export type ServerContext = {
  apiUrl: string;
  surfaceApiUrl?: string;
  accessToken: string;
  /** Namespace the credential is bound to; every tool operates in it and never leaves it. */
  namespace: NamespaceRef;
  transport: "http" | "stdio";
};

export type NamespaceRef = { id: string; slug: string };

export type SessionData = {
  activeNamespace: NamespaceRef;
};

export type SurfaceRef = { key: string };

/** Single-use, short-lived destination for raw HTML; no bearer token required. */
export type SurfaceUploadTarget = {
  url: string;
  method: string;
  headers: Record<string, string>;
};

export type SurfaceApprovalStatus = "not_requested" | "approved" | "rejected";
export type SurfacePublishStatus = "private" | "public";

export type SurfaceVersionRecord = {
  version: string;
  sdkVersion: "surface-sdk.v1";
  htmlSha256: string;
  htmlByteSize: number;
  createdAt: number;
  sourceUrl: string | null;
  approvalStatus: SurfaceApprovalStatus;
};

export type SurfaceManagementRecord = {
  id: string;
  namespaceId: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  publishStatus: SurfacePublishStatus;
  currentVersion: string | null;
  versions: SurfaceVersionRecord[];
};

export type SurfaceListData = {
  role?: string;
  surfaces: SurfaceManagementRecord[];
};

export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
};

export type ToolCatalogEntry = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
};

export type ToolSearchData = {
  query: string;
  results: ToolCatalogEntry[];
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
