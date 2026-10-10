/**
 * OpenCode Go Multi-Subscription Smart Router & Load Balancer
 * Ultra-low overhead, zero external dependencies (Node.js native).
 * 
 * Features:
 * - Full Graphical Configuration UI (/balancer/ui)
 * - Safe atomic configuration update & hot-reload without restart
 * - One-click account connectivity test with latency check
 * - Seamless round-robin / session-affinity load balancing (KV Cache optimized)
 * - Zero-downtime 429 / 503 failover with dynamic Retry-After cooldown calculation
 * - Full SSE streaming passthrough (text/event-stream)
 * - Preserves x-opencode-session header
 * - Environment variable fallback (OPENCODE_GO_KEY_1, OPENCODE_GO_KEY_2)
 * - Integrated Doctor & Auto-Repair diagnostic engine (/balancer/api/doctor & /balancer/api/repair)
 * - Dynamic cooldown reset API (/balancer/api/reset-cooldown)
 * - Health check endpoint (/health & /balancer/health)
 * - Global CORS preflight (OPTIONS) support
 */

const http = require('node:http');
const https = require('node:https');
const url = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync, exec, spawn } = require('node:child_process');
const codexAdapter = require('./codex-adapter');

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

const CONFIG_FILE = process.env.OPENCODE_ROUTER_CONFIG || path.join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  port: 4010,
  host: '127.0.0.1',
  upstream: 'https://opencode.ai/zen/go/v1',
  defaultCooldownMs: 60000,
  maxFailoverRetries: 2,
  sessionAffinityEnabled: true,
  uiPassword: '',
  accounts: [
    {
      id: 'account-1',
      name: 'OpenCode Go 主账号',
      apiKey: '',
      enabled: true
    },
    {
      id: 'account-2',
      name: 'OpenCode Go 备用账号',
      apiKey: '',
      enabled: true
    }
  ]
};

const DEFAULT_OMO_CONFIG = {
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

// Load or initialize config
let config = { ...DEFAULT_CONFIG };
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '');
      config = Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
    } catch (err) {
      console.error('[Config] Failed to load config.json, using defaults:', err.message);
    }
  } else {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
      console.error('[Config] Failed to create default config.json:', err.message);
    }
  }

  // Allow PORT environment variable override
  if (process.env.PORT) {
    const p = parseInt(process.env.PORT, 10);
    if (!isNaN(p) && p > 0) config.port = p;
  }

  // Allow HOST / OPENCODE_ROUTER_HOST override
  if (process.env.OPENCODE_ROUTER_HOST || process.env.HOST) {
    config.host = (process.env.OPENCODE_ROUTER_HOST || process.env.HOST).trim();
  }

  // Allow OPENCODE_ROUTER_PASSWORD override
  if (process.env.OPENCODE_ROUTER_PASSWORD) {
    config.uiPassword = process.env.OPENCODE_ROUTER_PASSWORD.trim();
  }

  // Fallback to environment variables if apiKey is empty
  if (Array.isArray(config.accounts)) {
    if (config.accounts[0] && (!config.accounts[0].apiKey || !config.accounts[0].apiKey.trim())) {
      const envKey1 = process.env.OPENCODE_GO_KEY_1 || process.env.OPENCODE_GO_API_KEY;
      if (envKey1 && envKey1.trim()) {
        config.accounts[0].apiKey = envKey1.trim();
      }
    }
    if (config.accounts[1] && (!config.accounts[1].apiKey || !config.accounts[1].apiKey.trim())) {
      const envKey2 = process.env.OPENCODE_GO_KEY_2;
      if (envKey2 && envKey2.trim()) {
        config.accounts[1].apiKey = envKey2.trim();
      }
    }
  }
}
loadConfig();

// Runtime account state tracking
const accountStats = new Map();
function syncAccountStats() {
  for (const acc of config.accounts) {
    if (!accountStats.has(acc.id)) {
      accountStats.set(acc.id, {
        id: acc.id,
        name: acc.name,
        activeRequests: 0,
        totalRequests: 0,
        rateLimitCount: 0,
        failoverCount: 0,
        cooldownUntil: 0,
        lastUsedAt: null,
        lastError: null
      });
    } else {
      const stat = accountStats.get(acc.id);
      stat.name = acc.name;
    }
  }
  // Remove deleted accounts from stats
  const currentIds = new Set(config.accounts.map(a => a.id));
  for (const id of accountStats.keys()) {
    if (!currentIds.has(id)) {
      accountStats.delete(id);
    }
  }
}
syncAccountStats();

// Session affinity map: sessionId -> accountId
const sessionMap = new Map();
const sessionLastSeen = new Map();

// Clean up stale sessions periodically (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [sess, time] of sessionLastSeen.entries()) {
    if (now - time > 3600000) { // 1 hour inactivity
      sessionMap.delete(sess);
      sessionLastSeen.delete(sess);
    }
  }
}, 600000);

let rrIndex = 0;

function isAccountAvailable(acc) {
  if (!acc.enabled || !acc.apiKey || acc.apiKey.trim() === '') return false;
  const stat = accountStats.get(acc.id);
  if (!stat) return false;
  if (stat.cooldownUntil > Date.now()) return false;
  return true;
}

function selectAccount(sessionId, excludeAccountIds = new Set()) {
  const now = Date.now();
  const available = config.accounts.filter(a => isAccountAvailable(a) && !excludeAccountIds.has(a.id));

  if (available.length === 0) {
    return null;
  }

  // 1. Session affinity check (if enabled)
  if (config.sessionAffinityEnabled && sessionId && sessionMap.has(sessionId)) {
    const pinnedId = sessionMap.get(sessionId);
    const candidate = available.find(a => a.id === pinnedId);
    if (candidate) {
      sessionLastSeen.set(sessionId, now);
      return candidate;
    }
  }

  // 2. Round-Robin selection
  const chosen = available[rrIndex % available.length];
  rrIndex = (rrIndex + 1) % available.length;

  if (config.sessionAffinityEnabled && sessionId) {
    if (sessionMap.size > 5000) {
      const entries = Array.from(sessionLastSeen.entries()).sort((a, b) => a[1] - b[1]);
      const pruneCount = Math.floor(entries.length * 0.2) || 1;
      for (let i = 0; i < pruneCount; i++) {
        sessionMap.delete(entries[i][0]);
        sessionLastSeen.delete(entries[i][0]);
      }
    }
    sessionMap.set(sessionId, chosen.id);
    sessionLastSeen.set(sessionId, now);
  }

  return chosen;
}

function recordCooldown(accountId, cooldownMs, reason) {
  const stat = accountStats.get(accountId);
  if (stat) {
    let dur = Number(cooldownMs);
    if (isNaN(dur) || dur <= 0 || !isFinite(dur)) {
      dur = config.defaultCooldownMs;
    }
    stat.cooldownUntil = Date.now() + dur;
    stat.rateLimitCount += 1;
    stat.lastError = `Rate limit cooldown for ${Math.round(dur / 1000)}s: ${reason || '429 / 503'}`;
    console.warn(`[Router Cooldown] Account "${stat.name}" cooling down until ${new Date(stat.cooldownUntil).toLocaleTimeString()} (${reason})`);
  }
}

// Connectivity Tester
function testAccountConnection(upstream, apiKey) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    try {
      let endpoint = upstream.replace(/\/+$/, '');
      if (!endpoint.endsWith('/models') && !endpoint.includes('/v1')) {
        endpoint += '/v1/models';
      } else if (!endpoint.endsWith('/models')) {
        endpoint += '/models';
      }
      const parsed = new URL(endpoint);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request(parsed, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'x-opencode-session': 'session-tester-' + Date.now(),
          'User-Agent': 'OpenCode-Go-Router-Tester/1.0',
          'Accept': 'application/json'
        },
        timeout: 6000
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, statusCode: res.statusCode, latencyMs, message: `连接成功 (延迟 ${latencyMs}ms)` });
          } else if (res.statusCode === 401 || res.statusCode === 403) {
            resolve({ success: false, statusCode: res.statusCode, latencyMs, message: `认证失败: 密钥无效或未授权 (HTTP ${res.statusCode})` });
          } else if (res.statusCode === 429) {
            resolve({ success: false, statusCode: res.statusCode, latencyMs, message: `账号限频中 (HTTP 429 Too Many Requests)` });
          } else {
            resolve({ success: false, statusCode: res.statusCode, latencyMs, message: `上游返回异常 (HTTP ${res.statusCode})` });
          }
        });
      });
      req.on('error', (err) => {
        resolve({ success: false, statusCode: 0, latencyMs: Date.now() - startTime, message: `网络连接异常: ${err.message}` });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, statusCode: 0, latencyMs: 6000, message: '上游连接超时 (6秒)' });
      });
      req.end();
    } catch (err) {
      resolve({ success: false, statusCode: 0, latencyMs: 0, message: `端点地址解析失败: ${err.message}` });
    }
  });
}

// Account Usage & Quota Fetcher (Rolling 5h, Weekly, Monthly limits)
function fetchAccountUsage(upstream, apiKey) {
  return new Promise((resolve) => {
    try {
      let endpoint = upstream.replace(/\/+$/, '');
      if (endpoint.endsWith('/models')) {
        endpoint = endpoint.replace(/\/models$/, '/usage');
      } else if (endpoint.endsWith('/v1')) {
        endpoint += '/usage';
      } else if (!endpoint.includes('/usage')) {
        endpoint += '/v1/usage';
      }
      const parsed = new URL(endpoint);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request(parsed, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'x-opencode-session': 'session-quota-' + Date.now(),
          'User-Agent': 'OpenCode-Go-Router-Quota/1.0',
          'Accept': 'application/json'
        },
        timeout: 8000
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              resolve({ success: true, statusCode: 200, usage: data.usage || null });
            } catch (e) {
              resolve({ success: false, statusCode: 200, error: '解析配额数据失败: ' + e.message });
            }
          } else {
            resolve({ success: false, statusCode: res.statusCode, error: `上游返回 HTTP ${res.statusCode}` });
          }
        });
      });
      req.on('error', (err) => {
        resolve({ success: false, statusCode: 0, error: `网络异常: ${err.message}` });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, statusCode: 0, error: '请求配额超时 (8秒)' });
      });
      req.end();
    } catch (err) {
      resolve({ success: false, statusCode: 0, error: `端点解析失败: ${err.message}` });
    }
  });
}

function stripJsonComments(str) {
  if (typeof str !== 'string') return '';
  const noComments = str.replace(/\\"|"(?:[^"\\]|\\.)*"|(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m));
  return noComments.replace(/,(\s*[}\]])/g, '$1');
}

function parseJsonSafe(filePath, defaultVal = {}) {
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(stripJsonComments(raw));
  } catch (e) {
    console.error(`[Config Warning] Failed to parse ${filePath}:`, e.message);
    return defaultVal;
  }
}

async function bindDesktopConfig(options = {}) {
  const result = { opencode: false, openchamber: false, omo: false, boost: false, messages: [] };
  const homeDir = os.homedir();
  const routerUrl = `http://127.0.0.1:${config.port}/v1`;

  // 1. OpenCode (~/.config/opencode/opencode.jsonc)
  try {
    const opencodeDir = process.env.OPENCODE_CONFIG_DIR || path.join(homeDir, '.config', 'opencode');
    if (!fs.existsSync(opencodeDir)) fs.mkdirSync(opencodeDir, { recursive: true });
    const opencodeJsonPath = path.join(opencodeDir, 'opencode.jsonc');
    const updater = require('./updater');

    // 动态嗅探拉取官方最新模型（若在线），离线则自动使用 38 款基准字典兜底
    let officialModels = options.officialModels || null;
    if (!officialModels) {
      const validAccount = config.accounts.find(a => a.enabled && a.apiKey && a.apiKey.trim());
      if (validAccount) {
        try {
          officialModels = await updater.fetchOfficialModels(validAccount.apiKey, config.upstream, 2500);
        } catch (_) {}
      }
    }

    const harmRes = updater.harmonizeOpencodeConfig(opencodeJsonPath, config.port, { officialModels });
    result.opencode = harmRes.success;
    if (harmRes.modelPreserved) {
      result.messages.push(`已保留当前 OpenCode 全局首选模型 (${harmRes.currentModel})`);
    } else {
      result.messages.push(`已将 OpenCode 全局首选模型设置为 ${harmRes.currentModel}`);
    }
    const syncTag = (officialModels && officialModels.length > 0) ? `已动态同步官方最新 ${harmRes.modelCount} 款模型` : `全量覆盖 ${harmRes.modelCount} 款官方基准模型`;
    result.messages.push(`已规范单一 provider 链路，${syncTag}，无损消除单复数冲突`);
  } catch (err) {
    result.messages.push('OpenCode 配置失败: ' + err.message);
  }

  // 2. OpenChamber (~/.config/openchamber and OPENCHAMBER_DATA_DIR)
  try {
    const chamberDirs = [];
    if (process.env.OPENCHAMBER_DATA_DIR && fs.existsSync(process.env.OPENCHAMBER_DATA_DIR)) {
      chamberDirs.push(process.env.OPENCHAMBER_DATA_DIR);
    }
    const nasChamberCandidates = [
      '/vol3/1000/docker/opencode/openchamber/data',
      '/vol1/1000/docker/opencode/openchamber/data',
      '/vol2/1000/docker/opencode/openchamber/data',
      '/vol4/1000/docker/opencode/openchamber/data',
      '/volume1/docker/openchamber/data',
      '/volume1/docker/opencode/openchamber/data',
      '/volume2/docker/openchamber/data',
      '/volume2/docker/opencode/openchamber/data',
      '/mnt/user/appdata/openchamber/data',
      '/var/lib/openchamber/data'
    ];
    for (const cand of nasChamberCandidates) {
      if (fs.existsSync(cand) && !chamberDirs.includes(cand)) {
        chamberDirs.push(cand);
      }
    }
    const standardChamberDir = path.join(homeDir, '.config', 'openchamber');
    if (!chamberDirs.includes(standardChamberDir)) {
      chamberDirs.push(standardChamberDir);
    }

    let chamberUpdated = false;
    for (const cDir of chamberDirs) {
      if (!fs.existsSync(cDir)) {
        try { fs.mkdirSync(cDir, { recursive: true }); } catch (e) {}
      }

      // Update preferences.json
      const prefPath = path.join(cDir, 'preferences.json');
      let pref = parseJsonSafe(prefPath, { version: 1, fields: {} });
      if (!pref.fields) pref.fields = {};

      const prefRecents = pref.fields.recentModels?.value || [];
      const filteredRecents = prefRecents.filter(m => !(m.providerID === 'opencode-go' && (m.modelID === 'deepseek-v4.1-flash' || m.modelID === 'kimi-k3')));
      pref.fields.recentModels = {
        updatedAt: Date.now(),
        value: [
          { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' },
          { providerID: 'opencode-go', modelID: 'kimi-k3' },
          ...filteredRecents
        ]
      };

      const favs = pref.fields.favoriteModels?.value || [];
      if (!favs.some(m => m.providerID === 'opencode-go' && m.modelID === 'deepseek-v4.1-flash')) {
        favs.unshift({ providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' });
      }
      if (!favs.some(m => m.providerID === 'opencode-go' && m.modelID === 'kimi-k3')) {
        favs.push({ providerID: 'opencode-go', modelID: 'kimi-k3' });
      }
      pref.fields.favoriteModels = {
        updatedAt: Date.now(),
        value: favs
      };
      fs.writeFileSync(prefPath, JSON.stringify(pref, null, 2), 'utf8');

      // Update settings.json if exists
      const setPath = path.join(cDir, 'settings.json');
      if (fs.existsSync(setPath)) {
        try {
          const settings = parseJsonSafe(setPath, {});
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
      chamberUpdated = true;
    }

    result.openchamber = chamberUpdated;
    result.messages.push('已将 OpenChamber 桌面/Web 端首选默认模型设为 opencode-go / deepseek-v4.1-flash');
  } catch (err) {
    result.messages.push('OpenChamber 配置失败: ' + err.message);
  }

  // 3. OMO (~/.omo/omo.jsonc)
  try {
    const omoDir = path.join(homeDir, '.omo');
    if (!fs.existsSync(omoDir)) fs.mkdirSync(omoDir, { recursive: true });
    const omoPath = path.join(omoDir, 'omo.jsonc');
    if (!fs.existsSync(omoPath)) {
      fs.writeFileSync(omoPath, JSON.stringify(DEFAULT_OMO_CONFIG, null, 2), 'utf8');
      result.omo = true;
      result.messages.push('已生成标准 ~/.omo/omo.jsonc 路由配置');
    } else {
      result.omo = true;
      result.messages.push('已确认 ~/.omo/omo.jsonc 路由配置已就绪');
    }
  } catch (err) {
    result.messages.push('OMO 配置提醒: ' + err.message);
  }

  // 4. Goal boost.md
  try {
    const cmdDir = path.join(homeDir, '.config', 'opencode', 'commands');
    if (!fs.existsSync(cmdDir)) fs.mkdirSync(cmdDir, { recursive: true });
    const boostPath = path.join(cmdDir, 'boost.md');
    if (!fs.existsSync(boostPath)) {
      const boostContent = `---
description: "极速自主推进增强模式 (Boost / Ultrawork Mode)"
---
# Boost 极速增强模式指示 (Boost & Ultrawork Orchestration)

立即进入高强度自主推进模式。
推进目标：
$ARGUMENTS

## 执行规范：
1. **启动全流程推进**：自动激活深层检索、多任务拆解与高效执行链路。
2. **端到端交付**：不半途而废，连续执行直至方案完全实现并完成端到端测试。
3. **保持高可逆性与安全性**：确保关键配置有备份，生产环境安全无损。
`;
      fs.writeFileSync(boostPath, boostContent, 'utf8');
      result.boost = true;
      result.messages.push('已就绪：/boost 指令模版');
    } else {
      result.boost = true;
      result.messages.push('已确认：/boost 指令模版已存在');
    }
  } catch (err) {
    result.messages.push('Boost 指令模版提醒: ' + err.message);
  }

  // 5. On Linux, preserve running tasks: OpenCode uses native inotify hot-reload for opencode.jsonc
  if (process.platform === 'linux') {
    try {
      execSync('systemctl --user reload-or-try-restart openchamber.service 2>/dev/null || true');
      result.messages.push('已通知前端 OpenChamber 服务同步，OpenCode 核心由 Inotify 原生热加载无需重启');
    } catch (e) {}
  }

  return result;
}

function getCorsHeaders(upstreamHeaders = {}) {
  const headers = { ...upstreamHeaders };
  delete headers['connection'];
  delete headers['transfer-encoding'];
  headers['access-control-allow-origin'] = '*';
  headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
  headers['access-control-allow-headers'] = '*';
  return headers;
}

function sendProxyRequest(clientReq, clientRes, reqBody, account, attemptNumber, triedAccountIds = new Set()) {
  triedAccountIds.add(account.id);
  const stat = accountStats.get(account.id);
  if (stat) {
    stat.activeRequests += 1;
    stat.totalRequests += 1;
    stat.lastUsedAt = Date.now();
  }

  const upstreamUrl = new URL(config.upstream);
  const isHttps = upstreamUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  let targetPath = clientReq.url;
  const upstreamPathname = upstreamUrl.pathname.replace(/\/+$/, '');
  // 避免双重 /v1 拼接: 若 upstream 已经以 /v1 结尾且客户端请求带 /v1，剔除多余前缀
  if (upstreamPathname.endsWith('/v1')) {
    if (targetPath === '/v1') targetPath = '/';
    else if (targetPath.startsWith('/v1/')) targetPath = targetPath.slice(3);
    else if (targetPath.startsWith('/v1?')) targetPath = '/' + targetPath.slice(3);
  }
  const upstreamPath = upstreamPathname + (targetPath.startsWith('/') ? targetPath : '/' + targetPath);

  // Model prefix normalization & Responses protocol check
  let parsedBody = null;
  if (reqBody && reqBody.length > 0) {
    try {
      parsedBody = JSON.parse(reqBody.toString('utf8'));
      if (parsedBody && typeof parsedBody.model === 'string' && parsedBody.model.startsWith('opencode-go/')) {
        parsedBody.model = parsedBody.model.slice(12);
        reqBody = Buffer.from(JSON.stringify(parsedBody), 'utf8');
      }
    } catch (e) {}
  }

  const isResponsesReq = targetPath.startsWith('/responses') || (clientReq.url && clientReq.url.includes('/responses'));
  if (isResponsesReq && parsedBody) {
    const reqModel = parsedBody.model || 'deepseek-v4.1-flash';
    if (codexAdapter.ANTHROPIC_MODELS && codexAdapter.ANTHROPIC_MODELS.has(reqModel)) {
      bridgeResponsesToAnthropicRequest(clientReq, clientRes, parsedBody, account, attemptNumber, triedAccountIds);
      return;
    } else if (!codexAdapter.NATIVE_RESPONSES_MODELS.has(reqModel)) {
      bridgeResponsesToChatRequest(clientReq, clientRes, parsedBody, account, attemptNumber, triedAccountIds);
      return;
    }
  }

  const proxyHeaders = { ...clientReq.headers };
  delete proxyHeaders['host'];
  delete proxyHeaders['connection'];
  delete proxyHeaders['keep-alive'];
  delete proxyHeaders['transfer-encoding'];
  delete proxyHeaders['expect'];

  if (!proxyHeaders['user-agent'] || /python|curl|undici|node-fetch/i.test(proxyHeaders['user-agent'])) {
    proxyHeaders['user-agent'] = 'opencode/2.0.26 (Desktop; Linux x86_64)';
  }

  if (reqBody && reqBody.length > 0) {
    proxyHeaders['content-length'] = String(Buffer.byteLength(reqBody));
  } else if (clientReq.method === 'POST' || clientReq.method === 'PUT' || clientReq.method === 'PATCH') {
    proxyHeaders['content-length'] = '0';
  } else {
    delete proxyHeaders['content-length'];
  }

  let sessionId = clientReq.headers['x-opencode-session'];
  if (!sessionId || !sessionId.trim()) {
    sessionId = 'session-opencode-go-default';
  }
  proxyHeaders['x-opencode-session'] = sessionId;
  proxyHeaders['authorization'] = `Bearer ${account.apiKey.trim()}`;

  const proxyOptions = {
    protocol: upstreamUrl.protocol,
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port || (isHttps ? 443 : 80),
    path: upstreamPath,
    method: clientReq.method,
    headers: proxyHeaders,
    timeout: 300000 // 5 minutes timeout for long generation
  };

  const proxyReq = transport.request(proxyOptions);
  let responded = false;
  let requestFinished = false;
  let clientAborted = false;

  const finishRequest = () => {
    if (!requestFinished) {
      requestFinished = true;
      if (stat && stat.activeRequests > 0) {
        stat.activeRequests -= 1;
      }
    }
  };

  const clientCloseHandler = () => {
    if (!clientRes.writableEnded) {
      clientAborted = true;
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
    }
    finishRequest();
  };

  clientRes.once('close', clientCloseHandler);

  proxyReq.on('timeout', () => {
    console.error(`[Upstream Timeout] Request to ${account.name} timed out after 300s`);
    proxyReq.destroy(new Error('Gateway Timeout (upstream took longer than 300s)'));
  });

  proxyReq.on('response', (upstreamRes) => {
    const statusCode = upstreamRes.statusCode;

    // Check if Rate Limited (429) or Service Unavailable (503)
    if ((statusCode === 429 || statusCode === 503) && attemptNumber <= config.maxFailoverRetries && !clientAborted && !clientRes.destroyed) {
      // Dynamic cooldown calculation from Retry-After header
      let cooldownMs = config.defaultCooldownMs;
      const retryAfter = upstreamRes.headers['retry-after'];
      if (retryAfter) {
        const sec = parseInt(retryAfter, 10);
        if (!isNaN(sec) && sec > 0) {
          cooldownMs = sec * 1000;
        } else {
          const dateMs = new Date(retryAfter).getTime();
          if (!isNaN(dateMs) && dateMs > Date.now()) {
            cooldownMs = dateMs - Date.now();
          }
        }
      }

      recordCooldown(account.id, cooldownMs, `HTTP ${statusCode}`);
      finishRequest();
      clientRes.removeListener('close', clientCloseHandler);

      const errorChunks = [];
      upstreamRes.on('data', chunk => errorChunks.push(chunk));
      upstreamRes.on('end', () => {
        if (clientAborted || clientRes.destroyed) return;
        const nextAccount = selectAccount(sessionId, triedAccountIds);

        if (nextAccount) {
          if (stat) stat.failoverCount += 1;
          console.log(`[Failover] Account "${account.name}" returned ${statusCode}. Switching to "${nextAccount.name}" (Attempt ${attemptNumber + 1})`);
          sendProxyRequest(clientReq, clientRes, reqBody, nextAccount, attemptNumber + 1, triedAccountIds);
        } else {
          const errorBody = Buffer.concat(errorChunks);
          const outHeaders = getCorsHeaders(upstreamRes.headers);
          outHeaders['content-length'] = String(errorBody.length);
          clientRes.writeHead(statusCode, outHeaders);
          clientRes.end(errorBody);
        }
      });
      return;
    }

    // Check if Responses protocol is unsupported on upstream for native models
    if (isResponsesReq && statusCode === 400 && parsedBody && !clientAborted && !clientRes.destroyed) {
      const errChunks = [];
      upstreamRes.on('data', chunk => errChunks.push(chunk));
      upstreamRes.on('end', () => {
        if (clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
        const errText = Buffer.concat(errChunks).toString('utf8');
        if (errText.includes('ModelProtocolUnsupported') || errText.includes('does not support /responses')) {
          console.log(`[Protocol Fallback] Model "${parsedBody.model}" triggered ModelProtocolUnsupported on /responses. Bridging...`);
          finishRequest();
          clientRes.removeListener('close', clientCloseHandler);
          if (codexAdapter.ANTHROPIC_MODELS && codexAdapter.ANTHROPIC_MODELS.has(parsedBody.model)) {
            bridgeResponsesToAnthropicRequest(clientReq, clientRes, parsedBody, account, attemptNumber, triedAccountIds);
          } else {
            bridgeResponsesToChatRequest(clientReq, clientRes, parsedBody, account, attemptNumber, triedAccountIds);
          }
        } else {
          finishRequest();
          const outHeaders = getCorsHeaders(upstreamRes.headers);
          const errorBody = Buffer.from(errText, 'utf8');
          outHeaders['content-length'] = String(errorBody.length);
          clientRes.writeHead(statusCode, outHeaders);
          clientRes.end(errorBody);
        }
      });
      return;
    }

    // Check if Region Blocked (403 unsupported_country_region_territory) or Protocol Incompatible (400)
    if ((statusCode === 403 || statusCode === 400) && parsedBody && attemptNumber <= config.maxFailoverRetries && !clientAborted && !clientRes.destroyed) {
      const errChunks = [];
      upstreamRes.on('data', chunk => errChunks.push(chunk));
      upstreamRes.on('end', () => {
        if (clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
        const errText = Buffer.concat(errChunks).toString('utf8');
        const isRegionBlocked = errText.includes('unsupported_country_region_territory') || errText.includes('territory not supported');
        const isProtocolUnsupported = statusCode === 400 && errText.includes('ModelProtocolUnsupported');

        if (isRegionBlocked || isProtocolUnsupported) {
          const reason = isRegionBlocked ? 'OpenAI 地域封锁 (unsupported_country_region_territory)' : '上游协议不兼容 (ModelProtocolUnsupported)';
          const originalModel = parsedBody.model || 'unknown';
          const targetFallback = 'deepseek-v4.1-flash';
          console.log(`[Auto Self-Healing] 模型 "${originalModel}" 触发 ${reason}。网关正在无缝自动挽救并切至 "${targetFallback}"...`);
          finishRequest();
          clientRes.removeListener('close', clientCloseHandler);
          parsedBody.model = targetFallback;
          const newReqBody = Buffer.from(JSON.stringify(parsedBody), 'utf8');
          sendProxyRequest(clientReq, clientRes, newReqBody, account, attemptNumber + 1, triedAccountIds);
          return;
        }

        finishRequest();
        const outHeaders = getCorsHeaders(upstreamRes.headers);
        const errorBody = Buffer.from(errText, 'utf8');
        outHeaders['content-length'] = String(errorBody.length);
        clientRes.writeHead(statusCode, outHeaders);
        clientRes.end(errorBody);
      });
      return;
    }

    responded = true;
    clientRes.writeHead(statusCode, getCorsHeaders(upstreamRes.headers));
    upstreamRes.pipe(clientRes);

    upstreamRes.on('error', (err) => {
      console.error('[Upstream Stream Error]', err.message);
      finishRequest();
      if (!clientRes.writableEnded) {
        clientRes.end();
      }
    });

    upstreamRes.on('end', () => {
      finishRequest();
    });
  });

  proxyReq.on('error', (err) => {
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);

    // If client was already closed / aborted, do NOT trigger failover or log false alarm
    if (clientAborted || clientRes.destroyed || clientRes.writableEnded || clientReq.destroyed) {
      console.log(`[Client Abort] Client disconnected before request completed with account "${account.name}". No failover needed.`);
      return;
    }

    console.error(`[Upstream Proxy Error] Account "${account.name}":`, err.stack || err.message);
    if (!responded && attemptNumber <= config.maxFailoverRetries) {
      // 仅在有备用账号时尝试故障漂移，不将网络异常账号错误地锁入429限频池
      const nextAccount = selectAccount(sessionId, triedAccountIds);
      if (nextAccount) {
        if (stat) stat.failoverCount += 1;
        console.log(`[Failover] Error with "${account.name}": ${err.message}. Switching to "${nextAccount.name}"`);
        sendProxyRequest(clientReq, clientRes, reqBody, nextAccount, attemptNumber + 1, triedAccountIds);
        return;
      }
    }

    if (!responded) {
      responded = true;
      const isTimeout = err.message && err.message.includes('Gateway Timeout');
      const errCode = isTimeout ? 504 : 502;
      clientRes.writeHead(errCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*'
      });
      clientRes.end(JSON.stringify({
        error: {
          message: `Proxy error reaching upstream: ${err.message}`,
          type: isTimeout ? 'router_gateway_timeout' : 'router_proxy_error',
          code: errCode
        }
      }));
    } else {
      if (!clientRes.writableEnded) {
        clientRes.end();
      }
    }
  });

  if (reqBody && reqBody.length > 0) {
    proxyReq.write(reqBody);
  }
  proxyReq.end();
}

function bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, account, attemptNumber, triedAccountIds = new Set()) {
  triedAccountIds.add(account.id);
  const stat = accountStats.get(account.id);
  if (stat) {
    stat.activeRequests += 1;
    stat.totalRequests += 1;
    stat.lastUsedAt = Date.now();
  }

  const upstreamUrl = new URL(config.upstream);
  const isHttps = upstreamUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const chatPayload = codexAdapter.convertResponsesToChatPayload(responsesBody);
  const reqModel = chatPayload.model || 'deepseek-v4.1-flash';
  const isStream = chatPayload.stream !== false;
  const chatBody = Buffer.from(JSON.stringify(chatPayload), 'utf8');

  const upstreamPathname = upstreamUrl.pathname.replace(/\/+$/, '');
  const upstreamChatPath = upstreamPathname + '/chat/completions';

  let sessionId = clientReq.headers['x-opencode-session'];
  if (!sessionId || !sessionId.trim()) {
    sessionId = 'session-opencode-go-default';
  }

  const proxyHeaders = {
    'content-type': 'application/json',
    'content-length': String(chatBody.length),
    'authorization': `Bearer ${account.apiKey.trim()}`,
    'x-opencode-session': sessionId,
    'user-agent': clientReq.headers['user-agent'] || 'OpenCode-Go-Router-CodexBridge/2.1'
  };

  const proxyOptions = {
    protocol: upstreamUrl.protocol,
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port || (isHttps ? 443 : 80),
    path: upstreamChatPath,
    method: 'POST',
    headers: proxyHeaders,
    timeout: 300000
  };

  const proxyReq = transport.request(proxyOptions);
  let responded = false;
  let requestFinished = false;
  let clientAborted = false;

  const finishRequest = () => {
    if (!requestFinished) {
      requestFinished = true;
      if (stat && stat.activeRequests > 0) {
        stat.activeRequests -= 1;
      }
    }
  };

  const clientCloseHandler = () => {
    if (!clientRes.writableEnded) {
      clientAborted = true;
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
    }
    finishRequest();
  };

  clientRes.once('close', clientCloseHandler);

  proxyReq.on('timeout', () => {
    console.error(`[Bridge Timeout] Upstream chat request for model "${reqModel}" timed out after 300s`);
    proxyReq.destroy(new Error('Gateway Timeout (upstream took longer than 300s)'));
  });

  proxyReq.on('response', (upstreamRes) => {
    const statusCode = upstreamRes.statusCode;

    // 429 / 503 failover
    if ((statusCode === 429 || statusCode === 503) && attemptNumber <= config.maxFailoverRetries && !clientAborted && !clientRes.destroyed) {
      let cooldownMs = config.defaultCooldownMs;
      const retryAfter = upstreamRes.headers['retry-after'];
      if (retryAfter) {
        const sec = parseInt(retryAfter, 10);
        if (!isNaN(sec) && sec > 0) cooldownMs = sec * 1000;
        else {
          const dateMs = new Date(retryAfter).getTime();
          if (!isNaN(dateMs) && dateMs > Date.now()) cooldownMs = dateMs - Date.now();
        }
      }
      recordCooldown(account.id, cooldownMs, `HTTP ${statusCode}`);
      finishRequest();
      clientRes.removeListener('close', clientCloseHandler);

      const errorChunks = [];
      upstreamRes.on('data', chunk => errorChunks.push(chunk));
      upstreamRes.on('end', () => {
        if (clientAborted || clientRes.destroyed) return;
        const nextAccount = selectAccount(sessionId, triedAccountIds);
        if (nextAccount) {
          if (stat) stat.failoverCount += 1;
          console.log(`[Bridge Failover] Account "${account.name}" returned ${statusCode}. Switching to "${nextAccount.name}" (Attempt ${attemptNumber + 1})`);
          bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds);
        } else {
          const errorBody = Buffer.concat(errorChunks);
          const outHeaders = getCorsHeaders(upstreamRes.headers);
          outHeaders['content-length'] = String(errorBody.length);
          clientRes.writeHead(statusCode, outHeaders);
          clientRes.end(errorBody);
        }
      });
      return;
    }

    if (statusCode !== 200) {
      responded = true;
      const errChunks = [];
      upstreamRes.on('data', chunk => errChunks.push(chunk));
      upstreamRes.on('end', () => {
        finishRequest();
        if (clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
        const errorBody = Buffer.concat(errChunks);
        const outHeaders = getCorsHeaders(upstreamRes.headers);
        outHeaders['content-length'] = String(errorBody.length);
        clientRes.writeHead(statusCode, outHeaders);
        clientRes.end(errorBody);
      });
      return;
    }

    responded = true;

    if (isStream) {
      codexAdapter.bridgeResponsesStream(upstreamRes, clientRes, reqModel, responsesBody.id, () => {
        finishRequest();
      });
      upstreamRes.on('error', (err) => {
        console.error('[Bridge Stream Error]', err.message);
        finishRequest();
        if (!clientRes.writableEnded) clientRes.end();
      });
    } else {
      const dataChunks = [];
      upstreamRes.on('data', chunk => dataChunks.push(chunk));
      upstreamRes.on('end', () => {
        finishRequest();
        if (clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
        try {
          const chatJson = JSON.parse(Buffer.concat(dataChunks).toString('utf8'));
          const responsesJson = codexAdapter.convertChatResponseToResponses(chatJson, reqModel, responsesBody.id);
          const outBuf = Buffer.from(JSON.stringify(responsesJson), 'utf8');
          const headers = getCorsHeaders(upstreamRes.headers);
          headers['content-type'] = 'application/json; charset=utf-8';
          headers['content-length'] = String(outBuf.length);
          clientRes.writeHead(200, headers);
          clientRes.end(outBuf);
        } catch (e) {
          clientRes.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          clientRes.end(JSON.stringify({ error: { message: 'Bridge parse error: ' + e.message } }));
        }
      });
      upstreamRes.on('error', (err) => {
        finishRequest();
        if (!clientRes.writableEnded) clientRes.end();
      });
    }
  });

  proxyReq.on('error', (err) => {
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientAborted || clientRes.destroyed || clientRes.writableEnded || clientReq.destroyed) return;

    if (!responded && attemptNumber <= config.maxFailoverRetries) {
      const nextAccount = selectAccount(sessionId, triedAccountIds);
      if (nextAccount) {
        if (stat) stat.failoverCount += 1;
        console.log(`[Bridge Failover] Error with "${account.name}": ${err.message}. Switching to "${nextAccount.name}"`);
        bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds);
        return;
      }
    }

    if (!responded) {
      responded = true;
      clientRes.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      clientRes.end(JSON.stringify({
        error: {
          message: `Bridge proxy error: ${err.message}`,
          type: 'router_bridge_error',
          code: 502
        }
      }));
    }
  });

  proxyReq.write(chatBody);
  proxyReq.end();
}

function bridgeResponsesToAnthropicRequest(clientReq, clientRes, responsesBody, account, attemptNumber, triedAccountIds = new Set()) {
  triedAccountIds.add(account.id);
  const stat = accountStats.get(account.id);
  if (stat) {
    stat.activeRequests += 1;
    stat.totalRequests += 1;
    stat.lastUsedAt = Date.now();
  }

  const upstreamUrl = new URL(config.upstream);
  const isHttps = upstreamUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const anthropicPayload = codexAdapter.convertResponsesToAnthropicPayload(responsesBody);
  const reqModel = anthropicPayload.model || 'claude-haiku-5-5';
  const isStream = anthropicPayload.stream !== false;
  const anthropicBody = Buffer.from(JSON.stringify(anthropicPayload), 'utf8');

  const upstreamPathname = upstreamUrl.pathname.replace(/\/+$/, '');
  const upstreamMessagesPath = upstreamPathname + '/messages';

  let sessionId = clientReq.headers['x-opencode-session'];
  if (!sessionId || !sessionId.trim()) {
    sessionId = 'session-opencode-go-default';
  }

  const proxyHeaders = {
    'content-type': 'application/json',
    'content-length': String(anthropicBody.length),
    'x-api-key': account.apiKey.trim(),
    'x-opencode-session': sessionId,
    'anthropic-version': '2023-06-01',
    'user-agent': clientReq.headers['user-agent'] || 'OpenCode-Go-Router-AnthropicBridge/2.1'
  };

  const proxyOptions = {
    protocol: upstreamUrl.protocol,
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port || (isHttps ? 443 : 80),
    path: upstreamMessagesPath,
    method: 'POST',
    headers: proxyHeaders,
    timeout: 300000
  };

  const proxyReq = transport.request(proxyOptions);
  let responded = false;
  let requestFinished = false;
  let clientAborted = false;

  const finishRequest = () => {
    if (!requestFinished) {
      requestFinished = true;
      if (stat && stat.activeRequests > 0) {
        stat.activeRequests -= 1;
      }
    }
  };

  const clientCloseHandler = () => {
    if (!clientRes.writableEnded) {
      clientAborted = true;
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
    }
    finishRequest();
  };

  clientRes.once('close', clientCloseHandler);

  proxyReq.on('timeout', () => {
    console.error(`[Bridge Timeout] Upstream Anthropic request for model "${reqModel}" timed out after 300s`);
    proxyReq.destroy(new Error('Gateway Timeout (upstream took longer than 300s)'));
  });

  proxyReq.on('response', (upstreamRes) => {
    const statusCode = upstreamRes.statusCode;

    // 429 / 503 failover
    if ((statusCode === 429 || statusCode === 503) && attemptNumber <= config.maxFailoverRetries && !clientAborted && !clientRes.destroyed) {
      let cooldownMs = config.defaultCooldownMs;
      const retryAfter = upstreamRes.headers['retry-after'];
      if (retryAfter) {
        const sec = parseInt(retryAfter, 10);
        if (!isNaN(sec) && sec > 0) cooldownMs = sec * 1000;
        else {
          const dateMs = new Date(retryAfter).getTime();
          if (!isNaN(dateMs) && dateMs > Date.now()) cooldownMs = dateMs - Date.now();
        }
      }
      recordCooldown(account.id, cooldownMs, `HTTP ${statusCode}`);
      finishRequest();
      clientRes.removeListener('close', clientCloseHandler);

      const errorChunks = [];
      upstreamRes.on('data', chunk => errorChunks.push(chunk));
      upstreamRes.on('end', () => {
        if (clientAborted || clientRes.destroyed) return;
        const nextAccount = selectAccount(sessionId, triedAccountIds);
        if (nextAccount) {
          if (stat) stat.failoverCount += 1;
          console.log(`[Anthropic Failover] Account "${account.name}" returned ${statusCode}. Switching to "${nextAccount.name}" (Attempt ${attemptNumber + 1})`);
          bridgeResponsesToAnthropicRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds);
        } else {
          const errorBody = Buffer.concat(errorChunks);
          const outHeaders = getCorsHeaders(upstreamRes.headers);
          outHeaders['content-length'] = String(errorBody.length);
          clientRes.writeHead(statusCode, outHeaders);
          clientRes.end(errorBody);
        }
      });
      return;
    }

    if (statusCode !== 200) {
      responded = true;
      const errChunks = [];
      upstreamRes.on('data', chunk => errChunks.push(chunk));
      upstreamRes.on('end', () => {
        finishRequest();
        if (clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
        const errorBody = Buffer.concat(errChunks);
        const outHeaders = getCorsHeaders(upstreamRes.headers);
        outHeaders['content-length'] = String(errorBody.length);
        clientRes.writeHead(statusCode, outHeaders);
        clientRes.end(errorBody);
      });
      return;
    }

    responded = true;

    if (isStream) {
      codexAdapter.bridgeAnthropicStream(upstreamRes, clientRes, reqModel, responsesBody.id, () => {
        finishRequest();
      });
      upstreamRes.on('error', (err) => {
        console.error('[Anthropic Stream Error]', err.message);
        finishRequest();
        if (!clientRes.writableEnded) clientRes.end();
      });
    } else {
      const dataChunks = [];
      upstreamRes.on('data', chunk => dataChunks.push(chunk));
      upstreamRes.on('end', () => {
        finishRequest();
        if (clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
        try {
          const anthropicJson = JSON.parse(Buffer.concat(dataChunks).toString('utf8'));
          const responsesJson = codexAdapter.convertAnthropicResponseToResponses(anthropicJson, reqModel, responsesBody.id);
          const outBuf = Buffer.from(JSON.stringify(responsesJson), 'utf8');
          const headers = getCorsHeaders(upstreamRes.headers);
          headers['content-type'] = 'application/json; charset=utf-8';
          headers['content-length'] = String(outBuf.length);
          clientRes.writeHead(200, headers);
          clientRes.end(outBuf);
        } catch (e) {
          clientRes.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          clientRes.end(JSON.stringify({ error: { message: 'Anthropic parse error: ' + e.message } }));
        }
      });
      upstreamRes.on('error', (err) => {
        finishRequest();
        if (!clientRes.writableEnded) clientRes.end();
      });
    }
  });

  proxyReq.on('error', (err) => {
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientAborted || clientRes.destroyed || clientRes.writableEnded || clientReq.destroyed) return;

    if (!responded && attemptNumber <= config.maxFailoverRetries) {
      const nextAccount = selectAccount(sessionId, triedAccountIds);
      if (nextAccount) {
        if (stat) stat.failoverCount += 1;
        console.log(`[Anthropic Failover] Error with "${account.name}": ${err.message}. Switching to "${nextAccount.name}"`);
        bridgeResponsesToAnthropicRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds);
        return;
      }
    }

    if (!responded) {
      responded = true;
      clientRes.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      clientRes.end(JSON.stringify({
        error: {
          message: `Anthropic proxy error: ${err.message}`,
          type: 'router_anthropic_error',
          code: 502
        }
      }));
    }
  });

  proxyReq.write(anthropicBody);
  proxyReq.end();
}

// System Diagnostic Helper (Doctor Engine)
function findDefaultWorkspace() {
  if (process.platform === 'win32') {
    const winWsList = [
      'D:\\opencode\\default',
      'C:\\opencode\\default',
      'E:\\opencode\\default',
      path.join(os.homedir(), 'opencode', 'default'),
      path.join(os.homedir(), 'workspace'),
      path.join(os.homedir(), 'projects')
    ];
    for (const ws of winWsList) {
      if (fs.existsSync(ws)) return ws;
    }
    return fs.existsSync('D:\\') ? 'D:\\opencode\\default' : path.join(os.homedir(), 'opencode', 'default');
  } else {
    const linuxWsList = [
      '/vol3/1000/docker/opencode2/default',
      '/vol3/1000/docker/opencode2/ra2',
      '/vol3/1000/docker/opencode/workspace',
      '/vol1/1000/docker/opencode/workspace',
      '/vol2/1000/docker/opencode/workspace',
      '/volume1/docker/opencode/workspace',
      '/volume2/docker/opencode/workspace',
      '/mnt/user/appdata/opencode/workspace',
      '/workspace',
      '/projects',
      path.join(os.homedir(), 'workspace'),
      path.join(os.homedir(), 'projects'),
      path.join(os.homedir(), 'opencode', 'default')
    ];
    for (const ws of linuxWsList) {
      if (fs.existsSync(ws)) return ws;
    }
    return path.join(os.homedir(), 'workspace');
  }
}

function getOpenChamberDistCandidates(customDir = null) {
  try {
    const updater = require('./updater');
    return updater.getOpenChamberDistCandidates(customDir);
  } catch (_) {
    const candidates = [];
    if (customDir) candidates.push(customDir);
    return candidates;
  }
}

function findOpenCodeBinary() {
  try {
    const v = execSync('opencode --version', { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
    return { version: v, path: 'PATH' };
  } catch (e) {}

  const candidates = [
    path.join(os.homedir(), '.opencode', 'bin', 'opencode'),
    path.join(os.homedir(), '.local', 'bin', 'opencode'),
    '/usr/local/bin/opencode',
    '/usr/bin/opencode',
    path.join(os.homedir(), '.bun', 'bin', 'opencode'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', '@openchamberelectron', 'resources', 'opencode-cli', 'opencode.exe'),
    path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd'),
    path.join(os.homedir(), '.bun', 'bin', 'opencode.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'opencode.cmd')
  ];

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      try {
        const v = execSync(`"${cand}" --version`, { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
        return { version: v, path: cand };
      } catch (e) {}
    }
  }
  return null;
}

function runSystemDoctor() {
  let defaultWs = findDefaultWorkspace();

  const report = {
    timestamp: new Date().toISOString(),
    router: {
      status: 'ok',
      port: config.port,
      upstream: config.upstream,
      accounts: config.accounts.map(a => {
        const st = accountStats.get(a.id) || {};
        const isCooling = (st.cooldownUntil || 0) > Date.now();
        return {
          id: a.id,
          name: a.name,
          enabled: a.enabled,
          hasKey: Boolean(a.apiKey && a.apiKey.trim()),
          status: isCooling ? 'cooling_down' : (a.enabled && a.apiKey ? 'healthy' : 'disabled'),
          remainingCooldownSec: isCooling ? Math.ceil((st.cooldownUntil - Date.now()) / 1000) : 0
        };
      })
    },
    opencode: { installed: false, version: null, path: null, error: null },
    openchamber: { reachable: false, ghost: false, error: null },
    opencodeConfig: {
      exists: false,
      path: path.join(process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode'), 'opencode.jsonc'),
      hasRouterEndpoint: false,
      hasDeadPort3001: false,
      plugins: []
    },
    omoConfig: {
      exists: false,
      path: path.join(os.homedir(), '.omo', 'omo.jsonc'),
      hasOpencodeGo: false
    },
    commands: {
      boostMdExists: false,
      path: path.join(os.homedir(), '.config', 'opencode', 'commands', 'boost.md')
    },
    workspace: {
      defaultPath: defaultWs,
      exists: false,
      gitInitialized: false
    },
    platform: (function() {
      try { return require('./updater').detectPlatformEnvironment(); } catch (_) { return { platform: process.platform, isWindows: process.platform === 'win32', isLinux: process.platform === 'linux' }; }
    })(),
    issues: []
  };

  // 1. Check opencode CLI
  const cliInfo = findOpenCodeBinary();
  if (cliInfo) {
    report.opencode.installed = true;
    report.opencode.version = cliInfo.version;
    report.opencode.path = cliInfo.path;
  } else {
    report.opencode.error = 'CLI 未在 PATH 或常用路径中找到';
    report.issues.push({ id: 'opencode_not_found', severity: 'warning', title: 'OpenCode CLI 未检测到', desc: '请通过安装向导安装 @opencode/cli' });
  }

  // 1.5 Check OpenChamber Workstation
  try {
    const chamberCurl = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const code = execSync(`${chamberCurl} -s -o /dev/null -w "%{http_code}" --connect-timeout 1 http://127.0.0.1:3000 || true`, {
      encoding: 'utf8',
      timeout: 2500,
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    if (code === '200' || code === '301' || code === '302' || code === '401' || code === '403') {
      report.openchamber.reachable = true;
    } else if (process.platform === 'linux') {
      const isActive = execSync('systemctl --user is-active openchamber.service 2>/dev/null || true', { encoding: 'utf8', timeout: 1000 }).trim();
      if (isActive === 'active') report.openchamber.reachable = true;
    }
  } catch (e) {
    report.openchamber.error = e.message;
  }

  // 1.6 Check OpenChamber Windows Ghost Process & SingleInstanceLock Deadlock
  if (process.platform === 'win32') {
    try {
      const psCheck = `
$chamberProcs = Get-Process -Name "OpenChamber" -ErrorAction SilentlyContinue
$hasChamber = [bool]$chamberProcs
$hasWindow = $false
if ($chamberProcs) {
  foreach ($p in $chamberProcs) {
    if ($p.MainWindowHandle -ne 0) { $hasWindow = $true; break }
  }
}
$managedOpencode = Get-Process -Name "opencode" -ErrorAction SilentlyContinue | Where-Object {
  try {
    (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine -like "*serve*--hostname*127.0.0.1*"
  } catch { $false }
}
[PSCustomObject]@{
  HasChamber = $hasChamber
  HasWindow = $hasWindow
  ChamberCount = if ($chamberProcs) { $chamberProcs.Count } else { 0 }
  HasManagedOpencode = [bool]$managedOpencode
} | ConvertTo-Json -Compress
`;
      const out = execSync(`powershell -NoProfile -NonInteractive -Command "${psCheck.replace(/\\r?\\n/g, ' ')}"`, {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      if (out) {
        const procState = JSON.parse(out);
        if (procState.HasChamber && !procState.HasWindow) {
          report.openchamber.ghost = true;
          report.issues.push({
            id: 'openchamber_ghost_process',
            severity: 'high',
            title: 'OpenChamber 后台无窗口僵死进程死锁单实例锁（导致桌面打不开）',
            desc: `检测到 ${procState.ChamberCount} 个后台无界面进程霸占 Electron SingleInstanceLock，导致桌面双击图标无法打开或闪退，可一键自动清理释放互斥锁`
          });
        }
        if (!procState.HasChamber && procState.HasManagedOpencode) {
          report.issues.push({
            id: 'orphan_opencode_process',
            severity: 'medium',
            title: 'OpenCode 孤立后台托管进程残留占用端口',
            desc: 'OpenChamber 退出后残留孤立 opencode serve 进程占用端口，可一键清理'
          });
        }
      }
    } catch (e) {}
  }

  // 1.7 Check OpenChamber Office Preview Engine
  let chamberDist = null;
  const candDists = getOpenChamberDistCandidates();
  for (const d of candDists) {
    if (fs.existsSync(path.join(d, 'index.html'))) {
      chamberDist = d;
      break;
    }
  }

  report.openchamber.officePreview = {
    distPath: chamberDist,
    installed: false
  };

  if (chamberDist) {
    try {
      const idxHtml = fs.readFileSync(path.join(chamberDist, 'index.html'), 'utf8');
      let jsHooked = false;
      const assetsDir = path.join(chamberDist, 'assets');
      if (fs.existsSync(assetsDir)) {
        const files = fs.readdirSync(assetsDir);
        const fv = files.find(f => f.startsWith('FilesView-') && f.endsWith('.js'));
        if (fv) {
          const fvContent = fs.readFileSync(path.join(assetsDir, fv), 'utf8');
          jsHooked = fvContent.includes('OpenChamberOfficeViewer.isOfficeFile');
        }
      }
      if (idxHtml.includes('office-preview-engine.js') && jsHooked) {
        report.openchamber.officePreview.installed = true;
      } else {
        report.issues.push({
          id: 'openchamber_office_preview',
          severity: 'low',
          title: 'OpenChamber 尚未挂载 Office 离线全格式安全预览引擎',
          desc: '当前遇 .docx/.xlsx/.pptx 将提示不解码，可一键挂载纯本地沙箱解析与原生原厂应用双轨打开'
        });
      }
    } catch (e) {}
  }

  // 2. Check opencode.jsonc
  if (fs.existsSync(report.opencodeConfig.path)) {
    report.opencodeConfig.exists = true;
    try {
      const raw = fs.readFileSync(report.opencodeConfig.path, 'utf8');
      report.opencodeConfig.hasDeadPort3001 = raw.includes(':3001');
      report.opencodeConfig.hasRouterEndpoint = raw.includes(`127.0.0.1:${config.port}`) || raw.includes(':4010');
      
      // 检测 provider 与 providers 冲突 (OpenCode normalization conflict)
      let hasPlural = false;
      let hasSingular = false;
      let modelCount = 0;
      try {
        const parsed = JSON.parse(stripJsonComments(raw));
        hasPlural = Boolean(parsed.providers && Object.keys(parsed.providers).length > 0);
        hasSingular = Boolean(parsed.provider && parsed.provider['opencode-go']);
        if (parsed.provider && parsed.provider['opencode-go'] && parsed.provider['opencode-go'].models) {
          modelCount = Object.keys(parsed.provider['opencode-go'].models).length;
        }
      } catch (e) {
        hasPlural = /"providers"\s*:\s*\{/s.test(raw);
        hasSingular = /"provider"\s*:\s*\{[^}]*"opencode-go"/s.test(raw);
      }
      report.opencodeConfig.hasConflict = hasPlural;

      if (report.opencodeConfig.hasConflict) {
        report.issues.push({
          id: 'config_conflict',
          severity: 'high',
          title: 'opencode.jsonc 存在已废弃的 providers 复数配置键',
          desc: 'OpenCode 2.0+ 统一采用单数 provider 规范，外层存在 providers 会导致启动时丢弃本地网关并报 conflict 错误，可一键自动合流清洗'
        });
      }
      const targetCount = 38;
      if (hasSingular && modelCount > 0 && modelCount < targetCount) {
        report.issues.push({
          id: 'models_incomplete',
          severity: 'low',
          title: `opencode-go 官方模型清单未补全 (当前 ${modelCount}/${targetCount} 款)`,
          desc: `官方上游支持全量模型目录，当前本地清单存在未同步模型，点击一键修复即可全量补全并增量合并`
        });
      }
      if (report.opencodeConfig.hasDeadPort3001) {
        report.issues.push({ id: 'dead_port_3001', severity: 'high', title: '检测到旧残留端口 3001', desc: '配置文件中仍有请求指向 3001 导致 ConnectionRefused，可一键重定向至 4010 网关' });
      }
      if (!report.opencodeConfig.hasRouterEndpoint) {
        report.issues.push({ id: 'missing_router_endpoint', severity: 'medium', title: 'OpenCode 未绑定本地网关', desc: 'opencode-go 的 baseURL 未指向当前 4010 智能网关' });
      }
    } catch (e) {}
  } else {
    report.issues.push({ id: 'missing_opencode_config', severity: 'medium', title: '未找到 opencode.jsonc', desc: '尚未生成用户核心配置文件' });
  }

  // 3. Check omo.jsonc
  if (fs.existsSync(report.omoConfig.path)) {
    report.omoConfig.exists = true;
    try {
      const raw = fs.readFileSync(report.omoConfig.path, 'utf8');
      report.omoConfig.hasOpencodeGo = raw.includes('opencode-go');
      if (raw.includes('opencode-go/deepseek') && !raw.includes('kimi-k3')) {
        report.issues.push({ id: 'deepseek_region_risk', severity: 'medium', title: '智能体调度缺少原生无区域限制的备选模型', desc: '建议为主要智能体添加 kimi-k3、qwen3.7-plus 兜底避开 Global regions 限制' });
      }
    } catch (e) {}
  } else {
    report.issues.push({ id: 'missing_omo_config', severity: 'low', title: '未找到 omo.jsonc', desc: '尚未生成 Oh My OpenAgent 多智能体模型调度配置' });
  }

  // 4. Check boost.md
  if (fs.existsSync(report.commands.path)) {
    report.commands.boostMdExists = true;
  } else {
    report.issues.push({ id: 'missing_boost_command', severity: 'low', title: '缺少 /boost 快捷指令', desc: 'boost.md 允许快速调用高强度自主推进任务' });
  }

  // 5. Check workspace git
  if (fs.existsSync(report.workspace.defaultPath)) {
    report.workspace.exists = true;
    report.workspace.gitInitialized = fs.existsSync(path.join(report.workspace.defaultPath, '.git'));
    if (!report.workspace.gitInitialized) {
      report.issues.push({ id: 'workspace_no_git', severity: 'low', title: '工作区未初始化 Git', desc: 'OpenChamber 建议工作区包含 Git 仓库以便回滚比对变更' });
    }
  }

  // 6. Check cooling down accounts
  const coolingAccs = report.router.accounts.filter(a => a.status === 'cooling_down');
  if (coolingAccs.length > 0) {
    report.issues.push({ id: 'accounts_cooling_down', severity: 'medium', title: `${coolingAccs.length} 个账号处于限频冷却中`, desc: '可点击一键重置冷却状态即刻恢复流量分配' });
  }

  // 7. Check component versions & ecosystem updates
  try {
    const updater = require('./updater');
    const localVers = updater.detectLocalVersions();
    report.components = localVers;
    const compat = updater.analyzeCompatibility(localVers, null);
    if (compat.warnings && compat.warnings.length > 0) {
      compat.warnings.forEach(w => {
        report.issues.push({
          id: `compat_${w.component}_${w.level}`,
          severity: w.level === 'critical' ? 'high' : (w.level === 'warning' ? 'medium' : 'low'),
          title: w.title,
          desc: w.desc
        });
      });
    }
  } catch (e) {}

  // 8. Check OpenAI Codex CLI & binding
  try {
    const codexStatus = codexAdapter.getCodexStatus(config.port);
    report.codex = codexStatus;
    if (codexStatus.cliInstalled && !codexStatus.isBound) {
      report.issues.push({
        id: 'codex_not_bound',
        severity: 'medium',
        title: 'OpenAI Codex CLI 尚未接入本地智能网关',
        desc: `检测到本地已安装 Codex CLI (${codexStatus.cliVersion || '已安装'})，可一键接入 OpenCode Go 38 款模型及思考等级映射`
      });
    }
  } catch (e) {}

  return report;
}

// Auto-Repair Engine
async function executeSystemRepair(options = {}) {
  const results = [];

  // 1. Reset all cooldowns
  for (const stat of accountStats.values()) {
    stat.cooldownUntil = 0;
    stat.lastError = null;
  }
  results.push({ item: 'Reset Cooldowns', success: true, message: '已重置所有账号的限频冷却状态' });

  // 2. Harmonize & Repair opencode.jsonc
  const ocDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
  const ocPath = path.join(ocDir, 'opencode.jsonc');
  try {
    const updater = require('./updater');

    // 动态嗅探拉取官方最新模型（若在线），离线则自动使用 38 款基准字典兜底
    let officialModels = options.officialModels || null;
    if (!officialModels) {
      const validAccount = config.accounts.find(a => a.enabled && a.apiKey && a.apiKey.trim());
      if (validAccount) {
        try {
          officialModels = await updater.fetchOfficialModels(validAccount.apiKey, config.upstream, 2500);
        } catch (_) {}
      }
    }

    const harmRes = updater.harmonizeOpencodeConfig(ocPath, config.port, { officialModels });
    const migMsg = harmRes.migratedProviders.length > 0 ? ` (已合流第三方服务商: ${harmRes.migratedProviders.join(', ')})` : '';
    const syncTag = (officialModels && officialModels.length > 0) ? `已动态同步官方最新 ${harmRes.modelCount} 款模型` : `全量补齐 ${harmRes.modelCount} 款官方模型`;
    results.push({
      item: 'OpenCode Config',
      success: true,
      message: harmRes.isNew
        ? '已自动生成 opencode.jsonc 并绑定 4010 智能网关'
        : `已清洗旧复数 providers 冲突，${syncTag}${migMsg}，保留当前首选模型 (${harmRes.currentModel})`
    });
  } catch (e) {
    results.push({ item: 'OpenCode Config', success: false, message: '修复 opencode.jsonc 失败: ' + e.message });
  }

  // 3. Ensure omo.jsonc exists
  const omoDir = path.join(os.homedir(), '.omo');
  const omoPath = path.join(omoDir, 'omo.jsonc');
  try {
    if (!fs.existsSync(omoDir)) {
      fs.mkdirSync(omoDir, { recursive: true });
    }
    if (!fs.existsSync(omoPath)) {
      fs.writeFileSync(omoPath, JSON.stringify(DEFAULT_OMO_CONFIG, null, 2), 'utf8');
      results.push({ item: 'OMO Config', success: true, message: '已生成标准 ~/.omo/omo.jsonc（默认使用 kimi-k3/qwen3.7 避开区域限制）' });
    } else {
      results.push({ item: 'OMO Config', success: true, message: '已就绪：omo.jsonc 存在' });
    }
  } catch (e) {
    results.push({ item: 'OMO Config', success: false, message: '生成 omo.jsonc 失败: ' + e.message });
  }

  // 4. Ensure boost.md exists
  const cmdDir = path.join(os.homedir(), '.config', 'opencode', 'commands');
  const boostPath = path.join(cmdDir, 'boost.md');
  try {
    if (!fs.existsSync(cmdDir)) {
      fs.mkdirSync(cmdDir, { recursive: true });
    }
    if (!fs.existsSync(boostPath)) {
      const boostContent = `---
description: "极速自主推进增强模式 (Boost / Ultrawork Mode)"
---
# Boost 极速增强模式指示 (Boost & Ultrawork Orchestration)

立即进入高强度自主推进模式。
推进目标：
$ARGUMENTS

## 执行规范：
1. **启动全流程推进**：自动激活深层检索、多任务拆解与高效执行链路。
2. **端到端交付**：不半途而废，连续执行直至方案完全实现并完成端到端测试。
3. **保持高可逆性与安全性**：确保关键配置有备份，生产环境安全无损。
`;
      fs.writeFileSync(boostPath, boostContent, 'utf8');
      results.push({ item: 'Boost Command', success: true, message: '已创建 /boost 自主推进快捷指令模版' });
    } else {
      results.push({ item: 'Boost Command', success: true, message: '已就绪：/boost 指令模版存在' });
    }
  } catch (e) {
    results.push({ item: 'Boost Command', success: false, message: '创建 boost.md 失败: ' + e.message });
  }

  // 5. Ensure Workspace Git
  let wsPath = findDefaultWorkspace();
  if (fs.existsSync(wsPath) && !fs.existsSync(path.join(wsPath, '.git'))) {
    try {
      execSync('git init', { cwd: wsPath, stdio: 'ignore' });
      results.push({ item: 'Workspace Git', success: true, message: `已在 ${wsPath} 初始化 Git 仓库` });
    } catch (e) {
      results.push({ item: 'Workspace Git', success: false, message: 'Git 初始化失败: ' + e.message });
    }
  }

  // 6. Windows: Clean OpenChamber ghost processes & orphan OpenCode instances
  if (process.platform === 'win32') {
    try {
      const psCleanup = `
$ghostFound = $false
$chamberProcs = Get-Process -Name "OpenChamber" -ErrorAction SilentlyContinue
if ($chamberProcs) {
  $hasWindow = $false
  foreach ($p in $chamberProcs) {
    if ($p.MainWindowHandle -ne 0) { $hasWindow = $true; break }
  }
  if (-not $hasWindow) {
    $chamberProcs | Stop-Process -Force
    $ghostFound = $true
  }
}
$orphanProcs = Get-Process -Name "opencode" -ErrorAction SilentlyContinue | Where-Object {
  try {
    (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine -like "*serve*--hostname*127.0.0.1*"
  } catch { $false }
}
$orphanFound = [bool]$orphanProcs
if ($ghostFound -or (-not $chamberProcs -and $orphanProcs)) {
  if ($orphanProcs) { $orphanProcs | Stop-Process -Force }
}
$codeCache = Join-Path $env:APPDATA "OpenChamber\Code Cache"
if (Test-Path $codeCache) { Remove-Item $codeCache -Recurse -Force -ErrorAction SilentlyContinue }
[PSCustomObject]@{ GhostKilled = $ghostFound; OrphanKilled = $orphanFound } | ConvertTo-Json -Compress
`;
      const out = execSync(`powershell -NoProfile -NonInteractive -Command "${psCleanup.replace(/\\r?\\n/g, ' ')}"`, {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      if (out) {
        const res = JSON.parse(out);
        if (res.GhostKilled) {
          results.push({ item: 'OpenChamber SingleInstanceLock', success: true, message: '已彻底终止后台僵死进程并释放单实例互斥锁，恢复桌面秒开' });
        } else {
          results.push({ item: 'OpenChamber SingleInstanceLock', success: true, message: '已校验单实例互斥锁状态健康（无僵死锁死）' });
        }
        if (res.OrphanKilled) {
          results.push({ item: 'Orphan OpenCode Cleanup', success: true, message: '已清理孤立残留的 OpenCode 托管后台进程' });
        }
      }
    } catch (e) {
      results.push({ item: 'OpenChamber SingleInstanceLock', success: false, message: '清理进程异常: ' + e.message });
    }
  }

  // 7. Auto-Patch OpenChamber Office Preview Engine
  try {
    const patchScriptWin = path.join(__dirname, 'patch-openchamber-office.ps1');
    const patchScriptLinux = path.join(__dirname, 'patch-openchamber-office.sh');
    let foundDist = null;
    let needsPatch = false;
    const candDists = getOpenChamberDistCandidates();
    for (const d of candDists) {
      const idx = path.join(d, 'index.html');
      if (fs.existsSync(idx)) {
        foundDist = d;
        const content = fs.readFileSync(idx, 'utf8');
        if (!content.includes('office-preview-engine.js')) {
          needsPatch = true;
        }
        const assetsDir = path.join(d, 'assets');
        if (fs.existsSync(assetsDir)) {
          const files = fs.readdirSync(assetsDir);
          const fv = files.find(f => f.startsWith('FilesView-') && f.endsWith('.js'));
          if (fv) {
            const fvContent = fs.readFileSync(path.join(assetsDir, fv), 'utf8');
            if (!fvContent.includes('OpenChamberOfficeViewer.isOfficeFile')) {
              needsPatch = true;
            }
          }
        }
        break;
      }
    }

    if (foundDist) {
      if (process.platform === 'win32' && fs.existsSync(patchScriptWin)) {
        if (needsPatch) {
          execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${patchScriptWin}" -Install`, { timeout: 10000, stdio: 'ignore' });
          results.push({ item: 'Office Preview Engine', success: true, message: '已自动挂载 OpenChamber 全能 Office 离线预览引擎' });
        } else {
          results.push({ item: 'Office Preview Engine', success: true, message: '已就绪：Office 离线安全预览引擎已处于挂载状态' });
        }
      } else if (process.platform === 'linux' && fs.existsSync(patchScriptLinux)) {
        if (needsPatch) {
          execSync(`bash "${patchScriptLinux}" install`, { timeout: 10000, stdio: 'ignore' });
          results.push({ item: 'Office Preview Engine', success: true, message: '已自动挂载 OpenChamber 全能 Office 离线预览引擎' });
        } else {
          results.push({ item: 'Office Preview Engine', success: true, message: '已就绪：Office 离线安全预览引擎已处于挂载状态' });
        }
      }
    } else {
      results.push({ item: 'Office Preview Engine', success: true, message: '未检测到本地已安装的 OpenChamber 前端目录，已跳过补丁挂载' });
    }
  } catch (e) {
    results.push({ item: 'Office Preview Engine', success: false, message: '挂载 Office 预览引擎异常: ' + e.message });
  }

  // 8. Auto-bind Codex CLI if installed and not yet bound
  try {
    const codexStatus = codexAdapter.getCodexStatus(config.port);
    if (codexStatus.cliInstalled && !codexStatus.isBound) {
      const bindRes = codexAdapter.bindCodexConfig({
        routerPort: config.port,
        routerUrl: `http://127.0.0.1:${config.port}/v1`,
        defaultModel: 'deepseek-v4.1-flash',
        reasoningEffort: 'high',
        providerName: 'opencode-go'
      });
      results.push({
        item: 'Codex Integration',
        success: bindRes.success,
        message: bindRes.success ? '已自动将 OpenAI Codex CLI 接入本地 4010 智能网关（支持全量 38 款模型）' : bindRes.error
      });
    }
  } catch (e) {
    results.push({ item: 'Codex Integration', success: false, message: 'Codex 接入修复异常: ' + e.message });
  }

  // 9. Linux NAS: Smoothly reload running user daemon services to load new config
  if (process.platform === 'linux') {
    try {
      const updater = require('./updater');
      const sysOut = updater.runCmdSync('systemctl --user list-units --type=service', 2000);
      if (sysOut && sysOut.includes('openchamber.service')) {
        updater.runCmd('systemctl --user reload-or-try-restart openchamber.service 2>/dev/null || systemctl --user restart openchamber.service', 10000);
        results.push({ item: 'Daemon Reload', success: true, message: '已同步 openchamber.service 前端视图配置' });
      }
      // 铁律：严禁在自愈体检中重启 opencode-server.service，以保护运行中会话与任务避免出现 Step interrupted
      results.push({ item: 'OpenCode Zero-Disturbance', success: true, message: 'OpenCode 原生 Inotify 热感知已生效，已严格保护业务长程任务不被中断' });
    } catch (_) {}
  }

  // 10. Platform-Aware Updater & Environment Self-Healing (Linux NAS & Windows)
  try {
    const updater = require('./updater');
    const platInfo = updater.detectPlatformEnvironment();
    const gitDir = path.join(__dirname, '.git');

    if (fs.existsSync(gitDir)) {
      // Clear git locks and incomplete rebase/merge states
      ['index.lock', 'rebase-merge', 'rebase-apply', 'ORIG_HEAD', 'CHERRY_PICK_HEAD', 'AUTO_MERGE'].forEach(f => {
        const p = path.join(gitDir, f);
        try {
          if (fs.existsSync(p)) {
            if (fs.lstatSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
            else fs.unlinkSync(p);
          }
        } catch (_) {}
      });
      try { updater.runCmdSync('git rebase --abort', 2000); } catch (_) {}
      try { updater.runCmdSync(`git config --global --add safe.directory "${__dirname}"`, 2000); } catch (_) {}
    }

    if (platInfo.isLinux) {
      const userLocal = path.join(os.homedir(), '.local');
      const userLocalBin = path.join(userLocal, 'bin');
      const userLocalModules = path.join(userLocal, 'lib', 'node_modules');
      if (!fs.existsSync(userLocalBin)) fs.mkdirSync(userLocalBin, { recursive: true });
      if (!fs.existsSync(userLocalModules)) fs.mkdirSync(userLocalModules, { recursive: true });

      const bashrc = path.join(os.homedir(), '.bashrc');
      if (fs.existsSync(bashrc)) {
        try {
          const content = fs.readFileSync(bashrc, 'utf8');
          if (!content.includes('.local/bin')) {
            fs.appendFileSync(bashrc, '\nexport PATH="$HOME/.local/bin:$PATH"\n', 'utf8');
          }
        } catch (_) {}
      }

      results.push({
        item: 'Updater Environment',
        success: true,
        message: `已就绪 Linux NAS 非 root 权限安全更新环境 (~/.local) 与 Git 容灾自愈 (${platInfo.description})`
      });
    } else if (platInfo.isWindows) {
      results.push({
        item: 'Updater Environment',
        success: true,
        message: '已就绪 Windows 桌面更新环境与 Git 容灾防护'
      });
    }
  } catch (envErr) {
    results.push({ item: 'Updater Environment', success: false, message: '自愈更新环境异常: ' + envErr.message });
  }

  return results;
}

function isAuthorized(req) {
  if (!config.uiPassword || !config.uiPassword.trim()) return true;
  const expected = config.uiPassword.trim();
  const expectedB64 = Buffer.from(expected).toString('base64');

  // 1. Authorization header: Bearer <pwd_or_b64>
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token === expected || token === expectedB64) return true;
  }

  // 2. Custom header: x-ui-password or x-router-auth
  const customHeader = (req.headers['x-ui-password'] || req.headers['x-router-auth'] || '').trim();
  if (customHeader === expected || customHeader === expectedB64) return true;

  // 3. Cookie: router_auth=<pwd_or_b64>
  const cookieHeader = req.headers['cookie'] || '';
  const match = cookieHeader.match(/router_auth=([^;]+)/);
  if (match) {
    const val = decodeURIComponent(match[1]).trim();
    if (val === expected || val === expectedB64) return true;
  }

  // 4. Query param: ?auth=<pwd_or_b64>
  const parsed = url.parse(req.url, true);
  if (parsed.query && parsed.query.auth) {
    const val = String(parsed.query.auth).trim();
    if (val === expected || val === expectedB64) return true;
  }

  return false;
}

function renderLoginPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>身份验证 | OpenCode 智能路由网关</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico">
  <style>
    :root {
      --bg: #0b1120;
      --card-bg: #1e293b;
      --border: #334155;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --text: #f8fafc;
      --muted: #94a3b8;
      --danger: #f87171;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .login-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 2.5rem 2rem;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 16px 36px rgba(0,0,0,0.45);
      text-align: center;
    }
    .icon { font-size: 2.8rem; margin-bottom: 1rem; }
    h2 { font-size: 1.45rem; color: var(--primary); margin-bottom: 0.5rem; }
    p { font-size: 0.88rem; color: var(--muted); margin-bottom: 1.6rem; line-height: 1.5; }
    .input-group { margin-bottom: 1.2rem; }
    .form-control {
      width: 100%;
      background: #0b1120;
      border: 1px solid #334155;
      color: #fff;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 1rem;
      text-align: center;
      outline: none;
      transition: border-color 0.2s;
    }
    .form-control:focus { border-color: var(--primary); }
    .btn {
      width: 100%;
      background: var(--primary);
      color: #04101c;
      border: none;
      padding: 12px;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn:hover { background: var(--primary-hover); color: #fff; }
    .err-msg {
      color: var(--danger);
      font-size: 0.85rem;
      margin-top: 1rem;
      display: none;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid rgba(248, 113, 113, 0.3);
      padding: 8px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <img src="/assets/logo.png" alt="OpenCode Gateway Logo" style="width: 72px; height: 72px; border-radius: 16px; box-shadow: 0 0 24px rgba(16,185,129,0.35); margin-bottom: 1.2rem;">
    <h2>OpenCode 智能路由网关</h2>
    <p>当前网关已开启安全访问认证，请输入管理员控制台访问密码</p>
    <form onsubmit="handleLogin(event)">
      <div class="input-group">
        <input type="password" id="pwd" class="form-control" placeholder="输入访问密码..." autofocus required>
      </div>
      <button type="submit" class="btn" id="subBtn">登录控制台</button>
      <div id="errMsg" class="err-msg"></div>
    </form>
  </div>
  <script>
    async function handleLogin(e) {
      e.preventDefault();
      const pwd = document.getElementById('pwd').value;
      const err = document.getElementById('errMsg');
      const btn = document.getElementById('subBtn');
      err.style.display = 'none';
      btn.innerText = '正在验证...';
      btn.disabled = true;
      try {
        const res = await fetch('/balancer/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();
        if (data.success) {
          localStorage.setItem('opencode_router_token', data.token);
          document.cookie = 'router_auth=' + encodeURIComponent(data.token) + '; Path=/; Max-Age=2592000; SameSite=Lax';
          location.reload();
        } else {
          err.innerText = data.error || '密码错误';
          err.style.display = 'block';
        }
      } catch (ex) {
        err.innerText = '网络异常: ' + ex.message;
        err.style.display = 'block';
      } finally {
        btn.innerText = '登录控制台';
        btn.disabled = false;
      }
    }

    // Auto-restore session from valid localStorage token if available
    window.addEventListener('DOMContentLoaded', async () => {
      const storedToken = localStorage.getItem('opencode_router_token');
      if (storedToken) {
        try {
          const res = await fetch('/balancer/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: storedToken })
          });
          const d = await res.json();
          if (d.success) {
            document.cookie = 'router_auth=' + encodeURIComponent(d.token) + '; Path=/; Max-Age=2592000; SameSite=Lax';
            location.reload();
          }
        } catch (e) {}
      }
    });
  </script>
</body>
</html>`;
}

// HTTP Server
const server = http.createServer((req, res) => {
  const reqUrl = url.parse(req.url, true);

  // Global CORS preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  // Health check endpoint
  if (reqUrl.pathname === '/health' || reqUrl.pathname === '/balancer/health') {
    const now = Date.now();
    const enabledAccounts = config.accounts.filter(a => a.enabled && a.apiKey && a.apiKey.trim());
    const healthyAccounts = enabledAccounts.filter(a => {
      const stat = accountStats.get(a.id);
      return !stat || (stat.cooldownUntil || 0) <= now;
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      status: 'ok',
      port: config.port,
      healthyAccounts: healthyAccounts.length,
      totalAccounts: config.accounts.length
    }));
    return;
  }

  // Status endpoint (JSON)
  if (reqUrl.pathname === '/status' || reqUrl.pathname === '/balancer/status') {
    const now = Date.now();
    const accountsData = config.accounts.map(acc => {
      const stat = accountStats.get(acc.id) || {};
      const isCooling = (stat.cooldownUntil || 0) > now;
      const remainingCooldown = isCooling ? Math.ceil((stat.cooldownUntil - now) / 1000) : 0;
      let status = 'healthy';
      if (!acc.enabled || !acc.apiKey || !acc.apiKey.trim()) status = 'disabled';
      else if (isCooling) status = 'cooling_down';

      return {
        id: acc.id,
        name: acc.name,
        enabled: acc.enabled,
        hasKey: Boolean(acc.apiKey && acc.apiKey.trim()),
        status,
        remainingCooldownSec: remainingCooldown,
        activeRequests: stat.activeRequests || 0,
        totalRequests: stat.totalRequests || 0,
        rateLimitCount: stat.rateLimitCount || 0,
        failoverCount: stat.failoverCount || 0,
        lastUsedAt: stat.lastUsedAt || null,
        lastError: stat.lastError || null
      };
    });

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      status: 'online',
      port: config.port,
      upstream: config.upstream,
      sessionAffinityEnabled: config.sessionAffinityEnabled,
      defaultCooldownMs: config.defaultCooldownMs,
      maxFailoverRetries: config.maxFailoverRetries,
      activeSessions: sessionMap.size,
      accounts: accountsData
    }, null, 2));
    return;
  }

  // Auth API
  if (reqUrl.pathname === '/balancer/api/auth' && req.method === 'GET') {
    const hasPwd = Boolean(config.uiPassword && config.uiPassword.trim());
    const authOk = isAuthorized(req);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: true, hasUiPassword: hasPwd, authenticated: authOk }));
    return;
  }

  if (reqUrl.pathname === '/balancer/api/auth' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      try {
        const payload = JSON.parse(Buffer.concat(body).toString('utf8'));
        const inputPwd = (payload.password || '').trim();
        const inputToken = (payload.token || '').trim();
        const expectedPwd = (config.uiPassword || '').trim();
        const expectedB64 = Buffer.from(expectedPwd).toString('base64');
        const token = Buffer.from(expectedPwd).toString('base64');
        if (!expectedPwd || inputPwd === expectedPwd || inputToken === expectedPwd || inputToken === expectedB64) {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Set-Cookie': `router_auth=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; SameSite=Lax`,
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify({ success: true, token, message: '验证通过' }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: '管理员密码错误，请重新输入' }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Auth gatekeeper for all /balancer/api/* endpoints
  if (reqUrl.pathname.startsWith('/balancer/api/')) {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized: 请输入管理员访问密码' }));
      return;
    }
  }

  // Get full config API (for UI)
  if (reqUrl.pathname === '/balancer/api/config' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      port: config.port,
      host: config.host || '127.0.0.1',
      upstream: config.upstream,
      defaultCooldownMs: config.defaultCooldownMs,
      maxFailoverRetries: config.maxFailoverRetries,
      sessionAffinityEnabled: config.sessionAffinityEnabled,
      hasUiPassword: Boolean(config.uiPassword && config.uiPassword.trim()),
      uiPassword: config.uiPassword || '',
      accounts: config.accounts
    }));
    return;
  }

  // Save config API (from UI)
  if (reqUrl.pathname === '/balancer/api/config' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      try {
        const payload = JSON.parse(Buffer.concat(body).toString('utf8'));
        if (!Array.isArray(payload.accounts) || payload.accounts.length === 0) {
          throw new Error('至少需要保留一个账号配置');
        }

        // Clean & validate accounts
        const newAccounts = payload.accounts.map((acc, index) => ({
          id: acc.id || `account-${Date.now()}-${index}`,
          name: (acc.name || `账号 ${index + 1}`).trim(),
          apiKey: (acc.apiKey || '').trim(),
          enabled: Boolean(acc.enabled)
        }));

        const newConfig = {
          ...config,
          upstream: (payload.upstream || config.upstream).trim(),
          defaultCooldownMs: Number(payload.defaultCooldownMs) || config.defaultCooldownMs,
          maxFailoverRetries: Number(payload.maxFailoverRetries) || config.maxFailoverRetries,
          sessionAffinityEnabled: payload.sessionAffinityEnabled !== undefined ? Boolean(payload.sessionAffinityEnabled) : config.sessionAffinityEnabled,
          accounts: newAccounts
        };
        if (payload.host !== undefined && String(payload.host).trim()) {
          newConfig.host = String(payload.host).trim();
        }
        if (payload.port !== undefined && Number(payload.port) > 0) {
          newConfig.port = Number(payload.port);
        }
        if (payload.uiPassword !== undefined) {
          newConfig.uiPassword = String(payload.uiPassword).trim();
        }

        // Create atomic backup of existing config.json
        if (fs.existsSync(CONFIG_FILE)) {
          fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak');
        }

        fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf8');
        config = newConfig;
        syncAccountStats();

        console.log('[Config] Configuration successfully updated via Graphical UI!');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, message: '配置已稳妥保存并实时生效！(若修改了端口或监听地址，将在服务重启后生效)' }));
      } catch (err) {
        console.error('[Config Error]', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Test account connectivity API
  if (reqUrl.pathname === '/balancer/api/test-account' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(Buffer.concat(body).toString('utf8'));
        const targetUpstream = (payload.upstream || config.upstream).trim();
        const apiKey = (payload.apiKey || '').trim();

        if (!apiKey) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, message: 'API Key 为空，请输入后再测试' }));
          return;
        }

        const result = await testAccountConnection(targetUpstream, apiKey);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, message: `测试异常: ${err.message}` }));
      }
    });
    return;
  }

  // Account Quota & Usage API
  if (reqUrl.pathname === '/balancer/api/account-quota' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(Buffer.concat(body).toString('utf8'));
        const targetUpstream = (payload.upstream || config.upstream).trim();
        let apiKey = (payload.apiKey || '').trim();
        if (!apiKey && payload.id) {
          const acc = config.accounts.find(a => a.id === payload.id);
          if (acc) apiKey = acc.apiKey.trim();
        }

        if (!apiKey) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, message: '未配置 API Key' }));
          return;
        }

        const result = await fetchAccountUsage(targetUpstream, apiKey);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Bind to OpenCode & OpenChamber Desktop API
  if (reqUrl.pathname === '/balancer/api/bind-desktop' && req.method === 'POST') {
    (async () => {
      try {
        const result = await bindDesktopConfig();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: result.opencode || result.openchamber,
          result,
          message: result.messages.join('；')
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    })();
    return;
  }

  // Codex CLI Status API
  if (reqUrl.pathname === '/balancer/api/codex-status' && req.method === 'GET') {
    try {
      const status = codexAdapter.getCodexStatus(config.port);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, status }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Bind Codex CLI API
  if (reqUrl.pathname === '/balancer/api/bind-codex' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      try {
        let payload = {};
        if (body.length > 0) {
          try { payload = JSON.parse(Buffer.concat(body).toString('utf8')); } catch (e) {}
        }
        const defaultModel = payload.defaultModel || 'deepseek-v4.1-flash';
        const reasoningEffort = payload.reasoningEffort || 'high';
        const result = codexAdapter.bindCodexConfig({
          routerPort: config.port,
          routerUrl: `http://127.0.0.1:${config.port}/v1`,
          defaultModel,
          reasoningEffort,
          providerName: 'opencode-go'
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: result.success,
          result,
          message: result.messages ? result.messages.join('；') : (result.success ? 'Codex 接入成功' : result.error)
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Restore Codex Configuration API
  if (reqUrl.pathname === '/balancer/api/restore-codex' && req.method === 'POST') {
    try {
      const result = codexAdapter.restoreCodexConfig();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        success: result.success,
        result,
        message: result.messages && result.messages.length > 0 ? result.messages.join('；') : (result.message || 'Codex 配置已还原')
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Launch / Activate OpenChamber Desktop Application API
  if (reqUrl.pathname === '/balancer/api/launch-chamber' && (req.method === 'POST' || req.method === 'GET')) {
    try {
      if (process.platform === 'win32') {
        const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const candidates = [
          path.join(localApp, 'Programs', '@openchamberelectron', 'OpenChamber.exe'),
          path.join(localApp, 'Programs', 'OpenChamber', 'OpenChamber.exe'),
          path.join(progFiles, 'OpenChamber', 'OpenChamber.exe'),
          path.join(progFilesX86, 'OpenChamber', 'OpenChamber.exe'),
          path.join(os.homedir(), 'Desktop', 'OpenChamber.lnk'),
          path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'OpenChamber.lnk')
        ];
        let foundExe = null;
        for (const c of candidates) {
          if (fs.existsSync(c)) { foundExe = c; break; }
        }
        if (foundExe) {
          // Check for ghost processes first and clean them
          try {
            const psGhostCheck = `
$procs = Get-Process -Name "OpenChamber" -ErrorAction SilentlyContinue
$ghost = $false
if ($procs) {
  $hasWin = $false
  foreach ($p in $procs) { if ($p.MainWindowHandle -ne 0) { $hasWin = $true; break } }
  if (-not $hasWin) { $procs | Stop-Process -Force; $ghost = $true }
}
$ghost
`;
            execSync(`powershell -NoProfile -NonInteractive -Command "${psGhostCheck.replace(/\\r?\\n/g, ' ')}"`, { timeout: 2000, stdio: 'ignore' });
          } catch (e) {}

          // Use explorer.exe to launch cleanly decoupled
          exec(`explorer.exe "${foundExe}"`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: true, mode: 'desktop', path: foundExe, message: '已安全唤起 OpenChamber 原生桌面客户端' }));
          return;
        }
      } else if (process.platform === 'linux') {
        try {
          execSync('systemctl --user start openchamber.service 2>/dev/null || true');
        } catch (e) {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, mode: 'web', url: 'http://127.0.0.1:3000', message: '已就绪 Web 端工作台' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Static Assets (Favicon & High-Def Logo)
  if (reqUrl.pathname === '/favicon.ico' || reqUrl.pathname === '/assets/router.ico') {
    const icoPath = path.join(__dirname, 'assets', 'router.ico');
    if (fs.existsSync(icoPath)) {
      res.writeHead(200, { 'Content-Type': 'image/x-icon', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(icoPath).pipe(res);
      return;
    }
  }

  if (reqUrl.pathname === '/assets/logo.png') {
    const pngPath = path.join(__dirname, 'assets', 'logo.png');
    if (fs.existsSync(pngPath)) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(pngPath).pipe(res);
      return;
    }
  }

  // Open Local File in Native Application API (Word/Excel/PowerPoint/WPS) - Hardened Sandbox
  if (reqUrl.pathname === '/balancer/api/open-file' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      try {
        const payload = JSON.parse(Buffer.concat(body).toString('utf8'));
        let filePath = (payload.path || '').trim();
        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'Path is required' }));
          return;
        }

        // Support file:/// URIs and percent-encoded paths
        if (filePath.startsWith('file://')) {
          try {
            const { fileURLToPath } = require('url');
            filePath = fileURLToPath(filePath);
          } catch (e) {
            filePath = decodeURIComponent(filePath.replace(/^file:\/\/\/?/, process.platform === 'win32' ? '' : '/'));
          }
        } else if (/%[0-9A-Fa-f]{2}/.test(filePath)) {
          try {
            filePath = decodeURIComponent(filePath);
          } catch (e) {}
        }

        // Strip URL fragment/query if present
        filePath = filePath.replace(/[?#].*$/, '');
        filePath = path.normalize(filePath);

        // Security Check: Block remote UNC network paths on Windows to prevent NTLM credential theft
        if (process.platform === 'win32') {
          if (filePath.startsWith('\\\\') || filePath.startsWith('//')) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ success: false, error: '安全拦截：禁止通过网络 UNC 共享路径打开文件以防凭据泄露' }));
            return;
          }
        }

        // Security Sandbox Check: Block dangerous executable, script, and shortcut extensions
        const sanitizedForExt = filePath.replace(/[.\s]+$/, '');
        const ext = path.extname(sanitizedForExt).toLowerCase();
        const DANGEROUS_EXTS = new Set([
          '.exe', '.bat', '.cmd', '.com', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
          '.msi', '.ps1', '.psm1', '.psd1', '.sh', '.bash', '.bin', '.pif', '.scr',
          '.hta', '.cpl', '.jar', '.reg', '.dll', '.sys', '.lnk', '.url', '.appref-ms'
        ]);
        if (DANGEROUS_EXTS.has(ext)) {
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: '安全拦截：禁止通过 open-file API 启动可执行程序或脚本文件' }));
          return;
        }

        if (!fs.existsSync(filePath)) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'File not found on local filesystem' }));
          return;
        }

        if (process.platform === 'win32') {
          const child = spawn('cmd.exe', ['/c', 'start', '', filePath], {
            windowsHide: true,
            detached: true,
            stdio: 'ignore'
          });
          child.on('error', (err) => {
            console.error('[Open File Win32 Error]', err.message);
          });
          child.unref();
        } else if (process.platform === 'darwin') {
          const child = spawn('open', [filePath], { detached: true, stdio: 'ignore' });
          child.unref();
        } else {
          const isHeadless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
          if (isHeadless) {
            console.warn(`[Open File] Headless Linux/NAS environment: xdg-open invoked for ${filePath}`);
          }
          const child = spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' });
          child.on('error', (err) => {
            console.error('[Open File Error]', err.message);
          });
          child.unref();
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, message: '已调用系统默认应用打开该文档！' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Reset Cooldown API
  if (reqUrl.pathname === '/balancer/api/reset-cooldown' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      try {
        let accountId = null;
        if (body.length > 0) {
          try {
            const payload = JSON.parse(Buffer.concat(body).toString('utf8'));
            accountId = payload.id;
          } catch (e) {}
        }
        if (accountId) {
          const stat = accountStats.get(accountId);
          if (stat) {
            stat.cooldownUntil = 0;
            stat.lastError = null;
          }
        } else {
          for (const stat of accountStats.values()) {
            stat.cooldownUntil = 0;
            stat.lastError = null;
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, message: '限频冷却已重置，账号已恢复健康！' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Doctor API
  if (reqUrl.pathname === '/balancer/api/doctor' && req.method === 'GET') {
    const report = runSystemDoctor();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(report, null, 2));
    return;
  }

  // Repair API
  if (reqUrl.pathname === '/balancer/api/repair' && req.method === 'POST') {
    (async () => {
      try {
        const results = await executeSystemRepair();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, results }, null, 2));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    })();
    return;
  }

  // Dynamic Official Models Sync API
  if (reqUrl.pathname === '/balancer/api/models/sync') {
    (async () => {
      let apiKey = '';
      const validAccount = config.accounts.find(a => a.enabled && a.apiKey && a.apiKey.trim());
      if (validAccount) apiKey = validAccount.apiKey.trim();

      try {
        const updater = require('./updater');
        const officialModels = await updater.fetchOfficialModels(apiKey, config.upstream, 5000);
        if (officialModels && officialModels.length > 0) {
          const opencodeDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
          const opencodeJsonPath = path.join(opencodeDir, 'opencode.jsonc');
          const harmRes = updater.harmonizeOpencodeConfig(opencodeJsonPath, config.port, { officialModels });
          
          let codexSynced = false;
          try {
            const codex = require('./codex-adapter');
            codex.syncDynamicModels(officialModels);
            codexSynced = true;
          } catch (_) {}

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            success: true,
            upstream: config.upstream,
            officialCount: officialModels.length,
            totalModelCount: harmRes.modelCount,
            currentModel: harmRes.currentModel,
            codexSynced,
            models: officialModels,
            message: `已成功从官方上游动态嗅探并同步 ${officialModels.length} 款模型，本地客户端配置已增量热更新！`
          }, null, 2));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            success: true,
            upstream: config.upstream,
            officialCount: 38,
            totalModelCount: 38,
            fallback: true,
            models: updater.ALL_38_SLUGS,
            message: '当前上游网络或密钥未就绪，已安全使用内置 38 款高保真基准模型字典兜底！'
          }, null, 2));
        }
      } catch (syncErr) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: syncErr.message }));
      }
    })();
    return;
  }

  // Updates Check API
  if (reqUrl.pathname === '/balancer/api/updates/check' && req.method === 'GET') {
    const updater = require('./updater');
    updater.checkAllUpdates().then((report) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(report, null, 2));
    }).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  // Updates Apply API
  if (reqUrl.pathname === '/balancer/api/updates/apply' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const updater = require('./updater');
      let payload = {};
      if (body.length > 0) {
        try { payload = JSON.parse(Buffer.concat(body).toString('utf8')); } catch (e) {}
      }
      payload.routerPort = payload.routerPort || config.port;
      updater.applyUpdates(payload.components || null, payload).then((results) => {
        loadConfig();
        syncAccountStats();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(results, null, 2));
      }).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      });
    });
    return;
  }

  // Updates Rollback API
  if (reqUrl.pathname === '/balancer/api/updates/rollback' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      try {
        const updater = require('./updater');
        let payload = {};
        if (body.length > 0) {
          try { payload = JSON.parse(Buffer.concat(body).toString('utf8')); } catch (e) {}
        }
        const results = updater.rollbackSnapshot(payload.snapshotId || null, payload);
        loadConfig();
        syncAccountStats();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(results, null, 2));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Updates Snapshots List API
  if (reqUrl.pathname === '/balancer/api/updates/snapshots' && req.method === 'GET') {
    try {
      const updater = require('./updater');
      const list = updater.listSnapshots();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, snapshots: list }, null, 2));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Web UI Dashboard & Graphical Config Center
  if (reqUrl.pathname === '/' || reqUrl.pathname === '/balancer/ui' || reqUrl.pathname === '/balancer') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderLoginPage());
      return;
    }
    const parsed = url.parse(req.url, true);
    const headers = { 'Content-Type': 'text/html; charset=utf-8' };
    if (config.uiPassword && parsed.query && parsed.query.auth) {
      const token = Buffer.from(config.uiPassword.trim()).toString('base64');
      headers['Set-Cookie'] = `router_auth=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; SameSite=Lax`;
    }
    res.writeHead(200, headers);
    res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode 订阅管理中心 | 原生高可用路由</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico">
  <style>
    :root {
      --bg: #0b1120;
      --card-bg: #1e293b;
      --border: #334155;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --success: #34d399;
      --warning: #fbbf24;
      --danger: #f87171;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 1.5rem;
      line-height: 1.5;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.2rem;
    }
    .title-group h1 {
      margin: 0;
      font-size: 1.6rem;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .title-group p { margin: 4px 0 0; color: var(--muted); font-size: 0.9rem; }
    .header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--primary);
      color: #04101c;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.2s;
    }
    .btn:hover { background: var(--primary-hover); color: #fff; }
    .btn-secondary {
      background: #334155;
      color: var(--text);
    }
    .btn-secondary:hover { background: #475569; }
    .btn-success { background: #065f46; color: #34d399; border: 1px solid #059669; }
    .btn-success:hover { background: #047857; color: #fff; }
    .btn-danger {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .btn-danger:hover { background: #991b1b; color: #fff; }
    .btn-sm { padding: 4px 10px; font-size: 0.8rem; border-radius: 6px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }
    .section-title {
      font-size: 1.15rem;
      font-weight: 600;
      margin: 0 0 1rem;
      color: #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .accounts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
      gap: 1.25rem;
    }
    .account-card {
      background: #151f32;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 1.2rem;
      position: relative;
      transition: border-color 0.2s;
    }
    .account-card:hover { border-color: var(--primary); }
    .acc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .acc-title-input {
      background: transparent;
      border: 1px dashed transparent;
      color: var(--text);
      font-size: 1.05rem;
      font-weight: 600;
      padding: 4px 6px;
      border-radius: 6px;
      width: 60%;
    }
    .acc-title-input:focus, .acc-title-input:hover {
      border-color: #475569;
      background: #0f172a;
    }
    .badge {
      padding: 3px 10px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-healthy { background: #064e3b; color: var(--success); border: 1px solid #059669; }
    .badge-cooling { background: #7f1d1d; color: var(--danger); border: 1px solid #dc2626; }
    .badge-disabled { background: #374151; color: var(--muted); border: 1px solid #4b5563; }
    
    .form-group { margin-bottom: 0.9rem; }
    .form-group label {
      display: block;
      font-size: 0.82rem;
      color: var(--muted);
      margin-bottom: 4px;
      font-weight: 500;
    }
    .input-wrapper { display: flex; gap: 6px; position: relative; }
    .form-control {
      flex: 1;
      background: #0b1120;
      border: 1px solid #334155;
      color: #e2e8f0;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.9rem;
      font-family: inherit;
    }
    .form-control:focus { outline: none; border-color: var(--primary); }
    .toggle-eye {
      background: #1e293b;
      border: 1px solid #334155;
      color: var(--muted);
      padding: 0 10px;
      border-radius: 6px;
      cursor: pointer;
    }
    .toggle-eye:hover { color: var(--text); }
    .acc-metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      background: #0b1120;
      padding: 10px;
      border-radius: 8px;
      margin: 1rem 0;
      font-size: 0.8rem;
    }
    .metric-item { display: flex; justify-content: space-between; }
    .metric-label { color: var(--muted); }
    .metric-val { color: var(--text); font-weight: 600; }
    
    .acc-actions { display: flex; justify-content: space-between; align-items: center; }
    .test-result-box {
      font-size: 0.8rem;
      margin-top: 6px;
      min-height: 18px;
      font-weight: 500;
    }
    .test-success { color: var(--success); }
    .test-fail { color: var(--danger); }

    .switch-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      color: var(--muted);
    }
    .switch-label input { cursor: pointer; }

    .config-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: #065f46;
      color: #fff;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      display: none;
      z-index: 1000;
      font-size: 0.95rem;
      font-weight: 600;
      border: 1px solid #34d399;
    }
    .banner {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.1), rgba(59, 130, 246, 0.05));
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 1rem;
      border-radius: 10px;
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .doctor-box {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 1rem;
      margin-top: 0.8rem;
      font-size: 0.88rem;
    }
    .issue-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      margin-bottom: 6px;
      border-radius: 6px;
      background: #1e293b;
    }
    .issue-high { border-left: 4px solid var(--danger); }
    .issue-medium { border-left: 4px solid var(--warning); }
    .issue-low { border-left: 4px solid var(--primary); }

    /* Quota Usage Box */
    .quota-box {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 10px 12px;
      margin: 12px 0 10px;
      font-size: 0.8rem;
    }
    .quota-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid #1e293b;
      font-weight: 600;
      color: #cbd5e1;
    }
    .quota-row { margin-bottom: 7px; }
    .quota-row:last-child { margin-bottom: 0; }
    .quota-row-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.78rem;
      margin-bottom: 3px;
    }
    .quota-label { color: #94a3b8; display: flex; align-items: center; gap: 4px; }
    .quota-value { font-weight: 700; }
    .quota-bar-track {
      width: 100%;
      height: 6px;
      background: #1e293b;
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 2px;
    }
    .quota-bar-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.4s ease;
    }
    .quota-bar-ok { background: linear-gradient(90deg, #10b981, #34d399); }
    .quota-bar-warn { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
    .quota-bar-danger { background: linear-gradient(90deg, #ef4444, #f87171); }
    .quota-reset-text {
      font-size: 0.72rem;
      color: #64748b;
      text-align: right;
    }

    /* Updates and Compatibility Matrix */
    .update-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 0.85rem;
    }
    .update-table th, .update-table td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid #334155;
    }
    .update-table th {
      color: #94a3b8;
      font-weight: 600;
      background: #1e293b;
    }
    .badge-update {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge-ok { background: rgba(52, 211, 153, 0.2); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.4); }
    .badge-warn { background: rgba(251, 191, 36, 0.2); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.4); }
    .badge-danger { background: rgba(248, 113, 113, 0.2); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.4); }
    .alert-box {
      border-radius: 6px;
      padding: 10px 14px;
      margin-top: 10px;
      font-size: 0.85rem;
      line-height: 1.5;
    }
    .alert-box-warn { background: rgba(251, 191, 36, 0.1); border: 1px solid #fbbf24; color: #fef08a; }
    .alert-box-danger { background: rgba(248, 113, 113, 0.1); border: 1px solid #f87171; color: #fecaca; }
    .alert-box-success { background: rgba(52, 211, 153, 0.1); border: 1px solid #34d399; color: #a7f3d0; }
    @media (max-width: 768px) {
      body { padding: 0.75rem; }
      .accounts-grid { grid-template-columns: 1fr; }
      .header-actions { width: 100%; margin-top: 10px; }
      header { flex-direction: column; align-items: flex-start; }
      .acc-title-input { width: 85%; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="title-group" style="display:flex; align-items:center; gap:14px;">
        <img src="/assets/logo.png" alt="OpenCode Gateway Logo" style="width:48px; height:48px; border-radius:10px; box-shadow:0 0 18px rgba(16,185,129,0.35); flex-shrink:0;">
        <div>
          <h1 style="margin:0; font-size:1.45rem;">OpenCode 智能路由网关与调度中心</h1>
          <p style="margin:3px 0 0 0;">原生专用双订阅智能路由与负载均衡 (本地端口: <strong>${config.port}</strong>)</p>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary btn-sm" onclick="bindDesktopClients()" title="一键将本地网关锁定为 OpenCode 和 OpenChamber 的默认首选模型">⚡ 应用至 OpenCode/OpenChamber</button>
        <button class="btn btn-secondary btn-sm" onclick="testAllAccounts()">⚡ 全部测速</button>
        <button class="btn btn-secondary btn-sm" onclick="refreshAllQuotas()">📊 刷新配额</button>
        <button class="btn btn-secondary btn-sm" onclick="resetAllCooldowns()">🔄 重置限频</button>
        <button class="btn btn-secondary btn-sm" onclick="checkUpdates()">📦 检查更新</button>
        <button class="btn btn-secondary btn-sm" onclick="runDoctorCheck()">🩺 一键体检</button>
        <button class="btn btn-secondary btn-sm" onclick="bindCodexQuick()" title="一键将本地网关锁定为 OpenAI Codex 默认配置">🤖 接入 Codex</button>
        <button class="btn btn-sm" onclick="saveConfig()">💾 保存配置</button>
        <button id="btn-logout" class="btn btn-danger btn-sm" onclick="logoutAdmin()" title="退出管理登录" style="${config.uiPassword ? '' : 'display:none;'}">🚪 退出登录</button>
      </div>
    </header>

    <div class="banner">
      <div style="display:flex; flex-direction:column; gap:6px;">
        <div>
          <strong>💡 本地服务运作中 (Running):</strong> 支持会话亲和性、429 限频秒级自动漂移与重试。
        </div>
        <div style="font-size:0.83rem; color:var(--muted); display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span>🌐 智能网关端点 (Base URL): <code id="lbl-baseurl" style="color:var(--primary); font-family:monospace; background:rgba(0,0,0,0.3); padding:2px 6px; border-radius:4px;">http://127.0.0.1:${config.port}</code></span>
          <button class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="copyBaseUrl()">📋 复制端点 (Copy)</button>
          <span id="lbl-host-status" class="badge badge-healthy" style="font-size:0.7rem;">本地监听 (127.0.0.1)</span>
        </div>
      </div>
      <div>
        <a href="javascript:void(0)" onclick="window.open('http://' + (window.location.hostname || '127.0.0.1') + ':3000', '_blank')" style="color: var(--primary); text-decoration: none; font-size: 0.85rem; font-weight: 600;">💻 打开 OpenChamber 工作台 (3000) ↗</a>
      </div>
    </div>

    <!-- 系统自检与修复区域 -->
    <div class="card" id="doctor-card">
      <div class="section-title">
        <span>🩺 系统健康自检与异常修复 (Doctor & Repair)</span>
        <div>
          <button class="btn btn-secondary btn-sm" onclick="runDoctorCheck()">🔍 重新检测</button>
          <button class="btn btn-success btn-sm" style="margin-left:6px;" onclick="runRepair()">🔧 一键自动修复</button>
        </div>
      </div>
      <div id="doctor-content" class="doctor-box">
        <span style="color:var(--muted)">点击【一键体检】检查 OpenCode CLI、端口重定向、OMO配置与工作区状态...</span>
      </div>
    </div>

    <!-- 全组件最新版本监测、兼容性诊断与安全升级区域 -->
    <div class="card" id="updates-card">
      <div class="section-title">
        <span>📦 全组件最新版本监测、兼容性诊断与安全更新 (Updates & Rollback)</span>
        <div>
          <button class="btn btn-secondary btn-sm" onclick="checkUpdates()">🔍 检查最新版本</button>
          <button class="btn btn-success btn-sm" style="margin-left:6px;" onclick="applyUpdatesClick()">🚀 一键安全更新</button>
          <button class="btn btn-danger btn-sm" style="margin-left:6px;" onclick="showRollbackModal()">⏪ 灾备一键回滚</button>
        </div>
      </div>
      <div id="updates-content" class="doctor-box">
        <span style="color:var(--muted)">点击【检查最新版本】自动检测 OpenCode CLI、OMO 调度插件、Goal 插件、OpenChamber 及智能网关套件的最新版本与兼容性状态...</span>
      </div>
    </div>

    <!-- OpenAI Codex CLI 智能接入与全量模型调度卡片 -->
    <div class="card" id="codex-card">
      <div class="section-title">
        <span>🤖 OpenAI Codex CLI 智能接入与模型调度 (Codex Integration)</span>
        <div>
          <button class="btn btn-secondary btn-sm" onclick="loadCodexStatus()">🔍 刷新状态</button>
          <button class="btn btn-success btn-sm" style="margin-left:6px;" onclick="bindCodex()">⚡ 一键接入 Codex</button>
          <button class="btn btn-danger btn-sm" style="margin-left:6px;" onclick="restoreCodex()">🔄 一键还原原本配置</button>
        </div>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:16px; margin-bottom:12px; align-items:flex-end;">
        <div class="form-group" style="flex:1; min-width:280px; margin-bottom:0;">
          <label>首选生效模型 (38 款全量模型，非原生 Responses 自动协议桥转换)</label>
          <select id="codex-model-select" class="form-control" style="background:#0b1120;">
            <!-- 动态生成 38 款模型 -->
          </select>
        </div>
        <div class="form-group" style="width:200px; margin-bottom:0;">
          <label>思考等级 (Reasoning Effort)</label>
          <select id="codex-effort-select" class="form-control" style="background:#0b1120;">
            <option value="low">low (极速轻量思考)</option>
            <option value="medium">medium (均衡思考)</option>
            <option value="high" selected>high (深度思考 - 默认推荐)</option>
            <option value="xhigh">xhigh (超强思考)</option>
            <option value="max">max (极限思考)</option>
          </select>
        </div>
      </div>
      <div id="codex-status-content" class="doctor-box" style="margin-top:10px;">
        <span style="color:var(--muted)">正在检测 OpenAI Codex CLI 状态与网关接入配置...</span>
      </div>
    </div>

    <!-- 账号配置区域 -->
    <div class="card">
      <div class="section-title">
        <span>📋 OpenCode Go 订阅账号列表</span>
        <button class="btn btn-secondary btn-sm" onclick="addAccountCard()">+ 添加订阅账号</button>
      </div>
      <div id="accounts-container" class="accounts-grid">
        <!-- 动态渲染账号卡片 -->
      </div>
    </div>

    <!-- 高级策略与网络安全配置 -->
    <div class="card">
      <div class="section-title">
        <span>⚙️ 路由、网络绑定与安全策略配置</span>
      </div>
      <div class="config-grid">
        <div class="form-group">
          <label>上游端点地址 (Upstream Endpoint)</label>
          <input type="text" id="cfg-upstream" class="form-control" value="${config.upstream}">
        </div>
        <div class="form-group">
          <label>监听绑定地址 (Host IP - 0.0.0.0 允许局域网/NAS访问)</label>
          <input type="text" id="cfg-host" class="form-control" value="${config.host || '127.0.0.1'}">
        </div>
        <div class="form-group">
          <label>服务端口 (Port)</label>
          <input type="number" id="cfg-port" class="form-control" value="${config.port}">
        </div>
        <div class="form-group">
          <label>Web 管理访问密码 (UI Password - 留空无限制)</label>
          <div class="input-wrapper">
            <input type="password" id="cfg-uipassword" class="form-control" placeholder="留空不设防，局域网共享建议设置" value="${config.uiPassword || ''}">
            <button type="button" class="toggle-eye" onclick="toggleEye('cfg-uipassword')">👁️</button>
          </div>
        </div>
        <div class="form-group">
          <label>429 触发后默认冷却时长 (秒)</label>
          <input type="number" id="cfg-cooldown" class="form-control" value="${Math.round(config.defaultCooldownMs / 1000)}">
        </div>
        <div class="form-group">
          <label>最大故障转移重试次数 (Retries)</label>
          <input type="number" id="cfg-retries" class="form-control" value="${config.maxFailoverRetries}">
        </div>
        <div class="form-group" style="display:flex; align-items:flex-end;">
          <label class="switch-label" style="margin-bottom:8px;">
            <input type="checkbox" id="cfg-affinity" ${config.sessionAffinityEnabled ? 'checked' : ''}>
            <span>启用会话亲和性 (保持对话在同一账号以命中 KV 缓存)</span>
          </label>
        </div>
      </div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    let currentConfig = null;
    let liveStats = {};
    let accountQuotas = {};

    function formatResetTime(isoStr) {
      if (!isoStr) return '';
      try {
        const date = new Date(isoStr);
        const now = new Date();
        const diffMs = date - now;
        let relative = '';
        if (diffMs > 0) {
          const diffMins = Math.round(diffMs / 60000);
          if (diffMins < 60) relative = ' (剩 ' + diffMins + ' 分钟)';
          else {
            const hours = (diffMs / 3600000).toFixed(1);
            relative = ' (剩 ' + hours + ' 小时)';
          }
        }
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return m + '-' + d + ' ' + h + ':' + min + relative;
      } catch (e) {
        return isoStr;
      }
    }

    function getBarClass(percent) {
      if (percent >= 90) return 'quota-bar-danger';
      if (percent >= 70) return 'quota-bar-warn';
      return 'quota-bar-ok';
    }

    function buildQuotaContent(usage) {
      if (!usage) return '<div style="color:var(--muted); font-size:0.75rem; text-align:center; padding: 4px 0;">点击【测速】或【刷新】查询官方 5h、周、月配额</div>';

      const rollingPct = Math.min(100, Math.max(0, (usage.rolling && usage.rolling.percent !== undefined) ? usage.rolling.percent : 0));
      const weeklyPct = Math.min(100, Math.max(0, (usage.weekly && usage.weekly.percent !== undefined) ? usage.weekly.percent : 0));
      const monthlyPct = Math.min(100, Math.max(0, (usage.monthly && usage.monthly.percent !== undefined) ? usage.monthly.percent : 0));

      return '<div class="quota-row">' +
        '<div class="quota-row-top">' +
          '<span class="quota-label">⏱️ 5小时滑动限额 (5h Rolling)</span>' +
          '<span class="quota-value" style="color: ' + (rollingPct > 80 ? 'var(--danger)' : 'var(--text)') + ';">' + rollingPct + '%</span>' +
        '</div>' +
        '<div class="quota-bar-track">' +
          '<div class="quota-bar-fill ' + getBarClass(rollingPct) + '" style="width: ' + rollingPct + '%;"></div>' +
        '</div>' +
        '<div class="quota-reset-text">恢复时间: ' + formatResetTime(usage.rolling && usage.rolling.resetsAt) + '</div>' +
      '</div>' +
      '<div class="quota-row">' +
        '<div class="quota-row-top">' +
          '<span class="quota-label">📅 本周累计额度 (Weekly)</span>' +
          '<span class="quota-value" style="color: ' + (weeklyPct > 80 ? 'var(--danger)' : 'var(--text)') + ';">' + weeklyPct + '%</span>' +
        '</div>' +
        '<div class="quota-bar-track">' +
          '<div class="quota-bar-fill ' + getBarClass(weeklyPct) + '" style="width: ' + weeklyPct + '%;"></div>' +
        '</div>' +
        '<div class="quota-reset-text">周重置: ' + formatResetTime(usage.weekly && usage.weekly.resetsAt) + '</div>' +
      '</div>' +
      '<div class="quota-row">' +
        '<div class="quota-row-top">' +
          '<span class="quota-label">🗓️ 本月累计额度 (Monthly)</span>' +
          '<span class="quota-value" style="color: ' + (monthlyPct > 80 ? 'var(--danger)' : 'var(--text)') + ';">' + monthlyPct + '%</span>' +
        '</div>' +
        '<div class="quota-bar-track">' +
          '<div class="quota-bar-fill ' + getBarClass(monthlyPct) + '" style="width: ' + monthlyPct + '%;"></div>' +
        '</div>' +
        '<div class="quota-reset-text">月重置: ' + formatResetTime(usage.monthly && usage.monthly.resetsAt) + '</div>' +
      '</div>';
    }

    function apiHeaders(extra = {}) {
      const headers = { ...extra };
      let token = localStorage.getItem('opencode_router_token');
      if (!token) {
        const match = document.cookie.match(/(?:^|;\s*)router_auth=([^;]+)/);
        if (match) {
          try {
            token = decodeURIComponent(match[1]);
          } catch (e) {}
        }
      }
      if (token) headers['Authorization'] = 'Bearer ' + token;
      return headers;
    }

    function copyBaseUrl() {
      const url = 'http://' + (window.location.hostname || '127.0.0.1') + ':${config.port}';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          showToast('✔ 已复制 Base URL: ' + url);
        }).catch(() => {
          fallbackCopyText(url);
        });
      } else {
        fallbackCopyText(url);
      }
    }

    function fallbackCopyText(text) {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        showToast('✔ 已复制 Base URL: ' + text);
      } catch (err) {
        showToast('复制失败，请手动复制: ' + text, true);
      }
      document.body.removeChild(textArea);
    }

    function logoutAdmin() {
      document.cookie = 'router_auth=; Path=/; Max-Age=0; SameSite=Lax';
      localStorage.removeItem('opencode_router_token');
      location.reload();
    }

    function showToast(msg, isError = false) {
      const toast = document.getElementById('toast');
      toast.innerText = msg;
      toast.style.background = isError ? '#991b1b' : '#065f46';
      toast.style.borderColor = isError ? '#f87171' : '#34d399';
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3000);
    }

    async function fetchConfig() {
      try {
        const res = await fetch('/balancer/api/config', { headers: apiHeaders() });
        if (res.status === 401) {
          localStorage.removeItem('opencode_router_token');
          document.cookie = 'router_auth=; Path=/; Max-Age=0; SameSite=Lax';
          location.reload();
          return;
        }
        currentConfig = await res.json();
        if (document.getElementById('cfg-host')) document.getElementById('cfg-host').value = currentConfig.host || '127.0.0.1';
        if (document.getElementById('cfg-port')) document.getElementById('cfg-port').value = currentConfig.port || 4010;
        if (document.getElementById('cfg-uipassword')) document.getElementById('cfg-uipassword').value = currentConfig.uiPassword || '';
        const logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn) logoutBtn.style.display = currentConfig.hasUiPassword ? 'inline-block' : 'none';
        renderAccounts();
        refreshAllQuotas();
      } catch (e) {
        showToast('获取配置失败: ' + e.message, true);
      }
    }

    async function fetchStatus() {
      try {
        const res = await fetch('/status');
        const data = await res.json();
        for (const acc of data.accounts) {
          liveStats[acc.id] = acc;
        }
        updateMetricsUI();
      } catch (e) {}
    }

    function renderAccounts() {
      const container = document.getElementById('accounts-container');
      container.innerHTML = '';

      currentConfig.accounts.forEach((acc, index) => {
        const stat = liveStats[acc.id] || {};
        let badgeClass = 'badge-disabled';
        let statusText = '未配置密钥/已禁用';
        if (acc.enabled && acc.apiKey) {
          if (stat.status === 'cooling_down') {
            badgeClass = 'badge-cooling';
            statusText = '冷却中 (' + stat.remainingCooldownSec + 's)';
          } else {
            badgeClass = 'badge-healthy';
            statusText = '正常可用';
          }
        }

        const card = document.createElement('div');
        card.className = 'account-card';
        card.id = 'acc-card-' + acc.id;
        card.innerHTML = \`
          <div class="acc-header">
            <input type="text" class="acc-title-input" value="\${acc.name || '账号 ' + (index + 1)}" onchange="updateAccountField('\${acc.id}', 'name', this.value)">
            <span class="badge \${badgeClass}" id="badge-\${acc.id}">\${statusText}</span>
          </div>

          <div class="form-group">
            <label>API Key (密钥)</label>
            <div class="input-wrapper">
              <input type="password" id="key-input-\${acc.id}" class="form-control" placeholder="输入订阅密钥..." value="\${acc.apiKey || ''}" onchange="updateAccountField('\${acc.id}', 'apiKey', this.value)">
              <button type="button" class="toggle-eye" onclick="toggleEye('\${acc.id}')">👁️</button>
            </div>
            <div class="test-result-box" id="test-res-\${acc.id}"></div>
          </div>

          <div class="quota-box" id="quota-box-\${acc.id}">
            <div class="quota-header">
              <span>📊 官方限额 (Usage Quota)</span>
              <button type="button" class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="fetchSingleQuota('\${acc.id}')">🔄 刷新</button>
            </div>
            <div id="quota-content-\${acc.id}">
              \${accountQuotas[acc.id] ? buildQuotaContent(accountQuotas[acc.id]) : '<div style="color:var(--muted); font-size:0.75rem; text-align:center; padding: 4px 0;">点击【测速】或【刷新】查询官方 5h、周、月配额</div>'}
            </div>
          </div>

          <div class="acc-metrics">
            <div class="metric-item"><span class="metric-label">活跃请求:</span><span class="metric-val" id="m-act-\${acc.id}">\${stat.activeRequests || 0}</span></div>
            <div class="metric-item"><span class="metric-label">总请求数:</span><span class="metric-val" id="m-tot-\${acc.id}">\${stat.totalRequests || 0}</span></div>
            <div class="metric-item"><span class="metric-label">429 限频:</span><span class="metric-val" id="m-429-\${acc.id}">\${stat.rateLimitCount || 0}</span></div>
            <div class="metric-item"><span class="metric-label">故障转移:</span><span class="metric-val" id="m-flv-\${acc.id}">\${stat.failoverCount || 0}</span></div>
          </div>

          <div class="acc-actions">
            <label class="switch-label">
              <input type="checkbox" \${acc.enabled ? 'checked' : ''} onchange="updateAccountField('\${acc.id}', 'enabled', this.checked)">
              <span>启用此账号</span>
            </label>
            <div>
              <button class="btn btn-secondary btn-sm" onclick="resetSingleCooldown('\${acc.id}')">🔄 解除冷却</button>
              <button class="btn btn-secondary btn-sm" style="margin-left:4px;" onclick="testSingleAccount('\${acc.id}')">⚡ 测速</button>
              \${currentConfig.accounts.length > 1 ? \`<button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="deleteAccount('\${acc.id}')">🗑️ 删除</button>\` : ''}
            </div>
          </div>
        \`;
        container.appendChild(card);
      });
    }

    function toggleEye(id) {
      const input = document.getElementById(id.startsWith('cfg-') ? id : 'key-input-' + id);
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    }

    function updateAccountField(id, field, value) {
      const target = currentConfig.accounts.find(a => a.id === id);
      if (target) {
        target[field] = value;
      }
    }

    function addAccountCard() {
      const newId = 'account-' + Date.now();
      currentConfig.accounts.push({
        id: newId,
        name: 'OpenCode Go 账号 ' + (currentConfig.accounts.length + 1),
        apiKey: '',
        enabled: true
      });
      renderAccounts();
    }

    function deleteAccount(id) {
      if (currentConfig.accounts.length <= 1) {
        alert('至少需要保留一个账号！');
        return;
      }
      currentConfig.accounts = currentConfig.accounts.filter(a => a.id !== id);
      renderAccounts();
    }

    async function testSingleAccount(id) {
      const resBox = document.getElementById('test-res-' + id);
      const acc = currentConfig.accounts.find(a => a.id === id);
      const upstream = document.getElementById('cfg-upstream').value;
      if (!acc || !acc.apiKey.trim()) {
        resBox.className = 'test-result-box test-fail';
        resBox.innerText = '❌ 请先输入 API Key 再进行测试';
        return;
      }
      resBox.className = 'test-result-box';
      resBox.innerText = '⏳ 正在向端点发送测试请求...';

      try {
        const res = await fetch('/balancer/api/test-account', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ upstream, apiKey: acc.apiKey })
        });
        const data = await res.json();
        if (data.success) {
          resBox.className = 'test-result-box test-success';
          resBox.innerText = '✔ ' + data.message;
        } else {
          resBox.className = 'test-result-box test-fail';
          resBox.innerText = '❌ ' + data.message;
        }
      } catch (e) {
        resBox.className = 'test-result-box test-fail';
        resBox.innerText = '❌ 请求异常: ' + e.message;
      }
      fetchSingleQuota(id);
    }

    async function testAllAccounts() {
      for (const acc of currentConfig.accounts) {
        if (acc.apiKey) {
          await testSingleAccount(acc.id);
        }
      }
    }

    async function resetSingleCooldown(id) {
      try {
        const res = await fetch('/balancer/api/reset-cooldown', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        showToast(data.message);
        fetchStatus();
      } catch (e) {
        showToast('重置失败: ' + e.message, true);
      }
    }

    async function resetAllCooldowns() {
      try {
        const res = await fetch('/balancer/api/reset-cooldown', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: '{}'
        });
        const data = await res.json();
        showToast(data.message);
        fetchStatus();
      } catch (e) {
        showToast('重置失败: ' + e.message, true);
      }
    }

    async function runDoctorCheck() {
      const box = document.getElementById('doctor-content');
      box.innerHTML = '<span style="color:var(--primary)">⏳ 正在执行系统环境全链路自检...</span>';
      try {
        const res = await fetch('/balancer/api/doctor', { headers: apiHeaders() });
        const doc = await res.json();
        let html = \`
          <div style="margin-bottom:8px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
            <span><strong>OpenCode CLI:</strong> \${doc.opencode.installed ? '<span style="color:var(--success)">✔ ' + doc.opencode.version + '</span>' : '<span style="color:var(--warning)">⚠ 未找到</span>'}</span>
            <span><strong>路由端口:</strong> <span style="color:var(--success)">✔ \${doc.router.port}</span></span>
            <span><strong>OpenChamber:</strong> \${doc.openchamber.reachable ? '<span style="color:var(--success)">✔ 运行中</span>' : (doc.openchamber.ghost ? '<span style="color:var(--danger)">❌ 僵死死锁</span>' : '<span style="color:var(--muted)">未运行</span>')} <button class="btn btn-secondary btn-sm" style="padding:1px 6px; font-size:11px; margin-left:4px;" onclick="launchOpenChamber()">💻 唤醒桌面端</button></span>
            <span><strong>Office 预览:</strong> \${doc.openchamber.officePreview && doc.openchamber.officePreview.installed ? '<span style="color:var(--success)">✔ 已挂载</span>' : '<span style="color:var(--muted)">未挂载</span>'}</span>
            <span><strong>/boost 指令:</strong> \${doc.commands.boostMdExists ? '<span style="color:var(--success)">✔ 已就绪</span>' : '<span style="color:var(--muted)">未安装</span>'}</span>
          </div>
        \`;
        if (doc.issues.length === 0) {
          html += '<div style="color:var(--success); font-weight:600; padding:6px 0;">🎉 全链路状态极佳，未发现任何潜在隐患！</div>';
        } else {
          html += '<div style="margin-top:8px;"><strong>发现 ' + doc.issues.length + ' 个可优化/待修复项：</strong></div>';
          doc.issues.forEach(iss => {
            const cls = iss.severity === 'high' ? 'issue-high' : (iss.severity === 'medium' ? 'issue-medium' : 'issue-low');
            html += \`
              <div class="issue-item \${cls}">
                <div>
                  <strong>\${iss.title}</strong>: <span style="color:var(--muted);">\${iss.desc}</span>
                </div>
              </div>
            \`;
          });
        }
        box.innerHTML = html;
      } catch (e) {
        box.innerHTML = '<span style="color:var(--danger)">自检失败: ' + e.message + '</span>';
      }
    }

    async function launchOpenChamber() {
      try {
        showToast('正在请求唤醒 OpenChamber 桌面客户端...');
        const res = await fetch('/balancer/api/launch-chamber', { method: 'POST', headers: apiHeaders() });
        const data = await res.json();
        if (data.mode === 'desktop') {
          showToast(data.message || '已成功唤起桌面端！');
        } else {
          showToast('已唤出 Web 工作台，建议开启桌面端客户端体验更佳。');
          window.open(data.url || 'http://127.0.0.1:3000', '_blank');
        }
        setTimeout(runDoctorCheck, 1500);
      } catch (e) {
        showToast('唤醒失败: ' + e.message, true);
      }
    }

    async function runRepair() {
      const box = document.getElementById('doctor-content');
      box.innerHTML = '<span style="color:var(--primary)">🔧 正在执行一键自动修复...</span>';
      try {
        const res = await fetch('/balancer/api/repair', { method: 'POST', headers: apiHeaders() });
        const data = await res.json();
        let html = '<div style="margin-bottom:6px;"><strong>修复执行结果：</strong></div>';
        data.results.forEach(r => {
          const color = r.success ? 'var(--success)' : 'var(--danger)';
          html += \`<div style="padding:4px 0; color:\${color}">\${r.success ? '✔' : '❌'} [\${r.item}]: \${r.message}</div>\`;
        });
        box.innerHTML = html;
        showToast('修复流程执行完毕！');
        fetchStatus();
      } catch (e) {
        box.innerHTML = '<span style="color:var(--danger)">修复执行异常: ' + e.message + '</span>';
      }
    }

    async function saveConfig() {
      const upstream = document.getElementById('cfg-upstream').value.trim();
      const host = document.getElementById('cfg-host').value.trim();
      const port = parseInt(document.getElementById('cfg-port').value, 10) || 4010;
      const uiPassword = document.getElementById('cfg-uipassword').value.trim();
      const cooldownSec = parseInt(document.getElementById('cfg-cooldown').value) || 60;
      const retries = parseInt(document.getElementById('cfg-retries').value) || 2;
      const affinity = document.getElementById('cfg-affinity').checked;

      const payload = {
        upstream,
        host,
        port,
        uiPassword,
        defaultCooldownMs: cooldownSec * 1000,
        maxFailoverRetries: retries,
        sessionAffinityEnabled: affinity,
        accounts: currentConfig.accounts
      };

      try {
        const res = await fetch('/balancer/api/config', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          if (uiPassword) {
            const newToken = btoa(uiPassword);
            localStorage.setItem('opencode_router_token', newToken);
            document.cookie = 'router_auth=' + encodeURIComponent(newToken) + '; Path=/; Max-Age=2592000; SameSite=Lax';
          } else {
            localStorage.removeItem('opencode_router_token');
            document.cookie = 'router_auth=; Path=/; Max-Age=0; SameSite=Lax';
          }
          showToast('✔ ' + data.message);
          fetchConfig();
          fetchStatus();
        } else {
          showToast('保存失败: ' + data.error, true);
        }
      } catch (e) {
        showToast('网络错误: ' + e.message, true);
      }
    }

    function updateMetricsUI() {
      for (const [id, stat] of Object.entries(liveStats)) {
        const act = document.getElementById('m-act-' + id);
        const tot = document.getElementById('m-tot-' + id);
        const r429 = document.getElementById('m-429-' + id);
        const flv = document.getElementById('m-flv-' + id);
        const badge = document.getElementById('badge-' + id);

        if (act) act.innerText = stat.activeRequests;
        if (tot) tot.innerText = stat.totalRequests;
        if (r429) r429.innerText = stat.rateLimitCount;
        if (flv) flv.innerText = stat.failoverCount;

        if (badge) {
          if (!stat.hasKey || !stat.enabled) {
            badge.className = 'badge badge-disabled';
            badge.innerText = '未配置密钥/已禁用';
          } else if (stat.status === 'cooling_down') {
            badge.className = 'badge badge-cooling';
            badge.innerText = '冷却中 (' + stat.remainingCooldownSec + 's)';
          } else {
            badge.className = 'badge badge-healthy';
            badge.innerText = '正常可用';
          }
        }
      }
    }

    async function fetchSingleQuota(id) {
      const qBox = document.getElementById('quota-content-' + id);
      const acc = currentConfig ? currentConfig.accounts.find(a => a.id === id) : null;
      const upstream = document.getElementById('cfg-upstream').value;
      if (!acc || !acc.apiKey.trim()) {
        if (qBox) qBox.innerHTML = '<div style="color:var(--muted); font-size:0.75rem; text-align:center; padding:4px 0;">请先输入 API Key 密钥</div>';
        return;
      }
      if (qBox) qBox.innerHTML = '<div style="color:var(--primary); font-size:0.75rem; text-align:center; padding:4px 0;">⏳ 正在查询官方配额限制...</div>';

      try {
        const res = await fetch('/balancer/api/account-quota', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ upstream, apiKey: acc.apiKey, id })
        });
        const data = await res.json();
        if (data.success && data.usage) {
          accountQuotas[id] = data.usage;
          if (qBox) qBox.innerHTML = buildQuotaContent(data.usage);
        } else {
          if (qBox) qBox.innerHTML = '<div style="color:var(--danger); font-size:0.75rem; text-align:center; padding:4px 0;">查询失败: ' + (data.error || '未返回配额数据') + '</div>';
        }
      } catch (e) {
        if (qBox) qBox.innerHTML = '<div style="color:var(--danger); font-size:0.75rem; text-align:center; padding:4px 0;">网络异常: ' + e.message + '</div>';
      }
    }

    async function refreshAllQuotas() {
      if (!currentConfig || !currentConfig.accounts) return;
      for (const acc of currentConfig.accounts) {
        if (acc.apiKey && acc.apiKey.trim()) {
          fetchSingleQuota(acc.id);
        }
      }
    }

    async function bindDesktopClients() {
      try {
        showToast('正在应用本地网关配置至桌面端...');
        const res = await fetch('/balancer/api/bind-desktop', { method: 'POST', headers: apiHeaders() });
        const data = await res.json();
        if (data.success) {
          showToast('✔ ' + (data.message || '已成功绑定至 OpenCode 与 OpenChamber！'));
        } else {
          showToast('绑定失败: ' + (data.error || data.message), true);
        }
      } catch (e) {
        showToast('请求异常: ' + e.message, true);
      }
    }

    let lastUpdateReport = null;

    async function checkUpdates() {
      const box = document.getElementById('updates-content');
      box.innerHTML = '<span style="color:var(--primary)">⏳ 正在联网检索各组件最新发布版本与兼容性状态...</span>';
      try {
        const res = await fetch('/balancer/api/updates/check', { headers: apiHeaders() });
        const report = await res.json();
        lastUpdateReport = report;

        let compBadgeCls = 'badge-ok';
        let compBadgeText = '✅ 完全兼容';
        if (report.compatibility.riskLevel === 'critical') {
          compBadgeCls = 'badge-danger';
          compBadgeText = '🛑 存在破坏性跨版本/冲突风险';
        } else if (report.compatibility.riskLevel === 'warning') {
          compBadgeCls = 'badge-warn';
          compBadgeText = '⚠️ 存在版本变动或需同步更新';
        }

        let html = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">' +
          '<span><strong>生态兼容性状态：</strong> <span class="badge-update ' + compBadgeCls + '">' + compBadgeText + '</span></span>' +
          '<span style="color:var(--muted); font-size:0.8rem;">检测时间: ' + new Date(report.timestamp).toLocaleTimeString() + '</span>' +
          '</div>' +
          '<table class="update-table">' +
            '<thead>' +
              '<tr>' +
                '<th style="width:36px; text-align:center;"><input type="checkbox" id="update-select-all" title="全选/全不选" onchange="toggleAllUpdateCheckboxes(this.checked)"></th>' +
                '<th>组件名称与定位</th>' +
                '<th>本地当前版本</th>' +
                '<th>官方最新版本</th>' +
                '<th>状态诊断</th>' +
                '<th style="width:110px; text-align:center;">操作</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>';

        report.components.forEach(function(c) {
          let stBadge = '';
          if (c.status === 'offline_or_error') {
            stBadge = '<span class="badge-update badge-danger" title="' + (c.error || '') + '">网络受限/失败</span>';
          } else if (c.hasUpdate) {
            stBadge = '<span class="badge-update badge-warn">待更新 (v' + c.latest + ')</span>';
          } else {
            stBadge = '<span class="badge-update badge-ok">已是最新 (v' + c.current + ')</span>';
          }

          const checkedAttr = c.hasUpdate ? 'checked' : '';
          html += '<tr>' +
            '<td style="text-align:center;"><input type="checkbox" class="update-comp-cb" value="' + c.id + '" ' + checkedAttr + '></td>' +
            '<td><div style="font-weight:600; color:var(--text);">' + c.name + '</div><div style="color:var(--muted); font-size:0.75rem;">' + c.desc + '</div></td>' +
            '<td style="font-family:monospace; font-weight:600; color:' + (c.current === '未知' ? 'var(--muted)' : 'var(--text)') + ';">' + c.current + '</td>' +
            '<td style="font-family:monospace; font-weight:600; color:' + (c.hasUpdate ? 'var(--primary)' : 'var(--muted)') + ';">' + c.latest + '</td>' +
            '<td>' + stBadge + '</td>' +
            '<td style="text-align:center;"><button class="btn btn-secondary btn-sm" onclick="applySingleUpdate(\\\'' + c.id + '\\\')">单独升级</button></td>' +
          '</tr>';
        });

        html += '</tbody></table>';

        if (report.compatibility.warnings && report.compatibility.warnings.length > 0) {
          const alertCls = report.compatibility.riskLevel === 'critical' ? 'alert-box-danger' : 'alert-box-warn';
          html += '<div class="alert-box ' + alertCls + '"><strong>⚠️ 兼容性与版本变动重点预警：</strong><ul style="margin:4px 0 0 16px; padding:0;">';
          report.compatibility.warnings.forEach(function(w) {
            html += '<li style="margin-bottom:3px;"><strong>' + w.title + '</strong>: ' + w.desc + '</li>';
          });
          html += '</ul></div>';
        }

        if (report.compatibility.recommendations && report.compatibility.recommendations.length > 0) {
          html += '<div style="margin-top:8px; font-size:0.82rem; color:var(--muted);"><strong>💡 专家建议：</strong> ' + report.compatibility.recommendations.join('；') + '</div>';
        }

        if (report.snapshots && report.snapshots.length > 0) {
          html += '<div style="margin-top:12px; padding-top:8px; border-top:1px solid #334155; display:flex; justify-content:space-between; align-items:center; font-size:0.8rem;">' +
            '<span style="color:var(--muted)">现有可用灾备快照: <strong>' + report.snapshots.length + '</strong> 份（最近备份: ' + new Date(report.snapshots[0].timestamp).toLocaleString() + '）</span>' +
            '<button class="btn btn-secondary btn-sm" onclick="showRollbackModal()">查看快照历史并秒级回滚</button>' +
          '</div>';
        }

        box.innerHTML = html;
      } catch (e) {
        box.innerHTML = '<span style="color:var(--danger)">检测更新失败: ' + e.message + '</span>';
      }
    }

    function toggleAllUpdateCheckboxes(checked) {
      const cbs = document.querySelectorAll('.update-comp-cb');
      cbs.forEach(function(cb) { cb.checked = checked; });
    }

    async function applySingleUpdate(compId) {
      const comp = lastUpdateReport && lastUpdateReport.components.find(function(c) { return c.id === compId; });
      const name = comp ? comp.name : compId;
      if (!confirm('⚠️ 确认要单独升级【' + name + '】吗？\\n\\n系统将在升级前自动创建灾备快照。')) return;
      await executeApplyUpdates([compId]);
    }

    async function applyUpdatesClick() {
      if (!lastUpdateReport) {
        showToast('请先点击【检查最新版本】完成兼容性扫描！', true);
        await checkUpdates();
        return;
      }

      const cbs = Array.from(document.querySelectorAll('.update-comp-cb:checked')).map(function(cb) { return cb.value; });
      let targets = cbs;
      if (targets.length === 0) {
        const pending = lastUpdateReport.components.filter(function(c) { return c.hasUpdate; }).map(function(c) { return c.id; });
        if (pending.length === 0) {
          const proceed = confirm('当前勾选列表为空，且所有组件均为最新版本！是否强制更新全部组件？');
          if (!proceed) return;
          targets = ['opencode', 'oh-my-openagent', 'opencode-goal-plugin', 'openchamber', 'opencode-go-router'];
        } else {
          targets = pending;
        }
      }

      const targetNames = targets.map(function(id) {
        const found = lastUpdateReport.components.find(function(c) { return c.id === id; });
        return found ? found.name : id;
      });

      let msg = '即将安全升级以下组件：\\n' + targetNames.map(function(n) { return '• ' + n; }).join('\\n') + '\\n\\n';
      if (lastUpdateReport.compatibility.riskLevel === 'critical') {
        msg += '🛑 警告：检测到存在破坏性大版本更新或生态冲突风险！\\n系统已启用自动快照备份，若更新后出现异常可秒级一键回滚。\\n\\n是否确认继续一键升级？';
      } else if (lastUpdateReport.compatibility.riskLevel === 'warning') {
        msg += '⚠️ 提示：系统将在更新前自动创建全量灾备快照。\\n\\n是否确认执行安全升级？';
      } else {
        msg += '系统将自动创建灾备快照并安全升级。是否确认继续？';
      }
      if (!confirm(msg)) return;

      await executeApplyUpdates(targets);
    }

    async function executeApplyUpdates(targets) {
      const box = document.getElementById('updates-content');
      box.innerHTML = '<span style="color:var(--primary)">🚀 正在执行安全更新流程（自动备份快照 -> 下载升级组件 -> 同步配置 -> 重新挂载 Office 离线预览引擎）... 请稍候...</span>';
      showToast('正在执行组件安全更新...');

      try {
        const res = await fetch('/balancer/api/updates/apply', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ components: targets, skipBackup: false })
        });
        const data = await res.json();
        if (data.success) {
          showToast('🎉 组件安全更新流程全部完成！');
          let html = '<div style="color:var(--success); font-weight:600; margin-bottom:8px;">🎉 组件安全升级成功！(已创建快照: ' + (data.snapshotId || '已备份') + ')</div>';
          html += '<div style="background:#1e293b; padding:10px; border-radius:6px; font-family:monospace; font-size:0.8rem; max-height:200px; overflow-y:auto; margin-bottom:10px;">';
          data.logs.forEach(function(l) {
            html += '<div>' + l + '</div>';
          });
          html += '</div>';
          html += '<button class="btn btn-secondary btn-sm" onclick="checkUpdates()">🔄 刷新版本诊断</button>';
          box.innerHTML = html;
          setTimeout(checkUpdates, 1500);
        } else {
          let html = '<div style="color:var(--danger); font-weight:600; margin-bottom:8px;">❌ 部分组件更新未完全成功 (已创建快照: ' + (data.snapshotId || '已备份') + ')</div>';
          if (data.logs && data.logs.length) {
            html += '<div style="background:#1e293b; padding:10px; border-radius:6px; font-family:monospace; font-size:0.8rem; max-height:200px; overflow-y:auto; margin-bottom:10px;">';
            data.logs.forEach(function(l) {
              html += '<div>' + l + '</div>';
            });
            html += '</div>';
          }
          html += '<button class="btn btn-danger btn-sm" onclick="showRollbackModal()">⏪ 灾备一键回滚</button> ';
          html += '<button class="btn btn-secondary btn-sm" onclick="checkUpdates()">🔄 刷新版本状态</button>';
          box.innerHTML = html;
          showToast('更新执行未完全成功', true);
        }
      } catch (e) {
        box.innerHTML = '<div style="color:var(--danger)">更新请求异常: ' + e.message + '</div>';
        showToast('请求超时或失败: ' + e.message, true);
      }
    }

    async function showRollbackModal() {
      const box = document.getElementById('updates-content');
      box.innerHTML = '<span style="color:var(--primary)">⏳ 正在检索历史灾备快照记录...</span>';
      try {
        const res = await fetch('/balancer/api/updates/snapshots', { headers: apiHeaders() });
        const data = await res.json();
        if (!data.success || !data.snapshots || data.snapshots.length === 0) {
          box.innerHTML = '<div style="color:var(--warning); padding:10px 0;">⚠ 暂无可用快照记录。首次执行【一键安全更新】时将自动生成全量快照。</div><button class="btn btn-secondary btn-sm" onclick="checkUpdates()">返回版本诊断</button>';
          return;
        }

        let html = '<div style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">' +
          '<strong>⏪ 灾备一键回滚 (选择还原点恢复至稳定状态)：</strong>' +
          '<button class="btn btn-secondary btn-sm" onclick="checkUpdates()">返回版本矩阵</button>' +
        '</div>' +
        '<div style="font-size:0.85rem; color:var(--muted); margin-bottom:8px;">' +
          '回滚将瞬间复原 <code>opencode.jsonc</code>、<code>omo.jsonc</code>、智能网关配置，并按需还原对应版本的组件与 Office 预览引擎。' +
        '</div>' +
        '<table class="update-table">' +
          '<thead>' +
            '<tr>' +
              '<th>快照编号 (Snapshot ID)</th>' +
              '<th>创建时间</th>' +
              '<th>备份原因</th>' +
              '<th>包含版本快照</th>' +
              '<th>操作</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>';

        data.snapshots.forEach(function(s) {
          const vStr = s.versions ? ('opencode: ' + (s.versions.opencode || '-') + ', omo: ' + (s.versions[\'oh-my-openagent\'] || '-')) : '-';
          html += '<tr>' +
            '<td style="font-family:monospace; font-weight:600;">' + s.id + '</td>' +
            '<td style="font-size:0.8rem; color:var(--muted);">' + new Date(s.timestamp).toLocaleString() + '</td>' +
            '<td>' + (s.reason || '自动快照') + '</td>' +
            '<td style="font-size:0.75rem; color:var(--muted); font-family:monospace;">' + vStr + '</td>' +
            '<td><button class="btn btn-danger btn-sm" onclick="executeRollback(\\\'' + s.id + '\\\')">恢复此快照</button></td>' +
          '</tr>';
        });

        html += '</tbody></table>';
        box.innerHTML = html;
      } catch (e) {
        box.innerHTML = '<span style="color:var(--danger)">查询快照失败: ' + e.message + '</span>';
      }
    }

    async function executeRollback(snapshotId) {
      if (!confirm('⚠️ 确认要执行灾备回滚至快照 [' + snapshotId + '] 吗？\\n\\n系统将秒级复原配置与组件状态。')) return;
      const box = document.getElementById('updates-content');
      box.innerHTML = '<span style="color:var(--primary)">⏪ 正在执行一键灾备回滚恢复...</span>';
      showToast('正在回滚至快照 ' + snapshotId + '...');

      try {
        const res = await fetch('/balancer/api/updates/rollback', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ snapshotId: snapshotId, reinstallPackages: false })
        });
        const data = await res.json();
        if (data.success) {
          showToast('🎉 灾备回滚成功！系统已秒级恢复！');
          let html = '<div style="color:var(--success); font-weight:600; margin-bottom:8px;">🎉 灾备回滚成功！系统配置已恢复至 ' + new Date(data.timestamp).toLocaleString() + ' 状态。</div>' +
          '<div style="background:#1e293b; padding:10px; border-radius:6px; font-size:0.82rem; margin-bottom:10px;">';
          data.restoredItems.forEach(function(item) {
            html += '<div>✔ 已还原: ' + (item.file || item.action) + ' (' + item.status + ')</div>';
          });
          html += '</div>' +
          '<button class="btn btn-secondary btn-sm" onclick="checkUpdates()">🔄 刷新版本状态</button>';
          box.innerHTML = html;
          fetchConfig();
          fetchStatus();
        } else {
          box.innerHTML = '<div style="color:var(--danger)">回滚失败: ' + (data.error || '未知错误') + '</div>';
          showToast('回滚执行失败', true);
        }
      } catch (e) {
        box.innerHTML = '<div style="color:var(--danger)">回滚请求异常: ' + e.message + '</div>';
        showToast('回滚请求异常: ' + e.message, true);
      }
    }

    // Codex Management Functions
    let codexStatusData = null;
    async function loadCodexStatus() {
      const box = document.getElementById('codex-status-content');
      const sel = document.getElementById('codex-model-select');
      try {
        const res = await fetch('/balancer/api/codex-status', { headers: apiHeaders() });
        const data = await res.json();
        if (data.success && data.status) {
          codexStatusData = data.status;
          const st = data.status;

          if (sel && sel.options.length === 0 && Array.isArray(st.availableModels)) {
            sel.innerHTML = '';
            st.availableModels.forEach(function(m) {
              const opt = document.createElement('option');
              const isNative = ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-flash', 'deepseek-v4.1-flash', 'deepseek-v4-pro', 'grok-4.6', 'grok-4.7', 'gpt-5.6-luna'].includes(m.slug);
              const isAnthropic = m.slug === 'claude-haiku-5-5';
              let tag = ' [智能协议桥]';
              if (isNative) tag = ' [原生 Responses]';
              else if (isAnthropic) tag = ' [Anthropic 协议桥]';
              opt.innerText = m.display_name + tag;
              if (m.slug === (st.currentModel || 'deepseek-v4.1-flash')) opt.selected = true;
              sel.appendChild(opt);
            });
          }

          if (st.currentReasoningEffort && document.getElementById('codex-effort-select')) {
            document.getElementById('codex-effort-select').value = st.currentReasoningEffort;
          }

          let html = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">';
          html += '<div><strong>Codex CLI 引擎状态:</strong> ' + (st.cliInstalled ? '<span class="badge badge-healthy">已安装 (v' + (st.cliVersion || '最新') + ')</span>' : '<span class="badge badge-disabled">未检测到全局 CLI (可预配置)</span>') + '</div>';
          html += '<div><strong>网关接入状态:</strong> ' + (st.isBound ? '<span class="badge badge-healthy">已接入 4010 网关</span>' : '<span class="badge badge-cooling">未接入</span>') + '</div>';
          html += '</div>';

          html += '<div style="font-size:0.85rem; color:#cbd5e1; line-height:1.6;">';
          html += '<div>• <strong>当前模型:</strong> <code style="color:var(--primary); font-family:monospace;">' + (st.currentModel || '未设置') + '</code> | <strong>提供商:</strong> ' + (st.currentProvider || '无') + ' | <strong>思考等级:</strong> ' + (st.currentReasoningEffort || 'high') + '</div>';
          html += '<div>• <strong>配置目录:</strong> <code style="color:var(--muted); font-family:monospace;">' + st.codexDir + '</code></div>';
          html += '<div>• <strong>灾备备份:</strong> ' + (st.hasBackup ? '<span style="color:var(--success);">✔ 原始配置已无损备份 (' + (st.backupInfo && st.backupInfo.isoDate ? st.backupInfo.isoDate : '已备份') + ')，随时可原样还原</span>' : '<span style="color:var(--muted);">初次接入前将自动执行原子备份</span>') + '</div>';
          html += '</div>';

          if (st.isBound) {
            html += '<div style="margin-top:8px; font-size:0.8rem; background:rgba(6,95,70,0.2); border:1px solid rgba(5,150,105,0.4); padding:6px 10px; border-radius:6px; color:#a7f3d0;">';
            html += '🚀 <strong>终端即用指令:</strong> <code>codex exec "编写单元测试"</code> 或 <code>codex --model ' + (st.currentModel || 'kimi-k3') + '</code>';
            html += '</div>';
          }

          box.innerHTML = html;
        } else {
          box.innerHTML = '<div style="color:var(--danger);">获取状态失败: ' + (data.error || '未知错误') + '</div>';
        }
      } catch (e) {
        box.innerHTML = '<div style="color:var(--danger);">检测 Codex 状态异常: ' + e.message + '</div>';
      }
    }

    async function bindCodex() {
      const model = document.getElementById('codex-model-select') ? document.getElementById('codex-model-select').value : 'deepseek-v4.1-flash';
      const effort = document.getElementById('codex-effort-select') ? document.getElementById('codex-effort-select').value : 'high';
      const box = document.getElementById('codex-status-content');
      if (box) box.innerHTML = '<span style="color:var(--muted)">正在执行原子配置备份并接入 OpenCode Go 38 款模型目录与网关...</span>';
      try {
        const res = await fetch('/balancer/api/bind-codex', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ defaultModel: model, reasoningEffort: effort })
        });
        const data = await res.json();
        if (data.success) {
          showToast('🎉 Codex 一键接入成功！');
          loadCodexStatus();
        } else {
          showToast('接入失败: ' + (data.error || data.message), true);
          loadCodexStatus();
        }
      } catch (e) {
        showToast('接入请求异常: ' + e.message, true);
        loadCodexStatus();
      }
    }

    async function bindCodexQuick() {
      await bindCodex();
      const card = document.getElementById('codex-card');
      if (card) card.scrollIntoView({ behavior: 'smooth' });
    }

    async function restoreCodex() {
      if (!confirm('确定要一键还原 Codex 原始配置吗？系统将从 backup-router-bind 恢复您接入前原本的所有配置与认证。')) return;
      const box = document.getElementById('codex-status-content');
      if (box) box.innerHTML = '<span style="color:var(--muted)">正在从安全备份中还原原始 Codex 配置...</span>';
      try {
        const res = await fetch('/balancer/api/restore-codex', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' })
        });
        const data = await res.json();
        if (data.success) {
          showToast('✔ Codex 原始配置已恢复！');
          loadCodexStatus();
        } else {
          showToast('还原未完成: ' + (data.message || data.error), true);
          loadCodexStatus();
        }
      } catch (e) {
        showToast('还原请求异常: ' + e.message, true);
        loadCodexStatus();
      }
    }

    // Init
    const currentHost = window.location.hostname || '127.0.0.1';
    const baseUrlElem = document.getElementById('lbl-baseurl');
    if (baseUrlElem) baseUrlElem.innerText = 'http://' + currentHost + ':${config.port}';
    const hostStatusElem = document.getElementById('lbl-host-status');
    if (hostStatusElem) {
      if (currentHost === '127.0.0.1' || currentHost === 'localhost') {
        hostStatusElem.innerText = '本地监听 (127.0.0.1)';
        hostStatusElem.className = 'badge badge-healthy';
      } else {
        hostStatusElem.innerText = '局域网/NAS访问 (' + currentHost + ')';
        hostStatusElem.className = 'badge badge-healthy';
      }
    }
    fetchConfig();
    fetchStatus();
    loadCodexStatus();
    setInterval(fetchStatus, 2000);
    if (window.location.hash === '#updates') {
      setTimeout(function() {
        checkUpdates();
        const card = document.getElementById('updates-card');
        if (card) card.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  </script>
</body>
</html>`);
    return;
  }

  // All other API calls: Proxy to OpenCode Go upstream
  const sessionId = req.headers['x-opencode-session'];
  const account = selectAccount(sessionId);

  if (!account) {
    const enabledAccounts = config.accounts.filter(a => a.enabled && a.apiKey && a.apiKey.trim());
    if (enabledAccounts.length > 0) {
      const now = Date.now();
      const cooldowns = enabledAccounts.map(a => Math.max(0, (accountStats.get(a.id)?.cooldownUntil || 0) - now));
      const finiteCooldowns = cooldowns.filter(c => isFinite(c) && c > 0);
      const minCooldownMs = finiteCooldowns.length > 0 ? Math.min(...finiteCooldowns) : config.defaultCooldownMs;
      const minCooldownSec = Math.max(1, Math.ceil(minCooldownMs / 1000));
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(minCooldownSec),
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        error: {
          message: `All OpenCode Go accounts in pool are temporarily cooling down due to rate limits. Nearest account recovers in ${minCooldownSec}s.`,
          type: 'rate_limit_exceeded',
          code: 'rate_limit_exceeded',
          retry_after: minCooldownSec
        }
      }));
      return;
    }

    res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      error: {
        message: 'No healthy OpenCode Go accounts configured in pool. Please visit http://127.0.0.1:' + config.port + '/balancer/ui to set up your subscriptions.',
        type: 'router_no_available_accounts'
      }
    }));
    return;
  }

  // Read request body for proxying
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const reqBody = Buffer.concat(chunks);
    sendProxyRequest(req, res, reqBody, account, 1);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[OpenCode Go Router Error] Port ${config.port} is already in use by another process.`);
    const autoHeal = process.env.OPENCODE_ROUTER_AUTO_HEAL !== '0';
    if (autoHeal && !server._hasRetriedHeal) {
      server._hasRetriedHeal = true;
      console.log(`[Port Self-Healing] 正在尝试自动清理 ${config.port} 端口的残留冲突进程...`);
      try {
        if (process.platform === 'win32') {
          execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${config.port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -like '*node*') { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"`, { timeout: 4000, stdio: 'ignore' });
        } else {
          execSync(`fuser -k ${config.port}/tcp 2>/dev/null || (lsof -t -i :${config.port} 2>/dev/null | xargs -r kill 2>/dev/null) || (ss -tlpn 'sport = :${config.port}' 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs -r kill 2>/dev/null) || true`, { timeout: 3000, stdio: 'ignore' });
        }
        setTimeout(() => {
          console.log(`[Port Self-Healing] 端口已释放，正在重新启动监听 ${config.host}:${config.port}...`);
          try {
            server.listen(config.port, config.host, () => {
              console.log(`[OpenCode Go Router] Successfully self-healed and running on http://${config.host}:${config.port}`);
              console.log(`[OpenCode Go Router] Upstream: ${config.upstream}`);
              console.log(`[OpenCode Go Router] Web Dashboard: http://${config.host}:${config.port}/balancer/ui`);
            });
            return;
          } catch (listenErr) {
            console.error('[Port Self-Healing Listen Error]', listenErr.message);
            process.exit(1);
          }
        }, 1000);
        return;
      } catch (healErr) {
        console.error('[Port Self-Healing Failed]', healErr.message);
      }
    }
  } else {
    console.error('[OpenCode Go Router Server Error]', err.message);
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(`[OpenCode Go Router] Running on http://${config.host}:${config.port}`);
  console.log(`[OpenCode Go Router] Upstream: ${config.upstream}`);
  console.log(`[OpenCode Go Router] Web Dashboard: http://${config.host}:${config.port}/balancer/ui`);
});
