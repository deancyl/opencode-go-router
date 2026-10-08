# OpenCode Go + OpenChamber 一键停止脚本
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🛑 正在停止 OpenCode Go 智能网关与 OpenChamber 服务... " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. 停止 OpenChamber
Write-Host "[1/2] 正在停止 OpenChamber (端口 3000)..." -ForegroundColor Yellow
try { openchamber stop } catch {}
$chamberConns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($chamberConns) {
    foreach ($conn in $chamberConns) {
        try {
            $p = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($p -and ($p.ProcessName -like "*openchamber*" -or $p.ProcessName -like "*node*" -or $p.ProcessName -like "*bun*")) {
                Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
                Write-Host "      ✔ 终止 OpenChamber 进程 (PID: $($conn.OwningProcess))" -ForegroundColor Green
            }
        } catch {}
    }
} else {
    Write-Host "      ✔ OpenChamber 未在运行" -ForegroundColor Green
}

# 2. 停止 opencode-go-router
Write-Host "[2/2] 正在停止 opencode-go-router (端口 4010)..." -ForegroundColor Yellow
$routerConns = Get-NetTCPConnection -LocalPort 4010 -State Listen -ErrorAction SilentlyContinue
if ($routerConns) {
    foreach ($conn in $routerConns) {
        try {
            $p = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($p -and ($p.ProcessName -like "*node*")) {
                Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
                Write-Host "      ✔ 终止路由进程 (PID: $($conn.OwningProcess))" -ForegroundColor Green
            }
        } catch {}
    }
} else {
    Write-Host "      ✔ opencode-go-router 未在运行" -ForegroundColor Green
}

# 3. 停止托盘守护进程
$trayProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*tray-runner.ps1*" }
if ($trayProcs) {
    foreach ($tp in $trayProcs) {
        try { Stop-Process -Id $tp.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
}

Write-Host "`n所有后台服务已安全停止。" -ForegroundColor Green
