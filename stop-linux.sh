#!/bin/sh
# OpenCode Go Router - Linux / NAS 快捷停止脚本 (兼容 POSIX sh / BusyBox ash / bash)
SCRIPT_PATH="$0"
if [ -n "$BASH_SOURCE" ]; then
  SCRIPT_PATH="${BASH_SOURCE[0]}"
fi
DIR="$(cd "$(dirname "$SCRIPT_PATH")" 2>/dev/null && pwd)"

if [ -x "/bin/bash" ]; then
  exec /bin/bash "$DIR/setup-linux.sh" --stop "$@"
elif command -v bash >/dev/null 2>&1; then
  exec bash "$DIR/setup-linux.sh" --stop "$@"
else
  exec sh "$DIR/setup-linux.sh" --stop "$@"
fi
