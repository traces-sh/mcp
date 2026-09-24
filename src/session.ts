import type { Fetch } from "./api-client.js";
import type { NamespaceRef, SessionData } from "./types.js";

export type SessionLookup =
  | { status: "valid"; namespace: NamespaceRef }
  | { status: "invalid" }
  | { status: "unavailable" };

function namespaceFromSession(payload: unknown): NamespaceRef | undefined {
  const data = (payload as { data?: Partial<SessionData> } | undefined)?.data;
  const namespace = data?.activeNamespace;
  if (typeof namespace?.id === "string" && typeof namespace.slug === "string") {
    return { id: namespace.id, slug: namespace.slug };
  }
  return undefined;
}

/** Validates a bearer token against `GET /v1/session` and returns the namespace it is bound to. */
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
      const namespace = namespaceFromSession(await response.json().catch(() => undefined));
      return namespace ? { status: "valid", namespace } : { status: "invalid" };
    }
    return {
      status: response.status === 401 || response.status === 403 ? "invalid" : "unavailable",
    };
  } catch {
    return { status: "unavailable" };
  }
}
