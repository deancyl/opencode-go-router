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

namespace OpenCodeWizard
{
    static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main(string[] args)
        {
            try { SetProcessDPIAware(); } catch { }

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

            // If command-line arguments are provided, preserve full CLI transparent forwarding
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

            // When launched without arguments (e.g. desktop double-click), launch modern WinForms High-DPI GUI
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new WizardForm(rootDir));
        }
    }

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
        private System.Windows.Forms.Timer portDebounceTimer;

        // Dark theme color palette (Minimalist Carbon)
        private Color clrBg = Color.FromArgb(14, 14, 18);
        private Color clrCardBg = Color.FromArgb(22, 22, 28);
        private Color clrBorder = Color.FromArgb(39, 39, 44);
        private Color clrInputBg = Color.FromArgb(28, 28, 36);
        private Color clrText = Color.FromArgb(244, 244, 245);
        private Color clrTextMuted = Color.FromArgb(161, 161, 170);
        private Color clrEmerald = Color.FromArgb(16, 185, 129);
        private Color clrEmeraldHover = Color.FromArgb(5, 150, 105);
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
            this.Text = "OpenCode 智能路由网关 - 部署与配置向导";
            this.Size = new Size(720, 640);
            this.MinimumSize = new Size(680, 600);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = clrBg;
            this.ForeColor = clrText;
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            this.AutoScaleMode = AutoScaleMode.Dpi;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;

            string icoPath = Path.Combine(rootDir, "assets", "router.ico");
            if (File.Exists(icoPath))
            {
                try { this.Icon = new Icon(icoPath); } catch { }
            }

            // 1. Header Panel
            Panel headerPanel = new Panel();
            headerPanel.Dock = DockStyle.Top;
            headerPanel.Height = 85;
            headerPanel.BackColor = clrCardBg;
            headerPanel.Padding = new Padding(24, 16, 24, 16);

            Label lblTitle = new Label();
            lblTitle.Text = "🚀 OpenCode 智能高可用网关配置";
            lblTitle.Font = new Font("Segoe UI", 14f, FontStyle.Bold);
            lblTitle.ForeColor = clrText;
            lblTitle.AutoSize = true;
            lblTitle.Location = new Point(24, 16);
            headerPanel.Controls.Add(lblTitle);

            Label lblSub = new Label();
            lblSub.Text = "配置服务端口、认证密钥、多账号故障转移与一键桌面集成 (High-DPI 原生托管)";
            lblSub.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            lblSub.ForeColor = clrTextMuted;
            lblSub.AutoSize = true;
            lblSub.Location = new Point(26, 48);
            headerPanel.Controls.Add(lblSub);

            this.Controls.Add(headerPanel);

            // 2. Card Container Panel
            Panel cardPanel = new Panel();
            cardPanel.Location = new Point(24, 105);
            cardPanel.Size = new Size(656, 360);
            cardPanel.BackColor = clrCardBg;
            cardPanel.Padding = new Padding(20);

            int curY = 16;

            // Field: Port
            Label lblPort = new Label();
            lblPort.Text = "服务端口 (Port):";
            lblPort.ForeColor = clrText;
            lblPort.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            lblPort.Location = new Point(20, curY);
            lblPort.AutoSize = true;
            cardPanel.Controls.Add(lblPort);

            txtPort = new TextBox();
            txtPort.Text = "4010";
            txtPort.Location = new Point(20, curY + 24);
            txtPort.Size = new Size(110, 26);
            txtPort.BackColor = clrInputBg;
            txtPort.ForeColor = clrText;
            txtPort.BorderStyle = BorderStyle.FixedSingle;
            txtPort.TextChanged += (s, e) => {
                if (portDebounceTimer != null) portDebounceTimer.Stop();
                portDebounceTimer = new System.Windows.Forms.Timer();
                portDebounceTimer.Interval = 300;
                portDebounceTimer.Tick += (s2, e2) => {
                    portDebounceTimer.Stop();
                    portDebounceTimer.Dispose();
                    portDebounceTimer = null;
                    CheckPortStatusAsync();
                };
                portDebounceTimer.Start();
            };
            cardPanel.Controls.Add(txtPort);

            btnFindFreePort = new Button();
            btnFindFreePort.Text = "⚡ 自动寻找空闲端口";
            btnFindFreePort.Location = new Point(140, curY + 23);
            btnFindFreePort.Size = new Size(140, 28);
            btnFindFreePort.FlatStyle = FlatStyle.Flat;
            btnFindFreePort.FlatAppearance.BorderColor = clrBorder;
            btnFindFreePort.BackColor = clrInputBg;
            btnFindFreePort.ForeColor = clrText;
            btnFindFreePort.Cursor = Cursors.Hand;
            btnFindFreePort.Click += (s, e) => FindFreePort();
            cardPanel.Controls.Add(btnFindFreePort);

            lblPortStatus = new Label();
            lblPortStatus.Text = "正在检测端口...";
            lblPortStatus.ForeColor = clrTextMuted;
            lblPortStatus.Location = new Point(290, curY + 28);
            lblPortStatus.AutoSize = true;
            cardPanel.Controls.Add(lblPortStatus);

            curY += 66;

            // Field: UI Password
            Label lblPass = new Label();
            lblPass.Text = "Web 控制台安全密码 (uiPassword，可选):";
            lblPass.ForeColor = clrText;
            lblPass.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            lblPass.Location = new Point(20, curY);
            lblPass.AutoSize = true;
            cardPanel.Controls.Add(lblPass);

            txtPassword = new TextBox();
            txtPassword.Location = new Point(20, curY + 24);
            txtPassword.Size = new Size(380, 26);
            txtPassword.BackColor = clrInputBg;
            txtPassword.ForeColor = clrText;
            txtPassword.BorderStyle = BorderStyle.FixedSingle;
            txtPassword.PasswordChar = '•';
            cardPanel.Controls.Add(txtPassword);

            chkShowPassword = new CheckBox();
            chkShowPassword.Text = "显示密码";
            chkShowPassword.ForeColor = clrTextMuted;
            chkShowPassword.Location = new Point(415, curY + 26);
            chkShowPassword.AutoSize = true;
            chkShowPassword.CheckedChanged += (s, e) => {
                txtPassword.PasswordChar = chkShowPassword.Checked ? '\0' : '•';
            };
            cardPanel.Controls.Add(chkShowPassword);

            Label lblPassHint = new Label();
            lblPassHint.Text = "留空则免密码访问 Web 控制台与接口；配置后外部请求需携带鉴权凭证。";
            lblPassHint.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            lblPassHint.ForeColor = clrTextMuted;
            lblPassHint.Location = new Point(20, curY + 54);
            lblPassHint.AutoSize = true;
            cardPanel.Controls.Add(lblPassHint);

            curY += 84;

            // Field: Key 1
            Label lblKey1 = new Label();
            lblKey1.Text = "主订阅账号 API Key (Account 1):";
            lblKey1.ForeColor = clrText;
            lblKey1.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            lblKey1.Location = new Point(20, curY);
            lblKey1.AutoSize = true;
            cardPanel.Controls.Add(lblKey1);

            txtKey1 = new TextBox();
            txtKey1.Location = new Point(20, curY + 24);
            txtKey1.Size = new Size(616, 26);
            txtKey1.BackColor = clrInputBg;
            txtKey1.ForeColor = clrText;
            txtKey1.BorderStyle = BorderStyle.FixedSingle;
            cardPanel.Controls.Add(txtKey1);

            curY += 66;

            // Field: Key 2
            Label lblKey2 = new Label();
            lblKey2.Text = "备用订阅账号 API Key (Account 2，可选负载均衡与限频故障转移):";
            lblKey2.ForeColor = clrText;
            lblKey2.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            lblKey2.Location = new Point(20, curY);
            lblKey2.AutoSize = true;
            cardPanel.Controls.Add(lblKey2);

            txtKey2 = new TextBox();
            txtKey2.Location = new Point(20, curY + 24);
            txtKey2.Size = new Size(616, 26);
            txtKey2.BackColor = clrInputBg;
            txtKey2.ForeColor = clrText;
            txtKey2.BorderStyle = BorderStyle.FixedSingle;
            cardPanel.Controls.Add(txtKey2);

            this.Controls.Add(cardPanel);

            // 3. Feedback Status Label
            lblFeedback = new Label();
            lblFeedback.Text = "💡 准备就绪。修改配置后点击下方按钮保存并拉起服务。";
            lblFeedback.Location = new Point(26, 478);
            lblFeedback.Size = new Size(650, 22);
            lblFeedback.ForeColor = clrTextMuted;
            lblFeedback.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            this.Controls.Add(lblFeedback);

            // 4. Action Buttons Bar
            Panel btnPanel = new Panel();
            btnPanel.Location = new Point(24, 508);
            btnPanel.Size = new Size(656, 48);

            btnSaveStart = new Button();
            btnSaveStart.Text = "🚀 保存并启动服务";
            btnSaveStart.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnSaveStart.Location = new Point(0, 4);
            btnSaveStart.Size = new Size(160, 38);
            btnSaveStart.FlatStyle = FlatStyle.Flat;
            btnSaveStart.FlatAppearance.BorderSize = 0;
            btnSaveStart.BackColor = clrEmerald;
            btnSaveStart.ForeColor = Color.White;
            btnSaveStart.Cursor = Cursors.Hand;
            btnSaveStart.Click += (s, e) => SaveAndStartService();
            btnPanel.Controls.Add(btnSaveStart);

            btnTestConn = new Button();
            btnTestConn.Text = "🔍 连通性测试";
            btnTestConn.Location = new Point(170, 4);
            btnTestConn.Size = new Size(110, 38);
            btnTestConn.FlatStyle = FlatStyle.Flat;
            btnTestConn.FlatAppearance.BorderColor = clrBorder;
            btnTestConn.BackColor = clrInputBg;
            btnTestConn.ForeColor = clrText;
            btnTestConn.Cursor = Cursors.Hand;
            btnTestConn.Click += (s, e) => TestConnectivity();
            btnPanel.Controls.Add(btnTestConn);

            btnDoctor = new Button();
            btnDoctor.Text = "🩺 环境体检";
            btnDoctor.Location = new Point(290, 4);
            btnDoctor.Size = new Size(105, 38);
            btnDoctor.FlatStyle = FlatStyle.Flat;
            btnDoctor.FlatAppearance.BorderColor = clrBorder;
            btnDoctor.BackColor = clrInputBg;
            btnDoctor.ForeColor = clrText;
            btnDoctor.Cursor = Cursors.Hand;
            btnDoctor.Click += (s, e) => RunDoctor();
            btnPanel.Controls.Add(btnDoctor);

            btnBind = new Button();
            btnBind.Text = "⚡ 绑定桌面客户端";
            btnBind.Location = new Point(405, 4);
            btnBind.Size = new Size(130, 38);
            btnBind.FlatStyle = FlatStyle.Flat;
            btnBind.FlatAppearance.BorderColor = clrBorder;
            btnBind.BackColor = clrInputBg;
            btnBind.ForeColor = clrText;
            btnBind.Cursor = Cursors.Hand;
            btnBind.Click += (s, e) => BindDesktop();
            btnPanel.Controls.Add(btnBind);

            btnOpenDashboard = new Button();
            btnOpenDashboard.Text = "🌐 打开控制面板";
            btnOpenDashboard.Location = new Point(545, 4);
            btnOpenDashboard.Size = new Size(110, 38);
            btnOpenDashboard.FlatStyle = FlatStyle.Flat;
            btnOpenDashboard.FlatAppearance.BorderColor = clrBorder;
            btnOpenDashboard.BackColor = clrInputBg;
            btnOpenDashboard.ForeColor = clrText;
            btnOpenDashboard.Cursor = Cursors.Hand;
            btnOpenDashboard.Click += (s, e) => OpenDashboard();
            btnPanel.Controls.Add(btnOpenDashboard);

            this.Controls.Add(btnPanel);
        }

        private void SetButtonsEnabled(bool enabled)
        {
            btnSaveStart.Enabled = enabled;
            btnTestConn.Enabled = enabled;
            btnDoctor.Enabled = enabled;
            btnBind.Enabled = enabled;
            btnOpenDashboard.Enabled = enabled;
            btnFindFreePort.Enabled = enabled;
        }

        private void LoadConfig()
        {
            try
            {
                string cfgPath = Path.Combine(rootDir, "config.json");
                if (!File.Exists(cfgPath)) return;

                string json = File.ReadAllText(cfgPath, Encoding.UTF8);

                // Port
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
                            if (int.TryParse(pStr, out p) && p > 0 && p < 65536)
                            {
                                txtPort.Text = p.ToString();
                            }
                        }
                    }
                }

                // uiPassword
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
                            if (q2 > q1)
                            {
                                txtPassword.Text = json.Substring(q1 + 1, q2 - q1 - 1);
                            }
                        }
                    }
                }

                // accounts: search for apiKey
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
                            }

                            int secondKeyIdx = json.IndexOf("\"apiKey\"", q2 + 1);
                            if (secondKeyIdx >= 0)
                            {
                                int sq1 = json.IndexOf("\"", json.IndexOf(":", secondKeyIdx));
                                if (sq1 >= 0)
                                {
                                    int sq2 = json.IndexOf("\"", sq1 + 1);
                                    if (sq2 > sq1)
                                    {
                                        txtKey2.Text = json.Substring(sq1 + 1, sq2 - sq1 - 1);
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
                lblPortStatus.Text = "✖ 端口范围无效 (须为 1-65535)";
                lblPortStatus.ForeColor = clrRed;
                return;
            }

            ThreadPool.QueueUserWorkItem(state => {
                bool isListening = false;
                try
                {
                    IPGlobalProperties ipProperties = IPGlobalProperties.GetIPGlobalProperties();
                    IPEndPoint[] endPoints = ipProperties.GetActiveTcpListeners();
                    foreach (IPEndPoint ep in endPoints)
                    {
                        if (ep.Port == p) { isListening = true; break; }
                    }
                }
                catch { }

                bool isOurRouter = false;
                if (isListening)
                {
                    try
                    {
                        HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + p + "/health");
                        req.Timeout = 400;
                        using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                        {
                            if (resp.StatusCode == HttpStatusCode.OK) isOurRouter = true;
                        }
                    }
                    catch { }
                }

                this.BeginInvoke((MethodInvoker)delegate {
                    if (isOurRouter)
                    {
                        lblPortStatus.Text = string.Format("✔ 本地网关已在端口 {0} 正常运行", p);
                        lblPortStatus.ForeColor = clrEmerald;
                    }
                    else if (isListening)
                    {
                        lblPortStatus.Text = string.Format("⚠ 端口 {0} 已被其他程序占用", p);
                        lblPortStatus.ForeColor = clrAmber;
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
                    IPGlobalProperties ipProperties = IPGlobalProperties.GetIPGlobalProperties();
                    IPEndPoint[] endPoints = ipProperties.GetActiveTcpListeners();
                    for (int cand = 4010; cand <= 4099; cand++)
                    {
                        bool occupied = false;
                        foreach (IPEndPoint ep in endPoints)
                        {
                            if (ep.Port == cand) { occupied = true; break; }
                        }
                        if (!occupied)
                        {
                            freePort = cand;
                            break;
                        }
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
                lblFeedback.Text = "✖ 请输入有效的端口号 (1 - 65535)";
                lblFeedback.ForeColor = clrRed;
                return;
            }

            SetButtonsEnabled(false);
            btnSaveStart.Text = "正在保存并启动...";
            lblFeedback.Text = "正在写入 config.json 配置并拉起后台服务...";
            lblFeedback.ForeColor = clrBlue;

            string portStr = p.ToString();
            string passStr = txtPassword.Text.Trim();
            string k1 = txtKey1.Text.Trim();
            string k2 = txtKey2.Text.Trim();

            ThreadPool.QueueUserWorkItem(state => {
                try
                {
                    // 1. 原子落盘保存 config.json
                    string cfgPath = Path.Combine(rootDir, "config.json");
                    string tmpPath = cfgPath + ".tmp";

                    StringBuilder sb = new StringBuilder();
                    sb.AppendLine("{");
                    sb.AppendLine(string.Format("  \"port\": {0},", portStr));
                    sb.AppendLine("  \"host\": \"127.0.0.1\",");
                    sb.AppendLine(string.Format("  \"uiPassword\": \"{0}\",", passStr));
                    sb.AppendLine("  \"accounts\": [");
                    sb.AppendLine("    {");
                    sb.AppendLine(string.Format("      \"apiKey\": \"{0}\",", k1));
                    sb.AppendLine("      \"name\": \"Primary Account 1\"");
                    sb.AppendLine("    }");
                    if (!string.IsNullOrEmpty(k2))
                    {
                        sb.AppendLine("    ,{");
                        sb.AppendLine(string.Format("      \"apiKey\": \"{0}\",", k2));
                        sb.AppendLine("      \"name\": \"Secondary Account 2 (Failover)\"");
                        sb.AppendLine("    }");
                    }
                    sb.AppendLine("  ]");
                    sb.AppendLine("}");

                    File.WriteAllText(tmpPath, sb.ToString(), Encoding.UTF8);
                    if (File.Exists(cfgPath))
                    {
                        File.Delete(cfgPath);
                    }
                    File.Move(tmpPath, cfgPath);

                    // 2. 拉起静默常驻服务
                    string silentVbs = Path.Combine(rootDir, "silent-start.vbs");
                    if (File.Exists(silentVbs))
                    {
                        ProcessStartInfo psi = new ProcessStartInfo("wscript.exe", "\"" + silentVbs + "\"");
                        psi.WorkingDirectory = rootDir;
                        psi.CreateNoWindow = true;
                        psi.UseShellExecute = false;
                        psi.WindowStyle = ProcessWindowStyle.Hidden;
                        Process.Start(psi);
                    }

                    // 3. 轮询直到端口就绪
                    bool isUp = false;
                    for (int i = 0; i < 25; i++)
                    {
                        Thread.Sleep(200);
                        try
                        {
                            IPGlobalProperties ipProps = IPGlobalProperties.GetIPGlobalProperties();
                            foreach (IPEndPoint ep in ipProps.GetActiveTcpListeners())
                            {
                                if (ep.Port == p) { isUp = true; break; }
                            }
                        }
                        catch { }
                        if (isUp) break;
                    }

                    this.BeginInvoke((MethodInvoker)delegate {
                        SetButtonsEnabled(true);
                        btnSaveStart.Text = "🚀 保存并启动服务";
                        if (isUp)
                        {
                            lblFeedback.Text = string.Format("✔ 配置已保存，服务已在端口 {0} 顺利启动并静默常驻！", p);
                            lblFeedback.ForeColor = clrEmerald;
                            CheckPortStatusAsync();
                        }
                        else
                        {
                            lblFeedback.Text = "⚠ 配置已保存，但服务尚未在预定时间内监听端口，请点击环境体检排查。";
                            lblFeedback.ForeColor = clrAmber;
                        }
                    });
                }
                catch (Exception ex)
                {
                    this.BeginInvoke((MethodInvoker)delegate {
                        SetButtonsEnabled(true);
                        btnSaveStart.Text = "🚀 保存并启动服务";
                        lblFeedback.Text = "✖ 保存或启动失败: " + ex.Message;
                        lblFeedback.ForeColor = clrRed;
                    });
                }
            });
        }

        private void TestConnectivity()
        {
            int p;
            if (!int.TryParse(txtPort.Text.Trim(), out p) || p < 1 || p > 65535) return;

            lblFeedback.Text = string.Format("正在向 127.0.0.1:{0}/status 发起连通性探针...", p);
            lblFeedback.ForeColor = clrBlue;

            ThreadPool.QueueUserWorkItem(state => {
                string result = "";
                bool success = false;
                Stopwatch sw = Stopwatch.StartNew();

                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + p + "/status");
                    req.Method = "GET";
                    req.Timeout = 2500;
                    string pass = txtPassword.Text.Trim();
                    if (!string.IsNullOrEmpty(pass))
                    {
                        req.Headers["x-ui-password"] = pass;
                        req.Headers["x-api-key"] = pass;
                    }

                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    {
                        sw.Stop();
                        if (resp.StatusCode == HttpStatusCode.OK)
                        {
                            success = true;
                            result = string.Format("✔ 连通性测试通过！响应状态: 200 OK，耗时: {0} ms", sw.ElapsedMilliseconds);
                        }
                        else
                        {
                            result = string.Format("⚠ 收到响应码: {0}，耗时: {1} ms", (int)resp.StatusCode, sw.ElapsedMilliseconds);
                        }
                    }
                }
                catch (Exception ex)
                {
                    sw.Stop();
                    result = string.Format("✖ 探针未连通: {0} (耗时: {1} ms)", ex.Message, sw.ElapsedMilliseconds);
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
                catch (Exception ex)
                {
                    lblFeedback.Text = "✖ 唤起体检程序失败: " + ex.Message;
                    lblFeedback.ForeColor = clrRed;
                }
            }
            else
            {
                lblFeedback.Text = "✖ 未找到 doctor-repair.ps1 脚本文件。";
                lblFeedback.ForeColor = clrRed;
            }
        }

        private void BindDesktop()
        {
            int p;
            if (!int.TryParse(txtPort.Text.Trim(), out p) || p < 1 || p > 65535) return;

            lblFeedback.Text = "正在将网关配置绑定至 OpenCode 与 OpenChamber 桌面端...";
            lblFeedback.ForeColor = clrBlue;

            ThreadPool.QueueUserWorkItem(state => {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + p + "/balancer/api/bind-desktop");
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    req.Timeout = 5000;
                    string pass = txtPassword.Text.Trim();
                    if (!string.IsNullOrEmpty(pass))
                    {
                        req.Headers["x-ui-password"] = pass;
                        req.Headers["x-api-key"] = pass;
                    }
                    byte[] data = Encoding.UTF8.GetBytes("{}");
                    req.ContentLength = data.Length;
                    using (Stream s = req.GetRequestStream()) { s.Write(data, 0, data.Length); }

                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    {
                        this.BeginInvoke((MethodInvoker)delegate {
                            lblFeedback.Text = "✔ 本地网关已成功锁定为 OpenCode 与 OpenChamber 默认配置！";
                            lblFeedback.ForeColor = clrEmerald;
                        });
                    }
                }
                catch (Exception ex)
                {
                    this.BeginInvoke((MethodInvoker)delegate {
                        lblFeedback.Text = "✖ 绑定桌面端请求失败: " + ex.Message;
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
            string url = "http://127.0.0.1:" + p + "/balancer/ui" + authQuery;

            try
            {
                string appExe = Path.Combine(rootDir, "OpenCodeRouterApp.exe");
                if (File.Exists(appExe))
                {
                    ProcessStartInfo psi = new ProcessStartInfo(appExe);
                    psi.WorkingDirectory = rootDir;
                    psi.UseShellExecute = true;
                    Process.Start(psi);
                    lblFeedback.Text = "✔ 已唤起独立桌面应用面板。";
                    lblFeedback.ForeColor = clrEmerald;
                    return;
                }
            }
            catch { }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(url);
                psi.UseShellExecute = true;
                Process.Start(psi);
                lblFeedback.Text = "✔ 已在默认浏览器唤出控制面板。";
                lblFeedback.ForeColor = clrEmerald;
            }
            catch (Exception ex)
            {
                lblFeedback.Text = "✖ 唤出控制面板失败: " + ex.Message;
                lblFeedback.ForeColor = clrRed;
            }
        }
    }
}
