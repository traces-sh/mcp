export type ServerContext = {
  apiUrl: string;
  accessToken: string;
  namespaceId?: string;
  transport: "http" | "stdio";
};

export type TraceMetadata = {
  id?: string;
  externalId?: string;
  title?: string;
  agentId?: string;
  model?: string;
  createdAt?: number | string;
  updatedAt?: number | string;
  messageCount?: number;
  createdBy?: string;
  projectName?: string;
  projectPath?: string;
  gitBranch?: string;
  url?: string;
  ai_analysis?: {
    status?: string;
  };
};

export type TraceListData = {
  traces: TraceMetadata[];
  total?: number;
  truncated?: boolean;
};

export type TraceEvent = {
  eventNumber?: number;
  type?: string;
  content?: unknown;
  toolName?: string;
};

export type TraceRead = {
  trace?: Pick<TraceMetadata, "title" | "url" | "agentId">;
  events: TraceEvent[];
  range?: {
    totalEvents?: number;
    returnedEvents?: number;
    offset?: number;
    limit?: number;
  };
  truncated?: boolean;
};
