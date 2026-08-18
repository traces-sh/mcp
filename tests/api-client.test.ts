import { afterEach, describe, expect, mock, test } from "bun:test";
import { TracesApiClient, TracesApiError } from "../src/api-client.js";

const context = {
  accessToken: "test-token",
  apiUrl: "https://agent.traces.com",
  namespaceId: "namespace-1",
  transport: "stdio" as const,
};

afterEach(() => mock.restore());

describe("TracesApiClient", () => {
  test("adds authentication and the configured namespace", async () => {
    const fetchImpl = mock(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ ok: true, data: { traces: [] } }),
    );
    const client = new TracesApiClient(context, fetchImpl);

    await client.list({ limit: 10 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    if (!init) throw new Error("Expected request options");
    expect(input).toBe("https://agent.traces.com/v1/tools/list");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-token");
    expect(JSON.parse(String(init.body))).toEqual({ limit: 10, namespaceIds: ["namespace-1"] });
  });

  test("returns a safe upstream error", async () => {
    const fetchImpl = mock(async () =>
      Response.json({ ok: false, error: { message: "Access denied" } }, { status: 403 }),
    );
    const client = new TracesApiClient(context, fetchImpl);

    expect(client.list({})).rejects.toEqual(new TracesApiError("Access denied", 403));
  });

  test("calls the authenticated lookup endpoint", async () => {
    const fetchImpl = mock(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        ok: true,
        data: {
          kind: "user",
          results: [],
          ambiguous: false,
          truncated: false,
          text: "no user matches",
        },
      }),
    );
    const client = new TracesApiClient(context, fetchImpl);

    await client.lookup({ kind: "user", id: "user-1" });

    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    expect(input).toBe("https://agent.traces.com/v1/tools/lookup");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
    expect(JSON.parse(String(init?.body))).toEqual({ kind: "user", id: "user-1" });
  });
});
