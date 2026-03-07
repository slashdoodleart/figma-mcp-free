# Figma MCP Free Rules

These rules define the recommended workflow when implementing Figma designs using the Figma MCP Free server.

## Required Flow (do not skip)

1. Run `get_design_context` first to fetch the structured representation for the exact node(s).
2. If the response is too large or truncated, run `get_metadata` to get the high-level node map with layer IDs, names, types, positions, and sizes. Then re-fetch only the required node(s) with `get_design_context`.
3. Run `get_screenshot` for a visual reference of the node being implemented.
4. Run `get_variable_defs` to retrieve design tokens (colors, spacing, typography variables).
5. Only after you have design context, screenshot, and token info, start implementation.
6. Translate the output into this project's conventions, styles, and framework. Reuse existing color tokens, components, and typography.
7. Validate against Figma for 1:1 look and behavior before marking complete.

## Implementation Rules

- Treat the Figma MCP output as a representation of design structure and behavior, not as final code.
- Reuse existing components (buttons, inputs, typography, icon wrappers) instead of duplicating functionality.
- Use the project's color system, typography scale, and spacing tokens consistently.
- Respect existing routing, state management, and data-fetch patterns already adopted in the repo.
- Strive for 1:1 visual parity with the Figma design.
- Validate the final UI against the Figma screenshot for both look and behavior.

## Tool Usage Guide

| Tool | When to Use |
|------|-------------|
| `get_metadata` | First, to understand structure of large designs. Returns lightweight node tree with IDs, types, positions, sizes. |
| `get_design_context` | Primary tool. Returns full layout, typography, fills, effects, components for selected nodes. |
| `get_screenshot` | Always. Provides visual reference for implementation validation. PNG preserves transparency. |
| `get_variable_defs` | To extract design tokens (colors, spacing, typography variables). |
| `get_styles` | To get all local text/paint/effect styles defined in the document. |
| `get_node` | To fetch a specific node by ID with full properties. |
| `get_selection` | To see what's currently selected in Figma. |
| `create_design_system_rules` | Once per project. Generates custom rules tailored to your stack. |

## Node ID Format

- Always use colon-separated format: `4029:12345`
- Never use hyphens in node IDs
- When extracting from Figma URLs, convert `node-id=1-2` to `1:2`

## Typography Data

The bridge extracts full typography information:
- `fontFamily`: The font family name
- `fontWeight`: CSS numeric weight (100-900), mapped from Figma style names
- `fontStyle`: "italic" or "oblique" when applicable
- `fontSize`: Size in pixels
- `lineHeight`: In px or % (omitted for AUTO)
- `letterSpacing`: In px or % (omitted when 0)
- `textCase`: CSS values (uppercase, lowercase, capitalize, small-caps)
- `textDecoration`: CSS values (underline, line-through)
- `textSegments`: When text has mixed styles, individual segments with their own style properties

## Layout Data

Auto-layout properties map to CSS flexbox:
- `mode`: "row" or "column" (maps to flex-direction)
- `justifyContent`: flex-start, flex-end, center, space-between
- `alignItems`: flex-start, flex-end, center, baseline
- `gap`: Gap between items in px
- `padding`: CSS shorthand padding
- `wrap`: Whether flex-wrap is enabled
- `sizing.horizontal` / `sizing.vertical`: "fixed", "fill" (flex-grow), or "hug" (fit-content)

## Variable Bindings

When nodes use Figma variables (design tokens), the output includes:
- `boundVariables`: Maps property names to variable IDs
- `fills[].variableId`: Variable ID bound to a specific fill color
- Use `get_variable_defs` to resolve variable IDs to names and values
