# setup-wizard.ps1: OpenCode 全套体系交互式安装与配置向导 (统一兼容入口)
# 模型族谱与 OMO 架构对齐: 默认支持 glm-5.3、qwen3-coder 等最新旗舰模型 (与 setup-windows.ps1 及 doctor-repair.ps1 严格对齐)
[CmdletBinding()]
param(
    [int[]]$Step,
    [switch]$All,
    [switch]$Silent,
    [switch]$Doctor,
    [switch]$Repair,
    [switch]$Update,
    [switch]$Rollback,
    [string]$RollbackId,
    [switch]$Start,
    [switch]$Stop,
    [switch]$Restart,
    [switch]$Status,
    [switch]$Bind,
    [string]$HostName,
    [int]$Port = 0,
    [string]$Key1,
    [string]$Key2,
    [string]$Password,
    [string]$InstallDir,
    [switch]$NoShortcuts
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$rootDir = if ($InstallDir) { $InstallDir } elseif ($PSScriptRoot) { $PSScriptRoot } else { "$env:USERPROFILE\.opencode-go-router" }
$targetScript = Join-Path $rootDir "setup-windows.ps1"

if (Test-Path $targetScript) {
    & $targetScript @PSBoundParameters
    exit $LASTEXITCODE
} else {
    Write-Host "❌ 未找到 setup-windows.ps1 核心脚本！" -ForegroundColor Red
    exit 1
}
