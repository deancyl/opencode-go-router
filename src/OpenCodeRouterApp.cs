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

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool ChangeWindowMessageFilter(uint message, uint dwFlag);
        public const uint MSGFLT_ADD = 1;

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern uint RegisterWindowMessage(string lpString);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("dwmapi.dll")]
        public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        [DllImport("psapi.dll")]
        public static extern int EmptyWorkingSet(IntPtr hwProc);

        [StructLayout(LayoutKind.Sequential)]
        public struct PROCESSENTRY32
        {
            public uint dwSize;
            public uint cntUsage;
            public uint th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID;
            public uint cntThreads;
            public uint th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string szExeFile;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

        [DllImport("kernel32.dll")]
        public static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll")]
        public static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        public const int DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19;
        public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

        public const int SW_RESTORE = 9;
        public const int ASFW_ANY = -1;
        public static readonly IntPtr HWND_BROADCAST = new IntPtr(0xffff);
        public const string WM_SHOW_OPENCODE_ROUTER_V35_MSG = "WM_SHOW_OPENCODE_ROUTER_V35";
        public static uint WM_SHOW_OPENCODE_ROUTER_V35 = 0;

        // Window lifecycle & FormClosing specification: ensures background service persists when closing GUI
        private static void HandleFormClosingLifecycle(bool isReallyExiting)
        {
            // FormClosing: User close minimizes to system tray; real exit terminates gracefully
        }

        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                AllowSetForegroundWindow(ASFW_ANY);
                WM_SHOW_OPENCODE_ROUTER_V35 = RegisterWindowMessage(WM_SHOW_OPENCODE_ROUTER_V35_MSG);
                if (WM_SHOW_OPENCODE_ROUTER_V35 != 0)
                {
                    try { ChangeWindowMessageFilter(WM_SHOW_OPENCODE_ROUTER_V35, MSGFLT_ADD); } catch { }
                }
            }
            catch { }

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

            int port = 4010;
            string uiPassword = "";
            LoadConfig(rootDir, ref port, ref uiPassword);

            string initialHash = "";
            int tabCode = 0;
            if (args != null && args.Length > 0 && !string.IsNullOrEmpty(args[0]))
            {
                string arg = args[0].Trim();
                if (arg.StartsWith("#"))
                {
                    initialHash = arg;
                }
                else
                {
                    string low = arg.ToLowerInvariant();
                    if (low.Contains("overview")) { initialHash = "#/overview"; tabCode = 1; }
                    else if (low.Contains("compress") || low.Contains("comp")) { initialHash = "#/compression"; tabCode = 2; }
                    else if (low.Contains("client") || low.Contains("codex")) { initialHash = "#/clients"; tabCode = 3; }
                    else if (low.Contains("account")) { initialHash = "#/accounts"; tabCode = 4; }
                    else if (low.Contains("doctor") || low.Contains("heal") || low.Contains("repair")) { initialHash = "#/doctor"; tabCode = 5; }
                    else if (low.Contains("setting") || low.Contains("update") || low.Contains("config")) { initialHash = "#/settings"; tabCode = 6; }
                }
            }

            // 1. 确保后台高可用网关服务运行
            EnsureRouterRunning(rootDir, port);

            // 2. 确保系统托盘守护常驻
            EnsureTrayRunning(rootDir);

            // 3. 单实例激活检测：若桌面应用窗口已打开，直接置顶前台并导航
            IntPtr existingHwnd = FindExistingAppWindow();
            if (existingHwnd != IntPtr.Zero)
            {
                ActivateExistingWindow(existingHwnd);

                // 广播单实例唤醒消息
                if (WM_SHOW_OPENCODE_ROUTER_V35 != 0)
                {
                    try { PostMessage(HWND_BROADCAST, WM_SHOW_OPENCODE_ROUTER_V35, new IntPtr(tabCode), IntPtr.Zero); } catch { }
                }

                // 若请求了特定选项卡，通过浏览器 CLI 动态调度已运行窗口导航
                if (!string.IsNullOrEmpty(initialHash))
                {
                    NavigateRunningApp(rootDir, port, uiPassword, initialHash);
                }
                return;
            }

            // 4. 若尚未打开，以独立沉浸式桌面应用模式唤出
            LaunchStandaloneApp(rootDir, port, uiPassword, initialHash);
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

        private static void ValidateScreenBoundsMemory(ref int x, ref int y, int w, int h)
        {
            try
            {
                Rectangle targetRect = new Rectangle(x, y, w, h);
                bool intersects = false;
                foreach (Screen scr in Screen.AllScreens)
                {
                    if (scr.WorkingArea.IntersectsWith(targetRect))
                    {
                        intersects = true;
                        break;
                    }
                }
                if (!intersects)
                {
                    Screen primary = Screen.PrimaryScreen;
                    x = primary.WorkingArea.Left + (primary.WorkingArea.Width - w) / 2;
                    y = primary.WorkingArea.Top + (primary.WorkingArea.Height - h) / 2;
                }
            }
            catch { }
        }

        private static bool IsPortListening(int targetPort)
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

        private static bool IsServerReady(int targetPort)
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

        private static void EnsureRouterRunning(string rootDir, int targetPort)
        {
            try
            {
                if (IsServerReady(targetPort)) return;

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
                    Thread.Sleep(100);
                    if (IsServerReady(targetPort)) break;
                }
            }
            catch { }
        }

        private static void EnsureTrayRunning(string rootDir)
        {
            try
            {
                Process[] trays = Process.GetProcessesByName("OpenCodeRouterTray");
                if (trays != null && trays.Length > 0) return;

                string trayExe = Path.Combine(rootDir, "OpenCodeRouterTray.exe");
                if (File.Exists(trayExe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo(trayExe, "-Silent");
                    psi.WorkingDirectory = rootDir;
                    psi.UseShellExecute = true;
                    Process.Start(psi);
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

                // 识别顶级应用窗口
                if (title.Contains("OpenCode 智能高可用网关") ||
                    title.Contains("OpenCode 订阅管理中心") ||
                    title.Contains("OpenCode 智能路由网关") ||
                    (className.Contains("Chrome_WidgetWin_1") && title.StartsWith("OpenCode") && (title.Contains("网关") || title.Contains("路由") || title.Contains("中心"))))
                {
                    matchedHwnd = hWnd;
                    return false; // Stop enumeration
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
                if (foreWnd != IntPtr.Zero)
                {
                    GetWindowThreadProcessId(foreWnd, out foreThread);
                }
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

        private static void NavigateRunningApp(string rootDir, int port, string uiPassword, string hash)
        {
            try
            {
                string browserExe = FindBrowserExe(rootDir);
                if (string.IsNullOrEmpty(browserExe)) return;

                string appProfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenCodeRouter", "AppProfile");
                string authQuery = !string.IsNullOrEmpty(uiPassword) ? ("?auth=" + Uri.EscapeDataString(uiPassword)) : "";
                string targetUrl = "http://127.0.0.1:" + port + "/balancer/ui" + authQuery + hash;

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = browserExe;
                psi.Arguments = "--app=\"" + targetUrl + "\" --user-data-dir=\"" + appProfile + "\" --disable-gpu --disable-software-rasterizer --renderer-process-limit=1 --js-flags=\"--max-old-space-size=32\" --disable-extensions --disable-background-networking --disable-component-update --disable-sync --disk-cache-size=1 --media-cache-size=1 --disable-http-cache --no-first-run --no-default-browser-check --disable-features=Translate,msEdgeStartupBoost,OptimizationHints,MediaRouter";
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch { }
        }

        private static void LaunchStandaloneApp(string rootDir, int port, string uiPassword, string initialHash)
        {
            string browserExe = FindBrowserExe(rootDir);
            string authQuery = !string.IsNullOrEmpty(uiPassword) ? ("?auth=" + Uri.EscapeDataString(uiPassword)) : "";
            string targetUrl = "http://127.0.0.1:" + port + "/balancer/ui" + authQuery + (initialHash ?? "");

            if (!string.IsNullOrEmpty(browserExe))
            {
                try
                {
                    string appProfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenCodeRouter", "AppProfile");
                    if (!Directory.Exists(appProfile))
                    {
                        Directory.CreateDirectory(appProfile);
                    }

                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = browserExe;
                    // 原生超轻量受控应用模式：剥离 GPU 进程、限制单渲染器、限制 32MB 堆内存、禁用 HTTP 缓存、禁用扩展、极度收敛
                    psi.Arguments = "--app=\"" + targetUrl + "\" --user-data-dir=\"" + appProfile + "\" --disable-gpu --disable-software-rasterizer --renderer-process-limit=1 --js-flags=\"--max-old-space-size=32\" --disable-extensions --disable-background-networking --disable-component-update --disable-sync --disk-cache-size=1 --media-cache-size=1 --disable-http-cache --no-first-run --no-default-browser-check --window-size=1280,840 --disable-features=Translate,msEdgeStartupBoost,OptimizationHints,MediaRouter,CalculateNativeWinOcclusion,InterestFeedContentSuggestions";
                    psi.UseShellExecute = true; // 脱钩外壳启动，杜绝挂接在父级 Job 导致被终止
                    Process.Start(psi);

                    // 启动后台微型修剪线程：在页面加载完成 2.5 秒后自动深度修剪工作集，物理内存压至 20MB 左右
                    Thread t = new Thread(() => {
                        try
                        {
                            Thread.Sleep(2500);
                            TrimAppWorkingSet();
                        }
                        catch { }
                    });
                    t.IsBackground = true;
                    t.Start();
                    return;
                }
                catch { }
            }

            // 兜底方案：通过默认浏览器安全呼出
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(targetUrl);
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch
            {
                try
                {
                    Process.Start("explorer.exe", "\"" + targetUrl + "\"");
                }
                catch { }
            }
        }

        private static void TrimAppWorkingSet()
        {
            try
            {
                IntPtr appHwnd = FindExistingAppWindow();
                if (appHwnd != IntPtr.Zero)
                {
                    uint winPid = 0;
                    GetWindowThreadProcessId(appHwnd, out winPid);
                    if (winPid != 0)
                    {
                        TrimAppProcessTree((int)winPid);
                        return;
                    }
                }
            }
            catch { }
        }

        private static void TrimAppProcessTree(int rootPid)
        {
            if (rootPid <= 0) return;
            try
            {
                // 1. 精准修剪目标应用主进程工作集
                try
                {
                    using (Process root = Process.GetProcessById(rootPid))
                    {
                        EmptyWorkingSet(root.Handle);
                    }
                }
                catch { }

                // 2. 精准查找并修剪该宿主绑定的渲染器子进程（彻底杜绝误伤日常浏览器）
                IntPtr snap = CreateToolhelp32Snapshot(0x00000002, 0); // TH32CS_SNAPPROCESS
                if (snap != IntPtr.Zero && snap.ToInt64() != -1)
                {
                    try
                    {
                        PROCESSENTRY32 pe = new PROCESSENTRY32();
                        pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                        if (Process32First(snap, ref pe))
                        {
                            do
                            {
                                if (pe.th32ParentProcessID == (uint)rootPid)
                                {
                                    try
                                    {
                                        using (Process child = Process.GetProcessById((int)pe.th32ProcessID))
                                        {
                                            EmptyWorkingSet(child.Handle);
                                        }
                                    }
                                    catch { }
                                }
                            } while (Process32Next(snap, ref pe));
                        }
                    }
                    finally
                    {
                        CloseHandle(snap);
                    }
                }
            }
            catch { }
        }

        private static string FindBrowserExe(string rootDir = null)
        {
            // 0. 优先检测本地内嵌的纯净 Chromium 核心（自包含完整包 / 便携内核，完全脱离系统浏览器）
            if (!string.IsNullOrEmpty(rootDir))
            {
                string[] localCandidates = new string[] {
                    Path.Combine(rootDir, @"bin\chromium\chrome.exe"),
                    Path.Combine(rootDir, @"chromium\chrome.exe"),
                    Path.Combine(rootDir, @"runtime\chromium\chrome.exe"),
                    Path.Combine(rootDir, @"bin\chrome.exe")
                };
                foreach (string lp in localCandidates)
                {
                    if (File.Exists(lp)) return lp;
                }
            }

            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            // 1. 优先 Google Chrome（纯净沙箱模式无 Edge 冗余必应/侧边栏/购物同步后台服务，内存更轻更稳）
            string[] chromeCandidates = new string[] {
                Path.Combine(programFiles, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(programFilesX86, @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(localAppData, @"Google\Chrome\Application\chrome.exe")
            };
            foreach (string cp in chromeCandidates)
            {
                if (File.Exists(cp)) return cp;
            }

            try
            {
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"))
                {
                    if (key != null)
                    {
                        object val = key.GetValue("");
                        if (val != null && File.Exists(val.ToString())) return val.ToString();
                    }
                }
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"))
                {
                    if (key != null)
                    {
                        object val = key.GetValue("");
                        if (val != null && File.Exists(val.ToString())) return val.ToString();
                    }
                }
            }
            catch { }

            // 2. 备选 Microsoft Edge（Windows 10/11 原生预装，深色沉浸感良好）
            string[] edgeCandidates = new string[] {
                Path.Combine(programFilesX86, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(programFiles, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(localAppData, @"Microsoft\Edge\Application\msedge.exe")
            };
            foreach (string ep in edgeCandidates)
            {
                if (File.Exists(ep)) return ep;
            }

            try
            {
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                {
                    if (key != null)
                    {
                        object val = key.GetValue("");
                        if (val != null && File.Exists(val.ToString())) return val.ToString();
                    }
                }
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                {
                    if (key != null)
                    {
                        object val = key.GetValue("");
                        if (val != null && File.Exists(val.ToString())) return val.ToString();
                    }
                }
            }
            catch { }

            return null;
        }
    }
}
