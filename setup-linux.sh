#!/usr/bin/env bash
# ==============================================================================
# OpenCode Go Router - Linux & NAS 一键部署与全栈生态绑定向导
# 支持系统: Debian, Ubuntu, fnOS(飞牛), 群晖(DSM), TrueNAS, Unraid, CentOS, Alpine
# 支持特性: 多订阅高可用路由 (4010) + Web 控制中心 + systemd/nohup 后台守护 +
#          OpenCode v2 + OpenChamber + OMO + Goal 目标推进全链路无缝结合
# ==============================================================================

set -e

# 自动定位或拉取仓库目录（支持直接通过 curl | bash 运行）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
if [[ -z "$SCRIPT_DIR" || ! -f "$SCRIPT_DIR/server.js" ]]; then
  TARGET_DIR="$HOME/.opencode-go-router"
  if [[ ! -f "$TARGET_DIR/server.js" ]]; then
    echo -e "\033[1;33m未检测到本地网关代码仓库，正在自动拉取最新版本至 $TARGET_DIR ...\033[0m"
    mkdir -p "$TARGET_DIR"
    if command -v git >/dev/null 2>&1; then
      git clone https://github.com/deancyl/opencode-go-router.git "$TARGET_DIR"
    elif command -v curl >/dev/null 2>&1; then
      curl -sSL https://github.com/deancyl/opencode-go-router/archive/refs/heads/master.tar.gz | tar -xz --strip-components=1 -C "$TARGET_DIR"
    elif command -v wget >/dev/null 2>&1; then
      wget -qO- https://github.com/deancyl/opencode-go-router/archive/refs/heads/master.tar.gz | tar -xz --strip-components=1 -C "$TARGET_DIR"
    else
      echo -e "\033[0;31m❌ 缺少 git / curl / wget，无法自动下载代码库，请先安装 git！\033[0m"
      exit 1
    fi
  fi
  SCRIPT_DIR="$TARGET_DIR"
fi
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
echo -e "${NC}"

if [[ -f "$SCRIPT_DIR/updater.js" ]] && command -v node >/dev/null 2>&1; then
  PLATFORM_DESC=$(node -e "try { const u = require('./updater'); console.log(u.detectPlatformEnvironment().description); } catch (_) { console.log('Linux 环境'); }" 2>/dev/null || echo "Linux 环境")
  echo -e "  💻 检测到运行平台: ${BOLD}${GREEN}${PLATFORM_DESC}${NC}\n"
fi

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
OPT_REPAIR=false
OPT_UPDATE=false
OPT_ROLLBACK=false
ARG_ROLLBACK_ID=""
OPT_START=false
OPT_STOP=false
OPT_STATUS=false
OPT_RESTART=false
ARG_HOST=""
ARG_PORT=""
ARG_KEY1=""
ARG_KEY2=""
ARG_PASSWORD=""
FLAG_PASSWORD_SET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--all) OPT_ALL=true; shift ;;
    -b|--bind) OPT_BIND=true; shift ;;
    -d|--doctor) OPT_DOCTOR=true; shift ;;
    -r|--repair) OPT_REPAIR=true; shift ;;
    -u|--update) OPT_UPDATE=true; shift ;;
    --rollback) OPT_ROLLBACK=true; ARG_ROLLBACK_ID="$2"; shift 2 2>/dev/null || shift ;;
    --start) OPT_START=true; shift ;;
    --stop) OPT_STOP=true; shift ;;
    --status) OPT_STATUS=true; shift ;;
    --restart) OPT_RESTART=true; shift ;;
    --host) ARG_HOST="$2"; shift 2 ;;
    --port) ARG_PORT="$2"; shift 2 ;;
    --key1) ARG_KEY1="$2"; shift 2 ;;
    --key2) ARG_KEY2="$2"; shift 2 ;;
    --password) ARG_PASSWORD="$2"; FLAG_PASSWORD_SET=1; shift 2 ;;
    -h|--help)
      echo "用法: ./setup-linux.sh [选项]"
      echo "选项:"
      echo "  -a, --all        全自动非交互式部署 (安装守护进程、配置、绑定 OpenCode 与 OpenChamber)"
      echo "  -b, --bind       单独执行 OpenCode + OpenChamber + OMO + Goal 客户端绑定"
      echo "  -d, --doctor     运行全链路系统体检"
      echo "  -r, --repair     运行一键自愈修复 (清洗 providers 冲突、补全 38 款模型、挂载 Office 预览)"
      echo "  -u, --update     非交互式一键安全更新全套组件 (自适应平台、灾备快照、热重载守护)"
      echo "  --rollback [id]  非交互式灾备一键秒级回滚 (还原配置与组件版本)"
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

# 动态获取配置中的端口
get_configured_port() {
  if [[ -f "$CONFIG_FILE" ]]; then
    node -e "try { const c = JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')); console.log(c.port || 4010); } catch(e) { console.log(4010); }" 2>/dev/null || echo "$DEFAULT_PORT"
  else
    echo "${ARG_PORT:-$DEFAULT_PORT}"
  fi
}

# 跨平台通用 HTTP 请求工具（优先 curl -> wget -> node 原生）
http_get() {
  local target_url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -s -f "$target_url" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$target_url" 2>/dev/null
  else
    node -e "
      const http = require('http');
      const req = http.get(process.argv[1], (res) => {
        if (res.statusCode < 200 || res.statusCode >= 400) process.exit(1);
        res.pipe(process.stdout);
      });
      req.on('error', () => process.exit(1));
    " "$target_url" 2>/dev/null
  fi
}

# 跨平台端口清理工具（fuser -> lsof -> ss -> netstat）
kill_port() {
  local target_port="${1:-4010}"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${target_port}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -i :"${target_port}" 2>/dev/null | xargs -r kill 2>/dev/null || true
  elif command -v ss >/dev/null 2>&1; then
    local pids
    pids=$(ss -tlpn "sport = :${target_port}" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2)
    for p in $pids; do kill "$p" 2>/dev/null || true; done
  elif command -v netstat >/dev/null 2>&1; then
    local pids
    pids=$(netstat -tlpn 2>/dev/null | grep ":${target_port} " | awk '{print $7}' | cut -d/ -f1)
    for p in $pids; do kill "$p" 2>/dev/null || true; done
  fi
}

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

# 2. 检查或生成 config.json (使用安全环境变量传递参数，杜绝引号/符号崩溃)
setup_config() {
  echo -e "\n${YELLOW}⚙️  正在初始化或核验配置文件...${NC}"
  local host="${ARG_HOST:-$DEFAULT_HOST}"
  local port="${ARG_PORT:-$DEFAULT_PORT}"

  CFG_FILE="$CONFIG_FILE" \
  ARG_H="$host" \
  ARG_P="$port" \
  ARG_PASS="$ARG_PASSWORD" \
  ARG_PASS_SET="$FLAG_PASSWORD_SET" \
  ARG_K1="$ARG_KEY1" \
  ARG_K2="$ARG_KEY2" \
  node -e '
    const fs = require("fs");
    const cfgPath = process.env.CFG_FILE;
    let cfg = {
      port: parseInt(process.env.ARG_P, 10) || 4010,
      host: process.env.ARG_H || "0.0.0.0",
      upstream: "https://opencode.ai/zen/go/v1",
      defaultCooldownMs: 60000,
      maxFailoverRetries: 2,
      sessionAffinityEnabled: true,
      uiPassword: process.env.ARG_PASS || "",
      accounts: [
        { id: "account-1", name: "OpenCode Go 主账号", apiKey: "", enabled: true },
        { id: "account-2", name: "OpenCode Go 备用账号", apiKey: "", enabled: true }
      ]
    };
    if (fs.existsSync(cfgPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        cfg = Object.assign({}, cfg, existing);
        if (process.env.ARG_H) cfg.host = process.env.ARG_H;
        if (process.env.ARG_P) cfg.port = parseInt(process.env.ARG_P, 10);
        if (process.env.ARG_PASS_SET === "1") cfg.uiPassword = process.env.ARG_PASS || "";
      } catch (e) {}
    }
    if (process.env.ARG_K1) cfg.accounts[0].apiKey = process.env.ARG_K1;
    if (process.env.ARG_K2 && cfg.accounts[1]) cfg.accounts[1].apiKey = process.env.ARG_K2;

    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
    console.log("✔ 配置文件已就绪:", cfgPath);
  '
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
    local current_user="${USER:-$(id -un 2>/dev/null || whoami 2>/dev/null)}"
    if [[ -n "$current_user" ]]; then
      loginctl enable-linger "$current_user" 2>/dev/null || true
    fi
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
  local configured_port
  configured_port=$(get_configured_port)

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
  # 跨平台清理端口占用
  kill_port "$configured_port"
  echo -e "${GREEN}✔ 网关服务已停止 (端口: $configured_port)${NC}"
}

# 8. 统一状态函数
service_status() {
  local configured_port
  configured_port=$(get_configured_port)

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
  local h
  h=$(http_get "http://127.0.0.1:${configured_port}/health" || true)
  if [[ -n "$h" ]]; then
    echo -e "${GREEN}✔ 网关健康检查通过: $h${NC}"
    echo -e "${CYAN}💡 网页控制面板访问地址: http://${LAN_IP}:${configured_port}/balancer/ui${NC}"
  else
    echo -e "${RED}❌ 本地 ${configured_port} 端口未响应${NC}"
  fi
}

# 9. 验证端点健康
verify_health() {
  local configured_port
  configured_port=$(get_configured_port)
  local max_retries=5
  local count=0
  echo -e "${YELLOW}正在等待网关服务就绪...${NC}"
  while [[ $count -lt $max_retries ]]; do
    local h
    h=$(http_get "http://127.0.0.1:${configured_port}/health" || true)
    if [[ -n "$h" ]]; then
      echo -e "${GREEN}🎉 智能网关服务已成功启动！${NC}"
      echo -e "   - 本地端点:   ${BOLD}http://127.0.0.1:${configured_port}/v1${NC}"
      echo -e "   - 局域网管理: ${BOLD}http://${LAN_IP}:${configured_port}/balancer/ui${NC}"
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
  local configured_port
  configured_port=$(get_configured_port)

  CFG_PORT="$configured_port" node -e '
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const homeDir = os.homedir();
    const routerPort = process.env.CFG_PORT || 4010;
    const routerUrl = `http://127.0.0.1:${routerPort}/v1`;

    function stripJsonComments(str) {
      if (typeof str !== "string") return "";
      return str.replace(/\\"|"(?:[^"\\]|\\.)*"|(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
    }
    function parseJsonSafe(filePath, defaultVal = {}) {
      try {
        if (!fs.existsSync(filePath)) return defaultVal;
        return JSON.parse(stripJsonComments(fs.readFileSync(filePath, "utf8")));
      } catch (e) {
        return defaultVal;
      }
    }

    // 1. OpenCode (~/.config/opencode/opencode.jsonc)
    const ocDir = path.join(homeDir, ".config", "opencode");
    if (!fs.existsSync(ocDir)) fs.mkdirSync(ocDir, { recursive: true });
    const ocPath = path.join(ocDir, "opencode.jsonc");
    try {
      const updater = require("./updater");
      const harmRes = updater.harmonizeOpencodeConfig(ocPath, routerPort);
      console.log(`✔ 已完成 opencode.jsonc 规范化 (清除 providers 冲突，合流第三方提供商，覆盖 38 款全量模型，保留首选: ${harmRes.currentModel})`);
    } catch (_) {
      let ocData = parseJsonSafe(ocPath, {});
      if (!ocData.provider) ocData.provider = {};
      if (ocData.providers && typeof ocData.providers === "object") {
        for (const [k, v] of Object.entries(ocData.providers)) {
          if (k !== "opencode-go" && !ocData.provider[k]) ocData.provider[k] = v;
        }
        delete ocData.providers;
      }
      ocData.provider["opencode-go"] = {
        name: "opencode-go",
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: routerUrl, apiKey: "local-router" },
        models: { "deepseek-v4.1-flash": { name: "deepseek-v4.1-flash" }, "glm-5.3-flash": { name: "glm-5.3-flash" } }
      };
      if (!ocData.model) ocData.model = "opencode-go/deepseek-v4.1-flash";
      fs.writeFileSync(ocPath, JSON.stringify(ocData, null, 2), "utf8");
      console.log("✔ 已在 opencode.jsonc 注册 opencode-go 提供商");
    }

    // 2. OpenChamber
    const chamberDirs = [];
    if (process.env.OPENCHAMBER_DATA_DIR && fs.existsSync(process.env.OPENCHAMBER_DATA_DIR)) chamberDirs.push(process.env.OPENCHAMBER_DATA_DIR);
    const nasChamberCandidates = [
      "/vol3/1000/docker/opencode/openchamber/data",
      "/vol1/1000/docker/opencode/openchamber/data",
      "/vol2/1000/docker/opencode/openchamber/data",
      "/vol4/1000/docker/opencode/openchamber/data",
      "/volume1/docker/openchamber/data",
      "/volume1/docker/opencode/openchamber/data",
      "/volume2/docker/openchamber/data",
      "/volume2/docker/opencode/openchamber/data",
      "/mnt/user/appdata/openchamber/data",
      "/var/lib/openchamber/data"
    ];
    for (const cand of nasChamberCandidates) {
      if (fs.existsSync(cand) && !chamberDirs.includes(cand)) chamberDirs.push(cand);
    }
    const standardChamberDir = path.join(homeDir, ".config", "openchamber");
    if (!chamberDirs.includes(standardChamberDir)) chamberDirs.push(standardChamberDir);

    for (const cDir of chamberDirs) {
      if (!fs.existsSync(cDir)) try { fs.mkdirSync(cDir, { recursive: true }); } catch (e) {}

      const prefPath = path.join(cDir, "preferences.json");
      let pref = parseJsonSafe(prefPath, { version: 1, fields: {} });
      if (!pref.fields) pref.fields = {};

      const recents = (pref.fields.recentModels && pref.fields.recentModels.value) || [];
      const filteredRecents = recents.filter(m => !(m.providerID === "opencode-go" && (m.modelID === "deepseek-v4.1-flash" || m.modelID === "kimi-k3")));
      pref.fields.recentModels = {
        updatedAt: Date.now(),
        value: [
          { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" },
          { providerID: "opencode-go", modelID: "kimi-k3" },
          ...filteredRecents
        ]
      };

      const favs = (pref.fields.favoriteModels && pref.fields.favoriteModels.value) || [];
      if (!favs.some(m => m.providerID === "opencode-go" && m.modelID === "deepseek-v4.1-flash")) {
        favs.unshift({ providerID: "opencode-go", modelID: "deepseek-v4.1-flash" });
      }
      if (!favs.some(m => m.providerID === "opencode-go" && m.modelID === "kimi-k3")) {
        favs.push({ providerID: "opencode-go", modelID: "kimi-k3" });
      }
      pref.fields.favoriteModels = { updatedAt: Date.now(), value: favs };
      fs.writeFileSync(prefPath, JSON.stringify(pref, null, 2), "utf8");

      // settings.json
      const setPath = path.join(cDir, "settings.json");
      if (fs.existsSync(setPath)) {
        try {
          const settings = parseJsonSafe(setPath, {});
          const sRecents = settings.recentModels || [];
          const sFiltered = sRecents.filter(m => !(m.providerID === "opencode-go" && (m.modelID === "deepseek-v4.1-flash" || m.modelID === "kimi-k3")));
          settings.recentModels = [
            { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" },
            { providerID: "opencode-go", modelID: "kimi-k3" },
            ...sFiltered
          ];
          const sFavs = settings.favoriteModels || [];
          if (!sFavs.some(m => m.providerID === "opencode-go" && m.modelID === "deepseek-v4.1-flash")) {
            sFavs.unshift({ providerID: "opencode-go", modelID: "deepseek-v4.1-flash" });
          }
          if (!sFavs.some(m => m.providerID === "opencode-go" && m.modelID === "kimi-k3")) {
            sFavs.push({ providerID: "opencode-go", modelID: "kimi-k3" });
          }
          settings.favoriteModels = sFavs;
          fs.writeFileSync(setPath, JSON.stringify(settings, null, 2), "utf8");
        } catch (e) {}
      }
      console.log("✔ 已在 OpenChamber (" + cDir + ") 设置常用模型与首选模型为 opencode-go");
    }

    // 3. OMO (~/.omo/omo.jsonc)
    const omoDir = path.join(homeDir, ".omo");
    if (!fs.existsSync(omoDir)) fs.mkdirSync(omoDir, { recursive: true });
    const omoPath = path.join(omoDir, "omo.jsonc");
    if (!fs.existsSync(omoPath)) {
      const omoTemplate = {
        "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
        "[opencode]": {
          "agents": {
            "sisyphus": { "model": "opencode-go/kimi-k3" },
            "oracle": { "model": "opencode-go/glm-5.3" },
            "librarian": { "model": "opencode-go/qwen3.7-plus", "fallback_models": [{ "model": "opencode-go/minimax-m3" }] },
            "explore": { "model": "opencode-go/qwen3.7-plus", "fallback_models": [{ "model": "opencode-go/minimax-m3" }] },
            "multimodal-looker": { "model": "opencode-go/kimi-k3" },
            "prometheus": { "model": "opencode-go/kimi-k3", "variant": "high" },
            "metis": { "model": "opencode-go/kimi-k3", "variant": "high" },
            "momus": { "model": "opencode-go/glm-5.3" },
            "atlas": { "model": "opencode-go/kimi-k3", "fallback_models": [{ "model": "opencode-go/minimax-m3" }] },
            "sisyphus-junior": { "model": "opencode-go/kimi-k3", "fallback_models": [{ "model": "opencode-go/minimax-m3" }] }
          },
          "categories": {
            "visual-engineering": { "model": "opencode-go/kimi-k3", "variant": "high" },
            "ultrabrain": { "model": "opencode-go/deepseek-v4.1-flash" },
            "deep-low": { "model": "opencode-go/deepseek-v4.1-flash" },
            "deep-high": { "model": "opencode-go/deepseek-v4-pro" },
            "artistry": { "model": "opencode-go/kimi-k3", "variant": "high" },
            "quick": { "model": "opencode-go/minimax-m3", "variant": "high" },
            "unspecified-low": { "model": "opencode-go/deepseek-v4.1-flash" },
            "unspecified-high": { "model": "opencode-go/deepseek-v4-pro" }
          }
        }
      };
      fs.writeFileSync(omoPath, JSON.stringify(omoTemplate, null, 2), "utf8");
      console.log("✔ 已生成 ~/.omo/omo.jsonc 核心多智能体调度配置");
    } else {
      console.log("✔ 已确认 ~/.omo/omo.jsonc 调度配置就绪");
    }

    // 4. Goal boost.md
    const cmdDir = path.join(homeDir, ".config", "opencode", "commands");
    if (!fs.existsSync(cmdDir)) fs.mkdirSync(cmdDir, { recursive: true });
    const boostPath = path.join(cmdDir, "boost.md");
    if (!fs.existsSync(boostPath)) {
      const boostContent = `---
description: "极速自主推进增强模式 (Boost / Ultrawork Mode)"
---
# Boost 极速增强模式指示 (Boost & Ultrawork Orchestration)

立即进入高强度自主推进模式。
推进目标：
\$ARGUMENTS

## 执行规范：
1. **启动全流程推进**：自动激活深层检索、多任务拆解与高效执行链路。
2. **端到端交付**：不半途而废，连续执行直至方案完全实现并完成端到端测试。
3. **保持高可逆性与安全性**：确保关键配置有备份，生产环境安全无损。
`;
      fs.writeFileSync(boostPath, boostContent, "utf8");
      console.log("✔ 已生成 /boost 目标自主推进快捷指令模版");
    } else {
      console.log("✔ 已确认 /boost 快捷指令模版就绪");
    }
  '

  # 自动挂载 OpenChamber Office 离线预览引擎
  if [[ -f "$SCRIPT_DIR/patch-openchamber-office.sh" ]]; then
    echo -e "${YELLOW}正在检测并挂载 OpenChamber Office 离线全格式预览引擎...${NC}"
    bash "$SCRIPT_DIR/patch-openchamber-office.sh" install 2>/dev/null || true
  fi

  # 热重启运行中的 OpenCode 和 OpenChamber 服务以应用新配置
  if has_systemd_user; then
    echo -e "${YELLOW}正在热重启 OpenCode 与 OpenChamber 服务使配置生效...${NC}"
    systemctl --user restart opencode-server.service 2>/dev/null && echo -e "${GREEN}✔ opencode-server.service 已重启${NC}" || true
    systemctl --user restart openchamber.service 2>/dev/null && echo -e "${GREEN}✔ openchamber.service 已重启${NC}" || true
  fi

  echo -e "${GREEN}🎉 全栈客户端绑定成功！${NC}"
}

# 11. 执行体检与修复
run_doctor() {
  local configured_port
  configured_port=$(get_configured_port)

  echo -e "\n${YELLOW}🩺 正在运行系统环境诊断与修复引擎...${NC}"
  CFG_PORT="$configured_port" CFG_PATH="$CONFIG_FILE" node -e '
    const http = require("http");
    const fs = require("fs");
    const port = process.env.CFG_PORT || 4010;
    const cfgPath = process.env.CFG_PATH;
    let pwd = "";
    if (fs.existsSync(cfgPath)) {
      try {
        const c = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (c.uiPassword) pwd = c.uiPassword;
      } catch (e) {}
    }
    const headers = {};
    if (pwd) {
      headers["Authorization"] = "Bearer " + Buffer.from(pwd).toString("base64");
    }
    const req = http.request({
      hostname: "127.0.0.1",
      port: port,
      path: "/balancer/api/doctor",
      method: "GET",
      headers: headers
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const report = JSON.parse(data);
          console.log("✔ 体检结果: 端口 " + report.router.port + " 状态正常");
          console.log("  - OpenCode CLI: " + (report.opencode.installed ? report.opencode.version : "未检测到"));
          console.log("  - OpenChamber 工作台: " + (report.openchamber.reachable ? "在线 (Port 3000)" : "未运行/不可达"));
          console.log("  - 账号数量: " + report.router.accounts.length);
          if (report.issues.length === 0) {
            console.log("🎉 未发现任何异常！");
          } else {
            console.log("⚠ 发现 " + report.issues.length + " 个可优化项目:");
            report.issues.forEach(i => console.log("   [" + i.severity + "] " + i.title + ": " + i.desc));
          }
        } catch (e) {
          console.log("响应解析异常:", data);
        }
      });
    });
    req.on("error", (e) => {
      console.log(`无法连接网关 API (${port}):`, e.message);
    });
    req.end();
  '
}

# 11.5 执行一键自愈修复
run_repair() {
  local configured_port
  configured_port=$(get_configured_port)

  echo -e "\n${YELLOW}🛠 正在执行一键环境自愈与全栈修复...${NC}"
  CFG_PORT="$configured_port" CFG_PATH="$CONFIG_FILE" node -e '
    const http = require("http");
    const fs = require("fs");
    const path = require("path");
    const port = process.env.CFG_PORT || 4010;
    const cfgPath = process.env.CFG_PATH;
    let pwd = "";
    if (fs.existsSync(cfgPath)) {
      try {
        const c = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (c.uiPassword) pwd = c.uiPassword;
      } catch (e) {}
    }
    const headers = { "Content-Type": "application/json" };
    if (pwd) {
      headers["Authorization"] = "Bearer " + Buffer.from(pwd).toString("base64");
    }
    const req = http.request({
      hostname: "127.0.0.1",
      port: port,
      path: "/balancer/api/repair",
      method: "POST",
      headers: headers
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          if (result.success) {
            console.log("🎉 一键自愈修复成功完成！");
            if (Array.isArray(result.results)) {
              result.results.forEach(r => console.log("  ✔ [" + r.item + "] " + r.message));
            }
          } else {
            console.log("❌ 修复出现异常:", result.error || "未知错误");
          }
        } catch (e) {
          console.log("响应解析异常:", data);
        }
      });
    });
    req.on("error", (e) => {
      try {
        const updater = require("./updater");
        const ocDir = path.join(require("os").homedir(), ".config", "opencode");
        const ocPath = path.join(ocDir, "opencode.jsonc");
        const harm = updater.harmonizeOpencodeConfig(ocPath, port);
        console.log("✔ 本地已完成 opencode.jsonc 离线修复 (清除 providers 冲突，全量补齐 38 款模型)");
      } catch (err) {
        console.log("本地离线自愈提示:", err.message);
      }
    });
    req.end();
  '
  # 自动重新挂载 Office 预览补丁
  if [[ -f "$SCRIPT_DIR/patch-openchamber-office.sh" ]]; then
    bash "$SCRIPT_DIR/patch-openchamber-office.sh" install 2>/dev/null || true
  fi

  # 热重启运行中的 OpenCode 与 OpenChamber 服务以加载修复后的配置
  if has_systemd_user; then
    echo -e "${YELLOW}正在热重启 OpenCode 与 OpenChamber 守护服务以加载最新配置...${NC}"
    systemctl --user restart opencode-server.service 2>/dev/null && echo -e "${GREEN}✔ opencode-server.service 已热重启${NC}" || true
    systemctl --user restart openchamber.service 2>/dev/null && echo -e "${GREEN}✔ openchamber.service 已热重启${NC}" || true
  fi
}

# 11.6 执行非交互式一键更新
run_update() {
  check_node_env
  local updater_js="$SCRIPT_DIR/updater.js"
  echo -e "\n${YELLOW}🚀 正在执行 Linux NAS 全组件安全自适应更新 (自动灾备快照)...${NC}"
  if node "$updater_js" apply; then
    echo -e "\n${GREEN}✔ 全套组件安全更新与守护服务平滑热重载全部完成！${NC}"
  else
    echo -e "\n${RED}❌ 更新执行出现异常，可运行 ./setup-linux.sh --rollback 执行灾备秒级回滚！${NC}"
    exit 1
  fi
}

# 11.7 执行非交互式灾备回滚
run_rollback() {
  check_node_env
  local updater_js="$SCRIPT_DIR/updater.js"
  echo -e "\n${YELLOW}⏪ 正在执行灾备秒级回滚...${NC}"
  if [[ -n "$ARG_ROLLBACK_ID" ]]; then
    node "$updater_js" rollback "$ARG_ROLLBACK_ID"
  else
    node "$updater_js" rollback
  fi
  if has_systemd_user; then
    systemctl --user restart openchamber.service 2>/dev/null || true
    systemctl --user restart opencode-server.service 2>/dev/null || true
  fi
  echo -e "\n${GREEN}✔ 灾备回滚完成，系统配置与守护服务已恢复！${NC}"
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

if [[ "$OPT_REPAIR" == true ]]; then
  run_repair
  exit 0
fi

if [[ "$OPT_UPDATE" == true ]]; then
  run_update
  exit 0
fi

if [[ "$OPT_ROLLBACK" == true ]]; then
  run_rollback
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

manage_updates() {
  echo -e "\n${CYAN}================ 全组件更新监测与安全升级 ================${NC}"
  local updater_js="$SCRIPT_DIR/updater.js"
  if [[ ! -f "$updater_js" ]]; then
    echo -e "${RED}❌ 未找到 updater.js 模块！${NC}"
    return
  fi

  echo -e "${YELLOW}正在检测全组件最新版本与兼容性状态...${NC}"
  node "$updater_js" check
  echo ""
  echo "请选择操作："
  echo " [1] 一键安全更新全部组件 (自动生成灾备快照)"
  echo " [2] 一键灾备回滚 (从最新快照秒级还原)"
  echo " [3] 查看历史快照列表"
  echo " [0] 返回上级"
  read -rp "请输入 [默认: 1]: " up_opt
  case "$up_opt" in
    1)
      echo -e "${YELLOW}正在执行一键安全更新 (自动灾备快照)...${NC}"
      if node "$updater_js" apply; then
        echo -e "${GREEN}✔ 全套组件安全更新完成！${NC}"
      else
        echo -e "${RED}❌ 更新执行出现异常，建议使用 [2] 执行灾备秒级回滚！${NC}"
      fi
      ;;
    2)
      read -rp "确认执行灾备回滚吗？(y/N): " rb_confirm
      if [[ "$rb_confirm" =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}正在执行灾备回滚...${NC}"
        if node "$updater_js" rollback; then
          echo -e "${GREEN}✔ 灾备回滚完成！系统配置已恢复！${NC}"
        else
          echo -e "${RED}❌ 灾备回滚失败，请检查快照目录！${NC}"
        fi
      fi
      ;;
    3)
      node "$updater_js" snapshots
      ;;
    0) ;;
    *)
      if node "$updater_js" apply; then
        echo -e "${GREEN}✔ 全套组件安全更新完成！${NC}"
      else
        echo -e "${RED}❌ 更新执行出现异常！${NC}"
      fi
      ;;
  esac
}

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
    echo " [9] 📄 挂载/管理 OpenChamber 全能 Office 离线预览引擎 (.docx/.xlsx/.pptx)"
    echo " [10] 📦 一键检测全套组件更新、兼容性诊断与安全升级/回滚"
    echo " [0] 退出"
    echo -e "${CYAN}================================================${NC}"
    read -rp "请输入数字 [0-10]: " choice

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
        read -rp "请输入 Web 管理员访问密码 (留空清空保护): " pwd
        ARG_KEY1="$k1"
        ARG_KEY2="$k2"
        ARG_PASSWORD="$pwd"
        FLAG_PASSWORD_SET=1
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
      9)
        if [[ -f "$SCRIPT_DIR/patch-openchamber-office.sh" ]]; then
          echo -e "\n${CYAN}OpenChamber Office 预览引擎管理：${NC}"
          echo " [1] 一键挂载离线预览引擎"
          echo " [2] 卸载并恢复官方原始备份"
          echo " [3] 查看当前挂载状态"
          echo " [0] 返回上级"
          read -rp "请输入 [默认: 1]: " oc_opt
          case "$oc_opt" in
            2) bash "$SCRIPT_DIR/patch-openchamber-office.sh" rollback ;;
            3) bash "$SCRIPT_DIR/patch-openchamber-office.sh" status ;;
            0) ;;
            *) bash "$SCRIPT_DIR/patch-openchamber-office.sh" install ;;
          esac
        else
          echo -e "${RED}❌ 未找到 patch-openchamber-office.sh${NC}"
        fi
        ;;
      10)
        manage_updates
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
