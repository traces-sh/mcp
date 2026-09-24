import { describe, expect, mock, test } from "bun:test";
import { createToolHandlers, normalizeTraceId } from "../src/tools.js";

const context = {
  accessToken: "test-token",
  apiUrl: "https://agent.traces.com",
  namespace: { id: "namespace-1", slug: "traces" },
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

  test("formats source session start with a created-time fallback", async () => {
    const fetchImpl = mock(async () =>
      Response.json({
        ok: true,
        data: {
          traces: [
            {
              externalId: "source-time",
              sourceCreatedAt: Date.UTC(2024, 0, 2, 3, 4),
              createdAt: Date.UTC(2025, 0, 2, 3, 4),
              updatedAt: Date.UTC(2026, 0, 2, 3, 4),
            },
            {
              externalId: "legacy-time",
              createdAt: Date.UTC(2024, 1, 3, 4, 5),
              updatedAt: Date.UTC(2026, 1, 3, 4, 5),
            },
          ],
          total: 2,
          truncated: false,
        },
      }),
    );

    const output = await createToolHandlers(context, fetchImpl).search({});

    expect(output).toContain("| Started |");
    expect(output).toContain("2024-01-02 03:04");
    expect(output).toContain("2024-02-03 04:05");
    expect(output).not.toContain("2026-01-02 03:04");
    expect(output).not.toContain("2026-02-03 04:05");
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

  test("discovers surface catalog operations incrementally", async () => {
    const output = await createToolHandlers(context).searchTools({ query: "surface release" });

    expect(output.isError).toBeUndefined();
    expect(output.structuredContent).toMatchObject({
      query: "surface release",
      results: expect.arrayContaining([
        expect.objectContaining({ name: "traces_surfaces_release_version" }),
      ]),
    });
  });

  test("executes a surface operation and returns its structured record", async () => {
    const surface = {
      id: "surface-1",
      namespaceId: "namespace-1",
      key: "overview",
      name: "Overview",
      description: null,
      icon: null,
      createdBy: "user-1",
      createdAt: 1,
      updatedAt: 2,
      archivedAt: null,
      publishStatus: "private",
      currentVersion: "1.0.0",
      versions: [],
    };
    const fetchImpl = mock(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/v1/namespaces/traces/surfaces")) {
        return Response.json({ ok: true, data: { surfaces: [surface] } });
      }
      expect(String(input)).toBe("https://agent.traces.com/v1/surfaces/overview");
      expect(init?.method).toBe("PATCH");
      return Response.json({ ok: true, data: { updated: true } });
    });

    const output = await createToolHandlers(context, fetchImpl).executeTool({
      name: "traces_surfaces_release_version",
      arguments: {
        surface: { key: "overview" },
        version: "1.0.0",
      },
    });

    expect(output.isError).toBeUndefined();
    expect(output.structuredContent).toEqual(surface);
  });

  test("formats catalog input errors as failed text results", async () => {
    const output = await createToolHandlers(context).executeTool({
      name: "traces_surfaces_archive",
      arguments: { surface: { key: "" } },
    });

    expect(output.isError).toBe(true);
    expect(output.content).toMatchObject([
      { type: "text", text: expect.stringContaining("**Input Error**") },
    ]);
  });

  test("completing an upload leaves the version unreleased and returns a pinned preview link", async () => {
    const surface = { id: "surface-1", key: "overview", name: "Overview", currentVersion: null };
    const calls: string[] = [];
    const fetchImpl = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
      if (url.endsWith("/v1/tools/list")) {
        return Response.json({
          ok: true,
          data: { traces: [{ externalId: "trace-9", url: "https://traces.com/s/trace-9" }] },
        });
      }
      if (url.endsWith("/v1/namespaces/traces/surfaces")) {
        return Response.json({ ok: true, data: { surfaces: [surface] } });
      }
      return Response.json({ ok: true, data: {} });
    });

    const output = await createToolHandlers(context, fetchImpl).executeTool({
      name: "traces_surfaces_complete_upload",
      arguments: { surface: { key: "overview" }, version: "1.0.0", artifactId: "artifact-1" },
    });

    expect(output.isError).toBeUndefined();
    expect(output.structuredContent).toMatchObject({
      released: false,
      previewUrl: "https://traces.com/s/trace-9?surface=overview&version=1.0.0",
    });
    expect(calls).not.toContain("PATCH /v1/surfaces/overview");
  });

  test("returns the canonical surface-building skill with the latest trace", async () => {
    const fetchImpl = mock(async (input: string | URL | Request) => {
      if (String(input).endsWith("/v1/tools/list")) {
        return Response.json({
          ok: true,
          data: { traces: [{ externalId: "trace-9", url: "https://traces.com/s/trace-9" }] },
        });
      }
      expect(String(input)).toBe("https://traces.com/surfaces.md");
      return new Response("# Build a surface\n");
    });

    const output = await createToolHandlers(context, fetchImpl).buildInstructions();

    expect(output).toContain("Canonical source: https://traces.com/surfaces.md");
    expect(output).toContain("Latest trace in this namespace");
    expect(output).toContain("https://traces.com/s/trace-9");
    expect(output).toContain("# Build a surface");
  });

  test("parses a trace URL", () => {
    expect(normalizeTraceId("https://traces.com/s/trace-123?tab=events")).toBe("trace-123");
  });
});
