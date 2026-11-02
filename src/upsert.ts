import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type TraceMessage, type TracesApiClient, TracesApiError } from "./api-client.js";

const timestampSchema = z
  .union([z.number().finite().nonnegative(), z.iso.datetime({ offset: true })])
  .describe("Epoch milliseconds or an ISO 8601 timestamp.");

const traceSchema = z.object({
  agentId: z
    .string()
    .min(1)
    .max(200)
    .describe("What produced this trace, such as skill-hub. Used to filter traces later."),
  title: z.string().max(1000).optional(),
  projectName: z.string().max(500).optional(),
  projectPath: z.string().max(500).optional(),
  model: z.string().max(200).optional(),
  visibility: z
    .enum(["private", "direct", "public"])
    .default("private")
    .describe("Who can see the trace. Defaults to private: members of this namespace only."),
  sourceCreatedAt: timestampSchema.optional().describe("When the source session started."),
});

const messageSchema = z.object({
  externalId: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Stable message ID. Sending the same ID again updates that message, never duplicates it.",
    ),
  role: z.enum(["user", "assistant", "system"]),
  textContent: z.string().min(1),
  order: z.number().int().min(0).max(4_294_967_295).optional().describe("Position in the trace."),
  timestamp: timestampSchema.optional(),
});

export const upsertInputSchema = {
  externalId: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Stable trace ID chosen by the caller, such as skillhub-<runId>. Reuse it to append.",
    ),
  trace: traceSchema
    .optional()
    .describe(
      "Trace fields. Required on the first call for a trace; omit to only append messages.",
    ),
  messages: z.array(messageSchema).max(1000).default([]).describe("Messages to add or update."),
};

export type UpsertInput = {
  externalId: string;
  trace?: z.input<typeof traceSchema>;
  messages?: z.input<typeof messageSchema>[];
};

class UpsertInputError extends Error {}

function toMillis(value: number | string): number {
  return typeof value === "number" ? value : Date.parse(value);
}

function toApiMessage(message: z.input<typeof messageSchema>): TraceMessage {
  return {
    externalId: message.externalId,
    role: message.role,
    textContent: message.textContent,
    ...(message.order !== undefined ? { order: message.order } : {}),
    ...(message.timestamp !== undefined ? { timestamp: toMillis(message.timestamp) } : {}),
  };
}

/** Rate limits, timeouts, server errors, and network failures can succeed on retry. */
function isRetryable(error: unknown): boolean {
  if (error instanceof UpsertInputError || error instanceof z.ZodError) return false;
  if (!(error instanceof TracesApiError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

function errorMessage(error: unknown): string {
  if (error instanceof TracesApiError && error.status === 401) {
    return "Traces rejected this connection's access token. Reconnect Traces and try again.";
  }
  if (error instanceof TracesApiError && error.status === 403) {
    return `${error.message} Reconnect Traces and approve write access if it was not granted.`;
  }
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function payloadResult(payload: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Creates or updates a trace, then appends messages, in this connection's namespace.
 * Both steps are keyed by externalId, so retrying the whole call after any failure is safe.
 */
export async function upsertTrace(
  api: TracesApiClient,
  input: UpsertInput,
): Promise<CallToolResult> {
  let traceId: string | null = null;
  try {
    const parsed = z.object(upsertInputSchema).parse(input);
    if (!parsed.trace && parsed.messages.length === 0) {
      throw new UpsertInputError("Provide trace fields, messages, or both.");
    }
    if (parsed.trace) {
      const { sourceCreatedAt, ...fields } = parsed.trace;
      const trace = await api.upsertTrace(parsed.externalId, {
        ...fields,
        ...(sourceCreatedAt !== undefined ? { sourceCreatedAt: toMillis(sourceCreatedAt) } : {}),
      });
      traceId = trace.id;
    }
    const appended =
      parsed.messages.length > 0
        ? await api.appendMessages(parsed.externalId, parsed.messages.map(toApiMessage))
        : 0;
    return payloadResult({
      traceId,
      externalId: parsed.externalId,
      namespace: api.namespace.slug,
      appended,
    });
  } catch (error) {
    return payloadResult(
      {
        error: {
          message: errorMessage(error),
          retryable: isRetryable(error),
          ...(error instanceof TracesApiError ? { status: error.status } : {}),
        },
        externalId: input.externalId,
        traceId,
      },
      true,
    );
  }
}
