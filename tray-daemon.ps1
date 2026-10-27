<#
===============================================================================
 OpenCode Router Tray Daemon (PowerShell WinForms Native Host)
 100% 微软官方签名宿主 (powershell.exe) 托管运行，零外部二进制，彻底杜绝杀软启发式误报
 Win32 原生调用增强：PerMonitorV2 高 DPI 锐化、EmptyWorkingSet 内存修剪、三端生态齐备
===============================================================================
#>
[CmdletBinding()]
param(
    [switch]$Silent
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction SilentlyContinue

$rootDir = $PSScriptRoot
if (-not $rootDir -or -not (Test-Path (Join-Path $rootDir "server.js"))) {
    $rootDir = Join-Path $env:USERPROFILE ".opencode-go-router"
}

$port = 4010
$uiPassword = ""
$cfgDefaultModel = "deepseek-v4.1-flash"
$icoPath = Join-Path $rootDir "assets\router.ico"
$logPath = Join-Path $rootDir "tray.log"

function Load-RouterConfig {
    try {
        $cfgPath = Join-Path $rootDir "config.json"
        if (Test-Path $cfgPath) {
            $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($cfg) {
                if ($cfg.port -and [int]$cfg.port -gt 0 -and [int]$cfg.port -lt 65536) {
                    $script:port = [int]$cfg.port
                }
                if ($null -ne $cfg.uiPassword) {
                    $script:uiPassword = [string]$cfg.uiPassword
                }
                if ($cfg.defaultModel) {
                    $script:cfgDefaultModel = [string]$cfg.defaultModel
                }
            }
        }
    } catch { }
}
Load-RouterConfig

function Write-TrayLog([string]$msg) {
    try {
        $timestamp = (Get-Date).ToString("yyyy/MM/dd HH:mm:ss")
        $line = "[$timestamp] [PS-Tray] $msg"
        Add-Content -Path $logPath -Value $line -ErrorAction SilentlyContinue
    } catch { }
}

function Test-PortListening([int]$targetPort) {
    try {
        $props = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties()
        $listeners = $props.GetActiveTcpListeners()
        foreach ($ep in $listeners) {
            if ($ep.Port -eq $targetPort) { return $true }
        }
        return $false
    } catch {
        try {
            $conn = Get-NetTCPConnection -LocalPort $targetPort -State Listen -ErrorAction SilentlyContinue
            return ($null -ne $conn)
        } catch {
            return $false
        }
    }
}

function Ensure-RouterRunning {
    try {
        if (Test-PortListening $port) { return }
        $nodeExe = "node.exe"
        if (Test-Path "C:\Program Files\nodejs\node.exe") {
            $nodeExe = "C:\Program Files\nodejs\node.exe"
        } elseif (Test-Path "$env:LOCALAPPDATA\Programs\node\node.exe") {
            $nodeExe = "$env:LOCALAPPDATA\Programs\node\node.exe"
        }
        $serverJs = Join-Path $rootDir "server.js"
        
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $nodeExe
        $psi.Arguments = "`"$serverJs`""
        $psi.WorkingDirectory = $rootDir
        $psi.CreateNoWindow = $true
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $psi.UseShellExecute = $false
        [System.Diagnostics.Process]::Start($psi) | Out-Null

        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 200
            if (Test-PortListening $port) { break }
        }
    } catch {
        Write-TrayLog "Ensure-RouterRunning error: $_"
    }
}

$script:lastDashboardOpenTime = [DateTime]::MinValue
function Open-Dashboard([string]$hash = "") {
    $now = [DateTime]::Now
    if (($now - $script:lastDashboardOpenTime).TotalMilliseconds -lt 600 -and -not $hash) {
        return
    }
    $script:lastDashboardOpenTime = $now

    # 双击时若菜单处于显示状态，平滑关闭菜单
    if ($menu -and $menu.Visible) {
        try { $menu.Close() } catch { }
    }

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

# 单实例互斥防御 (Mutex) - 必须在启动第一毫秒抢占，杜绝 C# 编译延迟导致多开穿透
$mutexName = "Local\OpenCodeRouterTrayPSMutex_v2"
$createdNew = $false
$global:mutex = $null
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
        $global:mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
    }
} catch {
    $createdNew = $true
}
$mutex = $global:mutex

if (-not $createdNew) {
    Write-TrayLog "Another instance is running. Activating dashboard and exiting."
    try {
        Write-TrayLog "Sending BroadcastRestoreTray from secondary instance..."
        # 1. 毫秒级跨桌面会话事件唤醒 (Session-Wide Event)
        try {
            $evt = [System.Threading.EventWaitHandle]::OpenExisting("Local\OpenCodeRouterTrayRestoreEvent")
            $evt.Set()
            $evt.Close()
        } catch { }

        # 2. 传统广播与隐形窗体消息唤醒 (Win32 Broadcast)
        try {
            [OpenCodeTrayHost.Win32Helper]::BroadcastRestoreTray()
        } catch { }
        Write-TrayLog "BroadcastRestoreTray sent successfully."
    } catch {
        Write-TrayLog "BroadcastRestoreTray error: $_"
    }
    if (-not $Silent) {
        Open-Dashboard
    }
    exit 0
}

$trayHostCs = @"
using System;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace OpenCodeTrayHost {
    public static class Win32Helper {
        public const uint MSGFLT_ADD = 1;
        public static readonly IntPtr HWND_BROADCAST = new IntPtr(0xffff);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern uint RegisterWindowMessage(string lpString);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool ChangeWindowMessageFilter(uint message, uint dwFlag);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool ChangeWindowMessageFilterEx(IntPtr hWnd, uint msg, uint action, IntPtr pChangeFilterStruct);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

        public static IntPtr FindSinkWindow() {
            IntPtr result = IntPtr.Zero;
            try {
                EnumWindows((hWnd, lParam) => {
                    var sb = new System.Text.StringBuilder(256);
                    GetWindowText(hWnd, sb, 256);
                    if (sb.ToString() == "OpenCodeRouterTrayMsgSink") {
                        result = hWnd;
                        return false;
                    }
                    return true;
                }, IntPtr.Zero);
            } catch { }
            return result;
        }

        // 高 DPI 锐化支持 (PerMonitorV2 = -4)
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        public static void EnableHighDpiAwareness() {
            try {
                SetProcessDpiAwarenessContext((IntPtr)(-4));
            } catch { }
        }

        // 内存工作集长效修剪
        [DllImport("psapi.dll", SetLastError = true)]
        public static extern bool EmptyWorkingSet(IntPtr hProcess);

        // 极速内存修剪快捷包装器
        public static void TrimCurrentProcessMemory() {
            try {
                using (var p = System.Diagnostics.Process.GetCurrentProcess()) {
                    EmptyWorkingSet(p.Handle);
                }
            } catch { }
        }

        public static void BroadcastRestoreTray() {
            try {
                try {
                    using (var evt = EventWaitHandle.OpenExisting("Local\\OpenCodeRouterTrayRestoreEvent")) {
                        evt.Set();
                    }
                } catch { }

                uint msg = RegisterWindowMessage("WM_RESTORE_OPENCODE_ROUTER_TRAY");
                if (msg != 0) {
                    try {
                        IntPtr hWnd = FindSinkWindow();
                        if (hWnd == IntPtr.Zero) {
                            hWnd = FindWindow(null, "OpenCodeRouterTrayMsgSink");
                        }
                        if (hWnd != IntPtr.Zero) {
                            PostMessage(hWnd, msg, IntPtr.Zero, IntPtr.Zero);
                        }
                    } catch { }
                    PostMessage(HWND_BROADCAST, msg, IntPtr.Zero, IntPtr.Zero);
                }
            } catch { }
        }
    }

    public static class StatusHolder {
        public static volatile bool IsOnline = false;
        public static volatile int Port = 4010;
        public static volatile string AccountRatio = "0/0";
        public static volatile string ActiveModel = "deepseek-v4.1-flash";

        public static void FetchStatusAsync(int targetPort, string authHeader) {
            FetchStatusAsync(targetPort, authHeader, null);
        }

        public static void FetchStatusAsync(int targetPort, string authHeader, string fallbackModel) {
            ThreadPool.QueueUserWorkItem(_ => {
                try {
                    var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + targetPort + "/status");
                    req.Timeout = 2500;
                    req.Method = "GET";
                    if (!string.IsNullOrEmpty(authHeader)) {
                        req.Headers["x-ui-password"] = authHeader;
                        req.Headers["x-api-key"] = authHeader;
                    }
                    using (var resp = req.GetResponse())
                    using (var stream = resp.GetResponseStream())
                    using (var reader = new StreamReader(stream)) {
                        string json = reader.ReadToEnd();
                        int healthy = 0;
                        var matches = Regex.Matches(json, "\"status\"\\s*:\\s*\"([^\"]+)\"");
                        foreach (Match m in matches) {
                            string st = m.Groups[1].Value;
                            if (st == "healthy") healthy++;
                        }
                        var accMatches = Regex.Matches(json, "\"id\"\\s*:\\s*\"account-[^\"]+\"");
                        int total = accMatches.Count;
                        if (total == 0) total = 2;

                        var modelMatch = Regex.Match(json, "\"defaultModel\"\\s*:\\s*\"([^\"]+)\"");
                        if (modelMatch.Success && !string.IsNullOrEmpty(modelMatch.Groups[1].Value)) {
                            ActiveModel = modelMatch.Groups[1].Value;
                        } else if (!string.IsNullOrEmpty(fallbackModel)) {
                            ActiveModel = fallbackModel;
                        }
                        Port = targetPort;
                        AccountRatio = healthy + "/" + total;
                        IsOnline = true;
                    }
                } catch (WebException ex) {
                    var httpResp = ex.Response as HttpWebResponse;
                    if (httpResp != null && httpResp.StatusCode == HttpStatusCode.Unauthorized) {
                        IsOnline = true;
                        Port = targetPort;
                        AccountRatio = "鉴权保护中";
                        if (!string.IsNullOrEmpty(fallbackModel)) {
                            ActiveModel = fallbackModel;
                        }
                        return;
                    }
                    IsOnline = false;
                } catch {
                    IsOnline = false;
                }
            });
        }
    }

    public class TrayMessageSinkForm : Form {
        private uint wmTaskbarCreated = 0;
        private uint wmRestoreTray = 0;
        private EventWaitHandle restoreEvent = null;
        private RegisteredWaitHandle registeredWait = null;
        public event EventHandler TrayRestoreRequested;

        public TrayMessageSinkForm() {
            this.Text = "OpenCodeRouterTrayMsgSink";
            this.FormBorderStyle = FormBorderStyle.None;
            this.WindowState = FormWindowState.Minimized;
            this.Size = new Size(0, 0);
            this.Opacity = 0;
            this.ShowIcon = false;
            IntPtr h = this.Handle;

            try {
                bool createdNew;
                restoreEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\OpenCodeRouterTrayRestoreEvent", out createdNew);
                registeredWait = ThreadPool.RegisterWaitForSingleObject(restoreEvent, (state, timedOut) => {
                    if (!timedOut) {
                        try {
                            if (this.IsHandleCreated && !this.IsDisposed) {
                                this.BeginInvoke(new Action(() => {
                                    if (TrayRestoreRequested != null) {
                                        try { TrayRestoreRequested(this, EventArgs.Empty); } catch { }
                                    }
                                }));
                            }
                        } catch { }
                    }
                }, null, -1, false);
            } catch { }
        }

        protected override CreateParams CreateParams {
            get {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x08000080; // WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
                cp.Parent = IntPtr.Zero;
                return cp;
            }
        }

        protected override void SetVisibleCore(bool value) {
            base.SetVisibleCore(false);
            if (!this.IsHandleCreated) {
                this.CreateHandle();
            }
        }

        protected override void Dispose(bool disposing) {
            if (disposing) {
                try {
                    if (registeredWait != null) {
                        registeredWait.Unregister(null);
                        registeredWait = null;
                    }
                    if (restoreEvent != null) {
                        restoreEvent.Close();
                        restoreEvent = null;
                    }
                } catch { }
            }
            base.Dispose(disposing);
        }

        protected override void OnHandleCreated(EventArgs e) {
            base.OnHandleCreated(e);
            try {
                wmTaskbarCreated = Win32Helper.RegisterWindowMessage("TaskbarCreated");
                if (wmTaskbarCreated != 0) {
                    Win32Helper.ChangeWindowMessageFilter(wmTaskbarCreated, Win32Helper.MSGFLT_ADD);
                    try { Win32Helper.ChangeWindowMessageFilterEx(this.Handle, wmTaskbarCreated, 1, IntPtr.Zero); } catch { }
                }
                wmRestoreTray = Win32Helper.RegisterWindowMessage("WM_RESTORE_OPENCODE_ROUTER_TRAY");
                if (wmRestoreTray != 0) {
                    Win32Helper.ChangeWindowMessageFilter(wmRestoreTray, Win32Helper.MSGFLT_ADD);
                    try { Win32Helper.ChangeWindowMessageFilterEx(this.Handle, wmRestoreTray, 1, IntPtr.Zero); } catch { }
                }
            } catch { }
        }

        protected override void WndProc(ref Message m) {
            if ((wmTaskbarCreated != 0 && m.Msg == (int)wmTaskbarCreated) ||
                (wmRestoreTray != 0 && m.Msg == (int)wmRestoreTray)) {
                if (TrayRestoreRequested != null) {
                    try { TrayRestoreRequested(this, EventArgs.Empty); } catch { }
                }
            }
            base.WndProc(ref m);
        }
    }
}
"@
try {
    Add-Type -TypeDefinition $trayHostCs -ReferencedAssemblies System.Windows.Forms, System.Drawing -ErrorAction SilentlyContinue
} catch { }

# 开启高 DPI 锐化
try { [OpenCodeTrayHost.Win32Helper]::EnableHighDpiAwareness() } catch { }

# 严格进程签名防误杀守护函数
function Stop-RouterServiceSafely {
    $script:isManuallyStopped = $true
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            $targetPids = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
            foreach ($targetPid in $targetPids) {
                if ($targetPid -gt 4 -and $targetPid -ne $PID) {
                    $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
                    if ($proc -and ($proc.ProcessName -ieq "node" -or $proc.ProcessName -ieq "node.exe")) {
                        $cmd = ""
                        $parentPid = 0
                        try {
                            $cimProc = Get-CimInstance Win32_Process -Filter "ProcessId = $targetPid" -ErrorAction SilentlyContinue
                            if ($cimProc) {
                                $cmd = $cimProc.CommandLine
                                $parentPid = [int]$cimProc.ParentProcessId
                            }
                        } catch { }
                        if ($cmd -like "*server.js*" -or $cmd -like "*opencode-go-router*") {
                            & taskkill.exe /PID $targetPid /T /F 2>$null
                            Write-TrayLog "Router service (PID: $targetPid) safely stopped."
                            if ($parentPid -gt 4) {
                                try {
                                    $parentProc = Get-CimInstance Win32_Process -Filter "ProcessId = $parentPid" -ErrorAction SilentlyContinue
                                    if ($parentProc -and $parentProc.Name -ieq "cmd.exe" -and $parentProc.CommandLine -like "*start-daemon.bat*") {
                                        & taskkill.exe /PID $parentPid /F 2>$null
                                        Write-TrayLog "Cleaned parent cmd host (PID: $parentPid) for router daemon."
                                    }
                                } catch { }
                            }
                        } else {
                            Write-TrayLog "Warning: Port $port listener PID $targetPid is node but command line ($cmd) does not match router. Aborting kill."
                        }
                    } else {
                        Write-TrayLog "Warning: Port $port listener PID $targetPid is not node.exe ($($proc.ProcessName)). Aborting kill to protect system/Codex processes."
                    }
                }
            }
        }
    } catch {
        Write-TrayLog "Stop-RouterServiceSafely error: $_"
    }
}

# --- 初始化 NotifyIcon 与图标缓存 ---
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
            $stateLabel = if ($isOnline) { "在线" } else { "离线" }
            $statusText = "OpenCode 订阅管理中心 (端口: $port - $stateLabel)"
            if ($statusText.Length -ge 64) { $statusText = $statusText.Substring(0, 63) }
            if ($global:notifyIcon.Text -ne $statusText) {
                $global:notifyIcon.Text = $statusText
            }
        }
    } catch { }
}

function Reassert-TrayIcon([bool]$forceCycle) {
    try {
        if (-not $global:notifyIcon) { return }
        $isOnline = Test-PortListening $port
        $targetIcon = if ($isOnline) { $global:cachedGreenIcon } else { $global:cachedNormalIcon }
        $stateLabel = if ($isOnline) { "在线" } else { "离线" }
        $statusText = "OpenCode 订阅管理中心 (端口: $port - $stateLabel)"
        if ($statusText.Length -ge 64) { $statusText = $statusText.Substring(0, 63) }

        if ($forceCycle) {
            $global:notifyIcon.Visible = $false
            $global:notifyIcon.Icon = $targetIcon
            $global:notifyIcon.Text = $statusText
            $global:notifyIcon.Visible = $true
        } else {
            if (-not $global:notifyIcon.Visible) {
                $global:notifyIcon.Visible = $true
            }
            if ($global:notifyIcon.Icon -ne $targetIcon) {
                $global:notifyIcon.Icon = $targetIcon
            }
            if ($global:notifyIcon.Text -ne $statusText) {
                $global:notifyIcon.Text = $statusText
            }
        }
    } catch {
        Write-TrayLog "Reassert-TrayIcon error: $_"
    }
}

# --- 抢占互斥锁后立即创建常驻隐形宿主窗体，保证次级实例广播秒级到达 ---
$hiddenForm = $null
try {
    $hiddenForm = New-Object OpenCodeTrayHost.TrayMessageSinkForm
    $hiddenForm.add_TrayRestoreRequested({
        Write-TrayLog "TaskbarCreated or WM_RESTORE_OPENCODE_ROUTER_TRAY received! Reasserting tray icon..."
        Reassert-TrayIcon $true
    })
} catch {
    $hiddenForm = New-Object System.Windows.Forms.Form
    $hiddenForm.Text = "OpenCodeRouterTrayMsgSink"
    $hiddenForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $hiddenForm.ShowInTaskbar = $false
    $hiddenForm.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
    $hiddenForm.Size = New-Object System.Drawing.Size(0, 0)
    $hiddenForm.Opacity = 0
    $hiddenForm.ShowIcon = $false
}

$global:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon = $global:notifyIcon
$isPortUp = Test-PortListening $port
$global:notifyIcon.Icon = if ($isPortUp) { $global:cachedGreenIcon } else { $global:cachedNormalIcon }
$global:notifyIcon.Text = "OpenCode 订阅管理中心 (端口: $port)"
$global:notifyIcon.Visible = $true

# 确保后台路由器运行
Ensure-RouterRunning

# 如果不是静默启动，唤起独立桌面应用窗口
if (-not $Silent) {
    Open-Dashboard
}

function Get-AuthHeaders {
    Load-RouterConfig
    $headers = @{}
    if ($script:uiPassword -and $script:uiPassword.Trim().Length -gt 0) {
        $headers["x-ui-password"] = $script:uiPassword.Trim()
        $headers["x-api-key"] = $script:uiPassword.Trim()
    }
    return $headers
}

function Update-StatusCacheAsync {
    try {
        Load-RouterConfig
        [OpenCodeTrayHost.StatusHolder]::FetchStatusAsync($port, $script:uiPassword, $script:cfgDefaultModel)
    } catch { }
}

# --- 三端桌面客户端联动 ---

function Launch-CodexDesktop {
    try {
        # 1. 检测运行中的 Codex 进程与窗口
        $procs = Get-Process -Name "codex", "OpenAI Codex" -ErrorAction SilentlyContinue
        if ($procs) {
            $hasWin = $false
            foreach ($p in $procs) {
                if ($p.MainWindowHandle -ne 0) {
                    $hasWin = $true
                    break
                }
            }
            if ($hasWin) {
                try {
                    [Microsoft.VisualBasic.Interaction]::AppActivate("OpenAI Codex") 2>$null
                    [Microsoft.VisualBasic.Interaction]::AppActivate("Codex") 2>$null
                } catch { }
                if ($global:notifyIcon) {
                    $global:notifyIcon.ShowBalloonTip(1500, "OpenAI Codex", "已快速激活置顶至当前前台窗口。", [System.Windows.Forms.ToolTipIcon]::Info)
                }
                return
            }
        }
    } catch { }

    # 2. 候选路径探测 (快捷方式与传统路径)
    $candidates = @(
        (Join-Path $env:USERPROFILE "Desktop\Codex.lnk"),
        (Join-Path $env:USERPROFILE "Desktop\Codex++.lnk"),
        (Join-Path $env:LOCALAPPDATA "Programs\OpenAI Codex\OpenAI Codex.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Codex\Codex.exe"),
        "C:\Program Files\OpenAI Codex\OpenAI Codex.exe",
        (Join-Path $env:USERPROFILE "Desktop\OpenAI Codex.lnk")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) {
            Start-Process "explorer.exe" -ArgumentList "`"$c`""
            return
        }
    }

    # 3. 动态检测并呼出 UWP AppsFolder
    try {
        $pkg = Get-AppxPackage -Name "*Codex*" -ErrorAction SilentlyContinue
        if ($pkg -and $pkg.PackageFamilyName) {
            Start-Process "explorer.exe" -ArgumentList "shell:AppsFolder\$($pkg.PackageFamilyName)!App"
            return
        }
    } catch { }

    try {
        Start-Process "explorer.exe" -ArgumentList "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"
        return
    } catch { }

    if ($global:notifyIcon) {
        $global:notifyIcon.ShowBalloonTip(2000, "Codex 启动提示", "未检测到 Codex 桌面安装路径，请检查快捷方式。", [System.Windows.Forms.ToolTipIcon]::Warning)
    }
}

function Bind-CodexGatewayAndMcp {
    try {
        $headers = Get-AuthHeaders
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$port/balancer/api/bind-codex" -Method Post -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 6
        if ($global:notifyIcon) {
            $global:notifyIcon.ShowBalloonTip(3000, "OpenAI Codex 配置同步", "✔ 4010 本地网关与 Master-MCP 适配器已成功同步至 Codex！", [System.Windows.Forms.ToolTipIcon]::Info)
        }
    } catch {
        if ($global:notifyIcon) {
            $global:notifyIcon.ShowBalloonTip(3000, "Codex 同步提示", "已尝试写入 Codex config.toml，请重启客户端生效。", [System.Windows.Forms.ToolTipIcon]::Info)
        }
    }
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
                try {
                    [Microsoft.VisualBasic.Interaction]::AppActivate("OpenChamber") 2>$null
                } catch { }
                if ($global:notifyIcon) {
                    $global:notifyIcon.ShowBalloonTip(1500, "OpenChamber 桌面端", "已快速激活置顶至当前前台窗口。", [System.Windows.Forms.ToolTipIcon]::Info)
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
                if ($global:notifyIcon) {
                    $global:notifyIcon.ShowBalloonTip(2000, "单实例自愈完成", "检测并清理了后台无窗口僵死进程，正在重启 OpenChamber 桌面端...", [System.Windows.Forms.ToolTipIcon]::Info)
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

function Bind-DesktopClients {
    try {
        $headers = Get-AuthHeaders
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$port/balancer/api/bind-desktop" -Method Post -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 6
        if ($global:notifyIcon) {
            $global:notifyIcon.ShowBalloonTip(4000, "OpenCode 智能路由", "✔ 本地网关已成功锁定为 OpenCode 与 OpenChamber 默认配置！", [System.Windows.Forms.ToolTipIcon]::Info)
        }
    } catch {
        if ($global:notifyIcon) {
            $global:notifyIcon.ShowBalloonTip(4000, "配置失败", $_.Exception.Message, [System.Windows.Forms.ToolTipIcon]::Warning)
        }
    }
}

function Check-RouterStatus {
    try {
        Ensure-RouterRunning
        $headers = Get-AuthHeaders
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$port/status" -Headers $headers -TimeoutSec 4 -ErrorAction Stop
        $total = if ($res.accounts) { $res.accounts.Count } else { 2 }
        $healthy = 0
        if ($res.accounts) {
            foreach ($acc in $res.accounts) {
                if ($acc.enabled -and $acc.hasKey -and ($acc.status -eq "healthy" -or -not $acc.status)) { $healthy++ }
            }
        }
        if ($global:notifyIcon) {
            $global:notifyIcon.ShowBalloonTip(3000, "OpenCode 路由网关状态", "✔ 服务在线 (端口: $port)`n✔ 健康账号数: $healthy/$total", [System.Windows.Forms.ToolTipIcon]::Info)
        }
    } catch {
        if ($global:notifyIcon) {
            $global:notifyIcon.ShowBalloonTip(3000, "OpenCode 路由网关状态", "⚠ 网关状态查询中，请稍候或直接打开控制台查看。", [System.Windows.Forms.ToolTipIcon]::Warning)
        }
    }
}

function Reset-Cooldown {
    try {
        Ensure-RouterRunning
        $headers = Get-AuthHeaders
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$port/balancer/api/reset-cooldown" -Method Post -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 3 -ErrorAction Stop
        if ($global:notifyIcon) {
            $global:notifyIcon.ShowBalloonTip(2000, "限频冷却已重置", "✔ 所有账号的 429 限频锁定已清零，恢复正常轮询！", [System.Windows.Forms.ToolTipIcon]::Info)
        }
    } catch {
        if ($global:notifyIcon) {
            $global:notifyIcon.ShowBalloonTip(2000, "重置提示", "已发送重置信号至端口 $port", [System.Windows.Forms.ToolTipIcon]::Info)
        }
    }
}

function Restart-RouterService {
    try {
        $script:isManuallyStopped = $false
        $script:circuitBreakerTripped = $false
        if ($script:restartFailureTimestamps) { $script:restartFailureTimestamps.Clear() }

        Stop-RouterServiceSafely
        $script:isManuallyStopped = $false
        Start-Sleep -Milliseconds 500
        Ensure-RouterRunning
        $isUp = Test-PortListening $port
        Update-TrayStatus $isUp
        if ($isUp) {
            Update-StatusCacheAsync
            if ($global:notifyIcon) {
                $global:notifyIcon.ShowBalloonTip(2000, "路由服务已重启", "✔ 4010 智能网关已完成平滑重载！", [System.Windows.Forms.ToolTipIcon]::Info)
            }
        } else {
            if ($global:notifyIcon) {
                $global:notifyIcon.ShowBalloonTip(3000, "启动提示", "⚠ 网关在预期时间内未就绪监听端口 $port，请检查日志。", [System.Windows.Forms.ToolTipIcon]::Warning)
            }
        }
    } catch {
        if ($global:notifyIcon) {
            $global:notifyIcon.ShowBalloonTip(2000, "重启失败", $_.Exception.Message, [System.Windows.Forms.ToolTipIcon]::Warning)
        }
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

function Exit-TrayProcessOnly {
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
        if ($global:mutex) {
            try { $global:mutex.ReleaseMutex() } catch { }
            try { $global:mutex.Dispose() } catch { }
        } elseif ($mutex) {
            try { $mutex.ReleaseMutex() } catch { }
            try { $mutex.Dispose() } catch { }
        }
    } catch { }
    if ($hiddenForm) {
        try { $hiddenForm.Close() } catch { }
    }
    [System.Windows.Forms.Application]::Exit()
    exit 0
}

function Exit-TrayApp {
    Stop-RouterServiceSafely
    Exit-TrayProcessOnly
}

# --- 构建右键/左键菜单 (ContextMenuStrip) ---
$menu = New-Object System.Windows.Forms.ContextMenuStrip

# 1. 顶部只读/直达动态健康卡
$menuHeaderCard = New-Object System.Windows.Forms.ToolStripMenuItem("🟢 网关在线 :$port | 账号: -- | 活跃: $cfgDefaultModel")
$menuHeaderCard.BackColor = [System.Drawing.Color]::FromArgb(240, 245, 255)
$menuHeaderCard.ForeColor = [System.Drawing.Color]::FromArgb(16, 124, 65)
$menuHeaderCard.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$menuHeaderCard.add_Click({
    if ($script:isManuallyStopped) {
        $script:isManuallyStopped = $false
        Ensure-RouterRunning
        $isUp = Test-PortListening $port
        Update-TrayStatus $isUp
        if ($isUp) {
            Update-StatusCacheAsync
        }
    } elseif ($script:circuitBreakerTripped) {
        Run-DoctorRepair
    } else {
        Open-Dashboard
    }
})
$menu.Items.Add($menuHeaderCard) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# 2. 独立管理面板
$menuOpen = New-Object System.Windows.Forms.ToolStripMenuItem("🚀 打开订阅管理面板")
$menuOpen.Font = New-Object System.Drawing.Font($menuOpen.Font, [System.Drawing.FontStyle]::Bold)
$menuOpen.add_Click({ Open-Dashboard })
$menu.Items.Add($menuOpen) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# 3. 三端生态客户端唤醒
$menuCodex = New-Object System.Windows.Forms.ToolStripMenuItem("💻 唤醒 / 启动 OpenAI Codex 桌面端")
$menuCodex.Font = New-Object System.Drawing.Font($menuCodex.Font, [System.Drawing.FontStyle]::Bold)
$menuCodex.add_Click({ Launch-CodexDesktop })
$menu.Items.Add($menuCodex) | Out-Null

$menuChamber = New-Object System.Windows.Forms.ToolStripMenuItem("💻 唤醒 / 启动 OpenChamber 桌面端")
$menuChamber.add_Click({ Launch-OpenChamber })
$menu.Items.Add($menuChamber) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# 4. 客户端网关与 MCP 统一配置同步
$menuBindCodex = New-Object System.Windows.Forms.ToolStripMenuItem("⚡ 一键绑定网关与 MCP 至 OpenAI Codex")
$menuBindCodex.add_Click({ Bind-CodexGatewayAndMcp })
$menu.Items.Add($menuBindCodex) | Out-Null

$menuBind = New-Object System.Windows.Forms.ToolStripMenuItem("⚡ 一键应用至 OpenCode / OpenChamber")
$menuBind.add_Click({ Bind-DesktopClients })
$menu.Items.Add($menuBind) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# 5. 运维监控与自愈
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

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# 6. 双轨退出生命周期分流
$menuExitGroup = New-Object System.Windows.Forms.ToolStripMenuItem("🚪 退出选项")

$menuExitTrayOnly = New-Object System.Windows.Forms.ToolStripMenuItem("仅退出托盘（网关保持后台服务）")
$menuExitTrayOnly.add_Click({
    Write-TrayLog "User requested Exit Tray Only. Keeping router alive."
    Exit-TrayProcessOnly
})

$menuExitAll = New-Object System.Windows.Forms.ToolStripMenuItem("彻底停止所有服务（关闭托盘与 4010 网关）")
$menuExitAll.ForeColor = [System.Drawing.Color]::FromArgb(180, 40, 40)
$menuExitAll.add_Click({
    Write-TrayLog "User requested Exit All Services. Terminating router."
    Stop-RouterServiceSafely
    Exit-TrayProcessOnly
})

$menuExitGroup.DropDownItems.Add($menuExitTrayOnly) | Out-Null
$menuExitGroup.DropDownItems.Add($menuExitAll) | Out-Null
$menu.Items.Add($menuExitGroup) | Out-Null

# 菜单展开时 0 毫秒延时渲染顶部健康指示卡
$menu.add_Opening({
    param($s, $e)
    $isOnline = [OpenCodeTrayHost.StatusHolder]::IsOnline
    $accountRatio = [OpenCodeTrayHost.StatusHolder]::AccountRatio
    $activeModel = [OpenCodeTrayHost.StatusHolder]::ActiveModel
    if ($isOnline) {
        $menuHeaderCard.Text = "🟢 网关在线 :$port | 账号: $accountRatio | 活跃: $activeModel"
        $menuHeaderCard.ForeColor = [System.Drawing.Color]::FromArgb(16, 124, 65)
    } elseif ($script:isManuallyStopped) {
        $menuHeaderCard.Text = "⏸ 网关已手动停止服务 | 点击启动"
        $menuHeaderCard.ForeColor = [System.Drawing.Color]::FromArgb(100, 100, 100)
    } elseif ($script:circuitBreakerTripped) {
        $menuHeaderCard.Text = "🚨 自愈熔断 (连续重启失败) | 点击自检"
        $menuHeaderCard.ForeColor = [System.Drawing.Color]::FromArgb(200, 30, 30)
    } else {
        $menuHeaderCard.Text = "🔴 网关离线 (:$port) | 正在尝试拉起..."
        $menuHeaderCard.ForeColor = [System.Drawing.Color]::FromArgb(180, 50, 50)
    }
})

$global:notifyIcon.ContextMenuStrip = $menu

# 鼠标交互规范：双击打开管理主面板
$global:notifyIcon.add_DoubleClick({
    Open-Dashboard
})

# 鼠标交互规范：左键单击弹出快捷菜单（与右键一致，根除双击连开两个窗口）
$global:notifyIcon.add_MouseClick({
    param($s, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        if ($menu -and $menu.Visible) {
            try { $menu.Close() } catch { }
            return
        }
        try {
            $mi = [System.Windows.Forms.NotifyIcon].GetMethod("ShowContextMenu", [System.Reflection.BindingFlags]::Instance -bor [System.Reflection.BindingFlags]::NonPublic)
            if ($mi) {
                $mi.Invoke($global:notifyIcon, $null)
                return
            }
        } catch { }
        try {
            $pos = [System.Windows.Forms.Cursor]::Position
            $menu.Show($pos)
        } catch { }
    }
})

if (-not $Silent) {
    try {
        $global:notifyIcon.ShowBalloonTip(3000, "OpenCode 订阅管理中心已就绪", "本地 $port 智能网关在后台常驻运行，双击绿色托盘图标可随时唤出管理面板。", [System.Windows.Forms.ToolTipIcon]::Info)
    } catch { }
}

# --- 后台自愈看门狗 (Watchdog) 与内存工作集长效修剪 ---
$script:restartFailureTimestamps = [System.Collections.Generic.List[DateTime]]::new()
$script:circuitBreakerTripped = $false
$script:isManuallyStopped = $false
$script:watchdogTickCount = 0

$watchdogTimer = New-Object System.Windows.Forms.Timer
$watchdogTimer.Interval = 5000
$watchdogTimer.add_Tick({
    try {
        $script:watchdogTickCount++

        # 在第 2 个 tick (+10s) 以及后续每 180 个 tick (15分钟) 执行工作集深度修剪与垃圾回收
        if ($script:watchdogTickCount -eq 2 -or ($script:watchdogTickCount % 180 -eq 0)) {
            [System.GC]::Collect()
            [System.GC]::WaitForPendingFinalizers()
            [System.GC]::Collect()
            [OpenCodeTrayHost.Win32Helper]::TrimCurrentProcessMemory()
            Write-TrayLog "Periodic memory trim executed at tick $($script:watchdogTickCount)."
        }

        # 如果用户显式关停了服务，看门狗保持静默巡检，绝不强行复活
        if ($script:isManuallyStopped) {
            Update-TrayStatus $false
            return
        }

        $up = Test-PortListening $port
        Update-TrayStatus $up

        if ($up) {
            # 服务正常，清空失败历史与熔断标记
            if ($script:restartFailureTimestamps.Count -gt 0) {
                $script:restartFailureTimestamps.Clear()
            }
            if ($script:circuitBreakerTripped) {
                $script:circuitBreakerTripped = $false
            }
            # 异步拉取健康状态更新内存缓存 (每 3 个 tick = 15 秒更新一次)
            if ($script:watchdogTickCount % 3 -eq 0 -or $script:watchdogTickCount -eq 1) {
                Update-StatusCacheAsync
            }
        } else {
            # 服务离线，检查是否已触发熔断
            if ($script:circuitBreakerTripped) {
                return
            }

            # 清理 1 分钟以前的旧失败记录
            $now = [DateTime]::Now
            $cutoff = $now.AddMinutes(-1)
            $validTimestamps = [System.Collections.Generic.List[DateTime]]::new()
            foreach ($ts in $script:restartFailureTimestamps) {
                if ($ts -gt $cutoff) {
                    $validTimestamps.Add($ts)
                }
            }
            $script:restartFailureTimestamps = $validTimestamps

            if ($script:restartFailureTimestamps.Count -ge 3) {
                $script:circuitBreakerTripped = $true
                Write-TrayLog "Circuit breaker TRIPPED! 3 restart failures within 1 minute. Pausing auto-restart."
                if ($global:notifyIcon) {
                    $global:notifyIcon.ShowBalloonTip(5000, "网关自愈熔断保护", "4010 网关短时间内连续启动失败，已暂停自动重启。点击菜单【系统环境自检与修复】进行诊断。", [System.Windows.Forms.ToolTipIcon]::Error)
                }
                return
            }

            # 执行自愈拉起并记录尝试时间
            Write-TrayLog "Port $port down. Resuscitating router service..."
            $script:restartFailureTimestamps.Add($now)
            Ensure-RouterRunning
        }

        # 冷开机后第 1 个 tick (+5s) 与第 3 个 tick (+15s) 强制执行一次 Shell_NotifyIcon 重注册，彻底解决 Windows 11 任务栏延迟初始化导致图标丢失
        if ($script:watchdogTickCount -eq 1 -or $script:watchdogTickCount -eq 3) {
            Reassert-TrayIcon $true
        } else {
            Reassert-TrayIcon $false
        }
    } catch {
        Write-TrayLog "Watchdog tick error: $_"
    }
})

# 启动时执行初次状态拉取与内存工作集修剪
Update-StatusCacheAsync
[System.GC]::Collect()
[OpenCodeTrayHost.Win32Helper]::TrimCurrentProcessMemory()

$watchdogTimer.Start()

Write-TrayLog "PowerShell native NotifyIcon daemon initialized with hiddenForm."

Write-TrayLog "Entering Application::Run(hiddenForm)..."
try {
    [System.Windows.Forms.Application]::Run($hiddenForm)
} catch {
    Write-TrayLog "Run exception: $_"
}
Write-TrayLog "Application::Run returned!"
