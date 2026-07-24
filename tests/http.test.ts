import { describe, expect, mock, test } from "bun:test";
import { createHttpHandler } from "../src/http.js";

const options = {
  apiUrl: "https://agent.traces.com",
  authorizationServer: "https://traces.com",
  publicUrl: "https://mcp.traces.com",
};

describe("HTTP transport", () => {
  test("publishes OAuth protected-resource metadata", async () => {
    const response = await createHttpHandler(options)(
      new Request("https://mcp.traces.com/.well-known/oauth-protected-resource"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: "https://mcp.traces.com",
      authorization_servers: ["https://traces.com"],
      scopes_supported: ["traces:read"],
      bearer_methods_supported: ["header"],
    });
  });

  test("challenges unauthenticated clients with metadata discovery", async () => {
    const response = await createHttpHandler(options)(
      new Request("https://mcp.traces.com", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.traces.com/.well-known/oauth-protected-resource"',
    );
  });

  test("serves an authenticated MCP initialization", async () => {
    const fetchImpl = mock(async () => Response.json({ ok: true, data: {} }));
    const handler = createHttpHandler({ ...options, fetchImpl });
    const response = await handler(
      new Request("https://mcp.traces.com", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer valid-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.serverInfo.name).toBe("traces-mcp");
  });

  test("rejects an invalid token", async () => {
    const fetchImpl = mock(async () => new Response("Unauthorized", { status: 401 }));
    const response = await createHttpHandler({ ...options, fetchImpl })(
      new Request("https://mcp.traces.com", {
        method: "POST",
        headers: { authorization: "Bearer invalid-token" },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  test("does not misreport an authentication service outage", async () => {
    const fetchImpl = mock(async () => new Response("Unavailable", { status: 503 }));
    const response = await createHttpHandler({ ...options, fetchImpl })(
      new Request("https://mcp.traces.com", {
        method: "POST",
        headers: { authorization: "Bearer valid-token" },
      }),
    );

    expect(response.status).toBe(503);
  });
});
