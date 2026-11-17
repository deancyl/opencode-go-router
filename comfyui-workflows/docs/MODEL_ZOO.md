# 📦 核心模型库与下载索引 (Model Zoo)

本工作流矩阵精选了最成熟、画质上限极高的 SD 1.5 生态权重，所有工作流均严格基于下述模型文件名编写。请将模型文件放置于 ComfyUI 对应的子目录中。

---

## 一、 Checkpoints (大底模)
存放路径：`models/checkpoints/`

| 模型文件名 | 推荐版本 / 类型 | 适用场景 | 建议下载来源 |
| :--- | :--- | :--- | :--- |
| **`anything-v5-PrtRE.safetensors`** | Anything V5 (PrtRE) | 二次元全能、厚涂、日漫光影、设计三视图 (WF05~12, 17) | [HuggingFace](https://huggingface.co/ckpt/anything-v5.0) / Civitai |
| **`realisticVisionV60B1_v51VAE.safetensors`** | Realistic Vision V6.0 B1 | 真人写实、次表面毛孔透析、日常生活街拍 (WF01, 02, 15, 16) | [Civitai](https://civitai.com/models/4201/realistic-vision-v60-b1) / HuggingFace |

---

## 二、 VAE (变分自编码器)
存放路径：`models/vae/`

| 模型文件名 | 说明 | 作用 | 建议下载来源 |
| :--- | :--- | :--- | :--- |
| **`vae-ft-mse-840000-ema-pruned.safetensors`** | StabilityAI 官方高精 MSE VAE | 解决色彩泛灰、暗部噪点，彻底免疫黑图溢出 | [HuggingFace](https://huggingface.co/stabilityai/sd-vae-ft-mse-original) |

---

## 三、 LoRA (低秩微调模型)
存放路径：`models/loras/`

| LoRA 文件名 | 推荐权重 | 适用工作流 | 特性描述 |
| :--- | :---: | :--- | :--- |
| **`more_details.safetensors`** | `0.45 ~ 0.65` | 全通用 (WF01, 06, 07, 09, 10, 11, 15, 16, 17) | 显著强化微观毛孔、服饰刺绣、发丝边缘与眼眸晶莹度 |
| **`KoreanDollLikeness_v15.safetensors`** | `0.65 ~ 0.75` | 真人写实专精 (WF01, 02, 15) | 亚洲清纯女性面部特征与真实皮下红润血色质感 |
| **`ghibli_style_offset.safetensors`** | `0.85` | 吉卜力手绘 (WF05, 06) | 纯正男鹿和雄水彩、白云积云与童话森林质感 |
| **`anime-lora-makoto-shinkai-anime-style.safetensors`** | `0.80` | 新海诚光影日漫 (WF05, 07) | 暮色霞光、地平线星光、彗星尾迹与冷暖光影冲突 |
| **`Ahegao.safetensors`** | `0.85` | 二次元深渊暗黑 (WF05, 08) | 狂气神态、发光紫眸、恶魔小虎牙与暗黑哥特风 |
| **`epi_noiseoffset2.safetensors`** | `0.60` | 电影暗角写实 (WF02) | 增强真实相机的闪光灯高对比度与胶片暗角质感 |
| **`Hyper-SD15-8steps-CFG-lora.safetensors`** | `1.00` | 极速盲盒与侧翼预览 (WF04 及各流 `[MODE:PREVIEW]`) | 字节跳动 8 步蒸馏 LoRA，专用于秒级低成本草图探索 |

---

## 四、 ControlNet (姿态与线稿控制网)
存放路径：`models/controlnet/`

| 模型文件名 | 类型 | 适用工作流 | 说明 |
| :--- | :--- | :--- | :--- |
| **`control_v11p_sd15_openpose_fp16.safetensors`** | OpenPose (骨骼姿态) | WF14 (精准控制流) | 1:1 锁定人物身体躯干、双臂及面部朝向 |
| **`control_v11p_sd15_canny_fp16.safetensors`** | Canny (边缘线稿) | WF14 (精准控制流) | 1:1 约束构图轮廓与机械线条 |

---

## 五、 自定义节点与分词模型 (Custom Nodes & Interrogators)

- **`ComfyUI-NSFW-Interrogator`**：
  - 存放路径：`custom_nodes/ComfyUI-NSFW-Interrogator/`（本仓库已完整附带）
  - 模型缓存：首次运行时会自动从 HuggingFace 下载 WD14 (SmilingWolf v2) ONNX 分词器及标签库至 `models/wd14_tagger/`，实现纯本地离线反推。
