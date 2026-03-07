type SerializedBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SerializedLayout = {
  mode?: "none" | "row" | "column";
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  padding?: string;
  wrap?: boolean;
  sizing?: {
    horizontal?: "fixed" | "fill" | "hug";
    vertical?: "fixed" | "fill" | "hug";
  };
  position?: "absolute";
};

type SerializedTextStyle = {
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  fontSize?: number | "mixed";
  lineHeight?: string;
  letterSpacing?: string;
  textCase?: string;
  textDecoration?: string;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
};

type SerializedFill = {
  type: string;
  color?: string;
  opacity?: number;
  gradient?: string;
  gradientStops?: Array<{ color: string; position: number }>;
  imageRef?: string;
  scaleMode?: string;
  variableId?: string;
};

type SerializedEffect = {
  type: string;
  css?: string;
};

type SerializedTextSegment = {
  characters: string;
  style: SerializedTextStyle;
  fills?: SerializedFill[];
};

type SerializedConstraint = {
  horizontal?: string;
  vertical?: string;
};

type SerializedNode = {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  bounds?: SerializedBounds;
  rotation?: number;
  characters?: string;
  textStyle?: SerializedTextStyle;
  textSegments?: SerializedTextSegment[];
  styles?: Record<string, unknown>;
  layout?: SerializedLayout;
  constraints?: SerializedConstraint;
  opacity?: number;
  blendMode?: string;
  effects?: SerializedEffect[];
  componentId?: string;
  componentName?: string;
  componentProperties?: Record<string, { value: string; type: string }>;
  boundVariables?: Record<string, string>;
  children?: SerializedNode[];
  childCount?: number;
};

const isMixed = (value: unknown): value is symbol => typeof value === "symbol";

const clampColor = (value: number) =>
  Math.min(255, Math.max(0, Math.round(value * 255)));

const toHex = (color: RGB): string => {
  const [r, g, b] = [clampColor(color.r), clampColor(color.g), clampColor(color.b)];
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

const toRgba = (color: RGBA, opacity?: number): string => {
  const r = clampColor(color.r);
  const g = clampColor(color.g);
  const b = clampColor(color.b);
  const a = Math.round((opacity ?? 1) * (color.a ?? 1) * 100) / 100;
  if (a === 1) return toHex(color);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const serializePaint = (paint: Paint): SerializedFill | null => {
  if (paint.visible === false) return null;

  if (paint.type === "SOLID" && "color" in paint) {
    const color = toRgba(
      { ...paint.color, a: 1 } as RGBA,
      paint.opacity
    );
    const fill: SerializedFill = { type: "SOLID", color, opacity: paint.opacity };
    // Detect bound color variable
    if ((paint as any).boundVariables?.color) {
      fill.variableId = (paint as any).boundVariables.color.id;
    }
    return fill;
  }

  if (paint.type === "IMAGE" && "imageHash" in paint) {
    return {
      type: "IMAGE",
      imageRef: paint.imageHash ?? undefined,
      scaleMode: (paint as any).scaleMode,
      opacity: paint.opacity,
    };
  }

  if (paint.type.startsWith("GRADIENT_") && "gradientStops" in paint) {
    const stops = (paint as GradientPaint).gradientStops.map((stop) => ({
      color: toRgba({ ...stop.color, a: stop.color.a ?? 1 } as RGBA),
      position: Math.round(stop.position * 100) / 100,
    }));
    return {
      type: paint.type,
      gradientStops: stops,
      opacity: paint.opacity,
    };
  }

  return { type: paint.type, opacity: paint.opacity };
};

const serializePaints = (paints: readonly Paint[] | symbol | undefined): SerializedFill[] => {
  if (isMixed(paints) || !paints || !Array.isArray(paints)) return [];
  return paints.map(serializePaint).filter((p): p is SerializedFill => p !== null);
};

const getBounds = (node: SceneNode): SerializedBounds | undefined => {
  if ("x" in node && "y" in node && "width" in node && "height" in node) {
    return {
      x: Math.round(node.x * 100) / 100,
      y: Math.round(node.y * 100) / 100,
      width: Math.round(node.width * 100) / 100,
      height: Math.round(node.height * 100) / 100,
    };
  }
  return undefined;
};

/**
 * Map Figma font style string to a CSS-standard font weight value.
 * Figma stores weight in the style string (e.g. "Bold", "Semi Bold", "Medium Italic").
 */
const mapFontWeight = (style: string): string => {
  const s = style.toLowerCase();
  if (s.includes("thin") || s.includes("hairline")) return "100";
  if (s.includes("extralight") || s.includes("ultra light") || s.includes("extra light")) return "200";
  if (s.includes("light")) return "300";
  if (s.includes("regular") || s.includes("normal") || s === "roman") return "400";
  if (s.includes("medium")) return "500";
  if (s.includes("semibold") || s.includes("semi bold") || s.includes("demi bold") || s.includes("demibold")) return "600";
  if (s.includes("extrabold") || s.includes("extra bold") || s.includes("ultra bold")) return "800";
  if (s.includes("bold")) return "700";
  if (s.includes("black") || s.includes("heavy")) return "900";
  return "400";
};

const mapFontStyle = (style: string): string | undefined => {
  const s = style.toLowerCase();
  if (s.includes("italic")) return "italic";
  if (s.includes("oblique")) return "oblique";
  return undefined;
};

const serializeTextStyle = (node: TextNode): SerializedTextStyle => {
  const style: SerializedTextStyle = {};

  // Font family
  if (isMixed(node.fontName)) {
    style.fontFamily = "mixed";
    style.fontWeight = "mixed";
  } else if (node.fontName) {
    style.fontFamily = node.fontName.family;
    style.fontWeight = mapFontWeight(node.fontName.style);
    const fontStyle = mapFontStyle(node.fontName.style);
    if (fontStyle) style.fontStyle = fontStyle;
  }

  // Font size
  style.fontSize = isMixed(node.fontSize) ? "mixed" : node.fontSize;

  // Line height
  if (!isMixed(node.lineHeight)) {
    const lh = node.lineHeight as LineHeight;
    if (lh.unit === "PIXELS") {
      style.lineHeight = `${lh.value}px`;
    } else if (lh.unit === "PERCENT") {
      style.lineHeight = `${Math.round(lh.value)}%`;
    }
    // AUTO => omit (browser default)
  }

  // Letter spacing
  if (!isMixed(node.letterSpacing)) {
    const ls = node.letterSpacing as LetterSpacing;
    if (ls.unit === "PIXELS" && ls.value !== 0) {
      style.letterSpacing = `${ls.value}px`;
    } else if (ls.unit === "PERCENT" && ls.value !== 0) {
      style.letterSpacing = `${ls.value}%`;
    }
  }

  // Text case
  if (!isMixed(node.textCase) && node.textCase !== "ORIGINAL") {
    const caseMap: Record<string, string> = {
      UPPER: "uppercase",
      LOWER: "lowercase",
      TITLE: "capitalize",
      SMALL_CAPS: "small-caps",
      SMALL_CAPS_FORCED: "small-caps",
    };
    style.textCase = caseMap[node.textCase] ?? node.textCase;
  }

  // Text decoration
  if (!isMixed(node.textDecoration) && node.textDecoration !== "NONE") {
    const decoMap: Record<string, string> = {
      UNDERLINE: "underline",
      STRIKETHROUGH: "line-through",
    };
    style.textDecoration = decoMap[node.textDecoration] ?? node.textDecoration;
  }

  // Alignment
  style.textAlignHorizontal = isMixed(node.textAlignHorizontal)
    ? "mixed"
    : node.textAlignHorizontal;
  style.textAlignVertical = isMixed(node.textAlignVertical)
    ? "mixed"
    : node.textAlignVertical;

  return style;
};

/**
 * Compare two FontName objects for equality.
 */
const fontNamesEqual = (a: FontName, b: FontName): boolean =>
  a.family === b.family && a.style === b.style;

/**
 * Compare two fill arrays for equality (by serialized string).
 */
const fillsEqual = (a: readonly Paint[] | undefined, b: readonly Paint[] | undefined): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  // Quick structural comparison via serialized output
  const sa = a.map(serializePaint).filter(Boolean);
  const sb = b.map(serializePaint).filter(Boolean);
  return JSON.stringify(sa) === JSON.stringify(sb);
};

/**
 * Serialize individual text segments when a TextNode has mixed styles.
 * Each segment gets its own font family, weight, size, color, line height,
 * and letter spacing — giving the AI model the full per-run breakdown
 * instead of just "mixed".
 */
const serializeTextSegments = (node: TextNode): SerializedTextSegment[] | undefined => {
  // Check for any mixed property
  const hasMixed =
    isMixed(node.fontName) ||
    isMixed(node.fontSize) ||
    isMixed(node.fills) ||
    isMixed(node.letterSpacing) ||
    isMixed(node.lineHeight) ||
    isMixed(node.textDecoration) ||
    isMixed(node.textCase);

  if (!hasMixed) return undefined;

  const len = node.characters.length;
  if (len === 0) return undefined;

  const segments: SerializedTextSegment[] = [];
  let i = 0;

  while (i < len) {
    // Read style properties for the character at position i
    const startFont = node.getRangeFontName(i, i + 1) as FontName;
    const startSize = node.getRangeFontSize(i, i + 1) as number;
    const startFills = node.getRangeFills(i, i + 1);
    const startLineHeight = node.getRangeLineHeight(i, i + 1);
    const startLetterSpacing = node.getRangeLetterSpacing(i, i + 1);

    // Extend the run while all style properties remain the same
    let j = i + 1;
    while (j < len) {
      const font = node.getRangeFontName(j, j + 1);
      const size = node.getRangeFontSize(j, j + 1);
      if (
        isMixed(font) || isMixed(size) ||
        !fontNamesEqual(font as FontName, startFont) ||
        (size as number) !== startSize
      ) {
        break;
      }
      // Also break on fill color changes
      const curFills = node.getRangeFills(j, j + 1);
      if (!isMixed(startFills) && !isMixed(curFills)) {
        if (!fillsEqual(startFills as readonly Paint[], curFills as readonly Paint[])) break;
      } else if (isMixed(startFills) !== isMixed(curFills)) {
        break;
      }
      j++;
    }

    const chars = node.characters.slice(i, j);
    const style: SerializedTextStyle = {
      fontFamily: startFont.family,
      fontWeight: mapFontWeight(startFont.style),
      fontSize: startSize,
    };
    const fs = mapFontStyle(startFont.style);
    if (fs) style.fontStyle = fs;

    // Line height for this segment
    if (!isMixed(startLineHeight)) {
      const lh = startLineHeight as LineHeight;
      if (lh.unit === "PIXELS") style.lineHeight = `${lh.value}px`;
      else if (lh.unit === "PERCENT") style.lineHeight = `${Math.round(lh.value)}%`;
    }

    // Letter spacing for this segment
    if (!isMixed(startLetterSpacing)) {
      const ls = startLetterSpacing as LetterSpacing;
      if (ls.unit === "PIXELS" && ls.value !== 0) style.letterSpacing = `${ls.value}px`;
      else if (ls.unit === "PERCENT" && ls.value !== 0) style.letterSpacing = `${ls.value}%`;
    }

    // Segment fills (colors)
    const fills = !isMixed(startFills) ? serializePaints(startFills as readonly Paint[]) : undefined;

    const seg: SerializedTextSegment = { characters: chars, style };
    if (fills && fills.length > 0) seg.fills = fills;
    segments.push(seg);

    i = j;
  }

  // Always return segments if there's mixed content, even with 1 segment
  // (so the AI knows the resolved style instead of just "mixed")
  return segments.length > 0 ? segments : undefined;
};

/**
 * Get layout constraints (for absolute positioning within frames).
 */
const serializeConstraints = (node: SceneNode): SerializedConstraint | undefined => {
  if (!("constraints" in node)) return undefined;
  const c = (node as any).constraints as { horizontal: string; vertical: string } | undefined;
  if (!c) return undefined;
  // Only include non-default constraints
  if (c.horizontal === "MIN" && c.vertical === "MIN") return undefined;
  return {
    horizontal: c.horizontal,
    vertical: c.vertical,
  };
};

/**
 * Detect bound variables on a node (fills, strokes, effects, etc.)
 */
const serializeBoundVariables = (node: SceneNode): Record<string, string> | undefined => {
  if (!("boundVariables" in node)) return undefined;
  const bv = (node as any).boundVariables;
  if (!bv || typeof bv !== "object") return undefined;

  const result: Record<string, string> = {};
  for (const [key, binding] of Object.entries(bv)) {
    if (binding && typeof binding === "object" && "id" in (binding as any)) {
      result[key] = (binding as any).id;
    } else if (Array.isArray(binding)) {
      // Some bindings like fills are arrays
      for (let idx = 0; idx < binding.length; idx++) {
        if (binding[idx] && typeof binding[idx] === "object" && "id" in binding[idx]) {
          result[`${key}[${idx}]`] = binding[idx].id;
        }
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const serializeLayout = (node: SceneNode): SerializedLayout | undefined => {
  if (!("layoutMode" in node)) return undefined;
  const frame = node as FrameNode;

  const layout: SerializedLayout = {};

  // Auto-layout mode
  if (!frame.layoutMode || frame.layoutMode === "NONE") {
    layout.mode = "none";
  } else {
    layout.mode = frame.layoutMode === "HORIZONTAL" ? "row" : "column";

    // Primary axis alignment
    const justifyMap: Record<string, string> = {
      MIN: "flex-start",
      MAX: "flex-end",
      CENTER: "center",
      SPACE_BETWEEN: "space-between",
    };
    layout.justifyContent = justifyMap[frame.primaryAxisAlignItems] ?? "flex-start";

    // Counter axis alignment
    const alignMap: Record<string, string> = {
      MIN: "flex-start",
      MAX: "flex-end",
      CENTER: "center",
      BASELINE: "baseline",
    };
    layout.alignItems = alignMap[frame.counterAxisAlignItems] ?? "flex-start";

    // Gap
    if (frame.itemSpacing && frame.itemSpacing > 0) {
      layout.gap = `${frame.itemSpacing}px`;
    }

    // Wrap
    if ("layoutWrap" in frame && (frame as any).layoutWrap === "WRAP") {
      layout.wrap = true;
    }
  }

  // Padding
  if (frame.paddingTop || frame.paddingRight || frame.paddingBottom || frame.paddingLeft) {
    const t = frame.paddingTop ?? 0;
    const r = frame.paddingRight ?? 0;
    const b = frame.paddingBottom ?? 0;
    const l = frame.paddingLeft ?? 0;
    if (t === r && r === b && b === l) {
      layout.padding = `${t}px`;
    } else if (t === b && l === r) {
      layout.padding = `${t}px ${r}px`;
    } else {
      layout.padding = `${t}px ${r}px ${b}px ${l}px`;
    }
  }

  // Sizing
  const sizing: SerializedLayout["sizing"] = {};
  if ("layoutSizingHorizontal" in frame) {
    const h = (frame as any).layoutSizingHorizontal;
    if (h === "FIXED") sizing.horizontal = "fixed";
    else if (h === "FILL") sizing.horizontal = "fill";
    else if (h === "HUG") sizing.horizontal = "hug";
  }
  if ("layoutSizingVertical" in frame) {
    const v = (frame as any).layoutSizingVertical;
    if (v === "FIXED") sizing.vertical = "fixed";
    else if (v === "FILL") sizing.vertical = "fill";
    else if (v === "HUG") sizing.vertical = "hug";
  }
  if (sizing.horizontal || sizing.vertical) {
    layout.sizing = sizing;
  }

  // Absolute positioning
  if ("layoutPositioning" in frame && (frame as any).layoutPositioning === "ABSOLUTE") {
    layout.position = "absolute";
  }

  return layout;
};

const serializeEffects = (node: SceneNode): SerializedEffect[] => {
  if (!("effects" in node)) return [];
  const effects = (node as any).effects as readonly Effect[];
  if (!effects || effects.length === 0) return [];

  return effects
    .filter((e) => e.visible !== false)
    .map((effect) => {
      const base: SerializedEffect = { type: effect.type };

      if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
        const shadow = effect as DropShadowEffect;
        const color = toRgba(shadow.color);
        const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
        base.css = `${inset}${shadow.offset.x}px ${shadow.offset.y}px ${shadow.radius}px ${shadow.spread ?? 0}px ${color}`;
      } else if (effect.type === "LAYER_BLUR") {
        base.css = `blur(${(effect as BlurEffect).radius}px)`;
      } else if (effect.type === "BACKGROUND_BLUR") {
        base.css = `blur(${(effect as BlurEffect).radius}px)`;
      }

      return base;
    });
};

const serializeStyles = (node: SceneNode) => {
  const styles: Record<string, unknown> = {};

  if ("fills" in node) {
    styles.fills = serializePaints(node.fills);
  }
  if ("strokes" in node) {
    const strokes = serializePaints(node.strokes);
    if (strokes.length > 0) {
      styles.strokes = strokes;
    }
  }
  if ("strokeWeight" in node && !isMixed(node.strokeWeight) && node.strokeWeight > 0) {
    styles.strokeWeight = `${node.strokeWeight}px`;
  }
  if ("strokeAlign" in node) {
    styles.strokeAlign = node.strokeAlign;
  }

  // Corner radius — handle per-corner and uniform
  if ("cornerRadius" in node) {
    if (isMixed(node.cornerRadius)) {
      // Per-corner radii
      if ("topLeftRadius" in node) {
        const n = node as RectangleNode;
        styles.borderRadius = `${n.topLeftRadius}px ${n.topRightRadius}px ${n.bottomRightRadius}px ${n.bottomLeftRadius}px`;
      } else {
        styles.cornerRadius = "mixed";
      }
    } else if (node.cornerRadius && node.cornerRadius > 0) {
      styles.borderRadius = `${node.cornerRadius}px`;
    }
  }

  // Clip content
  if ("clipsContent" in node && node.clipsContent) {
    styles.overflow = "hidden";
  }

  return styles;
};

export const serializeNode = (node: SceneNode): SerializedNode => {
  // Skip invisible nodes
  const visible = "visible" in node ? node.visible : true;

  const base: SerializedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    bounds: getBounds(node),
    styles: serializeStyles(node),
  };

  // Only mark visibility when hidden
  if (!visible) {
    base.visible = false;
  }

  // Rotation (degrees, clockwise)
  if ("rotation" in node && typeof node.rotation === "number" && node.rotation !== 0) {
    base.rotation = Math.round(node.rotation * 100) / 100;
  }

  // Opacity
  if ("opacity" in node && typeof node.opacity === "number" && node.opacity < 1) {
    base.opacity = Math.round(node.opacity * 100) / 100;
  }

  // Blend mode
  if ("blendMode" in node && node.blendMode !== "PASS_THROUGH" && node.blendMode !== "NORMAL") {
    base.blendMode = node.blendMode;
  }

  // Effects (shadows, blurs)
  const effects = serializeEffects(node);
  if (effects.length > 0) {
    base.effects = effects;
  }

  // Layout (auto-layout, sizing, padding)
  const layout = serializeLayout(node);
  if (layout && Object.keys(layout).length > 0) {
    base.layout = layout;
  }

  // Component info
  if (node.type === "INSTANCE") {
    const inst = node as InstanceNode;
    if (inst.componentProperties) {
      base.componentProperties = Object.fromEntries(
        Object.entries(inst.componentProperties).map(([key, prop]) => [
          key,
          { value: String(prop.value), type: prop.type },
        ])
      );
    }
    const mainComp = inst.mainComponent;
    if (mainComp) {
      base.componentId = mainComp.id;
      base.componentName = mainComp.name;
    }
  }

  if (node.type === "COMPONENT") {
    base.componentId = node.id;
    base.componentName = node.name;
  }

  // Constraints (for absolute positioning hints)
  const constraints = serializeConstraints(node);
  if (constraints) {
    base.constraints = constraints;
  }

  // Bound variables (design tokens)
  const boundVars = serializeBoundVariables(node);
  if (boundVars) {
    base.boundVariables = boundVars;
  }

  // Text node — full typography data + segments for mixed styles
  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    base.characters = textNode.characters;
    base.textStyle = serializeTextStyle(textNode);
    const segments = serializeTextSegments(textNode);
    if (segments) {
      base.textSegments = segments;
    }
    return base;
  }

  // Container nodes — recurse into children
  if ("children" in node) {
    return {
      ...base,
      children: node.children.map((child) => serializeNode(child)),
    };
  }

  return base;
};
