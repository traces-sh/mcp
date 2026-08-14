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

export function publicUrl(): string {
  return origin("MCP_PUBLIC_URL", "http://localhost:3001");
}

export function authorizationServer(): string {
  return origin("MCP_AUTHORIZATION_SERVER", "https://auth.traces.com");
}
