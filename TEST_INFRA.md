# OpenCode Go Router 测试基础设施与测试架构设计规范 (TEST_INFRA)

> **版本**: v3.2.4  
> **文档位置**: `TEST_INFRA.md` (项目根目录)  
> **维护角色**: E2E 测试套件构建专家 (`test_writer_e2e_gen2`)  
> **最后更新**: 2026-10-17  

---

## 1. 架构总览与测试设计哲学

OpenCode Go 智能高可用路由网关建立了生产级、全自动化的双轨端到端测试体系，旨在为 Windows 桌面端与 Linux NAS 双环境提供磐石般的可用性与极速转发性能保障。测试套件严格遵循经典软件测试四大工程设计体系：

```
                    ┌────────────────────────────────────────┐
                    │    Tier 4: 真实复杂场景与长周期浸泡压测  │
                    │   (120+ 请求浸泡 / 内存收敛 / O(1)淘汰) │
                    └───────────────────▲────────────────────┘
                                        │
                    ┌───────────────────┴────────────────────┐
                    │  Tier 3: 上游异构集群故障注入与自愈压测   │
                    │   (502重试 / 429容灾 / RST断连 / 看门狗)│
                    └───────────────────▲────────────────────┘
                                        │
                    ┌───────────────────┴────────────────────┐
                    │   Tier 2: 极限边界与畸形 Payload 压测    │
                    │  (空输出 / >50层递归 / 256KB cap / 裁剪)│
                    └───────────────────▲────────────────────┘
                                        │
                    ┌───────────────────┴────────────────────┐
                    │   Tier 1: 并发与核心特性冲撞压测        │
                    │   (30并发三协议冲撞 / 会话隔离 / 亲和锁) │
                    └───────────────────▲────────────────────┘
                                        │
                    ┌───────────────────┴────────────────────┐
                    │      既有 137 项集成测试基线矩阵        │
                    │      (功能全景 / 压缩引擎 / 跨平台合流) │
                    └────────────────────────────────────────┘
```

1. **Category-Partition (类别-分区法)**: 明确划分协议输入域（Responses、ChatCompletions、Anthropic Messages）、会话模式域（流式 SSE、短请求、连续多轮对话）、上游状态域（正常 200、限频 429、瞬态崩溃 502/503、受限模型报错 400）。
2. **Boundary Value Analysis (BVA, 边界值分析法)**: 穷尽系统极值边界（0 字节空响应、超深 >50 层递归结构、256KB 报错截断上限、滑动窗口 Token 临界裁剪、300s 看门狗超时刷新机制）。
3. **Pairwise Testing (正交配对测试法)**: 交叉组合多账号状态 × 协议转换适配器 × 压缩开关层级 × 流式/非流式传输。
4. **Real-World Workload (真实工作负载模拟)**: 120+ 真实请求长周期连续打压、多轮 `tool_calls` 原子连续性重排、孤儿消息自愈、大批量动态会话 O(1) 淘汰与堆内存收敛监控。

---

## 2. 双轨测试套件体系与职责划分

| 测试套件文件 | 代码行数 | 核心定位与职责 | 执行耗时 | 测试命令 |
| :--- | :--- | :--- | :--- | :--- |
| `test_router.js` | 6,244 行 | **既有全功能集成回归套件 (137 项基线)**<br>覆盖网关反向代理、429 Failover、密码安全、本地沙箱、Codex/Anthropic 协议转换桥、四大上下文压缩引擎、跨平台合流自愈与 Web UI 集成。 | ~85 秒 | `node test_router.js` |
| `test_stress_regression.js` | ~1,020 行 | **四层极限并发、故障注入与浸泡压测套件 (Tier 1 ~ 4)**<br>覆盖 30 并发三协议冲撞、零串话会话隔离、256KB 上游报错截断、502 瞬态抖动自愈重试、429 动态冷却转移、慢速 SSE 看门狗刷新、120 请求长周期内存稳定收敛。 | ~2 秒 | `node test_stress_regression.js` |

---

## 3. 测试运行基础设施与隔离安全机制

### 3.1 动态端口自动发现与分配 (`getFreePort`)
测试运行前通过临时 `net.createServer().listen(0)` 毫秒级探测并分配两个独立空闲端口：
- `mockPort`: 本次测试专用的异构模拟上游集群端口。
- `routerPort`: 本次测试专用的 OpenCode Go 网关监听端口。
彻底根绝硬编码端口引发的 `EADDRINUSE` 冲突。

### 3.2 沙箱级配置与快照隔离
测试运行时动态在系统临时目录 (`os.tmpdir()`) 建立专属沙箱：
- `config.stress-<timestamp>.json`: 临时网关配置文件。
- `test-stress-opencode-<timestamp>`: 临时 OpenCode 配置目录。
- `test-stress-snapshots-<timestamp>`: 临时更新灾备快照目录。
- `test-stress-codex-<timestamp>`: 临时 Codex 配置文件目录。
在 `finally` 块中执行无条件资源回收与垃圾清理，保证测试后环境零污染。

### 3.3 子进程托管与管道排空防挂死 (遵循准则 20)
使用 `child_process.fork('server.js')` 派生独立子进程，显式挂载流排空监听器：
```javascript
routerProc.stdout.on('data', () => {});
routerProc.stderr.on('data', (d) => { routerStderrBuf += d.toString(); });
```
彻底杜绝跨轮次累积日志撑爆 64KB OS 管道缓冲引发的进程永久卡死。

---

## 4. 四层压力与回归测试用例全景矩阵

### 4.1 Tier 1: 并发与核心特性冲撞压测 (Concurrency & Feature Collision Stress)

| 编号 | 用例名称 | 核心验证目标与断言要点 | 涉及模块与端点 | 结果 |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1 - 1.1** | Cross-Protocol Concurrent Assault | 30 个高并发请求同时发起（10x Responses + 10x ChatCompletions + 10x Anthropic Messages），验证全部返回 200，吞吐无阻塞，协议格式各自严格对应。 | `server.js`<br>`codex-adapter.js` | **PASS** |
| **Tier 1 - 1.2** | Session Isolation & Zero Crosstalk | 4 个独立 Session 并发交织发送 20 个请求，每个响应严格包含对应 Session 的专属标记，跨会话串话率为严格 0%。 | `server.js` (Session Map) | **PASS** |
| **Tier 1 - 1.3** | High-Concurrency Session Affinity Lock | 针对单一 Session ID 并发发起 20 个请求，验证 100% 粘性锁定在同一个固定账号上，绝无跨账号轮询漂移。 | `server.js` (selectAccount) | **PASS** |
| **Tier 1 - 1.4** | Adapter Statelessness & Isolation | 同时并发发起包含不同模型（kimi, claude, deepseek, glm）与 reasoning 提取的协议转换请求，验证各转换上下文互不污染。 | `codex-adapter.js` | **PASS** |

### 4.2 Tier 2: 极限边界与畸形 Payload 压测 (Boundary & Malformed Payload Stress)

| 编号 | 用例名称 | 核心验证目标与断言要点 | 涉及模块与端点 | 结果 |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 2 - 2.1** | Zero-Byte & Empty Output Shield | 模拟上游返回 0 字节内容或空 choices 响应，验证网关与协议桥安全防护拦截，绝不发生 JSON 解析异常或未捕获崩溃。 | `server.js`<br>`codex-adapter.js` | **PASS** |
| **Tier 2 - 2.2** | Deep Nested JSON Recursion Barrier | 构造 60 层极端深层嵌套 JSON Schema，验证深度递归安全屏障（>50层拦截）生效，绝不抛出调用栈溢出 (`RangeError`)。 | `context-compactor.js`<br>(slimToolsSchema) | **PASS** |
| **Tier 2 - 2.3** | Control Characters & Escape Sanitization | 传入带有 ANSI 色彩码、覆盖式进度条回车符 `\r` 及控制字符的数据，验证安全剥离并保留核心代码与诊断信息。 | `context-compactor.js`<br>(stripAnsi, cleanProgressBars) | **PASS** |
| **Tier 2 - 2.4** | Massive 350KB Upstream Error Cap (256KB) | 模拟上游返回 350KB 的巨型 500 HTML 报错信息，验证网关立即 unpipe 且聚合缓冲区严格 cap 在 256KB 内，输出标准规范错误。 | `server.js` (MAX_ERR_BYTES) | **PASS** |
| **Tier 2 - 2.5** | Long Context Sliding-Window Pruning | 传入 147,340 字符超长多轮历史对话，验证滑动窗口机制安全裁剪至 17,907 字符，系统提示词与末轮指令 100% 保留。 | `codex-adapter.js`<br>(pruneChatMessages) | **PASS** |

### 4.3 Tier 3: 上游异构集群故障注入与自愈压测 (Fault Injection & Self-Healing Stress)

| 编号 | 用例名称 | 核心验证目标与断言要点 | 涉及模块与端点 | 结果 |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 3 - 3.1** | 502/503 Transient Jitter In-Flight Retry | 模拟上游第 1 次返回 502 HTML 错误页，网关内部自动触发原位平滑重试，第 2 次成功 200，客户端 100% 透明无感知。 | `server.js`<br>(handleUpstreamGlitch) | **PASS** |
| **Tier 3 - 3.2** | 429 Rate Limit Failover & Cooldown Routing | 首个请求遭遇 429 限频（Retry-After: 2s），网关将其标记为 cooling_down，同次请求毫秒级转移至备用账号成功完成。 | `server.js`<br>(handleRateLimitFailover) | **PASS** |
| **Tier 3 - 3.3** | Socket RST / Client Abort Instant Teardown | 客户端流式读取中途突发 `req.destroy()`，网关捕获 abort 后即时销毁对应上游 socket，注销所有监听器，零内存泄漏。 | `codex-adapter.js`<br>(bridgeResponsesStream) | **PASS** |
| **Tier 3 - 3.4** | Slow SSE Streaming & Watchdog Data Refresh | 验证 Anthropic 流式 watchdog 在数据块间隔到达时持续更新 `lastDataTime`，长流不被误杀；静默超时时才精准派发断流。 | `codex-adapter.js`<br>(bridgeAnthropicStream) | **PASS** |
| **Tier 3 - 3.5** | Dynamic Upstream Model Fallback & Memory | 模拟上游提示支持模型清单，网关智能推导兼容模型（旗舰 gpt-6-luna -> deepseek-v4-pro），并在会话记忆池中固化预占。 | `codex-adapter.js`<br>`server.js` (Session Memory) | **PASS** |

### 4.4 Tier 4: 真实复杂场景与长周期内存浸泡压测 (Real-World Workload & Memory Soak Test)

| 编号 | 用例名称 | 核心验证目标与断言要点 | 涉及模块与端点 | 结果 |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 4 - 4.1** | 120-Request Long-Run Memory Soak | 连续发送 120 个混合请求（流式/非流式/多轮），监控堆内存：前 12.39 MB，后 12.24 MB（净增量 -0.15 MB），稳定收敛。 | `server.js`<br>(Node.js Heap Monitor) | **PASS** |
| **Tier 4 - 4.2** | Tool Call Contiguity & Orphan Self-Healing | 复杂多轮 tool_calls 中，验证 assistant 后的 tool 回复严格连续排列、交织通知顺延、缺失回复 dummy 占位、孤儿 tool 消息转 user。 | `codex-adapter.js`<br>(sanitizeAndValidate) | **PASS** |
| **Tier 4 - 4.3** | High-Volume Session Eviction O(1) Scalability | 模拟 1,500 个动态 Session 高频产生与 Fallback 解析，总耗时仅 4 ms（平均 0.003 ms/op），无 O(K*M) 线性瓶颈。 | `server.js`<br>`codex-adapter.js` | **PASS** |
| **Tier 4 - 4.4** | Full Compactor Pipelines under Agent Workloads | 混有 ANSI、进度条、Lockfile Diff、测试通过日志的真实工作流，验证压缩生效，且 Git 冲突标记、堆栈行号 100% 完整保留。 | `context-compactor.js` | **PASS** |

---

## 5. 质量指标与执行命令指南

### 5.1 自动化运行命令
```powershell
# 1. 运行既有 137 项基线功能集成测试
node test_router.js

# 2. 运行四层架构压力与回归测试套件
node test_stress_regression.js

# 3. 运行特定调试模式（输出网关底层详细日志）
$env:DEBUG_ROUTER = "1"
node test_stress_regression.js
```

### 5.2 综合质量验收成果
- **基线集成测试**: 137/137 测试项全部绿灯通过（100%）。
- **压力与回归测试**: 18 项高强度四层压测用例全部绿灯通过（100%）。
- **长周期内存浸泡**: 120 连发请求内存收敛率 100%，堆内存增量严格处于 < 35MB 极优安全线。
- **并发吞吐与死锁**: 30 并发跨协议混合请求 0 挂起、0 丢包、0 串话。
