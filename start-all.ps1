# OpenCode Go + OpenChamber + Oh My OpenAgent 一键启动脚本 (加固版: 路径空格/特殊字符/竞态防御)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " 🚀 正在启动 OpenCode Go 双账号智能网关与 OpenChamber 栈... " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$routerDir = if ($PSScriptRoot) { $PSScriptRoot } else { Join-Path $env:USERPROFILE ".opencode-go-router" }
$serverJs = Join-Path $routerDir "server.js"
$silentVbs = Join-Path $routerDir "silent-start.vbs"
$trayVbs = Join-Path $routerDir "start-tray.vbs"
$trayExe = Join-Path $routerDir "OpenCodeRouterTray.exe"

# 1. 检查并启动 opencode-go-router (端口 4010)
Write-Host "`n[1/3] 检查并启动 opencode-go-router 智能路由 (端口: 4010)..." -ForegroundColor Yellow
$routerConn = Get-NetTCPConnection -LocalPort 4010 -State Listen -ErrorAction SilentlyContinue
$alreadyRunning = $false

if ($routerConn) {
    $activePid = @($routerConn | Select-Object -ExpandProperty OwningProcess -Unique)[0]
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $activePid" -ErrorAction SilentlyContinue
    $cmdLine = if ($cim) { $cim.CommandLine } else { "" }
    if ($cmdLine -like "*server.js*" -or $cmdLine -like "*opencode-go-router*" -or $cim.Name -eq "OpenCodeRouterTray.exe") {
        Write-Host "   [OK]   opencode-go-router 已在稳健运行中 (PID: $activePid, 端口: 4010)" -ForegroundColor Green
        $alreadyRunning = $true
    } else {
        Write-Host "   [WARN] 端口 4010 已被外部进程占用 (PID: $activePid, 程序: '$($cim.Name)'), 请注意端口冲突！" -ForegroundColor Yellow
        $alreadyRunning = $true
    }
}

if (-not $alreadyRunning) {
    Write-Host "   正在静默拉起后台服务引擎..." -ForegroundColor Gray
    if (Test-Path -LiteralPath $trayExe) {
        Start-Process -FilePath $trayExe -WorkingDirectory $routerDir
    } elseif (Test-Path -LiteralPath $trayVbs) {
        Start-Process "wscript.exe" -ArgumentList "`"$trayVbs`"" -WorkingDirectory $routerDir -WindowStyle Hidden
    } elseif (Test-Path -LiteralPath $silentVbs) {
        Start-Process "wscript.exe" -ArgumentList "`"$silentVbs`"" -WorkingDirectory $routerDir -WindowStyle Hidden
    } elseif (Test-Path -LiteralPath $serverJs) {
        $nodeExe = "node.exe"
        if (Test-Path -LiteralPath "C:\Program Files\nodejs\node.exe") { $nodeExe = "C:\Program Files\nodejs\node.exe" }
        Start-Process -FilePath $nodeExe -ArgumentList "`"$serverJs`"" -WorkingDirectory $routerDir -WindowStyle Hidden
    }

    # 等待端口监听就绪 (最多等待 6 秒，每 200ms 探测一次)
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 200
        $check = Get-NetTCPConnection -LocalPort 4010 -State Listen -ErrorAction SilentlyContinue
        if ($check) {
            $newPid = @($check | Select-Object -ExpandProperty OwningProcess -Unique)[0]
            Write-Host "   [OK]   opencode-go-router 启动成功 (PID: $newPid, 端口: 4010)" -ForegroundColor Green
            $ready = $true
            break
        }
    }
    if (-not $ready) {
        Write-Host "   [WARN] opencode-go-router 仍在后台冷启动初始化中，请稍后通过状态脚本验证" -ForegroundColor Yellow
    }
}

# 2. 检查并启动 OpenChamber (端口 3000)
Write-Host "`n[2/3] 检查并启动 OpenChamber 工作台 (端口: 3000)..." -ForegroundColor Yellow
$chamberConn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($chamberConn) {
    $cPid = @($chamberConn | Select-Object -ExpandProperty OwningProcess -Unique)[0]
    Write-Host "   [OK]   OpenChamber 已在运行 (PID: $cPid, 端口: 3000)" -ForegroundColor Green
} else {
    $chamberBin = (Get-Command openchamber.exe -ErrorAction SilentlyContinue).Source
    if (-not $chamberBin) {
        $candidateBun = Join-Path $env:USERPROFILE ".bun\bin\openchamber.exe"
        if (Test-Path -LiteralPath $candidateBun) { $chamberBin = $candidateBun }
    }

    if ($chamberBin -and (Test-Path -LiteralPath $chamberBin)) {
        Write-Host "   正在启动 OpenChamber 后台服务..." -ForegroundColor Gray
        $chamberProc = Start-Process -FilePath $chamberBin -ArgumentList "serve","--port","3000","--foreground" -WorkingDirectory (Split-Path $chamberBin -Parent) -WindowStyle Hidden -PassThru
        
        $cReady = $false
        for ($i = 0; $i -lt 25; $i++) {
            Start-Sleep -Milliseconds 200
            $checkChamber = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
            if ($checkChamber) {
                Write-Host "   [OK]   OpenChamber 启动成功 (PID: $($chamberProc.Id), 端口: 3000)" -ForegroundColor Green
                $cReady = $true
                break
            }
        }
        if (-not $cReady) {
            Write-Host "   [WARN] OpenChamber 仍在启动中..." -ForegroundColor Yellow
        }
    } else {
        Write-Host "   [INFO] 本地未检测到 OpenChamber CLI，可通过安装向导或 npm/bun 一键配置" -ForegroundColor DarkGray
    }
}

# 3. 运行整体健康检查与服务验证
Write-Host "`n[3/3] 正在验证全链路服务状态..." -ForegroundColor Yellow
try {
    $routerHealth = Invoke-RestMethod -Uri "http://127.0.0.1:4010/health" -TimeoutSec 3 -ErrorAction Stop
    Write-Host "   [OK]   智能路由健康在线: $($routerHealth.status) (可用账号: $($routerHealth.healthyAccounts)/$($routerHealth.totalAccounts))" -ForegroundColor Green
} catch {
    Write-Host "   [WARN] 智能路由探测提示: $_" -ForegroundColor Yellow
}

try {
    $chamberHealth = Invoke-RestMethod -Uri "http://127.0.0.1:3000/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
    if ($chamberHealth) {
        $ocStatus = if ($chamberHealth.openCodeRunning) { "已连接 (端口 $($chamberHealth.openCodePort))" } else { "未就绪" }
        Write-Host "   [OK]   OpenChamber 工作台在线: $($chamberHealth.status) (内置 OpenCode v2: $ocStatus)" -ForegroundColor Green
    }
} catch { }

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " 🎉 全部组件已就绪！" -ForegroundColor Green
Write-Host " 🌐 OpenChamber 工作台:     http://127.0.0.1:3000" -ForegroundColor White
Write-Host " 📊 智能路由流量与监控面板:  http://127.0.0.1:4010/balancer/ui" -ForegroundColor White
Write-Host " 🎯 目标能力指令:           可在会话中直接输入 /goal <任务> 或 /boost <任务>" -ForegroundColor White
Write-Host " ⚡ Ultrawork能力:          在提示词中包含 'ultrawork' 或 'ulw'" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
