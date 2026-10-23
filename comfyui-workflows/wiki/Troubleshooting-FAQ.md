# ❓ 常见问题排查与自愈手册 (FAQ & Troubleshooting)

本手册收录了在 Windows 11 环境及 AMD 核显上运行 ComfyUI 时的典型日志报错与自愈方法。

---

## 1. 为什么控制台报 `PIL.UnidentifiedImageError: cannot identify image file '...'`？
* **现象**：
  ```text
  [ERROR] !!! Exception during processing !!! cannot identify image file '...input\upload_xxx.png'
  PIL.UnidentifiedImageError: cannot identify image file '...input\upload_xxx.png'
  ```
* **根因**：
  在包含 `LoadImage`（垫图/反推/局部重绘）的节点中，输入目录存在一个**损坏的伪图片**（例如浏览器上传中途断开导致的 0 字节文件，或自动化测试脚本写入的纯文本占位符 `"mock_image_data"`）。
* **自愈方案**：
  打开 `ComfyUI/input/` 目录，检查并删除体积异常（小于 100 字节）的损坏文件即可。ComfyUI 会在 0.03 秒内跳过该错误，对核心服务无任何破坏性影响。

---

## 2. 为什么某次生图耗时高达 1 小时 30 分钟（单步 `1315s/it`）？
* **现象**：
  ```text
  29%|██▊ | 4/14 [01:33<03:53, 23.37s/it]
  29%|██▊ | 4/14 [1:27:40<3:39:10, 1315.08s/it]
  [INFO] Processing interrupted
  [INFO] Prompt executed in 01:30:51
  ```
* **根因**：
  **100% 是 Windows 系统进入了休眠/睡眠模式（Modern Standby）**，或者笔记本合盖、锁屏导致 Windows 内核将 GPU 与计算进程完全冻结挂起。  
  当重新唤醒电脑点亮屏幕后，计算线程恢复，ComfyUI 统计出了这个包含了休眠时间的虚高耗时（`1315s/it`）。
* **自愈方案**：
  若需长时间挂机批量出图，请在 Windows 设置中将“屏幕关闭与睡眠”中的“睡眠”设为“从不”（屏幕可正常关闭熄灭，仅禁止系统休眠挂起 CPU/GPU）。

---

## 3. 为什么报 `ConnectionResetError: [WinError 10054] 远程主机强迫关闭了一个现有的连接`？
* **现象**：
  ```text
  handle: <Handle _ProactorBasePipeTransport._call_connection_lost(None)>
  ConnectionResetError: [WinError 10054] 远程主机强迫关闭了一个现有的连接。
  ```
* **根因**：
  这是 Windows 下 Python `asyncio` 事件循环处理 WebSocket 断开时的经典提示。当在生图过程中**刷新网页、关闭浏览器标签页、或者电脑休眠唤醒导致网页重连**时，旧的 Socket 连接被强行切断，Python 打印了该异常。
* **结论**：
  纯前端通信断开通知，对生成任务与核心模型 **0 影响**，无需处理。

---

## 4. 为什么生图速度有 4s/it、8s/it 和 28s/it 的明显差异？
* **4.0s/it（极速档）**：
  - 对应原生 `512x768`（约 39 万像素），AMD 780M 硬件算力发挥到极致，跑 26 步只需 ~1 分 40 秒；
* **7.5s ~ 8.5s/it（适中档）**：
  - 对应 `768x768`（约 59 万像素，计算量暴增 50%），且挂载了 `FreeU_V2` 频域增强，单步时间拉长到 ~8 秒（15 步总耗时约 1 分 20 秒左右出图）；
* **28s/it（高负荷放大档）**：
  - 对应潜空间微雕放大（Latent Upscale 1.35x/1.5x）。由于像素剧增，780M 共享显存吃紧，系统自动调度部分张量与系统内存分页交换，属于画质优先下的正常现象。

---

## 5. 生成结果全黑（Black Image / NaN）如何解决？
1. **VAE 溢出**：确认启动参数已挂载 `--cpu-vae`；
2. **模型选择**：换用经 fp16 剪裁且稳定的 `vae-ft-mse-840000-ema-pruned.safetensors`。
