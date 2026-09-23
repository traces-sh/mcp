import type {
  LookupData,
  ServerContext,
  SurfaceManagementRecord,
  SurfaceRef,
  SurfaceListData,
  TraceListData,
  TraceRead,
} from "./types.js";

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: { message?: string };
};

type SurfaceMutation = {
  name?: string;
  description?: string | null;
  icon?: string;
};

export class TracesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TracesApiError";
  }
}

function normalizeSurface(surface: SurfaceManagementRecord): SurfaceManagementRecord {
  return {
    ...surface,
    description: surface.description ?? null,
    icon: surface.icon ?? null,
    archivedAt: surface.archivedAt ?? null,
    currentVersion: surface.currentVersion ?? null,
    versions: (surface.versions ?? []).map((version) => ({
      ...version,
      sourceUrl: version.sourceUrl ?? null,
    })),
  };
}

export class TracesApiClient {
  constructor(
    private readonly context: ServerContext,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async list(input: Record<string, unknown>): Promise<TraceListData> {
    return this.post<TraceListData>("/v1/tools/list", {
      ...input,
      ...(this.context.namespaceId ? { namespaceIds: [this.context.namespaceId] } : {}),
    });
  }

  async show(input: Record<string, unknown>): Promise<TraceRead> {
    const data = await this.post<{ reads?: TraceRead[] }>("/v1/tools/show", input);
    const read = data.reads?.[0];
    if (!read) throw new TracesApiError("The trace was not found or is not accessible.", 404);
    return read;
  }

  async lookup(input: Record<string, unknown>): Promise<LookupData> {
    return this.post<LookupData>("/v1/tools/lookup", input);
  }

  async listSurfaces(namespaceSlug: string): Promise<SurfaceManagementRecord[]> {
    const data = await this.surfaceRequest<SurfaceListData>(
      "GET",
      `/v1/namespaces/${encodeURIComponent(namespaceSlug)}/surfaces`,
    );
    return (data.surfaces ?? []).map(normalizeSurface);
  }

  async resolveSurface(ref: SurfaceRef): Promise<SurfaceManagementRecord> {
    const surfaces = await this.listSurfaces(ref.namespaceSlug);
    const surface = surfaces.find((candidate) => candidate.key === ref.key);
    if (!surface) {
      throw new TracesApiError(`Surface not found: ${ref.key}`, 404);
    }
    return surface;
  }

  async createSurface(input: {
    namespaceSlug: string;
    key: string;
    name: string;
    description?: string;
    icon?: string;
  }): Promise<SurfaceManagementRecord> {
    await this.surfacePost<{ id: string }>(
      `/v1/namespaces/${encodeURIComponent(input.namespaceSlug)}/surfaces`,
      {
        key: input.key,
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
      },
    );
    return this.resolveSurface({ namespaceSlug: input.namespaceSlug, key: input.key });
  }

  async updateSurface(
    ref: SurfaceRef,
    mutation: SurfaceMutation,
  ): Promise<SurfaceManagementRecord> {
    await this.resolveSurface(ref);
    await this.surfacePatch(`/v1/surfaces/${encodeURIComponent(ref.key)}`, mutation);
    return this.resolveSurface(ref);
  }

  async releaseSurfaceVersion(
    ref: SurfaceRef,
    version: string,
    visibility?: "private" | "public",
  ): Promise<SurfaceManagementRecord> {
    await this.resolveSurface(ref);
    await this.surfacePatch(`/v1/surfaces/${encodeURIComponent(ref.key)}`, {
      currentVersion: version,
      ...(visibility !== undefined ? { publishStatus: visibility } : {}),
    });
    return this.resolveSurface(ref);
  }

  async setSurfaceArchived(ref: SurfaceRef, archived: boolean): Promise<SurfaceManagementRecord> {
    await this.resolveSurface(ref);
    await this.surfacePatch(`/v1/surfaces/${encodeURIComponent(ref.key)}`, { archived });
    return this.resolveSurface(ref);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async surfacePost<T>(path: string, body: unknown): Promise<T> {
    return this.surfaceRequest<T>("POST", path, body);
  }

  private async surfacePatch<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
    return this.surfaceRequest<T>("PATCH", path, body);
  }

  private async surfaceRequest<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.request<T>(method, path, body, this.context.surfaceApiUrl ?? this.context.apiUrl);
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
    baseUrl = this.context.apiUrl,
  ): Promise<T> {
    const response = await this.fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.context.accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });

    const envelope = (await response.json().catch(() => undefined)) as ApiEnvelope<T> | undefined;
    if (!response.ok || envelope?.ok === false) {
      const message = envelope?.error?.message ?? `Traces API request failed (${response.status})`;
      throw new TracesApiError(message, response.status);
    }
    if (!envelope?.data) throw new TracesApiError("Traces API returned an invalid response.", 502);
    return envelope.data;
  }
}
