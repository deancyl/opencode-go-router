# OpenCode Go + OpenChamber 状态查看脚本 (加固版: 健壮版本探针与 CLI UI 对齐)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$rootDir = if ($PSScriptRoot) { $PSScriptRoot } else { Join-Path $env:USERPROFILE ".opencode-go-router" }
$cfgFile = Join-Path $rootDir "config.json"
$hasLocalConfig = Test-Path -LiteralPath $cfgFile

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " 📋 OpenCode 整体运行环境状态自检 " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

function Get-SafeToolVersion([string]$toolName, [string]$arg = "--version") {
    try {
        $cmd = Get-Command $toolName -ErrorAction SilentlyContinue
        if (-not $cmd) { return $null }
        $out = & $toolName $arg 2>$null
        if ($out) {
            $first = ($out | Select-Object -First 1)
            if ($first) { return $first.ToString().Trim() }
        }
    } catch { }
    return $null
}

# 1. 检查 CLI 和版本
Write-Host "`n--- 核心组件版本 ---" -ForegroundColor Yellow
$opencodeVer = Get-SafeToolVersion "opencode"
if ($opencodeVer) {
    Write-Host "   [OK]   OpenCode CLI:       $opencodeVer" -ForegroundColor Green
} else {
    Write-Host "   [INFO] OpenCode CLI:       未安装 / 未加入环境变量" -ForegroundColor DarkGray
}

$chamberVer = Get-SafeToolVersion "openchamber"
if ($chamberVer) {
    Write-Host "   [OK]   OpenChamber:        $chamberVer" -ForegroundColor Green
} else {
    Write-Host "   [INFO] OpenChamber:        未安装 / 未加入环境变量" -ForegroundColor DarkGray
}

$omoVer = Get-SafeToolVersion "oh-my-openagent"
if ($omoVer) {
    Write-Host "   [OK]   Oh My OpenAgent:    $omoVer" -ForegroundColor Green
} else {
    Write-Host "   [INFO] Oh My OpenAgent:    未安装 / 未加入环境变量" -ForegroundColor DarkGray
}

# 2. 检查后台端口监听
Write-Host "`n--- 服务进程与端口监听 ---" -ForegroundColor Yellow
$routerConn = Get-NetTCPConnection -LocalPort 4010 -State Listen -ErrorAction SilentlyContinue
if ($routerConn) {
    $rPid = @($routerConn | Select-Object -ExpandProperty OwningProcess -Unique)[0]
    $rCim = Get-CimInstance Win32_Process -Filter "ProcessId = $rPid" -ErrorAction SilentlyContinue
    $rName = if ($rCim) { $rCim.Name } else { "node.exe" }
    Write-Host "   [OK]   智能网关 [4010]:     运行中 (PID: $rPid, 进程: $rName)" -ForegroundColor Green
} else {
    Write-Host "   [ERR]  智能网关 [4010]:     未运行 (服务离线)" -ForegroundColor Red
}

$chamberConn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
$chamberDesktopConn = Get-NetTCPConnection -LocalPort 57123 -State Listen -ErrorAction SilentlyContinue

if ($chamberConn) {
    $cPid = @($chamberConn | Select-Object -ExpandProperty OwningProcess -Unique)[0]
    Write-Host "   [OK]   OpenChamber [3000]:  运行中 (PID: $cPid)" -ForegroundColor Green
    try {
        $chHealth = Invoke-RestMethod -Uri "http://127.0.0.1:3000/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($chHealth) {
            $ocInfo = if ($chHealth.openCodeRunning) { "已桥接 OpenCode v2 (端口 $($chHealth.openCodePort))" } else { "OpenCode 未就绪" }
            Write-Host "          - 状态: $($chHealth.status), 引擎桥接: $ocInfo" -ForegroundColor White
        }
    } catch { }
} elseif ($chamberDesktopConn) {
    $dPid = @($chamberDesktopConn | Select-Object -ExpandProperty OwningProcess -Unique)[0]
    Write-Host "   [OK]   OpenChamber 桌面端 [57123]: 运行中 (PID: $dPid)" -ForegroundColor Green
    try {
        $chHealth = Invoke-RestMethod -Uri "http://127.0.0.1:57123/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($chHealth) {
            $ocInfo = if ($chHealth.openCodeRunning) { "已桥接 OpenCode v2 (端口 $($chHealth.openCodePort))" } else { "OpenCode 未就绪" }
            Write-Host "          - 状态: $($chHealth.status), 引擎桥接: $ocInfo" -ForegroundColor White
        }
    } catch { }
} else {
    Write-Host "   [IDLE] OpenChamber:         未运行 (桌面端/Web端未拉起)" -ForegroundColor Yellow
}

# 3. 检查智能网关账号详细健康度
if ($routerConn) {
    Write-Host "`n--- 双账号均衡与故障转移监控 ---" -ForegroundColor Yellow
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:4010/status" -TimeoutSec 3
        Write-Host "   活跃会话数: $($status.activeSessions)" -ForegroundColor White
        foreach ($acc in $status.accounts) {
            $badge = if ($acc.status -eq 'healthy') { "[健康]" } elseif ($acc.status -eq 'cooling_down') { "[冷却中]" } else { "[未就绪]" }
            $color = if ($acc.status -eq 'healthy') { "Green" } elseif ($acc.status -eq 'cooling_down') { "Yellow" } else { "DarkGray" }
            Write-Host "   $($acc.name) $badge :" -ForegroundColor $color
            Write-Host "     • 状态: $($acc.status), 剩余冷却: $($acc.remainingCooldownSec)s" -ForegroundColor White
            Write-Host "     • 请求数: $($acc.totalRequests), 活跃: $($acc.activeRequests), 429捕获: $($acc.rateLimitCount), 转移: $($acc.failoverCount)" -ForegroundColor White
        }
    } catch {
        Write-Host "   [WARN] 获取网关详情失败: $_" -ForegroundColor DarkGray
    }
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
