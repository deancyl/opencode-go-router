# OpenCode Go + OpenChamber + Oh My OpenAgent 一键启动脚本
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🚀 正在启动 OpenCode Go 双账号智能网关与 OpenChamber 栈... " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$routerDir = if ($PSScriptRoot) { $PSScriptRoot } else { "$env:USERPROFILE\.opencode-go-router" }
$serverJs = Join-Path $routerDir "server.js"
$silentVbs = Join-Path $routerDir "silent-start.vbs"

# 1. 检查并启动 opencode-go-router (端口 4010)
$routerConn = Get-NetTCPConnection -LocalPort 4010 -State Listen -ErrorAction SilentlyContinue
if ($routerConn) {
    Write-Host "[1/3] ✔ opencode-go-router 已在运行 (PID: $($routerConn.OwningProcess[0]), 端口: 4010)" -ForegroundColor Green
} else {
    Write-Host "[1/3] 正在静默启动 opencode-go-router 智能路由 (端口: 4010)..." -ForegroundColor Yellow
    $trayExe = Join-Path $routerDir "OpenCodeRouterTray.exe"
    if (Test-Path $trayExe) {
        Start-Process -FilePath $trayExe
    } elseif (Test-Path $silentVbs) {
        Start-Process "wscript.exe" -ArgumentList "`"$silentVbs`"" -WindowStyle Hidden
    } else {
        Start-Process -FilePath "node.exe" -ArgumentList "`"$serverJs`"" -WorkingDirectory $routerDir -WindowStyle Hidden
    }
    Start-Sleep -Seconds 1
    
    $check = Get-NetTCPConnection -LocalPort 4010 -State Listen -ErrorAction SilentlyContinue
    if ($check) {
        Write-Host "      ✔ opencode-go-router 启动成功 (PID: $($check.OwningProcess[0]))" -ForegroundColor Green
    } else {
        Write-Host "      ⚠ opencode-go-router 启动中，等待就绪..." -ForegroundColor Yellow
    }
}

# 2. 检查并启动 OpenChamber (端口 3000)
Write-Host "[2/3] 正在检查 OpenChamber 运行状态..." -ForegroundColor Yellow
$chamberConn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($chamberConn) {
    Write-Host "      ✔ OpenChamber 已在运行 (PID: $($chamberConn.OwningProcess[0]), 端口: 3000)" -ForegroundColor Green
} else {
    Write-Host "      正在启动 OpenChamber 后台服务 (端口: 3000)..." -ForegroundColor Yellow
    $chamberBin = (Get-Command openchamber.exe -ErrorAction SilentlyContinue).Source
    if (-not $chamberBin) { $chamberBin = "$env:USERPROFILE\.bun\bin\openchamber.exe" }
    if (Test-Path $chamberBin) {
        $chamberProc = Start-Process -FilePath $chamberBin -ArgumentList "serve","--port","3000","--foreground" -WindowStyle Hidden -PassThru
        Start-Sleep -Seconds 3

        $checkChamber = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
        if ($checkChamber) {
            Write-Host "      ✔ OpenChamber 启动成功 (PID: $($chamberProc.Id), 端口: 3000)" -ForegroundColor Green
        } else {
            Write-Host "      ⚠ OpenChamber 正在就绪中..." -ForegroundColor Yellow
        }
    } else {
        Write-Host "      ℹ OpenChamber 未在本地安装，可通过安装向导进行安装" -ForegroundColor DarkGray
    }
}

# 3. 运行整体健康检查
Write-Host "[3/3] 正在验证全链路状态..." -ForegroundColor Yellow
try {
    $routerHealth = Invoke-RestMethod -Uri "http://127.0.0.1:4010/health" -TimeoutSec 3 -ErrorAction Stop
    Write-Host "      ✔ 智能路由健康状态: $($routerHealth.status) (可用账号: $($routerHealth.healthyAccounts)/$($routerHealth.totalAccounts))" -ForegroundColor Green
} catch {
    Write-Host "      ⚠ 智能路由健康检查提醒: $_" -ForegroundColor Yellow
}

try {
    $chamberHealth = Invoke-RestMethod -Uri "http://127.0.0.1:3000/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
    if ($chamberHealth) {
        $ocStatus = if ($chamberHealth.openCodeRunning) { "已连接 (端口 $($chamberHealth.openCodePort))" } else { "未就绪" }
        Write-Host "      ✔ OpenChamber 工作台状态: $($chamberHealth.status) (内置 OpenCode v2: $ocStatus)" -ForegroundColor Green
    }
} catch {}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " 🎉 全部组件已就绪！" -ForegroundColor Green
Write-Host " 🌐 OpenChamber 工作台:    http://127.0.0.1:3000" -ForegroundColor White
Write-Host " 📊 智能路由流量与监控面板: http://127.0.0.1:4010/balancer/ui" -ForegroundColor White
Write-Host " 🎯 目标能力指令:          可在会话中直接输入 /goal <任务> 或 /boost <任务>" -ForegroundColor White
Write-Host " ⚡ Ultrawork能力:         在提示词中包含 'ultrawork' 或 'ulw'" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
