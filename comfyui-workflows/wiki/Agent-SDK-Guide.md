# 🤖 大模型智能体调度与 Python SDK 使用指南 (Agent SDK Guide)

为了让自主代码大模型（LLM Agent，包括 Google Antigravity, Claude, OpenAI Codex/ChatGPT, OpenCode, AutoGPT 等）能够零摩擦、零硬编码地控制 ComfyUI，本专版提供了强化版 SDK [`scripts/comfy_agent_client.py`](../scripts/comfy_agent_client.py)。

---

## 一、 快速冒烟测试 (Smoke Test)

在 Agent 首次连接到本地 ComfyUI 时，强烈建议首先执行端到端自动化冒烟测试：

```bash
python scripts/comfy_agent_client.py --test
```

### 冒烟测试全自动核验环节：
1. **服务探针健康检查**：向 `GET /system_stats` 发送毫秒级探针，确认端口监听就绪；
2. **Manifest 字典校验**：读取 `workflows_manifest.json`，核验工作流与关键节点映射（Prompt 节点、负向节点、采样器节点）；
3. **真实端到端成片闭环**：调度 04 号极速流派发测试任务至 `/prompt`，轮询 `/history` 状态机，下载成片至磁盘并校验图像字节大小有效性。

---

## 二、 SDK 核心代码范式

### 1. 基础调用：通过工作流编号或风格标签生图
```python
from scripts.comfy_agent_client import ComfyAgentClient

client = ComfyAgentClient(server_url="http://127.0.0.1:8284")

# 根据标签匹配工作流
wf_info = client.get_workflow_info("photorealistic")  # 或指定编号 "01"
print(f"匹配到工作流: {wf_info['name']}")

# 自动解析 Node ID 注入参数并执行
images = client.run_generation(
    wf_id_or_path="01",
    prompt="masterpiece, best quality, ultra-detailed, photorealistic portrait, soft volumetric lighting",
    negative="lowres, bad anatomy, bad hands, blurry",
    output_dir="./downloads"
)

print(f"成片已下载: {images}")
```

### 2. 进阶调用：自然语言智能意图路由 (`smart_generate`)
无需关心背后是几号工作流，Agent 直接将用户的自然语言传递给路由器：
```python
# 自动识别意图、选择底模、装配匹配 LoRA、注入防畸变负向词
images, decision = client.smart_generate(
    prompt="一只可爱皮卡丘在向日葵花田奔跑",
    mode="quality",
    output_dir="./downloads"
)

print(f"决策流派: {decision['category']}")
print(f"挂载 LoRA: {decision['lora_name']}")
print(f"决策理由: {decision['rationale']}")
```

---

## 三、 标准 REST API 接口映射字典

Agent 如需编写原生 HTTP 请求，直接调用以下标准 REST 接口：

| HTTP 端点 | 方法 | 作用 | 关键参数与响应 |
| :--- | :---: | :--- | :--- |
| **`/system_stats`** | `GET` | 查询服务器健康状态与可用显存 | 返回 `devices`、`vram_free`、`ram_free` |
| **`/queue`** | `GET` | 查询当前运行队列与等待队列 | 返回 `queue_running` 与 `queue_pending` |
| **`/prompt`** | `POST` | 提交执行图 JSON (Execution Graph) | 请求体 `{"prompt": {...}}`，返回 `prompt_id` |
| **`/history/{prompt_id}`** | `GET` | 轮询任务状态与输出成片文件名 | 返回节点 outputs，包含 `images[].filename` |
| **`/view`** | `GET` | 下载生成的原图文件 | Query 参数 `filename=...&type=output` |
| **`/interrupt`** | `POST` | 强行终止当前正在执行的任务 | 请求体 `{}`，立刻中止并释放显存 |
