import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Node } from "./node.js";
import { toolInputSchemas } from "./schema.js";
import type { BridgeResponse } from "./types.js";

type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
};

export type ExportFormat = "PNG" | "SVG" | "JPG" | "PDF";

export interface ScreenshotSender {
  sendWithParams(
    requestType: string,
    nodeIds?: string[],
    params?: Record<string, unknown>
  ): Promise<BridgeResponse>;
}

interface ScreenshotExport {
  nodeId: string;
  nodeName: string;
  format: ExportFormat;
  base64: string;
  width: number;
  height: number;
}

interface SaveScreenshotItemInput {
  nodeId: string;
  outputPath: string;
  format?: ExportFormat;
  scale?: number;
}

interface SaveScreenshotItemResult {
  index: number;
  nodeId: string;
  nodeName?: string;
  outputPath: string;
  format?: ExportFormat;
  width?: number;
  height?: number;
  bytesWritten?: number;
  success: boolean;
  error?: string;
}

export function registerTools(server: McpServer, node: Node): void {
  server.tool(
    "get_document",
    "Get the current Figma page document tree with full serialized properties. Returns all nodes on the current page. For large pages, use get_metadata first to understand the structure, then get_design_context on specific nodes.",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_document"));
    }
  );

  server.tool(
    "get_selection",
    "Get the currently selected nodes in Figma with full serialized properties. Returns detailed layout, typography, and visual data for each selected node.",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_selection"));
    }
  );

  server.tool(
    "get_node",
    "Get a specific Figma node by ID with full serialized properties including layout, typography, visual styles, and component data. Must use colon format, e.g. '4029:12345', never use hyphens.",
    toolInputSchemas.get_node.shape,
    async ({ nodeId }): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_node", [nodeId]));
    }
  );

  server.tool(
    "get_styles",
    "Get all local styles in the document including paint styles, text styles (with font family, weight, line height, letter spacing, text case, decoration), effect styles, and grid styles",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_styles"));
    }
  );

  server.tool(
    "get_metadata",
    "Get a structural overview of the current selection or page. Returns a lightweight tree of nodes with IDs, names, types, positions, and sizes. Use this tool first with large designs to understand the structure before calling get_design_context on specific nodes. Works with multiple selections or the whole page if nothing is selected.",
    toolInputSchemas.get_metadata.shape,
    async ({ depth }): Promise<ToolResult> => {
      const params: Record<string, unknown> = {};
      if (depth !== undefined && depth > 0) {
        params.depth = depth;
      }
      return renderResponse(() =>
        node.sendWithParams("get_metadata", undefined, params)
      );
    }
  );

  server.tool(
    "get_design_context",
    "Get the design context for specific nodes by ID, or the current selection. Returns a structured representation with full layout (auto-layout/flex, sizing, padding, gap), typography (font family, weight, style, line height, letter spacing, text segments for mixed styles), visual styles (fills with variable bindings, strokes, effects, opacity, border radius), rotation, constraints, and component data. This is the primary tool for implementing Figma designs as code. Pass nodeIds to target specific nodes without needing to select them in Figma.",
    toolInputSchemas.get_design_context.shape,
    async ({ nodeIds, depth, includeInvisible }): Promise<ToolResult> => {
      const params: Record<string, unknown> = {};
      if (depth !== undefined && depth > 0) {
        params.depth = depth;
      }
      if (includeInvisible) {
        params.includeInvisible = true;
      }
      return renderResponse(() =>
        node.sendWithParams("get_design_context", nodeIds, params)
      );
    }
  );

  server.tool(
    "get_nodes",
    "Get multiple Figma nodes by their IDs in a single call. Returns the full serialized data for each node including layout, typography (with per-segment breakdown for mixed styles), visual styles, rotation, constraints, and component data. Use colon-separated IDs, e.g. '4029:12345'.",
    toolInputSchemas.get_nodes.shape,
    async ({ nodeIds }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("get_nodes", nodeIds)
      );
    }
  );

  server.tool(
    "get_variable_defs",
    "Get all local variable definitions including variable collections, modes, and variable values. Variables are Figma's system for design tokens (colors, numbers, strings, booleans). Use this to extract color tokens, spacing values, and typography tokens used in the design.",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_variable_defs"));
    }
  );

  server.tool(
    "create_design_system_rules",
    "Generate a design system rules file for your project. This creates instructions for AI coding agents to follow when implementing Figma designs, ensuring consistent component usage, design token mapping, and proper Figma-to-code workflow. Save the output to .github/copilot-instructions.md (VS Code) or .cursor/rules/figma-design-system.mdc (Cursor).",
    {
      clientLanguages: z
        .string()
        .optional()
        .describe("Comma-separated list of languages (e.g. 'typescript,javascript')"),
      clientFrameworks: z
        .string()
        .optional()
        .describe("Framework being used (e.g. 'react', 'vue', 'svelte', 'angular')"),
    },
    async ({ clientLanguages, clientFrameworks }): Promise<ToolResult> => {
      const languages = clientLanguages || "typescript";
      const framework = clientFrameworks || "react";

      const rules = `# Figma MCP Integration Rules

These rules define how to translate Figma inputs into code for this project and
must be followed for every Figma-driven change.

## Tech Stack
- Languages: ${languages}
- Framework: ${framework}

## Required Flow (do not skip)

1. Run \`get_design_context\` first to fetch the structured representation for the exact node(s).
2. If the response is too large or truncated, run \`get_metadata\` to get the high-level node map, then re-fetch only the required node(s) with \`get_design_context\`.
3. Run \`get_screenshot\` for a visual reference of the node variant being implemented.
4. Run \`get_variable_defs\` to retrieve design tokens (colors, spacing, typography).
5. Only after you have design context, screenshot, and tokens, start implementation.
6. Translate the output into this project's conventions, styles, and framework. Reuse the project's color tokens, components, and typography wherever possible.
7. Validate against Figma for 1:1 look and behavior before marking complete.

## Implementation Rules

- Treat the Figma MCP output as a representation of design and behavior, not as final code style.
- Reuse existing components (buttons, inputs, typography, icon wrappers) instead of duplicating functionality.
- Use the project's color system, typography scale, and spacing tokens consistently.
- Respect existing routing, state management, and data-fetch patterns already adopted in the repo.
- Strive for 1:1 visual parity with the Figma design. When conflicts arise, prefer design-system tokens and adjust spacing or sizes minimally to match visuals.
- Validate the final UI against the Figma screenshot for both look and behavior.

## Asset Handling

- IMPORTANT: If the Figma MCP server returns a localhost source for an image or SVG, use that source directly.
- IMPORTANT: DO NOT import/add new icon packages — all assets should be in the Figma payload.
- IMPORTANT: DO NOT use or create placeholders if a localhost source is provided.

## Component Organization

- Place UI components in the project's designated component directory.
- Follow the project's component naming conventions.
- Avoid inline styles unless truly necessary for dynamic values.

## Design Token Usage

- IMPORTANT: Never hardcode colors — always use design tokens from the variable definitions.
- Map Figma variables to the project's token system.
- Spacing values should use the project's spacing scale.
- Typography should follow the project's type scale.

## Figma Node ID Format

- Always use colon-separated format for node IDs: \`4029:12345\`
- Never use hyphens in node IDs when calling tools
- When extracting from Figma URLs, convert \`node-id=1-2\` to \`1:2\`
`;

      return {
        content: [{ type: "text", text: rules }],
      };
    }
  );

  server.tool(
    "get_screenshot",
    "Export a screenshot of the selected nodes or specific nodes by ID. Returns base64-encoded image data with dimensions. Use this alongside get_design_context for visual reference when implementing designs. PNG format preserves transparency (no white background). Use JPG only when transparency is not needed. SVG gives vector output with ID attributes.",
    toolInputSchemas.get_screenshot.shape,
    async ({ nodeIds, format, scale }): Promise<ToolResult> => {
      const params: Record<string, unknown> = {};
      if (format) params.format = format;
      if (scale !== undefined && scale > 0) params.scale = scale;
      try {
        const resp = await node.sendWithParams("get_screenshot", nodeIds, params);
        if (resp.error) {
          return {
            content: [{ type: "text", text: resp.error }],
            isError: true,
          };
        }
        const data = resp.data as {
          exports: ScreenshotExport[];
        };
        const content: ToolResult["content"] = [];
        const effectiveFormat = format ?? "PNG";
        const mimeMap: Record<string, string> = {
          PNG: "image/png",
          JPG: "image/jpeg",
          SVG: "image/svg+xml",
          PDF: "application/pdf",
        };
        const mimeType = mimeMap[effectiveFormat] ?? "image/png";

        for (const exp of data.exports) {
          // Add metadata as text
          content.push({
            type: "text",
            text: `Node: ${exp.nodeName} (${exp.nodeId}) — ${exp.width}×${exp.height} ${effectiveFormat}`,
          });

          if (effectiveFormat === "SVG") {
            // SVG is text-based, return as text
            const svgText = Buffer.from(exp.base64, "base64").toString("utf-8");
            content.push({ type: "text", text: svgText });
          } else if (effectiveFormat === "PDF") {
            // PDF can't be displayed inline, return base64 as text
            content.push({
              type: "text",
              text: `[PDF base64 data: ${exp.base64.length} chars]`,
            });
          } else {
            // PNG/JPG — return as proper MCP image content
            content.push({
              type: "image",
              data: exp.base64,
              mimeType,
            });
          }
        }

        return { content };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "save_screenshots",
    "Export screenshots for multiple nodes and save them directly to the local filesystem. Returns metadata only (no base64).",
    toolInputSchemas.save_screenshots.shape,
    async ({ items, format, scale }): Promise<ToolResult> => {
      try {
        const result = await executeSaveScreenshots(node, items, format, scale);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    }
  );
}

export async function executeSaveScreenshots(
  sender: ScreenshotSender,
  items: SaveScreenshotItemInput[],
  format?: ExportFormat,
  scale?: number
): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  hasErrors: boolean;
  results: SaveScreenshotItemResult[];
}> {
  const results: SaveScreenshotItemResult[] = [];

  for (const [index, item] of items.entries()) {
    const result = await saveScreenshotItemToFile(
      sender,
      item,
      index,
      process.cwd(),
      format,
      scale
    );
    results.push(result);
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  return {
    total: results.length,
    succeeded,
    failed,
    hasErrors: failed > 0,
    results,
  };
}

async function renderResponse(
  fn: () => Promise<BridgeResponse>
): Promise<ToolResult> {
  try {
    const resp = await fn();
    if (resp.error) {
      return {
        content: [{ type: "text", text: resp.error }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(resp.data) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: err instanceof Error ? err.message : String(err),
        },
      ],
      isError: true,
    };
  }
}

function resolveAndValidateOutputPath(
  outputPath: string,
  workspaceRoot: string
): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(resolvedRoot, outputPath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  const escapesRoot =
    relativePath.startsWith("..") || path.isAbsolute(relativePath);
  if (escapesRoot) {
    throw new Error(
      `outputPath must be inside the MCP server working directory: ${resolvedRoot}`
    );
  }
  return resolvedPath;
}

function inferFormatFromPath(outputPath: string): ExportFormat | null {
  const ext = path.extname(outputPath).toLowerCase();
  switch (ext) {
    case ".png":
      return "PNG";
    case ".svg":
      return "SVG";
    case ".jpg":
    case ".jpeg":
      return "JPG";
    case ".pdf":
      return "PDF";
    default:
      return null;
  }
}

function resolveExportFormat(
  format: ExportFormat | undefined,
  inferredFormat: ExportFormat | null
): ExportFormat {
  if (format && inferredFormat && format !== inferredFormat) {
    throw new Error(
      `format ${format} conflicts with outputPath extension (${inferredFormat})`
    );
  }
  return format ?? inferredFormat ?? "PNG";
}

function getSingleScreenshotExport(data: unknown): ScreenshotExport {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid screenshot response from plugin");
  }

  const exports = (data as { exports?: unknown }).exports;
  if (!Array.isArray(exports) || exports.length === 0) {
    throw new Error("No screenshot export returned by plugin");
  }

  const first = exports[0];
  if (
    !first ||
    typeof first !== "object" ||
    typeof (first as { nodeId?: unknown }).nodeId !== "string" ||
    typeof (first as { nodeName?: unknown }).nodeName !== "string" ||
    typeof (first as { base64?: unknown }).base64 !== "string" ||
    typeof (first as { width?: unknown }).width !== "number" ||
    typeof (first as { height?: unknown }).height !== "number"
  ) {
    throw new Error("Malformed screenshot export payload");
  }

  const screenshot = first as ScreenshotExport;
  return screenshot;
}

async function saveScreenshotItemToFile(
  sender: ScreenshotSender,
  item: SaveScreenshotItemInput,
  index: number,
  workspaceRoot: string,
  defaultFormat?: ExportFormat,
  defaultScale?: number
): Promise<SaveScreenshotItemResult> {
  let resolvedOutputPath = item.outputPath;

  try {
    resolvedOutputPath = resolveAndValidateOutputPath(
      item.outputPath,
      workspaceRoot
    );
    const inferredFormat = inferFormatFromPath(resolvedOutputPath);
    const resolvedFormat = resolveExportFormat(
      item.format ?? defaultFormat,
      inferredFormat
    );
    const resolvedScale = resolveScale(item.scale, defaultScale);

    const params: Record<string, unknown> = { format: resolvedFormat };
    if (resolvedScale !== undefined) {
      params.scale = resolvedScale;
    }

    const resp = await sender.sendWithParams(
      "get_screenshot",
      [item.nodeId],
      params
    );
    if (resp.error) {
      throw new Error(resp.error);
    }

    const screenshotExport = getSingleScreenshotExport(resp.data);
    const bytesWritten = await writeBase64ToFile(
      screenshotExport.base64,
      resolvedOutputPath
    );

    return {
      index,
      nodeId: screenshotExport.nodeId,
      nodeName: screenshotExport.nodeName,
      outputPath: resolvedOutputPath,
      format: resolvedFormat,
      width: screenshotExport.width,
      height: screenshotExport.height,
      bytesWritten,
      success: true,
    };
  } catch (err) {
    return {
      index,
      nodeId: item.nodeId,
      outputPath: resolvedOutputPath,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function writeBase64ToFile(
  base64: string,
  outputPath: string
): Promise<number> {
  const bytes = Buffer.from(base64, "base64");
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await writeFile(outputPath, bytes, { flag: "wx" });
  } catch (err) {
    if (isNodeError(err) && err.code === "EEXIST") {
      throw new Error(`File already exists at outputPath: ${outputPath}`);
    }
    throw err;
  }
  return bytes.length;
}

function resolveScale(
  itemScale?: number,
  defaultScale?: number
): number | undefined {
  const resolvedScale = itemScale ?? defaultScale;
  if (resolvedScale === undefined || resolvedScale <= 0) {
    return undefined;
  }
  return resolvedScale;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error;
}
