@echo off
REM ============================================================================
REM GitHub Stars Manager — Cloudflare Worker 向量搜索一键部署启动器 (Windows CMD)
REM ============================================================================
pushd "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] 未检测到 Node.js 环境，请先安装 Node.js 18 或更高版本。
    echo [ERROR] Node.js 18 or later is required. Please install Node.js first.
    pause
    popd
    exit /b 1
)

node deploy.mjs %*
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
