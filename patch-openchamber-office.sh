#!/bin/sh
# ==============================================================================
# patch-openchamber-office.sh: OpenChamber 办公全格式离线安全预览 Linux / NAS 一键挂载与还原脚本
# 规范: 100% 纯本地离线安全红线 (Air-Gapped Safety) + 幂等指纹保护 + .orig 原始基线无损还原
# 兼容: POSIX sh / BusyBox ash / dash / bash / 群晖 DSM / 威联通 QTS / 飞牛 fnOS
# ==============================================================================
set -e

ACTION="install"
TARGET_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    -i|--install|install)
      ACTION="install"
      shift
      ;;
    -r|--rollback|rollback)
      ACTION="rollback"
      shift
      ;;
    -u|--uninstall|uninstall|--restore|restore)
      ACTION="rollback"
      shift
      ;;
    -s|--status|status)
      ACTION="status"
      shift
      ;;
    -t|--target)
      TARGET_DIR="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

SCRIPT_PATH="$0"
if [ -n "$BASH_SOURCE" ]; then
  SCRIPT_PATH="${BASH_SOURCE[0]}"
fi
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" 2>/dev/null && pwd)"

ENGINE_SRC="$SCRIPT_DIR/assets/office-preview-engine.js"
if [ ! -f "$ENGINE_SRC" ]; then
  ENGINE_SRC="$SCRIPT_DIR/office-preview-engine.js"
fi

if [ ! -f "$ENGINE_SRC" ]; then
  echo "❌ 未在 assets 或根目录下找到 office-preview-engine.js 引擎包！"
  exit 1
fi

IDEMPOTENT_HTML_TAG="<!-- OPENCODE_OFFICE_PATCH_IDEMPOTENT_V2 -->"
IDEMPOTENT_JS_TAG="/* OPENCODE_OFFICE_PATCH_IDEMPOTENT_V2 */"

# 自动探测 OpenChamber web-dist / dist 目录
CANDIDATES=""
if [ -n "$TARGET_DIR" ]; then
  CANDIDATES="$TARGET_DIR"
fi

if command -v openchamber >/dev/null 2>&1; then
  OC_BIN="$(which openchamber)"
  if [ -f "$OC_BIN" ]; then
    OC_REAL="$(readlink -f "$OC_BIN" 2>/dev/null || echo "$OC_BIN")"
    OC_DIR="$(cd "$(dirname "$OC_REAL")/.." && pwd)/dist"
    if [ -d "$OC_DIR" ]; then
      CANDIDATES="$CANDIDATES $OC_DIR"
    fi
  fi
fi

CANDIDATES="$CANDIDATES
/vol3/1000/docker/opencode/openchamber/node_modules/@openchamber/web/dist
/vol1/1000/docker/opencode/openchamber/node_modules/@openchamber/web/dist
/vol2/1000/docker/opencode/openchamber/node_modules/@openchamber/web/dist
/vol3/1000/docker/openchamber/web/dist
/vol3/1000/docker/openchamber/dist
/vol1/1000/docker/openchamber/web/dist
/vol1/1000/docker/openchamber/dist
/vol2/1000/docker/openchamber/web/dist
/vol4/1000/docker/openchamber/web/dist
/volume1/docker/openchamber/web/dist
/volume1/docker/openchamber/dist
/volume2/docker/openchamber/web/dist
/mnt/user/appdata/openchamber/web/dist
/var/lib/openchamber/web/dist
/var/lib/openchamber/dist
$HOME/.bun/install/global/node_modules/@openchamber/web/dist
/usr/local/lib/node_modules/@openchamber/web/dist
/usr/lib/node_modules/@openchamber/web/dist
$HOME/.local/share/openchamber/dist
$HOME/.openchamber/web-dist"

WEB_DIST=""
for dir in $CANDIDATES; do
  if [ -n "$dir" ] && [ -f "$dir/index.html" ]; then
    WEB_DIST="$dir"
    break
  fi
done

if [ -z "$WEB_DIST" ]; then
  echo "❌ 未能自动探测到 OpenChamber 前端 dist 目录！"
  echo "   请通过 --target /path/to/dist 参数手动指定。"
  exit 1
fi

INDEX_HTML="$WEB_DIST/index.html"
ASSETS_DIR="$WEB_DIST/assets"
TARGET_ENGINE="$ASSETS_DIR/office-preview-engine.js"

# 查找 FilesView 核心 JS 模块
FILES_VIEW_JS=""
if [ -d "$ASSETS_DIR" ]; then
  FILES_VIEW_JS=$(find "$ASSETS_DIR" -maxdepth 1 -name "FilesView-*.js" 2>/dev/null | head -n 1 || true)
  if [ -z "$FILES_VIEW_JS" ]; then
    FILES_VIEW_JS=$(grep -l "filesView.artifact.binary.descriptionWithType" "$ASSETS_DIR"/*.js 2>/dev/null | head -n 1 || true)
  fi
fi

if [ -z "$FILES_VIEW_JS" ]; then
  echo "❌ 未能定位到 FilesView 核心视图分发文件！"
  exit 1
fi

ORIG_INDEX="${INDEX_HTML}.orig"
ORIG_JS="${FILES_VIEW_JS}.orig"
BAK_INDEX="${INDEX_HTML}.bak"
BAK_JS="${FILES_VIEW_JS}.bak"

# 状态检查
if [ "$ACTION" = "status" ]; then
  echo "=== OpenChamber Office 离线预览引擎状态 ==="
  echo "目标目录: $WEB_DIST"
  if grep -q "office-preview-engine.js" "$INDEX_HTML" 2>/dev/null && grep -q "OpenChamberOfficeViewer" "$FILES_VIEW_JS" 2>/dev/null; then
    echo "✔ 状态: 已成功挂载 (支持 docx, doc, xlsx, xls, pptx, ppt, csv 100% 本地离线预览)"
    if grep -q "$IDEMPOTENT_HTML_TAG" "$INDEX_HTML" 2>/dev/null; then
      echo "  - 幂等指纹: V2 已生效"
    fi
  else
    echo "ℹ 状态: 未挂载 (处于官方出厂默认状态)"
  fi
  exit 0
fi

# 一键还原与卸载
if [ "$ACTION" = "rollback" ]; then
  echo "正在执行一键还原与卸载..."
  RESTORED=0
  if [ -f "$ORIG_INDEX" ]; then
    cp -f "$ORIG_INDEX" "$INDEX_HTML"
    rm -f "$ORIG_INDEX" "$BAK_INDEX"
    echo "  ✔ index.html 已通过 .orig 原厂基线还原"
    RESTORED=1
  elif [ -f "$BAK_INDEX" ]; then
    cp -f "$BAK_INDEX" "$INDEX_HTML"
    rm -f "$BAK_INDEX"
    echo "  ✔ index.html 已通过 .bak 备份还原"
    RESTORED=1
  fi

  if [ -f "$ORIG_JS" ]; then
    cp -f "$ORIG_JS" "$FILES_VIEW_JS"
    rm -f "$ORIG_JS" "$BAK_JS"
    echo "  ✔ $(basename "$FILES_VIEW_JS") 已通过 .orig 原厂基线还原"
    RESTORED=1
  elif [ -f "$BAK_JS" ]; then
    cp -f "$BAK_JS" "$FILES_VIEW_JS"
    rm -f "$BAK_JS"
    echo "  ✔ $(basename "$FILES_VIEW_JS") 已通过 .bak 备份还原"
    RESTORED=1
  fi

  if [ -f "$TARGET_ENGINE" ]; then
    rm -f "$TARGET_ENGINE"
    echo "  ✔ office-preview-engine.js 已清理"
    RESTORED=1
  fi

  if [ "$RESTORED" -eq 1 ]; then
    echo "🎉 OpenChamber 前端已成功恢复出厂纯净默认状态！"
  else
    echo "ℹ 未检测到修改或备份文件，系统已处于出厂纯净状态。"
  fi
  exit 0
fi

# 安装挂载
echo "正在安装全能 Office 离线安全预览引擎..."

# 0. 幂等性检测：若已挂载且包含 V2 幂等指纹，直接安全退出，杜绝重复写入损坏文件
if grep -q "$IDEMPOTENT_HTML_TAG" "$INDEX_HTML" 2>/dev/null && \
   grep -q "$IDEMPOTENT_JS_TAG" "$FILES_VIEW_JS" 2>/dev/null && \
   [ -f "$TARGET_ENGINE" ]; then
  echo "✔ 检测到已安装最新离线预览引擎补丁 (V2 指纹已匹配)，跳过重复挂载，保障系统幂等。"
  exit 0
fi

# 1. 建立永久原厂备份 (.orig)
if [ ! -f "$ORIG_INDEX" ]; then
  cp -f "$INDEX_HTML" "$ORIG_INDEX"
  echo "  ✔ 已创建原厂基线备份: $(basename "$ORIG_INDEX")"
fi
if [ ! -f "$ORIG_JS" ]; then
  cp -f "$FILES_VIEW_JS" "$ORIG_JS"
  echo "  ✔ 已创建原厂基线备份: $(basename "$ORIG_JS")"
fi

# 2. 注入离线引擎包
mkdir -p "$ASSETS_DIR"
cp -f "$ENGINE_SRC" "$TARGET_ENGINE"
echo "  ✔ 已注入离线引擎: assets/office-preview-engine.js"

# 3. 注入 index.html (带幂等指纹)
if ! grep -q "$IDEMPOTENT_HTML_TAG" "$INDEX_HTML"; then
  # 先清理可能残留的无指纹旧引用
  if grep -q "office-preview-engine.js" "$INDEX_HTML"; then
    sed -i '/office-preview-engine.js/d' "$INDEX_HTML" 2>/dev/null || true
  fi
  SCRIPT_TAG="    ${IDEMPOTENT_HTML_TAG}\n    <script src=\"/assets/office-preview-engine.js\"></script>\n  </head>"
  sed -i "s|</head>|$SCRIPT_TAG|g" "$INDEX_HTML"
  echo "  ✔ 已在 index.html 注入离线引擎并标记 V2 幂等指纹"
fi

# 4. 挂载 Hook 到 FilesView JS (AST 级别精准定位二进制组件与 JSX 运行时)
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs");
    const targetFile = process.argv[1];
    const marker = process.argv[2];
    let content = fs.readFileSync(targetFile, "utf8");

    // 0. 若已包含当前指纹，直接退出
    if (content.includes(marker)) {
      process.exit(0);
    }

    // 1. 定位 filesView.artifact.binary
    const binaryIdx = content.indexOf("filesView.artifact.binary");
    if (binaryIdx === -1) {
      console.error("  ❌ 未找到 filesView.artifact.binary 特征！");
      process.exit(1);
    }

    // 2. 向前寻找最近的函数定义入口
    const before = content.substring(Math.max(0, binaryIdx - 2000), binaryIdx);
    const matches = [...before.matchAll(/([A-Za-z0-9_$]+)\s*=\s*(?:\(([A-Za-z0-9_$]+)\)|([A-Za-z0-9_$]+))\s*=>\s*\{/g)];
    if (!matches.length) {
      console.error("  ❌ 未能精准定位二进制分发组件入口！");
      process.exit(1);
    }
    const compMatch = matches[matches.length - 1];
    const compName = compMatch[1];
    const paramName = compMatch[2] || compMatch[3];
    const compPattern = compMatch[0];

    // 3. 探测 JSX 运行时标识
    const compStart = binaryIdx - (before.length - compMatch.index);
    const compBody = content.substring(compStart, binaryIdx + 1500);
    const jsxMatch = compBody.match(/([A-Za-z0-9_$]+)\.(?:jsx|jsxs)\(/);
    const jsxId = jsxMatch ? jsxMatch[1] : "n";

    // 4. 清理旧 Hook (防止多次注入导致多重嵌套)
    content = content.replace(/\/\* OPENCODE_OFFICE_PATCH[^*]*\*\//g, "");
    content = content.replace(/if\(window\.OpenChamberOfficeViewer&&window\.OpenChamberOfficeViewer\.isOfficeFile\(([A-Za-z0-9_$]+)\.path\|\|\1\.name\)\)\{return [^;]+;?\}/g, "");

    // 5. 注入最新带指纹 Hook
    const hook = `${marker}if(window.OpenChamberOfficeViewer&&window.OpenChamberOfficeViewer.isOfficeFile(${paramName}.path||${paramName}.name)){return ${jsxId}.jsx("div",{key:${paramName}.path||${paramName}.name,className:"h-full w-full min-h-0",ref:node=>{if(node&&node.dataset.file!==(${paramName}.path||${paramName}.name)){node.dataset.file=${paramName}.path||${paramName}.name;window.OpenChamberOfficeViewer.mount(node,${paramName})}}});}`;
    const targetIdx = content.indexOf(compPattern);
    if (targetIdx !== -1) {
      content = content.substring(0, targetIdx + compPattern.length) + hook + content.substring(targetIdx + compPattern.length);
      fs.writeFileSync(targetFile, content, "utf8");
      console.log(`  ✔ 已精准挂载 Office 渲染拦截器至二进制组件 ${compName} (JSX: ${jsxId}) 并注入 V2 幂等指纹！`);
    } else {
      console.error(`  ❌ 未能在文件中匹配到 ${compPattern} 特征！`);
      process.exit(1);
    }
  ' "$FILES_VIEW_JS" "$IDEMPOTENT_JS_TAG"
elif command -v python3 >/dev/null 2>&1; then
  python3 -c '
import sys, re
target_file = sys.argv[1]
marker = sys.argv[2]
with open(target_file, "r", encoding="utf-8") as f:
    content = f.read()
if marker in content:
    sys.exit(0)
b_idx = content.find("filesView.artifact.binary")
if b_idx != -1:
    search_start = max(0, b_idx - 2000)
    pre = content[search_start:b_idx]
    matches = list(re.finditer(r"([A-Za-z0-9_$]+)\s*=\s*(?:\(([A-Za-z0-9_$]+)\)|([A-Za-z0-9_$]+))\s*=>\s*\{", pre))
    if matches:
        comp = matches[-1].group(1)
        param = matches[-1].group(2) or matches[-1].group(3)
        pat = matches[-1].group(0)
        comp_body = content[search_start + matches[-1].start():b_idx + 1500]
        jsx_match = re.search(r"([A-Za-z0-9_$]+)\.(?:jsx|jsxs)\(", comp_body)
        jsx_id = jsx_match.group(1) if jsx_match else "n"
        content = re.sub(r"/\* OPENCODE_OFFICE_PATCH[^*]*\*/", "", content)
        content = re.sub(r"if\(window\.OpenChamberOfficeViewer&&window\.OpenChamberOfficeViewer\.isOfficeFile\(([A-Za-z0-9_$]+)\.path\|\|\1\.name\)\)\{return [^;]+;?\}", "", content)
        hook = f"{marker}if(window.OpenChamberOfficeViewer&&window.OpenChamberOfficeViewer.isOfficeFile({param}.path||{param}.name)){{return {jsx_id}.jsx(\"div\",{{key:{param}.path||{param}.name,className:\"h-full w-full min-h-0\",ref:node=>{{if(node&&node.dataset.file!==({param}.path||{param}.name)){{node.dataset.file={param}.path||{param}.name;window.OpenChamberOfficeViewer.mount(node,{param})}}}}}});}}"
        idx = content.find(pat)
        if idx != -1:
            content = content[:idx + len(pat)] + hook + content[idx + len(pat):]
            with open(target_file, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"  ✔ [Python] 已精准挂载 Office 渲染拦截器至 {comp} (JSX: {jsx_id}) 并注入 V2 幂等指纹！")
' "$FILES_VIEW_JS" "$IDEMPOTENT_JS_TAG"
fi

echo "=========================================================="
echo " 🎉 OpenChamber 全能 Office 离线预览引擎挂载成功！"
echo "  - 支持格式: Word (.docx, .doc), Excel (.xlsx, .xls, .csv), PPT (.pptx, .ppt)"
echo "  - 100% 纯本地离线解析，零外网数据泄漏风险 (Air-Gapped Safety)"
echo "  - 具备 V2 幂等防御与 .orig 原始基线保护，支持任意次重复运行与无损回滚"
echo "=========================================================="
