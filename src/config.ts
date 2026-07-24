function url(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error(`${name} must use HTTPS unless it targets localhost.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

export function apiUrl(): string {
  return url("TRACES_API_URL", "https://agent.traces.com");
}

export function publicUrl(): string {
  return url("MCP_PUBLIC_URL", "http://localhost:3001");
}

export function authorizationServer(): string {
  return url("MCP_AUTHORIZATION_SERVER", "https://traces.com");
}
