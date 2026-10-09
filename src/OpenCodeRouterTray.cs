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

        private const int SW_RESTORE = 9;

        private static Mutex mutex = null;
        private static NotifyIcon notifyIcon = null;
        private static int port = 4010;
        private static string rootDir = "";
        private static string icoPath = "";
        private static System.Windows.Forms.Timer watchdogTimer = null;

        [STAThread]
        static void Main(string[] args)
        {
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

            icoPath = Path.Combine(rootDir, "assets", "router.ico");
            string logPath = Path.Combine(rootDir, "tray.log");

            AppDomain.CurrentDomain.UnhandledException += (s, e) => {
                try { File.AppendAllText(logPath, "[" + DateTime.Now + "] UnhandledException: " + e.ExceptionObject + "\r\n"); } catch { }
            };
            Application.ThreadException += (s, e) => {
                try { File.AppendAllText(logPath, "[" + DateTime.Now + "] ThreadException: " + e.Exception + "\r\n"); } catch { }
            };

            try
            {
                // Auto-clean stale OpenCodeRouterTray instances to ensure new version takes effect
                Process curProcess = Process.GetCurrentProcess();
                try
                {
                    foreach (Process p in Process.GetProcessesByName("OpenCodeRouterTray"))
                    {
                        if (p.Id != curProcess.Id)
                        {
                            try
                            {
                                p.Kill();
                                p.WaitForExit(1000);
                            }
                            catch { }
                        }
                    }
                }
                catch { }

                // Single instance check: only bail out if another instance is actively alive
                bool otherRunning = false;
                foreach (Process p in Process.GetProcessesByName("OpenCodeRouterTray"))
                {
                    if (p.Id != curProcess.Id)
                    {
                        try
                        {
                            if (!p.HasExited)
                            {
                                otherRunning = true;
                                break;
                            }
                        }
                        catch { }
                    }
                }

                if (otherRunning)
                {
                    EnsureRouterRunning();
                    OpenDashboard();
                    return;
                }

                try
                {
                    mutex = new Mutex(true, @"Local\OpenCodeRouterTrayMutex_v2");
                }
                catch { }

                EnsureRouterRunning();
                OpenDashboard();

            // Setup NotifyIcon
            notifyIcon = new NotifyIcon();
            if (File.Exists(icoPath))
            {
                try { notifyIcon.Icon = new Icon(icoPath); } catch { notifyIcon.Icon = SystemIcons.Application; }
            }
            else
            {
                notifyIcon.Icon = SystemIcons.Application;
            }

            notifyIcon.Text = "OpenCode 订阅管理中心 (端口: " + port + ")";
            notifyIcon.Visible = true;

            try
            {
                notifyIcon.ShowBalloonTip(3000, "OpenCode 订阅管理中心已启动", "已在系统托盘静默运行！若未显示，可展开任务栏右下角小箭头查看。", ToolTipIcon.Info);
            }
            catch { }

            // Context Menu
            ContextMenuStrip menu = new ContextMenuStrip();

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

            // 后台常驻自愈看门狗 (Watchdog: 每 5 秒守护检测 4010 端口，异常时静默复活)
            watchdogTimer = new System.Windows.Forms.Timer();
            watchdogTimer.Interval = 5000;
            watchdogTimer.Tick += (s, e) => {
                try { EnsureRouterRunning(); } catch { }
            };
            watchdogTimer.Start();

            Form hiddenForm = new Form();
            hiddenForm.FormBorderStyle = FormBorderStyle.None;
            hiddenForm.ShowInTaskbar = false;
            hiddenForm.Size = new Size(0, 0);
            hiddenForm.WindowState = FormWindowState.Minimized;
            hiddenForm.Load += (s, e) => {
                hiddenForm.Hide();
            };

            Application.Run(hiddenForm);
            }
            catch (Exception ex)
            {
                try { File.AppendAllText(logPath, "[" + DateTime.Now + "] Main CRASH: " + ex + "\r\n"); } catch { }
            }
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

        static void EnsureRouterRunning()
        {
            try
            {
                if (IsPortListening(port)) return;

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

                for (int i = 0; i < 15; i++)
                {
                    Thread.Sleep(200);
                    if (IsPortListening(port)) break;
                }
            }
            catch (Exception ex)
            {
                try { File.AppendAllText(Path.Combine(rootDir, "tray.log"), "[" + DateTime.Now + "] EnsureRouterRunning exception: " + ex + "\r\n"); } catch { }
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

        static void OpenUrl(string url)
        {
            EnsureRouterRunning();

            string defaultBrowser = GetDefaultBrowserName();
            string primaryBrowser = defaultBrowser;
            string secondaryBrowser = (defaultBrowser == "chrome.exe") ? "msedge.exe" : "chrome.exe";

            // 方案 1: 优先以系统默认浏览器的独立桌面应用模式 (--app=...) 唤出（无地址栏/标签栏纯净体验）
            try
            {
                string bExe = FindBrowserExe(primaryBrowser);
                if (!string.IsNullOrEmpty(bExe) && File.Exists(bExe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = bExe;
                    psi.Arguments = "--app=" + url;
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
                    psi.Arguments = "--app=" + url;
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                    return;
                }
            }
            catch { }

            // 方案 3: 使用 Windows Shell 默认关联浏览器打开 (UseShellExecute = true 核心保障)
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

        static void OpenDashboard(string hash = "")
        {
            string url = "http://127.0.0.1:" + port + "/balancer/ui" + (hash ?? "");
            try
            {
                if (notifyIcon != null)
                {
                    notifyIcon.ShowBalloonTip(1500, "订阅管理中心", "正在唤起控制面板界面...", ToolTipIcon.Info);
                }
            }
            catch { }
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
                    if (notifyIcon != null)
                    {
                        notifyIcon.ShowBalloonTip(1500, "OpenChamber 桌面端", "已快速激活置顶至当前前台窗口。", ToolTipIcon.Info);
                    }
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
                    // 严格遵循规则 4: 必须通过 explorer.exe <path> 脱钩启动，严禁挂接在临时终端 Job 树中
                    ProcessStartInfo psi = new ProcessStartInfo("explorer.exe", "\"" + chamberExe + "\"");
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                    if (notifyIcon != null)
                    {
                        notifyIcon.ShowBalloonTip(2000, "OpenChamber 桌面端", "正在启动 OpenChamber 桌面原生工作台...", ToolTipIcon.Info);
                    }
                    return;
                }
                catch (Exception ex)
                {
                    if (notifyIcon != null)
                    {
                        notifyIcon.ShowBalloonTip(3000, "启动失败", "启动原生客户端异常: " + ex.Message, ToolTipIcon.Warning);
                    }
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

            if (!isListening && notifyIcon != null)
            {
                notifyIcon.ShowBalloonTip(3000, "OpenChamber 提示", "已唤出工作台界面。检测到 3000 端口服务未就绪，可运行 setup-wizard.ps1 启动服务。", ToolTipIcon.Warning);
            }
        }

        static void CheckStatus()
        {
            try
            {
                using (WebClient client = new WebClient())
                {
                    client.Encoding = System.Text.Encoding.UTF8;
                    string json = client.DownloadString("http://127.0.0.1:" + port + "/status");
                    notifyIcon.ShowBalloonTip(3000, "OpenCode 路由正常", "本地端口: " + port + "\n服务在线，详细指标请查看面板。", ToolTipIcon.Info);
                }
            }
            catch (Exception ex)
            {
                notifyIcon.ShowBalloonTip(3000, "服务检测异常", "端口 " + port + ": " + ex.Message, ToolTipIcon.Warning);
            }
        }

        static void ResetCooldown()
        {
            try
            {
                using (WebClient client = new WebClient())
                {
                    client.Encoding = System.Text.Encoding.UTF8;
                    client.Headers[HttpRequestHeader.ContentType] = "application/json";
                    string res = client.UploadString("http://127.0.0.1:" + port + "/balancer/api/reset-cooldown", "POST", "{}");
                    notifyIcon.ShowBalloonTip(2500, "冷却已重置", "账号限频冷却已立即清空并恢复健康轮询！", ToolTipIcon.Info);
                }
            }
            catch (Exception ex)
            {
                notifyIcon.ShowBalloonTip(2500, "重置失败", ex.Message, ToolTipIcon.Warning);
            }
        }

        static void RestartRouter()
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -Command \"Get-NetTCPConnection -LocalPort " + port + " -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -like '*node*') { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }\"");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process p = Process.Start(psi);
                p.WaitForExit(3000);
            }
            catch { }

            Thread.Sleep(500);
            EnsureRouterRunning();
            notifyIcon.ShowBalloonTip(2000, "路由服务已重启", "服务已重新加载并监听端口 " + port, ToolTipIcon.Info);
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
            EnsureRouterRunning();
            OpenDashboard("#updates");
        }

        static void BindDesktopClients()
        {
            new Thread(() =>
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/balancer/api/bind-desktop");
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    req.Timeout = 6000;
                    byte[] data = Encoding.UTF8.GetBytes("{}");
                    req.ContentLength = data.Length;
                    using (Stream s = req.GetRequestStream())
                    {
                        s.Write(data, 0, data.Length);
                    }
                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    {
                        notifyIcon.ShowBalloonTip(4000, "OpenCode 智能路由", "✔ 本地网关已成功锁定为 OpenCode 与 OpenChamber 默认配置！", ToolTipIcon.Info);
                    }
                }
                catch (Exception ex)
                {
                    notifyIcon.ShowBalloonTip(4000, "配置失败", ex.Message, ToolTipIcon.Warning);
                }
            }).Start();
        }

        static void ExitApp()
        {
            if (watchdogTimer != null)
            {
                try
                {
                    watchdogTimer.Stop();
                    watchdogTimer.Dispose();
                }
                catch { }
            }

            if (notifyIcon != null)
            {
                notifyIcon.Visible = false;
                notifyIcon.Dispose();
            }
            if (mutex != null)
            {
                try { mutex.ReleaseMutex(); } catch { }
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -Command \"Get-NetTCPConnection -LocalPort " + port + " -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -like '*node*') { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }\"");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
            }
            catch { }

            Application.Exit();
        }
    }
}
