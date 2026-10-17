# 常见问题与故障排障速查 (FAQ & Troubleshooting)

本文档整理了使用过程中的高频问题与秒级自愈方案。

---

## ❓ 常见问题排查速查表

### Q1: 在 Codex 中调用提示 `The supported API model names are deepseek-flash... but you passed deepseek-v4.1-flash`？
- **原因**：部分上游推理异构节点对模型名称有严格历史白名单限制。
- **解决**：在网关 `v2.6.4` 中已部署动态候选解析与无感跃迁引擎。网关在收到报错时会自动按同梯级推导兼容模型（`deepseek-v4.1-flash` $\to$ `deepseek-flash`）并在底层透明重放，客户端 100% 零报错。若在早期版本，只需升级至最新版网关即可。

### Q2: 为什么 GLM 5.3 Flash 等模型在客户端界面只能选中度思考？
- **原因**：早期模型元数据未声明高等级推理映射。
- **解决**：最新版网关已全量解锁 `low, medium, high, xhigh` 全谱系思考等级。在 Web 控制台点击【⚡ 一键接入 Codex】重新同步即可生效。

### Q3: 双击桌面图标打不开 OpenChamber 或秒退？
- **原因**：先前运行的 OpenChamber 异常退出后，在后台残留了无界面的僵死进程（`MainWindowHandle == 0`），霸占了 Electron 的 `SingleInstanceLock`。
- **解决**：在 Web 仪表盘点击 **【⚡ 一键修复】**，或运行 `powershell .\doctor-repair.ps1 -AutoFix`，系统会自动终止孤立僵死进程并脱钩唤醒。

### Q4: 启动网关提示 `EADDRINUSE: address already in use :::4010`？
- **原因**：先前的 Node 网关进程未正常退出或端口被占用。
- **解决**：运行 `.\stop-all.ps1`（Windows）或 `./stop-linux.sh`（Linux），脚本会自动强力回收 4010 占用进程后平滑重拉。

### Q5: Codex 界面突然变成英文？
- **原因**：注入配置时未强制写入语言锁定项。
- **解决**：点击 Web 控制台中的 **【⚡ 一键接入 Codex】**，网关将自动补齐 `[desktop].localeOverride = "zh-CN"`，随后点击 **【🔄 重启 Codex 客户端】** 即可恢复简体中文。

### Q6: OpenChamber 无法打开办公文档或打开空白？
- **原因**：OpenChamber 更新后覆盖了前端静态文件，导致离线解析补丁未挂载。
- **解决**：在 Web 控制台点击 **【⚡ 一键修复】**，或执行 `.\patch-openchamber-office.ps1 -Install`（Linux 下运行 `./patch-openchamber-office.sh install`），网关会自动重新挂载 100% 纯本地离线解析引擎。

### Q7: Windows 下终端报错 `#< CLIXML`、`&&` 无法识别或路径末尾引号被吞？
- **原因**：Windows PowerShell 原生环境与 Bash 语法差异（如 5.1 不支持 `&&`、末尾反斜杠转义吃引号、curl 默认被别名为 Invoke-WebRequest）。
- **解决**：最新网关内置 Card 5 Windows PowerShell 转义优化引擎，在 Windows 环境下全自动修复上述陷阱，并深度去噪 `#< CLIXML` 报错，无需人工手动改动命令。

### Q8: OpenCode 2.0+ 或 Claude Code 提示 `Upstream request failed: Go requires a credential`？
- **原因**：上游 Zen 聚合层对 `/v1/messages` 接口强制校验 `x-api-key` 与 `anthropic-version` 请求头。
- **解决**：网关在 `v3.4.1` 中已内置双轨鉴权装配，在代理 `/messages` 路由时自动注入 `x-api-key: <key>` 与 `anthropic-version: 2023-06-01`，无缝解决上游鉴权拒绝。

---

## 🆘 终极自愈：一键恢复

无论遇到任何环境或配置异常，只需依次执行以下三步：
1. **运行健康体检与修复**：Web 界面点击【一键修复】（或终端运行 `./doctor-repair.ps1 -AutoFix` / `./setup-linux.sh --repair`）；
2. **重新绑定客户端**：点击【一键应用至 OpenCode / OpenChamber】与【一键接入 Codex】；
3. **重启客户端**：点击【重启 Codex】或重启对应桌面软件。
整个系统即可瞬间恢复全绿！
