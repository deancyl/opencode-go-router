<p align="center">
  <img src="assets/logo.png" width="120" height="120" alt="OpenCode Router Logo" style="border-radius: 24px; box-shadow: 0 0 35px rgba(16,185,129,0.4);">
</p>

<h1 align="center">OpenCode Go Router & Full-Stack Toolkit</h1>

<p align="center">
  <strong>专为 AI 编程打造的高可用聚合网关与上下文无损压缩中枢</strong><br>
  <em>全面支持 Windows 10/11 桌面端 与 Linux / NAS 私有服务器端（Debian、Ubuntu、fnOS 飞牛私有云、群晖 Synology DSM、TrueNAS、Docker）</em>
</p>

<p align="center">
  <a href="https://microsoft.com"><img src="https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6.svg?logo=windows&logoColor=white" alt="Windows"></a>
  <a href="https://kernel.org"><img src="https://img.shields.io/badge/Platform-Linux%20%2F%20NAS-E95420.svg?logo=linux&logoColor=white" alt="Linux"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-18%2B-339933.svg?logo=nodedotjs&logoColor=white" alt="Node.js"></a>
  <a href="https://github.com/deancyl/opencode-go-router/releases/tag/v3.11.0"><img src="https://img.shields.io/badge/Version-v3.11.0-10b981.svg?style=flat" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <a href="test_router.js"><img src="https://img.shields.io/badge/Tests-166%2F166%20Passing-brightgreen.svg" alt="Tests"></a>
</p>

---

## 💡 它是什么？干了什么？

**OpenCode Go Router** 是专为 **OpenCode、OpenAI Codex、OpenChamber** 等 AI 编程智能体生态量身打造的本地智能代理网关。它作为客户端与大模型上游之间的中间层，核心完成了 4 件事情：

1. **多订阅账号智能负载均衡与无感容灾 (Failover)**：
   聚合多个 API 账号（如官方订阅、多组织 Key），支持轮询分发。主账号遭遇 **HTTP 429 限频** 或网络中断时，网关在 **毫秒级内自动无缝漂移** 至备用账号重试，长对话与批量代码生成绝对不报错、不断流。
2. **确定性、零幻觉无损 Token 上下文压缩 (Context Compactor)**：
   自动剥离终端 ANSI 杂音、清洗长日志构建刷屏（`npm/cargo/pip`）、折叠超大同构 JSON 数据。源码文件、Diff 变更行与报错堆栈 **100% 豁免绝对不降智**；多轮历史字节锁定捍卫上游 **KV Cache 命中率**。
3. **全协议多模态无缝桥接 (Unified Protocol Bridge)**：
   原生双向转换 OpenAI Responses ↔ ChatCompletions / Anthropic 协议；解锁全量深度思考等级；内置 **ComfyUI 15步极速微雕直出生图引擎** 与 **Air-Gapped 本地离线 Office 高保真安全预览沙箱**。
4. **Windows / Linux 跨平台原生常驻与全链路自愈 (Self-Healing)**：
   Windows 下提供 **C# Win32 原生托盘守护（零控制台黑框打扰）** 与独立桌面 App 模式；Linux/NAS 下自动装配 systemd 用户级守护；具备端口占用无损自愈、单实例死锁释放与异构上游模型动态等位跃迁能力。

---

## 🎯 对使用者有什么实际影响与价值？

| 核心维度 | 使用前的痛点 | 使用 OpenCode Go Router 后的直观改变 |
| :--- | :--- | :--- |
| 💰 **使用成本** | 长任务与工具多轮调用导致 Token 账单暴涨，单次对话常突破数十万 Token。 | **Token 费用直降 60% ~ 85%**：终端刷屏日志与同构数据自动折叠，结合 KV Cache 命中优惠，大幅降低账单开销。 |
| 🛡️ **稳定性** | 单账号频繁触发 429 Rate Limit，多步复杂任务（如大型重构）经常半途崩溃中断。 | **0 崩溃、长任务永不中断**：多账号智能池化，自动无感漂移；上游故障或空流毫秒级自愈。 |
| 💻 **桌面体验** | 后台常驻各种 node/cmd 黑色控制台弹框，误关即断流；托盘图标经常丢失或多开死锁。 | **纯净桌面、零黑框打扰**：Win32 顶级消息下沉，开机自启纯静默常驻，独立应用级无地址栏清爽交互。 |
| ⚡ **上手难度** | OpenCode、OpenChamber、Codex 配置文件分散，格式繁琐，中文语言需手动 hack。 | **30 秒开箱即用**：全自动向导一键深度绑定全套生态，模型全量映射对齐，Codex 界面完整中文汉化。 |

---

## ⚡ 快速上手 (Quick Start)

### 场景 A：Windows 桌面端使用（最简推荐）

1. 从 [GitHub Releases](https://github.com/deancyl/opencode-go-router/releases/latest) 下载 `opencode-toolkit-windows-x64.zip` 并解压；
2. **首次配置**：运行 `setup-wizard.ps1` 或双击 `OpenCodeWizard.exe` 配置账号 Key 与端口；
3. **日常启动**：双击 `launch-gui.vbs` 即可拉起翡翠绿托盘守护并唤出独立 Web 控制台；
4. **一键自愈**：如遇环境异常，右键托盘图标选择「🩺 一键系统体检与自动修复」。

### 场景 B：Linux / NAS 私有云服务器部署 (fnOS / 群晖 DSM / TrueNAS / Debian)

在终端执行一键全自动部署脚本：
```bash
# 交互式向导部署：
curl -fsSL https://raw.githubusercontent.com/deancyl/opencode-go-router/master/install.sh | bash
```
> 向导将自动配置 Node.js 运行时、部署 4010 核心网关、配置 systemd 用户守护（`systemctl --user`）并启用持久化常驻（`loginctl enable-linger`）。

### 场景 C：OpenAI Codex CLI / ChatGPT 客户端接入

在 Web 管理控制台点击「🤖 接入 Codex」按钮，或手动在 `~/.codex/config.toml` 中配置：
```toml
model_provider = "opencode-router"

[model_providers.opencode-router]
base_url = "http://127.0.0.1:4010/v1"
wire_specification = "chat"
requires_openai_auth = true
```

---

## 🏛️ 系统架构简图

```
┌────────────────────────────────────────────────────────┐
│     客户端生态 (OpenCode / Codex / OpenChamber / Web)     │
└───────────────────────────┬────────────────────────────┘
                            │ (4010 统一接入端口)
┌───────────────────────────▼────────────────────────────┐
│              OpenCode Go Router 智能网关核心             │
├────────────────────────────────────────────────────────┤
│  • 鉴权守卫与 LAN 门禁   • 协议状态机 (SSE/Responses/Chat)  │
│  • 4MB/32MB 请求体守卫   • 动态会话强隔离 (Prompt Cache)   │
├────────────────────────────────────────────────────────┤
│          🗜️ 确定性上下文压缩中枢 (Compression Engine)          │
│   [RTK 终端去噪] → [Headroom 数据折叠] → [KV Cache 字节锁]   │
│   (代码文件、Diff 变更、报错堆栈 100% 豁免绝对不降智)           │
├────────────────────────────────────────────────────────┤
│          🔄 智能负载均衡与容灾池 (Failover Pool)            │
│   [主账号 429 限频探测] ──(毫秒级静默切换)──> [备用账号重试]   │
└─────────────┬───────────────────────────┬──────────────┘
              │                           │
┌─────────────▼─────────────┐   ┌─────────▼──────────────┐
│  OpenCode / 官方模型上游  │   │  ComfyUI 端侧微雕生图   │
└───────────────────────────┘   └────────────────────────┘
```

---

## 📚 官方 Wiki 知识库导航

本项目自带完备的离线专业知识库，欢迎查阅深入指南：

| 章节导航 | 核心内容 | 适用场景 |
| :--- | :--- | :---: |
| 📖 **[文档中心首页 (Home)](docs/Home.md)** | 全局技术概览、知识图谱与全景索引 | 快速查阅 |
| ⚡ **[快速开始 (Quick Start)](docs/Quick-Start.md)** | Windows 桌面向导、Linux/NAS 极速部署、生态绑定 | 新手首选 |
| 🏛️ **[系统架构与原理 (Architecture)](docs/Architecture.md)** | 会话亲和性 (Prompt Cache)、429 智能容灾、Session 隔离 | 架构与深入 |
| 🤖 **[Codex 智能接入 (Codex Integration)](docs/Codex-Integration.md)** | Responses ↔ Chat 协议双向桥、全谱系思考解锁、中文锁定 | Codex 开发者 |
| ⚡ **[Token 压缩与优化 (Context Compression)](docs/Context-Compression.md)** | 5 大确定性压缩引擎、分时段双语统计、防反向膨胀熔断 | 降本增效 |
| 🐧 **[Linux & NAS 部署指南 (Linux/NAS Guide)](docs/Linux-NAS-Deployment.md)** | systemd 用户常驻、fnOS/群晖多卷探测、局域网安全鉴权 | NAS / 私有云 |
| 🪟 **[Windows 桌面指南 (Windows Guide)](docs/Windows-Desktop-Guide.md)** | C# 原生托盘守护、Win32 顶级窗体消息下沉、开机自启 | 桌面用户 |
| 📄 **[Air-Gapped 离线预览 (Office Engine)](docs/Air-Gapped-Office.md)** | 纯本地离线 DOCX/XLSX/PPTX 高保真解析沙箱、安全红线 | 文档与安全 |
| 🩺 **[全链路体检与自愈 (Doctor & Repair)](docs/Doctor-Self-Healing.md)** | 端口冲突自愈、单实例互斥锁清理、异构模型等位跃迁 | 运维排障 |
| 📦 **[组件更新与快照回滚 (Updater & Rollback)](docs/Updater-Rollback.md)** | 核心组件版本监测、全量快照与秒级无损回滚 | 长期维护 |
| 🔌 **[API 核心接口清单 (API Reference)](docs/API-Reference.md)** | 网关控制台 API、配额监测、模型热同步与健康探针 | 二次开发 |
| ❓ **[常见问题排查 (FAQ & Troubleshooting)](docs/FAQ-Troubleshooting.md)** | 高频报错排查速查表、上游限制应对、空流自愈 | 常见问题速查 |

---

## 📄 开源许可

本项目遵循 [MIT License](LICENSE) 开源协议。
