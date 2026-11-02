import { describe, expect, mock, test } from "bun:test";
import { createToolHandlers } from "../src/tools.js";

const context = {
  accessToken: "test-token",
  apiUrl: "https://agent.traces.com",
  surfaceApiUrl: "https://actions.traces.com",
  namespace: { id: "namespace-1", slug: "clay" },
  transport: "http" as const,
};

type Call = { method: string; url: string; body: Record<string, unknown> };

function api(responses: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = mock(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: String(init?.method),
      url: String(input),
      body: JSON.parse(String(init?.body)),
    });
    const response = responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  });
  return { calls, tools: createToolHandlers(context, fetchImpl) };
}

const ok = (data: unknown) => Response.json({ ok: true, data });
const fail = (status: number, message: string) =>
  Response.json({ ok: false, error: { message } }, { status });

describe("traces_upsert", () => {
  test("creates a private trace and appends messages on the first call", async () => {
    const { calls, tools } = api([ok({ trace: { id: "trace-doc-1" } }), ok({ messages: 1 })]);

    const result = await tools.upsert({
      externalId: "skillhub-run-1",
      trace: {
        agentId: "skill-hub",
        title: "Call prep",
        sourceCreatedAt: "2026-10-29T15:04:00Z",
      },
      messages: [
        {
          externalId: "skillhub-run-1-0001",
          role: "assistant",
          order: 1,
          timestamp: "2026-10-29T15:04:12Z",
          textContent: "brief",
        },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      traceId: "trace-doc-1",
      externalId: "skillhub-run-1",
      namespace: "clay",
      appended: 1,
    });
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "PUT https://actions.traces.com/v1/traces/skillhub-run-1",
      "POST https://actions.traces.com/v1/traces/skillhub-run-1/messages/batch",
    ]);
    expect(calls[0]?.body).toEqual({
      agentId: "skill-hub",
      title: "Call prep",
      visibility: "private",
      sourceCreatedAt: 1793286240000,
    });
    expect(calls[1]?.body).toEqual({
      messages: [
        {
          externalId: "skillhub-run-1-0001",
          role: "assistant",
          order: 1,
          timestamp: 1793286252000,
          textContent: "brief",
        },
      ],
    });
  });

  test("appends messages without touching the trace when trace fields are omitted", async () => {
    const { calls, tools } = api([ok({ messages: 2 })]);

    const result = await tools.upsert({
      externalId: "skillhub-run-1",
      messages: [
        { externalId: "m-2", role: "user", textContent: "edit" },
        { externalId: "m-3", role: "assistant", textContent: "sent email" },
      ],
    });

    expect(result.structuredContent).toEqual({
      traceId: null,
      externalId: "skillhub-run-1",
      namespace: "clay",
      appended: 2,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
  });

  test("marks rate limits and server errors as retryable and keeps a known trace ID", async () => {
    const { tools } = api([ok({ trace: { id: "trace-doc-1" } }), fail(503, "Unavailable")]);

    const result = await tools.upsert({
      externalId: "skillhub-run-1",
      trace: { agentId: "skill-hub" },
      messages: [{ externalId: "m-1", role: "assistant", textContent: "brief" }],
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      traceId: "trace-doc-1",
      error: { retryable: true, status: 503 },
    });

    const limited = await api([fail(429, "Slow down")]).tools.upsert({
      externalId: "skillhub-run-1",
      messages: [{ externalId: "m-1", role: "assistant", textContent: "brief" }],
    });
    expect(limited.structuredContent).toMatchObject({ error: { retryable: true, status: 429 } });
  });

  test("marks permission and validation failures as permanent", async () => {
    const forbidden = await api([fail(403, "Missing scope")]).tools.upsert({
      externalId: "skillhub-run-1",
      trace: { agentId: "skill-hub" },
    });
    expect(forbidden.isError).toBe(true);
    expect(forbidden.structuredContent).toMatchObject({
      error: { retryable: false, status: 403 },
    });

    const { calls, tools } = api([]);
    const empty = await tools.upsert({ externalId: "skillhub-run-1" });
    expect(empty.structuredContent).toMatchObject({
      error: { message: "Provide trace fields, messages, or both.", retryable: false },
    });
    expect(calls).toHaveLength(0);
  });
});
