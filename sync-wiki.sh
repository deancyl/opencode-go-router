#!/usr/bin/env bash
# OpenCode Go Router - One-Click Sync Docs to GitHub Wiki (Bash)
set -e

REPO_URL="https://github.com/deancyl/opencode-go-router.wiki.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="${SCRIPT_DIR}/docs"
TEMP_DIR="/tmp/opencode-go-router-wiki-sync"

echo "===================================================="
echo "  OpenCode Go Router - GitHub Wiki 一键同步工具     "
echo "===================================================="

if [ ! -d "$DOCS_DIR" ]; then
    echo "错误: 文档目录不存在: $DOCS_DIR"
    exit 1
fi

rm -rf "$TEMP_DIR"
echo "正在拉取 GitHub Wiki 仓库..."
if ! git clone "$REPO_URL" "$TEMP_DIR"; then
    echo "⚠️ 克隆 Wiki 仓库失败。"
    echo "提示: GitHub Wiki 必须在 GitHub Web 界面先创建第一页后才会初始化底层 Git 仓库。"
    echo "请前往: https://github.com/deancyl/opencode-go-router/wiki 点击 'Create the first page'，然后重新执行本脚本。"
    exit 1
fi

echo "正在同步 docs/ 文档至 Wiki..."
cp -rf "$DOCS_DIR"/* "$TEMP_DIR"/

cd "$TEMP_DIR"
git config user.name "deancyl"
git config user.email "deancyl@users.noreply.github.com"
git add -A
if ! git diff-index --quiet HEAD --; then
    git commit -m "docs(wiki): sync latest docs from repository"
    git push origin master
    echo "✔ GitHub Wiki 同步完成！"
else
    echo "✔ GitHub Wiki 内容已是最新，无需更新。"
fi

rm -rf "$TEMP_DIR"
