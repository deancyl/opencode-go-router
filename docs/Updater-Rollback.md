# 组件安全更新与快照回滚系统 (Updater & Rollback)

本文档介绍 OpenCode Go Router 内置的 **组件版本监测、兼容性风险诊断与秒级灾备快照回滚系统**。

---

## 📦 监控的 5 大核心组件

| 组件标识 | 组件名称 | 监控源与生态角色 |
| :--- | :--- | :--- |
| `opencode-go-router` | 智能网关核心套件 | GitHub Releases / 本地 Git 仓库 |
| `opencode` | OpenCode CLI 核心引擎 | npm `@opencode/cli` / bun 运行时 |
| `oh-my-openagent` | OMO 多智能体协同插件 | npm `oh-my-openagent`，Sisyphus 任务规划 |
| `opencode-goal-plugin` | Goal 目标推进体系 | npm 官方插件，提供长程任务守护 |
| `openchamber` | OpenChamber 工作台 | 桌面客户端及 npm `@openchamber/web` |

---

## ⚠️ 破坏性变更 (Breaking Changes) 深度诊断

跨版本升级（例如 OpenCode 从 1.x 升级至 2.0+）经常带来重大的底层协议改动与参数废弃。
网关内置静态与动态兼容性分析引擎：
- **三级风险评级**：
  - 🟢 `safe`：完全向前兼容，无风险；
  - 🟡 `warning`：存在轻微格式调整或需重新热重载；
  - 🔴 `critical`：存在主版本跨越、命令参数重大废弃或插件 API 不兼容风险；
- **非阻断式告警**：醒目呈现破坏性变动说明与应对建议，但把掌控权交给开发者，支持用户确认后继续推进。

---

## 🛡️ 升级前全量快照与秒级一键回滚

### 1. 自动快照机制
在执行任何组件升级前，系统自动在 `snapshots/` 目录下创建全量时间戳快照：
- 备份所有涉及的核心配置文件（`config.json`、`opencode.jsonc`、`omo.jsonc`、OpenChamber 设置等）；
- 记录组件升级前的确切版本号与环境元数据；
- 维护最多 20 份历史快照，滚动安全清理。

### 2. 秒级一键回滚
当升级后发现异常或不符合预期时，可秒级无损回退：
- **Web 控制台**：进入【📦 组件版本与安全更新】面板，在历史快照列表中点击 **【⏪ 回滚此快照】**；
- **Windows 终端**：运行 `powershell -ExecutionPolicy Bypass -File .\rollback-all.ps1`；
- **Linux 终端**：通过向导菜单选择回滚操作。

所有配置将在毫秒内字节级还原，并将自动重新挂载 Office 离线预览补丁。

---

## ⚡ 两阶段暂存与事务级原子更新 (Angle 9)

针对下载中断、网络断流、Windows 文件锁占用（EBUSY）与语法损坏等边界条件，网关实现了 **五阶段事务级更新防御机制**：

1. **Stage 1: 暂存隔离拉取 (Staging Isolation)**：
   - 严禁在主目录或目标运行目录直接边下载边解压覆盖；
   - 更新包统一拉取解压至暂存沙箱目录 `.update_staging/`；
2. **Stage 2: 完整性与静态语法先验 (Pre-Flight Syntax Check)**：
   - 严格核验 `package.json` 的有效性；
   - 对核心执行入口（`server.js`、`updater.js` 等）执行 `node -c` 语法静态预检；
   - 若包损坏或语法检查未通过，立即清理暂存区，目标工作区保持 100% 零修改，杜绝半更新损坏；
3. **Stage 3: 就地核心代码灾备快照 (Pre-Switch Snapshot)**：
   - 覆盖前对本地当前关键运行代码生成 `.rollback_snapshot/` 就地快照；
4. **Stage 4: 多进程互斥安全文件替换 (Lock-Avoidance Safe Sync)**：
   - 针对 Windows 下正在运行的 `.exe` 或 `.dll` 句柄占用（`EBUSY` / `EPERM`），自动执行安全重命名避让（`.old.<timestamp>`）并写入新文件；
   - 替换过程若遭遇未知 I/O 异常，自动触发原地秒级原子自愈回滚；
5. **Stage 5: 启动健康自检探针与自动熔断回滚 (Health Probe & Auto-Rollback)**：
   - 更新后对 `/health` 端点进行探测自检；
   - 若服务启动失败或响应超时，自动触发熔断回滚，秒级退回上一稳定版本；
6. **生产统计数据零丢失保护 (Telemetry Data Guard)**：
   - `compression-history.json`、`compression-stats.json` 等生产遥测历史获得独立保护；回滚时若当前数据完好，绝不盲目覆写倒退，确保节省统计零丢失。
