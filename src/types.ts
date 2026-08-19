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
  sourceCreatedAt?: number | string;
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
  authors?: TraceAuthor[];
  total?: number;
  truncated?: boolean;
};

export type TraceAuthor = {
  id: string;
  displayName?: string;
  slug?: string;
};

export type LookupKind = "user" | "namespace" | "agent_creator";

export type LookupUser = {
  kind: "user";
  id: string;
  displayName?: string;
  slug?: string;
  namespaces: Array<{ id: string; slug: string; role: string }>;
};

export type LookupNamespace = {
  kind: "namespace";
  id: string;
  slug: string;
  displayName: string;
  type: "individual" | "org";
};

export type LookupAgentCreator = {
  kind: "agent_creator";
  id: string;
  name: string;
  slug: string;
  namespace: { id: string; slug: string };
  createdBy?: { id: string; displayName?: string };
};

export type LookupData = {
  kind: LookupKind;
  results: Array<LookupUser | LookupNamespace | LookupAgentCreator>;
  ambiguous: boolean;
  truncated: boolean;
  text?: string;
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
