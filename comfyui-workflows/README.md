# 🎨 ComfyUI Dual-Track Agent Edition

[![GitHub License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub Wiki](https://img.shields.io/badge/Wiki-Knowledge%20Base-blueviolet.svg)](wiki/Home.md)
[![ComfyUI](https://img.shields.io/badge/ComfyUI-Core%20v0.3+-success.svg)](https://github.com/comfyanonymous/ComfyUI)
[![AMD ZLUDA Verified](https://img.shields.io/badge/AMD%20ZLUDA-Radeon%20780M%20Passed-orange.svg)](wiki/Hardware-Tuning-AMD-780M.md)
[![Agent Ready](https://img.shields.io/badge/Agent-Autonomous%20Contract-purple.svg)](AGENT_GUIDE.md)
[![Turnkey Setup](https://img.shields.io/badge/Setup-One--Click%20Deploy-brightgreen.svg)](install.ps1)

工业级 ComfyUI 双轨自动化工作流矩阵、硬件级调优套件与大模型智能体调度方案。  
**本仓库是此专版 ComfyUI 的唯一权威源**：未来在任何全新电脑、重装系统或已有环境中，均可通过本仓库在数分钟内一键配置或复刻出 100% 相同标准的专版 ComfyUI。

---

## 🌟 核心特色与设计哲学

- 🎯 **质量绝对优先 (Quality-First Invariant)**：
  - 彻底淘汰粗制滥造的 8 步直接出图，根除塑料蜡像假面与结构融化；
  - 移除了诱发高频重影与色散的 `FreeU_V2` 频域算子；
  - 彻底解耦真人写实 LoRA 与 2D 二次元底模，解决“油画模糊涂抹”痛点，实现纯净锐利的赛璐珞硬线稿与工业三视图。
- ⚡ **标准化双轨拓扑 (Dual-Track Architecture)**：
  - **默认交付主链路 `[MODE:QUALITY]`**：26~28 步全精度 DPM++ 2M Karras + 1.35x~1.5x 潜空间放大 + 14~15 步高分微雕重绘（Denoise 0.44~0.52）-> `[OUTPUT:QUALITY]`；
  - **旁路极速预览链路 `[MODE:PREVIEW]`**：8 步轻量 Hyper-SD 旁路分支，专供 LLM Agent 进行秒级粗览构图与灵感探索；
  - **全体系唯一保留极速盲盒流**：`04_极速抽卡_无限多风格探索流`，兼顾秒级大批量抽卡。
- 🚀 **跨机器一键配置 (Turnkey Setup & Deploy)**：
  - 提供自动化脚本 `scripts/setup_edition.ps1` 与 `scripts/download_models.ps1`；
  - 现有 ComfyUI / 秋叶整合包 10 秒升级为专版，全新机器从零快速拉起。
- 🖥️ **深度适配 AMD APU (Radeon 780M / gfx1103) + ZLUDA**：
  - 独家调优的 Windows 11 + ZLUDA + ROCm 5.7 纯静默后台守护脚本；
  - `--cpu-vae` 与 `--reserve-vram 0.9` 显存保命配置，让轻薄本/迷你主机以 ~4.2s/it 稳定连续生图不黑屏、不崩溃；
  - 解决 LayerNorm 引起的 `0xC0000005` 驱动崩溃。
- 🤖 **Agent 机器可读调度契约 (`AGENT_GUIDE.md`)**：
  - 详尽的 Node ID 映射字典、REST API 队列控制协议与自愈防爆指南，支持外部智能体（Claude, GPT, Antigravity, OpenCode）100% 自主闭环调用。

---

## 📑 17 套工业级双轨工作流矩阵

所有工作流均通过解剖结构（30%）、面部五官（30%）、材质纹理（20%）、锐度纯净度（20%）四维量化质检，**质检均分高达 95.3 / 100**。

| 序号 | 工作流名称 | 核心风格定位 | 推荐底模 | 采样策略 | 4D 质检评分 |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **01** | `01_真人写实_极致NanoBanana_次表面透析_电影双段精雕流` | 电影级胶片质感、真实皮肤毛孔、耳廓逆光次表面红润透光 | Realistic Vision V6.0 B1 | 26步 DPM++ + 1.35x微雕 14步 | **94 / 100** |
| **02** | `02_抓拍视角_MOSS灵感_业余POV画中画_多档切换胶片流` | 业余手持手机抓拍视角、新娘微笑、婚纱缎面与闪光灯暗角 | Realistic Vision V6.0 B1 | 26步 DPM++ + 1.35x微雕 14步 | **95 / 100** |
| **03** | `03_智能工具_NSFW精准提示词反推工作台_中英对照融合` | WD14 深度反推 + 双轨中英对照表 + 结构化提示词重构 | 无需生图底模 | 纯图像特征提取 (免 KSampler) | **拓扑达标** |
| **04** | `04_极速抽卡_无限多风格探索流_秒级盲盒` | **全体系唯一保留的极速抽卡流**，轻量盲盒随机探索 | Anything V5 | 8步 Hyper-SD (秒级极速) | **官方保留** |
| **05** | `05_二次元总控_全能风格切换总控台_吉卜力_新海诚_暗黑` | 3 路 LoRA 切换矩阵，吉卜力/新海诚/暗黑自由组合 | Anything V5 | 26步 DPM++ + 1.35x微雕 14步 | **继承达标** |
| **06** | `06_二次元手绘_吉卜力唯美手绘风_童话治愈流` | 宫崎骏/男鹿和雄水彩质感、蓝天白云绿茵草坡与治愈倒影 | Anything V5 | 26步 DPM++ + 1.35x微雕 14步 | **95 / 100** |
| **07** | `07_二次元光影_新海诚光影日漫_双轨纯欲流` | 暮色霞光与彗星尾迹、东京夜景灯火、纯欲少女利落线稿 | Anything V5 | 26步 DPM++ + 1.35x微雕 14步 | **95 / 100** |
| **08** | `08_二次元暗黑_暗黑异界深渊_触手侵蚀流` | 星云发光紫眸、恶魔小虎牙与胸前深V哥特蕾丝刺绣 | Anything V5 | 26步 DPM++ + 1.35x微雕 14步 | **93 / 100** |
| **09** | `09_2D精细厚涂_圣职修女与地牢囚徒_禁断反差专精流` | 哥特厚涂笔触、金边十字架刺绣、半透明黑丝暗纹与彩绘玻璃 | Anything V5 | 26步 DPM++ + 1.35x微雕 14步 | **95 / 100** |
| **10** | `10_2D精细厚涂_4大经典主题快速切换总控台` | 4 大魔幻主题（地牢祭坛/世界之树/女武神/废土机甲） | Anything V5 | 26步 DPM++ + 1.35x微雕 14步 | **96 / 100** |
| **11** | `11_2D精细厚涂_开放式材质强化与反推沙箱` | 重装巴洛克金雕板甲、镜面精钢、紫晶星瞳与半透明白丝披风 | Anything V5 | 26步 DPM++ + 1.35x微雕 14步 | **97 / 100** |
| **12** | `12_BetterWaifu_五阶LoRA矩阵与动态姿态总控台` | 赛璐珞硬线稿二次元机甲少女，彻底杜绝油画模糊 | Anything V5 | 26步 DPM++ + 1.35x微雕 14步 | **96 / 100** |
| **13** | `13_实用工具_局部重绘与垫图图生图修图流` | VAE 羽化遮罩（Feather 8）+ 局部修复高精融合 | 可自由切换 | 26步 DPM++ (Denoise 0.65) | **拓扑达标** |
| **14** | `14_精准控制_ControlNet姿态骨骼与线稿重绘流` | OpenPose 骨骼锁定 + Canny 线稿 1:1 姿态复刻 | 可自由切换 | 26步 DPM++ + 1.35x微雕 14步 | **拓扑达标** |
| **15** | `15_生活写实_日常阳光通勤与社交人像写真流` | 晨光街拍写真、毛线针织针脚微观纹理、真实笑颜与自然手指 | Realistic Vision V6.0 B1 | 26步 DPM++ + 1.35x微雕 14步 | **97 / 100** |
| **16** | `16_宽屏场景_16比9超清唯美风光与桌面壁纸流` | 896x512 宽幅直出、日照金山雪线与高山镜湖宏大景深 | Realistic / Anything | 26步 DPM++ + 1.35x微雕 14步 | **96 / 100** |
| **17** | `17_概念设计_全能设计图与角色三视图设定集` | 工业级角色设计三视图（正/侧/背）+ 5 组表情差分矩阵 | Anything V5 | 28步 DPM++ + 1.5x微雕 15步 | **94 / 100** |

---

## 🛠️ 本地一键全自动安装与环境复刻 (Turnkey Single-Script Installer)

无论是在全新电脑上从零搭建，还是为现有的 ComfyUI（如秋叶整合包、官方独立版）进行一键注入升级，**仅需运行根目录下的单一脚本 `install.ps1`（或双击 `install.bat`）即可全自动闭环完成**：

```powershell
# 1. 克隆本仓库
git clone https://github.com/deancyl/comfyui-agent-workflows.git
cd comfyui-agent-workflows

# 2. 执行单脚本主安装器 (全自动探测目标路径、注入17套工作流、安装节点、打上ZLUDA驱动补丁并拉取19款LoRA)
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

> **Windows 桌面用户**：直接双击根目录下的 **`install.bat`** 即可在交互式引导下完成全部安装！

#### `install.ps1` 全自动安装流水线包含：
1. **自动路径探测与环境自愈**：自动扫描秋叶整合包或独立版 ComfyUI；若全新机器无 ComfyUI，脚本会自动从官方拉取源码并创建 Python 虚拟环境；
2. **17 套双轨工作流批量部署**：同步至 `user/default/workflows/`；
3. **关键扩展安装**：自动装配 `ComfyUI-NSFW-Interrogator` 与 `Gacha_Prompt_Randomizer` 抽卡动态词池；
4. **硬件驱动自适应加速 (AMD 780M / ZLUDA)**：自动检测 AMD APU，若缺失 ZLUDA 运行时，自动从 GitHub Releases 资产拉取预编译包并解压，打上 LayerNorm 防崩溃补丁；
5. **模型与多维 LoRA 同步**：自动核验并下载 19 款精选经典 LoRA（泡泡玛特盲盒、粘土定格、水墨墨心、Figma手办等）；
6. **桌面无控制台黑框静默启动器**：生成 `launch_gui.vbs`，实现双击秒开独立桌面应用体验。


---

## 🖥️ 桌面启动与运行体验

专版生成了无控制台黑框的静默启动器：
- 双击 **`launch_gui.vbs`**：
  - Windows 原生无窗口模式（`WindowStyle 0`）在后台纯静默托管；
  - 自动以 Edge 独立应用模式（`--app=http://127.0.0.1:8284`）唤出无地址栏的纯粹桌面软件界面。
- 命令行手动启动（AMD 780M / ZLUDA）：
  ```powershell
  powershell -File scripts/start_zluda_amd.ps1 -Foreground
  ```

---

## 🤖 大模型 Agent 程序化调用示例

外部智能体可通过 Python SDK 轻松调用任意工作流：

```python
from scripts.comfy_agent_client import ComfyAgentClient

client = ComfyAgentClient("http://127.0.0.1:8284")

# 1. 自动读取 workflows_manifest.json 匹配风格
wf_info = client.get_workflow_info("01")  # 或按标签 "photorealistic"

# 2. 注入提示词并全自动运行（自动解析 node ID 提交至 /prompt 并下载成片）
images = client.run_generation(
    wf_id_or_path="01",
    prompt="masterpiece, best quality, photorealistic portrait, soft volumetric lighting",
    output_dir="./downloads"
)
print(f"生成的成片已下载: {images}")
```

### 🧠 智能意图路由与多维 LoRA 矩阵 (Smart Intent Router)
无需记忆 17 个工作流与数十个 LoRA 编号，SDK 支持自然语言意图理解：自动识别萌宠生物、真人写真、国风水墨或机甲插画，动态选底模、装配对应 LoRA 并注入形态隔离词：

```python
# 零摩擦输入：无论是“皮卡丘在阳光下吃苹果”还是“水墨仙侠山水”
images, decision = client.smart_generate(
    prompt="一只可爱皮卡丘在向日葵花田奔跑",
    output_dir="./downloads"
)
print(f"自动决策命中: {decision['rationale']}")
```

命令行也可以直接调用分析或生成：
```bash
# 语义意图分析（秒级输出装配决策方案，不占用显存）
python scripts/comfy_agent_client.py --analyze "一只可爱皮卡丘在向日葵花田"

# 智能生成
python scripts/comfy_agent_client.py --smart "一只可爱皮卡丘在向日葵花田"
```

### 📦 自动化 LoRA 资产扩充与一键拉取
全量 LoRA 资产分类字典收录于 [`loras_manifest.json`](loras_manifest.json)，支持通过自动化脚本一键下载至 G 盘（已自动跳过已有模型）：
```bash
python scripts/download_loras.py
```

### ⚡ 一键端到端冒烟测试 (Smoke Test)
外部智能体或开发者可随时运行冒烟测试，验证服务可用性、Manifest 索引与成片闭环：
```bash
python scripts/comfy_agent_client.py --test
```

更多关于参数热修改、随机种子注入、队列监听与故障自愈的规范，请直接阅读机器可读文档 [`AGENT_GUIDE.md`](AGENT_GUIDE.md)。

---

## 📚 项目官方知识库 (Wiki & Docs)

本项目配备完整的官方全景知识库与排坑百科，文档收录于 [`wiki/`](wiki/) 与 [`docs/`](docs/) 目录：

| 章节名称 | 文档链接 | 核心内容 |
| :--- | :--- | :--- |
| **知识库首页** | [`wiki/Home.md`](wiki/Home.md) | 官方知识库目录索引与全景架构概览 |
| **极速上手与一键安装** | [`wiki/Quick-Start.md`](wiki/Quick-Start.md) | `install.ps1` / `install.bat` 单脚本安装流水线与高级参数 |
| **17 套双轨工作流图谱** | [`wiki/Workflow-Catalog.md`](wiki/Workflow-Catalog.md) | 17 套工业级工作流矩阵、节点速查与双轨拓扑架构 |
| **多维 LoRA 资产矩阵** | [`wiki/LoRA-Asset-Matrix.md`](wiki/LoRA-Asset-Matrix.md) | 5 大主分类、19 款高分 LoRA 清单、触发词与自动拉取 |
| **智能意图路由器规范** | [`wiki/Smart-Intent-Router.md`](wiki/Smart-Intent-Router.md) | 自然语言意图解析、动态底模/LoRA装配与形态隔离防畸变机制 |
| **AMD 780M 硬件调优** | [`wiki/Hardware-Tuning-AMD-780M.md`](wiki/Hardware-Tuning-AMD-780M.md) | ZLUDA / ROCm 5.7 踩坑实录、LayerNorm 崩溃自愈与显存防爆 |
| **Agent SDK 调度契约** | [`wiki/Agent-SDK-Guide.md`](wiki/Agent-SDK-Guide.md) | Python SDK 范式、自动化冒烟测试套件与 REST API 字典 |
| **高频排坑手册 (FAQ)** | [`wiki/Troubleshooting-FAQ.md`](wiki/Troubleshooting-FAQ.md) | WinError 10054、休眠时间膨胀、损坏伪图片排查自愈 |

---

## 📂 仓库目录结构

```text
comfyui-agent-workflows/
├── README.md                          # 🌟 项目主说明文档与总览导航
├── install.ps1                        # 🚀 全平台一键安装、升级与复刻主脚本 (Master Installer)
├── install.bat                        # 🖱️ Windows 桌面用户双击一键安装批处理
├── AGENT_GUIDE.md                     # 🤖 大模型智能体专属自动化调度契约 (Machine-Readable)
├── workflows_manifest.json            # 📋 17套工作流全局元数据索引字典 (零硬编码调度)
├── loras_manifest.json                # 📦 19款精选LoRA多维分类字典与触发规则
├── LICENSE                            # MIT 开源许可证
├── wiki/                              # 📚 官方全景知识库与排坑百科
│   ├── Home.md                        # Wiki 知识库主页
│   ├── Quick-Start.md                 # 极速上手与安装指南
│   ├── Workflow-Catalog.md            # 17 套工作流全景图谱
│   ├── LoRA-Asset-Matrix.md           # 5 大分类 19 款 LoRA 资产图谱
│   ├── Smart-Intent-Router.md         # 智能意图路由器规范与防畸变阻断
│   ├── Hardware-Tuning-AMD-780M.md    # AMD 780M / ZLUDA 硬件级调优
│   ├── Agent-SDK-Guide.md             # Agent 调度与 Python SDK 指南
│   └── Troubleshooting-FAQ.md         # 常见问题与故障自愈手册
├── workflows_api/                     # ⚡ 17 套纯 API 执行图 JSON (可直接 POST 到 /prompt)
├── workflows/                         # 17 套 UI 可视化工程 JSON (含坐标与连线)
├── custom_nodes/                      # 配套自定义扩展 (含 Gacha Randomizer 动态词池)
│   └── ComfyUI-NSFW-Interrogator/
├── patches/                           # 专版稳定性补丁 (LayerNorm 防崩溃 / safe_globals)
├── docs/                              # 部署与硬件配置补充文档
└── scripts/
    ├── comfy_agent_client.py          # 强化版 Agent 调度 SDK (含 --smart 意图路由与冒烟测试)
    ├── download_loras.py              # 19 款 LoRA 流式断点续传一键同步下载器
    ├── sync_wiki.py                   # GitHub Wiki 官方仓库一键推送同步工具
    ├── ui_to_api_prompt.py            # 离线/在线 UI 工作流转 API 执行图转换器
    ├── setup_edition.ps1              # 专版部署与同步执行引擎
    ├── download_models.ps1            # 核心底模一键下载器
    ├── start_zluda_amd.ps1            # AMD 780M / ZLUDA Windows 静默无窗口启动脚本
    └── start_nvidia.bat               # NVIDIA CUDA 通用启动批处理
```

---

## 📄 开源许可证 (License)

本项目采用 [MIT 许可证](LICENSE)。
欢迎各类开源 Agent 框架（Antigravity, OpenCode, AutoGPT, MetaGPT）与生图爱好者自由集成、二次分发与拓展！
