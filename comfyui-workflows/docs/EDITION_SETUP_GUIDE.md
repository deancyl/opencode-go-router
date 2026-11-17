# 🚀 专版 ComfyUI 部署与跨机器配置指南 (Turnkey Setup Guide)

本仓库是此 **ComfyUI 双轨智能体专版** 的唯一权威源（Single Source of Truth）。在未来任何全新电脑、重装系统或不同硬件环境中，您均可通过本仓库在数分钟内一键复刻或升级出一套 100% 相同配置的专版环境。

---

## 一、 专版核心资产构成

区别于普通原版 ComfyUI，本专版固化了以下关键能力：
1. **17 套工业级双轨工作流 (`workflows/`)**：质量优先主干（26~28步 DPM++ + 潜空间放大 + 14~15步微雕重绘）+ 旁路极速预览 + 唯一保留极速盲盒抽卡流。
2. **AMD Radeon 780M (gfx1103) / RDNA3 + ZLUDA 稳定补丁与驱动配置**：
   - 彻底解决 LayerNorm 引起的 `0xC0000005` 驱动崩溃；
   - 注入 `--cpu-vae` 与 `--reserve-vram 0.9` 显存保命配置。
3. **配套自定义扩展 (`custom_nodes/ComfyUI-NSFW-Interrogator/`)**：
   - WF03 必需的 WD14 深度反推 + 双轨中英对照与结构化提示词重构。
4. **Agent 机器调度契约 (`AGENT_GUIDE.md`) 与 Python Client SDK**：
   - 供外部智能体（Claude, GPT, Antigravity, OpenCode）程序化调用。

---

## 二、 部署路径 A：在已有 ComfyUI 上一键升级为专版 (推荐，10 秒完成)

如果您本地已经安装了 ComfyUI（如秋叶整合包、官方便携版或普通 git clone 版本）：

### 1. 克隆本仓库到任意临时目录
```powershell
git clone https://github.com/deancyl/comfyui-agent-workflows.git
cd comfyui-agent-workflows
```

### 2. 运行一键配置部署脚本
```powershell
# 自动探测常见目录并一键注入工作流、节点、补丁与启动器
powershell -ExecutionPolicy Bypass -File scripts/setup_edition.ps1 -TargetDir "G:\ComfyUI\ComfyUI-aki\ComfyUI-aki-v3.2\ComfyUI"
```
*(如果不带 `-TargetDir` 参数，脚本会自动扫描本机常见路径，或提示您输入路径)*

### 3. 一键同步完成的内容
- ✅ 17 套双轨工作流已复制至 `user/default/workflows/`；
- ✅ `ComfyUI-NSFW-Interrogator` 已安装至 `custom_nodes/`；
- ✅ 运行了 ZLUDA LayerNorm 与 PyTorch 安全全局变量补丁；
- ✅ 生成了独立桌面应用模式的静默无窗口启动器 `launch_gui.vbs`。

---

## 三、 部署路径 B：从零在全新电脑上拉起专版环境

在全新的 Windows 11 电脑上，请遵循以下四步：

### 第 1 步：安装基础环境
- **Python**: 推荐 Python 3.10.11 或 3.11.x（建议勾选 Add to PATH）；
- **Git**: [Git for Windows](https://git-scm.com/download/win)；
- **AMD 显卡专用（若为 Radeon 780M / 8845HS / 7840HS）**：
  - 安装 [AMD Software: Adrenalin](https://www.amd.com/en/support)；
  - 安装 [ROCm 5.7.1 for Windows](https://repo.radeon.com/rocm/windows/rocm-rel-5.7/amd-hip-sdk-5.7.1.exe)；
  - 下载 ZLUDA 3.96+ 解压至目标目录下的 `zluda/` 文件夹。

### 第 2 步：克隆 ComfyUI 原版与本专版仓库
```powershell
# 1. 克隆官方 ComfyUI
git clone https://github.com/comfyanonymous/ComfyUI.git C:\Users\deanc\ComfyUI-Zluda
cd C:\Users\deanc\ComfyUI-Zluda

# 2. 建立 Python 虚拟环境并安装 PyTorch
python -m venv venv
.\venv\Scripts\Activate.ps1
# NVIDIA 请装 cu121；AMD ZLUDA 请装 cu118 或 cu121
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

### 第 3 步：运行专版一键注入脚本
```powershell
# 进入本专版仓库目录
cd path\to\comfyui-agent-workflows
powershell -ExecutionPolicy Bypass -File scripts/setup_edition.ps1 -TargetDir "C:\Users\deanc\ComfyUI-Zluda"
```

### 第 4 步：运行核心模型一键下载器
```powershell
powershell -ExecutionPolicy Bypass -File scripts/download_models.ps1 -TargetDir "C:\Users\deanc\ComfyUI-Zluda"
```
脚本将自动从 HuggingFace 以多线程断点续传方式下载：
- `anything-v5-PrtRE.safetensors` (二次元主模)
- `realisticVisionV60B1_v51VAE.safetensors` (写实主模)
- `vae-ft-mse-840000-ema-pruned.safetensors` (高精防黑图 VAE)
- `more_details.safetensors` (细节强化 LoRA)
- `Hyper-SD15-8steps-CFG-lora.safetensors` (极速盲盒 LoRA)
- 及其他风格 LoRA 与 ControlNet 模型。

---

## 四、 启动与日常使用

### 1. 桌面独立软件体验（推荐）
双击 ComfyUI 根目录下的 **`launch_gui.vbs`**：
- Windows 原生无窗口模式（`WindowStyle 0`）内核级静默拉起后台服务；
- 绝不弹出任何可见的黑色 CMD/PowerShell 终端黑框；
- 自动以无地址栏、无标签页的 Edge 独立应用模式（`--app=http://127.0.0.1:8284`）呼出界面。

### 2. 命令行启动
- **AMD 780M / ZLUDA**：
  ```powershell
  powershell -File scripts/start_zluda_amd.ps1 -Foreground
  ```
- **NVIDIA GPU**：
  ```cmd
  scripts\start_nvidia.bat
  ```

---

## 五、 今后的升级与维护

当本仓库的工作流或配置发生升级时：
```powershell
cd path\to\comfyui-agent-workflows
git pull
powershell -ExecutionPolicy Bypass -File scripts/setup_edition.ps1 -TargetDir "您的ComfyUI目录"
```
1 秒钟即可完成本机全部工作流与节点的同步更新！
