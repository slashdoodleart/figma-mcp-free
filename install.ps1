# Figma MCP Free — Windows installer
# Supports: Claude Desktop, Claude Code, Cursor, VS Code, Windsurf,
#           Gemini CLI (Antigravity), Zed
#
# Run from an elevated or normal PowerShell prompt:
#   .\install.ps1

$ErrorActionPreference = "Stop"

# ── helpers ────────────────────────────────────────────────────────────────
function Info    { param($msg) Write-Host "  ▸ $msg" -ForegroundColor Cyan }
function Success { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Warn    { param($msg) Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Header  { param($msg) Write-Host "`n$msg" -ForegroundColor White }

function Command-Exists {
    param($name)
    $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

# Merge "figma-mcp-free" entry into an MCP config JSON file.
function Inject-McpConfig {
    param(
        [string]$ConfigPath,
        [string]$DistJs
    )

    $dir = Split-Path $ConfigPath
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    if (-not (Test-Path $ConfigPath)) {
        Set-Content -Path $ConfigPath -Value "{}"
    }

    $raw = Get-Content -Raw -Path $ConfigPath
    try { $cfg = $raw | ConvertFrom-Json -AsHashtable }
    catch { $cfg = @{} }

    if (-not $cfg.ContainsKey("mcpServers")) { $cfg["mcpServers"] = @{} }
    $cfg["mcpServers"]["figma-mcp-free"] = @{
        command = "node"
        args    = @($DistJs)
    }

    $cfg | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigPath -Encoding UTF8
}

# ── resolve paths ──────────────────────────────────────────────────────────
$ScriptDir  = $PSScriptRoot
$ServerDir  = Join-Path $ScriptDir "server"
$DistJs     = Join-Path $ServerDir "dist\index.js"
$AppData    = $env:APPDATA
$LocalApp   = $env:LOCALAPPDATA

# ── build server ───────────────────────────────────────────────────────────
Header "Building Figma MCP Free server"

if (-not (Command-Exists "node")) {
    Write-Host "  ✗ Node.js not found. Install Node.js 20+ from https://nodejs.org" -ForegroundColor Red
    exit 1
}

$nodeVer = (node -e "process.stdout.write(process.versions.node)").Split('.')[0]
if ([int]$nodeVer -lt 20) {
    Write-Host "  ✗ Node.js 20+ required (found v$nodeVer)" -ForegroundColor Red
    exit 1
}

Info "Installing server dependencies..."
Push-Location $ServerDir
npm install --silent
Pop-Location

Info "Building server..."
Push-Location $ServerDir
npm run build --silent
Pop-Location

if (-not (Test-Path $DistJs)) {
    Write-Host "  ✗ Build failed — $DistJs not found" -ForegroundColor Red
    exit 1
}
Success "Server built → $DistJs"

# ── config paths ───────────────────────────────────────────────────────────
$ClaudeDesktopCfg   = Join-Path $AppData    "Claude\claude_desktop_config.json"
$ClaudeCodeCfg      = Join-Path $env:USERPROFILE ".claude\mcp.json"
$CursorCfg          = Join-Path $AppData    "Cursor\User\globalStorage\cursor-mcp\mcp.json"
$CursorGlobalCfg    = Join-Path $env:USERPROFILE ".cursor\mcp.json"
$VsCodeCfg          = Join-Path $AppData    "Code\User\mcp.json"
$VsCodeInsidersCfg  = Join-Path $AppData    "Code - Insiders\User\mcp.json"
$WindsurfCfg        = Join-Path $env:USERPROFILE ".codeium\windsurf\mcp_config.json"
$GeminiCfg          = Join-Path $AppData    "Google\GeminiCode\mcp_config.json"
$ZedCfg             = Join-Path $AppData    "Zed\settings.json"

$Installed = @()
$Skipped   = @()

function Try-Configure {
    param([string]$Name, [string]$CfgPath, [bool]$Detected)
    if ($Detected -or (Test-Path (Split-Path $CfgPath))) {
        Info "Configuring $Name..."
        Inject-McpConfig -ConfigPath $CfgPath -DistJs $DistJs
        Success "$Name configured → $CfgPath"
        $script:Installed += $Name
    } else {
        $script:Skipped += "$Name (not detected)"
    }
}

Header "Configuring AI tools"

# Claude Desktop
$claudeDetected = Test-Path (Split-Path $ClaudeDesktopCfg)
Try-Configure "Claude Desktop" $ClaudeDesktopCfg $claudeDetected

# Claude Code
if (Command-Exists "claude") {
    Info "Configuring Claude Code (CLI)..."
    Inject-McpConfig -ConfigPath $ClaudeCodeCfg -DistJs $DistJs
    Success "Claude Code configured → $ClaudeCodeCfg"
    $Installed += "Claude Code"
} else {
    $Skipped += "Claude Code (claude CLI not found)"
}

# Cursor
$cursorDetected = (Test-Path $env:LOCALAPPDATA + "\Programs\cursor") -or (Test-Path $CursorGlobalCfg)
Try-Configure "Cursor" $CursorGlobalCfg $cursorDetected

# VS Code
$vscodeDetected = (Command-Exists "code") -or (Test-Path $VsCodeCfg)
Try-Configure "VS Code" $VsCodeCfg $vscodeDetected

# VS Code Insiders
if ((Command-Exists "code-insiders") -or (Test-Path $VsCodeInsidersCfg)) {
    Info "Configuring VS Code Insiders..."
    Inject-McpConfig -ConfigPath $VsCodeInsidersCfg -DistJs $DistJs
    Success "VS Code Insiders configured → $VsCodeInsidersCfg"
    $Installed += "VS Code Insiders"
}

# Windsurf
$windsurfDetected = (Command-Exists "windsurf") -or (Test-Path (Split-Path $WindsurfCfg))
Try-Configure "Windsurf" $WindsurfCfg $windsurfDetected

# Gemini CLI / Antigravity
$geminiDetected = (Command-Exists "gemini") -or (Test-Path (Split-Path $GeminiCfg))
Try-Configure "Gemini Code (Antigravity)" $GeminiCfg $geminiDetected

# Zed
if ((Command-Exists "zed") -or (Test-Path $ZedCfg)) {
    Info "Configuring Zed..."
    $dir = Split-Path $ZedCfg
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory $dir -Force | Out-Null }
    if (-not (Test-Path $ZedCfg)) { Set-Content $ZedCfg "{}" }

    $raw = Get-Content -Raw $ZedCfg
    try { $cfg = $raw | ConvertFrom-Json -AsHashtable } catch { $cfg = @{} }
    if (-not $cfg.ContainsKey("context_servers")) { $cfg["context_servers"] = @{} }
    $cfg["context_servers"]["figma-mcp-free"] = @{
        command = @{ path = "node"; args = @($DistJs) }
    }
    $cfg | ConvertTo-Json -Depth 10 | Set-Content $ZedCfg -Encoding UTF8
    Success "Zed configured → $ZedCfg"
    $Installed += "Zed"
} else {
    $Skipped += "Zed (not detected)"
}

# ── Figma plugin instructions ──────────────────────────────────────────────
Header "Figma Plugin"
Write-Host "  Install the plugin manually in Figma:"
Write-Host "  1. Open Figma → Plugins → Development → Import plugin from manifest"
Write-Host "  2. Select: $ScriptDir\plugin\manifest.json" -ForegroundColor Cyan
Write-Host "  3. Run the Figma MCP Free plugin before using any AI tool"

# ── summary ────────────────────────────────────────────────────────────────
Header "Summary"

if ($Installed.Count -gt 0) {
    Write-Host "Configured:" -ForegroundColor Green
    $Installed | ForEach-Object { Write-Host "  • $_" }
}

if ($Skipped.Count -gt 0) {
    Write-Host "`nSkipped (not installed):" -ForegroundColor Yellow
    $Skipped | ForEach-Object { Write-Host "  • $_" }
    Write-Host "  Run .\install.ps1 again after installing any of these tools."
}

Write-Host ""
Write-Host "  ✓ Done! Restart your AI tool to pick up the new MCP server." -ForegroundColor Green
Write-Host "  Docs: https://github.com/slashdoodleart/figma-mcp-free" -ForegroundColor Cyan
