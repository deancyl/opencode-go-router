# OpenAI Codex CLI 与 ChatGPT 桌面端智能接入 (Codex Integration)

本文档深入介绍如何将 **OpenAI Codex CLI** 与 **ChatGPT 桌面客户端**（Windows UWP 应用）无缝接入 OpenCode Go Router 智能网关。

---

## 🌟 核心特性一览

1. **全量 38 款模型目录直接使用**：  
   DeepSeek V4.1/Pro、智谱 GLM 5.3 Flash/Plus、月之暗面 Kimi K3/K2.7、MiniMax M3、通义千问 Qwen3.7/Qwen3.8、Claude 3.7 Sonnet、GPT-5.6/6 Luna 等全量可用。
2. **双向实时流协议转换 (Responses <-> ChatCompletions)**：  
   Codex 原生使用 OpenAI Responses API 规范，网关自动完成双向 SSE 流转换，支持思维链解包与动态工具调用。
3. **全谱系思考等级 (Reasoning Effort) 自由调节**：  
   彻底打破中度思考限制，完整支持 `low`、`medium`、`high`、`xhigh`，充分释放模型长推理与深思能力。
4. **简体中文语言锁定 (Localization Lock)**：  
   自动写入 `[desktop].localeOverride = "zh-CN"`，防止接入或更新配置后桌面界面意外漂移为英文。
5. **Windows PLM 挂起与单实例互斥锁自愈**：  
   诊断并清除 Windows 进程生命周期管理器（PLM）冻结的后台无窗口挂死实例，杜绝双击客户端无法打开或秒退。
6. **一键脱钩重启与内存缓存感知**：  
   消除 Codex 启动时常驻内存的配置缓存，支持一键无黑框脱钩重启生效。

---

## ⚡ 一键接入与还原

### 方式 1：Web 控制台图形界面（最推荐）
1. 访问控制台：`http://127.0.0.1:4010/balancer/ui`；
2. 找到 **【🤖 OpenAI Codex CLI 智能接入】** 卡片；
3. 点击 **【⚡ 一键接入 Codex】**；
4. 提示接入成功后，点击弹窗中的 **【🔄 重启 Codex 客户端】**；
5. 若需恢复原始配置，随时点击 **【⏪ 一键还原原本配置】**。

### 方式 2：终端脚本快速操作
在 Windows PowerShell 中：
```powershell
# 运行配置向导并选择 Codex 接入：
powershell -ExecutionPolicy Bypass -File .\setup-wizard.ps1
# 输入 10 进入 Codex 接入菜单，按提示执行接入或还原
```

---

## ⚙️ 配置文件机制说明

执行一键接入时，网关会对 `~/.codex/config.toml` 进行精确管理：

```toml
model = "opencode-go/deepseek-v4.1-flash"
model_provider = "opencode-go"

[desktop]
localeOverride = "zh-CN"

[model_providers."opencode-go"]
base_url = "http://127.0.0.1:4010/v1"
wire_api = "responses"
stream_idle_timeout_ms = 300000
stream_max_retries = 3
request_max_retries = 3

[model_providers."custom"]
base_url = "http://127.0.0.1:4010/v1"
wire_api = "responses"
```

- **双轨提供商互锁**：将 `custom` 与 `opencode-go` 的 base_url 均收口至 4010 本地网关，彻底消灭直接打官方时模型白名单不匹配的问题；
- **长推理超时守护**：注入 `300000ms`（5分钟）流空闲超时，杜绝复杂推理或大工具调用时连接提前断开；
- **自动上下文切分**：模型元数据中注入 `auto_compact_token_limit = 85%`，杜绝 `context_length_exceeded` 崩溃。

---

## 🩺 常见问题与自愈

### 1. Codex 启动秒退或双击打不开？
- **原因**：Windows 将先前退出的 Codex 冻结在后台（`MainWindowHandle == 0`），霸占了 Electron/UWP 单实例锁；
- **自愈**：在 Web 仪表盘点击【一键体检与修复】（Doctor），或运行 `.\doctor-repair.ps1 -AutoFix`，网关将强力清除僵死句柄并脱钩唤醒。

### 2. 界面显示英文？
- **自愈**：在 Web 控制台点击【⚡ 一键接入 Codex】再次应用，网关会自动补齐 `[desktop].localeOverride = "zh-CN"` 并写入 Chromium 语言覆盖环境，重启后即恢复纯正简体中文。

### 3. Windows 下终端命令因反斜杠、curl 别名或 && 解析报错？
- **机制**：网关内置 Windows PowerShell 转义优化引擎，在 Codex 发送 `execute_command` 工具调用时自动修正路径末尾反斜杠防吃闭合引号、将 `curl` 别名映射为 `curl.exe`、将 `&&` 转义为兼容语法；在终端返回 `#< CLIXML` 报错时自动去噪 hex 编码与堆栈，削减 70%~90% 终端试错 Token 开销。

### 4. Codex Responses 实机实测检验指标
- **协议兼容性**：Responses 双向流协议无缝转换，HTTP 200，SSE 平稳闭环到达 `completed`，0 断流；
- **多模块独立节约**：Codex 单轮实测节约 435 字符（~114 Tokens），其中 PowerShell 贡献 340 字符、RTK 贡献 57 字符、Schema 规范化贡献 38 字符。

---

## 🛡️ 多 IDE 协议适配与流式底层健壮性架构

针对 VSCode、Cursor、OpenChamber 及 Codex CLI 在高并发流式交互与复杂工具调用场景，网关在底层构建了高可靠的流式状态机：

### 1. SSE 流式 TCP 半包与 UTF-8 多字节分包免疫 (StringDecoder State Machine)
- **隐患根因**：传统按单次 `chunk.toString('utf8')` 切行解析的方式，在遇到 3 字节 UTF-8 中文或 4 字节 Emoji 恰好被 TCP 分包切断时，会被 Node.js 强制置换为不可逆的乱码占位符 `\uFFFD`，且跨包截断的 JSON 帧会直接抛出 `SyntaxError` 导致 IDE 代码补全中断。
- **加固机制**：引入 `string_decoder.StringDecoder('utf8')` 与 `pendingBuffer` 行缓冲区。只有收到完整换行符 `\n` 时才提交给 JSON 解析器；在连接结束时，通过 `decoder.end()` 冲刷并回捞尾部不带换行符的完整数据行，实现 100% 字节还原与零数据丢失。

### 2. 多并发工具调用分片隔离与参数汇聚 (Tool Calls Index Demuxing)
- **隐患根因**：多并发工具调用（如同时并发触发搜索与文件读取）时，上游推送的 `tool_calls` 切片交错到达；若单纯全局累加参数会导致 JSON 串混淆。
- **加固机制**：网关在流式管道中建立局部 `toolCallsMap (index -> { id, name, args, outIdx })`，严格按照 `index` 与 `call_id` 隔离拼接每个工具调用的 `arguments`，在流终态时自动校验闭合并生成规范的 `response.output_item.done` 事件。

### 3. 反向代理抗缓冲与 IDE 补全零卡顿 (Anti-Buffering Optimization)
- **隐患根因**：中间反向代理（如 Nginx、Traefik、透明网关）在代理 SSE 流时，默认启用 4KB~16KB 输出缓冲，导致 Cursor / VSCode / Codex CLI 补全出现“长时间卡顿后一次性喷出一大段”的跳跃体验。
- **加固机制**：网关在全部 SSE 流通道（`/v1/responses`、`/v1/chat/completions`、`/v1/messages`）的响应头中强制注入 `'X-Accel-Buffering': 'no'` 与 `'Cache-Control': 'no-cache'`，提示反向代理立即将单字分片刷新至下游客户端，实现丝滑流畅的打字机流式补全。

### 4. 终态帧与思维链保底 (Exactly-Once Completion & DeepSeek <think> Guard)
- **终态严格一次 (Exactly-Once)**：无论上游是正常 `[DONE]` 结束、携带 `finish_reason: stop` 终止，还是因异常触发 Rule 33 优雅关闭，网关确保唯一一次派发终态元数据与 `data: [DONE]\n\n`，绝不发生重复发送或漏发。
- **思维链平滑提取**：内置跨包前缀缓冲状态机（`thinkBuffer`），对 DeepSeek 系列模型跨 SSE 分片到达的 `<think>` 与 `</think>` 标签进行精确识别与剥离，将思考过程无损转为 `reasoning_text`，正文转为 `output_text`，严防思考标签泄露污染正式回复。


