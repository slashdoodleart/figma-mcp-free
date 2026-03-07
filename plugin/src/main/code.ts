import { serializeNode } from "./serializer";

type RequestType =
  | "get_document"
  | "get_selection"
  | "get_node"
  | "get_nodes"
  | "get_styles"
  | "get_metadata"
  | "get_design_context"
  | "get_variable_defs"
  | "get_screenshot";

type ServerRequest = {
  type: RequestType;
  requestId: string;
  nodeIds?: string[];
  params?: {
    format?: "PNG" | "SVG" | "JPG" | "PDF";
    scale?: number;
    depth?: number;
    includeInvisible?: boolean;
  };
};

type PluginResponse = {
  type: RequestType;
  requestId: string;
  data?: unknown;
  error?: string;
};

const sendStatus = () => {
  figma.ui.postMessage({
    type: "plugin-status",
    payload: {
      fileName: figma.root.name,
      selectionCount: figma.currentPage.selection.length,
    },
  });
};

const serializeVariableValue = (value: VariableValue): unknown => {
  if (typeof value === "object" && value !== null) {
    if ("type" in value && value.type === "VARIABLE_ALIAS") {
      return { type: "VARIABLE_ALIAS", id: value.id };
    }
    if ("r" in value && "g" in value && "b" in value) {
      // It's an RGB or RGBA color
      const color = value as RGBA;
      return {
        type: "COLOR",
        r: color.r,
        g: color.g,
        b: color.b,
        a: "a" in color ? color.a : 1,
      };
    }
  }
  return value;
};

const handleRequest = async (
  request: ServerRequest
): Promise<PluginResponse> => {
  try {
    switch (request.type) {
      case "get_document":
        return {
          type: request.type,
          requestId: request.requestId,
          data: serializeNode(figma.currentPage as unknown as SceneNode),
        };
      case "get_selection":
        return {
          type: request.type,
          requestId: request.requestId,
          data: figma.currentPage.selection.map((node) => serializeNode(node)),
        };
      case "get_node": {
        const nodeId = request.nodeIds && request.nodeIds[0];
        if (!nodeId) {
          throw new Error("nodeIds is required for get_node");
        }
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node || node.type === "DOCUMENT") {
          throw new Error(`Node not found: ${nodeId}`);
        }
        return {
          type: request.type,
          requestId: request.requestId,
          data: serializeNode(node as SceneNode),
        };
      }
      case "get_styles": {
        const [paintStyles, textStyles, effectStyles, gridStyles] =
          await Promise.all([
            figma.getLocalPaintStylesAsync(),
            figma.getLocalTextStylesAsync(),
            figma.getLocalEffectStylesAsync(),
            figma.getLocalGridStylesAsync(),
          ]);

        const mapFontWeight = (style: string): string => {
          const s = style.toLowerCase();
          if (s.includes("thin") || s.includes("hairline")) return "100";
          if (s.includes("extralight") || s.includes("ultra light") || s.includes("extra light")) return "200";
          if (s.includes("light")) return "300";
          if (s.includes("regular") || s.includes("normal")) return "400";
          if (s.includes("medium")) return "500";
          if (s.includes("semibold") || s.includes("semi bold") || s.includes("demibold") || s.includes("demi bold")) return "600";
          if (s.includes("extrabold") || s.includes("extra bold") || s.includes("ultra bold")) return "800";
          if (s.includes("bold")) return "700";
          if (s.includes("black") || s.includes("heavy")) return "900";
          return "400";
        };

        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            paints: paintStyles.map((style) => ({
              id: style.id,
              name: style.name,
              paints: style.paints,
            })),
            text: textStyles.map((style) => {
              const lh = style.lineHeight as LineHeight;
              let lineHeight: string | undefined;
              if (lh.unit === "PIXELS") lineHeight = `${lh.value}px`;
              else if (lh.unit === "PERCENT") lineHeight = `${Math.round(lh.value)}%`;

              const ls = style.letterSpacing as LetterSpacing;
              let letterSpacing: string | undefined;
              if (ls.unit === "PIXELS" && ls.value !== 0) letterSpacing = `${ls.value}px`;
              else if (ls.unit === "PERCENT" && ls.value !== 0) letterSpacing = `${ls.value}%`;

              return {
                id: style.id,
                name: style.name,
                fontFamily: style.fontName.family,
                fontWeight: mapFontWeight(style.fontName.style),
                fontStyle: style.fontName.style.toLowerCase().includes("italic") ? "italic" : undefined,
                fontSize: style.fontSize,
                lineHeight,
                letterSpacing,
                textCase: style.textCase !== "ORIGINAL" ? style.textCase : undefined,
                textDecoration: style.textDecoration !== "NONE" ? style.textDecoration : undefined,
              };
            }),
            effects: effectStyles.map((style) => ({
              id: style.id,
              name: style.name,
              effects: style.effects,
            })),
            grids: gridStyles.map((style) => ({
              id: style.id,
              name: style.name,
              layoutGrids: style.layoutGrids,
            })),
          },
        };
      }
      case "get_metadata": {
        // Structural overview: returns a lightweight tree of the selection
        // or full page with types, positions, and sizes (like official Figma MCP).
        // Useful for navigating large designs before calling get_design_context.
        const selection = figma.currentPage.selection;

        const serializeMetadataNode = (
          node: SceneNode | PageNode,
          maxDepth: number,
          currentDepth: number = 0
        ): Record<string, unknown> => {
          const entry: Record<string, unknown> = {
            id: node.id,
            name: node.name,
            type: node.type,
          };
          if ("x" in node && "y" in node) {
            entry.x = Math.round((node as SceneNode).x);
            entry.y = Math.round((node as SceneNode).y);
          }
          if ("width" in node && "height" in node) {
            entry.width = Math.round(node.width);
            entry.height = Math.round(node.height);
          }
          if ("children" in node && currentDepth < maxDepth) {
            entry.children = (node as ChildrenMixin).children.map((child) =>
              serializeMetadataNode(child as SceneNode, maxDepth, currentDepth + 1)
            );
          } else if ("children" in node) {
            entry.childCount = (node as ChildrenMixin).children.length;
          }
          return entry;
        };

        const metadataDepth = request.params?.depth ?? 3;
        const nodes = selection.length > 0
          ? selection.map((n) => serializeMetadataNode(n, metadataDepth))
          : [serializeMetadataNode(figma.currentPage, metadataDepth)];

        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            fileName: figma.root.name,
            currentPageId: figma.currentPage.id,
            currentPageName: figma.currentPage.name,
            pageCount: figma.root.children.length,
            pages: figma.root.children.map((page) => ({
              id: page.id,
              name: page.name,
            })),
            selectionCount: selection.length,
            nodes,
          },
        };
      }
      case "get_design_context": {
        const depth = request.params?.depth ?? 2;
        const includeInvisible = request.params?.includeInvisible ?? false;

        const serializeWithDepth = async (
          node: SceneNode,
          currentDepth: number
        ): Promise<ReturnType<typeof serializeNode>> => {
          // Skip invisible nodes unless explicitly requested
          if (!includeInvisible && "visible" in node && !node.visible) {
            return null as unknown as ReturnType<typeof serializeNode>;
          }

          const serialized = serializeNode(node);
          if (currentDepth >= depth && serialized.children) {
            // Truncate children at depth limit, but show count
            const visibleChildren = includeInvisible
              ? (node as ChildrenMixin & SceneNode).children
              : (node as ChildrenMixin & SceneNode).children?.filter(
                  (c) => !("visible" in c) || c.visible
                );
            return {
              ...serialized,
              children: undefined,
              childCount: visibleChildren?.length ?? 0,
            } as ReturnType<typeof serializeNode> & { childCount: number };
          }
          if (serialized.children && "children" in node) {
            const children = (node as FrameNode).children;
            const filteredChildren = includeInvisible
              ? children
              : children.filter((c) => !("visible" in c) || c.visible);

            const serializedChildren = (
              await Promise.all(
                filteredChildren.map((n) =>
                  serializeWithDepth(n as SceneNode, currentDepth + 1)
                )
              )
            ).filter(Boolean);

            return {
              ...serialized,
              children: serializedChildren,
            };
          }
          return serialized;
        };

        // If nodeIds are provided, fetch those specific nodes
        // Otherwise fall back to current selection or full page
        let targetNodes: SceneNode[];
        if (request.nodeIds && request.nodeIds.length > 0) {
          const fetched = await Promise.all(
            request.nodeIds.map((id) => figma.getNodeByIdAsync(id))
          );
          targetNodes = fetched.filter(
            (n): n is SceneNode =>
              n !== null && n.type !== "DOCUMENT" && n.type !== "PAGE"
          );
        } else {
          const selection = figma.currentPage.selection;
          targetNodes = selection.length > 0
            ? [...selection]
            : [figma.currentPage as unknown as SceneNode];
        }

        const contextNodes = (
          await Promise.all(
            targetNodes.map((node) => serializeWithDepth(node, 0))
          )
        ).filter(Boolean);

        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            fileName: figma.root.name,
            currentPage: {
              id: figma.currentPage.id,
              name: figma.currentPage.name,
            },
            selectionCount: targetNodes.length,
            context: contextNodes,
          },
        };
      }
      case "get_nodes": {
        if (!request.nodeIds || request.nodeIds.length === 0) {
          throw new Error("nodeIds is required for get_nodes");
        }
        const nodes = await Promise.all(
          request.nodeIds.map(async (id) => {
            const node = await figma.getNodeByIdAsync(id);
            if (!node || node.type === "DOCUMENT") {
              return { id, error: `Node not found: ${id}` };
            }
            return serializeNode(node as SceneNode);
          })
        );
        return {
          type: request.type,
          requestId: request.requestId,
          data: nodes,
        };
      }
      case "get_variable_defs": {
        const collections =
          await figma.variables.getLocalVariableCollectionsAsync();
        const variableData = await Promise.all(
          collections.map(async (collection) => {
            const variables = await Promise.all(
              collection.variableIds.map((id) =>
                figma.variables.getVariableByIdAsync(id)
              )
            );
            return {
              id: collection.id,
              name: collection.name,
              modes: collection.modes.map((mode) => ({
                modeId: mode.modeId,
                name: mode.name,
              })),
              variables: variables
                .filter((v): v is Variable => v !== null)
                .map((variable) => ({
                  id: variable.id,
                  name: variable.name,
                  resolvedType: variable.resolvedType,
                  valuesByMode: Object.fromEntries(
                    Object.entries(variable.valuesByMode).map(
                      ([modeId, value]) => [
                        modeId,
                        serializeVariableValue(value),
                      ]
                    )
                  ),
                })),
            };
          })
        );
        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            collections: variableData,
          },
        };
      }
      case "get_screenshot": {
        const format = request.params?.format ?? "PNG";
        const scale = request.params?.scale ?? 2;

        // Determine which node(s) to export
        let targetNodes: SceneNode[];
        if (request.nodeIds && request.nodeIds.length > 0) {
          const nodes = await Promise.all(
            request.nodeIds.map((id) => figma.getNodeByIdAsync(id))
          );
          targetNodes = nodes.filter(
            (node): node is SceneNode =>
              node !== null && node.type !== "DOCUMENT" && node.type !== "PAGE"
          );
        } else {
          targetNodes = [...figma.currentPage.selection];
        }

        if (targetNodes.length === 0) {
          throw new Error(
            "No nodes to export. Select nodes or provide nodeIds."
          );
        }

        const exports = await Promise.all(
          targetNodes.map(async (node) => {
            // Use useAbsoluteBounds: false to export only the node itself
            // without flattening onto a white background from parent bounds.
            // For PNG, this preserves transparency correctly.
            const settings: ExportSettings =
              format === "SVG"
                ? { format: "SVG", svgIdAttribute: true }
                : format === "PDF"
                  ? { format: "PDF" }
                  : format === "JPG"
                    ? {
                        format: "JPG",
                        constraint: { type: "SCALE", value: scale },
                      }
                    : {
                        format: "PNG",
                        constraint: { type: "SCALE", value: scale },
                      };

            const bytes = await node.exportAsync(settings);
            const base64 = figma.base64Encode(bytes);

            // Report actual pixel dimensions for raster formats
            const actualWidth = format === "SVG" || format === "PDF"
              ? node.width
              : Math.round(node.width * scale);
            const actualHeight = format === "SVG" || format === "PDF"
              ? node.height
              : Math.round(node.height * scale);

            return {
              nodeId: node.id,
              nodeName: node.name,
              format,
              base64,
              width: actualWidth,
              height: actualHeight,
              originalWidth: node.width,
              originalHeight: node.height,
            };
          })
        );

        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            exports,
          },
        };
      }
      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }
  } catch (error) {
    return {
      type: request.type,
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

figma.showUI(__html__, { width: 320, height: 180 });
sendStatus();

figma.on("selectionchange", () => {
  sendStatus();
});

figma.ui.onmessage = async (message) => {
  if (message.type === "ui-ready") {
    sendStatus();
    return;
  }

  if (message.type === "server-request") {
    const response = await handleRequest(message.payload as ServerRequest);
    try {
      figma.ui.postMessage(response);
    } catch (err) {
      figma.ui.postMessage({
        type: response.type,
        requestId: response.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
