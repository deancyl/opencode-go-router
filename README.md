<p align="center">
  <img src="assets/logo.png" width="128" height="128" alt="OpenCode Router Logo" style="border-radius: 24px; box-shadow: 0 0 25px rgba(16,185,129,0.35);">
</p>

# OpenCode Go Router & Full-Stack Toolkit
### OpenCode v2 + OpenChamber + Oh My OpenAgent + Goal 目标推进 + 双订阅高可用网关一体化套件 (Windows / Linux / NAS)

[![Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue.svg)](https://microsoft.com)
[![Linux](https://img.shields.io/badge/Platform-Linux%20%2F%20NAS%20(Debian%2CUbuntu%2CfnOS%2CDSM)-orange.svg)](https://kernel.org)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![OpenCode](https://img.shields.io/badge/OpenCode-v2.0%2B-orange.svg)](https://opencode.ai)
[![Version: v2.5.5](https://img.shields.io/badge/Version-v2.5.5-brightgreen.svg)](https://github.com/deancyl/opencode-go-router)

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

9. **平台自适应感知、OpenCode 2.0+ 配置无损合流与双轨国内源容灾系统 (Platform-Aware Auto-Harmonization & Dual-Track Fallback - v2.3.0 重磅发布)**：
   - **跨平台自适应探测引擎 (`detectPlatformEnvironment`)**：智能感知 Windows 桌面端、Linux 私有 NAS 服务器（fnOS 飞牛私有云、群晖 Synology DSM、TrueNAS、Unraid 等）及容器（Docker）环境，精准探测多卷挂载路径（`/vol*`、`/volume*`、`/fs`），自动匹配对应的更新管理与自愈重载链路；
   - **OpenCode 2.0+ 废弃键清洗与无损合流 (`harmonizeOpencodeConfig`)**：根除新版 OpenCode 废弃复数 `providers` 键引发的规范性冲突，将用户自定义第三方服务商（如 `shtech`, `aixforge` 等）无损合流进单数 `provider`，全量注入官方 38 款模型清单，完好保留用户自定义微调模型与当前选定模型（如 `glm-5.3-flash`），配置清理后秒级变绿；
   - **npm / bun 双轨国内镜像源容灾 (`npmmirror`)**：针对国内网络环境下访问 npmjs.org 官方源可能发生的超时或阻断，自动切换至 `https://registry.npmmirror.com` 国内镜像源重试，保障 Linux NAS 与离线环境下更新与依赖安装 100% 成功；
   - **Linux NAS `--repair` 命令行工具**：`setup-linux.sh` 原生支持 `-r | --repair` 参数，支持离线与在线体检自愈，全卷自动搜寻 OpenChamber 离线 Office 补丁并一键修补挂载；
   - **自动化回归测试套件扩充至 57 项**：全面覆盖跨平台环境探测矩阵、配置无损合流、38 模型基准与官方动态嗅探、Doctor 诊断元数据联动、双轨镜像容灾、零干扰守护及 OMO 标签自愈测试，57 项测试 100% 全绿通过。

10. **零干扰长程任务守护与服务重载解耦 (Zero-Disturbance Daemon Protection - v2.3.3 发布)**：
   - **彻底根治 `Step interrupted` 异常**：深度诊断发现 OpenCode 核心服务 `opencode-server.service`（4096 端口）在被频繁重启时，会强行掐断底层所有执行中的 fibers 线程，抛出 `InterruptError` 导致用户长程任务（如自主编程、大文件生成）夭折；
   - **OpenCode 原生 Inotify 热感知联动**：由于 OpenCode 原生内置文件监听，对 `opencode.jsonc` 的变更（如切换模型、更新提供商）均会自动触发热加载生效；因此智能网关在桌面绑定、自愈体检和非核心组件更新时，**严格禁绝重启 `opencode-server.service`**，仅平滑同步前端 `openchamber.service` 视图；
   - **细粒度更新重载隔离**：在 `updater.js` 与 `setup-linux.sh` 中实现差异化重载，只有在 OpenCode CLI 二进制自身被升级时才进行受控重启，最大化保障用户业务连续性与长程会话不被中断。

11. **官方模型动态嗅探与热同步、插件版本标签智能对齐系统 (Dynamic Model Sync & Auto-Aligned Updates - v2.4.0 重磅发布)**：
   - **官方模型动态嗅探与增量热合并 (`fetchOfficialModels` & `/balancer/api/models/sync`)**：
     打破固定模型硬编码限制，智能网关在运行时透明代理一切模型；同时在桌面绑定、自愈体检与更新面板中，自动通过有效 Key 直连官方上游 `/models` 接口动态拉取最新模型目录。若官方上线新模型（如 `deepseek-v5`, `glm-6`），自动与本地配置增量并集合并，无损保留用户现有的首选模型与自定义微调参数；在离线或无 Key 状态下自动无缝降级为内置 38 款高保真基准字典兜底；
   - **OMO 插件版本智能规范对齐与缓存自愈**：
     彻底解决版本升级后 `opencode.jsonc` 中残留旧插件标签或无版本号导致的脱节预警。在执行升级或合流时，自动将 `plugin` 数组中的 `oh-my-openagent` 规范化对齐至最新发布版（如 `oh-my-openagent@5.1.29`），杜绝启动崩溃与多智能体参数解析异常；
   - **OpenChamber 升级联动 Office 离线预览补丁自动重挂载**：
     解决升级 OpenChamber 覆盖前端构建产物导致的 Office 离线预览失效风险，在跨平台升级完成后全自动执行 `patch-openchamber-office.sh` / `patch-openchamber-office.ps1` 重新注入离线解析沙箱，恪守 Air-Gapped 安全红线。

12. **Linux / NAS 真实工作区根回溯、CLI 架构包捆绑与两阶段动态插件安全自愈系统 (Architecture Binary Bundle & Two-Stage Plugin Healing - v2.4.9 重磅增强)**：
   - **真实宿主项目工作区根回溯 (`getEnclosingProjectRoot`)**：彻底修复在嵌套依赖内执行更新的路径穿透缺陷，当检测到目标位于 `/node_modules/` 内部时，自动截断回溯至外层真实的宿主项目根目录（如 `/vol3/1000/docker/opencode/openchamber`），保障更新上下文与配置规范 100% 正确；
   - **跨平台 CLI 架构二进制包联合捆绑安装 (`@opencode/cli-${plat}-${arch}`)**：智能探测宿主平台与架构，自动联合捆绑安装对应架构包（如 `@opencode/cli-linux-x64`），让 `postinstall.mjs` 本地直接命中二进制，彻底斩断其脱网裸拉引发的连接超时报错（`npm error code 1 Failed to install OpenCode`）；
   - **OMO 插件新版本 Bun 动态缓存两阶段补丁闭环 (Two-Stage Plugin V2 Patch Lifecycle)**：针对 OpenCode 2.0 (Bun 引擎) 重启后才异步冷拉取插件到 `~/.cache/opencode/npm/` 的生命周期，自动执行第二阶段延迟安全检测与热重载，确保刚落盘的最新版本插件即时注入 `input.directory` 兼容包装，彻底消灭 `Plugin must export a default definition...` 报错；
   - **全套自动化测试扩展至 63 项**：全链路严密覆盖跨平台架构捆绑、工作区根目录回溯、两阶段补丁生命周期及 Codex / Doctor 自愈体系，63 项测试 100% 绿灯通过。

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

本项目配备 **63 项端到端单元与全链路集成自动化测试套件**，全面覆盖 Windows 与 Linux / NAS 各种极端边界条件、安全沙箱与自愈链路：

```bash
npm test
# 或
node test_router.js
```

### 覆盖核心测试场景（全量 63 项）：
- **基础网关与负载均衡 (Test 1 - 14)**：`/health`、CORS OPTIONS、`/status` 指标、双账号轮询、`x-opencode-session` 会话亲和性锁定、429 自动静默转移与冷却重置、智能体检诊断 (`/doctor`)、全熔断保护、客户端主动断开隔离、`/repair` 自愈、多客户端配置写入绑定 (`/bind-desktop`)、安全密码门禁与 Bearer Token 鉴权；
- **原生文件安全沙箱与灾备更新 (Test 15 - 24)**：`/open-file` 危险扩展名黑名单隔离与 UNC 网络路径阻断、跨平台组件版本检测与兼容性诊断 (`/updates/check`)、全量配置安全快照与更新 (`/updates/apply`)、灾备快照秒级深度还原 (`/updates/rollback`)、NAS 多卷路径探测、前端热补丁 AST 特征提取、POSIX 权限元数据持久化与损坏快照容错；
- **高并发与协议桥接规范 (Test 25 - 35)**：LRU 会话亲和一致性、JSON 注释清洗与尾逗号规范化、Web 控制台多重鉴权、OMO 模型 Fallback 对齐、OpenChamber 桌面端智能置顶唤醒与多级浏览器容灾；
- **OpenAI Codex CLI 智能接入与协议互通 (Test 36 - 47)**：Codex 状态查询与模型元数据、一键配置写入与零损备份还原、Responses API <-> ChatCompletions / Anthropic Messages 双向 SSE 流式转换、工具调用 (`tool_calls`) 与深度思考上下文生命周期、端到端桥接代理验证；
- **平台自适应探测与 OpenCode 2.0+ 配置合流 (Test 48 - 54)**：Windows / Linux NAS (fnOS / Synology / Docker) 多卷自适应感知、单复数 provider 冲突清洗合流、38 款官方模型基准与用户配置无损保留、npm/bun 双轨国内镜像源容灾 (`npmmirror`)、非 root 作用域安装目录寻址；
- **官方模型动态增量同步与生态自愈 (Test 55 - 63)**：官方 `/models` 接口动态拉取与增量热合并 (`/models/sync`)、OMO 插件版本智能对齐、OMO v2 运行时完整性检测、双轨 Schema 镜像、OpenChamber 端口动态嗅探、配额防抖缓存池与前端轮询调度、OpenCode 2.0 原生智能体 (`agent.goal`, `agent['goal-verify']`) 自动补齐与自愈。

---

## 八、构建与二次开发

Windows 原生静默托盘及向导程序使用 Windows 自带的 .NET C# 编译器编译，无需额外安装 Visual Studio：

```powershell
# 编译生成原生 Windows GUI 无黑框可执行文件
npm run build:exe
```

---

## 九、版本历史与更新记录

### 🚀 v2.4.9
- **彻底根治 Linux / NAS 环境下 OpenCode CLI 升级路径误判与架构二进制包缺失故障**：
  - **真实宿主工作区根目录回溯与 node_modules 穿透剥离 (`getEnclosingProjectRoot`)**：重构组件路径解析逻辑，当向上寻址宿主项目时，若候选路径命中 `node_modules` 内部（如 `/vol3/.../openchamber/node_modules/@openchamber/web`），强制剥离内部层级并回溯至真实的宿主根目录（`/vol3/.../openchamber`），彻底杜绝在嵌套子依赖内执行 `npm install --prefix` 导致的依赖断层与结构破坏；
  - **跨平台 CLI 架构二进制包联合捆绑安装 (`@opencode/cli-${plat}-${arch}`)**：针对 `@opencode/cli` 包装器特性，升级引擎自动探测宿主平台与架构（如 `linux-x64`、`windows-x64` 等），自动联装对应架构包（`@opencode/cli@x.y.z @opencode/cli-linux-x64@x.y.z`），使 `postinstall.mjs` 直接在本地精准命中二进制，彻底杜绝其脱离国内镜像源二次裸联网下载引发的超时与中断（消除 `npm error code 1 Failed to install OpenCode`）；
  - **OMO 插件新版本 Bun 动态缓存两阶段补丁闭环 (Two-Stage Plugin V2 Patch Lifecycle)**：针对 OpenCode 2.0 (Bun 运行时) 在服务重启后才动态拉取新插件到 `~/.cache/opencode/npm/` 的异步时序，更新引擎在重启 2 秒后自动执行第二阶段补丁检测与热重载，确保刚拉取的新版本插件包即时注入 `input.directory` 安全包装器，彻底消灭 `Plugin must export a default definition with an id and an effect or setup function` 报错；
  - **Linux NAS 实机端到端全绿验证**：飞牛私有云 (fnOS / Debian) 实机端到端升级验证通过，`@opencode/cli` 升至 `2.0.27`，`oh-my-openagent` 升至 `5.1.32`，90 款插件 100% 正常激活并稳定运行。

### 🚀 v2.4.8
- **修复 Linux / NAS 端“提供商接口”鉴权探测与端口自适应解析 (Provider Integration Probing)**：
  - **环境感知与密码自适应发现**：在 `updater.js` 中新增 `detectOpenCodeServiceInfo()`，自动识别 Linux / NAS 宿主 systemd 守护服务（`opencode-server.service`、`openchamber.service`）与系统环境变量，动态解析 OpenCode 后端真实监听端口（4096）与 `OPENCODE_PASSWORD` 访问密码；
  - **鉴权头自动注入与双向容灾**：在自检探针 `probeOpenChamberServices()` 中自动装配 `Authorization: Basic` 认证头，彻底消除 NAS 端因带密保护导致接口返回 401 并误报为 `error` 的假死提示；
  - **友好状态呈现**：Web 控制台顶栏提供商接口状态卡片精细化呈现探测时延（如 `✔ 68ms`）与鉴权状态指示，消除歧义；
  - **Linux NAS 实机实测**：飞牛私有云 (fnOS) 实机验证通过，/api/integration 响应 68ms 绿灯，88 款核心插件健康度 100%。

### 🚀 v2.4.7
- **OpenCode 2.0 原生智能体自动补齐与自愈 (Native Agent Self-Healing)**：
  - **原生注册 Agent 补全**：在 `updater.js` 的 `harmonizeOpencodeConfig` 中自动检测并补全 OpenCode 2.0 原生 `agent.goal` (mode: `primary`) 与 `agent['goal-verify']` (mode: `subagent`) 配置；
  - **根除生态识别断层**：彻底解决 OpenChamber 桌面端与 Web 客户端顶部切换到 `goal` 时抛出 `Session.AgentNotFoundError: Agent not found: "goal"` 的报错，使 OpenChamber / OpenCode 2.0 能够原生调度目标智能体；
  - **用户自定义安全隔离**：严密保留用户在 `opencode.jsonc` 中已有的自定义 Agent Prompt、自定义模型及描述，绝不暴力覆盖已定制项目。
- **Linux / NAS Bun 运行时模块缓存热重载与守护协同**：
  - **Bun 动态模块缓存刷新**：针对 OpenCode 2.0 (Bun 引擎) 动态 import ESM 插件常驻内存的问题，在升级关键插件 (OMO, Goal) 或自愈注入智能体声明时，自动平滑重启 `opencode-server.service`（具备 15 秒超时保护），使最新插件包装补丁与智能体配置即时生效；
  - **零干扰守护机制 (Zero-Disturbance)**：常规路由体检维持无感静默，严格保护运行中的长程任务不受中断。
- **全套自动化测试扩展至 63 项**：
  - 新增 `Test 63`，全链路严密覆盖 OpenCode 2.0 原生智能体自愈注入与用户自定义保留逻辑，全套 63 项测试 100% 绿灯通过；
- **Linux NAS 实机全链路验证**：
  - 飞牛私有云 (fnOS / Debian) 实机端到端验证通过，9 大智能体就绪（Build, General, Explore, Compaction, Title, Summary, Plan, Goal, Goal-Verify），OpenChamber 交互恢复正常。

### 🚀 v2.4.6
- **官方配额 (Usage Quota) 定时自动刷新、交互倒计时与智能防抖引擎**：
  - **自定义多档刷新周期**：在 Web 管理控制台“OpenCode Go 订阅账号列表”标题栏注入现代化控制条，支持切换【关闭】、【15 秒】、【30 秒】、【60 秒 (默认推荐)】、【2 分钟】、【5 分钟】；
  - **偏好自动记忆与持久化**：刷新间隔偏好自动保存在浏览器的 `localStorage` 中，重新打开或刷新控制台自动继承配置；
  - **交互式 1 秒步长倒计时徽章（`⏱️ 58s`）**：实时平滑倒计时，支持点击倒计时徽章或【🔄 刷新全部配额】按钮立即全量强制刷新并重置定时器；
  - **单卡片时间戳与防连点状态指示**：各账号限额卡片实时呈现最新更新时间（如 `11:05:36 更新 (缓存)`），并在刷新中呈现加载中状态防止重复点击；
  - **首屏静默自动探测与切台挂起**：进入管理面板自动无感探测所有账号额度，结合 Page Visibility API 在切出后台时挂起倒计时，切回前台时若即将超时则自动补查并恢复；
  - **后端 8 秒防抖内存缓存池 (Rate-Limit Defense)**：在 `server.js` 设立 `upstream + apiKey` 内存缓存池（TTL 8000ms），绝不因自动轮询或多标签页导致上游 429 限流；支持 `force: true` 显式穿透；
  - **测试覆盖扩充**：新增 `Test 62` 自动化验证防抖缓存、强制穿透与前端定时调度，全套 62 项测试 100% 绿灯通过。
- **Linux / NAS 组件升级与版本漂移根治 (OMO 5.1.30 同步与兼容)**：
  - **彻底清除版本硬编码降级漏洞**：重构 `updater.js` 中的 `harmonizeOpencodeConfig`，彻底删除旧版硬编码默认值 `'5.1.29'`，引入“升级目标版本优先 > 磁盘真实安装包版本 > 现有配置继承”动态确定策略，彻底杜绝升级后版本被反向篡改；
  - **升级后全自动注入 OMO v2 运行时安全兼容包装**：在升级 `oh-my-openagent` 后全自动执行 `patchOmoPluginV2()`，注入 `input.directory` 安全包装器并清除 Effect-TS 死锁，彻底终结升级后插件因缺少目录包装导致崩溃或显示为“未加载状态”的难题；
  - **双向消除版本漂移 (Drift Auto-Healing)**：在 `detectLocalVersions()` 中以物理磁盘真实安装的包为基准，若检测到 `opencode.jsonc` 中的版本标签落后，自动热对齐更新配置文件，确保 Web 面板诊断与物理机状态 100% 同步。

### 🚀 v2.4.1
- **彻底根治 OpenChamber Office 离线预览“不解码 DOCX 文件”痛点**：
  - **AST 级动态精准定位二进制组件**：彻底修复旧版本挂载脚本误匹配到 `Zd=r=>{`（字体文件预览组件）而非 `Xd=r=>{`（真实二进制文件兜底分发组件）的缺陷，通过向前动态回溯 AST 函数入口精确定位目标组件；
  - **动态 JSX 运行时标识智能适配**：自动探测目标 chunk 中使用的 JSX 运行时标识（如 `n.jsx`），彻底杜绝硬编码未定义标识（`s.jsx`）引发的 ReferenceError 异常；
  - **DOM 挂载安全沙箱与 React 虚拟节点隔离**：在 `office-preview-engine.js` 中严密校验下载按钮类型（`instanceof Node`），隔离 React VNode 传入 `appendChild` 引发的类型错误，并提供原生安全高保真下载按钮；
  - **全卷与工作区外路径无阻解析**：注入 `allowOutsideWorkspace=true` 与 `fileInfo.src` 优先读取协议，确保跨工作区及 `_handoff` 目录下文件均可秒级本地高保真渲染；
  - **体检与自愈管线全链路纳管**：更新 `server.js` 体检自愈（`/balancer/api/repair`）与挂载状态检测，实现 Windows 与 Linux / NAS 全端对齐。

### 🚀 v2.3.2
- **网关自愈防护升级与 Linux NAS 更新深度容灾 (Deep Resilient Updater & Self-Healing Guard)**：
  - **Git 锁与未决 Rebase 深度自愈**：在更新执行失败或遇到中断时，自动执行 `git rebase --abort` 并彻底清理 `index.lock`、`rebase-merge`、`rebase-apply` 等残留状态，彻底规避因网络超时导致代码库锁死的问题；
  - **精准服务重载防护**：修正服务热重载机制，仅当网关套件代码实际发生物理更新（`git-pull` 或 `tarball-pull`）时才向 systemd 派发热重载指令，在容灾降级（`preserved-current-version`）时杜绝无意义的服务启停中断；
  - **独立部署国内加速双轨镜像与 Wget 兜底**：在 Linux NAS 独立模式下，当 GitHub 原生代码包拉取超时时，自动平滑切换国内加速镜像代理拉取，并在缺少 curl 时自动启用 wget 兜底；
  - **一键自愈引擎增强 (`/balancer/api/repair`)**：自动排查清理各类 Git 锁及未决 rebase 文件夹，并在 Linux NAS 平台自动补全 `~/.bashrc` 中的 `~/.local/bin` PATH 环境变量，确保非 root 权限全局工具开箱即用。

### 🚀 v2.3.1
- **Linux NAS 全链路更新容灾加固、网关套件优雅降级与一键修复自愈 (Linux NAS Resilient Updater & Disaster Recovery Graceful Degradation)**：
  - **网关核心套件更新容灾优雅降级 (`preserved-current-version`)**：重构 `updater.js` 对 `opencode-go-router` 的升级逻辑。在弱网、国内直连 GitHub 超时、连接重置或离线场景下，如果 `git pull --rebase` 或 tarball 下载失败，自动启用容灾优雅降级：记录明确告警并平滑保留当前稳定运行版本，绝不阻断整体更新流程或让 API 报错返回失败；
  - **Linux NAS 平台非 Root 权限与作用域工作区智能自愈**：全自动识别 Linux NAS（fnOS 飞牛私有云、群晖 Synology、TrueNAS 等），智能解决无 root 权限下全局 npm 写入受阻问题（自动切换作用域工作区或 `~/.local` 前缀），辅以 `npmmirror` 国内镜像源双轨兜底；
  - **服务平滑热重载与防重保护**：在 Linux NAS 上仅当代码包或镜像实际更新成功时才重载 `systemd --user` 守护服务，规避无意义的服务启停中断；
  - **一键自愈引擎扩展 (`/balancer/api/repair`)**：新增更新环境自愈检测，自动排查并清理 Git 残留 `index.lock` 锁、自动配置 Git `safe.directory`，一键自愈 Linux NAS 用户空间更新目录与依赖环境；
  - **自动化测试 54 项 100% 全绿通过**：在弱网与离线模拟下验证 Test 17 容灾降级机制，保持与 Linux NAS（192.168.1.50）代码 100% 同步并全部通过。

### 🚀 v2.3.0
- **平台自适应感知、OpenCode 2.0+ 配置合流清洗与双轨国内源容灾 (Platform Intelligence & Zero-Loss Harmonization)**：
  - **平台自适应探测引擎 (`detectPlatformEnvironment`)**：智能识别 Windows、Linux 私有 NAS（fnOS 飞牛私有云、群晖 Synology DSM、TrueNAS、Unraid 等）及容器环境，自动探测跨卷路径（`/vol*`、`/volume*`、`/fs`），自适应服务守护与重载；
  - **OpenCode 2.0+ 废弃键清洗与第三方无损合流 (`harmonizeOpencodeConfig`)**：根除复数 `providers` 废弃键，将用户自定义第三方服务商（如 `shtech`, `aixforge` 等）无损迁入单数 `provider`，全量注入 38 款官方模型清单，保留自定义微调与当前偏好模型；
  - **npm / bun 双轨国内镜像源容灾 (`npmmirror`)**：针对国内网络环境下 npmjs 官方源连接超时或失败，自动无缝降级切换至 `https://registry.npmmirror.com` 国内镜像源重试，彻底保障组件在线升级成功率；
  - **Linux NAS `--repair` 命令行工具**：`setup-linux.sh` 扩充 `-r | --repair` 参数，支持离线与在线体检自愈，自动检测并挂载全卷 OpenChamber 离线 Office 补丁；
  - **组件更新动态端口与快照自愈对齐**：更新套件在创建安全快照与合流自愈时严格对齐活跃网关端口，保障灾备快照字节级无损还原；
  - **自动化测试扩充至 51 项**：新增 Test 48-51 跨平台矩阵测试，51 项测试 100% 全绿通过。

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

### 🚀 v2.5.5 (Codex 一键脱钩重启、双轨提供商重定向与上下文自动切分守护)
- **Codex 桌面客户端一键脱钩重启 (One-Click Decoupled Restart & In-Memory Cache Refresher)**：
  - **内存缓存刷新与生命周期管理**：深入诊断 Codex 桌面客户端（ChatGPT / UWP 应用）在启动时将 `config.toml` 与 `models.json` 固化缓存至进程内存的底层机制；新增 `/balancer/api/restart-codex` 后端 API 与 Web 控制台专属【🔄 重启 Codex 客户端】按钮；
  - **智能提示闭环**：在【⚡ 一键接入 Codex】或【⏪ 一键还原原本配置】完成后，自动弹出确认弹窗引导一键重启客户端，彻底消除“接入后没生效 / 仍然使用旧配置”的困惑；
  - **Windows 脱钩进程安全拉起**：严格遵循 Windows 桌面准则，以 `explorer.exe shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App` 原生脱钩唤醒，零黑框终端、防单实例互斥锁挂起与僵死。
- **超限上下文自动切分与双轨裁剪引擎 (Context Compaction & Sliding-Window Engine)**：
  - **Codex 自动压缩阈值注入**：深入排查 `context_length_exceeded`（输入达 152.5 万 tokens 超过 1M 上下文）根因，查明模型元数据中 `auto_compact_token_limit` 为 `null` 导致 Codex 永不触发自动压缩；已在模型清单中强制注入 `auto_compact_token_limit = Math.floor(ctx * 0.85)`（1M 模型设为 891k，2M 模型设为 1.7M），恢复原生滑动切分；
  - **网关层双保险主动裁剪**：在网关层集成巨型工具输出折叠（单条超过 12,000 字符自动折叠首尾）与前序轮次滑动截断，双轨杜绝上下文溢出。
- **DeepSeek 专享模型双轨重定向互锁 (Dual-Track Provider Redirection)**：
  - 彻底根治用户 `~/.codex/config.toml` 中 `model_provider = "custom"` 直连 DeepSeek 官方 API 导致 `The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4.1-flash` 的致命报错；
  - 在配置合流与接入中将 `custom` 供应商与 `opencode-go` 供应商的 `base_url` 同步重定向至 4010 本地网关，彻底消灭模型名校验冲突。
- **全套自动化测试扩展至 66 项 100% 绿灯**。

### 🚀 v2.5.2 (全量 38 款模型实测排查、协议不兼容与地域限制智能自愈容灾)
- **OpenCode 官方全量 38 款模型端到端压测与体检排查**：
  - 针对 Codex CLI / ChatGPT 客户端直连 4010 网关的场景，对 38 款模型执行自动化批量通信与生成测试；
  - 筛查确认主流 24+ 款主力模型（`deepseek-v4.1-flash`、`deepseek-v4-pro`、`qwen3.7-plus`、`qwen3.8-flash`、`glm-5.3-flash`、`kimi-k2.7`、`minimax-m3`、`claude-haiku-5-5` 等）100% 毫秒级生成可用；
  - 准确定位上游 5 款尚未对公放开协议的模型（`gpt-5.6-luna`、`gpt-6-luna`、`grok-4.6`、`grok-4.7`、`minimax-m2.7` 会报 `ModelProtocolUnsupported`）以及 2 款受上游地域限制模型（`muse-spark-1.2`、`1.3`）。
- **模型自适应协议自愈与容灾引擎 (Model Protocol Self-Healing & Disaster Recovery)**：
  - 在 Responses 协议桥中加入主动错误拦截；当上游返回 `ModelProtocolUnsupported`（协议未支持）或 `unsupported_country_region_territory`（地域限制）时，智能网关绝不向前端客户端抛出裸错误；
  - 自动且无缝将请求平滑切至高可用旗舰模型（`deepseek-v4.1-flash`），确保会话连续、工具调用顺畅、零弹窗报错，彻底终结 `Model does not support this protocol` 困局。
- **全套 63 项自动化集成测试持续 100% 绿灯**。

### 🚀 v2.5.1 (Windows 物理交互桌面挂接、专属翡翠绿网关托盘与杀软启发式误报零容忍)
- **Windows 物理交互桌面与会话隔离深度排查 (Desktop Session & Station Defense)**：
  - **根治“后台托盘在跑却在物理桌面上看不见”的底层系统盲区**：排查并解决了在终端或 Agent 子进程中启动托盘时被 Windows 分配到非交互沙箱桌面（`Desktop: exbox-...`）的问题；通过 Windows 交互桌面桥接技术（`WinSta0\Default`），确保系统托盘图标稳定注册在用户物理屏幕右下角的任务栏通知区域；
  - **全新高辨识度专属翡翠绿网关图标 (Emerald Green Gateway Icon)**：彻底告别与官方 ChatGPT 客户端黑白花瓣 Logo 撞车的混淆痛点，改用高对比度翡翠绿圆角高光节点图标（`assets/router_green.ico` 并覆盖 `assets/router.ico`），在折叠浮层（`^`）中清晰立现；
  - **100% 微软官方签名宿主，彻底免疫卡巴斯基/杀软启发式误报 (Zero AV False Positives)**：全面移除临时编译的外部无签名二进制，改用 Windows 原生官方已签名的 `powershell.exe`（WinForms STA 宿主）与 `wscript.exe` 原生静默运行；配合 `start-tray.vbs` 纯内核级静默引导，彻底消除终端黑框闪烁，彻底杜绝 `HEUR:Trojan.Win32.Generic` 杀软误报；
  - **“桌面独立客户端 + 系统托盘常驻”两者兼得 (Dual Experience)**：
    - **桌面独立应用客户端**：桌面快捷方式以 Chrome/Edge 独立桌面应用模式（`--app=http://127.0.0.1:4010/balancer/ui`）秒级唤起无地址栏、无标签页的清爽管理面板；
    - **系统托盘小图标常驻**：常驻右下角，左键单击/双击直达控制面板，右键唤出全栈快捷菜单（启动 OpenChamber、重置 429 冷却、重启服务、体检自愈、检查更新等）；
    - **自由拖拽至外层任务栏**：在 Windows 11 下支持直接将翡翠绿小图标拖拽至任务栏外层常驻显示；
    - **开机自启**：开机启动目录（`shell:startup`）自动挂载静默启动项，开机无感守护。
- **全套 63 项自动化集成测试持续 100% 绿灯验证**。

### 🚀 v2.5.0 (Codex 会话死锁根除与 ChatGPT 历史会话连续性保护里程碑)
- **Codex CLI / ChatGPT Desktop 无限 Thinking 彻底根治 (Deadlock Defense & Keep-Alive Bridge)**：
  - **上游 `/responses` 云端死锁穿透与全量转接**：排查发现上游官方闭源 `/v1/responses` 代理在遭遇大上下文（6万+ tokens）、复杂工具调用与高思考等级时极易陷入云端挂死（长达 28 分钟无响应）；智能网关重构全量 38 款模型统一收口至高可用稳定的本地智能协议桥（通过高并发高吞吐的 `/v1/chat/completions` 分发）；
  - **10 秒双轨 SSE 心跳保活机制 (`: keep-alive\n\n`)**：在协议桥流式推送中注入主动心跳，彻底防止反向代理、客户端与网络中间件在长生成期间因静默断流；
  - **90 秒停滞看门狗 (Stall Watchdog)**：针对突发网络死锁或上游异常中断，自动优雅平滑收口完成事件，杜绝前端无限转圈卡死；
  - **`<think>` 深度思考标签智能解包**：自动兼容不同模型后端在正文与思维链混流的场景，将 `<think>...</think>` 平滑拆分为原生 `reasoning_text` 事件。
- **ChatGPT Desktop 历史会话连续性保护 (Thread Continuity & Compatibility Preservation)**：
  - **根治 `Model provider opencode-go not found` 崩溃**：ChatGPT 历史会话永久绑定创建时的提供商 ID。一键还原时默认开启 `preserveCompatibility` 机制，在无损还原用户的首选模型与主提供商的同时，智能保留 `opencode-go` 提供商声明与全量 38 款模型元数据目录，彻底杜绝历史会话因缺少提供商无法加载的致命阻断；
  - **支持双模还原**：日常还原默认启用连续性安全模式；同时保留严格字节级零残留回滚模式（`preserveCompatibility: false`）。
- **全套自动化测试扩展至 63 项 100% 绿灯**：
  - 严密覆盖协议桥单向/双向流式转换、非流式默认规范对齐、心跳保活、历史会话兼容保护与零残留回滚，63 项测试全绿通过。

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
