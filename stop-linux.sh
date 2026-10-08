#!/usr/bin/env bash
# OpenCode Go Router - Linux / NAS 快捷停止脚本
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$DIR/setup-linux.sh" --stop "$@"
