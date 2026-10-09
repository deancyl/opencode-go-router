<p align="center">
  <img src="assets/logo.png" width="128" height="128" alt="OpenCode Router Logo" style="border-radius: 24px; box-shadow: 0 0 25px rgba(16,185,129,0.35);">
</p>

# OpenCode Go Router & Full-Stack Toolkit
### OpenCode v2 + OpenChamber + Oh My OpenAgent + Goal 目标推进 + 双订阅高可用网关一体化套件 (Windows / Linux / NAS)

[![Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue.svg)](https://microsoft.com)
[![Linux](https://img.shields.io/badge/Platform-Linux%20%2F%20NAS%20(Debian%2CUbuntu%2CfnOS%2CDSM)-orange.svg)](https://kernel.org)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![OpenCode](https://img.shields.io/badge/OpenCode-v2.0%2B-orange.svg)](https://opencode.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version: v2.2.3](https://img.shields.io/badge/Version-v2.2.3-brightgreen.svg)](https://github.com/deancyl/opencode-go-router)

---

## 一、项目概述

本工具套件是专门为开发者与团队打造的 **OpenCode 全栈生态集成与多订阅高可用智能网关套件**。全面支持 **Windows 桌面端** 以及 **Linux / NAS 私有服务器端（Debian、Ubuntu、fnOS 飞牛私有云、群晖 Synology DSM、TrueNAS、Unraid 等）**。

解决在使用 OpenCode、OpenChamber、Oh My OpenAgent (OMO) 与 Goal 长程目标推进过程中遇到的各种环境配置繁琐、订阅限频卡顿、网络中断、跨平台路径差异与控制台黑框打扰等痛点。

### 🌟 核心特性

1. **跨平台原生部署与守护常驻**：
   - **Windows**：C# 编译的原生无窗口托盘程序（`OpenCodeRouterTray.exe`，`/target:winexe`），零黑框常驻，Edge `--app=...` 独立桌面软件级后台体验。
   - **Linux / NAS**：内置通用一键配置向导（`setup-linux.sh`），自动适配 systemd 用户级守护进程（`systemctl --user`）与 nohup 双模式回退，自动开启 `loginctl enable-linger` 保证用户登出后后台持续常驻。

2. **局域网 Web 安全访问控制与鉴权门禁**：
   - 支持监听 `0.0.0.0` 供局域网其他设备（PC、手机、平板）远程管理与调用。
   - 内置安全密码访问控制（配置 `uiPassword` 或环境变量 `OPENCODE_ROUTER_PASSWORD`），未授权拦截所有敏感 API 与管理面板。
   - 精致暗色系登录界面，基于 Cookie 与 Bearer Token 双重认证，支持一键注销。
   - 网页端 API Key 采用掩码保护（`sk-***`），支持一键切换显隐与敏感信息防泄漏。

3. **多订阅智能网关与负载均衡 (端口 4010)**：
   - 纯原生 Node.js 高可用反向代理，内存开销 < 15MB，无任何第三方重型依赖。
   - **会话亲和性 (Session Affinity)**：根据 `x-opencode-session` 锁定会话上下文，确保精准命中上游 KV 缓存 (Prompt Cache)，降低时延并节省费用。
   - **零感 429 / 503 故障漂移 (Failover)**：当主账号触发限流时，透明重试备用账号，上层客户端零感知、请求不中断。
   - **智能 Retry-After 冷却**：自动解析上游返回的限频等待头，精准控制冷却恢复时间。
   - **CORS 全预检支持**：原生处理 `OPTIONS` 跨域预检，完美兼容 OpenChamber Web 与第三方网页调用。

4. **官方配额三维立体可视化 (Quota Limits)**：
   - 直连 OpenCode 官方配额 API (`/zen/go/v1/usage`)，在管理后台每个账号卡片中直接呈现。
   - **5小时滑动限制 (5h Rolling)**、**周累计限额 (Weekly)** 与 **月累计限额 (Monthly)** 实时百分比进度条。
   - 智能预警色（<70% 翠绿健康、70%-90% 警示橙、>90% 高危红），并精确计算各窗口额度恢复与重置倒计时。
   - 测速时联动自动刷新，支持一键独立刷新各账号配额。

5. **全栈生态一键深度绑定 (Multi-Client Integration)**：
   - 控制台顶栏与 CLI 均支持 **【⚡ 一键应用至 OpenCode / OpenChamber】**。
   - **OpenCode CLI v2**：写入统一标准提供商映射，配置 `@ai-sdk/openai-compatible` 协议驱动，默认首选模型锁定为 `opencode-go/deepseek-v4.1-flash`。
   - **OpenChamber**：自动识别本地用户目录与 Docker 映射目录（如 `OPENCHAMBER_DATA_DIR`），锁定常用模型与首选收藏模型为 4010 智能网关。
   - **Oh My OpenAgent (OMO)**：自动生成 `~/.omo/omo.jsonc` 核心智能体路由配置，使用 `kimi-k3`、`qwen3.7-plus` 与 `glm-5.3` 智能避开部分区域限制。
   - **Goal 目标推进体系**：自动生成 `/boost` 极速增强模式与长程任务推进指令。

6. **全自动健康体检与故障自愈 (Doctor Engine)**：
   - 运行 `./setup-linux.sh --doctor`、`doctor-repair.ps1` 或在 Web 面板点击【一键体检】：
     - 自动排查 3001 等历史端口死链并重定向。
     - 自动检测并清除 provider 与 providers 单复数配置冲突。
     - 自动检测并解除 OpenChamber 僵死进程与单实例互斥锁（SingleInstanceLock）。
     - 自动检测并一键重置限频冷却状态（All accounts cooling down）。
     - 自动检测 OMO / Goal 模版完整性与工作区 Git 仓库。

7. **OpenChamber Office 全格式离线安全预览引擎 (Air-Gapped Office Engine - v1.4.0 新增)**：
   - **告别“不解码 DOCX”遗憾**：彻底终结 OpenChamber 无法直接查看办公文档的痛点，内嵌开箱即用；
   - **本地离线安全红线 (Air-Gapped Safety)**：100% 纯本地离线解析沙箱，严禁使用微软/谷歌等公网第三方云预览 iframe，彻底杜绝本地代码、商业合同与财务报表外泄；
   - **全格式支持与高保真渲染**：完整支持 `.docx`、`.xlsx` / `.xls`、`.pptx` / `.ppt`；
   - **双轨极速原厂联动**：页面顶部自带【在本地应用中打开】按钮，通过智能网关安全 API 毫秒级调起系统本地原厂 Office 或 WPS 打开源文件；
   - **高性能与虚拟切片保护**：大型 Excel 自动启用 1000 行平滑虚拟分页截断，防卡死防内存膨胀；
   - **跨平台一键挂载与无损还原**：内置 `patch-openchamber-office.ps1`（Windows 原生）与 `patch-openchamber-office.sh`（Linux/NAS），支持 `-Install`、`-Rollback` 与 `-Status`。

8. **全套组件一键检测更新、兼容性诊断与安全回滚系统 (Safe Updater & Rollback Engine - v2.0.0 重磅发布)**：
   - **5 大核心组件全景监控**：深度监测 `opencode-go-router`、`opencode` CLI、`oh-my-openagent`、`opencode-goal-plugin` 以及 `openchamber` 的本地版本与官方最新版本；
   - **破坏性变更深度兼容性分析**：智能识别主版本号跨越、破坏性变更（Breaking Changes）、参数废弃、协议不兼容风险，输出三级兼容性评级（`safe` / `warning` / `critical`）与升级建议；
   - **非阻断式安全预警 (Non-Blocking Warning)**：存在重大不兼容风险时在界面与终端提供醒目告警，但尊重开发者掌控权，支持确认后继续安全升级；
   - **升级前自动全量快照与灾备**：执行任何组件升级前自动打标备份所有配置文件、命令及状态（保留最多 20 份快照，滚动清理）；
   - **秒级一键回滚恢复 (One-Click Rollback)**：随时可从历史快照中一键还原全部配置文件，灾备无忧；
   - **OpenChamber 补丁无缝自愈重挂载**：在升级 OpenChamber 桌面端或 Web 客户端后，自动重新挂载 Office 离线安全预览补丁，杜绝因组件覆盖导致离线预览失效；
   - **全端协同覆盖**：Web 控制台全新“📦 组件版本与安全更新”面板、Windows `setup-wizard.ps1`、Linux `setup-linux.sh`、`doctor-repair.ps1`（第 7 项更新诊断）、托盘菜单及 `rollback-all.ps1` 全面打通。

---

## 二、系统架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                        前端交互层 (Interactive UIs)                     │
│  - OpenChamber Web / 桌面工作台 (http://127.0.0.1:3000 或 NAS:3000)     │
│  - 独立桌面应用 / 局域网 Web 管理后台 (http://<IP>:4010/balancer/ui)   │
│  - Windows 系统托盘常驻 (OpenCodeRouterTray.exe)                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                       智能调度层 (Orchestration Engine)                │
│  - Oh My OpenAgent (OMO): Sisyphus 任务规划, 子智能体并行               │
│  - Goal 目标推进体系: /goal 目标守卫, /boost 极速增强模式, ultrawork   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 统一提供商: opencode-go
┌───────────────────────────────────▼────────────────────────────────────┐
│          高可用智能路由网关 (opencode-go-router, 默认端口 4010)        │
│  - 跨平台支持: Windows 原生托盘 / Linux & NAS systemd/nohup 守护常驻    │
│  - Web 密码安全鉴权门禁 (Cookie + Bearer Token)                         │
│  - 会话亲和性 (Session Affinity) 锁定 Prompt Cache                     │
│  - 双账号轮询 (Round-Robin) 与 零丢包 429 故障转移 (Failover)          │
│  - 官方滑动窗口配额立体监控 (5h / 7d / 30d)                            │
│  - 全链路健康体检与自愈 API (/balancer/api/doctor & /repair)            │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │ 密钥 1                           │ 密钥 2
┌──────────────────▼───────────┐   ┌─────────────────▼───────────────────┐
│  OpenCode Go 订阅 1 ($10/月) │   │     OpenCode Go 订阅 2 ($10/月)     │
│  https://opencode.ai/zen/go  │   │     https://opencode.ai/zen/go      │
└──────────────────────────────┘   └─────────────────────────────────────┘
```

---

## 三、快速开始

### 场景 A：Linux / NAS / 私有云服务器部署（强烈推荐）

适用于 Debian、Ubuntu、fnOS (飞牛)、群晖 Synology (DSM 7+)、TrueNAS、Unraid 等服务器环境：

#### 方式 1：远程极速一键安装（无需预先 clone，全自动搞定）
```bash
# 启动交互式向导：
curl -fsSL https://raw.githubusercontent.com/deancyl/opencode-go-router/master/install.sh | bash

# 或非交互式一键静默全套配置：
curl -fsSL https://raw.githubusercontent.com/deancyl/opencode-go-router/master/install.sh | bash -s -- --all --host 0.0.0.0 --port 4010 --password "你的密码"
```

#### 方式 2：克隆仓库本地部署
```bash
# 1. 克隆代码至本地
git clone https://github.com/deancyl/opencode-go-router.git ~/.opencode-go-router
cd ~/.opencode-go-router

# 2. 赋予脚本执行权限
chmod +x *.sh

# 3. 运行交互式配置向导 (推荐首次配置)
./setup-linux.sh
```

#### 交互式菜单选项：
```
================ 请选择操作菜单 ================
 [1] 一键全自动全套配置 (推荐: 部署网关+配置守护+绑定客户端)
 [2] 仅部署/更新 4010 智能网关后台服务
 [3] 配置双账号密钥与 Web 访问安全密码
 [4] 一键绑定本地 OpenCode + OpenChamber + OMO + Goal
 [5] 启动 / 重启网关服务
 [6] 停止网关服务
 [7] 查看运行状态与官方配额
 [8] 运行健康体检 (Doctor) 与自动修复
 [0] 退出
================================================
```

#### 非交互式一键部署指令：
```bash
# 一键部署网关、设置安全密码并绑定所有客户端：
./setup-linux.sh --all --host 0.0.0.0 --port 4010 --password "你的安全访问密码" --key1 "sk-xxx-1" --key2 "sk-xxx-2"

# 单独重新绑定所有客户端 (自动热重启 OpenCode / OpenChamber 服务)：
./setup-linux.sh --bind

# 查看网关运行状态与连通性：
./status-linux.sh

# 停止 / 启动网关服务：
./stop-linux.sh
./start-linux.sh
```

---

### 场景 B：Windows 桌面端使用

#### 方式 1：双击可执行文件（推荐普通用户）
1. **运行配置向导**：双击 `OpenCodeWizard.exe`，按数字键选择配置项（输入 `6` 执行一键全套配置）。
2. **启动托盘常驻**：双击 `OpenCodeRouterTray.exe`，任务栏右下角出现托盘图标，并以独立应用窗口唤出管理后台。

#### 方式 2：使用 PowerShell 脚本（推荐开发者）
```powershell
# 1. 运行交互式配置向导
powershell -ExecutionPolicy Bypass -File .\setup-wizard.ps1

# 2. 启动全套服务 (静默无黑框后台常驻)
powershell -ExecutionPolicy Bypass -File .\start-all.ps1

# 3. 运行健康体检与修复
powershell -ExecutionPolicy Bypass -File .\doctor-repair.ps1 -AutoFix

# 4. 查看当前状态与流量
powershell -ExecutionPolicy Bypass -File .\status-all.ps1

# 5. 安全停止服务
powershell -ExecutionPolicy Bypass -File .\stop-all.ps1
```

---

## 四、配置文件说明 (`config.json`)

配置文件位于当前目录下的 `config.json`（首次启动自动生成）：

```json
{
  "port": 4010,
  "host": "0.0.0.0",
  "upstream": "https://opencode.ai/zen/go/v1",
  "defaultCooldownMs": 60000,
  "maxFailoverRetries": 2,
  "sessionAffinityEnabled": true,
  "uiPassword": "你的Web管理控制台访问密码",
  "accounts": [
    {
      "id": "account-1",
      "name": "OpenCode Go 主账号",
      "apiKey": "sk-opencode-key-1",
      "enabled": true
    },
    {
      "id": "account-2",
      "name": "OpenCode Go 备用账号",
      "apiKey": "sk-opencode-key-2",
      "enabled": true
    }
  ]
}
```

### 字段说明：
- `host`：监听地址。在 NAS/Linux 下建议设置为 `"0.0.0.0"`，便于局域网其他设备访问；Windows 本地单机建议 `"127.0.0.1"`。
- `port`：网关端口，默认 `4010`。
- `uiPassword`：Web 控制面板访问密码。留空表示无需登录直接访问；若设置了密码或设置了环境变量 `OPENCODE_ROUTER_PASSWORD`，则访问管理面板和敏感 API 时强制要求登录。
- `sessionAffinityEnabled`：是否开启基于 `x-opencode-session` 的会话亲和性锁定（默认 `true`，命中 Prompt Cache 提速防多账号漂移）。
- `accounts`：订阅账号池，支持动态新增多个账号并各自独立启用/禁用。

> 💡 **提示**：直接在 Web 控制面板（`http://<IP>:4010/balancer/ui`）修改配置并点击【保存配置】，网关会立即热重载生效，无需重启进程！

---

## 五、生态客户端绑定说明

### 1. OpenCode CLI (v2.x)
- 写入位置：`~/.config/opencode/opencode.jsonc`
- 配置特性：
  - 注册 `opencode-go` 提供商，端点指向 `http://127.0.0.1:4010/v1`。
  - 支持 `providers`（v2 标准复数格式）与 `provider`（兼容单数格式）双重映射。
  - 默认模型设定为 `opencode-go/deepseek-v4.1-flash`。

### 2. OpenChamber Web / 桌面工作台
- 写入位置：`~/.config/openchamber/preferences.json` 与 `settings.json`（若在 NAS Docker 环境下，自动搜寻并写入挂载数据目录如 `/vol3/1000/docker/opencode/openchamber/data`）。
- 配置特性：
  - 将 `opencode-go/deepseek-v4.1-flash` 和 `opencode-go/kimi-k3` 写入首选常用模型列表（`recentModels`）与收藏模型列表（`favoriteModels`）。

### 3. Oh My OpenAgent (OMO)
- 写入位置：`~/.omo/omo.jsonc`
- 配置特性：
  - 规划智能体 `sisyphus` 映射至 `opencode-go/kimi-k3`。
  - 核心推理分类 `ultrabrain` 映射至 `opencode-go/deepseek-v4.1-flash`。
  - 多模态与视觉智能体映射至原生支持无区域限制的模型。

### 4. Goal 目标推进体系
- 写入位置：`~/.config/opencode/commands/boost.md`
- 支持快捷执行 `/goal <目标>` 或 `/boost <目标>`，自动唤醒多智能体全链路自主推演。

---

## 六、API 路由接口清单

| 路由路径 | 请求方法 | 认证保护 | 功能描述 |
| :--- | :---: | :---: | :--- |
| `/health` | GET | 无 | 基础健康检查探测，返回运行状态与健康账号数 |
| `/status` | GET | 无 | 网关核心运行指标概览（账号列表、总请求数、故障转移次数等） |
| `/v1/chat/completions` | POST | 携带 Key/转发 | 兼容 OpenAI / OpenCode 的大模型对话补全反向代理 |
| `/balancer/ui` | GET | 支持门禁 | Web 可视化控制管理后台界面 |
| `/balancer/api/auth` | POST | 无 | Web 控制台管理员登录鉴权接口（验证密码并下发 Token） |
| `/balancer/api/config` | GET / POST | 需要密码 | 获取或热更新当前网关完整配置 |
| `/balancer/api/account-quota` | GET | 需要密码 | 直连官方拉取 5h 滑动、周累计、月累计真实配额信息 |
| `/balancer/api/reset-cooldown` | POST | 需要密码 | 手动解除指定账号的限频冷却状态（恢复健康可用） |
| `/balancer/api/doctor` | GET | 需要密码 | 执行全链路系统体检，返回配置诊断与异常发现项 |
| `/balancer/api/repair` | POST | 需要密码 | 执行一键系统自动修复（端口死链纠正、缺失配置补全、Office 预览引擎挂载） |
| `/balancer/api/bind-desktop` | POST | 需要密码 | 执行全栈生态客户端（OpenCode / OpenChamber / OMO）一键写入绑定 |
| `/balancer/api/open-file` | POST | 无/本地校验 | 本地原厂应用程序一键安全唤醒（毫秒级调用系统默认 Office / WPS 打开指定文档） |
| `/balancer/api/updates/check` | GET | 需要密码 | 一键检测全套 5 大组件最新版本与破坏性变更兼容性诊断 |
| `/balancer/api/updates/apply` | POST | 需要密码 | 执行组件安全升级，前置自动打标备份全量快照，支持 OpenChamber 补丁重挂载 |
| `/balancer/api/updates/rollback` | POST | 需要密码 | 指定历史快照秒级一键回退灾备，全量复原配置文件与生态环境 |
| `/balancer/api/updates/snapshots` | GET | 需要密码 | 获取历史灾备快照列表及快照详情元数据 |

---

## 七、测试与质量保证

本项目配备 18 项端到端单元与集成自动化测试套件：

```bash
npm test
# 或
node test_router.js
```

### 包含测试项：
1. **[Test 1]** `/health` 健康检查端点测试
2. **[Test 2]** CORS OPTIONS 跨域预检测试
3. **[Test 3]** `/status` 状态指标测试
4. **[Test 4]** 账号负载均衡轮询 (Round-Robin) 测试
5. **[Test 5]** `x-opencode-session` 会话亲和性锁定测试
6. **[Test 6]** 上游 429 自动静默故障漂移 (Failover) 与恢复测试
7. **[Test 7]** `/balancer/api/reset-cooldown` 限频冷却重置 API 测试
8. **[Test 8]** `/balancer/api/doctor` 智能体检诊断 API 测试
9. **[Test 9]** 账号池全熔断保护 (Pool-wide 429 Cooldown Protection) 测试
10. **[Test 10]** 客户端主动断开连接隔离测试 (Client Abort Isolation)
11. **[Test 11]** 代理响应及错误响应 CORS 标头校验测试
12. **[Test 12]** `/balancer/api/repair` 自动修复 API 测试
13. **[Test 13]** `/balancer/api/bind-desktop` 跨平台多生态客户端写入绑定测试
14. **[Test 14]** UI Password 访问密码安全鉴权门禁拦截与 Bearer Token 访问测试
15. **[Test 15]** `/balancer/api/open-file` 本地原厂应用程序调用与路径合法性校验测试
16. **[Test 16]** 5 大核心组件版本检测与破坏性变更兼容性评级诊断测试 (`/balancer/api/updates/check`)
17. **[Test 17]** 全量组件自动快照创建与安全升级机制测试 (`/balancer/api/updates/apply`)
18. **[Test 18]** 历史快照秒级灾备回滚与生态数据全量复原测试 (`/balancer/api/updates/rollback`)

---

## 八、构建与二次开发

Windows 原生静默托盘及向导程序使用 Windows 自带的 .NET C# 编译器编译，无需额外安装 Visual Studio：

```powershell
# 编译生成原生 Windows GUI 无黑框可执行文件
npm run build:exe
```

---

## 九、版本历史与更新记录

### 🚀 v2.1.0 (全链路健壮性增强与生态深度对齐里程碑发布)
经过 10 个 0.1 级别的微小渐进式敏捷迭代与严密自动化回归验证，全面升级系统跨平台通用性、原生沙箱安全防御与灾备恢复能力：
- **v2.0.1 安全加固与原生文件执行沙箱防御 (Sandbox Security Hardening)**：
  - 彻底封堵 `/balancer/api/open-file` 接口的命令注入漏洞，抛弃拼接外壳字符串的 `exec`，改用参数数组隔离的 `spawn`；
  - 建立严格后缀黑名单防护机制（覆盖 `.exe`, `.bat`, `.cmd`, `.com`, `.vbs`, `.vbe`, `.js`, `.jse`, `.wsf`, `.wsh`, `.msi`, `.ps1`, `.sh`, `.reg`, `.dll`, `.sys`, `.lnk`, `.url`, `.appref-ms` 等），优先拦截并返回 `403 Forbidden`；
  - 增加 Windows 网络 UNC 共享路径安全阻断（拦截 `\\host\share` 与 `//host`，彻底杜绝 NTLM 凭据外泄攻击）；
  - 全面支持 `file:///` 本地文件 URL 解析与百分号转义清洗；
  - 修复 `office-preview-engine.js` 内联字符串拼接在 Windows 反斜杠转义下损坏语法的隐患，全面改用 DOM 原生事件闭包，并动态适配当前局域网访问主机名与 HTTPS 环境跨协议检测。
- **v2.0.2 跨平台工作区与 NAS / Docker 多卷动态探测 (Multi-Volume Workspace Engine)**：
  - 消除 Windows 盘符硬编码，引入多驱动器动态探测（`D:\`, `E:\`, `C:\`, 用户目录等）；
  - 全面支持 Linux / NAS 多卷动态挂载探测（群晖 Synology DSM `/volume1`, `/volume2`, fnOS 飞牛 `/vol1..vol4`, TrueNAS `/mnt/user/appdata` 及 Docker 容器卷）；
  - `bindDesktopConfig` 与 `setup-linux.sh` 同步覆盖全系列 NAS 卷路径，确保 OpenChamber 配置一键绑定百分之百命中。
- **v2.0.3 前端热补丁 AST 特征动态匹配与双端容错 (AST Dynamic Patching & Positional CLI)**：
  - 前端热补丁脚本升级为 AST 正则特征动态提取（`([A-Za-z0-9_$]+)=r=>\{(?:(?!function|[A-Za-z0-9_$]+=r=>).)*?filesView\.artifact\.binary`），从容应对 OpenChamber Web 打包混淆变量名变动；
  - 修复 Linux / NAS 脚本 `patch-openchamber-office.sh` 位置参数匹配缺陷，支持 `install`、`rollback`、`status` 原生动词与选项双重调用，彻底杜绝还原时错误重复安装的隐患；
  - `patch-openchamber-office.ps1` 同步支持位置动词参数并对齐全平台候选路径。
- **v2.0.4 端口冲突自愈与守护看门狗容灾增强 (Port Self-Healing & Daemon Watchdog)**：
  - 针对 `EADDRINUSE` 错误引入智能端口释放自愈机制，自动发现并清理陈旧孤立残留进程，1 秒内平滑重连；
  - PowerShell 与 C# 托盘统一使用去重管道（`Select-Object -ExpandProperty OwningProcess -Unique`），消除双栈 IPv4/IPv6 监听下的多进程判定异常；
  - `stop-all.ps1` 增加对 `OpenCodeRouterTray` 原生进程的强力终止保护，防止托盘看门狗在停止服务后误复活。
- **v2.0.5 负载均衡器会话亲和与滑动窗口配额监控健全化 (Affinity & Quota Robustness)**：
  - 引入 LRU 会话淘汰机制（上限 5000 会话），根除长期高频调用可能引发的内存泄露；
  - 修复全局限频冷却时 `Math.min(...[])` 产生 `Infinity` / `NaN` 的数学边界风险；
  - 冷却时间输入全链路校验与防越界保护。
- **v2.0.6 深度配置语法规范化与单复数冲突清洗引擎 (JSON Normalization & Conflict Cleaner)**：
  - 强化 `stripJsonComments` 引擎，支持智能清除尾部多余逗号 `,(\s*[}\]])` 与复杂多行块级注释；
  - 清理 `providers['opencode-go']` 冲突时严密保留第三方服务商配置。
- **v2.0.7 OMO 智能体调度无限制模型 Fallback 路由全链路对齐 (OMO Harmonization)**：
  - 统一全平台 OMO 默认调度模型模版（`glm-5.3`、`minimax-m3`、`qwen3.7-plus`、`kimi-k3`、`deepseek-v4.1-flash`、`deepseek-v4-pro`）；
  - 全面清理 `doctor-repair.ps1` 与 `setup-wizard.ps1` 中陈旧残留的 `glm-5.2` 与 `minimax-m2.7`。
- **v2.0.8 灾备快照文件元数据/权限持久化与损坏快照容错 (Snapshot Metadata & Corruption Tolerance)**：
  - `createSnapshot` 记录 POSIX mode 权限与文件元数据，`rollbackSnapshot` 在 Linux/macOS 上高保真还原文件权限；
  - `listSnapshots` 与 `rollbackSnapshot` 增加防御性容错，损坏的快照目录或损坏的 manifest JSON 不会导致服务或面板崩溃。
- **v2.0.9 Web 控制台 UI 双语优化、端点一键复制、局域网访问 IP 显示与触控适配 (UI Polish & Dual-Track Auth)**：
  - Web UI 顶栏增加 Base URL 动态展示、一键复制按钮与网络主机指示器（本地监听 vs 局域网/NAS访问）；
  - 强化前端 fetch 请求中的 Token 与 Cookie 双轨回退机制；
  - 增加移动端与触控设备自适应媒体查询（响应式断点）。
- **v2.1.0 自动化测试套件扩充至 34 项全绿验证与二进制编译发布 (v2.1.0 Milestones & 34 Test Suite)**：
  - `test_router.js` 扩展至 34 项全量自动化测试，覆盖安全沙箱、UNC网络防御、file:///解析、AST正则提取、快照元数据、损坏容灾、会话亲和并发、JSON清洗、全平台多卷候选矩阵与跨组件对齐；
  - 重新编译 C# 原生托盘程序 `OpenCodeRouterTray.exe` 与向导程序 `OpenCodeWizard.exe`；
  - 全量发布说明与文档对齐。

### 🚀 v2.2.3
- **原创品牌视觉升级与全尺寸高清 Logo 矩阵 (High-Def Brand Logo & Multi-Res Assets)**：
  - **彻底告别 Codex 螺旋旧标**：为 OpenCode 智能路由网关量身打造原创科技感品牌视觉，采用深黑曜石微弧背景、量子发光棱镜枢纽、互联拓扑路由网络与霓虹青翠发光光效，突显高可用网关与调度枢纽定位；
  - **全尺寸 Windows 原生图标矩阵 (`assets/router.ico`)**：涵盖 16x16、32x32、48x48、64x64、128x128、256x256 完整六阶多分辨率，在 4K/2K 高分屏、Windows 资源管理器大图标预览与系统托盘下均保持像素级细腻清晰；
  - **C# 原生可执行文件深度嵌入**：将最新原生图标重新编译嵌入 `OpenCodeRouterTray.exe` 与 `OpenCodeWizard.exe` 的 PE 资源中，桌面快捷方式与任务栏无缝显示全新图标；
  - **Web 控制台与登录门面焕新**：网关内置静态资源直出管线（`/favicon.ico` 与 `/assets/logo.png`），在安全验证登录卡片与仪表盘顶栏优雅呈现发光品牌微标，并绑定浏览器 Tab 标签 Favicon；
  - **自动化测试 47 项持续全绿**：全链路回归验证通过。

### 🚀 v2.2.2
- **组件更新引擎双轨容灾与原生二进制智能同步 (Dual-Engine Updater & Binary Sync)**：
  - **包管理器智能识别与 npm 优先策略**：针对 Windows 环境平台差异，更新引擎优先使用能够完整运行 `postinstall.mjs` 原生解压脚本的 `npm`，根治 Bun 在 Windows 上拦截原生二进制解压导致全局 Shim 损坏（`could not create process` / `Resolving dependencies`）的顽疾；
  - **Bun / npm 双引擎无缝回退**：在执行任何组件（OpenCode CLI、Oh My OpenAgent、Goal、OpenChamber）升级时，若首选包管理器受阻，自动透明回退至备选引擎重新执行，并自动添加 `--trust` 权限标志；
  - **Windows 原生可执行文件智能同步与残余清理**：升级完成后自动清理 `.bun\bin` 下损坏的占位 Shim，并原子级同步更新 `%APPDATA%\npm\opencode.exe` 原生主执行文件，确保命令行即刻调用最新版；
  - **全组件 100% 达标最新版**：OpenCode CLI v2.0.26、Oh My OpenAgent v5.1.27、OpenChamber v2.2.0、Goal v0.11.0、网关自身 v2.2.2 全量就绪。

### 🚀 v2.2.1
- **系统托盘与控制台全方位体验升级与高可用加固 (Experience & Dashboard Hardening)**：
  - **默认浏览器自适应与 Chrome 独立桌面 App 模式**：通过注册表精准识别用户主力默认浏览器（Chrome / Edge 等），以纯净无地址栏的 `--app=http://127.0.0.1:4010/balancer/ui` 独立桌面模式秒级呼出，辅以 5 级优雅降级容灾，彻底根治“打开订阅管理面板打不开”问题；
  - **托盘交互精简与原生 OpenChamber 桌面端智能置顶**：彻底剔除鸡肋的“3000 端口网页”菜单，升级为纯粹原厂体验的 **【💻 唤醒 / 启动 OpenChamber 桌面端】**，通过 Win32 API 毫秒级恢复置顶已有桌面窗口，并具备僵死锁自愈与脱钩启动能力；
  - **Web 控制台前端模板转义深度修复**：彻底修复多组件更新与快照回滚模块中的 JavaScript 模板字符串转义缺陷（`\\'` 与 `\\n`），根治前端页面因语法解析错误导致的订阅账号卡片留白与“+ 添加订阅账号”无响应问题；
  - **托盘生命周期与宿主加固**：固化 WinForms 隐藏消息窗体宿主（`HiddenForm`），提升单实例互斥锁抗并发与旧实例清理的稳定性。

### 🚀 v2.2.0
- **OpenAI Codex CLI 智能无缝接入与双向协议桥 (Codex Native Bridge Engine)**：
  - **全量 38 款模型目录接入**：支持 OpenCode Go 官方所有 38 款模型（DeepSeek V4.1/Pro、Kimi K3、MiniMax M3、通义千问 Qwen3.7、智谱 GLM 5.3、Claude Haiku、Grok 4.7、GPT 5.6/6 Luna 等）直接在 Codex CLI 中通过 `-m <model>` 调用；
  - **双向协议转换引擎 (`codex-adapter.js`)**：Codex 原生使用 `wire_api = "responses"`，网关自动完成 OpenAI Responses API <-> OpenAI ChatCompletions 与 Anthropic Messages API 的实时双向 SSE 流式转换，支持工具调用 (`tool_calls`) 与深度思考上下文；
  - **思考等级 (Reasoning Effort) 自由调节**：全面适配 `low`、`medium`、`high`、`xhigh`、`max`，实时映射各模型推理推导参数；
  - **原子配置备份与一键原样还原 (Zero-Loss Restore Engine)**：接入前自动备份原始 `config.toml`、`auth.json` 与 `models.json`，还原时字节级无损复原，还原后自动清理临时备份无残留；
  - **全端协同联动**：Web 控制台新增专属【🤖 OpenAI Codex CLI 智能接入】配置面板、`doctor-repair.ps1` 扩展至 8 步体检自愈检测、`setup-wizard.ps1` 新增步骤 10 交互式接入与还原；
  - **自动化测试扩充至 47 项**：全套覆盖 Codex 绑定/还原、Responses <-> ChatCompletions/Anthropic 协议桥、SSE 流生命周期与真实命令执行，47 项测试 100% 通过。

### 🚀 v2.1.2
- **OpenChamber 原厂桌面客户端智能唤醒与前台置顶 (Native Desktop Client Launcher)**：
  - **彻底终结“盲目打开浏览器网页”的不实用体验**：托盘右键优先展示 **【💻 唤醒 / 启动 OpenChamber 桌面端】**，点击优先激活真正的本地 Electron 客户端，同时保留 **【🌐 独立 Web 工作台 (3000 端口)】** 双轨模式；
  - **Win32 窗口置顶与无感恢复**：检测到已有 OpenChamber 桌面窗口处于最小化或后台时，直接调用 Win32 `ShowWindowAsync(SW_RESTORE)` 与 `SetForegroundWindow` 毫秒级瞬间激活置顶至最前台；
  - **单实例互斥锁死锁防御**：检测到后台存在无窗口僵死进程（`MainWindowHandle == 0`）霸占 Electron `SingleInstanceLock` 时，自动强力终止并释放互斥锁后脱钩启动；
  - **进程脱钩规范**：严格遵循准则，启动桌面客户端通过 `explorer.exe <path>` 安全脱钩启动，严禁挂接临时终端 Job 树；
  - **多端与后端 API 支持**：网关后端新增 `/balancer/api/launch-chamber` 接口，Web 管理控制台顶栏同步增加 **【💻 唤醒桌面端】** 快捷操作。
- **托盘多级浏览器探测与 5 级降级容灾引擎 (Multi-Tier Browser Fallbacks)**：
  - **解决“打开订阅管理面板打不开浏览器”故障**：重构托盘 `OpenUrl` 调用链，通过 Windows 注册表 `App Paths` 精准探测 Edge / Chrome 权威路径；
  - **5 级无窗口容灾回退**：Edge `--app=` -> Chrome `--app=` -> Windows 默认浏览器 (`UseShellExecute = true`) -> `explorer.exe` 兜底 -> `cmd.exe start` 终极无黑框唤起，确保 100% 能够在桌面弹出管理面板。
- **自动化测试扩充至 35 项**：新增 Test 35 自动化覆盖桌面端启动契约与多级浏览器探测容灾，全套 35 项测试全绿通过。

### 🚀 v2.0.0
- **全套组件一键检测更新与安全升级系统 (One-Click Safe Updater)**：
  - **5 大核心组件全景监控**：一站式检索并比对 `opencode-go-router`、`opencode` CLI、`oh-my-openagent`、`opencode-goal-plugin` 与 `openchamber` 的本地及最新发布版本；
  - **破坏性变更与生态兼容性诊断引擎**：深入检测 OpenCode CLI 主版本升级潜在的配置格式与命令行参数变更、OMO 智能体插件兼容性（如 5.1.24+ 对齐）、OpenChamber 托管通讯协议兼容性，输出精准的 `safe`、`warning`、`critical` 评级；
  - **非阻断式人性化告警**：存在高危兼容性变更时给予直观视觉告警提示与前置修复建议，但不硬编码强行拦截，支持开发者自主确认推进；
  - **升级前自动全量快照与秒级灾备回滚**：升级前自动建立全量配置与数据快照（保留至多 20 份），支持 Web 控制台、Windows 向导与 Linux 终端秒级一键回退还原历史状态；
  - **Office 离线安全预览补丁自动重挂载**：OpenChamber 组件更新后自动重新应用本地 Office 预览沙箱补丁，防止前端资源覆盖后离线预览失效；
  - **全新更新管理 API 体系**：暴露 `/balancer/api/updates/check`、`/balancer/api/updates/apply`、`/balancer/api/updates/rollback` 与 `/balancer/api/updates/snapshots`；
  - **全平台交互体验升级**：
    - Web UI 管理后台新增专属【📦 组件版本与安全更新】面板，支持一键检测、单选/全选安全更新与历史快照回滚；
    - Windows 向导 `setup-wizard.ps1` 与 Linux 向导 `setup-linux.sh` 分别新增专属更新与回滚菜单；
    - `doctor-repair.ps1` 升级为 7 步全链路诊断，新增组件更新体检与 `--AutoFix` 联动支持；
    - Windows 托盘程序 `OpenCodeRouterTray.exe` 新增一键检查更新入口；
    - `rollback-all.ps1` 优先联动快照系统执行全量安全还原。
- **自动化测试套件扩充至 18 项**：新增 Test 16、17、18 严密覆盖更新检测、安全快照升级及全量回滚全生命周期，100% 通过验证。

### 🚀 v1.4.0
- **OpenChamber 全能 Office 离线安全预览引擎 (Air-Gapped Office Engine)**：
  - **彻底告别“OpenChamber 不解码 DOCX 文件”遗憾**：内置开箱即用的本地预览引擎，覆盖 `.docx`、`.doc`、`.xlsx`、`.xls`、`.pptx`、`.ppt` 等全系列主流办公文档；
  - **本地离线安全红线 (Air-Gapped Safety 红线保障)**：严禁使用微软或谷歌等公网第三方云预览 iframe（如 `view.officeapps.live.com`），确保本地私有代码、敏感合同与财务数据绝不外泄；
  - **双轨联动机制 (Dual-Track Native Launch)**：预览界面内嵌【在本地应用中打开】按钮，通过网关 `/balancer/api/open-file` 接口安全唤醒本地 Office 或 WPS 原生软件；
  - **大文件性能防御**：针对大型表格（Excel）自动启用 1000 行平滑虚拟分页截断机制，杜绝渲染阻塞与内存溢出；
  - **跨平台一键部署与无损还原**：
    - Windows 原生脚本：`patch-openchamber-office.ps1`（支持 `-Install`、`-Rollback`、`-Status`）；
    - Linux / NAS 原生脚本：`patch-openchamber-office.sh`（支持 `install`、`rollback`、`status`）；
    - 无缝深度集成至 `setup-wizard.ps1`（步骤 8 / 一键全配）与 `setup-linux.sh`（步骤 9 / 一键全配）。
- **全链路健康自愈系统全面纳管 Office 预览引擎**：
  - `doctor-repair.ps1` 与 `server.js` 的 `/balancer/api/doctor` 同步检测 OpenChamber Office 引擎挂载状态；
  - 一键修复（`/balancer/api/repair` 与 `doctor-repair.ps1 -AutoFix`）自动修补并挂载预览引擎；
  - Web UI 管理控制台顶栏直观呈现 `Office 预览: ✔ 已挂载` 状态指示。
- **完善自动化测试**：新增 Test 15 验证本地文件原生唤起接口与边界安全校验，测试集扩充至 15 项全绿通过。

### 🚀 v1.3.3
- **深度根治 OpenChamber 桌面端打不开 / 无法启动 / 秒退痛点**：
  - **定位 Electron SingleInstanceLock 死锁机理**：OpenChamber 底层依赖 Electron `app.requestSingleInstanceLock()` 机制防多开；当后台残留隐藏/无界面的僵死 OpenChamber 进程（`MainWindowHandle == 0`）时，新启动的桌面端实例检测到互斥锁已被占，会静默退出（ExitCode 0），导致双击图标无任何响应；
  - **进程健康状态与僵死检测纳入 Doctor 体系**：在 `doctor-repair.ps1` 与 `server.js` 的 `/balancer/api/doctor` 接口中全面增加 `openchamber_ghost_process` 检测。遍历 Windows 进程表，当发现所有 OpenChamber 实例均为无窗口僵死状态时，自动标红告警并提供释放方案；
  - **孤立内嵌服务残留清理**：检测 OpenChamber 退出后滞留在后台的孤立 `opencode serve --hostname 127.0.0.1` 进程并提供释放方案，防止端口争用与陈旧配置混淆；
  - **一键极速自愈与单实例锁释放**：在 `doctor-repair.ps1 -AutoFix` 及 Web 控制台【一键自动修复】（`/balancer/api/repair`）中，自动强力终止后台僵死进程并清理孤立进程，瞬间释放单实例互斥锁，彻底恢复桌面端双击秒开体验；
  - **Web 管理面板实时联动**：在诊断面板顶栏实时呈现 OpenChamber 的桌面运行状态（`✔ 运行中`、`❌ 僵死死锁`、`未运行`）。

### 🚀 v1.3.2
- **彻底解决 OpenCode 配置冲突与 ConnectionRefused 致命隐患**：
  - 深入排查并清除了 `provider`（单数）与 `providers`（复数）同时存在时触发的 `configuration normalization diagnostic: path=$.providers.opencode-go kind=conflict action="retained native value over legacy value"` 冲突；
  - 规范统一采用标准单一 `provider` 结构，消除因配置冲突导致 OpenCode 回退直连官方、遭系统代理阻断并报 `ConnectionRefused` 的根因。
- **全链路体检与自愈系统 (Doctor Engine) 重大升级**：
  - **冲突检测与一键自愈**：自动检测 `opencode.jsonc` 中的单复数配置冲突，一键清理冗余冲突键，恢复纯净配置；
  - **端到端轻量推理探针 (E2E Completion Probe)**：不仅检测网关端口，更直接模拟真实请求校验上游通道（如 `deepseek-v4.1-flash`），确保毫秒级链路通畅；
  - **OpenChamber 托管实例陈旧状态检测与热重载**：检测 OpenChamber 内嵌的 `opencode serve` 进程是否与最新配置脱节，支持平滑重启托管服务或桌面端，彻底终结“修改配置后前端界面卡死在 Retrying in 9s (attempt 10)”的困局。
- **全端同步**：`doctor-repair.ps1`、`setup-wizard.ps1`、`server.js`、`setup-linux.sh` 全面对齐自愈逻辑。

---

## 十、开源许可

本项目基于 [MIT License](LICENSE) 许可协议开源。
