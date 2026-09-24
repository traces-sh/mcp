import { describe, expect, mock, test } from "bun:test";
import { createHttpHandler, createTokenValidator } from "../src/http.js";

const options = {
  apiUrl: "https://agent.traces.com",
  authorizationServer: "https://auth.traces.com",
  publicUrl: "https://mcp.traces.com",
};

const sessionResponse = () =>
  Response.json({
    ok: true,
    data: { activeNamespace: { id: "namespace-1", slug: "traces", role: "admin" } },
  });

describe("HTTP transport", () => {
  test("publishes OAuth protected-resource metadata", async () => {
    const response = await createHttpHandler(options)(
      new Request("https://mcp.traces.com/.well-known/oauth-protected-resource"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({
      resource: "https://mcp.traces.com",
      authorization_servers: ["https://auth.traces.com"],
      scopes_supported: ["traces:read", "surfaces:write"],
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
    expect(response.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
  });

  test("allows browser clients to preflight MCP requests", async () => {
    const response = await createHttpHandler(options)(
      new Request("https://mcp.traces.com", {
        method: "OPTIONS",
        headers: {
          origin: "https://client.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  test("serves an authenticated MCP initialization", async () => {
    const fetchImpl = mock(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://auth.traces.com/v1/session");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer valid-token");
      return sessionResponse();
    });
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
    expect(body.result.instructions).toContain("traces_lookup");
  });

  test("advertises the lookup tool", async () => {
    const fetchImpl = mock(async () => sessionResponse());
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
          id: 2,
          method: "tools/list",
          params: {},
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const toolNames = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "traces_lookup",
        "traces_search_tools",
        "traces_execute_tool",
        "surface_build_instructions",
      ]),
    );
  });

  test("exposes no namespace inputs on any tool", async () => {
    const fetchImpl = mock(async () => sessionResponse());
    const handler = createHttpHandler({ ...options, fetchImpl });
    const call = (body: Record<string, unknown>) =>
      handler(
        new Request("https://mcp.traces.com", {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            authorization: "Bearer valid-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 4, ...body }),
        }),
      ).then((response) => response.json());

    const listed = await call({ method: "tools/list", params: {} });
    const catalog = await call({
      method: "tools/call",
      params: { name: "traces_search_tools", arguments: { query: "surface", limit: 20 } },
    });
    const schemas = [
      ...listed.result.tools.map((tool: { inputSchema: unknown }) => tool.inputSchema),
      ...catalog.result.structuredContent.results.map(
        (tool: { inputSchema: unknown }) => tool.inputSchema,
      ),
    ];

    expect(schemas.length).toBeGreaterThan(10);
    expect(JSON.stringify(schemas)).not.toMatch(/namespace(Id|Ids|Slug)/);
  });

  test("rejects a token whose session has no namespace", async () => {
    const fetchImpl = mock(async () => Response.json({ ok: true, data: {} }));
    const response = await createHttpHandler({ ...options, fetchImpl })(
      new Request("https://mcp.traces.com", {
        method: "POST",
        headers: { authorization: "Bearer unbound-token" },
      }),
    );

    expect(response.status).toBe(401);
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

  test("validates a token once for a burst of concurrent requests", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = mock(async () => {
      await gate;
      return sessionResponse();
    });
    const handler = createHttpHandler({ ...options, fetchImpl });
    const request = () =>
      handler(
        new Request("https://mcp.traces.com", {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            authorization: "Bearer valid-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        }),
      );

    const pending = Promise.all([request(), request(), request()]);
    release();
    const responses = await pending;

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("reuses a token validation within its TTL and expires it afterwards", async () => {
    let clock = 0;
    const fetchImpl = mock(async () => sessionResponse());
    const validate = createTokenValidator(options.authorizationServer, fetchImpl, () => clock);

    expect((await validate("token-a")).status).toBe("valid");
    expect((await validate("token-a")).status).toBe("valid");
    expect((await validate("token-b")).status).toBe("valid");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    clock = 60_001;
    expect((await validate("token-a")).status).toBe("valid");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test("does not cache an authentication service outage", async () => {
    const statuses = [503, 200];
    const fetchImpl = mock(async () =>
      statuses.shift() === 503 ? new Response("", { status: 503 }) : sessionResponse(),
    );
    const validate = createTokenValidator(options.authorizationServer, fetchImpl);

    expect((await validate("token")).status).toBe("unavailable");
    expect((await validate("token")).status).toBe("valid");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("binds the session namespace so tools need no namespace input", async () => {
    const calls: string[] = [];
    const fetchImpl = mock(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/v1/session")) {
        return Response.json({
          ok: true,
          data: { activeNamespace: { id: "namespace-1", slug: "traces", role: "admin" } },
        });
      }
      return Response.json({ ok: true, data: { surfaces: [] } });
    });
    const handler = createHttpHandler({
      ...options,
      surfaceApiUrl: "https://actions.traces.com",
      fetchImpl,
    });
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
          id: 3,
          method: "tools/call",
          params: {
            name: "traces_execute_tool",
            arguments: { name: "traces_surfaces_search", arguments: {} },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent.namespaceSlug).toBe("traces");
    expect(calls).toContain("https://actions.traces.com/v1/namespaces/traces/surfaces");
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
