#!/usr/bin/env bash
# patch-openchamber-office.sh: OpenChamber 办公全格式离线安全预览 Linux / NAS 一键挂载与还原脚本
set -e

ACTION="install"
TARGET_DIR=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -i|--install|install)
      ACTION="install"
      shift
      ;;
    -r|--rollback|rollback)
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_SRC="$SCRIPT_DIR/assets/office-preview-engine.js"
if [[ ! -f "$ENGINE_SRC" ]]; then
  ENGINE_SRC="$SCRIPT_DIR/office-preview-engine.js"
fi

if [[ ! -f "$ENGINE_SRC" ]]; then
  echo "❌ 未在 assets 或根目录下找到 office-preview-engine.js 引擎包！"
  exit 1
fi

# 自动探测 OpenChamber web-dist / dist 目录
CANDIDATES=(
  "$TARGET_DIR"
)

if command -v openchamber >/dev/null 2>&1; then
  OC_BIN="$(which openchamber)"
  if [[ -f "$OC_BIN" ]]; then
    OC_REAL="$(readlink -f "$OC_BIN" 2>/dev/null || echo "$OC_BIN")"
    OC_DIR="$(cd "$(dirname "$OC_REAL")/.." && pwd)/dist"
    if [[ -d "$OC_DIR" ]]; then
      CANDIDATES+=("$OC_DIR")
    fi
  fi
fi

CANDIDATES+=(
  "/vol3/1000/docker/opencode/openchamber/node_modules/@openchamber/web/dist"
  "/vol1/1000/docker/opencode/openchamber/node_modules/@openchamber/web/dist"
  "/vol2/1000/docker/opencode/openchamber/node_modules/@openchamber/web/dist"
  "/vol3/1000/docker/openchamber/web/dist"
  "/vol3/1000/docker/openchamber/dist"
  "/vol1/1000/docker/openchamber/web/dist"
  "/vol1/1000/docker/openchamber/dist"
  "/vol2/1000/docker/openchamber/web/dist"
  "/vol4/1000/docker/openchamber/web/dist"
  "/volume1/docker/openchamber/web/dist"
  "/volume1/docker/openchamber/dist"
  "/volume2/docker/openchamber/web/dist"
  "/mnt/user/appdata/openchamber/web/dist"
  "/var/lib/openchamber/web/dist"
  "/var/lib/openchamber/dist"
  "$HOME/.bun/install/global/node_modules/@openchamber/web/dist"
  "/usr/local/lib/node_modules/@openchamber/web/dist"
  "/usr/lib/node_modules/@openchamber/web/dist"
  "$HOME/.local/share/openchamber/dist"
  "$HOME/.openchamber/web-dist"
)

WEB_DIST=""
for dir in "${CANDIDATES[@]}"; do
  if [[ -n "$dir" && -f "$dir/index.html" ]]; then
    WEB_DIST="$dir"
    break
  fi
done

if [[ -z "$WEB_DIST" ]]; then
  echo "❌ 未能自动探测到 OpenChamber 前端 dist 目录！"
  echo "   请通过 --target /path/to/dist 参数手动指定。"
  exit 1
fi

INDEX_HTML="$WEB_DIST/index.html"
ASSETS_DIR="$WEB_DIST/assets"
TARGET_ENGINE="$ASSETS_DIR/office-preview-engine.js"

# 查找 FilesView 核心 JS 模块
FILES_VIEW_JS=$(find "$ASSETS_DIR" -maxdepth 1 -name "FilesView-*.js" | head -n 1)
if [[ -z "$FILES_VIEW_JS" ]]; then
  FILES_VIEW_JS=$(grep -l "filesView.artifact.binary.descriptionWithType" "$ASSETS_DIR"/*.js 2>/dev/null | head -n 1 || true)
fi

if [[ -z "$FILES_VIEW_JS" ]]; then
  echo "❌ 未能定位到 FilesView 核心视图分发文件！"
  exit 1
fi

BACKUP_INDEX="${INDEX_HTML}.bak"
BACKUP_JS="${FILES_VIEW_JS}.bak"

# 状态检查
if [[ "$ACTION" == "status" ]]; then
  echo "=== OpenChamber Office 预览引擎状态 ==="
  echo "目标目录: $WEB_DIST"
  if grep -q "office-preview-engine.js" "$INDEX_HTML" && grep -q "OpenChamberOfficeViewer" "$FILES_VIEW_JS"; then
    echo "✔ 状态: 已成功挂载 (支持 docx, doc, xlsx, xls, pptx, ppt, csv 纯本地离线预览)"
  else
    echo "ℹ 状态: 未挂载 (处于官方出厂默认状态)"
  fi
  exit 0
fi

# 一键还原
if [[ "$ACTION" == "rollback" ]]; then
  echo "正在执行一键还原与卸载..."
  if [[ -f "$BACKUP_INDEX" ]]; then
    cp -f "$BACKUP_INDEX" "$INDEX_HTML"
    rm -f "$BACKUP_INDEX"
    echo "  ✔ index.html 已恢复"
  fi
  if [[ -f "$BACKUP_JS" ]]; then
    cp -f "$BACKUP_JS" "$FILES_VIEW_JS"
    rm -f "$BACKUP_JS"
    echo "  ✔ $(basename "$FILES_VIEW_JS") 已恢复"
  fi
  if [[ -f "$TARGET_ENGINE" ]]; then
    rm -f "$TARGET_ENGINE"
    echo "  ✔ office-preview-engine.js 已清理"
  fi
  echo "🎉 OpenChamber 前端已成功恢复出厂纯净默认状态！"
  exit 0
fi

# 安装挂载
echo "正在安装全能 Office 离线安全预览引擎..."

# 1. 备份原文件
if [[ ! -f "$BACKUP_INDEX" ]]; then
  cp -f "$INDEX_HTML" "$BACKUP_INDEX"
  echo "  ✔ 已创建备份: index.html.bak"
fi
if [[ ! -f "$BACKUP_JS" ]]; then
  cp -f "$FILES_VIEW_JS" "$BACKUP_JS"
  echo "  ✔ 已创建备份: $(basename "$FILES_VIEW_JS").bak"
fi

# 2. 拷贝引擎
cp -f "$ENGINE_SRC" "$TARGET_ENGINE"
echo "  ✔ 已注入离线引擎: assets/office-preview-engine.js"

# 3. 注入 index.html
if ! grep -q "office-preview-engine.js" "$INDEX_HTML"; then
  SCRIPT_TAG='    <script src="/assets/office-preview-engine.js"></script>\n  </head>'
  sed -i "s|</head>|$SCRIPT_TAG|g" "$INDEX_HTML"
  echo "  ✔ 已在 index.html 中注册全局驱动引擎"
fi

# 4. 挂载 Hook 到 FilesView JS (AST 级别精准定位二进制组件与 JSX 运行时)
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs");
    const targetFile = process.argv[1];
    let content = fs.readFileSync(targetFile, "utf8");

    // 1. 定位 filesView.artifact.binary
    const binaryIdx = content.indexOf("filesView.artifact.binary");
    if (binaryIdx === -1) {
      console.error("  ❌ 未找到 filesView.artifact.binary 特征！");
      process.exit(1);
    }

    // 2. 向前寻找最近的函数定义入口
    const before = content.substring(Math.max(0, binaryIdx - 2000), binaryIdx);
    const matches = [...before.matchAll(/([A-Za-z0-9_$]+)=r=>\{/g)];
    if (!matches.length) {
      console.error("  ❌ 未能精准定位二进制分发组件入口！");
      process.exit(1);
    }
    const compMatch = matches[matches.length - 1];
    const compName = compMatch[1];
    const compPattern = compMatch[0];

    // 3. 探测 JSX 运行时标识
    const compStart = binaryIdx - (before.length - compMatch.index);
    const compBody = content.substring(compStart, binaryIdx + 1500);
    const jsxMatch = compBody.match(/([A-Za-z0-9_$]+)\.(?:jsx|jsxs)\(/);
    const jsxId = jsxMatch ? jsxMatch[1] : "n";

    // 4. 清理旧错位 Hook
    if (content.includes("OpenChamberOfficeViewer")) {
      content = content.replace(/if\(window\.OpenChamberOfficeViewer&&window\.OpenChamberOfficeViewer\.isOfficeFile\(r\.path\|\|r\.name\)\)\{return [^;]+;?\}/g, "");
    }

    // 5. 注入最新 Hook
    const hook = `if(window.OpenChamberOfficeViewer&&window.OpenChamberOfficeViewer.isOfficeFile(r.path||r.name)){return ${jsxId}.jsx("div",{key:r.path||r.name,className:"h-full w-full min-h-0",ref:node=>{if(node&&node.dataset.file!==(r.path||r.name)){node.dataset.file=r.path||r.name;window.OpenChamberOfficeViewer.mount(node,r)}}});}`;
    const targetIdx = content.indexOf(compPattern);
    if (targetIdx !== -1) {
      content = content.substring(0, targetIdx + compPattern.length) + hook + content.substring(targetIdx + compPattern.length);
      fs.writeFileSync(targetFile, content, "utf8");
      console.log(`  ✔ 已精准挂载 Office 渲染拦截器至二进制组件 ${compName} (JSX 标识: ${jsxId})！`);
    } else {
      console.error(`  ❌ 未能在文件中匹配到 ${compPattern} 特征！`);
      process.exit(1);
    }
  ' "$FILES_VIEW_JS"
else
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import sys, re
target_file = sys.argv[1]
with open(target_file, "r", encoding="utf-8") as f:
    content = f.read()
b_idx = content.find("filesView.artifact.binary")
if b_idx != -1:
    search_start = max(0, b_idx - 2000)
    pre = content[search_start:b_idx]
    matches = list(re.finditer(r"([A-Za-z0-9_$]+)=r=>\{", pre))
    if matches:
        comp = matches[-1].group(1)
        pat = f"{comp}=r={{"
        comp_body = content[search_start + matches[-1].start():b_idx + 1500]
        jsx_match = re.search(r"([A-Za-z0-9_$]+)\.(?:jsx|jsxs)\(", comp_body)
        jsx_id = jsx_match.group(1) if jsx_match else "n"
        content = re.sub(r"if\(window\.OpenChamberOfficeViewer&&window\.OpenChamberOfficeViewer\.isOfficeFile\(r\.path\|\|r\.name\)\)\{return [^;]+;?\}", "", content)
        hook = f"if(window.OpenChamberOfficeViewer&&window.OpenChamberOfficeViewer.isOfficeFile(r.path||r.name)){{return {jsx_id}.jsx(\"div\",{{key:r.path||r.name,className:\"h-full w-full min-h-0\",ref:node=>{{if(node&&node.dataset.file!==(r.path||r.name)){{node.dataset.file=r.path||r.name;window.OpenChamberOfficeViewer.mount(node,r)}}}}}});}}"
        idx = content.find(pat)
        if idx != -1:
            content = content[:idx + len(pat)] + hook + content[idx + len(pat):]
            with open(target_file, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"  ✔ [Python] 已精准挂载 Office 渲染拦截器至 {comp} (JSX: {jsx_id})！")
' "$FILES_VIEW_JS"
  fi
fi

echo "=========================================================="
echo " 🎉 OpenChamber 全能 Office 离线预览引擎挂载成功！"
echo "  - 支持格式: Word (.docx, .doc), Excel (.xlsx, .xls, .csv), PPT (.pptx, .ppt)"
echo "  - 100% 纯本地离线解析，零外网数据泄漏风险"
echo "=========================================================="
