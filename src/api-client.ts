import type { ServerContext, TraceListData, TraceRead } from "./types.js";

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: { message?: string };
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

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.context.apiUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.context.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
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
