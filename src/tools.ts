import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CatalogInputError, executeCatalog, searchCatalog } from "./catalog.js";
import { TracesApiClient, TracesApiError, type Fetch } from "./api-client.js";
import { surfaceBuildInstructionsUrl } from "./config.js";
import { formatLookup, formatTraceList, formatTraceRead } from "./format.js";
import { SurfaceBuildInstructionsLoader } from "./surface-build-instructions.js";
import type { ServerContext } from "./types.js";

export const searchInputSchema = {
  projectName: z.string().min(1).optional().describe("Exact project name."),
  projectPath: z.string().min(1).optional().describe("Project path prefix."),
  createdByUserIds: z.array(z.string().min(1)).optional().describe("Traces creator IDs."),
  since: z
    .string()
    .regex(/^\d+(ms|s|m|h|d|w)$/)
    .optional()
    .describe("Relative session-start window, such as 24h, 7d, or 2w."),
  after: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Inclusive lower session-start bound."),
  before: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Exclusive upper session-start bound."),
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

export const lookupInputSchema = {
  kind: z.enum(["user", "namespace", "agent_creator"]).describe("Entity kind to resolve."),
  query: z
    .string()
    .min(1)
    .optional()
    .describe("Case-insensitive display-name query, matched within this connection's namespace."),
  id: z.string().min(1).optional().describe("Exact entity ID. Use this to humanize an opaque ID."),
  slug: z
    .string()
    .min(1)
    .optional()
    .describe("Exact slug. Valid for namespaces and registered agents, not users."),
  limit: z.number().int().min(1).max(50).default(10).describe("Maximum matches to return."),
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

function structuredResult(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function errorResult(operation: string, error: unknown): CallToolResult {
  if (error instanceof CatalogInputError || error instanceof z.ZodError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: [
            "**Input Error**",
            "",
            "It looks like there was a problem with the input you provided.",
            "",
            error.message,
            "",
            "You may be able to resolve the issue by addressing the concern and trying again.",
          ].join("\n"),
        },
      ],
    };
  }

  if (error instanceof TracesApiError && error.status === 401) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: [
            "**Authorization Expired**",
            "",
            "Traces rejected the stored access token for this session. Please re-authorize to continue.",
          ].join("\n"),
        },
      ],
    };
  }

  if (error instanceof TracesApiError && error.status >= 400 && error.status < 500) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: [
            "**Input Error**",
            "",
            `There was an HTTP ${error.status} error with your request to the Traces API.`,
            "",
            error.message,
            "",
            "You may be able to resolve the issue by addressing the concern and trying again.",
          ].join("\n"),
        },
      ],
    };
  }

  const status = error instanceof TracesApiError ? error.status : undefined;
  const statusText = status
    ? `There was an HTTP ${status} server error with the Traces API.`
    : "It looks like there was a problem communicating with the Traces API.";
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: [
          "**Error**",
          "",
          statusText,
          ...(error instanceof TracesApiError ? ["", error.message] : []),
          "",
          `The ${operation} operation could not be completed. Please try again later.`,
        ].join("\n"),
      },
    ],
  };
}

export function createToolHandlers(context: ServerContext, fetchImpl: Fetch = fetch) {
  const api = new TracesApiClient(context, fetchImpl);
  const buildInstructions = new SurfaceBuildInstructionsLoader(
    surfaceBuildInstructionsUrl(),
    fetchImpl,
  );
  return {
    search: async (input: Record<string, unknown>) => formatTraceList(await api.list(input)),
    lookup: async (input: Record<string, unknown>) => formatLookup(await api.lookup(input)),
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
    buildInstructions: async () => {
      const instructions = await buildInstructions.load();
      return [
        `Canonical source: ${instructions.sourceUrl}`,
        `Content SHA-256: ${instructions.contentHash}`,
        ...(instructions.stale
          ? ["The canonical source was unavailable; this is the last cached copy."]
          : []),
        "",
        instructions.markdown,
      ].join("\n");
    },
    searchTools: async (input: unknown): Promise<CallToolResult> => {
      try {
        return structuredResult(searchCatalog(input));
      } catch (error) {
        return errorResult("traces_search_tools", error);
      }
    },
    executeTool: async (input: unknown): Promise<CallToolResult> => {
      try {
        const result = await executeCatalog(api, input);
        if (!result.output || typeof result.output !== "object" || Array.isArray(result.output)) {
          throw new Error(`Catalog tool ${result.name} returned an invalid structured result.`);
        }
        return structuredResult(result.output as Record<string, unknown>);
      } catch (error) {
        return errorResult("traces_execute_tool", error);
      }
    },
  };
}
