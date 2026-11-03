import type { Fetch } from "./api-client.js";
import type { NamespaceRef, SessionData } from "./types.js";

export type SessionLookup =
  /** `scopes` is absent when the credential carries every scope (or the API predates the field). */
  | { status: "valid"; namespace: NamespaceRef; scopes?: string[] }
  | { status: "invalid" }
  | { status: "unavailable" };

function sessionFromPayload(
  payload: unknown,
): { namespace: NamespaceRef; scopes?: string[] } | undefined {
  const data = (payload as { data?: Partial<SessionData> } | undefined)?.data;
  const namespace = data?.activeNamespace;
  if (typeof namespace?.id !== "string" || typeof namespace.slug !== "string") return undefined;
  const scopes = data?.session?.scopes;
  return {
    namespace: { id: namespace.id, slug: namespace.slug },
    ...(Array.isArray(scopes) ? { scopes: scopes.filter((s) => typeof s === "string") } : {}),
  };
}

/** Validates a bearer token against `GET /v1/session` and returns the namespace and scopes it is bound to. */
export async function lookupSession(
  token: string,
  authorizationServer: string,
  fetchImpl: Fetch,
): Promise<SessionLookup> {
  try {
    const response = await fetchImpl(`${authorizationServer}/v1/session`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const session = sessionFromPayload(await response.json().catch(() => undefined));
      return session ? { status: "valid", ...session } : { status: "invalid" };
    }
    return {
      status: response.status === 401 || response.status === 403 ? "invalid" : "unavailable",
    };
  } catch {
    return { status: "unavailable" };
  }
}
