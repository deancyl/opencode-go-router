<#
===============================================================================
 OpenCode Router Tray Daemon (PowerShell WinForms Native Host)
 100% 微软官方签名宿主 (powershell.exe) 托管运行，零外部二进制，彻底杜绝杀软启发式误报
===============================================================================
#>
[CmdletBinding()]
param(
    [switch]$Silent
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$rootDir = $PSScriptRoot
if (-not $rootDir -or -not (Test-Path (Join-Path $rootDir "server.js"))) {
    $rootDir = Join-Path $env:USERPROFILE ".opencode-go-router"
}

$port = 4010
$icoPath = Join-Path $rootDir "assets\router.ico"
$logPath = Join-Path $rootDir "tray.log"

function Write-TrayLog([string]$msg) {
    try {
        $timestamp = (Get-Date).ToString("yyyy/MM/dd HH:mm:ss")
        $line = "[$timestamp] [PS-Tray] $msg"
        Add-Content -Path $logPath -Value $line -ErrorAction SilentlyContinue
    } catch { }
}

function Test-PortListening([int]$targetPort) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $targetPort -State Listen -ErrorAction SilentlyContinue
        return ($null -ne $conn)
    } catch {
        return $false
    }
}

function Ensure-RouterRunning {
    try {
        if (Test-PortListening $port) { return }
        $silentVbs = Join-Path $rootDir "silent-start.vbs"
        if (Test-Path $silentVbs) {
            Start-Process "wscript.exe" -ArgumentList "`"$silentVbs`"" -WindowStyle Hidden
        } else {
            $nodeExe = "node.exe"
            if (Test-Path "C:\Program Files\nodejs\node.exe") {
                $nodeExe = "C:\Program Files\nodejs\node.exe"
            } elseif (Test-Path "$env:LOCALAPPDATA\Programs\node\node.exe") {
                $nodeExe = "$env:LOCALAPPDATA\Programs\node\node.exe"
            }
            $serverJs = Join-Path $rootDir "server.js"
            $routerLog = Join-Path $rootDir "router.log"
            
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = "cmd.exe"
            $psi.Arguments = "/c `"`"`"$nodeExe`"`" `"`"$serverJs`"`" >> `"`"$routerLog`"`" 2>&1`""
            $psi.WorkingDirectory = $rootDir
            $psi.CreateNoWindow = $true
            $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
            $psi.UseShellExecute = $false
            [System.Diagnostics.Process]::Start($psi) | Out-Null
        }

        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 200
            if (Test-PortListening $port) { break }
        }
    } catch {
        Write-TrayLog "Ensure-RouterRunning error: $_"
    }
}

function Open-Dashboard([string]$hash = "") {
    Ensure-RouterRunning
    $appExe = Join-Path $rootDir "OpenCodeRouterApp.exe"
    if (Test-Path $appExe) {
        try {
            $argList = if ($hash) { @($hash) } else { @() }
            Start-Process -FilePath $appExe -ArgumentList $argList
            return
        } catch { }
    }
    $url = "http://127.0.0.1:$port/balancer/ui$hash"
    try {
        $localChromium = Join-Path $rootDir "bin\chromium\chrome.exe"
        if (Test-Path $localChromium) {
            Start-Process -FilePath $localChromium -ArgumentList "--app=$url"
            return
        }

        $chromeCandidates = @(
            "C:\Program Files\Google\Chrome\Application\chrome.exe",
            "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
        )
        foreach ($c in $chromeCandidates) {
            if (Test-Path $c) {
                Start-Process -FilePath $c -ArgumentList "--app=$url"
                return
            }
        }

        $edgeCandidates = @(
            "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
        )
        foreach ($e in $edgeCandidates) {
            if (Test-Path $e) {
                Start-Process -FilePath $e -ArgumentList "--app=$url"
                return
            }
        }
    } catch { }
    Start-Process "explorer.exe" -ArgumentList "`"$url`""
}

# 单实例互斥防御 (Mutex)
$mutexName = "Local\OpenCodeRouterTrayPSMutex_v2"
$createdNew = $false
$mutex = $null
try {
    # 检查 C# 托盘主程序是否已占有互斥体
    $csMutexExists = $false
    try {
        $dummy = [System.Threading.Mutex]::OpenExisting("Local\OpenCodeRouterTrayMutex_v2")
        $dummy.Close()
        $csMutexExists = $true
    } catch { }

    if ($csMutexExists) {
        $createdNew = $false
    } else {
        $mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
    }
} catch {
    $createdNew = $true
}

if (-not $createdNew) {
    Write-TrayLog "Another instance is running. Activating dashboard and exiting."
    if (-not $Silent) {
        Open-Dashboard
    }
    exit 0
}

# 确保后台路由器运行
Ensure-RouterRunning

# 如果不是静默启动，唤起独立桌面应用窗口
if (-not $Silent) {
    Open-Dashboard
}

function Launch-OpenChamber {
    try {
        $procs = Get-Process -Name "OpenChamber" -ErrorAction SilentlyContinue
        if ($procs) {
            $hasWin = $false
            foreach ($p in $procs) {
                if ($p.MainWindowHandle -ne 0) {
                    $hasWin = $true
                    break
                }
            }
            if ($hasWin) {
                [Microsoft.VisualBasic.Interaction]::AppActivate("OpenChamber") 2>$null
                if ($notifyIcon) {
                    $notifyIcon.ShowBalloonTip(1500, "OpenChamber 桌面端", "已快速激活置顶至当前前台窗口。", [System.Windows.Forms.ToolTipIcon]::Info)
                }
                return
            } else {
                # 存在无窗口僵死进程霸占 SingleInstanceLock，强力清理自愈
                $procs | Stop-Process -Force -ErrorAction SilentlyContinue
                Get-Process -Name "opencode" -ErrorAction SilentlyContinue | Where-Object {
                    try {
                        (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine -like "*serve*--hostname*127.0.0.1*"
                    } catch { $false }
                } | Stop-Process -Force -ErrorAction SilentlyContinue
                if ($notifyIcon) {
                    $notifyIcon.ShowBalloonTip(2000, "单实例自愈完成", "检测并清理了后台无窗口僵死进程，正在重启 OpenChamber 桌面端...", [System.Windows.Forms.ToolTipIcon]::Info)
                }
                Start-Sleep -Milliseconds 600
            }
        }
    } catch { }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\@openchamberelectron\OpenChamber.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\OpenChamber\OpenChamber.exe"),
        "C:\Program Files\OpenChamber\OpenChamber.exe",
        "C:\Program Files (x86)\OpenChamber\OpenChamber.exe",
        (Join-Path $env:USERPROFILE "Desktop\OpenChamber.lnk")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) {
            Start-Process "explorer.exe" -ArgumentList "`"$c`""
            return
        }
    }
    Open-Dashboard
}

function Check-RouterStatus {
    try {
        Ensure-RouterRunning
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$port/balancer/api/account-quota" -TimeoutSec 4 -ErrorAction Stop
        $model = if ($res.currentModel) { $res.currentModel } else { "opencode-go" }
        $total = if ($res.totalAccounts) { $res.totalAccounts } else { 2 }
        $notifyIcon.ShowBalloonTip(3000, "OpenCode 路由网关状态", "✔ 服务在线 (端口: $port)`n✔ 活跃账号数: $total`n✔ 当前主用模型: $model", [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {
        $notifyIcon.ShowBalloonTip(3000, "OpenCode 路由网关状态", "⚠ 网关状态查询中，请稍候或直接打开控制台查看。", [System.Windows.Forms.ToolTipIcon]::Warning)
    }
}

function Reset-Cooldown {
    try {
        Ensure-RouterRunning
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$port/balancer/api/reset-cooldown" -Method Post -TimeoutSec 3 -ErrorAction Stop
        $notifyIcon.ShowBalloonTip(2000, "限频冷却已重置", "✔ 所有账号的 429 限频锁定已清零，恢复正常轮询！", [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {
        $notifyIcon.ShowBalloonTip(2000, "重置提示", "已发送重置信号至端口 $port", [System.Windows.Forms.ToolTipIcon]::Info)
    }
}

function Restart-RouterService {
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($conn) {
            & taskkill.exe /PID $conn.OwningProcess /T /F 2>$null
            $p = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($p -and $p.ProcessName -like "*node*") {
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            }
        }
        Start-Sleep -Milliseconds 500
        Ensure-RouterRunning
        Update-TrayStatus $true
        $notifyIcon.ShowBalloonTip(2000, "路由服务已重启", "✔ 4010 智能网关已完成平滑重载！", [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {
        $notifyIcon.ShowBalloonTip(2000, "重启失败", $_.Exception.Message, [System.Windows.Forms.ToolTipIcon]::Warning)
    }
}

function Run-DoctorRepair {
    $docScript = Join-Path $rootDir "doctor-repair.ps1"
    if (Test-Path $docScript) {
        Start-Process "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$docScript`""
    } else {
        Open-Dashboard "#doctor"
    }
}

function Bind-DesktopClients {
    [System.Threading.ThreadPool]::QueueUserWorkItem({
        try {
            $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$port/balancer/api/bind-desktop" -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 6
            $notifyIcon.ShowBalloonTip(4000, "OpenCode 智能路由", "✔ 本地网关已成功锁定为 OpenCode 与 OpenChamber 默认配置！", [System.Windows.Forms.ToolTipIcon]::Info)
        } catch {
            $notifyIcon.ShowBalloonTip(4000, "配置失败", $_.Exception.Message, [System.Windows.Forms.ToolTipIcon]::Warning)
        }
    })
}

# --- 创建常驻隐形宿主窗体 (防止消息泵被 GC 回收) ---
$hiddenForm = New-Object System.Windows.Forms.Form
$hiddenForm.Text = "OpenCodeRouterTrayMsgSink"
$hiddenForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$hiddenForm.ShowInTaskbar = $false
$hiddenForm.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$hiddenForm.Size = New-Object System.Drawing.Size(0, 0)
$hiddenForm.Opacity = 0
$hiddenForm.ShowIcon = $false

function Exit-TrayApp {
    try {
        if ($watchdogTimer) {
            $watchdogTimer.Stop()
            $watchdogTimer.Dispose()
        }
        if ($global:notifyIcon) {
            $global:notifyIcon.Visible = $false
            $global:notifyIcon.Dispose()
        }
        if ($global:cachedNormalIcon -and $global:cachedNormalIcon -ne [System.Drawing.SystemIcons]::Application) {
            $global:cachedNormalIcon.Dispose()
        }
        if ($global:cachedGreenIcon -and $global:cachedGreenIcon -ne [System.Drawing.SystemIcons]::Application -and $global:cachedGreenIcon -ne $global:cachedNormalIcon) {
            $global:cachedGreenIcon.Dispose()
        }
        if ($mutex) {
            $mutex.ReleaseMutex()
            $mutex.Dispose()
        }
    } catch { }
    try {
        # 退出托盘时彻底清理 4010 关联的子进程树
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($conn) {
            & taskkill.exe /PID $conn.OwningProcess /T /F 2>$null
        }
    } catch { }
    if ($hiddenForm) {
        $hiddenForm.Close()
    }
    [System.Windows.Forms.Application]::Exit()
    exit 0
}

# --- 初始化 NotifyIcon 与图标缓存 ---
Ensure-RouterRunning

$normalIcoPath = Join-Path $rootDir "assets\router.ico"
$greenIcoPath = Join-Path $rootDir "assets\router_green.ico"
$global:cachedNormalIcon = $null
$global:cachedGreenIcon = $null

if (Test-Path $normalIcoPath) {
    try { $global:cachedNormalIcon = New-Object System.Drawing.Icon($normalIcoPath) } catch { }
}
if (Test-Path $greenIcoPath) {
    try { $global:cachedGreenIcon = New-Object System.Drawing.Icon($greenIcoPath) } catch { }
}
if (-not $global:cachedNormalIcon -and $global:cachedGreenIcon) { $global:cachedNormalIcon = $global:cachedGreenIcon }
if (-not $global:cachedGreenIcon -and $global:cachedNormalIcon) { $global:cachedGreenIcon = $global:cachedNormalIcon }
if (-not $global:cachedNormalIcon) { $global:cachedNormalIcon = [System.Drawing.SystemIcons]::Application }
if (-not $global:cachedGreenIcon) { $global:cachedGreenIcon = [System.Drawing.SystemIcons]::Application }

function Update-TrayStatus([bool]$isOnline) {
    try {
        if ($global:notifyIcon) {
            $targetIcon = if ($isOnline) { $global:cachedGreenIcon } else { $global:cachedNormalIcon }
            if ($global:notifyIcon.Icon -ne $targetIcon) {
                $global:notifyIcon.Icon = $targetIcon
            }
            $statusText = "OpenCode 订阅管理中心 (端口: $port - " + (if ($isOnline) { "在线" } else { "离线" }) + ")"
            if ($statusText.Length -ge 64) { $statusText = $statusText.Substring(0, 63) }
            $global:notifyIcon.Text = $statusText
        }
    } catch { }
}

$global:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon = $global:notifyIcon
$isPortUp = Test-PortListening $port
$global:notifyIcon.Icon = if ($isPortUp) { $global:cachedGreenIcon } else { $global:cachedNormalIcon }
$global:notifyIcon.Text = "OpenCode 订阅管理中心 (端口: $port)"
$global:notifyIcon.Visible = $true

# --- 构建右键菜单 (ContextMenuStrip) ---
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$menuOpen = New-Object System.Windows.Forms.ToolStripMenuItem("🚀 打开订阅管理面板")
$menuOpen.Font = New-Object System.Drawing.Font($menuOpen.Font, [System.Drawing.FontStyle]::Bold)
$menuOpen.add_Click({ Open-Dashboard })
$menu.Items.Add($menuOpen) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$menuChamber = New-Object System.Windows.Forms.ToolStripMenuItem("💻 唤醒 / 启动 OpenChamber 桌面端")
$menuChamber.Font = New-Object System.Drawing.Font($menuChamber.Font, [System.Drawing.FontStyle]::Bold)
$menuChamber.add_Click({ Launch-OpenChamber })
$menu.Items.Add($menuChamber) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$menuStatus = New-Object System.Windows.Forms.ToolStripMenuItem("🔍 检查服务状态")
$menuStatus.add_Click({ Check-RouterStatus })
$menu.Items.Add($menuStatus) | Out-Null

$menuReset = New-Object System.Windows.Forms.ToolStripMenuItem("⚡ 一键重置限频冷却")
$menuReset.add_Click({ Reset-Cooldown })
$menu.Items.Add($menuReset) | Out-Null

$menuRestart = New-Object System.Windows.Forms.ToolStripMenuItem("🔄 重启路由服务")
$menuRestart.add_Click({ Restart-RouterService })
$menu.Items.Add($menuRestart) | Out-Null

$menuDoctor = New-Object System.Windows.Forms.ToolStripMenuItem("🩺 系统环境自检与修复")
$menuDoctor.add_Click({ Run-DoctorRepair })
$menu.Items.Add($menuDoctor) | Out-Null

$menuUpdates = New-Object System.Windows.Forms.ToolStripMenuItem("📦 检查更新与组件版本诊断")
$menuUpdates.add_Click({ Open-Dashboard "#updates" })
$menu.Items.Add($menuUpdates) | Out-Null

$menuBind = New-Object System.Windows.Forms.ToolStripMenuItem("⚡ 一键应用至 OpenCode / OpenChamber")
$menuBind.add_Click({ Bind-DesktopClients })
$menu.Items.Add($menuBind) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$menuExit = New-Object System.Windows.Forms.ToolStripMenuItem("❌ 退出托盘与路由服务")
$menuExit.add_Click({ Exit-TrayApp })
$menu.Items.Add($menuExit) | Out-Null

$global:notifyIcon.ContextMenuStrip = $menu
$global:notifyIcon.add_DoubleClick({ Open-Dashboard })
$global:notifyIcon.add_Click({
    param($s, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Open-Dashboard
    }
})

try {
    $global:notifyIcon.ShowBalloonTip(3000, "OpenCode 订阅管理中心已就绪", "本地 4010 智能网关在后台常驻运行，双击绿色托盘图标可随时唤出管理面板。", [System.Windows.Forms.ToolTipIcon]::Info)
} catch { }

# --- 后台自愈看门狗 (Watchdog) ---
$watchdogTimer = New-Object System.Windows.Forms.Timer
$watchdogTimer.Interval = 5000
$watchdogTimer.add_Tick({
    try {
        $up = Test-PortListening $port
        Update-TrayStatus $up
        if (-not $up) {
            Ensure-RouterRunning
        }
        if ($global:notifyIcon -and -not $global:notifyIcon.Visible) {
            $global:notifyIcon.Visible = $true
        }
    } catch { }
})
$watchdogTimer.Start()

Write-TrayLog "PowerShell native NotifyIcon daemon initialized with hiddenForm."

Write-TrayLog "Entering Application::Run(hiddenForm)..."
try {
    [System.Windows.Forms.Application]::Run($hiddenForm)
} catch {
    Write-TrayLog "Run exception: $_"
}
Write-TrayLog "Application::Run returned!"
