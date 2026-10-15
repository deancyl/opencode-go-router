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
