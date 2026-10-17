@echo off
REM ============================================================================
REM GitHub Stars Manager — Cloudflare Worker 向量搜索一键部署启动器 (Windows CMD)
REM ============================================================================
pushd "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] 未检测到 Node.js 环境，请先安装 Node.js (>= 18.0.0)。
    echo [ERROR] Node.js is required (>= 18.0.0). Please install Node.js first.
    pause
    popd
    exit /b 1
)

node deploy.mjs %*
popd
