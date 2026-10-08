# tray-runner.ps1: 基于全局互斥体的 Windows 系统托盘与智能守护启动器
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$rootDir = if ($PSScriptRoot) { $PSScriptRoot } else { "$env:USERPROFILE\.opencode-go-router" }
$serverScript = Join-Path $rootDir "server.js"
$icoPath = Join-Path $rootDir "assets\router.ico"
if (-not (Test-Path $icoPath)) {
    $icoPath = "$env:USERPROFILE\.one-api\one-api.ico"
}
$port = 4010

# 1. 确保后台 node 路由器运行
function Ensure-RouterRunning {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) {
        $nodeExe = "C:\Program Files\nodejs\node.exe"
        if (-not (Test-Path $nodeExe)) {
            $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
            if ($nodeCmd) { $nodeExe = $nodeCmd.Source } else { $nodeExe = "node.exe" }
        }
        
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $nodeExe
        $psi.Arguments = "`"$serverScript`""
        $psi.WorkingDirectory = $rootDir
        $psi.CreateNoWindow = $true
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $psi.UseShellExecute = $false
        try {
            [System.Diagnostics.Process]::Start($psi) | Out-Null
        } catch {
            $silentVbs = Join-Path $rootDir "silent-start.vbs"
            if (Test-Path $silentVbs) {
                Start-Process "wscript.exe" -ArgumentList "`"$silentVbs`"" -WindowStyle Hidden
            } else {
                Start-Process -FilePath $nodeExe -ArgumentList "`"$serverScript`"" -WorkingDirectory $rootDir -WindowStyle Hidden
            }
        }
        
        # 等待端口就绪
        for ($i = 0; $i -lt 25; $i++) {
            Start-Sleep -Milliseconds 200
            try {
                $res = Invoke-RestMethod -Uri "http://127.0.0.1:$port/status" -TimeoutSec 1 -ErrorAction Stop
                if ($res.status -eq "online") { break }
            } catch {}
        }
    }
}

# 2. 唤起独立桌面应用窗口
function Open-Dashboard {
    Ensure-RouterRunning
    $edgePaths = @(
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    )
    $edgeExe = $edgePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($edgeExe) {
        Start-Process -FilePath $edgeExe -ArgumentList "--app=http://127.0.0.1:$port/balancer/ui"
    } else {
        Start-Process "http://127.0.0.1:$port/balancer/ui"
    }
}

# 3. 单实例互斥检测 (Single Instance Mutex)
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\OpenCodeRouterTrayMutex", [ref]$createdNew)
if (-not $createdNew) {
    # 已有托盘进程在后台常驻运行，直接唤起前端界面
    Open-Dashboard
    exit 0
}

# 确保后台路由就绪并打开前端面板
Ensure-RouterRunning
Open-Dashboard

# 4. 创建系统托盘图标
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
if (Test-Path $icoPath) {
    $notifyIcon.Icon = New-Object System.Drawing.Icon($icoPath)
} else {
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}
$notifyIcon.Text = "OpenCode 订阅管理中心 (端口: $port)"
$notifyIcon.Visible = $true

# 弹出气泡通知，引导用户发现托盘图标位置
try {
    $notifyIcon.ShowBalloonTip(4000, "OpenCode 订阅管理中心已启动", "已在系统托盘运行！若未看到，请点击任务栏右下角【^】小箭头展开查看，或直接拖拽至任务栏。", [System.Windows.Forms.ToolTipIcon]::Info)
} catch {}

# 5. 创建托盘右键菜单
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$menuOpen = $contextMenu.Items.Add("🚀 打开订阅管理面板")
$menuOpen.Font = New-Object System.Drawing.Font($menuOpen.Font, [System.Drawing.FontStyle]::Bold)
$menuOpen.Add_Click({ Open-Dashboard })

$contextMenu.Items.Add("-") | Out-Null

$menuChamber = $contextMenu.Items.Add("💻 打开 OpenChamber 工作台 (3000)")
$menuChamber.Add_Click({
    Start-Process "http://127.0.0.1:3000"
})

$contextMenu.Items.Add("-") | Out-Null

$menuStatus = $contextMenu.Items.Add("🔍 检查服务状态")
$menuStatus.Add_Click({
    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$port/status" -TimeoutSec 2
        $accCount = $res.accounts.Count
        $onlineCount = ($res.accounts | Where-Object { $_.status -eq "healthy" }).Count
        $notifyIcon.ShowBalloonTip(3000, "OpenCode 路由正常", "端口: $port`n可用账号: $onlineCount / $accCount`n活跃会话: $($res.activeSessions)", [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {
        $notifyIcon.ShowBalloonTip(3000, "服务异常", "无法连接到端口 $($port): $_", [System.Windows.Forms.ToolTipIcon]::Warning)
    }
})

$menuResetCooldown = $contextMenu.Items.Add("⚡ 一键重置限频冷却")
$menuResetCooldown.Add_Click({
    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$port/balancer/api/reset-cooldown" -Method Post -TimeoutSec 2
        $notifyIcon.ShowBalloonTip(2500, "冷却已重置", "$($res.message)", [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {
        $notifyIcon.ShowBalloonTip(2500, "重置失败", "$_", [System.Windows.Forms.ToolTipIcon]::Warning)
    }
})

$menuRestart = $contextMenu.Items.Add("🔄 重启路由服务")
$menuRestart.Add_Click({
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -like "*node*") {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 1
    Ensure-RouterRunning
    $notifyIcon.ShowBalloonTip(2000, "服务已重启", "OpenCode 订阅路由已重新加载完毕！", [System.Windows.Forms.ToolTipIcon]::Info)
})

$menuDoctor = $contextMenu.Items.Add("🩺 一键自检与环境修复")
$menuDoctor.Add_Click({
    $doctorScript = Join-Path $rootDir "doctor-repair.ps1"
    if (Test-Path $doctorScript) {
        Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$doctorScript`"")
    } else {
        Open-Dashboard
    }
})

$contextMenu.Items.Add("-") | Out-Null

$menuExit = $contextMenu.Items.Add("❌ 退出托盘与路由服务")
$menuExit.Add_Click({
    if ($watchdogTimer) {
        $watchdogTimer.Stop()
        $watchdogTimer.Dispose()
    }
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    try { $mutex.ReleaseMutex() } catch {}
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -like "*node*") {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
    [System.Windows.Forms.Application]::Exit()
})

$notifyIcon.ContextMenuStrip = $contextMenu
$notifyIcon.Add_DoubleClick({ Open-Dashboard })
$notifyIcon.Add_Click({
    param($s, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Open-Dashboard
    }
})

# 6. 后台看门狗定时器 (Watchdog: 每 5 秒守护检测 4010 端口，异常时静默复活)
$watchdogTimer = New-Object System.Windows.Forms.Timer
$watchdogTimer.Interval = 5000
$watchdogTimer.Add_Tick({
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $conn) {
            Ensure-RouterRunning
        }
    } catch {}
})
$watchdogTimer.Start()

# Windows 消息循环
try {
    [System.Windows.Forms.Application]::Run()
} finally {
    if ($watchdogTimer) {
        $watchdogTimer.Stop()
        $watchdogTimer.Dispose()
    }
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    try { $mutex.ReleaseMutex() } catch {}
}
