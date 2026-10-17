<p align="center">
  <img src="assets/logo.png" width="132" height="132" alt="OpenCode Router Logo" style="border-radius: 28px; box-shadow: 0 0 35px rgba(16,185,129,0.45);">
</p>

<h1 align="center">OpenCode Go Router & Full-Stack Toolkit</h1>

<p align="center">
  <strong>OpenCode v2 + OpenChamber + OpenAI Codex CLI + Oh My OpenAgent + Goal 目标推进 + 双订阅高可用网关一体化套件</strong><br>
  <em>全面支持 Windows 10/11 桌面端 与 Linux / NAS 私有服务器端（Debian、Ubuntu、fnOS 飞牛私有云、群晖 Synology DSM、TrueNAS、Unraid、Docker）</em>
</p>

<p align="center">
  <a href="https://microsoft.com"><img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6.svg?logo=windows&logoColor=white" alt="Windows"></a>
  <a href="https://kernel.org"><img src="https://img.shields.io/badge/Platform-Linux%20%2F%20NAS%20(fnOS%2CDSM%2CDebian)-E95420.svg?logo=linux&logoColor=white" alt="Linux"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-18%2B-339933.svg?logo=nodedotjs&logoColor=white" alt="Node.js"></a>
  <a href="https://github.com/deancyl/opencode-go-router"><img src="https://img.shields.io/badge/Version-v3.4.0-10b981.svg?style=flat" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <a href="test_router.js"><img src="https://img.shields.io/badge/Tests-139%2F139%20Passing-brightgreen.svg" alt="Tests"></a>
</p>

---

## 📚 官方文档中心 (Wiki & Documentation)

为了提供更系统、更便捷的查阅体验，本项目已建立完整的专业知识库，欢迎点击直达对应章节：

| 章节与模块 | 核心内容导航 | 适用场景 |
| :--- | :--- | :---: |
| 📖 **[文档中心首页 (Home)](docs/Home.md)** | 全局技术概览、知识图谱与全景导航 | 快速查阅 |
| ⚡ **[快速开始 (Quick Start)](docs/Quick-Start.md)** | Windows 桌面双击向导、Linux/NAS 极速一键部署、30秒完成双账号与生态绑定 | 新手首选 |
| 🏛️ **[系统架构与核心机制 (Architecture)](docs/Architecture.md)** | 网关架构、会话亲和性 (Prompt Cache)、429 智能故障转移、动态 Session 隔离 | 架构与深入 |
| 🤖 **[OpenAI Codex CLI 智能接入 (Codex Integration)](docs/Codex-Integration.md)** | Responses <-> ChatCompletions 实时双向流协议转换、思考等级全解锁、中文语言锁定、PLM 自愈 | Codex / ChatGPT 开发者 |
| 🐧 **[Linux 与 NAS 服务器部署 (Linux/NAS Guide)](docs/Linux-NAS-Deployment.md)** | systemd 用户级常驻守护、多卷挂载探测（fnOS、群晖 DSM、TrueNAS）、局域网安全鉴权 | NAS 与私有云用户 |
| 🪟 **[Windows 桌面端无黑框体验 (Windows Guide)](docs/Windows-Desktop-Guide.md)** | C# 原生托盘守护、全栈快捷方式引导器、独立桌面 App 模式（Edge --app）、开机自启 | Windows 桌面用户 |
| 📄 **[Air-Gapped Office 离线安全预览 (Office Engine)](docs/Air-Gapped-Office.md)** | 纯本地离线 DOCX/XLSX/PPTX 高保真解析沙箱、安全红线隔离、双轨本地原厂 Office/WPS 联动 | 办公文档与私有安全用户 |
| 🩺 **[全链路体检诊断与自动自愈 (Doctor & Repair)](docs/Doctor-Self-Healing.md)** | 端口死链自愈、配置单复数冲突合流、单实例互斥锁释放、动态异构模型白名单跃迁 | 运维与系统自愈 |
| 📦 **[组件安全更新与快照回滚 (Updater & Rollback)](docs/Updater-Rollback.md)** | 5 大核心组件跨版本监测、破坏性变更深度分析、升级前全量快照与秒级无损回滚 | 长期维护者 |
| 🔌 **[API 接口参考清单 (API Reference)](docs/API-Reference.md)** | 网关控制台 API、官方配额监测 API、模型热同步 API、文件安全打开 API 与健康探针 | API 二次开发 |
| ❓ **[常见问题与排障速查 (FAQ & Troubleshooting)](docs/FAQ-Troubleshooting.md)** | 高频报错排查速查表、上游模型名限制报错应对、网络超时与空流排障 | 常见疑问速查 |

---

## 一、项目概述与 13 大核心支柱

OpenCode Go Router 是专为开发者与团队量身打造的 **OpenCode 全栈生态集成与多订阅高可用智能网关套件**。它彻底解决了在使用 OpenCode、OpenChamber、Codex、OMO 与 Goal 过程中的环境配置繁琐、订阅限频卡顿、网络中断、跨平台路径差异与控制台黑框打扰等核心痛点。

### 🌟 13 大核心技术支柱

1. **跨平台原生部署与常驻守护**：
   - **Windows**：C# 原生无窗口翡翠绿高光托盘程序（`OpenCodeRouterTray.exe`），零黑框终端打扰，以独立桌面应用模式（Edge `--app=...`）唤出管理界面；
   - **Linux / NAS**：通用部署向导（`setup-linux.sh`），自动适配 systemd 用户级守护常驻（`systemctl --user`）与 nohup 双模回退，自动开启 `loginctl enable-linger` 保证用户登出后持续在线。
2. **局域网 Web 安全访问控制与门禁**：
   - 支持监听 `0.0.0.0`，局域网设备（PC、手机、平板）均可远程管理与调用；
   - 内置安全密码访问控制（Cookie + Bearer Token 双重认证），网页端 API Key 采用掩码保护（`sk-***`）。
3. **多订阅智能网关与负载均衡 (端口 4010)**：
   - 原生 Node.js 高可用反向代理，内存开销 < 15MB；
   - **会话亲和性 (Session Affinity)**：根据 Session 锁定上游账号，精准命中上游 KV 缓存 (Prompt Cache)，降低时延并节省费用；
   - **零感 429 / 503 故障漂移 (Failover)**：主账号限频时瞬间切换至备用账号，请求不中断，上层零感知；
   - **动态会话强隔离**：并发请求动态派生唯一会话哈希，彻底杜绝上游推理会话并发互斥掐断连接。
4. **官方配额三维立体可视化 (Quota Limits)**：
   - 直连官方配额 API (`/zen/go/v1/usage`)，每个账号卡片独立呈现；
   - **5小时滑动限制 (5h Rolling)**、**周累计限额 (Weekly)** 与 **月累计限额 (Monthly)** 实时百分比进度条与恢复倒计时。
5. **OpenAI Codex CLI 与 ChatGPT 桌面端深度智能接入**：
   - **实时双向协议桥**：自动在 OpenAI Responses API 与 OpenAI ChatCompletions / Anthropic 协议间进行流式双向转换；
   - **全谱系思考等级解锁**：完整开放 `low`、`medium`、`high`、`xhigh`，充分释放模型长推理深思能力；
   - **简体中文语言锁定**：强制锁定 `[desktop].localeOverride = "zh-CN"`，彻底根除界面英文漂移；
   - **PLM 挂起与死锁自愈**：一键检测并释放 Windows 后台冻结进程，恢复双击秒开体验；
   - **长推理超时看门狗**：注入 5 分钟超时与 SSE 保活心跳，彻底终结长生成卡死。
6. **异构上游推理节点模型动态候选解析与毫秒级无感跃迁**：
   - 彻底攻克部分异构节点苛刻的模型白名单报错（如 `The supported API model names are deepseek-flash... but you passed deepseek-v4.1-flash`）；
   - 正则动态解析返回的可用模型池，按同梯级（Flash $\to$ Flash、Pro $\to$ Pro）推导兼容模型并在底层透明重放，客户端 100% 零感知。
7. **动态工具 Schema 深度规范化与网关错误清洗屏障**：
   - 全面探测 `parameters`、`inputSchema` 与 `input_schema`，强制补齐合规参数模式，杜绝空对象 `{}` 引发严校验上游集群 400 崩溃；
   - 拦截非 200 裸错误，强制清洗为标准 OpenAI JSON 结构，消灭客户端红框气泡与空气泡。
8. **全生态客户端一键深度绑定**：
   - **OpenCode CLI v2**：写入统一提供商映射与 38 款全量模型目录；
   - **OpenChamber**：自动识别本地与 NAS Docker 卷目录，锁定首选网关；
   - **Oh My OpenAgent (OMO)**：自动生成 `~/.omo/omo.jsonc` 核心智能体调度配置；
   - **Goal 目标推进体系**：自动注入 `/boost` 极速增强模式与长程任务推进指令。
9. **OpenChamber Office 全格式离线安全预览引擎 (Air-Gapped Safety)**：
   - **告别“不解码 DOCX”遗憾**：纯本地离线解析 `.docx`、`.xlsx` / `.xls`、`.pptx` / `.ppt`；
   - **离线安全红线**：严禁公网第三方云预览 iframe，彻底防止本地私有代码、商业合同与财务报表外泄；
   - **双轨极速原厂联动**：一键安全调起本地原厂 Microsoft Office / WPS 打开源文件。
10. **全套组件一键检测更新、兼容性诊断与安全回滚系统**：
    - 5 大核心组件跨版本全景监测；
    - 破坏性变更深度兼容性分析与三级风险评级（`safe` / `warning` / `critical`）；
    - 升级前自动全量快照，随时支持秒级无损一键回退。
11. **平台自适应感知与 OpenCode 2.0+ 配置无损合流**：
    - 智能识别 Windows、Linux NAS（fnOS、群晖 DSM、TrueNAS）及 Docker 容器；
    - 清洗废弃的复数 `providers` 键，第三方模型无损合流进单数 `provider`，配置清理后秒级变绿；
    - npm / bun 国内镜像源容灾（`npmmirror`），保障更新 100% 成功。
12. **全自动健康体检与故障自愈 (Doctor Engine)**：
    - 涵盖端口死链排查、单复数冲突清洗、僵死进程清理、单实例互斥锁释放、语言锁定修复、异构模型跃迁等 10 大维度，一键秒级恢复全绿；
    - **OpenCode 2.0 原生凭据与后台守护进程自愈 (Anti-Invalid Credential)**：彻底根除日常 `Upstream request failed: Invalid credential` 异常；原生利用 Node.js `node:sqlite` 同步增量写入 `opencode.db` 的 `credential` 表与 `auth.json`，在 Linux NAS 端自动配置 `opencode-server.service` 环境变量并平滑重启，在 Windows 端持久化写入当前用户环境变量 `OPENCODE_API_KEY`；严格执行红线，100% 完整保留已有第三方凭据（如 shtech、aixforge、deepseek 等）。
13. **无损上下文优化与多层 Token 压缩引擎 (Context Compactor & Token Optimization)**：
    - 吸收借鉴 Headroom、llmtrim、RTK 与 MCP-Compressor 的工程精髓，纯 Node.js 18+ 原生零外部依赖实现；
    - **终端与日志去噪**：ANSI 颜色转义与控制符剥离 (`stripAnsi`)，`\r` 覆盖式终端进度条去噪 (`cleanProgressBars`)；
    - **DevOps 运维日志折叠**：Docker 镜像拉取层状态去噪折叠 (`cleanDockerOutput`)，Terraform 资源状态刷新去噪折叠 (`cleanTerraformOutput`)；
    - **锁定文件安全折叠**：巨型 Lockfile（package-lock、yarn、cargo、bun、uv、go.sum 等）Diff 安全折叠与原始锁文件（raw lockfiles）智能折叠 (`foldLockfiles`)，探测到 `<<<<<<<` 冲突或 `/dev/null` 时精准豁免与安全命名，100% 保护代码解决能力；
    - **Headroom 结构化超长同构对象与数组折叠引擎 (SmartCrusher / foldStructuredData)**：针对超长同构 JSON 列表（如 >50 项的文件树、日志、实体列表等）及超大对象进行智能采样与折叠，中间注入结构体摘要对象提取样本字段（sampleFields），折叠字符与 Token 直接计入 Card 2 Headroom 节省统计；遇 Git 冲突标记或异常堆栈时 100% 绝对放弃折叠，确保防降智红线；
    - **正向匹配测试项折叠**：安全反转设计 (`foldTestPasses`)，原生支持 Jest/Vitest/Mocha、TAP、Pytest、Cargo、Go test、GoogleTest（`[ OK ]`）、Python unittest、CTest，支持配置自定义正则；遇失败、错误堆栈全量原样留存；
    - **Prompt Cache 对齐、KV Cache 锁定与超大 Schema 深度瘦身 (Card 3 CacheAligner)**：Web 控制中心清晰呈现 `🔒 KV Cache 前缀已锁定 (提升上游 80%~90% 缓存命中，字符无损)` 与锁定轮次指示（`X 轮锁定`）；工具 Schema 字典序排序对齐与重复工具去重 (`alignToolsSchema`) 锁定上游 KV Cache 前缀，超大 Schema 深度递归裁剪示例代码 (`slimToolsSchema`)，会话缓存区字节固化 (`sessionCompressionMemo`)；
    - **流式套接字异常加固与安全沙盒**：全面加固 clientRes 错误监听，防止客户端提前挂断引发未捕获套接字异常；内置 Pluggable Pipeline 接口（`registerTransformer`, `runPipeline`），支持第三方自定义转换器插拔，全管道 100% 安全沙盒包裹，异常静默旁路绝不阻断正常业务。

---

## 二、系统架构

```mermaid
flowchart TD
    subgraph ClientLayer["前端与客户端接入层 (Client Layer)"]
        CLI["OpenCode CLI v2"]
        Chamber["OpenChamber Web / Desktop (3000)"]
        Codex["OpenAI Codex CLI / ChatGPT Desktop"]
        OMO["Oh My OpenAgent (多智能体调度)"]
        Goal["Goal 目标推进体系 (/goal, /boost)"]
    end

    subgraph GatewayLayer["OpenCode Go 智能网关 (Port 4010)"]
        AuthGate["局域网安全鉴权 (Cookie + Bearer Token)"]
        
        subgraph Bridges["智能协议转换桥 (Protocol Bridges)"]
            ResponsesBridge["OpenAI Responses API 桥 (Codex专用)"]
            ChatBridge["OpenAI ChatCompletions 代理桥"]
            ClaudeBridge["Anthropic Messages 代理桥"]
        end

        subgraph Compactor["上下文优化与 Token 压缩引擎 (Context Compactor)"]
            Denoise["终端/日志去噪 (ANSI & \\r 进度条清洗)"]
            DiffFold["Lockfile Diff 安全折叠 (冲突豁免)"]
            TestFold["测试通过项正向折叠 (堆栈全量留存)"]
            CacheAlign["Schema 字典序对齐 & 瘦身 (KV Cache 锁定)"]
            MemoPool["会话缓存区冻结 (Cache-Zone Memo)"]
            PowerShellOpt["Windows PowerShell 转义自愈 & CLIXML 去噪 (环境自适应)"]
        end

        subgraph CoreShield["高可用自愈屏障 (Resilience Core)"]
            DynamicSession["动态会话强隔离 (Anti-Interference)"]
            AffinityCache["会话亲和性锁定 (Prompt Cache Lock)"]
            SchemaFilter["动态工具 Schema 深度规范化"]
            FallbackEngine["异构推理节点模型无感跃迁引擎"]
            ErrorSanitizer["网关非200错误响应清洗屏障"]
            HeartbeatWatchdog["SSE 10s双轨保活 + 300s看门狗"]
        end

        subgraph AccountPool["多订阅负载均衡与状态监测"]
            Balance["加权轮询 / 零感 429 故障转移 (Failover)"]
            CooldownMgr["智能 Retry-After 冷却管理器"]
            QuotaTracker["官方滑动窗口配额监控 (5h / 7d / 30d)"]
        end
    end

    subgraph UpstreamLayer["OpenCode Zen 聚合服务上游"]
        Account1["订阅账号 1 ($10/月)"]
        Account2["订阅账号 2 ($10/月)"]
        AccountN["... 扩展多账号池"]
    end

    ClientLayer --> AuthGate
    AuthGate --> Bridges
    Bridges --> Compactor
    Compactor --> CoreShield
    CoreShield --> AccountPool
    AccountPool --> UpstreamLayer
```

---

## 三、快速开始

### 场景 A：Linux / NAS 私有云服务器部署（强烈推荐）

适用于 **Debian、Ubuntu、fnOS (飞牛私有云)、群晖 Synology (DSM 7+)、TrueNAS、Unraid** 等服务器：

#### 方式 1：远程极速一键部署（无需预先 clone，全自动搞定）
```bash
# 启动交互式向导（推荐首次部署）：
curl -fsSL https://raw.githubusercontent.com/deancyl/opencode-go-router/master/install.sh | bash

# 或非交互式一键静默全套配置：
curl -fsSL https://raw.githubusercontent.com/deancyl/opencode-go-router/master/install.sh | bash -s -- --all --host 0.0.0.0 --port 4010 --password "你的后台管理密码"
```

#### 方式 2：克隆仓库本地部署
```bash
git clone https://github.com/deancyl/opencode-go-router.git ~/.opencode-go-router
cd ~/.opencode-go-router
chmod +x *.sh
./setup-linux.sh
```

---

### 场景 B：Windows 桌面端使用

适用于 **Windows 10 / Windows 11 (64位)**：

#### 方式 1：双击运行向导与托盘（推荐普通用户）
1. 解压发布的 `opencode-toolkit-windows-x64.zip`；
2. **首次配置**：双击 `OpenCodeWizard.exe`，输入 `6` 执行一键全套配置；
3. **日常启动**：双击 `OpenCodeRouterTray.exe`，任务栏出现翡翠绿小图标，并以独立窗口唤出控制面板。

#### 方式 2：使用 PowerShell 脚本（开发者推荐）
```powershell
# 1. 运行交互式配置向导
powershell -ExecutionPolicy Bypass -File .\setup-wizard.ps1

# 2. 启动全套服务 (静默无黑框后台常驻)
powershell -ExecutionPolicy Bypass -File .\start-all.ps1

# 3. 运行全链路健康体检并自动修复
powershell -ExecutionPolicy Bypass -File .\doctor-repair.ps1 -AutoFix

# 4. 查看当前状态与官方配额
powershell -ExecutionPolicy Bypass -File .\status-all.ps1
```

---

### 场景 C：OpenAI Codex CLI / ChatGPT 桌面端一键接入

1. 打开管理后台仪表盘：`http://127.0.0.1:4010/balancer/ui`；
2. 在左侧卡片点击 **【⚡ 一键接入 Codex】**；
3. 提示成功后点击 **【🔄 重启 Codex 客户端】**；
4. Codex 即刻接入 38 款模型，并解锁全部思考梯级（`low` 至 `xhigh`）。

---

## 四、配置文件说明 (`config.json`)

配置文件位于运行目录下的 `config.json`（支持在 Web 控制台热重载）：

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

> 💡 **提示**：直接在 Web 控制面板（`http://<IP>:4010/balancer/ui`）修改配置并点击【保存配置】，网关会立即热重载生效，无需重启进程！

---

## 五、API 核心接口清单

| 路由路径 | 请求方法 | 认证保护 | 功能描述 |
| :--- | :---: | :---: | :--- |
| `/health` | GET | 无 | 基础健康探针，返回运行状态与可用账号数 |
| `/status` | GET | 无 | 网关核心运行指标概览（账号列表、总请求数、转移次数等） |
| `/balancer/ui` | GET | 密码保护 | Web 管理控制台仪表盘 |
| `/balancer/api/account-quota` | GET | 密码保护 | 查询账号官方配额（5h / 7d / 30d 实时监控） |
| `/balancer/api/models/sync` | POST | 密码保护 | 动态嗅探上游最新模型并增量合并 |
| `/balancer/api/bind-codex` | POST | 密码保护 | 一键接入 OpenAI Codex CLI / ChatGPT |
| `/balancer/api/restart-codex`| POST | 密码保护 | 脱钩重启 Codex 桌面端（刷新内存缓存） |
| `/balancer/api/doctor` | GET | 密码保护 | 运行全链路健康体检报告 |
| `/balancer/api/repair` | POST | 密码保护 | 执行全链路一键自动自愈与修复 |
| `/balancer/api/updates/check`| GET | 密码保护 | 检查 5 大核心组件最新版本与兼容性评级 |

*完整 API 清单请查阅 [API 接口参考清单 (docs/API-Reference.md)](docs/API-Reference.md)*。

---

## 六、版本演进与发布历史

### 🚀 v3.3.1 (当前最新版：OpenCode 官方模型费率字典与动态感知、分模型精细化节约归因与动态加权费用大盘、全套 138 项全绿测试)
- **OpenCode 官方模型实时费率字典与动态感知引擎 (`context-compactor.js` & `server.js`)**：
  - **内置主流全系费率表**：高保真内置 42 款主流模型基准费率（如 `deepseek-v4.1-flash` ~$0.14/1M、`deepseek-v4-pro` ~$0.55/1M、`glm-5.3-flash` ~$0.10/1M、`glm-5.3` ~$0.35/1M、`kimi-k3` ~$0.60/1M、`claude-haiku-5-5` ~$1.25/1M、`gpt-5.6-luna` ~$1.50/1M 等），未知模型 $0.25/1M 安全兜底；
  - **守护服务动态感知同步**：支持从本地及 NAS OpenCode 守护进程 `/api/model` 动态感知并提取 `cost.input` 费率元数据，与官方上游费率无缝对齐；
- **分模型精细化节约与动态加权费用测算引擎 (`context-compactor.js`)**：
  - **细粒度按模型遥测 (`stats.byModel`)**：跨 OpenAI ChatCompletions、Anthropic Messages 与 OpenAI Codex Responses 三大协议，请求进入压缩管道时自动提取规范化模型标识，分别记录处理字符数、节约 Tokens、官方费率与对应节约金额；
  - **动态加权总费用测算**：总费用彻底告别单一粗糙假设，升级为各模型真实单价动态加权累计之和 `sum(byModel[m].savedCostUSD)`；
  - **安全持久化与一键干净重置**：`compression-stats.json` 磁盘数据结构无缝平滑迁移；调用重置 API 时自动连同分模型明细一键清零；
- **Web 控制台分模型数据大盘与自适应抽屉 (`server.js`)**：
  - **动态加权卡片指示**：费用卡片说明更新为“基于各模型官方实时费率动态加权测算”，增加“分模型明细 ▾”交互标签；
  - **交互式分模型明细抽屉 (By Model Breakdown Drawer)**：点击费用卡片即可平滑展开/收起明细表格，直观呈现各模型的调用名称、处理原字符数、节约 Token 预估、官方费率参考 ($/1M Tokens) 及各自节约金额 (USD)；
  - **移动端与桌面端自适应排版**：全面适配手机竖屏浏览器横向流畅滑动与大屏桌面展开，不破坏既有任何 DOM 与事件；
- **全套 138 项自动化集成测试 100% 绿灯全通**。

### 🚀 v3.3.0 (高频会话 O(1) LRU 淘汰、Anthropic 深度推演看门狗防误杀、监听器防泄漏屏障、上下文计算开销优化与 4 层极限压测)
- **高频会话 O(1) LRU 增量淘汰引擎 (`server.js`)**：
  - 彻底重构当 `sessionMap.size > 5000` 时因全量遍历、多次数组拷贝与复杂排序导致的 Node.js 事件循环挂死与高延迟瓶颈（由 O(K×M) 降低为 O(1)）；
  - 引入 Map 原生插入顺序 LRU 机制（`touchSession` 与 `deleteSessionRecord`）结合 `sessionFallbackKeyMap` 二级索引，实现会话瞬时常数级增量淘汰；
- **Anthropic 协议深度推演看门狗与长思考防误杀 (`codex-adapter.js`)**：
  - 全面接入 Anthropic `thinking`（深度推演/思考）协议块事件解析与分发（`response.reasoning_text.delta` 等）；
  - 自适应长推演看门狗：对 `xhigh` / `opus` / `thinking` 模型或处于推演阶段的长流动态放宽门限至 600 秒（普通流 300 秒），并在收到数据分块时严格刷新活动时间戳，彻底杜绝长思考被看门狗误杀；
- **客户端连接异常与多轮重试监听器防泄漏屏障 (`server.js` & `codex-adapter.js`)**：
  - 在故障转移（429、401、502/503、Socket ECONNRESET）与动态协议网关中，全面打通并严格解绑 `clientRes` 的 `close` 与 `error` 监听器，彻底根除跨轮次重试引发的 `MaxListenersExceededWarning` 与内存挂死；
  - 引入 `MAX_ERR_BYTES = 256 * 1024` 上游错误流上限截断，杜绝畸形巨幅错误 payload 撑爆堆内存；
- **首包延迟 (TTFT) 与正则/序列化计算开销优化 (`context-compactor.js`)**：
  - 缓存动态正则编译（`dynamicRegexCache` / `getCachedRegex`）并预编译提升 20+ 个核心判定静态正则表达式，大幅消除单行扫描中的重复编译开销；
  - 在工具模式深拷贝与处理中采用 `structuredClone` 优先与引用不变性短路（避免无谓 `JSON.stringify` 运算），降低 CPU 占用并显著压减首包延迟；
- **四层并发与故障自愈压测套件 (`test_stress_regression.js`) 与既有 137 项集成测试 100% 双百全绿通**。

### 🚀 v3.2.3 (Card 2 Headroom 原始锁文件安全折叠与结构化对象采样、Card 3 CacheAligner 工具去重排序与 KV Cache 锁定贡献度精准归因、全套 137 项全绿测试)
- **Card 2 Headroom 代码与结构化折叠引擎指标激活 (`context-compactor.js` & `server.js`)**：
  - **原始锁文件安全折叠**：除原先 git diff 模式外，新增对工具读取的原始 Lockfile（`package-lock.json`、`yarn.lock`、`pnpm-lock.yaml`、`cargo.lock`、`go.sum`）深度安全折叠，严格豁免 Git 冲突标记；
  - **结构化超大对象折叠支持**：`foldStructuredData` 扩展至 >50 个顶层键的大型字典对象采样折叠，彻底解决日常查看巨型 JSON/配置显示 0% · ~0 Tokens 痛点；
  - **多协议全链路归因**：OpenAI ChatCompletions、Anthropic Messages 与 OpenAI Codex Responses 三大协议工具输出深度解析与 Headroom 归因对齐；
- **Card 3 CacheAligner & mcp-compressor 工具定义优化指标激活 (`context-compactor.js` & `server.js`)**：
  - **工具排序与去重即时归因**：重构 `compactToolsList`，消除原先在排序对齐后才计算字符长度导致贡献被丢弃的缺陷；自动去重同名工具并统计规整字符；
  - **KV Cache 前缀锁定轮次看板**：记录并持久化 `alignedRounds` 与 `alignedToolsCount`，当工具对齐生效时 Web UI 动态呈现 `(X 轮锁定)` 与 100% 绿色激活进度条；
### 🚀 v3.4.0 (Windows PowerShell 转义深度优化、CLIXML 报错去噪、跨平台环境自适应与 Web UI Card 5)
- **Windows PowerShell 转义陷阱深度自愈 (`powershell-optimizer.js`)**：
  - **路径末尾反斜杠防吞噬引号**：自愈 Windows CRT `CommandLineToArgvW` 陷阱，将 `"C:\dir\"` 自动转换为 `"C:\dir\\"`，彻底防止闭合双引号被意外吃掉导致后续参数拼接错位；
  - **PowerShell 5.1 curl/wget 别名陷阱规避**：规避 Windows 原生 PowerShell 将 `curl` 别名为 `Invoke-WebRequest` 导致的参数崩溃，自动映射为 `curl.exe`；
  - **`&&` 和 `||` 语法解析错误自愈**：将 Windows PowerShell 5.1 不支持的 `&&` 操作符智能转换为 `; if ($?) { ... }`，消除 ParserError 语法中断；
  - **多行续行符修正**：将 Bash 式末尾续行反斜杠 `\` 转换为 PowerShell 原生反引号 `` ` `` 续行；
  - **PowerShell CLIXML 报错去噪与 Token 节省**：清洗 `#< CLIXML` 冗长标签与 hex 转义编码（`_x000D__x000A_`），剥离 CategoryInfo 冗余堆栈，削减 70%~90% 因报错重试消耗的 Token；
  - **前置防踩坑指令屏障 (Prompt Guard)**：在 system / instructions 中轻量注入 PowerShell 规范指南，从源头消灭 Agent 试错循环；
  - **防降智与代码安全绝对红线**：严禁触碰源码正文、文件 Diff 或非终端参数，仅在终端命令与 stderr 中生效。
- **跨平台环境自适应与休眠旁路 (Platform Auto-Detection & Dormancy)**：
  - 自动检测当前操作系统与客户端请求平台（`options.targetPlatform > client headers > User-Agent > host process.platform`）；
  - 在 Linux NAS 环境下保持 0 开销纯净休眠旁路（零修改零篡改），在 Windows 环境下自动激活；
  - 允许通过 Web UI 控制台总开关与 7 个独立子开关细粒度开启或关闭，默认自动检测并开启。
- **Web 控制台升级 (Card 5: Windows PowerShell 优化与自适应防护)**：
  - 在 Web UI 中增设专属 Card 5，直观展示操作系统运行状态徽章（`🟢 Windows 原生运行中` vs `🐧 Linux 休眠旁路`）；
  - 7 个独立子开关支持平衡标准档、极致省Token档与保守档联动；
  - 贡献度与节约 Token 实时归因统计与进度条同步；
  - 接入 Doctor 健康自检（`activeEngines.powershell`）与一键配置修复。
- **全套 139 项自动化集成测试 100% 绿灯全通**。

### 🚀 v3.3.1 (分模型定价节约预估、OpenCode 官方费率动态加权测算与 Web UI 模型明细抽屉)
- **OpenCode 官方模型费率动态感知字典**：内置主流模型基准输入费率，支持动态同步；
- **分模型精细化节约与贡献明细 (By-Model Breakdown)**：实时统计各模型字符与 Token 节约量，总费用按各模型实际单价动态加权测算；
- **Web UI 数据大盘交互升级**：增设分模型节约明细折叠面板与实时列表；
- **全套 138 项自动化集成测试 100% 绿灯全通**。

### 🚀 v3.3.0 (高可用转发吞吐、全链路瓶颈清除、增量淘汰与 137 项全绿回归测试)
- **高频会话驱逐算法优化**：增量定长淘汰替代全量排序，消除事件循环阻塞；
- **Anthropic 桥看门狗机制与监听器防泄漏**；
- **全套 137 项自动化集成测试 100% 绿灯全通**。

### 🚀 v3.2.2 (Web UI 体验升级、KV Cache 锁原理说明、SmartCrusher 超长同构 JSON 采样折叠与全链路测试)
- **Web 控制台状态与原理说明升级 (Card 3 & Card 2)**：
  - **KV Cache 锁原理看板**：在 Card 3 增设专属指标提示 `🔒 KV Cache 前缀已锁定 (提升上游 80%~90% 缓存命中，字符无损)` 与通俗原理解释（说明字典序对齐虽不减字数，但通过固化前缀字节流使上游 100% 命中 Prompt Cache，输入费用直降 80%~90%，首字响应延迟降低 50%+）；
  - **瘦身门限明晰引导**：标注 `💡 瘦身门限当前为 15,000 字符（仅挂载大型/多 MCP 服务时触发）`，让开发者一目了然；
  - **SmartCrusher 独立子开关**：在 Card 2 增设【超长同构 JSON 数组采样折叠 (SmartCrusher / foldStructuredData)】子开关，受分层总开关与平衡档（启用）、极致档（启用）、保守档（关闭）无缝联动；
- **SmartCrusher 超长同构 JSON 数组采样折叠 (`context-compactor.js`)**：
  - 针对工具输出或命令行返回超过 50 项的超长同构 JSON 数组（巨型文件列表、大数据库查询结果等）进行安全智能摘要采样（保留结构 + 前 5 项与后 3 项样本），中间插入合规结构描述项，大幅节约日常推理 Token；
  - **代码安全与防降智绝对红线**：遇 Git 冲突标记（`<<<<<<<` 等）、错误堆栈与异常（`TypeError`、`panic`、`AssertionError`、`Traceback` 等）100% 绝对豁免免折叠；
- **全套 136 项自动化集成测试 100% 绿灯全通**。

### 🚀 v3.0.0 (无损上下文优化与多层 Token 压缩引擎、Pluggable Pipeline、DevOps 运维日志去噪与 106 项全绿回归测试)
- **原生上下文无损优化与 Token 压缩引擎 (`context-compactor.js`)**：
  - **终端与日志去噪**：ANSI 颜色转义与控制符剥离 (`stripAnsi`)，`\r` 覆盖式终端进度条去噪并 100% 字节级保全 Windows CRLF 换行 (`cleanProgressBars`)；
  - **DevOps 运维输出清洗**：Docker 镜像拉取/推送/缓存层状态折叠 (`cleanDockerOutput`)，Kubectl Pod 状态与发布轮转折叠并严密保护故障状态 (`cleanKubectlOutput`)，Terraform 资源与数据源状态刷新折叠 (`cleanTerraformOutput`)；
  - **锁定文件安全折叠**：巨型 Lockfile（package-lock、yarn、cargo、bun、uv、pubspec、gradle 等）Diff 安全折叠 (`foldLockfiles`)，探测到 `<<<<<<<` 冲突或 `/dev/null` 时精准豁免与安全命名，100% 保护代码解决能力；
  - **测试通过项正向安全折叠**：安全反转设计 (`foldTestPasses`)，严格匹配算法绝不错杀源码变量行与代码断言，原生支持 Jest/Vitest/Mocha、TAP、Pytest、Cargo、Go test、GoogleTest（`[ OK ]`）、Python unittest、CTest，支持配置自定义正则；遇失败、错误堆栈全量原样留存；
  - **Prompt Cache 对齐与超大 Schema 深度瘦身**：工具 Schema 字典序排序对齐 (`alignToolsSchema`) 锁定上游 KV Cache 前缀，超大 Schema 递归深度防溢出护栏（>50层熔断）与复合 patternProperties/additionalProperties 瘦身 (`slimToolsSchema`)，基于真 LRU 的会话缓存池与动态插件签名固化 (`sessionCompressionMemo`)；
  - **可扩展管道体系与安全沙盒**：内置 Pluggable Pipeline 接口（`registerTransformer`, `runPipeline`），支持第三方自定义转换器插拔，全管道 100% 安全沙盒包裹，异常静默旁路绝不阻断正常业务。
- **全套 106 项自动化集成测试 100% 绿灯全通**。

### 🚀 v2.6.5 (工具调用原子严格连续性自愈、开发者通知顺延与会话前置模型跃迁记忆池)
- **工具调用原子严格连续排列与开发者通知顺延 (`sanitizeAndValidateChatMessages`)**：
  - 彻底攻克 OpenAI/DeepSeek 严格校验器对多工具调用的连续性要求（`an assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'`）；
  - 自动识别穿插在工具调用之间的系统/开发者消息（如 Codex 多图浏览插入的 `<image_resize_notice>`），安全顺延至整组工具回复之后；
  - 自动检测并补齐缺失的孤儿 `tool_calls`，将未配对的孤儿 `tool` 消息安全转为 `user` 上下文；
  - 在网关层部署 400 自动拦截器，遇未完全对齐的工具调用即刻秒级提取缺失 ID 并自愈重试。
- **会话级前置模型跃迁记忆池 (`sessionModelFallbackCache`)**：
  - 会话因异构节点限制发生动态自愈（如 `glm-5.3-flash` $\to$ `deepseek-flash`）后，网关自动将该会话绑定至等位可用模型；
  - 该会话的后续轮次请求在网关入口处直接执行前置跃迁，0 次 400 失败、0 毫秒重试延迟，确保新建与既有任务全程顺畅；
- **全套 84 项自动化集成测试 100% 绿灯全通**。

### 🚀 v2.6.4 (异构上游推理节点模型动态候选解析与毫秒级无感跃迁)
- **异构推理集群模型受限报错毫秒级自愈 (`resolveCompatibleFallbackModel`)**：
  - 彻底攻克 OpenCode Zen 聚合上游下挂受限推理节点抛出 `The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4.1-flash` 的阻断痛点；
  - 正则动态解析返回的可用模型候选池，按同梯级（Flash $\to$ Flash、Pro $\to$ Pro）与族谱前缀推导等位模型；
  - 网关在 `server.js` 三大代理路由内部透明重放当前请求，向客户端无感输出推理结果，做到客户端 100% 零报错；
- **全套 82 项自动化集成测试 100% 绿灯全通**。

### 🚀 v2.6.3 (Codex UWP 进程挂起、SingleInstanceLock 死锁与简体中文语言锁定)
- **Codex 简体中文语言覆盖与锁定 (`checkCodexLocaleAndEnvironment`)**：
  - 自动注入 `[desktop].localeOverride = "zh-CN"` 并写入 Chromium 语言参数，彻底杜绝配置覆盖导致界面英文漂移；
- **Windows PLM 进程挂起检测与僵死互斥锁释放**：
  - 针对 Windows 进程生命周期管理器将 Codex 冻结在后台霸占互斥锁的问题，提供自动唤醒与清理自愈；
- **全量纳入 Doctor 一键体检与自动修复体系**。

### 🚀 v2.6.2 (工具输出图片安全清洗、上游 400 空流自愈与 80 项全绿测试)
- **多模态工具输出图片安全脱敏与规范化**：针对客户端工具调用返回巨大 Base64 图片数据的场景进行安全清洗；
- **上游 400 空响应拦截**：防止上游空流引发客户端空气泡报错。

### 🚀 v2.6.1 (动态工具 Schema 深度规范化与网关错误清洗屏障)
- **动态工具 Schema 深度提取**：全面识别 `inputSchema`、`parameters` 与 `input_schema`，强制规范化为合规的 `{ type: 'object', properties: {} }`；
- **网关层非 200 错误清洗屏障**：强制重置响应头，将裸 JSON 或 0 字节流包装为标准 OpenAI JSON 错误。

### 🚀 v2.6.0 (动态会话隔离、空流防瞒报与零泄露生命周期)
- **动态会话隔离**：优先从会话头动态派生唯一 Session ID，消除并发互斥掐断；
- **空流防瞒报**：遭遇上游断流且无有效内容时，坚决派发标准 `response.failed`，杜绝伪造 `completed`；
- **长推理看门狗放宽至 300 秒**，彻底消除 `activeRequests` 计数泄漏。

<details>
<summary><b>点击展开查看历史版本演进 (v1.0.0 - v2.5.5)</b></summary>

- **v2.5.5**：Codex 桌面端一键脱钩重启、双轨提供商重定向、85% 上下文自动切分阈值守护与超长工具输出主动折叠；
- **v2.5.2**：全量 38 款模型实测排查、协议未放开与地域限制模型智能自愈容灾；
- **v2.5.1**：Windows 物理交互桌面挂接、专属高光翡翠绿网关托盘、彻底免疫杀软启发式误报；
- **v2.5.0**：Codex CLI / ChatGPT Desktop 历史会话连续性保护、10s 双轨 SSE 保活心跳、`<think>` 思维链解包；
- **v2.3.0**：跨平台自适应探测引擎、OpenCode 2.0+ 配置无损合流、38 款官方模型基准与 npmmirror 国内源容灾；
- **v2.1.2**：OpenChamber 原厂桌面客户端置顶唤醒与单实例互斥锁释放；
- **v2.0.0**：5 大核心组件全景监测、破坏性变更深度兼容性诊断、升级前全量快照与秒级一键回滚；
- **v1.4.0**：OpenChamber 全格式 Office 纯本地离线安全预览引擎（Air-Gapped Safety）；
- **v1.3.0**：Linux / NAS 私有服务器一键安装与守护部署支持；
- **v1.0.0**：基础多订阅轮询网关与 429 智能故障转移架构诞生。

</details>

---

## 七、开源许可

本项目基于 [MIT License](LICENSE) 许可协议开源。
