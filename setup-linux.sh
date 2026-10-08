#!/usr/bin/env bash
# ==============================================================================
# OpenCode Go Router - Linux & NAS 一键部署与全栈生态绑定向导
# 支持系统: Debian, Ubuntu, fnOS(飞牛), 群晖(DSM), TrueNAS, Unraid, CentOS, Alpine
# 支持特性: 多订阅高可用路由 (4010) + Web 控制中心 + systemd/nohup 后台守护 +
#          OpenCode v2 + OpenChamber + OMO + Goal 目标推进全链路无缝结合
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}${BOLD}"
echo "================================================================================"
echo "    🚀 OpenCode Go Router - Linux / NAS 高可用智能网关与全栈配置套件"
echo "================================================================================"
echo -e "${NC}"

# 默认配置
DEFAULT_PORT=4010
DEFAULT_HOST="0.0.0.0" # Linux/NAS 下默认 0.0.0.0 便于局域网网页访问
CONFIG_FILE="$SCRIPT_DIR/config.json"
PID_FILE="$SCRIPT_DIR/.router.pid"
LOG_FILE="$SCRIPT_DIR/router.log"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SERVICE_NAME="opencode-router.service"

# 参数解析
OPT_ALL=false
OPT_BIND=false
OPT_DOCTOR=false
OPT_START=false
OPT_STOP=false
OPT_STATUS=false
OPT_RESTART=false
ARG_HOST=""
ARG_PORT=""
ARG_KEY1=""
ARG_KEY2=""
ARG_PASSWORD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--all) OPT_ALL=true; shift ;;
    -b|--bind) OPT_BIND=true; shift ;;
    -d|--doctor) OPT_DOCTOR=true; shift ;;
    --start) OPT_START=true; shift ;;
    --stop) OPT_STOP=true; shift ;;
    --status) OPT_STATUS=true; shift ;;
    --restart) OPT_RESTART=true; shift ;;
    --host) ARG_HOST="$2"; shift 2 ;;
    --port) ARG_PORT="$2"; shift 2 ;;
    --key1) ARG_KEY1="$2"; shift 2 ;;
    --key2) ARG_KEY2="$2"; shift 2 ;;
    --password) ARG_PASSWORD="$2"; shift 2 ;;
    -h|--help)
      echo "用法: ./setup-linux.sh [选项]"
      echo "选项:"
      echo "  -a, --all        全自动非交互式部署 (安装守护进程、配置、绑定 OpenCode 与 OpenChamber)"
      echo "  -b, --bind       单独执行 OpenCode + OpenChamber + OMO + Goal 客户端绑定"
      echo "  -d, --doctor     运行全链路系统体检与自动修复"
      echo "  --start          启动网关服务"
      echo "  --stop           停止网关服务"
      echo "  --restart        重启网关服务"
      echo "  --status         查看网关运行状态"
      echo "  --host <ip>      设置网关监听 IP (默认 0.0.0.0)"
      echo "  --port <port>    设置网关端口 (默认 4010)"
      echo "  --key1 <key>     设置第 1 个 OpenCode Go 密钥"
      echo "  --key2 <key>     设置第 2 个 OpenCode Go 密钥"
      echo "  --password <pwd> 设置 Web 控制台访问安全密码"
      exit 0
      ;;
    *) shift ;;
  esac
done

# 探测本地局域网 IP
get_lan_ip() {
  local ip
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  if [[ -z "$ip" ]]; then
    ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}')
  fi
  if [[ -z "$ip" ]]; then
    ip="127.0.0.1"
  fi
  echo "$ip"
}

LAN_IP=$(get_lan_ip)

# 1. 检查 Node.js 环境
check_node_env() {
  echo -e "${YELLOW}🔍 正在检查 Node.js 运行环境...${NC}"
  if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}❌ 未检测到 Node.js，智能网关需要 Node.js v18+ 支持！${NC}"
    echo -e "${YELLOW}请根据当前操作系统快速安装：${NC}"
    echo "  - Debian / Ubuntu:  sudo apt-get update && sudo apt-get install -y nodejs npm"
    echo "  - Alpine Linux:     sudo apk add nodejs npm"
    echo "  - CentOS / RHEL:    sudo dnf install -y nodejs npm"
    echo "  - 或安装 nvm / fnm:  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    exit 1
  fi

  NODE_VER=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [[ "$NODE_MAJOR" -lt 18 ]]; then
    echo -e "${RED}❌ 当前 Node.js 版本 (v$NODE_VER) 过低，需要 v18.0.0 或更高版本。${NC}"
    exit 1
  fi
  echo -e "${GREEN}✔ Node.js 环境正常: v$NODE_VER ($(which node))${NC}"
}

# 2. 检查或生成 config.json
setup_config() {
  echo -e "\n${YELLOW}⚙️  正在初始化或核验配置文件...${NC}"
  local host="${ARG_HOST:-$DEFAULT_HOST}"
  local port="${ARG_PORT:-$DEFAULT_PORT}"
  local password="${ARG_PASSWORD:-}"

  node -e "
    const fs = require('fs');
    const path = require('path');
    const cfgPath = '$CONFIG_FILE';
    let cfg = {
      port: $port,
      host: '$host',
      upstream: 'https://opencode.ai/zen/go/v1',
      defaultCooldownMs: 60000,
      maxFailoverRetries: 2,
      sessionAffinityEnabled: true,
      uiPassword: '$password',
      accounts: [
        { id: 'account-1', name: 'OpenCode Go 主账号', apiKey: '', enabled: true },
        { id: 'account-2', name: 'OpenCode Go 备用账号', apiKey: '', enabled: true }
      ]
    };
    if (fs.existsSync(cfgPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        cfg = Object.assign({}, cfg, existing);
        if ('$ARG_HOST') cfg.host = '$ARG_HOST';
        if ('$ARG_PORT') cfg.port = parseInt('$ARG_PORT', 10);
        if ('$ARG_PASSWORD') cfg.uiPassword = '$ARG_PASSWORD';
      } catch (e) {}
    }
    if ('$ARG_KEY1') cfg.accounts[0].apiKey = '$ARG_KEY1';
    if ('$ARG_KEY2' && cfg.accounts[1]) cfg.accounts[1].apiKey = '$ARG_KEY2';

    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    console.log('✔ 配置文件已就绪:', cfgPath);
  "
}

# 3. 检查 systemd 支持情况
has_systemd_user() {
  if command -v systemctl >/dev/null 2>&1 && systemctl --user list-units >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# 4. 配置 systemd 用户服务
install_systemd_service() {
  echo -e "\n${YELLOW}📦 正在配置 systemd 用户守护服务...${NC}"
  mkdir -p "$SYSTEMD_USER_DIR"
  local service_file="$SYSTEMD_USER_DIR/$SERVICE_NAME"
  local node_bin
  node_bin=$(which node)

  cat > "$service_file" <<EOF
[Unit]
Description=OpenCode Go Smart Router Gateway (Port 4010)
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory=$SCRIPT_DIR
Environment="NODE_ENV=production"
Environment="PATH=$HOME/.local/bin:$HOME/.opencode/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=$node_bin server.js
Restart=always
RestartSec=3s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl --user restart "$SERVICE_NAME"
  
  # 开启持久化驻留 (Linger)，使用户注销后守护进程仍可常驻
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$USER" 2>/dev/null || true
  fi

  echo -e "${GREEN}✔ systemd 用户服务已注册并启动: $SERVICE_NAME${NC}"
}

# 5. 回退 nohup 后台启动
start_nohup_daemon() {
  echo -e "\n${YELLOW}🚀 正在使用后台守护模式启动智能网关...${NC}"
  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
      echo -e "${YELLOW}网关进程已在运行 (PID: $old_pid)${NC}"
      return 0
    fi
  fi

  nohup node server.js >> "$LOG_FILE" 2>&1 &
  local new_pid=$!
  echo "$new_pid" > "$PID_FILE"
  sleep 1
  if kill -0 "$new_pid" 2>/dev/null; then
    echo -e "${GREEN}✔ 网关后台进程已启动 (PID: $new_pid)，日志输出至: $LOG_FILE${NC}"
  else
    echo -e "${RED}❌ 启动失败，请查看日志: $LOG_FILE${NC}"
    exit 1
  fi
}

# 6. 统一启动函数
service_start() {
  if has_systemd_user; then
    systemctl --user restart "$SERVICE_NAME" 2>/dev/null || install_systemd_service
  else
    start_nohup_daemon
  fi
  sleep 1
  verify_health
}

# 7. 统一停止函数
service_stop() {
  echo -e "${YELLOW}正在停止 OpenCode 智能网关服务...${NC}"
  if has_systemd_user; then
    systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
  fi
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
      rm -f "$PID_FILE"
    fi
  fi
  # 检查端口并杀死残留
  fuser -k 4010/tcp 2>/dev/null || true
  echo -e "${GREEN}✔ 网关服务已停止${NC}"
}

# 8. 统一状态函数
service_status() {
  echo -e "${CYAN}=== OpenCode 智能路由网关运行状态 ===${NC}"
  if has_systemd_user; then
    systemctl --user status "$SERVICE_NAME" --no-pager || true
  elif [[ -f "$PID_FILE" ]]; then
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo -e "${GREEN}✔ 独立守护进程运行中 (PID: $pid)${NC}"
    else
      echo -e "${RED}❌ 守护进程未运行${NC}"
    fi
  fi

  echo -e "\n${YELLOW}正在向本地端点发起健康探测...${NC}"
  if curl -s -f http://127.0.0.1:4010/health >/dev/null 2>&1; then
    local h
    h=$(curl -s http://127.0.0.1:4010/health)
    echo -e "${GREEN}✔ 网关健康检查通过: $h${NC}"
    echo -e "${CYAN}💡 网页控制面板访问地址: http://${LAN_IP}:4010/balancer/ui${NC}"
  else
    echo -e "${RED}❌ 本地 4010 端口未响应${NC}"
  fi
}

# 9. 验证端点健康
verify_health() {
  local max_retries=5
  local count=0
  echo -e "${YELLOW}正在等待网关服务就绪...${NC}"
  while [[ $count -lt $max_retries ]]; do
    if curl -s -f http://127.0.0.1:4010/health >/dev/null 2>&1; then
      local h
      h=$(curl -s http://127.0.0.1:4010/health)
      echo -e "${GREEN}🎉 智能网关服务已成功启动！${NC}"
      echo -e "   - 本地端点:   ${BOLD}http://127.0.0.1:4010/v1${NC}"
      echo -e "   - 局域网管理: ${BOLD}http://${LAN_IP}:4010/balancer/ui${NC}"
      echo -e "   - 健康状态:   $h"
      return 0
    fi
    sleep 1
    count=$((count + 1))
  done
  echo -e "${YELLOW}⚠ 网关已启动，等待完全监听中。可运行 ./setup-linux.sh --status 查看详情。${NC}"
}

# 10. 绑定 OpenCode, OpenChamber, OMO, Goal
bind_ecosystem() {
  echo -e "\n${YELLOW}🔗 正在一键绑定 OpenCode、OpenChamber、OMO 与 Goal...${NC}"
  node -e "
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const homeDir = os.homedir();
    const routerUrl = 'http://127.0.0.1:4010/v1';

    // 1. OpenCode (~/.config/opencode/opencode.jsonc)
    const ocDir = path.join(homeDir, '.config', 'opencode');
    if (!fs.existsSync(ocDir)) fs.mkdirSync(ocDir, { recursive: true });
    const ocPath = path.join(ocDir, 'opencode.jsonc');
    let ocData = {};
    if (fs.existsSync(ocPath)) {
      try { ocData = JSON.parse(fs.readFileSync(ocPath, 'utf8')); } catch (e) {}
    }
    if (!ocData.providers) ocData.providers = {};
    if (!ocData.provider) ocData.provider = {};

    const stdModels = {
      'deepseek-v4.1-flash': { modelID: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash' },
      'deepseek-v4-pro': { modelID: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
      'kimi-k3': { modelID: 'kimi-k3', name: 'kimi-k3' },
      'qwen3.7-plus': { modelID: 'qwen3.7-plus', name: 'qwen3.7-plus' },
      'glm-5.3': { modelID: 'glm-5.3', name: 'glm-5.3' },
      'minimax-m3': { modelID: 'minimax-m3', name: 'minimax-m3' }
    };

    ocData.providers['opencode-go'] = {
      name: 'opencode-go',
      package: 'aisdk:@ai-sdk/openai-compatible',
      settings: { baseURL: routerUrl },
      models: stdModels
    };

    ocData.provider['opencode-go'] = {
      name: 'opencode-go',
      npm: '@ai-sdk/openai-compatible',
      options: { baseURL: routerUrl, apiKey: 'local-router' },
      models: {
        'deepseek-v4.1-flash': { name: 'deepseek-v4.1-flash' },
        'deepseek-v4-pro': { name: 'deepseek-v4-pro' },
        'kimi-k3': { name: 'kimi-k3' },
        'qwen3.7-plus': { name: 'qwen3.7-plus' },
        'glm-5.3': { name: 'glm-5.3' },
        'minimax-m3': { name: 'minimax-m3' }
      }
    };
    ocData.model = 'opencode-go/deepseek-v4.1-flash';

    fs.writeFileSync(ocPath, JSON.stringify(ocData, null, 2), 'utf8');
    console.log('✔ 已在 opencode.jsonc 注册 opencode-go 提供商，并将默认模型锁定为 opencode-go/deepseek-v4.1-flash');

    // 2. OpenChamber
    const chamberDirs = [];
    if (process.env.OPENCHAMBER_DATA_DIR && fs.existsSync(process.env.OPENCHAMBER_DATA_DIR)) chamberDirs.push(process.env.OPENCHAMBER_DATA_DIR);
    const defaultDataDir = '/vol3/1000/docker/opencode/openchamber/data';
    if (fs.existsSync(defaultDataDir) && !chamberDirs.includes(defaultDataDir)) chamberDirs.push(defaultDataDir);
    const standardChamberDir = path.join(homeDir, '.config', 'openchamber');
    if (!chamberDirs.includes(standardChamberDir)) chamberDirs.push(standardChamberDir);

    for (const cDir of chamberDirs) {
      if (!fs.existsSync(cDir)) try { fs.mkdirSync(cDir, { recursive: true }); } catch (e) {}

      const prefPath = path.join(cDir, 'preferences.json');
      let pref = { version: 1, fields: {} };
      if (fs.existsSync(prefPath)) {
        try { pref = JSON.parse(fs.readFileSync(prefPath, 'utf8')); } catch (e) {}
      }
      if (!pref.fields) pref.fields = {};

      const recents = (pref.fields.recentModels && pref.fields.recentModels.value) || [];
      const filteredRecents = recents.filter(m => !(m.providerID === 'opencode-go' && (m.modelID === 'deepseek-v4.1-flash' || m.modelID === 'kimi-k3')));
      pref.fields.recentModels = {
        updatedAt: Date.now(),
        value: [
          { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' },
          { providerID: 'opencode-go', modelID: 'kimi-k3' },
          ...filteredRecents
        ]
      };

      const favs = (pref.fields.favoriteModels && pref.fields.favoriteModels.value) || [];
      if (!favs.some(m => m.providerID === 'opencode-go' && m.modelID === 'deepseek-v4.1-flash')) {
        favs.unshift({ providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' });
      }
      if (!favs.some(m => m.providerID === 'opencode-go' && m.modelID === 'kimi-k3')) {
        favs.push({ providerID: 'opencode-go', modelID: 'kimi-k3' });
      }
      pref.fields.favoriteModels = { updatedAt: Date.now(), value: favs };
      fs.writeFileSync(prefPath, JSON.stringify(pref, null, 2), 'utf8');

      // settings.json
      const setPath = path.join(cDir, 'settings.json');
      if (fs.existsSync(setPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(setPath, 'utf8'));
          const sRecents = settings.recentModels || [];
          const sFiltered = sRecents.filter(m => !(m.providerID === 'opencode-go' && (m.modelID === 'deepseek-v4.1-flash' || m.modelID === 'kimi-k3')));
          settings.recentModels = [
            { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' },
            { providerID: 'opencode-go', modelID: 'kimi-k3' },
            ...sFiltered
          ];
          const sFavs = settings.favoriteModels || [];
          if (!sFavs.some(m => m.providerID === 'opencode-go' && m.modelID === 'deepseek-v4.1-flash')) {
            sFavs.unshift({ providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' });
          }
          if (!sFavs.some(m => m.providerID === 'opencode-go' && m.modelID === 'kimi-k3')) {
            sFavs.push({ providerID: 'opencode-go', modelID: 'kimi-k3' });
          }
          settings.favoriteModels = sFavs;
          fs.writeFileSync(setPath, JSON.stringify(settings, null, 2), 'utf8');
        } catch (e) {}
      }
      console.log('✔ 已在 OpenChamber (' + cDir + ') 设置常用模型与首选模型为 opencode-go');
    }

    // 3. OMO (~/.omo/omo.jsonc)
    const omoDir = path.join(homeDir, '.omo');
    if (!fs.existsSync(omoDir)) fs.mkdirSync(omoDir, { recursive: true });
    const omoPath = path.join(omoDir, 'omo.jsonc');
    if (!fs.existsSync(omoPath)) {
      const omoTemplate = {
        \"\$schema\": \"https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json\",
        \"[opencode]\": {
          \"agents\": {
            \"sisyphus\": { \"model\": \"opencode-go/kimi-k3\" },
            \"oracle\": { \"model\": \"opencode-go/glm-5.3\" },
            \"librarian\": { \"model\": \"opencode-go/qwen3.7-plus\", \"fallback_models\": [{ \"model\": \"opencode-go/minimax-m3\" }] },
            \"explore\": { \"model\": \"opencode-go/qwen3.7-plus\", \"fallback_models\": [{ \"model\": \"opencode-go/minimax-m3\" }] },
            \"multimodal-looker\": { \"model\": \"opencode-go/kimi-k3\" },
            \"prometheus\": { \"model\": \"opencode-go/kimi-k3\", \"variant\": \"high\" },
            \"metis\": { \"model\": \"opencode-go/kimi-k3\", \"variant\": \"high\" },
            \"momus\": { \"model\": \"opencode-go/glm-5.3\" },
            \"atlas\": { \"model\": \"opencode-go/kimi-k3\", \"fallback_models\": [{ \"model\": \"opencode-go/minimax-m3\" }] },
            \"sisyphus-junior\": { \"model\": \"opencode-go/kimi-k3\", \"fallback_models\": [{ \"model\": \"opencode-go/minimax-m3\" }] }
          },
          \"categories\": {
            \"visual-engineering\": { \"model\": \"opencode-go/kimi-k3\", \"variant\": \"high\" },
            \"ultrabrain\": { \"model\": \"opencode-go/deepseek-v4.1-flash\" },
            \"deep-low\": { \"model\": \"opencode-go/deepseek-v4.1-flash\" },
            \"deep-high\": { \"model\": \"opencode-go/deepseek-v4-pro\" },
            \"artistry\": { \"model\": \"opencode-go/kimi-k3\", \"variant\": \"high\" },
            \"quick\": { \"model\": \"opencode-go/minimax-m3\", \"variant\": \"high\" }
          }
        }
      };
      fs.writeFileSync(omoPath, JSON.stringify(omoTemplate, null, 2), 'utf8');
      console.log('✔ 已生成 ~/.omo/omo.jsonc 核心多智能体调度配置 (默认使用 kimi-k3/qwen3.7 避开区域限制)');
    } else {
      console.log('✔ ~/.omo/omo.jsonc 已存在');
    }

    // 4. Goal boost.md
    const cmdDir = path.join(homeDir, '.config', 'opencode', 'commands');
    if (!fs.existsSync(cmdDir)) fs.mkdirSync(cmdDir, { recursive: true });
    const boostPath = path.join(cmdDir, 'boost.md');
    if (!fs.existsSync(boostPath)) {
      const boostContent = \`---
description: \"极速自主推进增强模式 (Boost / Ultrawork Mode)\"
---
# Boost 极速增强模式指示 (Boost & Ultrawork Orchestration)

立即进入高强度自主推进模式。
推进目标：
\$ARGUMENTS

## 执行规范：
1. **启动全流程推进**：自动激活深层检索、多任务拆解与高效执行链路。
2. **端到端交付**：不半途而废，连续执行直至方案完全实现并完成端到端测试。
3. **保持高可逆性与安全性**：确保关键配置有备份，生产环境安全无损。
\`;
      fs.writeFileSync(boostPath, boostContent, 'utf8');
      console.log('✔ 已生成 /boost 目标自主推进快捷指令模版');
    }
  "

  # 重启运行中的 OpenCode 和 OpenChamber 服务以应用新配置
  if has_systemd_user; then
    echo -e "${YELLOW}正在热重启 OpenCode 与 OpenChamber 服务使配置生效...${NC}"
    systemctl --user restart opencode-server.service 2>/dev/null && echo -e "${GREEN}✔ opencode-server.service 已重启${NC}" || true
    systemctl --user restart openchamber.service 2>/dev/null && echo -e "${GREEN}✔ openchamber.service 已重启${NC}" || true
  fi

  echo -e "${GREEN}🎉 全栈客户端绑定成功！${NC}"
}

# 11. 执行体检与修复
run_doctor() {
  echo -e "\n${YELLOW}🩺 正在运行系统环境诊断与修复引擎...${NC}"
  node -e "
    const http = require('http');
    const req = http.request('http://127.0.0.1:4010/balancer/api/doctor', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const report = JSON.parse(data);
          console.log('✔ 体检结果: 端口 ' + report.router.port + ' 状态正常');
          console.log('  - OpenCode CLI: ' + (report.opencode.installed ? report.opencode.version : '未检测到'));
          console.log('  - 账号数量: ' + report.router.accounts.length);
          if (report.issues.length === 0) {
            console.log('🎉 未发现任何异常！');
          } else {
            console.log('⚠ 发现 ' + report.issues.length + ' 个可优化项目:');
            report.issues.forEach(i => console.log('   [' + i.severity + '] ' + i.title + ': ' + i.desc));
          }
        } catch (e) {
          console.log('响应解析异常:', data);
        }
      });
    });
    req.on('error', (e) => {
      console.log('无法连接网关 API (4010):', e.message);
    });
    req.end();
  "
}

# 执行命令行参数逻辑
if [[ "$OPT_STOP" == true ]]; then
  service_stop
  exit 0
fi

if [[ "$OPT_START" == true ]]; then
  check_node_env
  service_start
  exit 0
fi

if [[ "$OPT_RESTART" == true ]]; then
  check_node_env
  service_stop
  service_start
  exit 0
fi

if [[ "$OPT_STATUS" == true ]]; then
  service_status
  exit 0
fi

if [[ "$OPT_BIND" == true ]]; then
  bind_ecosystem
  exit 0
fi

if [[ "$OPT_DOCTOR" == true ]]; then
  run_doctor
  exit 0
fi

if [[ "$OPT_ALL" == true ]]; then
  check_node_env
  setup_config
  if has_systemd_user; then
    install_systemd_service
  else
    start_nohup_daemon
  fi
  sleep 1
  verify_health
  bind_ecosystem
  echo -e "\n${GREEN}${BOLD}================================================================================${NC}"
  echo -e "${GREEN}${BOLD}🎉 OpenCode Linux/NAS 全栈部署全部完成！${NC}"
  echo -e "  - Web 控制面板:   ${BOLD}http://${LAN_IP}:4010/balancer/ui${NC}"
  echo -e "  - OpenChamber:    ${BOLD}http://${LAN_IP}:3000${NC}"
  echo -e "  - 默认首选模型:   ${BOLD}opencode-go/deepseek-v4.1-flash${NC}"
  echo -e "  - 区域无忧备选:   ${BOLD}opencode-go/kimi-k3${NC}"
  echo -e "${GREEN}${BOLD}================================================================================${NC}\n"
  exit 0
fi

# 交互式菜单模式
interactive_menu() {
  check_node_env
  while true; do
    echo -e "\n${CYAN}================ 请选择操作菜单 ================${NC}"
    echo " [1] 一键全自动全套配置 (推荐: 部署网关+配置守护+绑定客户端)"
    echo " [2] 仅部署/更新 4010 智能网关后台服务"
    echo " [3] 配置双账号密钥与 Web 访问安全密码"
    echo " [4] 一键绑定本地 OpenCode + OpenChamber + OMO + Goal"
    echo " [5] 启动 / 重启网关服务"
    echo " [6] 停止网关服务"
    echo " [7] 查看运行状态与官方配额"
    echo " [8] 运行健康体检 (Doctor) 与自动修复"
    echo " [0] 退出"
    echo -e "${CYAN}================================================${NC}"
    read -rp "请输入数字 [0-8]: " choice

    case "$choice" in
      1)
        setup_config
        if has_systemd_user; then install_systemd_service; else start_nohup_daemon; fi
        verify_health
        bind_ecosystem
        echo -e "${GREEN}✔ 全栈自动配置完毕！${NC}"
        ;;
      2)
        setup_config
        if has_systemd_user; then install_systemd_service; else start_nohup_daemon; fi
        verify_health
        ;;
      3)
        read -rp "请输入主账号 API Key (留空保持原样): " k1
        read -rp "请输入备用账号 API Key (留空保持原样): " k2
        read -rp "请输入 Web 管理员访问密码 (留空无保护): " pwd
        ARG_KEY1="$k1"
        ARG_KEY2="$k2"
        ARG_PASSWORD="$pwd"
        setup_config
        if has_systemd_user; then systemctl --user restart "$SERVICE_NAME"; else service_start; fi
        echo -e "${GREEN}✔ 账号密钥与安全密码已更新！${NC}"
        ;;
      4)
        bind_ecosystem
        ;;
      5)
        service_start
        ;;
      6)
        service_stop
        ;;
      7)
        service_status
        ;;
      8)
        run_doctor
        ;;
      0)
        echo "退出向导。"
        exit 0
        ;;
      *)
        echo -e "${RED}输入无效，请重新选择${NC}"
        ;;
    esac
  done
}

interactive_menu
