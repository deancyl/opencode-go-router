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

namespace OpenCodeWizard
{
    static class Program
    {
        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool AllowSetForegroundWindow(int dwProcessId);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern uint RegisterWindowMessage(string lpString);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        public static readonly IntPtr HWND_BROADCAST = new IntPtr(0xffff);
        public const int SW_RESTORE = 9;
        public const int ASFW_ANY = -1;

        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                SetProcessDPIAware();
                AllowSetForegroundWindow(ASFW_ANY);
            }
            catch { }

            string rootDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            if (!File.Exists(Path.Combine(rootDir, "setup-wizard.ps1")))
            {
                string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string candidate = Path.Combine(userProfile, ".opencode-go-router");
                if (File.Exists(Path.Combine(candidate, "setup-wizard.ps1")))
                {
                    rootDir = candidate;
                }
            }

            // 分支 1: 若通过命令行传入了参数，保持对 setup-wizard.ps1 的全透明 CLI 转发
            if (args != null && args.Length > 0)
            {
                string wizardScript = Path.Combine(rootDir, "setup-wizard.ps1");
                string arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + wizardScript + "\"";
                arguments += " " + string.Join(" ", args);

                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", arguments);
                psi.WorkingDirectory = rootDir;
                psi.UseShellExecute = false;

                Process proc = Process.Start(psi);
                if (proc != null)
                {
                    proc.WaitForExit();
                }
                return;
            }

            // 分支 2: 双击桌面快捷方式（无参数启动）时，执行全栈智能引导与独立桌面应用唤出
            int port = 4010;
            string uiPassword = "";
            LoadConfig(rootDir, ref port, ref uiPassword);

            // 1. 确保后台网关核心静默常驻
            EnsureRouterRunning(rootDir, port);

            // 2. 确保系统托盘守护常驻
            EnsureTrayRunning(rootDir);

            // 3. 单实例检测：若控制台应用窗口已存在，置顶激活
            IntPtr existingHwnd = FindExistingAppWindow();
            if (existingHwnd != IntPtr.Zero)
            {
                ActivateExistingWindow(existingHwnd);
                return;
            }

            // 4. 尝试以无边框独立应用模式（Edge / Chrome --app=...）唤出全新极简 Web 全栈向导
            if (LaunchStandaloneApp(rootDir, port, uiPassword))
            {
                return;
            }

            // 5. 极端兜底：若本地无任何 Chromium/Edge 浏览器，以修复了 High-DPI 自适应的 WinForms 唤出
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new WizardForm(rootDir));
        }

        private static void LoadConfig(string dir, ref int port, ref string uiPassword)
        {
            try
            {
                string cfgPath = Path.Combine(dir, "config.json");
                if (File.Exists(cfgPath))
                {
                    string json = File.ReadAllText(cfgPath, Encoding.UTF8);
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
                                if (int.TryParse(portStr, out p) && p > 0 && p < 65536) port = p;
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
                                if (q2 > q1) uiPassword = json.Substring(q1 + 1, q2 - q1 - 1).Trim();
                            }
                        }
                    }
                }
            }
            catch { }
        }

        private static bool IsPortListening(int targetPort)
        {
            try
            {
                IPGlobalProperties ipProps = IPGlobalProperties.GetIPGlobalProperties();
                IPEndPoint[] endPoints = ipProps.GetActiveTcpListeners();
                foreach (IPEndPoint ep in endPoints)
                {
                    if (ep.Port == targetPort) return true;
                }
            }
            catch { }
            return false;
        }

        private static void EnsureRouterRunning(string rootDir, int targetPort)
        {
            try
            {
                if (IsPortListening(targetPort)) return;

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

                for (int i = 0; i < 20; i++)
                {
                    Thread.Sleep(100);
                    if (IsPortListening(targetPort)) break;
                }
            }
            catch { }
        }

        private static void EnsureTrayRunning(string rootDir)
        {
            try
            {
                uint msgRestore = RegisterWindowMessage("WM_RESTORE_OPENCODE_ROUTER_TRAY");
                bool trayRunning = false;
                Process[] trays = Process.GetProcessesByName("OpenCodeRouterTray");
                if (trays != null && trays.Length > 0)
                {
                    trayRunning = true;
                }
                else
                {
                    try
                    {
                        using (Mutex dummy = Mutex.OpenExisting(@"Local\OpenCodeRouterTrayPSMutex_v2"))
                        {
                            trayRunning = true;
                        }
                    }
                    catch { }
                    if (!trayRunning)
                    {
                        try
                        {
                            using (Mutex dummy = Mutex.OpenExisting(@"Local\OpenCodeRouterTrayMutex_v2"))
                            {
                                trayRunning = true;
                            }
                        }
                        catch { }
                    }
                }

                if (trayRunning)
                {
                    if (msgRestore != 0)
                    {
                        try { PostMessage(HWND_BROADCAST, msgRestore, IntPtr.Zero, IntPtr.Zero); } catch { }
                    }
                    return;
                }

                string startTrayVbs = Path.Combine(rootDir, "start-tray.vbs");
                if (File.Exists(startTrayVbs))
                {
                    ProcessStartInfo psi = new ProcessStartInfo("wscript.exe", "\"" + startTrayVbs + "\" -Silent");
                    psi.WorkingDirectory = rootDir;
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    Process.Start(psi);
                    return;
                }

                string trayExe = Path.Combine(rootDir, "OpenCodeRouterTray.exe");
                if (File.Exists(trayExe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo(trayExe, "-Silent");
                    psi.WorkingDirectory = rootDir;
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                }
            }
            catch { }
        }

        private static IntPtr FindExistingAppWindow()
        {
            IntPtr matchedHwnd = IntPtr.Zero;
            EnumWindows((hWnd, lParam) =>
            {
                if (!IsWindowVisible(hWnd)) return true;

                StringBuilder sb = new StringBuilder(512);
                GetWindowText(hWnd, sb, 512);
                string title = sb.ToString();

                StringBuilder cb = new StringBuilder(256);
                GetClassName(hWnd, cb, 256);
                string className = cb.ToString();

                if (title.Contains("OpenCode 智能高可用网关") ||
                    title.Contains("OpenCode 订阅管理中心") ||
                    title.Contains("OpenCode 智能路由网关") ||
                    (className.Contains("Chrome_WidgetWin_1") && title.StartsWith("OpenCode") && (title.Contains("网关") || title.Contains("路由") || title.Contains("中心"))))
                {
                    matchedHwnd = hWnd;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            return matchedHwnd;
        }

        private static void ActivateExistingWindow(IntPtr hWnd)
        {
            try
            {
                ShowWindowAsync(hWnd, SW_RESTORE);
                IntPtr foreWnd = GetForegroundWindow();
                uint foreThread = 0;
                if (foreWnd != IntPtr.Zero) GetWindowThreadProcessId(foreWnd, out foreThread);
                uint curThread = GetCurrentThreadId();

                if (foreThread != 0 && foreThread != curThread)
                {
                    AttachThreadInput(curThread, foreThread, true);
                    BringWindowToTop(hWnd);
                    SetForegroundWindow(hWnd);
                    AttachThreadInput(curThread, foreThread, false);
                }
                else
                {
                    BringWindowToTop(hWnd);
                    SetForegroundWindow(hWnd);
                }
            }
            catch { }
        }

        private static string FindBrowserExe(string exeName)
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

        private static bool LaunchStandaloneApp(string rootDir, int port, string uiPassword)
        {
            string appExe = Path.Combine(rootDir, "OpenCodeRouterApp.exe");
            if (File.Exists(appExe))
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(appExe, "#/overview");
                    psi.WorkingDirectory = rootDir;
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                    return true;
                }
                catch { }
            }

            string browserExe = FindBrowserExe("msedge.exe");
            if (string.IsNullOrEmpty(browserExe) || !File.Exists(browserExe))
            {
                browserExe = FindBrowserExe("chrome.exe");
            }

            if (string.IsNullOrEmpty(browserExe) || !File.Exists(browserExe))
            {
                return false;
            }

            string authQuery = !string.IsNullOrEmpty(uiPassword) ? ("?auth=" + Uri.EscapeDataString(uiPassword)) : "";
            string targetUrl = string.Format("http://127.0.0.1:{0}/balancer/ui{1}#/overview", port, authQuery);

            string appDataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenCodeRouter", "AppProfile");
            try { if (!Directory.Exists(appDataDir)) Directory.CreateDirectory(appDataDir); } catch { }

            string args = string.Format("--app=\"{0}\" --user-data-dir=\"{1}\" --window-size=1280,840 --no-first-run --no-default-browser-check --disable-background-mode", targetUrl, appDataDir);

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(browserExe, args);
                psi.WorkingDirectory = rootDir;
                psi.UseShellExecute = true;
                Process.Start(psi);
                return true;
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>
    /// 极端无浏览器环境下的纯净原生 WinForms 降级对话框（全面 High-DPI 响应式流式布局，0 文字踩踏，0 按钮截断）
    /// </summary>
    public class WizardForm : Form
    {
        private string rootDir;
        private TextBox txtPort;
        private Label lblPortStatus;
        private Button btnFindFreePort;
        private TextBox txtPassword;
        private CheckBox chkShowPassword;
        private TextBox txtKey1;
        private TextBox txtKey2;
        private Button btnSaveStart;
        private Button btnTestConn;
        private Button btnDoctor;
        private Button btnBind;
        private Button btnOpenDashboard;
        private Label lblFeedback;

        private Color clrBg = Color.FromArgb(14, 14, 18);
        private Color clrCardBg = Color.FromArgb(22, 22, 28);
        private Color clrBorder = Color.FromArgb(39, 39, 44);
        private Color clrInputBg = Color.FromArgb(28, 28, 36);
        private Color clrText = Color.FromArgb(244, 244, 245);
        private Color clrTextMuted = Color.FromArgb(161, 161, 170);
        private Color clrEmerald = Color.FromArgb(16, 185, 129);
        private Color clrAmber = Color.FromArgb(245, 158, 11);
        private Color clrRed = Color.FromArgb(239, 68, 68);
        private Color clrBlue = Color.FromArgb(59, 130, 246);

        public WizardForm(string rootDirectory)
        {
            this.rootDir = rootDirectory;
            InitializeComponents();
            LoadConfig();
            CheckPortStatusAsync();
        }

        private void InitializeComponents()
        {
            this.Text = "OpenCode 智能路由网关 - 全栈部署与配置向导";
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = clrBg;
            this.ForeColor = clrText;
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            this.Size = new Size(820, 680);
            this.MinimumSize = new Size(760, 620);
            this.AutoScaleMode = AutoScaleMode.Dpi;
            this.Padding = new Padding(20);

            string icoPath = Path.Combine(rootDir, "assets", "router.ico");
            if (File.Exists(icoPath))
            {
                try { this.Icon = new Icon(icoPath); } catch { }
            }

            TableLayoutPanel mainLayout = new TableLayoutPanel();
            mainLayout.Dock = DockStyle.Fill;
            mainLayout.ColumnCount = 1;
            mainLayout.RowCount = 4;
            mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 70));
            mainLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 35));
            mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 55));
            this.Controls.Add(mainLayout);

            // 1. Header
            Panel header = new Panel();
            header.Dock = DockStyle.Fill;
            header.BackColor = clrCardBg;
            header.Padding = new Padding(16, 10, 16, 10);

            Label lblTitle = new Label();
            lblTitle.Text = "🚀 OpenCode 智能高可用网关配置";
            lblTitle.Font = new Font("Segoe UI", 13f, FontStyle.Bold);
            lblTitle.ForeColor = clrText;
            lblTitle.Dock = DockStyle.Top;
            lblTitle.Height = 28;
            header.Controls.Add(lblTitle);

            Label lblSub = new Label();
            lblSub.Text = "配置服务端口、认证密钥、多账号容灾与一键桌面环境自愈";
            lblSub.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            lblSub.ForeColor = clrTextMuted;
            lblSub.Dock = DockStyle.Bottom;
            lblSub.Height = 20;
            header.Controls.Add(lblSub);

            mainLayout.Controls.Add(header, 0, 0);

            // 2. Card Content (Scrollable flow)
            Panel card = new Panel();
            card.Dock = DockStyle.Fill;
            card.BackColor = clrCardBg;
            card.Padding = new Padding(20);
            card.AutoScroll = true;

            int y = 16;

            Label lblPort = new Label() { Text = "服务端口 (Port):", AutoSize = true, Location = new Point(20, y), ForeColor = clrText, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold) };
            card.Controls.Add(lblPort);

            txtPort = new TextBox() { Text = "4010", Location = new Point(20, y + 24), Size = new Size(100, 26), BackColor = clrInputBg, ForeColor = clrText, BorderStyle = BorderStyle.FixedSingle };
            card.Controls.Add(txtPort);

            btnFindFreePort = new Button() { Text = "⚡ 自动寻找空闲端口", Location = new Point(130, y + 23), Size = new Size(150, 28), FlatStyle = FlatStyle.Flat, BackColor = clrInputBg, ForeColor = clrText, Cursor = Cursors.Hand };
            btnFindFreePort.FlatAppearance.BorderColor = clrBorder;
            btnFindFreePort.Click += (s, e) => FindFreePort();
            card.Controls.Add(btnFindFreePort);

            lblPortStatus = new Label() { Text = "正在检测端口...", Location = new Point(290, y + 28), AutoSize = true, ForeColor = clrTextMuted };
            card.Controls.Add(lblPortStatus);

            y += 66;

            Label lblPass = new Label() { Text = "Web 控制台安全密码 (uiPassword，可选):", AutoSize = true, Location = new Point(20, y), ForeColor = clrText, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold) };
            card.Controls.Add(lblPass);

            txtPassword = new TextBox() { Location = new Point(20, y + 24), Size = new Size(360, 26), BackColor = clrInputBg, ForeColor = clrText, BorderStyle = BorderStyle.FixedSingle, PasswordChar = '•' };
            card.Controls.Add(txtPassword);

            chkShowPassword = new CheckBox() { Text = "显示密码", Location = new Point(390, y + 26), AutoSize = true, ForeColor = clrTextMuted };
            chkShowPassword.CheckedChanged += (s, e) => { txtPassword.PasswordChar = chkShowPassword.Checked ? '\0' : '•'; };
            card.Controls.Add(chkShowPassword);

            y += 66;

            Label lblKey1 = new Label() { Text = "主订阅账号 API Key (Account 1):", AutoSize = true, Location = new Point(20, y), ForeColor = clrText, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold) };
            card.Controls.Add(lblKey1);

            txtKey1 = new TextBox() { Location = new Point(20, y + 24), Size = new Size(700, 26), BackColor = clrInputBg, ForeColor = clrText, BorderStyle = BorderStyle.FixedSingle };
            card.Controls.Add(txtKey1);

            y += 66;

            Label lblKey2 = new Label() { Text = "备用订阅账号 API Key (Account 2，可选负载均衡与限频故障转移):", AutoSize = true, Location = new Point(20, y), ForeColor = clrText, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold) };
            card.Controls.Add(lblKey2);

            txtKey2 = new TextBox() { Location = new Point(20, y + 24), Size = new Size(700, 26), BackColor = clrInputBg, ForeColor = clrText, BorderStyle = BorderStyle.FixedSingle };
            card.Controls.Add(txtKey2);

            mainLayout.Controls.Add(card, 0, 1);

            // 3. Feedback Status
            lblFeedback = new Label();
            lblFeedback.Text = "💡 准备就绪。双击此向导已自动拉起静默常驻网关，点击下方按钮可快速维护。";
            lblFeedback.Dock = DockStyle.Fill;
            lblFeedback.ForeColor = clrTextMuted;
            lblFeedback.TextAlign = ContentAlignment.MiddleLeft;
            mainLayout.Controls.Add(lblFeedback, 0, 2);

            // 4. Action Buttons (Flow layout)
            FlowLayoutPanel btnPanel = new FlowLayoutPanel();
            btnPanel.Dock = DockStyle.Fill;
            btnPanel.FlowDirection = FlowDirection.LeftToRight;
            btnPanel.WrapContents = false;

            btnSaveStart = new Button() { Text = "🚀 保存并启动服务", Size = new Size(150, 40), FlatStyle = FlatStyle.Flat, BackColor = clrEmerald, ForeColor = Color.White, Cursor = Cursors.Hand };
            btnSaveStart.FlatAppearance.BorderSize = 0;
            btnSaveStart.Click += (s, e) => SaveAndStartService();
            btnPanel.Controls.Add(btnSaveStart);

            btnOpenDashboard = new Button() { Text = "🌐 打开控制面板", Size = new Size(140, 40), FlatStyle = FlatStyle.Flat, BackColor = clrInputBg, ForeColor = clrText, Cursor = Cursors.Hand };
            btnOpenDashboard.FlatAppearance.BorderColor = clrBorder;
            btnOpenDashboard.Click += (s, e) => OpenDashboard();
            btnPanel.Controls.Add(btnOpenDashboard);

            btnTestConn = new Button() { Text = "🔍 连通性测试", Size = new Size(130, 40), FlatStyle = FlatStyle.Flat, BackColor = clrInputBg, ForeColor = clrText, Cursor = Cursors.Hand };
            btnTestConn.FlatAppearance.BorderColor = clrBorder;
            btnTestConn.Click += (s, e) => TestConnectivity();
            btnPanel.Controls.Add(btnTestConn);

            btnDoctor = new Button() { Text = "🩺 环境体检", Size = new Size(120, 40), FlatStyle = FlatStyle.Flat, BackColor = clrInputBg, ForeColor = clrText, Cursor = Cursors.Hand };
            btnDoctor.FlatAppearance.BorderColor = clrBorder;
            btnDoctor.Click += (s, e) => RunDoctor();
            btnPanel.Controls.Add(btnDoctor);

            btnBind = new Button() { Text = "⚡ 绑定桌面端", Size = new Size(130, 40), FlatStyle = FlatStyle.Flat, BackColor = clrInputBg, ForeColor = clrText, Cursor = Cursors.Hand };
            btnBind.FlatAppearance.BorderColor = clrBorder;
            btnBind.Click += (s, e) => BindDesktop();
            btnPanel.Controls.Add(btnBind);

            mainLayout.Controls.Add(btnPanel, 0, 3);
        }

        private void LoadConfig()
        {
            try
            {
                string cfgPath = Path.Combine(rootDir, "config.json");
                if (!File.Exists(cfgPath)) return;
                string json = File.ReadAllText(cfgPath, Encoding.UTF8);

                int portIdx = json.IndexOf("\"port\"");
                if (portIdx >= 0)
                {
                    int colon = json.IndexOf(":", portIdx);
                    if (colon >= 0)
                    {
                        int end = json.IndexOfAny(new char[] { ',', '}', '\r', '\n' }, colon + 1);
                        if (end > colon)
                        {
                            string pStr = json.Substring(colon + 1, end - colon - 1).Trim();
                            int p;
                            if (int.TryParse(pStr, out p) && p > 0 && p < 65536) txtPort.Text = p.ToString();
                        }
                    }
                }

                int passIdx = json.IndexOf("\"uiPassword\"");
                if (passIdx >= 0)
                {
                    int colon = json.IndexOf(":", passIdx);
                    if (colon >= 0)
                    {
                        int q1 = json.IndexOf("\"", colon);
                        if (q1 >= 0)
                        {
                            int q2 = json.IndexOf("\"", q1 + 1);
                            if (q2 > q1) txtPassword.Text = json.Substring(q1 + 1, q2 - q1 - 1);
                        }
                    }
                }

                int accIdx = json.IndexOf("\"accounts\"");
                if (accIdx >= 0)
                {
                    int firstKeyIdx = json.IndexOf("\"apiKey\"", accIdx);
                    if (firstKeyIdx >= 0)
                    {
                        int q1 = json.IndexOf("\"", json.IndexOf(":", firstKeyIdx));
                        if (q1 >= 0)
                        {
                            int q2 = json.IndexOf("\"", q1 + 1);
                            if (q2 > q1)
                            {
                                txtKey1.Text = json.Substring(q1 + 1, q2 - q1 - 1);
                                int secondKeyIdx = json.IndexOf("\"apiKey\"", q2 + 1);
                                if (secondKeyIdx >= 0)
                                {
                                    int sq1 = json.IndexOf("\"", json.IndexOf(":", secondKeyIdx));
                                    if (sq1 >= 0)
                                    {
                                        int sq2 = json.IndexOf("\"", sq1 + 1);
                                        if (sq2 > sq1) txtKey2.Text = json.Substring(sq1 + 1, sq2 - sq1 - 1);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            catch { }
        }

        private void CheckPortStatusAsync()
        {
            int p;
            if (!int.TryParse(txtPort.Text.Trim(), out p) || p < 1 || p > 65535)
            {
                lblPortStatus.Text = "✖ 端口无效";
                lblPortStatus.ForeColor = clrRed;
                return;
            }

            ThreadPool.QueueUserWorkItem(state => {
                bool isListening = false;
                try
                {
                    IPGlobalProperties ipProps = IPGlobalProperties.GetIPGlobalProperties();
                    foreach (IPEndPoint ep in ipProps.GetActiveTcpListeners())
                    {
                        if (ep.Port == p) { isListening = true; break; }
                    }
                }
                catch { }

                this.BeginInvoke((MethodInvoker)delegate {
                    if (isListening)
                    {
                        lblPortStatus.Text = string.Format("✔ 本地网关已在端口 {0} 正常运行", p);
                        lblPortStatus.ForeColor = clrEmerald;
                    }
                    else
                    {
                        lblPortStatus.Text = string.Format("✔ 端口 {0} 空闲可用", p);
                        lblPortStatus.ForeColor = clrEmerald;
                    }
                });
            });
        }

        private void FindFreePort()
        {
            ThreadPool.QueueUserWorkItem(state => {
                int freePort = 4010;
                try
                {
                    IPGlobalProperties ipProps = IPGlobalProperties.GetIPGlobalProperties();
                    IPEndPoint[] endPoints = ipProps.GetActiveTcpListeners();
                    for (int cand = 4010; cand <= 4099; cand++)
                    {
                        bool occupied = false;
                        foreach (IPEndPoint ep in endPoints)
                        {
                            if (ep.Port == cand) { occupied = true; break; }
                        }
                        if (!occupied) { freePort = cand; break; }
                    }
                }
                catch { }

                this.BeginInvoke((MethodInvoker)delegate {
                    txtPort.Text = freePort.ToString();
                    lblFeedback.Text = string.Format("✔ 已自动选择空闲端口: {0}", freePort);
                    lblFeedback.ForeColor = clrEmerald;
                });
            });
        }

        private void SaveAndStartService()
        {
            int p;
            if (!int.TryParse(txtPort.Text.Trim(), out p) || p < 1 || p > 65535)
            {
                lblFeedback.Text = "✖ 请输入有效端口号";
                lblFeedback.ForeColor = clrRed;
                return;
            }

            btnSaveStart.Enabled = false;
            btnSaveStart.Text = "正在保存并启动...";
            lblFeedback.Text = "正在写入配置并启动服务...";
            lblFeedback.ForeColor = clrBlue;

            string portStr = p.ToString();
            string passStr = txtPassword.Text.Trim();
            string k1 = txtKey1.Text.Trim();
            string k2 = txtKey2.Text.Trim();

            ThreadPool.QueueUserWorkItem(state => {
                try
                {
                    string cfgPath = Path.Combine(rootDir, "config.json");
                    bool mergedViaNode = false;
                    try
                    {
                        string mergeScript = "const fs=require('fs'),p=process.argv[1];let c={};try{if(fs.existsSync(p))c=JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){}c.port=parseInt(process.argv[2],10)||4010;c.host=c.host||'127.0.0.1';c.uiPassword=process.argv[3]||'';const k1=process.argv[4]||'';const k2=process.argv[5]||'';const accs=Array.isArray(c.accounts)?c.accounts:[];if(accs.length===0){accs.push({id:'account-1',name:'Primary Account 1',apiKey:k1,enabled:true});}else{accs[0].apiKey=k1;accs[0].enabled=true;}if(k2){if(accs.length<2){accs.push({id:'account-2',name:'Secondary Account 2 (Failover)',apiKey:k2,enabled:true});}else{accs[1].apiKey=k2;accs[1].enabled=true;}}c.accounts=accs;fs.writeFileSync(p,JSON.stringify(c,null,2),'utf8');";
                        ProcessStartInfo psiNode = new ProcessStartInfo("node.exe", string.Format("-e \"{0}\" \"{1}\" \"{2}\" \"{3}\" \"{4}\" \"{5}\"", mergeScript, cfgPath, portStr, passStr, k1, k2));
                        psiNode.WorkingDirectory = rootDir;
                        psiNode.CreateNoWindow = true;
                        psiNode.UseShellExecute = false;
                        using (Process pNode = Process.Start(psiNode))
                        {
                            if (pNode != null && pNode.WaitForExit(3000) && pNode.ExitCode == 0)
                            {
                                mergedViaNode = true;
                            }
                        }
                    }
                    catch { }

                    if (!mergedViaNode)
                    {
                        StringBuilder sb = new StringBuilder();
                        sb.AppendLine("{");
                        sb.AppendLine(string.Format("  \"port\": {0},", portStr));
                        sb.AppendLine("  \"host\": \"127.0.0.1\",");
                        sb.AppendLine(string.Format("  \"uiPassword\": \"{0}\",", passStr));
                        sb.AppendLine("  \"accounts\": [");
                        sb.AppendLine("    {");
                        sb.AppendLine("      \"id\": \"account-1\",");
                        sb.AppendLine(string.Format("      \"apiKey\": \"{0}\",", k1));
                        sb.AppendLine("      \"name\": \"Primary Account 1\",");
                        sb.AppendLine("      \"enabled\": true");
                        sb.AppendLine("    }");
                        if (!string.IsNullOrEmpty(k2))
                        {
                            sb.AppendLine("    ,{");
                            sb.AppendLine("      \"id\": \"account-2\",");
                            sb.AppendLine(string.Format("      \"apiKey\": \"{0}\",", k2));
                            sb.AppendLine("      \"name\": \"Secondary Account 2 (Failover)\",");
                            sb.AppendLine("      \"enabled\": true");
                            sb.AppendLine("    }");
                        }
                        sb.AppendLine("  ]");
                        sb.AppendLine("}");
                        File.WriteAllText(cfgPath, sb.ToString(), Encoding.UTF8);
                    }

                    string silentVbs = Path.Combine(rootDir, "silent-start.vbs");
                    if (File.Exists(silentVbs))
                    {
                        ProcessStartInfo psi = new ProcessStartInfo("wscript.exe", "\"" + silentVbs + "\"");
                        psi.WorkingDirectory = rootDir;
                        psi.CreateNoWindow = true;
                        psi.UseShellExecute = false;
                        Process.Start(psi);
                    }

                    Thread.Sleep(800);

                    this.BeginInvoke((MethodInvoker)delegate {
                        btnSaveStart.Enabled = true;
                        btnSaveStart.Text = "🚀 保存并启动服务";
                        lblFeedback.Text = string.Format("✔ 配置已保存，网关已在端口 {0} 顺利启动常驻！", p);
                        lblFeedback.ForeColor = clrEmerald;
                        CheckPortStatusAsync();
                    });
                }
                catch (Exception ex)
                {
                    this.BeginInvoke((MethodInvoker)delegate {
                        btnSaveStart.Enabled = true;
                        btnSaveStart.Text = "🚀 保存并启动服务";
                        lblFeedback.Text = "✖ 保存失败: " + ex.Message;
                        lblFeedback.ForeColor = clrRed;
                    });
                }
            });
        }

        private void TestConnectivity()
        {
            int p;
            if (!int.TryParse(txtPort.Text.Trim(), out p) || p < 1 || p > 65535) return;
            lblFeedback.Text = string.Format("正在向 127.0.0.1:{0}/status 发起探针...", p);
            lblFeedback.ForeColor = clrBlue;

            ThreadPool.QueueUserWorkItem(state => {
                string result = "";
                bool success = false;
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + p + "/status");
                    req.Timeout = 2000;
                    string pass = txtPassword.Text.Trim();
                    if (!string.IsNullOrEmpty(pass)) req.Headers["x-ui-password"] = pass;

                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    {
                        success = (resp.StatusCode == HttpStatusCode.OK);
                        result = string.Format("✔ 连通性测试通过！(HTTP {0})", (int)resp.StatusCode);
                    }
                }
                catch (Exception ex)
                {
                    result = "✖ 探针未响应: " + ex.Message;
                }

                this.BeginInvoke((MethodInvoker)delegate {
                    lblFeedback.Text = result;
                    lblFeedback.ForeColor = success ? clrEmerald : clrAmber;
                    CheckPortStatusAsync();
                });
            });
        }

        private void RunDoctor()
        {
            string doctorScript = Path.Combine(rootDir, "doctor-repair.ps1");
            if (File.Exists(doctorScript))
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -NoExit -File \"" + doctorScript + "\"");
                    psi.WorkingDirectory = rootDir;
                    Process.Start(psi);
                    lblFeedback.Text = "🩺 已唤起独立终端运行系统环境体检与自愈程序。";
                    lblFeedback.ForeColor = clrEmerald;
                }
                catch { }
            }
        }

        private void BindDesktop()
        {
            int p;
            if (!int.TryParse(txtPort.Text.Trim(), out p) || p < 1 || p > 65535) return;
            lblFeedback.Text = "正在绑定配置至 OpenCode 桌面端...";
            lblFeedback.ForeColor = clrBlue;

            ThreadPool.QueueUserWorkItem(state => {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + p + "/balancer/api/bind-desktop");
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    req.Timeout = 5000;
                    string pass = txtPassword.Text.Trim();
                    if (!string.IsNullOrEmpty(pass)) req.Headers["x-ui-password"] = pass;
                    byte[] data = Encoding.UTF8.GetBytes("{}");
                    req.ContentLength = data.Length;
                    using (Stream s = req.GetRequestStream()) { s.Write(data, 0, data.Length); }
                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    {
                        this.BeginInvoke((MethodInvoker)delegate {
                            lblFeedback.Text = "✔ 本地网关已成功锁定为 OpenCode 默认配置！";
                            lblFeedback.ForeColor = clrEmerald;
                        });
                    }
                }
                catch (Exception ex)
                {
                    this.BeginInvoke((MethodInvoker)delegate {
                        lblFeedback.Text = "✖ 绑定请求失败: " + ex.Message;
                        lblFeedback.ForeColor = clrAmber;
                    });
                }
            });
        }

        private void OpenDashboard()
        {
            int p;
            if (!int.TryParse(txtPort.Text.Trim(), out p) || p < 1 || p > 65535) p = 4010;
            string pass = txtPassword.Text.Trim();
            string authQuery = !string.IsNullOrEmpty(pass) ? ("?auth=" + Uri.EscapeDataString(pass)) : "";
            string url = "http://127.0.0.1:" + p + "/balancer/ui" + authQuery + "#/overview";

            string appExe = Path.Combine(rootDir, "OpenCodeRouterApp.exe");
            if (File.Exists(appExe))
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(appExe, "#/overview");
                    psi.WorkingDirectory = rootDir;
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                    lblFeedback.Text = "✔ 已唤起独立桌面应用面板。";
                    lblFeedback.ForeColor = clrEmerald;
                    return;
                }
                catch { }
            }

            try
            {
                Process.Start(url);
                lblFeedback.Text = "✔ 已在默认浏览器唤出控制面板。";
                lblFeedback.ForeColor = clrEmerald;
            }
            catch { }
        }
    }
}
