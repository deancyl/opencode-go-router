# 🌐 ComfyUI REST API 与 WebSocket 交互协议规范

本文档面向自主代码大模型（LLM Agent）、自动化脚本与第三方客户端，详细定义 ComfyUI 的服务端接口与通信协议。

---

## 一、 通信模式总览

ComfyUI 提供双轨接口：
1. **REST HTTP API**：用于任务派发、队列管理、状态读取与产物下载。
2. **WebSocket**：用于实时毫秒级接收采样步数进度（Progress）与节点流转事件。

---

## 二、 核心 HTTP 端点字典

### 1. 提交生图任务 (`POST /prompt`)
- **URL**: `http://<host>:<port>/prompt`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "client_id": "optional-agent-uuid",
  "prompt": {
    "1": {
      "inputs": { "ckpt_name": "anything-v5-PrtRE.safetensors" },
      "class_type": "CheckpointLoaderSimple"
    },
    "2": {
      "inputs": {
        "seed": 12345678,
        "steps": 26,
        "cfg": 7.0,
        "sampler_name": "dpmpp_2m",
        "scheduler": "karras",
        "denoise": 1.0,
        "model": ["1", 0],
        "positive": ["3", 0],
        "negative": ["4", 0],
        "latent_image": ["5", 0]
      },
      "class_type": "KSampler"
    }
  }
}
```
- **Response** (HTTP 200):
```json
{
  "prompt_id": "c85d893f-e8d1-4470-8fc2-5b9220556f89",
  "number": 1,
  "node_errors": {}
}
```

---

### 2. 轮询历史与执行结果 (`GET /history/{prompt_id}`)
- **URL**: `http://<host>:<port>/history/<prompt_id>`
- **Method**: `GET`
- **Response** (任务已完成时):
```json
{
  "c85d893f-e8d1-4470-8fc2-5b9220556f89": {
    "prompt": [...],
    "outputs": {
      "10": {
        "images": [
          {
            "filename": "WF01_Quality_NanoBanana_00001_.png",
            "subfolder": "",
            "type": "output"
          }
        ]
      }
    },
    "status": {
      "status_str": "success",
      "completed": true,
      "messages": []
    }
  }
}
```
> [!TIP]
> 若字典为空对象 `{}`，表示任务仍在队列中等待或正在 GPU 上执行，Agent 应休眠 2~3 秒后重试。

---

### 3. 获取输出图像 (`GET /view`)
- **URL**: `http://<host>:<port>/view?filename=<fn>&subfolder=<sub>&type=<type>`
- **Method**: `GET`
- **Query Params**:
  - `filename`: 图像文件名（如 `WF01_Quality_NanoBanana_00001_.png`）
  - `subfolder`: 子目录名称（默认为空）
  - `type`: `output` 或 `temp`
- **Response**: `image/png` 二进制文件流。

---

### 4. 队列自检与清理 (`GET /queue` & `POST /interrupt`)
- **读取队列**: `GET /queue` 返回 `{"queue_running": [...], "queue_pending": [...]}`。
- **中断当前生成**: `POST /interrupt`，无负载，若进程卡死或用户要求取消时触发。
- **清空待定队列**: `POST /queue` 带 `{"clear": true}`。

---

## 三、 WebSocket 实时监听规范

- **Endpoint**: `ws://<host>:<port>/ws?clientId=<client_id>`
- **核心数据包类型**:
  - `status`: 当前队列堆积数
  - `execution_start`: 任务进入 GPU 执行
  - `executing`: 某节点开始执行（附带 `node_id`）
  - `progress`: 采样步数更新（附带 `value` 当前步, `max` 总步数）
  - `executed`: 某节点执行完毕（附带该节点输出的图片文件名）
