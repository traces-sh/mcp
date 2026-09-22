import { z } from "zod";
import type { TracesApiClient } from "./api-client.js";
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

const surfaceRefSchema = z.union([
  z.strictObject({ surfaceId: z.string().trim().min(1) }),
  z.strictObject({ namespaceSlug: z.string().trim().min(1), key: z.string().trim().min(1) }),
]) satisfies z.ZodType<SurfaceRef>;

const surfacesSearchSchema = z.strictObject({
  namespaceSlug: z.string().trim().min(1),
  query: z.string().trim().optional(),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(50),
});

const surfacesGetSchema = z.strictObject({ surface: surfaceRefSchema });

const surfacesCreateSchema = z.strictObject({
  namespaceSlug: z.string().trim().min(1),
  key: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
});

const surfacesReleaseVersionSchema = z.strictObject({
  surface: surfaceRefSchema,
  version: z.string().trim().min(1),
  visibility: z.enum(["private", "public"]).optional(),
});

const surfacesUpdateSchema = z
  .strictObject({
    surface: surfaceRefSchema,
    newKey: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
  })
  .refine(
    (input) =>
      input.newKey !== undefined ||
      input.name !== undefined ||
      input.description !== undefined ||
      input.icon !== undefined,
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
    "List surfaces managed by a namespace, including private, archived, and unapproved surfaces. Use this to discover a surface and obtain its stable surfaceId before performing mutations.",
    surfacesSearchSchema,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async (api, input) => {
      const parsed = surfacesSearchSchema.parse(input);
      const allSurfaces = await api.listSurfaces(parsed.namespaceSlug);
      const filtered = allSurfaces.filter(
        (surface) =>
          (parsed.includeArchived || surface.archivedAt === null) &&
          (parsed.query === undefined || textMatchesSurface(surface, parsed.query)),
      );
      return {
        namespaceSlug: parsed.namespaceSlug,
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
    "Create a new private surface in a namespace. The new surface has no uploaded versions or current version.",
    surfacesCreateSchema,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async (api, input) => api.createSurface(surfacesCreateSchema.parse(input)),
  ),
  catalogTool(
    "traces_surfaces_release_version",
    "Release an already uploaded surface version as current. The version must be completed through the trusted artifact-upload flow first. This operation does not accept HTML or upload files. Omit visibility to preserve the current visibility; omission never implies public visibility.",
    surfacesReleaseVersionSchema,
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async (api, input) => {
      const parsed = surfacesReleaseVersionSchema.parse(input);
      return api.releaseSurfaceVersion(parsed.surface, parsed.version, parsed.visibility);
    },
  ),
  catalogTool(
    "traces_surfaces_update",
    "Update surface metadata only. This operation cannot change the current version, visibility, or archived state.",
    surfacesUpdateSchema,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async (api, input) => {
      const parsed = surfacesUpdateSchema.parse(input);
      return api.updateSurface(parsed.surface, {
        newKey: parsed.newKey,
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
