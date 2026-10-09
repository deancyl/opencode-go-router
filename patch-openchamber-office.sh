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

# 4. 挂载 Hook 到 FilesView JS
if ! grep -q "OpenChamberOfficeViewer" "$FILES_VIEW_JS"; then
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      const targetFile = process.argv[1];
      let content = fs.readFileSync(targetFile, "utf8");
      const hook = "if(window.OpenChamberOfficeViewer&&window.OpenChamberOfficeViewer.isOfficeFile(r.path||r.name)){return s.jsx(\"div\",{className:\"h-full w-full min-h-0\",ref:node=>{if(node&&!node.dataset.mounted){node.dataset.mounted=\"true\";window.OpenChamberOfficeViewer.mount(node,r)}}});}";
      if (content.includes("Zd=r=>{")) {
        content = content.replace("Zd=r=>{", "Zd=r=>{" + hook);
        fs.writeFileSync(targetFile, content, "utf8");
        console.log("  ✔ 已在 FilesView 视图分发层挂载全能 Office 渲染拦截器 (特征模式: Zd=r=>{)！");
      } else {
        const match = content.match(/([A-Za-z0-9_$]+)=r=>\{(?:(?!function|[A-Za-z0-9_$]+=r=>).)*?filesView\.artifact\.binary/);
        if (match) {
          const comp = match[1];
          content = content.replace(comp + "=r=>{", comp + "=r=>{" + hook);
          fs.writeFileSync(targetFile, content, "utf8");
          console.log("  ✔ 已在 FilesView 视图分发层挂载全能 Office 渲染拦截器 (特征模式: " + comp + "=r=>{)！");
        } else {
          console.error("  ❌ 未能在 FilesView 中匹配到视图组件特征！");
          process.exit(1);
        }
      }
    ' "$FILES_VIEW_JS"
  else
    HOOK='if(window.OpenChamberOfficeViewer\&\&window.OpenChamberOfficeViewer.isOfficeFile(r.path\|\|r.name)){return s.jsx("div",{className:"h-full w-full min-h-0",ref:node=>{if(node\&\&!node.dataset.mounted){node.dataset.mounted="true";window.OpenChamberOfficeViewer.mount(node,r)}}});}'
    sed -i "s|Zd=r=>{|Zd=r=>{$HOOK|g" "$FILES_VIEW_JS"
    echo "  ✔ 已在 FilesView 视图分发层挂载全能 Office 渲染拦截器！"
  fi
fi

echo "=========================================================="
echo " 🎉 OpenChamber 全能 Office 离线预览引擎挂载成功！"
echo "  - 支持格式: Word (.docx, .doc), Excel (.xlsx, .xls, .csv), PPT (.pptx, .ppt)"
echo "  - 100% 纯本地离线解析，零外网数据泄漏风险"
echo "=========================================================="
