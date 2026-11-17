# 🛠️ AMD Radeon 780M (gfx1103) + ZLUDA 硬件加速专项配置指南

本指南专为搭载 **AMD Ryzen 7000 / 8000 系列 APU**（如 Ryzen 7 7840HS, 8845HS, 7940HS, 8945HS，内置 **Radeon 780M / gfx1103 架构**）在 Windows 11 环境下，通过 **ZLUDA + ROCm 5.7** 实现稳定、高画质本地文生图推理而编写。

---

## 一、 为什么选择 ZLUDA 而非纯 DirectML / CPU？

1. **DirectML 的局限**：
   - 显存利用率低，容易遭遇莫名其妙的驱动超时（TDR）；
   - 不支持诸多高阶自定义节点（如复杂 LoRA 融合、高级采样器调度）；
   - FP16 计算精度偶发下溢导致黑图。
2. **ZLUDA 的优势**：
   - 将 CUDA 调用毫秒级翻译为 AMD ROCm HIP 底层指令；
   - 能够完整运行标准 PyTorch CUDA 算子与绝大多数 ComfyUI 官方节点；
   - 在 Radeon 780M 上实现 **4.0 ~ 5.2 秒/步** 的稳定推理，双段高精微雕单图可在 4~5 分钟内顺利完成。

---

## 二、 核心环境依赖与驱动矩阵

| 组件 | 推荐版本 | 说明与下载注意 |
| :--- | :--- | :--- |
| **操作系统** | Windows 11 64-bit (22H2 / 23H2 / 24H2) | 具备完整的 GPU 内存动态共享支持 |
| **AMD 显卡驱动** | AMD Software: Adrenalin 24.3.1+ | 基础底层驱动 |
| **ROCm for Windows** | **ROCm 5.7.1** (`C:\Program Files\AMD\ROCm\5.7\`) | **不可使用 6.x**，目前 ZLUDA 针对 5.7.1 稳定性最佳 |
| **ZLUDA** | ZLUDA 3.96+ (适用于 HIP 5.7) | 包含 `nvcuda.dll`、`zluda.exe` |
| **Tensile Library** | gfx1103 专用 Tensile 算子库 | 放置于 `gfx1103_libs\library\`，加速矩阵乘法 |
| **Python** | 3.10.x 或 3.11.x (venv) | 推荐使用独立虚拟环境 |
| **PyTorch** | PyTorch 2.1.2+cu118 或 cu121 | ZLUDA 会劫持 CUDA 算子并重定向 |

---

## 三、 关键启动参数深度解析

启动命令由 [`scripts/start_zluda_amd.ps1`](../scripts/start_zluda_amd.ps1) 自动封装：

```powershell
$zludaExe -- $pythonExe main.py `
    --port 8284 `
    --disable-auto-launch `
    --cpu-vae `
    --use-pytorch-cross-attention `
    --disable-comfy-compiler `
    --reserve-vram 0.9 `
    --disable-async-offload `
    --disable-pinned-memory
```

### 1. 显存保命三剑客：`--cpu-vae`、`--reserve-vram 0.9`、`--disable-pinned-memory`
- **`--cpu-vae`**：
  - Radeon 780M 通常由系统动态分配显存（或 BIOS 固定分配 2GB~4GB）。
  - VAE Decode/Encode 瞬间峰值显存占用极高；将其移至 CPU（搭配 DDR5 高频内存）处理，仅需耗时 1~2 秒，但可**彻底根除 VAE 解码阶段的 CUDA OOM 崩溃**。
- **`--reserve-vram 0.9`**：
  - 强制 ComfyUI 预留 0.9GB 显存给 Windows 桌面合成与驱动开销，防止 Windows DWM 因显存挤爆而黑屏重启。
- **`--disable-pinned-memory`**：
  - 禁用固定页内存映射，防止 Windows 虚拟内存分页池耗尽。

### 2. 计算稳定性双保险：`--use-pytorch-cross-attention`、`--disable-comfy-compiler`
- **`--use-pytorch-cross-attention`**：
  - 替代默认的 xFormers / sdp-attention；
  - ZLUDA 对原生 PyTorch Math Cross-Attention 的兼容性达到 100%，杜绝核函数崩溃。
- **`--disable-comfy-compiler`**：
  - 关闭 TorchDynamo / Inductor 编译，防止 HIP 后端在 JIT 编译时产生无符号溢出。

---

## 四、 环境变量安全注入清单

在拉起 `zluda.exe` 前，脚本注入了以下环境变量：

```powershell
# 1. 显式声明 HIP 运行时根目录
$env:HIP_PATH = "C:\Program Files\AMD\ROCm\5.7\"

# 2. 注入 gfx1103 定制 Tensile 算子库路径
$env:ROCBLAS_TENSILE_LIBPATH = "C:\Users\deanc\ComfyUI-Zluda\gfx1103_libs\library"

# 3. 将 zluda 目录与 ROCm bin 前置注入系统 PATH
$env:PATH = "C:\Users\deanc\ComfyUI-Zluda\zluda;C:\Program Files\AMD\ROCm\5.7\bin;" + $env:PATH

# 4. MIOpen 寻找模式 (2 = Fast, 避免每次初次执行时耗费数分钟探测卷积算法)
$env:MIOPEN_FIND_MODE = "2"
$env:MIOPEN_LOG_LEVEL = "3"

# 5. 禁用未受支持的 cuDNN
$env:TORCH_BACKENDS_CUDNN_ENABLED = "0"
$env:TORCH_COMPILE_DISABLE = "1"
```

---

## 五、 常见排障与自愈指南 (FAQ)

### Q1: 首次出图很慢（超过 10 分钟）？
> **原因**：初次加载模型时，ROCm 驱动需要编译着色器缓存（Shader Cache），且正在向内存装载权重。  
> **应对**：耐受首次冷启动；一旦着色器编译完成并落盘，后续单步推理速度将稳定在 ~4.2s/it。

### Q2: 出现全黑图片 (Black Image)？
> **原因**：部分底模的 VAE 在半精度 FP16 下发生数值溢出（NaN）。  
> **应对**：本仓库工作流已默认绑定独立高精度 VAE `vae-ft-mse-840000-ema-pruned.safetensors` 并开启 `--cpu-vae`，全面杜绝黑图。

### Q3: 运行长任务后系统响应迟钝？
> **应对**：调用 Python 客户端执行 `client.interrupt()` 清空队列，或调用 Windows 批处理清空临时显存缓存。
