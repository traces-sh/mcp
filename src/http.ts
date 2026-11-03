import { createHash } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Fetch } from "./api-client.js";
import { apiUrl, authorizationServer, publicUrl, surfaceApiUrl } from "./config.js";
import { buildServer } from "./server.js";
import { lookupSession, type SessionLookup } from "./session.js";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
  "access-control-expose-headers": "WWW-Authenticate, MCP-Session-Id",
};

function bearerToken(request: Request): string | undefined {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

/** Scopes a new connection asks for. Clients request these instead of everything in `SUPPORTED_SCOPES`. */
const INITIAL_SCOPES = ["traces:read", "surfaces:write"];
const TRACES_WRITE = "traces:write";
const SUPPORTED_SCOPES = [...INITIAL_SCOPES, TRACES_WRITE];

/** Tools whose API routes need a scope that new connections do not get by default. */
const STEP_UP_TOOLS: Record<string, string> = { traces_upsert: TRACES_WRITE };

function unauthorized(resourceUrl: string, description?: string): Response {
  const metadataUrl = `${resourceUrl}/.well-known/oauth-protected-resource`;
  const attributes = [
    'Bearer realm="Traces MCP"',
    `resource_metadata="${metadataUrl}"`,
    `scope="${INITIAL_SCOPES.join(" ")}"`,
    ...(description ? [`error="invalid_token"`, `error_description="${description}"`] : []),
  ];
  return new Response("Authentication required", {
    status: 401,
    headers: { "www-authenticate": attributes.join(", "), ...CORS_HEADERS },
  });
}

/**
 * Asks the client to re-authorize with `scopes` (RFC 6750 `insufficient_scope`).
 * MCP clients prompt the user, then retry the call with the new token.
 */
function insufficientScope(resourceUrl: string, scopes: string[]): Response {
  const metadataUrl = `${resourceUrl}/.well-known/oauth-protected-resource`;
  const attributes = [
    'Bearer realm="Traces MCP"',
    `error="insufficient_scope"`,
    `scope="${scopes.join(" ")}"`,
    `resource_metadata="${metadataUrl}"`,
    `error_description="Saving traces needs write access"`,
  ];
  return new Response("Additional authorization required", {
    status: 403,
    headers: { "www-authenticate": attributes.join(", "), ...CORS_HEADERS },
  });
}

/** The scope the request's tool calls need but the token lacks, if any. */
async function missingToolScope(request: Request, scopes: string[]): Promise<string | undefined> {
  if (request.method !== "POST") return undefined;
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => undefined);
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    const call = message as { method?: unknown; params?: { name?: unknown } } | undefined;
    if (call?.method !== "tools/call" || typeof call.params?.name !== "string") continue;
    const required = STEP_UP_TOOLS[call.params.name];
    if (required && !scopes.includes(required)) return required;
  }
  return undefined;
}

type TokenValidation = SessionLookup;

const TOKEN_VALIDATION_TTL_MS = 60_000;
const TOKEN_VALIDATION_CACHE_MAX = 10_000;

function tokenCacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Coalesces concurrent lookups per token and caches definitive answers for a short TTL. */
export function createTokenValidator(
  authorizationServer: string,
  fetchImpl: Fetch,
  now: () => number = Date.now,
) {
  const settled = new Map<string, { result: TokenValidation; expiresAt: number }>();
  const inflight = new Map<string, Promise<TokenValidation>>();

  return async (token: string): Promise<TokenValidation> => {
    const key = tokenCacheKey(token);
    const cached = settled.get(key);
    if (cached && cached.expiresAt > now()) return cached.result;
    settled.delete(key);

    const pending = inflight.get(key);
    if (pending) return pending;

    const lookup = lookupSession(token, authorizationServer, fetchImpl).then((result) => {
      if (result.status !== "unavailable") {
        if (settled.size >= TOKEN_VALIDATION_CACHE_MAX) {
          const oldest = settled.keys().next().value;
          if (oldest !== undefined) settled.delete(oldest);
        }
        settled.set(key, { result, expiresAt: now() + TOKEN_VALIDATION_TTL_MS });
      }
      return result;
    });
    inflight.set(key, lookup);
    try {
      return await lookup;
    } finally {
      inflight.delete(key);
    }
  };
}

export type HttpHandlerOptions = {
  apiUrl: string;
  surfaceApiUrl?: string;
  authorizationServer: string;
  publicUrl: string;
  fetchImpl?: Fetch;
};

export function createHttpHandler(options: HttpHandlerOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const validateToken = createTokenValidator(options.authorizationServer, fetchImpl);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "traces-mcp" }, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return Response.json(
        {
          resource: options.publicUrl,
          authorization_servers: [options.authorizationServer],
          scopes_supported: SUPPORTED_SCOPES,
          bearer_methods_supported: ["header"],
        },
        { headers: { "cache-control": "public, max-age=3600", ...CORS_HEADERS } },
      );
    }

    if (url.pathname !== "/" && url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const token = bearerToken(request);
    if (!token) return unauthorized(options.publicUrl);
    const validation = await validateToken(token);
    if (validation.status === "invalid") {
      return unauthorized(options.publicUrl, "The access token is invalid or expired");
    }
    if (validation.status === "unavailable") {
      return new Response("Traces authentication is temporarily unavailable", {
        status: 503,
        headers: CORS_HEADERS,
      });
    }

    // Unknown scopes mean the credential is unrestricted; the API still enforces scopes either way.
    if (validation.scopes) {
      const missing = await missingToolScope(request, validation.scopes);
      if (missing) return insufficientScope(options.publicUrl, [...validation.scopes, missing]);
    }

    const server = buildServer(
      {
        accessToken: token,
        apiUrl: options.apiUrl,
        surfaceApiUrl: options.surfaceApiUrl,
        namespace: validation.namespace,
        transport: "http",
      },
      fetchImpl,
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value);
    return response;
  };
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3001);
  const server = Bun.serve({
    port,
    fetch: createHttpHandler({
      apiUrl: apiUrl(),
      surfaceApiUrl: surfaceApiUrl(),
      authorizationServer: authorizationServer(),
      publicUrl: publicUrl(),
    }),
  });
  console.error(`Traces MCP listening on ${server.url}`);
}
