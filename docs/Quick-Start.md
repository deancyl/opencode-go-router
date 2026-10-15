# 快速开始 (Quick Start)

本文档将引导您在 **3 分钟内** 完成 OpenCode Go Router 智能网关的部署，并完成与 OpenCode、OpenChamber、Codex 等生态客户端的一键深度绑定。

---

## 🚀 场景 A：Linux / NAS / 私有云部署

适用于 **Debian、Ubuntu、fnOS (飞牛私有云)、群晖 Synology (DSM 7+)、TrueNAS、Unraid** 等服务器环境。

### 方式 1：远程极速一键部署（强烈推荐，全自动）
无需预先克隆代码，直接在服务器终端执行：
```bash
# 交互式向导模式（推荐首次部署）：
curl -fsSL https://raw.githubusercontent.com/deancyl/opencode-go-router/master/install.sh | bash
```
或者使用一键全自动静默部署：
```bash
curl -fsSL https://raw.githubusercontent.com/deancyl/opencode-go-router/master/install.sh | bash -s -- --all --host 0.0.0.0 --port 4010 --password "你的后台管理密码" --key1 "sk-key-1" --key2 "sk-key-2"
```

### 方式 2：本地克隆部署
```bash
# 1. 克隆代码仓库
git clone https://github.com/deancyl/opencode-go-router.git ~/.opencode-go-router
cd ~/.opencode-go-router

# 2. 赋予执行权限并启动交互向导
chmod +x *.sh
./setup-linux.sh
```

在交互菜单中输入 `1`（一键全自动配置），向导将自动完成：
1. 依赖与 Node.js 运行时检测；
2. 4010 智能网关服务部署；
3. systemd 用户级守护常驻（自动开启 `loginctl enable-linger` 登出不中断）；
4. OpenCode CLI、OpenChamber、OMO 多智能体与 Goal 目标推进体系自动绑定。

---

## 🪟 场景 B：Windows 桌面端部署

适用于 **Windows 10 / Windows 11 (64位)**。

### 方式 1：双击可执行程序（普通用户首选）
1. 解压发布的 `opencode-toolkit-windows-x64.zip`；
2. **首次配置**：双击运行 `OpenCodeWizard.exe`，按提示输入 `6` 执行一键全套配置；
3. **日常启动**：双击 `OpenCodeRouterTray.exe`，系统任务栏右下角将出现高光翡翠绿托盘图标，并以独立桌面应用模式唤出管理面板。

### 方式 2：PowerShell 终端指令（开发者推荐）
在项目目录下以管理员或普通用户运行：
```powershell
# 1. 运行交互向导进行初始化
powershell -ExecutionPolicy Bypass -File .\setup-wizard.ps1

# 2. 启动服务（无黑框后台常驻）
powershell -ExecutionPolicy Bypass -File .\start-all.ps1

# 3. 运行健康体检并自动修复一切潜在环境问题
powershell -ExecutionPolicy Bypass -File .\doctor-repair.ps1 -AutoFix
```

---

## 🤖 场景 C：OpenAI Codex CLI / ChatGPT 桌面端接入

若您在日常工作中使用 OpenAI Codex CLI 或 ChatGPT 桌面客户端，只需：

1. 打开浏览器或独立桌面应用访问管理后台：`http://127.0.0.1:4010/balancer/ui`；
2. 在左侧或主卡片中找到 **【🤖 OpenAI Codex CLI 智能接入】**；
3. 点击 **【⚡ 一键接入 Codex】**；
4. 弹窗提示成功后，点击 **【🔄 重启 Codex 客户端】**（或系统自动完成脱钩重启）；
5. 此时打开 Codex，即可直接调用 OpenCode Go 官方所有 38 款模型（如 `deepseek-v4.1-flash`、`kimi-k3`、`qwen3.7-plus`、`glm-5.3-flash`），并支持调节全谱系思考等级（`low` 至 `xhigh`）。

---

## 📊 验证部署成功

打开管理后台仪表盘：
- 本机访问：`http://127.0.0.1:4010/balancer/ui`
- 局域网/NAS访问：`http://<服务器IP>:4010/balancer/ui`

当您在仪表盘顶部看到翠绿色状态提示，且账号卡片中显示了官方滑动窗口配额（5小时/周/月）百分比进度条时，即表明网关全功能正常就绪！
