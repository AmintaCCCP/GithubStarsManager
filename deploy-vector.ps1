# ==============================================================================
# GitHub Stars Manager — 向量搜索一键部署脚本 (PowerShell)
# ==============================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "❌ 未检测到 Node.js，请先安装 Node.js (推荐 v18 或更高版本):" -ForegroundColor Red
    Write-Host "   官方下载: https://nodejs.org/"
    Write-Host ""
    Read-Host "按回车键退出..."
    exit 1
}

node "$ScriptDir/scripts/deploy-vector.mjs" @args
$ExitCode = $LASTEXITCODE

if ($args.Count -eq 0 -and $Host.Name -eq "ConsoleHost") {
    Write-Host ""
    Read-Host "部署向导执行完毕，按回车键退出..."
}

exit $ExitCode
