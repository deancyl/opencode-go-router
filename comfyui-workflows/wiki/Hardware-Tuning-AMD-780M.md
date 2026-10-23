# 🛠️ AMD 780M / ZLUDA 硬件级调优与避坑指南 (Hardware Tuning AMD 780M)

AMD Radeon 780M（核显架构 gfx1103，RDNA3）具备最高 12GB~16GB 动态共享显存，性价比极高，但由于非原生 NVIDIA CUDA 架构，在运行 PyTorch + ComfyUI 时极易遭遇驱动崩溃、内存溢出与 LayerNorm 致命异常。

本指南记录了本专版实现的全部硬件级自愈修补方案。

---

## 一、 核心痛点与自愈修复矩阵

| 致命故障现象 | 底层根因分析 | 本专版工程自愈补丁 |
| :--- | :--- | :--- |
| **生图瞬间闪退，退出代码 `0xC0000005` (Access Violation)** | ROCm 5.7 对 RDNA3 的 `torch.nn.functional.layer_norm` 指令翻译缺陷，触发底层空指针访问 | 在 `comfy/zluda.py` 中自动注入 LayerNorm 包装器，强制将 LayerNorm 运算路由至安全 CPU/原生 PyTorch 计算，彻底消灭闪退 |
| **生图到 80% 突然报错 CUDA Out of Memory (OOM)** | 780M 核显共享显存发生突发峰值，Windows DWM 桌面合成器与 GPU 争抢显存 | 启动参数中强制注入 `--reserve-vram 0.9`，硬性预留 900MB 缓冲区给系统桌面，显存永远不撞墙 |
| **VAE 解码阶段系统死锁黑屏或卡死** | VAE 全分辨率解码需要瞬时分配巨大连续显存块，APU 共享内存无法满足 | 启动参数强制注入 `--cpu-vae`，将极轻量且易溢出的 VAE 解码安全卸载给 8 核 16 线程的 CPU 执行（仅多耗时 1~2 秒，换取 100% 稳定性） |
| **双击快捷方式或脚本闪退秒退** | 后台存在无窗口孤立僵死进程霸占端口或锁文件 | 编写 `launch_gui.vbs` 与全栈自愈探测器，启动前毫秒级检测端口并平滑拉起 |

---

## 二、 关键启动参数黄金法则

在 `start_zluda_amd.ps1` 中，以下参数经过了上百次实机压测：

```powershell
$argsList = @(
    "--",
    $pythonExe,
    "main.py",
    "--port", "8284",
    "--disable-auto-launch",
    "--cpu-vae",                    # 强制 CPU 解码 VAE，杜绝显存瞬间爆表
    "--use-pytorch-cross-attention",# 使用 PyTorch 原生交叉注意力，避免 xformers 驱动冲突
    "--disable-comfy-compiler",     # 禁用 TorchInductor 编译器，消除驱动不兼容
    "--reserve-vram", "0.9",        # 显存安全缓冲红线
    "--disable-async-offload",      # 保证张量串行传输，避免 AMD 共享内存竞争
    "--disable-pinned-memory"       # 禁用锁页内存，防止与 Windows 虚拟内存交换冲突
)
```

---

## 三、 硬件性能基线 (Benchmarking)

在上述优化下，AMD Radeon 780M 在 Windows 11 环境下的实测性能数据如下：

* **SD 1.5 原生分辨率 (`512x768`)**：
  - 采样速度：**~3.9s ~ 4.2s / it**；
  - 8 步极速抽卡（WF04）：**~30 秒 / 张**；
  - 26 步全精度 DPM++ 2M Karras：**~1 分 45 秒**。
* **高精度潜空间微雕 (`512x768` -> 1.35x 双三次放大 -> 14步 Refine)**：
  - 总耗时：**~4 分钟 / 张**；
  - 稳定性：连续 50 张连续跑卡 **0 崩溃、0 显存溢出、0 坏图**。
