import type { TracesApiClient } from "./api-client.js";
import { webUrl } from "./config.js";
import type { TraceMetadata } from "./types.js";

function traceUrl(trace: TraceMetadata): string | undefined {
  if (trace.url) return trace.url;
  const id = trace.externalId ?? trace.id;
  return id === undefined ? undefined : `${webUrl()}/s/${encodeURIComponent(id)}`;
}

export async function latestTraceUrl(api: TracesApiClient): Promise<string | undefined> {
  try {
    const data = await api.list({ limit: 1 });
    const trace = data.traces[0];
    return trace === undefined ? undefined : traceUrl(trace);
  } catch {
    return undefined;
  }
}

/** Renders one uploaded version on a trace for namespace members, whether or not it is current. */
export function versionPreviewUrl(traceUrl: string, surfaceKey: string, version: string): string {
  const url = new URL(traceUrl);
  url.searchParams.set("surface", surfaceKey);
  url.searchParams.set("version", version);
  return url.href;
}

export function buildGuidance(traceUrl: string | undefined): string[] {
  const workflow =
    "Workflow: write the HTML locally, then traces_surfaces_prepare_upload -> upload -> traces_surfaces_complete_upload (release defaults to false). Share the returned previewUrl with the user; it renders that exact version on their latest trace without changing what others see. Call traces_surfaces_release_version only when the user is happy.";
  return traceUrl === undefined
    ? [
        "No trace found in this namespace yet; record one with the Traces CLI so the surface can be tried on real data.",
        workflow,
      ]
    : [
        `Latest trace in this namespace (use it to try each uploaded version): ${traceUrl}`,
        workflow,
      ];
}
