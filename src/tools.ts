import { z } from "zod";
import { TracesApiClient, type Fetch } from "./api-client.js";
import { formatTraceList, formatTraceRead } from "./format.js";
import type { ServerContext } from "./types.js";

export const searchInputSchema = {
  projectName: z.string().min(1).optional().describe("Exact project name."),
  projectPath: z.string().min(1).optional().describe("Project path prefix."),
  createdByUserIds: z.array(z.string().min(1)).optional().describe("Traces creator IDs."),
  since: z
    .string()
    .regex(/^\d+(ms|s|m|h|d|w)$/)
    .optional()
    .describe("Relative activity window, such as 24h, 7d, or 2w."),
  after: z.union([z.string(), z.number()]).optional().describe("Inclusive lower time bound."),
  before: z.union([z.string(), z.number()]).optional().describe("Exclusive upper time bound."),
  limit: z.number().int().min(1).max(200).default(20).describe("Maximum traces to return."),
};

export const readInputSchema = {
  traceId: z.string().min(1).describe("Trace external ID or Traces URL."),
  includeTools: z.boolean().default(false).describe("Include tool calls and tool results."),
  offset: z.number().int().min(1).optional().describe("1-indexed event offset."),
  limit: z.number().int().min(1).max(200).default(40).describe("Maximum events to return."),
  aroundEvent: z.number().int().min(1).optional().describe("Center the window on an event."),
  before: z.number().int().min(0).optional().describe("Events before aroundEvent."),
  after: z.number().int().min(0).optional().describe("Events after aroundEvent."),
  maxEventChars: z.number().int().min(100).max(10_000).optional(),
};

export function normalizeTraceId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("traceId is required");
  if (!/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^trace:/i, "");
  const parts = new URL(trimmed).pathname.split("/").filter(Boolean);
  const traceId = parts.at(-1);
  if (!traceId) throw new Error("The Traces URL does not contain a trace ID.");
  return traceId;
}

export function createToolHandlers(context: ServerContext, fetchImpl: Fetch = fetch) {
  const api = new TracesApiClient(context, fetchImpl);
  return {
    search: async (input: Record<string, unknown>) => formatTraceList(await api.list(input)),
    read: async (input: {
      traceId: string;
      includeTools?: boolean;
      offset?: number;
      limit?: number;
      aroundEvent?: number;
      before?: number;
      after?: number;
      maxEventChars?: number;
    }) => {
      const traceId = normalizeTraceId(input.traceId);
      const eventTypes = input.includeTools
        ? ["user_message", "agent_text", "tool_call", "tool_result"]
        : ["user_message", "agent_text"];
      const read = await api.show({
        externalId: traceId,
        eventTypes,
        ...(input.offset !== undefined ? { offset: input.offset } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.aroundEvent !== undefined ? { aroundEvent: input.aroundEvent } : {}),
        ...(input.before !== undefined ? { before: input.before } : {}),
        ...(input.after !== undefined ? { after: input.after } : {}),
        ...(input.maxEventChars !== undefined ? { maxEventChars: input.maxEventChars } : {}),
      });
      const markdown = formatTraceRead(traceId, read);
      return markdown.length > 50_000
        ? `${markdown.slice(0, 50_000)}\n\n[Response truncated. Read another event window.]`
        : markdown;
    },
  };
}
