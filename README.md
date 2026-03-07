# Figma MCP Free

- [Install](#install)
- [Features](#features)
- [Manual Setup](#manual-setup)
- [Tools](#tools)
- [Structure](#structure)
- [How It Works](#how-it-works)

<br/>

A plugin + MCP server that streams live Figma document data to AI coding tools without hitting Figma's REST API rate limits. Figma's free-tier API limits are brutal (a handful of requests per month), so I built this to bypass that entirely — the plugin reads directly from the Figma canvas and streams data over a local WebSocket to the MCP server.

## Install

### Automatic (recommended)

Clone the repo and run the installer — it detects every installed AI tool and configures them all in one shot.

**macOS / Linux**
```bash
git clone https://github.com/slashdoodleart/figma-mcp-free.git
cd figma-mcp-free
chmod +x install.sh && ./install.sh
```

**Windows (PowerShell)**
```powershell
git clone https://github.com/slashdoodleart/figma-mcp-free.git
cd figma-mcp-free
.\install.ps1
```

The installer:
- Builds the MCP server from source
- Auto-detects and configures: **Claude Desktop**, **Claude Code**, **Cursor**, **VS Code**, **VS Code Insiders**, **Windsurf**, **Gemini Code (Antigravity)**, **Zed**
- Skips tools that aren't installed (re-run after installing any new tool)
- Prints the plugin install path

Then in Figma: **Plugins → Development → Import plugin from manifest** → select `plugin/manifest.json`.

## Features

- **Zero API calls** — reads directly from the Figma plugin API, no REST API tokens needed
- **Full design extraction** — layout (auto-layout → flexbox), typography (with accurate font weights + mixed text segments), fills (solid, gradient, image with variable bindings), effects (shadows, blurs → CSS), constraints, component data
- **Screenshot export** — PNG (with transparency), JPG, SVG, PDF at configurable scale — returned as viewable images to the AI
- **Target nodes by ID** — `get_design_context` and `get_screenshot` accept `nodeIds` to target specific nodes without selecting them in Figma
- **Design tokens** — extracts Figma variables (colors, spacing, typography) for token mapping
- **Structural metadata** — lightweight node tree for navigating large designs before deep-fetching
- **Leader election** — multiple MCP server instances auto-coordinate; only one holds the WebSocket
- **Works with any MCP client** — VS Code, Cursor, Windsurf, Claude Desktop, Gemini Code, Zed, etc.

## Manual Setup

### Supported tools & config locations

| Tool | Config file |
|------|-------------|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `~/.claude/mcp.json` |
| Cursor | `~/.cursor/mcp.json` |
| VS Code / GitHub Copilot | `~/Library/Application Support/Code/User/mcp.json` (macOS) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Gemini Code (Antigravity) | `~/Library/Application Support/Google/GeminiCode/mcp_config.json` |
| Zed | `~/.config/zed/settings.json` |

Add the MCP server entry to `mcpServers` in the relevant file:

```json
{
  "mcpServers": {
    "figma-mcp-free": {
      "command": "node",
      "args": ["/absolute/path/to/figma-mcp-free/server/dist/index.js"]
    }
  }
}
```

Or use `npx` (no build required):

```json
{
  "mcpServers": {
    "figma-mcp-free": {
      "command": "npx",
      "args": ["-y", "figma-mcp-free"]
    }
  }
}
```

### VS Code / GitHub Copilot

Add to `~/Library/Application Support/Code/User/mcp.json` (global) or `.vscode/mcp.json` (workspace):

```json
{
  "servers": {
    "figma-bridge": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "figma-mcp-free"]
    }
  }
}
```

For the best experience, use the included VS Code agent (`Figma MCP Free`) and Copilot instructions in `.github/copilot-instructions.md` — they define the recommended design-to-code workflow.

## Tools

| Tool | Description |
|------|-------------|
| `get_metadata` | Lightweight node tree with IDs, types, positions, sizes. Use first on large designs. |
| `get_design_context` | Full design data — layout, typography, fills, effects, constraints, components. Primary tool. |
| `get_screenshot` | Export screenshot as PNG/JPG/SVG/PDF. PNG preserves transparency. |
| `get_variable_defs` | All Figma variable collections and values (design tokens). |
| `get_styles` | Local paint, text, effect, and grid styles. |
| `get_node` | Fetch a specific node by ID. |
| `get_selection` | Get currently selected nodes with full properties. |
| `get_document` | Full page document tree. |
| `save_screenshots` | Export + save screenshots directly to filesystem. |
| `create_design_system_rules` | Generate AI workflow rules tailored to your stack. |

## Local Development

```bash
git clone https://github.com/slashdoodleart/figma-mcp-free.git
cd figma-mcp-free

# Build server
cd server && npm install && npm run build

# Build plugin
cd ../plugin && npm install && npm run build
```

Then run `./install.sh` (or `.\install.ps1`) to configure your AI tools.

## Structure

```
figma-mcp-free/
├── plugin/                 # Figma plugin (TypeScript/React)
│   ├── src/main/
│   │   ├── code.ts         # Plugin handler — processes bridge requests
│   │   └── serializer.ts   # Serializes Figma nodes → structured JSON
│   └── src/ui/
│       └── App.tsx          # Plugin UI (connection status)
└── server/                 # MCP server (TypeScript/Node.js)
    └── src/
        ├── index.ts         # Entry point
        ├── bridge.ts        # WebSocket bridge to Figma plugin
        ├── leader.ts        # Leader: HTTP server + bridge
        ├── follower.ts      # Follower: proxies to leader via HTTP
        ├── node.ts          # Dynamic leader/follower role switching
        ├── election.ts      # Leader election & health monitoring
        ├── tools.ts         # MCP tool definitions
        ├── schema.ts        # Zod input schemas
        └── types.ts         # Shared types
```

## How It Works

### The Figma Plugin

Runs inside Figma and reads directly from the canvas using the Figma Plugin API. It serializes nodes into structured JSON with full layout, typography, visual styles, design tokens, and component data. Connects to the MCP server over WebSocket at `ws://localhost:1994`.

### The MCP Server

Receives tool calls from AI clients via stdio (MCP protocol), forwards them to the Figma plugin over the WebSocket, and returns the results. Multiple server instances use leader election — only one holds the WebSocket connection, others proxy requests via HTTP.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FIGMA (Browser)                                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Figma Plugin                                  │  │
│  │               Reads canvas → serializes → streams                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ WebSocket (ws://localhost:1994)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRIMARY MCP SERVER (Leader)                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  • Manages WebSocket to plugin          Endpoints:                  │    │
│  │  • Forwards MCP tool calls              • /ws    (plugin)           │    │
│  │  • Routes responses back                • /ping  (health)           │    │
│  │                                         • /rpc   (followers)        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                           ▲                              ▲
                           │ HTTP /rpc                    │ HTTP /rpc
         ┌─────────────────┴───────────┐    ┌─────────────┴───────────────┐
         │      FOLLOWER SERVER 1      │    │      FOLLOWER SERVER 2      │
         │  • Proxies to leader        │    │  • Proxies to leader        │
         │  • Takes over if leader     │    │  • Takes over if leader     │
         │    goes down                │    │    goes down                │
         └─────────────────────────────┘    └─────────────────────────────┘
                    ▲                                      ▲
                    │ MCP (stdio)                          │ MCP (stdio)
                    ▼                                      ▼
         ┌─────────────────────────────┐    ┌─────────────────────────────┐
         │       AI Tool / IDE 1       │    │       AI Tool / IDE 2       │
         └─────────────────────────────┘    └─────────────────────────────┘
```

## License

MIT
