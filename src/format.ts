import type { TraceEvent, TraceListData, TraceMetadata, TraceRead } from "./types.js";

function cell(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  return String(value).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function timestamp(trace: TraceMetadata): string {
  const value = trace.updatedAt ?? trace.createdAt;
  const milliseconds = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString().slice(0, 16).replace("T", " ")
    : "-";
}

export function formatTraceList(data: TraceListData): string {
  const lines = [
    `Found ${data.traces.length} trace(s)${typeof data.total === "number" ? ` of ${data.total}` : ""}${data.truncated ? "; more results are available" : ""}.`,
    "",
  ];
  if (data.traces.length === 0) return `${lines.join("\n")}No traces matched.`;

  lines.push("| Time | Creator ID | Project | Agent | Status | Messages | Title | URL |");
  lines.push("|---|---|---|---|---|---:|---|---|");
  for (const trace of data.traces) {
    lines.push(
      `| ${timestamp(trace)} | ${cell(trace.createdBy)} | ${cell(trace.projectName)} | ${cell(trace.agentId)} | ${cell(trace.ai_analysis?.status)} | ${cell(trace.messageCount)} | ${cell(trace.title)} | ${cell(trace.url)} |`,
    );
  }
  return lines.join("\n");
}

function eventContent(event: TraceEvent): string {
  return typeof event.content === "string"
    ? event.content
    : JSON.stringify(event.content ?? null, null, 2);
}

export function formatTraceRead(traceId: string, read: TraceRead): string {
  const lines = [
    `# ${read.trace?.title ?? "Trace"}`,
    "",
    `- ID: ${traceId}`,
    ...(read.trace?.url ? [`- URL: ${read.trace.url}`] : []),
    ...(read.trace?.agentId ? [`- Agent: ${read.trace.agentId}`] : []),
    "",
  ];

  for (const event of read.events) {
    const heading =
      event.type === "user_message"
        ? "User"
        : event.type === "agent_text"
          ? "Agent"
          : event.toolName
            ? `${event.type}: ${event.toolName}`
            : (event.type ?? "Event");
    lines.push(`## ${heading}`, "", eventContent(event), "");
  }

  if (read.truncated) lines.push("More matching events are available. Read another window.");
  return lines.join("\n");
}
