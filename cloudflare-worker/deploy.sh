#!/usr/bin/env bash
# ==============================================================================
# GitHub Stars Manager — Cloudflare Worker 向量搜索一键部署启动器 (macOS / Linux)
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
    echo "❌ 未检测到 Node.js 环境，请先安装 Node.js (>= 18.0.0)。"
    echo "❌ Node.js is required (>= 18.0.0). Please install Node.js first."
    exit 1
fi

node deploy.mjs "$@"
