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

setlocal EnableDelayedExpansion
set "SAFE_ARGS="

:parse_args
if "%~1"=="" goto run_node

if /I "%~1"=="-h" set "SAFE_ARGS=!SAFE_ARGS! -h"
if /I "%~1"=="--help" set "SAFE_ARGS=!SAFE_ARGS! --help"
if /I "%~1"=="-q" set "SAFE_ARGS=!SAFE_ARGS! -q"
if /I "%~1"=="--quick" set "SAFE_ARGS=!SAFE_ARGS! --quick"
if /I "%~1"=="-s" set "SAFE_ARGS=!SAFE_ARGS! -s"
if /I "%~1"=="--status" set "SAFE_ARGS=!SAFE_ARGS! --status"
if /I "%~1"=="--lang=zh" set "SAFE_ARGS=!SAFE_ARGS! --lang=zh"
if /I "%~1"=="--lang=en" set "SAFE_ARGS=!SAFE_ARGS! --lang=en"

shift
goto parse_args

:run_node
node deploy.mjs %SAFE_ARGS%
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & set "FINAL_EXIT_CODE=%EXIT_CODE%"
popd
exit /b %FINAL_EXIT_CODE%
