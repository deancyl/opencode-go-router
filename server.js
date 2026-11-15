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
let ComfyUIAdapter;
try {
  ComfyUIAdapter = require('./comfyui-adapter').ComfyUIAdapter;
} catch (e) {
  ComfyUIAdapter = class DummyComfyUIAdapter {
    constructor() { this.enabled = false; }
    isComfyUIRequest() { return false; }
    handleComfyUIRequest() { return false; }
  };
}

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

const CONFIG_FILE = process.env.OPENCODE_ROUTER_CONFIG || path.join(__dirname, 'config.json');

let CURRENT_ROUTER_VERSION = '3.13.5';
try {
  const pkgData = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  if (pkgData && pkgData.version) CURRENT_ROUTER_VERSION = pkgData.version;
} catch (_) {}

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
  ttftTimeoutMs: 25000,
  chunkIdleTimeoutMs: 60000,
  circuitBreaker: {
    enabled: true,
    failureThreshold: 3,
    baseCooldownMs: 5000,
    maxCooldownMs: 120000,
    halfOpenMaxProbes: 1
  },
  uiPassword: '',
  allowModelAutoUpgrade: false,
  allowRegionFallback: false,
  modelSourcePolicy: 'hybrid',
  defaultModel: 'deepseek-v4.1-flash',
  favoriteModels: ['deepseek-v4.1-flash', 'kimi-k3'],
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
    localDir: '',
    repoUrl: 'https://github.com/deancyl/comfyui-agent-workflows',
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
const MAX_PROXY_AGENT_CACHE = 50; // N3 Fix: Bounded LRU cap to prevent unbounded memory growth

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
      config.modelSourcePolicy = ['official_docs', 'api_probed', 'hybrid'].includes(config.modelSourcePolicy) ? config.modelSourcePolicy : 'hybrid';
      config.defaultModel = config.defaultModel || 'deepseek-v4.1-flash';
      config.favoriteModels = Array.isArray(config.favoriteModels) ? config.favoriteModels : ['deepseek-v4.1-flash', 'kimi-k3'];
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
      if (!config.plugins || typeof config.plugins !== 'object') {
        config.plugins = {};
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
let pluginManager = null;
try {
  const { PluginManager } = require('./plugin-manager');
  pluginManager = new PluginManager({ rootDir: __dirname, configPath: CONFIG_FILE, routerPort: config.port || 4010 });
  pluginManager.scanPlugins();
  const pluginsCfg = pluginManager.getPluginsConfig();
  for (const [id, manifest] of pluginManager.discoveredPlugins.entries()) {
    if (pluginManager.isPluginEnabled(id, manifest, pluginsCfg)) {
      pluginManager.enablePlugin(id, { persist: false }).catch(e => {
        console.warn(`[PluginManager] 启动加载插件 "${id}" 失败:`, e.message);
      });
    }
  }
  config.plugins = pluginsCfg;
  if (typeof codexAdapter !== 'undefined' && codexAdapter && typeof codexAdapter.setPluginManager === 'function') {
    codexAdapter.setPluginManager(pluginManager);
  }
} catch (e) {
  console.warn('[PluginManager] 初始化异常:', e.message);
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
    // LRU refresh: delete and re-insert to move to end
    const cached = proxyAgentCache.get(key);
    proxyAgentCache.delete(key);
    proxyAgentCache.set(key, cached);
    return cached;
  }
  try {
    // N3 Fix: Evict oldest entry when cache exceeds bounded cap
    if (proxyAgentCache.size >= MAX_PROXY_AGENT_CACHE) {
      const oldestKey = proxyAgentCache.keys().next().value;
      const oldAgent = proxyAgentCache.get(oldestKey);
      proxyAgentCache.delete(oldestKey);
      try { oldAgent.destroy(); } catch (_) {}
    }
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

// Runtime account state tracking & Circuit Breaker state machine
const CIRCUIT_STATE = {
  CLOSED: 'CLOSED',       // 正常：放行所有常规请求
  HALF_OPEN: 'HALF_OPEN', // 半开：单飞探测中 (Single-Flight Probe)
  OPEN: 'OPEN'            // 熔断：完全阻断流量，执行退避冷却
};

const DEFAULT_CIRCUIT_CONFIG = {
  enabled: true,
  failureThreshold: 3,
  baseCooldownMs: 5000,
  maxCooldownMs: 120000,
  halfOpenMaxProbes: 1
};

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
        lastError: null,
        // Circuit Breaker State Machine
        circuitState: CIRCUIT_STATE.CLOSED,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        halfOpenInFlight: false,
        halfOpenProbeStartTime: 0,
        openCount: 0,
        // Latency & TTFT Sliding Window
        lastTtftMs: null,
        avgTtftMs: null,
        ttftSamples: []
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

function getCircuitState(accountId, now = Date.now()) {
  const stat = accountStats.get(accountId);
  if (!stat) return CIRCUIT_STATE.CLOSED;
  if (!stat.circuitState) stat.circuitState = CIRCUIT_STATE.CLOSED;
  if (stat.circuitState === CIRCUIT_STATE.OPEN) {
    if (now >= (stat.cooldownUntil || 0)) {
      stat.circuitState = CIRCUIT_STATE.HALF_OPEN;
      stat.halfOpenInFlight = false;
      console.log(`[Circuit Breaker] Account "${stat.name}" cooldown expired. Transitioned to HALF_OPEN (Awaiting Single-Flight Probe).`);
    }
  } else if (stat.circuitState === CIRCUIT_STATE.HALF_OPEN) {
    // Deadlock defense: if probe hung for > 45s without completion or error, release probe lock
    if (stat.halfOpenInFlight && now - (stat.halfOpenProbeStartTime || 0) > 45000) {
      console.warn(`[Circuit Breaker Deadlock Defense] Account "${stat.name}" probe hung for >45s. Releasing probe lock.`);
      stat.halfOpenInFlight = false;
    }
  }
  return stat.circuitState;
}

function calculateJitteredBackoff(baseMs, failureCount, maxMs = 120000) {
  const exponent = Math.max(0, Math.min(failureCount, 8));
  const rawBackoff = Math.min(maxMs, baseMs * Math.pow(2, exponent));
  // Full jitter: 70% ~ 130%
  const jitterFactor = 0.7 + Math.random() * 0.6;
  return Math.round(rawBackoff * jitterFactor);
}

function recordAccountSuccess(accountId, ttftMs = null) {
  const stat = accountStats.get(accountId);
  if (!stat) return;
  if (typeof ttftMs === 'number' && ttftMs >= 0) {
    stat.lastTtftMs = ttftMs;
    if (!Array.isArray(stat.ttftSamples)) stat.ttftSamples = [];
    stat.ttftSamples.push(ttftMs);
    if (stat.ttftSamples.length > 10) stat.ttftSamples.shift();
    stat.avgTtftMs = Math.round(stat.ttftSamples.reduce((a, b) => a + b, 0) / stat.ttftSamples.length);
  }
  stat.consecutiveFailures = 0;
  stat.consecutiveSuccesses = (stat.consecutiveSuccesses || 0) + 1;
  if (stat.circuitState === CIRCUIT_STATE.HALF_OPEN) {
    stat.circuitState = CIRCUIT_STATE.CLOSED;
    stat.halfOpenInFlight = false;
    stat.cooldownUntil = 0;
    stat.lastError = null;
    console.log(`[Circuit Breaker] Account "${stat.name}" single-flight probe SUCCEEDED. Circuit CLOSED (Fully Recovered).`);
  } else if (stat.circuitState === CIRCUIT_STATE.CLOSED) {
    stat.halfOpenInFlight = false;
  }
}

function recordAccountFailure(accountId, reason, statusCode = null, isRateLimit = false, explicitCooldownMs = null) {
  const stat = accountStats.get(accountId);
  if (!stat) return;
  const errDesc = `${statusCode ? 'HTTP ' + statusCode + ': ' : ''}${reason || 'Unknown error'}`;
  stat.lastError = errDesc;
  stat.consecutiveSuccesses = 0;
  const circuitConf = { ...DEFAULT_CIRCUIT_CONFIG, ...(config.circuitBreaker || {}) };

  if (stat.circuitState === CIRCUIT_STATE.HALF_OPEN) {
    // Single-flight probe failed! Escalate cooldown and reopen circuit
    stat.halfOpenInFlight = false;
    stat.consecutiveFailures = (stat.consecutiveFailures || 0) + 1;
    stat.circuitState = CIRCUIT_STATE.OPEN;
    stat.openCount = (stat.openCount || 0) + 1;
    const cooldown = calculateJitteredBackoff(circuitConf.baseCooldownMs, stat.consecutiveFailures, circuitConf.maxCooldownMs);
    stat.cooldownUntil = Date.now() + cooldown;
    console.warn(`[Circuit Breaker] Account "${stat.name}" probe FAILED (${errDesc}). Circuit re-opened until ${new Date(stat.cooldownUntil).toLocaleTimeString()} (+${Math.round(cooldown / 1000)}s)`);
    return;
  }

  if (isRateLimit) {
    stat.rateLimitCount = (stat.rateLimitCount || 0) + 1;
    stat.consecutiveFailures = (stat.consecutiveFailures || 0) + 1;
    stat.circuitState = CIRCUIT_STATE.OPEN;
    stat.openCount = (stat.openCount || 0) + 1;
    let dur = Number(explicitCooldownMs);
    if (isNaN(dur) || dur <= 0 || !isFinite(dur)) {
      dur = config.defaultCooldownMs || 60000;
    }
    const jitteredDur = Math.round(dur * (0.95 + Math.random() * 0.1));
    const targetCooldown = Date.now() + jitteredDur;
    stat.cooldownUntil = Math.max(stat.cooldownUntil || 0, targetCooldown);
    console.warn(`[Circuit Breaker RateLimit] Account "${stat.name}" tripped OPEN until ${new Date(stat.cooldownUntil).toLocaleTimeString()} (${errDesc})`);
    return;
  }

  // Standard 5xx or TTFT Timeout or Network failure
  stat.consecutiveFailures = (stat.consecutiveFailures || 0) + 1;
  const threshold = circuitConf.failureThreshold || 3;
  if (stat.consecutiveFailures >= threshold) {
    stat.circuitState = CIRCUIT_STATE.OPEN;
    stat.openCount = (stat.openCount || 0) + 1;
    const cooldown = calculateJitteredBackoff(circuitConf.baseCooldownMs, stat.consecutiveFailures - threshold, circuitConf.maxCooldownMs);
    stat.cooldownUntil = Date.now() + cooldown;
    console.warn(`[Circuit Breaker Tripped] Account "${stat.name}" reached ${stat.consecutiveFailures} consecutive failures. Circuit OPEN until ${new Date(stat.cooldownUntil).toLocaleTimeString()} (${errDesc})`);
  }
}

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

function isAccountAvailable(acc, now = Date.now()) {
  if (!acc.enabled || !acc.apiKey || acc.apiKey.trim() === '') return false;
  const stat = accountStats.get(acc.id);
  if (!stat) return false;
  const state = getCircuitState(acc.id, now);
  if (state === CIRCUIT_STATE.CLOSED) return true;
  if (state === CIRCUIT_STATE.OPEN) return false;
  if (state === CIRCUIT_STATE.HALF_OPEN) {
    // Single-Flight Probe Guard: if a probe is already running, block concurrent requests
    if (stat.halfOpenInFlight) return false;
    return true;
  }
  return false;
}

function selectAccount(sessionId, excludeAccountIds = new Set()) {
  const now = Date.now();
  const accounts = Array.isArray(config.accounts) ? config.accounts : [];
  const available = accounts.filter(a => isAccountAvailable(a, now) && !excludeAccountIds.has(a.id));

  if (available.length === 0) {
    return null;
  }

  const effectiveSessionId = typeof sessionId === 'string' ? sessionId.replace(/(?:-r\d+)+$/, '') : sessionId;

  // 1. Session affinity check (if enabled)
  if (config.sessionAffinityEnabled && effectiveSessionId && (sessionMap.has(effectiveSessionId) || (sessionId && sessionMap.has(sessionId)))) {
    const pinnedId = sessionMap.get(effectiveSessionId) || (sessionId ? sessionMap.get(sessionId) : null);
    const candidate = available.find(a => a.id === pinnedId);
    if (candidate) {
      const candStat = accountStats.get(candidate.id);
      if (candStat && candStat.circuitState === CIRCUIT_STATE.HALF_OPEN && !candStat.halfOpenInFlight) {
        candStat.halfOpenInFlight = true;
        candStat.halfOpenProbeStartTime = now;
        console.log(`[Circuit Breaker] Account "${candStat.name}" granted single-flight probe ticket (Session Affinity).`);
      }
      touchSession(effectiveSessionId, now);
      if (sessionId && sessionId !== effectiveSessionId) touchSession(sessionId, now);
      return candidate;
    }
  }

  // 2. Round-Robin selection
  rrIndex = (Number.isInteger(rrIndex) && rrIndex >= 0) ? rrIndex : 0;
  const chosen = available[rrIndex % available.length];
  rrIndex = (rrIndex + 1) % available.length;

  if (chosen) {
    const chosenStat = accountStats.get(chosen.id);
    if (chosenStat && chosenStat.circuitState === CIRCUIT_STATE.HALF_OPEN && !chosenStat.halfOpenInFlight) {
      chosenStat.halfOpenInFlight = true;
      chosenStat.halfOpenProbeStartTime = now;
      console.log(`[Circuit Breaker] Account "${chosenStat.name}" granted single-flight probe ticket.`);
    }
  }

  if (config.sessionAffinityEnabled && effectiveSessionId) {
    if (sessionMap.size > 5000) {
      let pruneCount = Math.floor(sessionMap.size * 0.2) || 1;
      for (const sess of sessionLastSeen.keys()) {
        deleteSessionRecord(sess);
        if (--pruneCount <= 0) break;
      }
      if (sessionMap.size > 5000) {
        let remaining = Math.floor(sessionMap.size * 0.2) || 1;
        for (const sess of sessionLastSeen.keys()) {
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
  recordAccountFailure(accountId, reason, null, true, cooldownMs);
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

  // 1 & 2. OpenCode 2.0 CLI and OpenChamber Desktop (via unified client-adapter-manager)
  try {
    const clientAdapter = require('./client-adapter-manager');
    const policy = options.policy || config.modelSourcePolicy || 'hybrid';
    const defaultModel = options.defaultModel || config.defaultModel || 'deepseek-v4.1-flash';
    const favorites = options.favorites || config.favoriteModels || ['deepseek-v4.1-flash', 'kimi-k3'];
    const syncRes = clientAdapter.syncAllClients({
      routerPort: config.port,
      policy,
      defaultModel,
      favorites,
      clients: ['opencode', 'openchamber'],
      preserveChoice: options.preserveChoice !== false
    });
    result.opencode = Boolean(syncRes.opencode?.success);
    result.openchamber = Boolean(syncRes.openchamber?.success);
    result.messages.push(...syncRes.messages);
  } catch (err) {
    result.messages.push('客户端适配同步提醒: ' + err.message);
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

function autoHealOpencodePortDrift(customPath = null, targetPort = config.port) {
  try {
    const numericPort = parseInt(targetPort, 10) || config.port || 4010;
    // 防御深度：若运行于临时沙箱目录且未显式指定 OPENCODE_CONFIG_DIR，严禁触碰宿主配置
    const isTempSandbox = __dirname.toLowerCase().includes(os.tmpdir().toLowerCase()) ||
                          __dirname.toLowerCase().includes('\\temp\\') ||
                          __dirname.toLowerCase().includes('/temp/') ||
                          __dirname.includes('沙箱');
    if (!customPath && !process.env.OPENCODE_CONFIG_DIR && isTempSandbox) {
      return false;
    }

    const ocDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
    const p = customPath || path.join(ocDir, 'opencode.jsonc');
    if (!fs.existsSync(p)) return false;

    const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    if (!raw.trim()) return false;

    let data;
    try {
      data = JSON.parse(stripJsonComments(raw));
    } catch (e) {
      console.warn(`[OpenCode Go Router] [Port Drift Self-Healing] 无法解析 ${path.basename(p)}: ${e.message}`);
      return false;
    }

    if (!data || typeof data !== 'object' || !data.provider) return false;
    const og = data.provider['opencode-go'];
    if (!og || typeof og !== 'object') return false;

    const expectedBaseUrl = `http://127.0.0.1:${numericPort}/v1`;
    let modified = false;

    // 仅当探测到 provider['opencode-go'].options.baseURL 或 settings.baseURL 端口不匹配时单值纠偏
    if (og.options && typeof og.options === 'object' && og.options.baseURL) {
      if (String(og.options.baseURL).trim() !== expectedBaseUrl) {
        const oldUrl = og.options.baseURL;
        og.options.baseURL = expectedBaseUrl;
        modified = true;
        console.log(`[OpenCode Go Router] [Port Drift Self-Healing] options.baseURL 单值纠偏: ${oldUrl} -> ${expectedBaseUrl}`);
      }
    }

    if (og.settings && typeof og.settings === 'object' && og.settings.baseURL) {
      if (String(og.settings.baseURL).trim() !== expectedBaseUrl) {
        const oldUrl = og.settings.baseURL;
        og.settings.baseURL = expectedBaseUrl;
        modified = true;
        console.log(`[OpenCode Go Router] [Port Drift Self-Healing] settings.baseURL 单值纠偏: ${oldUrl} -> ${expectedBaseUrl}`);
      }
    }

    if (modified) {
      // 绝对红线: 仅单值纠偏 baseURL，100% 保护第三方 provider (aixforge 等) 与模型、插件、智能体
      writeFileSyncAtomic(p, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[OpenCode Go Router] [Port Drift Self-Healing] 已成功自愈 ${p} 中的网关端口漂移 -> ${numericPort}`);
      return true;
    }
    return false;
  } catch (err) {
    console.warn(`[OpenCode Go Router] [Port Drift Self-Healing] 异常: ${err.message}`);
    return false;
  }
}

function getCorsHeaders(upstreamHeaders = {}) {
  const headers = { ...upstreamHeaders };
  delete headers['connection'];
  delete headers['transfer-encoding'];
  headers['access-control-allow-origin'] = '*';
  headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
  headers['access-control-allow-headers'] = '*';
  const cType = String(headers['content-type'] || '').toLowerCase();
  if (cType.includes('text/event-stream')) {
    headers['x-accel-buffering'] = 'no';
    headers['cache-control'] = 'no-cache';
  }
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
function classifyUpstreamError(statusCode, rawErrText = '', maybeThirdArg = '') {
  const errText = typeof rawErrText === 'string' ? rawErrText : (typeof maybeThirdArg === 'string' && maybeThirdArg ? maybeThirdArg : String(rawErrText || ''));
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

  // 2b. Detect Account Quota / Balance Exhaustion (HTTP 402 or 429/403/401 with quota exceeded)
  const isQuotaExhausted = statusCode === 402 || (
    (statusCode === 429 || statusCode === 403 || statusCode === 401) && (
      lowerText.includes('insufficient_quota') ||
      lowerText.includes('quota_exceeded') ||
      lowerText.includes('exceeded your current quota') ||
      lowerText.includes('out of quota') ||
      lowerText.includes('credit') ||
      lowerText.includes('balance') ||
      lowerText.includes('arrears')
    )
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
  // N2 Fix: Require BOTH 403 status AND region-specific keywords to avoid false positives
  // on generic 403 Forbidden (WAF, permissions, IP blacklist) which should not trigger region fallback.
  // Bare keyword matches (any status code) are also accepted for non-standard upstream error wrapping.
  const isRegionBlocked = (
    (statusCode === 403 && !isQuotaExhausted && (
      lowerText.includes('unsupported_country_region_territory') ||
      lowerText.includes('territory not supported') ||
      lowerText.includes('not available in your country') ||
      lowerText.includes('region') ||
      lowerText.includes('geograph') ||
      lowerText.includes('country') ||
      lowerText.length === 0  // bare 403 with no body — likely CDN geo-block
    )) ||
    // Catch region keywords in non-403 error wrappers (e.g. 400/200 with error body)
    lowerText.includes('unsupported_country_region_territory')
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
    isQuotaExhausted,
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
  const maxRetries = Math.max(config.maxFailoverRetries || 2, (config.accounts ? config.accounts.length : 1));
  if (attemptNumber > maxRetries) {
    return false;
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
 * Unified Quota / Balance Exhaustion Account Failover Handler (HTTP 402)
 */
function handleQuotaExhaustedFailover({
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
  console.warn(`[Router Quota Alert] Account "${account.name}" quota/balance exhausted (${statusCode}): ${errText.slice(0, 160)}`);
  recordCooldown(account.id, 3600000, 'Quota / Balance Exhausted');
  finishRequest();
  clientRes.removeListener('close', clientCloseHandler);
  if (clientErrorHandler || clientCloseHandler?.errorHandler) {
    clientRes.removeListener('error', clientErrorHandler || clientCloseHandler.errorHandler);
  }
  const maxRetries = Math.max(config.maxFailoverRetries || 2, (config.accounts ? config.accounts.length : 1));
  if (attemptNumber > maxRetries) {
    return false;
  }
  const nextAccount = selectAccount(sessionId, triedAccountIds);
  if (nextAccount && attemptNumber <= maxRetries) {
    const stat = accountStats.get(account.id);
    if (stat) stat.failoverCount += 1;
    console.log(`[${protocolTag} Failover] Account "${account.name}" returned ${statusCode} (Quota Exhausted). Switching to "${nextAccount.name}" (Attempt ${attemptNumber + 1})`);
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
    const errText = Buffer.concat(errorChunks).toString('utf8');
    const classified = classifyUpstreamError(statusCode, errText);
    if (classified && classified.isQuotaExhausted) {
      recordCooldown(account.id, 3600000, 'Quota / Balance Exhausted');
    }
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
  recordAccountFailure(account.id, `Upstream Cluster Node Failure (${statusCode})`, statusCode, false);
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
  recordAccountFailure(account.id, err.message, err.message && err.message.includes('Timeout') ? 504 : 502, false);
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
    const isCompEnabled = Boolean(config.compression && config.compression.enabled);
    if (Array.isArray(payload.messages)) {
      const pruneRes = codexAdapter.pruneChatMessages(payload.messages, null, sessionId, { enabled: isCompEnabled, emergency: true });
      const prunedMsgs = pruneRes.pruned || pruneRes;
      wasPruned = Boolean(pruneRes.modified);
      pruned = { ...payload, messages: prunedMsgs };
    } else if (Array.isArray(payload.input)) {
      const pruneRes = codexAdapter.pruneResponsesPayload(payload, sessionId, { enabled: isCompEnabled, emergency: true });
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
    const cachedFallback = getSessionModelFallback(sessionId, rawReqModel);
    if (cachedFallback && cachedFallback !== rawReqModel) {
      console.log(`[Auto Pre-Emptive Fallback] 会话 ${sessionId} 命中异构节点模型记忆，直接将 "${rawReqModel}" 替换为 "${cachedFallback}"`);
      responsesBody = { ...responsesBody, model: cachedFallback };
      model = cachedFallback;
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

/**
 * 健壮提取响应体或缓冲区中的 usage 对象，完整支持嵌套对象（如 prompt_tokens_details: { cached_tokens: ... }）
 */
function extractUsageFromBuffer(bufferStr) {
  if (!bufferStr || typeof bufferStr !== 'string' || !bufferStr.includes('"usage"')) return null;
  let searchIdx = bufferStr.length;
  while (searchIdx > 0) {
    const usageIdx = bufferStr.lastIndexOf('"usage"', searchIdx);
    if (usageIdx === -1) break;
    const colonIdx = bufferStr.indexOf(':', usageIdx + 7);
    if (colonIdx === -1) {
      searchIdx = usageIdx - 1;
      continue;
    }
    const braceStart = bufferStr.indexOf('{', colonIdx);
    if (braceStart === -1) {
      searchIdx = usageIdx - 1;
      continue;
    }
    const between = bufferStr.slice(colonIdx + 1, braceStart).trim();
    if (between.length > 0) {
      searchIdx = usageIdx - 1;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escape = false;
    let parsed = null;
    for (let i = braceStart; i < bufferStr.length; i++) {
      const ch = bufferStr[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              parsed = JSON.parse(bufferStr.slice(braceStart, i + 1));
            } catch (_) {}
            break;
          }
        }
      }
    }
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    searchIdx = usageIdx - 1;
  }
  return null;
}

function mergeUsageObjects(existing, newUsage) {
  if (!newUsage || typeof newUsage !== 'object') return existing;
  if (!existing) return { ...newUsage };
  const res = { ...existing, ...newUsage };
  if (typeof newUsage.prompt_tokens === 'number' || typeof newUsage.input_tokens === 'number') {
    res.prompt_tokens = newUsage.prompt_tokens ?? newUsage.input_tokens;
    res.input_tokens = res.prompt_tokens;
  }
  if (typeof newUsage.completion_tokens === 'number' || typeof newUsage.output_tokens === 'number') {
    res.completion_tokens = newUsage.completion_tokens ?? newUsage.output_tokens;
    res.output_tokens = res.completion_tokens;
  }
  if (newUsage.prompt_tokens_details || newUsage.input_tokens_details) {
    res.prompt_tokens_details = {
      ...(existing.prompt_tokens_details || {}),
      ...(newUsage.prompt_tokens_details || newUsage.input_tokens_details || {})
    };
  }
  if (typeof newUsage.cache_read_input_tokens === 'number') {
    res.cache_read_input_tokens = newUsage.cache_read_input_tokens;
  }
  return res;
}

/**
 * 网关代理层全量请求遥测联动上报 (Usage Telemetry Hook)
 * 捕获 upstream 返回的真实 usage 并与压缩引擎 savedTokens 联动
 */
function recordRequestUsageTelemetry(modelName, rawUsage, compSavings = null, timestamp = Date.now()) {
  if (!rawUsage || !contextCompactor || typeof contextCompactor.recordRequestTelemetry !== 'function') return;
  const inputTokens = Number(rawUsage.prompt_tokens ?? rawUsage.input_tokens ?? 0);
  const outputTokens = Number(rawUsage.completion_tokens ?? rawUsage.output_tokens ?? 0);
  const cachedTokens = Number(
    rawUsage.prompt_tokens_details?.cached_tokens ??
    rawUsage.input_tokens_details?.cached_tokens ??
    rawUsage.cache_read_input_tokens ??
    0
  );

  contextCompactor.recordRequestTelemetry({
    model: modelName,
    inputTokens,
    outputTokens,
    cachedTokens,
    savings: compSavings,
    timestamp
  });
}

function sendProxyRequest(clientReq, clientRes, reqBody, account, attemptNumber, triedAccountIds = new Set(), resolvedSessionId = null, precomputedParsedBody = null) {
  triedAccountIds.add(account.id);

  const effectiveUpstream = (account && typeof account.upstream === 'string' && account.upstream.trim()) ? account.upstream.trim() : config.upstream;
  const upstreamUrl = new URL(effectiveUpstream);
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
    const cachedFallback = getSessionModelFallback(sessionId, rawReqModel);
    if (cachedFallback && cachedFallback !== rawReqModel) {
      console.log(`[Auto Pre-Emptive Fallback] 会话 ${sessionId} 命中异构节点模型记忆，直接将 "${rawReqModel}" 替换为 "${cachedFallback}"`);
      parsedBody.model = cachedFallback;
      reqBody = Buffer.from(JSON.stringify(parsedBody), 'utf8');
    }
  }

  const isResponsesReq = targetPath.startsWith('/responses') || (clientReq.url && clientReq.url.includes('/responses'));
  if (isResponsesReq && parsedBody) {
    const isCompEnabled = Boolean(config.compression && config.compression.enabled);
    const hasBase64Image = reqBody && (reqBody.includes(';base64,') || reqBody.includes('data:image/'));
    if (isCompEnabled && Array.isArray(parsedBody.input) && (parsedBody.input.length > 12 || hasBase64Image || (reqBody && reqBody.length > 100000))) {
      try {
        const pruneRes = codexAdapter.pruneResponsesPayload(parsedBody, sessionId, { enabled: isCompEnabled });
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
  let requestCompSavings = null;
  if (parsedBody && config.compression && config.compression.enabled !== false && (!attemptNumber || attemptNumber <= 1)) {
    try {
      const parsedModel = (parsedBody && typeof parsedBody.model === 'string') ? parsedBody.model.replace(/^opencode-go\//, '') : undefined;
      const compOpts = {
        ...getEffectiveCompressionOptions(config.compression, clientReq),
        model: parsedModel,
        _isRetryAttempt: Boolean(attemptNumber && attemptNumber > 1)
      };
      const origByteLen = reqBody ? reqBody.length : 0;
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
      if (origByteLen > 0 && reqBody && reqBody.length < origByteLen) {
        const savedChars = origByteLen - reqBody.length;
        requestCompSavings = {
          savedChars,
          savedTokens: contextCompactor.estimateTokens(savedChars),
          originalChars: origByteLen
        };
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
  if (targetPath.includes('/messages')) {
    proxyHeaders['x-api-key'] = account.apiKey.trim();
    if (!proxyHeaders['anthropic-version']) {
      proxyHeaders['anthropic-version'] = clientReq.headers['anthropic-version'] || '2023-06-01';
    }
  } else {
    // Strip Anthropic-specific headers when proxying to OpenAI or native /responses endpoints
    delete proxyHeaders['x-api-key'];
    delete proxyHeaders['anthropic-version'];
    delete proxyHeaders['anthropic-beta'];
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

  const startTime = Date.now();
  let ttftTimer = null;
  let chunkIdleTimer = null;
  let ttftMs = null;

  const effectiveTtftTimeout = Number(config.ttftTimeoutMs) > 0 
    ? Number(config.ttftTimeoutMs) 
    : (config.circuitBreaker?.ttftTimeoutMs || 25000);

  const effectiveChunkIdleTimeout = Number(config.chunkIdleTimeoutMs) > 0 
    ? Number(config.chunkIdleTimeoutMs) 
    : (config.circuitBreaker?.chunkIdleTimeoutMs || 60000);

  const clearAllTimers = () => {
    if (ttftTimer) {
      clearTimeout(ttftTimer);
      ttftTimer = null;
    }
    if (chunkIdleTimer) {
      clearTimeout(chunkIdleTimer);
      chunkIdleTimer = null;
    }
  };

  ttftTimer = setTimeout(() => {
    if (responded || clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
    responded = true;
    clearAllTimers();
    console.warn(`[TTFT Timeout] Proxy request to "${account.name}" exceeded ${effectiveTtftTimeout}ms TTFT threshold before first byte.`);
    recordAccountFailure(account.id, `TTFT Timeout (${effectiveTtftTimeout}ms)`, 504);
    proxyReq.removeAllListeners('error');
    proxyReq.on('error', () => {});
    try {
      proxyReq.destroy(new Error(`TTFT Timeout (${effectiveTtftTimeout}ms)`));
    } catch (_) {}

    if (!clientRes.headersSent) {
      const nextAccount = selectAccount(sessionId, triedAccountIds);
      const maxRetries = Math.max(config.maxFailoverRetries || 2, (config.accounts ? config.accounts.length : 1));
      if (nextAccount && attemptNumber <= maxRetries) {
        console.log(`[TTFT Failover] In-flight switching from "${account.name}" to "${nextAccount.name}" (Attempt ${attemptNumber + 1})`);
        finishRequest();
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        sendProxyRequest(clientReq, clientRes, reqBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, parsedBody);
        return;
      }
    }
  }, effectiveTtftTimeout);

  const finishRequest = () => {
    clearAllTimers();
    if (!requestFinished) {
      requestFinished = true;
      if (stat && stat.activeRequests > 0) {
        stat.activeRequests -= 1;
      }
    }
  };

  let clientErrorHandler = null;
  const clientCloseHandler = () => {
    clearAllTimers();
    if (clientErrorHandler) {
      clientRes.removeListener('error', clientErrorHandler);
    }
    if (!clientRes.writableEnded) {
      clientAborted = true;
      if (stat && stat.halfOpenInFlight && stat.circuitState === CIRCUIT_STATE.HALF_OPEN) {
        stat.halfOpenInFlight = false;
      }
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
    if (ttftTimer) {
      clearTimeout(ttftTimer);
      ttftTimer = null;
    }
    ttftMs = Date.now() - startTime;
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

        if (classified.isQuotaExhausted) {
          const handled = handleQuotaExhaustedFailover({
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
    recordAccountSuccess(account.id, ttftMs);
    const outHeaders = getCorsHeaders(upstreamRes.headers);
    outHeaders['x-router-account-id'] = account.id;
    outHeaders['x-router-circuit-state'] = stat ? stat.circuitState : 'CLOSED';
    if (ttftMs !== null) outHeaders['x-router-ttft-ms'] = String(ttftMs);
    if (attemptNumber > 1) outHeaders['x-router-failover-attempts'] = String(attemptNumber - 1);
    clientRes.writeHead(statusCode, outHeaders);

    const resetChunkIdleTimer = () => {
      if (chunkIdleTimer) clearTimeout(chunkIdleTimer);
      chunkIdleTimer = setTimeout(() => {
        console.warn(`[Chunk Idle Timeout] Upstream stream idle for more than ${effectiveChunkIdleTimeout}ms`);
        try { upstreamRes.destroy(new Error(`Chunk Idle Timeout (${effectiveChunkIdleTimeout}ms)`)); } catch (_) {}
      }, effectiveChunkIdleTimeout);
    };
    resetChunkIdleTimer();
    upstreamRes.on('data', resetChunkIdleTimer);
    upstreamRes.on('end', () => {
      if (chunkIdleTimer) {
        clearTimeout(chunkIdleTimer);
        chunkIdleTimer = null;
      }
    });

    // Sniff response.id to lock root session mapping for native /responses models (e.g. Luna)
    let sessionSniffed = false;
    let sniffBuffer = '';
    const onSniffData = (chunk) => {
      if (sessionSniffed) return;
      sniffBuffer += chunk.toString('utf8', 0, Math.min(chunk.length, 1024));
      const m = sniffBuffer.match(/"id"\s*:\s*"(resp_[^"]+)"/);
      if (m && m[1]) {
        sessionSniffed = true;
        upstreamRes.removeListener('data', onSniffData);
        if (typeof codexAdapter.recordResponseSession === 'function') {
          codexAdapter.recordResponseSession(m[1], sessionId);
        }
      } else if (sniffBuffer.length > 2048) {
        sessionSniffed = true;
        upstreamRes.removeListener('data', onSniffData);
      }
    };
    upstreamRes.on('data', onSniffData);

    let capturedUsage = null;
    let sniffedTailBuffer = '';
    const onUsageSniff = (chunk) => {
      const s = chunk.toString('utf8');
      sniffedTailBuffer = (sniffedTailBuffer + s).slice(-32768);
      if (s.includes('data:')) {
        const lines = s.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
            try {
              const parsed = JSON.parse(trimmed.slice(5).trim());
              if (parsed.usage) capturedUsage = mergeUsageObjects(capturedUsage, parsed.usage);
              else if (parsed.message?.usage) capturedUsage = mergeUsageObjects(capturedUsage, parsed.message.usage);
              else if (parsed.response?.usage) capturedUsage = mergeUsageObjects(capturedUsage, parsed.response.usage);
              else if (parsed.delta?.usage) capturedUsage = mergeUsageObjects(capturedUsage, parsed.delta.usage);
            } catch (_) {}
          }
        }
      }
      if (s.includes('"usage"')) {
        const directExt = extractUsageFromBuffer(sniffedTailBuffer);
        if (directExt) capturedUsage = mergeUsageObjects(capturedUsage, directExt);
      }
    };
    upstreamRes.on('data', onUsageSniff);

    const isNativeResponsesStream = isResponsesReq && (parsedBody ? parsedBody.stream === true : Boolean(clientReq.headers && clientReq.headers.accept && clientReq.headers.accept.includes('text/event-stream')));
    let nativeResponsesHasOutput = false;
    let nativeResponsesHasCompleted = false;
    if (isNativeResponsesStream) {
      upstreamRes.on('data', (chunk) => {
        const s = chunk.toString('utf8');
        if (s.includes('response.output_item.') || s.includes('response.output_text.')) {
          nativeResponsesHasOutput = true;
        }
        if (s.includes('response.completed') || s.includes('response.failed') || s.includes('response.incomplete')) {
          nativeResponsesHasCompleted = true;
        }
      });
      upstreamRes.pipe(clientRes, { end: false });
    } else {
      upstreamRes.pipe(clientRes);
    }

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
            clientRes.end();
          } catch (_) {
            try { clientRes.destroy(err); } catch (_) {}
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
          try { clientRes.end(); } catch (_) { try { clientRes.destroy(err); } catch (_) {} }
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
      if (!capturedUsage && sniffedTailBuffer) {
        const directExt = extractUsageFromBuffer(sniffedTailBuffer);
        if (directExt) capturedUsage = mergeUsageObjects(capturedUsage, directExt);
      }
      if (capturedUsage) {
        recordRequestUsageTelemetry(reqModelName, capturedUsage);
      }
      if (isNativeResponsesStream && !clientRes.writableEnded && !clientRes.destroyed) {
        if (!nativeResponsesHasOutput && !nativeResponsesHasCompleted && typeof codexAdapter.dispatchResponsesStreamError === 'function') {
          const reqModel = parsedBody?.model || 'deepseek-v4.1-flash';
          codexAdapter.dispatchResponsesStreamError(
            clientRes,
            reqModel,
            parsedBody?.id,
            new Error('Upstream native Responses stream ended prematurely with 0 output items'),
            sessionId
          );
        } else {
          try { clientRes.end(); } catch (_) {}
        }
      }
    });
  });

  proxyReq.on('error', (err) => {
    clearAllTimers();
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);

    // If client was already closed / aborted, do NOT trigger failover or log false alarm
    if (clientAborted || clientRes.destroyed || clientRes.writableEnded || clientReq.destroyed) {
      console.log(`[Client Abort] Client disconnected before request completed with account "${account.name}". No failover needed.`);
      return;
    }

    recordAccountFailure(account.id, err.message, err.message && err.message.includes('Timeout') ? 504 : 502);
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

  const effectiveUpstream = (account && typeof account.upstream === 'string' && account.upstream.trim()) ? account.upstream.trim() : config.upstream;
  const upstreamUrl = new URL(effectiveUpstream);
  const isHttps = upstreamUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  let sessionId = resolvedSessionId || codexAdapter.extractOrDeriveSessionId(clientReq, responsesBody);
  let rawReqModel = (responsesBody && typeof responsesBody.model === 'string')
    ? responsesBody.model.replace(/^opencode-go\//, '')
    : undefined;

  // Pre-emptive model fallback check for heterogeneous upstream nodes
  if (sessionId && rawReqModel) {
    const cachedFallback = getSessionModelFallback(sessionId, rawReqModel);
    if (cachedFallback && cachedFallback !== rawReqModel) {
      console.log(`[Auto Pre-Emptive Fallback] 会话 ${sessionId} 命中异构节点模型记忆，直接将 "${rawReqModel}" 替换为 "${cachedFallback}"`);
      responsesBody = { ...responsesBody, model: cachedFallback };
      rawReqModel = cachedFallback;
    }
  }

  // Pre-flight check & pruning for oversized responses payload (Rule 5 & Rule 33)
  const isCompEnabled = Boolean(config.compression && config.compression.enabled);
  if (isCompEnabled && !precomputedChatPayload && responsesBody && Array.isArray(responsesBody.input) && !responsesBody.modified) {
    const shouldPrune = responsesBody.input.length > 12 ||
      (responsesBody.input.length > 3 && responsesBody.input.some(it => it && ((typeof it.output === 'string' && (it.output.length > 2000 || it.output.includes(';base64,'))) || (typeof it.content === 'string' && it.content.length > 5000))));
    if (shouldPrune) {
      try {
        const pruneRes = codexAdapter.pruneResponsesPayload(responsesBody, sessionId, { enabled: isCompEnabled });
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

  const startTime = Date.now();
  let ttftTimer = null;
  let chunkIdleTimer = null;
  let ttftMs = null;

  const effectiveTtftTimeout = Number(config.ttftTimeoutMs) > 0 
    ? Number(config.ttftTimeoutMs) 
    : (config.circuitBreaker?.ttftTimeoutMs || 25000);

  const effectiveChunkIdleTimeout = Number(config.chunkIdleTimeoutMs) > 0 
    ? Number(config.chunkIdleTimeoutMs) 
    : (config.circuitBreaker?.chunkIdleTimeoutMs || 60000);

  const clearAllTimers = () => {
    if (ttftTimer) {
      clearTimeout(ttftTimer);
      ttftTimer = null;
    }
    if (chunkIdleTimer) {
      clearTimeout(chunkIdleTimer);
      chunkIdleTimer = null;
    }
  };

  ttftTimer = setTimeout(() => {
    if (responded || clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
    responded = true;
    clearAllTimers();
    console.warn(`[TTFT Timeout] Bridge chat request for model "${reqModel}" exceeded ${effectiveTtftTimeout}ms TTFT threshold before first byte.`);
    recordAccountFailure(account.id, `TTFT Timeout (${effectiveTtftTimeout}ms)`, 504);
    proxyReq.removeAllListeners('error');
    proxyReq.on('error', () => {});
    try {
      proxyReq.destroy(new Error(`TTFT Timeout (${effectiveTtftTimeout}ms)`));
    } catch (_) {}

    if (!clientRes.headersSent) {
      const nextAccount = selectAccount(sessionId, triedAccountIds);
      const maxRetries = Math.max(config.maxFailoverRetries || 2, (config.accounts ? config.accounts.length : 1));
      if (nextAccount && attemptNumber <= maxRetries) {
        console.log(`[TTFT Failover] In-flight switching from "${account.name}" to "${nextAccount.name}" (Attempt ${attemptNumber + 1})`);
        finishRequest();
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, chatPayload);
        return;
      }
    }
  }, effectiveTtftTimeout);

  const finishRequest = () => {
    clearAllTimers();
    if (!requestFinished) {
      requestFinished = true;
      if (stat && stat.activeRequests > 0) {
        stat.activeRequests -= 1;
      }
    }
  };

  let clientErrorHandler = null;
  const clientCloseHandler = () => {
    clearAllTimers();
    if (clientErrorHandler) {
      clientRes.removeListener('error', clientErrorHandler);
    }
    if (!clientRes.writableEnded) {
      clientAborted = true;
      if (stat && stat.halfOpenInFlight && stat.circuitState === CIRCUIT_STATE.HALF_OPEN) {
        stat.halfOpenInFlight = false;
      }
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
    if (ttftTimer) {
      clearTimeout(ttftTimer);
      ttftTimer = null;
    }
    ttftMs = Date.now() - startTime;
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

        if (classified.isQuotaExhausted) {
          const handled = handleQuotaExhaustedFailover({
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
    recordAccountSuccess(account.id, ttftMs);
    if (!clientRes.headersSent) {
      try {
        clientRes.setHeader('x-router-account-id', account.id);
        clientRes.setHeader('x-router-circuit-state', stat ? stat.circuitState : 'CLOSED');
        if (ttftMs !== null) clientRes.setHeader('x-router-ttft-ms', String(ttftMs));
        if (attemptNumber > 1) clientRes.setHeader('x-router-failover-attempts', String(attemptNumber - 1));
      } catch (_) {}
    }

    if (isStream) {
      const resetChunkIdleTimer = () => {
        if (chunkIdleTimer) clearTimeout(chunkIdleTimer);
        chunkIdleTimer = setTimeout(() => {
          console.warn(`[Chunk Idle Timeout] Upstream chat stream idle for more than ${effectiveChunkIdleTimeout}ms`);
          try { upstreamRes.destroy(new Error(`Chunk Idle Timeout (${effectiveChunkIdleTimeout}ms)`)); } catch (_) {}
        }, effectiveChunkIdleTimeout);
      };
      resetChunkIdleTimer();
      upstreamRes.on('data', resetChunkIdleTimer);
      upstreamRes.on('end', () => {
        if (chunkIdleTimer) {
          clearTimeout(chunkIdleTimer);
          chunkIdleTimer = null;
        }
      });
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
    clearAllTimers();
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
    if (clientAborted || clientRes.destroyed || clientRes.writableEnded || clientReq.destroyed) return;
    recordAccountFailure(account.id, err.message, err.message && err.message.includes('Timeout') ? 504 : 502);

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
  const effectiveUpstream = (account && typeof account.upstream === 'string' && account.upstream.trim()) ? account.upstream.trim() : config.upstream;
  const upstreamUrl = new URL(effectiveUpstream);
  const isHttps = upstreamUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  let sessionId = resolvedSessionId || codexAdapter.extractOrDeriveSessionId(clientReq, responsesBody);
  let rawReqModel = (responsesBody && typeof responsesBody.model === 'string')
    ? responsesBody.model.replace(/^opencode-go\//, '')
    : undefined;

  // Pre-emptive model fallback check for heterogeneous upstream nodes (Rule 19)
  if (sessionId && rawReqModel) {
    const cachedFallback = getSessionModelFallback(sessionId, rawReqModel);
    if (cachedFallback && cachedFallback !== rawReqModel) {
      console.log(`[Auto Pre-Emptive Fallback] Anthropic 桥接会话 ${sessionId} 命中异构节点模型记忆，直接将 "${rawReqModel}" 替换为 "${cachedFallback}"`);
      responsesBody = { ...responsesBody, model: cachedFallback };
      rawReqModel = cachedFallback;
      if (!codexAdapter.ANTHROPIC_MODELS.has(cachedFallback)) {
        bridgeResponsesToChatRequest(clientReq, clientRes, responsesBody, account, attemptNumber, triedAccountIds, sessionId);
        return;
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
  const isCompEnabled = Boolean(config.compression && config.compression.enabled);
  if (isCompEnabled && !precomputedAnthropicPayload && responsesBody && Array.isArray(responsesBody.input) && !responsesBody.modified) {
    const shouldPrune = responsesBody.input.length > 12 ||
      (responsesBody.input.length > 3 && responsesBody.input.some(it => it && ((typeof it.output === 'string' && (it.output.length > 2000 || it.output.includes(';base64,'))) || (typeof it.content === 'string' && it.content.length > 5000))));
    if (shouldPrune) {
      try {
        const pruneRes = codexAdapter.pruneResponsesPayload(responsesBody, sessionId, { enabled: isCompEnabled });
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
    'authorization': `Bearer ${account.apiKey.trim()}`,
    'x-api-key': account.apiKey.trim(),
    'x-opencode-session': sessionId,
    'anthropic-version': clientReq.headers['anthropic-version'] || '2023-06-01',
    'user-agent': clientReq.headers['user-agent'] || 'OpenCode-Go-Router-AnthropicBridge/2.1'
  };
  if (clientReq.headers['anthropic-beta']) {
    proxyHeaders['anthropic-beta'] = clientReq.headers['anthropic-beta'];
  }

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

  const startTime = Date.now();
  let ttftTimer = null;
  let chunkIdleTimer = null;
  let ttftMs = null;

  const effectiveTtftTimeout = Number(config.ttftTimeoutMs) > 0 
    ? Number(config.ttftTimeoutMs) 
    : (config.circuitBreaker?.ttftTimeoutMs || 25000);

  const effectiveChunkIdleTimeout = Number(config.chunkIdleTimeoutMs) > 0 
    ? Number(config.chunkIdleTimeoutMs) 
    : (config.circuitBreaker?.chunkIdleTimeoutMs || 60000);

  const clearAllTimers = () => {
    if (ttftTimer) {
      clearTimeout(ttftTimer);
      ttftTimer = null;
    }
    if (chunkIdleTimer) {
      clearTimeout(chunkIdleTimer);
      chunkIdleTimer = null;
    }
  };

  ttftTimer = setTimeout(() => {
    if (responded || clientAborted || clientRes.destroyed || clientRes.writableEnded) return;
    responded = true;
    clearAllTimers();
    console.warn(`[TTFT Timeout] Bridge Anthropic request for model "${reqModel}" exceeded ${effectiveTtftTimeout}ms TTFT threshold before first byte.`);
    recordAccountFailure(account.id, `TTFT Timeout (${effectiveTtftTimeout}ms)`, 504);
    proxyReq.removeAllListeners('error');
    proxyReq.on('error', () => {});
    try {
      proxyReq.destroy(new Error(`TTFT Timeout (${effectiveTtftTimeout}ms)`));
    } catch (_) {}

    if (!clientRes.headersSent) {
      const nextAccount = selectAccount(sessionId, triedAccountIds);
      const maxRetries = Math.max(config.maxFailoverRetries || 2, (config.accounts ? config.accounts.length : 1));
      if (nextAccount && attemptNumber <= maxRetries) {
        console.log(`[TTFT Failover] In-flight switching from "${account.name}" to "${nextAccount.name}" (Attempt ${attemptNumber + 1})`);
        finishRequest();
        clientRes.removeListener('close', clientCloseHandler);
        if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
        bridgeResponsesToAnthropicRequest(clientReq, clientRes, responsesBody, nextAccount, attemptNumber + 1, triedAccountIds, sessionId, anthropicPayload);
        return;
      }
    }
  }, effectiveTtftTimeout);

  const finishRequest = () => {
    clearAllTimers();
    if (!requestFinished) {
      requestFinished = true;
      if (stat && stat.activeRequests > 0) {
        stat.activeRequests -= 1;
      }
    }
  };

  let clientErrorHandler = null;
  const clientCloseHandler = () => {
    clearAllTimers();
    if (clientErrorHandler) {
      clientRes.removeListener('error', clientErrorHandler);
    }
    if (!clientRes.writableEnded) {
      clientAborted = true;
      if (stat && stat.halfOpenInFlight && stat.circuitState === CIRCUIT_STATE.HALF_OPEN) {
        stat.halfOpenInFlight = false;
      }
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
    if (ttftTimer) {
      clearTimeout(ttftTimer);
      ttftTimer = null;
    }
    ttftMs = Date.now() - startTime;
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

        if (classified.isQuotaExhausted) {
          const handled = handleQuotaExhaustedFailover({
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
    recordAccountSuccess(account.id, ttftMs);
    if (!clientRes.headersSent) {
      try {
        clientRes.setHeader('x-router-account-id', account.id);
        clientRes.setHeader('x-router-circuit-state', stat ? stat.circuitState : 'CLOSED');
        if (ttftMs !== null) clientRes.setHeader('x-router-ttft-ms', String(ttftMs));
        if (attemptNumber > 1) clientRes.setHeader('x-router-failover-attempts', String(attemptNumber - 1));
      } catch (_) {}
    }

    if (isStream) {
      const resetChunkIdleTimer = () => {
        if (chunkIdleTimer) clearTimeout(chunkIdleTimer);
        chunkIdleTimer = setTimeout(() => {
          console.warn(`[Chunk Idle Timeout] Upstream Anthropic stream idle for more than ${effectiveChunkIdleTimeout}ms`);
          try { upstreamRes.destroy(new Error(`Chunk Idle Timeout (${effectiveChunkIdleTimeout}ms)`)); } catch (_) {}
        }, effectiveChunkIdleTimeout);
      };
      resetChunkIdleTimer();
      upstreamRes.on('data', resetChunkIdleTimer);
      upstreamRes.on('end', () => {
        if (chunkIdleTimer) {
          clearTimeout(chunkIdleTimer);
          chunkIdleTimer = null;
        }
      });
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
    clearAllTimers();
    finishRequest();
    clientRes.removeListener('close', clientCloseHandler);
    if (clientErrorHandler) clientRes.removeListener('error', clientErrorHandler);
    if (clientAborted || clientRes.destroyed || clientRes.writableEnded || clientReq.destroyed) return;
    recordAccountFailure(account.id, err.message, err.message && err.message.includes('Timeout') ? 504 : 502);

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
      '/vol4/1000/docker/opencode/workspace',
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
$appProfileDir = Join-Path $env:LOCALAPPDATA "OpenCodeRouter\\AppProfile"
$browserGhostCount = 0
if (Test-Path $appProfileDir) {
  $bps = Get-Process -Name "chrome", "msedge" -ErrorAction SilentlyContinue
  foreach ($bp in $bps) {
    if ($bp.MainWindowHandle -eq 0) {
      try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($bp.Id)").CommandLine
        if ($cmd -like "*OpenCodeRouter*AppProfile*") { $browserGhostCount++ }
      } catch {}
    }
  }
}
  BrowserGhostCount = $browserGhostCount
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
          if (procState.BrowserGhostCount > 0) {
            report.issues.push({
              id: 'router_browser_ghost_process',
              severity: 'high',
              title: '智能网关桌面前端后台无窗口僵死进程死锁单实例锁（导致桌面打不开）',
              desc: '检测到 ' + procState.BrowserGhostCount + ' 个后台无界面浏览器进程霸占 Chromium AppProfile 单实例锁，导致桌面双击图标无法打开或无反应，可一键自动清理释放'
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

  // 1. Reset all cooldowns & circuit breakers
  for (const stat of accountStats.values()) {
    stat.cooldownUntil = 0;
    stat.circuitState = CIRCUIT_STATE.CLOSED;
    stat.consecutiveFailures = 0;
    stat.halfOpenInFlight = false;
    stat.lastError = null;
  }
  results.push({ item: 'Reset Cooldowns', success: true, message: '已重置所有账号的限频冷却与熔断器状态' });

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
$appProfileDir = Join-Path $env:LOCALAPPDATA "OpenCodeRouter\\AppProfile"
$browserGhostFound = $false
if (Test-Path $appProfileDir) {
  $bps = Get-Process -Name "chrome", "msedge" -ErrorAction SilentlyContinue
  foreach ($bp in $bps) {
    if ($bp.MainWindowHandle -eq 0) {
      try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($bp.Id)").CommandLine
        if ($cmd -like "*OpenCodeRouter*AppProfile*") {
          Stop-Process -Id $bp.Id -Force -ErrorAction SilentlyContinue
          $browserGhostFound = $true
        }
      } catch {}
    }
  }
  $lf = Join-Path $appProfileDir "lockfile"
  if (Test-Path $lf) { Remove-Item $lf -Force -ErrorAction SilentlyContinue }
}
[PSCustomObject]@{ GhostKilled = $ghostFound; OrphanKilled = $orphanFound; BrowserGhostKilled = $browserGhostFound } | ConvertTo-Json -Compress
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
          }
          if (res.BrowserGhostKilled) {
            results.push({ item: 'Router Browser SingleInstanceLock', success: true, message: '已彻底终止无窗口僵死浏览器进程并释放 AppProfile 单实例锁' });
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

function isLoopbackRequest(req) {
  const remoteIp = (req && req.socket && req.socket.remoteAddress) || '';
  return remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1' || remoteIp === 'localhost';
}

function isTrustedManagementOrigin(origin) {
  if (!origin) return true; // Direct non-browser calls (curl, scripts, local test suites)
  const trimmed = String(origin).trim().toLowerCase();
  if (trimmed === 'null') return true; // file:// or local sandboxed context
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname;
    // Allow local loopback IPs and hostnames
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') {
      return true;
    }
    // Allow the configured router host if set
    if (config.host && host === config.host.toLowerCase()) {
      return true;
    }
    // Allow local desktop app protocols
    if (parsed.protocol === 'vscode-webview:' || parsed.protocol === 'app:' || parsed.protocol === 'file:' || parsed.protocol === 'tauri:') {
      return true;
    }
  } catch (_) {}
  return false;
}

function getManagementCorsOrigin(req) {
  const reqOrigin = req && req.headers && req.headers['origin'];
  if (!reqOrigin) return null;
  if (isTrustedManagementOrigin(reqOrigin)) {
    return reqOrigin;
  }
  return null;
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
  const isLoopback = isLoopbackRequest(req);

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
  <!-- Non-intrusive Gateway Offline Reconnection Banner -->
  <div id="gateway-connection-banner" class="connection-banner" role="alert" aria-live="assertive" style="display:none;">
    <span class="conn-dot"></span>
    <span id="gateway-connection-text">⚠️ 与智能网关通信中断，正在尝试重新连接 (第 1 次重试)...</span>
  </div>
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

function renderLanForbiddenPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>安全拦截 | OpenCode 智能路由网关</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico">
  <style>
    :root {
      --bg: #09090b;
      --card-bg: #121215;
      --border: #27272a;
      --primary: #f59e0b;
      --text: #f4f4f5;
      --muted: #a1a1aa;
    }
    * { box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      max-width: 520px;
      width: 100%;
      padding: 2.5rem 2rem;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
      text-align: center;
    }
    .icon {
      font-size: 3rem;
      margin-bottom: 1rem;
      line-height: 1;
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 600;
      margin: 0 0 0.75rem;
      color: #fbbf24;
    }
    p {
      color: var(--muted);
      font-size: 0.95rem;
      line-height: 1.6;
      margin: 0 0 1.25rem;
    }
    .notice-box {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.25);
      border-radius: 8px;
      padding: 1rem;
      font-size: 0.88rem;
      color: #fde68a;
      text-align: left;
      margin-bottom: 1.5rem;
      line-height: 1.6;
    }
    .btn {
      display: inline-block;
      padding: 0.65rem 1.25rem;
      background: #27272a;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      text-decoration: none;
      font-size: 0.9rem;
      transition: all 0.15s ease;
      cursor: pointer;
    }
    .btn:hover {
      background: #3f3f46;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🛡️</div>
    <h1>安全隔离拦截 (403 Forbidden)</h1>
    <p>网关当前尚未配置管理员访问密码 (<code>uiPassword</code>)。</p>
    <div class="notice-box">
      <strong>🔒 安全隔离防护机制 (Air-Gapped Safety)：</strong><br>
      为了保护您的账号凭据与本地系统安全，未设置密码时网关控制台已默认锁定为<strong>仅允许本机回路 (127.0.0.1)</strong> 访问。<br><br>
      <strong>如何开启局域网/远程访问：</strong><br>
      请直接在运行网关的宿主机浏览器中打开 <code>http://127.0.0.1:4010/balancer/ui</code>，在系统设置中配置 <code>uiPassword</code> 并保存，即可通过密码安全登录。
    </div>
    <a href="javascript:location.reload()" class="btn">🔄 刷新重试</a>
  </div>
</body>
</html>`;
}

let cachedIndexHtml = null;
let cachedIndexMtime = 0;
let cachedAppJs = null;
let cachedAppJsMtime = 0;

function renderDashboardHtml(config) {
  let pkgVersion = '3.14.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    if (pkg.version) pkgVersion = pkg.version;
  } catch (_) {}
  const activePort = (config && config.port) || 4010;
  const activeHost = (config && config.host) || '127.0.0.1';
  let psIsWin = process.platform === 'win32';
  try {
    const compCfg = (config && config.compression) || contextCompactor.DEFAULT_COMPRESSION_CONFIG;
    psIsWin = Boolean(powershellOptimizer.detectPlatform(compCfg).isWindows);
  } catch (_) {}

  const publicIndexPath = path.join(__dirname, 'public', 'index.html');
  const publicAppJsPath = path.join(__dirname, 'public', 'js', 'app.js');
  try {
    if (fs.existsSync(publicIndexPath)) {
      const stat = fs.statSync(publicIndexPath);
      if (!cachedIndexHtml || stat.mtimeMs > cachedIndexMtime) {
        cachedIndexHtml = fs.readFileSync(publicIndexPath, 'utf8');
        cachedIndexMtime = stat.mtimeMs;
      }
      let html = cachedIndexHtml
        .replace(/v3\.1[0-9]\.\d+ Pro/g, 'v' + pkgVersion + ' Pro')
        .replace(/4010 监听正常 \([^)]+\)/g, activePort + ' 监听正常 (' + activeHost + ')')
        .replace(/4010 监听正常/g, activePort + ' 监听正常')
        .replace(/端口:\s*\d+/g, '端口: ' + activePort)
        .replace(/Port:\s*\d+/g, 'Port: ' + activePort)
        .replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://127.0.0.1:' + activePort)
        .replace(/(<span style="color:var\(--muted\);">当前系统架构:<\/span>\s*<strong style="color:var\(--text\);">)[^<]+(<\/strong>)/, '$1' + process.platform + ' (' + process.arch + ')$2')
        .replace(/(<span style="color:var\(--muted\);">Node\.js 运行时:<\/span>\s*<strong style="color:var\(--text\);">)[^<]+(<\/strong>)/, '$1' + process.version + '$2')
        .replace(/(<span style="color:var\(--muted\);">网关服务监听:<\/span>\s*<strong style="color:var\(--primary\);">)[^<]+(<\/strong>)/, '$1' + activeHost + ':' + activePort + '$2')
        .replace(
          /<span class="badge [^"]*" id="badge-module-powershell-platform">[^<]*<\/span>/,
          '<span class="badge ' + (psIsWin ? 'badge-healthy' : 'badge-disabled') + '" id="badge-module-powershell-platform">' + (psIsWin ? '🟢 Windows 原生运行中' : '🐧 Linux 休眠旁路 (零干扰)') + '</span>'
        );

      if (fs.existsSync(publicAppJsPath)) {
        const jsStat = fs.statSync(publicAppJsPath);
        if (!cachedAppJs || jsStat.mtimeMs > cachedAppJsMtime) {
          cachedAppJs = fs.readFileSync(publicAppJsPath, 'utf8');
          cachedAppJsMtime = jsStat.mtimeMs;
        }
        html = html.replace('<script src="/public/js/app.js"></script>', () => '<script>\n' + cachedAppJs + '\n</script>');
      }
      return html;
    }
  } catch (err) {
    console.warn('[Dashboard Serve] Failed to read public/index.html:', err.message);
  }
  return '<!DOCTYPE html><html><head><title>OpenCode Go Router</title></head><body><h1>OpenCode Go Router</h1></body></html>';
}

const STATIC_MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStaticFile(req, res, relPath) {
  try {
    let decodedRel = relPath || '';
    try {
      decodedRel = decodeURIComponent(decodedRel);
    } catch (_) {}
    const publicDir = path.resolve(__dirname, 'public');
    const safePath = path.resolve(publicDir, decodedRel.replace(/^[\/\\]+/, ''));
    if (!safePath.startsWith(publicDir + path.sep) && safePath !== publicDir) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden: Directory traversal blocked');
      return;
    }
    if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    const contentType = STATIC_MIME_TYPES[ext] || 'application/octet-stream';
    const stat = fs.statSync(safePath);
    const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    const content = fs.readFileSync(safePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, must-revalidate',
      'ETag': etag
    });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  }
}

const MAX_INTERNAL_PAYLOAD = 4 * 1024 * 1024;
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
    const isMgmt = reqUrl.pathname.startsWith('/balancer/api/');
    const reqOrigin = req.headers['origin'];
    if (isMgmt && reqOrigin && !isTrustedManagementOrigin(reqOrigin)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Forbidden: Untrusted Origin' }));
      return;
    }
    const allowOrigin = (isMgmt && reqOrigin) ? reqOrigin : '*';
    const varyHeader = (isMgmt && reqOrigin) ? { 'Vary': 'Origin' } : {};
    res.writeHead(204, {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
      ...varyHeader
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
      service: 'opencode-go-router',
      version: CURRENT_ROUTER_VERSION,
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
      const state = getCircuitState(acc.id, now);
      const isCooling = state === CIRCUIT_STATE.OPEN || (stat.cooldownUntil || 0) > now;
      const remainingCooldown = isCooling ? Math.max(0, Math.ceil(((stat.cooldownUntil || 0) - now) / 1000)) : 0;
      let status = 'healthy';
      if (!acc.enabled || !acc.apiKey || !acc.apiKey.trim()) status = 'disabled';
      else if (isCooling) status = 'cooling_down';
      else if (state === CIRCUIT_STATE.HALF_OPEN) status = 'half_open';

      return {
        id: acc.id,
        name: acc.name,
        enabled: acc.enabled,
        hasKey: Boolean(acc.apiKey && acc.apiKey.trim()),
        status,
        circuitState: state,
        consecutiveFailures: stat.consecutiveFailures || 0,
        consecutiveSuccesses: stat.consecutiveSuccesses || 0,
        halfOpenInFlight: Boolean(stat.halfOpenInFlight),
        avgTtftMs: stat.avgTtftMs || null,
        lastTtftMs: stat.lastTtftMs || null,
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
      defaultModel: config.defaultModel || 'deepseek-v4.1-flash',
      upstream: config.upstream,
      sessionAffinityEnabled: config.sessionAffinityEnabled,
      defaultCooldownMs: config.defaultCooldownMs,
      maxFailoverRetries: config.maxFailoverRetries,
      ttftTimeoutMs: config.ttftTimeoutMs || 25000,
      chunkIdleTimeoutMs: config.chunkIdleTimeoutMs || 60000,
      circuitBreaker: config.circuitBreaker || DEFAULT_CIRCUIT_CONFIG,
      activeSessions: sessionMap.size,
      accounts: accountsData
    }, null, 2));
    return;
  }

  // Circuit Breaker Status API
  if (reqUrl.pathname === '/balancer/api/circuit-status' && req.method === 'GET') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized: 请输入管理员访问密码' }));
      return;
    }
    const now = Date.now();
    const accountsData = config.accounts.map(acc => {
      const stat = accountStats.get(acc.id) || {};
      const state = getCircuitState(acc.id, now);
      const isCooling = state === CIRCUIT_STATE.OPEN || (stat.cooldownUntil || 0) > now;
      const remSec = isCooling ? Math.max(0, Math.ceil(((stat.cooldownUntil || 0) - now) / 1000)) : 0;
      return {
        id: acc.id,
        name: acc.name,
        enabled: acc.enabled,
        hasKey: Boolean(acc.apiKey && acc.apiKey.trim()),
        circuitState: state,
        consecutiveFailures: stat.consecutiveFailures || 0,
        consecutiveSuccesses: stat.consecutiveSuccesses || 0,
        halfOpenInFlight: Boolean(stat.halfOpenInFlight),
        cooldownRemainingSec: remSec,
        lastTtftMs: stat.lastTtftMs || null,
        avgTtftMs: stat.avgTtftMs || null,
        activeRequests: stat.activeRequests || 0,
        totalRequests: stat.totalRequests || 0,
        rateLimitCount: stat.rateLimitCount || 0,
        failoverCount: stat.failoverCount || 0,
        lastError: stat.lastError || null
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      success: true,
      ok: true,
      timestamp: new Date().toISOString(),
      circuitBreaker: config.circuitBreaker || DEFAULT_CIRCUIT_CONFIG,
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

  if (reqUrl.pathname === '/balancer/api/auth/logout' && (req.method === 'POST' || req.method === 'GET')) {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'router_auth=; Path=/; Max-Age=0; SameSite=Lax',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ success: true, message: '已安全注销登录并清除凭证' }));
    return;
  }

  if ((reqUrl.pathname === '/balancer/api/auth' || reqUrl.pathname === '/balancer/api/auth/login') && req.method === 'POST') {
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

  // Security Boundary & Auth Gatekeeper for all /balancer/api/* endpoints
  if (reqUrl.pathname.startsWith('/balancer/api/')) {
    // 1. Origin header CSRF & Cross-Site Data Leak Defense
    const reqOrigin = req.headers['origin'];
    if (reqOrigin && !isTrustedManagementOrigin(reqOrigin)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: '安全拦截：禁止未受信任的跨域来源访问管理接口 (Cross-Origin Access Denied)' }));
      return;
    }

    // 2. Auth & Air-Gapped LAN Gatekeeper (Rule 28 & Air-Gapped Safety)
    if (config.uiPassword && config.uiPassword.trim()) {
      if (!isAuthorized(req)) {
        const corsOrigin = getManagementCorsOrigin(req);
        res.writeHead(401, {
          'Content-Type': 'application/json; charset=utf-8',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin, 'Vary': 'Origin' } : {})
        });
        res.end(JSON.stringify({ success: false, error: 'Unauthorized: 请输入管理员访问密码' }));
        return;
      }
    } else {
      // When uiPassword is not configured, strictly restrict control plane to local loopback (127.0.0.1)
      if (!isLoopbackRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          error: '安全拦截：网关未设置 uiPassword 时，管理控制接口仅限本机 (127.0.0.1) 访问。如需局域网管理，请先在本机配置 uiPassword。'
        }));
        return;
      }
    }
  }

  // Get full config API (for UI)
  if (reqUrl.pathname === '/balancer/api/config' && req.method === 'GET') {
    const corsOrigin = getManagementCorsOrigin(req);
    const shouldMask = reqUrl.searchParams.get('mask') === '1' || reqUrl.searchParams.get('mask') === 'true' || reqUrl.searchParams.get('desensitize') === '1';
    const maskSecret = (s) => {
      if (!s || typeof s !== 'string') return '';
      const t = s.trim();
      if (t.length <= 6) return '******';
      return t.slice(0, 3) + '****' + t.slice(-4);
    };
    const outAccounts = shouldMask
      ? (config.accounts || []).map(a => ({ ...a, apiKey: a.apiKey ? maskSecret(a.apiKey) : '' }))
      : config.accounts;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': corsOrigin || '*',
      ...(corsOrigin ? { 'Vary': 'Origin' } : {})
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
      uiPassword: shouldMask ? (config.uiPassword ? '******' : '') : (config.uiPassword || ''),
      accounts: outAccounts,
      compression: config.compression || DEFAULT_CONFIG.compression,
      comfyui: config.comfyui || DEFAULT_CONFIG.comfyui || { enabled: true, host: 'http://127.0.0.1:8284', workflowsDir: '', localDir: '', repoUrl: 'https://github.com/deancyl/comfyui-agent-workflows', timeoutSec: 180 }
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

          // Clean & validate accounts (Rule 28 & SSRF protocol hardening)
          newAccounts = payload.accounts.map((acc, index) => {
            let accUpstream = acc.upstream;
            if (accUpstream && typeof accUpstream === 'string' && accUpstream.trim()) {
              const u = new URL(accUpstream.trim());
              if (u.protocol !== 'http:' && u.protocol !== 'https:') {
                throw new Error(`账号 [${acc.name || index + 1}] 自定义 upstream 仅支持 http:// 或 https://`);
              }
            }
            return {
              id: acc.id || `account-${Date.now()}-${index}`,
              name: (acc.name || `账号 ${index + 1}`).trim(),
              apiKey: (acc.apiKey || '').trim(),
              enabled: Boolean(acc.enabled),
              ...(accUpstream ? { upstream: accUpstream.trim() } : {})
            };
          });
        }

        let newUpstream = config.upstream;
        if (payload.upstream !== undefined) {
          const upStr = String(payload.upstream).trim();
          if (!upStr) throw new Error('Upstream 地址不能为空');
          try {
            const parsedUp = new URL(upStr);
            if (parsedUp.protocol !== 'http:' && parsedUp.protocol !== 'https:') {
              throw new Error('Upstream 端点协议仅支持 http:// 或 https://');
            }
            if (!parsedUp.hostname) {
              throw new Error('Upstream 端点主机名不能为空');
            }
            newUpstream = upStr;
          } catch (e) {
            throw new Error(`非法的 Upstream 地址: ${e.message}`);
          }
        }

        const newConfig = {
          ...config,
          upstream: newUpstream,
          defaultCooldownMs: payload.defaultCooldownMs !== undefined ? (Number(payload.defaultCooldownMs) || config.defaultCooldownMs) : config.defaultCooldownMs,
          maxFailoverRetries: payload.maxFailoverRetries !== undefined ? (Number(payload.maxFailoverRetries) || config.maxFailoverRetries) : config.maxFailoverRetries,
          sessionAffinityEnabled: payload.sessionAffinityEnabled !== undefined ? Boolean(payload.sessionAffinityEnabled) : config.sessionAffinityEnabled,
          allowModelAutoUpgrade: payload.allowModelAutoUpgrade !== undefined ? Boolean(payload.allowModelAutoUpgrade) : Boolean(config.allowModelAutoUpgrade),
          allowRegionFallback: payload.allowRegionFallback !== undefined ? Boolean(payload.allowRegionFallback) : Boolean(config.allowRegionFallback),
          accounts: newAccounts,
          plugins: (payload.plugins && typeof payload.plugins === 'object') ? payload.plugins : ((pluginManager ? pluginManager.getPluginsConfig() : config.plugins) || {})
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
        if (payload.port !== undefined) {
          const p = parseInt(payload.port, 10);
          if (Number.isInteger(p) && p >= 1 && p <= 65535) {
            newConfig.port = p;
          }
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
          let validatedHost = prevComfy.host || 'http://127.0.0.1:8284';
          if (payload.comfyui.host !== undefined) {
            const hStr = String(payload.comfyui.host).trim();
            if (hStr) {
              const u = new URL(hStr);
              if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('ComfyUI host 仅支持 http:// 或 https://');
            }
            validatedHost = hStr;
          }
          let validatedRepoUrl = prevComfy.repoUrl || 'https://github.com/deancyl/comfyui-agent-workflows';
          if (payload.comfyui.repoUrl !== undefined) {
            const rStr = String(payload.comfyui.repoUrl).trim();
            if (rStr) {
              const u = new URL(rStr);
              if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('ComfyUI repoUrl 仅支持 http:// 或 https://');
            }
            validatedRepoUrl = rStr;
          }
          newConfig.comfyui = {
            enabled: payload.comfyui.enabled !== false,
            host: validatedHost,
            workflowsDir: (payload.comfyui.workflowsDir !== undefined ? String(payload.comfyui.workflowsDir).trim() : (prevComfy.workflowsDir || '')),
            localDir: (payload.comfyui.localDir !== undefined ? String(payload.comfyui.localDir).trim() : (prevComfy.localDir || '')),
            repoUrl: validatedRepoUrl,
            timeoutSec: (Number(payload.comfyui.timeoutSec) && Number(payload.comfyui.timeoutSec) > 0) ? Number(payload.comfyui.timeoutSec) : (prevComfy.timeoutSec || 180)
          };
          if (typeof comfyuiAdapter !== 'undefined' && comfyuiAdapter) {
            comfyuiAdapter.config = newConfig;
            comfyuiAdapter.enabled = newConfig.comfyui.enabled !== false;
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

        if (pluginManager && payload.plugins && typeof payload.plugins === 'object') {
          for (const [pId, pCfg] of Object.entries(payload.plugins)) {
            if (pCfg && pCfg.enabled === false) {
              pluginManager.disablePlugin(pId).catch(() => {});
            } else if (pCfg && pCfg.enabled === true) {
              pluginManager.enablePlugin(pId, { persist: false }).catch(() => {});
            }
          }
        }

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

  // Account Quota & Usage API (Supports both GET query params and POST JSON payload)
  if (reqUrl.pathname === '/balancer/api/account-quota' && (req.method === 'POST' || req.method === 'GET')) {
    const handleQuotaQuery = async (payload = {}) => {
      try {
        let apiKey = (payload.apiKey || '').trim();
        const targetAccountId = payload.accountId || payload.account_id || payload.id;
        let matchedAcc = null;
        if (targetAccountId) {
          matchedAcc = config.accounts.find(a => a.id === targetAccountId);
        } else if (!apiKey && config.accounts.length > 0) {
          matchedAcc = config.accounts.find(a => a.enabled && a.apiKey && a.apiKey.trim()) || config.accounts[0];
        }
        if (!apiKey && matchedAcc && matchedAcc.apiKey) {
          apiKey = matchedAcc.apiKey.trim();
        }
        const targetUpstream = (payload.upstream || (matchedAcc && matchedAcc.upstream) || config.upstream).trim();

        if (!apiKey) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, message: '未配置 API Key' }));
          return;
        }

        const force = payload.force === true || payload.force === '1' || payload.force === 'true';
        const result = await fetchAccountUsage(targetUpstream, apiKey, force);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    };
    if (req.method === 'GET') {
      handleQuotaQuery(reqUrl.query || {});
      return;
    }
    readInternalBody(req, res).then((buf) => {
      if (!buf) return;
      let payload = {};
      try { if (buf.length > 0) payload = JSON.parse(buf.toString('utf8')); } catch (_) {}
      handleQuotaQuery(payload);
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

          // Use explorer.exe to launch cleanly decoupled (Rule 14 & Rule 28)
          const child = spawn('explorer.exe', [foundExe], {
            detached: true,
            stdio: 'ignore'
          });
          child.unref();
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

  // Static Assets Handler (Hardened Sandbox & MIME Dispatch)
  const rawUrlPath = (req.url || '').split('?')[0];
  if (rawUrlPath.startsWith('/assets/') || reqUrl.pathname.startsWith('/assets/') || reqUrl.pathname === '/favicon.ico') {
    const rawSubPath = reqUrl.pathname === '/favicon.ico' ? 'router.ico' : (
      rawUrlPath.startsWith('/assets/') ? rawUrlPath.slice('/assets/'.length) : reqUrl.pathname.slice('/assets/'.length)
    );
    let decodedSubPath = '';
    try {
      decodedSubPath = decodeURIComponent(rawSubPath);
    } catch (_) {
      decodedSubPath = rawSubPath;
    }

    const assetsBaseDir = path.resolve(path.join(__dirname, 'assets'));
    const safeTarget = path.resolve(path.join(assetsBaseDir, decodedSubPath));
    const assetsBasePrefix = assetsBaseDir.endsWith(path.sep) ? assetsBaseDir : (assetsBaseDir + path.sep);

    if (safeTarget !== assetsBaseDir && !safeTarget.startsWith(assetsBasePrefix)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Access denied: Path traversal prohibited' }));
      return;
    }

    if (fs.existsSync(safeTarget) && fs.statSync(safeTarget).isFile()) {
      const ext = path.extname(safeTarget).toLowerCase();
      const mimeTypes = {
        '.ico': 'image/x-icon',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.json': 'application/json; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.json' ? 'no-cache' : 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(safeTarget).pipe(res);
      return;
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Asset not found' }));
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
            stat.circuitState = CIRCUIT_STATE.CLOSED;
            stat.consecutiveFailures = 0;
            stat.halfOpenInFlight = false;
            stat.lastError = null;
          }
        } else {
          for (const stat of accountStats.values()) {
            stat.cooldownUntil = 0;
            stat.circuitState = CIRCUIT_STATE.CLOSED;
            stat.consecutiveFailures = 0;
            stat.halfOpenInFlight = false;
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

let modelsHubProbeCache = null;
let lastModelsHubProbeTime = 0;
const MODELS_HUB_PROBE_TTL_MS = 10000; // 10s TTL (Rule 7 Anti-Throttling)

  // Models Hub API: 获取模型调度中心全量元数据、上游深度诊断与多端状态 (GET)
  if (reqUrl.pathname === '/balancer/api/models/hub' && req.method === 'GET') {
    (async () => {
      try {
        const updater = require('./updater');
        const clientAdapter = require('./client-adapter-manager');
        const proxyInfo = getEffectiveProxyForRequest(null);
        const proxyAgent = proxyInfo ? getProxyAgent(proxyInfo.url, new URL(config.upstream).protocol === 'https:') : null;

        // 探测上游模型与深层故障诊断 (带 10s 内存级防抖缓存，支持 ?force=1 穿透刷新 - Rule 7)
        const forceProbe = reqUrl.searchParams.get('force') === '1' || reqUrl.searchParams.get('force') === 'true';
        const now = Date.now();
        let probeRes = null;
        if (!forceProbe && modelsHubProbeCache && (now - lastModelsHubProbeTime < MODELS_HUB_PROBE_TTL_MS)) {
          probeRes = modelsHubProbeCache;
        } else {
          probeRes = await updater.fetchOfficialModels(config.accounts, config.upstream, 3500, {
            returnDetails: true,
            agent: proxyAgent
          });
          modelsHubProbeCache = probeRes;
          lastModelsHubProbeTime = now;
        }

        const policy = config.modelSourcePolicy || 'hybrid';
        const officialModels = clientAdapter.loadOfficialModels();
        const probedSlugs = probeRes?.slugs || [];
        const activeModels = clientAdapter.filterModelsByPolicy(policy, {
          officialModels,
          probedModels: probedSlugs
        });

        const clientStatus = clientAdapter.getClientStatus({ routerPort: config.port });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: true,
          policy,
          modelsCount: activeModels.length,
          availablePolicies: clientAdapter.MODEL_SOURCE_POLICIES,
          defaultModel: config.defaultModel || 'deepseek-v4.1-flash',
          favoriteModels: config.favoriteModels || ['deepseek-v4.1-flash', 'kimi-k3'],
          upstreamStatus: {
            healthy: Boolean(probeRes && probeRes.success),
            probedCount: probedSlugs.length,
            diagnostic: probeRes?.diagnostic || null,
            accountsTested: probeRes?.accountsTested || 0
          },
          counts: {
            officialCount: officialModels.length,
            probedCount: probedSlugs.length,
            activeCount: activeModels.length
          },
          models: activeModels,
          clients: clientStatus
        }, null, 2));
      } catch (hubErr) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: hubErr.message }));
      }
    })();
    return;
  }

  // Models Policy API: 切换模型获取源策略 (POST)
  if ((reqUrl.pathname === '/balancer/api/models/policy' || reqUrl.pathname === '/balancer/api/models/source-policy') && req.method === 'POST') {
    readInternalBody(req, res).then((buf) => {
      try {
        const rawBody = buf ? buf.toString('utf8') : '';
        const body = rawBody ? JSON.parse(rawBody) : {};
        const clientAdapter = require('./client-adapter-manager');
        const targetPolicy = body.policy;
        if (!clientAdapter.MODEL_SOURCE_POLICIES.includes(targetPolicy)) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ success: false, error: `无效策略: ${targetPolicy}，必须为: ${clientAdapter.MODEL_SOURCE_POLICIES.join(', ')}` }));
        }

        config.modelSourcePolicy = targetPolicy;
        if (body.defaultModel) config.defaultModel = body.defaultModel;
        if (Array.isArray(body.favoriteModels)) config.favoriteModels = body.favoriteModels;

        // 原子持久化写入 config.json
        writeFileSyncAtomic(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');

        // 若需要联动同步至各客户端
        if (body.syncClients) {
          clientAdapter.syncAllClients({
            routerPort: config.port,
            policy: targetPolicy,
            defaultModel: config.defaultModel,
            favorites: config.favoriteModels
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: true,
          policy: targetPolicy,
          defaultModel: config.defaultModel,
          message: `模型获取源策略已成功切换为【${targetPolicy}】并已持久化保存！`
        }, null, 2));
      } catch (parseErr) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: parseErr.message }));
      }
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  // Dynamic Official Models Sync API
  if (reqUrl.pathname === '/balancer/api/models/sync') {
    const handleSync = async (body = {}) => {
      const updater = require('./updater');
      const clientAdapter = require('./client-adapter-manager');
      const proxyInfo = getEffectiveProxyForRequest(null);
      const proxyAgent = proxyInfo ? getProxyAgent(proxyInfo.url, new URL(config.upstream).protocol === 'https:') : null;

      const policy = body.policy || config.modelSourcePolicy || 'hybrid';
      const defaultModel = body.defaultModel || config.defaultModel || 'deepseek-v4.1-flash';
      const favorites = body.favorites || config.favoriteModels || ['deepseek-v4.1-flash', 'kimi-k3'];
      const targetClients = Array.isArray(body.clients) ? body.clients : ['opencode', 'openchamber', 'codex'];

      // 探测上游
      const probeRes = await updater.fetchOfficialModels(config.accounts, config.upstream, 4000, {
        returnDetails: true,
        agent: proxyAgent
      });

      const syncResult = clientAdapter.syncAllClients({
        routerPort: config.port,
        policy,
        defaultModel,
        favorites,
        probedModels: probeRes?.slugs || [],
        clients: targetClients,
        preserveChoice: body.preserveChoice
      });

      // 同步 Token 压缩率
      try {
        await contextCompactor.syncModelRatesFromOpenCode();
      } catch (_) {}

      const allOfficial = clientAdapter.loadOfficialModels();
      const filtered = clientAdapter.filterModelsByPolicy(policy, { probedModels: probeRes?.slugs || [] });
      const returnedModels = filtered.map(m => m.slug || m);

      return {
        success: syncResult.success,
        policy,
        modelsCount: syncResult.modelsCount,
        officialCount: Math.max(allOfficial.length, syncResult.modelsCount, 38),
        totalModelCount: syncResult.modelsCount,
        models: returnedModels,
        defaultModel,
        syncedClients: targetClients,
        syncDetails: syncResult,
        upstreamProbe: {
          healthy: Boolean(probeRes && probeRes.success),
          probedCount: probeRes?.slugs?.length || 0,
          diagnostic: probeRes?.diagnostic || null
        },
        message: `全端模型目录与策略同步完成 (策略: ${policy}，已装配 ${syncResult.modelsCount} 款模型，首选: ${defaultModel})`
      };
    };

    if (req.method === 'POST') {
      readInternalBody(req, res).then(async (buf) => {
        try {
          const rawBody = buf ? buf.toString('utf8') : '';
          const body = rawBody ? JSON.parse(rawBody) : {};
          const result = await handleSync(body);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(result, null, 2));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      }).catch(err => {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      });
      return;
    } else {
      // GET fallback
      handleSync().then(result => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result, null, 2));
      }).catch(e => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      });
      return;
    }
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
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized: 请提供有效的访问密码或 API Key', type: 'authentication_error', code: 401 } }));
      return;
    }
    const rawFilename = reqUrl.pathname.slice('/artifacts/images/'.length);
    const safeFilename = path.basename(decodeURIComponent(rawFilename));
    const targetFilePath = path.join(__dirname, 'artifacts', 'images', safeFilename);
    const safeBaseDir = path.join(__dirname, 'artifacts', 'images');

    // Strict boundary defense against path traversal attacks (Rule 5 & Air-Gapped Safety)
    const normTarget = path.resolve(targetFilePath);
    const normBase = path.resolve(safeBaseDir);
    const isInsideBase = process.platform === 'win32'
      ? normTarget.toLowerCase().startsWith(normBase.toLowerCase() + path.sep)
      : normTarget.startsWith(normBase + path.sep);

    if (!isInsideBase || safeFilename.includes('..') || safeFilename.includes('/') || safeFilename.includes('\\') || safeFilename.includes('\0')) {
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
    const fileStream = fs.createReadStream(targetFilePath);
    fileStream.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      res.end('Error streaming file');
    });
    res.on('close', () => {
      fileStream.destroy();
    });
    fileStream.pipe(res);
    return;
  }

  // ComfyUI Status API (/balancer/api/comfyui/status)
  if (reqUrl.pathname === '/balancer/api/comfyui/status' && req.method === 'GET') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    const force = reqUrl.query?.force === 'true' || reqUrl.query?.force === '1';
    comfyuiAdapter.detectServer(force).then(status => {
      const wfs = comfyuiAdapter.manifest || {};
      const isEnabled = config.comfyui?.enabled !== false && comfyuiAdapter.enabled !== false;
      const detectedDirs = typeof comfyuiAdapter.detectLocalComfyUIDirs === 'function' ? comfyuiAdapter.detectLocalComfyUIDirs() : [];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        success: true,
        enabled: isEnabled,
        status,
        detectedDirs,
        workflowsDir: comfyuiAdapter.workflowsDir,
        localDir: config.comfyui?.localDir || (detectedDirs[0]?.path || ''),
        repoUrl: config.comfyui?.repoUrl || 'https://github.com/deancyl/comfyui-agent-workflows',
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

  // ComfyUI Plugin Toggle API (/balancer/api/comfyui/toggle)
  if (reqUrl.pathname === '/balancer/api/comfyui/toggle' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then((buf) => {
      if (!buf) return;
      try {
        const payload = JSON.parse(buf.toString('utf8'));
        const newEnabled = payload.enabled !== false;
        if (!config.comfyui) config.comfyui = { ...DEFAULT_CONFIG.comfyui };
        config.comfyui.enabled = newEnabled;
        if (comfyuiAdapter) comfyuiAdapter.enabled = newEnabled;

        if (pluginManager) {
          config.plugins = pluginManager.getPluginsConfig();
          if (newEnabled) {
            pluginManager.enablePlugin('comfyui').catch(() => {});
          } else {
            pluginManager.disablePlugin('comfyui').catch(() => {});
          }
        }
        
        // Atomic persist to config.json
        if (fs.existsSync(CONFIG_FILE)) {
          fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak');
        }
        writeFileSyncAtomic(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: true,
          enabled: newEnabled,
          message: newEnabled ? 'ComfyUI 视觉生图插件已成功启用' : 'ComfyUI 视觉生图插件已安全停用'
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // ComfyUI Service Control: Start (/balancer/api/comfyui/service/start)
  if (reqUrl.pathname === '/balancer/api/comfyui/service/start' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then(async (buf) => {
      if (!buf || res.headersSent || res.writableEnded) return;
      try {
        const payload = buf.length > 0 ? JSON.parse(buf.toString('utf8')) : {};
        const result = await comfyuiAdapter.startService(payload);
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ComfyUI Service Control: Stop (/balancer/api/comfyui/service/stop)
  if (reqUrl.pathname === '/balancer/api/comfyui/service/stop' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then(async (buf) => {
      if (!buf || res.headersSent || res.writableEnded) return;
      try {
        const payload = buf.length > 0 ? JSON.parse(buf.toString('utf8')) : {};
        const result = await comfyuiAdapter.stopService(payload);
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ComfyUI Service Control: Restart (/balancer/api/comfyui/service/restart)
  if (reqUrl.pathname === '/balancer/api/comfyui/service/restart' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then(async (buf) => {
      if (!buf || res.headersSent || res.writableEnded) return;
      try {
        const payload = buf.length > 0 ? JSON.parse(buf.toString('utf8')) : {};
        const result = await comfyuiAdapter.restartService(payload);
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ComfyUI Open Web GUI (/balancer/api/comfyui/open-gui)
  if (reqUrl.pathname === '/balancer/api/comfyui/open-gui' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then((buf) => {
      if (!buf || res.headersSent || res.writableEnded) return;
      try {
        const payload = buf.length > 0 ? JSON.parse(buf.toString('utf8')) : {};
        const targetUrl = payload.url || config.comfyui?.host || 'http://127.0.0.1:8284';
        const opened = comfyuiAdapter.openWebGui(targetUrl);
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: opened, url: targetUrl, message: '已通过独立应用窗口呼出 ComfyUI Web 界面' }));
      } catch (err) {
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ComfyUI Workflows Sync from GitHub (/balancer/api/comfyui/sync-workflows)
  if (reqUrl.pathname === '/balancer/api/comfyui/sync-workflows' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then(async (buf) => {
      if (!buf || res.headersSent || res.writableEnded) return;
      try {
        const payload = buf.length > 0 ? JSON.parse(buf.toString('utf8')) : {};
        const result = await comfyuiAdapter.syncWorkflowsFromGitHub(payload);
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ComfyUI Deploy Workflows & Patches to Local ComfyUI (/balancer/api/comfyui/deploy-to-comfyui)
  if (reqUrl.pathname === '/balancer/api/comfyui/deploy-to-comfyui' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then(async (buf) => {
      if (!buf || res.headersSent || res.writableEnded) return;
      try {
        const payload = buf.length > 0 ? JSON.parse(buf.toString('utf8')) : {};
        const result = await comfyuiAdapter.deployToComfyUI(payload);
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ComfyUI Detect Local Directories (/balancer/api/comfyui/detect-dirs)
  if (reqUrl.pathname === '/balancer/api/comfyui/detect-dirs' && req.method === 'GET') {
    // N5 Fix: Enforce LAN auth gatekeeper to prevent filesystem structure leakage
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    const dirs = typeof comfyuiAdapter.detectLocalComfyUIDirs === 'function' ? comfyuiAdapter.detectLocalComfyUIDirs() : [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: true, dirs }));
    return;
  }

  // =========================================================================
  // Plugin Center Microkernel APIs (/balancer/api/plugins/*)
  // =========================================================================

  // 1. List Plugins (/balancer/api/plugins)
  if (reqUrl.pathname === '/balancer/api/plugins' && req.method === 'GET') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    const plugins = pluginManager ? pluginManager.listPlugins() : [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: true, count: plugins.length, plugins }));
    return;
  }

  // 2. Rescan Plugins (/balancer/api/plugins/rescan)
  if (reqUrl.pathname === '/balancer/api/plugins/rescan' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    const scanned = pluginManager ? pluginManager.scanPlugins() : [];
    const plugins = pluginManager ? pluginManager.listPlugins() : [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: true, count: plugins.length, plugins }));
    return;
  }

  // 3. Toggle Plugin Enable/Disable (/balancer/api/plugins/toggle)
  if (reqUrl.pathname === '/balancer/api/plugins/toggle' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then(async (buf) => {
      if (!buf || res.headersSent || res.writableEnded) return;
      try {
        const payload = JSON.parse(buf.toString('utf8'));
        const pluginId = payload.id || payload.pluginId;
        const targetEnabled = payload.enabled !== false;
        if (!pluginId) throw new Error('plugin id is required');

        let result = null;
        if (targetEnabled) {
          result = await pluginManager.enablePlugin(pluginId, payload);
        } else {
          result = await pluginManager.disablePlugin(pluginId);
        }

        if (pluginManager) {
          config.plugins = pluginManager.getPluginsConfig();
        }

        try {
          const clientAdapterManager = require('./client-adapter-manager');
          const currentScopes = targetEnabled ? (result?.clientScopes || {}) : { opencode: false, openchamber: false, codex: false };
          clientAdapterManager.syncPluginScopes(pluginId, currentScopes, { routerPort: config.port });
        } catch (_) {}

        // Keep ComfyUI legacy configuration synchronized
        if (pluginId === 'comfyui') {
          if (!config.comfyui) config.comfyui = { ...DEFAULT_CONFIG.comfyui };
          config.comfyui.enabled = targetEnabled;
          if (comfyuiAdapter) comfyuiAdapter.enabled = targetEnabled;
          try {
            writeFileSyncAtomic(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
          } catch (_) {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 4. Update Client Scopes (/balancer/api/plugins/clients)
  if (reqUrl.pathname === '/balancer/api/plugins/clients' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then((buf) => {
      if (!buf || res.headersSent || res.writableEnded) return;
      try {
        const payload = JSON.parse(buf.toString('utf8'));
        const pluginId = payload.id || payload.pluginId;
        const clients = payload.clients;
        if (!pluginId || !clients) throw new Error('plugin id and clients object are required');

        const updatedScopes = pluginManager.setClientScopes(pluginId, clients);
        try {
          const clientAdapterManager = require('./client-adapter-manager');
          clientAdapterManager.syncPluginScopes(pluginId, updatedScopes, { routerPort: config.port });
        } catch (_) {}

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, pluginId, clients: updatedScopes }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 5. Pre-flight Topology Check (/balancer/api/plugins/preflight)
  if (reqUrl.pathname === '/balancer/api/plugins/preflight' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then(async (buf) => {
      if (!buf || res.headersSent || res.writableEnded) return;
      try {
        const payload = JSON.parse(buf.toString('utf8'));
        const pluginId = payload.id || payload.pluginId;
        if (!pluginId) throw new Error('plugin id is required');

        const topology = await pluginManager.checkTopology(pluginId, payload);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, pluginId, topology }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 6. Plugin Service Daemon Control (/balancer/api/plugins/service)
  if (reqUrl.pathname === '/balancer/api/plugins/service' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then(async (buf) => {
      if (!buf || res.headersSent || res.writableEnded) return;
      try {
        const payload = JSON.parse(buf.toString('utf8'));
        const pluginId = payload.id || payload.pluginId;
        const action = payload.action || 'start';
        const mode = payload.mode || 'gpu';
        if (!pluginId) throw new Error('plugin id is required');

        let result = null;
        if (action === 'start') {
          result = await pluginManager.startService(pluginId, mode);
        } else if (action === 'stop') {
          result = await pluginManager.stopService(pluginId);
        } else if (action === 'restart') {
          await pluginManager.stopService(pluginId);
          result = await pluginManager.startService(pluginId, mode);
        } else if (action === 'status' || action === 'probe') {
          result = await pluginManager.probeService(pluginId);
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 7. Active Tools Discovery (/balancer/api/plugins/tools)
  if (reqUrl.pathname === '/balancer/api/plugins/tools' && req.method === 'GET') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    const client = reqUrl.query?.client || null;
    const tools = pluginManager ? pluginManager.getActiveTools(client) : [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: true, count: tools.length, tools }));
    return;
  }

  // 8. Execute Plugin Tool via REST (/balancer/api/plugins/execute)
  if (reqUrl.pathname === '/balancer/api/plugins/execute' && req.method === 'POST') {
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then(async (buf) => {
      if (!buf || res.headersSent || res.writableEnded) return;
      try {
        const payload = JSON.parse(buf.toString('utf8'));
        const toolName = payload.name || payload.tool || payload.toolName;
        const toolArgs = payload.arguments || payload.args || {};
        const client = payload.client || null;
        if (!toolName) throw new Error('tool name is required');
        const result = await pluginManager.executeTool(toolName, toolArgs, client);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, tool: toolName, result }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Standard OpenAI Image Generation Endpoint (/v1/images/generations & /images/generations)
  if ((reqUrl.pathname === '/v1/images/generations' || reqUrl.pathname === '/images/generations') && req.method === 'POST') {
    // N1 Fix: Enforce LAN auth gatekeeper to prevent unauthorized GPU resource consumption
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized: 请提供有效的访问密码或 API Key', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then(async buf => {
      if (!buf) return;

      // Master switch check for ComfyUI plugin
      if (config.comfyui?.enabled === false || (comfyuiAdapter && comfyuiAdapter.enabled === false)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          error: {
            message: 'ComfyUI 视觉生图插件已被停用。如需使用生图，请在网关控制台“外挂与扩展插件中心”开启 ComfyUI 插件。',
            type: 'plugin_disabled',
            code: 'comfyui_disabled'
          }
        }));
        return;
      }
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
    // N1 Fix: Enforce LAN auth gatekeeper to prevent unauthorized GPU resource consumption
    if (config.uiPassword && !isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized: 请提供有效的访问密码或 API Key', type: 'authentication_error', code: 401 } }));
      return;
    }
    readInternalBody(req, res).then(async buf => {
      if (!buf) return;

      // Master switch check for ComfyUI plugin
      if (config.comfyui?.enabled === false || (comfyuiAdapter && comfyuiAdapter.enabled === false)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          error: {
            message: 'ComfyUI 视觉生图插件已被停用。如需使用图片反推，请在网关控制台“外挂与扩展插件中心”开启 ComfyUI 插件。',
            type: 'plugin_disabled',
            code: 'comfyui_disabled'
          }
        }));
        return;
      }
      let body = {};
      try {
        body = JSON.parse(buf.toString('utf8'));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON payload: ' + e.message, type: 'invalid_request_error' } }));
        return;
      }

      if (body.image_path && typeof body.image_path === 'string') {
        const safeBaseDir = path.resolve(path.join(__dirname, 'artifacts', 'images'));
        const resolvedPath = path.resolve(body.image_path);
        const isInside = process.platform === 'win32'
          ? resolvedPath.toLowerCase().startsWith(safeBaseDir.toLowerCase() + path.sep)
          : resolvedPath.startsWith(safeBaseDir + path.sep);
        if (!isInside) {
          res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: { message: 'Forbidden: 本地图片反推仅允许访问 artifacts/images 目录下的生成资产，其他图片请通过 image 字段以 Base64 上传。', type: 'invalid_request_error' } }));
          return;
        }
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

  // Static assets serving (/public/*)
  if (reqUrl.pathname && reqUrl.pathname.startsWith('/public/')) {
    const relPath = reqUrl.pathname.slice('/public/'.length);
    serveStaticFile(req, res, relPath);
    return;
  }

  // Web UI Dashboard & Graphical Config Center
  if (reqUrl.pathname === '/' || reqUrl.pathname === '/balancer/ui' || reqUrl.pathname === '/balancer') {
    if (config.uiPassword && config.uiPassword.trim()) {
      if (!isAuthorized(req)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderLoginPage());
        return;
      }
    } else {
      // Security Boundary: Restrict unauthenticated dashboard to local loopback (127.0.0.1)
      if (!isLoopbackRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderLanForbiddenPage());
        return;
      }
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
        const minCooldownMs = finiteCooldowns.length > 0 ? Math.min(...finiteCooldowns) : (config.defaultCooldownMs || 60000);
        const minCooldownSec = Math.max(1, Math.ceil(minCooldownMs / 1000));

        const circuitReports = enabledAccounts.map(a => {
          const st = accountStats.get(a.id) || {};
          const cState = getCircuitState(a.id, now);
          const remSec = Math.max(0, Math.ceil(((st.cooldownUntil || 0) - now) / 1000));
          return {
            id: a.id,
            name: a.name,
            state: cState,
            probe_in_flight: Boolean(st.halfOpenInFlight),
            consecutive_failures: st.consecutiveFailures || 0,
            cooldown_remaining_sec: remSec,
            last_error: st.lastError || null,
            avg_ttft_ms: st.avgTtftMs || null
          };
        });

        res.writeHead(429, {
          'Content-Type': 'application/json; charset=utf-8',
          'Retry-After': String(minCooldownSec),
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
          error: {
            message: `All OpenCode Go accounts in pool are temporarily cooling down due to rate limits. Nearest account recovers in ${minCooldownSec}s.`,
            type: 'rate_limit_exceeded',
            code: 'rate_limit_exceeded',
            retry_after: minCooldownSec,
            circuit_status: circuitReports,
            remediation: `Wait ${minCooldownSec}s for automatic single-flight probe, or call POST /balancer/api/reset-cooldown to immediately reset all circuit breakers.`
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
    const forceRestart = process.argv.includes('--force-restart') || process.env.OPENCODE_ROUTER_FORCE_RESTART === '1';
    if (autoHeal && !server._hasRetriedHeal) {
      server._hasRetriedHeal = true;
      const probeExistingHealth = () => new Promise((resolve) => {
        if (forceRestart) return resolve(false);
        const probeReq = http.get({
          hostname: '127.0.0.1',
          port: config.port,
          path: '/health',
          timeout: 600
        }, (probeRes) => {
          let raw = '';
          probeRes.on('data', (c) => { raw += c; });
          probeRes.on('end', () => {
            try {
              const parsed = JSON.parse(raw);
              if (probeRes.statusCode === 200 && parsed && parsed.status === 'ok' && parsed.service === 'opencode-go-router') {
                return resolve(true);
              }
            } catch (_) {}
            resolve(false);
          });
        });
        probeReq.on('error', () => resolve(false));
        probeReq.on('timeout', () => { probeReq.destroy(); resolve(false); });
      });

      probeExistingHealth().then((isHealthyPeer) => {
        if (isHealthyPeer) {
          console.log(`[Port Self-Healing] 检测到端口 ${config.port} 已有健康运行的网关实例在线，当前重复启动实例安全退出 (0 干扰)。`);
          process.exit(0);
          return;
        }
        console.log(`[Port Self-Healing] 正在尝试自动清理 ${config.port} 端口的残留/无响应冲突进程...`);
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
                try {
                  autoHealOpencodePortDrift(null, config.port);
                } catch (_) {}
              });
            } catch (listenErr) {
              console.error('[Port Self-Healing Listen Error]', listenErr.message);
              process.exit(1);
            }
          }, 1000);
        } catch (healErr) {
          console.error('[Port Self-Healing Failed]', healErr.message);
          process.exit(1);
        }
      });
      return;
    }
  } else {
    console.error('[OpenCode Go Router Server Error]', err.message);
  }
  process.exit(1);
});

let isShuttingDown = false;
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[OpenCode Go Router] Received ${signal || 'shutdown signal'}, initiating graceful shutdown...`);
  try {
    if (contextCompactor && typeof contextCompactor.flushStatsToDisk === 'function') {
      contextCompactor.flushStatsToDisk();
      console.log('[OpenCode Go Router] Successfully flushed compression stats to disk.');
    }
  } catch (err) {
    console.error('[OpenCode Go Router] Error flushing stats on exit:', err.message);
  }
  if (server && server.listening) {
    try {
      server.close(() => {
        console.log('[OpenCode Go Router] HTTP server closed gracefully.');
        process.exit(0);
      });
    } catch (_) {
      process.exit(0);
    }
  } else {
    process.exit(0);
  }
  const forceTimer = setTimeout(() => {
    console.warn('[OpenCode Go Router] Shutdown timeout reached (4s), exiting forcibly.');
    process.exit(0);
  }, 4000);
  if (forceTimer.unref) forceTimer.unref();
}

function start(port = config.port, host = config.host, callback) {
  if (typeof port === 'function') {
    callback = port;
    port = config.port;
    host = config.host;
  } else if (typeof host === 'function') {
    callback = host;
    host = config.host;
  }
  const targetPort = parseInt(port, 10) || config.port || 4010;
  return server.listen(targetPort, host, () => {
    console.log(`[OpenCode Go Router] Running on http://${host}:${targetPort}`);
    console.log(`[OpenCode Go Router] Upstream: ${config.upstream}`);
    console.log(`[OpenCode Go Router] Web Dashboard: http://${host}:${targetPort}/balancer/ui`);
    try {
      contextCompactor.syncModelRatesFromOpenCode().catch(() => {});
    } catch (_) {}
    try {
      autoHealOpencodePortDrift(null, targetPort);
    } catch (healErr) {
      console.warn('[OpenCode Go Router] autoHealOpencodePortDrift warning:', healErr.message);
    }
    if (typeof callback === 'function') callback();
  });
}

if (require.main === module) {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  start();
}

module.exports = {
  server,
  start,
  autoHealOpencodePortDrift,
  config,
  gracefulShutdown,
  classifyUpstreamError,
  handleUpstreamGlitchAndFailover,
  handleInvalidApiKeyFailover,
  handleQuotaExhaustedFailover,
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
  isLoopbackRequest,
  isTrustedManagementOrigin,
  getManagementCorsOrigin,
  renderLanForbiddenPage,
  writeFileSyncAtomic,
  CIRCUIT_STATE,
  DEFAULT_CIRCUIT_CONFIG,
  accountStats,
  getCircuitState,
  recordAccountSuccess,
  recordAccountFailure,
  calculateJitteredBackoff,
  isAccountAvailable,
  selectAccount,
  getCorsHeaders,
  pluginManager
};
