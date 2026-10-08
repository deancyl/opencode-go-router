# OpenCode Go Router & Full-Stack Toolkit
### OpenCode v2 + OpenChamber + Oh My OpenAgent + Goal 目标推进 + 双订阅高可用网关一体化套件 (Windows / Linux / NAS)

[![Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue.svg)](https://microsoft.com)
[![Linux](https://img.shields.io/badge/Platform-Linux%20%2F%20NAS%20(Debian%2CUbuntu%2CfnOS%2CDSM)-orange.svg)](https://kernel.org)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![OpenCode](https://img.shields.io/badge/OpenCode-v2.0%2B-orange.svg)](https://opencode.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version: v1.4.0](https://img.shields.io/badge/Version-v1.4.0-brightgreen.svg)](https://github.com/deancyl/opencode-go-router)

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

---

## 七、测试与质量保证

本项目配备 15 项端到端单元与集成自动化测试套件：

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

---

## 八、构建与二次开发

Windows 原生静默托盘及向导程序使用 Windows 自带的 .NET C# 编译器编译，无需额外安装 Visual Studio：

```powershell
# 编译生成原生 Windows GUI 无黑框可执行文件
npm run build:exe
```

---

## 九、版本历史与更新记录

### 🚀 v1.4.0 (当前版本)
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
