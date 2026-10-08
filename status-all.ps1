# OpenCode Go + OpenChamber 状态查看脚本
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 📋 OpenCode 整体运行环境状态自检 " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. 检查 CLI 和版本
Write-Host "--- 核心组件版本 ---" -ForegroundColor Yellow
$opencodeVer = opencode --version 2>$null
Write-Host " OpenCode CLI:       $opencodeVer" -ForegroundColor White

$chamberVer = openchamber --version 2>$null
Write-Host " OpenChamber:        $chamberVer" -ForegroundColor White

$omoVer = oh-my-openagent --version 2>$null
Write-Host " Oh My OpenAgent:    $omoVer" -ForegroundColor White

# 2. 检查后台端口监听
Write-Host "`n--- 服务进程与端口监听 ---" -ForegroundColor Yellow
$routerConn = Get-NetTCPConnection -LocalPort 4010 -State Listen -ErrorAction SilentlyContinue
if ($routerConn) {
    Write-Host " 智能网关 [4010]:     运行中 (PID: $($routerConn.OwningProcess[0]))" -ForegroundColor Green
} else {
    Write-Host " 智能网关 [4010]:     未运行" -ForegroundColor Red
}

$chamberConn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($chamberConn) {
    Write-Host " OpenChamber [3000]: 运行中 (PID: $($chamberConn.OwningProcess[0]))" -ForegroundColor Green
    try {
        $chHealth = Invoke-RestMethod -Uri "http://127.0.0.1:3000/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($chHealth) {
            $ocInfo = if ($chHealth.openCodeRunning) { "已连接 OpenCode v2 (端口 $($chHealth.openCodePort))" } else { "OpenCode 未就绪" }
            Write-Host "    - 状态: $($chHealth.status), 引擎桥接: $ocInfo" -ForegroundColor White
        }
    } catch {}
} else {
    Write-Host " OpenChamber [3000]: 未运行" -ForegroundColor Red
}

# 3. 检查智能网关账号详细健康度
if ($routerConn) {
    Write-Host "`n--- 双账号均衡与故障转移监控 ---" -ForegroundColor Yellow
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:4010/status" -TimeoutSec 3
        Write-Host " 活跃会话数: $($status.activeSessions)" -ForegroundColor White
        foreach ($acc in $status.accounts) {
            $badge = if ($acc.status -eq 'healthy') { "[健康]" } elseif ($acc.status -eq 'cooling_down') { "[冷却中]" } else { "[未配置/禁用]" }
            $color = if ($acc.status -eq 'healthy') { "Green" } elseif ($acc.status -eq 'cooling_down') { "Yellow" } else { "DarkGray" }
            Write-Host "  $($acc.name) $badge :" -ForegroundColor $color
            Write-Host "    - 状态: $($acc.status), 剩余冷却: $($acc.remainingCooldownSec)s" -ForegroundColor White
            Write-Host "    - 请求数: $($acc.totalRequests), 活跃: $($acc.activeRequests), 429捕获: $($acc.rateLimitCount), 转移: $($acc.failoverCount)" -ForegroundColor White
        }
    } catch {
        Write-Host " 获取路由详情失败: $_" -ForegroundColor DarkGray
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
