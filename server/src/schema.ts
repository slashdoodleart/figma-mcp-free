import { z } from "zod";

/** Figma node IDs use colon-separated format, e.g. "4029:12345". */
export const figmaNodeId = z
  .string()
  .regex(/^\d+:\d+$/, "Node ID must use colon format, e.g. '4029:12345'");
const exportFormat = z.enum(["PNG", "SVG", "JPG", "PDF"]);

export const toolInputSchemas = {
  get_node: z.object({
    nodeId: figmaNodeId.describe("The node ID to fetch"),
  }),

  get_metadata: z.object({
    depth: z
      .number()
      .optional()
      .describe("How many levels deep to traverse the node tree (default 3). Use lower values for very large pages."),
  }),

  get_design_context: z.object({
    nodeIds: z
      .array(figmaNodeId)
      .optional()
      .describe(
        "Optional list of node IDs to get design context for (colon format, e.g. '4029:12345'). If omitted, uses the current selection.",
      ),
    depth: z
      .number()
      .optional()
      .describe("How many levels deep to traverse the node tree (default 2)"),
    includeInvisible: z
      .boolean()
      .optional()
      .describe("Include invisible (hidden) nodes in the output (default false)"),
  }),

  get_nodes: z.object({
    nodeIds: z
      .array(figmaNodeId)
      .min(1)
      .describe(
        "List of node IDs to fetch (colon format, e.g. '4029:12345'). Returns full serialized data for each node.",
      ),
  }),

  get_screenshot: z.object({
    nodeIds: z
      .array(figmaNodeId)
      .optional()
      .describe(
        "Optional list of node IDs to export (colon-separated format, e.g. '4029:12345' — never use hyphens). If empty, exports the current selection",
      ),
    format: exportFormat
      .optional()
      .describe("Export format: PNG (default, supports transparency) or SVG or JPG (no transparency) or PDF"),
    scale: z
      .number()
      .optional()
      .describe("Export scale for raster formats (default 2). Higher values give sharper images."),
  }),

  save_screenshots: z.object({
    items: z
      .array(
        z.object({
          nodeId: figmaNodeId.describe("The node ID to export"),
          outputPath: z
            .string()
            .min(1)
            .describe(
              "Output file path (relative paths resolve from the MCP server current working directory)",
            ),
          format: exportFormat
            .optional()
            .describe("Per-item export format override: PNG, SVG, JPG, or PDF"),
          scale: z
            .number()
            .optional()
            .describe("Per-item export scale override for raster formats"),
        }),
      )
      .min(1)
      .describe("List of screenshot save operations to execute in batch"),
    format: exportFormat
      .optional()
      .describe("Default export format: PNG (default) or SVG or JPG or PDF"),
    scale: z
      .number()
      .optional()
      .describe("Default export scale for raster formats (default 2)"),
  }),
} as const;

type ToolName = keyof typeof toolInputSchemas;

/**
 * Maps the RPC wire format { tool, nodeIds?, params? } to each tool's
 * expected input shape. Typed as Record<ToolName, ...> so adding a schema
 * without a mapper is a compile error.
 */
const rpcToArgs: Record<
  ToolName,
  (nodeIds?: string[], params?: Record<string, unknown>) => unknown
> = {
  get_node: (nodeIds) => ({ nodeId: nodeIds?.[0] }),
  get_metadata: (_nodeIds, params) => ({ ...params }),
  get_design_context: (nodeIds, params) => ({ nodeIds, ...params }),
  get_nodes: (nodeIds) => ({ nodeIds }),
  get_screenshot: (nodeIds, params) => ({ nodeIds, ...params }),
  save_screenshots: (_nodeIds, params) => ({ ...params }),
};

/**
 * Validate an RPC request against the corresponding tool's input schema.
 * Returns an error string on failure, null if valid or no schema exists for the tool.
 */
export function validateRpc(
  tool: string,
  nodeIds?: string[],
  params?: Record<string, unknown>,
): string | null {
  if (!(tool in toolInputSchemas)) return null;

  const name = tool as ToolName;
  const result = toolInputSchemas[name].safeParse(
    rpcToArgs[name](nodeIds, params),
  );
  return result.success ? null : result.error.issues[0].message;
}
