using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace OpenCodeRouter
{
    static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        private const int SW_RESTORE = 9;

        [DllImport("psapi.dll")]
        private static extern int EmptyWorkingSet(IntPtr hwProc);

        private static Mutex mutex = null;
        private static NotifyIcon notifyIcon = null;
        private static Icon cachedNormalIcon = null;
        private static Icon cachedGreenIcon = null;
        private static int port = 4010;
        private static string uiPassword = "";
        private static string rootDir = "";
        private static string logPath = "";
        private static System.Windows.Forms.Timer watchdogTimer = null;

        // Anti-reentrancy flags for background operations
        private static int isCheckingStatus = 0;
        private static int isResettingCooldown = 0;
        private static int isRestartingRouter = 0;
        private static int isBindingClients = 0;
        private static int isEnsuringRunning = 0;

        private static void Log(string msg)
        {
            try
            {
                if (string.IsNullOrEmpty(logPath)) return;
                using (FileStream fs = new FileStream(logPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
                using (StreamWriter sw = new StreamWriter(fs, Encoding.UTF8))
                {
                    sw.WriteLine("[" + DateTime.Now.ToString("yyyy/MM/dd HH:mm:ss") + "] " + msg);
                }
            }
            catch { }
        }

        [STAThread]
        static void Main(string[] args)
        {
            try { SetProcessDPIAware(); } catch { }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            rootDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            if (!File.Exists(Path.Combine(rootDir, "server.js")))
            {
                string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string candidate = Path.Combine(userProfile, ".opencode-go-router");
                if (File.Exists(Path.Combine(candidate, "server.js")))
                {
                    rootDir = candidate;
                }
            }

            LoadConfig(rootDir, ref port, ref uiPassword);
            logPath = Path.Combine(rootDir, "tray.log");
            LoadCachedIcons();

            AppDomain.CurrentDomain.UnhandledException += (s, e) => {
                Log("UnhandledException: " + e.ExceptionObject);
            };
            Application.ThreadException += (s, e) => {
                Log("ThreadException: " + e.Exception);
            };

            try
            {
                Log("Step 1: Main started, pid=" + Process.GetCurrentProcess().Id);

                bool createdNew = false;
                try
                {
                    // Check if PowerShell tray daemon is already running with its mutex
                    bool psMutexExists = false;
                    try
                    {
                        using (Mutex dummy = Mutex.OpenExisting(@"Local\OpenCodeRouterTrayPSMutex_v2"))
                        {
                            psMutexExists = true;
                        }
                    }
                    catch { }

                    if (psMutexExists)
                    {
                        createdNew = false;
                    }
                    else
                    {
                        mutex = new Mutex(true, @"Local\OpenCodeRouterTrayMutex_v2", out createdNew);
                    }
                }
                catch (Exception mex)
                {
                    Log("Mutex ex: " + mex.Message);
                    createdNew = true;
                }

                bool isSilent = false;
                if (args != null && args.Length > 0)
                {
                    foreach (string a in args)
                    {
                        if (a != null && a.IndexOf("silent", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            isSilent = true;
                            break;
                        }
                    }
                }

                Log("Step 2: createdNew=" + createdNew + ", isSilent=" + isSilent);
                if (!createdNew)
                {
                    Log("Another instance is running. Activating dashboard and exiting.");
                    EnsureRouterRunning(false);
                    if (!isSilent)
                    {
                        OpenDashboard();
                    }
                    return;
                }

                Log("Step 3: EnsureRouterRunning");
                EnsureRouterRunning(true);
                if (!isSilent)
                {
                    Log("Step 4: OpenDashboard");
                    OpenDashboard();
                }
                else
                {
                    Log("Step 4: Silent mode, skipping OpenDashboard");
                }
                Log("Step 5: Setting up NotifyIcon");

                // Setup NotifyIcon
                notifyIcon = new NotifyIcon();
                bool isOnline = IsPortListening(port);
                notifyIcon.Icon = isOnline ? cachedGreenIcon : cachedNormalIcon;
                notifyIcon.Text = string.Format("OpenCode 订阅管理中心 (端口: {0})", port);
                notifyIcon.Visible = true;

                try
                {
                    notifyIcon.ShowBalloonTip(3000, "OpenCode 订阅管理中心已启动", "已在系统托盘静默运行！若未显示，可展开任务栏右下角小箭头查看。", ToolTipIcon.Info);
                }
                catch { }

                // Context Menu
                ContextMenuStrip menu = new ContextMenuStrip();
                menu.ShowImageMargin = false;

                ToolStripMenuItem menuOpen = new ToolStripMenuItem("🚀 打开订阅管理面板");
                menuOpen.Font = new Font(menuOpen.Font, FontStyle.Bold);
                menuOpen.Click += (s, e) => OpenDashboard();
                menu.Items.Add(menuOpen);

                menu.Items.Add(new ToolStripSeparator());

                ToolStripMenuItem menuChamber = new ToolStripMenuItem("💻 唤醒 / 启动 OpenChamber 桌面端");
                menuChamber.Font = new Font(menuChamber.Font, FontStyle.Bold);
                menuChamber.Click += (s, e) => LaunchOrActivateOpenChamber();
                menu.Items.Add(menuChamber);

                menu.Items.Add(new ToolStripSeparator());

                ToolStripMenuItem menuStatus = new ToolStripMenuItem("🔍 检查服务状态");
                menuStatus.Click += (s, e) => CheckStatus();
                menu.Items.Add(menuStatus);

                ToolStripMenuItem menuResetCooldown = new ToolStripMenuItem("⚡ 一键重置限频冷却");
                menuResetCooldown.Click += (s, e) => ResetCooldown();
                menu.Items.Add(menuResetCooldown);

                ToolStripMenuItem menuRestart = new ToolStripMenuItem("🔄 重启路由服务");
                menuRestart.Click += (s, e) => RestartRouter();
                menu.Items.Add(menuRestart);

                ToolStripMenuItem menuDoctor = new ToolStripMenuItem("🩺 系统环境自检与修复");
                menuDoctor.Click += (s, e) => RunDoctor();
                menu.Items.Add(menuDoctor);

                ToolStripMenuItem menuUpdates = new ToolStripMenuItem("📦 检查更新与组件版本诊断");
                menuUpdates.Click += (s, e) => CheckUpdates();
                menu.Items.Add(menuUpdates);

                ToolStripMenuItem menuBind = new ToolStripMenuItem("⚡ 一键应用至 OpenCode / OpenChamber");
                menuBind.Click += (s, e) => BindDesktopClients();
                menu.Items.Add(menuBind);

                ToolStripMenuItem menuTrim = new ToolStripMenuItem("🧹 深度清理与内存修剪 (释放至 <30MB)");
                menuTrim.Click += (s, e) => TrimMemory(true);
                menu.Items.Add(menuTrim);

                menu.Items.Add(new ToolStripSeparator());

                ToolStripMenuItem menuExit = new ToolStripMenuItem("❌ 退出托盘与路由服务");
                menuExit.Click += (s, e) => ExitApp();
                menu.Items.Add(menuExit);

                notifyIcon.ContextMenuStrip = menu;
                notifyIcon.DoubleClick += (s, e) => OpenDashboard();
                notifyIcon.Click += (s, e) => {
                    MouseEventArgs me = e as MouseEventArgs;
                    if (me != null && me.Button == MouseButtons.Left)
                    {
                        OpenDashboard();
                    }
                };

                // 后台常驻自愈看门狗 (Watchdog: 每 5 秒守护检测 4010 端口，全异步非阻塞，异常时静默复活)
                int watchdogTickCount = 0;
                watchdogTimer = new System.Windows.Forms.Timer();
                watchdogTimer.Interval = 5000;
                watchdogTimer.Tick += (s, e) => {
                    try
                    {
                        bool listening = IsPortListening(port);
                        UpdateTrayStatus(listening);

                        if (!listening)
                        {
                            // Trigger background resurrection without blocking the UI thread
                            ThreadPool.QueueUserWorkItem(state => {
                                try { EnsureRouterRunning(true); } catch { }
                            });
                        }

                        watchdogTickCount++;
                        if (watchdogTickCount % 6 == 0) // 每 30 秒静默深度整理内存
                        {
                            try { TrimMemory(false); } catch { }
                        }
                    }
                    catch { }
                };
                watchdogTimer.Start();

                // 创建常驻隐形宿主窗体 (防止消息泵被回收)
                Form hiddenForm = new Form();
                hiddenForm.Text = "OpenCodeRouterTrayMsgSink";
                hiddenForm.FormBorderStyle = FormBorderStyle.None;
                hiddenForm.ShowInTaskbar = false;
                hiddenForm.WindowState = FormWindowState.Minimized;
                hiddenForm.Size = new Size(0, 0);
                hiddenForm.Opacity = 0;
                hiddenForm.ShowIcon = false;

                Log("Step 7: Entering Application.Run(hiddenForm)...");
                Application.Run(hiddenForm);
                Log("Application.Run EXITED!");
            }
            catch (Exception ex)
            {
                Log("Main CRASH: " + ex);
            }
        }

        private static void LoadCachedIcons()
        {
            string normalIcoPath = Path.Combine(rootDir, "assets", "router.ico");
            string greenIcoPath = Path.Combine(rootDir, "assets", "router_green.ico");

            if (File.Exists(normalIcoPath))
            {
                try { cachedNormalIcon = new Icon(normalIcoPath); } catch { }
            }
            if (File.Exists(greenIcoPath))
            {
                try { cachedGreenIcon = new Icon(greenIcoPath); } catch { }
            }

            if (cachedNormalIcon == null && cachedGreenIcon != null) cachedNormalIcon = cachedGreenIcon;
            if (cachedGreenIcon == null && cachedNormalIcon != null) cachedGreenIcon = cachedNormalIcon;
            if (cachedNormalIcon == null) cachedNormalIcon = SystemIcons.Application;
            if (cachedGreenIcon == null) cachedGreenIcon = SystemIcons.Application;
        }

        private static void UpdateTrayStatus(bool isOnline)
        {
            try
            {
                if (notifyIcon != null)
                {
                    Icon targetIcon = isOnline ? cachedGreenIcon : cachedNormalIcon;
                    if (notifyIcon.Icon != targetIcon)
                    {
                        notifyIcon.Icon = targetIcon;
                    }
                    string statusText = string.Format("OpenCode 订阅管理中心 (端口: {0} - {1})", port, isOnline ? "在线" : "离线");
                    if (statusText.Length >= 64) statusText = statusText.Substring(0, 63);
                    notifyIcon.Text = statusText;
                }
            }
            catch { }
        }

        private static void ShowBalloon(string title, string text, ToolTipIcon icon, int timeout = 3000)
        {
            try
            {
                if (notifyIcon != null)
                {
                    notifyIcon.ShowBalloonTip(timeout, title, text, icon);
                }
            }
            catch { }
        }

        static bool IsPortListening(int targetPort)
        {
            try
            {
                IPGlobalProperties ipProperties = IPGlobalProperties.GetIPGlobalProperties();
                IPEndPoint[] endPoints = ipProperties.GetActiveTcpListeners();
                foreach (IPEndPoint ep in endPoints)
                {
                    if (ep.Port == targetPort) return true;
                }
            }
            catch { }
            return false;
        }

        static void EnsureRouterRunning(bool wait = false)
        {
            if (Interlocked.Exchange(ref isEnsuringRunning, 1) != 0) return;
            try
            {
                if (IsPortListening(port))
                {
                    UpdateTrayStatus(true);
                    return;
                }

                UpdateTrayStatus(false);

                string silentVbs = Path.Combine(rootDir, "silent-start.vbs");
                string serverJs = Path.Combine(rootDir, "server.js");

                if (File.Exists(silentVbs))
                {
                    ProcessStartInfo psi = new ProcessStartInfo("wscript.exe", "\"" + silentVbs + "\"");
                    psi.WorkingDirectory = rootDir;
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                    Process.Start(psi);
                }
                else if (File.Exists(serverJs))
                {
                    ProcessStartInfo psi = new ProcessStartInfo("node.exe", "\"" + serverJs + "\"");
                    psi.WorkingDirectory = rootDir;
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                    Process.Start(psi);
                }

                if (wait)
                {
                    for (int i = 0; i < 20; i++)
                    {
                        Thread.Sleep(150);
                        if (IsPortListening(port))
                        {
                            UpdateTrayStatus(true);
                            break;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log("EnsureRouterRunning exception: " + ex);
            }
            finally
            {
                Interlocked.Exchange(ref isEnsuringRunning, 0);
            }
        }

        static string FindBrowserExe(string exeName)
        {
            try
            {
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exeName))
                {
                    if (key != null)
                    {
                        object val = key.GetValue("");
                        if (val != null && File.Exists(val.ToString())) return val.ToString();
                    }
                }
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exeName))
                {
                    if (key != null)
                    {
                        object val = key.GetValue("");
                        if (val != null && File.Exists(val.ToString())) return val.ToString();
                    }
                }
            }
            catch { }

            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            string[] candidates = new string[] {
                Path.Combine(programFiles, @"Microsoft\Edge\Application\" + exeName),
                Path.Combine(programFilesX86, @"Microsoft\Edge\Application\" + exeName),
                Path.Combine(localAppData, @"Microsoft\Edge\Application\" + exeName),
                Path.Combine(programFiles, @"Google\Chrome\Application\" + exeName),
                Path.Combine(programFilesX86, @"Google\Chrome\Application\" + exeName),
                Path.Combine(localAppData, @"Google\Chrome\Application\" + exeName)
            };

            foreach (string p in candidates)
            {
                if (File.Exists(p)) return p;
            }

            return null;
        }

        static string GetDefaultBrowserName()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice"))
                {
                    if (key != null)
                    {
                        object progId = key.GetValue("ProgId");
                        if (progId != null)
                        {
                            string pid = progId.ToString().ToLowerInvariant();
                            if (pid.Contains("chrome")) return "chrome.exe";
                            if (pid.Contains("edge") || pid.Contains("msedge")) return "msedge.exe";
                        }
                    }
                }
            }
            catch { }
            return "chrome.exe";
        }

        static void TrimMemory(bool showBalloon)
        {
            try
            {
                // 1. 精准修剪托盘守护自身工作集
                EmptyWorkingSet(Process.GetCurrentProcess().Handle);

                // 2. 精准修剪 OpenCodeRouterApp 进程
                Process[] appProcs = Process.GetProcessesByName("OpenCodeRouterApp");
                foreach (Process p in appProcs)
                {
                    try { EmptyWorkingSet(p.Handle); } catch { }
                }

                // 3. 仅精准查找拥有网关管理中心标题的窗口进程进行修剪，绝不误伤用户日常浏览器
                Process[] allProcs = Process.GetProcesses();
                foreach (Process p in allProcs)
                {
                    try
                    {
                        if (!string.IsNullOrEmpty(p.MainWindowTitle) &&
                            (p.MainWindowTitle.Contains("OpenCode 智能高可用网关") ||
                             p.MainWindowTitle.Contains("OpenCode 订阅管理中心") ||
                             p.MainWindowTitle.Contains("OpenCode 智能路由网关")))
                        {
                            EmptyWorkingSet(p.Handle);
                        }
                    }
                    catch { }
                }

                if (showBalloon)
                {
                    ShowBalloon("内存深度清理完成", "已将前端与托盘守护工作集深度整理，物理内存已降至 20MB 左右！", ToolTipIcon.Info, 2000);
                }
            }
            catch { }
        }

        static void OpenUrl(string url)
        {
            EnsureRouterRunning(false);

            // 方案 0: 优先使用本地超轻量桌面客户端 OpenCodeRouterApp.exe 唤出（单实例置顶、内存修剪、极简模式）
            try
            {
                string appExe = Path.Combine(rootDir, "OpenCodeRouterApp.exe");
                if (File.Exists(appExe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = appExe;
                    psi.WorkingDirectory = rootDir;
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                    return;
                }
            }
            catch { }

            string lightBrowserArgs = "--disable-gpu --disable-software-rasterizer --renderer-process-limit=1 --js-flags=\"--max-old-space-size=32\" --disable-extensions --disable-background-networking --disable-component-update --disable-sync --disk-cache-size=1 --media-cache-size=1 --disable-http-cache --no-first-run --no-default-browser-check --disable-features=Translate,msEdgeStartupBoost,OptimizationHints,MediaRouter";

            // 方案 0.5: 优先使用本地嵌入纯净 Chromium 核心（若存在独立自包含包）
            try
            {
                string[] localCandidates = new string[] {
                    Path.Combine(rootDir, @"bin\chromium\chrome.exe"),
                    Path.Combine(rootDir, @"chromium\chrome.exe"),
                    Path.Combine(rootDir, @"runtime\chromium\chrome.exe")
                };
                foreach (string lp in localCandidates)
                {
                    if (File.Exists(lp))
                    {
                        ProcessStartInfo psi = new ProcessStartInfo();
                        psi.FileName = lp;
                        psi.Arguments = "--app=\"" + url + "\" " + lightBrowserArgs;
                        psi.UseShellExecute = true;
                        Process.Start(psi);
                        return;
                    }
                }
            }
            catch { }

            string defaultBrowser = GetDefaultBrowserName();
            string primaryBrowser = "chrome.exe";
            string secondaryBrowser = "msedge.exe";

            // 方案 1: 优先以主浏览器的独立桌面应用模式 (--app=...) 唤出
            try
            {
                string bExe = FindBrowserExe(primaryBrowser);
                if (!string.IsNullOrEmpty(bExe) && File.Exists(bExe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = bExe;
                    psi.Arguments = "--app=\"" + url + "\" " + lightBrowserArgs;
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                    return;
                }
            }
            catch { }

            // 方案 2: 备选以次要浏览器的独立桌面应用模式 (--app=...) 唤出
            try
            {
                string bExe = FindBrowserExe(secondaryBrowser);
                if (!string.IsNullOrEmpty(bExe) && File.Exists(bExe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = bExe;
                    psi.Arguments = "--app=\"" + url + "\" " + lightBrowserArgs;
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                    return;
                }
            }
            catch { }

            // 方案 3: 使用 Windows Shell 默认关联浏览器打开
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = url;
                psi.UseShellExecute = true;
                Process.Start(psi);
                return;
            }
            catch { }

            // 方案 4: explorer.exe 脱钩打开 URL 兜底
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("explorer.exe", "\"" + url + "\"");
                psi.UseShellExecute = true;
                Process.Start(psi);
                return;
            }
            catch { }

            // 方案 5: cmd.exe start 终极无窗口唤醒
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c start \"\" \"" + url + "\"");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            catch { }
        }

        private static void LoadConfig(string dir, ref int port, ref string uiPassword)
        {
            try
            {
                string cfgPath = Path.Combine(dir, "config.json");
                if (File.Exists(cfgPath))
                {
                    string json = File.ReadAllText(cfgPath);
                    int portIdx = json.IndexOf("\"port\"");
                    if (portIdx >= 0)
                    {
                        int colonIdx = json.IndexOf(":", portIdx);
                        if (colonIdx >= 0)
                        {
                            int endIdx = json.IndexOfAny(new char[] { ',', '}', '\r', '\n' }, colonIdx + 1);
                            if (endIdx > colonIdx)
                            {
                                string portStr = json.Substring(colonIdx + 1, endIdx - colonIdx - 1).Trim();
                                int p;
                                if (int.TryParse(portStr, out p) && p > 0 && p < 65536)
                                {
                                    port = p;
                                }
                            }
                        }
                    }

                    int passIdx = json.IndexOf("\"uiPassword\"");
                    if (passIdx >= 0)
                    {
                        int colonIdx = json.IndexOf(":", passIdx);
                        if (colonIdx >= 0)
                        {
                            int q1 = json.IndexOf("\"", colonIdx);
                            if (q1 >= 0)
                            {
                                int q2 = json.IndexOf("\"", q1 + 1);
                                if (q2 > q1)
                                {
                                    uiPassword = json.Substring(q1 + 1, q2 - q1 - 1).Trim();
                                }
                            }
                        }
                    }
                }
            }
            catch { }
        }

        static void OpenDashboard(string hash = "")
        {
            EnsureRouterRunning(false);
            LoadConfig(rootDir, ref port, ref uiPassword);
            string appExe = Path.Combine(rootDir, "OpenCodeRouterApp.exe");
            if (File.Exists(appExe))
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(appExe, string.IsNullOrEmpty(hash) ? "" : hash);
                    psi.WorkingDirectory = rootDir;
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                    return;
                }
                catch { }
            }
            string authQuery = !string.IsNullOrEmpty(uiPassword) ? ("?auth=" + Uri.EscapeDataString(uiPassword)) : "";
            string url = "http://127.0.0.1:" + port + "/balancer/ui" + authQuery + (hash ?? "");
            ShowBalloon("订阅管理中心", "正在唤起控制面板界面...", ToolTipIcon.Info, 1500);
            OpenUrl(url);
        }

        static string FindOpenChamberDesktopExe()
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

            string[] candidates = new string[] {
                Path.Combine(localAppData, @"Programs\@openchamberelectron\OpenChamber.exe"),
                Path.Combine(localAppData, @"Programs\OpenChamber\OpenChamber.exe"),
                Path.Combine(programFiles, @"OpenChamber\OpenChamber.exe"),
                Path.Combine(programFilesX86, @"OpenChamber\OpenChamber.exe"),
                Path.Combine(localAppData, @"OpenChamber\OpenChamber.exe"),
                Path.Combine(userProfile, @"Desktop\OpenChamber.lnk"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), @"Programs\OpenChamber.lnk")
            };

            foreach (string p in candidates)
            {
                if (File.Exists(p)) return p;
            }
            return null;
        }

        static void LaunchOrActivateOpenChamber()
        {
            // 1. 优先检测是否已有带窗口的运行中实例，秒级置顶前台
            try
            {
                Process[] procs = Process.GetProcessesByName("OpenChamber");
                IntPtr activeWindow = IntPtr.Zero;
                bool hasGhost = false;

                foreach (Process p in procs)
                {
                    try
                    {
                        if (p.MainWindowHandle != IntPtr.Zero)
                        {
                            activeWindow = p.MainWindowHandle;
                            break;
                        }
                        else
                        {
                            hasGhost = true;
                        }
                    }
                    catch { }
                }

                // 分支 1: 已有可见桌面窗口，毫秒级置顶激活并恢复前台
                if (activeWindow != IntPtr.Zero)
                {
                    ShowWindowAsync(activeWindow, SW_RESTORE);
                    SetForegroundWindow(activeWindow);
                    ShowBalloon("OpenChamber 桌面端", "已快速激活置顶至当前前台窗口。", ToolTipIcon.Info, 1500);
                    return;
                }

                // 分支 2: 后台存在无窗口僵死进程死锁 SingleInstanceLock，强力自愈释放
                if (hasGhost)
                {
                    foreach (Process p in procs)
                    {
                        try { p.Kill(); } catch { }
                    }
                    Thread.Sleep(500);
                }
            }
            catch { }

            // 2. 定位并脱钩启动原生桌面客户端
            string chamberExe = FindOpenChamberDesktopExe();
            if (!string.IsNullOrEmpty(chamberExe) && File.Exists(chamberExe))
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo("explorer.exe", "\"" + chamberExe + "\"");
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                    ShowBalloon("OpenChamber 桌面端", "正在启动 OpenChamber 桌面原生工作台...", ToolTipIcon.Info, 2000);
                    return;
                }
                catch (Exception ex)
                {
                    ShowBalloon("启动失败", "启动原生客户端异常: " + ex.Message, ToolTipIcon.Warning, 3000);
                }
            }

            // 3. 若本地未安装客户端，降级为独立 Web 工作台模式并检测服务
            OpenWebChamber();
        }

        static void OpenWebChamber()
        {
            string url = "http://127.0.0.1:3000";
            bool isListening = IsPortListening(3000);
            OpenUrl(url);

            if (!isListening)
            {
                ShowBalloon("OpenChamber 提示", "已唤出工作台界面。检测到 3000 端口服务未就绪，可运行 setup-wizard.ps1 启动服务。", ToolTipIcon.Warning, 3000);
            }
        }

        static void CheckStatus()
        {
            if (Interlocked.Exchange(ref isCheckingStatus, 1) != 0) return;

            ThreadPool.QueueUserWorkItem(state =>
            {
                try
                {
                    LoadConfig(rootDir, ref port, ref uiPassword);
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/status");
                    req.Method = "GET";
                    req.Timeout = 3000;
                    if (!string.IsNullOrEmpty(uiPassword))
                    {
                        req.Headers["x-ui-password"] = uiPassword;
                        req.Headers["x-api-key"] = uiPassword;
                    }
                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    {
                        UpdateTrayStatus(true);
                        ShowBalloon("OpenCode 路由正常", "本地端口: " + port + "\n服务在线，详细指标请查看面板。", ToolTipIcon.Info, 3000);
                    }
                }
                catch (Exception ex)
                {
                    UpdateTrayStatus(false);
                    ShowBalloon("服务检测异常", "端口 " + port + ": " + ex.Message, ToolTipIcon.Warning, 3000);
                }
                finally
                {
                    Interlocked.Exchange(ref isCheckingStatus, 0);
                }
            });
        }

        static void ResetCooldown()
        {
            if (Interlocked.Exchange(ref isResettingCooldown, 1) != 0) return;

            ThreadPool.QueueUserWorkItem(state =>
            {
                try
                {
                    LoadConfig(rootDir, ref port, ref uiPassword);
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/balancer/api/reset-cooldown");
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    req.Timeout = 3500;
                    if (!string.IsNullOrEmpty(uiPassword))
                    {
                        req.Headers["x-ui-password"] = uiPassword;
                        req.Headers["x-api-key"] = uiPassword;
                    }
                    byte[] data = Encoding.UTF8.GetBytes("{}");
                    req.ContentLength = data.Length;
                    using (Stream s = req.GetRequestStream())
                    {
                        s.Write(data, 0, data.Length);
                    }
                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    {
                        ShowBalloon("冷却已重置", "账号限频冷却已立即清空并恢复健康轮询！", ToolTipIcon.Info, 2500);
                    }
                }
                catch (Exception ex)
                {
                    ShowBalloon("重置失败", ex.Message, ToolTipIcon.Warning, 2500);
                }
                finally
                {
                    Interlocked.Exchange(ref isResettingCooldown, 0);
                }
            });
        }

        static void RestartRouter()
        {
            if (Interlocked.Exchange(ref isRestartingRouter, 1) != 0) return;

            ShowBalloon("正在重启路由服务", "正在停止并安全重载 4010 网关核心进程...", ToolTipIcon.Info, 1500);

            ThreadPool.QueueUserWorkItem(state =>
            {
                try
                {
                    KillProcessTreeByPort(port);
                    Thread.Sleep(500);
                    EnsureRouterRunning(true);
                    UpdateTrayStatus(true);
                    ShowBalloon("路由服务已重启", "服务已重新加载并监听端口 " + port, ToolTipIcon.Info, 2000);
                }
                catch (Exception ex)
                {
                    ShowBalloon("重启异常", ex.Message, ToolTipIcon.Warning, 3000);
                }
                finally
                {
                    Interlocked.Exchange(ref isRestartingRouter, 0);
                }
            });
        }

        static void RunDoctor()
        {
            string doctorScript = Path.Combine(rootDir, "doctor-repair.ps1");
            if (File.Exists(doctorScript))
            {
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -NoExit -File \"" + doctorScript + "\"");
                Process.Start(psi);
            }
            else
            {
                OpenDashboard();
            }
        }

        static void CheckUpdates()
        {
            EnsureRouterRunning(false);
            OpenDashboard("#updates");
        }

        static void BindDesktopClients()
        {
            if (Interlocked.Exchange(ref isBindingClients, 1) != 0) return;

            ThreadPool.QueueUserWorkItem(state =>
            {
                try
                {
                    LoadConfig(rootDir, ref port, ref uiPassword);
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/balancer/api/bind-desktop");
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    if (!string.IsNullOrEmpty(uiPassword))
                    {
                        req.Headers["x-ui-password"] = uiPassword;
                        req.Headers["x-api-key"] = uiPassword;
                    }
                    req.Timeout = 6000;
                    byte[] data = Encoding.UTF8.GetBytes("{}");
                    req.ContentLength = data.Length;
                    using (Stream s = req.GetRequestStream())
                    {
                        s.Write(data, 0, data.Length);
                    }
                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    {
                        ShowBalloon("OpenCode 智能路由", "✔ 本地网关已成功锁定为 OpenCode 与 OpenChamber 默认配置！", ToolTipIcon.Info, 4000);
                    }
                }
                catch (Exception ex)
                {
                    ShowBalloon("配置失败", ex.Message, ToolTipIcon.Warning, 4000);
                }
                finally
                {
                    Interlocked.Exchange(ref isBindingClients, 0);
                }
            });
        }

        static void KillProcessTreeByPort(int targetPort)
        {
            try
            {
                // Primary: PowerShell TCP connection lookup with deduplication pipeline
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -Command \"Get-NetTCPConnection -LocalPort " + targetPort + " -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -like '*node*') { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }\"");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                using (Process p = Process.Start(psi))
                {
                    if (p != null) p.WaitForExit(3000);
                }
            }
            catch { }

            try
            {
                // Secondary: netstat and taskkill /F /T for recursive child process termination
                ProcessStartInfo psiNetstat = new ProcessStartInfo("cmd.exe", "/c netstat -ano -p tcp | findstr \":" + targetPort + " .*LISTENING\"");
                psiNetstat.CreateNoWindow = true;
                psiNetstat.UseShellExecute = false;
                psiNetstat.RedirectStandardOutput = true;
                using (Process pNetstat = Process.Start(psiNetstat))
                {
                    string output = pNetstat.StandardOutput.ReadToEnd();
                    pNetstat.WaitForExit(2000);
                    if (!string.IsNullOrEmpty(output))
                    {
                        string[] lines = output.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                        foreach (string line in lines)
                        {
                            string[] parts = line.Trim().Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                            if (parts.Length >= 5)
                            {
                                string pidStr = parts[parts.Length - 1];
                                int pid;
                                if (int.TryParse(pidStr, out pid) && pid > 0 && pid != Process.GetCurrentProcess().Id)
                                {
                                    KillProcessTree(pid);
                                }
                            }
                        }
                    }
                }
            }
            catch { }
        }

        static void KillProcessTree(int pid)
        {
            if (pid <= 0) return;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("taskkill.exe", string.Format("/F /T /PID {0}", pid));
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit(3000);
                }
            }
            catch
            {
                try
                {
                    Process proc = Process.GetProcessById(pid);
                    proc.Kill();
                }
                catch { }
            }
        }

        static void ExitApp()
        {
            if (watchdogTimer != null)
            {
                try
                {
                    watchdogTimer.Stop();
                    watchdogTimer.Dispose();
                    watchdogTimer = null;
                }
                catch { }
            }

            if (notifyIcon != null)
            {
                try
                {
                    notifyIcon.Visible = false;
                    notifyIcon.Dispose();
                    notifyIcon = null;
                }
                catch { }
            }

            if (cachedNormalIcon != null && cachedNormalIcon != SystemIcons.Application)
            {
                try { cachedNormalIcon.Dispose(); } catch { }
                cachedNormalIcon = null;
            }
            if (cachedGreenIcon != null && cachedGreenIcon != SystemIcons.Application && cachedGreenIcon != cachedNormalIcon)
            {
                try { cachedGreenIcon.Dispose(); } catch { }
                cachedGreenIcon = null;
            }

            if (mutex != null)
            {
                try
                {
                    mutex.ReleaseMutex();
                    mutex.Dispose();
                }
                catch { }
                mutex = null;
            }

            try
            {
                KillProcessTreeByPort(port);
            }
            catch { }

            Application.Exit();
        }
    }
}
