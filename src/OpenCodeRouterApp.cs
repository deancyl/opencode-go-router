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
    public class MainForm : Form
    {
        [DllImport("user32.dll")]
        public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

        [DllImport("user32.dll")]
        public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

        [DllImport("user32.dll")]
        public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll")]
        public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        public static extern IntPtr SetFocus(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern uint RegisterWindowMessage(string lpString);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool AllowSetForegroundWindow(int dwProcessId);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool ChangeWindowMessageFilter(uint message, uint dwFlag);
        public const uint MSGFLT_ADD = 1;

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        private const int DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19;
        private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

        public const int GWL_STYLE = -16;
        public const int WS_VISIBLE = 0x10000000;
        public const int WS_CHILD = 0x40000000;
        public const int WS_CAPTION = 0x00C00000;
        public const int WS_THICKFRAME = 0x00040000;
        public const int WS_MINIMIZEBOX = 0x00020000;
        public const int WS_MAXIMIZEBOX = 0x00010000;
        public const int WS_SYSMENU = 0x00080000;

        public const int SW_RESTORE = 9;
        public static readonly IntPtr HWND_BROADCAST = new IntPtr(0xffff);
        public static uint WM_SHOW_OPENCODE_ROUTER = 0;

        private Panel container;
        private NotifyIcon notifyIcon;
        private Process browserProcess = null;
        private IntPtr browserHwnd = IntPtr.Zero;
        private bool isReallyExiting = false;
        private string rootDir;
        private string icoPath;
        private int port = 4010;
        private string uiPassword = "";
        private string targetUrl;

        public MainForm(string rootDirectory, string iconPath, string initialHash)
        {
            this.rootDir = rootDirectory;
            this.icoPath = iconPath;

            LoadConfig(rootDir);
            string authQuery = !string.IsNullOrEmpty(uiPassword) ? ("?auth=" + Uri.EscapeDataString(uiPassword)) : "";
            this.targetUrl = "http://127.0.0.1:" + port + "/balancer/ui" + authQuery + (string.IsNullOrEmpty(initialHash) ? "" : initialHash);

            WM_SHOW_OPENCODE_ROUTER = RegisterWindowMessage("WM_SHOW_OPENCODE_ROUTER_V35");
            try { ChangeWindowMessageFilter(WM_SHOW_OPENCODE_ROUTER, MSGFLT_ADD); } catch { }

            InitializeComponent();
            ApplyDarkMode();
            RestoreWindowBounds();
            SetupTrayIcon();

            this.Load += (s, e) => {
                EnsureRouterRunning();
                LaunchAndEmbedBrowser();
            };
        }

        private void LoadConfig(string dir)
        {
            try
            {
                string cfgPath = Path.Combine(dir, "config.json");
                if (File.Exists(cfgPath))
                {
                    string content = File.ReadAllText(cfgPath);
                    System.Text.RegularExpressions.Match mPort = System.Text.RegularExpressions.Regex.Match(content, @"""port""\s*:\s*(\d+)");
                    if (mPort.Success)
                    {
                        int p;
                        if (int.TryParse(mPort.Groups[1].Value, out p) && p > 0 && p < 65536)
                        {
                            this.port = p;
                        }
                    }
                    System.Text.RegularExpressions.Match mPw = System.Text.RegularExpressions.Regex.Match(content, @"""uiPassword""\s*:\s*""([^""]*)""");
                    if (mPw.Success)
                    {
                        this.uiPassword = mPw.Groups[1].Value;
                    }
                }
            }
            catch { }
        }

        private void InitializeComponent()
        {
            this.Text = "OpenCode 智能路由网关与调度中心 (v3.5.0)";
            this.Size = new Size(1240, 840);
            this.MinimumSize = new Size(960, 640);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(11, 17, 32);

            if (File.Exists(icoPath))
            {
                try { this.Icon = new Icon(icoPath); } catch { }
            }

            container = new Panel();
            container.Dock = DockStyle.Fill;
            container.BackColor = Color.FromArgb(11, 17, 32);
            container.Resize += (s, e) => {
                if (browserHwnd != IntPtr.Zero)
                {
                    MoveWindow(browserHwnd, 0, 0, container.Width, container.Height, true);
                }
            };
            this.Controls.Add(container);

            this.Activated += (s, e) => {
                if (browserHwnd != IntPtr.Zero)
                {
                    SetFocus(browserHwnd);
                }
            };
        }

        private void ApplyDarkMode()
        {
            try
            {
                int darkMode = 1;
                if (DwmSetWindowAttribute(this.Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref darkMode, sizeof(int)) != 0)
                {
                    DwmSetWindowAttribute(this.Handle, DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1, ref darkMode, sizeof(int));
                }
            }
            catch { }
        }

        private void RestoreWindowBounds()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\OpenCodeRouterApp\Window"))
                {
                    if (key != null)
                    {
                        int x = Convert.ToInt32(key.GetValue("X", this.Location.X));
                        int y = Convert.ToInt32(key.GetValue("Y", this.Location.Y));
                        int w = Convert.ToInt32(key.GetValue("Width", this.Size.Width));
                        int h = Convert.ToInt32(key.GetValue("Height", this.Size.Height));
                        int max = Convert.ToInt32(key.GetValue("Maximized", 0));

                        w = Math.Max(w, 800);
                        h = Math.Max(h, 600);
                        Rectangle targetRect = new Rectangle(x, y, w, h);

                        Screen targetScreen = null;
                        foreach (Screen scr in Screen.AllScreens)
                        {
                            if (scr.WorkingArea.IntersectsWith(targetRect))
                            {
                                targetScreen = scr;
                                break;
                            }
                        }

                        if (targetScreen == null)
                        {
                            targetScreen = Screen.PrimaryScreen;
                            x = targetScreen.WorkingArea.Left + (targetScreen.WorkingArea.Width - w) / 2;
                            y = targetScreen.WorkingArea.Top + (targetScreen.WorkingArea.Height - h) / 2;
                        }
                        else
                        {
                            // Ensure titlebar is visible and draggable on multi-monitor setups
                            if (y < targetScreen.WorkingArea.Top) y = targetScreen.WorkingArea.Top;
                            if (y > targetScreen.WorkingArea.Bottom - 60) y = targetScreen.WorkingArea.Bottom - 60;
                            if (x < targetScreen.WorkingArea.Left - w + 100) x = targetScreen.WorkingArea.Left;
                            if (x > targetScreen.WorkingArea.Right - 100) x = targetScreen.WorkingArea.Right - w;
                        }

                        this.StartPosition = FormStartPosition.Manual;
                        this.Location = new Point(x, y);
                        this.Size = new Size(w, h);

                        if (max == 1)
                        {
                            this.WindowState = FormWindowState.Maximized;
                        }
                    }
                }
            }
            catch { }
        }

        private void SaveWindowBounds()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\OpenCodeRouterApp\Window"))
                {
                    if (key != null)
                    {
                        Rectangle boundsToSave = (this.WindowState == FormWindowState.Normal) ? this.Bounds : this.RestoreBounds;
                        key.SetValue("X", boundsToSave.X);
                        key.SetValue("Y", boundsToSave.Y);
                        key.SetValue("Width", boundsToSave.Width);
                        key.SetValue("Height", boundsToSave.Height);
                        key.SetValue("Maximized", (this.WindowState == FormWindowState.Maximized) ? 1 : 0);
                    }
                }
            }
            catch { }
        }

        private void SetupTrayIcon()
        {
            notifyIcon = new NotifyIcon();
            if (File.Exists(icoPath))
            {
                try { notifyIcon.Icon = new Icon(icoPath); }
                catch { notifyIcon.Icon = SystemIcons.Application; }
            }
            else
            {
                notifyIcon.Icon = SystemIcons.Application;
            }

            notifyIcon.Text = "OpenCode 智能路由网关 (端口: " + port + ")";
            notifyIcon.Visible = true;
            notifyIcon.DoubleClick += (s, e) => ShowAndActivate();

            ContextMenuStrip menu = new ContextMenuStrip();

            ToolStripMenuItem menuOpen = new ToolStripMenuItem("🚀 打开管理控制台");
            menuOpen.Font = new Font(menuOpen.Font, FontStyle.Bold);
            menuOpen.Click += (s, e) => ShowAndActivate();
            menu.Items.Add(menuOpen);

            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem menuChamber = new ToolStripMenuItem("💻 打开 OpenChamber 工作台 (3000)");
            menuChamber.Click += (s, e) => {
                try { Process.Start("http://127.0.0.1:3000"); } catch { }
            };
            menu.Items.Add(menuChamber);

            ToolStripMenuItem menuStatus = new ToolStripMenuItem("🔍 检查网关服务状态");
            menuStatus.Click += (s, e) => CheckStatus();
            menu.Items.Add(menuStatus);

            ToolStripMenuItem menuDoctor = new ToolStripMenuItem("🩺 系统环境自检与修复");
            menuDoctor.Click += (s, e) => RunDoctor();
            menu.Items.Add(menuDoctor);

            ToolStripMenuItem menuResetCooldown = new ToolStripMenuItem("⚡ 一键重置限频冷却");
            menuResetCooldown.Click += (s, e) => ResetCooldown();
            menu.Items.Add(menuResetCooldown);

            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem menuExit = new ToolStripMenuItem("❌ 彻底退出程序");
            menuExit.Click += (s, e) => ExitApplication();
            menu.Items.Add(menuExit);

            notifyIcon.ContextMenuStrip = menu;
        }

        public void ShowAndActivate(int tabCode = 0)
        {
            if (!this.Visible) this.Show();
            if (this.WindowState == FormWindowState.Minimized)
            {
                this.WindowState = FormWindowState.Normal;
            }
            this.Activate();
            SetForegroundWindow(this.Handle);
            if (browserHwnd != IntPtr.Zero)
            {
                SetFocus(browserHwnd);
                MoveWindow(browserHwnd, 0, 0, container.Width, container.Height, true);
            }

            if (tabCode > 0)
            {
                string hash = "";
                switch (tabCode)
                {
                    case 1: hash = "#/overview"; break;
                    case 2: hash = "#/compression"; break;
                    case 3: hash = "#/clients"; break;
                    case 4: hash = "#/accounts"; break;
                    case 5: hash = "#/doctor"; break;
                    case 6: hash = "#/settings"; break;
                }
                if (!string.IsNullOrEmpty(hash))
                {
                    NavigateToTab(hash);
                }
            }
        }

        private void NavigateToTab(string hash)
        {
            try
            {
                string browserExe = FindBrowserExe();
                if (!string.IsNullOrEmpty(browserExe))
                {
                    string appProfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenCodeRouter", "NativeProfile");
                    string authQuery = !string.IsNullOrEmpty(uiPassword) ? ("?auth=" + Uri.EscapeDataString(uiPassword)) : "";
                    string navUrl = "http://127.0.0.1:" + port + "/balancer/ui" + authQuery + hash;
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = browserExe;
                    psi.Arguments = "--app=\"" + navUrl + "\" --user-data-dir=\"" + appProfile + "\"";
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    Process.Start(psi);
                }
            }
            catch { }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            SaveWindowBounds();
            if (!isReallyExiting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                this.Hide();
                if (notifyIcon != null)
                {
                    try
                    {
                        notifyIcon.ShowBalloonTip(2500, "OpenCode 智能网关已最小化至托盘",
                            "后台高可用路由持续运行中。双击托盘图标可重新打开，右键托盘菜单可彻底退出。", ToolTipIcon.Info);
                    }
                    catch { }
                }
                return;
            }

            // Real exit cleanup
            if (notifyIcon != null)
            {
                notifyIcon.Visible = false;
                notifyIcon.Dispose();
            }

            TerminateBrowserProcess();

            base.OnFormClosing(e);
        }

        private void TerminateBrowserProcess()
        {
            if (browserProcess != null)
            {
                try
                {
                    if (!browserProcess.HasExited)
                    {
                        browserProcess.CloseMainWindow();
                        if (!browserProcess.WaitForExit(350))
                        {
                            // Eradicate entire process tree to prevent orphaned GPU / renderer zombie processes
                            ProcessStartInfo killPsi = new ProcessStartInfo("taskkill.exe", "/pid " + browserProcess.Id + " /T /F");
                            killPsi.CreateNoWindow = true;
                            killPsi.UseShellExecute = false;
                            Process.Start(killPsi);
                        }
                    }
                }
                catch { }
                browserProcess = null;
            }
        }

        protected override void WndProc(ref Message m)
        {
            if (WM_SHOW_OPENCODE_ROUTER != 0 && m.Msg == WM_SHOW_OPENCODE_ROUTER)
            {
                int tabCode = m.WParam.ToInt32();
                ShowAndActivate(tabCode);
                return;
            }
            base.WndProc(ref m);
        }

        private void LaunchAndEmbedBrowser()
        {
            string browserExe = FindBrowserExe();
            if (string.IsNullOrEmpty(browserExe))
            {
                MessageBox.Show("未检测到 Microsoft Edge 或 Google Chrome 浏览器，无法初始化原生窗口内核。",
                    "OpenCode 智能网关", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            string appProfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenCodeRouter", "NativeProfile");
            try { if (!Directory.Exists(appProfile)) Directory.CreateDirectory(appProfile); } catch { }

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = browserExe;
            psi.Arguments = "--app=\"" + targetUrl + "\" --user-data-dir=\"" + appProfile + "\" --no-first-run --no-default-browser-check --disable-background-networking --disable-background-mode --disable-features=msEdgeStartupBoost --window-size=1240,840";
            psi.UseShellExecute = false;

            try
            {
                browserProcess = Process.Start(psi);
                if (browserProcess == null) return;

                // Asynchronously wait for browser HWND and reparent
                Thread reparentThread = new Thread(() => {
                    IntPtr foundHwnd = IntPtr.Zero;
                    for (int i = 0; i < 40; i++)
                    {
                        Thread.Sleep(120);
                        if (browserProcess.HasExited) break;

                        // Try finding Chrome_WidgetWin_1 window for process tree
                        foundHwnd = FindBrowserWindowForProcess(browserProcess.Id);
                        if (foundHwnd != IntPtr.Zero) break;
                    }

                    if (foundHwnd != IntPtr.Zero && !this.IsDisposed && this.IsHandleCreated)
                    {
                        this.Invoke((MethodInvoker)delegate {
                            try
                            {
                                browserHwnd = foundHwnd;
                                int style = GetWindowLong(browserHwnd, GWL_STYLE);
                                style = (style & ~WS_CAPTION & ~WS_THICKFRAME & ~WS_MINIMIZEBOX & ~WS_MAXIMIZEBOX & ~WS_SYSMENU) | WS_CHILD | WS_VISIBLE;
                                SetWindowLong(browserHwnd, GWL_STYLE, style);
                                SetParent(browserHwnd, container.Handle);
                                MoveWindow(browserHwnd, 0, 0, container.Width, container.Height, true);
                                SetFocus(browserHwnd);
                            }
                            catch { }
                        });
                    }
                });
                reparentThread.IsBackground = true;
                reparentThread.Start();
            }
            catch (Exception ex)
            {
                MessageBox.Show("启动桌面内核失败: " + ex.Message, "OpenCode 智能网关", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private IntPtr FindBrowserWindowForProcess(int targetPid)
        {
            IntPtr result = IntPtr.Zero;
            EnumWindows((hWnd, lParam) => {
                if (!IsWindowVisible(hWnd)) return true;
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                if (pid == targetPid)
                {
                    StringBuilder sb = new StringBuilder(256);
                    GetClassName(hWnd, sb, 256);
                    string className = sb.ToString();
                    if (className.Contains("Chrome_WidgetWin_1"))
                    {
                        result = hWnd;
                        return false;
                    }
                }
                return true;
            }, IntPtr.Zero);

            if (result == IntPtr.Zero && browserProcess != null && browserProcess.MainWindowHandle != IntPtr.Zero)
            {
                result = browserProcess.MainWindowHandle;
            }
            return result;
        }

        private string FindBrowserExe()
        {
            string[] candidates = new string[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
            };
            foreach (string p in candidates)
            {
                if (File.Exists(p)) return p;
            }
            return null;
        }

        private void EnsureRouterRunning()
        {
            try
            {
                if (IsServerReady(port)) return;

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

                for (int i = 0; i < 25; i++)
                {
                    Thread.Sleep(120);
                    if (IsServerReady(port)) break;
                }
            }
            catch { }
        }

        private bool IsServerReady(int targetPort)
        {
            if (!IsPortListening(targetPort)) return false;
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + targetPort + "/balancer/ui");
                req.Method = "HEAD";
                req.Timeout = 250;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return true;
                }
            }
            catch (WebException wex)
            {
                if (wex.Response != null) return true;
            }
            catch { }
            return true;
        }

        private bool IsPortListening(int targetPort)
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

        private void CheckStatus()
        {
            try
            {
                bool listening = IsPortListening(port);
                if (listening)
                {
                    notifyIcon.ShowBalloonTip(3000, "OpenCode 智能网关状态正常", "端口 " + port + " 正在监听，高可用路由运作中！", ToolTipIcon.Info);
                }
                else
                {
                    notifyIcon.ShowBalloonTip(3000, "OpenCode 智能网关离线", "端口 " + port + " 未监听，正在自动拉起...", ToolTipIcon.Warning);
                    EnsureRouterRunning();
                }
            }
            catch { }
        }

        private void ResetCooldown()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/balancer/api/reset-cooldown");
                req.Method = "POST";
                req.ContentLength = 0;
                req.Timeout = 3000;
                if (!string.IsNullOrEmpty(uiPassword))
                {
                    string b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(uiPassword.Trim()));
                    req.Headers["Authorization"] = "Bearer " + b64;
                }
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    if (resp.StatusCode == HttpStatusCode.OK)
                    {
                        notifyIcon.ShowBalloonTip(2000, "限频重置成功", "已立即解除全部 429 限频账号的冷却锁定！", ToolTipIcon.Info);
                    }
                }
            }
            catch (Exception ex)
            {
                notifyIcon.ShowBalloonTip(2000, "操作失败", "重置限频失败: " + ex.Message, ToolTipIcon.Error);
            }
        }

        private void RunDoctor()
        {
            try
            {
                string psScript = Path.Combine(rootDir, "doctor-repair.ps1");
                if (File.Exists(psScript))
                {
                    ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File \"" + psScript + "\"");
                    psi.WorkingDirectory = rootDir;
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                }
            }
            catch { }
        }

        public void ExitApplication()
        {
            isReallyExiting = true;
            this.Close();
            Application.Exit();
        }
    }

    static class Program
    {
        private static Mutex mutex = null;
        public const int ASFW_ANY = -1;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool AllowSetForegroundWindow(int dwProcessId);

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string rootDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            if (!File.Exists(Path.Combine(rootDir, "server.js")))
            {
                string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string candidate = Path.Combine(userProfile, ".opencode-go-router");
                if (File.Exists(Path.Combine(candidate, "server.js")))
                {
                    rootDir = candidate;
                }
            }

            string icoPath = Path.Combine(rootDir, "assets", "router.ico");

            int tabCode = 0;
            string initialHash = "";
            if (args != null && args.Length > 0 && !string.IsNullOrEmpty(args[0]))
            {
                string arg = args[0].ToLowerInvariant();
                if (arg.Contains("overview")) tabCode = 1;
                else if (arg.Contains("compress") || arg.Contains("comp")) tabCode = 2;
                else if (arg.Contains("client") || arg.Contains("codex")) tabCode = 3;
                else if (arg.Contains("account")) tabCode = 4;
                else if (arg.Contains("doctor") || arg.Contains("heal") || arg.Contains("repair")) tabCode = 5;
                else if (arg.Contains("setting") || arg.Contains("update") || arg.Contains("config")) tabCode = 6;

                if (args[0].StartsWith("#")) initialHash = args[0];
            }

            bool createdNew = false;
            try
            {
                mutex = new Mutex(true, @"Local\OpenCodeRouterAppSingleInstanceMutex_v35", out createdNew);
            }
            catch
            {
                createdNew = true;
            }

            if (!createdNew)
            {
                // Another instance is already running -> grant foreground lock and activate it
                try { AllowSetForegroundWindow(ASFW_ANY); } catch { }
                uint wmShow = MainForm.RegisterWindowMessage("WM_SHOW_OPENCODE_ROUTER_V35");
                if (wmShow != 0)
                {
                    MainForm.PostMessage(MainForm.HWND_BROADCAST, wmShow, new IntPtr(tabCode), IntPtr.Zero);
                }
                return;
            }

            MainForm form = new MainForm(rootDir, icoPath, initialHash);
            Application.Run(form);

            if (mutex != null)
            {
                try { mutex.ReleaseMutex(); } catch { }
            }
        }
    }
}
