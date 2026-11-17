# opengo-router 智能网关高可用、协议桥接与无损压缩准则 (GEMINI.md)

本规则适用于 `D:\Codex\opengo-router`，是智能网关路由、OpenAI/Claude 协议转换、RTK 压缩、KV Cache 优化与高并发流式守护的核心行为准则。

---

## 一、协议桥接、清洗与 KV Cache 优化

1. **终端包装头清洗与结构化非 JSON 折叠**：RTK 顶层无损剥离命令包装头（`Chunk ID:`、`Wall time:`、`Process exited with code 0`、`Warning: truncated output`）。纯代码、diff、patch、报错堆栈 100% 免折叠；安全折叠扩展至长目录/进程表、长 grep、长 CSV。自动解包深度压缩带 `[Tool Output: ...]` 的孤儿转 user 消息。
2. **链式响应根会话溯源与 KV Cache 锁定**：建立全局 LRU 响应链池，经 `previous_response_id` 递归反查锁定根会话 ID（Root Session ID）。严守 Cache-Zone：仅清洗折叠最新轮输出并固化哈希；历史轮次字节级冻结，工具 Schema 字典序排序，保 100% 命中 KV Cache。
3. **双轨请求体限额、413 优先拦截与有界 LRU**：管理接口限 4MB、代理接口限 32MB；底层 `data` 事件实时累计，超限立即截断销毁并优先返 HTTP 413。所有内部状态字典（Session/Fallback/响应链）必配容量上限与真 LRU 淘汰，禁无界 `Map.set`。
4. **编码确定性无损压缩与 KV Cache 冻结**：禁困惑度删词有损压缩；纯代码、Git Diff、冲突标记（`<<<<<<<`）、编译诊断与报错堆栈 100% 免折叠；冻结历史轮次字节并对工具 Schema 递归字典序排序；剥离 `Chunk ID`/`Wall time`/`CLIXML`/`ANSI` 并配防膨胀回滚。
5. **传输降级与计量意图解耦及累加防覆盖**：网络层可用降级/兼容别名（`deepseek-flash`），但内部压缩、Token 计量、账本与时序统计入口强制固化 `model: rawReqModel`（初始标准全称如 `deepseek-v4.1-flash`）。`normalizeModelName` 经 `CANONICAL_MODEL_ALIASES` 与族谱正则 100% 归并至规范全称；TimeSeries/Buckets 聚合同名条目强制用 `+=` 累加，禁用 `=` 覆盖。

---

## 二、高并发流式、状态机与容灾

6. **流式状态图、反静默失败与混沌测试**：
   - 异步流转发禁用零散布尔，须建形式化状态机（`IDLE -> CONNECTING -> STREAMING -> SETTLING -> CLOSED`）配单次结算锁；
   - 禁吞异常返原数据的裸 `try/catch`，降级须打审计日志并在出站口建断言；
   - 流式测试挂载 Chunk Fuzzer 与故障注入，覆盖 `<think>` 跨包撕裂、标签落分包末尾、极限 TTFT、Socket 中断、空帧及 Unicode 撕裂。
7. **思考流块末闭合与未闭合兜底**：流式解析 `<think>...</think>` 时若 `</think>` 位于分片末尾（`after === ''`），定位 `endIdx !== -1` 时须第一时间执行 `closeReasoning()` 并置 `reasoningCompleted = true`（禁绑在 `if (textChunk)` 后，防正文误吸入 `thinkBuffer`）。非流式须用全局正则 `/g`（`replace(/<think>[\s\S]*?<\/think>/g, '')`）串联未闭合兜底（`replace(/<think>[\s\S]*$/, '')`）。
8. **流式退化死循环检测与毫秒级熔断**：滑动窗口实时检测注意力退化重复（如 `"Let me search. Let me search..."`）；相同短语连续重复达阈值（≥4 次）时 1ms 内熔断，强力销毁上游 Socket，追加安全截断提示，派发 `output_item.done` 与 `response.completed` 解锁 UI。
9. **异步销毁单次结算锁与双流竞态绝缘**：Node.js `http`/`https` 中 `proxyReq.destroy(err)` 会在下一微任务触发 `'error'`；所有重试/故障转移须受原子单次结算锁约束；销毁 `proxyReq` 前强制执行 `proxyReq.removeAllListeners('error'); proxyReq.on('error', () => {});`。
10. **空流断流优雅闭环与 UI 转圈解锁**：首字前断流优先毫秒级原位透明重连。重试耗尽发 `response.failed` 时禁发裸空 `output: []`，须注入合规 assistant 中文错误块并触发 `output_item.done`，驱动客户端关闭骨架屏并释放写锁。
11. **非破坏性端口自愈与健康对等体零干扰**：启动遇 `EADDRINUSE` 禁盲目 `taskkill`；先探 `http://127.0.0.1:<port>/health`（500~600ms），确认对等体健康匹配则以退出码 0 静默退出；仅超时/僵死/未知进程霸占时才强杀自愈。
