import { describe, expect, mock, test } from "bun:test";
import { createToolHandlers, normalizeTraceId } from "../src/tools.js";

const context = {
  accessToken: "test-token",
  apiUrl: "https://agent.traces.com",
  transport: "http" as const,
};

describe("trace tools", () => {
  test("accepts arbitrary creator IDs", async () => {
    const fetchImpl = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.createdByUserIds).toEqual(["customer-user-id"]);
      return Response.json({ ok: true, data: { traces: [], total: 0 } });
    });

    const output = await createToolHandlers(context, fetchImpl).search({
      createdByUserIds: ["customer-user-id"],
    });

    expect(output).toContain("Found 0 trace(s) of 0");
  });

  test("normalizes referenced authors once and uses slugs in trace rows", async () => {
    const fetchImpl = mock(async () =>
      Response.json({
        ok: true,
        data: {
          traces: [
            {
              externalId: "trace-1",
              createdBy: "user-1",
              createdAt: 0,
              agentId: "pi",
              projectName: "traces",
              title: "First",
            },
            {
              externalId: "trace-2",
              createdBy: "user-1",
              createdAt: 1,
              agentId: "pi",
              projectName: "traces",
              title: "Second",
            },
          ],
          authors: [
            { id: "user-1", displayName: "Srihari", slug: "ssrihari" },
            { id: "not-in-results", displayName: "Other", slug: "other" },
          ],
          total: 2,
          truncated: false,
        },
      }),
    );

    const output = await createToolHandlers(context, fetchImpl).search({});

    expect(output.match(/user-1/g)).toHaveLength(1);
    expect(output.match(/Srihari/g)).toHaveLength(1);
    expect(output.match(/@ssrihari/g)).toHaveLength(3);
    expect(output).not.toContain("not-in-results");
    expect(output).not.toContain("Other");
  });

  test("formats user lookup results for deterministic chaining", async () => {
    const fetchImpl = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        kind: "user",
        query: "Srihari",
        namespaceId: "namespace-1",
      });
      return Response.json({
        ok: true,
        data: {
          kind: "user",
          results: [
            {
              kind: "user",
              id: "user-1",
              displayName: "Srihari",
              slug: "ssrihari",
              namespaces: [{ id: "namespace-1", slug: "traces", role: "member" }],
            },
          ],
          ambiguous: false,
          truncated: false,
        },
      });
    });

    const output = await createToolHandlers(context, fetchImpl).lookup({
      kind: "user",
      query: "Srihari",
      namespaceId: "namespace-1",
    });

    expect(output).toContain("Srihari");
    expect(output).toContain("@ssrihari");
    expect(output).toContain("user-1");
    expect(output).toContain("@traces");
  });

  test("reads only conversational events by default", async () => {
    const fetchImpl = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        externalId: "trace-123",
        eventTypes: ["user_message", "agent_text"],
      });
      expect(body).not.toHaveProperty("includeTools");
      expect(body).not.toHaveProperty("traceId");
      return Response.json({
        ok: true,
        data: {
          reads: [
            {
              trace: { title: "Example" },
              events: [{ type: "user_message", content: "Help me" }],
            },
          ],
        },
      });
    });

    const output = await createToolHandlers(context, fetchImpl).read({
      traceId: "https://traces.com/s/trace-123",
    });

    expect(output).toContain("# Example");
    expect(output).toContain("Help me");
  });

  test("parses a trace URL", () => {
    expect(normalizeTraceId("https://traces.com/s/trace-123?tab=events")).toBe("trace-123");
  });
});
