import { createHash } from "node:crypto";
import type { Fetch } from "./api-client.js";

const CACHE_TTL_MS = 5 * 60_000;
const MAX_INSTRUCTIONS_BYTES = 128 * 1024;

export type SurfaceBuildInstructions = {
  sourceUrl: string;
  markdown: string;
  contentHash: string;
  fetchedAt: number;
  stale: boolean;
};

export class SurfaceBuildInstructionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SurfaceBuildInstructionsError";
  }
}

export class SurfaceBuildInstructionsLoader {
  private cached: SurfaceBuildInstructions | undefined;
  private pending: Promise<SurfaceBuildInstructions> | undefined;

  constructor(
    private readonly sourceUrl: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<SurfaceBuildInstructions> {
    const current = this.cached;
    if (current && this.now() - current.fetchedAt < CACHE_TTL_MS) return current;
    if (this.pending) return this.pending;

    this.pending = this.fetchInstructions();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  private async fetchInstructions(): Promise<SurfaceBuildInstructions> {
    try {
      const response = await this.fetchImpl(this.sourceUrl, {
        headers: { accept: "text/markdown, text/plain;q=0.9" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new SurfaceBuildInstructionsError(
          `The canonical surface-building skill returned HTTP ${response.status}.`,
        );
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_INSTRUCTIONS_BYTES) {
        throw new SurfaceBuildInstructionsError(
          "The canonical surface-building skill is too large.",
        );
      }

      const markdown = await response.text();
      const bytes = new TextEncoder().encode(markdown).byteLength;
      if (bytes === 0) {
        throw new SurfaceBuildInstructionsError("The canonical surface-building skill was empty.");
      }
      if (bytes > MAX_INSTRUCTIONS_BYTES) {
        throw new SurfaceBuildInstructionsError(
          "The canonical surface-building skill is too large.",
        );
      }

      const fetchedAt = this.now();
      const result: SurfaceBuildInstructions = {
        sourceUrl: this.sourceUrl,
        markdown,
        contentHash: createHash("sha256").update(markdown).digest("hex"),
        fetchedAt,
        stale: false,
      };
      this.cached = result;
      return result;
    } catch (error) {
      if (error instanceof SurfaceBuildInstructionsError) {
        if (this.cached) return { ...this.cached, stale: true };
        throw error;
      }
      if (this.cached) return { ...this.cached, stale: true };
      throw new SurfaceBuildInstructionsError(
        `The canonical surface-building skill could not be fetched: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }
}
