# 系统架构与核心机制 (Architecture)

本文档详细阐述 OpenCode Go Router 智能网关的设计哲学、架构分层以及关键技术机制。

---

## 🏛️ 系统架构全景图

```mermaid
flowchart TD
    subgraph ClientLayer["客户端接入层 (Client Ecosystem)"]
        CLI["OpenCode CLI v2"]
        Chamber["OpenChamber Web / Desktop"]
        Codex["OpenAI Codex CLI / ChatGPT App"]
        OMO["Oh My OpenAgent (多智能体)"]
        Goal["Goal 推进体系 (/goal, /boost)"]
    end

    subgraph GatewayLayer["高可用智能路由网关 (opencode-go-router:4010)"]
        Auth["局域网安全鉴权门禁 (Cookie + Bearer Token)"]
        
        subgraph ProtocolBridge["智能双向协议桥 (Protocol Bridges)"]
            P_Responses["OpenAI Responses API 桥"]
            P_Chat["OpenAI ChatCompletions 桥"]
            P_Anthropic["Anthropic Messages 桥"]
            P_Direct["原生透传反向代理"]
        end
        
        subgraph FlowControl["流量治理与自愈内核 (Resilience Kernel)"]
            SessionIso["动态会话强隔离 (Dynamic Session Derivation)"]
            Affinity["会话亲和性锁定 (Session Affinity / Cache Lock)"]
            SchemaNorm["动态工具 Schema 深度规范化 (inputSchema/parameters)"]
            ErrorClean["非200错误清洗屏障 (Sanitization Barrier)"]
            FallbackEng["异构推理集群模型无感跃迁引擎"]
            Watchdog["SSE 10s心跳保活 + 300s停滞看门狗"]
        end

        subgraph LoadBalancer["多账号负载均衡器 (Account Pool)"]
            RR["加权轮询 / 状态健康检查"]
            Failover["零感 429 故障转移 (Failover)"]
            Cooldown["智能 Retry-After 冷却管理器"]
            QuotaMonitor["官方滑动窗口配额监控 (5h / 7d / 30d)"]
        end
    end

    subgraph UpstreamLayer["OpenCode Zen 聚合上游"]
        Acc1["OpenCode Go 订阅账号 1 ($10/月)"]
        Acc2["OpenCode Go 订阅账号 2 ($10/月)"]
        AccN["... 扩展多账号池"]
    end

    ClientLayer --> Auth
    Auth --> ProtocolBridge
    ProtocolBridge --> FlowControl
    FlowControl --> LoadBalancer
    LoadBalancer --> UpstreamLayer
```

---

## 🔑 核心技术机制深度解析

### 1. 动态会话隔离 (Dynamic Session Derivation)
- **痛点**：多端或多标签页并发请求时，若采用静态共享 Session ID，上游推理节点会发生状态冲突，导致正在推理的前序会话被直接掐断（报 `aborted`）。
- **机制**：网关优先从客户端请求头 `x-opencode-session`、`x-conversation-id`、`x-request-id` 以及 Responses 请求体中的 `previous_response_id` 中动态派生强隔离的唯一哈希标识，确保多会话并发零冲突。

### 2. 会话亲和性 (Session Affinity) 与 Prompt Cache 锁定
- **机制**：针对同属于一个工作流或连续对话的请求，网关将其严格绑定在同一上游订阅账号上；
- **价值**：极大提升上游 KV 缓存 (Prompt Cache) 命中率，推理首字延迟降低 60% 以上，并大幅节约 Token 消耗。

### 3. 零感 429 故障转移 (Failover) 与智能冷却
- **机制**：当当前账号返回 `429 Too Many Requests` 或 `503 Service Unavailable` 时，网关捕获响应并在内存中瞬间将请求切换到备用账号重试；
- **智能冷却**：解析响应头中的 `retry-after`，将受限账号置入冷却队列，冷却期结束后自动重新纳入调度池。整个切换过程对上层客户端完全透明，杜绝任务中断。

### 4. 异构推理集群模型无感跃迁 (In-Flight Fallback)
- **痛点**：上游 Zen 聚合层接入了多家异构推理集群。部分受限节点对模型名称有苛刻白名单，传入新版全名（如 `deepseek-v4.1-flash`）会抛出：
  `The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4.1-flash.`
- **机制**：网关内置正则提取器毫秒级解析上游返回的受支持模型列表，按同梯级（Flash $\to$ Flash、Pro $\to$ Pro）与族谱前缀推导等位模型，并在网关层透明重放当前轮次，客户端 100% 零感知。

### 5. 动态工具 Schema 规范化与网关错误清洗屏障
- **Schema 规范化**：全面探测 `parameters`、`inputSchema` 与 `input_schema`，杜绝空参数降级为空对象 `{}` 引发严校验上游集群 400 崩溃；强制补齐 `{ type: 'object', properties: {} }`。
- **错误清洗屏障**：拦截非 200 响应，强制剥离 `content-encoding` 干扰，将上游 0 字节 SSE 空流或非标裸 JSON 统一包装为规范的 OpenAI Error 结构，消除客户端红框气泡与空气泡。
