#!/usr/bin/env bash
# Figma MCP Free — installer
# Supports: Claude Desktop, Claude Code, Cursor, VS Code, Windsurf,
#           Gemini CLI (Antigravity), Zed
set -euo pipefail

# ── colours ────────────────────────────────────────────────────────────────
BOLD='\033[1m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "${RED}✗${RESET} $*"; }
header()  { echo -e "\n${BOLD}$*${RESET}"; }

# ── detect OS ──────────────────────────────────────────────────────────────
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *)      error "Unsupported OS: $OS"; exit 1 ;;
esac

# ── resolve script directory (repo root) ──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
DIST_JS="$SERVER_DIR/dist/index.js"

# ── helpers ────────────────────────────────────────────────────────────────
command_exists() { command -v "$1" &>/dev/null; }

# Merge MCP server config into a JSON config file.
# Creates the file if missing; adds/updates only "mcpServers.figma-mcp-free".
inject_mcp_config() {
  local config_file="$1"
  local server_block="$2"   # JSON object string for the server entry
  local server_key="figma-mcp-free"

  mkdir -p "$(dirname "$config_file")"

  if [[ ! -f "$config_file" ]]; then
    echo "{}" > "$config_file"
  fi

  # Require python3 or node for JSON merge
  if command_exists python3; then
    python3 - "$config_file" "$server_key" "$server_block" <<'PYEOF'
import sys, json

path, key, block = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    cfg = json.load(f)

if "mcpServers" not in cfg:
    cfg["mcpServers"] = {}

cfg["mcpServers"][key] = json.loads(block)

with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PYEOF
  elif command_exists node; then
    node - "$config_file" "$server_key" "$server_block" <<'JSEOF'
const fs = require("fs");
const [, , path, key, block] = process.argv;
const cfg = JSON.parse(fs.readFileSync(path, "utf8") || "{}");
if (!cfg.mcpServers) cfg.mcpServers = {};
cfg.mcpServers[key] = JSON.parse(block);
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
JSEOF
  else
    warn "Neither python3 nor node found — writing raw config to $config_file"
    cat > "$config_file" <<EOF
{
  "mcpServers": {
    "$server_key": $server_block
  }
}
EOF
  fi
}

# ── build server ───────────────────────────────────────────────────────────
header "Building Figma MCP Free server"

if ! command_exists node; then
  error "Node.js not found. Install Node.js 20+ from https://nodejs.org"
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.version.replace('v',''))")
NODE_MAJOR="${NODE_VER%%.*}"
if (( NODE_MAJOR < 20 )); then
  error "Node.js 20+ required (found v$NODE_VER)"
  exit 1
fi

info "Installing server dependencies…"
(cd "$SERVER_DIR" && npm install --silent)

info "Building server…"
(cd "$SERVER_DIR" && npm run build --silent)

if [[ ! -f "$DIST_JS" ]]; then
  error "Build failed — $DIST_JS not found"
  exit 1
fi

success "Server built → $DIST_JS"

# ── server config block ────────────────────────────────────────────────────
SERVER_JSON=$(cat <<EOF
{
  "command": "node",
  "args": ["$DIST_JS"]
}
EOF
)

# ── tool config paths ──────────────────────────────────────────────────────
if [[ "$PLATFORM" == "macos" ]]; then
  CLAUDE_DESKTOP_CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
  VSCODE_CFG="$HOME/Library/Application Support/Code/User/mcp.json"
  VSCODE_INSIDERS_CFG="$HOME/Library/Application Support/Code - Insiders/User/mcp.json"
  GEMINI_CFG="$HOME/Library/Application Support/Google/GeminiCode/mcp_config.json"
else
  CLAUDE_DESKTOP_CFG="$HOME/.config/claude/claude_desktop_config.json"
  VSCODE_CFG="$HOME/.config/Code/User/mcp.json"
  VSCODE_INSIDERS_CFG="$HOME/.config/Code - Insiders/User/mcp.json"
  GEMINI_CFG="$HOME/.config/google/gemini-code/mcp_config.json"
fi

CLAUDE_CODE_CFG="$HOME/.claude/mcp.json"
CURSOR_GLOBAL_CFG="$HOME/.cursor/mcp.json"
WINDSURF_CFG="$HOME/.codeium/windsurf/mcp_config.json"
ZED_CFG="$HOME/.config/zed/settings.json"

# ── detect & configure each tool ──────────────────────────────────────────
INSTALLED=()
SKIPPED=()

configure_tool() {
  local name="$1"
  local cfg_path="$2"
  local always="${3:-false}"  # if true, configure even if app not detected

  if [[ "$always" == "true" ]] || [[ -f "$cfg_path" ]] || [[ -d "$(dirname "$cfg_path")" ]]; then
    info "Configuring $name…"
    inject_mcp_config "$cfg_path" "$SERVER_JSON"
    success "$name configured → $cfg_path"
    INSTALLED+=("$name")
  else
    SKIPPED+=("$name (not detected)")
  fi
}

header "Configuring AI tools"

# Claude Desktop
if [[ "$PLATFORM" == "macos" ]]; then
  configure_tool "Claude Desktop" "$CLAUDE_DESKTOP_CFG" \
    "$([[ -d "$HOME/Library/Application Support/Claude" ]] && echo true || echo false)"
else
  configure_tool "Claude Desktop" "$CLAUDE_DESKTOP_CFG" \
    "$([[ -d "$HOME/.config/claude" ]] && echo true || echo false)"
fi

# Claude Code (CLI)
if command_exists claude; then
  info "Configuring Claude Code (CLI)…"
  inject_mcp_config "$CLAUDE_CODE_CFG" "$SERVER_JSON"
  success "Claude Code configured → $CLAUDE_CODE_CFG"
  INSTALLED+=("Claude Code")
else
  SKIPPED+=("Claude Code (claude CLI not found)")
fi

# Cursor
if command_exists cursor || [[ -d "$HOME/.cursor" ]]; then
  inject_mcp_config "$CURSOR_GLOBAL_CFG" "$SERVER_JSON"
  success "Cursor configured → $CURSOR_GLOBAL_CFG"
  INSTALLED+=("Cursor")
else
  SKIPPED+=("Cursor (not detected)")
fi

# VS Code
if command_exists code || [[ -f "$VSCODE_CFG" ]]; then
  inject_mcp_config "$VSCODE_CFG" "$SERVER_JSON"
  success "VS Code configured → $VSCODE_CFG"
  INSTALLED+=("VS Code")
else
  SKIPPED+=("VS Code (not detected)")
fi

# VS Code Insiders
if command_exists code-insiders || [[ -f "$VSCODE_INSIDERS_CFG" ]]; then
  inject_mcp_config "$VSCODE_INSIDERS_CFG" "$SERVER_JSON"
  success "VS Code Insiders configured → $VSCODE_INSIDERS_CFG"
  INSTALLED+=("VS Code Insiders")
fi

# Windsurf
if command_exists windsurf || [[ -d "$HOME/.codeium/windsurf" ]]; then
  inject_mcp_config "$WINDSURF_CFG" "$SERVER_JSON"
  success "Windsurf configured → $WINDSURF_CFG"
  INSTALLED+=("Windsurf")
else
  SKIPPED+=("Windsurf (not detected)")
fi

# Gemini CLI / Antigravity (Google)
if command_exists gemini || [[ -d "$(dirname "$GEMINI_CFG")" ]]; then
  inject_mcp_config "$GEMINI_CFG" "$SERVER_JSON"
  success "Gemini Code (Antigravity) configured → $GEMINI_CFG"
  INSTALLED+=("Gemini Code")
else
  SKIPPED+=("Gemini Code / Antigravity (not detected)")
fi

# Zed
if command_exists zed || [[ -f "$ZED_CFG" ]]; then
  info "Configuring Zed…"
  # Zed uses a different schema: context_servers not mcpServers
  mkdir -p "$(dirname "$ZED_CFG")"
  if [[ ! -f "$ZED_CFG" ]]; then echo "{}" > "$ZED_CFG"; fi

  if command_exists python3; then
    python3 - "$ZED_CFG" "$DIST_JS" <<'PYEOF'
import sys, json
path, dist = sys.argv[1], sys.argv[2]
with open(path) as f:
    cfg = json.load(f)
if "context_servers" not in cfg:
    cfg["context_servers"] = {}
cfg["context_servers"]["figma-mcp-free"] = {
    "command": {"path": "node", "args": [dist]}
}
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PYEOF
  fi
  success "Zed configured → $ZED_CFG"
  INSTALLED+=("Zed")
else
  SKIPPED+=("Zed (not detected)")
fi

# ── install Figma plugin instructions ─────────────────────────────────────
header "Figma Plugin"
echo -e "  Install the plugin manually in Figma:"
echo -e "  1. Open Figma → ${BOLD}Plugins → Development → Import plugin from manifest${RESET}"
echo -e "  2. Select: ${CYAN}$SCRIPT_DIR/plugin/manifest.json${RESET}"
echo -e "  3. Run the ${BOLD}Figma MCP Free${RESET} plugin before using any AI tool"

# ── summary ────────────────────────────────────────────────────────────────
header "Summary"

if [[ ${#INSTALLED[@]} -gt 0 ]]; then
  echo -e "${GREEN}Configured:${RESET}"
  for t in "${INSTALLED[@]}"; do echo "  • $t"; done
fi

if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  echo -e "\n${YELLOW}Skipped (not installed):${RESET}"
  for t in "${SKIPPED[@]}"; do echo "  • $t"; done
  echo -e "  Run ${CYAN}./install.sh${RESET} again after installing any of these tools."
fi

echo ""
success "Done! Restart your AI tool to pick up the new MCP server."
echo -e "  Docs: ${CYAN}https://github.com/slashdoodleart/figma-mcp-free${RESET}"
