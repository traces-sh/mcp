import type {
  LookupData,
  TraceAuthor,
  TraceEvent,
  TraceListData,
  TraceMetadata,
  TraceRead,
} from "./types.js";

function cell(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  return String(value).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function timestamp(trace: TraceMetadata): string {
  const value = trace.sourceCreatedAt ?? trace.createdAt;
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

  const referencedAuthorIds = new Set(
    data.traces.map((trace) => trace.createdBy).filter((id): id is string => Boolean(id)),
  );
  const suppliedAuthors = new Map(
    (data.authors ?? [])
      .filter((author) => referencedAuthorIds.has(author.id))
      .map((author) => [author.id, author]),
  );
  const authors: TraceAuthor[] = [];
  for (const trace of data.traces) {
    if (!trace.createdBy) continue;
    const author = suppliedAuthors.get(trace.createdBy);
    if (author && !authors.some((item) => item.id === author.id)) authors.push(author);
  }
  const authorById = new Map(authors.map((author) => [author.id, author]));

  if (authors.length > 0) {
    lines.push("## People", "", "| User | Display name | User ID |", "|---|---|---|");
    for (const author of authors) {
      lines.push(
        `| ${cell(author.slug ? `@${author.slug}` : undefined)} | ${cell(author.displayName)} | ${cell(author.id)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Traces", "");
  lines.push("| Started | User | Project | Agent | Status | Messages | Title | URL |");
  lines.push("|---|---|---|---|---|---:|---|---|");
  for (const trace of data.traces) {
    const author = trace.createdBy ? authorById.get(trace.createdBy) : undefined;
    const user = author?.slug ? `@${author.slug}` : trace.createdBy;
    lines.push(
      `| ${timestamp(trace)} | ${cell(user)} | ${cell(trace.projectName)} | ${cell(trace.agentId)} | ${cell(trace.ai_analysis?.status)} | ${cell(trace.messageCount)} | ${cell(trace.title)} | ${cell(trace.url)} |`,
    );
  }
  return lines.join("\n");
}

export function formatLookup(data: LookupData): string {
  const lines = [
    `Found ${data.results.length} ${data.kind} match(es)${data.truncated ? "; more matches are available" : ""}.`,
    ...(data.ambiguous
      ? ["The result is ambiguous; ask the user to disambiguate before filtering."]
      : []),
    "",
  ];
  if (data.results.length === 0) return `${lines.join("\n")}No entities matched.`;

  if (data.kind === "user") {
    lines.push("| Display name | User | User ID | Visible namespaces |", "|---|---|---|---|");
    for (const result of data.results) {
      if (result.kind !== "user") continue;
      const namespaces = result.namespaces.map((namespace) => `@${namespace.slug}`).join(", ");
      lines.push(
        `| ${cell(result.displayName)} | ${cell(result.slug ? `@${result.slug}` : undefined)} | ${cell(result.id)} | ${cell(namespaces)} |`,
      );
    }
    return lines.join("\n");
  }

  if (data.kind === "namespace") {
    lines.push("| Display name | Namespace | Namespace ID | Type |", "|---|---|---|---|");
    for (const result of data.results) {
      if (result.kind !== "namespace") continue;
      lines.push(
        `| ${cell(result.displayName)} | ${cell(`@${result.slug}`)} | ${cell(result.id)} | ${cell(result.type)} |`,
      );
    }
    return lines.join("\n");
  }

  lines.push("| Name | Agent | Agent ID | Namespace |", "|---|---|---|---|");
  for (const result of data.results) {
    if (result.kind !== "agent_creator") continue;
    lines.push(
      `| ${cell(result.name)} | ${cell(`@${result.slug}`)} | ${cell(result.id)} | ${cell(`@${result.namespace.slug}`)} |`,
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
