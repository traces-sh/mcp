import type {
  LookupData,
  NamespaceRef,
  ServerContext,
  SurfaceManagementRecord,
  SurfaceRef,
  SurfaceUploadTarget,
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
  currentVersion?: null;
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

  get namespace(): NamespaceRef {
    return this.context.namespace;
  }

  async list(input: Record<string, unknown>): Promise<TraceListData> {
    return this.post<TraceListData>("/v1/tools/list", {
      ...input,
      namespaceIds: [this.context.namespace.id],
    });
  }

  async show(input: Record<string, unknown>): Promise<TraceRead> {
    const data = await this.post<{ reads?: TraceRead[] }>("/v1/tools/show", input);
    const read = data.reads?.[0];
    if (!read) throw new TracesApiError("The trace was not found or is not accessible.", 404);
    return read;
  }

  async lookup(input: Record<string, unknown>): Promise<LookupData> {
    const needsNamespace = input.kind !== "namespace" && input.id === undefined;
    return this.post<LookupData>("/v1/tools/lookup", {
      ...input,
      ...(needsNamespace ? { namespaceId: this.context.namespace.id } : {}),
    });
  }

  async listSurfaces(): Promise<SurfaceManagementRecord[]> {
    const data = await this.surfaceRequest<SurfaceListData>("GET", this.surfacesPath());
    return (data.surfaces ?? []).map(normalizeSurface);
  }

  async resolveSurface(ref: SurfaceRef): Promise<SurfaceManagementRecord> {
    const surfaces = await this.listSurfaces();
    const surface = surfaces.find((candidate) => candidate.key === ref.key);
    if (!surface) {
      throw new TracesApiError(`Surface not found: ${ref.key}`, 404);
    }
    return surface;
  }

  async createSurface(input: {
    key: string;
    name: string;
    description?: string;
    icon?: string;
  }): Promise<SurfaceManagementRecord> {
    await this.surfacePost<{ id: string }>(this.surfacesPath(), {
      key: input.key,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
    });
    return this.resolveSurface({ key: input.key });
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

  async prepareSurfaceUpload(
    ref: SurfaceRef,
    version: string,
    byteSize: number,
    createAs?: { name: string; description?: string; icon?: string },
  ): Promise<{ upload: SurfaceUploadTarget; created: boolean }> {
    const existing = (await this.listSurfaces()).find((s) => s.key === ref.key);
    if (!existing && !createAs) {
      throw new TracesApiError(`Surface not found: ${ref.key}. Pass name to create it.`, 404);
    }
    if (!existing && createAs) {
      await this.createSurface({ key: ref.key, ...createAs });
    }
    const data = await this.surfacePost<{ upload: SurfaceUploadTarget }>(
      `/v1/surfaces/${encodeURIComponent(ref.key)}/versions/uploads`,
      { version, byteSize },
    );
    return { upload: data.upload, created: !existing };
  }

  async completeSurfaceUpload(
    ref: SurfaceRef,
    version: string,
    artifactId: string,
    release: boolean,
  ): Promise<SurfaceManagementRecord> {
    await this.resolveSurface(ref);
    await this.surfacePost(
      `/v1/surfaces/${encodeURIComponent(ref.key)}/versions/uploads/complete`,
      {
        version,
        artifactId,
      },
    );
    if (release) return this.releaseSurfaceVersion(ref, version);
    return this.resolveSurface(ref);
  }

  async setSurfaceArchived(ref: SurfaceRef, archived: boolean): Promise<SurfaceManagementRecord> {
    await this.resolveSurface(ref);
    await this.surfacePatch(`/v1/surfaces/${encodeURIComponent(ref.key)}`, { archived });
    return this.resolveSurface(ref);
  }

  private surfacesPath(): string {
    return `/v1/namespaces/${encodeURIComponent(this.context.namespace.slug)}/surfaces`;
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
