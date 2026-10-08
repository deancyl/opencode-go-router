using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Threading;
using System.Windows.Forms;

namespace OpenCodeRouter
{
    static class Program
    {
        private static Mutex mutex = null;
        private static NotifyIcon notifyIcon = null;
        private static int port = 4010;
        private static string rootDir = "";
        private static string icoPath = "";

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

            // Single instance check
            bool createdNew;
            mutex = new Mutex(true, @"Global\OpenCodeRouterTrayMutex", out createdNew);
            if (!createdNew)
            {
                EnsureRouterRunning();
                OpenDashboard();
                return;
            }

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

            ToolStripMenuItem menuChamber = new ToolStripMenuItem("💻 打开 OpenChamber 工作台 (3000)");
            menuChamber.Click += (s, e) => Process.Start("http://127.0.0.1:3000");
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

            Application.Run();
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

        static void OpenDashboard()
        {
            EnsureRouterRunning();
            string edgeApp = "http://127.0.0.1:" + port + "/balancer/ui";
            string edgeExe = null;
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            string[] possiblePaths = new string[] {
                Path.Combine(programFiles, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(programFilesX86, @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(localAppData, @"Microsoft\Edge\Application\msedge.exe")
            };
            foreach (string p in possiblePaths)
            {
                if (File.Exists(p)) { edgeExe = p; break; }
            }

            if (edgeExe != null)
            {
                Process.Start(edgeExe, "--app=" + edgeApp);
            }
            else
            {
                Process.Start(edgeApp);
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
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -Command \"$c = Get-NetTCPConnection -LocalPort " + port + " -State Listen -ErrorAction SilentlyContinue; if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -like '*node*') { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } }\"");
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

        static void ExitApp()
        {
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
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -Command \"$c = Get-NetTCPConnection -LocalPort " + port + " -State Listen -ErrorAction SilentlyContinue; if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -like '*node*') { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } }\"");
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
