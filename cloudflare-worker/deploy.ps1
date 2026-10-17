# ==============================================================================
# GitHub Stars Manager — Cloudflare Worker 向量搜索一键部署启动器 (PowerShell)
# ==============================================================================
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $ScriptDir

try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Error "Node.js is required (>= 18.0.0). Please install Node.js first."
        exit 1
    }

    node deploy.mjs @args
} finally {
    Pop-Location
}
