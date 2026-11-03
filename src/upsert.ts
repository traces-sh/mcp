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
    .describe(
      "Who can see the trace. Defaults to private (namespace members only), and is applied every time trace fields are sent.",
    ),
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
  namespace: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Expected namespace slug. When set, nothing is written unless this connection is bound to it.",
    ),
  trace: traceSchema
    .optional()
    .describe(
      "Trace fields. Required on the first call for a trace; omit to only append messages.",
    ),
  messages: z.array(messageSchema).max(1000).default([]).describe("Messages to add or update."),
};

/** Tool input after MCP validation, with defaults applied. */
export type UpsertTraceInput = z.output<z.ZodObject<typeof upsertInputSchema>>;

export type UpsertTraceErrorCode =
  | "invalid_input"
  | "namespace_mismatch"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "unavailable";

export type UpsertTraceResult =
  | {
      ok: true;
      /** Null when only messages were appended; the ID is returned by the call that sends `trace`. */
      traceId: string | null;
      externalId: string;
      namespace: string;
      appended: number;
    }
  | {
      ok: false;
      error: { code: UpsertTraceErrorCode; message: string; retryable: boolean };
      externalId: string;
      /** Set when the trace was written before a later step failed. */
      traceId: string | null;
    };

const RETRYABLE: ReadonlySet<UpsertTraceErrorCode> = new Set(["rate_limited", "unavailable"]);

function toMillis(value: number | string): number {
  return typeof value === "number" ? value : Date.parse(value);
}

function toApiMessage(message: UpsertTraceInput["messages"][number]): TraceMessage {
  return {
    externalId: message.externalId,
    role: message.role,
    textContent: message.textContent,
    ...(message.order !== undefined ? { order: message.order } : {}),
    ...(message.timestamp !== undefined ? { timestamp: toMillis(message.timestamp) } : {}),
  };
}

function errorCode(error: unknown): UpsertTraceErrorCode {
  if (!(error instanceof TracesApiError)) return "unavailable";
  if (error.status === 401) return "unauthorized";
  if (error.status === 403) return "forbidden";
  if (error.status === 404) return "not_found";
  if (error.status === 429) return "rate_limited";
  if (error.status === 408 || error.status >= 500) return "unavailable";
  return "invalid_input";
}

function errorMessage(code: UpsertTraceErrorCode, error: unknown): string {
  const detail = error instanceof Error ? error.message : "An unexpected error occurred.";
  if (code === "unauthorized") {
    return "Traces rejected this connection's access token. Reconnect Traces and try again.";
  }
  if (code === "forbidden") {
    return `${detail} Reconnect Traces and approve write access if it was not granted.`;
  }
  return detail;
}

function failure(
  input: UpsertTraceInput,
  traceId: string | null,
  code: UpsertTraceErrorCode,
  message: string,
): UpsertTraceResult {
  return {
    ok: false,
    error: { code, message, retryable: RETRYABLE.has(code) },
    externalId: input.externalId,
    traceId,
  };
}

/**
 * Creates or updates a trace (when `trace` is set), then appends `messages`, in the
 * connection's namespace. Both steps are keyed by externalId, so retrying the whole
 * call after any failure never duplicates data. Expected failures are returned, not thrown.
 */
export async function upsertTraceWithMessages(
  api: TracesApiClient,
  input: UpsertTraceInput,
): Promise<UpsertTraceResult> {
  if (input.namespace !== undefined && input.namespace !== api.namespace.slug) {
    return failure(
      input,
      null,
      "namespace_mismatch",
      `This connection writes to the ${api.namespace.slug} namespace, not ${input.namespace}. Reconnect Traces and choose ${input.namespace}.`,
    );
  }
  if (!input.trace && input.messages.length === 0) {
    return failure(input, null, "invalid_input", "Provide trace fields, messages, or both.");
  }

  let traceId: string | null = null;
  try {
    if (input.trace) {
      const { sourceCreatedAt, ...fields } = input.trace;
      const trace = await api.upsertTrace(input.externalId, {
        ...fields,
        ...(sourceCreatedAt !== undefined ? { sourceCreatedAt: toMillis(sourceCreatedAt) } : {}),
      });
      traceId = trace.id;
    }
    const appended =
      input.messages.length > 0
        ? await api.appendMessages(input.externalId, input.messages.map(toApiMessage))
        : 0;
    return {
      ok: true,
      traceId,
      externalId: input.externalId,
      namespace: api.namespace.slug,
      appended,
    };
  } catch (error) {
    const code = errorCode(error);
    return failure(input, traceId, code, errorMessage(code, error));
  }
}
