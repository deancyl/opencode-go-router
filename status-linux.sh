#!/usr/bin/env bash
# OpenCode Go Router - Linux / NAS 快捷状态查看脚本
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$DIR/setup-linux.sh" --status "$@"
