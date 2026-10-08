#!/usr/bin/env bash
# OpenCode Go Router - Linux / NAS 快捷启动脚本
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$DIR/setup-linux.sh" --start "$@"
