function origin(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  const parsed = new URL(value);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    throw new Error(`${name} must use HTTPS unless it targets a loopback address.`);
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${name} must be an origin without credentials, a path, query, or fragment.`);
  }
  return parsed.origin;
}

export function apiUrl(): string {
  return origin("TRACES_API_URL", "https://agent.traces.com");
}

export function surfaceApiUrl(): string {
  return origin("TRACES_SURFACES_API_URL", "https://actions.traces.com");
}

export function webUrl(): string {
  return origin("TRACES_WEB_URL", "https://traces.com");
}

export function publicUrl(): string {
  return origin("MCP_PUBLIC_URL", "http://localhost:3001");
}

export function authorizationServer(): string {
  return origin("MCP_AUTHORIZATION_SERVER", "https://auth.traces.com");
}

export function surfaceBuildInstructionsUrl(): string {
  const value =
    process.env.TRACES_SURFACE_BUILD_INSTRUCTIONS_URL ?? "https://traces.com/surfaces.md";
  const parsed = new URL(value);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    throw new Error(
      "TRACES_SURFACE_BUILD_INSTRUCTIONS_URL must use HTTPS unless it targets a loopback address.",
    );
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname === "/"
  ) {
    throw new Error(
      "TRACES_SURFACE_BUILD_INSTRUCTIONS_URL must be a URL without credentials, query, or fragment and must include a path.",
    );
  }
  return parsed.toString();
}
