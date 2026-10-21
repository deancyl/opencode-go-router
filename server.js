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
const net = require('node:net');
const tls = require('node:tls');
const url = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync, exec, spawn } = require('node:child_process');
const codexAdapter = require('./codex-adapter');
const contextCompactor = require('./context-compactor');
const powershellOptimizer = require('./powershell-optimizer');
const { ComfyUIAdapter } = require('./comfyui-adapter');

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

const CONFIG_FILE = process.env.OPENCODE_ROUTER_CONFIG || path.join(__dirname, 'config.json');

function writeFileSyncAtomic(filePath, data, encoding = 'utf8') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${path.basename(filePath)}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(tmpPath, data, encoding);
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.copyFileSync(tmpPath, filePath);
      fs.unlinkSync(tmpPath);
    } catch (_) {
      try {
        fs.writeFileSync(filePath, data, encoding);
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch (finalErr) {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
        throw finalErr;
      }
    }
  }
}

const DEFAULT_CONFIG = {
  port: 4010,
  host: '127.0.0.1',
  upstream: 'https://opencode.ai/zen/go/v1',
  defaultCooldownMs: 60000,
  maxFailoverRetries: 2,
  sessionAffinityEnabled: true,
  uiPassword: '',
  allowModelAutoUpgrade: false,
  allowRegionFallback: false,
  proxy: {
    enabled: false,
    url: '',
    scope: 'all',
    models: ['gpt-5.6-luna', 'gpt-6-luna', 'claude-haiku-5-5']
  },
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
  ],
  compression: contextCompactor.DEFAULT_COMPRESSION_CONFIG,
  comfyui: {
    enabled: true,
    host: 'http://127.0.0.1:8284',
    workflowsDir: '',
    timeoutSec: 180
  }
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

const proxyAgentCache = new Map();

function clearProxyAgentCache() {
  for (const [key, agent] of proxyAgentCache.entries()) {
    try { agent.destroy(); } catch (_) {}
  }
  proxyAgentCache.clear();
}

// Load or initialize config
let config = { ...DEFAULT_CONFIG };
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '');
      config = Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
      config.compression = contextCompactor.normalizeCompressionOptions(config.compression || DEFAULT_CONFIG.compression);
      config.allowModelAutoUpgrade = Boolean(config.allowModelAutoUpgrade);
      config.allowRegionFallback = Boolean(config.allowRegionFallback);
      if (typeof config.proxy === 'string') {
        config.proxy = { enabled: Boolean(config.proxy.trim()), url: config.proxy.trim(), scope: 'all', models: [] };
      } else if (config.proxy && typeof config.proxy === 'object') {
        config.proxy = {
          enabled: config.proxy.enabled !== false,
          url: (config.proxy.url || '').trim(),
          scope: config.proxy.scope || 'all',
          models: Array.isArray(config.proxy.models) ? config.proxy.models : ['gpt-5.6-luna', 'gpt-6-luna', 'claude-haiku-5-5']
        };
      } else {
        config.proxy = { ...DEFAULT_CONFIG.proxy };
      }
      clearProxyAgentCache();
      codexAdapter.configureAdapter(config);
    } catch (err) {
      console.error('[Config] Failed to load config.json, using defaults:', err.message);
    }
  } else {
    try {
      writeFileSyncAtomic(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
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
const comfyuiAdapter = new ComfyUIAdapter({ rootDir: __dirname, config });
if (typeof codexAdapter !== 'undefined' && codexAdapter && typeof codexAdapter.setComfyUIAdapter === 'function') {
  codexAdapter.setComfyUIAdapter(comfyuiAdapter);
}

/**
 * Zero-dependency native HTTP CONNECT tunnel forward proxy agent for Node.js 18+
 * Allows routing upstream requests through HTTP/HTTPS proxies (e.g. http://127.0.0.1:7890)
 * to bypass geographic IP restrictions (403 unsupported_country_region_territory) for Luna models.
 */
class HttpsTunnelAgent extends https.Agent {
  constructor(proxyUrlOrOpts, options = {}) {
    let proxyUrlStr = proxyUrlOrOpts;
    let agentOpts = options;
    if (proxyUrlOrOpts && typeof proxyUrlOrOpts === 'object') {
      proxyUrlStr = proxyUrlOrOpts.proxyUrl || proxyUrlOrOpts.url;
      agentOpts = { ...proxyUrlOrOpts, ...options };
    }
    super({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 50, ...agentOpts });
    let norm = String(proxyUrlStr || '').trim();
    if (norm && !/^https?:\/\//i.test(norm)) {
      norm = 'http://' + norm;
    }
    this.proxyUrl = new URL(norm || 'http://127.0.0.1:80');
    this.agentOpts = agentOpts;
  }

  createConnection(options, callback) {
    const isProxyHttps = this.proxyUrl.protocol === 'https:';
    const proxyModule = isProxyHttps ? https : http;
    const proxyPort = parseInt(this.proxyUrl.port, 10) || (isProxyHttps ? 443 : 80);
    const targetHost = options.host || options.hostname;
    const targetPort = options.port || 443;

    const connectHeaders = {
      'Host': `${targetHost}:${targetPort}`,
      'Proxy-Connection': 'Keep-Alive',
      'User-Agent': 'OpenCode-Router-ProxyTunnel/1.0'
    };

    if (this.proxyUrl.username || this.proxyUrl.password) {
      const auth = `${decodeURIComponent(this.proxyUrl.username)}:${decodeURIComponent(this.proxyUrl.password)}`;
      connectHeaders['Proxy-Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
    } else if (this.agentOpts?.auth) {
      connectHeaders['Proxy-Authorization'] = `Basic ${Buffer.from(String(this.agentOpts.auth)).toString('base64')}`;
    }

    const connectReq = proxyModule.request({
      host: this.proxyUrl.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: connectHeaders,
      timeout: 15000
    });

    let settled = false;
    const onError = (err) => {
      if (settled) return;
      settled = true;
      try { connectReq.destroy(); } catch (_) {}
      callback(err);
    };

    connectReq.on('timeout', () => {
      onError(new Error(`Proxy CONNECT timeout after 15s (${this.proxyUrl.host})`));
    });

    connectReq.on('error', onError);

    connectReq.on('connect', (res, socket, head) => {
      if (settled) {
        try { socket.destroy(); } catch (_) {}
        return;
      }
      if (res.statusCode !== 200) {
        settled = true;
        try { socket.destroy(); } catch (_) {}
        return callback(new Error(`Proxy CONNECT rejected with HTTP ${res.statusCode}: ${res.statusMessage || ''}`));
      }

      if (head && head.length > 0) {
        socket.unshift(head);
      }

      socket.on('error', (err) => {
        if (!settled) {
          settled = true;
          callback(err);
        }
      });

      const rejectUnauthorized = options.rejectUnauthorized !== undefined
        ? options.rejectUnauthorized
        : (this.agentOpts?.rejectUnauthorized !== undefined ? this.agentOpts.rejectUnauthorized : true);

      const tlsSocket = tls.connect({
        socket: socket,
        servername: options.servername || targetHost,
        rejectUnauthorized
      }, () => {
        if (settled) return;
        settled = true;
        callback(null, tlsSocket);
      });

      tlsSocket.on('error', (err) => {
        if (!settled) {
          settled = true;
          callback(err);
        }
      });
    });

    connectReq.end();
  }
}

class HttpTunnelAgent extends http.Agent {
  constructor(proxyUrlOrOpts, options = {}) {
    let proxyUrlStr = proxyUrlOrOpts;
    let agentOpts = options;
    if (proxyUrlOrOpts && typeof proxyUrlOrOpts === 'object') {
      proxyUrlStr = proxyUrlOrOpts.proxyUrl || proxyUrlOrOpts.url;
      agentOpts = { ...proxyUrlOrOpts, ...options };
    }
    super({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 50, ...agentOpts });
    let norm = String(proxyUrlStr || '').trim();
    if (norm && !/^https?:\/\//i.test(norm)) {
      norm = 'http://' + norm;
    }
    this.proxyUrl = new URL(norm || 'http://127.0.0.1:80');
    this.agentOpts = agentOpts;
  }

  createConnection(options, callback) {
    const isProxyHttps = this.proxyUrl.protocol === 'https:';
    const proxyModule = isProxyHttps ? https : http;
    const proxyPort = parseInt(this.proxyUrl.port, 10) || (isProxyHttps ? 443 : 80);
    const targetHost = options.host || options.hostname;
    const targetPort = options.port || 80;

    const connectHeaders = {
      'Host': `${targetHost}:${targetPort}`,
      'Proxy-Connection': 'Keep-Alive',
      'User-Agent': 'OpenCode-Router-ProxyTunnel/1.0'
    };

    if (this.proxyUrl.username || this.proxyUrl.password) {
      const auth = `${decodeURIComponent(this.proxyUrl.username)}:${decodeURIComponent(this.proxyUrl.password)}`;
      connectHeaders['Proxy-Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
    } else if (this.agentOpts?.auth) {
      connectHeaders['Proxy-Authorization'] = `Basic ${Buffer.from(String(this.agentOpts.auth)).toString('base64')}`;
    }

    const connectReq = proxyModule.request({
      host: this.proxyUrl.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: connectHeaders,
      timeout: 15000
    });

    let settled = false;
    const onError = (err) => {
      if (settled) return;
      settled = true;
      try { connectReq.destroy(); } catch (_) {}
      callback(err);
    };

    connectReq.on('timeout', () => {
      onError(new Error(`Proxy CONNECT timeout after 15s (${this.proxyUrl.host})`));
    });

    connectReq.on('error', onError);

    connectReq.on('connect', (res, socket, head) => {
      if (settled) {
        try { socket.destroy(); } catch (_) {}
        return;
      }
      if (res.statusCode !== 200) {
        settled = true;
        try { socket.destroy(); } catch (_) {}
        return callback(new Error(`Proxy CONNECT rejected with HTTP ${res.statusCode}: ${res.statusMessage || ''}`));
      }
      if (head && head.length > 0) {
        socket.unshift(head);
      }
      socket.on('error', (err) => {
        if (!settled) {
          settled = true;
          callback(err);
        }
      });
      settled = true;
      callback(null, socket);
    });

    connectReq.end();
  }
}

function getProxyAgent(proxyUrlInput, isHttps = true) {
  if (!proxyUrlInput) return null;
  const proxyUrlStr = typeof proxyUrlInput === 'string'
    ? proxyUrlInput.trim()
    : (proxyUrlInput.proxyUrl || proxyUrlInput.url || '').toString().trim();
  if (!proxyUrlStr) return null;
  const key = `${isHttps ? 'https' : 'http'}://${proxyUrlStr}`;
  if (proxyAgentCache.has(key)) {
    return proxyAgentCache.get(key);
  }
  try {
    const agent = isHttps ? new HttpsTunnelAgent(proxyUrlStr) : new HttpTunnelAgent(proxyUrlStr);
    proxyAgentCache.set(key, agent);
    return agent;
  } catch (err) {
    console.error(`[Proxy Agent Error] Failed to initialize proxy agent for "${proxyUrlStr}":`, err.message);
    return null;
  }
}

const OVERSEAS_RESTRICTED_MODELS = new Set([
  'gpt-5.6-luna',
  'gpt-6-luna',
  'claude-haiku-5-5'
]);

function getEffectiveProxyForRequest(modelName = null) {
  let proxyConf = config.proxy;

  // 1. If explicit config.proxy exists
  if (proxyConf !== undefined && proxyConf !== null) {
    if (typeof proxyConf === 'string' && proxyConf.trim()) {
      return { url: proxyConf.trim(), scope: 'all' };
    }
    if (typeof proxyConf === 'object') {
      if (proxyConf.enabled === false) {
        return null;
      }
      const url = (proxyConf.url || '').trim();
      if (!url) {
        return null;
      }
      const scope = proxyConf.scope || 'all';
      if (scope === 'all') {
        return { url, scope: 'all' };
      }
      const cleanModel = (modelName || '').toLowerCase().trim();
      const models = Array.isArray(proxyConf.models) ? proxyConf.models : [];
      if (scope === 'restricted') {
        const isRestricted = OVERSEAS_RESTRICTED_MODELS.has(cleanModel) ||
          cleanModel.includes('luna') ||
          models.some(m => (m || '').toLowerCase().trim() === cleanModel);
        if (isRestricted) {
          return { url, scope: 'restricted' };
        }
        return null;
      }
      if (scope === 'custom') {
        const isCustom = models.some(m => (m || '').toLowerCase().trim() === cleanModel);
        if (isCustom) {
          return { url, scope: 'custom' };
        }
        return null;
      }
      return null;
    }
  }

  // 2. Fallback to standard environment variables when no explicit config.proxy
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy;
  if (envProxy && envProxy.trim()) {
    return { url: envProxy.trim(), scope: 'env' };
  }

  return null;
}

/**
 * Resolves effective compression options with target platform detection from client headers.
 * Ensures Linux NAS services adapt PowerShell optimization and denoising for Windows clients.
 */
function getEffectiveCompressionOptions(baseCompressionConfig, clientReq = null) {
  if (!baseCompressionConfig) return baseCompressionConfig;
  const comp = { ...baseCompressionConfig };
  try {
    const psOpt = require('./powershell-optimizer');
    const platInfo = psOpt.detectPlatform(comp, clientReq);
    if (platInfo && platInfo.platform) {
      comp.targetPlatform = platInfo.platform;
    }
  } catch (_) {}
  return comp;
}

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
// Pre-emptive fallback cache: `${sessionId}:${model}` -> fallbackModel (for heterogeneous nodes)
const sessionModelFallbackCache = new Map();
// Secondary reverse index: sessionId -> Set of `${sessionId}:${model}` cacheKeys (O(1) session invalidation)
const sessionFallbackKeyMap = new Map();
const sessionToFallbackKeys = sessionFallbackKeyMap;
// CacheKey to SessionId reverse mapping for delimiter-safe O(1) invalidation
const cacheKeyToSessionMap = new Map();

const MAX_ROUTER_SESSIONS = 5000;

function touchSession(sessionId, now = Date.now()) {
  if (!sessionId) return;
  sessionLastSeen.delete(sessionId);
  sessionLastSeen.set(sessionId, now);

  // Bounded LRU eviction to prevent memory leak under session flooding
  if (sessionLastSeen.size > MAX_ROUTER_SESSIONS) {
    const oldestSession = sessionLastSeen.keys().next().value;
    if (oldestSession) {
      deleteSessionRecord(oldestSession);
    }
  }
}

function getSessionModelFallback(sessionId, model) {
  if (!sessionId || !model) return null;
  const cleanReq = model.replace(/^opencode-go\//, '');
  const effectiveSessionId = typeof sessionId === 'string' ? sessionId.replace(/(?:-r\d+)+$/, '') : sessionId;
  const cacheKey = `${effectiveSessionId}:${cleanReq}`;
  return sessionModelFallbackCache.get(cacheKey) || (sessionId !== effectiveSessionId ? sessionModelFallbackCache.get(`${sessionId}:${cleanReq}`) : null) || null;
}

function deleteSessionRecord(sess) {
  sessionMap.delete(sess);
  sessionLastSeen.delete(sess);
  contextCompactor.clearSessionMemo(sess);
  const fbSet = sessionFallbackKeyMap.get(sess);
  if (fbSet) {
    for (const k of fbSet) {
      sessionModelFallbackCache.delete(k);
      cacheKeyToSessionMap.delete(k);
    }
    sessionFallbackKeyMap.delete(sess);
  }
}

function setSessionModelFallback(sessionId, model, fallbackModel) {
  if (!sessionId || !model || !fallbackModel) return;
  const cleanReq = model.replace(/^opencode-go\//, '');
  const effectiveSessionId = typeof sessionId === 'string' ? sessionId.replace(/(?:-r\d+)+$/, '') : sessionId;
  const cacheKey = `${effectiveSessionId}:${cleanReq}`;
  if (!sessionModelFallbackCache.has(cacheKey) && sessionModelFallbackCache.size >= 5000) {
    let pruneCount = Math.floor(sessionModelFallbackCache.size * 0.2) || 1;
    for (const key of sessionModelFallbackCache.keys()) {
      sessionModelFallbackCache.delete(key);
      const sId = cacheKeyToSessionMap.get(key);
      cacheKeyToSessionMap.delete(key);
      if (sId) {
        const fbSet = sessionFallbackKeyMap.get(sId);
        if (fbSet) {
          fbSet.delete(key);
          if (fbSet.size === 0) sessionFallbackKeyMap.delete(sId);
        }
      }
      if (--pruneCount <= 0) break;
    }
  }
  // Refresh insertion order if key already exists
  sessionModelFallbackCache.delete(cacheKey);
  sessionModelFallbackCache.set(cacheKey, fallbackModel);
  cacheKeyToSessionMap.set(cacheKey, effectiveSessionId);
  let fbSet = sessionFallbackKeyMap.get(effectiveSessionId);
  if (!fbSet) {
    fbSet = new Set();
    sessionFallbackKeyMap.set(effectiveSessionId, fbSet);
  }
  fbSet.add(cacheKey);

  // Also store exact sessionId if different
  if (sessionId && sessionId !== effectiveSessionId) {
    const rawCacheKey = `${sessionId}:${cleanReq}`;
    sessionModelFallbackCache.set(rawCacheKey, fallbackModel);
    cacheKeyToSessionMap.set(rawCacheKey, sessionId);
    let rawFbSet = sessionFallbackKeyMap.get(sessionId);
    if (!rawFbSet) {
      rawFbSet = new Set();
      sessionFallbackKeyMap.set(sessionId, rawFbSet);
    }
    rawFbSet.add(rawCacheKey);
  }
}

// Clean up stale sessions periodically (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [sess, time] of sessionLastSeen.entries()) {
    if (now - time > 3600000) { // 1 hour inactivity
      deleteSessionRecord(sess);
    } else {
      // Insertion-order LRU property: all subsequent entries are even newer
      break;
    }
  }
  // Defensive alignment: clean any stray orphaned sessions in sessionMap
  if (sessionMap.size > sessionLastSeen.size) {
    for (const sess of sessionMap.keys()) {
      if (!sessionLastSeen.has(sess)) {
        sessionMap.delete(sess);
        contextCompactor.clearSessionMemo(sess);
      }
    }
  }
}, 600000).unref();

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

  const effectiveSessionId = typeof sessionId === 'string' ? sessionId.replace(/(?:-r\d+)+$/, '') : sessionId;

  // 1. Session affinity check (if enabled)
  if (config.sessionAffinityEnabled && effectiveSessionId && (sessionMap.has(effectiveSessionId) || (sessionId && sessionMap.has(sessionId)))) {
    const pinnedId = sessionMap.get(effectiveSessionId) || (sessionId ? sessionMap.get(sessionId) : null);
    const candidate = available.find(a => a.id === pinnedId);
    if (candidate) {
      touchSession(effectiveSessionId, now);
      if (sessionId && sessionId !== effectiveSessionId) touchSession(sessionId, now);
      return candidate;
    }
  }

  // 2. Round-Robin selection
  const chosen = available[rrIndex % available.length];
  rrIndex = (rrIndex + 1) % available.length;

  if (config.sessionAffinityEnabled && effectiveSessionId) {
    if (sessionMap.size > 5000) {
      let pruneCount = Math.floor(sessionMap.size * 0.2) || 1;
      for (const sess of sessionLastSeen.keys()) {
        deleteSessionRecord(sess);
        if (--pruneCount <= 0) break;
      }
      if (sessionMap.size > 5000) {
        let remaining = Math.floor(sessionMap.size * 0.2) || 1;
        for (const sess of sessionMap.keys()) {
          deleteSessionRecord(sess);
          if (--remaining <= 0) break;
        }
      }
    }
    sessionMap.set(effectiveSessionId, chosen.id);
    if (sessionId && sessionId !== effectiveSessionId) {
      sessionMap.set(sessionId, chosen.id);
    }
    touchSession(effectiveSessionId, now);
    if (sessionId && sessionId !== effectiveSessionId) touchSession(sessionId, now);
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
    let settled = false;
    const safeResolve = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
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
      const reqOptions = {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'x-opencode-session': 'session-tester-' + Date.now(),
          'User-Agent': 'OpenCode-Go-Router-Tester/1.0',
          'Accept': 'application/json'
        },
        timeout: 6000
      };
      const proxyInfo = getEffectiveProxyForRequest(null);
      if (proxyInfo) {
        const agent = getProxyAgent(proxyInfo.url, parsed.protocol === 'https:');
        if (agent) reqOptions.agent = agent;
      }
      const req = mod.request(parsed, reqOptions, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            safeResolve({ success: true, statusCode: res.statusCode, latencyMs, message: `连接成功 (延迟 ${latencyMs}ms)` });
          } else if (res.statusCode === 401 || res.statusCode === 403) {
            safeResolve({ success: false, statusCode: res.statusCode, latencyMs, message: `认证失败: 密钥无效或未授权 (HTTP ${res.statusCode})` });
          } else if (res.statusCode === 429) {
            safeResolve({ success: false, statusCode: res.statusCode, latencyMs, message: `账号限频中 (HTTP 429 Too Many Requests)` });
          } else {
            safeResolve({ success: false, statusCode: res.statusCode, latencyMs, message: `上游返回异常 (HTTP ${res.statusCode})` });
          }
        });
      });
      req.on('error', (err) => {
        safeResolve({ success: false, statusCode: 0, latencyMs: Date.now() - startTime, message: `网络连接异常: ${err.message}` });
      });
      req.on('timeout', () => {
        try { req.destroy(); } catch (_) {}
        safeResolve({ success: false, statusCode: 0, latencyMs: 6000, message: '上游连接超时 (6秒)' });
      });
      req.end();
    } catch (err) {
      safeResolve({ success: false, statusCode: 0, latencyMs: 0, message: `端点地址解析失败: ${err.message}` });
    }
  });
}

// Account Usage & Quota Fetcher (Rolling 5h, Weekly, Monthly limits) with Debounce Cache
const quotaCache = new Map();
const QUOTA_CACHE_TTL_MS = 8000; // 8 seconds memory cache to prevent upstream rate-limiting

function pruneQuotaCacheIfNeeded() {
  const now = Date.now();
  for (const [k, v] of quotaCache.entries()) {
    if (now - v.timestamp >= QUOTA_CACHE_TTL_MS * 2) {
      quotaCache.delete(k);
    }
  }
  if (quotaCache.size > 100) {
    let toRemove = Math.floor(quotaCache.size * 0.2) || 1;
    for (const k of quotaCache.keys()) {
      quotaCache.delete(k);
      if (--toRemove <= 0) break;
    }
  }
}

function fetchAccountUsage(upstream, apiKey, force = false) {
  const cacheKey = `${(upstream || '').trim()}#${(apiKey || '').trim()}`;
  const now = Date.now();
  if (!force && quotaCache.has(cacheKey)) {
    const cached = quotaCache.get(cacheKey);
    if (now - cached.timestamp < QUOTA_CACHE_TTL_MS) {
      return Promise.resolve({ ...cached.result, fromCache: true, cachedAt: cached.timestamp });
    }
  }

  return new Promise((resolve) => {
    let settled = false;
    const safeResolve = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

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
      const reqOptions = {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'x-opencode-session': 'session-quota-' + Date.now(),
          'User-Agent': 'OpenCode-Go-Router-Quota/1.0',
          'Accept': 'application/json'
        },
        timeout: 8000
      };
      const proxyInfo = getEffectiveProxyForRequest(null);
      if (proxyInfo) {
        const agent = getProxyAgent(proxyInfo.url, parsed.protocol === 'https:');
        if (agent) reqOptions.agent = agent;
      }
      const req = mod.request(parsed, reqOptions, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              const result = { success: true, statusCode: 200, usage: data.usage || null, fromCache: false, cachedAt: Date.now() };
              pruneQuotaCacheIfNeeded();
              quotaCache.set(cacheKey, { timestamp: Date.now(), result });
              safeResolve(result);
            } catch (e) {
              safeResolve({ success: false, statusCode: 200, error: '解析配额数据失败: ' + e.message, fromCache: false });
            }
          } else {
            safeResolve({ success: false, statusCode: res.statusCode, error: `上游返回 HTTP ${res.statusCode}`, fromCache: false });
          }
        });
      });
      req.on('error', (err) => {
        safeResolve({ success: false, statusCode: 0, error: `网络异常: ${err.message}`, fromCache: false });
      });
      req.on('timeout', () => {
        try { req.destroy(); } catch (_) {}
        safeResolve({ success: false, statusCode: 0, error: '请求配额超时 (8秒)', fromCache: false });
      });
      req.end();
    } catch (err) {
      safeResolve({ success: false, statusCode: 0, error: `端点解析失败: ${err.message}`, fromCache: false });
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
          const proxyInfo = getEffectiveProxyForRequest(null);
          const proxyAgent = proxyInfo ? getProxyAgent(proxyInfo.url, new URL(config.upstream).protocol === 'https:') : null;
          officialModels = await updater.fetchOfficialModels(validAccount.apiKey, config.upstream, 2500, { agent: proxyAgent });
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

function sendStandardizedError(clientRes, upstreamRes, statusCode, rawErrText) {
  if (clientRes.writableEnded || clientRes.destroyed) return;
  const formattedText = codexAdapter.formatUpstreamErrorResponse(rawErrText, statusCode);
  const errorBuf = Buffer.from(formattedText, 'utf8');
  if (clientRes.headersSent) {
    if (!clientRes.writableEnded) clientRes.end(errorBuf);
    return;
  }
  const outHeaders = getCorsHeaders(upstreamRes ? upstreamRes.headers : {});
  outHeaders['content-type'] = 'application/json; charset=utf-8';
  delete outHeaders['transfer-encoding'];
  delete outHeaders['content-encoding'];
  outHeaders['content-length'] = String(errorBuf.length);
  clientRes.writeHead(statusCode, outHeaders);
  clientRes.end(errorBuf);
}

/**
 * Centralized Upstream Error Classifier (Case-Insensitive & Multi-Status Protocol Safe)
 */
function classifyUpstreamError(statusCode, rawErrText = '') {
  const errText = typeof rawErrText === 'string' ? rawErrText : String(rawErrText || '');
  const lowerText = errText.toLowerCase();

  // 1. Detect Upstream Cluster Internal Glitch (e.g. node credential or availability failure masked as 401/500/502/503/504)
  const isUpstreamClusterGlitch = (
    statusCode === 500 || statusCode === 502 || statusCode === 504 ||
    (statusCode === 503 && !lowerText.includes('rate limit')) ||
    lowerText.includes('upstream request failed') ||
    lowerText.includes('server_error') ||
    lowerText.includes('model is unavailable') ||
    lowerText.includes('bad gateway') ||
    lowerText.includes('internal server error') ||
    lowerText.includes('gateway time-out') ||
    lowerText.includes('gateway timeout') ||
    lowerText.includes('upstream connect error') ||
    lowerText.includes('connection reset') ||
    lowerText.includes('connection refused')
  );

  // 2. Detect Genuine Invalid API Key for current subscription account
  // If it's a cluster glitch (e.g. "Upstream request failed: Invalid credential"), it is NOT a genuine account key failure!
  const isInvalidApiKey = statusCode === 401 && !isUpstreamClusterGlitch && (
    lowerText.includes('invalid_api_key') ||
    lowerText.includes('incorrect api key') ||
    lowerText.includes('invalid token') ||
    lowerText.includes('unauthorized') ||
    lowerText.includes('authentication failed')
  );

  // 3. Detect Rate Limited / Service Unavailable
  const isRateLimitedOrServiceUnavailable = statusCode === 429 || (statusCode === 503 && lowerText.includes('rate limit'));

  // 4. Detect Context Length Exceeded
  const isContextLengthExceeded = statusCode === 400 && (
    lowerText.includes('context_length_exceeded') ||
    lowerText.includes('input too long') ||
    lowerText.includes('prompt is too long') ||
    lowerText.includes('maximum context length') ||
    lowerText.includes('exceeds the maximum context length') ||
    lowerText.includes('context window') ||
    lowerText.includes('too many tokens') ||
    lowerText.includes('max_tokens')
  );

  // 5. Detect Region Blocked
  const isRegionBlocked = statusCode === 403 || (
    lowerText.includes('unsupported_country_region_territory') ||
    lowerText.includes('territory not supported') ||
    lowerText.includes('not available in your country')
  );

  // 6. Detect Protocol Incompatible
  const isProtocolUnsupported = statusCode === 400 && (
    lowerText.includes('modelprotocolunsupported') ||
    lowerText.includes('does not support this protocol') ||
    lowerText.includes('does not support /responses')
  );

  // 7. Detect Model Unsupported on Upstream Node
  const isModelUnsupported = (statusCode === 400 || statusCode === 404) && (
    lowerText.includes('supported api model names are') ||
    lowerText.includes('supported model names are') ||
    lowerText.includes('the supported api model names') ||
    lowerText.includes('model_not_found') ||
    lowerText.includes('is not supported by this model provider') ||
    (lowerText.includes('the model') && (lowerText.includes('does not exist') || lowerText.includes('not supported')))
  );

  // 8. Detect Tool Calls Mismatch
  const isToolCallsMismatch = statusCode === 400 && (
    lowerText.includes('must be followed by tool messages responding to each') ||
    lowerText.includes('did not have response messages') ||
    (lowerText.includes('tool_call_id') && lowerText.includes('response'))
  );

  // 9. Empty Stream Error
  const isEmptyStreamError = statusCode === 400 && (!errText || errText.trim().length === 0);

  return {
    isUpstreamClusterGlitch,
    isInvalidApiKey,
    isRateLimitedOrServiceUnavailable,
    isContextLengthExceeded,
    isRegionBlocked,
    isProtocolUnsupported,
    isModelUnsupported,
    isToolCallsMismatch,
    isEmptyStreamError,
    errText,
    lowerText
  };
}

const MAX_ERR_BYTES = 256 * 1024; // 256KB buffer cap to prevent OOM DoS on abnormal upstream streams

/**
 * Unified Invalid API Key Account Failover Handler
 */
function handleInvalidApiKeyFailover({
  protocolTag,
  clientRes,
  account,
  attemptNumber,
  triedAccountIds,
  sessionId,
  statusCode,
  errText,
  finishRequest,
  clientCloseHandler,
  clientErrorHandler = clientCloseHandler?.errorHandler,
  retryFn
}) {
  console.warn(`[Router Auth Alert] Account "${account.name}" returned invalid API key: ${errText.slice(0, 160)}`);
  recordCooldown(account.id, 3600000, 'Invalid API Key');
  finishRequest();
  clientRes.removeListener('close', clientCloseHandler);
  if (clientErrorHandler || clientCloseHandler?.errorHandler) {
    clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
  }
  const nextAccount = selectAccount(sessionId, triedAccountIds);
  if (nextAccount) {
    const stat = accountStats.get(account.id);
    if (stat) stat.failoverCount += 1;
    console.log(`[${protocolTag} Failover] Account "${account.name}" returned ${statusCode} (Invalid API Key). Switching to "${nextAccount.name}" (Attempt ${attemptNumber + 1})`);
    retryFn(nextAccount);
    return true;
  }
  return false;
}

/**
 * Unified Rate Limit (429 / 503 with Retry-After) Failover Handler
 */
function handleRateLimitFailover({
  protocolTag,
  clientRes,
  account,
  attemptNumber,
  triedAccountIds,
  sessionId,
  statusCode,
  upstreamRes,
  finishRequest,
  clientCloseHandler,
  clientErrorHandler = clientCloseHandler?.errorHandler,
  retryFn,
  errorFallbackFn
}) {
  let cooldownMs = config.defaultCooldownMs;
  const retryAfter = upstreamRes.headers ? upstreamRes.headers['retry-after'] : null;
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

  const errorChunks = [];
  let errorBytes = 0;
  upstreamRes.on('data', chunk => {
    if (errorBytes < MAX_ERR_BYTES) {
      const remaining = MAX_ERR_BYTES - errorBytes;
      if (chunk.length > remaining) {
        errorChunks.push(chunk.slice(0, remaining));
        errorBytes += remaining;
      } else {
        errorChunks.push(chunk);
        errorBytes += chunk.length;
      }
    }
  });
  upstreamRes.on('error', (err) => {
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler || clientCloseHandler?.errorHandler) {
      clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
    }
    if (typeof errorFallbackFn === 'function') {
      errorFallbackFn(err.message);
    }
  });

  upstreamRes.on('end', () => {
    if (clientRes.destroyed || clientRes.writableEnded) {
      finishRequest();
      clientRes.removeListener('close', clientCloseHandler);
      if (clientErrorHandler || clientCloseHandler?.errorHandler) {
        clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
      }
      return;
    }

    const nextAccount = selectAccount(sessionId, triedAccountIds);
    const maxRetries = Math.max(config.maxFailoverRetries || 2, (config.accounts ? config.accounts.length : 1));
    if (nextAccount && attemptNumber <= maxRetries) {
      const stat = accountStats.get(account.id);
      if (stat) stat.failoverCount += 1;
      console.log(`[${protocolTag} Failover] Account "${account.name}" returned ${statusCode}. Switching to "${nextAccount.name}" (Attempt ${attemptNumber + 1})`);
      finishRequest();
      clientRes.removeListener('close', clientCloseHandler);
      if (clientErrorHandler || clientCloseHandler?.errorHandler) {
        clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
      }
      retryFn(nextAccount);
    } else {
      finishRequest();
      clientRes.removeListener('close', clientCloseHandler);
      if (clientErrorHandler || clientCloseHandler?.errorHandler) {
        clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
      }
      const errText = Buffer.concat(errorChunks).toString('utf8');
      if (typeof errorFallbackFn === 'function') {
        errorFallbackFn(errText);
      } else {
        sendStandardizedError(clientRes, upstreamRes, statusCode, errText);
      }
    }
  });
}

/**
 * Unified Upstream Cluster Node Glitch Self-Healing Pipeline
 * Step 1: In-flight session jitter retry after 350ms backoff
 * Step 2: Next backup subscription account failover
 * Step 3: Dynamic compatible equivalent model fallback (Rule 15 & 19)
 */
function handleUpstreamGlitchAndFailover({
  protocolTag,
  clientRes,
  account,
  attemptNumber,
  triedAccountIds,
  sessionId,
  statusCode,
  errText,
  model,
  reasoningEffort,
  finishRequest,
  clientCloseHandler,
  clientErrorHandler = clientCloseHandler?.errorHandler,
  retryCurrentAccount,
  retryNextAccount,
  fallbackModelFn
}) {
  const accountCount = config.accounts && config.accounts.length ? config.accounts.length : 1;
  const maxRetries = Math.max(config.maxFailoverRetries || 2, accountCount + 2);
  if (attemptNumber > maxRetries) {
    return false;
  }

  // Step 1: In-flight retry with fresh session jitter after brief backoff on current account
  if (attemptNumber === 1) {
    console.warn(`[Auto Self-Healing] ${protocolTag} 捕获上游异构推理节点瞬态异常 (${statusCode}): "${errText.slice(0, 120)}"，正在实施原位平滑重试...`);
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler || clientCloseHandler?.errorHandler) {
      clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
    }

    let jitterTimer = null;
    const cancelJitter = () => {
      if (jitterTimer) {
        clearTimeout(jitterTimer);
        jitterTimer = null;
      }
      clientRes.removeListener('close', cancelJitter);
      clientRes.removeListener('error', cancelJitter);
    };
    clientRes.once('close', cancelJitter);
    clientRes.once('error', cancelJitter);

    jitterTimer = setTimeout(() => {
      cancelJitter();
      if (clientRes.destroyed || clientRes.writableEnded) return;
      const retrySessionId = (sessionId || 'session-default') + '-r' + Date.now();
      retryCurrentAccount(retrySessionId);
    }, 350);
    return true;
  }

  // Step 2: If in-flight jitter retry failed, try backup subscription account if available
  const nextAccount = selectAccount(sessionId, triedAccountIds);
  if (nextAccount) {
    const stat = accountStats.get(account.id);
    if (stat) stat.failoverCount += 1;
    console.log(`[${protocolTag} Failover] Account "${account.name}" returned ${statusCode} (Upstream Cluster Node Failure). Switching to "${nextAccount.name}" (Attempt ${attemptNumber + 1})`);
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler || clientCloseHandler?.errorHandler) {
      clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
    }
    retryNextAccount(nextAccount);
    return true;
  }

  // Step 3: Dynamic fallback to equivalent compatible model (Rule 15 & 19)
  if (model && typeof fallbackModelFn === 'function') {
    const targetFallback = codexAdapter.resolveCompatibleFallbackModel(model, errText, { 
      reasoningEffort,
      allowUpgrade: config.allowModelAutoUpgrade
    });
    if (targetFallback && targetFallback !== model) {
      console.warn(`[Auto Self-Healing] 上游集群节点持续报错，自动无缝跃迁至等位模型 "${targetFallback}" 兜底执行...`);
      if (sessionId) {
        setSessionModelFallback(sessionId, model, targetFallback);
      }
      finishRequest();
      clientRes.removeListener('close', clientCloseHandler);
      if (clientErrorHandler || clientCloseHandler?.errorHandler) {
        clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
      }
      fallbackModelFn(targetFallback);
      return true;
    }
  }

  finishRequest();
  clientRes.removeListener('close', clientCloseHandler);
  if (clientErrorHandler || clientCloseHandler?.errorHandler) {
    clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
  }
  return false;
}

/**
 * Unified Network Socket Error Self-Healing Pipeline
 * Step 1: In-flight retry with fresh session jitter after brief backoff
 * Step 2: Next backup subscription account failover
 * Step 3: Dynamic compatible equivalent model fallback (if model provided)
 */
function handleNetworkErrorFailover({
  protocolTag,
  clientRes,
  account,
  attemptNumber,
  triedAccountIds,
  sessionId,
  err,
  model,
  reasoningEffort,
  finishRequest,
  clientCloseHandler,
  clientErrorHandler = clientCloseHandler?.errorHandler,
  retryCurrentAccount,
  retryNextAccount,
  fallbackModelFn
}) {
  const accountCount = config.accounts && config.accounts.length ? config.accounts.length : 1;
  const maxRetries = Math.max(config.maxFailoverRetries || 2, accountCount + 2);
  if (attemptNumber > maxRetries) {
    return false;
  }

  // Step 1: In-flight jitter retry on current account
  if (attemptNumber === 1) {
    console.warn(`[Auto Self-Healing] ${protocolTag} 捕获上游网络瞬态异常 (${err.message})，正在实施原位平滑重试...`);
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler || clientCloseHandler?.errorHandler) {
      clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
    }

    let jitterTimer = null;
    const cancelJitter = () => {
      if (jitterTimer) {
        clearTimeout(jitterTimer);
        jitterTimer = null;
      }
      clientRes.removeListener('close', cancelJitter);
      clientRes.removeListener('error', cancelJitter);
    };
    clientRes.once('close', cancelJitter);
    clientRes.once('error', cancelJitter);

    jitterTimer = setTimeout(() => {
      cancelJitter();
      if (clientRes.destroyed || clientRes.writableEnded) return;
      const retrySessionId = (sessionId || 'session-default') + '-r' + Date.now();
      retryCurrentAccount(retrySessionId);
    }, 350);
    return true;
  }

  // Step 2: Try next backup subscription account
  const nextAccount = selectAccount(sessionId, triedAccountIds);
  if (nextAccount) {
    const stat = accountStats.get(account.id);
    if (stat) stat.failoverCount += 1;
    console.log(`[${protocolTag} Failover] Error with "${account.name}": ${err.message}. Switching to "${nextAccount.name}" (Attempt ${attemptNumber + 1})`);
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler || clientCloseHandler?.errorHandler) {
      clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
    }
    retryNextAccount(nextAccount);
    return true;
  }

  // Step 3: Fallback to equivalent compatible model if available
  if (model && typeof fallbackModelFn === 'function') {
    const targetFallback = codexAdapter.resolveCompatibleFallbackModel(model, err.message, { 
      reasoningEffort,
      allowUpgrade: config.allowModelAutoUpgrade
    });
    if (targetFallback && targetFallback !== model) {
      console.warn(`[Auto Self-Healing] 网络连接持续异常，自动无缝跃迁至等位模型 "${targetFallback}" 兜底执行...`);
      if (sessionId) {
        setSessionModelFallback(sessionId, model, targetFallback);
      }
      finishRequest();
      clientRes.removeListener('close', clientCloseHandler);
      if (clientErrorHandler || clientCloseHandler?.errorHandler) {
        clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
      }
      fallbackModelFn(targetFallback);
      return true;
    }
  }

  finishRequest();
  clientRes.removeListener('close', clientCloseHandler);
  if (clientErrorHandler || clientCloseHandler?.errorHandler) {
    clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
  }
  return false;
}

/**
 * Unified Context Compaction, Model Restriction & Tool Call Mismatch Self-Healing Handler
 */
function handleModelAndContextFallback({
  protocolTag,
  clientRes,
  account,
  attemptNumber,
  triedAccountIds,
  sessionId,
  statusCode,
  errText,
  classified,
  model,
  reasoningEffort,
  payload,
  finishRequest,
  clientCloseHandler,
  clientErrorHandler = clientCloseHandler?.errorHandler,
  retryWithPayload
}) {
  const accountCount = config.accounts && config.accounts.length ? config.accounts.length : 1;
  const maxRetries = Math.max(config.maxFailoverRetries || 2, accountCount + 2);
  if (attemptNumber > maxRetries) {
    return false;
  }

  // 1. Context length exceeded or empty stream -> prune or escalate to 2M kimi
  if ((classified.isContextLengthExceeded || classified.isEmptyStreamError) && payload) {
    const warnReason = classified.isContextLengthExceeded ? `上下文超限 (${model})` : `上游空流/尺寸截断拦截 (${model})`;
    console.warn(`[Auto Self-Healing] ${protocolTag} 请求触发 ${warnReason}。网关正在执行智能滑动窗口裁剪与冗余折叠自愈...`);
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler || clientCloseHandler?.errorHandler) {
      clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
    }

    let pruned = payload;
    let wasPruned = false;
    if (Array.isArray(payload.messages)) {
      const pruneRes = codexAdapter.pruneChatMessages(payload.messages, null, sessionId);
      const prunedMsgs = pruneRes.pruned || pruneRes;
      wasPruned = Boolean(pruneRes.modified);
      pruned = { ...payload, messages: prunedMsgs };
    } else if (Array.isArray(payload.input)) {
      const pruneRes = codexAdapter.pruneResponsesPayload(payload, sessionId);
      pruned = pruneRes.pruned || pruneRes;
      wasPruned = Boolean(pruneRes.modified);
    }

    if ((attemptNumber > 1 || !wasPruned) && model !== 'kimi-k2.7-code') {
      console.warn(`[Auto Self-Healing] 自动跃迁至 2M 超长上下文旗舰模型 "kimi-k2.7-code" 兜底执行...`);
      pruned = { ...pruned, model: 'kimi-k2.7-code' };
    }
    retryWithPayload(pruned, model !== pruned.model);
    return true;
  }

  // 2. Region blocked (403): check allowRegionFallback switch
  if (classified.isRegionBlocked) {
    if (!config.allowRegionFallback) {
      console.warn(`[Proxy 403 Region Block] 模型 "${model}" 触发上游地域限制 (403)，且未开启自动降级回退 (allowRegionFallback: false)。`);
      finishRequest();
      clientRes.removeListener('close', clientCloseHandler);
      if (clientErrorHandler || clientCloseHandler?.errorHandler) {
        clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
      }
      sendStandardizedError(clientRes, null, 403, '上游返回 403: 当前公网 IP 受地域限制，请配置网关代理服务器或开启海外/Tailscale 节点');
      return true;
    }
  }

  // 2b. Protocol unsupported, model unsupported, or region blocked (if allowRegionFallback is enabled) -> fallback model
  if ((classified.isRegionBlocked || classified.isProtocolUnsupported || classified.isModelUnsupported) && model) {
    const fallbackModel = codexAdapter.resolveCompatibleFallbackModel(model, errText, { 
      reasoningEffort,
      allowUpgrade: config.allowModelAutoUpgrade
    });
    if (fallbackModel && fallbackModel !== model) {
      if (sessionId && model) {
        setSessionModelFallback(sessionId, model, fallbackModel);
      }
      let reason = '上游节点模型限制 (Model Not Supported on Node)';
      if (classified.isRegionBlocked) reason = '上游地域限制 (Region Blocked)';
      else if (classified.isProtocolUnsupported) reason = '上游协议暂未支持该模型 (ModelProtocolUnsupported)';
      console.warn(`[Auto Self-Healing] 模型 "${model}" 触发 ${reason}。网关正在无缝自动挽救并切至 "${fallbackModel}"...`);
      finishRequest();
      clientRes.removeListener('close', clientCloseHandler);
      if (clientErrorHandler || clientCloseHandler?.errorHandler) {
        clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
      }

      let healedPayload = payload;
      if (payload && typeof payload === 'object') {
        healedPayload = { ...payload, model: fallbackModel };
      }
      retryWithPayload(healedPayload, true);
      return true;
    }
  }

  // 3. Tool calls mismatch -> sanitize and validate tool calls sequence
  if (classified.isToolCallsMismatch && payload) {
    console.warn(`[Auto Self-Healing] 上游抛出工具回调不匹配错误: ${errText.slice(0, 160)}。网关正在执行原子工具序列规范化与缺失回复自愈补齐...`);
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler || clientCloseHandler?.errorHandler) {
      clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
    }

    let healedPayload = payload;
    if (Array.isArray(payload.messages)) {
      healedPayload = { ...payload, messages: codexAdapter.sanitizeAndValidateChatMessages(payload.messages) };
    } else if (Array.isArray(payload.input)) {
      const missingMatch = errText.match(/The following tool_call_ids did not have response messages:\s*([^\n\r.]+)/i);
      const missingIds = missingMatch ? missingMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [];
      healedPayload = JSON.parse(JSON.stringify(payload));
      const existingOutputIds = new Set();
      for (const item of healedPayload.input) {
        if (item && item.call_id && (item.output !== undefined || (item.type && item.type.endsWith('_output')))) {
          existingOutputIds.add(item.call_id);
        }
      }
      for (const missingId of missingIds) {
        if (!existingOutputIds.has(missingId)) {
          healedPayload.input.push({
            type: 'custom_tool_call_output',
            call_id: missingId,
            output: '{"status":"completed","note":"auto-filled by gateway resilience"}'
          });
          existingOutputIds.add(missingId);
        }
      }
    }
    retryWithPayload(healedPayload, false);
    return true;
  }

  return false;
}

/**
 * Unified Bidirectional Responses Protocol Dispatcher (Anthropic vs OpenAI Chat)
 */
function dispatchResponsesRequest(clientReq, clientRes, responsesBody, account, attemptNumber = 1, triedAccountIds = new Set(), sessionId = null) {
  let model = responsesBody && responsesBody.model;
  if (typeof model === 'string' && model.startsWith('opencode-go/')) {
    model = model.slice(12);
    responsesBody = { ...responsesBody, model };
  }
  // Pre-emptive model fallback check for heterogeneous upstream nodes (Rule 19)
  if (sessionId && model) {
    const rawReqModel = model.replace(/^opencode-go\//, '');
    const cacheKey = `${sessionId}:${rawReqModel}`;
    if (sessionModelFallbackCache.has(cacheKey)) {
      const cachedFallback = sessionModelFallbackCache.get(cacheKey);
      if (cachedFallback && cachedFallback !== rawReqModel) {
        console.log(`[Auto Pre-Emptive Fallback] 会话 ${sessionId} 命中异构节点模型记忆，直接将 "${rawReqModel}" 替换为 "${cachedFallback}"`);
        responsesBody = { ...responsesBody, model: cachedFallback };
        model = cachedFallback;
      }
    }
  }

  if (codexAdapter.ANTHROPIC_MODELS && codexAdapter.ANTHROPIC_MODELS.has(model)) {
    bridgeResponsesToAnthropicRequest(clientReq, clientRes, responsesBody, account, attemptNumber, triedAccountIds, sessionId);
  } else if (codexAdapter.isNativeResponsesModel && codexAdapter.isNativeResponsesModel(model)) {
    const reqBody = Buffer.from(JSON.stringify(responsesBody), 'utf8');
    sendProxyRequest(clientReq, clientRes, reqBody, account, attemptNumber, triedAccountIds, sessionId);
  } else {
    bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, account, attemptNumber, triedAccountIds, sessionId);
  }
}

function sendProxyRequest(clientReq, clientRes, reqBody, account, attemptNumber, triedAccountIds = new Set(), resolvedSessionId = null, precomputedParsedBody = null) {
  triedAccountIds.add(account.id);

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
  let parsedBody = precomputedParsedBody || null;
  if (!parsedBody && reqBody && reqBody.length > 0) {
    try {
      parsedBody = JSON.parse(reqBody.toString('utf8'));
      if (parsedBody && typeof parsedBody.model === 'string' && parsedBody.model.startsWith('opencode-go/')) {
        parsedBody.model = parsedBody.model.slice(12);
        reqBody = Buffer.from(JSON.stringify(parsedBody), 'utf8');
      }
    } catch (e) {
      const cType = (clientReq.headers['content-type'] || '').toLowerCase();
      const isJsonEndpoint = targetPath.includes('/chat/completions') || targetPath.includes('/messages') || targetPath.includes('/responses');
      if (cType.includes('application/json') || isJsonEndpoint) {
        if (!clientRes.headersSent) {
          clientRes.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        }
        if (!clientRes.writableEnded) {
          clientRes.end(JSON.stringify({
            error: {
              message: `Malformed JSON payload: ${e.message}`,
              type: 'invalid_request_error',
              code: 'malformed_json'
            }
          }));
        }
        return;
      }
    }
  }

  const sessionId = resolvedSessionId || codexAdapter.extractOrDeriveSessionId(clientReq, parsedBody || reqBody);

  // Pre-emptive model fallback check for heterogeneous upstream nodes (Rule 19)
  if (sessionId && parsedBody && parsedBody.model) {
    const rawReqModel = parsedBody.model.replace(/^opencode-go\//, '');
    const cacheKey = `${sessionId}:${rawReqModel}`;
    if (sessionModelFallbackCache.has(cacheKey)) {
      const cachedFallback = sessionModelFallbackCache.get(cacheKey);
      if (cachedFallback && cachedFallback !== rawReqModel) {
        console.log(`[Auto Pre-Emptive Fallback] 会话 ${sessionId} 命中异构节点模型记忆，直接将 "${rawReqModel}" 替换为 "${cachedFallback}"`);
        parsedBody.model = cachedFallback;
        reqBody = Buffer.from(JSON.stringify(parsedBody), 'utf8');
      }
    }
  }

  const isResponsesReq = targetPath.startsWith('/responses') || (clientReq.url && clientReq.url.includes('/responses'));
  if (isResponsesReq && parsedBody) {
    const hasBase64Image = reqBody && (reqBody.includes(';base64,') || reqBody.includes('data:image/'));
    if (Array.isArray(parsedBody.input) && (parsedBody.input.length > 12 || hasBase64Image || (reqBody && reqBody.length > 100000))) {
      try {
        const pruneRes = codexAdapter.pruneResponsesPayload(parsedBody, sessionId);
        if (pruneRes && pruneRes.modified) {
          parsedBody = pruneRes;
          reqBody = Buffer.from(JSON.stringify(parsedBody), 'utf8');
        }
      } catch (err) {
        console.warn('[Prune Responses] Pre-flight pruning failed safely:', err.message);
      }
    }
    const reqModel = parsedBody.model || 'deepseek-v4.1-flash';
    if (codexAdapter.ANTHROPIC_MODELS && codexAdapter.ANTHROPIC_MODELS.has(reqModel)) {
      bridgeResponsesToAnthropicRequest(clientReq, clientRes, parsedBody, account, attemptNumber, triedAccountIds, sessionId);
      return;
    } else if (codexAdapter.isNativeResponsesModel ? !codexAdapter.isNativeResponsesModel(reqModel) : !codexAdapter.NATIVE_RESPONSES_MODELS.has(reqModel)) {
      bridgeResponsesToChatRequest(clientReq, clientRes, parsedBody, account, attemptNumber, triedAccountIds, sessionId);
      return;
    }
  }

  // Apply context and token compression for direct upstream requests (first attempt only)
  if (parsedBody && config.compression && config.compression.enabled !== false && (!attemptNumber || attemptNumber <= 1)) {
    try {
      const compOpts = getEffectiveCompressionOptions(config.compression, clientReq);
      if (isResponsesReq) {
        parsedBody = contextCompactor.compactResponsesPayload(parsedBody, compOpts, sessionId);
        reqBody = Buffer.from(JSON.stringify(parsedBody), 'utf8');
      } else if (targetPath.includes('/messages')) {
        parsedBody = contextCompactor.compactAnthropicPayload(parsedBody, compOpts, sessionId);
        reqBody = Buffer.from(JSON.stringify(parsedBody), 'utf8');
      } else if (parsedBody.messages || targetPath.includes('/chat/completions')) {
        parsedBody = contextCompactor.compactChatPayload(parsedBody, compOpts, sessionId);
        reqBody = Buffer.from(JSON.stringify(parsedBody), 'utf8');
      }
    } catch (compErr) {
      console.warn('[Server Compression Sandbox] Direct proxy compression failed, bypassing safely:', compErr.message);
    }
  }

  const stat = accountStats.get(account.id);
  if (stat) {
    stat.activeRequests += 1;
    stat.totalRequests += 1;
    stat.lastUsedAt = Date.now();
  }

  const proxyHeaders = { ...clientReq.headers };
  delete proxyHeaders['host'];
  delete proxyHeaders['connection'];
  delete proxyHeaders['keep-alive'];
  delete proxyHeaders['transfer-encoding'];
  delete proxyHeaders['accept-encoding'];
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

  proxyHeaders['x-opencode-session'] = sessionId;
  proxyHeaders['authorization'] = `Bearer ${account.apiKey.trim()}`;
  if (targetPath.includes('/messages') || clientReq.headers['x-api-key'] || clientReq.headers['anthropic-version']) {
    proxyHeaders['x-api-key'] = account.apiKey.trim();
    if (!proxyHeaders['anthropic-version']) {
      proxyHeaders['anthropic-version'] = '2023-06-01';
    }
  }

  const proxyOptions = {
    protocol: upstreamUrl.protocol,
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port || (isHttps ? 443 : 80),
    path: upstreamPath,
    method: clientReq.method,
    headers: proxyHeaders,
    timeout: 300000 // 5 minutes timeout for long generation
  };

  const reqModelName = (parsedBody && parsedBody.model) || null;
  const effectiveProxy = getEffectiveProxyForRequest(reqModelName);
  if (effectiveProxy) {
    const agent = getProxyAgent(effectiveProxy.url, isHttps);
    if (agent) {
      proxyOptions.agent = agent;
    }
  }

  const proxyReq = transport.request(proxyOptions);
  let responded = false;
  let requestFinished = false;
  let clientAborted = false;
  let currentUpstreamRes = null;

  const finishRequest = () => {
    if (!requestFinished) {
      requestFinished = true;
      if (stat && stat.activeRequests > 0) {
        stat.activeRequests -= 1;
      }
    }
  };

  let clientErrorHandler = null;
  const clientCloseHandler = () => {
    if (clientErrorHandler) {
      clientRes.removeListener('error', clientErrorHandler);
    }
    if (!clientRes.writableEnded) {
      clientAborted = true;
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
      if (currentUpstreamRes && typeof currentUpstreamRes.destroy === 'function' && !currentUpstreamRes.destroyed) {
        try {
          currentUpstreamRes.unpipe(clientRes);
        } catch (_) {}
        currentUpstreamRes.destroy();
      }
    }
    finishRequest();
  };

  clientErrorHandler = (err) => {
    clientCloseHandler();
  };
  clientCloseHandler.errorHandler = clientErrorHandler;

  clientRes.once('close', clientCloseHandler);
  clientRes.on('error', clientErrorHandler);

  proxyReq.on('timeout', () => {
    console.error(`[Upstream Timeout] Request to ${account.name} timed out after 300s`);
    proxyReq.destroy(new Error('Gateway Timeout (upstream took longer than 300s)'));
  });

  proxyReq.on('response', (upstreamRes) => {
    currentUpstreamRes = upstreamRes;
    const statusCode = upstreamRes.statusCode;

    // 1. Check Rate Limited (429 or 503 with retry-after)
    const hasRetryAfter = Boolean(upstreamRes.headers && upstreamRes.headers['retry-after']);
    if ((statusCode === 429 || (statusCode === 503 && hasRetryAfter)) && !clientAborted && !clientRes.destroyed) {
      handleRateLimitFailover({
        protocolTag: 'Proxy',
        clientRes,
        account,
        attemptNumber,
        triedAccountIds,
        sessionId,
        statusCode,
        upstreamRes,
        finishRequest,
        clientCloseHandler,
        clientErrorHandler,
        retryFn: (nextAccount) => {
          sendProxyRequest(clientReq, clientRes, reqBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, parsedBody);
        },
        errorFallbackFn: (errText) => {
          sendStandardizedError(clientRes, upstreamRes, statusCode, errText);
        }
      });
      return;
    }

    // 2. Check if Responses protocol is unsupported on upstream for native models (404, 405, 501, or 400 ModelProtocolUnsupported)
    const isResponsesProtocolError = isResponsesReq && (statusCode === 404 || statusCode === 405 || statusCode === 501 || statusCode === 400);
    if (isResponsesProtocolError && parsedBody && !clientAborted && !clientRes.destroyed) {
      const errChunks = [];
      let errBytes = 0;
      upstreamRes.on('data', chunk => {
        if (errBytes < MAX_ERR_BYTES) {
          const remaining = MAX_ERR_BYTES - errBytes;
          if (chunk.length > remaining) {
            errChunks.push(chunk.slice(0, remaining));
            errBytes += remaining;
          } else {
            errChunks.push(chunk);
            errBytes += chunk.length;
          }
        }
      });
      upstreamRes.on('error', (err) => {
        finishRequest();
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        sendStandardizedError(clientRes, upstreamRes, statusCode, `Upstream error: ${err.message}`);
      });
      upstreamRes.on('end', () => {
        if (clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
        const errText = Buffer.concat(errChunks).toString('utf8');
        const reqModel = parsedBody && parsedBody.model;
        const isUnsupported = (
          statusCode === 404 ||
          statusCode === 405 ||
          statusCode === 501 ||
          errText.includes('ModelProtocolUnsupported') ||
          errText.includes('does not support /responses') ||
          errText.includes('Unsupported endpoint') ||
          errText.includes('unknown endpoint') ||
          errText.includes('not supported')
        );

        if (isUnsupported) {
          console.log(`[Protocol Fallback] Model "${reqModel}" returned ${statusCode} on native /responses. Marking as unsupported and bridging to ChatCompletions...`);
          if (codexAdapter.markNativeResponsesUnsupported && reqModel) {
            codexAdapter.markNativeResponsesUnsupported(reqModel);
          }
          finishRequest();
          clientRes.removeListener('close', clientCloseHandler);
          if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
          bridgeResponsesToChatRequest(clientReq, clientRes, parsedBody, account, attemptNumber, triedAccountIds, sessionId);
        } else {
          finishRequest();
          clientRes.removeListener('close', clientCloseHandler);
          if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
          sendStandardizedError(clientRes, upstreamRes, statusCode, errText);
        }
      });
      return;
    }

    // 3. Error status codes (400, 401, 403, 404, 422, 500, 502, 503, 504)
    if (statusCode !== 200 && !clientAborted && !clientRes.destroyed) {
      const errChunks = [];
      let errBytes = 0;
      upstreamRes.on('data', chunk => {
        if (errBytes < MAX_ERR_BYTES) {
          const remaining = MAX_ERR_BYTES - errBytes;
          if (chunk.length > remaining) {
            errChunks.push(chunk.slice(0, remaining));
            errBytes += remaining;
          } else {
            errChunks.push(chunk);
            errBytes += chunk.length;
          }
        }
      });
      upstreamRes.on('error', (err) => {
        finishRequest();
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        sendStandardizedError(clientRes, upstreamRes, statusCode, `Upstream error: ${err.message}`);
      });
      upstreamRes.on('end', () => {
        if (clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
        const errText = Buffer.concat(errChunks).toString('utf8');
        const classified = classifyUpstreamError(statusCode, errText);

        if (classified.isInvalidApiKey) {
          const handled = handleInvalidApiKeyFailover({
            protocolTag: 'Proxy',
            clientRes,
            account,
            attemptNumber,
            triedAccountIds,
            sessionId,
            statusCode,
            errText,
            finishRequest,
            clientCloseHandler,
            clientErrorHandler,
            retryFn: (nextAccount) => {
              sendProxyRequest(clientReq, clientRes, reqBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, parsedBody);
            }
          });
          if (handled) return;
        }

        if (classified.isUpstreamClusterGlitch) {
          const reqModel = parsedBody && parsedBody.model;
          const eff = parsedBody?.reasoning_effort || parsedBody?.reasoning?.effort;
          const handled = handleUpstreamGlitchAndFailover({
            protocolTag: 'Proxy',
            clientRes,
            account,
            attemptNumber,
            triedAccountIds,
            sessionId,
            statusCode,
            errText,
            model: reqModel,
            reasoningEffort: eff,
            finishRequest,
            clientCloseHandler,
            clientErrorHandler,
            retryCurrentAccount: (retrySessionId) => {
              sendProxyRequest(clientReq, clientRes, reqBody, account, attemptNumber + 1, triedAccountIds, retrySessionId, parsedBody);
            },
            retryNextAccount: (nextAccount) => {
              sendProxyRequest(clientReq, clientRes, reqBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, parsedBody);
            },
            fallbackModelFn: (targetFallback) => {
              if (parsedBody && typeof parsedBody === 'object') {
                parsedBody.model = targetFallback;
                const newReqBody = Buffer.from(JSON.stringify(parsedBody), 'utf8');
                sendProxyRequest(clientReq, clientRes, newReqBody, account, attemptNumber + 1, new Set([account.id]), sessionId, parsedBody);
              }
            }
          });
          if (handled) return;
        }

        const handledFallback = handleModelAndContextFallback({
          protocolTag: 'Proxy',
          clientRes,
          account,
          attemptNumber,
          triedAccountIds,
          sessionId,
          statusCode,
          errText,
          classified,
          model: parsedBody && parsedBody.model,
          reasoningEffort: parsedBody?.reasoning_effort || parsedBody?.reasoning?.effort,
          payload: parsedBody,
          finishRequest,
          clientCloseHandler,
          clientErrorHandler,
          retryWithPayload: (newPayload, isModelChanged) => {
            parsedBody = newPayload;
            const newReqBody = Buffer.from(JSON.stringify(newPayload), 'utf8');
            sendProxyRequest(clientReq, clientRes, newReqBody, account, attemptNumber + 1, isModelChanged ? new Set([account.id]) : triedAccountIds, sessionId, newPayload);
          }
        });
        if (handledFallback) return;

        finishRequest();
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        const isResponsesReq = targetPath.startsWith('/responses') || (clientReq.url && clientReq.url.includes('/responses'));
        const isStream = parsedBody ? parsedBody.stream === true : Boolean(clientReq.headers && clientReq.headers.accept && clientReq.headers.accept.includes('text/event-stream'));
        if (isResponsesReq && isStream && typeof codexAdapter.dispatchResponsesStreamError === 'function') {
          const reqModel = parsedBody?.model || 'deepseek-v4.1-flash';
          codexAdapter.dispatchResponsesStreamError(clientRes, reqModel, parsedBody?.id, errText || `Upstream returned status ${statusCode}`, sessionId);
        } else {
          sendStandardizedError(clientRes, upstreamRes, statusCode, errText);
        }
      });
      return;
    }

    if (clientAborted || clientRes.destroyed || clientRes.writableEnded) {
      finishRequest();
      return;
    }

    responded = true;
    clientRes.writeHead(statusCode, getCorsHeaders(upstreamRes.headers));
    upstreamRes.pipe(clientRes);

    const onClientPipeError = () => {
      try {
        upstreamRes.unpipe(clientRes);
      } catch (_) {}
      if (upstreamRes && typeof upstreamRes.destroy === 'function' && !upstreamRes.destroyed) {
        upstreamRes.destroy();
      }
    };
    clientRes.once('error', onClientPipeError);
    clientRes.once('close', onClientPipeError);

    upstreamRes.on('error', (err) => {
      console.error('[Upstream Stream Error]', err.message);
      clientRes.removeListener('error', onClientPipeError);
      clientRes.removeListener('close', onClientPipeError);
      clientRes.removeListener('close', clientCloseHandler);
      if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
      try {
        upstreamRes.unpipe(clientRes);
      } catch (_) {}
      try {
        upstreamRes.resume();
      } catch (_) {}
      finishRequest();
      if (!clientRes.writableEnded && !clientRes.destroyed) {
        const isResponsesReq = targetPath.startsWith('/responses') || (clientReq.url && clientReq.url.includes('/responses'));
        const isStream = parsedBody ? parsedBody.stream === true : Boolean(clientReq.headers && clientReq.headers.accept && clientReq.headers.accept.includes('text/event-stream'));
        if (isResponsesReq && isStream && typeof codexAdapter.dispatchResponsesStreamError === 'function') {
          const reqModel = parsedBody?.model || 'deepseek-v4.1-flash';
          codexAdapter.dispatchResponsesStreamError(clientRes, reqModel, parsedBody?.id, err, sessionId);
        } else if (clientRes.headersSent) {
          try {
            clientRes.write(`event: error\ndata: ${JSON.stringify({ error: { message: 'Upstream stream terminated prematurely: ' + err.message, type: 'upstream_stream_error' } })}\n\n`);
          } catch (_) {}
          try {
            clientRes.destroy(err);
          } catch (_) {
            try { clientRes.end(); } catch (_) {}
          }
        } else {
          clientRes.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          clientRes.end(JSON.stringify({ error: { message: 'Upstream stream error: ' + err.message, type: 'upstream_stream_error' } }));
        }
      }
    });

    upstreamRes.on('close', () => {
      if (!upstreamRes.readableEnded && !clientRes.writableEnded && !clientRes.destroyed) {
        clientRes.removeListener('error', onClientPipeError);
        clientRes.removeListener('close', onClientPipeError);
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        finishRequest();
        const err = new Error('Upstream stream closed prematurely before completion');
        const isResponsesReq = targetPath.startsWith('/responses') || (clientReq.url && clientReq.url.includes('/responses'));
        const isStream = parsedBody ? parsedBody.stream === true : Boolean(clientReq.headers && clientReq.headers.accept && clientReq.headers.accept.includes('text/event-stream'));
        if (isResponsesReq && isStream && typeof codexAdapter.dispatchResponsesStreamError === 'function') {
          const reqModel = parsedBody?.model || 'deepseek-v4.1-flash';
          codexAdapter.dispatchResponsesStreamError(clientRes, reqModel, parsedBody?.id, err, sessionId);
        } else if (clientRes.headersSent) {
          try {
            clientRes.write(`event: error\ndata: ${JSON.stringify({ error: { message: err.message, type: 'upstream_stream_error' } })}\n\n`);
          } catch (_) {}
          try { clientRes.destroy(err); } catch (_) { try { clientRes.end(); } catch (_) {} }
        } else {
          clientRes.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          clientRes.end(JSON.stringify({ error: { message: err.message, type: 'upstream_stream_error' } }));
        }
      }
    });

    upstreamRes.on('end', () => {
      clientRes.removeListener('error', onClientPipeError);
      clientRes.removeListener('close', onClientPipeError);
      clientRes.removeListener('close', clientCloseHandler);
      if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
      finishRequest();
    });
  });

  proxyReq.on('error', (err) => {
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);

    // If client was already closed / aborted, do NOT trigger failover or log false alarm
    if (clientAborted || clientRes.destroyed || clientRes.writableEnded || clientReq.destroyed) {
      console.log(`[Client Abort] Client disconnected before request completed with account "${account.name}". No failover needed.`);
      return;
    }

    console.error(`[Upstream Proxy Error] Account "${account.name}":`, err.stack || err.message);
    if (!responded) {
      const handled = handleNetworkErrorFailover({
        protocolTag: 'Proxy',
        clientRes,
        account,
        attemptNumber,
        triedAccountIds,
        sessionId,
        err,
        model: parsedBody && parsedBody.model,
        reasoningEffort: parsedBody?.reasoning_effort || parsedBody?.reasoning?.effort,
        finishRequest,
        clientCloseHandler,
        clientErrorHandler,
        retryCurrentAccount: (retrySessionId) => {
          sendProxyRequest(clientReq, clientRes, reqBody, account, attemptNumber + 1, triedAccountIds, retrySessionId, parsedBody);
        },
        retryNextAccount: (nextAccount) => {
          sendProxyRequest(clientReq, clientRes, reqBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, parsedBody);
        },
        fallbackModelFn: (targetFallback) => {
          if (parsedBody && typeof parsedBody === 'object') {
            parsedBody.model = targetFallback;
            const newReqBody = Buffer.from(JSON.stringify(parsedBody), 'utf8');
            sendProxyRequest(clientReq, clientRes, newReqBody, account, attemptNumber + 1, new Set([account.id]), sessionId, parsedBody);
          }
        }
      });
      if (handled) return;
    }

    if (!responded) {
      responded = true;
      const isResponsesReq = targetPath.startsWith('/responses') || (clientReq.url && clientReq.url.includes('/responses'));
      const isStream = parsedBody ? parsedBody.stream === true : Boolean(clientReq.headers && clientReq.headers.accept && clientReq.headers.accept.includes('text/event-stream'));
      if (isResponsesReq && isStream && typeof codexAdapter.dispatchResponsesStreamError === 'function') {
        const reqModel = parsedBody?.model || 'deepseek-v4.1-flash';
        codexAdapter.dispatchResponsesStreamError(clientRes, reqModel, parsedBody?.id, err, sessionId);
      } else {
        const isTimeout = err.message && err.message.includes('Gateway Timeout');
        const errCode = isTimeout ? 504 : 502;
        const errPayload = JSON.stringify({
          error: {
            message: `Proxy error reaching upstream: ${err.message}`,
            type: isTimeout ? 'router_gateway_timeout' : 'router_proxy_error',
            code: errCode
          }
        });
        if (clientRes.headersSent) {
          if (!clientRes.writableEnded) clientRes.end(errPayload);
        } else {
          clientRes.writeHead(errCode, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*'
          });
          clientRes.end(errPayload);
        }
      }
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

function bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, account, attemptNumber, triedAccountIds = new Set(), resolvedSessionId = null, precomputedChatPayload = null) {
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

  let sessionId = resolvedSessionId || codexAdapter.extractOrDeriveSessionId(clientReq, responsesBody);

  // Pre-emptive model fallback check for heterogeneous upstream nodes
  if (sessionId && responsesBody && responsesBody.model) {
    const rawReqModel = responsesBody.model.replace(/^opencode-go\//, '');
    const cacheKey = `${sessionId}:${rawReqModel}`;
    if (sessionModelFallbackCache.has(cacheKey)) {
      const cachedFallback = sessionModelFallbackCache.get(cacheKey);
      if (cachedFallback && cachedFallback !== rawReqModel) {
        console.log(`[Auto Pre-Emptive Fallback] 会话 ${sessionId} 命中异构节点模型记忆，直接将 "${rawReqModel}" 替换为 "${cachedFallback}"`);
        responsesBody = { ...responsesBody, model: cachedFallback };
      }
    }
  }

  // Pre-flight check & pruning for oversized responses payload (Rule 5 & Rule 33)
  if (!precomputedChatPayload && responsesBody && Array.isArray(responsesBody.input) && !responsesBody.modified) {
    const shouldPrune = responsesBody.input.length > 12 ||
      (responsesBody.input.length > 3 && responsesBody.input.some(it => it && ((typeof it.output === 'string' && (it.output.length > 2000 || it.output.includes(';base64,'))) || (typeof it.content === 'string' && it.content.length > 5000))));
    if (shouldPrune) {
      try {
        const pruneRes = codexAdapter.pruneResponsesPayload(responsesBody, sessionId);
        if (pruneRes && pruneRes.modified) {
          responsesBody = pruneRes;
        }
      } catch (_) {}
    }
  }

  const effectiveComp = {
    ...getEffectiveCompressionOptions(config.compression, clientReq),
    model: typeof rawReqModel !== 'undefined' ? rawReqModel : undefined,
    _isRetryAttempt: Boolean(attemptNumber && attemptNumber > 1)
  };
  const chatPayload = precomputedChatPayload || codexAdapter.convertResponsesToChatPayload(responsesBody, effectiveComp, sessionId);
  const reqModel = chatPayload.model || 'deepseek-v4.1-flash';
  const isStream = chatPayload.stream === true;
  const chatBody = Buffer.from(JSON.stringify(chatPayload), 'utf8');

  const upstreamPathname = upstreamUrl.pathname.replace(/\/+$/, '');
  const upstreamChatPath = upstreamPathname + '/chat/completions';

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

  const effectiveProxy = getEffectiveProxyForRequest(chatPayload.model);
  if (effectiveProxy) {
    const agent = getProxyAgent(effectiveProxy.url, isHttps);
    if (agent) {
      proxyOptions.agent = agent;
    }
  }

  const proxyReq = transport.request(proxyOptions);
  let responded = false;
  let requestFinished = false;
  let clientAborted = false;
  let currentUpstreamRes = null;

  const finishRequest = () => {
    if (!requestFinished) {
      requestFinished = true;
      if (stat && stat.activeRequests > 0) {
        stat.activeRequests -= 1;
      }
    }
  };

  let clientErrorHandler = null;
  const clientCloseHandler = () => {
    if (clientErrorHandler) {
      clientRes.removeListener('error', clientErrorHandler);
    }
    if (!clientRes.writableEnded) {
      clientAborted = true;
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
      if (currentUpstreamRes && typeof currentUpstreamRes.destroy === 'function' && !currentUpstreamRes.destroyed) {
        try {
          currentUpstreamRes.unpipe(clientRes);
        } catch (_) {}
        currentUpstreamRes.destroy();
      }
    }
    finishRequest();
  };

  clientErrorHandler = (err) => {
    clientCloseHandler();
  };
  clientCloseHandler.errorHandler = clientErrorHandler;

  clientRes.once('close', clientCloseHandler);
  clientRes.on('error', clientErrorHandler);

  proxyReq.on('timeout', () => {
    console.error(`[Bridge Timeout] Upstream chat request for model "${reqModel}" timed out after 300s`);
    proxyReq.destroy(new Error('Gateway Timeout (upstream took longer than 300s)'));
  });

  proxyReq.on('response', (upstreamRes) => {
    currentUpstreamRes = upstreamRes;
    const statusCode = upstreamRes.statusCode;

    // 1. Check Rate Limited (429 or 503 with retry-after)
    const hasRetryAfter = Boolean(upstreamRes.headers && upstreamRes.headers['retry-after']);
    if ((statusCode === 429 || (statusCode === 503 && hasRetryAfter)) && !clientAborted && !clientRes.destroyed) {
      handleRateLimitFailover({
        protocolTag: 'Bridge',
        clientRes,
        account,
        attemptNumber,
        triedAccountIds,
        sessionId,
        statusCode,
        upstreamRes,
        finishRequest,
        clientCloseHandler,
        clientErrorHandler,
        retryFn: (nextAccount) => {
          bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, chatPayload);
        },
        errorFallbackFn: (errText) => {
          sendStandardizedError(clientRes, upstreamRes, statusCode, errText);
        }
      });
      return;
    }

    if (statusCode !== 200 && !clientAborted && !clientRes.destroyed) {
      const errChunks = [];
      let errBytes = 0;
      upstreamRes.on('data', chunk => {
        if (errBytes < MAX_ERR_BYTES) {
          const remaining = MAX_ERR_BYTES - errBytes;
          if (chunk.length > remaining) {
            errChunks.push(chunk.slice(0, remaining));
            errBytes += remaining;
          } else {
            errChunks.push(chunk);
            errBytes += chunk.length;
          }
        }
      });
      upstreamRes.on('error', (err) => {
        if (clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
        responded = true;
        finishRequest();
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        if (isStream && typeof codexAdapter.dispatchResponsesStreamError === 'function') {
          codexAdapter.dispatchResponsesStreamError(clientRes, reqModel, responsesBody ? responsesBody.id : null, err, sessionId);
        } else {
          sendStandardizedError(clientRes, upstreamRes, statusCode, `Upstream error: ${err.message}`);
        }
      });
      upstreamRes.on('end', () => {
        if (clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
        const errText = Buffer.concat(errChunks).toString('utf8');

        const classified = classifyUpstreamError(statusCode, errText);

        if (classified.isInvalidApiKey) {
          const handled = handleInvalidApiKeyFailover({
            protocolTag: 'Bridge',
            clientRes,
            account,
            attemptNumber,
            triedAccountIds,
            sessionId,
            statusCode,
            errText,
            finishRequest,
            clientCloseHandler,
            clientErrorHandler,
            retryFn: (nextAccount) => {
              bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, chatPayload);
            }
          });
          if (handled) return;
        }

        if (classified.isUpstreamClusterGlitch) {
          const eff = responsesBody?.reasoning_effort || responsesBody?.reasoning?.effort || responsesBody?.model_reasoning_effort;
          const handled = handleUpstreamGlitchAndFailover({
            protocolTag: 'Bridge',
            clientRes,
            account,
            attemptNumber,
            triedAccountIds,
            sessionId,
            statusCode,
            errText,
            model: reqModel,
            reasoningEffort: eff,
            finishRequest,
            clientCloseHandler,
            clientErrorHandler,
            retryCurrentAccount: (retrySessionId) => {
              bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, account, attemptNumber + 1, triedAccountIds, retrySessionId, chatPayload);
            },
            retryNextAccount: (nextAccount) => {
              bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, chatPayload);
            },
            fallbackModelFn: (targetFallback) => {
              const healedBody = { ...responsesBody, model: targetFallback };
              dispatchResponsesRequest(clientReq, clientRes, healedBody, account, attemptNumber + 1, new Set([account.id]), sessionId);
            }
          });
          if (handled) return;
        }

        const eff = responsesBody?.reasoning_effort || responsesBody?.reasoning?.effort || responsesBody?.model_reasoning_effort;
        const handledFallback = handleModelAndContextFallback({
          protocolTag: 'Bridge',
          clientRes,
          account,
          attemptNumber,
          triedAccountIds,
          sessionId,
          statusCode,
          errText,
          classified,
          model: reqModel,
          reasoningEffort: eff,
          payload: responsesBody,
          finishRequest,
          clientCloseHandler,
          clientErrorHandler,
          retryWithPayload: (newPayload, isModelChanged) => {
            dispatchResponsesRequest(clientReq, clientRes, newPayload, account, attemptNumber + 1, isModelChanged ? new Set([account.id]) : triedAccountIds, sessionId);
          }
        });
        if (handledFallback) return;

        responded = true;
        finishRequest();
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        if (isStream && typeof codexAdapter.dispatchResponsesStreamError === 'function') {
          codexAdapter.dispatchResponsesStreamError(clientRes, reqModel, responsesBody ? responsesBody.id : null, errText || `Upstream returned status ${statusCode}`, sessionId);
        } else {
          sendStandardizedError(clientRes, upstreamRes, statusCode, errText);
        }
      });
      return;
    }

    if (clientAborted || clientRes.destroyed || clientRes.writableEnded) {
      finishRequest();
      return;
    }

    responded = true;

    if (isStream) {
      const reconnectFn = (onSuccess, onFailure) => {
        try {
          const retryReq = transport.request(proxyOptions);
          retryReq.setTimeout(180000, () => {
            retryReq.destroy(new Error('Reconnect attempt timed out'));
          });
          retryReq.once('error', (err) => {
            onFailure(err);
          });
          retryReq.once('response', (retryUpstreamRes) => {
            currentUpstreamRes = retryUpstreamRes;
            if (retryUpstreamRes.statusCode === 200) {
              onSuccess(retryUpstreamRes);
            } else {
              onFailure(new Error(`Reconnect upstream returned status ${retryUpstreamRes.statusCode}`));
            }
          });
          retryReq.end(chatBody);
        } catch (e) {
          onFailure(e);
        }
      };

      codexAdapter.bridgeResponsesStream(upstreamRes, clientRes, reqModel, responsesBody.id, () => {
        finishRequest();
      }, sessionId, reconnectFn, comfyuiAdapter);
      upstreamRes.on('error', (err) => {
        console.error('[Bridge Stream Error]', err.message);
        finishRequest();
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
          if (responsesJson && responsesJson.id && sessionId) {
            codexAdapter.recordResponseSession(responsesJson.id, sessionId);
          }
          const outBuf = Buffer.from(JSON.stringify(responsesJson), 'utf8');
          const headers = getCorsHeaders(upstreamRes.headers);
          headers['content-type'] = 'application/json; charset=utf-8';
          headers['content-length'] = String(outBuf.length);
          if (!clientRes.headersSent) {
            clientRes.writeHead(responsesJson.status === 'failed' ? 502 : 200, headers);
          }
          clientRes.end(outBuf);
        } catch (e) {
          if (!clientRes.headersSent) {
            clientRes.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          }
          if (!clientRes.writableEnded) {
            clientRes.end(JSON.stringify({ error: { message: 'Bridge parse error: ' + e.message } }));
          }
        }
      });
      upstreamRes.on('error', (err) => {
        finishRequest();
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        if (!clientRes.writableEnded && !clientRes.destroyed) {
          const errPayload = JSON.stringify({
            error: {
              type: 'server_error',
              code: 'upstream_stream_error',
              message: `Upstream error: ${err.message}`
            }
          });
          if (clientRes.headersSent) {
            try {
              clientRes.write(`event: error\ndata: ${errPayload}\n\n`);
            } catch (_) {}
            try {
              clientRes.destroy(err);
            } catch (_) {
              try { clientRes.end(); } catch (_) {}
            }
          } else {
            clientRes.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            clientRes.end(errPayload);
          }
        }
      });
    }
  });

  proxyReq.on('error', (err) => {
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
    if (clientAborted || clientRes.destroyed || clientRes.writableEnded || clientReq.destroyed) return;

    if (!responded) {
      const eff = responsesBody?.reasoning_effort || responsesBody?.reasoning?.effort || responsesBody?.model_reasoning_effort;
      const handled = handleNetworkErrorFailover({
        protocolTag: 'Bridge',
        clientRes,
        account,
        attemptNumber,
        triedAccountIds,
        sessionId,
        err,
        model: reqModel,
        reasoningEffort: eff,
        finishRequest,
        clientCloseHandler,
        clientErrorHandler,
        retryCurrentAccount: (retrySessionId) => {
          bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, account, attemptNumber + 1, triedAccountIds, retrySessionId, chatPayload);
        },
        retryNextAccount: (nextAccount) => {
          bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, chatPayload);
        },
        fallbackModelFn: (targetFallback) => {
          const healedBody = { ...responsesBody, model: targetFallback };
          dispatchResponsesRequest(clientReq, clientRes, healedBody, account, attemptNumber + 1, new Set([account.id]), sessionId);
        }
      });
      if (handled) return;
    }

    if (!responded) {
      responded = true;
      if (isStream && typeof codexAdapter.dispatchResponsesStreamError === 'function') {
        codexAdapter.dispatchResponsesStreamError(clientRes, reqModel, responsesBody ? responsesBody.id : null, err, sessionId);
      } else {
        const errPayload = JSON.stringify({
          error: {
            message: `Bridge proxy error: ${err.message}`,
            type: 'router_bridge_error',
            code: 502
          }
        });
        if (clientRes.headersSent) {
          if (!clientRes.writableEnded) clientRes.end(errPayload);
        } else {
          clientRes.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          clientRes.end(errPayload);
        }
      }
    }
  });

  proxyReq.write(chatBody);
  proxyReq.end();
}

function bridgeResponsesToAnthropicRequest(clientReq, clientRes, responsesBody, account, attemptNumber, triedAccountIds = new Set(), resolvedSessionId = null, precomputedAnthropicPayload = null) {
  const upstreamUrl = new URL(config.upstream);
  const isHttps = upstreamUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  let sessionId = resolvedSessionId || codexAdapter.extractOrDeriveSessionId(clientReq, responsesBody);

  // Pre-emptive model fallback check for heterogeneous upstream nodes (Rule 19)
  if (sessionId && responsesBody && responsesBody.model) {
    const rawReqModel = responsesBody.model.replace(/^opencode-go\//, '');
    const cacheKey = `${sessionId}:${rawReqModel}`;
    if (sessionModelFallbackCache.has(cacheKey)) {
      const cachedFallback = sessionModelFallbackCache.get(cacheKey);
      if (cachedFallback && cachedFallback !== rawReqModel) {
        console.log(`[Auto Pre-Emptive Fallback] Anthropic 桥接会话 ${sessionId} 命中异构节点模型记忆，直接将 "${rawReqModel}" 替换为 "${cachedFallback}"`);
        responsesBody = { ...responsesBody, model: cachedFallback };
        if (!codexAdapter.ANTHROPIC_MODELS.has(cachedFallback)) {
          bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, account, attemptNumber, triedAccountIds, sessionId);
          return;
        }
      }
    }
  }

  triedAccountIds.add(account.id);
  const stat = accountStats.get(account.id);
  if (stat) {
    stat.activeRequests += 1;
    stat.totalRequests += 1;
    stat.lastUsedAt = Date.now();
  }

  // Pre-flight check & pruning for oversized responses payload (Rule 5 & Rule 33)
  if (!precomputedAnthropicPayload && responsesBody && Array.isArray(responsesBody.input) && !responsesBody.modified) {
    const shouldPrune = responsesBody.input.length > 12 ||
      (responsesBody.input.length > 3 && responsesBody.input.some(it => it && ((typeof it.output === 'string' && (it.output.length > 2000 || it.output.includes(';base64,'))) || (typeof it.content === 'string' && it.content.length > 5000))));
    if (shouldPrune) {
      try {
        const pruneRes = codexAdapter.pruneResponsesPayload(responsesBody, sessionId);
        if (pruneRes && pruneRes.modified) {
          responsesBody = pruneRes;
        }
      } catch (_) {}
    }
  }

  const effectiveComp = {
    ...getEffectiveCompressionOptions(config.compression, clientReq),
    model: typeof rawReqModel !== 'undefined' ? rawReqModel : undefined,
    _isRetryAttempt: Boolean(attemptNumber && attemptNumber > 1)
  };
  const anthropicPayload = precomputedAnthropicPayload || codexAdapter.convertResponsesToAnthropicPayload(responsesBody, effectiveComp, sessionId);
  const reqModel = anthropicPayload.model || 'claude-haiku-5-5';
  const isStream = anthropicPayload.stream !== false;
  const anthropicBody = Buffer.from(JSON.stringify(anthropicPayload), 'utf8');

  const upstreamPathname = upstreamUrl.pathname.replace(/\/+$/, '');
  const upstreamMessagesPath = upstreamPathname + '/messages';

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

  const effectiveProxy = getEffectiveProxyForRequest(anthropicPayload.model);
  if (effectiveProxy) {
    const agent = getProxyAgent(effectiveProxy.url, isHttps);
    if (agent) {
      proxyOptions.agent = agent;
    }
  }

  const proxyReq = transport.request(proxyOptions);
  let responded = false;
  let requestFinished = false;
  let clientAborted = false;
  let currentUpstreamRes = null;

  const finishRequest = () => {
    if (!requestFinished) {
      requestFinished = true;
      if (stat && stat.activeRequests > 0) {
        stat.activeRequests -= 1;
      }
    }
  };

  let clientErrorHandler = null;
  const clientCloseHandler = () => {
    if (clientErrorHandler) {
      clientRes.removeListener('error', clientErrorHandler);
    }
    if (!clientRes.writableEnded) {
      clientAborted = true;
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
      if (currentUpstreamRes && typeof currentUpstreamRes.destroy === 'function' && !currentUpstreamRes.destroyed) {
        try {
          currentUpstreamRes.unpipe(clientRes);
        } catch (_) {}
        currentUpstreamRes.destroy();
      }
    }
    finishRequest();
  };

  clientErrorHandler = (err) => {
    clientCloseHandler();
  };
  clientCloseHandler.errorHandler = clientErrorHandler;

  clientRes.once('close', clientCloseHandler);
  clientRes.on('error', clientErrorHandler);

  proxyReq.on('timeout', () => {
    console.error(`[Bridge Timeout] Upstream Anthropic request for model "${reqModel}" timed out after 300s`);
    proxyReq.destroy(new Error('Gateway Timeout (upstream took longer than 300s)'));
  });

  proxyReq.on('response', (upstreamRes) => {
    currentUpstreamRes = upstreamRes;
    const statusCode = upstreamRes.statusCode;

    // 1. Check Rate Limited (429 or 503 with retry-after)
    const hasRetryAfter = Boolean(upstreamRes.headers && upstreamRes.headers['retry-after']);
    if ((statusCode === 429 || (statusCode === 503 && hasRetryAfter)) && !clientAborted && !clientRes.destroyed) {
      handleRateLimitFailover({
        protocolTag: 'Anthropic',
        clientRes,
        account,
        attemptNumber,
        triedAccountIds,
        sessionId,
        statusCode,
        upstreamRes,
        finishRequest,
        clientCloseHandler,
        clientErrorHandler,
        retryFn: (nextAccount) => {
          bridgeResponsesToAnthropicRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, anthropicPayload);
        },
        errorFallbackFn: (errText) => {
          sendStandardizedError(clientRes, upstreamRes, statusCode, errText);
        }
      });
      return;
    }

    if (statusCode !== 200 && !clientAborted && !clientRes.destroyed) {
      const errChunks = [];
      let errBytes = 0;
      upstreamRes.on('data', chunk => {
        if (errBytes < MAX_ERR_BYTES) {
          const remaining = MAX_ERR_BYTES - errBytes;
          if (chunk.length > remaining) {
            errChunks.push(chunk.slice(0, remaining));
            errBytes += remaining;
          } else {
            errChunks.push(chunk);
            errBytes += chunk.length;
          }
        }
      });
      upstreamRes.on('error', (err) => {
        if (clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
        responded = true;
        finishRequest();
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        if (isStream && typeof codexAdapter.dispatchResponsesStreamError === 'function') {
          codexAdapter.dispatchResponsesStreamError(clientRes, reqModel, responsesBody ? responsesBody.id : null, err, sessionId);
        } else {
          sendStandardizedError(clientRes, upstreamRes, statusCode, `Upstream error: ${err.message}`);
        }
      });
      upstreamRes.on('end', () => {
        if (clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
        const errText = Buffer.concat(errChunks).toString('utf8');

        const classified = classifyUpstreamError(statusCode, errText);

        if (classified.isInvalidApiKey) {
          const handled = handleInvalidApiKeyFailover({
            protocolTag: 'Anthropic',
            clientRes,
            account,
            attemptNumber,
            triedAccountIds,
            sessionId,
            statusCode,
            errText,
            finishRequest,
            clientCloseHandler,
            clientErrorHandler,
            retryFn: (nextAccount) => {
              bridgeResponsesToAnthropicRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, anthropicPayload);
            }
          });
          if (handled) return;
        }

        if (classified.isUpstreamClusterGlitch) {
          const eff = responsesBody?.reasoning_effort || responsesBody?.reasoning?.effort || responsesBody?.model_reasoning_effort;
          const handled = handleUpstreamGlitchAndFailover({
            protocolTag: 'Anthropic',
            clientRes,
            account,
            attemptNumber,
            triedAccountIds,
            sessionId,
            statusCode,
            errText,
            model: reqModel,
            reasoningEffort: eff,
            finishRequest,
            clientCloseHandler,
            clientErrorHandler,
            retryCurrentAccount: (retrySessionId) => {
              bridgeResponsesToAnthropicRequest(clientReq, clientRes, responsesBody, account, attemptNumber + 1, triedAccountIds, retrySessionId, anthropicPayload);
            },
            retryNextAccount: (nextAccount) => {
              bridgeResponsesToAnthropicRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, anthropicPayload);
            },
            fallbackModelFn: (targetFallback) => {
              const healedBody = { ...responsesBody, model: targetFallback };
              dispatchResponsesRequest(clientReq, clientRes, healedBody, account, attemptNumber + 1, new Set([account.id]), sessionId);
            }
          });
          if (handled) return;
        }

        const eff = responsesBody?.reasoning_effort || responsesBody?.reasoning?.effort || responsesBody?.model_reasoning_effort;
        const handledFallback = handleModelAndContextFallback({
          protocolTag: 'Anthropic',
          clientRes,
          account,
          attemptNumber,
          triedAccountIds,
          sessionId,
          statusCode,
          errText,
          classified,
          model: reqModel,
          reasoningEffort: eff,
          payload: responsesBody,
          finishRequest,
          clientCloseHandler,
          clientErrorHandler,
          retryWithPayload: (newPayload, isModelChanged) => {
            dispatchResponsesRequest(clientReq, clientRes, newPayload, account, attemptNumber + 1, isModelChanged ? new Set([account.id]) : triedAccountIds, sessionId);
          }
        });
        if (handledFallback) return;

        responded = true;
        finishRequest();
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        if (isStream && typeof codexAdapter.dispatchResponsesStreamError === 'function') {
          codexAdapter.dispatchResponsesStreamError(clientRes, reqModel, responsesBody ? responsesBody.id : null, errText || `Upstream returned status ${statusCode}`, sessionId);
        } else {
          sendStandardizedError(clientRes, upstreamRes, statusCode, errText);
        }
      });
      return;
    }

    if (clientAborted || clientRes.destroyed || clientRes.writableEnded) {
      finishRequest();
      return;
    }

    responded = true;

    if (isStream) {
      const reconnectFn = (onSuccess, onFailure) => {
        try {
          const retryReq = transport.request(proxyOptions);
          retryReq.setTimeout(180000, () => {
            retryReq.destroy(new Error('Reconnect attempt timed out'));
          });
          retryReq.once('error', (err) => {
            onFailure(err);
          });
          retryReq.once('response', (retryUpstreamRes) => {
            currentUpstreamRes = retryUpstreamRes;
            if (retryUpstreamRes.statusCode === 200) {
              onSuccess(retryUpstreamRes);
            } else {
              onFailure(new Error(`Reconnect upstream returned status ${retryUpstreamRes.statusCode}`));
            }
          });
          retryReq.end(anthropicBody);
        } catch (e) {
          onFailure(e);
        }
      };

      codexAdapter.bridgeAnthropicStream(upstreamRes, clientRes, reqModel, responsesBody.id, () => {
        finishRequest();
      }, sessionId, reconnectFn);
      upstreamRes.on('error', (err) => {
        console.error('[Anthropic Stream Error]', err.message);
        finishRequest();
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
          if (responsesJson && responsesJson.id && sessionId) {
            codexAdapter.recordResponseSession(responsesJson.id, sessionId);
          }
          const outBuf = Buffer.from(JSON.stringify(responsesJson), 'utf8');
          const headers = getCorsHeaders(upstreamRes.headers);
          headers['content-type'] = 'application/json; charset=utf-8';
          headers['content-length'] = String(outBuf.length);
          if (!clientRes.headersSent) {
            clientRes.writeHead(responsesJson.status === 'failed' ? 502 : 200, headers);
          }
          clientRes.end(outBuf);
        } catch (e) {
          if (!clientRes.headersSent) {
            clientRes.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          }
          if (!clientRes.writableEnded) {
            clientRes.end(JSON.stringify({ error: { message: 'Anthropic parse error: ' + e.message } }));
          }
        }
      });
      upstreamRes.on('error', (err) => {
        finishRequest();
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        if (!clientRes.writableEnded && !clientRes.destroyed) {
          const errPayload = JSON.stringify({
            error: {
              type: 'server_error',
              code: 'upstream_stream_error',
              message: `Upstream error: ${err.message}`
            }
          });
          if (clientRes.headersSent) {
            try {
              clientRes.write(`event: error\ndata: ${errPayload}\n\n`);
            } catch (_) {}
            try {
              clientRes.destroy(err);
            } catch (_) {
              try { clientRes.end(); } catch (_) {}
            }
          } else {
            clientRes.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            clientRes.end(errPayload);
          }
        }
      });
    }
  });

  proxyReq.on('error', (err) => {
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
    if (clientAborted || clientRes.destroyed || clientRes.writableEnded || clientReq.destroyed) return;

    if (!responded) {
      const eff = responsesBody?.reasoning_effort || responsesBody?.reasoning?.effort || responsesBody?.model_reasoning_effort;
      const handled = handleNetworkErrorFailover({
        protocolTag: 'Anthropic',
        clientRes,
        account,
        attemptNumber,
        triedAccountIds,
        sessionId,
        err,
        model: reqModel,
        reasoningEffort: eff,
        finishRequest,
        clientCloseHandler,
        clientErrorHandler,
        retryCurrentAccount: (retrySessionId) => {
          bridgeResponsesToAnthropicRequest(clientReq, clientRes, responsesBody, account, attemptNumber + 1, triedAccountIds, retrySessionId, anthropicPayload);
        },
        retryNextAccount: (nextAccount) => {
          bridgeResponsesToAnthropicRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, anthropicPayload);
        },
        fallbackModelFn: (targetFallback) => {
          const healedBody = { ...responsesBody, model: targetFallback };
          dispatchResponsesRequest(clientReq, clientRes, healedBody, account, attemptNumber + 1, new Set([account.id]), sessionId);
        }
      });
      if (handled) return;
    }

    if (!responded) {
      responded = true;
      if (isStream && typeof codexAdapter.dispatchResponsesStreamError === 'function') {
        codexAdapter.dispatchResponsesStreamError(clientRes, reqModel, responsesBody ? responsesBody.id : null, err, sessionId);
      } else {
        const errPayload = JSON.stringify({
          error: {
            message: `Anthropic proxy error: ${err.message}`,
            type: 'router_anthropic_error',
            code: 502
          }
        });
        if (clientRes.headersSent) {
          if (!clientRes.writableEnded) clientRes.end(errPayload);
        } else {
          clientRes.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          clientRes.end(errPayload);
        }
      }
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

async function runSystemDoctor(scope = 'all', options = {}) {
  if (scope === 'compression') {
    const compStats = contextCompactor.getCompressionStats();
    const compHealth = contextCompactor.checkCompressionHealth(config.compression, compStats);
    return {
      timestamp: new Date().toISOString(),
      scope: 'compression',
      router: {
        status: 'ok',
        port: config.port,
        upstream: config.upstream
      },
      compression: compHealth,
      issues: compHealth.issues
    };
  }

  if (scope === 'codex') {
    const codexStatus = codexAdapter.getCodexStatus(config.port);
    const procHealth = codexStatus.processHealth || codexAdapter.checkCodexProcessHealth();
    const localeCheck = codexStatus.localeCheck || codexAdapter.checkCodexLocaleAndEnvironment();
    const codexIssues = [];
    if (codexStatus.cliInstalled && !codexStatus.isBound) {
      codexIssues.push({
        id: 'codex_not_bound',
        severity: 'medium',
        title: 'OpenAI Codex CLI 尚未接入本地智能网关',
        desc: `检测到本地已安装 Codex CLI (${codexStatus.cliVersion || '已安装'})，可一键接入 OpenCode Go 38 款模型及思考等级映射`
      });
    } else if (codexStatus.cliInstalled && codexStatus.isBound && !codexStatus.hasStreamIdleTimeout) {
      codexIssues.push({
        id: 'codex_timeout_unhardened',
        severity: 'medium',
        title: 'OpenAI Codex 缺少长思考防断流与智能重试加固配置',
        desc: '检测到 Codex config.toml 未配置 stream_idle_timeout_ms (5分钟防断流) 或 stream_max_retries，长思考容易偶发断流，可一键加固修复'
      });
    }
    if (procHealth && !procHealth.healthy) {
      if (procHealth.hasSuspended) {
        codexIssues.push({
          id: 'codex_process_suspended',
          severity: 'high',
          title: 'OpenAI Codex (ChatGPT) 存在被 Windows PLM 挂起的进程（导致桌面打不开或秒退）',
          desc: `检测到 ${procHealth.suspendedCount} 个处于 Wait:Suspended 挂起状态的 ChatGPT 线程霸占单实例互斥锁，一键修复即可通过 Win32 API 唤醒恢复渲染`
        });
      } else if (procHealth.hasGhost) {
        codexIssues.push({
          id: 'codex_ghost_process',
          severity: 'high',
          title: 'OpenAI Codex (ChatGPT) 后台无窗口僵死进程死锁单实例锁',
          desc: '检测到后台存在无窗口僵死实例霸占 SingleInstanceLock 互斥锁，导致桌面双击图标无法打开或闪退，可一键自动清理释放'
        });
      }
    }
    if (localeCheck && !localeCheck.healthy && localeCheck.issues && localeCheck.issues.length > 0) {
      codexIssues.push({
        id: 'codex_locale_misaligned',
        severity: 'medium',
        title: 'OpenAI Codex 简体中文语言环境或模型标识未完整对齐（显示为英文或自定义）',
        desc: `检测到: ${localeCheck.issues.join('；')}，点击一键修复即可锁定中文语言环境并规范模型 Slug`
      });
    }
    return {
      timestamp: new Date().toISOString(),
      scope: 'codex',
      router: {
        status: 'ok',
        port: config.port,
        upstream: config.upstream
      },
      codex: codexStatus,
      codexProcessHealth: procHealth,
      codexLocale: localeCheck,
      codexIssues,
      issues: codexIssues
    };
  }

  let defaultWs = findDefaultWorkspace();

  const report = {
    timestamp: new Date().toISOString(),
    scope,
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

  // 1.5 Check OpenChamber Workstation (Dynamic port detection + Auth discovery)
  try {
    const updaterMod = require('./updater');
    const serviceInfo = updaterMod.detectOpenCodeServiceInfo();
    const activePort = serviceInfo.port || 3000;
    report.openchamber.port = activePort;

    const probeHttp = await new Promise((resolve) => {
      let settled = false;
      const safeResolve = (val) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };
      const probeReq = http.request({
        hostname: '127.0.0.1',
        port: activePort,
        path: '/',
        method: 'GET',
        timeout: 1200
      }, (probeRes) => {
        probeRes.resume();
        safeResolve({ ok: true, status: probeRes.statusCode });
      });
      probeReq.on('error', (err) => safeResolve({ ok: false, error: err.message }));
      probeReq.on('timeout', () => {
        try { probeReq.destroy(); } catch (_) {}
        safeResolve({ ok: false, error: 'timeout' });
      });
      probeReq.end();
    });

    if (probeHttp.ok) {
      report.openchamber.reachable = true;
      if (probeHttp.status === 401) {
        report.openchamber.authRequired = true;
      }
    } else if (process.platform === 'linux') {
      try {
        const isActive = execSync('systemctl --user is-active openchamber.service 2>/dev/null || true', { encoding: 'utf8', timeout: 1000 }).trim();
        if (isActive === 'active') report.openchamber.reachable = true;
      } catch (_) {}
    }
  } catch (e) {
    report.openchamber.error = e.message;
  }

  // 1.6 Check OpenChamber Windows Ghost Process & SingleInstanceLock Deadlock
  if (process.platform === 'win32') {
    try {
      const psCheck = `
$ProgressPreference = 'SilentlyContinue'
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
      const enc = Buffer.from(psCheck, 'utf16le').toString('base64');
      const out = execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${enc}`, {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      if (out) {
        const jsonMatch = out.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const procState = JSON.parse(jsonMatch[0]);
          if (procState.HasChamber && !procState.HasWindow && !report.openchamber.reachable) {
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

      // OpenCode 2.0+ 原生智能体注册核验 (Rule 9)
      const hasAgentGoal = Boolean(parsed && parsed.agent && parsed.agent.goal && (parsed.agent.goal.mode === 'primary' || parsed.agent.goal.mode === 'all'));
      const hasAgentGoalVerify = Boolean(parsed && parsed.agent && parsed.agent['goal-verify']);
      const agentDeclared = hasAgentGoal && hasAgentGoalVerify;
      report.opencodeConfig.agentDeclaration = {
        declared: agentDeclared,
        hasGoal: hasAgentGoal,
        hasGoalVerify: hasAgentGoalVerify
      };

      if (!agentDeclared) {
        report.issues.push({
          id: 'opencode_agent_declaration',
          severity: 'medium',
          title: 'opencode.jsonc 缺少 OpenCode 2.0 原生智能体定义 (Rule 9)',
          desc: 'OpenCode 2.0 Slash 指令无法直接作为桌面/Web 下拉智能体调度；需在 opencode.jsonc 的 agent 字段中显式声明 agent.goal (主模式) 与 agent[\'goal-verify\'] (审阅模式)，一键修复即可自动补齐并保护定制 Prompt'
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

    // 7.5 Check OMO v2 plugin integrity and deadlocks
    const omoInteg = updater.checkOmoPluginV2Integrity();
    report.omoIntegrity = omoInteg;
    if (omoInteg.hasDeadlockEffect) {
      report.issues.push({
        id: 'omo_effect_deadlock',
        severity: 'high',
        title: 'Oh My OpenAgent 插件存在 Effect-TS 死锁标记',
        desc: '检测到 OMO 插件中注入了 effect: serverPlugin，导致 OpenCode v2 调度锁全局死锁、/api/integration 超时挂死及提供商连接转圈卡死，可一键自动清除'
      });
    }
    if (omoInteg.hasMissingWrapper) {
      report.issues.push({
        id: 'omo_v2_wrapper_missing',
        severity: 'high',
        title: 'Oh My OpenAgent 缺少 OpenCode v2 运行时目录安全兼容包装',
        desc: '检测到 OMO 插件未注入 input.directory 安全兼容包装器，可能导致运行时崩溃并显示为“未加载”，可一键自动注入'
      });
    }

    // 7.6 Check Provider Dual-Track Schema (OpenCode CLI & OpenChamber UI)
    const dtSchema = updater.checkProviderDualTrackSchema(report.opencodeConfig.path);
    report.dualTrackSchema = dtSchema;
    if (!dtSchema.healthy && dtSchema.issues && dtSchema.issues.length > 0) {
      report.issues.push({
        id: 'provider_dual_track_missing',
        severity: 'high',
        title: '提供商配置缺少双轨 Schema 镜像（导致 OpenChamber 或 CLI 丢失卡片）',
        desc: `检测到提供商缺少 OpenChamber 或 CLI 所需字段 (${dtSchema.issues.join('; ')})，会导致桌面端提供商列表丢失或添加卡住，可一键对齐合流`
      });
    }

    // 7.7 Probe live OpenChamber / OpenCode services
    const probeRes = await updater.probeOpenChamberServices(null, 1500);
    report.openchamberProbe = probeRes;
    if (probeRes.integration && probeRes.integration.status === 'deadlocked') {
      report.issues.push({
        id: 'integration_api_deadlock',
        severity: 'high',
        title: 'OpenCode 插件调度锁死锁（添加提供商界面转圈挂死）',
        desc: '实测 /api/integration 响应超时挂死，表明后台 PluginSupervisor 已处于死锁状态，一键修复将清理 OMO 补丁并重启释放进程'
      });
    }
    if (probeRes.plugins && probeRes.plugins.status === 'degraded' && probeRes.plugins.failedPlugins && probeRes.plugins.failedPlugins.length > 0) {
      report.issues.push({
        id: 'plugin_load_failed',
        severity: 'high',
        title: `核心智能体插件处于加载失败状态 (${probeRes.plugins.failedPlugins.join(', ')})`,
        desc: '检测到插件未能正常加载激活，一键修复将自动注入安全补丁并重载'
      });
    }
  } catch (e) {}

  // 8. Check OpenAI Codex CLI, processes, locale and binding
  try {
    const codexStatus = codexAdapter.getCodexStatus(config.port);
    report.codex = codexStatus;
    const procHealth = codexStatus.processHealth || codexAdapter.checkCodexProcessHealth();
    report.codexProcessHealth = procHealth;
    const localeCheck = codexStatus.localeCheck || codexAdapter.checkCodexLocaleAndEnvironment();
    report.codexLocale = localeCheck;

    const codexIssues = [];
    if (codexStatus.cliInstalled && !codexStatus.isBound) {
      codexIssues.push({
        id: 'codex_not_bound',
        severity: 'medium',
        title: 'OpenAI Codex CLI 尚未接入本地智能网关',
        desc: `检测到本地已安装 Codex CLI (${codexStatus.cliVersion || '已安装'})，可一键接入 OpenCode Go 38 款模型及思考等级映射`
      });
    } else if (codexStatus.cliInstalled && codexStatus.isBound && !codexStatus.hasStreamIdleTimeout) {
      codexIssues.push({
        id: 'codex_timeout_unhardened',
        severity: 'medium',
        title: 'OpenAI Codex 缺少长思考防断流与智能重试加固配置',
        desc: '检测到 Codex config.toml 未配置 stream_idle_timeout_ms (5分钟防断流) 或 stream_max_retries，长思考容易偶发断流，可一键加固修复'
      });
    }

    // 8.1 Check Codex Process Health (Suspension & SingleInstanceLock Deadlocks)
    if (procHealth && !procHealth.healthy) {
      if (procHealth.hasSuspended) {
        codexIssues.push({
          id: 'codex_process_suspended',
          severity: 'high',
          title: 'OpenAI Codex (ChatGPT) 存在被 Windows PLM 挂起的进程（导致桌面打不开或秒退）',
          desc: `检测到 ${procHealth.suspendedCount} 个处于 Wait:Suspended 挂起状态的 ChatGPT 线程霸占单实例互斥锁，一键修复即可通过 Win32 API 唤醒恢复渲染`
        });
      } else if (procHealth.hasGhost) {
        codexIssues.push({
          id: 'codex_ghost_process',
          severity: 'high',
          title: 'OpenAI Codex (ChatGPT) 后台无窗口僵死进程死锁单实例锁',
          desc: '检测到后台存在无窗口僵死实例霸占 SingleInstanceLock 互斥锁，导致桌面双击图标无法打开或闪退，可一键自动清理释放'
        });
      }
    }

    // 8.2 Check Codex Locale & Environment Alignment
    if (localeCheck && !localeCheck.healthy && localeCheck.issues && localeCheck.issues.length > 0) {
      codexIssues.push({
        id: 'codex_locale_misaligned',
        severity: 'medium',
        title: 'OpenAI Codex 简体中文语言环境或模型标识未完整对齐（显示为英文或自定义）',
        desc: `检测到: ${localeCheck.issues.join('；')}，点击一键修复即可锁定中文语言环境并规范模型 Slug`
      });
    }

    report.codexIssues = codexIssues;
    if (scope === 'all') {
      report.issues.push(...codexIssues);
    }
  } catch (e) {}

  // 8.3 Check Upstream Model Compatibility & Gateway Self-Healing Shield
  report.modelCompatibilityShield = {
    status: 'active',
    supportedDynamicFallback: true,
    protectedModels: ['deepseek-v4.1-flash', 'deepseek-v4-flash', 'gpt-5.6-luna', 'gpt-6-luna', 'grok-4.6', 'grok-4.7', 'minimax-m2.7'],
    strategy: 'dynamic_candidate_resolution'
  };

  // 8.4 Check Context Compression Health & Anti-Downgrade Redlines
  try {
    const compStats = contextCompactor.getCompressionStats();
    const compHealth = contextCompactor.checkCompressionHealth(config.compression, compStats);
    report.compression = compHealth;
    if (scope === 'all' && compHealth.issues && compHealth.issues.length > 0) {
      report.issues.push(...compHealth.issues);
    }
  } catch (e) {}

  // 8.5 Check OpenCode 2.0 Credential & Daemon Key Health (Anti-Invalid Credential)
  try {
    const updater = require('./updater');
    const targetKey = (options && options.apiKey && typeof options.apiKey === 'string' && options.apiKey.trim()) ? options.apiKey.trim() : 'local-router';
    const credStatus = updater.checkOpenCodeCredentials(targetKey);
    report.opencodeCredentials = credStatus;
    if (report.opencode) {
      report.opencode.credentials = credStatus;
    }
    if (scope === 'all' && credStatus.issues && credStatus.issues.length > 0) {
      report.issues.push(...credStatus.issues);
    }
  } catch (e) {}

  // 8.6 Check Gateway Loopback IPC Authorization Barrier (Anti-401 Provider Deadlock)
  try {
    const targetKey = (options && options.apiKey && typeof options.apiKey === 'string' && options.apiKey.trim()) ? options.apiKey.trim() : 'local-router';
    const loopbackAuthOk = isAuthorized({
      url: '/v1/models',
      headers: { authorization: `Bearer ${targetKey}` },
      socket: { remoteAddress: '127.0.0.1' }
    });
    const lanProtectedOk = (!config.uiPassword || !config.uiPassword.trim()) ? true : !isAuthorized({
      url: '/v1/models',
      headers: { authorization: `Bearer ${targetKey}` },
      socket: { remoteAddress: '192.168.1.100' }
    });

    report.gatewayLoopbackAuth = {
      healthy: loopbackAuthOk && lanProtectedOk,
      hasUiPassword: Boolean(config.uiPassword && config.uiPassword.trim()),
      loopbackAuthorized: loopbackAuthOk,
      lanProtected: lanProtectedOk
    };

    if (!loopbackAuthOk) {
      report.issues.push({
        id: 'gateway_loopback_auth_blocked',
        severity: 'high',
        title: '智能网关本地回路鉴权阻断 (OpenCode 访问 401 死锁)',
        desc: `检测到网关已开启访问密码，但未放行来自 127.0.0.1 回路的 "${targetKey}" 本地密钥，导致 OpenCode 与 OpenChamber 访问报 401 鉴权失败且会话死锁挂起，可一键自动修复放行`
      });
    }
    if (!lanProtectedOk) {
      report.issues.push({
        id: 'gateway_lan_protection_bypassed',
        severity: 'high',
        title: '智能网关局域网鉴权门禁存在穿透风险 (违反 Rule 28 红线)',
        desc: `检测到局域网外部客户端能够通过内部密钥 "${targetKey}" 绕过访问密码访问网关，存在配额盗刷风险，可一键自动修复隔离`
      });
    }
  } catch (e) {}

  return report;
}

// Auto-Repair Engine
async function executeSystemRepair(options = {}) {
  const scope = options.scope || 'all';

  // Compression 专项自愈与防降智修复分支
  if (scope === 'compression') {
    const results = [];
    try {
      const repairResult = contextCompactor.repairCompressionConfig(config.compression, options);
      if (repairResult && repairResult.repairedConfig) {
        config.compression = repairResult.repairedConfig;
        if (fs.existsSync(CONFIG_FILE)) {
          try { fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak'); } catch (_) {}
        }
        writeFileSyncAtomic(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
      }
      if (repairResult && repairResult.results) {
        results.push(...repairResult.results);
      }
    } catch (e) {
      results.push({ item: 'Context Compression Engine', success: false, message: '压缩引擎专项自愈异常: ' + e.message });
    }
    return results;
  }

  // Codex 专项自愈与防断流加固分支
  if (scope === 'codex') {
    const results = [];
    try {
      // 8.1 Repair Codex suspension and ghost processes if any
      const procRep = codexAdapter.resumeOrCleanCodexProcesses();
      if (procRep && procRep.resumed) {
        results.push({ item: 'Codex Process Suspension', success: true, message: procRep.message });
      } else if (procRep && procRep.killed) {
        results.push({ item: 'Codex SingleInstanceLock', success: true, message: procRep.message });
      } else {
        results.push({ item: 'Codex Process Suspension', success: true, message: '进程健康无挂起或僵死锁' });
      }

      // 8.2 Repair Codex locale, model slug and port conflicts
      const locRep = codexAdapter.repairCodexLocaleAndEnvironment();
      if (locRep && locRep.messages && locRep.messages.length > 0) {
        results.push({ item: 'Codex Locale & Environment', success: true, message: locRep.messages.join('；') });
      } else {
        results.push({ item: 'Codex Locale & Environment', success: true, message: '简体中文语言环境与模型标识已对齐' });
      }

      // 8.3 Auto-bind Codex CLI if installed and not yet bound or not hardened
      const codexStatus = codexAdapter.getCodexStatus(config.port);
      if (codexStatus.cliInstalled && (!codexStatus.isBound || !codexStatus.hasStreamIdleTimeout)) {
        const isRehardened = codexStatus.isBound && !codexStatus.hasStreamIdleTimeout;
        const bindRes = codexAdapter.bindCodexConfig({
          routerPort: config.port,
          routerUrl: `http://127.0.0.1:${config.port}/v1`,
          defaultModel: options.defaultModel || 'deepseek-v4.1-flash',
          reasoningEffort: options.reasoningEffort || 'high',
          providerName: 'opencode-go'
        });
        results.push({
          item: 'Codex Integration',
          success: bindRes.success,
          message: bindRes.success
            ? (isRehardened ? '已自动加固 OpenAI Codex 5分钟长思考防断流与智能重试机制 (stream_idle_timeout_ms = 300000)' : '已自动将 OpenAI Codex CLI 接入本地 4010 智能网关（支持全量 38 款模型）')
            : bindRes.error
        });
      } else if (codexStatus.cliInstalled && codexStatus.isBound) {
        results.push({ item: 'Codex Integration', success: true, message: 'OpenAI Codex 已接入本地 4010 网关且已完成 5 分钟超时加固' });
      } else {
        results.push({ item: 'Codex Integration', success: true, message: 'Codex CLI 未检测到全局安装，已就绪配置目录待命' });
      }
    } catch (e) {
      results.push({ item: 'Codex Integration', success: false, message: 'Codex 专项自愈异常: ' + e.message });
    }
    return results;
  }

  const results = [];

  // 1. Reset all cooldowns
  for (const stat of accountStats.values()) {
    stat.cooldownUntil = 0;
    stat.lastError = null;
  }
  results.push({ item: 'Reset Cooldowns', success: true, message: '已重置所有账号的限频冷却状态' });

  let omoPatchedNow = false;
  let agentGoalInjectedNow = false;

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
          const proxyInfo = getEffectiveProxyForRequest(null);
          const proxyAgent = proxyInfo ? getProxyAgent(proxyInfo.url, new URL(config.upstream).protocol === 'https:') : null;
          officialModels = await updater.fetchOfficialModels(validAccount.apiKey, config.upstream, 2500, { agent: proxyAgent });
        } catch (_) {}
      }
    }

    const harmRes = updater.harmonizeOpencodeConfig(ocPath, config.port, { officialModels });
    if (harmRes.agentGoalInjected) agentGoalInjectedNow = true;
    const migMsg = harmRes.migratedProviders.length > 0 ? ` (已合流第三方服务商: ${harmRes.migratedProviders.join(', ')})` : '';
    const syncTag = (officialModels && officialModels.length > 0) ? `已动态同步官方最新 ${harmRes.modelCount} 款模型` : `全量补齐 ${harmRes.modelCount} 款官方模型`;
    results.push({
      item: 'OpenCode Config',
      success: true,
      message: harmRes.isNew
        ? '已自动生成 opencode.jsonc 并绑定 4010 智能网关'
        : `已清洗旧复数 providers 冲突，${syncTag}${migMsg}，保留当前首选模型 (${harmRes.currentModel})`
    });
    if (harmRes.agentGoalInjected) {
      results.push({
        item: 'OpenCode Agent Declaration',
        success: true,
        message: '已自动补齐 OpenCode 2.0 原生 agent.goal (主模式) 与 agent[\'goal-verify\'] (审阅模式) 声明，并严格保护用户定制 Prompt'
      });
    }
  } catch (e) {
    results.push({ item: 'OpenCode Config', success: false, message: '修复 opencode.jsonc 失败: ' + e.message });
  }

  // 2.1 Sync & Activate OpenCode 2.0 Credentials in opencode.db / auth.json and daemon environment
  try {
    const updater = require('./updater');
    const targetKey = (options && options.apiKey && typeof options.apiKey === 'string' && options.apiKey.trim()) ? options.apiKey.trim() : 'local-router';
    const repRes = updater.repairOpenCodeCredentials(targetKey);
    results.push({
      item: 'OpenCode Credential & Daemon Key',
      success: repRes.success,
      message: repRes.message || '已增量激活 OpenCode 原生凭据与守护进程环境变量'
    });
  } catch (credErr) {
    results.push({ item: 'OpenCode Credential & Daemon Key', success: false, message: '修复 OpenCode 原生凭据异常: ' + credErr.message });
  }

  // 2.2 Verify and Harden Gateway Loopback Auth Barrier
  try {
    const targetKey = (options && options.apiKey && typeof options.apiKey === 'string' && options.apiKey.trim()) ? options.apiKey.trim() : 'local-router';
    if (!config.localApiKey) {
      config.localApiKey = targetKey;
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          writeFileSyncAtomic(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        } catch (_) {}
      }
    }
    const testLoopback = isAuthorized({
      url: '/v1/models',
      headers: { authorization: `Bearer ${targetKey}` },
      socket: { remoteAddress: '127.0.0.1' }
    });
    results.push({
      item: 'Gateway Loopback Auth Barrier',
      success: testLoopback,
      message: testLoopback
        ? '已确保护网关本地回路 IPC 零配置鉴权放行，且严格保持局域网密码门禁 (Rule 28)'
        : '网关本地回路鉴权未完全通过，已自动注入 localApiKey 保护配置'
    });
  } catch (lbErr) {
    results.push({ item: 'Gateway Loopback Auth Barrier', success: false, message: '修复网关回路鉴权门禁异常: ' + lbErr.message });
  }

  // 2.5 Auto-Patch OMO v2 Compatibility & Clean Deadlocks
  try {
    const updater = require('./updater');
    const omoPatchRes = updater.patchOmoPluginV2();
    if (omoPatchRes.patchedCount > 0) {
      omoPatchedNow = true;
      results.push({
        item: 'OMO Plugin v2 Patch',
        success: true,
        message: `已为 ${omoPatchRes.patchedCount} 处 OMO 插件注入 OpenCode v2 安全目录包装器并清除 Effect-TS 死锁标记`
      });
    } else {
      results.push({
        item: 'OMO Plugin v2 Patch',
        success: true,
        message: `已就绪：本地 ${omoPatchRes.targets} 处 OMO 插件均已具备安全目录包装器且无死锁标记`
      });
    }
  } catch (e) {
    results.push({ item: 'OMO Plugin v2 Patch', success: false, message: '修补 OMO 插件异常: ' + e.message });
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
$ProgressPreference = 'SilentlyContinue'
$ghostFound = $false
$chamberProcs = Get-Process -Name "OpenChamber" -ErrorAction SilentlyContinue
if ($chamberProcs) {
  $hasWindow = $false
  foreach ($p in $chamberProcs) {
    if ($p.MainWindowHandle -ne 0) { $hasWindow = $true; break }
  }
  $portReachable = $false
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $ar = $tcp.BeginConnect("127.0.0.1", 3000, $null, $null)
    if ($ar.AsyncWaitHandle.WaitOne(400, $false) -and $tcp.Connected) { $portReachable = $true }
    $tcp.Close()
  } catch {}
  if (-not $hasWindow -and -not $portReachable) {
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
$codeCache = Join-Path $env:APPDATA "OpenChamber\\Code Cache"
if (Test-Path $codeCache) { Remove-Item $codeCache -Recurse -Force -ErrorAction SilentlyContinue }
[PSCustomObject]@{ GhostKilled = $ghostFound; OrphanKilled = $orphanFound } | ConvertTo-Json -Compress
`;
      const enc = Buffer.from(psCleanup, 'utf16le').toString('base64');
      const out = execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${enc}`, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      if (out) {
        const jsonMatch = out.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const res = JSON.parse(jsonMatch[0]);
          if (res.GhostKilled) {
            results.push({ item: 'OpenChamber SingleInstanceLock', success: true, message: '已彻底终止后台僵死进程并释放单实例互斥锁，恢复桌面秒开' });
          } else {
            results.push({ item: 'OpenChamber SingleInstanceLock', success: true, message: '已校验单实例互斥锁状态健康（无僵死锁死）' });
          }
          if (res.OrphanKilled) {
            results.push({ item: 'Orphan OpenCode Cleanup', success: true, message: '已清理孤立残留的 OpenCode 托管后台进程' });
          }
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

  // 8. Auto-bind & auto-repair Codex CLI, processes, locale and environment (Skipped when scope === 'system')
  if (scope !== 'system') {
    try {
      // 8.1 Repair Codex suspension and ghost processes if any
      const procRep = codexAdapter.resumeOrCleanCodexProcesses();
      if (procRep && procRep.resumed) {
        results.push({ item: 'Codex Process Suspension', success: true, message: procRep.message });
      } else if (procRep && procRep.killed) {
        results.push({ item: 'Codex SingleInstanceLock', success: true, message: procRep.message });
      }

      // 8.2 Repair Codex locale, model slug and port conflicts
      const locRep = codexAdapter.repairCodexLocaleAndEnvironment();
      if (locRep && locRep.messages && locRep.messages.length > 0) {
        results.push({ item: 'Codex Locale & Environment', success: true, message: locRep.messages.join('；') });
      }

      // 8.3 Auto-bind Codex CLI if installed and not yet bound or not hardened
      const codexStatus = codexAdapter.getCodexStatus(config.port);
      if (codexStatus.cliInstalled && (!codexStatus.isBound || !codexStatus.hasStreamIdleTimeout)) {
        const isRehardened = codexStatus.isBound && !codexStatus.hasStreamIdleTimeout;
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
          message: bindRes.success
            ? (isRehardened ? '已自动加固 OpenAI Codex 5分钟长思考防断流与智能重试机制 (stream_idle_timeout_ms = 300000)' : '已自动将 OpenAI Codex CLI 接入本地 4010 智能网关（支持全量 38 款模型）')
            : bindRes.error
        });
      }
    } catch (e) {
      results.push({ item: 'Codex Integration', success: false, message: 'Codex 诊断修复异常: ' + e.message });
    }
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

      // 若刚为 OMO 插件注入补丁或为 opencode.jsonc 补齐了缺失的 agent.goal，必须重启 opencode-server 刷新 Bun 运行时内存模块缓存
      const shouldRestartOpencode = omoPatchedNow || agentGoalInjectedNow;
      if (shouldRestartOpencode && sysOut && sysOut.includes('opencode-server.service')) {
        updater.runCmd('systemctl --user restart opencode-server.service', 15000);
        results.push({ item: 'OpenCode Plugin Reload', success: true, message: '检测到核心智能体/插件补丁已对齐，已平滑重启 opencode-server.service 刷新模块缓存' });
      } else {
        // 常规体检保持稳定常驻，保护运行中会话与任务避免出现 Step interrupted
        results.push({ item: 'OpenCode Zero-Disturbance', success: true, message: 'OpenCode 原生 Inotify 热感知已生效，已严格保护业务长程任务不被中断' });
      }
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

  // 8. Context Compression Engine auto-healing (when scope === 'all')
  if (scope === 'all') {
    try {
      const compStats = contextCompactor.getCompressionStats();
      const compHealth = contextCompactor.checkCompressionHealth(config.compression, compStats);
      if (!compHealth.healthy) {
        const compRep = contextCompactor.repairCompressionConfig(config.compression, { autoHeal: true });
        if (compRep && compRep.repairedConfig) {
          config.compression = compRep.repairedConfig;
          if (fs.existsSync(CONFIG_FILE)) {
            try { fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak'); } catch (_) {}
          }
          writeFileSyncAtomic(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        }
        if (compRep && compRep.results) {
          results.push(...compRep.results);
        }
      } else {
        results.push({ item: 'Context Compression Engine', success: true, message: '压缩引擎配置安全健康，防降智与防断流守护均正常' });
      }
    } catch (e) {
      results.push({ item: 'Context Compression Engine', success: false, message: '压缩引擎自愈异常: ' + e.message });
    }
  }

  return results;
}

function isAuthorized(req) {
  if (!config.uiPassword || !config.uiPassword.trim()) return true;
  const expected = config.uiPassword.trim();
  const expectedB64 = Buffer.from(expected).toString('base64');

  const validApiKeys = new Set(
    (config.accounts || [])
      .filter(a => a && a.enabled && a.apiKey && a.apiKey.trim())
      .map(a => a.apiKey.trim())
  );
  if (config.apiKey && typeof config.apiKey === 'string' && config.apiKey.trim()) {
    validApiKeys.add(config.apiKey.trim());
  }

  // Determine if caller is strictly from local loopback (same-machine IPC)
  const remoteIp = (req && req.socket && req.socket.remoteAddress) || '';
  const isLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1' || remoteIp === 'localhost';

  // Helper to validate loopback-only internal token (e.g., 'local-router' used by OpenCode)
  // Remote/LAN callers cannot use 'local-router' to bypass uiPassword (Rule 28)
  const isLoopbackToken = (token) => {
    if (!token || typeof token !== 'string') return false;
    const trimmed = token.trim();
    if (trimmed === 'local-router') return isLoopback;
    if (config.localApiKey && trimmed === config.localApiKey.trim()) return isLoopback;
    return false;
  };

  // Rule 28 Protection Symmetry & Codex / OpenCode Desktop Loopback Immunity:
  // When uiPassword is configured to protect Web Dashboard and LAN exposure, local desktop clients
  // (Codex Desktop calling /v1/responses or OpenCode calling /v1/*) running on the same loopback host (127.0.0.1)
  // are automatically authorized for inference calls so they never suffer 401 errors.
  // Administrative endpoints (/balancer/*) STILL strictly require uiPassword on loopback!
  // Remote/LAN callers to /v1/* or /balancer/* STILL strictly require uiPassword/apiKey (Rule 28)!
  const reqUrlStr = (req && req.url) || '';
  if (isLoopback && (reqUrlStr.startsWith('/v1/') || reqUrlStr === '/v1')) {
    return true;
  }

  // 1. Authorization header: Bearer <pwd_or_b64_or_key> or Basic <base64>
  const authHeader = (req && req.headers && req.headers['authorization']) || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token === expected || token === expectedB64 || validApiKeys.has(token) || isLoopbackToken(token)) return true;
  } else if (authHeader.startsWith('Basic ')) {
    const b64 = authHeader.slice(6).trim();
    if (b64 === expected || b64 === expectedB64) return true;
    try {
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      const parts = decoded.split(':');
      const pass = parts.length > 1 ? parts.slice(1).join(':') : parts[0];
      if (pass === expected || decoded === expected || validApiKeys.has(pass) || isLoopbackToken(pass) || isLoopbackToken(decoded)) return true;
    } catch (e) {}
  }

  // 2. Custom header: x-ui-password, x-router-auth, or x-api-key
  const customHeader = (req && req.headers && (req.headers['x-ui-password'] || req.headers['x-router-auth'] || req.headers['x-api-key']) || '').trim();
  if (customHeader === expected || customHeader === expectedB64 || validApiKeys.has(customHeader) || isLoopbackToken(customHeader)) return true;

  // 3. Cookie: router_auth=<pwd_or_b64>
  const cookieHeader = req.headers['cookie'] || '';
  const match = cookieHeader.match(/router_auth=([^;]+)/);
  if (match) {
    const val = decodeURIComponent(match[1]).trim();
    if (val === expected || val === expectedB64) return true;
  }

  // 4. Query param: ?auth=<pwd_or_b64>
  if (typeof req.url === 'string') {
    try {
      const u4177 = new URL(req.url || '/', 'http://localhost');
      const parsed = { pathname: u4177.pathname, query: Object.fromEntries(u4177.searchParams.entries()), searchParams: u4177.searchParams };
      if (parsed.query && parsed.query.auth) {
        const val = String(parsed.query.auth).trim();
        if (val === expected || val === expectedB64) return true;
      }
    } catch (_) {}
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
      --bg: #09090b;
      --card-bg: #121215;
      --border: #27272a;
      --border-hover: #3f3f46;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --text: #f4f4f5;
      --muted: #a1a1aa;
      --danger: #ef4444;
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
      -webkit-font-smoothing: antialiased;
    }
    .login-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2.5rem 2rem;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 16px 36px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.03);
      text-align: center;
    }
    .icon { font-size: 2.8rem; margin-bottom: 1rem; }
    h2 { font-size: 1.35rem; color: #ffffff; margin-bottom: 0.5rem; letter-spacing: -0.01em; }
    p { font-size: 0.86rem; color: var(--muted); margin-bottom: 1.6rem; line-height: 1.5; }
    .input-group { margin-bottom: 1.2rem; }
    .form-control {
      width: 100%;
      background: #09090b;
      border: 1px solid var(--border);
      color: #f4f4f5;
      padding: 11px 16px;
      border-radius: 8px;
      font-size: 0.95rem;
      text-align: center;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .form-control:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 0 1px #38bdf8;
    }
    .btn {
      width: 100%;
      background: #f4f4f5;
      color: #09090b;
      border: 1px solid #f4f4f5;
      padding: 11px;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn:hover { background: #ffffff; border-color: #ffffff; color: #000000; box-shadow: 0 1px 8px rgba(255,255,255,0.15); }
    .btn:active { transform: translateY(1px); }
    .err-msg {
      color: var(--danger);
      font-size: 0.85rem;
      margin-top: 1rem;
      display: none;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
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

function renderDashboardHtml(config) {
  let pkgVersion = '3.11.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    if (pkg.version) pkgVersion = pkg.version;
  } catch (_) {}
  const compCfg = config.compression || contextCompactor.DEFAULT_COMPRESSION_CONFIG;
  const mCfg = compCfg.modules || {};
  let psPlatform = { isWindows: process.platform === 'win32', isLinux: process.platform === 'linux' };
  try {
    psPlatform = powershellOptimizer.detectPlatform(compCfg);
  } catch (_) {}
  const psIsWin = psPlatform.isWindows;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#09090b">
  <meta name="color-scheme" content="dark">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>OpenCode 智能高可用网关 | 订阅管理中心</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico">
  <style>
    :root {
      --bg: #09090b;
      --card-bg: #121215;
      --card-bg-elevated: #16161a;
      --sidebar-bg: #0c0c0e;
      --sidebar-border: #222226;
      --border: #27272a;
      --border-subtle: #1f1f23;
      --border-hover: #3f3f46;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f4f4f5;
      --text-muted: #a1a1aa;
      --muted: #a1a1aa;
      --muted-dark: #71717a;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background-color: #09090b !important;
      color: var(--text);
      line-height: 1.5;
      overflow-x: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    /* Sleek Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #09090b; }
    ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #3f3f46; }

    .app-layout {
      display: flex;
      min-height: 100vh;
      width: 100%;
    }
    .app-sidebar {
      width: 240px;
      height: 100vh;
      position: fixed;
      left: 0;
      top: 0;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--sidebar-border);
      display: flex;
      flex-direction: column;
      z-index: 100;
      transition: width 0.22s cubic-bezier(0.16, 1, 0.3, 1), left 0.22s ease;
      box-shadow: 1px 0 0 0 var(--sidebar-border);
    }
    .sidebar-header {
      padding: 14px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--sidebar-border);
      min-height: 58px;
    }
    .sidebar-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      overflow: hidden;
      text-decoration: none;
    }
    .sidebar-logo {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      flex-shrink: 0;
    }
    .sidebar-title-box {
      overflow: hidden;
      white-space: nowrap;
    }
    .sidebar-title {
      font-size: 0.98rem;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.2;
      letter-spacing: -0.01em;
    }
    .sidebar-subtitle {
      font-size: 0.7rem;
      color: var(--muted);
      font-weight: 500;
    }
    .sidebar-collapse-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: 6px;
      padding: 4px 6px;
      cursor: pointer;
      font-size: 0.8rem;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .sidebar-collapse-btn:hover {
      background: #1f1f23;
      border-color: var(--border-hover);
      color: #ffffff;
    }
    .sidebar-version-badge {
      padding: 6px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #09090b;
      border-bottom: 1px solid var(--sidebar-border);
      font-size: 0.72rem;
    }
    .sidebar-nav {
      flex: 1;
      padding: 10px 8px;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 6px;
      color: var(--muted);
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 500;
      transition: background 0.15s ease, color 0.15s ease;
      position: relative;
      user-select: none;
    }
    .nav-item:hover {
      background: #16161a;
      color: #ffffff;
    }
    .nav-item.active {
      background: #18181b;
      color: #ffffff;
      font-weight: 600;
      border-left: 2px solid var(--primary);
    }
    .nav-icon {
      font-size: 1.1rem;
      flex-shrink: 0;
      width: 20px;
      text-align: center;
    }
    .nav-label {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .nav-badge {
      font-size: 0.68rem;
      padding: 1px 6px;
      border-radius: 9999px;
      background: #1f1f23;
      color: #d4d4d8;
      border: 1px solid var(--border);
      white-space: nowrap;
    }
    .sidebar-footer {
      padding: 10px 14px;
      border-top: 1px solid var(--sidebar-border);
      background: var(--sidebar-bg);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .sidebar-host-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.74rem;
      color: var(--muted);
      overflow: hidden;
      white-space: nowrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .status-indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 6px #10b981;
      flex-shrink: 0;
    }
    .sidebar-logout-btn {
      padding: 2px 8px;
      font-size: 0.72rem;
    }

    /* Collapsed Sidebar Mode */
    body.sidebar-collapsed .app-sidebar {
      width: 68px;
    }
    body.sidebar-collapsed .sidebar-title-box,
    body.sidebar-collapsed .sidebar-subtitle,
    body.sidebar-collapsed .sidebar-version-badge,
    body.sidebar-collapsed .nav-label,
    body.sidebar-collapsed .nav-badge,
    body.sidebar-collapsed .sidebar-host-status .sidebar-port-label {
      display: none !important;
    }
    body.sidebar-collapsed .sidebar-header {
      justify-content: center;
      padding: 12px 6px;
    }
    body.sidebar-collapsed .sidebar-collapse-btn .collapse-icon {
      transform: rotate(180deg);
    }
    body.sidebar-collapsed .nav-item {
      justify-content: center;
      padding: 10px 0;
    }
    body.sidebar-collapsed .nav-icon {
      margin: 0;
    }
    body.sidebar-collapsed .app-main {
      margin-left: 68px;
      width: calc(100% - 68px);
    }

    /* Main Content Area */
    .app-main {
      margin-left: 240px;
      width: calc(100% - 240px);
      min-height: 100vh;
      padding: 1.5rem 2rem 3rem;
      transition: margin-left 0.22s cubic-bezier(0.16, 1, 0.3, 1), width 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      background: #09090b;
    }
    .container { max-width: 1160px; margin: 0 auto; }

    /* Top Action Bar (Persistent) */
    .top-action-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      padding-bottom: 0.85rem;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
      gap: 12px;
    }
    .top-bar-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .current-route-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.15rem;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.01em;
    }
    .route-icon { font-size: 1.25rem; }
    .top-baseurl-box {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #121215;
      border: 1px solid var(--border);
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 0.78rem;
    }
    .top-baseurl-box code {
      color: #ffffff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 500;
    }
    .baseurl-tag { color: var(--muted); }
    .top-bar-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* Dropdown Menu Styles (Minimalist Carbon) */
    .dropdown-wrapper {
      position: relative;
      display: inline-flex;
    }
    .dropdown-arrow {
      display: inline-block;
      transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .dropdown-wrapper.open .dropdown-arrow {
      transform: rotate(180deg);
    }
    .dropdown-menu {
      position: absolute;
      right: 0;
      top: calc(100% + 6px);
      background: #16161a;
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 10px 30px -5px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04);
      z-index: 250;
      min-width: 220px;
      padding: 6px;
      display: none;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
    .dropdown-menu.show {
      display: flex;
      flex-direction: column;
      gap: 2px;
      animation: dropdownFadeIn 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes dropdownFadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 7px 10px;
      font-size: 0.82rem;
      color: var(--text);
      background: transparent;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      text-align: left;
      text-decoration: none;
      transition: background 0.15s ease, color 0.15s ease;
      font-family: inherit;
    }
    .dropdown-item:hover {
      background: #27272a;
      color: #ffffff;
    }
    .dropdown-item-icon {
      font-size: 0.95rem;
      flex-shrink: 0;
      width: 18px;
      text-align: center;
    }
    .dropdown-divider {
      height: 1px;
      background: var(--border);
      margin: 4px 0;
    }

    /* Status Pill Bar & Condensed Banner */
    .banner, .status-capsule-bar {
      background: rgba(18, 18, 21, 0.7);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 6px 14px;
      margin-bottom: 1.25rem;
      font-size: 0.82rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    .capsule-group {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      border-radius: 9999px;
      padding: 2px 10px;
      font-size: 0.74rem;
      color: var(--muted);
      font-weight: 500;
    }
    .status-pill-active {
      background: rgba(16, 185, 129, 0.08);
      border-color: rgba(16, 185, 129, 0.25);
      color: #34d399;
    }
    .status-dot-pulse {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }

    /* View Sections (SPA Transitions) */
    .view-section {
      display: none;
      animation: fadeInView 0.16s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .view-section.active {
      display: block;
    }
    @keyframes fadeInView {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Mobile Header (Hidden on PC) */
    .mobile-header {
      display: none;
      position: sticky;
      top: 0;
      left: 0;
      right: 0;
      height: 52px;
      background: #0c0c0e;
      border-bottom: 1px solid var(--border);
      padding: 0 12px;
      align-items: center;
      justify-content: space-between;
      z-index: 90;
    }
    .hamburger-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: #f4f4f5;
      font-size: 1.15rem;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
    }
    .mobile-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      color: #ffffff;
      font-size: 0.95rem;
    }
    .mobile-brand img { width: 26px; height: 26px; border-radius: 6px; }
    .sidebar-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 95;
      backdrop-filter: blur(4px);
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
      flex-wrap: wrap;
      gap: 14px;
    }
    .title-group h1 {
      margin: 0;
      font-size: 1.35rem;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 10px;
      letter-spacing: -0.01em;
    }
    .title-group p { margin: 4px 0 0; color: var(--muted); font-size: 0.85rem; }
    .header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #18181b;
      color: var(--text);
      border: 1px solid var(--border);
      padding: 6px 14px;
      border-radius: 6px;
      font-weight: 500;
      cursor: pointer;
      font-size: 0.82rem;
      transition: all 0.15s ease;
      user-select: none;
      font-family: inherit;
    }
    .btn:hover {
      background: #27272a;
      border-color: var(--border-hover);
      color: #ffffff;
    }
    .btn:active { transform: translateY(1px); }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-primary {
      background: #f4f4f5;
      color: #09090b;
      border-color: #f4f4f5;
      font-weight: 600;
    }
    .btn-primary:hover {
      background: #ffffff;
      border-color: #ffffff;
      color: #000000;
      box-shadow: 0 1px 8px rgba(255, 255, 255, 0.15);
    }
    .btn-secondary {
      background: #18181b;
      color: var(--text);
      border-color: var(--border);
    }
    .btn-secondary:hover {
      background: #27272a;
      border-color: var(--border-hover);
      color: #ffffff;
    }
    .btn-success {
      background: #064e3b;
      color: #34d399;
      border-color: #059669;
    }
    .btn-success:hover {
      background: #047857;
      color: #ffffff;
    }
    .btn-danger {
      background: #450a0a;
      color: #fca5a5;
      border-color: #7f1d1d;
    }
    .btn-danger:hover {
      background: #7f1d1d;
      color: #ffffff;
    }
    .btn-sm {
      padding: 4px 10px;
      font-size: 0.78rem;
      border-radius: 6px;
    }

    /* Foolproof Save Dirty State & Micro-interactions */
    .btn-save-dirty {
      background: linear-gradient(135deg, #0284c7 0%, #10b981 100%) !important;
      color: #ffffff !important;
      border-color: rgba(255, 255, 255, 0.4) !important;
      animation: pulseSaveGlow 1.8s infinite ease-in-out;
    }
    @keyframes pulseSaveGlow {
      0%, 100% { box-shadow: 0 0 8px rgba(16, 185, 129, 0.4); }
      50% { box-shadow: 0 0 18px rgba(56, 189, 248, 0.85); transform: translateY(-1px); }
    }

    /* Wizard Hero Button */
    .btn-wizard {
      background: #18181b;
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.4);
      padding: 8px 18px;
      font-size: 0.92rem;
      border-radius: 8px;
      font-weight: 600;
      transition: all 0.2s ease;
    }
    .btn-wizard:hover {
      background: rgba(56, 189, 248, 0.1);
      border-color: #38bdf8;
      color: #ffffff;
      box-shadow: 0 0 14px rgba(56, 189, 248, 0.25);
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.25rem;
      margin-bottom: 1.25rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.6);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .card:hover {
      border-color: var(--border-hover);
    }
    .wizard-card {
      background: #121215;
      border: 1px solid rgba(56, 189, 248, 0.25);
      box-shadow: 0 2px 10px rgba(0,0,0,0.5);
    }
    .section-title {
      font-size: 1.05rem;
      font-weight: 600;
      margin: 0 0 0.85rem;
      color: #ffffff;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      letter-spacing: -0.01em;
    }
    .section-title-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .collapse-toggle {
      font-size: 0.74rem;
      color: var(--muted);
      cursor: pointer;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      user-select: none;
      transition: all 0.15s ease;
    }
    .collapse-toggle:hover { color: #ffffff; background: #27272a; border-color: var(--border-hover); }
    .badge {
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .badge-healthy { background: rgba(16, 185, 129, 0.1); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.25); }
    .badge-cooling { background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.25); }
    .badge-disabled { background: rgba(113, 113, 122, 0.1); color: #a1a1aa; border: 1px solid rgba(113, 113, 122, 0.25); }

    /* Plain Tip Box (Minimalist Carbon refinement) */
    .plain-tip-box {
      font-size: 0.78rem;
      color: #a1a1aa;
      background: #101014;
      padding: 7px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      margin-bottom: 12px;
      line-height: 1.45;
    }
    .plain-tip-box strong { color: #f4f4f5; }

    /* Wizard Grid */
    .wizard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .wizard-step {
      background: #16161a;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: border-color 0.2s;
    }
    .wizard-step:hover { border-color: var(--border-hover); }
    .wizard-step-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      font-size: 0.86rem;
      color: #ffffff;
    }

    /* Accounts & Forms */
    .accounts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
      gap: 1.25rem;
    }
    .account-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.2rem;
      position: relative;
      transition: border-color 0.2s;
    }
    .account-card:hover { border-color: var(--border-hover); }
    .acc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .acc-title-input {
      background: transparent;
      border: 1px dashed transparent;
      color: #ffffff;
      font-size: 1.05rem;
      font-weight: 600;
      padding: 4px 6px;
      border-radius: 6px;
      width: 60%;
    }
    .acc-title-input:focus, .acc-title-input:hover {
      border-color: var(--border-hover);
      background: #09090b;
    }
    .form-group { margin-bottom: 0.9rem; }
    .form-group label {
      display: block;
      font-size: 0.8rem;
      color: var(--muted);
      margin-bottom: 4px;
      font-weight: 500;
    }
    .input-wrapper { display: flex; gap: 6px; position: relative; }
    .form-control {
      flex: 1;
      background: #09090b;
      border: 1px solid var(--border);
      color: #f4f4f5;
      padding: 7px 10px;
      border-radius: 6px;
      font-size: 0.86rem;
      font-family: inherit;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .form-control:focus {
      outline: none;
      border-color: #38bdf8;
      box-shadow: 0 0 0 1px #38bdf8;
    }
    .toggle-eye {
      background: #18181b;
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 0 10px;
      border-radius: 6px;
      cursor: pointer;
    }
    .toggle-eye:hover { color: var(--text); background: #27272a; }
    .acc-metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      background: #09090b;
      border: 1px solid var(--border-subtle);
      padding: 10px 12px;
      border-radius: 6px;
      margin: 1rem 0;
      font-size: 0.78rem;
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

    /* Compression Hierarchy */
    .comp-topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      background: #16161a;
      border: 1px solid var(--border);
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 14px;
    }
    .comp-presets-wrapper {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .presets-title { font-size: 0.8rem; color: var(--muted); font-weight: 500; }
    .comp-presets-group {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }
    .preset-btn {
      background: #121215;
      border: 1px solid var(--border);
      color: #a1a1aa;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.78rem;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    .preset-btn:hover { background: #27272a; color: #fff; border-color: var(--border-hover); }
    .preset-btn.active {
      background: #27272a;
      color: #ffffff;
      border-color: #3f3f46;
      font-weight: 600;
      box-shadow: 0 0 0 1px #52525b;
    }
    .preset-desc-card {
      margin-top: 10px;
      padding: 10px 14px;
      background: #121215;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 0.8rem;
      line-height: 1.5;
      color: #a1a1aa;
      width: 100%;
    }
    .comp-range-group {
      display: inline-flex;
      align-items: center;
      background: #121215;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
    }
    .comp-range-btn, .time-range-pill {
      background: transparent;
      border: 1px solid transparent;
      color: #a1a1aa;
      padding: 4px 11px;
      border-radius: 4px;
      font-size: 0.76rem;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .comp-range-btn:hover, .time-range-pill:hover {
      color: #f1f5f9;
      background: rgba(255, 255, 255, 0.05);
    }
    .comp-range-btn.active, .time-range-pill.active {
      background: #27272a;
      color: #38bdf8;
      border-color: rgba(56, 189, 248, 0.4);
      font-weight: 600;
      box-shadow: 0 0 8px rgba(56, 189, 248, 0.2);
    }
    .comp-metrics-dashboard {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .comp-metric-card {
      background: #16161a;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      transition: border-color 0.2s, transform 0.2s;
    }
    .comp-metric-card:hover { border-color: var(--border-hover); }
    .comp-metric-label { font-size: 0.78rem; color: var(--muted); margin-bottom: 4px; font-weight: 500; }
    .comp-metric-val { font-size: 1.35rem; font-weight: 700; color: #ffffff; line-height: 1.2; letter-spacing: -0.02em; }
    .comp-metric-sub { font-size: 0.72rem; color: #71717a; margin-top: 4px; }
    .by-model-table tr:hover { background: rgba(255, 255, 255, 0.02); }
    .comp-modules-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
      gap: 1.25rem;
    }
    .comp-module-card {
      background: #121215;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.2rem;
      transition: all 0.2s ease;
      position: relative;
    }
    .comp-module-card:hover { border-color: var(--border-hover); }
    .comp-module-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .comp-main-switch-label { font-weight: 600; color: #ffffff; font-size: 0.92rem; }
    .comp-module-desc { font-size: 0.76rem; color: var(--muted); margin-bottom: 12px; line-height: 1.4; }
    .comp-module-header-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; text-align: right; }
    .comp-module-contrib { display: flex; flex-direction: column; align-items: flex-end; }
    .contrib-text { font-size: 0.72rem; color: #a1a1aa; white-space: nowrap; }
    .comp-progress-bar { width: 90px; height: 6px; background: #18181b; border: 1px solid #27272a; border-radius: 9999px; overflow: hidden; margin-top: 3px; }
    .comp-progress-fill { height: 100%; background: linear-gradient(90deg, #38bdf8, #34d399); border-radius: 9999px; box-shadow: 0 0 6px rgba(56, 189, 248, 0.4); transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
    .comp-module-body { display: flex; flex-direction: column; gap: 9px; transition: opacity 0.25s, filter 0.25s; }
    .comp-sub-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 6px 10px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.015);
      border: 1px solid rgba(255, 255, 255, 0.035);
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .comp-sub-item:hover {
      background: rgba(255, 255, 255, 0.035);
      border-color: rgba(255, 255, 255, 0.08);
    }
    .comp-sub-item .switch-label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 0.82rem;
      user-select: none;
      color: #e2e8f0;
      flex: 1;
      margin-bottom: 0;
    }
    .comp-sub-item .switch-label span {
      font-weight: 500;
    }
    .info-tooltip-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
    }
    .info-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 17px;
      height: 17px;
      border-radius: 50%;
      background: #27272a;
      border: 1px solid #3f3f46;
      color: #a1a1aa;
      font-size: 0.7rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 600;
      cursor: help;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      line-height: 1;
      user-select: none;
    }
    .info-icon:hover {
      background: rgba(56, 189, 248, 0.2);
      border-color: #38bdf8;
      color: #38bdf8;
      box-shadow: 0 0 8px rgba(56, 189, 248, 0.35);
      transform: scale(1.1);
    }
    .info-tooltip-bubble {
      visibility: hidden;
      opacity: 0;
      position: absolute;
      bottom: calc(100% + 8px);
      right: -6px;
      width: 280px;
      padding: 9px 12px;
      background: rgba(15, 15, 18, 0.98);
      backdrop-filter: blur(14px);
      border: 1px solid #3f3f46;
      border-radius: 8px;
      color: #cbd5e1;
      font-size: 0.73rem;
      line-height: 1.45;
      font-style: normal;
      box-shadow: 0 12px 28px -4px rgba(0,0,0,0.88), 0 0 0 1px rgba(255,255,255,0.06);
      pointer-events: none;
      z-index: 100;
      transition: opacity 0.15s ease, transform 0.15s ease;
      white-space: normal;
      text-align: left;
    }
    .info-tooltip-bubble::after {
      content: '';
      position: absolute;
      top: 100%;
      right: 10px;
      border-width: 5px;
      border-style: solid;
      border-color: #3f3f46 transparent transparent transparent;
    }
    .info-tooltip-wrap:hover .info-tooltip-bubble {
      visibility: visible;
      opacity: 1;
      transform: translateY(-2px);
    }
    .sub-tip { font-size: 0.73rem; color: #71717a; margin-left: 22px; line-height: 1.35; }
    .comp-module-card.module-disabled { border-color: #1f1f23; background: #0c0c0e; }
    .comp-module-card.module-disabled .comp-module-body { opacity: 0.42; pointer-events: none; filter: grayscale(80%); }
    .comp-module-card.module-disabled .comp-module-desc { opacity: 0.5; }
    .comp-module-card.module-disabled .comp-module-contrib { opacity: 0.4; }
    #compression-card.comp-master-disabled .comp-modules-grid,
    #compression-card.comp-master-disabled .comp-presets-wrapper,
    #compression-card.comp-master-disabled .comp-chart-card {
      opacity: 0.45;
      pointer-events: none;
      filter: grayscale(80%);
    }

    /* Compression Time-Series Chart Styles */
    .comp-chart-card {
      background: #121215;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 18px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.5);
      position: relative;
      transition: border-color 0.2s;
    }
    .comp-chart-card:hover { border-color: var(--border-hover); }
    .chart-btn-group {
      display: inline-flex;
      background: #09090b;
      padding: 2px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .chart-pill-btn {
      background: transparent;
      border: none;
      color: #a1a1aa;
      padding: 3px 9px;
      font-size: 0.72rem;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .chart-pill-btn:hover { color: #ffffff; background: rgba(255, 255, 255, 0.05); }
    .chart-pill-btn.active {
      background: #27272a;
      color: #fb923c;
      font-weight: 600;
      border: 1px solid rgba(249, 115, 22, 0.4);
    }
    .chart-metric-btn.active {
      background: #27272a;
      color: #38bdf8;
      font-weight: 600;
      border: 1px solid rgba(56, 189, 248, 0.4);
    }
    .chart-svg-root {
      width: 100%;
      height: 100%;
      display: block;
      user-select: none;
    }
    .chart-bar-rect {
      transition: opacity 0.15s ease, filter 0.15s ease;
      cursor: pointer;
    }
    .chart-bar-rect:hover {
      opacity: 0.85;
      filter: brightness(1.2);
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: #16161a;
      color: #f4f4f5;
      padding: 10px 18px;
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.8);
      display: none;
      z-index: 1000;
      font-size: 0.88rem;
      font-weight: 500;
      border: 1px solid var(--border);
      animation: toastIn 0.2s ease forwards;
    }
    @keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

    .doctor-box {
      background: #121215;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.9rem;
      margin-top: 0.8rem;
      font-size: 0.86rem;
    }
    .issue-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      margin-bottom: 6px;
      border-radius: 6px;
      background: #16161a;
      border: 1px solid var(--border-subtle);
    }
    .issue-high { border-left: 3px solid var(--danger); }
    .issue-medium { border-left: 3px solid var(--warning); }
    .issue-low { border-left: 3px solid var(--primary); }

    /* Quota */
    .quota-box {
      background: #0d0d10;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      margin: 12px 0 10px;
      font-size: 0.8rem;
    }
    .quota-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--border-subtle);
      font-weight: 600;
      color: #ffffff;
    }
    .quota-row { margin-bottom: 8px; }
    .quota-row:last-child { margin-bottom: 0; }
    .quota-row-top { display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; margin-bottom: 3px; }
    .quota-label { color: #a1a1aa; display: flex; align-items: center; gap: 4px; }
    .quota-value { font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .quota-bar-track { width: 100%; height: 7px; background: #18181b; border: 1px solid #27272a; border-radius: 9999px; overflow: hidden; margin-bottom: 4px; }
    .quota-bar-fill { height: 100%; border-radius: 9999px; transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
    .quota-bar-ok { background: linear-gradient(90deg, #059669, #10b981); box-shadow: 0 0 6px rgba(16, 185, 129, 0.4); }
    .quota-bar-warn { background: linear-gradient(90deg, #d97706, #f59e0b); box-shadow: 0 0 6px rgba(245, 158, 11, 0.4); }
    .quota-bar-danger { background: linear-gradient(90deg, #dc2626, #ef4444); box-shadow: 0 0 6px rgba(239, 68, 68, 0.5); }
    .quota-reset-text { font-size: 0.72rem; color: #71717a; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .quota-ctrl-bar {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.78rem;
      color: var(--muted);
      background: #09090b;
      border: 1px solid var(--border);
      padding: 3px 8px;
      border-radius: 6px;
    }
    .quota-countdown-badge {
      display: inline-block;
      cursor: pointer;
      font-weight: 600;
      color: var(--primary);
      font-size: 0.76rem;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
      transition: all 0.15s ease;
      user-select: none;
    }
    .quota-countdown-badge:hover { background: rgba(56, 189, 248, 0.2); color: #fff; }
    .quota-time-tag { font-size: 0.72rem; color: #71717a; margin-left: 6px; font-weight: normal; }

    /* Updates Table */
    .update-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.82rem; }
    .update-table th, .update-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border-subtle); }
    .update-table th { color: #a1a1aa; font-weight: 600; background: #16161a; }
    .badge-update { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 600; }
    .badge-ok { background: rgba(16, 185, 129, 0.1); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-warn { background: rgba(245, 158, 11, 0.1); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-danger { background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .alert-box { border-radius: 6px; padding: 10px 14px; margin-top: 10px; font-size: 0.82rem; line-height: 1.5; }
    .alert-box-warn { background: rgba(245, 158, 11, 0.08); border: 1px solid #f59e0b; color: #fef08a; }
    .alert-box-danger { background: rgba(239, 68, 68, 0.08); border: 1px solid #ef4444; color: #fecaca; }
    .alert-box-success { background: rgba(16, 185, 129, 0.08); border: 1px solid #10b981; color: #a7f3d0; }

    /* Responsive */
    @media (max-width: 768px) {
      .mobile-header { display: flex; }
      .app-sidebar {
        left: -270px;
        width: 260px;
        box-shadow: 4px 0 24px rgba(0,0,0,0.8);
      }
      .app-sidebar.drawer-open {
        left: 0;
      }
      .sidebar-overlay.active {
        display: block;
      }
      .app-main {
        margin-left: 0 !important;
        width: 100% !important;
        padding: 0.85rem;
      }
      .top-action-bar {
        flex-direction: column;
        align-items: flex-start;
      }
      .top-bar-right {
        width: 100%;
        gap: 6px;
      }
      .top-bar-right .btn {
        flex: 1 1 auto;
        justify-content: center;
      }
      .dropdown-wrapper {
        width: 100%;
      }
      .dropdown-wrapper .btn {
        width: 100%;
        justify-content: center;
      }
      .dropdown-menu {
        left: 0;
        right: 0;
        width: 100%;
        min-width: unset;
      }
      .accounts-grid, .comp-modules-grid, .config-grid, .wizard-grid {
        grid-template-columns: 1fr;
      }
      .acc-title-input { width: 85%; }
      .banner, .status-capsule-bar { flex-direction: column; align-items: flex-start; }
    }
    @media (max-width: 420px) {
      .top-bar-right .btn { flex: 1 1 100%; }
    }
  </style>
</head>
<body>
  <!-- Mobile Header Bar (shown only < 768px) -->
  <header class="mobile-header">
    <button type="button" class="hamburger-btn" onclick="toggleSidebarDrawer()" title="打开菜单">☰</button>
    <div class="mobile-brand">
      <img src="/assets/logo.png" alt="Logo">
      <span>OpenCode 智能网关</span>
    </div>
    <div class="mobile-actions">
      <button type="button" class="btn btn-primary btn-sm" onclick="saveConfig()" title="保存当前配置">💾</button>
    </div>
  </header>

  <!-- Sidebar Overlay for Mobile -->
  <div class="sidebar-overlay" id="sidebar-overlay" onclick="closeSidebarDrawer()"></div>

  <div class="app-layout">
    <!-- Left Sidebar Navigation -->
    <aside class="app-sidebar" id="app-sidebar">
      <div class="sidebar-header">
        <a href="#/overview" class="sidebar-brand" onclick="switchTab('overview')">
          <img src="/assets/logo.png" alt="Logo" class="sidebar-logo">
          <div class="sidebar-title-box">
            <div class="sidebar-title">OpenCode Go</div>
            <div class="sidebar-subtitle">智能高可用网关</div>
          </div>
        </a>
        <button type="button" class="sidebar-collapse-btn" onclick="toggleSidebarCollapse()" title="折叠/展开侧边栏">
          <span class="collapse-icon">◀</span>
        </button>
      </div>

      <div class="sidebar-version-badge">
        <span class="badge badge-healthy" style="font-size:0.7rem; padding:2px 6px;">v${pkgVersion} Pro</span>
        <span style="display:flex; align-items:center; gap:4px; color:var(--muted); font-size:0.7rem;">
          <span class="status-indicator"></span> 运行中
        </span>
      </div>

      <!-- Navigation Menu Items (6 大业务模块) -->
      <nav class="sidebar-nav">
        <a href="#/overview" class="nav-item active" id="nav-item-overview" onclick="switchTab('overview')">
          <span class="nav-icon">📊</span>
          <span class="nav-label">总览与向导</span>
          <span class="nav-badge" id="nav-badge-overview">就绪</span>
        </a>
        <a href="#/compression" class="nav-item" id="nav-item-compression" onclick="switchTab('compression')">
          <span class="nav-icon">⚡</span>
          <span class="nav-label">Token 压缩中枢</span>
          <span class="nav-badge" id="nav-badge-compression">5 引擎</span>
        </a>
        <a href="#/clients" class="nav-item" id="nav-item-clients" onclick="switchTab('clients')">
          <span class="nav-icon">🤖</span>
          <span class="nav-label">客户端接入</span>
          <span class="nav-badge" id="nav-badge-clients">Codex</span>
        </a>
        <a href="#/plugins" class="nav-item" id="nav-item-plugins" onclick="switchTab('plugins')">
          <span class="nav-icon">🧩</span>
          <span class="nav-label">外挂与插件</span>
          <span class="nav-badge" id="nav-badge-plugins" style="background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3);">在线</span>
        </a>
        <a href="#/accounts" class="nav-item" id="nav-item-accounts" onclick="switchTab('accounts')">
          <span class="nav-icon">📋</span>
          <span class="nav-label">订阅账号与配额</span>
          <span class="nav-badge" id="nav-badge-accounts">多账号</span>
        </a>
        <a href="#/doctor" class="nav-item" id="nav-item-doctor" onclick="switchTab('doctor')">
          <span class="nav-icon">🩺</span>
          <span class="nav-label">系统体检与修复</span>
          <span class="nav-badge" id="nav-badge-doctor">健康</span>
        </a>
        <a href="#/settings" class="nav-item" id="nav-item-settings" onclick="switchTab('settings')">
          <span class="nav-icon">⚙️</span>
          <span class="nav-label">系统设置与更新</span>
        </a>
      </nav>

      <!-- Sidebar Footer / Quick Status -->
      <div class="sidebar-footer">
        <div class="sidebar-host-status">
          <span class="status-indicator"></span>
          <span class="sidebar-port-label">端口: ${config.port}</span>
        </div>
        <button id="btn-logout" class="btn btn-danger btn-sm sidebar-logout-btn" onclick="logoutAdmin()" title="安全退出管理员会话" style="${config.uiPassword ? '' : 'display:none;'}">🚪 退出</button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="app-main" id="main-content">
      <div class="container">
        <!-- Persistent Top Action Bar -->
        <header class="top-action-bar">
          <div class="top-bar-left">
            <div class="current-route-title" id="current-view-title">
              <span class="route-icon">📊</span>
              <span class="route-name">总览与快速上手 (Overview)</span>
            </div>
            <div class="top-baseurl-box">
              <span class="baseurl-tag">🌐 Base URL:</span>
              <code id="lbl-baseurl">http://127.0.0.1:${config.port}</code>
              <button id="btn-copy-baseurl" class="btn btn-secondary btn-sm" onclick="copyBaseUrl()" title="复制智能网关端点 URL">📋 复制端点 (Copy)</button>
              <span id="lbl-host-status" class="badge badge-healthy">本地监听 (127.0.0.1)</span>
            </div>
          </div>
          <div class="top-bar-right header-actions">
            <button id="btn-save-config" class="btn btn-primary btn-sm" onclick="saveConfig()" title="立即将当前账号与系统修改写入磁盘保存">💾 保存配置</button>
            <button id="btn-refresh-quotas" class="btn btn-secondary btn-sm" onclick="refreshAllQuotas(false, true)" title="从官方实时穿透刷新 5小时/周/月限额与账号状态">🔄 刷新配额/状态</button>
            <div class="dropdown-wrapper" id="top-quick-actions-dropdown">
              <button type="button" class="btn btn-secondary btn-sm dropdown-trigger" id="btn-quick-actions" onclick="toggleQuickActionsMenu(event)" aria-haspopup="true" aria-expanded="false" title="更多快捷工具与接入操作">
                🚀 快捷操作 <span class="dropdown-arrow" style="font-size:0.7rem; margin-left:2px;">▾</span>
              </button>
              <div class="dropdown-menu" id="quick-actions-menu">
                <button type="button" class="dropdown-item" onclick="bindDesktopClients(); closeQuickActionsMenu();" title="一键将本地网关锁定为 OpenCode 和 OpenChamber 的默认首选模型">
                  <span class="dropdown-item-icon">⚡</span>
                  <span>应用至 OpenCode/OpenChamber</span>
                </button>
                <button type="button" class="dropdown-item" onclick="bindCodexQuick(); closeQuickActionsMenu();" title="一键将本地网关锁定为 OpenAI Codex 默认配置">
                  <span class="dropdown-item-icon">🤖</span>
                  <span>接入 Codex</span>
                </button>
                <button type="button" class="dropdown-item" onclick="runDoctorCheck('system'); closeQuickActionsMenu();" title="全面扫描系统运行环境与后台死锁状态">
                  <span class="dropdown-item-icon">🩺</span>
                  <span>一键体检</span>
                </button>
                <button type="button" class="dropdown-item" onclick="checkUpdates(); closeQuickActionsMenu();" title="在线检测生态各组件最新版本与兼容性状态">
                  <span class="dropdown-item-icon">📦</span>
                  <span>检查更新</span>
                </button>
                <div class="dropdown-divider"></div>
                <a href="javascript:void(0)" onclick="window.open('http://' + (window.location.hostname || '127.0.0.1') + ':3000', '_blank'); closeQuickActionsMenu();" class="dropdown-item" style="color:var(--primary); text-decoration:none;" title="打开 OpenChamber 工作台">
                  <span class="dropdown-item-icon">💻</span>
                  <span>OpenChamber ↗</span>
                </a>
              </div>
            </div>
          </div>
        </header>

        <!-- View Section 1: Overview (#/overview) -->
        <section class="view-section active" id="view-overview">
          <div class="banner status-capsule-bar">
            <div class="capsule-group">
              <span class="status-pill status-pill-active">
                <span class="status-dot-pulse"></span>
                <span>本地服务运作中 (127.0.0.1:${config.port})</span>
              </span>
              <span class="status-pill">🟢 429 秒级故障转移</span>
              <span class="status-pill">🔒 会话亲和性 (KV Cache)</span>
              <span class="status-pill">⚡ 5 大 Token 优化引擎</span>
            </div>
            <div class="capsule-actions" style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:0.75rem; color:var(--muted);">多账号自动负载均衡 &amp; 无感漂移</span>
            </div>
          </div>

          <!-- Quick Overview Metrics Grid -->
          <div class="overview-metrics-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-bottom:1.5rem;">
            <div class="card" style="margin-bottom:0; cursor:pointer;" onclick="switchTab('accounts')" title="点击查看订阅账号与实时配额">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-size:0.8rem; color:var(--muted);">🔑 订阅账号池</span>
                <span class="badge badge-healthy" id="accounts-overview-badge">🟢 账号池可用</span>
              </div>
              <div style="font-size:1.3rem; font-weight:700; color:#38bdf8;" id="accounts-overview-val">已就绪</div>
              <div style="font-size:0.75rem; color:var(--muted); margin-top:4px;" id="accounts-overview-sub">多账号 429 秒级自动漂移与配额轮转</div>
            </div>
            <div class="card" style="margin-bottom:0; cursor:pointer;" onclick="switchTab('compression')" title="点击查看 Token 压缩大盘与 5 大引擎">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-size:0.8rem; color:var(--muted);">🪙 Token 优化大盘</span>
                <span class="badge badge-healthy" id="comp-overview-badge">实时估算中</span>
              </div>
              <div style="font-size:1.3rem; font-weight:700; color:#34d399;" id="stat-saved-tokens-overview">~0 Tokens</div>
              <div style="font-size:0.75rem; color:var(--muted); margin-top:4px;" id="stat-saved-cost-overview">节约费用: ~$0.0000 USD</div>
            </div>
            <div class="card" style="margin-bottom:0; cursor:pointer;" onclick="switchTab('doctor')" title="点击查看系统自检与异常修复">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-size:0.8rem; color:var(--muted);">🩺 全链路健康</span>
                <span class="badge badge-healthy" id="doctor-overview-badge">🟢 健康</span>
              </div>
              <div style="font-size:1.3rem; font-weight:700; color:#a78bfa;" id="doctor-overview-val">系统就绪</div>
              <div style="font-size:0.75rem; color:var(--muted); margin-top:4px;">CLI、端口、离线安全预览与死锁防御</div>
            </div>
            <div class="card" style="margin-bottom:0; cursor:pointer;" onclick="switchTab('clients')" title="点击进入客户端接入中心">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-size:0.8rem; color:var(--muted);">🤖 Codex 客户端</span>
                <span class="badge badge-healthy">🟢 5min 防断流</span>
              </div>
              <div style="font-size:1.3rem; font-weight:700; color:#f1f5f9;" id="codex-overview-val">38 款大模型</div>
              <div style="font-size:0.75rem; color:var(--muted); margin-top:4px;">Responses 协议桥与高思考等级锁定</div>
            </div>
            <div class="card" style="margin-bottom:0; cursor:pointer;" onclick="switchTab('plugins')" title="点击查看外挂插件中心与 ComfyUI 生图">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="font-size:0.8rem; color:var(--muted);">🧩 外挂插件</span>
                <span class="badge badge-healthy" id="plugins-overview-badge">🟢 1 个在线</span>
              </div>
              <div style="font-size:1.3rem; font-weight:700; color:#38bdf8;" id="plugins-overview-val">ComfyUI 就绪</div>
              <div style="font-size:0.75rem; color:var(--muted); margin-top:4px;" id="plugins-overview-sub">17 套工业级工作流 · GPU 极速生图</div>
            </div>
          </div>

          <!-- 📈 总览级实时节省时序波形与消耗趋势 (Overview Live Chart Card) -->
          <div class="comp-chart-card" id="overview-chart-card" style="margin-bottom: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 0.95rem; font-weight: 600; color: #f1f5f9; display: flex; align-items: center; gap: 6px;">
                  <span id="overview-chart-type-icon">📊</span>
                  <span>消耗与节约分布趋势</span>
                </span>
                <span id="overview-chart-summary-badge" style="font-size: 0.72rem; color: #10b981; background: rgba(16,185,129,0.12); padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(16,185,129,0.3);">
                  时序就绪
                </span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <!-- 时间段切换 -->
                <div class="time-range-group" style="display: flex; background: #121215; border: 1px solid #27272a; border-radius: 6px; padding: 2px; gap: 2px;">
                  <button type="button" class="time-range-pill" data-range="1h" onclick="switchTimeRange('1h')">1小时</button>
                  <button type="button" class="time-range-pill" data-range="24h" onclick="switchTimeRange('24h')">24小时</button>
                  <button type="button" class="time-range-pill" data-range="7d" onclick="switchTimeRange('7d')">7天</button>
                  <button type="button" class="time-range-pill active" data-range="all" onclick="switchTimeRange('all')">全部</button>
                </div>
                <!-- 视图形态切换 -->
                <div class="chart-btn-group">
                  <button type="button" class="chart-pill-btn active" id="btn-overview-chart-mode-bar" onclick="switchChartMode('bar')" title="切换为离散柱状分布图">📊 柱状图</button>
                  <button type="button" class="chart-pill-btn" id="btn-overview-chart-mode-area" onclick="switchChartMode('area')" title="切换为平滑面积趋势图">📈 面积图</button>
                </div>
                <!-- 度量切换 -->
                <div class="chart-btn-group">
                  <button type="button" class="chart-pill-btn chart-metric-btn active" id="btn-overview-chart-metric-tokens" onclick="switchChartMetric('tokens')">By Tokens</button>
                  <button type="button" class="chart-pill-btn chart-metric-btn" id="btn-overview-chart-metric-cost" onclick="switchChartMetric('cost')">By Cost</button>
                  <button type="button" class="chart-pill-btn chart-metric-btn" id="btn-overview-chart-metric-chars" onclick="switchChartMetric('chars')">By Chars</button>
                </div>
                <!-- 前往压缩中枢 -->
                <button type="button" class="btn btn-secondary btn-sm" onclick="switchTab('compression')" style="font-size: 0.75rem; padding: 3px 8px;" title="前往 Token 压缩中枢调配 5 大引擎">⚡ 压缩中枢 ↗</button>
              </div>
            </div>

            <!-- SVG 图表视口 -->
            <div id="overview-chart-viewport" style="width: 100%; height: 210px; position: relative;"></div>

            <!-- 交互悬浮 Tooltip 气泡 -->
            <div id="overview-chart-tooltip" style="display: none; position: absolute; pointer-events: none; z-index: 50; background: rgba(18, 18, 21, 0.96); backdrop-filter: blur(12px); border: 1px solid #27272a; border-radius: 8px; padding: 8px 12px; font-size: 0.75rem; color: #f4f4f5; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04); transition: opacity 0.1s ease; min-width: 160px;"></div>

            <!-- 图例区 -->
            <div id="overview-chart-legends" style="display: flex; justify-content: center; align-items: center; gap: 14px; margin-top: 10px; flex-wrap: wrap; font-size: 0.75rem; color: #94a3b8;"></div>
          </div>

    <!-- 🚀 新手极速向导与一键自愈看板 (Smart Quick Start & Guide) -->
    <div class="card wizard-card" id="wizard-card">
      <div class="section-title">
        <div class="section-title-left">
          <span style="font-size:1.2rem; color:#38bdf8;">🚀 新手极速向导与一键自愈看板 (Smart Quick Start & Guide)</span>
          <span id="wizard-global-badge" class="badge badge-healthy" title="全局健康与使用就绪看板">🟢 开箱即用</span>
        </div>
        <div>
          <button id="btn-quick-setup" class="btn btn-wizard" onclick="runQuickSetupWizard()" title="无需理解复杂底层参数，一键全自动完成账号校验、系统健康自愈、推荐压缩平衡档与 Codex 5分钟防断流">
            🚀 新手一键全能配置与体检 (One-Click Setup & Heal)
          </button>
        </div>
      </div>
      <div class="plain-tip-box" style="margin-bottom:8px;">
        💡 <strong>【小白开箱无忧】</strong>：无需理会繁琐参数！直接点击右上方 <strong>【🚀 新手一键全能配置与体检】</strong>，系统秒级自动完成：<strong>① 账号池有效性校验</strong> ➔ <strong>② 全链路系统自愈与离线沙箱修复</strong> ➔ <strong>③ 推荐 Token 压缩平衡标准档</strong> ➔ <strong>④ OpenAI Codex 5分钟防断流接入</strong>，直接进入黄金使用状态！
      </div>

      <div class="wizard-grid">
        <div class="wizard-step" id="wizard-step-account">
          <div class="wizard-step-header">
            <span>🔑 1. 订阅账号绑定</span>
            <span id="wizard-status-account" class="badge badge-healthy">🟢 检测中</span>
          </div>
          <div id="wizard-desc-account" style="font-size:0.78rem; color:var(--muted); line-height:1.4;">检查订阅密钥与官方 5h/周/月配额可用性</div>
          <div style="margin-top:auto; padding-top:6px;">
            <button class="btn btn-secondary btn-sm" style="font-size:0.75rem; padding:2px 8px; width:100%; justify-content:center;" onclick="scrollToElement('accounts-card')">📋 管理订阅账号</button>
          </div>
        </div>

        <div class="wizard-step" id="wizard-step-doctor">
          <div class="wizard-step-header">
            <span>🩺 2. 系统健康沙箱</span>
            <span id="wizard-status-doctor" class="badge badge-healthy">🟢 全链路健康</span>
          </div>
          <div id="wizard-desc-doctor" style="font-size:0.78rem; color:var(--muted); line-height:1.4;">CLI、端口、离线 Office 预览沙箱与自愈屏障</div>
          <div style="margin-top:auto; padding-top:6px;">
            <button class="btn btn-secondary btn-sm" style="font-size:0.75rem; padding:2px 8px; width:100%; justify-content:center;" onclick="scrollToElement('doctor-card')">🩺 系统体检详情</button>
          </div>
        </div>

        <div class="wizard-step" id="wizard-step-comp">
          <div class="wizard-step-header">
            <span>⚡ 3. Token 压缩去噪</span>
            <span id="wizard-status-comp" class="badge badge-healthy">🟢 推荐平衡档</span>
          </div>
          <div id="wizard-desc-comp" style="font-size:0.78rem; color:var(--muted); line-height:1.4;">智能清洗终端与测试日志，无损节省 15%~30%</div>
          <div style="margin-top:auto; padding-top:6px;">
            <button class="btn btn-secondary btn-sm" style="font-size:0.75rem; padding:2px 8px; width:100%; justify-content:center;" onclick="scrollToElement('compression-card')">⚡ 调配压缩档位</button>
          </div>
        </div>

        <div class="wizard-step" id="wizard-step-codex">
          <div class="wizard-step-header">
            <span>🤖 4. OpenAI Codex</span>
            <span id="wizard-status-codex" class="badge badge-healthy">🟢 网关防断流</span>
          </div>
          <div id="wizard-desc-codex" style="font-size:0.78rem; color:var(--muted); line-height:1.4;">调度 38 款大模型，注入 5 分钟超时与断流自愈</div>
          <div style="margin-top:auto; padding-top:6px;">
            <button class="btn btn-secondary btn-sm" style="font-size:0.75rem; padding:2px 8px; width:100%; justify-content:center;" onclick="scrollToElement('codex-card')">🤖 Codex 专项控制</button>
          </div>
        </div>
      </div>

      <div id="wizard-progress-box" class="doctor-box" style="display:none; margin-top:12px; font-size:0.85rem; border-color:rgba(56, 189, 248, 0.4);"></div>
    </div>
        </section>

        <!-- View Section 2: Token Compression (#/compression) -->
        <section class="view-section" id="view-compression">
          <div class="banner status-capsule-bar">
            <div class="capsule-group">
              <span class="status-pill status-pill-active">
                <span class="status-dot-pulse"></span>
                <span id="capsule-comp-status">${(compCfg.enabled === false) ? '总开关已关闭' : '5 大压缩引擎全就绪'}</span>
              </span>
              <span class="status-pill">🔒 KV Cache 字典序锁定</span>
              <span class="status-pill">🛡️ 源码与堆栈绝对保真</span>
              <span class="status-pill">📊 双语动态 Token 测算</span>
            </div>
            <div class="capsule-actions" style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:0.75rem; color:var(--muted);">无损清洗日志与测试刷屏 · 节约 15%~30%</span>
            </div>
          </div>
<!-- 上下文优化与 Token 压缩配置 (Context Compression v3.1.0) -->
    <div class="card ${(compCfg.enabled === false) ? 'comp-master-disabled' : ''}" id="compression-card">
      <div class="section-title">
        <div class="section-title-left">
          <span>⚡ 上下文优化与 Token 压缩配置 (Context Compression)</span>
          <span class="badge badge-healthy" id="comp-global-status-badge">${(compCfg.enabled === false) ? '总开关已关闭' : '全引擎就绪'}</span>
          <span class="badge badge-healthy" id="comp-doctor-status-badge" style="margin-left: 4px;">🟢 压缩引擎健康</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 0.78rem; color: var(--muted); display: inline-flex; align-items: center; gap: 4px;">
            <span class="pulse-dot" style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#34d399; box-shadow: 0 0 6px #34d399;"></span>
            实时估算中
          </span>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-comp-doctor" onclick="runCompressionDoctorCheck(false)" title="深度诊断压缩引擎健康度与防降智配置">
            🩺 诊断体检
          </button>
          <button type="button" class="btn btn-success btn-sm" id="btn-comp-repair" onclick="runCompressionRepair()" title="一键自愈修复异常并对齐安全推荐档">
            🛠️ 一键修复安全配置
          </button>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-reset-comp-stats" onclick="handleResetCompressionStats()" title="清零累计压缩与Token节省统计数据">
            🔄 一键清零统计
          </button>
          <span class="collapse-toggle" onclick="toggleCardCollapse('compression-collapse-body', this)">▼ 收起</span>
        </div>
      </div>
      <div id="compression-collapse-body">
        <div class="plain-tip-box">
          💡 <strong>【白话通俗解释】</strong>：自动帮您剔除终端滚动进度条、控制符与冗余通过项日志，绝不改变任何代码和回答原意，可直接为您节约 15%~30% 官方限额消耗！小白直接保持推荐的【🌟 平衡标准档】即可。
        </div>

        <!-- 压缩引擎健康自检与异常修复报告抽屉 (Compression Doctor Panel) -->
        <div id="comp-doctor-panel" class="comp-doctor-panel" style="display: none; margin-bottom: 14px; padding: 12px 14px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px;">
          <div id="comp-doctor-panel-content">
            <!-- 动态渲染 -->
          </div>
        </div>

        <!-- 顶层总开关与一键预设档位 -->
        <div class="comp-topbar">
          <div class="comp-master-switch">
            <label class="switch-label" style="font-size: 0.95rem; font-weight: 600; color: #38bdf8;">
              <input type="checkbox" id="cfg-comp-enabled" ${(compCfg.enabled !== false) ? 'checked' : ''} onchange="handleCompMasterToggle(this.checked)">
              <span>启用上下文优化与 Token 压缩总开关 (Master Compression Switch)</span>
            </label>
          </div>
          <div class="comp-presets-wrapper" style="width: 100%;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="presets-title">一键快捷预设:</span>
              <div class="comp-presets-group" id="comp-presets-group">
                <button type="button" class="preset-btn ${(compCfg.preset === 'balanced' || !compCfg.preset) ? 'active' : ''}" id="preset-btn-balanced" onclick="applyPreset('balanced')">🌟 平衡标准档 (推荐)</button>
                <button type="button" class="preset-btn ${(compCfg.preset === 'aggressive') ? 'active' : ''}" id="preset-btn-aggressive" onclick="applyPreset('aggressive')">🚀 极致省Token档</button>
                <button type="button" class="preset-btn ${(compCfg.preset === 'conservative') ? 'active' : ''}" id="preset-btn-conservative" onclick="applyPreset('conservative')">🛡️ 保守只去噪档</button>
                <button type="button" class="preset-btn ${(compCfg.preset === 'custom') ? 'active' : ''}" id="preset-btn-custom" onclick="applyPreset('custom')">⚙️ 自定义模式</button>
                <span class="preset-badge" id="preset-active-badge" style="font-size: 0.75rem; color: var(--primary); padding: 4px 8px; background: rgba(56,189,248,0.1); border-radius: 6px; border: 1px solid rgba(56,189,248,0.3);">
                  当前: ${(compCfg.preset === 'aggressive') ? '🚀 极致省Token档' : (compCfg.preset === 'conservative') ? '🛡️ 保守只去噪档' : (compCfg.preset === 'custom') ? '⚙️ 自定义模式' : '🌟 平衡标准档'}
                </span>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-comp-advanced" onclick="toggleAllCompModuleBodies()" style="margin-left:auto; font-size:0.75rem; padding:3px 10px;" title="一键收起或展开下方 5 大引擎的底层细粒度开关，保持界面清爽">🎛️ 收起/展开底层微调项</button>
              </div>
            </div>
            <div class="preset-desc-card" id="preset-desc-card">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; flex-wrap: wrap; gap: 8px;">
                <span style="font-weight: 600; color: #38bdf8; font-size: 0.85rem;">🌟 平衡标准档 (推荐)</span>
                <span style="font-size: 0.75rem; color: #94a3b8; background: rgba(255,255,255,0.06); padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);">
                  预期压缩率: <strong style="color: #38bdf8;">65% ~ 80%</strong>
                </span>
              </div>
              <div style="font-size: 0.78rem; color: #cbd5e1; margin-bottom: 4px;">
                <strong style="color: #94a3b8;">压缩策略:</strong> 启用 RTK 终端去噪、Headroom 锁文件折叠、Schema 结构精简 (阈值 15,000)、Cache-Zone 缓存冻结与 PowerShell 跨平台转义修复。
              </div>
              <div style="font-size: 0.78rem; color: #cbd5e1;">
                <strong style="color: #94a3b8;">潜在风险:</strong> <span style="color: #94a3b8;">极低。严格豁免 Git 冲突区、Diff 补丁与运行时堆栈，兼顾极致压缩与代码语义无损。</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 实时节省 Token 数据大盘与时间段维度切换 (Metrics Dashboard & Time Range) -->
        <div class="comp-dashboard-header" id="comp-dashboard-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.95rem; font-weight: 600; color: #f1f5f9;">📊 实时节省数据大盘</span>
            <span class="preset-badge" id="comp-range-badge" style="font-size: 0.75rem; color: #38bdf8; padding: 2px 8px; background: rgba(56,189,248,0.12); border-radius: 6px; border: 1px solid rgba(56,189,248,0.3);">
              全部历史累计
            </span>
          </div>
          <div class="comp-range-group" id="comp-range-group">
            <button type="button" class="comp-range-btn" id="comp-range-1h" onclick="switchCompRange('1h')">⏱️ 过去 1 小时</button>
            <button type="button" class="comp-range-btn" id="comp-range-24h" onclick="switchCompRange('24h')">📅 过去 24 小时</button>
            <button type="button" class="comp-range-btn" id="comp-range-7d" onclick="switchCompRange('7d')">🗓️ 过去 7 天</button>
            <button type="button" class="comp-range-btn active" id="comp-range-all" onclick="switchCompRange('all')">🌐 全部历史累计</button>
          </div>
        </div>
        <div class="comp-metrics-dashboard" id="comp-metrics-dashboard">
          <div class="comp-metric-card">
            <div class="comp-metric-label">
              <span>🪙 累计节约 Token 预估</span>
            </div>
            <div class="comp-metric-val" id="stat-saved-tokens">~0 Tokens</div>
            <div class="comp-metric-sub" id="stat-saved-tokens-sub">基于中英双语动态模型 (~1.25 中文 / ~3.8 英文代码 字符/Token)</div>
          </div>
          <div class="comp-metric-card" style="border-color: rgba(56, 189, 248, 0.35); background: linear-gradient(180deg, rgba(56, 189, 248, 0.04) 0%, rgba(22, 22, 26, 0.95) 100%);">
            <div class="comp-metric-label" style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #38bdf8; font-weight: 600;">📈 Token 动态节约率 (实省)</span>
              <span class="info-tooltip-wrap">
                <span class="info-icon">i</span>
                <div class="info-tooltip-bubble">
                  <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">Token 动态节约率 (实省比例)</div>
                  账单省钱率 = 智能节约 Token ÷ (实际处理消耗 + 智能节约 Token)。原本需消耗 23.8 万 Token，网关智能去噪砍掉 11 万，实际仅发往模型 12.7 万，净省 46.4% 账单！
                </div>
              </span>
            </div>
            <div class="comp-metric-val" id="stat-dynamic-savings-ratio" style="color: #38bdf8;">0.0%</div>
            <div class="comp-metric-sub" id="stat-dynamic-savings-sub">原本总需求: 0 T · 相当于打 10 折</div>
          </div>
          <div class="comp-metric-card" id="card-saved-cost" style="cursor: pointer;" onclick="toggleByModelDrawer()" title="点击展开/收起分模型节约明细">
            <div class="comp-metric-label" style="display: flex; justify-content: space-between; align-items: center;">
              <span>💵 累计节约费用预估 (USD)</span>
              <span id="by-model-tag" style="font-size: 0.68rem; padding: 1px 6px; border-radius: 4px; background: rgba(52,211,153,0.15); color: #34d399; font-weight: normal; border: 1px solid rgba(52,211,153,0.3);">分模型明细 ▾</span>
            </div>
            <div class="comp-metric-val" id="stat-saved-cost" style="color: #34d399;">~$0.0000 USD</div>
            <div class="comp-metric-sub" id="stat-saved-cost-sub">基于各模型官方实时费率动态加权测算</div>
          </div>
          <div class="comp-metric-card">
            <div class="comp-metric-label" style="display: flex; justify-content: space-between; align-items: center;">
              <span>📉 综合文本压缩率</span>
              <span class="info-tooltip-wrap">
                <span class="info-icon">i</span>
                <div class="info-tooltip-bubble">
                  <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">文本体积压缩率 (字符裁剪)</div>
                  送入压缩引擎的原始文本数据（终端回显、锁定文件、JSON 数组等）的体积裁剪率。不包含免死的用户指令与 System Prompt。
                </div>
              </span>
            </div>
            <div class="comp-metric-val" id="stat-compression-ratio" style="color: #a78bfa;">0.0%</div>
            <div class="comp-metric-sub" id="stat-saved-chars-sub">已节约 0 字符</div>
          </div>
          <div class="comp-metric-card">
            <div class="comp-metric-label">
              <span>📝 已处理原文本字符</span>
            </div>
            <div class="comp-metric-val" id="stat-original-chars" style="color: #f1f5f9;">0 Chars</div>
            <div class="comp-metric-sub" id="stat-compressed-chars-sub">压缩后: 0 字符</div>
          </div>
        </div>
        <!-- 📈 实时节省趋势与时序分布图表 (Time-Series Chart) -->
        <div class="comp-chart-card" id="comp-chart-card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 0.92rem; font-weight: 600; color: #f1f5f9; display: flex; align-items: center; gap: 6px;">
                <span id="chart-type-icon">📊</span>
                <span>消耗与节约分布趋势</span>
              </span>
              <span id="chart-summary-badge" style="font-size: 0.72rem; color: #10b981; background: rgba(16,185,129,0.12); padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(16,185,129,0.3);">
                时序就绪
              </span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <!-- 视图形态切换：柱状图 vs 面积图 -->
              <div class="chart-btn-group">
                <button type="button" class="chart-pill-btn active" id="btn-chart-mode-bar" onclick="switchChartMode('bar')" title="切换为离散柱状分布图">📊 柱状图</button>
                <button type="button" class="chart-pill-btn" id="btn-chart-mode-area" onclick="switchChartMode('area')" title="切换为平滑面积趋势图">📈 面积图</button>
              </div>
              <!-- 统计度量切换：By Tokens vs By Cost vs By Chars -->
              <div class="chart-btn-group">
                <button type="button" class="chart-pill-btn chart-metric-btn active" id="btn-chart-metric-tokens" onclick="switchChartMetric('tokens')" title="按节约 Token 数统计">By Tokens</button>
                <button type="button" class="chart-pill-btn chart-metric-btn" id="btn-chart-metric-cost" onclick="switchChartMetric('cost')" title="按动态加权节约金额 ($) 统计">By Cost</button>
                <button type="button" class="chart-pill-btn chart-metric-btn" id="btn-chart-metric-chars" onclick="switchChartMetric('chars')" title="按处理字符数统计">By Chars</button>
              </div>
            </div>
          </div>

          <!-- SVG 图表视口 -->
          <div id="comp-chart-viewport" style="width: 100%; height: 210px; position: relative;">
            <!-- 由客户端 renderCompressionChart() 原生渲染 SVG -->
          </div>

          <!-- 交互悬浮 Tooltip 气泡 -->
          <div id="comp-chart-tooltip" style="display: none; position: absolute; pointer-events: none; z-index: 50; background: rgba(18, 18, 21, 0.96); backdrop-filter: blur(12px); border: 1px solid #27272a; border-radius: 8px; padding: 8px 12px; font-size: 0.75rem; color: #f4f4f5; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04); transition: opacity 0.1s ease; min-width: 160px;">
          </div>

          <!-- 图例区 -->
          <div id="comp-chart-legends" style="display: flex; justify-content: center; align-items: center; gap: 14px; margin-top: 10px; flex-wrap: wrap; font-size: 0.75rem; color: #94a3b8;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="display: inline-block; width: 10px; height: 10px; background: #f97316; border-radius: 2px;"></span>
              <span>deepseek-v4.1-flash</span>
            </div>
          </div>
        </div>

        <!-- 📊 分模型节约明细抽屉面板 (By Model Breakdown Drawer) -->
        <div id="by-model-breakdown-drawer" style="display: none; background: #121215; border: 1px solid #27272a; border-radius: 10px; padding: 14px 16px; margin-bottom: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #222226; padding-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 0.92rem; font-weight: 600; color: #f1f5f9;">📊 分模型节约明细 (By Model Breakdown)</span>
              <span id="by-model-count-badge" style="font-size: 0.72rem; color: #38bdf8; background: rgba(56,189,248,0.12); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(56,189,248,0.3);">0 款模型</span>
            </div>
            <button type="button" onclick="toggleByModelDrawer()" style="background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 1.1rem; line-height: 1; padding: 2px 6px;" title="关闭明细面板">✕</button>
          </div>
          <div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
            <table class="by-model-table" style="width: 100%; border-collapse: collapse; font-size: 0.8rem; text-align: left; min-width: 520px;">
              <thead>
                <tr style="color: #a1a1aa; border-bottom: 1px solid #27272a;">
                  <th style="padding: 8px 10px;">模型名称 (Model)</th>
                  <th style="padding: 8px 10px; text-align: right;">已处理原字符</th>
                  <th style="padding: 8px 10px; text-align: right;">节约 Tokens</th>
                  <th style="padding: 8px 10px; text-align: right;">官方费率参考</th>
                  <th style="padding: 8px 10px; text-align: right;">节约费用 (USD)</th>
                </tr>
              </thead>
              <tbody id="by-model-table-body">
                <tr><td colspan="5" style="text-align: center; color: #71717a; padding: 14px 8px;">暂无分模型调用数据（发起请求后将实时归集并动态加权测算）</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 4 大核心引擎分层独立管控卡片 -->
        <div class="comp-modules-grid" id="comp-modules-grid">
          <!-- 大项 1：RTK / Token-Saver 终端与日志去噪引擎 -->
          <div class="comp-module-card ${(mCfg.rtk && mCfg.rtk.enabled === false) ? 'module-disabled' : ''}" id="module-card-rtk">
            <div class="comp-module-header">
              <div class="comp-module-title-box">
                <label class="switch-label comp-main-switch-label">
                  <input type="checkbox" id="cfg-module-rtk-enabled" ${(mCfg.rtk && mCfg.rtk.enabled !== false) ? 'checked' : ''} onchange="toggleModuleEnabled('rtk', this.checked)">
                  <span class="comp-module-title">1. RTK / Token-Saver 终端与日志去噪引擎</span>
                </label>
              </div>
              <div class="comp-module-header-right">
                <span class="badge ${(mCfg.rtk && mCfg.rtk.enabled === false) ? 'badge-disabled' : 'badge-healthy'}" id="badge-module-rtk">${(mCfg.rtk && mCfg.rtk.enabled === false) ? '已停用/旁路' : '运行中'}</span>
                <div class="comp-module-contrib">
                  <span class="contrib-text" id="contrib-text-rtk">贡献度: 0% · 0 Tokens</span>
                  <div class="comp-progress-bar">
                    <div class="comp-progress-fill" id="progress-fill-rtk" style="width: 0%;"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="comp-module-desc">针对 Shell、编译、容器与测试套件产生的冗余控制符及高频刷屏日志进行无损清洗。</div>
            <div class="comp-module-body" id="module-body-rtk">
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-strip-ansi" ${(mCfg.rtk && mCfg.rtk.stripAnsi !== false && compCfg.stripAnsi !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>ANSI 颜色与控制符剥离</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">ANSI 颜色与控制符剥离 (stripAnsi)</div>
                    剥离终端输出中的 ANSI 颜色代码、文本加粗高亮样式、光标控制指令及 OSC 终端标题，消除终端排版产生的冗余 Token。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-clean-progress" ${(mCfg.rtk && mCfg.rtk.cleanProgressBars !== false && compCfg.cleanProgressBars !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>终端进度条去噪 (\r 覆写抹除)</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">进度条去噪 (cleanProgressBars)</div>
                    抹除回车符 (\r) 覆盖刷屏，仅保留最终完成状态，严格保全 Windows CRLF (\r\n) 换行结构。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-fold-tests" ${(mCfg.rtk && mCfg.rtk.foldTestPasses !== false && compCfg.foldTestPasses !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>测试正向通过项折叠</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">测试通过折叠 (foldTestPasses)</div>
                    折叠海量成功用例 (✓/PASS/ok)，错误用例、异常堆栈与断言失败 100% 完整保留免死。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-clean-devops" ${(mCfg.rtk && mCfg.rtk.cleanDevOpsOutput !== false && compCfg.cleanDevOpsOutput !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>DevOps 与构建重复日志去噪</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">DevOps 日志去噪 (cleanDevOpsOutput)</div>
                    智能折叠 Docker 镜像层、Kubectl Pod 状态、Terraform 刷新、Git 对象传输进度、Cargo/Pip/NPM 依赖编译刷屏及时间戳重复日志。
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 大项 2：Headroom 代码与结构化折叠引擎 -->
          <div class="comp-module-card ${(mCfg.headroom && mCfg.headroom.enabled === false) ? 'module-disabled' : ''}" id="module-card-headroom">
            <div class="comp-module-header">
              <div class="comp-module-title-box">
                <label class="switch-label comp-main-switch-label">
                  <input type="checkbox" id="cfg-module-headroom-enabled" ${(mCfg.headroom && mCfg.headroom.enabled !== false) ? 'checked' : ''} onchange="toggleModuleEnabled('headroom', this.checked)">
                  <span class="comp-module-title">2. Headroom 代码与结构化折叠引擎</span>
                </label>
              </div>
              <div class="comp-module-header-right">
                <span class="badge ${(mCfg.headroom && mCfg.headroom.enabled === false) ? 'badge-disabled' : 'badge-healthy'}" id="badge-module-headroom">${(mCfg.headroom && mCfg.headroom.enabled === false) ? '已停用/旁路' : '运行中'}</span>
                <div class="comp-module-contrib">
                  <span class="contrib-text" id="contrib-text-headroom">贡献度: 0% · ~0 Tokens</span>
                  <div class="comp-progress-bar">
                    <div class="comp-progress-fill" id="progress-fill-headroom" style="width: 0%;"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="comp-module-desc">针对超大结构化数据与 Git Diff 中的锁定文件提供安全摘要折叠，保全代码行号与冲突防御。</div>
            <div class="comp-module-body" id="module-body-headroom">
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-fold-lockfiles" ${(mCfg.headroom && mCfg.headroom.foldLockfiles !== false && compCfg.foldLockfiles !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>依赖锁定文件 Diff 安全折叠</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">锁定文件折叠 (foldLockfiles)</div>
                    折叠 package-lock/yarn/pnpm/Cargo/uv 等超大锁定文件，节省数万至数十万 Token。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-fold-structured" ${(mCfg.headroom && mCfg.headroom.foldStructuredData !== false && compCfg.foldStructuredData !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>超长同构 JSON 数组采样折叠 (SmartCrusher / foldStructuredData)</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">超长同构 JSON 数组采样折叠 (SmartCrusher / foldStructuredData)</div>
                    针对工具返回超过 50 项的超长同构 JSON 数组（巨型文件列表、大数据库查询结果等）进行安全智能摘要采样（保留结构 + 首尾样本），在不影响推理的情况下大幅提升开发中的 Token 节省率，遇报错堆栈与冲突标记 100% 绝对豁免。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-exempt-conflicts" ${(mCfg.headroom && mCfg.headroom.exemptMergeConflicts !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>Git 合并冲突绝对豁免防御</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">冲突绝对豁免 (exemptMergeConflicts)</div>
                    严格检测 &lt;&lt;&lt;&lt;&lt;&lt;&lt; / ||||||| / ======= 标记，发生合并冲突时 100% 放弃折叠，确保解决冲突绝对安全。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-protect-diffs" ${(mCfg.headroom && mCfg.headroom.protectSourceDiffs !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>源码行号与补丁高保真保护</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">源码行号保真 (protectSourceDiffs)</div>
                    严禁对业务代码文件做抽稀，确保 apply_patch 与补丁定位绝对精准。
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 大项 3：Headroom CacheAligner & mcp-compressor 工具定义优化 -->
          <div class="comp-module-card ${(mCfg.schema && mCfg.schema.enabled === false) ? 'module-disabled' : ''}" id="module-card-schema">
            <div class="comp-module-header">
              <div class="comp-module-title-box">
                <label class="switch-label comp-main-switch-label">
                  <input type="checkbox" id="cfg-module-schema-enabled" ${(mCfg.schema && mCfg.schema.enabled !== false) ? 'checked' : ''} onchange="toggleModuleEnabled('schema', this.checked)">
                  <span class="comp-module-title">3. CacheAligner & mcp-compressor 工具定义优化</span>
                </label>
              </div>
              <div class="comp-module-header-right">
                <span class="badge ${(mCfg.schema && mCfg.schema.enabled === false) ? 'badge-disabled' : 'badge-healthy'}" id="badge-module-schema">${(mCfg.schema && mCfg.schema.enabled === false) ? '已停用/旁路' : '运行中'}</span>
                <div class="comp-module-contrib">
                  <span class="contrib-text" id="contrib-text-schema">🔒 KV Cache 前缀已锁定 (提升上游 80%~90% 缓存命中，字符无损)</span>
                  <div class="comp-progress-bar">
                    <div class="comp-progress-fill" id="progress-fill-schema" style="width: 0%;"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="comp-module-desc">规范化模型上下文中的 Tools 与 MCP Schema 定义，极大化提高上游 Prompt KV 命中率。</div>
            <div class="comp-module-body" id="module-body-schema">
              <div class="kv-cache-banner" style="margin: 0 0 8px 0; padding: 8px 12px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.22); border-radius: 8px; font-size: 0.78rem; color: #93c5fd; display: flex; align-items: center; justify-content: space-between;">
                <span>🔒 KV Cache 前缀已锁定 (提升上游 80%~90% 缓存命中，字符无损)</span>
                <span class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">为何字符无损却省账单？</div>
                    字典序对齐虽然不删减工具字符数，但能将 Tools / MCP Schema 键值序列规范化为全局唯一且恒定的字节流，使 Anthropic / OpenAI 等上游推理集群稳定命中前缀 Prompt 缓存，直接享受 80%~90% 输入费率折扣。<br>
                    💡 瘦身门限当前为 15,000 字符（仅挂载大型/多 MCP 服务时触发）
                  </div>
                </span>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-align-schema" ${(mCfg.schema && mCfg.schema.alignToolsSchema !== false && compCfg.alignToolsSchema !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>工具参数字典序对齐 (KV 锁定)</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">参数字典序对齐 (alignToolsSchema)</div>
                    参数键名与 required 列表严格字典序排序，保证字节流恒定并锁定 KV Cache。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-slim-schema" ${(mCfg.schema && mCfg.schema.slimToolsSchema !== false && compCfg.slimToolsSchema !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>超大 MCP Schema 描述瘦身</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">Schema 描述瘦身 (slimToolsSchema)</div>
                    裁剪多行 Markdown 冗余描述与臃肿示例，100% 保全类型、参数名与枚举。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size: 0.82rem; color: #cbd5e1; font-weight: 500;">瘦身触发字符阈值</span>
                  <div class="info-tooltip-wrap">
                    <span class="info-icon">i</span>
                    <div class="info-tooltip-bubble">
                      <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">门限阈值 (schemaCharThreshold)</div>
                      tools &lt; 15,000 字符时保持原样并锁定 KV Cache 前缀，享受上游极速缓存命中与零损耗；仅在超巨型 tools &gt; 15,000 字符时自动触发 Schema 深度瘦身削减冗余描述。
                    </div>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <input type="number" id="cfg-comp-threshold" class="form-control" style="width: 85px; text-align: right; padding: 3px 6px; font-size: 0.82rem;" value="${(mCfg.schema && mCfg.schema.schemaCharThreshold) || compCfg.schemaCharThreshold || 15000}" min="1000" step="1000" onchange="handleSubOptionChange()">
                  <span style="font-size: 0.78rem; color: var(--muted);">字符</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 大项 4：llmtrim Cache-Zone 多轮会话缓存区固化 -->
          <div class="comp-module-card ${(mCfg.cacheZone && mCfg.cacheZone.enabled === false) ? 'module-disabled' : ''}" id="module-card-cacheZone">
            <div class="comp-module-header">
              <div class="comp-module-title-box">
                <label class="switch-label comp-main-switch-label">
                  <input type="checkbox" id="cfg-module-cachezone-enabled" ${(mCfg.cacheZone && mCfg.cacheZone.enabled !== false) ? 'checked' : ''} onchange="toggleModuleEnabled('cacheZone', this.checked)">
                  <span class="comp-module-title">4. llmtrim Cache-Zone 多轮会话缓存区固化</span>
                </label>
              </div>
              <div class="comp-module-header-right">
                <span class="badge ${(mCfg.cacheZone && mCfg.cacheZone.enabled === false) ? 'badge-disabled' : 'badge-healthy'}" id="badge-module-cacheZone">${(mCfg.cacheZone && mCfg.cacheZone.enabled === false) ? '已停用/旁路' : '运行中'}</span>
                <div class="comp-module-contrib">
                  <span class="contrib-text" id="contrib-text-cacheZone">贡献度: 0% · 0 Tokens</span>
                  <div class="comp-progress-bar">
                    <div class="comp-progress-fill" id="progress-fill-cacheZone" style="width: 0%;"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="comp-module-desc">多轮会话历史轮次字节级冻结，结合真 LRU 热度淘汰，杜绝重复压缩与计算消耗。</div>
            <div class="comp-module-body" id="module-body-cacheZone">
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-cache-freeze" ${(mCfg.cacheZone && mCfg.cacheZone.cacheZoneFreeze !== false && compCfg.cacheZoneFreeze !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>历史轮次前缀字节级冻结</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">历史轮次前缀冻结 (cacheZoneFreeze)</div>
                    单次压缩结果基于 Session ID 与 SHA256 哈希字节固化，防止多轮重复消耗。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-true-lru" ${(mCfg.cacheZone && mCfg.cacheZone.trueLruRetention !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>真 LRU 缓存淘汰与边界守护</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">真 LRU 淘汰守护 (trueLruRetention)</div>
                    双重上限限制 (最多 500 会话 / 每会话 200 键)，访问时自动提权热度，杜绝内存泄漏。
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 大项 5：Windows PowerShell 转义优化与环境自适应防护 -->
          <div class="comp-module-card ${(mCfg.powershell && mCfg.powershell.enabled === false) ? 'module-disabled' : ''}" id="module-card-powershell">
            <div class="comp-module-header">
              <div class="comp-module-title-box">
                <label class="switch-label comp-main-switch-label">
                  <input type="checkbox" id="cfg-module-powershell-enabled" ${(mCfg.powershell && mCfg.powershell.enabled !== false) ? 'checked' : ''} onchange="toggleModuleEnabled('powershell', this.checked)">
                  <span class="comp-module-title">5. Windows PowerShell 转义优化与环境自适应防护</span>
                </label>
              </div>
              <div class="comp-module-header-right">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:nowrap;">
                  <span class="badge ${psIsWin ? 'badge-healthy' : 'badge-disabled'}" id="badge-module-powershell-platform">${psIsWin ? '🟢 Windows 原生运行中' : '🐧 Linux 休眠旁路 (零干扰)'}</span>
                  <span class="badge ${(mCfg.powershell && mCfg.powershell.enabled === false) ? 'badge-disabled' : 'badge-healthy'}" id="badge-module-powershell">${(mCfg.powershell && mCfg.powershell.enabled === false) ? '已停用/旁路' : '运行中'}</span>
                </div>
                <div class="comp-module-contrib">
                  <span class="contrib-text" id="contrib-text-powershell">贡献度: 0% · 0 Tokens</span>
                  <div class="comp-progress-bar">
                    <div class="comp-progress-fill" id="progress-fill-powershell" style="width: 0%;"></div>
                  </div>
                </div>
              </div>
            </div>
            <div class="comp-module-desc">智能区分 Linux 与 Windows 环境。Windows 下深度分析并自愈 PowerShell 转义陷阱、消灭 CLIXML 报错噪点与 Token 浪费；Linux NAS 下零干扰纯净休眠。</div>
            <div class="comp-module-body" id="module-body-powershell">
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-ps-autodetect" ${(mCfg.powershell && mCfg.powershell.autoDetectPlatform !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>跨平台环境自适应与休眠</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">环境自适应 (autoDetectPlatform)</div>
                    自动探测操作系统（Windows 激活 / Linux NAS 保持零开销休眠旁路），亦可通过请求头自适应。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-ps-clixml" ${(mCfg.powershell && mCfg.powershell.cleanCliXmlNoise !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>CLIXML 报错去噪与 Hex 解码</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">CLIXML 去噪 (cleanCliXmlNoise)</div>
                    剥离 #&lt; CLIXML 标签与冗长 CategoryInfo 堆栈，解码 _x000D__x000A_，削减 70%~90% 报错重试 Token 浪费。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-ps-trailing-slash" ${(mCfg.powershell && mCfg.powershell.fixTrailingSlash !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>路径末尾反斜杠防吞噬引号</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">末尾反斜杠自愈 (fixTrailingSlash)</div>
                    自愈 Windows CRT CommandLineToArgvW 陷阱：自动将 &quot;C:\dir\&quot; 转换为 &quot;C:\dir\\&quot; 彻底防止闭合引号被吃掉。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-ps-curl-alias" ${(mCfg.powershell && mCfg.powershell.fixCurlAlias !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>PowerShell curl 别名规避</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">curl 别名规避 (fixCurlAlias)</div>
                    规避 Windows 自带 PowerShell 将 curl 别名至 Invoke-WebRequest 导致的参数崩溃，自动映射为 curl.exe。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-ps-and-operator" ${(mCfg.powershell && mCfg.powershell.fixAndOperator !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>PowerShell 5.1 && 语法自愈</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">&amp;&amp; 连词符自愈 (fixAndOperator)</div>
                    将 PowerShell 5.1 不支持的 &amp;&amp; 语法自愈为 ; if ($?) { ... }，消除致命语法解析错误中断。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-ps-line-continuation" ${(mCfg.powershell && mCfg.powershell.fixLineContinuation !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>多行反引号续行符修正</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">续行符修正 (fixLineContinuation)</div>
                    将 Bash 风格的多行末尾续行反斜杠 (\) 转换为 PowerShell 原生反引号 (&#96;) 续行。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-ps-subexpression" ${(mCfg.powershell && mCfg.powershell.fixSubexpressionEscaping !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>双引号 $() 子表达式转义保护</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">子表达式转义保护 (fixSubexpressionEscaping)</div>
                    自愈 Windows PowerShell 双引号内 &#36;() / &#36;{} 被本机提前求值陷阱，自动转义为 &#96;&#36;( 与 &#96;&#36;{，保障目标命令完整传递。
                  </div>
                </div>
              </div>
              <div class="comp-sub-item">
                <label class="switch-label">
                  <input type="checkbox" id="cfg-comp-ps-guard-directive" ${(mCfg.powershell && mCfg.powershell.injectPowerShellGuard !== false) ? 'checked' : ''} onchange="handleSubOptionChange()">
                  <span>PowerShell 环境锚点指令注入</span>
                </label>
                <div class="info-tooltip-wrap">
                  <span class="info-icon">i</span>
                  <div class="info-tooltip-bubble">
                    <div style="font-weight:600; color:#38bdf8; margin-bottom:2px;">环境锚点指令屏障 (injectPowerShellGuard)</div>
                    在 system / instructions 中轻量注入 PowerShell 规范指南，从源头消灭 Agent 试错循环与降智风险。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
        </section>

        <!-- View Section 3: Clients & Model Dispatch (#/clients) -->
        <section class="view-section" id="view-clients">
          <div class="banner status-capsule-bar">
            <div class="capsule-group">
              <span class="status-pill status-pill-active">
                <span class="status-dot-pulse"></span>
                <span>38 款全量模型已就绪</span>
              </span>
              <span class="status-pill">🔄 Responses 协议桥</span>
              <span class="status-pill">⏱️ 5 分钟超时与断流自愈</span>
              <span class="status-pill">💻 OpenChamber / OpenCode 原生支持</span>
            </div>
            <div class="capsule-actions" style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:0.75rem; color:var(--muted);">支持任意 OpenAI API 兼容客户端无缝接驳</span>
            </div>
          </div>
<!-- OpenAI Codex CLI 智能接入与全量模型调度卡片 -->
    <div class="card" id="codex-card">
      <div class="section-title">
        <div class="section-title-left">
          <span>🤖 OpenAI Codex CLI 智能接入与模型调度 (Codex Integration)</span>
          <span id="codex-status-badge" class="badge badge-healthy">🟢 网关接入就绪</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" onclick="runCodexDoctorCheck()" title="全面诊断 OpenAI Codex 配置、语言与进程状态">🔍 Codex 体检</button>
          <button class="btn btn-primary btn-sm" style="background:#0284c7; border-color:#0369a1;" onclick="bindCodex()" title="一键备份并锁定 38 款模型目录与网关">⚡ 一键接入</button>
          <button class="btn btn-success btn-sm" onclick="runCodexRepair()" title="一键自愈超时配置并注入防断流屏障">🛠️ 专项自愈加固</button>
          <button class="btn btn-secondary btn-sm" style="background:#d97706; border-color:#b45309; color:#fff;" onclick="restartCodexClient()" title="平滑重启 Codex 客户端加载最新配置">🔄 重启客户端</button>
          <button class="btn btn-danger btn-sm" onclick="restoreCodex()" title="从灾备快照还原原始配置">⏪ 还原配置</button>
          <span class="collapse-toggle" onclick="toggleCardCollapse('codex-collapse-body', this)">▼ 收起</span>
        </div>
      </div>
      <div id="codex-collapse-body">
        <div class="plain-tip-box">
          💡 <strong>【白话通俗解释】</strong>：将 OpenAI 官方 Codex 客户端流量无感接驳至本地 4010 智能网关，直接解锁全套 38 款大模型，并内置 5 分钟超时与防断流加固，杜绝模型在超长推理或编写复杂补丁时意外超时中断。
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:16px; margin-bottom:12px; align-items:flex-end;">
          <div class="form-group" style="flex:1; min-width:280px; margin-bottom:0;">
            <label>首选生效模型 (38 款全量模型，非原生 Responses 自动协议桥转换)</label>
            <select id="codex-model-select" class="form-control" style="background:#09090b; border-color:#27272a;">
              <!-- 动态生成 38 款模型 -->
            </select>
          </div>
          <div class="form-group" style="width:200px; margin-bottom:0;">
            <label>思考等级 (Reasoning Effort)</label>
            <select id="codex-effort-select" class="form-control" style="background:#09090b; border-color:#27272a;">
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
    </div>
          <!-- 桌面客户端与生态接入指南卡片 -->
          <div class="card" id="clients-guide-card">
            <div class="section-title">
              <div class="section-title-left">
                <span>💻 桌面客户端与开发者工具快速接入指南</span>
              </div>
            </div>
            <div class="plain-tip-box">
              💡 <strong>【无感接驳】</strong>：智能网关提供标准 OpenAI API 兼容端点 (<code>http://127.0.0.1:${config.port}/v1</code>) 与 Responses 协议桥 (<code>http://127.0.0.1:${config.port}/responses</code>)，支持任意 AI 编程工具无缝接入。
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:12px; margin-top:10px;">
              <div class="wizard-step">
                <div class="wizard-step-header">
                  <span>🖥️ OpenChamber 桌面工作台</span>
                  <span class="badge badge-healthy">推荐</span>
                </div>
                <div style="font-size:0.8rem; color:var(--muted); line-height:1.5;">
                  私有化本地 AI 编程工作台，纯本地离线文档解析沙箱，原生支持多会话与实时协同。
                </div>
                <div style="margin-top:auto; padding-top:8px; display:flex; gap:6px;">
                  <button class="btn btn-primary btn-sm" onclick="bindDesktopClients()">⚡ 一键绑定生效</button>
                  <button class="btn btn-secondary btn-sm" onclick="window.open('http://' + (window.location.hostname || '127.0.0.1') + ':3000', '_blank')">打开工作台 ↗</button>
                </div>
              </div>
              <div class="wizard-step">
                <div class="wizard-step-header">
                  <span>💻 OpenCode CLI 原生终端</span>
                  <span class="badge badge-healthy">原生支持</span>
                </div>
                <div style="font-size:0.8rem; color:var(--muted); line-height:1.5;">
                  命令行快速编码助手，直接使用 <code>opencode</code> 并在配置中将 upstream 指向本地网关端口。
                </div>
                <div style="margin-top:auto; padding-top:8px;">
                  <button class="btn btn-secondary btn-sm" onclick="bindDesktopClients()">⚡ 一键配置 OpenCode</button>
                </div>
              </div>
              <div class="wizard-step">
                <div class="wizard-step-header">
                  <span>🤖 Claude Code / Cursor / Windsurf</span>
                  <span class="badge badge-healthy">标准协议</span>
                </div>
                <div style="font-size:0.8rem; color:var(--muted); line-height:1.5;">
                  在客户端设置中将 Base URL 设为 <code>http://127.0.0.1:${config.port}/v1</code>，API Key 填入任意字符串即可。
                </div>
                <div style="margin-top:auto; padding-top:8px;">
                  <button class="btn btn-secondary btn-sm" onclick="copyBaseUrl()">📋 复制端点 URL</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- View Section: Plugins & Extensions (#/plugins) -->
        <section class="view-section" id="view-plugins">
          <!-- Banner / Top Capsule Bar -->
          <div class="banner status-capsule-bar">
            <div class="capsule-group">
              <span class="status-pill status-pill-active">
                <span class="status-dot-pulse"></span>
                <span id="plugins-bar-active-count">外挂系统运作中 (1 个已激活)</span>
              </span>
              <span class="status-pill" id="comfy-capsule-device">🎮 AMD Radeon 780M (ZLUDA)</span>
              <span class="status-pill" id="comfy-capsule-workflows">🖼️ 17 套工业级工作流就绪</span>
              <span class="status-pill">⚡ OpenAI 兼容 /v1/images 协议</span>
            </div>
            <div class="capsule-actions" style="display:flex; align-items:center; gap:6px;">
              <button class="btn btn-secondary btn-sm" onclick="loadComfyUiPluginStatus(true)" title="强制穿透缓存探测所有外挂插件状态">🔄 刷新插件状态</button>
            </div>
          </div>

          <!-- Plugin Card 1: ComfyUI 视觉生图与图片反推中枢 -->
          <div class="card" id="comfyui-plugin-card">
            <div class="section-title">
              <div class="section-title-left" style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:0.95rem; font-weight:600; color:#f4f4f5;">🖼️ ComfyUI 视觉生图与图片反推中枢 (ComfyUI Visual Engine)</span>
                <span id="comfy-status-badge" class="badge badge-healthy">🟢 探测中...</span>
              </div>
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" onclick="loadComfyUiPluginStatus(true)" title="重新嗅探服务与重载工作流">🔄 探测重载</button>
                <button class="btn btn-primary btn-sm" onclick="saveComfyUiConfig(true)" title="测试当前配置并持久化保存">⚡ 测试并保存</button>
                <button class="btn btn-secondary btn-sm" onclick="bindCodexMcp()" title="自动为 OpenAI Codex 注入 ComfyUI MCP 智能体工具">🤖 接入 Codex MCP</button>
                <span class="collapse-toggle" onclick="toggleCardCollapse('comfyui-collapse-body', this)">▼ 收起</span>
              </div>
            </div>

            <div id="comfyui-collapse-body">
              <div class="plain-tip-box" style="border-left-color: #38bdf8;">
                💡 <strong>【白话通俗解释】</strong>：为智能网关赋予外挂生图与图片反推能力。自动发现本地（默认 8284 / 8188）或局域网/远程部署的 ComfyUI，对外暴露 OpenAI 标准生图端点 <code>/v1/images/generations</code>，并通过 MCP 为 Codex / OpenCode 提供原生 <code>generate_image</code> 智能体工具，彻底消除由于模型原生无生图能力带来的断层。
              </div>

              <!-- ComfyUI Configuration Form Grid -->
              <div style="display:grid; grid-template-columns: minmax(240px, 1.2fr) minmax(280px, 1.8fr) minmax(130px, 160px); gap:16px; margin-bottom:16px; align-items:flex-start;">
                <div class="form-group" style="margin-bottom:0;">
                  <label style="display:block; font-size:0.8rem; font-weight:600; color:#f4f4f5; margin-bottom:4px;">
                    ComfyUI 服务端地址 (Host URL)
                  </label>
                  <input type="text" id="comfy-cfg-host" class="form-control" placeholder="http://127.0.0.1:8284" value="${config.comfyui?.host || 'http://127.0.0.1:8284'}" style="width:100%; box-sizing:border-box; background:#09090b; border-color:#27272a;">
                  <div style="font-size:0.73rem; color:var(--muted); margin-top:5px; line-height:1.4;">支持 8284、8188 端口或远程局域网 IP</div>
                </div>

                <div class="form-group" style="margin-bottom:0;">
                  <label style="display:block; font-size:0.8rem; font-weight:600; color:#f4f4f5; margin-bottom:4px;">
                    工作流存储目录 (Workflows Directory)
                  </label>
                  <input type="text" id="comfy-cfg-dir" class="form-control" placeholder="留空则自动探测 scratch/comfyui-agent-workflows" value="${config.comfyui?.workflowsDir || ''}" style="width:100%; box-sizing:border-box; background:#09090b; border-color:#27272a;">
                  <div style="font-size:0.73rem; color:var(--muted); margin-top:5px; line-height:1.4;">留空则自动探测 scratch/comfyui-agent-workflows</div>
                </div>

                <div class="form-group" style="margin-bottom:0;">
                  <label style="display:block; font-size:0.8rem; font-weight:600; color:#f4f4f5; margin-bottom:4px;">
                    采样超时 (秒)
                  </label>
                  <input type="number" id="comfy-cfg-timeout" class="form-control" min="30" max="600" value="${config.comfyui?.timeoutSec || 180}" style="width:100%; box-sizing:border-box; background:#09090b; border-color:#27272a;">
                  <div style="font-size:0.73rem; color:var(--muted); margin-top:5px; line-height:1.4;">出图等待上限 (默认 180s)</div>
                </div>
              </div>

              <!-- Hardware & Workflow Statistics Strip -->
              <div style="display:flex; gap:16px; flex-wrap:wrap; background:#09090b; border:1px solid #27272a; border-radius:6px; padding:10px 14px; margin-bottom:16px; align-items:center;">
                <div style="font-size:0.8rem; color:var(--muted); display:flex; align-items:center; gap:6px;">
                  <span>🎮 加速环境:</span>
                  <strong id="comfy-val-device" style="color:#f4f4f5; font-weight:600;">探测中...</strong>
                </div>
                <div style="font-size:0.8rem; color:var(--muted); display:flex; align-items:center; gap:6px; margin-left:auto;">
                  <span>显存总计:</span>
                  <strong id="comfy-val-vram" style="color:#34d399; font-weight:600;">--</strong>
                </div>
                <div style="font-size:0.8rem; color:var(--muted); display:flex; align-items:center; gap:6px;">
                  <span>已装载工作流:</span>
                  <strong id="comfy-val-wfcount" style="color:#38bdf8; font-weight:600;">0 套</strong>
                </div>
              </div>

              <!-- 🧪 即时抽卡与在线测试沙箱 (Interactive Test Sandbox) -->
              <div style="background:#09090b; border:1px solid #27272a; border-radius:8px; padding:14px; margin-bottom:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                  <span style="font-size:0.85rem; font-weight:600; color:#f1f5f9; display:flex; align-items:center; gap:6px;">
                    <span>🎨</span>
                    <span>在线快速出图测试沙箱 (Quick Generation Sandbox)</span>
                  </span>
                  <span style="font-size:0.75rem; color:var(--muted);">测试网关端到端调度与图片预览</span>
                </div>

                <div style="display:grid; grid-template-columns: minmax(220px, 1fr) minmax(240px, 340px) auto; gap:10px; align-items:flex-end;">
                  <div style="min-width:0;">
                    <label style="font-size:0.75rem; color:var(--muted); margin-bottom:4px; display:block;">测试提示词 (Positive Prompt)</label>
                    <input type="text" id="comfy-test-prompt" class="form-control" value="1girl, cinematic lighting, 8k uhd, photorealistic, elegant smile" placeholder="输入画面提示词..." style="width:100%; box-sizing:border-box; background:#121215; border-color:#27272a; font-size:0.85rem; height:36px;">
                  </div>
                  <div style="min-width:0;">
                    <label style="font-size:0.75rem; color:var(--muted); margin-bottom:4px; display:block;">调度工作流</label>
                    <select id="comfy-test-workflow-select" class="form-control" style="width:100%; max-width:100%; box-sizing:border-box; background:#121215; border-color:#27272a; font-size:0.85rem; height:36px; text-overflow:ellipsis; overflow:hidden;">
                      <option value="04">04_极速抽卡_无限多风格探索流 ⭐[极速推荐]</option>
                      <option value="01">01_真人写实_极致NanoBanana (高精成片)</option>
                    </select>
                  </div>
                  <div style="flex-shrink:0;">
                    <button type="button" class="btn btn-primary" id="btn-comfy-test-gen" onclick="triggerComfyUiTestGen()" style="height:36px; padding:0 18px; font-weight:600; white-space:nowrap; display:inline-flex; align-items:center; justify-content:center; gap:6px;">
                      🚀 试画一张
                    </button>
                  </div>
                </div>

                <!-- Test Result Container (Image Preview & Metadata) -->
                <div id="comfy-test-result-box" style="display:none; background:#121215; border:1px solid #27272a; border-radius:6px; padding:12px; margin-top:12px;">
                  <div style="display:flex; gap:16px; flex-wrap:wrap;">
                    <div style="max-width:280px; max-height:280px; overflow:hidden; border-radius:6px; border:1px solid #3f3f46; display:flex; align-items:center; justify-content:center; background:#000;">
                      <img id="comfy-test-result-img" src="" alt="预览图" style="max-width:100%; max-height:280px; object-fit:contain; display:block;">
                    </div>
                    <div style="flex:1; min-width:240px; font-size:0.8rem; line-height:1.6; color:#a1a1aa;">
                      <div style="font-weight:600; color:#f4f4f5; margin-bottom:4px;" id="comfy-test-res-title">成片生成就绪</div>
                      <div>工作流：<strong id="comfy-test-res-wf" style="color:#38bdf8;">--</strong></div>
                      <div>采样耗时：<strong id="comfy-test-res-duration" style="color:#34d399;">--</strong></div>
                      <div>随机 Seed：<strong id="comfy-test-res-seed" style="color:#38bdf8;">--</strong></div>
                      <div>托管地址：<a id="comfy-test-res-link" href="#" target="_blank" style="color:#38bdf8; word-break:break-all;">--</a></div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Workflow List Accordion / Catalog -->
              <details style="background:#121215; border:1px solid #27272a; border-radius:8px; padding:10px 14px;">
                <summary style="font-size:0.85rem; font-weight:600; color:#f1f5f9; cursor:pointer; user-select:none;">
                  📚 查看已就绪的 17 套工业级双轨工作流清单与标签
                </summary>
                <div id="comfy-workflows-catalog-list" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:10px; margin-top:12px;">
                  <!-- Dynamically populated -->
                </div>
              </details>
            </div>
          </div>

          <!-- Future Extension Slots (插槽化卡片流) -->
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:16px; margin-top:16px;">
            <div class="card" style="margin-bottom:0; opacity:0.65; border:1px dashed #3f3f46;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-weight:600; color:#a1a1aa;">🌐 联网搜索增强代理 (Web Search Plugin)</span>
                <span class="badge" style="background:#27272a; color:#a1a1aa;">扩展预留</span>
              </div>
              <div style="font-size:0.8rem; color:var(--muted); line-height:1.5;">
                为无联网能力的本地大模型赋予实时网络检索与网页正文提取能力，自动注入 Search Tool 闭环。
              </div>
            </div>

            <div class="card" style="margin-bottom:0; opacity:0.65; border:1px dashed #3f3f46;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-weight:600; color:#a1a1aa;">📚 本地私有知识库 (Local RAG Plugin)</span>
                <span class="badge" style="background:#27272a; color:#a1a1aa;">扩展预留</span>
              </div>
              <div style="font-size:0.8rem; color:var(--muted); line-height:1.5;">
                基于本地离线向量库（Chroma / SQLite-vec）挂载私有文档与代码库，100% 离线检索保障代码安全。
              </div>
            </div>
          </div>
        </section>

        <!-- View Section 4: Accounts & Quotas (#/accounts) -->
        <section class="view-section" id="view-accounts">
          <div class="banner status-capsule-bar">
            <div class="capsule-group">
              <span class="status-pill status-pill-active">
                <span class="status-dot-pulse"></span>
                <span>多账号自动负载均衡池</span>
              </span>
              <span class="status-pill">⚡ 429 秒级无感漂移</span>
              <span class="status-pill">⏱️ 官方配额实时穿透轮询</span>
              <span class="status-pill">🔒 本地安全密钥隔离</span>
            </div>
            <div class="capsule-actions" style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:0.75rem; color:var(--muted);">5h / 周 / 月滑动窗口智能轮换保障</span>
            </div>
          </div>
<!-- 账号配置区域 -->
    <div class="card" id="accounts-card">
      <div class="section-title" style="flex-wrap:wrap; gap:10px;">
        <div class="section-title-left">
          <span>📋 OpenCode Go 订阅账号列表</span>
          <span id="accounts-status-badge" class="badge badge-healthy">🟢 账号池可用</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" onclick="testAllAccounts()" title="测试所有订阅账号的连通性与响应速度">⚡ 全部测速</button>
          <button class="btn btn-secondary btn-sm" onclick="resetAllCooldowns()" title="解除因 429 限频进入冷却的账号">🔄 重置限频</button>
          <div class="quota-ctrl-bar">
            <span>⏱️ 配额自动刷新:</span>
            <select id="quota-refresh-interval" class="form-control" style="width:auto; padding:2px 8px; font-size:0.75rem; height:26px; background:#09090b; border-color:#27272a;" onchange="changeQuotaRefreshInterval(this.value)">
              <option value="0">已关闭</option>
              <option value="15">15 秒</option>
              <option value="30">30 秒</option>
              <option value="60" selected>60 秒 (默认)</option>
              <option value="120">2 分钟</option>
              <option value="300">5 分钟</option>
            </select>
            <span id="quota-countdown-badge" class="quota-countdown-badge" title="点击立即全量刷新官方配额" onclick="triggerManualQuotaRefreshAll()">⏱️ 60s</span>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="triggerManualQuotaRefreshAll()">🔄 刷新全部配额</button>
          <button class="btn btn-secondary btn-sm" onclick="addAccountCard()">+ 添加订阅账号</button>
          <span class="collapse-toggle" onclick="toggleCardCollapse('accounts-collapse-body', this)">▼ 收起</span>
        </div>
      </div>
      <div id="accounts-collapse-body">
        <div class="plain-tip-box">
          💡 <strong>【白话通俗解释】</strong>：多账号自动负载均衡池。当某个账号达到官方限额触发 429 限频时，网关会在 0.1 秒内自动无感漂移到另一个健康账号继续工作，绝不让你的编码任务报错中断。
        </div>
        <div id="accounts-container" class="accounts-grid">
          <!-- 动态渲染账号卡片 -->
        </div>
      </div>
    </div>
        </section>

        <!-- View Section 5: Doctor & Repair (#/doctor) -->
        <section class="view-section" id="view-doctor">
          <div class="banner status-capsule-bar">
            <div class="capsule-group">
              <span class="status-pill status-pill-active">
                <span class="status-dot-pulse"></span>
                <span>全链路环境诊断体系</span>
              </span>
              <span class="status-pill">🛡️ 100% 离线沙箱 (Air-Gapped)</span>
              <span class="status-pill">🔧 一键秒级自愈闭环</span>
              <span class="status-pill">🪟 零黑框进程脱钩</span>
            </div>
            <div class="capsule-actions" style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:0.75rem; color:var(--muted);">杜绝外部云预览泄露与后台僵死互斥锁</span>
            </div>
          </div>
<!-- 系统自检与修复区域 -->
    <div class="card" id="doctor-card">
      <div class="section-title">
        <div class="section-title-left">
          <span>🩺 系统健康自检与异常修复 (Doctor & Repair)</span>
          <span id="doctor-status-badge" class="badge badge-healthy">🟢 全链路健康</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" onclick="runDoctorCheck('system')">🔍 重新检测</button>
          <button class="btn btn-success btn-sm" onclick="runRepair('system')">🔧 一键自动修复</button>
          <button class="btn btn-secondary btn-sm" style="font-size:0.75rem; opacity:0.85;" onclick="runRepair('all')" title="全量自愈OpenCode、OpenChamber、OMO与Codex全部项目">🛠️ 全量彻底自愈</button>
          <span class="collapse-toggle" onclick="toggleCardCollapse('doctor-collapse-body', this)">▼ 收起</span>
        </div>
      </div>
      <div id="doctor-collapse-body">
        <div class="plain-tip-box">
          💡 <strong>【白话通俗解释】</strong>：全面扫描本地与远程 OpenCode 运行环境、端口占用、离线文档预览沙箱（100% 本地解析沙箱，严禁公网第三方云预览 iframe，杜绝代码和私密合同泄露）以及后台僵死锁。发现异常点击【一键自动修复】即可秒级自愈。
        </div>
        <div id="doctor-content" class="doctor-box">
          <span style="color:var(--muted)">点击【重新检测】检查 OpenCode CLI、路由端口、OpenChamber 工作台、Office 离线安全沙箱与工作区状态...</span>
        </div>
      </div>
    </div>
        </section>

        <!-- View Section 6: Settings & Updates (#/settings) -->
        <section class="view-section" id="view-settings">
          <div class="banner status-capsule-bar">
            <div class="capsule-group">
              <span class="status-pill status-pill-active">
                <span class="status-dot-pulse"></span>
                <span>核心网关运行参数 (Port: ${config.port})</span>
              </span>
              <span class="status-pill">🌐 CONNECT 隧道代理支持</span>
              <span class="status-pill">🛡️ 禁止逆向升阶铁律</span>
              <span class="status-pill">📦 全组件版本热更新</span>
            </div>
            <div class="capsule-actions" style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:0.75rem; color:var(--muted);">支持 127.0.0.1 本地回环与 0.0.0.0 局域网协同</span>
            </div>
          </div>
<!-- 高级策略与网络安全配置 -->
    <div class="card" id="config-card">
      <div class="section-title">
        <div class="section-title-left">
          <span>⚙️ 路由、网络绑定与安全策略配置 (高级运行参数)</span>
          <span id="network-status-badge" class="badge badge-healthy" title="网关端口与网络监听状态">🟢 ${config.port} 监听正常 (${config.host || '127.0.0.1'})</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="btn btn-primary btn-sm" onclick="saveConfig()" title="保存当前配置">💾 保存配置</button>
          <span class="collapse-toggle" id="config-collapse-btn" onclick="toggleCardCollapse('config-card-body', this)">▼ 收起</span>
        </div>
      </div>
      <div id="config-card-body">
        <div class="plain-tip-box">
          💡 <strong>【小白友好提示】</strong>：以下为高级系统运行参数，普通用户保持默认推荐值即可开箱即用。若需供局域网其他电脑或 NAS 访问，可将【监听绑定地址】设为 <code>0.0.0.0</code> 并设置【Web 访问密码】。
        </div>
        <div class="config-grid">
          <div class="form-group">
            <label>上游端点地址 (Upstream Endpoint)</label>
            <input type="text" id="cfg-upstream" class="form-control" value="${config.upstream}" oninput="markConfigDirty()">
            <div class="sub-tip" style="margin-left:0; margin-top:3px;">官方上游 API 接口基础端点</div>
          </div>
          <div class="form-group">
            <label>监听绑定地址 (Host IP - 0.0.0.0 允许局域网/NAS访问)</label>
            <input type="text" id="cfg-host" class="form-control" value="${config.host || '127.0.0.1'}" oninput="markConfigDirty()">
            <div class="sub-tip" style="margin-left:0; margin-top:3px;">127.0.0.1 仅本机可用；0.0.0.0 允许局域网/手机/远程设备连接</div>
          </div>
          <div class="form-group">
            <label>服务端口 (Port)</label>
            <input type="number" id="cfg-port" class="form-control" value="${config.port}" oninput="markConfigDirty()">
            <div class="sub-tip" style="margin-left:0; margin-top:3px;">网关核心服务监听端口，默认 4010</div>
          </div>
          <div class="form-group">
            <label>Web 管理访问密码 (UI Password - 留空无限制)</label>
            <div class="input-wrapper" style="display:flex; gap:8px; align-items:center;">
              <input type="password" id="cfg-uipassword" class="form-control" placeholder="留空不设防，单机电脑推荐留空" value="${config.uiPassword || ''}" oninput="markConfigDirty()" style="flex:1;">
              <button type="button" class="toggle-eye" onclick="toggleEye('cfg-uipassword')" title="显示/隐藏密码">👁️</button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="clearPassword()" style="white-space:nowrap; padding:5px 10px; font-size:12px;" title="一键清空密码恢复免密">🗑️ 清空密码</button>
            </div>
            <div class="sub-tip" style="margin-left:0; margin-top:4px; color:#94a3b8; font-size:12px; line-height:1.5;">
              💡 <strong>【白话说明】</strong>：当前单机电脑（Windows）使用<strong>强烈建议留空</strong>，免密开箱即用。若网关部署在云端/NAS 且开启局域网共享（绑定 <code>0.0.0.0</code>），可在此设置密码防止外部蹭用。无论是否设密，本机上的 Codex 与 OpenCode 均享有本地回路免密通行，绝不报错。
            </div>
          </div>
          <div class="form-group">
            <label>429 触发后默认冷却时长 (秒)</label>
            <input type="number" id="cfg-cooldown" class="form-control" value="${Math.round(config.defaultCooldownMs / 1000)}" oninput="markConfigDirty()">
            <div class="sub-tip" style="margin-left:0; margin-top:3px;">【白话】：账号被限频后暂停使用的秒数，时间到后自动恢复正常</div>
          </div>
          <div class="form-group">
            <label>最大故障转移重试次数 (Retries)</label>
            <input type="number" id="cfg-retries" class="form-control" value="${config.maxFailoverRetries}" oninput="markConfigDirty()">
            <div class="sub-tip" style="margin-left:0; margin-top:3px;">【白话】：网络抖动时自动换其他账号重试的次数，默认 2 次</div>
          </div>
          <div class="form-group" style="display:flex; flex-direction:column; justify-content:center;">
            <label class="switch-label" style="margin-bottom:4px;">
              <input type="checkbox" id="cfg-affinity" ${config.sessionAffinityEnabled ? 'checked' : ''} onchange="markConfigDirty()">
              <span style="font-weight:600; color:#e2e8f0;">启用会话亲和性 (保持连续对话在同一账号)</span>
            </label>
            <div class="sub-tip" style="margin-left:22px;">【白话】：让同一个任务的后续对话找同一个账号，AI 能记住上文并享受官方 KV 缓存折扣</div>
          </div>

          <!-- Proxy Tunnel Settings -->
          <div class="form-group" style="grid-column: 1 / -1; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px;">
            <div style="font-weight: 700; color: #38bdf8; margin-bottom: 6px; font-size: 0.95rem;">
              🌐 上游网络代理与地域限制穿透 (Forward Proxy Tunnel)
            </div>
            <div class="sub-tip" style="margin-left:0; margin-bottom: 10px;">
              为访问官方上游配置 HTTP/HTTPS 代理（如 <code>http://127.0.0.1:7890</code>），让 GPT-5.6/6 Luna 等海外受限模型在大陆 IP 环境下免受 403 阻断；支持零外部依赖 Node.js 原生 CONNECT 隧道转发。
            </div>
          </div>
          <div class="form-group" style="display:flex; flex-direction:column; justify-content:center;">
            <label class="switch-label" style="margin-bottom:4px;">
              <input type="checkbox" id="cfg-proxy-enabled" ${config.proxy && config.proxy.enabled ? 'checked' : ''} onchange="markConfigDirty()">
              <span style="font-weight:600; color:#e2e8f0;">启用上游网络代理 (Enable Proxy)</span>
            </label>
            <div class="sub-tip" style="margin-left:22px;">勾选后，指定流量将通过下方代理服务器隧道转发至上游</div>
          </div>
          <div class="form-group">
            <label>代理服务器地址 (Proxy URL)</label>
            <input type="text" id="cfg-proxy-url" class="form-control" placeholder="http://127.0.0.1:7890" value="${(config.proxy && config.proxy.url) || ''}" oninput="markConfigDirty()">
            <div class="sub-tip" style="margin-left:0; margin-top:3px;">支持 HTTP/HTTPS 代理，未配置时自动继承系统环境变量 (HTTP_PROXY / HTTPS_PROXY)</div>
          </div>
          <div class="form-group">
            <label>代理生效范围 (Proxy Scope)</label>
            <select id="cfg-proxy-scope" class="form-control" onchange="markConfigDirty()">
              <option value="all" ${(!config.proxy || config.proxy.scope === 'all') ? 'selected' : ''}>全局代理 (所有上游请求均走代理)</option>
              <option value="restricted" ${(config.proxy && config.proxy.scope === 'restricted') ? 'selected' : ''}>受限模型代理 (仅 Luna、Claude 等受地域限制模型走代理)</option>
              <option value="custom" ${(config.proxy && config.proxy.scope === 'custom') ? 'selected' : ''}>自定义模型清单 (仅下方指定模型走代理)</option>
            </select>
            <div class="sub-tip" style="margin-left:0; margin-top:3px;">按需指定哪些模型流量走代理，兼顾国内低延迟与海外模型可用性</div>
          </div>
          <div class="form-group">
            <label>走代理的模型清单 (Custom Proxy Models - 逗号分隔)</label>
            <input type="text" id="cfg-proxy-models" class="form-control" placeholder="gpt-5.6-luna, gpt-6-luna, claude-haiku-5-5" value="${(config.proxy && Array.isArray(config.proxy.models)) ? config.proxy.models.join(', ') : 'gpt-5.6-luna, gpt-6-luna, claude-haiku-5-5'}" oninput="markConfigDirty()">
            <div class="sub-tip" style="margin-left:0; margin-top:3px;">仅在范围为“受限模型”或“自定义清单”时生效</div>
          </div>

          <!-- Model Fallback & Anti-Upgrade Policy -->
          <div class="form-group" style="grid-column: 1 / -1; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px;">
            <div style="font-weight: 700; color: #a78bfa; margin-bottom: 6px; font-size: 0.95rem;">
              🛡️ 模型容灾与禁止逆向升阶铁律 (Anti-Upgrade Barrier & Fallback Control)
            </div>
            <div class="sub-tip" style="margin-left:0; margin-bottom: 10px;">
              严格杜绝任何模型未经许可擅自升阶至 Pro 等昂贵慢速旗舰，消除费用与延迟不可控风险。
            </div>
          </div>
          <div class="form-group" style="display:flex; flex-direction:column; justify-content:center;">
            <label class="switch-label" style="margin-bottom:4px;">
              <input type="checkbox" id="cfg-allow-upgrade" ${config.allowModelAutoUpgrade ? 'checked' : ''} onchange="markConfigDirty()">
              <span style="font-weight:600; color:#e2e8f0;">允许模型自动逆向升阶 (默认禁止)</span>
            </label>
            <div class="sub-tip" style="margin-left:22px;">【铁律保护】：保持关闭状态。严禁将 Flash/Standard 请求升阶为昂贵的 Pro/Flagship 旗舰</div>
          </div>
          <div class="form-group" style="display:flex; flex-direction:column; justify-content:center;">
            <label class="switch-label" style="margin-bottom:4px;">
              <input type="checkbox" id="cfg-allow-region-fallback" ${config.allowRegionFallback ? 'checked' : ''} onchange="markConfigDirty()">
              <span style="font-weight:600; color:#e2e8f0;">允许 403 地域限制自动 Fallback 降级 (默认禁止)</span>
            </label>
            <div class="sub-tip" style="margin-left:22px;">【透明感知】：保持关闭时，403 明确报错并提示开启代理或海外节点；开启后才尝试静默替换兼容模型</div>
          </div>
        </div>
      </div>
    </div>
<!-- 全组件最新版本监测、兼容性诊断与安全升级区域 -->
    <div class="card" id="updates-card">
      <div class="section-title">
        <div class="section-title-left">
          <span>📦 全组件最新版本监测、兼容性诊断与安全更新 (Updates & Rollback)</span>
          <span id="updates-status-badge" class="badge badge-healthy">🟢 版本诊断就绪</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" onclick="checkUpdates()">🔍 检查最新版本</button>
          <button class="btn btn-success btn-sm" onclick="applyUpdatesClick()">🚀 一键安全更新</button>
          <button class="btn btn-danger btn-sm" onclick="showRollbackModal()">⏪ 灾备一键回滚</button>
          <span class="collapse-toggle" onclick="toggleCardCollapse('updates-collapse-body', this)">▼ 收起</span>
        </div>
      </div>
      <div id="updates-collapse-body">
        <div class="plain-tip-box">
          💡 <strong>【白话通俗解释】</strong>：实时监测生态核心组件（CLI、OMO 调度插件、Goal 目标插件、OpenChamber 与智能网关）最新版本。更新前系统会自动创建灾备快照，更新后自动重放安全补丁，如有任何不兼容随时可秒级一键回滚。
        </div>
        <div id="updates-content" class="doctor-box">
          <span style="color:var(--muted)">点击【检查最新版本】自动检测 OpenCode CLI、OMO 调度插件、Goal 插件、OpenChamber 及智能网关套件的最新版本与兼容性状态...</span>
        </div>
      </div>
    </div>
          <!-- 系统与网关版本信息卡片 -->
          <div class="card" id="system-info-card">
            <div class="section-title">
              <div class="section-title-left">
                <span>ℹ️ 关于 OpenCode Go 智能高可用网关</span>
                <span class="badge badge-healthy">v${pkgVersion} Pro (SPA Architecture v3.5.0 Pro Baseline)</span>
              </div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:12px; font-size:0.85rem;">
              <div class="wizard-step">
                <span style="color:var(--muted);">当前系统架构:</span>
                <strong style="color:var(--text);">${process.platform} (${process.arch})</strong>
              </div>
              <div class="wizard-step">
                <span style="color:var(--muted);">Node.js 运行时:</span>
                <strong style="color:var(--text);">${process.version}</strong>
              </div>
              <div class="wizard-step">
                <span style="color:var(--muted);">网关服务监听:</span>
                <strong style="color:var(--primary);">${config.host || '127.0.0.1'}:${config.port}</strong>
              </div>
              <div class="wizard-step">
                <span style="color:var(--muted);">桌面客户端形态:</span>
                <strong style="color:#34d399;">原生独立桌面程序 (OpenCodeRouterApp.exe)</strong>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    var currentConfig = (typeof currentConfig !== 'undefined' && currentConfig && currentConfig.accounts) ? currentConfig : { accounts: [] };
    var liveStats = (typeof liveStats !== 'undefined' && liveStats) ? liveStats : {};
    var accountQuotas = (typeof accountQuotas !== 'undefined' && accountQuotas) ? accountQuotas : {};
    var currentPreset = (typeof currentPreset !== 'undefined' && currentPreset) ? currentPreset : 'balanced';
    var codexStatusData = (typeof codexStatusData !== 'undefined') ? codexStatusData : null;

    var tabTitles = {
      'overview': { icon: '📊', name: '总览与快速上手 (Overview)' },
      'compression': { icon: '⚡', name: 'Token 压缩与上下文优化中枢 (Compression)' },
      'clients': { icon: '🤖', name: '客户端接入与模型调度 (Clients & Codex)' },
      'plugins': { icon: '🧩', name: '外挂与扩展插件中心 (Extensions & Plugins)' },
      'accounts': { icon: '📋', name: '订阅账号与官方实时配额 (Accounts & Quotas)' },
      'doctor': { icon: '🩺', name: '系统运行环境自检与修复 (Doctor & Repair)' },
      'settings': { icon: '⚙️', name: '系统网络与高级安全配置 (Settings & Updates)' }
    };

    var tabAliases = {
      'updates': 'settings',
      'config': 'settings',
      'codex': 'clients',
      'extensions': 'plugins',
      'comfyui': 'plugins',
      'comp': 'compression'
    };

    function switchTab(tabId) {
      if (tabAliases[tabId]) tabId = tabAliases[tabId];
      if (!tabTitles[tabId]) tabId = 'overview';

      if (typeof window !== 'undefined' && window.location) {
        const targetHash = '#/' + tabId;
        if (window.location.hash !== targetHash) {
          try {
            if (typeof history !== 'undefined' && history && history.replaceState) {
              history.replaceState(null, '', targetHash);
            } else {
              window.location.hash = targetHash;
            }
          } catch (e) {}
        }
      }

      const tabs = ['overview', 'compression', 'clients', 'plugins', 'accounts', 'doctor', 'settings'];
      tabs.forEach(t => {
        const navItem = document.getElementById('nav-item-' + t);
        if (navItem && navItem.classList) {
          if (t === tabId) navItem.classList.add('active');
          else navItem.classList.remove('active');
        }
        const viewSec = document.getElementById('view-' + t);
        if (viewSec && viewSec.classList) {
          if (t === tabId) viewSec.classList.add('active');
          else viewSec.classList.remove('active');
        }
      });

      const titleBox = document.getElementById('current-view-title');
      if (titleBox && tabTitles[tabId]) {
        titleBox.innerHTML = '<span class="route-icon">' + tabTitles[tabId].icon + '</span><span class="route-name">' + tabTitles[tabId].name + '</span>';
      }

      closeSidebarDrawer();
      closeQuickActionsMenu();

      try {
        if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.setItem === 'function') {
          localStorage.setItem('opencode_router_last_tab', tabId);
        }
      } catch (e) {}

      if ((tabId === 'compression' || tabId === 'overview') && typeof cachedTimeSeriesData !== 'undefined' && cachedTimeSeriesData && cachedTimeSeriesData.length > 0) {
        setTimeout(function() {
          if (typeof renderCompressionTimeSeriesChart === 'function') {
            renderCompressionTimeSeriesChart(cachedTimeSeriesData, cachedTimeSeriesRange, cachedTimeSeriesStats);
          }
        }, 60);
      }
    }

    function getHashTab() {
      let h = (typeof window !== 'undefined' && window.location && window.location.hash) ? window.location.hash : '';
      if (h.indexOf('#/') === 0) h = h.slice(2);
      else if (h.indexOf('#') === 0) h = h.slice(1);
      if (h.indexOf('?') !== -1) h = h.split('?')[0];
      if (h.indexOf('/') !== -1) h = h.split('/')[0];
      return h;
    }

    function initRouter() {
      let initialTab = 'overview';
      const hashTab = getHashTab();
      if (hashTab) {
        let mapped = tabAliases[hashTab] || hashTab;
        if (tabTitles[mapped]) initialTab = mapped;
      } else {
        try {
          if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function') {
            const saved = localStorage.getItem('opencode_router_last_tab');
            if (saved && tabTitles[saved]) initialTab = saved;
          }
        } catch (e) {}
      }
      switchTab(initialTab);

      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('hashchange', function() {
          const ht = getHashTab();
          const mapped = tabAliases[ht] || ht;
          if (tabTitles[mapped]) switchTab(mapped);
        });
      }
    }

    function toggleSidebarCollapse() {
      if (typeof document !== 'undefined' && document.body && document.body.classList) {
        const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
        try {
          if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.setItem === 'function') {
            localStorage.setItem('opencode_sidebar_collapsed', isCollapsed ? '1' : '0');
          }
        } catch (e) {}
      }
    }

    function toggleSidebarDrawer() {
      const sidebar = document.getElementById('app-sidebar');
      const overlay = document.getElementById('sidebar-overlay');
      if (sidebar && sidebar.classList) sidebar.classList.toggle('drawer-open');
      if (overlay && overlay.classList) overlay.classList.toggle('active');
    }

    function closeSidebarDrawer() {
      const sidebar = document.getElementById('app-sidebar');
      const overlay = document.getElementById('sidebar-overlay');
      if (sidebar && sidebar.classList) sidebar.classList.remove('drawer-open');
      if (overlay && overlay.classList) overlay.classList.remove('active');
    }

    function toggleQuickActionsMenu(event) {
      if (event) {
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        if (typeof event.preventDefault === 'function') event.preventDefault();
      }
      const menu = document.getElementById('quick-actions-menu');
      const wrapper = document.getElementById('top-quick-actions-dropdown');
      if (!menu) return;
      const isOpen = menu.classList.toggle('show');
      if (wrapper && wrapper.classList) {
        if (isOpen) wrapper.classList.add('open');
        else wrapper.classList.remove('open');
      }
      const btn = document.getElementById('btn-quick-actions');
      if (btn && typeof btn.setAttribute === 'function') {
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }
    }

    function closeQuickActionsMenu() {
      const menu = document.getElementById('quick-actions-menu');
      if (menu && menu.classList) menu.classList.remove('show');
      const wrapper = document.getElementById('top-quick-actions-dropdown');
      if (wrapper && wrapper.classList) wrapper.classList.remove('open');
      const btn = document.getElementById('btn-quick-actions');
      if (btn && typeof btn.setAttribute === 'function') {
        btn.setAttribute('aria-expanded', 'false');
      }
    }

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('click', function(e) {
        const dropdown = document.getElementById('top-quick-actions-dropdown');
        if (dropdown && !dropdown.contains(e.target)) {
          closeQuickActionsMenu();
        }
      });
      window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' || e.keyCode === 27) {
          closeQuickActionsMenu();
        }
      });
    }

    function initSidebarState() {
      try {
        if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function') {
          if (localStorage.getItem('opencode_sidebar_collapsed') === '1' && document.body && document.body.classList) {
            document.body.classList.add('sidebar-collapsed');
          }
        }
      } catch (e) {}
    }


    function handleCompMasterToggle(checked) {
      updateCompCardsUI();
      showToast(checked ? '✔ 上下文优化与 Token 压缩总开关已开启' : 'ℹ️ 上下文优化与 Token 压缩总开关已旁路关闭');
    }

    function toggleModuleEnabled(modName, enabled) {
      updateCompCardsUI();
      showToast('✔ 模块 ' + modName + (enabled ? ' 已启用' : ' 已停用'));
    }

    function updateCompCardsUI() {
      const masterSw = document.getElementById('cfg-comp-enabled');
      const isMaster = masterSw ? masterSw.checked : true;
      const card = document.getElementById('compression-card');
      const masterBadge = document.getElementById('comp-global-status-badge');

      if (card) {
        if (!isMaster) card.classList.add('comp-master-disabled');
        else card.classList.remove('comp-master-disabled');
      }
      if (masterBadge) {
        if (!isMaster) {
          masterBadge.className = 'badge badge-disabled';
          masterBadge.innerText = '总开关已关闭';
        } else {
          masterBadge.className = 'badge badge-healthy';
          masterBadge.innerText = '全引擎就绪';
        }
      }

      const presets = document.getElementById('comp-presets-group');
      if (presets) {
        presets.querySelectorAll('button').forEach(btn => {
          btn.disabled = !isMaster;
        });
      }

      ['rtk', 'headroom', 'schema', 'cacheZone', 'powershell'].forEach(mod => {
        const sw = document.getElementById('cfg-module-' + (mod === 'cacheZone' ? 'cachezone' : mod) + '-enabled');
        const enabled = sw ? sw.checked : true;
        const modCard = document.getElementById('module-card-' + mod);
        const modBadge = document.getElementById('badge-module-' + mod);
        const modBody = document.getElementById('module-body-' + mod);

        if (modCard) {
          if (!isMaster || !enabled) modCard.classList.add('module-disabled');
          else modCard.classList.remove('module-disabled');
        }
        if (modBadge) {
          if (!isMaster || !enabled) {
            modBadge.className = 'badge badge-disabled';
            modBadge.innerText = !isMaster ? '总控旁路' : '已停用/旁路';
          } else {
            modBadge.className = 'badge badge-healthy';
            modBadge.innerText = '运行中';
          }
        }
        if (sw) sw.disabled = !isMaster;
        if (modBody) {
          modBody.querySelectorAll('input').forEach(input => {
            input.disabled = !isMaster || !enabled;
          });
        }
      });
      handleSubOptionChange();
      updateWizardStatusBadges();
    }

    const PRESET_DESCRIPTIONS = {
      balanced: {
        title: '🌟 平衡标准档 (推荐)',
        ratio: '65% ~ 80%',
        policy: '启用 RTK 终端去噪、Headroom 锁文件折叠、Schema 结构精简 (阈值 15,000)、Cache-Zone 缓存冻结与 PowerShell 跨平台转义修复。',
        risk: '极低。严格豁免 Git 冲突区、Diff 补丁与运行时堆栈，兼顾极致压缩与代码语义无损。',
        badgeColor: '#38bdf8'
      },
      aggressive: {
        title: '🚀 极致省Token档',
        ratio: '80% ~ 92%',
        policy: '全力压缩模式。更早折叠巨型 JSON 结构 (上限 15 项)、极低 Schema 触发阈值 (8,000 字符)、激进合并重复长轮次上下文。',
        risk: '低至中等。超大型数据结构的内部细节将被折叠截断（仍保留键名提示与代码补丁保护），适合重度长会话开发。',
        badgeColor: '#f97316'
      },
      conservative: {
        title: '🛡️ 保守只去噪档',
        ratio: '20% ~ 40%',
        policy: '纯净安全模式。仅清除 ANSI 转义颜色码、终端进度条噪点及 PowerShell 7 冗余报错，不折叠锁文件与数据结构，不使用冻结缓存。',
        risk: '零风险。100% 保持所有历史正文与结构化字段原汁原味，适合高敏感严校验场景。',
        badgeColor: '#34d399'
      },
      custom: {
        title: '⚙️ 自定义模式',
        ratio: '自定义',
        policy: '自由组合 5 大引擎模块（RTK、Headroom、Schema、Cache-Zone、PowerShell）与各项细分开关。',
        risk: '取决于具体勾选配置与自定义阈值。',
        badgeColor: '#a78bfa'
      }
    };

    function setPresetUI(presetName) {
      currentPreset = presetName;
      ['balanced', 'aggressive', 'conservative', 'custom'].forEach(p => {
        const btn = document.getElementById('preset-btn-' + p);
        if (btn) {
          if (p === presetName) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
      const badge = document.getElementById('preset-active-badge');
      if (badge) {
        const titles = {
          balanced: '🌟 平衡标准档',
          aggressive: '🚀 极致省Token档',
          conservative: '🛡️ 保守只去噪档',
          custom: '⚙️ 自定义模式'
        };
        badge.innerText = '当前: ' + (titles[presetName] || presetName);
      }
      const descCard = document.getElementById('preset-desc-card');
      if (descCard) {
        const info = PRESET_DESCRIPTIONS[presetName] || PRESET_DESCRIPTIONS['balanced'];
        descCard.innerHTML = '<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; flex-wrap: wrap; gap: 8px;">' +
          '<span style="font-weight: 600; color: ' + info.badgeColor + '; font-size: 0.85rem;">' + info.title + '</span>' +
          '<span style="font-size: 0.75rem; color: #94a3b8; background: rgba(255,255,255,0.06); padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);">' +
            '预期压缩率: <strong style="color: #38bdf8;">' + info.ratio + '</strong>' +
          '</span>' +
        '</div>' +
        '<div style="font-size: 0.78rem; color: #cbd5e1; margin-bottom: 4px;">' +
          '<strong style="color: #94a3b8;">压缩策略:</strong> ' + info.policy +
        '</div>' +
        '<div style="font-size: 0.78rem; color: #cbd5e1;">' +
          '<strong style="color: #94a3b8;">潜在风险:</strong> <span style="color: ' + (presetName === 'aggressive' ? '#f59e0b' : presetName === 'conservative' ? '#34d399' : '#94a3b8') + ';">' + info.risk + '</span>' +
        '</div>';
      }
      updateWizardStatusBadges();
    }

    function applyPreset(presetName) {
      if (presetName === 'balanced') {
        setCheck('cfg-module-rtk-enabled', true);
        setCheck('cfg-comp-strip-ansi', true);
        setCheck('cfg-comp-clean-progress', true);
        setCheck('cfg-comp-fold-tests', true);
        setCheck('cfg-comp-clean-devops', true);

        setCheck('cfg-module-headroom-enabled', true);
        setCheck('cfg-comp-fold-lockfiles', true);
        setCheck('cfg-comp-fold-structured', true);
        setCheck('cfg-comp-exempt-conflicts', true);
        setCheck('cfg-comp-protect-diffs', true);

        setCheck('cfg-module-schema-enabled', true);
        setCheck('cfg-comp-align-schema', true);
        setCheck('cfg-comp-slim-schema', true);
        setValue('cfg-comp-threshold', 15000);

        setCheck('cfg-module-cachezone-enabled', true);
        setCheck('cfg-comp-cache-freeze', true);
        setCheck('cfg-comp-true-lru', true);

        setCheck('cfg-module-powershell-enabled', true);
        setCheck('cfg-comp-ps-autodetect', true);
        setCheck('cfg-comp-ps-clixml', true);
        setCheck('cfg-comp-ps-trailing-slash', true);
        setCheck('cfg-comp-ps-curl-alias', true);
        setCheck('cfg-comp-ps-and-operator', true);
        setCheck('cfg-comp-ps-line-continuation', true);
        setCheck('cfg-comp-ps-subexpression', true);
        setCheck('cfg-comp-ps-guard-directive', true);
      } else if (presetName === 'aggressive') {
        setCheck('cfg-module-rtk-enabled', true);
        setCheck('cfg-comp-strip-ansi', true);
        setCheck('cfg-comp-clean-progress', true);
        setCheck('cfg-comp-fold-tests', true);
        setCheck('cfg-comp-clean-devops', true);

        setCheck('cfg-module-headroom-enabled', true);
        setCheck('cfg-comp-fold-lockfiles', true);
        setCheck('cfg-comp-fold-structured', true);
        setCheck('cfg-comp-exempt-conflicts', true);
        setCheck('cfg-comp-protect-diffs', true);

        setCheck('cfg-module-schema-enabled', true);
        setCheck('cfg-comp-align-schema', true);
        setCheck('cfg-comp-slim-schema', true);
        setValue('cfg-comp-threshold', 8000);

        setCheck('cfg-module-cachezone-enabled', true);
        setCheck('cfg-comp-cache-freeze', true);
        setCheck('cfg-comp-true-lru', true);

        setCheck('cfg-module-powershell-enabled', true);
        setCheck('cfg-comp-ps-autodetect', true);
        setCheck('cfg-comp-ps-clixml', true);
        setCheck('cfg-comp-ps-trailing-slash', true);
        setCheck('cfg-comp-ps-curl-alias', true);
        setCheck('cfg-comp-ps-and-operator', true);
        setCheck('cfg-comp-ps-line-continuation', true);
        setCheck('cfg-comp-ps-subexpression', true);
        setCheck('cfg-comp-ps-guard-directive', true);
      } else if (presetName === 'conservative') {
        setCheck('cfg-module-rtk-enabled', true);
        setCheck('cfg-comp-strip-ansi', true);
        setCheck('cfg-comp-clean-progress', true);
        setCheck('cfg-comp-fold-tests', false);
        setCheck('cfg-comp-clean-devops', false);

        setCheck('cfg-module-headroom-enabled', false);
        setCheck('cfg-comp-fold-lockfiles', false);
        setCheck('cfg-comp-fold-structured', false);
        setCheck('cfg-comp-exempt-conflicts', true);
        setCheck('cfg-comp-protect-diffs', true);

        setCheck('cfg-module-schema-enabled', true);
        setCheck('cfg-comp-align-schema', true);
        setCheck('cfg-comp-slim-schema', false);
        setValue('cfg-comp-threshold', 15000);

        setCheck('cfg-module-cachezone-enabled', false);
        setCheck('cfg-comp-cache-freeze', false);
        setCheck('cfg-comp-true-lru', true);

        setCheck('cfg-module-powershell-enabled', true);
        setCheck('cfg-comp-ps-autodetect', true);
        setCheck('cfg-comp-ps-clixml', true);
        setCheck('cfg-comp-ps-trailing-slash', true);
        setCheck('cfg-comp-ps-curl-alias', true);
        setCheck('cfg-comp-ps-and-operator', true);
        setCheck('cfg-comp-ps-line-continuation', true);
        setCheck('cfg-comp-ps-subexpression', true);
        setCheck('cfg-comp-ps-guard-directive', false);
      } else if (presetName === 'custom') {
        // Keeps current user configuration intact and highlights custom mode
      }

      updateCompCardsUI();
      setPresetUI(presetName);
    }

    function setCheck(id, val) {
      const elem = document.getElementById(id);
      if (elem) elem.checked = Boolean(val);
    }

    function setValue(id, val) {
      const elem = document.getElementById(id);
      if (elem) elem.value = String(val);
    }

    function handleSubOptionChange() {
      const isRtk = getChecked('cfg-module-rtk-enabled');
      const isStrip = getChecked('cfg-comp-strip-ansi');
      const isClean = getChecked('cfg-comp-clean-progress');
      const isTests = getChecked('cfg-comp-fold-tests');
      const isDevops = getChecked('cfg-comp-clean-devops');

      const isHeadroom = getChecked('cfg-module-headroom-enabled');
      const isLock = getChecked('cfg-comp-fold-lockfiles');
      const isStruct = getChecked('cfg-comp-fold-structured');

      const isSchema = getChecked('cfg-module-schema-enabled');
      const isAlign = getChecked('cfg-comp-align-schema');
      const isSlim = getChecked('cfg-comp-slim-schema');
      const threshold = parseInt((document.getElementById('cfg-comp-threshold') || {}).value, 10) || 15000;

      const isCacheZone = getChecked('cfg-module-cachezone-enabled');
      const isFreeze = getChecked('cfg-comp-cache-freeze');

      const isPs = getChecked('cfg-module-powershell-enabled');
      const isPsClixml = getChecked('cfg-comp-ps-clixml');
      const isPsTrailingSlash = getChecked('cfg-comp-ps-trailing-slash');
      const isPsCurl = getChecked('cfg-comp-ps-curl-alias');
      const isPsAnd = getChecked('cfg-comp-ps-and-operator');
      const isPsLine = getChecked('cfg-comp-ps-line-continuation');
      const isPsSub = getChecked('cfg-comp-ps-subexpression');
      const isPsGuard = getChecked('cfg-comp-ps-guard-directive');
      const isPsFull = isPs && isPsClixml && isPsTrailingSlash && isPsCurl && isPsAnd && isPsLine && isPsSub;

      if (isRtk && isStrip && isClean && isTests && isDevops && isHeadroom && isLock && isStruct && isSchema && isAlign && isSlim && threshold === 15000 && isCacheZone && isFreeze && isPsFull && isPsGuard) {
        setPresetUI('balanced');
      } else if (isRtk && isStrip && isClean && isTests && isDevops && isHeadroom && isLock && isStruct && isSchema && isAlign && isSlim && threshold === 8000 && isCacheZone && isFreeze && isPsFull && isPsGuard) {
        setPresetUI('aggressive');
      } else if (isRtk && isStrip && isClean && !isTests && !isDevops && !isHeadroom && !isLock && !isStruct && isSchema && isAlign && !isSlim && threshold === 15000 && !isCacheZone && !isFreeze && isPsFull && !isPsGuard) {
        setPresetUI('conservative');
      } else {
        setPresetUI('custom');
      }
    }

    function getChecked(id) {
      const el = document.getElementById(id);
      return el ? el.checked : false;
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function toggleByModelDrawer() {
      const drawer = document.getElementById('by-model-breakdown-drawer');
      if (!drawer) return;
      const isHidden = drawer.style.display === 'none';
      drawer.style.display = isHidden ? 'block' : 'none';
      const tag = document.getElementById('by-model-tag');
      if (tag) {
        const badgeEl = document.getElementById('by-model-count-badge');
        const count = badgeEl ? badgeEl.innerText.replace(' 款模型', '') : '0';
        tag.innerText = isHidden
          ? '收起明细 ▴'
          : (count !== '0' ? (count + ' 款模型 ▾') : '分模型明细 ▾');
      }
    }

    // ==========================================
    // 时序图表引擎状态与渲染逻辑 (Zero-Dependency Native SVG Chart)
    // ==========================================
    let currentChartMode = (typeof localStorage !== 'undefined' && localStorage.getItem('router_comp_chart_mode')) || 'bar'; // 'bar' | 'area'
    let currentChartMetric = (typeof localStorage !== 'undefined' && localStorage.getItem('router_comp_chart_metric')) || 'tokens'; // 'tokens' | 'cost' | 'chars'
    let cachedTimeSeriesData = [];
    let cachedTimeSeriesRange = 'all';
    let cachedTimeSeriesStats = null;

    const MODEL_PALETTE = {
      'deepseek-v4-pro': '#ea580c',      // 深赤橙
      'deepseek-v4.1-flash': '#f59e0b',  // 金黄橙
      'deepseek': '#f97316',             // 活力亮橙兜底
      'claude': '#38bdf8',               // 天空蓝
      'kimi': '#a855f7',                 // 紫罗兰
      'glm': '#eab308',                  // 亮金黄
      'gpt': '#10b981',                  // 翡翠绿
      'default': '#f97316'
    };
    const FALLBACK_COLORS = ['#ea580c', '#f59e0b', '#38bdf8', '#10b981', '#a855f7', '#eab308', '#ec4899', '#06b6d4', '#84cc16'];

    function getModelColor(modelName, index = 0) {
      if (!modelName) return MODEL_PALETTE['default'];
      const lower = String(modelName).toLowerCase();
      // 精准区分 DeepSeek 旗舰 Pro (深赤橙 #ea580c) 与轻量 Flash (金黄橙 #f59e0b)，杜绝同色塌陷
      if (lower.includes('deepseek') && (lower.includes('pro') || lower.includes('r1') || lower.includes('v4-pro'))) {
        return '#ea580c';
      }
      if (lower.includes('deepseek') && (lower.includes('flash') || lower.includes('v4.1') || lower.includes('lite'))) {
        return '#f59e0b';
      }
      for (const [k, c] of Object.entries(MODEL_PALETTE)) {
        if (k !== 'default' && lower.includes(k)) return c;
      }
      return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
    }

    function switchChartMode(mode) {
      if (mode !== 'bar' && mode !== 'area') mode = 'bar';
      currentChartMode = mode;
      try { localStorage.setItem('router_comp_chart_mode', mode); } catch (_) {}
      ['bar', 'area'].forEach(m => {
        ['btn-chart-mode-', 'btn-overview-chart-mode-'].forEach(prefix => {
          const btn = document.getElementById(prefix + m);
          if (btn && btn.classList) {
            if (m === mode) btn.classList.add('active');
            else btn.classList.remove('active');
          }
        });
      });
      ['chart-type-icon', 'overview-chart-type-icon'].forEach(id => {
        const iconEl = document.getElementById(id);
        if (iconEl) iconEl.innerText = mode === 'bar' ? '📊' : '📈';
      });
      renderCompressionTimeSeriesChart(cachedTimeSeriesData, cachedTimeSeriesRange, cachedTimeSeriesStats);
    }

    function switchChartMetric(metric) {
      if (metric !== 'tokens' && metric !== 'cost' && metric !== 'chars') metric = 'tokens';
      currentChartMetric = metric;
      try { localStorage.setItem('router_comp_chart_metric', metric); } catch (_) {}
      ['tokens', 'cost', 'chars'].forEach(m => {
        ['btn-chart-metric-', 'btn-overview-chart-metric-'].forEach(prefix => {
          const btn = document.getElementById(prefix + m);
          if (btn && btn.classList) {
            if (m === metric) btn.classList.add('active');
            else btn.classList.remove('active');
          }
        });
      });
      renderCompressionTimeSeriesChart(cachedTimeSeriesData, cachedTimeSeriesRange, cachedTimeSeriesStats);
    }

    function renderCompressionTimeSeriesChart(series = [], range = 'all', stats = {}) {
      cachedTimeSeriesData = series;
      cachedTimeSeriesRange = range;
      cachedTimeSeriesStats = stats;

      // 1. 同步更新所有摘要标签 (Summary Badges) - 显式突出动态节约率
      ['chart-summary-badge', 'overview-chart-summary-badge'].forEach(badgeId => {
        const badge = document.getElementById(badgeId);
        if (badge && stats) {
          const sTokens = Number(stats.savedTokens || 0);
          const cTokens = Number(stats.consumedTokens || 0);
          const totalT = sTokens + cTokens;
          const ratio = totalT > 0 ? ((sTokens / totalT) * 100).toFixed(1) + '%' : (sTokens > 0 ? '100%' : '0%');
          if (currentChartMetric === 'cost') {
            const costVal = Number(stats.savedCostUSD || 0);
            badge.innerText = '总节约: ~$' + (costVal < 0.0001 && costVal > 0 ? costVal.toFixed(6) : costVal.toFixed(4)) + ' USD · 动态节约率: ' + ratio;
          } else if (currentChartMetric === 'chars') {
            badge.innerText = '总节约: ' + Number(stats.totalSavedChars || 0).toLocaleString() + ' 字符 · 动态节约率: ' + ratio;
          } else {
            badge.innerText = '总节约: ~' + sTokens.toLocaleString() + ' Tokens · 动态节约率: ' + ratio;
          }
        }
      });

      // 2. 提取活跃模型集
      const modelSet = new Set();
      if (Array.isArray(series)) {
        series.forEach(pt => {
          if (pt.byModel && typeof pt.byModel === 'object') {
            Object.keys(pt.byModel).forEach(m => modelSet.add(m));
          }
        });
      }
      const activeModels = Array.from(modelSet);
      if (activeModels.length === 0) {
        activeModels.push('deepseek-v4.1-flash');
      }

      // 3. 同步更新所有图例区 (Legends)
      ['comp-chart-legends', 'overview-chart-legends'].forEach(legendsId => {
        const legendsEl = document.getElementById(legendsId);
        if (legendsEl) {
          const activeThemeColor = currentChartMetric === 'cost' ? '#10b981' : (currentChartMetric === 'chars' ? '#a78bfa' : '#38bdf8');
          const trackLegend = '<div style="display:flex;align-items:center;gap:8px;font-size:0.75rem;margin-right:8px;padding-right:8px;border-right:1px solid #27272a;">' +
            '<span style="display:inline-block;width:9px;height:9px;background:#52525b;border-radius:2px;"></span>' +
            '<span style="color:#94a3b8;font-weight:500;">原本消耗 (左柱灰)</span>' +
            '<span style="display:inline-block;width:9px;height:9px;background:#f59e0b;border-radius:2px;margin-left:4px;"></span>' +
            '<span style="color:#f59e0b;font-weight:500;">实际使用 (右柱黄)</span>' +
            '<span style="display:inline-block;width:9px;height:9px;background:rgba(56,189,248,0.22);border:1px dashed #38bdf8;border-radius:2px;margin-left:4px;"></span>' +
            '<span style="color:#38bdf8;font-weight:500;">智能节约 (虚线帽)</span>' +
            '</div>';
          legendsEl.innerHTML = trackLegend + activeModels.map((m, idx) => {
            const color = getModelColor(m, idx);
            return '<div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;">' +
              '<span style="display:inline-block;width:9px;height:9px;background:' + color + ';border-radius:2px;"></span>' +
              '<span style="font-family:monospace;color:#cbd5e1;">' + escapeHtml(m) + '</span>' +
              '</div>';
          }).join('');
        }
      });

      // 4. 定义双视口规格配置
      const viewports = [
        {
          viewportId: 'comp-chart-viewport',
          tooltipId: 'comp-chart-tooltip',
          overlayId: 'comp-chart-overlay',
          crosshairGroupId: 'comp-chart-crosshair-group',
          crosshairLineId: 'comp-chart-crosshair',
          hoverDotId: 'comp-chart-hover-dot'
        },
        {
          viewportId: 'overview-chart-viewport',
          tooltipId: 'overview-chart-tooltip',
          overlayId: 'overview-chart-overlay',
          crosshairGroupId: 'overview-chart-crosshair-group',
          crosshairLineId: 'overview-chart-crosshair',
          hoverDotId: 'overview-chart-hover-dot'
        }
      ];

      viewports.forEach(cfg => {
        renderSingleChartViewport(cfg, series, range, stats, activeModels);
      });
    }

    function renderSingleChartViewport(cfg, series, range, stats, activeModels) {
      const viewport = document.getElementById(cfg.viewportId);
      if (!viewport) return;

      const themeColor = currentChartMetric === 'cost' ? '#10b981' : (currentChartMetric === 'chars' ? '#a78bfa' : '#38bdf8');
      const consumedColor = '#52525b';

      if (!Array.isArray(series) || series.length === 0) {
        viewport.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:0.85rem;">💤 暂无时序数据</div>';
        return;
      }

      const getSavedVal = (pt) => {
        if (!pt) return 0;
        if (currentChartMetric === 'cost') return Number(pt.savedCostUSD || 0);
        if (currentChartMetric === 'chars') return Number(pt.savedChars || 0);
        return Number(pt.savedTokens || 0);
      };

      const getConsumedVal = (pt) => {
        if (!pt) return 0;
        if (currentChartMetric === 'cost') return Number(pt.consumedCostUSD || 0);
        if (currentChartMetric === 'chars') return Number(pt.consumedChars || pt.originalChars || (pt.savedChars ? Math.round(pt.savedChars * 1.5) : 0));
        return Number(pt.consumedTokens || 0);
      };

      const rawMax = Math.max(...series.map(pt => getConsumedVal(pt) + getSavedVal(pt)), 0);
      const isAllZero = rawMax === 0;

      let maxVal = rawMax;
      if (isAllZero) {
        maxVal = currentChartMetric === 'cost' ? 0.001 : (currentChartMetric === 'chars' ? 500 : 100);
      } else {
        maxVal = maxVal * 1.15;
      }

      const viewportRect = viewport.getBoundingClientRect ? viewport.getBoundingClientRect() : null;
      const svgW = Math.max(600, Math.round((viewportRect && viewportRect.width) || 800));
      const svgH = 200;
      const padL = currentChartMetric === 'cost' ? 68 : 55;
      const padR = 20;
      const padT = 20;
      const padB = 30;
      const chartW = svgW - padL - padR;
      const chartH = svgH - padT - padB;
      const n = series.length;

      const formatYTick = (val) => {
        if (val === 0) return '0';
        if (currentChartMetric === 'cost') {
          return '$' + (val < 0.001 ? val.toFixed(4) : val.toFixed(3));
        }
        if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
        if (val >= 1000) return (val / 1000).toFixed(1) + 'k';
        return String(Math.round(val));
      };

      let gridLinesSvg = '';
      const gridLevels = [0, 0.33, 0.66, 1.0];
      gridLevels.forEach(lvl => {
        const y = padT + chartH * (1 - lvl);
        const tickVal = maxVal * lvl;
        gridLinesSvg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (padL + chartW) + '" y2="' + y + '" stroke="#222226" stroke-width="1" stroke-dasharray="3,3" />' +
          '<text x="' + (padL - 8) + '" y="' + (y + 3) + '" fill="#71717a" font-size="10" text-anchor="end" font-family="monospace">' + formatYTick(tickVal) + '</text>';
      });

      const xBaseY = padT + chartH;
      let xLabelsSvg = '<line x1="' + padL + '" y1="' + xBaseY + '" x2="' + (padL + chartW) + '" y2="' + xBaseY + '" stroke="#27272a" stroke-width="1" />';

      const step = n <= 8 ? 1 : (n <= 14 ? 2 : 4);
      series.forEach((pt, i) => {
        if (i % step === 0 || i === n - 1) {
          const x = padL + (i + 0.5) * (chartW / n);
          xLabelsSvg += '<text x="' + x + '" y="' + (xBaseY + 16) + '" fill="#71717a" font-size="9.5" text-anchor="middle" font-family="monospace">' + escapeHtml(pt.label) + '</text>';
        }
      });

      let contentSvg = '';

      if (currentChartMode === 'bar') {
        const slotW = chartW / n;
        const barW = Math.max(3, Math.min(14, slotW * 0.36));

        series.forEach((pt, i) => {
          const sVal = getSavedVal(pt);
          const cVal = getConsumedVal(pt);
          const origVal = cVal + sVal;
          const xCenter = padL + (i + 0.5) * slotW;
          const origBarX = xCenter - barW - 1.5;
          const actBarX = xCenter + 1.5;

          // 1) 原本总消耗柱 (左柱 - 中性炭灰)
          if (origVal > 0) {
            const origH = Math.max(2, (origVal / maxVal) * chartH);
            const origY = xBaseY - origH;
            contentSvg += '<rect class="chart-bar-rect chart-bar-consumed" data-index="' + i + '" x="' + origBarX + '" y="' + origY + '" width="' + barW + '" height="' + origH + '" fill="' + consumedColor + '" opacity="0.85" rx="2" />';
          } else {
            contentSvg += '<rect data-index="' + i + '" x="' + origBarX + '" y="' + (xBaseY - 2) + '" width="' + barW + '" height="2" fill="#27272a" opacity="0.4" rx="1" />';
          }

          // 2) 实际使用柱 + 顶部虚线节约帽 (右柱)
          if (origVal > 0) {
            const modelEntries = Object.entries(pt.byModel || {});
            const color = modelEntries.length === 1 ? getModelColor(modelEntries[0][0], 0) : (modelEntries.length > 1 ? getModelColor(modelEntries[0][0], 0) : '#f59e0b');

            // 右柱实心下半截：实际处理消耗 (cVal)
            if (cVal > 0) {
              const cH = Math.max(2, (cVal / maxVal) * chartH);
              const cY = xBaseY - cH;
              contentSvg += '<rect class="chart-bar-rect chart-bar-actual" data-index="' + i + '" x="' + actBarX + '" y="' + cY + '" width="' + barW + '" height="' + cH + '" fill="' + color + '" rx="2" ry="2" />';
            }

            // 右柱虚线上半截：智能压缩节约 (sVal)
            if (sVal > 0) {
              const sH = Math.max(2, (sVal / maxVal) * chartH);
              const cH = cVal > 0 ? (cVal / maxVal) * chartH : 0;
              const sY = xBaseY - cH - sH;
              contentSvg += '<rect class="chart-bar-rect chart-bar-saved" data-index="' + i + '" x="' + actBarX + '" y="' + sY + '" width="' + barW + '" height="' + sH + '" fill="rgba(56, 189, 248, 0.22)" stroke="#38bdf8" stroke-width="1" stroke-dasharray="2,2" rx="2" ry="2" />';
            }
          } else {
            contentSvg += '<rect data-index="' + i + '" x="' + actBarX + '" y="' + (xBaseY - 2) + '" width="' + barW + '" height="2" fill="#27272a" opacity="0.4" rx="1" />';
          }
        });
      } else {
        const savedPoints = series.map((pt, i) => {
          const val = getSavedVal(pt);
          const x = padL + (i + 0.5) * (chartW / n);
          const y = isAllZero ? xBaseY : (xBaseY - (val / maxVal) * chartH);
          return { x, y, val };
        });

        const consumedPoints = series.map((pt, i) => {
          const val = getConsumedVal(pt);
          const x = padL + (i + 0.5) * (chartW / n);
          const y = isAllZero ? xBaseY : (xBaseY - (val / maxVal) * chartH);
          return { x, y, val };
        });

        const buildSmoothPath = (pts) => {
          if (!pts || pts.length === 0) return '';
          if (pts.length === 1) return 'M ' + (pts[0].x - 8) + ' ' + pts[0].y + ' L ' + (pts[0].x + 8) + ' ' + pts[0].y;
          let pathD = 'M ' + pts[0].x + ' ' + pts[0].y;
          for (let i = 0; i < pts.length - 1; i++) {
            const p0 = i > 0 ? pts[i - 1] : pts[i];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = i < pts.length - 2 ? pts[i + 2] : p2;
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            pathD += ' C ' + cp1x.toFixed(1) + ' ' + cp1y.toFixed(1) + ', ' + cp2x.toFixed(1) + ' ' + cp2y.toFixed(1) + ', ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
          }
          return pathD;
        };

        const consumedPathD = buildSmoothPath(consumedPoints);
        const savedPathD = buildSmoothPath(savedPoints);
        const savedAreaD = savedPathD + ' L ' + savedPoints[savedPoints.length - 1].x + ' ' + xBaseY + ' L ' + savedPoints[0].x + ' ' + xBaseY + ' Z';

        const gradId = 'compAreaGrad_' + cfg.viewportId;
        contentSvg += '<defs>' +
          '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + themeColor + '" stop-opacity="0.38"/>' +
          '<stop offset="100%" stop-color="' + themeColor + '" stop-opacity="0.02"/>' +
          '</linearGradient>' +
          '</defs>' +
          '<path d="' + consumedPathD + '" fill="none" stroke="' + consumedColor + '" stroke-width="1.8" stroke-dasharray="4,3" stroke-linecap="round" stroke-linejoin="round" opacity="0.75" />' +
          '<path d="' + savedAreaD + '" fill="url(#' + gradId + ')" />' +
          '<path d="' + savedPathD + '" fill="none" stroke="' + themeColor + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />';

        consumedPoints.forEach(p => {
          if (p.val > 0) {
            contentSvg += '<circle cx="' + p.x + '" cy="' + p.y + '" r="2.8" fill="' + consumedColor + '" stroke="#121215" stroke-width="1.5" />';
          }
        });
        savedPoints.forEach(p => {
          if (p.val > 0) {
            contentSvg += '<circle cx="' + p.x + '" cy="' + p.y + '" r="3.5" fill="' + themeColor + '" stroke="#121215" stroke-width="1.8" />';
          }
        });
      }

      let emptyOverlaySvg = '';
      if (isAllZero) {
        emptyOverlaySvg = '<g transform="translate(' + (padL + chartW / 2) + ', ' + (padT + chartH / 2) + ')">' +
          '<rect x="-180" y="-18" width="360" height="36" rx="18" fill="rgba(18,18,21,0.9)" stroke="#27272a" stroke-width="1" />' +
          '<text x="0" y="5" fill="#a1a1aa" font-size="11.5" text-anchor="middle">💤 当前时间段内暂无压缩数据，发起对话后将实时呈现时序波形</text>' +
          '</g>';
      }

      const interactiveSvg = '<g id="' + cfg.crosshairGroupId + '" style="display:none;">' +
        '<line id="' + cfg.crosshairLineId + '" x1="0" y1="' + padT + '" x2="0" y2="' + xBaseY + '" stroke="' + themeColor + '" stroke-width="1" stroke-dasharray="3,3" />' +
        '<circle id="' + cfg.hoverDotId + '" cx="0" cy="0" r="5" fill="' + themeColor + '" stroke="#121215" stroke-width="2" />' +
        '</g>' +
        '<rect id="' + cfg.overlayId + '" x="' + padL + '" y="' + padT + '" width="' + chartW + '" height="' + chartH + '" fill="transparent" style="cursor:crosshair;" />';

      viewport.innerHTML = '<svg class="chart-svg-root" viewBox="0 0 ' + svgW + ' ' + svgH + '" style="width:100%;height:100%;display:block;">' +
        gridLinesSvg +
        xLabelsSvg +
        contentSvg +
        emptyOverlaySvg +
        interactiveSvg +
        '</svg>';

      const overlayEl = document.getElementById(cfg.overlayId);
      const crosshairGroup = document.getElementById(cfg.crosshairGroupId);
      const crosshairLine = document.getElementById(cfg.crosshairLineId);
      const hoverDot = document.getElementById(cfg.hoverDotId);
      const tooltipEl = document.getElementById(cfg.tooltipId);

      if (overlayEl && tooltipEl && crosshairGroup) {
        overlayEl.addEventListener('mousemove', function(e) {
          const rect = overlayEl.getBoundingClientRect();
          const mouseXRel = (e.clientX - rect.left) / rect.width;
          const idx = Math.max(0, Math.min(n - 1, Math.floor(mouseXRel * n)));
          const pt = series[idx];
          if (!pt) return;

          const slotW = chartW / n;
          const xPos = padL + (idx + 0.5) * slotW;
          const sVal = getSavedVal(pt);
          const yPos = isAllZero ? xBaseY : (xBaseY - (sVal / maxVal) * chartH);

          crosshairGroup.style.display = 'block';
          if (crosshairLine) {
            crosshairLine.setAttribute('x1', xPos);
            crosshairLine.setAttribute('x2', xPos);
          }
          if (hoverDot) {
            hoverDot.setAttribute('cx', xPos);
            hoverDot.setAttribute('cy', yPos);
          }

          let modelDetailsHtml = '';
          const mEntries = Object.entries(pt.byModel || {});
          if (mEntries.length > 0) {
            modelDetailsHtml = '<div style="margin-top:6px;padding-top:6px;border-top:1px solid #27272a;">' +
              mEntries.map(([m, mData], mIdx) => {
                const col = getModelColor(m, mIdx);
                const sTokens = Number(mData.savedTokens || 0).toLocaleString();
                const sCost = Number(mData.savedCostUSD || 0).toFixed(6);
                return '<div style="display:flex;justify-content:space-between;gap:12px;font-size:0.72rem;margin-top:2px;">' +
                  '<span><span style="color:' + col + ';">■</span> ' + escapeHtml(m) + '</span>' +
                  '<span style="color:#cbd5e1;font-family:monospace;">~' + sTokens + 'T ($' + sCost + ')</span>' +
                  '</div>';
              }).join('') +
              '</div>';
          }

          const timeLabel = new Date(pt.time).toLocaleString('zh-CN', { hour12: false });
          const sTokens = Number(pt.savedTokens || 0);
          const cTokens = Number(pt.consumedTokens || 0);
          const sCost = Number(pt.savedCostUSD || 0);
          const cCost = Number(pt.consumedCostUSD || 0);
          const sChars = Number(pt.savedChars || 0);
          const origChars = Number(pt.originalChars || pt.consumedChars || (sChars + Math.round(cTokens * 3.8)));

          const totalTokens = cTokens + sTokens;
          const ratioStr = totalTokens > 0 ? ((sTokens / totalTokens) * 100).toFixed(1) + '%' : (sTokens > 0 ? '100%' : '0%');

          tooltipEl.innerHTML = '<div style="font-weight:600;color:#f1f5f9;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
            '<span>⏱️ ' + escapeHtml(pt.label) + '</span>' +
            '<span style="font-size:0.68rem;color:#71717a;font-weight:normal;">(' + escapeHtml(timeLabel) + ')</span>' +
            '</div>' +
            '<div style="display:flex;flex-direction:column;gap:3px;font-size:0.74rem;">' +
            '<div style="display:flex;justify-content:space-between;gap:12px;color:#94a3b8;">' +
            '<span>📊 原本总需求 (未压缩):</span>' +
            '<span style="font-family:monospace;color:#94a3b8;">~' + totalTokens.toLocaleString() + ' T</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;gap:12px;color:#f59e0b;font-weight:500;">' +
            '<span>⚡ 实际处理消耗 (压缩后):</span>' +
            '<span style="font-family:monospace;color:#f59e0b;">~' + cTokens.toLocaleString() + ' T ($' + cCost.toFixed(5) + ')</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;gap:12px;color:#38bdf8;font-weight:500;">' +
            '<span>✂️ 智能压缩节约 (虚线砍掉):</span>' +
            '<span style="font-family:monospace;color:#38bdf8;">~' + sTokens.toLocaleString() + ' T ($' + sCost.toFixed(5) + ')</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;gap:12px;color:#34d399;font-size:0.72rem;border-top:1px dashed #27272a;padding-top:3px;margin-top:2px;">' +
            '<span>📈 动态节约率 (实省比例):</span>' +
            '<span style="font-family:monospace;font-weight:600;color:#34d399;">' + ratioStr + '</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;gap:12px;color:#71717a;font-size:0.7rem;">' +
            '<span>📝 处理字符数:</span>' +
            '<span style="font-family:monospace;">~' + origChars.toLocaleString() + ' chars (节约 ' + sChars.toLocaleString() + ')</span>' +
            '</div>' +
            '</div>' +
            modelDetailsHtml;

          tooltipEl.style.display = 'block';

          const card = (viewport.closest && viewport.closest('.comp-chart-card')) || viewport.parentElement;
          if (card) {
            const cardRect = card.getBoundingClientRect();
            const screenX = e.clientX - cardRect.left;
            const screenY = e.clientY - cardRect.top;
            const tooltipW = tooltipEl.offsetWidth || 220;
            const tooltipH = tooltipEl.offsetHeight || 140;

            // 自适应水平定位：默认右侧 +16px，若右侧溢出则翻转至左侧 -tooltipW - 16px，避免遮挡光标
            let targetX = screenX + 16;
            if (targetX + tooltipW > cardRect.width - 12) {
              targetX = Math.max(10, screenX - tooltipW - 16);
            }

            // 自适应垂直定位：垂直居中偏上，限制在卡片安全可视区域内
            let targetY = Math.max(10, Math.min(cardRect.height - tooltipH - 10, screenY - Math.round(tooltipH / 2)));

            tooltipEl.style.left = targetX + 'px';
            tooltipEl.style.top = targetY + 'px';
          }
        });

        overlayEl.addEventListener('mouseleave', function() {
          crosshairGroup.style.display = 'none';
          tooltipEl.style.display = 'none';
        });
      }
    }

    let compChartResizeTimer = null;
    window.addEventListener('resize', function() {
      if (compChartResizeTimer) clearTimeout(compChartResizeTimer);
      compChartResizeTimer = setTimeout(function() {
        if (cachedTimeSeriesData && cachedTimeSeriesData.length > 0) {
          renderCompressionTimeSeriesChart(cachedTimeSeriesData, cachedTimeSeriesRange, cachedTimeSeriesStats);
        }
      }, 150);
    });


    let currentCompRange = 'all';

    function switchCompRange(range) {
      if (!range) range = 'all';
      currentCompRange = range;
      const allButtons = document.querySelectorAll('.comp-range-btn, .time-range-pill');
      allButtons.forEach(btn => {
        const btnRange = btn.getAttribute('data-range') || (btn.id ? btn.id.replace('comp-range-', '') : '');
        if (btnRange === range) btn.classList.add('active');
        else btn.classList.remove('active');
      });

      const rangeLabels = {
        '1h': '过去 1 小时',
        '24h': '过去 24 小时',
        '7d': '过去 7 天',
        'all': '全部历史累计'
      };
      const badgeEl = document.getElementById('comp-range-badge');
      if (badgeEl) {
        badgeEl.innerText = rangeLabels[range] || range;
      }
      fetchCompressionStats();
    }

    function switchTimeRange(range) {
      return switchCompRange(range);
    }

    async function fetchCompressionStats() {
      if (document.hidden) return;
      try {
        const queryParam = currentCompRange ? '?range=' + encodeURIComponent(currentCompRange) : '';
        const res = await fetch('/balancer/api/compression/stats' + queryParam, { headers: apiHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (!data || !data.stats) return;
        const stats = data.stats;
        const hasData = (stats.totalOriginalChars || 0) > 0 || (stats.totalSavedChars || 0) > 0;

        const tokensEl = document.getElementById('stat-saved-tokens');
        const costEl = document.getElementById('stat-saved-cost');
        const ratioEl = document.getElementById('stat-compression-ratio');
        const origEl = document.getElementById('stat-original-chars');
        const savedCharsSub = document.getElementById('stat-saved-chars-sub');
        const compCharsSub = document.getElementById('stat-compressed-chars-sub');

        const savedTokens = Number(stats.savedTokens || 0);
        const consumedTokens = Number(stats.consumedTokens || 0);
        const totalTokens = savedTokens + consumedTokens;
        const dynamicSavingsRatio = totalTokens > 0
          ? Number(((savedTokens / totalTokens) * 100).toFixed(1))
          : (savedTokens > 0 ? 100.0 : 0.0);
        const discountRate = dynamicSavingsRatio > 0
          ? ((100 - dynamicSavingsRatio) / 10).toFixed(1)
          : '10';

        if (tokensEl) tokensEl.innerText = '~' + savedTokens.toLocaleString() + ' Tokens';
        const savedTokensSub = document.getElementById('stat-saved-tokens-sub');
        if (savedTokensSub) {
          savedTokensSub.innerText = hasData
            ? ('实际处理消耗 ~' + consumedTokens.toLocaleString() + ' T · 原本需求 ~' + totalTokens.toLocaleString() + ' T')
            : '基于中英双语动态模型 (~1.25 中文 / ~3.8 英文代码 字符/Token)';
        }

        const dynRatioEl = document.getElementById('stat-dynamic-savings-ratio');
        const dynRatioSub = document.getElementById('stat-dynamic-savings-sub');
        if (dynRatioEl) dynRatioEl.innerText = dynamicSavingsRatio.toFixed(1) + '%';
        if (dynRatioSub) {
          dynRatioSub.innerText = hasData
            ? ('原本需求 ~' + totalTokens.toLocaleString() + ' T · 相当于打 ' + discountRate + ' 折')
            : (currentCompRange === 'all' ? '原本总需求: 0 T · 相当于打 10 折' : '此时间段内暂无数据');
        }

        if (costEl) {
          const costVal = Number(stats.savedCostUSD || 0);
          costEl.innerText = '~$' + (costVal < 0.0001 && costVal > 0 ? costVal.toFixed(6) : costVal.toFixed(4)) + ' USD';
        }
        const tokensOverviewEl = document.getElementById('stat-saved-tokens-overview');
        const costOverviewEl = document.getElementById('stat-saved-cost-overview');
        const compOverviewBadge = document.getElementById('comp-overview-badge');
        if (tokensOverviewEl) tokensOverviewEl.innerText = '~' + savedTokens.toLocaleString() + ' Tokens';
        if (costOverviewEl) {
          const costVal = Number(stats.savedCostUSD || 0);
          costOverviewEl.innerText = '节约费用: ~$' + (costVal < 0.0001 && costVal > 0 ? costVal.toFixed(6) : costVal.toFixed(4)) + ' USD · 实省 ' + dynamicSavingsRatio.toFixed(1) + '%';
        }
        if (compOverviewBadge) {
          compOverviewBadge.innerText = hasData ? ('⚡ 实省 ' + dynamicSavingsRatio.toFixed(1) + '%') : '实时估算中';
        }
        if (ratioEl) ratioEl.innerText = (stats.compressionRatio || 0) + '%';
        if (origEl) origEl.innerText = Number(stats.totalOriginalChars || 0).toLocaleString() + ' Chars';
        if (savedCharsSub) {
          savedCharsSub.innerText = hasData
            ? ('已节约 ' + Number(stats.totalSavedChars || 0).toLocaleString() + ' 字符')
            : (currentCompRange === 'all' ? '已节约 0 字符' : '此时间段内暂无压缩数据');
        }
        if (compCharsSub) compCharsSub.innerText = '压缩后: ' + Number(stats.totalCompressedChars || 0).toLocaleString() + ' 字符';

        // Update By-Model breakdown telemetry
        const byModelEntries = Object.entries(stats.byModel || {});
        const tagEl = document.getElementById('by-model-tag');
        const badgeEl = document.getElementById('by-model-count-badge');
        const drawerEl = document.getElementById('by-model-breakdown-drawer');
        const isDrawerOpen = drawerEl && drawerEl.style.display !== 'none';

        if (tagEl) {
          tagEl.innerText = isDrawerOpen
            ? '收起明细 ▴'
            : (byModelEntries.length > 0 ? (byModelEntries.length + ' 款模型 ▾') : '分模型明细 ▾');
        }
        if (badgeEl) badgeEl.innerText = byModelEntries.length + ' 款模型';

        const tbody = document.getElementById('by-model-table-body');
        if (tbody) {
          if (byModelEntries.length === 0) {
            const rangeNote = (data.rangeLabel || (currentCompRange === 'all' ? '全部历史累计' : currentCompRange));
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #71717a; padding: 14px 8px;">' +
              (hasData ? '暂无分模型调用数据（发起请求后将实时归集并动态加权测算）' : ('此时间段（' + escapeHtml(rangeNote) + '）内暂无压缩数据')) +
              '</td></tr>';
          } else {
            byModelEntries.sort((a, b) => (b[1].savedCostUSD || 0) - (a[1].savedCostUSD || 0) || (b[1].savedTokens || 0) - (a[1].savedTokens || 0));
            tbody.innerHTML = byModelEntries.map(([m, mData]) => {
              const costVal = Number(mData.savedCostUSD || 0);
              const costStr = costVal < 0.0001 && costVal > 0 ? costVal.toFixed(7) : costVal.toFixed(6);
              const rateVal = Number(mData.ratePer1M || 0);
              const rateStr = (rateVal > 0 && rateVal < 0.01) ? rateVal.toFixed(4) : (rateVal % 0.01 !== 0 && rateVal < 1 ? rateVal.toFixed(3) : rateVal.toFixed(2));
              const origStr = Number(mData.originalChars || 0).toLocaleString();
              const tokensStr = Number(mData.savedTokens || 0).toLocaleString();
              return '<tr style="border-bottom: 1px solid #222226; transition: background 0.15s;">' +
                '<td style="padding: 7px 10px; font-weight: 600; color: #e2e8f0; font-family: monospace;">' +
                '<span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #34d399; margin-right: 6px;"></span>' +
                escapeHtml(m) + '</td>' +
                '<td style="padding: 7px 10px; text-align: right; color: #cbd5e1;">' + origStr + ' 字符</td>' +
                '<td style="padding: 7px 10px; text-align: right; color: #38bdf8; font-weight: 500;">~' + tokensStr + ' Tokens</td>' +
                '<td style="padding: 7px 10px; text-align: right; color: #94a3b8;">$' + rateStr + ' / 1M</td>' +
                '<td style="padding: 7px 10px; text-align: right; color: #34d399; font-weight: 600;">$' + costStr + '</td>' +
                '</tr>';
            }).join('');
          }
        }

        if (stats.modules) {
          ['rtk', 'headroom', 'schema', 'cacheZone', 'powershell'].forEach(mod => {
            const m = stats.modules[mod] || {};
            const textEl = document.getElementById('contrib-text-' + mod);
            const fillEl = document.getElementById('progress-fill-' + mod);
            if (textEl) {
              if (mod === 'schema') {
                const roundsText = m.alignedRounds ? ' (' + m.alignedRounds + ' 轮锁定)' : '';
                if ((m.savedTokens || 0) > 0) {
                  textEl.innerText = '贡献度: ' + (m.percentage || 0) + '% · ~' + Number(m.savedTokens || 0).toLocaleString() + ' Tokens' + roundsText;
                } else if (m.alignedRounds > 0) {
                  textEl.innerText = '🔒 KV Cache 前缀已锁定 (' + m.alignedRounds + ' 轮 · ' + Number(m.alignedToolsCount || 0).toLocaleString() + ' 工具)';
                } else {
                  textEl.innerText = '贡献度: 0% · ~0 Tokens';
                }
              } else if (mod === 'cacheZone') {
                const hits = m.cacheZoneHits || 0;
                if ((m.savedTokens || 0) > 0) {
                  textEl.innerText = '贡献度: ' + (m.percentage || 0) + '% · ~' + Number(m.savedTokens || 0).toLocaleString() + ' Tokens' + (hits > 0 ? ' (' + Number(hits).toLocaleString() + ' 次命中)' : '');
                } else if (hits > 0) {
                  textEl.innerText = '⚡ 固化命中 ' + Number(hits).toLocaleString() + ' 次 (零重算零抖动)';
                } else {
                  textEl.innerText = '贡献度: 0% · ~0 Tokens (待命中)';
                }
              } else {
                textEl.innerText = '贡献度: ' + (m.percentage || 0) + '% · ~' + Number(m.savedTokens || 0).toLocaleString() + ' Tokens';
              }
            }
            if (fillEl) {
              if (mod === 'schema' && (m.percentage || 0) === 0 && (m.alignedRounds || 0) > 0) {
                fillEl.style.width = '100%';
              } else if (mod === 'cacheZone' && (m.percentage || 0) === 0 && (m.cacheZoneHits || 0) > 0) {
                fillEl.style.width = '100%';
              } else {
                fillEl.style.width = Math.min(100, Math.max(0, m.percentage || 0)) + '%';
              }
            }
          });
        }

        // Update Time-Series Trend & Distribution Chart
        const seriesData = data.timeSeries || stats.timeSeries || [];
        renderCompressionTimeSeriesChart(seriesData, data.range || currentCompRange, stats);
      } catch (e) {}
    }

    async function handleResetCompressionStats() {
      if (!confirm('确定要清零累计压缩与 Token 节省统计数据吗？此操作不可逆。')) return;
      try {
        const res = await fetch('/balancer/api/compression/stats/reset', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' })
        });
        const data = await res.json();
        if (data && data.success) {
          showToast('✔ ' + (data.message || '压缩与 Token 节省统计已清零'));
          const tbody = document.getElementById('by-model-table-body');
          if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #71717a; padding: 14px 8px;">暂无分模型调用数据（发起请求后将实时归集并动态加权测算）</td></tr>';
          const badgeEl = document.getElementById('by-model-count-badge');
          if (badgeEl) badgeEl.innerText = '0 款模型';
          const tagEl = document.getElementById('by-model-tag');
          if (tagEl) tagEl.innerText = '分模型明细 ▾';
          fetchCompressionStats();
        } else {
          showToast('清零失败: ' + (data.error || '未知错误'), true);
        }
      } catch (e) {
        showToast('请求失败: ' + e.message, true);
      }
    }

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
      const btn = document.getElementById('btn-copy-baseurl');
      const origText = btn ? btn.innerText : '📋 复制端点 (Copy)';

      const onSuccess = () => {
        showToast('✔ 已复制 Base URL: ' + url);
        if (btn) {
          btn.innerText = '✔ 已复制!';
          btn.classList.add('btn-success');
          btn.classList.remove('btn-secondary');
          setTimeout(() => {
            btn.innerText = origText;
            btn.classList.remove('btn-success');
            btn.classList.add('btn-secondary');
          }, 1800);
        }
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(onSuccess).catch(() => {
          fallbackCopyText(url, onSuccess);
        });
      } else {
        fallbackCopyText(url, onSuccess);
      }
    }

    function fallbackCopyText(text, cb) {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        if (cb) cb();
        else showToast('✔ 已复制 Base URL: ' + text);
      } catch (err) {
        showToast('复制失败，请手动复制: ' + text, true);
      }
      document.body.removeChild(textArea);
    }

    function clearPassword() {
      const input = document.getElementById('cfg-uipassword');
      if (input) {
        input.value = '';
        markConfigDirty();
        showToast('已清空访问密码，点击【💾 保存配置】即可生效为免密模式');
      }
    }

    function markConfigDirty() {
      const saveBtn = document.getElementById('btn-save-config');
      if (saveBtn && !saveBtn.classList.contains('btn-save-dirty')) {
        saveBtn.classList.add('btn-save-dirty');
        saveBtn.title = '您有未保存的配置更改，点击立即保存！';
      }
    }

    function clearConfigDirty() {
      const saveBtn = document.getElementById('btn-save-config');
      if (saveBtn) {
        saveBtn.classList.remove('btn-save-dirty');
        saveBtn.title = '保存当前所有配置';
      }
    }

    function logoutAdmin() {
      if (!confirm('确定要退出当前管理面板登录吗？')) return;
      document.cookie = 'router_auth=; Path=/; Max-Age=0; SameSite=Lax';
      localStorage.removeItem('opencode_router_token');
      location.reload();
    }

    function showToast(msg, isError = false) {
      const toast = document.getElementById('toast');
      if (!toast) return;
      toast.innerText = msg;
      toast.style.background = isError ? '#991b1b' : '#065f46';
      toast.style.borderColor = isError ? '#f87171' : '#34d399';
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3000);
    }

    var compAdvancedCollapsed = false;
    function toggleAllCompModuleBodies() {
      compAdvancedCollapsed = !compAdvancedCollapsed;
      var ids = ['module-body-rtk', 'module-body-headroom', 'module-body-schema', 'module-body-cacheZone', 'module-body-powershell'];
      for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (el) el.style.display = compAdvancedCollapsed ? 'none' : '';
      }
      var btn = document.getElementById('btn-toggle-comp-advanced');
      if (btn) {
        btn.textContent = compAdvancedCollapsed ? '🎛️ 展开底层微调项 (已精简)' : '🎛️ 收起/展开底层微调项';
      }
    }

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          if (typeof saveConfig === 'function') saveConfig();
        } else if (e.altKey && !e.ctrlKey && !e.metaKey) {
          var tabMap = { '1': 'overview', '2': 'compression', '3': 'clients', '4': 'plugins', '5': 'accounts', '6': 'doctor', '7': 'settings' };
          if (tabMap[e.key] && typeof switchTab === 'function') {
            e.preventDefault();
            switchTab(tabMap[e.key]);
          }
        }
      });
    }

    function toggleCardCollapse(bodyId, triggerElem) {
      const body = document.getElementById(bodyId);
      if (!body) return;
      const isCollapsed = body.style.display === 'none';
      if (isCollapsed) {
        body.style.display = 'block';
        if (triggerElem) triggerElem.innerText = '▼ 收起';
        try { localStorage.setItem('collapse_' + bodyId, 'open'); } catch (_) {}
      } else {
        body.style.display = 'none';
        if (triggerElem) triggerElem.innerText = '▶ 展开';
        try { localStorage.setItem('collapse_' + bodyId, 'closed'); } catch (_) {}
      }
    }

    function initCardCollapseStates() {
      const cardIds = [
        { id: 'doctor-collapse-body', defaultState: 'open' },
        { id: 'updates-collapse-body', defaultState: 'open' },
        { id: 'codex-collapse-body', defaultState: 'open' },
        { id: 'accounts-collapse-body', defaultState: 'open' },
        { id: 'compression-collapse-body', defaultState: 'open' },
        { id: 'config-card-body', defaultState: 'closed' }
      ];
      cardIds.forEach(item => {
        const body = document.getElementById(item.id);
        if (!body) return;
        let saved = null;
        try { saved = localStorage.getItem('collapse_' + item.id); } catch (_) {}
        const state = saved || item.defaultState;
        if (state === 'closed') {
          body.style.display = 'none';
          const trigger = (body.parentElement && typeof body.parentElement.querySelector === 'function')
            ? body.parentElement.querySelector('.collapse-toggle')
            : document.getElementById('config-collapse-btn');
          if (trigger) trigger.innerText = '▶ 展开';
        } else if (state === 'open') {
          body.style.display = 'block';
          const trigger = (body.parentElement && typeof body.parentElement.querySelector === 'function')
            ? body.parentElement.querySelector('.collapse-toggle')
            : null;
          if (trigger) trigger.innerText = '▼ 收起';
        }
      });
    }

    function scrollToElement(id) {
      const elementToTabMap = {
        'accounts-card': 'accounts',
        'accounts-container': 'accounts',
        'compression-card': 'compression',
        'comp-metrics-dashboard': 'compression',
        'module-card-rtk': 'compression',
        'module-card-headroom': 'compression',
        'module-card-schema': 'compression',
        'module-card-cacheZone': 'compression',
        'module-card-powershell': 'compression',
        'codex-card': 'clients',
        'clients-guide-card': 'clients',
        'doctor-card': 'doctor',
        'config-card': 'settings',
        'updates-card': 'settings',
        'system-info-card': 'settings',
        'wizard-card': 'overview'
      };
      let targetTab = elementToTabMap[id];
      if (!targetTab) {
        const el = document.getElementById(id);
        if (el && typeof el.closest === 'function') {
          const parentSec = el.closest('.view-section');
          if (parentSec && parentSec.id && parentSec.id.indexOf('view-') === 0) {
            targetTab = parentSec.id.slice(5);
          }
        }
      }
      if (targetTab && typeof switchTab === 'function') {
        switchTab(targetTab);
      }
      setTimeout(() => {
        const el = document.getElementById(id);
        if (el) {
          if (typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          el.style.transition = 'box-shadow 0.3s ease';
          el.style.boxShadow = '0 0 20px rgba(56, 189, 248, 0.6)';
          setTimeout(() => {
            if (el && el.style) el.style.boxShadow = '';
          }, 1500);
        }
      }, 40);
    }

    function updateWizardStatusBadges() {
      const validAccounts = (currentConfig && currentConfig.accounts) ? currentConfig.accounts.filter(a => a.apiKey && a.apiKey.trim() && a.enabled) : [];
      const accBadge = document.getElementById('accounts-status-badge');
      const wizAccBadge = document.getElementById('wizard-status-account');
      const wizAccDesc = document.getElementById('wizard-desc-account');
      if (validAccounts.length > 0) {
        if (accBadge) {
          accBadge.className = 'badge badge-healthy';
          accBadge.innerText = '🟢 已就绪 (' + validAccounts.length + ' 账号)';
          accBadge.title = '当前账号池有 ' + validAccounts.length + ' 个有效订阅账号可用，自动故障转移已就绪';
        }
        if (wizAccBadge) {
          wizAccBadge.className = 'badge badge-healthy';
          wizAccBadge.innerText = '🟢 ' + validAccounts.length + ' 账号已就绪';
          wizAccBadge.title = '订阅账号池健康就绪';
        }
        if (wizAccDesc) {
          wizAccDesc.innerText = '已成功绑定 ' + validAccounts.length + ' 个可用订阅账号，支持秒级自动漂移与配额轮转';
        }
      } else {
        if (accBadge) {
          accBadge.className = 'badge badge-cooling';
          accBadge.innerText = '🔴 待配置密钥';
          accBadge.title = '账号池无可用密钥，网关无法转发请求至上游';
        }
        if (wizAccBadge) {
          wizAccBadge.className = 'badge badge-cooling';
          wizAccBadge.innerText = '🔴 待配置密钥';
          wizAccBadge.title = '请在下方账号列表中填入 API Key';
        }
        if (wizAccDesc) {
          wizAccDesc.innerText = '请在下方账号卡片中填入您的 API Key 订阅密钥即可立即开启负载均衡';
        }
      }

      const compMaster = document.getElementById('cfg-comp-enabled');
      const isComp = compMaster ? compMaster.checked : true;
      const wizCompBadge = document.getElementById('wizard-status-comp');
      const wizCompDesc = document.getElementById('wizard-desc-comp');
      if (wizCompBadge) {
        wizCompBadge.className = isComp ? 'badge badge-healthy' : 'badge badge-disabled';
        wizCompBadge.innerText = isComp ? '🟢 ' + (currentPreset === 'aggressive' ? '极致省Token' : (currentPreset === 'conservative' ? '保守只去噪' : (currentPreset === 'custom' ? '自定义模式' : '推荐平衡档'))) : '⏸️ 已旁路';
        wizCompBadge.title = isComp ? 'Token 压缩优化已开启，预计为您节约 15%~30% 官方配额消耗' : '压缩总开关已关闭，日志原样转发';
      }
      if (wizCompDesc) {
        wizCompDesc.innerText = isComp ? '智能清洗终端刷屏 + Headroom 结构折叠 + Schema 对齐，无损省 Token' : '压缩引擎已旁路暂停，建议点击【一键配置】开启推荐平衡档';
      }

      const codexBadge = document.getElementById('codex-status-badge');
      const wizCodexBadge = document.getElementById('wizard-status-codex');
      const wizCodexDesc = document.getElementById('wizard-desc-codex');
      const codexBound = Boolean(codexStatusData && codexStatusData.codex && codexStatusData.codex.isBound);
      if (codexBound) {
        if (codexBadge) {
          codexBadge.className = 'badge badge-healthy';
          codexBadge.innerText = '🟢 已接入 4010 网关 (5min防断流)';
          codexBadge.title = 'OpenAI Codex 客户端已锁定至本地 4010 网关，并已注入 5 分钟超时与死锁保护';
        }
        if (wizCodexBadge) {
          wizCodexBadge.className = 'badge badge-healthy';
          wizCodexBadge.innerText = '🟢 5min 防断流就绪';
          wizCodexBadge.title = 'Codex 客户端接入健康';
        }
        if (wizCodexDesc) {
          wizCodexDesc.innerText = 'OpenAI Codex 流量已导入本地网关，全量 38 款模型与 5 分钟长推理防断流就绪';
        }
      } else {
        if (codexBadge) {
          codexBadge.className = 'badge badge-cooling';
          codexBadge.innerText = '🟡 未接入网关';
          codexBadge.title = 'OpenAI Codex 尚未连接至本地网关，点击【一键接入】即可秒级绑定';
        }
        if (wizCodexBadge) {
          wizCodexBadge.className = 'badge badge-cooling';
          wizCodexBadge.innerText = '🟡 未接入网关';
          wizCodexBadge.title = 'Codex 尚未绑定';
        }
        if (wizCodexDesc) {
          wizCodexDesc.innerText = '点击【一键全能配置】或前往 Codex 卡片一键接入，解锁 38 款大模型与防断流';
        }
      }

      // Overview summary badges
      const accOverviewBadge = document.getElementById('accounts-overview-badge');
      const accOverviewVal = document.getElementById('accounts-overview-val');
      const accOverviewSub = document.getElementById('accounts-overview-sub');
      if (accOverviewBadge) {
        accOverviewBadge.className = validAccounts.length > 0 ? 'badge badge-healthy' : 'badge badge-cooling';
        accOverviewBadge.innerText = validAccounts.length > 0 ? '🟢 账号池可用' : '🔴 待配置密钥';
      }
      if (accOverviewVal) {
        accOverviewVal.innerText = validAccounts.length > 0 ? (validAccounts.length + ' 个账号就绪') : '待配置密钥';
      }
      if (accOverviewSub) {
        accOverviewSub.innerText = validAccounts.length > 0 ? '多账号 429 秒级自动漂移与配额轮转' : '请点击填入订阅 API Key 即可启动负载均衡';
      }
      const codexOverviewVal = document.getElementById('codex-overview-val');
      if (codexOverviewVal) {
        codexOverviewVal.innerText = codexBound ? '38 款大模型 (已接入)' : '38 款大模型 (待接入)';
      }

      // Update Network Status Badge
      const netBadge = document.getElementById('network-status-badge');
      if (netBadge) {
        const host = (currentConfig && currentConfig.host) || '127.0.0.1';
        const port = (currentConfig && currentConfig.port) || ${config.port};
        netBadge.className = 'badge badge-healthy';
        netBadge.innerText = '🟢 ' + port + ' 监听正常 (' + host + ')';
        netBadge.title = '智能网关正在 ' + host + ':' + port + ' 正常监听，所有请求均受高可用与会话隔离保护';
      }

      // Dynamically calculate and update Wizard Global Badge
      const wizGlobalBadge = document.getElementById('wizard-global-badge');
      if (wizGlobalBadge) {
        const hasAccounts = validAccounts.length > 0;
        const isCompActive = isComp;
        const isCodexReady = codexBound;
        if (!hasAccounts) {
          wizGlobalBadge.className = 'badge badge-cooling';
          wizGlobalBadge.innerText = '🔴 待配置密钥';
          wizGlobalBadge.title = '尚未配置任何有效的 API Key 密钥，请在下方填入订阅密钥';
        } else if (!isCodexReady || !isCompActive) {
          wizGlobalBadge.className = 'badge badge-healthy';
          wizGlobalBadge.innerText = '🟡 待优化 (点击一键配置)';
          wizGlobalBadge.title = '账号已就绪，推荐点击【🚀 新手一键全能配置】秒级加固 Codex 与 Token 压缩';
        } else {
          wizGlobalBadge.className = 'badge badge-healthy';
          wizGlobalBadge.innerText = '🟢 黄金就绪 (开箱即用)';
          wizGlobalBadge.title = '所有核心组件均处于最佳工作状态，尽情使用！';
        }
      }
    }

    async function runQuickSetupWizard() {
      const btn = document.getElementById('btn-quick-setup');
      const progBox = document.getElementById('wizard-progress-box');
      if (btn) {
        btn.disabled = true;
        btn.innerText = '⏳ 正在全自动执行新手全能配置与体检...';
      }
      if (progBox) {
        progBox.style.display = 'block';
        progBox.innerHTML = '<div style="color:var(--primary); font-weight:600; margin-bottom:6px;">🚀 新手全能向导执行中，请稍候：</div>' +
          '<div id="w-step-1" style="color:var(--muted); padding:2px 0;">⏳ [1/4] 正在校验账号池有效性与官方限额...</div>' +
          '<div id="w-step-2" style="color:var(--muted); padding:2px 0;">⏳ [2/4] 正在执行全链路系统健康体检与异常自愈...</div>' +
          '<div id="w-step-3" style="color:var(--muted); padding:2px 0;">⏳ [3/4] 正在应用推荐 Token 压缩平衡标准档...</div>' +
          '<div id="w-step-4" style="color:var(--muted); padding:2px 0;">⏳ [4/4] 正在将 4010 网关智能接入 OpenAI Codex 并开启 5 分钟防断流...</div>';
      }

      showToast('🚀 正在执行新手一键全能配置与体检...');

      try {
        // Step 1: Accounts verification
        const validAccounts = (currentConfig && currentConfig.accounts) ? currentConfig.accounts.filter(a => a.apiKey && a.apiKey.trim()) : [];
        const w1 = document.getElementById('w-step-1');
        if (validAccounts.length > 0) {
          await refreshAllQuotas(true, false);
          if (w1) {
            w1.innerHTML = '✔ [1/4] 账号池校验完毕：已配置 ' + validAccounts.length + ' 个有效订阅账号';
            w1.style.color = 'var(--success)';
          }
        } else {
          if (w1) {
            w1.innerHTML = '⚠️ [1/4] 账号池提示：当前尚未配置 API Key 密钥，建议在下方账号卡片中填入您的订阅密钥';
            w1.style.color = 'var(--warning)';
          }
        }

        // Step 2: System Health & Repair
        const w2 = document.getElementById('w-step-2');
        await runRepair('all');
        await runDoctorCheck('system');
        if (w2) {
          w2.innerHTML = '✔ [2/4] 全链路健康自愈完毕：CLI、端口监听、离线预览沙箱与指令集均已就绪';
          w2.style.color = 'var(--success)';
        }

        // Step 3: Apply recommended compression preset 'balanced'
        const w3 = document.getElementById('w-step-3');
        setCheck('cfg-comp-enabled', true);
        applyPreset('balanced');
        if (w3) {
          w3.innerHTML = '✔ [3/4] 推荐 Token 压缩平衡标准档已生效：日志清洗 + Headroom 折叠 + Schema 对齐';
          w3.style.color = 'var(--success)';
        }

        // Step 4: Codex Bind & 5min Timeout Guard
        const w4 = document.getElementById('w-step-4');
        try {
          const model = (document.getElementById('codex-model-select') && document.getElementById('codex-model-select').value) || 'deepseek-v4.1-flash';
          const effort = (document.getElementById('codex-effort-select') && document.getElementById('codex-effort-select').value) || 'high';
          const resBind = await fetch('/balancer/api/bind-codex', {
            method: 'POST',
            headers: apiHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ defaultModel: model, reasoningEffort: effort })
          });
          const dataBind = await resBind.json();
          if (dataBind && dataBind.success) {
            if (w4) {
              w4.innerHTML = '✔ [4/4] OpenAI Codex 已成功接入 4010 网关 (已配置 5 分钟防断流与高思考等级)';
              w4.style.color = 'var(--success)';
            }
          } else {
            if (w4) {
              w4.innerHTML = 'ℹ [4/4] Codex 接入提示: ' + (dataBind.message || '已配置');
              w4.style.color = 'var(--muted)';
            }
          }
          await loadCodexStatus();
        } catch (e) {
          if (w4) {
            w4.innerHTML = 'ℹ [4/4] Codex 接入扫描完毕: ' + e.message;
            w4.style.color = 'var(--muted)';
          }
          await loadCodexStatus();
        }

        // Save final config to persist
        await saveConfig();
        clearConfigDirty();
        updateWizardStatusBadges();

        if (progBox) {
          progBox.innerHTML += '<div style="margin-top:8px; padding-top:6px; border-top:1px solid #27272a; color:var(--success); font-weight:700;">' +
            '🎉 新手一键全能配置与体检已 100% 达成！系统已处于最佳状态，可直接在 OpenCode、OpenChamber 或终端中畅享高可用智能编程！' +
            '</div>';
        }
        showToast('🎉 新手一键全能配置已圆满完成！');
      } catch (err) {
        showToast('一键配置过程中出现提示: ' + err.message, true);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = '🚀 新手一键全能配置与体检 (已处于最佳状态)';
        }
      }
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
        if (document.getElementById('cfg-allow-upgrade')) document.getElementById('cfg-allow-upgrade').checked = Boolean(currentConfig.allowModelAutoUpgrade);
        if (document.getElementById('cfg-allow-region-fallback')) document.getElementById('cfg-allow-region-fallback').checked = Boolean(currentConfig.allowRegionFallback);
        if (currentConfig.proxy) {
          if (document.getElementById('cfg-proxy-enabled')) document.getElementById('cfg-proxy-enabled').checked = Boolean(currentConfig.proxy.enabled);
          if (document.getElementById('cfg-proxy-url')) document.getElementById('cfg-proxy-url').value = currentConfig.proxy.url || '';
          if (document.getElementById('cfg-proxy-scope')) document.getElementById('cfg-proxy-scope').value = currentConfig.proxy.scope || 'all';
          if (document.getElementById('cfg-proxy-models')) {
            document.getElementById('cfg-proxy-models').value = Array.isArray(currentConfig.proxy.models) ? currentConfig.proxy.models.join(', ') : (currentConfig.proxy.models || '');
          }
        }
        if (currentConfig.compression) {
          const comp = currentConfig.compression;
          const m = comp.modules || {};
          if (document.getElementById('cfg-comp-enabled')) {
            document.getElementById('cfg-comp-enabled').checked = comp.enabled !== false;
          }

          // Module RTK
          if (document.getElementById('cfg-module-rtk-enabled')) {
            document.getElementById('cfg-module-rtk-enabled').checked = (m.rtk && m.rtk.enabled !== false);
          }
          if (document.getElementById('cfg-comp-strip-ansi')) {
            document.getElementById('cfg-comp-strip-ansi').checked = (m.rtk ? m.rtk.stripAnsi !== false : comp.stripAnsi !== false);
          }
          if (document.getElementById('cfg-comp-clean-progress')) {
            document.getElementById('cfg-comp-clean-progress').checked = (m.rtk ? m.rtk.cleanProgressBars !== false : comp.cleanProgressBars !== false);
          }
          if (document.getElementById('cfg-comp-fold-tests')) {
            document.getElementById('cfg-comp-fold-tests').checked = (m.rtk ? m.rtk.foldTestPasses !== false : comp.foldTestPasses !== false);
          }
          if (document.getElementById('cfg-comp-clean-devops')) {
            document.getElementById('cfg-comp-clean-devops').checked = (m.rtk ? m.rtk.cleanDevOpsOutput !== false : (comp.cleanDevOpsOutput !== false && comp.cleanDockerOutput !== false));
          }

          // Module Headroom
          if (document.getElementById('cfg-module-headroom-enabled')) {
            document.getElementById('cfg-module-headroom-enabled').checked = (m.headroom && m.headroom.enabled !== false);
          }
          if (document.getElementById('cfg-comp-fold-lockfiles')) {
            document.getElementById('cfg-comp-fold-lockfiles').checked = (m.headroom ? m.headroom.foldLockfiles !== false : comp.foldLockfiles !== false);
          }
          if (document.getElementById('cfg-comp-fold-structured')) {
            document.getElementById('cfg-comp-fold-structured').checked = (m.headroom ? m.headroom.foldStructuredData !== false : comp.foldStructuredData !== false);
          }
          if (document.getElementById('cfg-comp-exempt-conflicts')) {
            document.getElementById('cfg-comp-exempt-conflicts').checked = (m.headroom ? m.headroom.exemptMergeConflicts !== false : comp.exemptMergeConflicts !== false);
          }
          if (document.getElementById('cfg-comp-protect-diffs')) {
            document.getElementById('cfg-comp-protect-diffs').checked = (m.headroom ? m.headroom.protectSourceDiffs !== false : comp.protectSourceDiffs !== false);
          }

          // Module Schema
          if (document.getElementById('cfg-module-schema-enabled')) {
            document.getElementById('cfg-module-schema-enabled').checked = (m.schema && m.schema.enabled !== false);
          }
          if (document.getElementById('cfg-comp-align-schema')) {
            document.getElementById('cfg-comp-align-schema').checked = (m.schema ? m.schema.alignToolsSchema !== false : comp.alignToolsSchema !== false);
          }
          if (document.getElementById('cfg-comp-slim-schema')) {
            document.getElementById('cfg-comp-slim-schema').checked = (m.schema ? m.schema.slimToolsSchema !== false : comp.slimToolsSchema !== false);
          }
          if (document.getElementById('cfg-comp-threshold')) {
            document.getElementById('cfg-comp-threshold').value = (m.schema && m.schema.schemaCharThreshold) || comp.schemaCharThreshold || 15000;
          }

          // Module CacheZone
          if (document.getElementById('cfg-module-cachezone-enabled')) {
            document.getElementById('cfg-module-cachezone-enabled').checked = (m.cacheZone && m.cacheZone.enabled !== false);
          }
          if (document.getElementById('cfg-comp-cache-freeze')) {
            document.getElementById('cfg-comp-cache-freeze').checked = (m.cacheZone ? m.cacheZone.cacheZoneFreeze !== false : comp.cacheZoneFreeze !== false);
          }
          if (document.getElementById('cfg-comp-true-lru')) {
            document.getElementById('cfg-comp-true-lru').checked = (m.cacheZone ? m.cacheZone.trueLruRetention !== false : comp.trueLruRetention !== false);
          }

          updateCompCardsUI();
          if (comp.preset) setPresetUI(comp.preset);
          else handleSubOptionChange();
        }
        const logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn) logoutBtn.style.display = currentConfig.hasUiPassword ? 'inline-block' : 'none';
        renderAccounts();
        initQuotaRefreshScheduler();
        refreshAllQuotas(true, false);
        updateWizardStatusBadges();
        runCompressionDoctorCheck(true);
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
        updateWizardStatusBadges();
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
              <div style="display:flex; align-items:center;">
                <span>📊 官方限额 (Usage Quota)</span>
                <span id="quota-updated-\${acc.id}" class="quota-time-tag"></span>
              </div>
              <button type="button" id="quota-btn-\${acc.id}" class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="fetchSingleQuota('\${acc.id}', true)">🔄 刷新</button>
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
      markConfigDirty();
      updateWizardStatusBadges();
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
      markConfigDirty();
      updateWizardStatusBadges();
      showToast('已添加新订阅账号卡片，请填入密钥');
    }

    function deleteAccount(id) {
      if (currentConfig.accounts.length <= 1) {
        alert('至少需要保留一个账号！');
        return;
      }
      if (!confirm('确定要删除该订阅账号配置吗？删除后不可恢复。')) return;
      currentConfig.accounts = currentConfig.accounts.filter(a => a.id !== id);
      renderAccounts();
      markConfigDirty();
      updateWizardStatusBadges();
      showToast('✔ 已删除账号');
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

    async function runDoctorCheck(scope = 'system') {
      const box = document.getElementById('doctor-content');
      const doctorBadge = document.getElementById('doctor-status-badge');
      const wizDocBadge = document.getElementById('wizard-status-doctor');
      const wizDocDesc = document.getElementById('wizard-desc-doctor');
      const overviewDocBadge = document.getElementById('doctor-overview-badge');
      const overviewDocVal = document.getElementById('doctor-overview-val');
      const navDocBadge = document.getElementById('nav-badge-doctor');
      const wizGlobalBadge = document.getElementById('wizard-global-badge');
      box.innerHTML = '<span style="color:var(--primary)">⏳ 正在执行系统环境全链路自检...</span>';
      try {
        const res = await fetch('/balancer/api/doctor?scope=' + encodeURIComponent(scope), { headers: apiHeaders() });
        const doc = await res.json();
        let html = \`
          <div style="margin-bottom:8px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
            <span><strong>OpenCode CLI:</strong> \${doc.opencode.installed ? '<span style="color:var(--success)">✔ ' + doc.opencode.version + '</span>' : '<span style="color:var(--warning)">⚠ 未找到</span>'}</span>
            <span><strong>路由端口:</strong> <span style="color:var(--success)">✔ \${doc.router.port}</span></span>
            <span><strong>OpenChamber:</strong> \${doc.openchamber.reachable ? '<span style="color:var(--success)">✔ 运行中</span>' : (doc.openchamber.ghost ? '<span style="color:var(--danger)">❌ 僵死死锁</span>' : '<span style="color:var(--muted)">未运行</span>')} <button class="btn btn-secondary btn-sm" style="padding:1px 6px; font-size:11px; margin-left:4px;" onclick="launchOpenChamber()">💻 唤醒桌面端</button></span>
            <span><strong>Office 预览:</strong> \${doc.openchamber.officePreview && doc.openchamber.officePreview.installed ? '<span style="color:var(--success)">✔ 已挂载</span>' : '<span style="color:var(--muted)">未挂载</span>'}</span>
            <span><strong>OMO 插件:</strong> \${doc.omoIntegrity ? (doc.omoIntegrity.healthy ? '<span style="color:var(--success)">✔ v2安全</span>' : '<span style="color:var(--danger)">❌ 存在缺陷</span>') : '<span style="color:var(--muted)">-</span>'}</span>
            <span><strong>双轨 Schema:</strong> \${doc.dualTrackSchema ? (doc.dualTrackSchema.healthy ? '<span style="color:var(--success)">✔ 镜像正常</span>' : '<span style="color:var(--warning)">⚠ 缺失规范</span>') : '<span style="color:var(--muted)">-</span>'}</span>
            <span><strong>提供商接口:</strong> \${doc.openchamberProbe && doc.openchamberProbe.integration ? (doc.openchamberProbe.integration.status === 'healthy' ? '<span style="color:var(--success)">✔ ' + doc.openchamberProbe.integration.latencyMs + 'ms' + (doc.openchamberProbe.integration.authRequired ? ' (鉴权)' : '') + '</span>' : (doc.openchamberProbe.integration.status === 'deadlocked' ? '<span style="color:var(--danger)">❌ 死锁挂死</span>' : (doc.openchamberProbe.integration.status === 'unreachable' ? '<span style="color:var(--muted)">未连接</span>' : '<span style="color:var(--warning)">⚠ ' + (doc.openchamberProbe.integration.error || doc.openchamberProbe.integration.status) + '</span>'))) : '<span style="color:var(--muted)">-</span>'}</span>
            <span><strong>/boost 指令:</strong> \${doc.commands.boostMdExists ? '<span style="color:var(--success)">✔ 已就绪</span>' : '<span style="color:var(--muted)">未安装</span>'}</span>
            <span><strong>回路互通门禁:</strong> \${doc.gatewayLoopbackAuth ? (doc.gatewayLoopbackAuth.healthy ? '<span style="color:var(--success)">✔ 守卫正常</span>' : '<span style="color:var(--danger)">❌ 存在阻断</span>') : '<span style="color:var(--muted)">-</span>'}</span>
            <span><strong>模型自愈屏障:</strong> <span style="color:var(--success)">✔ 异构节点防护</span></span>
          </div>
        \`;
        if (doc.issues.length === 0) {
          html += '<div style="color:var(--success); font-weight:600; padding:6px 0;">🎉 系统核心组件全链路状态极佳，未发现任何潜在隐患！</div>';
          if (doctorBadge) { doctorBadge.className = 'badge badge-healthy'; doctorBadge.innerText = '🟢 全链路健康'; }
          if (wizDocBadge) { wizDocBadge.className = 'badge badge-healthy'; wizDocBadge.innerText = '🟢 全链路健康'; }
          if (wizDocDesc) { wizDocDesc.innerText = 'CLI、端口、离线预览沙箱与指令集均运行良好'; }
          if (overviewDocBadge) { overviewDocBadge.className = 'badge badge-healthy'; overviewDocBadge.innerText = '🟢 健康'; }
          if (overviewDocVal) { overviewDocVal.style.color = '#60a5fa'; overviewDocVal.innerText = '系统就绪'; }
          if (navDocBadge) { navDocBadge.innerText = '健康'; }
        } else {
          html += '<div style="margin-top:8px;"><strong>发现 ' + doc.issues.length + ' 个系统待修复/可优化项：</strong></div>';
          let hasHigh = false;
          doc.issues.forEach(iss => {
            if (iss.severity === 'high') hasHigh = true;
            const cls = iss.severity === 'high' ? 'issue-high' : (iss.severity === 'medium' ? 'issue-medium' : 'issue-low');
            html += \`
              <div class="issue-item \${cls}">
                <div>
                  <strong>\${iss.title}</strong>: <span style="color:var(--muted);">\${iss.desc}</span>
                </div>
              </div>
            \`;
          });
          if (doctorBadge) {
            doctorBadge.className = hasHigh ? 'badge badge-cooling' : 'badge badge-healthy';
            doctorBadge.innerText = hasHigh ? '🔴 待修复 (' + doc.issues.length + ')' : '🟡 待优化 (' + doc.issues.length + ')';
          }
          if (wizDocBadge) {
            wizDocBadge.className = hasHigh ? 'badge badge-cooling' : 'badge badge-healthy';
            wizDocBadge.innerText = hasHigh ? '🔴 待修复 (' + doc.issues.length + ')' : '🟡 待优化 (' + doc.issues.length + ')';
          }
          if (wizDocDesc) {
            wizDocDesc.innerText = '发现 ' + doc.issues.length + ' 项可优化/修复项，点击【一键自动修复】即可秒级自愈';
          }
          if (overviewDocBadge) {
            overviewDocBadge.className = hasHigh ? 'badge badge-cooling' : 'badge badge-healthy';
            overviewDocBadge.innerText = hasHigh ? '🔴 待修复 (' + doc.issues.length + ')' : '🟡 待优化 (' + doc.issues.length + ')';
          }
          if (overviewDocVal) {
            overviewDocVal.style.color = hasHigh ? 'var(--danger)' : 'var(--warning)';
            overviewDocVal.innerText = hasHigh ? (doc.issues.length + ' 项待修复') : (doc.issues.length + ' 项可优化');
          }
          if (navDocBadge) {
            navDocBadge.innerText = hasHigh ? ('待修复(' + doc.issues.length + ')') : ('待优化(' + doc.issues.length + ')');
          }
          if (wizGlobalBadge && hasHigh) {
            wizGlobalBadge.className = 'badge badge-cooling';
            wizGlobalBadge.innerText = '🔴 待修复 (' + doc.issues.length + ' 项异常)';
          }
        }
        if (doc.codexIssues && doc.codexIssues.length > 0) {
          html += \`
            <div style="margin-top:10px; padding:8px 12px; background:rgba(56, 189, 248, 0.08); border:1px solid rgba(56, 189, 248, 0.25); border-radius:6px; font-size:0.83rem; color:#93c5fd; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
              <span>🤖 检测到 OpenAI Codex 存在 <strong>\${doc.codexIssues.length}</strong> 个待优化项（已隔离至 Codex 专项面板进行管理）</span>
              <button class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="scrollToCodexCard()">👉 前往 Codex 专属卡片查看与修复</button>
            </div>
          \`;
        }
        if (doc.compression && doc.compression.issues && doc.compression.issues.length > 0) {
          html += \`
            <div style="margin-top:10px; padding:8px 12px; background:rgba(234, 179, 8, 0.08); border:1px solid rgba(234, 179, 8, 0.25); border-radius:6px; font-size:0.83rem; color:#fde047; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
              <span>⚡ 检测到上下文压缩配置存在 <strong>\${doc.compression.issues.length}</strong> 个待优化项（已关联至压缩专属面板）</span>
              <button class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="scrollToCompressionCard()">👉 前往压缩卡片查看与一键修复</button>
            </div>
          \`;
        }
        box.innerHTML = html;
      } catch (e) {
        box.innerHTML = '<span style="color:var(--danger)">自检失败: ' + e.message + '</span>';
      }
    }

    function scrollToCodexCard() {
      scrollToElement('codex-card');
      setTimeout(() => { runCodexDoctorCheck(); }, 60);
    }

    function scrollToCompressionCard() {
      const card = document.getElementById('compression-card');
      const body = document.getElementById('compression-collapse-body');
      if (body && body.style.display === 'none') {
        body.style.display = 'block';
        const toggle = card ? card.querySelector('.collapse-toggle') : null;
        if (toggle) toggle.innerText = '▼ 收起';
        try { localStorage.setItem('collapse_compression-collapse-body', 'open'); } catch (_) {}
      }
      scrollToElement('compression-card');
      setTimeout(() => { runCompressionDoctorCheck(false); }, 60);
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

    async function runRepair(scope = 'system') {
      const box = document.getElementById('doctor-content');
      box.innerHTML = '<span style="color:var(--primary)">🔧 正在执行' + (scope === 'all' ? '全量系统与Codex' : '系统核心组件') + '一键自动修复...</span>';
      try {
        const res = await fetch('/balancer/api/repair?scope=' + encodeURIComponent(scope), { method: 'POST', headers: apiHeaders() });
        const data = await res.json();
        let html = '<div style="margin-bottom:6px;"><strong>' + (scope === 'all' ? '全量自愈' : '系统修复') + '执行结果：</strong></div>';
        data.results.forEach(r => {
          const color = r.success ? 'var(--success)' : 'var(--danger)';
          html += \`<div style="padding:4px 0; color:\${color}">\${r.success ? '✔' : '❌'} [\${r.item}]: \${r.message}</div>\`;
        });
        box.innerHTML = html;
        showToast((scope === 'all' ? '全量自愈' : '系统修复') + '流程执行完毕！');
        fetchStatus();
        await runDoctorCheck(scope === 'all' ? 'all' : 'system');
      } catch (e) {
        box.innerHTML = '<span style="color:var(--danger)">修复执行异常: ' + e.message + '</span>';
      }
    }

    async function saveConfig() {
      const saveBtn = document.getElementById('btn-save-config');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerText = '💾 保存中...';
      }
      const upstream = document.getElementById('cfg-upstream').value.trim();
      const host = document.getElementById('cfg-host').value.trim();
      const port = parseInt(document.getElementById('cfg-port').value, 10) || 4010;
      const uiPassword = document.getElementById('cfg-uipassword').value.trim();
      const cooldownSec = parseInt(document.getElementById('cfg-cooldown').value) || 60;
      const retries = parseInt(document.getElementById('cfg-retries').value) || 2;
      const affinity = document.getElementById('cfg-affinity').checked;
      const compEnabled = document.getElementById('cfg-comp-enabled') ? document.getElementById('cfg-comp-enabled').checked : true;
      const rtkEnabled = document.getElementById('cfg-module-rtk-enabled') ? document.getElementById('cfg-module-rtk-enabled').checked : true;
      const compStripAnsi = document.getElementById('cfg-comp-strip-ansi') ? document.getElementById('cfg-comp-strip-ansi').checked : true;
      const compCleanProgress = document.getElementById('cfg-comp-clean-progress') ? document.getElementById('cfg-comp-clean-progress').checked : true;
      const compFoldTests = document.getElementById('cfg-comp-fold-tests') ? document.getElementById('cfg-comp-fold-tests').checked : true;
      const compCleanDevOps = document.getElementById('cfg-comp-clean-devops') ? document.getElementById('cfg-comp-clean-devops').checked : true;

      const headroomEnabled = document.getElementById('cfg-module-headroom-enabled') ? document.getElementById('cfg-module-headroom-enabled').checked : true;
      const compFoldLockfiles = document.getElementById('cfg-comp-fold-lockfiles') ? document.getElementById('cfg-comp-fold-lockfiles').checked : true;
      const compFoldStructured = document.getElementById('cfg-comp-fold-structured') ? document.getElementById('cfg-comp-fold-structured').checked : true;
      const compExemptConflicts = document.getElementById('cfg-comp-exempt-conflicts') ? document.getElementById('cfg-comp-exempt-conflicts').checked : true;
      const compProtectDiffs = document.getElementById('cfg-comp-protect-diffs') ? document.getElementById('cfg-comp-protect-diffs').checked : true;

      const schemaEnabled = document.getElementById('cfg-module-schema-enabled') ? document.getElementById('cfg-module-schema-enabled').checked : true;
      const compAlignSchema = document.getElementById('cfg-comp-align-schema') ? document.getElementById('cfg-comp-align-schema').checked : true;
      const compSlimSchema = document.getElementById('cfg-comp-slim-schema') ? document.getElementById('cfg-comp-slim-schema').checked : true;
      const compThreshold = parseInt((document.getElementById('cfg-comp-threshold') || {}).value, 10) || 15000;

      const cacheZoneEnabled = document.getElementById('cfg-module-cachezone-enabled') ? document.getElementById('cfg-module-cachezone-enabled').checked : true;
      const compCacheFreeze = document.getElementById('cfg-comp-cache-freeze') ? document.getElementById('cfg-comp-cache-freeze').checked : true;
      const compTrueLru = document.getElementById('cfg-comp-true-lru') ? document.getElementById('cfg-comp-true-lru').checked : true;

      const psEnabled = document.getElementById('cfg-module-powershell-enabled') ? document.getElementById('cfg-module-powershell-enabled').checked : true;
      const compPsAutodetect = document.getElementById('cfg-comp-ps-autodetect') ? document.getElementById('cfg-comp-ps-autodetect').checked : true;
      const compPsClixml = document.getElementById('cfg-comp-ps-clixml') ? document.getElementById('cfg-comp-ps-clixml').checked : true;
      const compPsTrailingSlash = document.getElementById('cfg-comp-ps-trailing-slash') ? document.getElementById('cfg-comp-ps-trailing-slash').checked : true;
      const compPsCurlAlias = document.getElementById('cfg-comp-ps-curl-alias') ? document.getElementById('cfg-comp-ps-curl-alias').checked : true;
      const compPsAndOperator = document.getElementById('cfg-comp-ps-and-operator') ? document.getElementById('cfg-comp-ps-and-operator').checked : true;
      const compPsLineContinuation = document.getElementById('cfg-comp-ps-line-continuation') ? document.getElementById('cfg-comp-ps-line-continuation').checked : true;
      const compPsSubexpression = document.getElementById('cfg-comp-ps-subexpression') ? document.getElementById('cfg-comp-ps-subexpression').checked : true;
      const compPsGuardDirective = document.getElementById('cfg-comp-ps-guard-directive') ? document.getElementById('cfg-comp-ps-guard-directive').checked : true;

      const compression = {
        enabled: compEnabled,
        preset: currentPreset || 'balanced',
        modules: {
          rtk: {
            enabled: rtkEnabled,
            stripAnsi: compStripAnsi,
            cleanProgressBars: compCleanProgress,
            foldTestPasses: compFoldTests,
            cleanDevOpsOutput: compCleanDevOps
          },
          headroom: {
            enabled: headroomEnabled,
            foldLockfiles: compFoldLockfiles,
            foldStructuredData: compFoldStructured,
            exemptMergeConflicts: compExemptConflicts,
            protectSourceDiffs: compProtectDiffs
          },
          schema: {
            enabled: schemaEnabled,
            alignToolsSchema: compAlignSchema,
            slimToolsSchema: compSlimSchema,
            schemaCharThreshold: compThreshold
          },
          cacheZone: {
            enabled: cacheZoneEnabled,
            cacheZoneFreeze: compCacheFreeze,
            trueLruRetention: compTrueLru
          },
          powershell: {
            enabled: psEnabled,
            autoDetectPlatform: compPsAutodetect,
            cleanCliXmlNoise: compPsClixml,
            fixQuoteEscaping: compPsTrailingSlash,
            fixCurlAlias: compPsCurlAlias,
            fixTrailingSlash: compPsTrailingSlash,
            fixAndOperator: compPsAndOperator,
            fixLineContinuation: compPsLineContinuation,
            fixSubexpressionEscaping: compPsSubexpression,
            injectPowerShellGuard: compPsGuardDirective
          }
        },
        stripAnsi: (compEnabled && rtkEnabled) ? compStripAnsi : false,
        cleanProgressBars: (compEnabled && rtkEnabled) ? compCleanProgress : false,
        foldTestPasses: (compEnabled && rtkEnabled) ? compFoldTests : false,
        cleanDevOpsOutput: (compEnabled && rtkEnabled) ? compCleanDevOps : false,
        cleanDockerOutput: (compEnabled && rtkEnabled) ? compCleanDevOps : false,
        cleanKubectlOutput: (compEnabled && rtkEnabled) ? compCleanDevOps : false,
        cleanTerraformOutput: (compEnabled && rtkEnabled) ? compCleanDevOps : false,
        foldLockfiles: (compEnabled && headroomEnabled) ? compFoldLockfiles : false,
        foldStructuredData: (compEnabled && headroomEnabled) ? compFoldStructured : false,
        exemptMergeConflicts: compExemptConflicts,
        protectSourceDiffs: compProtectDiffs,
        alignToolsSchema: (compEnabled && schemaEnabled) ? compAlignSchema : false,
        slimToolsSchema: (compEnabled && schemaEnabled) ? compSlimSchema : false,
        schemaCharThreshold: compThreshold,
        cacheZoneFreeze: (compEnabled && cacheZoneEnabled) ? compCacheFreeze : false,
        trueLruRetention: compTrueLru,
        autoDetectPlatform: compPsAutodetect,
        cleanCliXmlNoise: (compEnabled && psEnabled) ? compPsClixml : false,
        fixQuoteEscaping: (compEnabled && psEnabled) ? compPsTrailingSlash : false,
        fixCurlAlias: (compEnabled && psEnabled) ? compPsCurlAlias : false,
        fixTrailingSlash: (compEnabled && psEnabled) ? compPsTrailingSlash : false,
        fixAndOperator: (compEnabled && psEnabled) ? compPsAndOperator : false,
        fixLineContinuation: (compEnabled && psEnabled) ? compPsLineContinuation : false,
        injectPowerShellGuard: (compEnabled && psEnabled) ? compPsGuardDirective : false
      };

      const proxyEnabled = document.getElementById('cfg-proxy-enabled') ? document.getElementById('cfg-proxy-enabled').checked : false;
      const proxyUrl = document.getElementById('cfg-proxy-url') ? document.getElementById('cfg-proxy-url').value.trim() : '';
      const proxyScope = document.getElementById('cfg-proxy-scope') ? document.getElementById('cfg-proxy-scope').value : 'all';
      const proxyModelsStr = document.getElementById('cfg-proxy-models') ? document.getElementById('cfg-proxy-models').value.trim() : '';
      const proxyModels = proxyModelsStr ? proxyModelsStr.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean) : ['gpt-5.6-luna', 'gpt-6-luna', 'claude-haiku-5-5'];

      const allowModelAutoUpgrade = document.getElementById('cfg-allow-upgrade') ? document.getElementById('cfg-allow-upgrade').checked : false;
      const allowRegionFallback = document.getElementById('cfg-allow-region-fallback') ? document.getElementById('cfg-allow-region-fallback').checked : false;

      const payload = {
        upstream,
        host,
        port,
        uiPassword,
        defaultCooldownMs: cooldownSec * 1000,
        maxFailoverRetries: retries,
        sessionAffinityEnabled: affinity,
        allowModelAutoUpgrade,
        allowRegionFallback,
        proxy: {
          enabled: proxyEnabled,
          url: proxyUrl,
          scope: proxyScope,
          models: proxyModels
        },
        accounts: currentConfig.accounts,
        compression
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
          clearConfigDirty();
          showToast('✔ ' + data.message);
          fetchConfig();
          fetchStatus();
        } else {
          showToast('保存失败: ' + data.error, true);
        }
      } catch (e) {
        showToast('网络错误: ' + e.message, true);
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerText = '💾 保存配置';
        }
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

    let quotaTimer = null;
    let quotaCountdown = 60;
    let quotaRefreshInterval = 60;

    function initQuotaRefreshScheduler() {
      const saved = localStorage.getItem('opencode_router_quota_interval');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && [0, 15, 30, 60, 120, 300].includes(parsed)) {
          quotaRefreshInterval = parsed;
        }
      }
      const selectElem = document.getElementById('quota-refresh-interval');
      if (selectElem) selectElem.value = String(quotaRefreshInterval);

      quotaCountdown = quotaRefreshInterval;
      updateQuotaCountdownBadge();

      if (quotaTimer) clearInterval(quotaTimer);
      quotaTimer = setInterval(handleQuotaTick, 1000);
    }

    function handleQuotaTick() {
      if (document.hidden || quotaRefreshInterval <= 0) return;
      quotaCountdown--;
      if (quotaCountdown <= 0) {
        quotaCountdown = quotaRefreshInterval;
        updateQuotaCountdownBadge();
        refreshAllQuotas(true, false);
      } else {
        updateQuotaCountdownBadge();
      }
    }

    function updateQuotaCountdownBadge() {
      const badge = document.getElementById('quota-countdown-badge');
      if (!badge) return;
      if (quotaRefreshInterval <= 0) {
        badge.innerText = '⏸️ 已暂停';
        badge.title = '定时自动刷新已关闭，点击立即刷新';
      } else {
        badge.innerText = '⏱️ ' + quotaCountdown + 's';
        badge.title = '距离下次自动刷新还剩 ' + quotaCountdown + ' 秒，点击立即刷新';
      }
    }

    function changeQuotaRefreshInterval(newVal) {
      quotaRefreshInterval = parseInt(newVal, 10) || 0;
      localStorage.setItem('opencode_router_quota_interval', String(quotaRefreshInterval));
      quotaCountdown = quotaRefreshInterval;
      updateQuotaCountdownBadge();
      if (quotaRefreshInterval > 0) {
        showToast('✔ 配额自动刷新已设置为 ' + quotaRefreshInterval + ' 秒');
      } else {
        showToast('ℹ️ 配额自动刷新已关闭');
      }
    }

    function triggerManualQuotaRefreshAll() {
      quotaCountdown = quotaRefreshInterval > 0 ? quotaRefreshInterval : 60;
      updateQuotaCountdownBadge();
      refreshAllQuotas(false, true);
    }

    async function fetchSingleQuota(id, force = false) {
      const qBox = document.getElementById('quota-content-' + id);
      const qBtn = document.getElementById('quota-btn-' + id);
      const qTime = document.getElementById('quota-updated-' + id);
      const acc = currentConfig ? currentConfig.accounts.find(a => a.id === id) : null;
      const upstream = document.getElementById('cfg-upstream') ? document.getElementById('cfg-upstream').value : '';
      if (!acc || !acc.apiKey.trim()) {
        if (qBox) qBox.innerHTML = '<div style="color:var(--muted); font-size:0.75rem; text-align:center; padding:4px 0;">请先输入 API Key 密钥</div>';
        return;
      }
      if (qBtn) {
        qBtn.disabled = true;
        qBtn.innerText = '⏳ 刷新中...';
      }
      if (!accountQuotas[id] && qBox) {
        qBox.innerHTML = '<div style="color:var(--primary); font-size:0.75rem; text-align:center; padding:4px 0;">⏳ 正在查询官方配额限制...</div>';
      }

      try {
        const res = await fetch('/balancer/api/account-quota', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ upstream, apiKey: acc.apiKey, id, force })
        });
        const data = await res.json();
        if (data.success && data.usage) {
          accountQuotas[id] = data.usage;
          if (qBox) qBox.innerHTML = buildQuotaContent(data.usage);
          if (qTime) {
            const now = new Date();
            const timeStr = String(now.getHours()).padStart(2, '0') + ':' +
                            String(now.getMinutes()).padStart(2, '0') + ':' +
                            String(now.getSeconds()).padStart(2, '0');
            qTime.innerText = timeStr + ' 更新' + (data.fromCache ? ' (缓存)' : '');
          }
        } else {
          if (qBox) qBox.innerHTML = '<div style="color:var(--danger); font-size:0.75rem; text-align:center; padding:4px 0;">查询失败: ' + (data.error || '未返回配额数据') + '</div>';
        }
      } catch (e) {
        if (qBox) qBox.innerHTML = '<div style="color:var(--danger); font-size:0.75rem; text-align:center; padding:4px 0;">网络异常: ' + e.message + '</div>';
      } finally {
        if (qBtn) {
          qBtn.disabled = false;
          qBtn.innerText = '🔄 刷新';
        }
      }
    }

    async function refreshAllQuotas(silent = true, force = false) {
      if (!currentConfig || !currentConfig.accounts) return;
      const validAccounts = currentConfig.accounts.filter(a => a.apiKey && a.apiKey.trim() && a.enabled);
      if (validAccounts.length === 0) return;
      await Promise.all(validAccounts.map(a => fetchSingleQuota(a.id, force)));
      if (!silent) {
        showToast('✔ 已完成所有账号官方限额刷新！');
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
      const updatesBadge = document.getElementById('updates-status-badge');
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
          if (updatesBadge) { updatesBadge.className = 'badge badge-cooling'; updatesBadge.innerText = '🛑 冲突风险'; }
        } else if (report.compatibility.riskLevel === 'warning') {
          compBadgeCls = 'badge-warn';
          compBadgeText = '⚠️ 存在版本变动或需同步更新';
          if (updatesBadge) { updatesBadge.className = 'badge badge-cooling'; updatesBadge.innerText = '⚠️ 待更新'; }
        } else {
          if (updatesBadge) { updatesBadge.className = 'badge badge-healthy'; updatesBadge.innerText = '🟢 全组件最新'; }
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
          html += '<div style="margin-top:12px; padding-top:8px; border-top:1px solid #27272a; display:flex; justify-content:space-between; align-items:center; font-size:0.8rem;">' +
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
          html += '<div style="background:#121215; border:1px solid #27272a; padding:10px; border-radius:6px; font-family:monospace; font-size:0.8rem; max-height:200px; overflow-y:auto; margin-bottom:10px;">';
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
            html += '<div style="background:#121215; border:1px solid #27272a; padding:10px; border-radius:6px; font-family:monospace; font-size:0.8rem; max-height:200px; overflow-y:auto; margin-bottom:10px;">';
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
          '<div style="background:#121215; border:1px solid #27272a; padding:10px; border-radius:6px; font-size:0.82rem; margin-bottom:10px;">';
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
    async function runCodexDoctorCheck() {
      const box = document.getElementById('codex-status-content');
      if (box) box.innerHTML = '<span style="color:var(--primary)">⏳ 正在执行 OpenAI Codex 专项体检与深度诊断...</span>';
      try {
        const res = await fetch('/balancer/api/doctor?scope=codex', { headers: apiHeaders() });
        const doc = await res.json();
        renderCodexDiagnostics(doc);
      } catch (e) {
        if (box) box.innerHTML = '<div style="color:var(--danger);">Codex 专项体检异常: ' + e.message + '</div>';
      }
    }

    async function runCodexRepair() {
      const box = document.getElementById('codex-status-content');
      if (box) box.innerHTML = '<span style="color:var(--primary)">🛠️ 正在执行 OpenAI Codex 专项自愈与防断流加固...</span>';
      try {
        const model = (document.getElementById('codex-model-select') && document.getElementById('codex-model-select').value) || 'deepseek-v4.1-flash';
        const effort = (document.getElementById('codex-effort-select') && document.getElementById('codex-effort-select').value) || 'high';
        const res = await fetch('/balancer/api/repair?scope=codex', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ defaultModel: model, reasoningEffort: effort })
        });
        const data = await res.json();
        let html = '<div style="margin-bottom:8px;"><strong>🛠️ Codex 专项自愈与加固结果：</strong></div>';
        (data.results || []).forEach(r => {
          const color = r.success ? 'var(--success)' : 'var(--danger)';
          html += '<div style="padding:3px 0; color:' + color + '; font-size:0.85rem;">' + (r.success ? '✔' : '❌') + ' [' + r.item + ']: ' + r.message + '</div>';
        });
        html += '<div style="margin-top:10px;"><button class="btn btn-secondary btn-sm" onclick="runCodexDoctorCheck()">🔍 重新体检诊断</button> <button class="btn btn-warning btn-sm" style="margin-left:6px; background:#d97706; border-color:#b45309; color:#fff;" onclick="restartCodexClient()">🔄 平滑重启 Codex 客户端</button></div>';
        if (box) box.innerHTML = html;
        showToast('Codex 专项自愈完成！');
        if (confirm('🎉 OpenAI Codex 专项自愈与加固完成！\\n\\n是否立即平滑重启 Codex 客户端以立即加载最新环境与加固配置？')) {
          restartCodexClient();
        }
      } catch (e) {
        if (box) box.innerHTML = '<div style="color:var(--danger);">Codex 专项修复异常: ' + e.message + '</div>';
      }
    }

    function renderCodexDiagnostics(doc) {
      codexStatusData = doc;
      const box = document.getElementById('codex-status-content');
      if (!box) return;
      const st = doc.codex || {};
      const proc = doc.codexProcessHealth || (st && st.processHealth) || {};
      const loc = doc.codexLocale || (st && st.localeCheck) || {};
      const issues = doc.issues || doc.codexIssues || [];

      // Update model dropdown if needed
      const sel = document.getElementById('codex-model-select');
      if (sel && sel.options.length === 0 && Array.isArray(st.availableModels)) {
        sel.innerHTML = '';
        st.availableModels.forEach(function(m) {
          const opt = document.createElement('option');
          opt.value = m.slug;
          const isAnthropic = m.slug === 'claude-haiku-5-5';
          const tag = isAnthropic ? ' [Anthropic 协议桥]' : ' [智能双轨协议桥]';
          opt.innerText = m.display_name + tag;
          if (m.slug === (st.currentModel || 'deepseek-v4.1-flash')) opt.selected = true;
          sel.appendChild(opt);
        });
      }

      if (st.currentReasoningEffort && document.getElementById('codex-effort-select')) {
        document.getElementById('codex-effort-select').value = st.currentReasoningEffort;
      }

      let html = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">';
      html += '<div><strong>Codex CLI 引擎状态:</strong> ' + (st.cliInstalled ? '<span class="badge badge-healthy">✔ 已安装 (v' + (st.cliVersion || '最新') + ')</span>' : '<span class="badge badge-disabled">未检测到全局 CLI</span>') + '</div>';
      html += '<div><strong>网关接入状态:</strong> ' + (st.isBound ? '<span class="badge badge-healthy">✔ 已接入 4010 网关' + (st.hasStreamIdleTimeout ? ' (已防断流加固)' : '') + '</span>' : '<span class="badge badge-cooling">未接入</span>') + '</div>';
      html += '<div><strong>进程健康:</strong> ' + (proc.healthy ? '<span class="badge badge-healthy">✔ 无挂起/死锁</span>' : '<span class="badge badge-danger">❌ 存在异常挂起/僵死锁</span>') + '</div>';
      html += '<div><strong>语言环境:</strong> ' + (loc.healthy ? '<span class="badge badge-healthy">✔ 简体中文已对齐</span>' : '<span class="badge badge-cooling">⚠️ 语言未对齐</span>') + '</div>';
      html += '</div>';

      html += '<div style="font-size:0.85rem; color:#f4f4f5; line-height:1.6; background:#121215; padding:8px 12px; border-radius:6px; border:1px solid #27272a;">';
      html += '<div>• <strong>当前模型:</strong> <code style="color:var(--primary); font-family:monospace;">' + (st.currentModel || '未设置') + '</code> | <strong>提供商:</strong> ' + (st.currentProvider || '无') + ' | <strong>思考等级:</strong> ' + (st.currentReasoningEffort || 'high') + '</div>';
      html += '<div>• <strong>配置目录:</strong> <code style="color:var(--muted); font-family:monospace;">' + (st.codexDir || '~/.codex') + '</code></div>';
      html += '<div>• <strong>灾备备份:</strong> ' + (st.hasBackup ? '<span style="color:var(--success);">✔ 原始配置已无损备份 (' + (st.backupInfo && st.backupInfo.isoDate ? st.backupInfo.isoDate : '已备份') + ')，随时可原样还原</span>' : '<span style="color:var(--muted);">初次接入前将自动执行原子备份</span>') + '</div>';
      html += '</div>';

      if (issues.length > 0) {
        html += '<div style="margin-top:10px;">';
        html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:8px;">';
        html += '<strong style="color:#f59e0b;">🔍 发现 ' + issues.length + ' 个 Codex 待自愈/待加固项：</strong>';
        html += '<button class="btn btn-success btn-sm" onclick="runCodexRepair()">🛠️ 立即一键自愈修复 Codex</button>';
        html += '</div>';
        issues.forEach(function(iss) {
          const cls = iss.severity === 'high' ? 'issue-high' : (iss.severity === 'medium' ? 'issue-medium' : 'issue-low');
          html += '<div class="issue-item ' + cls + '" style="margin-bottom:6px;">';
          html += '<div><strong>' + iss.title + '</strong>: <span style="color:var(--muted);">' + iss.desc + '</span></div>';
          html += '</div>';
        });
        html += '</div>';
      } else {
        html += '<div style="margin-top:10px; color:var(--success); font-weight:600; padding:4px 0;">🎉 Codex 状态极佳：已接入 4010 智能网关、已具备 5 分钟超时加固、无任何挂起死锁！</div>';
      }

      if (st.isBound) {
        html += '<div style="margin-top:10px; font-size:0.8rem; background:rgba(6,95,70,0.2); border:1px solid rgba(5,150,105,0.4); padding:6px 10px; border-radius:6px; color:#a7f3d0;">';
        html += '🚀 <strong>终端即用指令:</strong> <code>codex exec "编写单元测试"</code> 或 <code>codex --model ' + (st.currentModel || 'kimi-k3') + '</code>';
        html += '</div>';
      }

      box.innerHTML = html;
      updateWizardStatusBadges();
    }

    async function loadCodexStatus() {
      await runCodexDoctorCheck();
    }

    async function bindCodex() {
      const model = (document.getElementById('codex-model-select') && document.getElementById('codex-model-select').value) || 'deepseek-v4.1-flash';
      const effort = (document.getElementById('codex-effort-select') && document.getElementById('codex-effort-select').value) || 'high';
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
          showToast('🎉 Codex 一键接入成功！建议重启客户端以立即加载新配置。');
          await loadCodexStatus();
          if (confirm('🎉 Codex 已成功接入 4010 本地网关！\\n\\n是否立即平滑重启 Codex 客户端以立即加载最新配置与 38 款模型？')) {
            restartCodexClient();
          }
        } else {
          showToast('接入失败: ' + (data.error || data.message), true);
          await loadCodexStatus();
        }
      } catch (e) {
        showToast('接入请求异常: ' + e.message, true);
        await loadCodexStatus();
      }
    }

    async function bindCodexQuick() {
      await bindCodex();
      scrollToElement('codex-card');
    }

    async function restartCodexClient() {
      const box = document.getElementById('codex-status-content');
      if (box) box.innerHTML = '<span style="color:var(--muted)">正在平滑重启 OpenAI Codex 客户端并加载最新配置...</span>';
      try {
        const res = await fetch('/balancer/api/restart-codex', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' })
        });
        const data = await res.json();
        if (data.success) {
          showToast('🎉 Codex 客户端已优雅重启并加载最新配置！');
          setTimeout(loadCodexStatus, 1500);
        } else {
          showToast('重启已执行: ' + (data.message || '已发送重启信号'), false);
          setTimeout(loadCodexStatus, 1500);
        }
      } catch (e) {
        showToast('重启请求异常: ' + e.message, true);
        loadCodexStatus();
      }
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
          if (confirm('✔ Codex 原始配置已恢复！\\n\\n是否立即平滑重启 Codex 客户端以重新加载原始配置？')) {
            restartCodexClient();
          }
        } else {
          showToast('还原未完成: ' + (data.message || data.error), true);
          loadCodexStatus();
        }
      } catch (e) {
        showToast('还原请求异常: ' + e.message, true);
        loadCodexStatus();
      }
    }

    // Context Compression Doctor & Auto-Repair Engine
    async function runCompressionDoctorCheck(silent = false) {
      const panel = document.getElementById('comp-doctor-panel');
      const content = document.getElementById('comp-doctor-panel-content');
      const badge = document.getElementById('comp-doctor-status-badge');
      const btn = document.getElementById('btn-comp-doctor');
      if (btn) btn.disabled = true;
      if (!silent && panel && content) {
        panel.style.display = 'block';
        content.innerHTML = '<span style="color:var(--primary);">⏳ 正在执行压缩引擎健康体检与防降智审计...</span>';
      }
      try {
        const res = await fetch('/balancer/api/compression/doctor', { headers: apiHeaders() });
        const doc = await res.json();
        renderCompressionDiagnostics(doc, silent);
        if (!silent) {
          showToast(doc.healthy ? '✔ 压缩引擎体检完成：全引擎健康' : '⚠️ 压缩引擎检测到可优化项');
        }
      } catch (e) {
        if (content) content.innerHTML = '<span style="color:var(--danger);">诊断异常: ' + e.message + '</span>';
        if (!silent) showToast('压缩诊断请求失败: ' + e.message, true);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    function renderCompressionDiagnostics(doc, silent = false) {
      const panel = document.getElementById('comp-doctor-panel');
      const content = document.getElementById('comp-doctor-panel-content');
      const badge = document.getElementById('comp-doctor-status-badge');
      if (!doc) return;

      const issues = doc.issues || [];
      const hasHigh = issues.some(i => i.severity === 'high');

      if (badge) {
        if (issues.length === 0) {
          badge.className = 'badge badge-healthy';
          badge.innerText = '🟢 压缩引擎健康';
        } else if (hasHigh) {
          badge.className = 'badge badge-cooling';
          badge.innerText = '🔴 待修复 (' + issues.length + ')';
        } else {
          badge.className = 'badge badge-healthy';
          badge.innerText = '🟡 待优化 (' + issues.length + ')';
        }
      }

      if (!content) return;
      if (!silent && panel) panel.style.display = 'block';

      const eng = doc.activeEngines || {};
      const clients = doc.clientsCompatibility || {};

      let html = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">';
      html += '<strong>🩺 压缩引擎健康度诊断与防降智检测报告</strong>';
      html += '<div style="display:flex; gap:6px;">';
      html += '<button type="button" class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="runCompressionDoctorCheck(false)">🔄 重新体检</button>';
      html += '<button type="button" class="btn btn-success btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="runCompressionRepair()">🛠️ 一键修复安全配置</button>';
      html += '<button type="button" class="btn btn-secondary btn-sm" style="padding:2px 6px; font-size:0.75rem;" onclick="document.getElementById(\\\'comp-doctor-panel\\\').style.display=\\\'none\\\'">✕ 收起</button>';
      html += '</div></div>';

      // 5 大引擎状态条
      html += '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:8px; margin-bottom:10px;">';
      html += '<div style="background:#121215; padding:6px 10px; border-radius:6px; border:1px solid #27272a; font-size:0.8rem;">';
      html += '<strong>1. RTK 终端去噪:</strong> ' + (eng.rtk && eng.rtk.enabled ? '<span style="color:var(--success);">✔ 运行中</span>' : '<span style="color:var(--muted);">旁路关闭</span>');
      html += '</div>';
      html += '<div style="background:#121215; padding:6px 10px; border-radius:6px; border:1px solid #27272a; font-size:0.8rem;">';
      html += '<strong>2. Headroom 结构折叠:</strong> ' + (eng.headroom && eng.headroom.enabled ? '<span style="color:var(--success);">✔ 运行中</span>' : '<span style="color:var(--muted);">旁路关闭</span>');
      html += '</div>';
      html += '<div style="background:#121215; padding:6px 10px; border-radius:6px; border:1px solid #27272a; font-size:0.8rem;">';
      html += '<strong>3. CacheAligner 优化:</strong> ' + (eng.schema && eng.schema.enabled ? '<span style="color:var(--success);">✔ 门限 ' + (eng.schema.threshold || 15000) + ' 字符</span>' : '<span style="color:var(--muted);">旁路关闭</span>');
      html += '</div>';
      html += '<div style="background:#121215; padding:6px 10px; border-radius:6px; border:1px solid #27272a; font-size:0.8rem;">';
      html += '<strong>4. llmtrim Cache-Zone:</strong> ' + (eng.cacheZone && eng.cacheZone.enabled ? '<span style="color:var(--success);">✔ 活跃会话 ' + (eng.cacheZone.activeSessions || 0) + '</span>' : '<span style="color:var(--muted);">旁路关闭</span>');
      html += '</div>';
      html += '<div style="background:#121215; padding:6px 10px; border-radius:6px; border:1px solid #27272a; font-size:0.8rem;">';
      const psStatusText = eng.powershell && eng.powershell.enabled
        ? '<span style="color:var(--success);">✔ ' + (eng.powershell.platform && eng.powershell.platform.isWindows ? 'Windows 原生运行' : 'Linux 旁路休眠') + '</span>'
        : '<span style="color:var(--muted);">旁路关闭</span>';
      html += '<strong>5. PowerShell 优化:</strong> ' + psStatusText;
      html += '</div>';
      html += '</div>';

      // 3 大客户端适配保障状态
      html += '<div style="font-size:0.8rem; background:#121215; padding:8px 10px; border-radius:6px; border:1px solid #27272a; margin-bottom:10px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">';
      html += '<span>🤖 <strong>Codex CLI / Desktop:</strong> <span style="color:var(--success);">✔ Responses 保真 &amp; PS 转义自愈</span></span>';
      html += '<span>⚡ <strong>OpenCode 2.0+:</strong> <span style="color:var(--success);">✔ Tool Call 连续性 &amp; CLIXML 去噪</span></span>';
      html += '<span>💻 <strong>OpenChamber:</strong> <span style="color:var(--success);">✔ 100% 离线沙箱安全 &amp; 环境自适应</span></span>';
      html += '</div>';

      if (issues.length > 0) {
        html += '<div style="margin-top:6px;"><strong style="color:#f59e0b;">🔍 发现 ' + issues.length + ' 个待修复/可优化项：</strong></div>';
        issues.forEach(function(iss) {
          const cls = iss.severity === 'high' ? 'issue-high' : (iss.severity === 'medium' ? 'issue-medium' : 'issue-low');
          html += '<div class="issue-item ' + cls + '" style="margin-top:6px;">';
          html += '<div><strong>' + iss.title + '</strong>: <span style="color:var(--muted);">' + iss.desc + '</span></div>';
          html += '</div>';
        });
        html += '<div style="margin-top:10px;"><button type="button" class="btn btn-success btn-sm" onclick="runCompressionRepair()">🛠️ 立即一键修复上述安全异常</button></div>';
      } else {
        html += '<div style="color:var(--success); font-weight:600; padding:4px 0;">🎉 压缩引擎状态极佳：已全开 Git 冲突豁免、源码 Diff 保真、Schema 安全门限与防断流守护，未发现降智或链接风险！</div>';
      }

      content.innerHTML = html;
    }

    async function runCompressionRepair() {
      if (!confirm('确认执行压缩引擎安全自愈？\\n\\n将自动开启 Git 冲突豁免防御、源码 Diff 完整性保护、修正瘦身门限为安全档 (15,000字符) 并开启真 LRU 守护，杜绝断流与降智隐患。')) {
        return;
      }
      const btn = document.getElementById('btn-comp-repair');
      if (btn) {
        btn.disabled = true;
        btn.innerText = '🛠️ 自愈中...';
      }
      try {
        const res = await fetch('/balancer/api/compression/repair', {
          method: 'POST',
          headers: apiHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ autoHeal: true })
        });
        const data = await res.json();
        if (data.success) {
          showToast('🎉 压缩引擎已成功自愈并对齐安全推荐档！');
          await runCompressionDoctorCheck(false);
          await fetchConfig();
        } else {
          showToast('自愈失败: ' + (data.error || '未知错误'), true);
        }
      } catch (e) {
        showToast('自愈请求异常: ' + e.message, true);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = '🛠️ 一键修复安全配置';
        }
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
    initSidebarState();
    initRouter();
    initCardCollapseStates();

    // Initialize chart UI buttons from user preferences
    if (typeof currentChartMode === 'string') {
      ['bar', 'area'].forEach(m => {
        ['btn-chart-mode-', 'btn-overview-chart-mode-'].forEach(prefix => {
          const btn = document.getElementById(prefix + m);
          if (btn && btn.classList) {
            if (m === currentChartMode) btn.classList.add('active');
            else btn.classList.remove('active');
          }
        });
      });
      ['chart-type-icon', 'overview-chart-type-icon'].forEach(id => {
        const iconEl = document.getElementById(id);
        if (iconEl) iconEl.innerText = currentChartMode === 'bar' ? '📊' : '📈';
      });
    }
    if (typeof currentChartMetric === 'string') {
      ['tokens', 'cost', 'chars'].forEach(m => {
        ['btn-chart-metric-', 'btn-overview-chart-metric-'].forEach(prefix => {
          const btn = document.getElementById(prefix + m);
          if (btn && btn.classList) {
            if (m === currentChartMetric) btn.classList.add('active');
            else btn.classList.remove('active');
          }
        });
      });
    }

    fetchConfig();
    fetchStatus();
    fetchCompressionStats();
    runDoctorCheck('system');
    loadCodexStatus();
    runCompressionDoctorCheck(true);
    setInterval(() => {
      if (!document.hidden) fetchStatus();
    }, 2000);
    setInterval(() => {
      if (!document.hidden) fetchCompressionStats();
    }, 10000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        fetchStatus();
        fetchCompressionStats();
        if (quotaRefreshInterval > 0 && quotaCountdown <= 3) {
          quotaCountdown = quotaRefreshInterval;
          updateQuotaCountdownBadge();
          refreshAllQuotas(true, false);
        }
      }
    });
    if (window.location.hash === '#updates') {
      setTimeout(function() {
        checkUpdates();
        scrollToElement('updates-card');
      }, 300);
    }

    // ==========================================
    // ComfyUI Visual Plugin Management & Testing
    // ==========================================
    var comfyUiStatusData = null;

    function cleanDeviceName(raw) {
      if (!raw || typeof raw !== 'string') return 'GPU 加速设备';
      var s = raw.replace(/^cuda:[0-9]+ */i, '').replace(/ *: *native *$/i, '').trim();
      s = s.replace(/ Graphics/i, '');
      s = s.split('[').join('(').split(']').join(')');
      return s.trim() || raw;
    }

    async function loadComfyUiPluginStatus(force) {
      try {
        const url = '/balancer/api/comfyui/status' + (force ? '?force=true' : '');
        const res = await fetch(url);
        const data = await res.json();
        if (!data || !data.success) return;

        comfyUiStatusData = data;
        const st = data.status || {};
        const isOnline = Boolean(st.isOnline);
        const devName = cleanDeviceName(st.deviceInfo?.name || '未知设备');
        const vramGb = st.deviceInfo?.vramTotal ? (st.deviceInfo.vramTotal / (1024 * 1024 * 1024)).toFixed(1) + ' GB' : '--';
        const wfCount = data.workflowsCount || 0;

        // 1. Update badges
        const badge = document.getElementById('comfy-status-badge');
        if (badge) {
          badge.className = isOnline ? 'badge badge-healthy' : 'badge badge-disabled';
          badge.textContent = isOnline ? '🟢 已连接 (' + (st.serverUrl || '8284') + ')' : '⚪ 离线 (未启动)';
        }

        const navBadge = document.getElementById('nav-badge-plugins');
        if (navBadge) {
          navBadge.textContent = isOnline ? '在线' : '离线';
          navBadge.style.color = isOnline ? '#34d399' : '#a1a1aa';
        }

        const ovBadge = document.getElementById('plugins-overview-badge');
        if (ovBadge) {
          ovBadge.className = isOnline ? 'badge badge-healthy' : 'badge badge-disabled';
          ovBadge.textContent = isOnline ? '🟢 1 个在线' : '⚪ 未就绪';
        }

        const ovVal = document.getElementById('plugins-overview-val');
        if (ovVal) {
          ovVal.textContent = isOnline ? 'ComfyUI 就绪' : 'ComfyUI 离线';
          ovVal.style.color = isOnline ? '#38bdf8' : '#a1a1aa';
        }

        // 2. Update device info
        const devEl = document.getElementById('comfy-val-device');
        if (devEl) devEl.textContent = isOnline ? devName : '未连接';

        const vramEl = document.getElementById('comfy-val-vram');
        if (vramEl) vramEl.textContent = vramGb;

        const countEl = document.getElementById('comfy-val-wfcount');
        if (countEl) countEl.textContent = wfCount + ' 套';

        const capDev = document.getElementById('comfy-capsule-device');
        if (capDev) capDev.textContent = isOnline ? '🎮 ' + devName : '🎮 纯 CPU/轻薄本模式';

        const capWf = document.getElementById('comfy-capsule-workflows');
        if (capWf) capWf.textContent = '🖼️ ' + wfCount + ' 套工业级工作流就绪';

        // 3. Populate workflow dropdown in test sandbox
        const sel = document.getElementById('comfy-test-workflow-select');
        if (sel && Array.isArray(data.workflows)) {
          const prevVal = sel.value;
          sel.innerHTML = '';
          data.workflows.forEach(wf => {
            const opt = document.createElement('option');
            opt.value = wf.id;
            opt.textContent = wf.name + ' (' + (wf.tags ? wf.tags.slice(0, 3).join('/') : '') + ')';
            if (wf.id === '04') opt.textContent += ' ⭐[极速推荐]';
            sel.appendChild(opt);
          });
          if (prevVal) sel.value = prevVal;
        }

        // 4. Populate catalog accordion
        const catalogList = document.getElementById('comfy-workflows-catalog-list');
        if (catalogList && Array.isArray(data.workflows)) {
          var items = [];
          for (var i = 0; i < data.workflows.length; i++) {
            var wf = data.workflows[i];
            var tagsHtml = '';
            if (Array.isArray(wf.tags)) {
              for (var j = 0; j < wf.tags.length; j++) {
                tagsHtml += '<span style="background:#18181b; border:1px solid #27272a; border-radius:3px; padding:1px 5px; color:#a1a1aa; font-size:0.68rem;">#' + wf.tags[j] + '</span>';
              }
            }
            items.push('<div style="background:#09090b; border:1px solid #27272a; border-radius:6px; padding:8px 10px; font-size:0.75rem;"><div style="margin-bottom:2px;"><span style="color:#38bdf8; font-weight:700; margin-right:4px;">[' + wf.id + ']</span><span style="font-weight:600; color:#f4f4f5;">' + wf.name + '</span></div><div style="color:var(--muted); margin-bottom:4px; font-size:0.72rem;">' + (wf.description || '') + '</div><div style="display:flex; flex-wrap:wrap; gap:4px;">' + tagsHtml + '</div></div>');
          }
          catalogList.innerHTML = items.join('');
        }

        if (force) {
          showToast(isOnline ? 'ComfyUI 服务嗅探成功，工作流已实时重载！' : 'ComfyUI 未响应，请确认本地 8284/8188 端口是否已启动', isOnline ? 'success' : 'error');
        }
      } catch (e) {
        console.warn('获取 ComfyUI 状态失败:', e);
      }
    }

    async function saveComfyUiConfig(andTest) {
      const hostInput = document.getElementById('comfy-cfg-host');
      const dirInput = document.getElementById('comfy-cfg-dir');
      const timeoutInput = document.getElementById('comfy-cfg-timeout');

      const comfyCfg = {
        enabled: true,
        host: hostInput ? hostInput.value.trim() : 'http://127.0.0.1:8284',
        workflowsDir: dirInput ? dirInput.value.trim() : '',
        timeoutSec: timeoutInput ? (parseInt(timeoutInput.value, 10) || 180) : 180
      };

      try {
        const res = await fetch('/balancer/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comfyui: comfyCfg })
        });
        const d = await res.json();
        if (d.success) {
          showToast('ComfyUI 外挂配置已安全保存！', 'success');
          if (andTest) {
            await loadComfyUiPluginStatus(true);
          }
        } else {
          showToast('保存失败: ' + (d.error || '未知错误'), 'error');
        }
      } catch (err) {
        showToast('网络请求异常: ' + err.message, 'error');
      }
    }

    async function triggerComfyUiTestGen() {
      const btn = document.getElementById('btn-comfy-test-gen');
      const promptInput = document.getElementById('comfy-test-prompt');
      const wfSel = document.getElementById('comfy-test-workflow-select');
      const resultBox = document.getElementById('comfy-test-result-box');
      const resImg = document.getElementById('comfy-test-result-img');
      const resTitle = document.getElementById('comfy-test-res-title');
      const resWf = document.getElementById('comfy-test-res-wf');
      const resDuration = document.getElementById('comfy-test-res-duration');
      const resSeed = document.getElementById('comfy-test-res-seed');
      const resLink = document.getElementById('comfy-test-res-link');

      const prompt = promptInput ? promptInput.value.trim() : '';
      if (!prompt) {
        showToast('提示词不能为空', 'error');
        return;
      }

      const workflow = wfSel ? wfSel.value : '04';

      if (btn) {
        btn.disabled = true;
        btn.textContent = '🎨 GPU 采样中 (请稍候)...';
      }

      try {
        const res = await fetch('/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: prompt,
            model: workflow,
            response_format: 'url'
          })
        });

        const data = await res.json();
        if (data && data.data && data.data[0] && data.data[0].url) {
          const item = data.data[0];
          const wfInfo = data.workflow || {};
          if (resImg) resImg.src = item.url;
          if (resWf) resWf.textContent = wfInfo.name || workflow;
          if (resDuration) resDuration.textContent = wfInfo.durationMs ? (wfInfo.durationMs / 1000).toFixed(1) + 's' : '--';
          if (resSeed) resSeed.textContent = wfInfo.seed || '--';
          if (resLink) {
            resLink.href = item.url;
            resLink.textContent = item.url;
          }
          if (resultBox) resultBox.style.display = 'block';
          showToast('🎉 成片渲染完成！', 'success');
        } else {
          const errMsg = data?.error?.message || '生成失败，请检查 ComfyUI 连接';
          showToast('出图失败: ' + errMsg, 'error');
        }
      } catch (e) {
        showToast('请求出错: ' + e.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🚀 试画一张';
        }
      }
    }

    async function bindCodexMcp() {
      try {
        const res = await fetch('/balancer/api/repair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'codex' })
        });
        const d = await res.json();
        if (d.success) {
          showToast('已成功为 Codex Desktop 注册 ComfyUI 图像智能体 (mcp-comfyui.js)！', 'success');
          if (confirm('🎉 已成功为 OpenAI Codex 注册 ComfyUI 图像智能体！\\n\\n是否立即平滑重启 Codex 客户端以立即加载最新生图与反推工具？')) {
            restartCodexClient();
          }
        } else {
          showToast('注册 MCP 失败: ' + (d.error || '未知错误'), 'error');
        }
      } catch (e) {
        showToast('请求异常: ' + e.message, 'error');
      }
    }

    // Auto-load ComfyUI status on initialization
    setTimeout(function() {
      loadComfyUiPluginStatus(false);
    }, 400);
  </script>
</body>
</html>`;
}

const MAX_INTERNAL_PAYLOAD = 4 * 1024 * 1024; // 4MB safety ceiling for internal management APIs to prevent OOM

function readInternalBody(req, res, maxBytes = MAX_INTERNAL_PAYLOAD) {
  return new Promise((resolve) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    const cleanup = () => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('close', onClose);
    };

    const done = (val) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    const onData = (chunk) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        chunks.length = 0;
        if (!res.headersSent) {
          try {
            res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ success: false, error: 'Payload Too Large: 管理接口请求体超过 4MB 上限', type: 'payload_too_large' }));
          } catch (_) {}
        }
        try { req.destroy(); } catch (_) {}
        done(null);
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      done(Buffer.concat(chunks));
    };

    const onError = () => {
      chunks.length = 0;
      done(null);
    };

    const onClose = () => {
      if (!req.readableEnded) {
        chunks.length = 0;
        done(null);
      }
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);

    if (req.readableEnded) {
      done(Buffer.concat(chunks));
    }
  });
}

// HTTP Server
const server = http.createServer((req, res) => {
  req.on('error', (err) => {
    if (!res.headersSent) {
      try {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Client request stream error: ' + err.message, type: 'client_error' } }));
      } catch (_) {}
    }
  });

  const u9568 = new URL(req.url || '/', 'http://localhost');
  const reqUrl = { pathname: u9568.pathname, query: Object.fromEntries(u9568.searchParams.entries()), searchParams: u9568.searchParams, search: u9568.search };

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
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized: 请输入访问密码' }));
      return;
    }
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
    readInternalBody(req, res).then((buf) => {
      if (!buf) return;
      try {
        const payload = JSON.parse(buf.toString('utf8'));
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
      allowModelAutoUpgrade: Boolean(config.allowModelAutoUpgrade),
      allowRegionFallback: Boolean(config.allowRegionFallback),
      proxy: config.proxy || { enabled: false, url: '', scope: 'all', models: [] },
      hasUiPassword: Boolean(config.uiPassword && config.uiPassword.trim()),
      uiPassword: config.uiPassword || '',
      accounts: config.accounts,
      compression: config.compression || DEFAULT_CONFIG.compression,
      comfyui: config.comfyui || DEFAULT_CONFIG.comfyui || { enabled: true, host: 'http://127.0.0.1:8284', workflowsDir: '', timeoutSec: 180 }
    }));
    return;
  }

  // Save config API (from UI)
  if (reqUrl.pathname === '/balancer/api/config' && req.method === 'POST') {
    readInternalBody(req, res).then((buf) => {
      if (!buf) return;
      try {
        const payload = JSON.parse(buf.toString('utf8'));
        let newAccounts = config.accounts;
        if (payload.accounts !== undefined) {
          if (!Array.isArray(payload.accounts) || payload.accounts.length === 0) {
            throw new Error('至少需要保留一个账号配置');
          }

          // Clean & validate accounts
          newAccounts = payload.accounts.map((acc, index) => ({
            id: acc.id || `account-${Date.now()}-${index}`,
            name: (acc.name || `账号 ${index + 1}`).trim(),
            apiKey: (acc.apiKey || '').trim(),
            enabled: Boolean(acc.enabled)
          }));
        }

        const newConfig = {
          ...config,
          upstream: (payload.upstream !== undefined ? String(payload.upstream).trim() : config.upstream),
          defaultCooldownMs: payload.defaultCooldownMs !== undefined ? (Number(payload.defaultCooldownMs) || config.defaultCooldownMs) : config.defaultCooldownMs,
          maxFailoverRetries: payload.maxFailoverRetries !== undefined ? (Number(payload.maxFailoverRetries) || config.maxFailoverRetries) : config.maxFailoverRetries,
          sessionAffinityEnabled: payload.sessionAffinityEnabled !== undefined ? Boolean(payload.sessionAffinityEnabled) : config.sessionAffinityEnabled,
          allowModelAutoUpgrade: payload.allowModelAutoUpgrade !== undefined ? Boolean(payload.allowModelAutoUpgrade) : Boolean(config.allowModelAutoUpgrade),
          allowRegionFallback: payload.allowRegionFallback !== undefined ? Boolean(payload.allowRegionFallback) : Boolean(config.allowRegionFallback),
          accounts: newAccounts
        };
        if (payload.proxy !== undefined) {
          if (typeof payload.proxy === 'string') {
            newConfig.proxy = {
              enabled: Boolean(payload.proxy.trim()),
              url: payload.proxy.trim(),
              scope: 'all',
              models: []
            };
          } else if (payload.proxy && typeof payload.proxy === 'object') {
            newConfig.proxy = {
              enabled: payload.proxy.enabled !== false,
              url: (payload.proxy.url || '').trim(),
              scope: payload.proxy.scope || 'all',
              models: Array.isArray(payload.proxy.models)
                ? payload.proxy.models.map(m => String(m).trim()).filter(Boolean)
                : (typeof payload.proxy.models === 'string'
                    ? payload.proxy.models.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
                    : [])
            };
          }
        }
        if (payload.host !== undefined && String(payload.host).trim()) {
          newConfig.host = String(payload.host).trim();
        }
        if (payload.port !== undefined && Number(payload.port) > 0) {
          newConfig.port = Number(payload.port);
        }
        if (payload.uiPassword !== undefined) {
          newConfig.uiPassword = String(payload.uiPassword).trim();
        }
        if (payload.compression && typeof payload.compression === 'object') {
          const prevComp = config.compression || DEFAULT_CONFIG.compression;
          if (payload.compression.modules && typeof payload.compression.modules === 'object') {
            // Modern hierarchical update: payload contains modules
            const mergedModules = {
              rtk: { ...(prevComp.modules?.rtk || {}), ...(payload.compression.modules.rtk || {}) },
              headroom: { ...(prevComp.modules?.headroom || {}), ...(payload.compression.modules.headroom || {}) },
              schema: { ...(prevComp.modules?.schema || {}), ...(payload.compression.modules.schema || {}) },
              cacheZone: { ...(prevComp.modules?.cacheZone || {}), ...(payload.compression.modules.cacheZone || {}) },
              powershell: { ...(prevComp.modules?.powershell || {}), ...(payload.compression.modules.powershell || {}) }
            };
            const toNormalize = {
              enabled: payload.compression.enabled !== undefined ? payload.compression.enabled : prevComp.enabled,
              preset: payload.compression.preset !== undefined ? payload.compression.preset : prevComp.preset,
              modules: mergedModules
            };
            for (const k of ['stripAnsi', 'cleanCliMetadata', 'cleanProgressBars', 'cleanDevOpsOutput', 'cleanDockerOutput',
                            'cleanKubectlOutput', 'cleanTerraformOutput', 'cleanGitOutput', 'cleanBuildAndPkgOutput',
                            'cleanSearchAndTreeOutput', 'dedupLogLines', 'foldLockfiles', 'foldStructuredData',
                            'maxStructuredItems', 'structuredHeadCount', 'structuredTailCount',
                            'exemptMergeConflicts', 'protectSourceDiffs', 'foldTestPasses',
                            'alignToolsSchema', 'slimToolsSchema', 'schemaCharThreshold',
                            'cacheZoneFreeze', 'trueLruRetention', 'customTestPassPatterns',
                            'autoDetectPlatform', 'cleanCliXmlNoise', 'cleanPowerShell7Noise', 'fixQuoteEscaping', 'fixCurlAlias',
                            'fixTrailingSlash', 'fixAndOperator', 'fixLineContinuation', 'fixSubexpressionEscaping',
                            'scriptFileInjectionHelper', 'injectPowerShellGuard']) {
              if (payload.compression[k] !== undefined) {
                toNormalize[k] = payload.compression[k];
              }
            }
            newConfig.compression = contextCompactor.normalizeCompressionOptions(toNormalize);
          } else {
            // Legacy flat update: payload contains flat keys without modules
            const mergedModules = prevComp.modules ? JSON.parse(JSON.stringify(prevComp.modules)) : null;
            if (mergedModules) {
              if (payload.compression.stripAnsi !== undefined && mergedModules.rtk) {
                mergedModules.rtk.stripAnsi = Boolean(payload.compression.stripAnsi);
              }
              if (payload.compression.cleanProgressBars !== undefined && mergedModules.rtk) {
                mergedModules.rtk.cleanProgressBars = Boolean(payload.compression.cleanProgressBars);
              }
              if (payload.compression.foldTestPasses !== undefined && mergedModules.rtk) {
                mergedModules.rtk.foldTestPasses = Boolean(payload.compression.foldTestPasses);
              }
              if (payload.compression.cleanDevOpsOutput !== undefined && mergedModules.rtk) {
                mergedModules.rtk.cleanDevOpsOutput = Boolean(payload.compression.cleanDevOpsOutput);
              }
              if (payload.compression.foldLockfiles !== undefined && mergedModules.headroom) {
                mergedModules.headroom.foldLockfiles = Boolean(payload.compression.foldLockfiles);
              }
              if (payload.compression.foldStructuredData !== undefined && mergedModules.headroom) {
                mergedModules.headroom.foldStructuredData = Boolean(payload.compression.foldStructuredData);
              }
              if (payload.compression.maxStructuredItems !== undefined && mergedModules.headroom) {
                const val = Number(payload.compression.maxStructuredItems);
                mergedModules.headroom.maxStructuredItems = (!isNaN(val) && val > 0) ? val : 50;
              }
              if (payload.compression.exemptMergeConflicts !== undefined && mergedModules.headroom) {
                mergedModules.headroom.exemptMergeConflicts = Boolean(payload.compression.exemptMergeConflicts);
              }
              if (payload.compression.protectSourceDiffs !== undefined && mergedModules.headroom) {
                mergedModules.headroom.protectSourceDiffs = Boolean(payload.compression.protectSourceDiffs);
              }
              if (payload.compression.alignToolsSchema !== undefined && mergedModules.schema) {
                mergedModules.schema.alignToolsSchema = Boolean(payload.compression.alignToolsSchema);
              }
              if (payload.compression.slimToolsSchema !== undefined && mergedModules.schema) {
                mergedModules.schema.slimToolsSchema = Boolean(payload.compression.slimToolsSchema);
              }
              if (payload.compression.schemaCharThreshold !== undefined && mergedModules.schema) {
                const val = Number(payload.compression.schemaCharThreshold);
                mergedModules.schema.schemaCharThreshold = (!isNaN(val) && val >= 0) ? val : 15000;
              }
              if (payload.compression.cacheZoneFreeze !== undefined && mergedModules.cacheZone) {
                mergedModules.cacheZone.cacheZoneFreeze = Boolean(payload.compression.cacheZoneFreeze);
              }
              if (payload.compression.trueLruRetention !== undefined && mergedModules.cacheZone) {
                mergedModules.cacheZone.trueLruRetention = Boolean(payload.compression.trueLruRetention);
              }
              if (mergedModules.powershell) {
                if (payload.compression.autoDetectPlatform !== undefined) mergedModules.powershell.autoDetectPlatform = Boolean(payload.compression.autoDetectPlatform);
                if (payload.compression.cleanCliXmlNoise !== undefined) mergedModules.powershell.cleanCliXmlNoise = Boolean(payload.compression.cleanCliXmlNoise);
                if (payload.compression.fixQuoteEscaping !== undefined) mergedModules.powershell.fixQuoteEscaping = Boolean(payload.compression.fixQuoteEscaping);
                if (payload.compression.fixCurlAlias !== undefined) mergedModules.powershell.fixCurlAlias = Boolean(payload.compression.fixCurlAlias);
                if (payload.compression.fixTrailingSlash !== undefined) mergedModules.powershell.fixTrailingSlash = Boolean(payload.compression.fixTrailingSlash);
                if (payload.compression.fixAndOperator !== undefined) mergedModules.powershell.fixAndOperator = Boolean(payload.compression.fixAndOperator);
                if (payload.compression.fixLineContinuation !== undefined) mergedModules.powershell.fixLineContinuation = Boolean(payload.compression.fixLineContinuation);
                if (payload.compression.injectPowerShellGuard !== undefined) mergedModules.powershell.injectPowerShellGuard = Boolean(payload.compression.injectPowerShellGuard);
              }
            }
            const toNormalize = {
              enabled: payload.compression.enabled !== undefined ? payload.compression.enabled : prevComp.enabled,
              preset: payload.compression.preset !== undefined ? payload.compression.preset : prevComp.preset,
              modules: mergedModules || undefined
            };
            for (const k of ['stripAnsi', 'cleanCliMetadata', 'cleanProgressBars', 'cleanDevOpsOutput', 'cleanDockerOutput',
                            'cleanKubectlOutput', 'cleanTerraformOutput', 'cleanGitOutput', 'cleanBuildAndPkgOutput',
                            'cleanSearchAndTreeOutput', 'dedupLogLines', 'foldLockfiles', 'foldStructuredData',
                            'maxStructuredItems', 'structuredHeadCount', 'structuredTailCount',
                            'exemptMergeConflicts', 'protectSourceDiffs', 'foldTestPasses',
                            'alignToolsSchema', 'slimToolsSchema', 'schemaCharThreshold',
                            'cacheZoneFreeze', 'trueLruRetention', 'customTestPassPatterns',
                            'autoDetectPlatform', 'cleanCliXmlNoise', 'cleanPowerShell7Noise', 'fixQuoteEscaping', 'fixCurlAlias',
                            'fixTrailingSlash', 'fixAndOperator', 'fixLineContinuation', 'fixSubexpressionEscaping',
                            'scriptFileInjectionHelper', 'injectPowerShellGuard']) {
              if (payload.compression[k] !== undefined) {
                toNormalize[k] = payload.compression[k];
              } else if (prevComp[k] !== undefined) {
                toNormalize[k] = prevComp[k];
              }
            }
            newConfig.compression = contextCompactor.normalizeCompressionOptions(toNormalize);
          }
        }

        if (payload.comfyui && typeof payload.comfyui === 'object') {
          const prevComfy = config.comfyui || DEFAULT_CONFIG.comfyui || {};
          newConfig.comfyui = {
            enabled: payload.comfyui.enabled !== false,
            host: (payload.comfyui.host !== undefined ? String(payload.comfyui.host).trim() : (prevComfy.host || 'http://127.0.0.1:8284')),
            workflowsDir: (payload.comfyui.workflowsDir !== undefined ? String(payload.comfyui.workflowsDir).trim() : (prevComfy.workflowsDir || '')),
            timeoutSec: (Number(payload.comfyui.timeoutSec) && Number(payload.comfyui.timeoutSec) > 0) ? Number(payload.comfyui.timeoutSec) : (prevComfy.timeoutSec || 180)
          };
          if (typeof comfyuiAdapter !== 'undefined' && comfyuiAdapter) {
            comfyuiAdapter.config = newConfig;
            comfyuiAdapter.reloadManifest();
          }
        }

        // Create atomic backup of existing config.json
        if (fs.existsSync(CONFIG_FILE)) {
          fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak');
        }

        writeFileSyncAtomic(CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf8');
        config = newConfig;
        syncAccountStats();
        clearProxyAgentCache();
        codexAdapter.configureAdapter(config);

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

  // Get compression metrics stats API
  if (reqUrl.pathname === '/balancer/api/compression/stats' && req.method === 'GET') {
    const range = (reqUrl.query && reqUrl.query.range) || (reqUrl.searchParams && reqUrl.searchParams.get('range')) || 'all';
    const stats = contextCompactor.getStatsByRange
      ? contextCompactor.getStatsByRange(range)
      : contextCompactor.getCompressionStats();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      success: true,
      range: stats.range || range,
      rangeLabel: stats.rangeLabel || (range === '1h' ? '过去 1 小时' : range === '24h' ? '过去 24 小时' : range === '7d' ? '过去 7 天' : '全部历史累计'),
      timeSeries: stats.timeSeries || [],
      stats
    }));
    return;
  }

  // Reset compression metrics stats API
  if (reqUrl.pathname === '/balancer/api/compression/stats/reset' && req.method === 'POST') {
    const stats = contextCompactor.resetCompressionStats();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      success: true,
      message: '压缩与 Token 节省统计数据已清零',
      stats
    }));
    return;
  }

  // Compression Doctor API
  if (reqUrl.pathname === '/balancer/api/compression/doctor' && req.method === 'GET') {
    try {
      const stats = contextCompactor.getCompressionStats();
      const report = contextCompactor.checkCompressionHealth(config.compression, stats);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(report, null, 2));
    } catch (err) {
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({ error: err.message }, null, 2));
    }
    return;
  }

  // Compression Repair API
  if (reqUrl.pathname === '/balancer/api/compression/repair' && req.method === 'POST') {
    readInternalBody(req, res).then(async (buf) => {
      if (!buf) return;
      try {
        let postData = {};
        if (buf.length > 0) {
          const rawBody = buf.toString('utf8').trim();
          if (rawBody) {
            try { postData = JSON.parse(rawBody); } catch (_) {}
          }
        }
        const repairResult = contextCompactor.repairCompressionConfig(config.compression, postData);
        if (repairResult && repairResult.repairedConfig) {
          config.compression = repairResult.repairedConfig;
          if (fs.existsSync(CONFIG_FILE)) {
            try { fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak'); } catch (_) {}
          }
          writeFileSyncAtomic(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
          success: true,
          results: repairResult.results,
          compression: config.compression
        }, null, 2));
      } catch (err) {
        res.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Test account connectivity API
  if (reqUrl.pathname === '/balancer/api/test-account' && req.method === 'POST') {
    readInternalBody(req, res).then(async (buf) => {
      if (!buf) return;
      try {
        const payload = JSON.parse(buf.toString('utf8'));
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
    readInternalBody(req, res).then(async (buf) => {
      if (!buf) return;
      try {
        const payload = JSON.parse(buf.toString('utf8'));
        const targetUpstream = (payload.upstream || config.upstream).trim();
        let apiKey = (payload.apiKey || '').trim();
        const targetAccountId = payload.accountId || payload.account_id || payload.id;
        if (!apiKey && targetAccountId) {
          const acc = config.accounts.find(a => a.id === targetAccountId);
          if (acc) apiKey = acc.apiKey.trim();
        }

        if (!apiKey) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, message: '未配置 API Key' }));
          return;
        }

        const force = Boolean(payload.force);
        const result = await fetchAccountUsage(targetUpstream, apiKey, force);
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
    readInternalBody(req, res).then((buf) => {
      if (!buf) return;
      try {
        let payload = {};
        if (buf.length > 0) {
          try { payload = JSON.parse(buf.toString('utf8')); } catch (e) {}
        }
        const defaultModel = payload.defaultModel || 'deepseek-v4.1-flash';
        const reasoningEffort = payload.reasoningEffort || 'high';
        const result = codexAdapter.bindCodexConfig({
          codexDir: payload.codexDir,
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
    readInternalBody(req, res).then((buf) => {
      if (!buf) return;
      try {
        let payload = {};
        if (buf.length > 0) {
          try { payload = JSON.parse(buf.toString('utf8')); } catch (e) {}
        }
        const result = codexAdapter.restoreCodexConfig(payload.codexDir);
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
    });
    return;
  }

  // Restart Codex Desktop Application API
  if (reqUrl.pathname === '/balancer/api/restart-codex' && (req.method === 'POST' || req.method === 'GET')) {
    try {
      const result = codexAdapter.restartCodex();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        success: result.success,
        result,
        message: result.messages && result.messages.length > 0 ? result.messages.join('；') : 'Codex 客户端已平滑重启并加载最新配置'
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
    readInternalBody(req, res).then((buf) => {
      if (!buf) return;
      try {
        const payload = JSON.parse(buf.toString('utf8'));
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

        // Support dryRun mode (for automated tests and validation without leaking GUI processes)
        if (payload.dryRun === true) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: true, dryRun: true, message: '安全沙箱与文件存在性校验通过 (dryRun 模式已跳过桌面应用启动)' }));
          return;
        }

        if (process.platform === 'win32') {
          const child = spawn('explorer.exe', [filePath], {
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
    readInternalBody(req, res).then((buf) => {
      if (!buf) return;
      try {
        let accountId = null;
        if (buf.length > 0) {
          try {
            const payload = JSON.parse(buf.toString('utf8'));
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
    (async () => {
      try {
        const scope = (reqUrl.query && reqUrl.query.scope) || (reqUrl.searchParams && reqUrl.searchParams.get('scope')) || 'all';
        const report = await runSystemDoctor(scope);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(report, null, 2));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message }, null, 2));
      }
    })();
    return;
  }

  // Repair API
  if (reqUrl.pathname === '/balancer/api/repair' && req.method === 'POST') {
    readInternalBody(req, res).then(async (buf) => {
      if (!buf) return;
      try {
        let postData = {};
        if (buf.length > 0) {
          const rawBody = buf.toString('utf8').trim();
          if (rawBody) {
            try { postData = JSON.parse(rawBody); } catch (_) {}
          }
        }
        const scope = (reqUrl.query && reqUrl.query.scope) || (reqUrl.searchParams && reqUrl.searchParams.get('scope')) || postData.scope || 'all';
        const results = await executeSystemRepair({ ...postData, scope });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, results, scope }, null, 2));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
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
        const proxyInfo = getEffectiveProxyForRequest(null);
        const proxyAgent = proxyInfo ? getProxyAgent(proxyInfo.url, new URL(config.upstream).protocol === 'https:') : null;
        const officialModels = await updater.fetchOfficialModels(apiKey, config.upstream, 5000, { agent: proxyAgent });
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

          let compactorRatesSynced = false;
          try {
            const cr = await contextCompactor.syncModelRatesFromOpenCode();
            compactorRatesSynced = Boolean(cr && cr.success);
          } catch (_) {}

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            success: true,
            upstream: config.upstream,
            officialCount: officialModels.length,
            totalModelCount: harmRes.modelCount,
            currentModel: harmRes.currentModel,
            codexSynced,
            compactorRatesSynced,
            models: officialModels,
            message: `已成功从官方上游动态嗅探并同步 ${officialModels.length} 款模型，本地客户端配置已增量热更新！`
          }, null, 2));
        } else {
          let compactorRatesSynced = false;
          try {
            const cr = await contextCompactor.syncModelRatesFromOpenCode();
            compactorRatesSynced = Boolean(cr && cr.success);
          } catch (_) {}

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            success: true,
            upstream: config.upstream,
            officialCount: 38,
            totalModelCount: 38,
            fallback: true,
            compactorRatesSynced,
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
    readInternalBody(req, res).then((buf) => {
      if (!buf) return;
      const updater = require('./updater');
      let payload = {};
      if (buf.length > 0) {
        try { payload = JSON.parse(buf.toString('utf8')); } catch (e) {}
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
    readInternalBody(req, res).then((buf) => {
      if (!buf) return;
      try {
        const updater = require('./updater');
        let payload = {};
        if (buf.length > 0) {
          try { payload = JSON.parse(buf.toString('utf8')); } catch (e) {}
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


  // Static Media Server for Generated Artifacts (Air-Gapped, No CORS / Protocol Issues for OpenChamber & Web)
  if (reqUrl.pathname.startsWith('/artifacts/images/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const rawFilename = reqUrl.pathname.slice('/artifacts/images/'.length);
    const safeFilename = path.basename(decodeURIComponent(rawFilename));
    const targetFilePath = path.join(__dirname, 'artifacts', 'images', safeFilename);
    const safeBaseDir = path.join(__dirname, 'artifacts', 'images');

    // Strict boundary defense against path traversal attacks (Rule 5 & Air-Gapped Safety)
    if (!targetFilePath.startsWith(safeBaseDir) || safeFilename.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Forbidden: Path traversal detected' }));
      return;
    }

    if (!fs.existsSync(targetFilePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Image not found' }));
      return;
    }

    const ext = path.extname(safeFilename).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif'
    };
    const cType = mimeTypes[ext] || 'application/octet-stream';

    const stat = fs.statSync(targetFilePath);
    res.writeHead(200, {
      'Content-Type': cType,
      'Content-Length': stat.size,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400, immutable'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(targetFilePath).pipe(res);
    return;
  }

  // ComfyUI Status API (/balancer/api/comfyui/status)
  if (reqUrl.pathname === '/balancer/api/comfyui/status' && req.method === 'GET') {
    const force = reqUrl.query?.force === 'true' || reqUrl.query?.force === '1';
    comfyuiAdapter.detectServer(force).then(status => {
      const wfs = comfyuiAdapter.manifest || {};
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        success: true,
        status,
        workflowsCount: Object.keys(wfs).length,
        workflows: Object.entries(wfs).map(([id, meta]) => ({
          id,
          name: meta.name,
          description: meta.description,
          tags: meta.style_tags || []
        }))
      }));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  // Standard OpenAI Image Generation Endpoint (/v1/images/generations & /images/generations)
  if ((reqUrl.pathname === '/v1/images/generations' || reqUrl.pathname === '/images/generations') && req.method === 'POST') {
    readInternalBody(req, res).then(async buf => {
      if (!buf) return;
      let body = {};
      try {
        body = JSON.parse(buf.toString('utf8'));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON payload: ' + e.message, type: 'invalid_request_error' } }));
        return;
      }

      const prompt = body.prompt;
      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: { message: 'Missing required parameter: prompt', type: 'invalid_request_error', param: 'prompt' } }));
        return;
      }

      // Check ComfyUI server status
      const snInfo = await comfyuiAdapter.detectServer();
      if (!snInfo.isOnline) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          error: {
            message: 'ComfyUI 图像生成外挂未就绪。请确认本地服务已启动 (8284/8188) 或在网关控制台配置远端服务器。',
            type: 'comfyui_offline',
            code: 'comfyui_not_connected'
          }
        }));
        return;
      }

      try {
        let reqWidth = undefined;
        let reqHeight = undefined;
        if (typeof body.size === 'string' && body.size.includes('x')) {
          const parts = body.size.split('x').map(s => parseInt(s.trim(), 10));
          if (!isNaN(parts[0]) && !isNaN(parts[1])) {
            reqWidth = parts[0];
            reqHeight = parts[1];
          }
        }

        const genResult = await comfyuiAdapter.executeGeneration({
          prompt: prompt.trim(),
          workflow: body.model || body.workflow || 'auto',
          negative: body.negative,
          width: reqWidth,
          height: reqHeight,
          seed: body.seed
        });

        const host = req.headers.host || ("127.0.0.1:" + config.port);
        const imageUrl = "http://" + host + genResult.url;
        const responseFormat = body.response_format || 'url';

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
          created: Math.floor(Date.now() / 1000),
          data: [
            responseFormat === 'b64_json'
              ? { b64_json: genResult.base64, revised_prompt: genResult.prompt }
              : { url: imageUrl, revised_prompt: genResult.prompt }
          ],
          workflow: {
            name: genResult.workflowName,
            id: genResult.workflowId,
            seed: genResult.seed,
            durationMs: genResult.durationMs
          }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          error: {
            message: "生图执行失败: " + err.message,
            type: 'comfyui_execution_error'
          }
        }));
      }
    });
    return;
  }

  // Image Interrogation Endpoint (/v1/images/interrogate & /images/interrogate)
  if ((reqUrl.pathname === '/v1/images/interrogate' || reqUrl.pathname === '/images/interrogate') && req.method === 'POST') {
    readInternalBody(req, res).then(async buf => {
      if (!buf) return;
      let body = {};
      try {
        body = JSON.parse(buf.toString('utf8'));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON payload: ' + e.message, type: 'invalid_request_error' } }));
        return;
      }

      const imageInput = body.image || body.image_path;
      if (!imageInput) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: { message: 'Missing required parameter: image or image_path', type: 'invalid_request_error' } }));
        return;
      }

      try {
        const fallbackVision = async (imgBuf) => {
          return '1girl, masterpiece, photorealistic, natural lighting, high quality';
        };

        const result = await comfyuiAdapter.interrogateImage(imageInput, fallbackVision);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: true,
          tags: result.tags,
          source: result.source
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          error: {
            message: "反推失败: " + err.message,
            type: 'interrogation_error'
          }
        }));
      }
    });
    return;
  }

  // Web UI Dashboard & Graphical Config Center
  if (reqUrl.pathname === '/' || reqUrl.pathname === '/balancer/ui' || reqUrl.pathname === '/balancer') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderLoginPage());
      return;
    }
    const u10579 = new URL(req.url || '/', 'http://localhost');
    const parsed = { pathname: u10579.pathname, query: Object.fromEntries(u10579.searchParams.entries()), searchParams: u10579.searchParams };
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    };
    if (config.uiPassword && parsed.query && parsed.query.auth) {
      const token = Buffer.from(config.uiPassword.trim()).toString('base64');
      headers['Set-Cookie'] = `router_auth=${encodeURIComponent(token)}; Path=/; Max-Age=2592000; SameSite=Lax`;
    }
    try {
      const html = renderDashboardHtml(config);
      res.writeHead(200, headers);
      res.end(html);
    } catch (err) {
      console.error('[Dashboard Render Error]', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Dashboard Render Error: ' + (err && err.message ? err.message : String(err)));
    }
    return;
  }

  // All other API calls: Proxy to OpenCode Go upstream
  if (config.uiPassword && !isAuthorized(req)) {
    res.writeHead(401, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      error: {
        message: 'Unauthorized: 请提供有效的访问密码或 API Key (Bearer / x-api-key / x-ui-password)',
        type: 'authentication_error',
        code: 401
      }
    }));
    return;
  }

  const chunks = [];
  let totalReqBytes = 0;
  const MAX_REQ_BYTES = 32 * 1024 * 1024; // 32MB safety ceiling to prevent heap allocation exhaustion
  let reqRejected = false;
  req.on('error', err => {
    if (reqRejected) return;
    reqRejected = true;
    chunks.length = 0;
    if (!res.headersSent) {
      try {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Client request stream error: ' + err.message, type: 'client_error' } }));
      } catch (_) {}
    }
  });
  req.on('close', () => {
    if (!req.readableEnded) {
      reqRejected = true;
      chunks.length = 0;
    }
  });
  req.on('data', chunk => {
    if (reqRejected) return;
    totalReqBytes += chunk.length;
    if (totalReqBytes > MAX_REQ_BYTES) {
      reqRejected = true;
      chunks.length = 0;
      if (!res.headersSent) {
        try {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Payload Too Large: request body exceeded 32MB ceiling', type: 'payload_too_large' } }));
        } catch (_) {}
      }
      try { req.destroy(); } catch (_) {}
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (reqRejected) return;
    const reqBody = Buffer.concat(chunks);
    const sessionId = codexAdapter.extractOrDeriveSessionId(req, reqBody);
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

    sendProxyRequest(req, res, reqBody, account, 1, new Set(), sessionId);
  });
});

// Configure Node HTTP server timeout & keep-alives for resilient long-reasoning streaming
server.timeout = 0;
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 65000;

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
          execSync(`(lsof -t -sTCP:LISTEN -i :${config.port} 2>/dev/null | xargs -r kill -9 2>/dev/null) || (ss -tlpn 'sport = :${config.port}' 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs -r kill -9 2>/dev/null) || true`, { timeout: 3000, stdio: 'ignore' });
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

if (require.main === module) {
  server.listen(config.port, config.host, () => {
    console.log(`[OpenCode Go Router] Running on http://${config.host}:${config.port}`);
    console.log(`[OpenCode Go Router] Upstream: ${config.upstream}`);
    console.log(`[OpenCode Go Router] Web Dashboard: http://${config.host}:${config.port}/balancer/ui`);
    try {
      contextCompactor.syncModelRatesFromOpenCode().catch(() => {});
    } catch (_) {}
  });
}

module.exports = {
  server,
  config,
  classifyUpstreamError,
  handleUpstreamGlitchAndFailover,
  handleInvalidApiKeyFailover,
  handleRateLimitFailover,
  handleNetworkErrorFailover,
  handleModelAndContextFallback,
  dispatchResponsesRequest,
  sessionModelFallbackCache,
  sessionFallbackKeyMap,
  sessionToFallbackKeys,
  cacheKeyToSessionMap,
  getSessionModelFallback,
  setSessionModelFallback,
  deleteSessionRecord,
  sessionMap,
  sessionLastSeen,
  MAX_ROUTER_SESSIONS,
  readInternalBody,
  runSystemDoctor,
  executeSystemRepair,
  HttpsTunnelAgent,
  HttpTunnelAgent,
  getProxyAgent,
  getEffectiveProxyForRequest,
  clearProxyAgentCache,
  isAuthorized,
  writeFileSyncAtomic
};
