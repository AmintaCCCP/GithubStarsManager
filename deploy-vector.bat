@echo off
chcp 65001 >nul
:: ==============================================================================
:: GitHub Stars Manager — 向量搜索一键部署脚本 (Windows)
:: ==============================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo ❌ 未检测到 Node.js，请先安装 Node.js ^(推荐 v18 或更高版本^):
    echo    官方下载: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

node "%~dp0scripts\deploy-vector.mjs" %*
set "EXIT_CODE=%errorlevel%"

if "%~1"=="" (
    echo.
    pause
)

exit /b %EXIT_CODE%
