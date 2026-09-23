import { describe, expect, mock, test } from "bun:test";
import {
  SurfaceBuildInstructionsError,
  SurfaceBuildInstructionsLoader,
} from "../src/surface-build-instructions.js";

const sourceUrl = "https://traces.com/building_surfaces.md";

const response = (body: string, status = 200, headers?: HeadersInit) =>
  new Response(body, { status, headers });

describe("SurfaceBuildInstructionsLoader", () => {
  test("fetches and hashes the canonical Markdown", async () => {
    const fetchImpl = mock(async () => response("# Build a surface\n"));
    const loader = new SurfaceBuildInstructionsLoader(sourceUrl, fetchImpl, () => 123);

    const result = await loader.load();

    expect(result).toMatchObject({
      sourceUrl,
      markdown: "# Build a surface\n",
      fetchedAt: 123,
      stale: false,
      contentHash: "4c8d8a12e30119a394c3b8d2c6944ec9d37e45d3d82a7a6aade28e38c012fee0",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("caches successful responses within the refresh window", async () => {
    let now = 100;
    const fetchImpl = mock(async () => response("cached"));
    const loader = new SurfaceBuildInstructionsLoader(sourceUrl, fetchImpl, () => now);

    await loader.load();
    now += 1_000;
    const result = await loader.load();

    expect(result.markdown).toBe("cached");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("returns the last successful response when refresh fails", async () => {
    let now = 100;
    const responses = [response("cached"), response("unavailable", 503)];
    const fetchImpl = mock(async () => responses.shift() ?? response("unavailable", 503));
    const loader = new SurfaceBuildInstructionsLoader(sourceUrl, fetchImpl, () => now);

    await loader.load();
    now += 5 * 60_000;
    const result = await loader.load();

    expect(result).toMatchObject({ markdown: "cached", stale: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("rejects empty and oversized responses without a cache", async () => {
    const empty = new SurfaceBuildInstructionsLoader(sourceUrl, async () => response(""));
    await expect(empty.load()).rejects.toBeInstanceOf(SurfaceBuildInstructionsError);

    const oversized = new SurfaceBuildInstructionsLoader(sourceUrl, async () =>
      response("x".repeat(128 * 1024 + 1)),
    );
    await expect(oversized.load()).rejects.toThrow("too large");
  });
});
