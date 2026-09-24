import { afterEach, describe, expect, mock, test } from "bun:test";
import { TracesApiClient, TracesApiError } from "../src/api-client.js";
import type { SurfaceManagementRecord } from "../src/types.js";

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

  test("normalizes nullable surface management fields", async () => {
    const fetchImpl = mock(async (input: string | URL | Request) => {
      expect(input).toBe("https://agent.traces.com/v1/namespaces/traces/surfaces");
      return Response.json({
        ok: true,
        data: {
          role: "member",
          surfaces: [
            {
              id: "surface-1",
              namespaceId: "namespace-1",
              key: "overview",
              name: "Overview",
              createdBy: "user-1",
              createdAt: 1,
              updatedAt: 2,
              publishStatus: "private",
              versions: [
                {
                  version: "1.0.0",
                  sdkVersion: "surface-sdk.v1",
                  htmlSha256: "hash",
                  htmlByteSize: 10,
                  createdAt: 1,
                  approvalStatus: "not_requested",
                },
              ],
            },
          ],
        },
      });
    });

    const surfaces = await new TracesApiClient(context, fetchImpl).listSurfaces("traces");

    expect(surfaces[0]).toMatchObject({
      description: null,
      icon: null,
      archivedAt: null,
      currentVersion: null,
      versions: [{ sourceUrl: null }],
    });
  });

  test("returns the resulting surface record after release", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const surface: SurfaceManagementRecord = {
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
      calls.push({ input: String(input), init });
      if (String(input).endsWith("/v1/namespaces/traces/surfaces")) {
        return Response.json({ ok: true, data: { surfaces: [surface] } });
      }
      if (String(input).endsWith("/v1/surfaces/overview")) {
        expect(init?.method).toBe("PATCH");
        return Response.json({ ok: true, data: { updated: true } });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    const result = await new TracesApiClient(context, fetchImpl).releaseSurfaceVersion(
      { namespaceSlug: "traces", key: "overview" },
      "1.0.0",
    );

    expect(result).toEqual(surface);
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.input).toBe("https://agent.traces.com/v1/surfaces/overview");
    expect(calls[1]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ currentVersion: "1.0.0" });
    expect(calls[2]?.init?.method).toBe("GET");
  });

  test("defaults to the bound namespace and refuses to leave it", async () => {
    const bound = {
      accessToken: "test-token",
      apiUrl: "https://agent.traces.com",
      namespace: { id: "namespace-1", slug: "traces" },
      transport: "http" as const,
    };
    const fetchImpl = mock(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ ok: true, data: { surfaces: [] } }),
    );
    const client = new TracesApiClient(bound, fetchImpl);

    await client.list({ namespaceIds: ["other"] });
    await client.lookup({ kind: "user", query: "ann" });
    await client.listSurfaces();

    const bodies = fetchImpl.mock.calls.map(
      ([, init]) => init?.body && JSON.parse(String(init.body)),
    );
    expect(bodies[0]).toEqual({ namespaceIds: ["namespace-1"] });
    expect(bodies[1]).toEqual({ kind: "user", query: "ann", namespaceId: "namespace-1" });
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(
      "https://agent.traces.com/v1/namespaces/traces/surfaces",
    );
    expect(client.listSurfaces("other")).rejects.toMatchObject({ status: 403 });
  });

  test("publishes HTML through prepare and complete upload", async () => {
    const surface: SurfaceManagementRecord = {
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
      currentVersion: null,
      versions: [],
    };
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    let created = false;
    const fetchImpl = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method, body: init?.body && JSON.parse(String(init.body)) });
      if (url.endsWith("/v1/namespaces/traces/surfaces") && init?.method === "GET") {
        return Response.json({ ok: true, data: { surfaces: created ? [surface] : [] } });
      }
      if (url.endsWith("/v1/namespaces/traces/surfaces")) {
        created = true;
        return Response.json({ ok: true, data: { id: "surface-1" } });
      }
      if (url.endsWith("/versions/uploads")) {
        return Response.json({
          ok: true,
          data: {
            upload: { url: "https://actions.traces.com/u/tok", method: "POST", headers: {} },
          },
        });
      }
      return Response.json({ ok: true, data: {} });
    });
    const client = new TracesApiClient(
      { ...context, namespace: { id: "namespace-1", slug: "traces" } },
      fetchImpl,
    );

    const prepared = await client.prepareSurfaceUpload({ key: "overview" }, "1.0.0", 42, {
      name: "Overview",
    });
    expect(prepared.created).toBe(true);
    expect(prepared.upload.url).toBe("https://actions.traces.com/u/tok");
    expect(calls.find((c) => c.url.endsWith("/versions/uploads"))?.body).toEqual({
      version: "1.0.0",
      byteSize: 42,
    });

    await client.completeSurfaceUpload({ key: "overview" }, "1.0.0", "artifact-1", true);
    expect(calls.find((c) => c.url.endsWith("/uploads/complete"))?.body).toEqual({
      version: "1.0.0",
      artifactId: "artifact-1",
    });
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ currentVersion: "1.0.0" });
  });
});
