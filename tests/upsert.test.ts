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
const trace = { agentId: "skill-hub", visibility: "private" as const };
const message = (externalId: string) => ({
  externalId,
  role: "assistant" as const,
  textContent: "brief",
});

describe("traces_upsert", () => {
  test("creates a trace and appends messages on the first call", async () => {
    const { calls, tools } = api([ok({ trace: { id: "trace-doc-1" } }), ok({ messages: 1 })]);

    const result = await tools.upsert({
      externalId: "skillhub-run-1",
      namespace: "clay",
      trace: { ...trace, title: "Call prep", sourceCreatedAt: "2026-10-29T15:04:00Z" },
      messages: [
        { ...message("skillhub-run-1-0001"), order: 1, timestamp: "2026-10-29T15:04:12Z" },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      ok: true,
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
      messages: [message("m-2"), message("m-3")],
    });

    expect(result.structuredContent).toEqual({
      ok: true,
      traceId: null,
      externalId: "skillhub-run-1",
      namespace: "clay",
      appended: 2,
    });
    expect(calls.map(({ method }) => method)).toEqual(["POST"]);
  });

  test("writes nothing when the connection is bound to a different namespace", async () => {
    const { calls, tools } = api([]);

    const result = await tools.upsert({
      externalId: "skillhub-run-1",
      namespace: "acme",
      trace,
      messages: [message("m-1")],
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "namespace_mismatch", retryable: false },
    });
    expect(calls).toHaveLength(0);
  });

  test("marks rate limits and outages as retryable and keeps a trace ID already written", async () => {
    const outage = await api([
      ok({ trace: { id: "trace-doc-1" } }),
      fail(503, "Unavailable"),
    ]).tools.upsert({ externalId: "skillhub-run-1", trace, messages: [message("m-1")] });
    expect(outage.isError).toBe(true);
    expect(outage.structuredContent).toMatchObject({
      ok: false,
      traceId: "trace-doc-1",
      error: { code: "unavailable", retryable: true },
    });

    const limited = await api([fail(429, "Slow down")]).tools.upsert({
      externalId: "skillhub-run-1",
      messages: [message("m-1")],
    });
    expect(limited.structuredContent).toMatchObject({
      error: { code: "rate_limited", retryable: true },
    });
  });

  test("marks permission, missing-trace, and empty calls as permanent", async () => {
    const forbidden = await api([fail(403, "Missing scope")]).tools.upsert({
      externalId: "skillhub-run-1",
      trace,
      messages: [],
    });
    expect(forbidden.structuredContent).toMatchObject({
      error: { code: "forbidden", retryable: false },
    });

    const missing = await api([fail(404, "Trace not found")]).tools.upsert({
      externalId: "skillhub-run-unknown",
      messages: [message("m-1")],
    });
    expect(missing.structuredContent).toMatchObject({
      error: { code: "not_found", retryable: false },
    });

    const { calls, tools } = api([]);
    const empty = await tools.upsert({ externalId: "skillhub-run-1", messages: [] });
    expect(empty.structuredContent).toMatchObject({
      error: { code: "invalid_input", retryable: false },
    });
    expect(calls).toHaveLength(0);
  });
});
