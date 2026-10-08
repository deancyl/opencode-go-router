# OpenCode Go Router & Full-Stack Toolkit
### OpenCode v2 + OpenChamber + Oh My OpenAgent + Goal 目标推进 + 双订阅高可用网关一体化套件

[![Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue.svg)](https://microsoft.com)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![OpenCode](https://img.shields.io/badge/OpenCode-v2.0%2B-orange.svg)](https://opencode.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 一、项目概述

本工具套件是专门为 Windows 开发者打造的 **OpenCode 全栈生态集成与订阅高可用管理工具**。解决个人或团队在使用 OpenCode、OpenChamber、Oh My OpenAgent (OMO) 与 Goal 长程目标推进过程中遇到的各种环境配置复杂、订阅限频卡顿、网络中断与控制台黑框打扰等痛点。

### 🌟 核心特性

1. **协助安装 OpenCode v2**：
   - 自动化检测本地 OpenCode 核心引擎版本（`opencode --version`）。
   - 支持一键通过 npm 或 bun 下载并配置 `@opencode/cli` 及 Windows 原生二进制包，解决 Windows 下 postinstall 脚本受限或 229 字节空占位符等典型暗坑。

2. **多订阅智能网关与负载均衡 (端口 4010)**：
   - 原生 Node.js 高可用反向代理，内存开销 < 15MB，无任何第三方重型依赖。
   - **会话亲和性 (Session Affinity)**：根据 `x-opencode-session` 锁定会话上下文，确保精准命中上游 KV 缓存 (Prompt Cache)，降低时延并节省费用。
   - **零感 429 / 503 故障漂移 (Failover)**：当主账号触发限流时，透明重试备用账号，上层客户端零感知、请求不中断。
   - **智能 Retry-After 冷却**：自动解析上游返回的限频等待头，精准控制冷却恢复时间。
   - **CORS 全预检支持**：原生处理 `OPTIONS` 跨域预检，完美兼容 OpenChamber Web 与第三方网页调用。

3. **内核级静默托盘与桌面 GUI (无终端黑框)**：
   - 提供使用 C# 原生编译的轻量级 Windows 窗口程序 **`OpenCodeRouterTray.exe`** (`/target:winexe`)。
   - 彻底告别传统 cmd/powershell 的常驻黑框打扰，完全静默托管在右下角系统托盘。
   - 采用 Edge `--app=...` 独立无边框应用模式唤出 Web 监控后台 (`http://127.0.0.1:4010/balancer/ui`)。
   - 具备单实例互斥锁 (`Global\OpenCodeRouterTrayMutex`)，重复双击直接激活已有界面。

4. **模块化分步向导 (`OpenCodeWizard.exe` / `setup-wizard.ps1`)**：
   - 允许用户**自由选择**配置到哪一步，支持单步执行或全自动执行：
     - **[1]** 协助下载并安装 OpenCode v2 核心 CLI
     - **[2]** 配置并部署 4010 订阅管理工具 (双账号轮询与托盘守护)
     - **[3]** 配置 Oh My OpenAgent (OMO v5.1.22 多智能体调度与模型映射)
     - **[4]** 配置 Goal 目标推进能力插件 (`opencode-goal-plugin` + `/goal` + `/boost`)
     - **[5]** 配置 OpenChamber 桌面工作台 (绑定工作区与 4010 本地网关)
     - **[6]** 🚀 全栈一键自动配置 (依次完成上述所有步骤)
     - **[7]** 🩺 系统全链路健康体检与异常一键修复 (Doctor & Auto-Repair)

5. **全自动健康体检与已知故障自愈 (`doctor-repair.ps1`)**：
   - 内置针对历史典型疑难杂症的诊断与一键修复引擎：
     - **`ConnectionRefused`**：自动识别 `opencode.jsonc` 中旧残留端口（如 3001），重定向至 4010 本地网关。
     - **`Proxy error reaching upstream: socket hang up`**：校验并注入必选的 `x-opencode-session` 请求头，修正连接关闭生命周期监听。
     - **`All accounts cooling down`**：提供一键重置限频冷却功能，避免瞬态网络抖动导致账号误锁。
     - **DeepSeek 区域限制 (Global Regions)**：自动在 OMO 与 OpenCode 中配置 `kimi-k3`、`qwen3.7-plus` 与 `aixforge` 等原生无限制候选路由。
     - **工作区 Git 缺失**：自动在 OpenChamber 工作目录执行 `git init`，确保差异追踪可用。
     - **端口伪占用识别**：采用严格的 TCP `-State Listen` 判定，避免将临时出站连接误认作服务端口。

---

## 二、系统架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                        前端交互层 (Interactive UIs)                     │
│  - OpenChamber Web / 桌面工作台 (http://127.0.0.1:3000)                │
│  - 独立桌面应用模式管理后台 (http://127.0.0.1:4010/balancer/ui)         │
│  - 系统托盘驻留控制 (OpenCodeRouterTray.exe)                           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                       智能调度层 (Orchestration Engine)                │
│  - Oh My OpenAgent (OMO): Sisyphus 任务规划, 子智能体并行               │
│  - Goal 目标推进体系: /goal 目标守卫, /boost 极速增强模式, ultrawork   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 统一提供商: opencode-go
┌───────────────────────────────────▼────────────────────────────────────┐
│          本地轻量化智能网关 (opencode-go-router, 端口 4010)             │
│  - 纯原生 Node.js / C# 双核驱动，零可见黑框                             │
│  - 会话亲和性 (Session Affinity) 锁定 Prompt Cache                     │
│  - 双账号轮询 (Round-Robin) 与 零丢包 429 故障转移 (Failover)          │
│  - 动态 Retry-After 冷却解析与一键即时重置                              │
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

### 方式 1：双击可执行文件运行（推荐普通用户）

1. **直接运行交互式向导**：
   双击运行 `OpenCodeWizard.exe`，按数字键选择需要配置的项目（例如输入 `6` 执行一键全套配置，或输入 `1` 单独下载安装 OpenCode v2）。
2. **启动系统托盘常驻守护**：
   双击运行 `OpenCodeRouterTray.exe`，任务栏右下角出现图标，并自动弹出桌面配置后台。

### 方式 2：使用 PowerShell 脚本（推荐开发者）

在项目目录下打开终端：

```powershell
# 1. 运行交互式配置向导 (支持 -Step 1,2,3 或 -All 自动化参数)
powershell -ExecutionPolicy Bypass -File .\setup-wizard.ps1

# 2. 运行一键健康体检与修复
powershell -ExecutionPolicy Bypass -File .\doctor-repair.ps1 -AutoFix

# 3. 启动全套服务 (静默无黑框后台常驻)
powershell -ExecutionPolicy Bypass -File .\start-all.ps1

# 4. 查看当前运行状态与账号流量统计
powershell -ExecutionPolicy Bypass -File .\status-all.ps1

# 5. 安全停止所有服务
powershell -ExecutionPolicy Bypass -File .\stop-all.ps1
```

---

## 四、双账号订阅密钥配置

配置文件模板位于 `config.json`（初次启动时会自动创建）：

```json
{
  "port": 4010,
  "host": "127.0.0.1",
  "upstream": "https://opencode.ai/zen/go/v1",
  "defaultCooldownMs": 60000,
  "maxFailoverRetries": 2,
  "sessionAffinityEnabled": true,
  "accounts": [
    {
      "id": "account-1",
      "name": "OpenCode Go (订阅账号 1)",
      "apiKey": "你的第1个OpenCode Go API Key",
      "enabled": true
    },
    {
      "id": "account-2",
      "name": "OpenCode Go (订阅账号 2)",
      "apiKey": "你的第2个OpenCode Go API Key",
      "enabled": true
    }
  ]
}
```

> **提示**：除了直接编辑配置文件外，你也可以打开桌面后台 `http://127.0.0.1:4010/balancer/ui`，在可视化界面中输入密钥并点击【保存配置】，即可实时热重载生效，无需重启服务。

---

## 五、核心功能模块与使用说明

### 1. 交互式多步骤配置向导
运行 `setup-wizard.ps1` 或 `OpenCodeWizard.exe` 后，呈现如下菜单：
- **`[1]` 协助下载并安装 OpenCode v2 (CLI)**：检查 npm/bun 环境，安装 `@opencode/cli` 与对应架构原生内核，验证版本号。
- **`[2]` 配置并部署 4010 订阅管理工具**：配置双账号密钥并完成连通性测速，静默注册托盘。
- **`[3]` 配置 Oh My OpenAgent**：在 `~/.config/opencode/opencode.jsonc` 注册插件，并在 `~/.omo/omo.jsonc` 生成主智能体（Sisyphus/Prometheus/Metis等）与备用模型的无限制路由映射。
- **`[4]` 配置 Goal 目标推进能力插件**：注册 `opencode-goal-plugin`，创建 `commands/boost.md` 指令模版。
- **`[5]` 配置 OpenChamber 桌面工作台**：绑定本地工作区目录 `D:\opencode\default`，自动执行 `git init`，桥接 4010 网关。
- **`[6]` 全栈一键自动配置**：依序执行上述所有步骤。
- **`[7]` 系统全链路健康体检与修复**：运行体检并修复问题。

### 2. 长程目标自主推进指令
在 OpenCode CLI 或 OpenChamber 会话中：
- `/goal <任务目标>`：开启长程目标守护模式，持续迭代推演直至交付。
- `/boost <任务目标>`：进入极速高强度全流程自主推进。
- 在常规 Prompt 中输入 `ultrawork` 或 `ulw`：激活 Sisyphus 多智能体网络并发攻坚。

### 3. 一键环境自检与修复 (Doctor Engine)
运行 `doctor-repair.ps1` 或在 Web 面板点击【一键体检】/【一键自动修复】：
- 自动校验 CLI 可用性。
- 自动探测并纠正 3001 端口死链。
- 自动重置限频冷却状态。
- 自动补全缺失的指令文件与工作区 Git。

---

## 六、构建与二次开发

本项目使用 Windows 原生编译器，无需安装大型构建工具链：

```powershell
# 运行单元与集成测试套件 (包含 9 项全链路自动化验证)
npm test
# 或
node test_router.js

# 编译生成原生 Windows GUI 无黑框可执行文件
npm run build:exe
```

---

## 七、开源许可

本项目基于 [MIT License](LICENSE) 许可协议开源。
