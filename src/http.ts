import { createHash } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Fetch } from "./api-client.js";
import { apiUrl, authorizationServer, publicUrl, surfaceApiUrl } from "./config.js";
import { buildServer } from "./server.js";

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

function unauthorized(resourceUrl: string, description?: string): Response {
  const metadataUrl = `${resourceUrl}/.well-known/oauth-protected-resource`;
  const attributes = [
    'Bearer realm="Traces MCP"',
    `resource_metadata="${metadataUrl}"`,
    ...(description ? [`error="invalid_token"`, `error_description="${description}"`] : []),
  ];
  return new Response("Authentication required", {
    status: 401,
    headers: { "www-authenticate": attributes.join(", "), ...CORS_HEADERS },
  });
}

type TokenValidation = "valid" | "invalid" | "unavailable";

const TOKEN_VALIDATION_TTL_MS = 60_000;
const TOKEN_VALIDATION_CACHE_MAX = 10_000;

async function fetchTokenValidation(
  token: string,
  authorizationServer: string,
  fetchImpl: Fetch,
): Promise<TokenValidation> {
  try {
    const response = await fetchImpl(`${authorizationServer}/v1/session`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return "valid";
    return response.status === 401 || response.status === 403 ? "invalid" : "unavailable";
  } catch {
    return "unavailable";
  }
}

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

    const lookup = fetchTokenValidation(token, authorizationServer, fetchImpl).then((result) => {
      if (result !== "unavailable") {
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
          scopes_supported: ["traces:read"],
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
    if (validation === "invalid") {
      return unauthorized(options.publicUrl, "The access token is invalid or expired");
    }
    if (validation === "unavailable") {
      return new Response("Traces authentication is temporarily unavailable", {
        status: 503,
        headers: CORS_HEADERS,
      });
    }

    const server = buildServer(
      {
        accessToken: token,
        apiUrl: options.apiUrl,
        surfaceApiUrl: options.surfaceApiUrl,
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
