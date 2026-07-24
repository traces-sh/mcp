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
