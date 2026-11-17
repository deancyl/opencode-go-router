# OpenCode Go + OpenChamber 一键停止脚本 (加固版: PID 过期复用防御与安全特征校验)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " 🛑 正在停止 OpenCode Go 智能网关与 OpenChamber 服务... " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$rootDir = if ($PSScriptRoot) { $PSScriptRoot } else { Join-Path $env:USERPROFILE ".opencode-go-router" }

function Stop-SafeProcess {
    param(
        [Parameter(Mandatory=$true)][int]$ProcessId,
        [Parameter(Mandatory=$true)][string[]]$Keywords,
        [Parameter(Mandatory=$true)][string]$ServiceName
    )
    if ($ProcessId -le 0 -or $ProcessId -eq $PID) { return $false }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }

    # Query command line & executable path via CIM to prevent killing innocent processes on recycled PIDs
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    $cmdLine = if ($cim -and $cim.CommandLine) { $cim.CommandLine } else { "" }
    $execPath = if ($cim -and $cim.ExecutablePath) { $cim.ExecutablePath } else { "" }
    $procName = $proc.ProcessName

    $isMatch = $false
    foreach ($kw in $Keywords) {
        if (($cmdLine -and $cmdLine -like "*$kw*") -or 
            ($execPath -and $execPath -like "*$kw*") -or 
            ($procName -like "*$kw*")) {
            $isMatch = $true
            break
        }
    }

    if ($isMatch) {
        try {
            # Recursive tree termination via taskkill on Windows
            Start-Process -FilePath "taskkill.exe" -ArgumentList "/F /T /PID $ProcessId" -NoNewWindow -Wait -ErrorAction SilentlyContinue
            Write-Host "   [OK]   已安全终止 $ServiceName 进程 (PID: $ProcessId, 特征已验证)" -ForegroundColor Green
            return $true
        } catch {
            try {
                Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
                Write-Host "   [OK]   已强制终止 $ServiceName 进程 (PID: $ProcessId)" -ForegroundColor Green
                return $true
            } catch {
                Write-Host "   [WARN] 终止 $ServiceName 进程 (PID: $ProcessId) 异常: $_" -ForegroundColor Yellow
                return $false
            }
        }
    } else {
        Write-Host "   [WARN] PID $ProcessId 非 $ServiceName 实例 (命令行特征不符: '$cmdLine')，已跳过以防止误杀！" -ForegroundColor Yellow
        return $false
    }
}

# 1. 停止 OpenChamber (端口 3000)
Write-Host "`n[1/3] 正在检查并停止 OpenChamber (端口 3000)..." -ForegroundColor Yellow
try { & openchamber stop 2>$null } catch {}
$chamberConns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($chamberConns) {
    $chamberPids = @($chamberConns | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($cpid in $chamberPids) {
        Stop-SafeProcess -ProcessId $cpid -Keywords @("openchamber", "bun", "serve", "3000") -ServiceName "OpenChamber" | Out-Null
    }
} else {
    Write-Host "   [INFO] OpenChamber 端口 3000 当前未监听" -ForegroundColor DarkGray
}

# 2. 停止 opencode-go-router (端口 4010)
Write-Host "`n[2/3] 正在检查并停止 opencode-go-router 智能路由 (端口 4010)..." -ForegroundColor Yellow
$routerConns = Get-NetTCPConnection -LocalPort 4010 -State Listen -ErrorAction SilentlyContinue
if ($routerConns) {
    $routerPids = @($routerConns | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($rpid in $routerPids) {
        Stop-SafeProcess -ProcessId $rpid -Keywords @("server.js", "opencode-go-router", "OpenCodeRouter") -ServiceName "opencode-go-router" | Out-Null
    }
} else {
    Write-Host "   [INFO] opencode-go-router 端口 4010 当前未监听" -ForegroundColor DarkGray
}

# 3. 停止托盘守护进程与配套向导客户端
Write-Host "`n[3/3] 正在清理托盘守护程序与客户端..." -ForegroundColor Yellow
$trayProcs = Get-Process -Name "OpenCodeRouterTray" -ErrorAction SilentlyContinue
if ($trayProcs) {
    foreach ($tp in $trayProcs) {
        Stop-SafeProcess -ProcessId $tp.Id -Keywords @("OpenCodeRouterTray") -ServiceName "OpenCodeRouterTray" | Out-Null
    }
}

$wizardProcs = Get-Process -Name "OpenCodeWizard" -ErrorAction SilentlyContinue
if ($wizardProcs) {
    foreach ($wp in $wizardProcs) {
        Stop-SafeProcess -ProcessId $wp.Id -Keywords @("OpenCodeWizard") -ServiceName "OpenCodeWizard" | Out-Null
    }
}

$daemonScripts = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { 
    $_.CommandLine -like "*tray-runner.ps1*" -or $_.CommandLine -like "*tray-daemon.ps1*" 
}
if ($daemonScripts) {
    foreach ($ds in $daemonScripts) {
        Stop-SafeProcess -ProcessId $ds.ProcessId -Keywords @("tray-runner.ps1", "tray-daemon.ps1") -ServiceName "托盘脚本守护" | Out-Null
    }
}

# 4. 安全清理残留 PID 文件 (验证 PID 是否与目标相符再清理)
$pidFiles = @("router.pid", "tray.pid", "chamber.pid")
foreach ($pf in $pidFiles) {
    $fullPath = Join-Path $rootDir $pf
    if (Test-Path -LiteralPath $fullPath) {
        try {
            $savedPid = [int](Get-Content -LiteralPath $fullPath -Raw -ErrorAction SilentlyContinue)
            if ($savedPid -gt 0) {
                Stop-SafeProcess -ProcessId $savedPid -Keywords @("server.js", "opencode-go-router", "OpenCodeRouterTray") -ServiceName "PID基准文件" | Out-Null
            }
            Remove-Item -LiteralPath $fullPath -Force -ErrorAction SilentlyContinue
        } catch { }
    }
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " ✔ 所有目标后台服务已安全停止并完成清理。" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
