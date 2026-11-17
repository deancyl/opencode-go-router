# 📚 ComfyUI Dual-Track Agent Edition 官方知识库 (Wiki)

欢迎查阅 **ComfyUI Dual-Track Agent Edition** 官方全景知识库与架构百科。  
本项目专为**高质量 AI 绘画创作**与**大模型自主智能体（LLM Agent）零硬编码调度**而设计，深度适配 Windows 11 桌面环境与 AMD APU (Radeon 780M / ZLUDA) 硬件加速。

---

## 🧭 全景知识库导航 (Wiki Index)

| 知识库章节 | 核心内容与阅读目标 |
| :--- | :--- |
| **[1. 极速上手与一键安装](Quick-Start)** | `install.ps1` 与 `install.bat` 全自动安装、全新电脑从零拉取与现有环境无损升级 |
| **[2. 17 套工业级双轨工作流全景图谱](Workflow-Catalog)** | 17 套经过 4D 质检（均分 95.3）的工作流矩阵、高精主干与预览旁路双轨架构 |
| **[3. 多维立体 LoRA 资产图谱](LoRA-Asset-Matrix)** | 5 大核心分类（潮玩盲盒/国风水墨/大师插画/人像写真/质感外挂）与 19 款 LoRA 规范 |
| **[4. 智能意图路由器规范](Smart-Intent-Router)** | 自然语言意图拆解、模型动态装配、萌宠形态隔离词与防人体异化阻断机制 |
| **[5. AMD 780M / ZLUDA 硬件级调优](Hardware-Tuning-AMD-780M)** | Windows 11 + ROCm 5.7 + ZLUDA 踩坑与自愈，解决 LayerNorm 崩溃与显存溢出 |
| **[6. 大模型 Agent 调度与 Python SDK](Agent-SDK-Guide)** | 零硬编码 Manifest 驱动调度、自动化冒烟测试套件与 REST API 协议规范 |
| **[7. 常见问题与故障自愈 (FAQ)](Troubleshooting-FAQ)** | 深入排查 WinError 10054、系统休眠导致的耗时膨胀、损坏图片拦截与自愈 |

---

## 🌟 核心理念与技术基线

1. **画质绝对优先 (Quality-First Invariant)**：
   - 彻底摒弃粗糙的 8 步直接出图方案，成片默认强制走 **26~28 步全精度 DPM++ 2M Karras + 1.35x 双三次潜空间无损放大 + 14~15 步高分辨率精雕 (Refine)**；
   - 仅保留唯一一个极速抽卡探索流（`04_极速抽卡`）供灵感盲盒探索。
2. **纯本地离线闭环 (100% Local & Air-Gapped)**：
   - 全套模型（Checkpoints、LoRA、ControlNet）均放置于本地磁盘（G 盘主仓）；
   - 所有 REST API（`/prompt`, `/history`, `/view`）在 `127.0.0.1:8284` 毫秒级流转，零隐私数据外泄。
3. **零控制台黑框桌面体验 (Zero-Console Desktop Daemon)**：
   - Windows 原生无窗口模式（`WindowStyle 0`）后台静默托管服务；
   - 自动唤出 Edge 独立应用模式（`--app=http://127.0.0.1:8284`），提供极致纯净清爽的独立软件界面。
