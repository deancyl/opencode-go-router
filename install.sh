#!/usr/bin/env bash
# OpenCode Go Router - Linux / NAS 通用一键安装入口
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
if [[ -f "$DIR/setup-linux.sh" ]]; then
  exec "$DIR/setup-linux.sh" "$@"
else
  # 支持通过 curl https://.../install.sh | bash 直接拉取安装
  TARGET_DIR="$HOME/.opencode-go-router"
  if [[ ! -f "$TARGET_DIR/setup-linux.sh" ]]; then
    mkdir -p "$TARGET_DIR"
    if command -v git >/dev/null 2>&1; then
      git clone https://github.com/deancyl/opencode-go-router.git "$TARGET_DIR"
    elif command -v curl >/dev/null 2>&1; then
      curl -sSL https://github.com/deancyl/opencode-go-router/archive/refs/heads/master.tar.gz | tar -xz --strip-components=1 -C "$TARGET_DIR"
    elif command -v wget >/dev/null 2>&1; then
      wget -qO- https://github.com/deancyl/opencode-go-router/archive/refs/heads/master.tar.gz | tar -xz --strip-components=1 -C "$TARGET_DIR"
    fi
  fi
  exec "$TARGET_DIR/setup-linux.sh" "$@"
fi
