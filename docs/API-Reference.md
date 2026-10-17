# API 接口与路由清单 (API Reference)

OpenCode Go Router 在 `4010` 端口上暴露了完备的 RESTful API 与反向代理路由。

---

## 📋 API 路由汇总一览

| 请求路径 | 方法 | 鉴权保护 | 功能描述与返回值 |
| :--- | :---: | :---: | :--- |
| `/health` | GET | 否 | 基础健康探针，返回当前状态、可用账号数与版本 |
| `/status` | GET | 否 | 网关运行指标（总请求数、活跃数、故障转移次数、账号状态） |
| `/balancer/ui` | GET | 是/否 | Web 管理控制台仪表盘界面 |
| `/balancer/api/config` | GET | 是 | 获取当前网关完整配置（密码/敏感字段脱敏） |
| `/balancer/api/config` | POST | 是 | 保存并热重载网关配置（无需重启进程） |
| `/balancer/api/account-quota` | GET | 是 | 查询指定账号的官方滑动窗口配额（5h / 7d / 30d） |
| `/balancer/api/models/sync` | POST | 是 | 动态直连上游同步官方全量最新模型目录并增量热合并 |
| `/balancer/api/reset-cooldown` | POST | 是 | 一键重置所有账号的 429 冷却倒计时与熔断状态 |
| `/balancer/api/bind-desktop` | POST | 是 | 一键将网关配置深度应用至 OpenCode / OpenChamber / OMO |
| `/balancer/api/bind-codex` | POST | 是 | 一键接入 OpenAI Codex CLI / ChatGPT 桌面端 |
| `/balancer/api/restore-codex` | POST | 是 | 一键无损还原 Codex 接入前的原始配置 |
| `/balancer/api/restart-codex` | POST | 是 | 原生外壳脱钩重启 Codex 桌面客户端（刷新内存缓存） |
| `/balancer/api/launch-chamber` | POST | 是 | 原生唤醒并置顶 OpenChamber 桌面客户端 |
| `/balancer/api/open-file` | POST | 是 | 安全沙箱唤醒本地 Office/WPS 打开源文件（Air-Gapped） |
| `/balancer/api/doctor` | GET | 是 | 运行全链路健康体检诊断，返回 10 维度体检报告 |
| `/balancer/api/repair` | POST | 是 | 执行全链路自动修复与自愈 |
| `/balancer/api/updates/check` | GET | 是 | 检查 5 大组件最新版本与破坏性兼容性评级 |
| `/balancer/api/updates/apply` | POST | 是 | 执行指定或全量组件安全更新（升级前自动打快照） |
| `/balancer/api/updates/rollback` | POST | 是 | 执行指定历史快照的秒级无损回滚 |
| `/balancer/api/compression/stats` | GET | 是 | 获取实时压缩指标大盘数据（累计节约 Token、基于各模型官方实时费率动态加权测算的费用预估、5大模块贡献度及 `byModel` 细粒度分模型遥测数据） |
| `/balancer/api/compression/stats/reset` | POST | 是 | 一键清零累计 Token 压缩指标、分模型明细并联动清空内存记忆池 |
| `/balancer/api/compression/doctor` | GET | 是 | 压缩引擎健康体检，返回防降智红线、三端客户端兼容性、安全门限等诊断状态 |
| `/balancer/api/compression/repair` | POST | 是 | 执行压缩引擎一键自愈修复，恢复安全推荐档并消除不安全配置 |
| `/balancer/api/auth/login` | POST | 否 | 控制台密码登录（颁发安全 Cookie 与 Token） |
| `/balancer/api/auth/logout` | POST | 否 | 注销登录并清除凭证 |

---

## 🔀 协议转发与代理端点

| 代理端点 | 目标协议 | 特性与治理机制 |
| :--- | :--- | :--- |
| `/v1/chat/completions` | OpenAI ChatCompletions | 双账号轮询、429 故障转移、会话亲和性、上下文 Token 压缩 (Compactor)、流式 SSE 保活 |
| `/v1/responses` | OpenAI Responses (Codex) | 双向流式转换、思考等级映射、动态会话隔离、上下文 Token 压缩、模型跃迁自愈 |
| `/v1/messages` | Anthropic Messages | Claude 格式自动转接、tool_result 深度压缩、超长上下文切分与 2M 跃迁兜底 |
| `/v1/*` | 其他透传 API | 标准 OpenAI 兼容代理，全预检 CORS 支持与动态 Token 优化 |
