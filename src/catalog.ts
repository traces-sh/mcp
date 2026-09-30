import { z } from "zod";
import type { TracesApiClient } from "./api-client.js";
import { latestTraceUrl, versionPreviewUrl } from "./surface-links.js";
import type {
  SurfaceManagementRecord,
  SurfaceRef,
  ToolAnnotations,
  ToolCatalogEntry,
  ToolSearchData,
} from "./types.js";

export class CatalogInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogInputError";
  }
}

type CatalogTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  annotations: ToolAnnotations;
  execute: (api: TracesApiClient, input: unknown) => Promise<unknown>;
};

// Mirrors the Traces API's surface validation (packages/shared/src/surface.ts in traces) so agents
// get a precise error before a round trip. The API stays authoritative, including reserved keys.
const SURFACE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_SURFACE_KEY_LENGTH = 3;
const MAX_SURFACE_KEY_LENGTH = 48;
const MAX_SURFACE_NAME_LENGTH = 80;
const MAX_SURFACE_DESCRIPTION_LENGTH = 500;
const MAX_SURFACE_ICON_LENGTH = 64;
const MAX_SURFACE_HTML_BYTES = 16 * 1024 * 1024;
const SURFACE_KEY_RULE = `${MIN_SURFACE_KEY_LENGTH}-${MAX_SURFACE_KEY_LENGTH} lowercase letters and digits, words joined by single hyphens`;

const newSurfaceKeySchema = z
  .string()
  .trim()
  .min(MIN_SURFACE_KEY_LENGTH, `Surface key must be ${SURFACE_KEY_RULE}.`)
  .max(MAX_SURFACE_KEY_LENGTH, `Surface key must be ${SURFACE_KEY_RULE}.`)
  .regex(SURFACE_KEY_PATTERN, `Surface key must be ${SURFACE_KEY_RULE}.`)
  .describe(
    `Permanent, globally unique key for a new surface; it appears in trace links as ?surface=<key> and can never be changed. ${SURFACE_KEY_RULE} (e.g. "tool-failures"). Keys starting with "traces-" or "official-", and a few official-sounding names, are reserved for the Traces team; the API rejects them.`,
  );

const surfaceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SURFACE_NAME_LENGTH)
  .describe(
    `Display name shown on the trace tab and in the marketplace. 1-${MAX_SURFACE_NAME_LENGTH} characters.`,
  );

const surfaceDescriptionSchema = z
  .string()
  .max(MAX_SURFACE_DESCRIPTION_LENGTH)
  .describe(
    `One or two sentences on what the surface shows, used in the marketplace. At most ${MAX_SURFACE_DESCRIPTION_LENGTH} characters.`,
  );

const surfaceIconSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SURFACE_ICON_LENGTH)
  .describe(
    `Lucide icon name in kebab-case (e.g. "activity", "workflow", "zap"). Names outside the Traces icon picker fall back to the default icon. At most ${MAX_SURFACE_ICON_LENGTH} characters.`,
  );

const surfaceVersionSchema = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+$/, "Version must be a semantic version without prerelease, e.g. 1.0.0.")
  .describe("Semantic version without prerelease, e.g. 1.0.0.");

const surfaceRefSchema = z
  .strictObject({
    key: z
      .string()
      .trim()
      .min(1)
      .describe("Key of a surface in this namespace, as listed by traces_surfaces_search."),
  })
  .describe("The surface to act on.") satisfies z.ZodType<SurfaceRef>;

const surfacesSearchSchema = z.strictObject({
  query: z
    .string()
    .trim()
    .optional()
    .describe("Words that must all appear in the key, name, or description. Omit to list all."),
  includeArchived: z.boolean().default(false).describe("Include archived surfaces."),
  limit: z.number().int().min(1).max(200).default(50).describe("Maximum surfaces to return."),
});

const surfacesGetSchema = z.strictObject({ surface: surfaceRefSchema });

const surfacesCreateSchema = z.strictObject({
  key: newSurfaceKeySchema,
  name: surfaceNameSchema,
  description: surfaceDescriptionSchema.optional(),
  icon: surfaceIconSchema.optional(),
});

const surfacesPrepareUploadSchema = z.strictObject({
  surface: surfaceRefSchema.describe(
    `The surface to upload to. If the key does not exist yet, pass name to create it; a new key must be ${SURFACE_KEY_RULE}.`,
  ),
  name: surfaceNameSchema
    .optional()
    .describe(
      `Display name, 1-${MAX_SURFACE_NAME_LENGTH} characters. Required only when the surface key does not exist yet; creates it. Ignored for an existing surface.`,
    ),
  description: surfaceDescriptionSchema
    .optional()
    .describe(
      `Marketplace description, at most ${MAX_SURFACE_DESCRIPTION_LENGTH} characters. Used only when creating the surface.`,
    ),
  icon: surfaceIconSchema
    .optional()
    .describe("Lucide icon name in kebab-case. Used only when creating the surface."),
  version: surfaceVersionSchema.describe(
    "New semantic version, e.g. 1.0.0. Must not already exist on the surface.",
  ),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(MAX_SURFACE_HTML_BYTES, "Surface HTML must be at most 16 MiB.")
    .describe(
      "Exact byte size of the HTML file (wc -c), at most 16 MiB. The upload is rejected if it differs.",
    ),
});

const surfacesCompleteUploadSchema = z.strictObject({
  surface: surfaceRefSchema,
  version: surfaceVersionSchema.describe("The version passed to traces_surfaces_prepare_upload."),
  artifactId: z.string().trim().min(1).describe("data.artifactId from the upload response."),
  release: z
    .boolean()
    .default(false)
    .describe(
      "Make this version current immediately. Default false: the version is uploaded but users keep seeing the current one until traces_surfaces_release_version.",
    ),
});

const surfacesReleaseVersionSchema = z.strictObject({
  surface: surfaceRefSchema,
  version: surfaceVersionSchema.describe(
    "An uploaded version to make current. It must have been completed with traces_surfaces_complete_upload.",
  ),
  visibility: z
    .enum(["private", "public"])
    .optional()
    .describe(
      "private: only namespace members see the surface. public: listed in the marketplace and usable on any trace. Changing it requires a namespace admin. Omit to keep the current visibility.",
    ),
});

const surfacesUpdateSchema = z
  .strictObject({
    surface: surfaceRefSchema,
    name: surfaceNameSchema.optional(),
    description: surfaceDescriptionSchema
      .nullable()
      .optional()
      .describe(
        `New marketplace description, at most ${MAX_SURFACE_DESCRIPTION_LENGTH} characters. null removes it; omit to keep it.`,
      ),
    icon: surfaceIconSchema.optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined || input.description !== undefined || input.icon !== undefined,
    { message: "At least one metadata field is required." },
  );

const surfacesArchiveSchema = z.strictObject({ surface: surfaceRefSchema });
const surfacesRestoreSchema = z.strictObject({ surface: surfaceRefSchema });

function textMatchesSurface(surface: SurfaceManagementRecord, query: string): boolean {
  const haystack = [surface.key, surface.name, surface.description ?? ""].join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return JSON.parse(JSON.stringify(z.toJSONSchema(schema)));
}

function catalogTool(
  name: string,
  description: string,
  inputSchema: z.ZodType,
  annotations: ToolAnnotations,
  execute: CatalogTool["execute"],
): CatalogTool {
  return { name, description, inputSchema, annotations, execute };
}

const catalogTools: CatalogTool[] = [
  catalogTool(
    "traces_surfaces_search",
    "List surfaces in this connection's namespace, including private, archived, and unapproved surfaces. Use this to discover a surface key before performing mutations.",
    surfacesSearchSchema,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async (api, input) => {
      const parsed = surfacesSearchSchema.parse(input);
      const allSurfaces = await api.listSurfaces();
      const filtered = allSurfaces.filter(
        (surface) =>
          (parsed.includeArchived || surface.archivedAt === null) &&
          (parsed.query === undefined || textMatchesSurface(surface, parsed.query)),
      );
      return {
        namespaceSlug: api.namespace.slug,
        surfaces: filtered.slice(0, parsed.limit),
        truncated: filtered.length > parsed.limit,
      };
    },
  ),
  catalogTool(
    "traces_surfaces_get",
    "Get the complete management record for an existing surface, including metadata, current version, and immutable version history.",
    surfacesGetSchema,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async (api, input) => api.resolveSurface(surfacesGetSchema.parse(input).surface),
  ),
  catalogTool(
    "traces_surfaces_create",
    "Create a new private surface in this connection's namespace. The new surface has no uploaded versions or current version. The key is permanent and global: lowercase words joined by single hyphens, 3-48 characters, and not reserved for the Traces team. Prefer traces_surfaces_prepare_upload with name, which creates the surface and prepares its first upload in one step.",
    surfacesCreateSchema,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async (api, input) => api.createSurface(surfacesCreateSchema.parse(input)),
  ),
  catalogTool(
    "traces_surfaces_prepare_upload",
    "Step 1 of 2 to publish surface HTML: reserve a version and get a single-use upload destination, creating the surface first if the key is new (pass name). Send the raw HTML file body to the returned url with the returned method and headers (for example: curl -fsS -X POST -H 'Content-Type: text/html' --data-binary @surface.html <url>); the response contains data.artifactId. Then call traces_surfaces_complete_upload. The destination expires quickly and needs no bearer token. Never pass HTML through this tool. Uploading does not change what users see: complete_upload leaves the current version untouched and returns a previewUrl for trying the new one.",
    surfacesPrepareUploadSchema,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async (api, input) => {
      const parsed = surfacesPrepareUploadSchema.parse(input);
      const createAs =
        parsed.name !== undefined
          ? { name: parsed.name, description: parsed.description, icon: parsed.icon }
          : undefined;
      const { upload, created } = await api.prepareSurfaceUpload(
        parsed.surface,
        parsed.version,
        parsed.byteSize,
        createAs,
      );
      return {
        surface: { key: parsed.surface.key },
        created,
        version: parsed.version,
        upload,
        nextStep: `Upload the file, then call traces_surfaces_complete_upload with version "${parsed.version}" and the returned artifactId.`,
      };
    },
  ),
  catalogTool(
    "traces_surfaces_complete_upload",
    "Step 2 of 2 to publish surface HTML: finalize an uploaded artifact as an immutable surface version. The result includes a previewUrl that renders this exact version on the user's latest trace (namespace members only) so they can try it before it goes live; always share it with the user. Make it current with release: true here or, after the user has tried it, via traces_surfaces_release_version, which also controls visibility.",
    surfacesCompleteUploadSchema,
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async (api, input) => {
      const parsed = surfacesCompleteUploadSchema.parse(input);
      const [surface, traceUrl] = await Promise.all([
        api.completeSurfaceUpload(
          parsed.surface,
          parsed.version,
          parsed.artifactId,
          parsed.release,
        ),
        latestTraceUrl(api),
      ]);
      return {
        surface,
        version: parsed.version,
        released: parsed.release,
        previewUrl:
          traceUrl === undefined
            ? undefined
            : versionPreviewUrl(traceUrl, parsed.surface.key, parsed.version),
        nextStep: parsed.release
          ? "This version is now current."
          : `Ask the user to try previewUrl; when happy, call traces_surfaces_release_version with version "${parsed.version}" to make it current.`,
      };
    },
  ),
  catalogTool(
    "traces_surfaces_release_version",
    "Release an already uploaded surface version as current, or change visibility. The version must be completed through traces_surfaces_complete_upload first. This operation does not accept HTML or upload files. Omit visibility to preserve the current visibility; omission never implies public visibility.",
    surfacesReleaseVersionSchema,
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async (api, input) => {
      const parsed = surfacesReleaseVersionSchema.parse(input);
      return api.releaseSurfaceVersion(parsed.surface, parsed.version, parsed.visibility);
    },
  ),
  catalogTool(
    "traces_surfaces_update",
    "Update surface metadata only: name (up to 80 characters), description (up to 500), and icon. Surface keys are immutable. This operation cannot change the current version, visibility, or archived state.",
    surfacesUpdateSchema,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async (api, input) => {
      const parsed = surfacesUpdateSchema.parse(input);
      return api.updateSurface(parsed.surface, {
        name: parsed.name,
        description: parsed.description,
        icon: parsed.icon,
      });
    },
  ),
  catalogTool(
    "traces_surfaces_archive",
    "Archive an existing surface. Archived surfaces remain in version history but are excluded from normal discovery and public availability.",
    surfacesArchiveSchema,
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async (api, input) => api.setSurfaceArchived(surfacesArchiveSchema.parse(input).surface, true),
  ),
  catalogTool(
    "traces_surfaces_restore",
    "Restore an archived surface without changing its current version or visibility.",
    surfacesRestoreSchema,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async (api, input) => api.setSurfaceArchived(surfacesRestoreSchema.parse(input).surface, false),
  ),
];

export const toolSearchInputSchema = {
  query: z.string().trim().min(1).describe("Natural-language operation or resource to find."),
  limit: z.number().int().min(1).max(20).default(8),
};

export const toolExecuteInputSchema = {
  name: z.string().trim().min(1).describe("Exact catalog operation name."),
  arguments: z.record(z.string(), z.unknown()).default({}),
};

export function searchCatalog(input: unknown): ToolSearchData {
  const parsed = z.object(toolSearchInputSchema).parse(input);
  const terms = parsed.query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = catalogTools
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const description = tool.description.toLowerCase();
      const score = terms.reduce(
        (total, term) =>
          total + (name.includes(term) ? 3 : 0) + (description.includes(term) ? 1 : 0),
        0,
      );
      return { tool, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name),
    )
    .slice(0, parsed.limit)
    .map(
      ({ tool }): ToolCatalogEntry => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toJsonSchema(tool.inputSchema),
        annotations: tool.annotations,
      }),
    );

  return { query: parsed.query, results };
}

export async function executeCatalog(
  api: TracesApiClient,
  input: unknown,
): Promise<{ name: string; output: unknown }> {
  const parsed = z.object(toolExecuteInputSchema).parse(input);
  const tool = catalogTools.find((candidate) => candidate.name === parsed.name);
  if (!tool) throw new CatalogInputError(`Unknown Traces catalog tool: ${parsed.name}`);

  const validated = tool.inputSchema.safeParse(parsed.arguments);
  if (!validated.success) {
    const details = validated.error.issues
      .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
      .join("; ");
    throw new CatalogInputError(details);
  }

  return { name: tool.name, output: await tool.execute(api, validated.data) };
}
