import os
import csv
import random
import numpy as np
from PIL import Image

try:
    import onnxruntime as ort
except ImportError:
    ort = None

try:
    import folder_paths
except ImportError:
    folder_paths = None

_SESSION_CACHE = {}
_TAGS_CACHE = {}

# Comprehensive Chinese Danbooru / NSFW Translation Dictionary
TAG_CN_DICT = {
    # Nudity & Coverage
    "nude": "裸体 (全裸)",
    "completely_nude": "完全裸露",
    "topless": "无上装 (袒胸)",
    "bottomless": "无下装 (袒露下体)",
    "partially_unbuttoned": "解开部分纽扣",
    "undressing": "脱衣中",
    "clothes_lift": "掀起衣物",
    "shirt_lift": "掀起衬衫",
    "dress_lift": "撩起裙子",
    "skirt_lift": "掀起短裙",
    "panties_aside": "内裤拨向一侧",
    "see-through": "半透明薄纱透视",
    "translucent": "半透明材质",
    "wet_clothes": "湿透贴身衣物",
    "exposed_breasts": "袒露胸部",
    "uncovered": "未遮盖",
    
    # Anatomy & Breasts
    "breasts": "胸部 / 乳房",
    "large_breasts": "丰满胸部",
    "medium_breasts": "匀称胸部",
    "small_breasts": "小巧胸部",
    "huge_breasts": "巨乳",
    "nipples": "乳头",
    "puffy_nipples": "微肿敏感乳头",
    "areolae": "乳晕",
    "cleavage": "乳沟",
    "sideboob": "侧乳",
    "underboob": "南半球 (下乳)",
    "collarbone": "性感锁骨",
    "bare_shoulders": "露肩",
    "navel": "肚脐",
    "stomach": "腹部 / 小腹",
    "abs": "微腹肌线条",
    "thighs": "大腿",
    "thick_thighs": "丰满大腿",
    "bare_legs": "光洁双腿",
    "butt": "臀部 / 翘臀",
    "ass": "臀部",
    "bare_butt": "裸露臀部",
    "pussy": "私密处 (阴户)",
    "clitoris": "阴蒂",
    "anus": "肛门",
    "crotch": "裆部",
    "pubic_hair": "阴毛",
    "female_pubic_hair": "女性阴毛",
    "shaved": "白虎 (光滑无毛)",
    "cameltoe": "骆驼趾 (勒痕)",
    "spread_legs": "张开双腿",
    "kneeling": "跪姿",
    "all_fours": "四肢着地 (趴姿)",
    "arched_back": "背部弓起",
    "bent_over": "俯身弯腰",
    "lying": "躺卧姿态",
    "on_back": "仰卧",
    "on_stomach": "俯卧趴卧",
    "looking_back": "回头顾盼",
    "presenting": "展示姿态",
    "cowgirl_position": "骑乘位",
    "breasts_apart": "双乳分开",
    "arm_support": "手臂支撑",
    "sitting": "坐姿",
    
    # Lingerie & Fetish
    "underwear": "内衣",
    "lingerie": "性感内衣 / 蕾丝吊带",
    "panties": "内裤",
    "lace_panties": "蕾丝内裤",
    "thong": "丁字裤",
    "g-string": "T字裤 / 细绳丁字裤",
    "bra": "文胸 / 胸罩",
    "strapless_bra": "无肩带文胸",
    "corset": "紧身胸衣 / 束腰",
    "garter_straps": "吊袜带",
    "thighhighs": "过膝长袜",
    "black_thighhighs": "黑色过膝袜",
    "stockings": "丝袜",
    "fishnet_stockings": "渔网袜",
    "pantyhose": "连裤袜",
    "torn_clothes": "破损撕裂衣物",
    "bondage": "束缚 / 捆绑",
    "rope": "绳索",
    "tentacles": "触手纠缠",
    "collar": "项圈",
    "shackles": "手铐 / 镣铐",
    
    # Skin & Sensual Fluids
    "sweat": "细密汗珠",
    "sweaty": "香汗淋漓",
    "wet": "湿润",
    "wet_skin": "水光滑亮皮肤",
    "droplets": "水珠滑落",
    "saliva": "唾液 / 牵丝",
    "drooling": "微流涎水",
    "tears": "泪光 / 欢愉之泪",
    "heavy_breathing": "急促粗重呼吸",
    "blush": "面色潮红",
    "flushed": "发情潮红",
    "parted_lips": "微张双唇",
    "lips": "水润唇部",
    "tongue": "伸舌",
    "ahegao": "阿黑颜 (销魂神情)",
    "glazed_eyes": "迷离失神眼眸",
    "pleasure": "愉悦享受表情",
    "surrender": "顺从沉沦",
    
    # Photographic & Lighting Aesthetics
    "subsurface_scattering": "次表面光影透射 (皮肤通透感)",
    "chiaroscuro": "强烈明暗对比 (古典油画光感)",
    "dramatic_lighting": "戏剧性光影",
    "cinematic_lighting": "电影级布光",
    "rim_light": "轮廓边缘金光",
    "backlight": "逆光",
    "sunlight": "自然日光斜射",
    "volumetric_lighting": "丁达尔丁香光束",
    "bokeh": "大光圈背景虚化",
    "depth_of_field": "景深层次",
    "blurry_background": "背景柔和虚化",
    "blurry": "光学浅景深",
    "film_grain": "真实胶片颗粒感",
    "raw_photo": "真实摄影直出",
    "realistic": "真实写实质感",
    "8k_resolution": "8K极致分辨率",
    "masterpiece": "殿堂杰作",
    "best_quality": "顶级画质",
    "ultra_detailed": "极致微观细节",
    "1girl": "单人女性",
    "solo": "独角单人",
    "looking_at_viewer": "凝视镜头",
    "brown_hair": "棕色秀发",
    "brown_eyes": "深邃棕瞳",
    "water": "水面 / 水池波光",
    "tanlines": "性感比基尼晒痕",
    "tan": "小麦色健康肤色",
    "short_hair": "利落短发",
    "long_hair": "飘逸长发"
}


def load_tags(tags_csv_path):
    if tags_csv_path in _TAGS_CACHE:
        return _TAGS_CACHE[tags_csv_path]

    tag_list = []
    with open(tags_csv_path, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            if len(row) >= 3:
                tag_id = int(row[0])
                name = row[1].replace("_", " ")
                category = int(row[2])
                tag_list.append((tag_id, name, category))

    _TAGS_CACHE[tags_csv_path] = tag_list
    return tag_list


def preprocess_image(pil_img, target_size=448):
    w, h = pil_img.size
    scale = target_size / max(w, h)
    nw, nh = int(w * scale), int(h * scale)
    resized = pil_img.resize((nw, nh), Image.BICUBIC)

    canvas = Image.new("RGB", (target_size, target_size), (255, 255, 255))
    paste_x = (target_size - nw) // 2
    paste_y = (target_size - nh) // 2
    canvas.paste(resized, (paste_x, paste_y))

    arr = np.array(canvas, dtype=np.float32)
    bgr_arr = arr[:, :, ::-1]
    return np.expand_dims(bgr_arr, 0)


class NSFW_WD14_Interrogator:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "threshold": ("FLOAT", {"default": 0.35, "min": 0.05, "max": 1.0, "step": 0.05}),
                "character_threshold": ("FLOAT", {"default": 0.75, "min": 0.05, "max": 1.0, "step": 0.05}),
                "exclude_tags": ("STRING", {
                    "multiline": True,
                    "default": "watermark, text, signature, rating:*, source_*, simple background, white background, blurry, bad anatomy, bad hands"
                }),
                "sort_by_confidence": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "florence_caption": ("STRING", {"forceInput": True, "default": ""})
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("tags", "natural_caption", "merged_prompt", "bilingual_table", "rating")
    FUNCTION = "interrogate"
    CATEGORY = "image/interrogation"

    def interrogate(self, image, threshold, character_threshold, exclude_tags, sort_by_confidence, florence_caption=""):
        if ort is None:
            raise RuntimeError("onnxruntime is not installed. Please run `pip install onnxruntime`.")

        model_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "models", "taggers", "wd-v1-4-convnext-tagger-v2")
        model_path = os.path.join(model_dir, "model.onnx")
        csv_path = os.path.join(model_dir, "selected_tags.csv")

        if not os.path.exists(model_path) or not os.path.exists(csv_path):
            raise FileNotFoundError(f"WD14 Tagger model or CSV not found in {model_dir}. Please wait for download to finish.")

        if model_path not in _SESSION_CACHE:
            providers = ["CPUExecutionProvider"]
            _SESSION_CACHE[model_path] = ort.InferenceSession(model_path, providers=providers)
        session = _SESSION_CACHE[model_path]
        tags_info = load_tags(csv_path)

        img_np = (image[0].cpu().numpy() * 255).astype(np.uint8)
        pil_img = Image.fromarray(img_np, mode="RGB")
        input_data = preprocess_image(pil_img, 448)

        input_name = session.get_inputs()[0].name
        output_name = session.get_outputs()[0].name
        probs = session.run([output_name], {input_name: input_data})[0][0]

        exclude_list = [t.strip().lower() for t in exclude_tags.split(",") if t.strip()]

        ratings = {}
        general_tags = []
        character_tags = []

        for idx, (tag_id, name, category) in enumerate(tags_info):
            prob = float(probs[idx])
            name_lower = name.lower()

            if any(name_lower == exc or (exc.endswith("*") and name_lower.startswith(exc[:-1])) for exc in exclude_list):
                continue

            if category == 9:  # Rating
                ratings[name] = prob
            elif category == 4:  # Character
                if prob >= character_threshold:
                    character_tags.append((name, prob))
            elif category == 0:  # General
                if prob >= threshold:
                    general_tags.append((name, prob))

        if sort_by_confidence:
            general_tags.sort(key=lambda x: x[1], reverse=True)
            character_tags.sort(key=lambda x: x[1], reverse=True)

        rating_str = "general"
        if ratings:
            sorted_ratings = sorted(ratings.items(), key=lambda x: x[1], reverse=True)
            rating_str = f"{sorted_ratings[0][0]} ({sorted_ratings[0][1]:.2f})"

        all_tags_list = [t[0] for t in character_tags] + [t[0] for t in general_tags]
        tags_output = ", ".join(all_tags_list)

        body_parts = []
        sensual_features = []
        posture = []
        lighting_env = []

        for t, p in general_tags:
            tl = t.lower()
            if any(k in tl for k in ["nude", "naked", "topless", "bottomless", "panties", "lingerie", "lace"]):
                sensual_features.append(t)
            elif any(k in tl for k in ["breasts", "nipples", "cleavage", "thighs", "collarbone", "butt", "navel", "pussy", "cameltoe"]):
                body_parts.append(t)
            elif any(k in tl for k in ["lying", "sitting", "kneeling", "bent over", "arched back", "all fours", "looking back", "spread legs"]):
                posture.append(t)
            elif any(k in tl for k in ["lighting", "shadow", "chiaroscuro", "backlight", "rim light", "dimly", "sunlight", "bokeh", "sweat", "wet"]):
                lighting_env.append(t)

        natural_parts = []
        if character_tags:
            natural_parts.append(f"A cinematic photograph of {', '.join([c[0] for c in character_tags[:2]])}")
        else:
            natural_parts.append("A close-up artistic photograph capturing an alluring feminine subject")

        if posture:
            natural_parts.append(f"in a graceful {', '.join(posture[:2])} posture")
        if sensual_features or body_parts:
            combined_body = body_parts[:3] + sensual_features[:2]
            natural_parts.append(f"accentuating delicate {', '.join(combined_body)}")
        if lighting_env:
            natural_parts.append(f"bathed in {', '.join(lighting_env[:3])}")

        natural_parts.append("captured with authentic raw skin texture, subtle subsurface scattering, and shallow depth of field.")
        synthesized_caption = " ".join(natural_parts)

        if florence_caption and len(florence_caption.strip()) > 5:
            merged_prompt = f"{florence_caption.strip()}, {tags_output}"
        else:
            merged_prompt = f"{synthesized_caption}, {tags_output}"

        bilingual_lines = [
            f"### 🏷️ 检出标签分析报告 (评级: **{rating_str}**)",
            f"- **总检出标签数**: {len(all_tags_list)} 个",
            "",
            "| 英文标签 (Prompt Tag) | 中文释义 (Chinese Translation) | 置信度 (Score) |",
            "| :--- | :--- | :--- |"
        ]

        for t, p in (character_tags + general_tags):
            key = t.lower().replace(" ", "_")
            cn_trans = TAG_CN_DICT.get(key)
            if not cn_trans:
                for k_dict, v_dict in TAG_CN_DICT.items():
                    if k_dict in key or key in k_dict:
                        cn_trans = v_dict
                        break
            if not cn_trans:
                cn_trans = "—"
            
            bilingual_lines.append(f"| `{t}` | **{cn_trans}** | `{p*100:.1f}%` |")

        bilingual_table = "\n".join(bilingual_lines)

        return (tags_output, synthesized_caption, merged_prompt, bilingual_table, rating_str)


class NSFW_Text_Display:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"forceInput": True}),
            },
            "optional": {
                "save_to_file": ("BOOLEAN", {"default": False}),
                "filename": ("STRING", {"default": "interrogated_prompt.txt"}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "display_text"
    OUTPUT_NODE = True
    CATEGORY = "image/interrogation"

    def display_text(self, text, save_to_file=False, filename="interrogated_prompt.txt"):
        if save_to_file and filename:
            out_dir = folder_paths.get_output_directory() if folder_paths else os.path.abspath(".")
            out_path = os.path.join(out_dir, filename)
            try:
                with open(out_path, "w", encoding="utf-8") as f:
                    f.write(text)
                print(f"[NSFW_Text_Display] Saved text to {out_path}")
            except Exception as e:
                print(f"[NSFW_Text_Display] Error saving file: {e}")

        return {"ui": {"text": [text]}, "result": (text,)}


class Gacha_Prompt_Randomizer:
    SUBJECTS = [
        "sensual feminine silhouette, delicate collarbones, arched back, slender waist, graceful neck",
        "alluring young woman with messy high bun, parted glossy lips, heavy breathing, flushed cheeks",
        "gorgeous pale beauty with soft natural curves, porcelain skin, vulnerable yet confident expression",
        "athletic toned maiden with gentle body curves, defined ribcage, smooth bare shoulders",
        "sultry exotic muse with glazed ecstatic eyes, warm rosy undertones, sensual posture",
        "intimate candid portrait of a woman, head tilted back, natural radiant smile, glistening skin",
        "gothic dark maiden with mysterious intense gaze, porcelain pale skin, captivating posture"
    ]

    ATTIRES = [
        "completely nude, porcelain pale skin with glistening water droplets running down body contours",
        "wearing translucent see-through black lace lingerie, delicate thin straps falling off shoulders",
        "wearing a wet translucent white silk slip clinging tightly to sensual body curves",
        "loosely wrapped in an oversized unbuttoned white linen shirt, slipping to reveal bare shoulder and chest",
        "intricate sheer lace corset with matching stockings, partially undone and alluring",
        "topless, arms lightly covering chest, slender hips accentuated by sheer low-waist lace panties",
        "wet skin, droplets forming trails across bare collarbone and cleavage, delicate sensual sheen"
    ]

    POSES = [
        "lying back on luxurious satin bedsheets, arched spine, head tilted back, breathy expression",
        "kneeling gracefully on a plush velvet rug, looking back over shoulder with alluring gaze",
        "standing against a steamy glass shower wall, one arm raised, water dripping down skin",
        "sitting on the edge of a vintage leather armchair, slender legs crossed, leaning slightly forward",
        "leaning back on elbows on a sun-drenched daybed, natural body curves highlighted by sunlight",
        "on all fours with back gently arched, elegant spinal curve, captivating perspective",
        "candid amateur POV perspective, authentic unposed intimate moment, close-up snapshot"
    ]

    ENVIRONMENTS = [
        "dimly lit private luxury bedroom sanctuary, moody chiaroscuro lighting, deep warm shadows",
        "steamy private marble bathroom, soft golden morning light streaming through sheer curtains",
        "sun-drenched minimalist loft bedroom, warm golden hour sunbeams casting long dramatic shadows",
        "moody gothic ruined chamber, flickering candlelight, atmospheric volumetric dust rays",
        "modern high-rise penthouse suite at night, soft blue city bokeh lights glowing in background",
        "private secluded natural hot spring pool, soft rising mist, moonlit reflections on water surface"
    ]

    LIGHTINGS = [
        "dramatic chiaroscuro lighting, strong golden rim light carving body contours, rich shadow depth",
        "subsurface scattering, delicate reddish light diffusion through earlobes and fingertips, soft illumination",
        "warm sunlight filtering through blinds, artistic striped light patterns across smooth bare skin",
        "soft cinematic candlelit glow, intimate warm atmosphere, realistic skin micro-sheen",
        "shot on Arri Alexa 65, 85mm anamorphic lens f/1.2, authentic film grain, kodak portra 400 tones"
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "theme": (["All Styles (全风格综合混搭)", "Intimate & Sensual (私房纯欲)", "Dark Gothic (暗黑哥特禁忌)", "Candid POV (生活感抓拍)", "Wet & Glistening (湿身水光)"],),
                "nudity_level": (["Random (随机体态)", "Nude & Sensual (全裸曲线)", "Lingerie & Lace (蕾丝性感内衣)", "See-through & Wet (半透湿纱)"],),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            },
            "optional": {
                "custom_extra": ("STRING", {
                    "default": "masterpiece, best quality, ultra-detailed, 8k resolution, raw color photo, authentic skin texture"
                })
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("positive_prompt", "negative_prompt", "card_title")
    FUNCTION = "generate_gacha_prompt"
    CATEGORY = "gacha"

    def generate_gacha_prompt(self, theme, nudity_level, seed, custom_extra=""):
        rng = random.Random(seed if seed != 0 else random.randint(1, 999999999))

        subj = rng.choice(self.SUBJECTS)
        attire = rng.choice(self.ATTIRES)
        pose = rng.choice(self.POSES)
        env = rng.choice(self.ENVIRONMENTS)
        light = rng.choice(self.LIGHTINGS)

        if "Intimate" in theme:
            env = "dimly lit private luxury bedroom sanctuary, soft bedsheets, warm mood"
        elif "Dark Gothic" in theme:
            env = "ruined gothic chamber, moody dark chiaroscuro, mysterious shadows, dark lace"
        elif "Candid POV" in theme:
            pose = "candid amateur POV shot, authentic unposed intimate moment, natural flash photography"
        elif "Wet" in theme:
            attire = "wet skin, glistening water droplets running down body contours, translucent wet sheen"

        if "Nude" in nudity_level:
            attire = "completely nude, porcelain pale skin with glistening water droplets running down body contours"
        elif "Lingerie" in nudity_level:
            attire = "wearing translucent black lace lingerie, delicate thin straps, sheer thighhighs"
        elif "See-through" in nudity_level:
            attire = "wearing a wet translucent see-through white silk slip clinging to skin"

        pos_parts = [
            custom_extra.strip() if custom_extra.strip() else "masterpiece, best quality, ultra-detailed, 8k resolution",
            subj,
            pose,
            attire,
            env,
            light
        ]
        positive_prompt = ", ".join(pos_parts)

        negative_prompt = (
            "lowres, bad anatomy, bad hands, bad feet, missing fingers, extra digits, extra limbs, "
            "fused fingers, deformed, disfigured, malformed limbs, blurry, bad eyes, poorly drawn face, "
            "plastic skin, overly smooth, doll, fake, airbrushed, cartoon, anime, 3d render, cgi, "
            "watermark, text, signature, low quality, normal quality, jpeg artifacts, flat lighting, clothed completely"
        )

        card_title = f"Card #{seed % 10000:04d} - [{theme.split(' ')[0]}]"
        return (positive_prompt, negative_prompt, card_title)


NODE_CLASS_MAPPINGS = {
    "NSFW_WD14_Interrogator": NSFW_WD14_Interrogator,
    "NSFW_Text_Display": NSFW_Text_Display,
    "Gacha_Prompt_Randomizer": Gacha_Prompt_Randomizer
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NSFW_WD14_Interrogator": "🔍 NSFW 精准提示词反推器 (WD14 + 双轨语义重构)",
    "NSFW_Text_Display": "📋 提示词反推展示与导出面板 (NSFW Text Display)",
    "Gacha_Prompt_Randomizer": "🎲 极速抽卡动态提示词随机生成器 (Gacha Randomizer)"
}
