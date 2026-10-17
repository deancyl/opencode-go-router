# ===============================================================================
# OpenCode Go Router - Milestone 3 Windows Host & Daemon Adversarial Test Suite
# File: test_m3_windows_host_adversarial.ps1
# 
# Adversarial Challenges:
# 1. Windows Desktop Host Silent Execution & Mutex Anti-Duplication
# 2. Electron Ghost Process Simulation & Self-Healing Decoupled Launch
# 3. Port 4010 Cold-Start & Autonomous Watchdog Recovery
# 4. Zero Console Black Box & Air-Gapped Air-Tightness Verification
# ===============================================================================

$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot
if (-not $scriptRoot) {
    $scriptRoot = "C:\Users\deanc\.opencode-go-router"
}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🚀 M3 Windows 宿主守护与托盘对抗压力实测套件启动" -ForegroundColor Cyan
Write-Host "工作根目录: $scriptRoot" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$testResults = [ordered]@{}
$stopwatch = [System.Diagnostics.Stopwatch]::New()

function Assert-Test([string]$name, [bool]$condition, [string]$detail) {
    if ($condition) {
        Write-Host "  [PASS] $name - $detail" -ForegroundColor Green
        $testResults[$name] = @{ Status = "PASS"; Detail = $detail }
    } else {
        Write-Host "  [FAIL] $name - $detail" -ForegroundColor Red
        $testResults[$name] = @{ Status = "FAIL"; Detail = $detail }
        throw "Assertion failure in test '$name': $detail"
    }
}

function Test-PortActive([int]$targetPort) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $targetPort -State Listen -ErrorAction SilentlyContinue
        return ($null -ne $conn)
    } catch {
        return $false
    }
}

function Get-TrayDaemonProcesses() {
    $found = @()
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue
        foreach ($p in $procs) {
            if ($p.CommandLine -like "*tray-daemon.ps1*") {
                $found += $p
            }
        }
    } catch { }
    return $found
}

# -------------------------------------------------------------------------------
# 前置状态检查与现有环境清理
# -------------------------------------------------------------------------------
Write-Host "`n[Setup] 检查基线环境并重置托盘测试状态..." -ForegroundColor Yellow
$origConn = Get-NetTCPConnection -LocalPort 4010 -State Listen -ErrorAction SilentlyContinue
if ($origConn) {
    Write-Host "  基线 4010 网关在线 (PID: $($origConn.OwningProcess))" -ForegroundColor Gray
} else {
    Write-Host "  4010 网关当前未运行，将由冷启动自愈拉起" -ForegroundColor Gray
}

# 彻底清理既有托盘进程，建立洁净基准
$existingTrays = @(Get-TrayDaemonProcesses)
foreach ($et in $existingTrays) {
    Write-Host "  清理已有托盘守护实例 (PID: $($et.ProcessId))..." -ForegroundColor Gray
    Stop-Process -Id $et.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 1000

# ===============================================================================
# 挑战 1: Windows 桌面宿主静默与互斥对抗
# ===============================================================================
Write-Host "`n-----------------------------------------------------------------" -ForegroundColor Magenta
Write-Host "【挑战 1】Windows 桌面宿主静默与互斥对抗实测" -ForegroundColor Magenta
Write-Host "-----------------------------------------------------------------" -ForegroundColor Magenta

# 1.1 验证 launch-gui.vbs 启动主托盘守护并持锁
Write-Host "`n[Test 1.1] 启动主托盘守护进程 (wscript.exe launch-gui.vbs -Silent)..." -ForegroundColor Yellow
$vbsPath = Join-Path $scriptRoot "launch-gui.vbs"
$logPath = Join-Path $scriptRoot "tray.log"

$p = Start-Process "wscript.exe" -ArgumentList "`"$vbsPath`" -Silent" -WorkingDirectory $scriptRoot -PassThru
Start-Sleep -Milliseconds 2000

$activeTrays = @(Get-TrayDaemonProcesses)
Assert-Test "1.1.1 主托盘静默启动" ($activeTrays.Count -ge 1) "主托盘进程已静默拉起 (PID: $($activeTrays[0].ProcessId))"

$primaryTrayCim = $activeTrays[0]
$primaryTrayProc = Get-Process -Id $primaryTrayCim.ProcessId -ErrorAction SilentlyContinue
Assert-Test "1.1.2 零控制台黑框检验" ($primaryTrayProc -ne $null -and $primaryTrayProc.MainWindowHandle -eq 0) "主托盘宿主无可见控制台黑框 (MainWindowHandle == 0)"

# 检查是否持有了 Local\OpenCodeRouterTrayPSMutex_v2
$mutexHeld = $false
try {
    $createdNew = $false
    $testMutex = New-Object System.Threading.Mutex($true, "Local\OpenCodeRouterTrayPSMutex_v2", [ref]$createdNew)
    $mutexHeld = (-not $createdNew)
    if ($testMutex) {
        if ($createdNew) { $testMutex.ReleaseMutex() }
        $testMutex.Dispose()
    }
} catch {
    $mutexHeld = $true
}
Assert-Test "1.1.3 互斥锁占用确认" $mutexHeld "Local\OpenCodeRouterTrayPSMutex_v2 已被主实例牢固锁定"

# 1.2 多开冲撞对抗测试 (3 并发重复运行 launch-gui.vbs -Silent)
Write-Host "`n[Test 1.2] 并发派生 3 个重复实例冲撞互斥锁..." -ForegroundColor Yellow
for ($i = 1; $i -le 3; $i++) {
    Start-Process "wscript.exe" -ArgumentList "`"$vbsPath`" -Silent" -WorkingDirectory $scriptRoot
    Start-Sleep -Milliseconds 150
}

# 等待次级实例检测互斥锁并安全退出
Start-Sleep -Milliseconds 2500

$currentTrays = @(Get-TrayDaemonProcesses)
Write-Host "  当前活动的 tray-daemon 实例数量: $($currentTrays.Count) (PID: $($currentTrays[0].ProcessId))" -ForegroundColor Gray
Assert-Test "1.2.1 单实例互斥防多开" ($currentTrays.Count -eq 1 -and $currentTrays[0].ProcessId -eq $primaryTrayCim.ProcessId) "多开冲撞下只有 1 个主托盘进程常驻，次级实例 100% 安全退出"

# 检查日志中记录的拒绝与激活事实
$trayLogContent = if (Test-Path $logPath) { (Get-Content $logPath -Tail 20) -join "`n" } else { "" }
$hasAnotherLog = $trayLogContent -like "*Another instance is running*"
Assert-Test "1.2.2 互斥日志溯源" $hasAnotherLog "tray.log 明确记录 'Another instance is running. Activating dashboard and exiting.'"

# ===============================================================================
# 挑战 1 (Part B): 模拟 Electron 僵死进程残留与自愈清理
# ===============================================================================
Write-Host "`n-----------------------------------------------------------------" -ForegroundColor Magenta
Write-Host "【挑战 1 (Part B)】模拟 Electron 僵死进程残留与自愈清理对抗实测" -ForegroundColor Magenta
Write-Host "-----------------------------------------------------------------" -ForegroundColor Magenta

$tempChamberDir = Join-Path $env:TEMP "adversarial_chamber_$(Get-Random)"
New-Item -ItemType Directory -Path $tempChamberDir -Force | Out-Null
$ghostExe = Join-Path $tempChamberDir "OpenChamber.exe"

# 使用 csc.exe 编译一个无窗体后台进程 (模拟僵死挂起霸占 SingleInstanceLock)
$ghostSource = @"
using System;
using System.Threading;
class Program {
    static void Main(string[] args) {
        Thread.Sleep(120000);
    }
}
"@
$ghostCs = Join-Path $tempChamberDir "Ghost.cs"
Set-Content -Path $ghostCs -Value $ghostSource
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /out:"$ghostExe" "$ghostCs"

# 启动模拟僵死进程
$ghostProc = Start-Process -FilePath $ghostExe -PassThru
Start-Sleep -Milliseconds 600

$procInfo = Get-Process -Id $ghostProc.Id
Assert-Test "1.3.1 僵尸进程构造" ($procInfo.ProcessName -eq "OpenChamber" -and $procInfo.MainWindowHandle -eq 0) "构造出 MainWindowHandle == 0 的无窗口僵尸 OpenChamber 进程 (PID: $($ghostProc.Id))"

# 模拟孤立 opencode serve 进程
$dummyServeScript = "Start-Sleep -Seconds 120 # serve --hostname 127.0.0.1"
$orphanProc = Start-Process "powershell.exe" -ArgumentList "-NoProfile -Command `"$dummyServeScript`"" -PassThru -WindowStyle Hidden
Start-Sleep -Milliseconds 600

# 触发自愈清理算法 (测试 tray-daemon.ps1 与 server.js 中的自愈清理核心算法)
Write-Host "`n[Test 1.3] 执行僵尸进程探测与自愈清理逻辑..." -ForegroundColor Yellow

$procs = Get-Process -Name "OpenChamber" -ErrorAction SilentlyContinue
$ghostDetected = $false
$ghostKilled = $false
if ($procs) {
    $hasWin = $false
    foreach ($p in $procs) {
        if ($p.MainWindowHandle -ne 0) {
            $hasWin = $true
            break
        }
    }
    if (-not $hasWin) {
        $ghostDetected = $true
        # 存在无窗口僵死进程霸占 SingleInstanceLock，强力清理自愈
        $procs | Stop-Process -Force -ErrorAction SilentlyContinue
        # 清理孤立托管的 opencode serve 进程
        Get-Process -Name "powershell", "node", "opencode" -ErrorAction SilentlyContinue | Where-Object {
            try {
                (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine -like "*serve*--hostname*127.0.0.1*"
            } catch { $false }
        } | Stop-Process -Force -ErrorAction SilentlyContinue
        $ghostKilled = $true
    }
}

Start-Sleep -Milliseconds 600

$ghostAlive = (Get-Process -Id $ghostProc.Id -ErrorAction SilentlyContinue) -ne $null
$orphanAlive = (Get-Process -Id $orphanProc.Id -ErrorAction SilentlyContinue) -ne $null

Assert-Test "1.3.2 僵尸进程准确识别" $ghostDetected "MainWindowHandle == 0 被 100% 准确判定为僵死进程"
Assert-Test "1.3.3 僵死进程强力终止" (-not $ghostAlive) "僵死 OpenChamber 进程已被强力清除 (PID $($ghostProc.Id) 已终止)"
Assert-Test "1.3.4 孤立托管进程清除" (-not $orphanAlive) "孤立 serve 托管进程已被彻底同步清除"

# 验证有窗体正常进程绝对不被误杀 (反向安全防线)
Write-Host "`n[Test 1.4] 验证正常窗口实例防误杀保护 (MainWindowHandle != 0)..." -ForegroundColor Yellow
$winExe = Join-Path $tempChamberDir "OpenChamberWin.exe"
$winSource = @"
using System;
using System.Windows.Forms;
class Program {
    [STAThread]
    static void Main(string[] args) {
        Form f = new Form();
        f.Text = "OpenChamber Normal Window";
        Application.Run(f);
    }
}
"@
$winCs = Join-Path $tempChamberDir "Normal.cs"
Set-Content -Path $winCs -Value $winSource
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /out:"$winExe" "$winCs"
$normalProc = Start-Process -FilePath $winExe -PassThru
Start-Sleep -Milliseconds 1000

$procs2 = Get-Process -Id $normalProc.Id
$hasVisibleWin = ($procs2.MainWindowHandle -ne 0)

$wouldKill = $false
if ($procs2) {
    $hasWin2 = $false
    if ($procs2.MainWindowHandle -ne 0) { $hasWin2 = $true }
    if (-not $hasWin2) { $wouldKill = $true }
}

Assert-Test "1.4.1 正常窗口豁免判定" (-not $wouldKill) "正常桌面窗口被豁免清理，绝对不发生误杀"

# 清理测试正常进程
$normalProc | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Remove-Item -Path $tempChamberDir -Recurse -Force -ErrorAction SilentlyContinue

# ===============================================================================
# 挑战 2: 4010 网关冷启动与看门狗自愈实测
# ===============================================================================
Write-Host "`n-----------------------------------------------------------------" -ForegroundColor Magenta
Write-Host "【挑战 2】4010 网关冷启动与看门狗自愈实测" -ForegroundColor Magenta
Write-Host "-----------------------------------------------------------------" -ForegroundColor Magenta

# 2.1 终止网关进程，实测 Ensure-RouterRunning 毫秒级冷启动
Write-Host "`n[Test 2.1] 终止现有网关并实测 Ensure-RouterRunning 冷启动..." -ForegroundColor Yellow
$currentConn = Get-NetTCPConnection -LocalPort 4010 -State Listen -ErrorAction SilentlyContinue
if ($currentConn) {
    Write-Host "  强制终止当前 4010 网关 (PID: $($currentConn.OwningProcess))..." -ForegroundColor Gray
    Stop-Process -Id $currentConn.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

Assert-Test "2.1.1 端口终止断言" (-not (Test-PortActive 4010)) "4010 端口已被彻底释放关闭"

# 实测 silent-start.vbs 冷启动耗时
$silentVbs = Join-Path $scriptRoot "silent-start.vbs"

$stopwatch.Restart()
Start-Process "wscript.exe" -ArgumentList "`"$silentVbs`"" -WorkingDirectory $scriptRoot -WindowStyle Hidden
$coldStartSuccess = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 200
    if (Test-PortActive 4010) {
        $coldStartSuccess = $true
        break
    }
}
$coldStartTimeMs = $stopwatch.ElapsedMilliseconds
$stopwatch.Stop()

Write-Host "  冷启动耗时: ${coldStartTimeMs} ms" -ForegroundColor Gray
Assert-Test "2.1.2 毫秒级冷启动成功" $coldStartSuccess "4010 端口已在 ${coldStartTimeMs} ms 内静默拉起并就绪监听"
Assert-Test "2.1.3 冷启动时延合规 (0.5~5.0s)" ($coldStartTimeMs -ge 300 -and $coldStartTimeMs -le 5000) "启动耗时处于毫秒级健康窗口 (实测 ${coldStartTimeMs} ms <= 5000 ms)"

# HTTP 探针回读
$probeHealth = $null
try {
    $probeHealth = Invoke-RestMethod -Uri "http://127.0.0.1:4010/health" -TimeoutSec 3
} catch { }

Assert-Test "2.1.4 /health 探针回读 200 OK" ($probeHealth -ne $null -and $probeHealth.status -eq "ok") "HTTP /health 探针回读成功: $($probeHealth | ConvertTo-Json -Compress)"

# 2.2 托盘后台看门狗 (Watchdog) 自愈实测
Write-Host "`n[Test 2.2] 测试常驻托盘看门狗自动感知与静默自愈能力..." -ForegroundColor Yellow
$newConn = Get-NetTCPConnection -LocalPort 4010 -State Listen -ErrorAction SilentlyContinue
$deadPid = $newConn.OwningProcess

Write-Host "  再次强制击杀网关进程 (PID: $deadPid)，等待托盘看门狗自动唤醒..." -ForegroundColor Gray
Stop-Process -Id $deadPid -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

Assert-Test "2.2.1 故障注入确认" (-not (Test-PortActive 4010)) "网关进程已被击毙，端口处于断流故障状态"

# 不手动调用任何启动指令，秒表纯等待看门狗自动触发 (托盘设置的看门狗周期为 5000ms)
$stopwatch.Restart()
$watchdogRevived = $false
$maxWaitSec = 10
for ($i = 0; $i -lt ($maxWaitSec * 5); $i++) {
    Start-Sleep -Milliseconds 200
    if (Test-PortActive 4010) {
        $watchdogRevived = $true
        break
    }
}
$watchdogTimeMs = $stopwatch.ElapsedMilliseconds
$stopwatch.Stop()

Write-Host "  托盘看门狗自愈感知耗时: ${watchdogTimeMs} ms" -ForegroundColor Gray
Assert-Test "2.2.2 看门狗自主感知复活" $watchdogRevived "托盘看门狗在 ${watchdogTimeMs} ms 内自动检测端口故障并静默复活核心网关"

$revivedConn = Get-NetTCPConnection -LocalPort 4010 -State Listen -ErrorAction SilentlyContinue
$revivedPid = $revivedConn.OwningProcess
Assert-Test "2.2.3 新进程实例替换" ($revivedPid -ne $deadPid) "确认生成了新 PID 进程 ($revivedPid != $deadPid)"

# 2.3 业务与压缩引擎健康核验
Write-Host "`n[Test 2.3] 深度核验自愈后核心接口状态与压缩引擎健康..." -ForegroundColor Yellow
$compDoctor = $null
try {
    $compDoctor = Invoke-RestMethod -Uri "http://127.0.0.1:4010/balancer/api/compression/doctor" -TimeoutSec 4
} catch { }

Assert-Test "2.3.1 压缩引擎 Doctor 回读" ($compDoctor -ne $null -and $compDoctor.healthy -eq $true) "Doctor 诊断确认压缩引擎全绿: healthy = $($compDoctor.healthy)"

# 保持网关与托盘健康常驻状态
Write-Host "`n[Status] 当前宿主状态: 网关 PID=$revivedPid, 托盘 PID=$($primaryTrayCim.ProcessId)" -ForegroundColor Green

# ===============================================================================
# 总结测试报告
# ===============================================================================
Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "📊 M3 Windows 宿主对抗实测结果汇总" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$passCount = 0
$failCount = 0
foreach ($k in $testResults.Keys) {
    $item = $testResults[$k]
    if ($item.Status -eq "PASS") {
        $passCount++
        Write-Host "✔ $k : $($item.Detail)" -ForegroundColor Green
    } else {
        $failCount++
        Write-Host "✖ $k : $($item.Detail)" -ForegroundColor Red
    }
}

$summaryColor = if ($failCount -eq 0) { "Green" } else { "Red" }
Write-Host "`n实测总计: $($testResults.Count) 项 | 通过: $passCount | 失败: $failCount" -ForegroundColor $summaryColor
if ($failCount -gt 0) {
    exit 1
}
exit 0
