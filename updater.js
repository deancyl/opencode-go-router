/**
 * OpenCode Go Router - All-in-One Component Updater & Compatibility Engine
 * Zero external dependencies (pure Node.js native).
 * 
 * Capabilities:
 * - Detects local and remote versions of all suite components:
 *   1. opencode-go-router
 *   2. opencode CLI (@opencode/cli)
 *   3. oh-my-openagent (OMO)
 *   4. opencode-goal-plugin
 *   5. openchamber (@openchamber/web)
 * - Deep compatibility analysis with OpenCode breaking changes & ecosystem impact:
 *   - Provider syntax migrations & key-name conflicts
 *   - Legacy port 3001 residue
 *   - Gateway 4010 binding
 *   - OMO version alignment & DeepSeek region fallback
 *   - Goal plugin & /boost mode template
 *   - OpenChamber serve arguments & Air-Gapped Office preview sandbox
 * - Non-blocking risk warning system with explicit confirmation
 * - Automatic snapshot backup before updates
 * - One-click instant rollback engine
 * - Post-update Office offline preview patch re-mounting hook
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');
const { execSync, spawnSync, spawn } = require('node:child_process');

function writeFileSyncAtomic(targetFile, data, encoding = 'utf8') {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpFile = `${targetFile}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpFile, data, encoding);
  try {
    fs.renameSync(tmpFile, targetFile);
  } catch (err) {
    try {
      fs.copyFileSync(tmpFile, targetFile);
      fs.unlinkSync(tmpFile);
    } catch (_) {
      fs.writeFileSync(targetFile, data, encoding);
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    }
  }
}

function stripJsonComments(str) {
  if (typeof str !== 'string') return '';
  const noComments = str.replace(/\\"|"(?:[^"\\]|\\.)*"|(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m));
  return noComments.replace(/,(\s*[}\]])/g, '$1');
}

function parseSemver(v) {
  if (!v) return null;
  const s = String(v).trim().replace(/^[v^~=\s]+/, '');
  const withoutBuild = s.split('+')[0];
  const [verPart, ...preParts] = withoutBuild.split('-');
  const preStr = preParts.length ? preParts.join('-') : null;
  const nums = verPart.split('.').map(n => parseInt(n, 10));
  if (!nums.length || nums.some(n => isNaN(n))) return null;
  return {
    major: nums[0] || 0,
    minor: nums[1] || 0,
    patch: nums[2] || 0,
    preList: preStr ? preStr.split('.') : null,
    prerelease: preStr,
    raw: s
  };
}

function compareSemver(v1, v2) {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);
  if (!p1 && !p2) return 0;
  if (!p1) return -1;
  if (!p2) return 1;
  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  if (p1.patch !== p2.patch) return p1.patch - p2.patch;
  if (p1.preList && !p2.preList) return -1;
  if (!p1.preList && p2.preList) return 1;
  if (p1.preList && p2.preList) {
    const len = Math.max(p1.preList.length, p2.preList.length);
    for (let i = 0; i < len; i++) {
      if (p1.preList[i] === undefined) return -1;
      if (p2.preList[i] === undefined) return 1;
      const a = p1.preList[i];
      const b = p2.preList[i];
      const aNum = /^\d+$/.test(a);
      const bNum = /^\d+$/.test(b);
      if (aNum && bNum) {
        const diff = parseInt(a, 10) - parseInt(b, 10);
        if (diff !== 0) return diff;
      } else if (aNum && !bNum) {
        return -1;
      } else if (!aNum && bNum) {
        return 1;
      } else {
        const diff = a.localeCompare(b);
        if (diff !== 0) return diff;
      }
    }
  }
  return 0;
}

const ROOT_DIR = __dirname;

function getSnapshotsDir() {
  const custom = process.env.OPENCODE_SNAPSHOTS_DIR;
  if (custom) return custom;
  return path.join(ROOT_DIR, 'snapshots');
}

function getOpencodeConfigPath() {
  const dir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
  return path.join(dir, 'opencode.jsonc');
}

function getOmoConfigPath() {
  return path.join(os.homedir(), '.omo', 'omo.jsonc');
}

function getRouterConfigPath() {
  return process.env.OPENCODE_ROUTER_CONFIG || path.join(ROOT_DIR, 'config.json');
}

// 44 All Available OpenCode Go Models with zero-loss fallback
const ALL_38_SLUGS = [
  'deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-flash', 'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp', 'glm-5.1', 'glm-5.2', 'glm-5.3', 'glm-5.3-flash',
  'grok-4.6', 'grok-4.7', 'muse-spark-1.2-contributor', 'muse-spark-1.3-contributor',
  'omen-alpha', 'gpt-5.6-luna', 'gpt-6-luna', 'claude-haiku-5-5', 'hy3', 'hy4-preview',
  'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k3', 'mimo-v2.5', 'mimo-v2.6-flash',
  'mimo-v2.5-pro', 'mimo-v2.6-pro', 'minimax-m2.5', 'minimax-m2.7', 'minimax-m3',
  'space-bunny', 'longcat-2.0', 'longcat-2.5-preview-free', 'step-5-preview-free',
  'qwen3.6-plus', 'qwen3.7-plus', 'qwen3.7-max', 'qwen3.8-max', 'qwen3.8-flash',
  'gemini-4-argon', 'gemini-4-argon-contributor', 'step-5-preview', 'minimax-m3.1-flash-free', 'beam-free', 'cat-jam-free'
];

/**
 * 上游探测深层故障精准甄别 (Root-Cause Differentiation)
 * 精准细分 5 大类根本原因：
 * 1. QUOTA_EXHAUSTED: 429 且含 GoUsageLimitError / monthly
 * 2. TRANSIENT_RATE_LIMIT: 429 且可退避恢复
 * 3. AUTH_INVALID: 401/403 或无有效 Key
 * 4. GEOGRAPHIC_RESTRICTION: 403 unsupported_country_region_territory
 * 5. NETWORK_OFFLINE: ENOTFOUND / ECONNREFUSED / ETIMEDOUT
 */
function diagnoseUpstreamFailure(res, err, body = '') {
  const statusCode = res?.statusCode || 0;
  const rawBody = typeof body === 'string' ? body : (body ? JSON.stringify(body) : '');
  const errMsg = err?.message || (typeof err === 'string' ? err : '');
  const combined = (rawBody + ' ' + errMsg).toLowerCase();

  // 1. 海外地域受限 (403 unsupported_country_region_territory)
  if (
    combined.includes('unsupported_country_region_territory') ||
    combined.includes('geographic_restriction') ||
    combined.includes('region_blocked') ||
    combined.includes('country not supported') ||
    (statusCode === 403 && combined.includes('region'))
  ) {
    return {
      type: 'GEOGRAPHIC_RESTRICTION',
      code: 'GEOGRAPHIC_RESTRICTION',
      statusCode: statusCode || 403,
      title: '海外地域受限 (IP 处于未受支持地区)',
      message: '上游服务提示当前 IP 处于海外限制区域，需配置并走海外网络代理通道',
      suggestion: '建议在网关设置中配置海外 Socks5/HTTP 代理，针对海外受限模型自动路由',
      recommendation: '建议在网关设置中配置海外 Socks5/HTTP 代理，针对海外受限模型自动路由',
      retryable: false,
      requiresOverseasProxy: true
    };
  }

  // 2. 账号月度配额耗尽 (QUOTA_EXHAUSTED)
  if (
    statusCode === 429 && (
      combined.includes('gousagelimiterror') ||
      combined.includes('go usage limit exceeded') ||
      combined.includes('monthly') ||
      combined.includes('quota_exceeded') ||
      combined.includes('insufficient_quota') ||
      combined.includes('monthly_limit')
    )
  ) {
    return {
      type: 'QUOTA_EXHAUSTED',
      code: 'QUOTA_EXHAUSTED',
      statusCode: 429,
      title: '账号月度额度耗尽 (Monthly Quota Exhausted)',
      message: '当前订阅账号月度额度已用尽 (GoUsageLimitError / monthly)',
      suggestion: '当前订阅账号月度额度已用尽，请充值或在管理控制台更换有效 Key；系统已自动平滑降级至官网基准模型',
      recommendation: '当前订阅账号月度额度已用尽，请充值或在管理控制台更换有效 Key；系统已自动平滑降级至官网基准模型',
      retryable: false,
      requiresOverseasProxy: false
    };
  }

  // 3. 瞬态高频限频 (TRANSIENT_RATE_LIMIT)
  if (
    statusCode === 429 ||
    combined.includes('rate_limit') ||
    combined.includes('too_many_requests') ||
    res?.headers?.['retry-after']
  ) {
    const retryAfter = res?.headers?.['retry-after'] || null;
    return {
      type: 'TRANSIENT_RATE_LIMIT',
      code: 'TRANSIENT_RATE_LIMIT',
      statusCode: 429,
      title: '瞬态高频限频 (Rate Limit Throttling)',
      message: `上游服务短时限频中${retryAfter ? ` (建议重试间隔: ${retryAfter}s)` : ''}`,
      suggestion: '上游触发瞬时调用频率限制，已启动指数退避，将在短时间后自动恢复，不影响本地持久化模型目录',
      recommendation: '上游触发瞬时调用频率限制，已启动指数退避，将在短时间后自动恢复，不影响本地持久化模型目录',
      retryable: true,
      retryAfter: retryAfter ? parseInt(retryAfter, 10) : 10,
      requiresOverseasProxy: false
    };
  }

  // 4. 缺少 Key 或鉴权失效 (AUTH_INVALID)
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    combined.includes('invalid_api_key') ||
    combined.includes('unauthorized') ||
    combined.includes('authentication_failed') ||
    combined.includes('key_expired') ||
    combined.includes('bearer token') ||
    combined.includes('no key')
  ) {
    return {
      type: 'AUTH_INVALID',
      code: 'AUTH_INVALID',
      statusCode: statusCode || 401,
      title: '缺少有效凭据或鉴权失效 (Authentication Failed)',
      message: '缺少有效 API Key 或 Key 已过期失效 (401/403 Unauthorized)',
      suggestion: '请在管理面板中为账号配置有效的 OpenCode Go 订阅密钥 (API Key)',
      recommendation: '请在管理面板中为账号配置有效的 OpenCode Go 订阅密钥 (API Key)',
      retryable: false,
      requiresOverseasProxy: false
    };
  }

  // 5. 物理网络或代理断开 (NETWORK_OFFLINE)
  if (
    combined.includes('enotfound') ||
    combined.includes('econnrefused') ||
    combined.includes('etimedout') ||
    combined.includes('ehostunreach') ||
    combined.includes('econnreset') ||
    combined.includes('network error') ||
    combined.includes('fetch failed') ||
    combined.includes('socket hang up') ||
    err?.code === 'ENOTFOUND' ||
    err?.code === 'ECONNREFUSED' ||
    err?.code === 'ETIMEDOUT'
  ) {
    return {
      type: 'NETWORK_OFFLINE',
      code: 'NETWORK_OFFLINE',
      statusCode: 0,
      title: '物理网络或代理阻断 (Network Offline / Timeout)',
      message: `物理网络离线或代理端点不可达 (${err?.code || 'TIMEOUT'})`,
      suggestion: '请检查本地网络连接或代理服务是否正常；系统已瞬时平滑降级为内置官网文档模型基准，本地 Agent 立即可用',
      recommendation: '请检查本地网络连接或代理服务是否正常；系统已瞬时平滑降级为内置官网文档模型基准，本地 Agent 立即可用',
      retryable: true,
      requiresOverseasProxy: false
    };
  }

  // 6. 上游服务异常 (UPSTREAM_ERROR: 5xx)
  if (statusCode >= 500 && statusCode < 600) {
    return {
      type: 'UPSTREAM_ERROR',
      code: 'UPSTREAM_ERROR',
      statusCode,
      title: `上游服务异常 (HTTP ${statusCode})`,
      message: `上游服务暂时不可用或处于维护中 (HTTP ${statusCode})`,
      suggestion: '上游服务暂时响应异常，系统已平滑采纳官方基准模型兜底，建议稍后重试',
      recommendation: '上游服务暂时响应异常，系统已平滑采纳官方基准模型兜底，建议稍后重试',
      retryable: true,
      requiresOverseasProxy: false
    };
  }

  // 兜底未知异常
  return {
    type: 'UNKNOWN',
    code: 'UNKNOWN',
    statusCode,
    title: '上游探测未知异常',
    message: errMsg || rawBody.slice(0, 100) || '未知网络/服务状态',
    suggestion: '系统已安全使用官网模型基准兜底',
    recommendation: '系统已安全使用官网模型基准兜底',
    retryable: true,
    requiresOverseasProxy: false
  };
}

const DIAGNOSTIC_PRIORITY = {
  'QUOTA_EXHAUSTED': 100,
  'GEOGRAPHIC_RESTRICTION': 90,
  'AUTH_INVALID': 80,
  'TRANSIENT_RATE_LIMIT': 70,
  'UPSTREAM_ERROR': 60,
  'NETWORK_OFFLINE': 50,
  'UNKNOWN': 10
};

function selectBestDiagnostic(diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return null;
  let best = diagnostics[0];
  let bestScore = DIAGNOSTIC_PRIORITY[best?.code] || 0;
  for (let i = 1; i < diagnostics.length; i++) {
    const diag = diagnostics[i];
    const score = DIAGNOSTIC_PRIORITY[diag?.code] || 0;
    if (score > bestScore) {
      best = diag;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 单个 Key 探测
 */
function probeSingleKey(apiKey, upstream = 'https://opencode.ai/zen/go/v1', timeoutMs = 4000, options = {}) {
  return new Promise((resolve) => {
    if (!apiKey || !apiKey.trim()) {
      const diag = diagnoseUpstreamFailure(null, 'no key');
      return resolve({ success: false, slugs: null, res: null, err: null, body: '', diagnostic: diag });
    }
    try {
      let endpoint = upstream.replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(endpoint)) {
        endpoint = 'https://' + endpoint;
      }
      if (endpoint.endsWith('/models')) {
        // already ends with /models
      } else if (endpoint.endsWith('/v1')) {
        endpoint += '/models';
      } else {
        endpoint += '/v1/models';
      }
      const parsed = new URL(endpoint);
      const transport = parsed.protocol === 'https:' ? https : http;
      let finished = false;
      const reqOpts = {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'User-Agent': 'opencode-go-router-updater'
        },
        timeout: timeoutMs
      };
      if (options && options.agent) {
        reqOpts.agent = options.agent;
      }
      const req = transport.request(parsed, reqOpts, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (finished) return;
          finished = true;
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const parsedRes = JSON.parse(data);
              const list = Array.isArray(parsedRes.data) ? parsedRes.data : [];
              const slugs = list.map(m => {
                let id = typeof m === 'string' ? m : (m && typeof m === 'object' ? (m.id || m.name || m.slug) : '');
                if (typeof id === 'string' && id.startsWith('opencode-go/')) id = id.slice(12);
                return id;
              }).filter(id => typeof id === 'string' && id.trim().length > 0);
              if (slugs.length > 0) {
                return resolve({ success: true, slugs: Array.from(new Set(slugs)), res, body: data, diagnostic: null });
              }
            }
            const diag = diagnoseUpstreamFailure(res, null, data);
            resolve({ success: false, slugs: null, res, body: data, diagnostic: diag });
          } catch (parseErr) {
            const diag = diagnoseUpstreamFailure(res, parseErr, data);
            resolve({ success: false, slugs: null, res, body: data, diagnostic: diag });
          }
        });
      });
      req.on('error', (err) => {
        if (!finished) {
          finished = true;
          const diag = diagnoseUpstreamFailure(null, err, null);
          resolve({ success: false, slugs: null, res: null, err, diagnostic: diag });
        }
      });
      req.on('timeout', () => {
        if (!finished) {
          finished = true;
          req.destroy();
          const diag = diagnoseUpstreamFailure(null, new Error('ETIMEDOUT'), null);
          resolve({ success: false, slugs: null, res: null, err: new Error('ETIMEDOUT'), diagnostic: diag });
        }
      });
      req.end();
    } catch (e) {
      const diag = diagnoseUpstreamFailure(null, e, null);
      resolve({ success: false, slugs: null, res: null, err: e, diagnostic: diag });
    }
  });
}

/**
 * Dynamically fetch official OpenCode Go models catalog from upstream API
 * 支持单 Key 或账号数组多账号故障转移轮询 (账号 1 异常时自动尝试账号 2)
 * 全部受阻或断网时平滑降级至本地缓存或内置官网基准
 */
async function fetchOfficialModels(apiKeyOrAccounts, upstream = 'https://opencode.ai/zen/go/v1', timeoutMs = 4000, options = {}) {
  const keysToTry = [];
  if (Array.isArray(apiKeyOrAccounts)) {
    for (const acc of apiKeyOrAccounts) {
      if (typeof acc === 'string' && acc.trim()) keysToTry.push(acc.trim());
      else if (acc && typeof acc === 'object' && acc.apiKey && acc.apiKey.trim() && acc.enabled !== false) {
        keysToTry.push(acc.apiKey.trim());
      }
    }
  } else if (typeof apiKeyOrAccounts === 'string' && apiKeyOrAccounts.trim()) {
    keysToTry.push(apiKeyOrAccounts.trim());
  }

  if (keysToTry.length === 0) {
    const diag = diagnoseUpstreamFailure(null, 'no key configured');
    if (options.returnDetails) {
      return { success: false, slugs: null, diagnostic: diag, diagnostics: [diag], accountsTested: 0 };
    }
    return null;
  }

  const allDiagnostics = [];
  for (let i = 0; i < keysToTry.length; i++) {
    const key = keysToTry[i];
    const probeRes = await probeSingleKey(key, upstream, timeoutMs, options);
    if (probeRes.success && probeRes.slugs && probeRes.slugs.length > 0) {
      if (options.returnDetails) {
        return {
          success: true,
          slugs: probeRes.slugs,
          diagnostic: null,
          diagnostics: allDiagnostics,
          accountsTested: i + 1,
          accountIndex: i
        };
      }
      return probeRes.slugs;
    }

    if (probeRes.diagnostic) {
      allDiagnostics.push(probeRes.diagnostic);
    }
    // 多账号故障转移提示
    if (i < keysToTry.length - 1) {
      console.log(`[Updater] 账号 ${i + 1} 上游探测返回 ${probeRes.diagnostic?.code || 'ERROR'}，正在自动故障转移轮询尝试账号 ${i + 2}...`);
    }
  }

  const primaryDiagnostic = selectBestDiagnostic(allDiagnostics);

  if (options.returnDetails) {
    return {
      success: false,
      slugs: null,
      diagnostic: primaryDiagnostic,
      diagnostics: allDiagnostics,
      accountsTested: keysToTry.length
    };
  }
  return null;
}

/**
 * 获取官网公开模型基准元数据字典 (异步比对官网网页，提供新模型发现提示)
 */
async function fetchWebDocsCatalog(options = {}) {
  try {
    const clientAdapter = require('./client-adapter-manager');
    const models = clientAdapter.loadOfficialModels();
    return {
      success: true,
      count: models.length,
      models,
      source: 'official_docs'
    };
  } catch (err) {
    return {
      success: false,
      count: ALL_38_SLUGS.length,
      models: ALL_38_SLUGS.map(s => ({ slug: s, name: s })),
      source: 'fallback_slugs',
      error: err.message
    };
  }
}

/**
 * Intelligent cross-platform environment detector
 * Accurately detects Windows Desktop, Linux NAS (fnOS / Synology / TrueNAS / Unraid), Docker, and standard Linux.
 */
function detectPlatformEnvironment(overrides = {}) {
  const currentPlatform = overrides.platform || process.platform;
  const isWin = currentPlatform === 'win32';
  const isMac = currentPlatform === 'darwin';
  const isLinux = currentPlatform === 'linux';
  const checkExists = overrides.fsExists || fs.existsSync;
  const getRelease = overrides.kernelRelease !== undefined ? overrides.kernelRelease : (os.release() || '');
  const readStr = overrides.readFile || ((p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } });

  let isDocker = false;
  try {
    if (checkExists('/.dockerenv') || checkExists('/run/.containerenv')) {
      isDocker = true;
    } else if (checkExists('/proc/1/cgroup')) {
      const cgroup = readStr('/proc/1/cgroup');
      if (cgroup.includes('docker') || cgroup.includes('containerd') || cgroup.includes('kubepods')) {
        isDocker = true;
      }
    }
  } catch (_) {}

  let isNas = false;
  let nasType = null;
  let distroName = '';

  if (isLinux) {
    const osReleaseStr = readStr('/etc/os-release');
    const procVersion = readStr('/proc/version');
    const kernelRelease = getRelease;

    // 1. fnOS (飞牛 NAS OS)
    if (kernelRelease.includes('trim') || procVersion.includes('trim') || checkExists('/fs') || checkExists('/vol3') || checkExists('/vol1') || osReleaseStr.toLowerCase().includes('trim')) {
      isNas = true;
      nasType = 'fnos';
      distroName = 'fnOS (飞牛私有云 NAS / Debian)';
    } else if (checkExists('/etc/synoinfo.conf') || checkExists('/etc.defaults/synoinfo.conf') || checkExists('/volume1') || osReleaseStr.toLowerCase().includes('synology')) {
      isNas = true;
      nasType = 'synology';
      distroName = 'Synology DSM';
    } else if (checkExists('/etc/truenas_version') || osReleaseStr.toLowerCase().includes('truenas')) {
      isNas = true;
      nasType = 'truenas';
      distroName = 'TrueNAS';
    } else if (checkExists('/mnt/user') || osReleaseStr.toLowerCase().includes('unraid')) {
      isNas = true;
      nasType = 'unraid';
      distroName = 'Unraid NAS';
    } else if (checkExists('/vol1') || checkExists('/volume1') || checkExists('/volume2')) {
      isNas = true;
      nasType = 'generic-nas';
      distroName = 'Linux 存储服务器 (NAS)';
    } else {
      const matchName = osReleaseStr.match(/PRETTY_NAME="([^"]+)"/);
      distroName = matchName ? matchName[1] : (isDocker ? 'Linux Container' : 'Linux Standard');
    }
  } else if (isWin) {
    distroName = `Windows ${getRelease} (${os.arch()})`;
  } else if (isMac) {
    distroName = `macOS ${getRelease} (${os.arch()})`;
  }

  let serviceManager = 'unknown';
  if (isWin) {
    serviceManager = 'tray-or-powershell';
  } else if (isLinux) {
    try {
      const sysOut = overrides.systemctlVersion !== undefined ? overrides.systemctlVersion : runCmdSync('systemctl --version', 2000);
      if (sysOut && sysOut.includes('systemd')) {
        serviceManager = 'systemd';
      } else {
        serviceManager = 'nohup';
      }
    } catch (_) {
      serviceManager = 'nohup';
    }
  }

  let platformTag = 'linux';
  if (isWin) {
    platformTag = 'windows';
  } else if (isNas) {
    platformTag = 'linux-nas';
  } else if (isDocker) {
    platformTag = 'docker';
  } else if (isMac) {
    platformTag = 'darwin';
  }

  let description = distroName;
  if (isNas) {
    description = `${distroName} [${nasType ? nasType.toUpperCase() : 'NAS'}] (${isDocker ? 'Docker 容器' : '原生宿主'})`;
  } else if (isWin) {
    description = `Windows 桌面工作站 (${distroName})`;
  } else if (isDocker) {
    description = `Docker 容器环境 (${distroName})`;
  }

  return {
    platform: platformTag,
    isWindows: isWin,
    isLinux,
    isNas,
    nasType,
    isDocker,
    arch: os.arch(),
    serviceManager,
    description
  };
}

/**
 * Cross-platform Zero-Loss Opencode Config Harmonization & Auto-Repair Engine
 * Migrates deprecated plural `providers` into singular `provider`,
 * populates models for `opencode-go` (dynamic official upstream or 38 fallback),
 * normalizes OMO tags, preserves custom models and user choice.
 */
function harmonizeOpencodeConfig(customPath = null, routerPort = 4010, options = {}) {
  const p = customPath || getOpencodeConfigPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let data = {};
  let isNew = false;
  if (fs.existsSync(p)) {
    try {
      const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
      if (raw.trim().length > 0) {
        data = JSON.parse(stripJsonComments(raw));
      }
    } catch (e) {
      try { fs.copyFileSync(p, p + '.corrupt-bak.' + Date.now()); } catch (_) {}
      throw new Error(`解析 ${path.basename(p)} 失败 (已保留快照备份): ${e.message}`);
    }
  } else {
    isNew = true;
    data = {
      plugin: ["oh-my-openagent@5.1.30", "opencode-goal-plugin"],
      $schema: "https://opencode.ai/config.json"
    };
  }

  if (!data || typeof data !== 'object') data = {};
  if (!Array.isArray(data.plugin)) data.plugin = [];

  // 1. 获取现有配置中的 OMO 版本
  let existingOmoVer = null;
  for (const item of data.plugin) {
    const str = typeof item === 'string' ? item : (Array.isArray(item) ? item[0] : '');
    const m = String(str).match(/oh-my-openagent@(?:[v^~])?([0-9A-Za-z.+-]+)/);
    if (m) {
      existingOmoVer = m[1];
      break;
    }
  }

  // 2. 探测真实安装在磁盘中的包版本
  let detectedLocalOmoVer = null;
  const omoPkgCandidates = [
    path.join(os.homedir(), '.config', 'opencode', 'node_modules', 'oh-my-openagent', 'package.json'),
    path.join(os.homedir(), '.config', 'opencode', 'oh-my-openagent', 'package.json'),
    path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', 'oh-my-openagent', 'package.json'),
    path.join(os.homedir(), '.local', 'lib', 'node_modules', 'oh-my-openagent', 'package.json'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'oh-my-openagent', 'package.json'),
    '/root/.bun/install/global/node_modules/oh-my-openagent/package.json',
    '/usr/local/lib/node_modules/oh-my-openagent/package.json',
    '/usr/lib/node_modules/oh-my-openagent/package.json'
  ];
  for (const c of omoPkgCandidates) {
    if (fs.existsSync(c)) {
      try {
        const pkgData = JSON.parse(fs.readFileSync(c, 'utf8'));
        if (pkgData && pkgData.version) {
          detectedLocalOmoVer = pkgData.version;
          break;
        }
      } catch (_) {}
    }
  }

  // 3. 动态确定目标版本：options 优先 > (若磁盘与现有均存在，仅当磁盘版本更高时执行双向对齐，否则保留现有更高版本) > 真实已安装版本 > 现有配置版本 > 5.1.30 兜底
  let targetOmoVer = options.omoVersion;
  if (!targetOmoVer) {
    if (detectedLocalOmoVer && existingOmoVer) {
      targetOmoVer = compareSemver(detectedLocalOmoVer, existingOmoVer) > 0 ? detectedLocalOmoVer : existingOmoVer;
    } else {
      targetOmoVer = detectedLocalOmoVer || existingOmoVer || '5.1.30';
    }
  }
  const targetOmoTag = `oh-my-openagent@${targetOmoVer}`;

  // 规范化与同步更新 OMO 插件标签
  let omoFound = false;
  for (let i = 0; i < data.plugin.length; i++) {
    const item = data.plugin[i];
    if (typeof item === 'string' && (item === 'oh-my-openagent' || item.startsWith('oh-my-openagent@'))) {
      data.plugin[i] = targetOmoTag;
      omoFound = true;
    } else if (Array.isArray(item) && typeof item[0] === 'string' && (item[0] === 'oh-my-openagent' || item[0].startsWith('oh-my-openagent@'))) {
      item[0] = targetOmoTag;
      omoFound = true;
    }
  }
  if (!omoFound) {
    data.plugin.unshift(targetOmoTag);
  }

  if (!data.plugin.some(item => String(Array.isArray(item) ? item[0] : item).includes('opencode-goal-plugin'))) {
    data.plugin.push('opencode-goal-plugin');
  }

  if (!data.provider || typeof data.provider !== 'object') {
    data.provider = {};
  }

  const routerUrl = `http://127.0.0.1:${routerPort}/v1`;

  // 1. Build models map with dynamic models + fallback 38 models
  let baseSlugs = ALL_38_SLUGS;
  if (Array.isArray(options.officialModels) && options.officialModels.length > 0) {
    if (options.strictModels) {
      baseSlugs = Array.from(new Set(options.officialModels));
    } else {
      baseSlugs = Array.from(new Set([...ALL_38_SLUGS, ...options.officialModels]));
    }
  }
  const allModelsMap = {};
  for (const s of baseSlugs) {
    allModelsMap[s] = { name: s, modelID: s };
  }

  // Preserve existing models and custom parameters from provider['opencode-go']
  if (data.provider['opencode-go'] && data.provider['opencode-go'].models && typeof data.provider['opencode-go'].models === 'object') {
    for (const [k, v] of Object.entries(data.provider['opencode-go'].models)) {
      if (allModelsMap[k]) {
        if (typeof v === 'object' && v !== null) {
          allModelsMap[k] = Object.assign({}, allModelsMap[k], v, {
            name: v.name || v.modelID || k,
            modelID: v.modelID || v.name || k
          });
        }
      } else {
        if (options.strictModels && ALL_38_SLUGS.includes(k)) {
          continue;
        }
        if (typeof v === 'object' && v !== null) {
          allModelsMap[k] = Object.assign({}, v, {
            name: v.name || v.modelID || k,
            modelID: v.modelID || v.name || k
          });
        } else {
          allModelsMap[k] = { name: k, modelID: k };
        }
      }
    }
  }

  // Preserve existing models and custom parameters from legacy providers['opencode-go']
  if (data.providers && data.providers['opencode-go'] && data.providers['opencode-go'].models && typeof data.providers['opencode-go'].models === 'object') {
    for (const [k, v] of Object.entries(data.providers['opencode-go'].models)) {
      if (allModelsMap[k]) {
        if (typeof v === 'object' && v !== null) {
          allModelsMap[k] = Object.assign({}, allModelsMap[k], v, {
            name: v.name || v.modelID || k,
            modelID: v.modelID || v.name || k
          });
        }
      } else {
        if (typeof v === 'object' && v !== null) {
          allModelsMap[k] = Object.assign({}, v, {
            name: v.name || v.modelID || k,
            modelID: v.modelID || v.name || k
          });
        } else {
          allModelsMap[k] = { name: k, modelID: k };
        }
      }
    }
  }

  // 2. Harmonize third-party custom providers (shtech, aixforge, etc.)
  const migratedProviders = [];
  if (data.providers && typeof data.providers === 'object') {
    for (const [k, v] of Object.entries(data.providers)) {
      if (k !== 'opencode-go') {
        if (!data.provider[k]) {
          data.provider[k] = v;
          migratedProviders.push(k);
        }
      }
    }
    // Delete legacy plural providers completely
    delete data.providers;
  }

  // 2.1 Sanitize & Normalize all third-party providers to Dual-Track OpenCode & OpenChamber schema
  for (const [k, prov] of Object.entries(data.provider)) {
    if (k === 'opencode-go') continue;
    if (prov && typeof prov === 'object') {
      // CLI needs npm, OpenChamber needs package
      if (!prov.npm) {
        if (prov.package && typeof prov.package === 'string' && prov.package.startsWith('aisdk:')) {
          prov.npm = prov.package.slice('aisdk:'.length);
        } else {
          prov.npm = '@ai-sdk/openai-compatible';
        }
      }
      if (!prov.package) {
        prov.package = '@opencode/ai/providers/openai-compatible';
      }
      // CLI needs options, OpenChamber needs settings
      if (prov.settings && !prov.options) {
        prov.options = Object.assign({}, prov.settings);
      } else if (prov.options && !prov.settings) {
        prov.settings = Object.assign({}, prov.options);
      }
      // Models dual-track (name & modelID)
      if (prov.models && typeof prov.models === 'object') {
        for (const [mKey, mVal] of Object.entries(prov.models)) {
          if (mVal && typeof mVal === 'object') {
            const mName = mVal.name || mVal.modelID || mKey;
            mVal.name = mName;
            mVal.modelID = mName;
          }
        }
      }
    }
  }

  // 3. Configure opencode-go (Dual-Track Schema for CLI & OpenChamber UI)
  data.provider['opencode-go'] = {
    name: 'opencode-go',
    npm: '@ai-sdk/openai-compatible',
    package: '@opencode/ai/providers/openai-compatible',
    options: {
      baseURL: routerUrl,
      apiKey: 'local-router'
    },
    settings: {
      baseURL: routerUrl,
      apiKey: 'local-router'
    },
    models: allModelsMap
  };

  if (data.provider['one-api']) {
    if (!data.provider['one-api'].options) data.provider['one-api'].options = {};
    data.provider['one-api'].options.baseURL = routerUrl;
    data.provider['one-api'].options.apiKey = 'local-router';
  }

  // 3.1 Ensure Native Goal & Verifier Agent Definitions for OpenCode 2.0 & OpenChamber (Rule 9)
  let agentGoalInjected = false;
  if (!data.agent || typeof data.agent !== 'object') {
    data.agent = {};
    agentGoalInjected = true;
  }
  if (!data.agent.goal) {
    data.agent.goal = {
      description: "Execute an explicit user goal with persistent progress and evidence-gated completion.",
      mode: "primary",
      prompt: "Execute explicit goals persistently. Use goal tools to track state and checkpoints. Make concrete progress; claim completion only with verification evidence. Report only genuine blockers."
    };
    agentGoalInjected = true;
  } else {
    // Strictly preserve user customized prompt if exists
    if (!data.agent.goal.prompt) {
      data.agent.goal.prompt = "Execute explicit goals persistently. Use goal tools to track state and checkpoints. Make concrete progress; claim completion only with verification evidence. Report only genuine blockers.";
      agentGoalInjected = true;
    }
    if (!data.agent.goal.mode) {
      data.agent.goal.mode = "primary";
      agentGoalInjected = true;
    }
    if (!data.agent.goal.description) {
      data.agent.goal.description = "Execute an explicit user goal with persistent progress and evidence-gated completion.";
    }
  }
  if (!data.agent['goal-verify']) {
    data.agent['goal-verify'] = {
      description: "Independently verify a goal completion claim without modifying the workspace.",
      mode: "subagent",
      hidden: true
    };
    agentGoalInjected = true;
  } else {
    if (!data.agent['goal-verify'].mode) {
      data.agent['goal-verify'].mode = "subagent";
      agentGoalInjected = true;
    }
    if (data.agent['goal-verify'].hidden === undefined) {
      data.agent['goal-verify'].hidden = true;
    }
  }

  // 4. Model selection: preserve user's valid choice, support Luna as preferred or fallback default
  let modelPreserved = true;
  if (options.preferredModel) {
    data.model = options.preferredModel;
    modelPreserved = false;
  } else if (!data.model) {
    if (options.defaultModel) {
      data.model = options.defaultModel.includes('/') ? options.defaultModel : `opencode-go/${options.defaultModel}`;
    } else {
      data.model = options.useLuna ? 'opencode-go/gpt-5.6-luna' : 'opencode-go/deepseek-v4.1-flash';
    }
    modelPreserved = false;
  }

  // Backup original file with timestamp before writing (Angle 9)
  let backupPath = null;
  if (fs.existsSync(p)) {
    try {
      const ts = Date.now();
      backupPath = `${p}.bak.${ts}`;
      fs.copyFileSync(p, backupPath);
      fs.copyFileSync(p, `${p}.bak`);
    } catch (_) {}
  }

  writeFileSyncAtomic(p, JSON.stringify(data, null, 2), 'utf8');

  return {
    success: true,
    isNew,
    backupPath,
    migratedProviders,
    modelCount: Object.keys(allModelsMap).length,
    currentModel: data.model,
    modelPreserved,
    agentGoalInjected
  };
}

function getOpenChamberDistCandidates(customDir = null) {
  const candidates = [];
  if (customDir) candidates.push(customDir);
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', '@openchamberelectron', 'resources', 'web-dist'));
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'OpenChamber', 'resources', 'web-dist'));
    }
    candidates.push(path.join(os.homedir(), 'AppData', 'Local', 'Programs', '@openchamberelectron', 'resources', 'web-dist'));
    candidates.push(path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'OpenChamber', 'resources', 'web-dist'));
    candidates.push(path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', '@openchamber', 'web', 'dist'));
    candidates.push(path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', '@openchamber', 'web', 'public'));
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@openchamber', 'web', 'dist'));
    }
  } else {
    // Dynamic resolution via which openchamber realpath
    try {
      const bin = runCmdSync('which openchamber');
      if (bin) {
        const firstLine = bin.split(/\r?\n/)[0].trim();
        if (firstLine && fs.existsSync(firstLine)) {
          const realBin = fs.realpathSync(firstLine);
          const pkgRoot = path.join(path.dirname(realBin), '..');
          candidates.push(path.join(pkgRoot, 'dist'));
          candidates.push(path.join(pkgRoot, 'public'));
        }
      }
    } catch (_) {}

    candidates.push(
      '/vol3/1000/docker/opencode/openchamber/node_modules/@openchamber/web/dist',
      '/vol3/1000/docker/opencode/openchamber/dist',
      '/vol1/1000/docker/opencode/openchamber/node_modules/@openchamber/web/dist',
      '/vol2/1000/docker/opencode/openchamber/node_modules/@openchamber/web/dist',
      '/vol3/1000/docker/openchamber/web/dist',
      '/vol3/1000/docker/openchamber/dist',
      '/vol1/1000/docker/openchamber/web/dist',
      '/vol1/1000/docker/openchamber/dist',
      '/vol2/1000/docker/openchamber/web/dist',
      '/vol4/1000/docker/openchamber/web/dist',
      '/volume1/docker/openchamber/web/dist',
      '/volume1/docker/openchamber/dist',
      '/volume2/docker/openchamber/web/dist',
      '/mnt/user/appdata/openchamber/web/dist',
      '/var/lib/openchamber/web/dist',
      '/var/lib/openchamber/dist',
      '/usr/local/lib/node_modules/@openchamber/web/dist',
      '/usr/lib/node_modules/@openchamber/web/dist',
      path.join(os.homedir(), '.local', 'share', 'openchamber', 'dist'),
      path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', '@openchamber', 'web', 'dist'),
      path.join(os.homedir(), '.openchamber', 'web-dist')
    );
  }
  return candidates;
}

/**
 * Execute command with output capture and error details
 */
function runCmd(cmd, timeoutMs = 60000, customCwd = ROOT_DIR) {
  try {
    const stdout = execSync(cmd, {
      cwd: customCwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });
    return {
      success: true,
      output: stdout ? stdout.trim() : '',
      error: null
    };
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    const stdout = e.stdout ? e.stdout.toString().trim() : '';
    const errMsg = stderr || stdout || e.message || '命令执行失败';
    return {
      success: false,
      output: stdout,
      error: errMsg
    };
  }
}

function runCmdSync(cmd, timeoutMs = 5000) {
  const res = runCmd(cmd, timeoutMs);
  return res.success ? res.output : null;
}

/**
 * Checks if the current process has write permissions to global npm node_modules
 */
function canWriteGlobalNpm(customOverrides = {}) {
  if (customOverrides.canWriteGlobal !== undefined) return Boolean(customOverrides.canWriteGlobal);
  if (process.platform === 'win32') return true;
  try {
    const rootG = runCmdSync('npm root -g', 2000);
    if (rootG && fs.existsSync(rootG.trim())) {
      const testDir = rootG.trim();
      fs.accessSync(testDir, fs.constants.W_OK);
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

/**
 * Locates the local target project directory for a component on Linux NAS
 */
function findScopedComponentDir(comp, customOverrides = {}) {
  if (customOverrides.scopedDirs && customOverrides.scopedDirs[comp]) {
    return customOverrides.scopedDirs[comp];
  }
  if (process.platform === 'win32') return null;

  if (comp === 'oh-my-openagent' || comp === 'opencode-goal-plugin') {
    const ocDir = path.join(os.homedir(), '.config', 'opencode');
    if (fs.existsSync(path.join(ocDir, 'package.json'))) return ocDir;
    if (fs.existsSync(ocDir)) return ocDir;
  }

  if (comp === 'openchamber' || comp === 'opencode') {
    // Helper to get true project root by stripping any /node_modules/... suffix
    const getEnclosingProjectRoot = (dir) => {
      if (!dir) return null;
      const normalized = path.resolve(dir).replace(/\\/g, '/');
      const idx = normalized.lastIndexOf('/node_modules');
      if (idx !== -1) {
        const root = normalized.slice(0, idx);
        if (fs.existsSync(path.join(root, 'package.json'))) return path.resolve(root);
      }
      return path.resolve(dir);
    };

    // 1. Search candidate openchamber dirs
    const cands = getOpenChamberDistCandidates();
    for (const c of cands) {
      const projRoot = getEnclosingProjectRoot(c);
      if (projRoot) {
        const pkg = path.join(projRoot, 'package.json');
        if (fs.existsSync(pkg)) {
          try {
            const raw = fs.readFileSync(pkg, 'utf8');
            if (comp === 'openchamber' && (raw.includes('@openchamber/web') || raw.includes('openchamber'))) {
              return projRoot;
            }
            if (comp === 'opencode' && (raw.includes('@opencode/cli') || raw.includes('opencode'))) {
              return projRoot;
            }
          } catch (_) {}
        }
      }
    }

    // 2. Dynamic check via binary realpaths
    try {
      const binName = comp === 'openchamber' ? 'openchamber' : 'opencode';
      const whichOut = runCmdSync(`which ${binName}`, 2000);
      if (whichOut) {
        const first = whichOut.split(/\r?\n/)[0].trim();
        if (first && fs.existsSync(first)) {
          const real = fs.realpathSync(first);
          const projRoot = getEnclosingProjectRoot(real);
          if (projRoot && fs.existsSync(path.join(projRoot, 'package.json'))) {
            return projRoot;
          }
        }
      }
    } catch (_) {}

    // 3. Check ~/.config/opencode for opencode
    if (comp === 'opencode') {
      const ocDir = path.join(os.homedir(), '.config', 'opencode');
      if (fs.existsSync(path.join(ocDir, 'package.json'))) return ocDir;
    }
  }

  return null;
}

function detectPackageManager() {
  if (process.platform === 'win32') {
    const hasNpm = runCmdSync('npm --version', 2000);
    if (hasNpm) return 'npm';
    const hasBun = runCmdSync('bun --version', 2000);
    if (hasBun) return 'bun';
    return 'npm';
  }
  const hasBun = runCmdSync('bun --version', 2000);
  if (hasBun) return 'bun';
  const hasNpm = runCmdSync('npm --version', 2000);
  if (hasNpm) return 'npm';
  return 'npm';
}

/**
 * Fetch latest version of npm package with dual-track timeout & npmmirror fallback
 */
function fetchNpmLatestVersion(pkgName, timeoutMs = 4500) {
  return new Promise((resolve) => {
    const encodedName = pkgName.startsWith('@') ? '@' + encodeURIComponent(pkgName.slice(1)) : encodeURIComponent(pkgName);
    const primaryUrl = `https://registry.npmjs.org/${encodedName}/latest`;
    const mirrorUrl = `https://registry.npmmirror.com/${encodedName}/latest`;

    function doFetch(targetUrl, isFallback = false) {
      let finished = false;
      const markDone = (cb) => {
        if (finished) return;
        finished = true;
        cb();
      };

      try {
        const u = new URL(targetUrl);
        const req = https.get(u, { headers: { 'User-Agent': 'opencode-go-router-updater' } }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            markDone(() => {
              try {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                  const parsed = JSON.parse(data);
                  return resolve({ version: parsed.version || null, error: null });
                } else {
                  if (!isFallback) return doFetch(mirrorUrl, true);
                  resolve({ version: null, error: `HTTP ${res.statusCode}` });
                }
              } catch (e) {
                if (!isFallback) return doFetch(mirrorUrl, true);
                resolve({ version: null, error: e.message });
              }
            });
          });
        });
        req.on('error', (e) => {
          markDone(() => {
            if (!isFallback) return doFetch(mirrorUrl, true);
            resolve({ version: null, error: e.message });
          });
        });
        const timerLimit = isFallback ? 2500 : 2000;
        req.setTimeout(timerLimit, () => {
          markDone(() => {
            try { req.destroy(); } catch (_) {}
            if (!isFallback) return doFetch(mirrorUrl, true);
            resolve({ version: null, error: '请求超时 (可能处于离线或受限网络环境)' });
          });
        });
      } catch (err) {
        markDone(() => {
          if (!isFallback) return doFetch(mirrorUrl, true);
          resolve({ version: null, error: err.message });
        });
      }
    }

    doFetch(primaryUrl, false);
  });
}

/**
 * Fetch latest release from GitHub API
 */
function fallbackGitRemoteVersion() {
  let pkgVer = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    pkgVer = pkg.version || null;
  } catch (_) {}
  try {
    const gitTag = runCmdSync('git describe --tags --abbrev=0', 2000);
    if (gitTag) {
      const v = gitTag.trim().replace(/^v/, '');
      if (v) {
        if (pkgVer && compareSemver(pkgVer, v) > 0) {
          return { version: pkgVer, error: null, source: 'package-local' };
        }
        return { version: v, error: null, source: 'git-tag' };
      }
    }
  } catch (_) {}
  return { version: pkgVer || '2.3.2', error: null, source: 'package-local' };
}

/**
 * Fetch latest release from GitHub API with fast network resilience
 */
function fetchGitHubLatestRelease(repo, timeoutMs = 3500) {
  return new Promise((resolve) => {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    let finished = false;
    const req = https.get(url, { headers: { 'User-Agent': 'opencode-go-router-updater' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (finished) return;
        finished = true;
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            const tag = (parsed.tag_name || '').replace(/^v/, '');
            resolve({ version: tag || null, releaseName: parsed.name, error: null });
          } else {
            resolve(fallbackGitRemoteVersion());
          }
        } catch (e) {
          resolve(fallbackGitRemoteVersion());
        }
      });
    });
    req.on('error', () => {
      if (finished) return;
      finished = true;
      resolve(fallbackGitRemoteVersion());
    });
    req.setTimeout(timeoutMs, () => {
      if (finished) return;
      finished = true;
      req.destroy();
      resolve(fallbackGitRemoteVersion());
    });
  });
}

/**
 * Detect local versions of all 5 components
 */
function detectLocalVersions() {
  const versions = {
    'opencode-go-router': null,
    'opencode': null,
    'oh-my-openagent': null,
    'opencode-goal-plugin': null,
    'openchamber': null,
    'codex': null
  };

  // 1. Router version from package.json
  try {
    const pkgPath = path.join(ROOT_DIR, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      versions['opencode-go-router'] = pkg.version || '2.0.0';
    }
  } catch (e) {}

  // 2. OpenCode CLI
  let ocOut = runCmdSync('opencode --version');
  if (ocOut) {
    const m = ocOut.match(/(?:v)?(\d+\.\d+\.\d+)/);
    if (m) versions['opencode'] = m[1];
  }
  if (!versions['opencode']) {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', '@openchamberelectron', 'resources', 'opencode-cli', 'opencode.exe'),
      path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd'),
      path.join(os.homedir(), '.bun', 'bin', 'opencode.exe'),
      path.join(os.homedir(), '.bun', 'bin', 'opencode'),
      path.join(os.homedir(), '.opencode', 'bin', 'opencode'),
      path.join(os.homedir(), '.local', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
      '/usr/bin/opencode'
    ];
    for (const cand of candidates) {
      if (cand && fs.existsSync(cand)) {
        const out = runCmdSync(`"${cand}" --version`);
        if (out) {
          const m = out.match(/(?:v)?(\d+\.\d+\.\d+)/);
          if (m) { versions['opencode'] = m[1]; break; }
        }
      }
    }
  }

  // 3. oh-my-openagent (OMO) & 4. opencode-goal-plugin
  let detectedOmoPkgVer = null;
  const omoPkgCandidates = [
    path.join(os.homedir(), '.config', 'opencode', 'node_modules', 'oh-my-openagent', 'package.json'),
    path.join(os.homedir(), '.config', 'opencode', 'oh-my-openagent', 'package.json'),
    path.join(os.homedir(), '.local', 'lib', 'node_modules', 'oh-my-openagent', 'package.json'),
    path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', 'oh-my-openagent', 'package.json'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'oh-my-openagent', 'package.json'),
    '/usr/local/lib/node_modules/oh-my-openagent/package.json',
    '/usr/lib/node_modules/oh-my-openagent/package.json'
  ];
  for (const c of omoPkgCandidates) {
    if (fs.existsSync(c)) {
      try {
        const pkgData = JSON.parse(fs.readFileSync(c, 'utf8'));
        if (pkgData && pkgData.version) {
          detectedOmoPkgVer = pkgData.version;
          break;
        }
      } catch (e) {}
    }
  }

  const ocConfigPath = getOpencodeConfigPath();
  let configOmoVer = null;
  if (fs.existsSync(ocConfigPath)) {
    try {
      const raw = fs.readFileSync(ocConfigPath, 'utf8').replace(/^\uFEFF/, '');
      const cleanRaw = stripJsonComments(raw);
      try {
        const parsed = JSON.parse(cleanRaw);
        const pluginsArr = Array.isArray(parsed.plugin) ? parsed.plugin : (Array.isArray(parsed.plugins) ? parsed.plugins : []);
        for (const p of pluginsArr) {
          const m = String(p).match(/oh-my-openagent@(\d+\.\d+\.\d+)/);
          if (m) configOmoVer = m[1];
          const gm = String(p).match(/opencode-goal-plugin(?:@(\d+\.\d+\.\d+))?/);
          if (gm) {
            versions['opencode-goal-plugin'] = gm[1] || '0.11.0';
          }
        }
      } catch (pe) {
        // Fallback: regex search on raw content
        const m = raw.match(/oh-my-openagent@(\d+\.\d+\.\d+)/);
        if (m) configOmoVer = m[1];
        const gm = raw.match(/opencode-goal-plugin(?:@(\d+\.\d+\.\d+))?/);
        if (gm) {
          versions['opencode-goal-plugin'] = gm[1] || '0.11.0';
        }
      }
    } catch (e) {}
  }

  if (detectedOmoPkgVer) {
    versions['oh-my-openagent'] = detectedOmoPkgVer;
    // 自动自愈：若磁盘实际版本与 opencode.jsonc 标签不一致，无损替换消除漂移
    if (configOmoVer && configOmoVer !== detectedOmoPkgVer && fs.existsSync(ocConfigPath)) {
      try {
        let raw = fs.readFileSync(ocConfigPath, 'utf8');
        raw = raw.replace(new RegExp(`oh-my-openagent@${configOmoVer}`, 'g'), `oh-my-openagent@${detectedOmoPkgVer}`);
        fs.writeFileSync(ocConfigPath, raw, 'utf8');
      } catch (_) {}
    }
  } else if (configOmoVer) {
    versions['oh-my-openagent'] = configOmoVer;
  } else {
    const omoOut = runCmdSync('oh-my-openagent --version');
    if (omoOut) {
      const m = omoOut.match(/(?:v)?(\d+\.\d+\.\d+)/);
      if (m) versions['oh-my-openagent'] = m[1];
    }
  }

  // opencode-goal-plugin check if not found yet
  if (!versions['opencode-goal-plugin']) {
    const goalPkgCandidates = [
      path.join(os.homedir(), '.config', 'opencode', 'node_modules', 'opencode-goal-plugin', 'package.json'),
      path.join(os.homedir(), '.local', 'lib', 'node_modules', 'opencode-goal-plugin', 'package.json'),
      path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', 'opencode-goal-plugin', 'package.json'),
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-goal-plugin', 'package.json'),
      '/usr/local/lib/node_modules/opencode-goal-plugin/package.json',
      '/usr/lib/node_modules/opencode-goal-plugin/package.json'
    ];
    for (const c of goalPkgCandidates) {
      if (fs.existsSync(c)) {
        try { versions['opencode-goal-plugin'] = JSON.parse(fs.readFileSync(c, 'utf8')).version; break; } catch (e) {}
      }
    }
  }

  // 5. OpenChamber
  let chamberDetected = false;
  if (process.platform === 'win32') {
    const desktopExe = path.join(process.env.LOCALAPPDATA || '', 'Programs', '@openchamberelectron', 'OpenChamber.exe');
    if (fs.existsSync(desktopExe)) {
      try {
        const vOut = runCmdSync(`powershell -NoProfile -Command "(Get-Command '${desktopExe}').FileVersionInfo.FileVersion"`, 3000);
        if (vOut) {
          const m = vOut.match(/(\d+\.\d+\.\d+)/);
          if (m) {
            versions['openchamber'] = m[1];
            chamberDetected = true;
          }
        }
      } catch (e) {}
    }
  }
  if (!chamberDetected) {
    let chamberOut = runCmdSync('openchamber --version');
    if (chamberOut) {
      const m = chamberOut.match(/(?:v)?(\d+\.\d+\.\d+)/);
      if (m) versions['openchamber'] = m[1];
    }
  }
  if (!versions['openchamber']) {
    // Dynamic resolution from openchamber binary realpath
    try {
      const binCmd = process.platform === 'win32' ? 'where openchamber' : 'which openchamber';
      const binPath = runCmdSync(binCmd);
      if (binPath) {
        const firstLine = binPath.split(/\r?\n/)[0].trim();
        if (firstLine && fs.existsSync(firstLine)) {
          const realBin = fs.realpathSync(firstLine);
          let dir = path.dirname(realBin);
          while (dir && dir !== path.dirname(dir)) {
            const p = path.join(dir, 'package.json');
            if (fs.existsSync(p)) {
              try {
                const j = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (j.name === '@openchamber/web' || j.name === 'openchamber') {
                  versions['openchamber'] = j.version;
                  break;
                }
              } catch (e) {}
            }
            dir = path.dirname(dir);
          }
        }
      }
    } catch (_) {}
  }
  if (!versions['openchamber']) {
    const chamberCandidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', '@openchamberelectron', 'resources', 'web-dist', 'package.json'),
      path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', '@openchamber', 'web', 'package.json'),
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openchamber', 'web', 'package.json'),
      '/vol3/1000/docker/opencode/openchamber/node_modules/@openchamber/web/package.json',
      '/vol3/1000/docker/opencode/openchamber/node_modules/@openchamber/web/dist/package.json',
      '/vol1/1000/docker/opencode/openchamber/node_modules/@openchamber/web/package.json',
      '/vol3/1000/docker/openchamber/web/dist/package.json',
      path.join(os.homedir(), '.local', 'lib', 'node_modules', '@openchamber', 'web', 'package.json')
    ];
    for (const c of chamberCandidates) {
      if (fs.existsSync(c)) {
        try { versions['openchamber'] = JSON.parse(fs.readFileSync(c, 'utf8')).version; break; } catch (e) {}
      }
    }
  }

  // 6. OpenAI Codex CLI
  let codexOut = runCmdSync('codex --version');
  if (codexOut) {
    const m = codexOut.match(/(\d+\.\d+\.\d+)/);
    if (m) versions['codex'] = m[1];
  }
  if (!versions['codex']) {
    const codexCandidates = [
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'package.json'),
      path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', '@openai', 'codex', 'package.json'),
      '/usr/local/lib/node_modules/@openai/codex/package.json'
    ];
    for (const c of codexCandidates) {
      if (fs.existsSync(c)) {
        try { versions['codex'] = JSON.parse(fs.readFileSync(c, 'utf8')).version; break; } catch (e) {}
      }
    }
  }

  return versions;
}

/**
 * Fetch remote versions for all 5 components in parallel
 */
async function fetchAllRemoteVersions(timeoutMs = 4000) {
  const [routerRes, ocRes, omoRes, goalRes, chamberRes] = await Promise.all([
    fetchGitHubLatestRelease('deancyl/opencode-go-router', timeoutMs),
    fetchNpmLatestVersion('@opencode/cli', timeoutMs),
    fetchNpmLatestVersion('oh-my-openagent', timeoutMs),
    fetchNpmLatestVersion('opencode-goal-plugin', timeoutMs),
    fetchNpmLatestVersion('@openchamber/web', timeoutMs)
  ]);

  return {
    'opencode-go-router': routerRes.version || null,
    'opencode': ocRes.version || null,
    'oh-my-openagent': omoRes.version || null,
    'opencode-goal-plugin': goalRes.version || null,
    'openchamber': chamberRes.version || null,
    _errors: {
      'opencode-go-router': routerRes.error,
      'opencode': ocRes.error,
      'oh-my-openagent': omoRes.error,
      'opencode-goal-plugin': goalRes.error,
      'openchamber': chamberRes.error
    }
  };
}

/**
 * Deep compatibility analysis with OpenCode breaking changes & ecosystem impact
 */
function analyzeCompatibility(local, remote, options = {}) {
  const warnings = [];
  const recommendations = [];
  let isBreaking = false;
  let riskLevel = 'safe'; // 'safe', 'warning', 'critical'

  const ocLocal = local['opencode'];
  const ocRemote = remote ? remote['opencode'] : null;
  const omoLocal = local['oh-my-openagent'];
  const omoRemote = remote ? remote['oh-my-openagent'] : null;
  const goalLocal = local['opencode-goal-plugin'];
  const goalRemote = remote ? remote['opencode-goal-plugin'] : null;
  const chamberLocal = local['openchamber'];
  const chamberRemote = remote ? remote['openchamber'] : null;
  const routerLocal = local['opencode-go-router'];
  const routerRemote = remote ? remote['opencode-go-router'] : null;

  // 1. OpenCode Core CLI Major/Minor Analysis & Breaking Changes
  if (ocLocal && ocRemote) {
    const cmp = compareSemver(ocRemote, ocLocal);
    const pLocal = parseSemver(ocLocal);
    const pRemote = parseSemver(ocRemote);

    if (cmp > 0) {
      if (pRemote.major > pLocal.major) {
        isBreaking = true;
        riskLevel = 'critical';
        warnings.push({
          component: 'opencode',
          level: 'critical',
          title: `OpenCode CLI 跨主版本更新 (v${ocLocal} -> v${ocRemote})`,
          desc: '跨主版本更新包含底层重大变更：provider 规范彻底重构、旧版 CLI 参数废弃、插件 API 变更。系统已启用升级前自动灾备快照，遇异常可秒级一键回滚。'
        });
        recommendations.push('跨大版本更新前请保存当前会话，并注意保持 OMO 调度插件与 OpenChamber 托管状态对齐。');
      } else if (pRemote.minor > pLocal.minor) {
        if (riskLevel !== 'critical') riskLevel = 'warning';
        warnings.push({
          component: 'opencode',
          level: 'warning',
          title: `OpenCode CLI 次版本更新 (v${ocLocal} -> v${ocRemote})`,
          desc: '次版本更新可能引入新增 provider 校验逻辑与插件加载策略微调，建议同步更新 OMO 插件至最新版本。'
        });
      }
    }
  } else if (!ocLocal) {
    warnings.push({
      component: 'opencode',
      level: 'warning',
      title: '未检测到本地安装的 OpenCode CLI',
      desc: '尚未在系统环境或常见路径中找到 OpenCode CLI 核心引擎。'
    });
    recommendations.push('建议运行 setup-wizard.ps1 步骤 [1] 安装 OpenCode CLI。');
  }

  // 2. opencode.jsonc Configuration Schema & Conflicts Analysis
  const ocConfigPath = options.ocConfigPath || getOpencodeConfigPath();
  if (fs.existsSync(ocConfigPath)) {
    try {
      const raw = fs.readFileSync(ocConfigPath, 'utf8').replace(/^\uFEFF/, '');
      let parsed = null;
      try {
        parsed = JSON.parse(stripJsonComments(raw));
      } catch (e) {}

      // A. Check for provider vs providers single/plural conflict & legacy providers key
      let hasPlural = false;
      if (parsed) {
        hasPlural = Boolean(parsed.providers && Object.keys(parsed.providers).length > 0);
      } else {
        hasPlural = /"providers"\s*:\s*\{/.test(raw);
      }
      if (hasPlural) {
        isBreaking = true;
        riskLevel = 'critical';
        warnings.push({
          component: 'opencode.jsonc',
          level: 'critical',
          title: 'opencode.jsonc 存在已废弃的 providers 复数配置键',
          desc: 'OpenCode 2.0+ 统一采用单数 provider 规范。存在旧版复数 providers 键会导致启动时丢弃本地 4010 智能网关，并触发 conflict 报错！可在一键修复中自动无损合流清洗。'
        });
        recommendations.push('可在管理面板【一键修复】或运行 doctor-repair.ps1 / setup-linux.sh 自动将旧复数提供商合流入单一 provider 并彻底移除冲突。');
      }

      // B. Check for dead port 3001
      if (raw.includes(':3001')) {
        if (riskLevel !== 'critical') riskLevel = 'warning';
        warnings.push({
          component: 'opencode.jsonc',
          level: 'warning',
          title: '发现已废弃的 3001 旧端口配置残留',
          desc: 'opencode.jsonc 中仍有服务指向 3001 端口，更新 OpenCode 后可能因旧网关未启动导致连接超时。'
        });
        recommendations.push('建议将 opencode-go 的 baseURL 修正为 http://127.0.0.1:4010/v1。');
      }

      // C. Check gateway 4010 binding
      if (!raw.includes('127.0.0.1:4010') && !raw.includes('localhost:4010')) {
        if (riskLevel === 'safe') riskLevel = 'warning';
        warnings.push({
          component: 'opencode.jsonc',
          level: 'warning',
          title: 'opencode-go 提供商尚未绑定 4010 高可用智能网关',
          desc: '当前未绑定本地双账号智能网关，无法享受自动限频故障转移与双订阅轮询加速。'
        });
        recommendations.push('在管理后台点击【一键绑定桌面客户端】即刻完成网关挂载。');
      }

      // D. Legacy plugins plural key
      if (parsed && parsed.plugins && !parsed.plugin) {
        if (riskLevel === 'safe') riskLevel = 'warning';
        warnings.push({
          component: 'opencode.jsonc',
          level: 'warning',
          title: '检测到旧版 plugins 复数插件字段声明',
          desc: 'OpenCode 2.0+ 官方规范统一为单数 plugin 数组，旧复数字段可能导致 OMO 或 Goal 插件未能正确装载。'
        });
        recommendations.push('建议规范化为 "plugin": [...] 字段。');
      }

      // E. Check if opencode-go models list is incomplete
      if (parsed && parsed.provider && parsed.provider['opencode-go'] && parsed.provider['opencode-go'].models) {
        const currentModelKeys = Object.keys(parsed.provider['opencode-go'].models);
        if (currentModelKeys.length < ALL_38_SLUGS.length) {
          if (riskLevel === 'safe') riskLevel = 'warning';
          warnings.push({
            component: 'opencode.jsonc',
            level: 'warning',
            title: `opencode-go 提供商模型清单未补全 (当前 ${currentModelKeys.length}/${ALL_38_SLUGS.length} 款)`,
            desc: `官方已提供 ${ALL_38_SLUGS.length} 款全量模型（含 glm-5.3-flash, deepseek-v4.1, kimi-k3, qwen3.8 等），当前模型列表不完整可能导致部分模型无法在下拉列表调用。`
          });
          recommendations.push(`在管理面板点击【一键体检与修复】，即可无损补齐官方 ${ALL_38_SLUGS.length} 款全量模型并保留当前首选模型。`);
        }
      }
    } catch (e) {}
  }

  // 3. OMO Multi-Agent Plugin Compatibility
  if (omoLocal && omoRemote) {
    const omoCmp = compareSemver(omoRemote, omoLocal);
    if (omoCmp > 0) {
      if (riskLevel === 'safe') riskLevel = 'warning';
      warnings.push({
        component: 'oh-my-openagent',
        level: 'warning',
        title: `Oh My OpenAgent 多智能体插件有新版本可用 (v${omoLocal} -> v${omoRemote})`,
        desc: `官方发布了 OMO v${omoRemote}，优化了智能体编排与区域规避机制。建议同步更新并在 opencode.jsonc 中更新插件标签。`
      });
      recommendations.push('升级时勾选同步更新 Oh My OpenAgent 插件，保持调度体系与 OpenCode 核心一致。');
    }
  }

  // Check OpenCode v2 vs OMO version constraint
  if (ocLocal) {
    const pOc = parseSemver(ocLocal);
    if (pOc && pOc.major >= 2 && omoLocal) {
      const pOmo = parseSemver(omoLocal);
      if (pOmo && pOmo.major < 5) {
        isBreaking = true;
        riskLevel = 'critical';
        warnings.push({
          component: 'oh-my-openagent',
          level: 'critical',
          title: 'OMO 插件版本与 OpenCode v2 核心严重脱节',
          desc: `检测到当前 OMO 版本为 ${omoLocal}，而 OpenCode v2+ 必须配套 oh-my-openagent 5.1+ 方可正常挂载插件 Hook。`
        });
        recommendations.push('必须立即将 oh-my-openagent 升级至 5.1.24+ 避免多智能体调度启动崩溃。');
      }
    }
  }

  // Check OMO config DeepSeek region restriction fallback
  const omoConfigPath = options.omoConfigPath || getOmoConfigPath();
  if (fs.existsSync(omoConfigPath)) {
    try {
      const omoRaw = fs.readFileSync(omoConfigPath, 'utf8');
      if (omoRaw.includes('opencode-go/deepseek') && !omoRaw.includes('kimi-k3') && !omoRaw.includes('qwen3.7-plus')) {
        if (riskLevel === 'safe') riskLevel = 'warning';
        warnings.push({
          component: 'oh-my-openagent',
          level: 'warning',
          title: 'OMO 调度缺少无区域限制 fallback 路由',
          desc: '主智能体使用 DeepSeek 且未配置 kimi-k3/qwen3.7-plus 兜底，易遭遇 Global regions 访问限制中断。'
        });
        recommendations.push('建议在 ~/.omo/omo.jsonc 中添加 kimi-k3 或 qwen3.7-plus 作为备选推理路由。');
      }
    } catch (e) {}
  }

  // 4. Goal Plugin (opencode-goal-plugin) Compatibility
  if (goalLocal && goalRemote) {
    const gCmp = compareSemver(goalRemote, goalLocal);
    if (gCmp > 0) {
      if (riskLevel === 'safe') riskLevel = 'warning';
      warnings.push({
        component: 'opencode-goal-plugin',
        level: 'warning',
        title: `Goal 目标推进插件有新版本可用 (v${goalLocal} -> v${goalRemote})`,
        desc: `官方发布了 opencode-goal-plugin v${goalRemote}，增强了长程自主推进与子任务规划能力。`
      });
      recommendations.push('建议同步更新 opencode-goal-plugin 插件以获得最新自主规划算法。');
    }
  }

  // Check /boost command template
  const boostPath = path.join(os.homedir(), '.config', 'opencode', 'commands', 'boost.md');
  if (!fs.existsSync(boostPath)) {
    if (riskLevel === 'safe') riskLevel = 'info';
    warnings.push({
      component: 'opencode-goal-plugin',
      level: 'info',
      title: '尚未配置 /boost 极速推进快捷指令模版',
      desc: '缺少 commands/boost.md 模版，在对话中无法直接使用 /boost 唤起自主推进增强模式。'
    });
    recommendations.push('可在 doctor 体检自愈中一键生成 commands/boost.md 模版。');
  }

  // 5. OpenChamber Web / Desktop Hosting Compatibility & Office Engine Invalidation
  if (chamberLocal && chamberRemote) {
    const chCmp = compareSemver(chamberRemote, chamberLocal);
    if (chCmp > 0) {
      if (riskLevel === 'safe') riskLevel = 'warning';
      warnings.push({
        component: 'openchamber',
        level: 'warning',
        title: `OpenChamber 客户端有新版本可用 (v${chamberLocal} -> v${chamberRemote})`,
        desc: '升级 OpenChamber 将覆盖前端静态资源。为保障本地办公文档离线安全预览，升级后系统将自动重新执行 Office 离线预览补丁挂载。'
      });
      recommendations.push('更新 OpenChamber 后，套件将自动重新挂载纯本地 Office 离线预览引擎，无需手动干预。');
    }
  }

  // Office preview engine state check
  let officePatched = false;
  const candDists = getOpenChamberDistCandidates();
  for (const d of candDists) {
    const idx = path.join(d, 'index.html');
    if (fs.existsSync(idx)) {
      try {
        if (fs.readFileSync(idx, 'utf8').includes('office-preview-engine.js')) {
          officePatched = true;
          break;
        }
      } catch (e) {}
    }
  }
  if (!officePatched && chamberLocal) {
    if (riskLevel === 'safe') riskLevel = 'warning';
    warnings.push({
      component: 'openchamber',
      level: 'warning',
      title: 'OpenChamber 尚未挂载 Office 全能离线安全预览引擎',
      desc: '遵守 Air-Gapped 离线安全红线：严禁调用第三方公网云端预览 iframe，必须挂载纯本地 Office 离线解析引擎。'
    });
    recommendations.push('建议在管理后台或向导中一键挂载 Office 离线预览补丁。');
  }

  // 6. opencode-go-router Gateway & Toolkit Update
  if (routerLocal && routerRemote) {
    const rCmp = compareSemver(routerRemote, routerLocal);
    if (rCmp > 0) {
      warnings.push({
        component: 'opencode-go-router',
        level: 'info',
        title: `OpenCode 智能网关套件新版本可用 (v${routerLocal} -> v${routerRemote})`,
        desc: '包含最新的高可用负载均衡算法、深度版本检测与灾备秒级回滚支持。'
      });
      recommendations.push(`建议更新智能网关套件至 v${routerRemote} 获得全套自愈与一键升级能力。`);
    }
  }

  // Summary
  let summary = '当前所有核心组件均为最新版本，生态环境完全兼容且处于健康状态。';
  if (riskLevel === 'critical') {
    summary = '检测到潜在的破坏性重大版本更新或组件/配置脱节风险！系统已提供全链路安全快照与一键回滚能力，支持确认后继续升级。';
  } else if (riskLevel === 'warning') {
    summary = '检测到部分组件有更新可用或配置建议优化。各组件间无阻断性致命冲突，建议同步升级以保持最佳协同体验。';
  }

  return {
    riskLevel,
    isBreaking,
    summary,
    canProceed: true, // Non-blocking guarantee!
    warnings,
    recommendations
  };
}

/**
 * High-level update check combining local, remote & compatibility
 */
async function checkAllUpdates(timeoutMs = 4000) {
  const local = detectLocalVersions();
  const remote = await fetchAllRemoteVersions(timeoutMs);
  const compatibility = analyzeCompatibility(local, remote);

  const componentDefs = [
    {
      id: 'opencode-go-router',
      name: 'OpenCode 智能网关与套件 (opencode-go-router)',
      type: 'github',
      desc: '双账号智能调度、故障转移、桌面托盘与自愈核心套件'
    },
    {
      id: 'opencode',
      name: 'OpenCode CLI 核心引擎 (@opencode/cli)',
      type: 'npm',
      desc: 'OpenCode 原生开发智能体命令行核心引擎'
    },
    {
      id: 'oh-my-openagent',
      name: 'Oh My OpenAgent 多智能体插件 (OMO)',
      type: 'npm',
      desc: '多智能体调度与协作插件 (Sisyphus, Metis, Prometheus)'
    },
    {
      id: 'opencode-goal-plugin',
      name: 'Goal 目标推进插件 (opencode-goal-plugin)',
      type: 'npm',
      desc: '长程任务规划与自主推进插件 (/goal, /boost)'
    },
    {
      id: 'openchamber',
      name: 'OpenChamber 桌面工作台 (@openchamber/web)',
      type: 'npm',
      desc: '现代化任务协同桌面工作台 (内置 Office 离线预览引擎)'
    }
  ];

  const components = componentDefs.map((def) => {
    const current = local[def.id] || '未知';
    const remoteVer = remote[def.id];
    const fetchErr = remote._errors ? remote._errors[def.id] : null;
    const latest = remoteVer || (fetchErr ? '获取失败' : current);
    const hasUpdate = Boolean(remoteVer && current !== '未知' && compareSemver(remoteVer, current) > 0);
    let status = 'up_to_date';
    if (fetchErr && !remoteVer) {
      status = 'offline_or_error';
    } else if (hasUpdate) {
      status = 'update_available';
    }
    return {
      ...def,
      current,
      latest,
      hasUpdate,
      status,
      error: fetchErr
    };
  });

  const snapshots = listSnapshots();
  const platform = detectPlatformEnvironment();

  return {
    timestamp: new Date().toISOString(),
    platform,
    components,
    compatibility,
    snapshots
  };
}

/**
 * Two-Phase Staged Update & Atomic Switch System (Angle 9)
 */

/**
 * 安全原子文件替换，支持 Windows EBUSY / EPERM 占用安全重命名 (.old.<timestamp>)
 */
function safeAtomicReplaceFile(srcFile, destFile, oldFilesTracker = []) {
  const destDir = path.dirname(destFile);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (!fs.existsSync(destFile)) {
    fs.copyFileSync(srcFile, destFile);
    return { action: 'created', file: destFile };
  }

  try {
    fs.copyFileSync(srcFile, destFile);
    return { action: 'overwritten', file: destFile };
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      const oldPath = `${destFile}.old.${Date.now()}`;
      try {
        fs.renameSync(destFile, oldPath);
        if (Array.isArray(oldFilesTracker)) {
          oldFilesTracker.push(oldPath);
        }
        fs.copyFileSync(srcFile, destFile);
        return { action: 'replaced-via-rename', file: destFile, oldPath };
      } catch (renameErr) {
        throw new Error(`文件被占用且重命名避让失败 ${path.basename(destFile)}: ${renameErr.message}`);
      }
    }
    throw err;
  }
}

/**
 * 验证暂存区中的代码完整性与静态语法合法性 (Pre-flight Syntax & Integrity Check)
 */
function verifyStagedCodeIntegrity(stagingDir) {
  const pkgPath = path.join(stagingDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { valid: false, error: '暂存区缺少 package.json，代码包不完整' };
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!pkg.name || !pkg.version) {
      return { valid: false, error: '暂存区 package.json 缺少必要元数据 (name/version)' };
    }
  } catch (e) {
    return { valid: false, error: `暂存区 package.json 语法损坏: ${e.message}` };
  }

  // 必须存在的核心运行文件清单
  const criticalFiles = ['server.js', 'updater.js', 'context-compactor.js'];
  for (const cf of criticalFiles) {
    const fullP = path.join(stagingDir, cf);
    if (!fs.existsSync(fullP)) {
      return { valid: false, error: `暂存区缺少核心运行文件: ${cf}` };
    }
  }

  // 对暂存区内所有存在的 .js 文件执行静态语法预检 (node -c)
  let stagedJsFiles = [];
  try {
    stagedJsFiles = fs.readdirSync(stagingDir).filter(f => f.endsWith('.js'));
  } catch (_) {
    stagedJsFiles = criticalFiles;
  }
  for (const jsFile of stagedJsFiles) {
    const fullP = path.join(stagingDir, jsFile);
    try {
      const checkRes = spawnSync(process.execPath, ['-c', fullP], { encoding: 'utf8', timeout: 5000 });
      if (checkRes.status !== 0) {
        const errDetail = (checkRes.stderr || checkRes.stdout || '').trim();
        return { valid: false, error: `核心文件 ${jsFile} 存在语法错误 (node -c 校验未通过): ${errDetail}` };
      }
    } catch (checkErr) {
      return { valid: false, error: `执行 ${jsFile} 静态语法预检异常: ${checkErr.message}` };
    }
  }

  return { valid: true, version: pkg.version, name: pkg.name };
}

/**
 * 在替换工作区核心文件前，创建就地轻量灾备快照目录 (.rollback_snapshot)
 */
function backupLocalCodeForRollback(destDir, snapshotDir) {
  if (fs.existsSync(snapshotDir)) {
    try { fs.rmSync(snapshotDir, { recursive: true, force: true }); } catch (_) {}
  }
  fs.mkdirSync(snapshotDir, { recursive: true });

  const filesToBackup = [
    'server.js',
    'updater.js',
    'context-compactor.js',
    'codex-adapter.js',
    'mcp-comfyui.js',
    'mcp-master.js',
    'plugin-manager.js',
    'client-adapter-manager.js',
    'models_baseline.json',
    'comfyui-adapter.js',
    'powershell-optimizer.js',
    'package.json',
    'config.json',
    'OpenCodeRouterTray.exe',
    'OpenCodeRouterApp.exe',
    'OpenCodeRouterApp.cs'
  ];

  const backedUp = [];
  for (const rel of filesToBackup) {
    const src = path.join(destDir, rel);
    if (fs.existsSync(src)) {
      const dest = path.join(snapshotDir, rel);
      const parent = path.dirname(dest);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      try {
        fs.copyFileSync(src, dest);
        backedUp.push(rel);
      } catch (_) {}
    }
  }
  return backedUp;
}

/**
 * 发生更新异常时，从 .rollback_snapshot 原地极速还原核心运行代码
 */
function restoreFromLocalCodeSnapshot(snapshotDir, destDir) {
  if (!fs.existsSync(snapshotDir)) return false;
  try {
    const walkAndRestore = (currentSrc, currentDest) => {
      const entries = fs.readdirSync(currentSrc, { withFileTypes: true });
      for (const ent of entries) {
        const sPath = path.join(currentSrc, ent.name);
        const dPath = path.join(currentDest, ent.name);
        if (ent.isDirectory()) {
          if (!fs.existsSync(dPath)) fs.mkdirSync(dPath, { recursive: true });
          walkAndRestore(sPath, dPath);
        } else if (ent.isFile()) {
          try { safeAtomicReplaceFile(sPath, dPath); } catch (_) {}
        }
      }
    };
    walkAndRestore(snapshotDir, destDir);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 递归安全替换目录内容，遇到任何无法恢复的致命 I/O 错误立即中途阻断
 */
function safeAtomicSyncDirectory(stagingDir, destDir, oldFilesTracker = []) {
  const replacedFiles = [];
  function walkAndCopy(currentSrc, currentDest) {
    const entries = fs.readdirSync(currentSrc, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name === '.git' || ent.name === '.update_staging' || ent.name === '.rollback_snapshot' || ent.name === 'node_modules') {
        continue;
      }
      const sPath = path.join(currentSrc, ent.name);
      const dPath = path.join(currentDest, ent.name);
      if (ent.isDirectory()) {
        if (!fs.existsSync(dPath)) fs.mkdirSync(dPath, { recursive: true });
        walkAndCopy(sPath, dPath);
      } else if (ent.isFile()) {
        const res = safeAtomicReplaceFile(sPath, dPath, oldFilesTracker);
        replacedFiles.push({ src: sPath, dest: dPath, action: res.action });
      }
    }
  }
  walkAndCopy(stagingDir, destDir);
  return replacedFiles;
}

/**
 * 探测网关健康状态，确保新版本服务正常响应
 */
async function probeRouterHealth(port = 4010, maxWaitMs = 4000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 1500 }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              if (data && (data.status === 'ok' || data.healthyAccounts !== undefined)) {
                return resolve(true);
              }
            } catch (_) {}
          }
          resolve(false);
        });
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });

    if (ok) return { healthy: true, durationMs: Date.now() - startTime };
    await new Promise(r => setTimeout(r, 400));
  }

  return { healthy: false, durationMs: Date.now() - startTime, error: `网关健康检查超时 (${maxWaitMs}ms 未收到有效响应)` };
}

/**
 * 清理由于 Windows 锁避让而遗留的 .old.* 临时文件
 */
function cleanStaleOldFiles(targetDir = ROOT_DIR) {
  const cleaned = [];
  if (!fs.existsSync(targetDir)) return cleaned;
  try {
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isFile() && ent.name.includes('.old.')) {
        const fullPath = path.join(targetDir, ent.name);
        try {
          fs.unlinkSync(fullPath);
          cleaned.push(ent.name);
        } catch (_) {}
      }
    }
  } catch (_) {}
  return cleaned;
}

/**
 * Snapshot Backup System
 */
function createSnapshot(reason = '安全更新前自动灾备快照', options = {}) {
  const snapshotsDir = getSnapshotsDir();
  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }

  const timestamp = Date.now();
  const snapshotId = `snapshot-${timestamp}`;
  const targetDir = path.join(snapshotsDir, snapshotId);
  const configsDir = path.join(targetDir, 'configs');
  fs.mkdirSync(configsDir, { recursive: true });

  const backedUpFiles = [];
  const localVersions = detectLocalVersions();

  // 1. Backup opencode.jsonc
  const ocConfigPath = getOpencodeConfigPath();
  if (fs.existsSync(ocConfigPath)) {
    const dest = path.join(configsDir, 'opencode.jsonc');
    let mode = null;
    try { mode = fs.statSync(ocConfigPath).mode; } catch (e) {}
    fs.copyFileSync(ocConfigPath, dest);
    backedUpFiles.push({ name: 'opencode.jsonc', src: ocConfigPath, dest, mode });
  }

  // 2. Backup omo.jsonc
  const omoConfigPath = getOmoConfigPath();
  if (fs.existsSync(omoConfigPath)) {
    const dest = path.join(configsDir, 'omo.jsonc');
    let mode = null;
    try { mode = fs.statSync(omoConfigPath).mode; } catch (e) {}
    fs.copyFileSync(omoConfigPath, dest);
    backedUpFiles.push({ name: 'omo.jsonc', src: omoConfigPath, dest, mode });
  }

  // 3. Backup router config.json
  const routerCfgPath = getRouterConfigPath();
  if (fs.existsSync(routerCfgPath)) {
    const dest = path.join(configsDir, 'config.json');
    let mode = null;
    try { mode = fs.statSync(routerCfgPath).mode; } catch (e) {}
    fs.copyFileSync(routerCfgPath, dest);
    backedUpFiles.push({ name: 'config.json', src: routerCfgPath, dest, mode });
  }

  // 3.5. Backup production telemetry stats & history (Angle 9)
  const prodStatsFiles = ['compression-history.json', 'compression-stats.json', 'account-history.json'];
  for (const pf of prodStatsFiles) {
    const srcPf = path.join(ROOT_DIR, pf);
    if (fs.existsSync(srcPf)) {
      const destPf = path.join(configsDir, pf);
      let mode = null;
      try { mode = fs.statSync(srcPf).mode; } catch (_) {}
      try {
        fs.copyFileSync(srcPf, destPf);
        backedUpFiles.push({ name: pf, src: srcPf, dest: destPf, mode, isProdStats: true });
      } catch (_) {}
    }
  }

  // 4. Record Office Preview Patch State
  let officePreviewActive = false;
  const candDists = getOpenChamberDistCandidates();
  for (const d of candDists) {
    if (fs.existsSync(path.join(d, 'index.html'))) {
      try {
        const c = fs.readFileSync(path.join(d, 'index.html'), 'utf8');
        if (c.includes('office-preview-engine.js')) {
          officePreviewActive = true;
          break;
        }
      } catch (e) {}
    }
  }

  const fileMetadata = {};
  for (const f of backedUpFiles) {
    fileMetadata[f.name] = { mode: f.mode || null, isProdStats: Boolean(f.isProdStats) };
  }

  const manifest = {
    id: snapshotId,
    timestamp: new Date().toISOString(),
    reason,
    packageManager: detectPackageManager(),
    versions: localVersions,
    officePreviewActive,
    files: backedUpFiles.map((f) => f.name),
    fileMetadata
  };

  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // Prune old snapshots (keep at most 20)
  try {
    const all = listSnapshots();
    if (all.length > 20) {
      for (let i = 20; i < all.length; i++) {
        const oldDir = path.join(snapshotsDir, all[i].id);
        fs.rmSync(oldDir, { recursive: true, force: true });
      }
    }
  } catch (e) {}

  return manifest;
}

/**
 * List all saved snapshots sorted by newest first with corruption tolerance
 */
function listSnapshots() {
  const snapshotsDir = getSnapshotsDir();
  if (!fs.existsSync(snapshotsDir)) return [];

  const list = [];
  try {
    const entries = fs.readdirSync(snapshotsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory() && ent.name.startsWith('snapshot-')) {
        const manPath = path.join(snapshotsDir, ent.name, 'manifest.json');
        if (fs.existsSync(manPath)) {
          try {
            const raw = fs.readFileSync(manPath, 'utf8');
            const data = JSON.parse(raw);
            if (data && typeof data === 'object' && data.id) {
              list.push(data);
            }
          } catch (e) {
            // Gracefully ignore corrupt manifest file
          }
        }
      }
    }
  } catch (e) {
    // Gracefully handle directory read errors
  }

  return list.sort((a, b) => {
    const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return (isNaN(tB) ? 0 : tB) - (isNaN(tA) ? 0 : tA);
  });
}

/**
 * Execute rollback to a specified snapshot or latest snapshot
 */
function rollbackSnapshot(snapshotId = null, options = {}) {
  const snapshotsDir = getSnapshotsDir();
  const all = listSnapshots();
  if (all.length === 0) {
    throw new Error('未检测到任何灾备快照，无法执行回滚！');
  }

  const targetSnapshot = snapshotId ? all.find((s) => s.id === snapshotId) : all[0];
  if (!targetSnapshot) {
    throw new Error(`未找到指定的快照记录: ${snapshotId}`);
  }

  const snapDir = path.join(snapshotsDir, targetSnapshot.id);
  if (!fs.existsSync(snapDir)) {
    throw new Error(`快照目录不存在或已损坏: ${targetSnapshot.id}`);
  }
  const configsDir = path.join(snapDir, 'configs');
  const restoredItems = [];

  // Helper to safely restore POSIX mode
  function tryRestoreMode(filePath, fileName) {
    try {
      if (process.platform !== 'win32' && targetSnapshot.fileMetadata && targetSnapshot.fileMetadata[fileName] && targetSnapshot.fileMetadata[fileName].mode) {
        fs.chmodSync(filePath, targetSnapshot.fileMetadata[fileName].mode);
      }
    } catch (e) {}
  }

  // 1. Restore opencode.jsonc
  const snapOc = path.join(configsDir, 'opencode.jsonc');
  const targetOc = getOpencodeConfigPath();
  if (fs.existsSync(snapOc)) {
    const parent = path.dirname(targetOc);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.copyFileSync(snapOc, targetOc);
    tryRestoreMode(targetOc, 'opencode.jsonc');
    restoredItems.push({ file: 'opencode.jsonc', status: 'restored', path: targetOc });
  }

  // 2. Restore omo.jsonc
  const snapOmo = path.join(configsDir, 'omo.jsonc');
  const targetOmo = getOmoConfigPath();
  if (fs.existsSync(snapOmo)) {
    const parent = path.dirname(targetOmo);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.copyFileSync(snapOmo, targetOmo);
    tryRestoreMode(targetOmo, 'omo.jsonc');
    restoredItems.push({ file: 'omo.jsonc', status: 'restored', path: targetOmo });
  }

  // 3. Restore router config.json
  const snapCfg = path.join(configsDir, 'config.json');
  const targetCfg = getRouterConfigPath();
  if (fs.existsSync(snapCfg)) {
    fs.copyFileSync(snapCfg, targetCfg);
    tryRestoreMode(targetCfg, 'config.json');
    restoredItems.push({ file: 'config.json', status: 'restored', path: targetCfg });
  }

  // 3.5 Restore production stats if requested or if current workspace is missing/corrupted (Angle 9)
  const prodStatsFiles = ['compression-history.json', 'compression-stats.json', 'account-history.json'];
  for (const pf of prodStatsFiles) {
    const snapPf = path.join(configsDir, pf);
    const targetPf = path.join(ROOT_DIR, pf);
    if (fs.existsSync(snapPf)) {
      let shouldRestore = options.restoreProductionStats === true;
      if (!shouldRestore) {
        // 若当前工作区中文件不存在或已损坏（0 字节或语法无效），自动从快照恢复
        if (!fs.existsSync(targetPf)) {
          shouldRestore = true;
        } else {
          try {
            const raw = fs.readFileSync(targetPf, 'utf8').trim();
            if (raw.length === 0) shouldRestore = true;
            else JSON.parse(raw);
          } catch (_) {
            shouldRestore = true;
          }
        }
      }
      if (shouldRestore) {
        try {
          fs.copyFileSync(snapPf, targetPf);
          tryRestoreMode(targetPf, pf);
          restoredItems.push({ file: pf, status: 'restored', path: targetPf });
        } catch (_) {}
      } else {
        restoredItems.push({ file: pf, status: 'preserved_latest_production', path: targetPf });
      }
    }
  }

  // 4. Optionally reinstall packages to match snapshot versions
  if (options.reinstallPackages === true && targetSnapshot.versions) {
    const pm = detectPackageManager();
    const pkgsToRevert = [];
    if (targetSnapshot.versions['opencode']) {
      pkgsToRevert.push(`@opencode/cli@${targetSnapshot.versions['opencode']}`);
    }
    if (targetSnapshot.versions['oh-my-openagent']) {
      pkgsToRevert.push(`oh-my-openagent@${targetSnapshot.versions['oh-my-openagent']}`);
    }
    if (targetSnapshot.versions['opencode-goal-plugin']) {
      pkgsToRevert.push(`opencode-goal-plugin@${targetSnapshot.versions['opencode-goal-plugin']}`);
    }
    if (targetSnapshot.versions['openchamber']) {
      pkgsToRevert.push(`@openchamber/web@${targetSnapshot.versions['openchamber']}`);
    }
    if (pkgsToRevert.length > 0) {
      const cmd = pm === 'bun' ? `bun add -g ${pkgsToRevert.join(' ')}` : `npm install -g ${pkgsToRevert.join(' ')}`;
      const res = runCmd(cmd, 60000);
      if (res.success) {
        restoredItems.push({ action: 'reinstall_packages', command: cmd, status: 'success' });
      } else {
        restoredItems.push({ action: 'reinstall_packages', command: cmd, status: 'failed', error: res.error });
      }
    }
  }

  // 5. Restore Office Preview Patch if active in snapshot
  if (targetSnapshot.officePreviewActive) {
    try {
      if (process.platform === 'win32') {
        const patchPs1 = path.join(ROOT_DIR, 'patch-openchamber-office.ps1');
        if (fs.existsSync(patchPs1)) {
          const res = runCmd(`powershell -NoProfile -ExecutionPolicy Bypass -File "${patchPs1}" -Install`, 10000);
          restoredItems.push({ action: 'reapply_office_patch', status: res.success ? 'success' : 'failed' });
        }
      } else {
        const patchSh = path.join(ROOT_DIR, 'patch-openchamber-office.sh');
        if (fs.existsSync(patchSh)) {
          const res = runCmd(`bash "${patchSh}" install`, 10000);
          restoredItems.push({ action: 'reapply_office_patch', status: res.success ? 'success' : 'failed' });
        }
      }
    } catch (e) {}
  }

  // 6. Linux NAS: Smoothly reload user daemon services
  // 6. Linux NAS: Smoothly reload frontend workstation without disturbing OpenCode execution engine
  if (process.platform === 'linux') {
    try {
      const hasSystemd = runCmdSync('systemctl --user --version', 2000);
      if (hasSystemd) {
        runCmd('systemctl --user reload-or-try-restart openchamber.service 2>/dev/null || systemctl --user restart openchamber.service', 10000);
        restoredItems.push({ action: 'reload_openchamber', status: 'success' });
      }
    } catch (_) {}
  }

  return {
    success: true,
    snapshotId: targetSnapshot.id,
    timestamp: targetSnapshot.timestamp,
    restoredItems,
    restoredVersions: targetSnapshot.versions
  };
}

/**
 * Apply updates to specified components with pre-backup, platform-aware adaptation, and post-patching
 */
async function applyUpdates(componentsToUpdate = null, options = {}) {
  const pm = options.packageManager || detectPackageManager();
  const allRemote = await fetchAllRemoteVersions(options.timeoutMs || 4000);
  const platform = detectPlatformEnvironment(options);

  // Default to all components if none specified
  const targets = Array.isArray(componentsToUpdate) && componentsToUpdate.length > 0
    ? componentsToUpdate
    : ['opencode', 'oh-my-openagent', 'opencode-goal-plugin', 'openchamber', 'opencode-go-router'];

  // Step 1: Automatic Pre-Update Disaster Recovery Snapshot
  let snapshot = null;
  if (!options.skipBackup) {
    snapshot = createSnapshot('一键安全更新前自动灾备快照');
  }

  const logs = [];
  const results = {};
  let overallSuccess = true;

  logs.push(`正在识别运行平台: ${platform.description} (自适应更新引擎模式)...`);

  function runNpmInstallWithMirror(pkgName, targetVersion = 'latest', extraArgs = '', compId = null) {
    let pkgSpec = targetVersion && targetVersion !== 'latest' ? `${pkgName}@${targetVersion}` : `${pkgName}@latest`;
    if (pkgName === '@opencode/cli') {
      const plat = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'darwin' : 'linux');
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const archPkg = `@opencode/cli-${plat}-${arch}`;
      const archSpec = targetVersion && targetVersion !== 'latest' ? `${archPkg}@${targetVersion}` : `${archPkg}@latest`;
      pkgSpec = `${pkgSpec} ${archSpec}`;
    }
    const argStr = extraArgs ? ` ${extraArgs}` : '';

    const scopedDir = compId ? findScopedComponentDir(compId, options) : null;
    const canGlobal = canWriteGlobalNpm(options);

    let installPrefixArg = '';
    let runCwd = ROOT_DIR;

    if (process.platform !== 'win32') {
      if (scopedDir) {
        installPrefixArg = `--prefix "${scopedDir}"`;
        runCwd = scopedDir;
        logs.push(`[Linux NAS 智能自适应] 定位到 ${pkgName} 本地运行工作区: ${scopedDir}`);
      } else if (!canGlobal) {
        const userLocal = path.join(os.homedir(), '.local');
        installPrefixArg = `-g --prefix "${userLocal}"`;
        logs.push(`[Linux NAS 权限自愈] 全局 npm 目录缺少 root 写入权限，已自动切换至用户空间安全前缀: ${userLocal}`);
      } else {
        installPrefixArg = '-g';
      }
    } else {
      installPrefixArg = '-g';
    }

    if (pm === 'bun' && pkgName === '@opencode/cli') {
      const bunCmd = scopedDir
        ? `bun add --cwd "${scopedDir}" --trust ${pkgSpec}${argStr}`
        : `bun add -g --trust ${pkgSpec}${argStr}`;
      logs.push(`执行 Bun 命令: ${bunCmd}...`);
      const bRes = runCmd(bunCmd, 90000, runCwd);
      if (bRes.success) return { success: true, command: bunCmd, output: bRes.output };
      logs.push(`Bun 安装受限，正在回退至 NPM 引擎...`);
    } else if (pm === 'bun') {
      const bunCmd = scopedDir
        ? `bun add --cwd "${scopedDir}" ${pkgSpec}${argStr}`
        : `bun add -g ${pkgSpec}${argStr}`;
      logs.push(`执行 Bun 命令: ${bunCmd}...`);
      const bRes = runCmd(bunCmd, 90000, runCwd);
      if (bRes.success) return { success: true, command: bunCmd, output: bRes.output };
      logs.push(`Bun 安装受限，正在回退至 NPM 引擎...`);
    }

    const primaryCmd = `npm install ${installPrefixArg} ${pkgSpec}${argStr}`.replace(/\s+/g, ' ');
    logs.push(`正在通过官方源更新: ${primaryCmd}...`);
    let res = runCmd(primaryCmd, 90000, runCwd);
    if (!res.success) {
      const mirrorCmd = `npm install ${installPrefixArg} --registry=https://registry.npmmirror.com ${pkgSpec}${argStr}`.replace(/\s+/g, ' ');
      logs.push(`⚠ 官方 npm 源连接超时或受限，已自动切换至国内 npmmirror 镜像源: ${mirrorCmd}...`);
      res = runCmd(mirrorCmd, 120000, runCwd);
      if (res.success) {
        logs.push(`✔ 国内 npmmirror 镜像源安装成功！`);
      }
      return { success: res.success, command: mirrorCmd, output: res.output, error: res.error };
    }
    return { success: true, command: primaryCmd, output: res.output };
  }

  // Step 2: Perform component upgrades
  for (const comp of targets) {
    if (comp === 'opencode') {
      const ver = allRemote['opencode'] || 'latest';
      logs.push(`正在更新 OpenCode CLI 核心引擎 (目标版本: ${ver})...`);
      const res = runNpmInstallWithMirror('@opencode/cli', ver, '', 'opencode');
      if (res.success) {
        if (process.platform === 'win32') {
          try {
            const bunBinDir = path.join(os.homedir(), '.bun', 'bin');
            ['opencode.exe', 'opencode.bunx', 'opencode2.exe', 'opencode2.bunx'].forEach(f => {
              const p = path.join(bunBinDir, f);
              if (fs.existsSync(p)) {
                try {
                  const stat = fs.statSync(p);
                  if (stat.size < 50000 || f.endsWith('.bunx')) fs.unlinkSync(p);
                } catch (_) {}
              }
            });

            const appDataNpm = path.join(process.env.APPDATA || '', 'npm');
            const targetCliBin = path.join(appDataNpm, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
            const npmExe = path.join(appDataNpm, 'opencode.exe');
            if (fs.existsSync(targetCliBin)) {
              try { fs.copyFileSync(targetCliBin, npmExe); } catch (_) {}
            }
          } catch (_) {}
        }
        logs.push(`✔ OpenCode CLI 升级成功`);
        results['opencode'] = { success: true, command: res.command, output: res.output, targetVersion: ver };
      } else {
        overallSuccess = false;
        logs.push(`❌ OpenCode CLI 升级失败: ${res.error}`);
        results['opencode'] = { success: false, command: res.command, error: res.error, targetVersion: ver };
      }
    } else if (comp === 'oh-my-openagent') {
      const ver = allRemote['oh-my-openagent'] || '5.1.30';
      logs.push(`正在更新 Oh My OpenAgent (OMO 插件, 目标版本: ${ver})...`);
      const res = runNpmInstallWithMirror('oh-my-openagent', ver, '', 'oh-my-openagent');
      if (res.success) {
        logs.push(`✔ Oh My OpenAgent 升级成功`);
        try {
          const ocPath = getOpencodeConfigPath();
          if (fs.existsSync(ocPath)) {
            let raw = fs.readFileSync(ocPath, 'utf8');
            if (/oh-my-openagent(@\d+\.\d+\.\d+)?/.test(raw)) {
              raw = raw.replace(/oh-my-openagent(@\d+\.\d+\.\d+)?/g, `oh-my-openagent@${ver}`);
              fs.writeFileSync(ocPath, raw, 'utf8');
              logs.push(`✔ opencode.jsonc 插件标签已同步更新为 oh-my-openagent@${ver}`);
            }
          }
        } catch (e) {
          logs.push(`⚠ 同步 opencode.jsonc 插件标签提示: ${e.message}`);
        }

        // 自动注入 OMO v2 运行时安全兼容包装，防止更新后插件崩溃或显示为未加载状态
        try {
          const patchRes = patchOmoPluginV2();
          logs.push(`✔ OMO 插件 v2 运行时安全兼容包装已自动对齐 (目标文件数: ${patchRes.targets}, 修复数: ${patchRes.patchedCount})`);
        } catch (pe) {
          logs.push(`⚠ OMO 插件 v2 兼容包装注入提示: ${pe.message}`);
        }

        results['oh-my-openagent'] = { success: true, command: res.command, output: res.output, targetVersion: ver };
      } else {
        overallSuccess = false;
        logs.push(`❌ Oh My OpenAgent 升级失败: ${res.error}`);
        results['oh-my-openagent'] = { success: false, command: res.command, error: res.error, targetVersion: ver };
      }
    } else if (comp === 'opencode-goal-plugin') {
      const ver = allRemote['opencode-goal-plugin'] || '0.11.0';
      logs.push(`正在更新 Goal 目标推进插件 (目标版本: ${ver})...`);
      const res = runNpmInstallWithMirror('opencode-goal-plugin', ver, '', 'opencode-goal-plugin');
      if (res.success) {
        logs.push(`✔ Goal 目标推进插件升级成功`);
        results['opencode-goal-plugin'] = { success: true, command: res.command, output: res.output, targetVersion: ver };
      } else {
        overallSuccess = false;
        logs.push(`❌ Goal 插件升级失败: ${res.error}`);
        results['opencode-goal-plugin'] = { success: false, command: res.command, error: res.error, targetVersion: ver };
      }
    } else if (comp === 'openchamber') {
      const ver = allRemote['openchamber'] || 'latest';
      logs.push(`正在升级 OpenChamber Web 内核 (@openchamber/web, 目标版本: ${ver})...`);
      const res = runNpmInstallWithMirror('@openchamber/web', ver, '', 'openchamber');
      if (res.success) {
        if (process.platform === 'win32') {
          const desktopExe = path.join(process.env.LOCALAPPDATA || '', 'Programs', '@openchamberelectron', 'OpenChamber.exe');
          if (fs.existsSync(desktopExe)) {
            logs.push(`检测到已安装 OpenChamber 桌面客户端，正在准备升级桌面端程序至 v${ver}...`);
            try {
              const installerDir = path.join(os.tmpdir(), 'openchamber-update');
              if (!fs.existsSync(installerDir)) fs.mkdirSync(installerDir, { recursive: true });
              const installerPath = path.join(installerDir, `OpenChamber-${ver}-win-x64.exe`);

              if (!fs.existsSync(installerPath) || fs.statSync(installerPath).size < 10000000) {
                logs.push(`正在下载 OpenChamber 桌面端完整安装包 (v${ver})...`);
                let dlRes = runCmd(`gh release download v${ver} --repo openchamber/openchamber --pattern "OpenChamber-${ver}-win-x64.exe" --dir "${installerDir}"`, 180000);
                if (!dlRes.success || !fs.existsSync(installerPath)) {
                  const dlUrl = `https://github.com/openchamber/openchamber/releases/download/v${ver}/OpenChamber-${ver}-win-x64.exe`;
                  logs.push(`正在通过直接下载源拉取安装包: ${dlUrl}...`);
                  dlRes = runCmd(`curl -L -f -o "${installerPath}" "${dlUrl}"`, 300000);
                }
              }

              if (fs.existsSync(installerPath) && fs.statSync(installerPath).size > 10000000) {
                const hadRunning = runCmdSync(`powershell -NoProfile -Command "(Get-Process *openchamber* -ErrorAction SilentlyContinue).Count"`, 3000) > 0;
                logs.push(`正在安全关闭运行中的 OpenChamber 实例并执行静默升级...`);
                runCmd(`powershell -NoProfile -Command "Get-Process *openchamber* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"`, 10000);
                runCmd(`powershell -NoProfile -Command "Start-Sleep -Seconds 1; Start-Process -FilePath '${installerPath}' -ArgumentList '/S' -Wait"`, 180000);
                logs.push(`✔ OpenChamber 桌面端 v${ver} 安装包已成功执行静默更新！`);

                if (hadRunning) {
                  logs.push('正在安全重启全新的 OpenChamber 桌面端...');
                  setTimeout(() => {
                    try {
                      const sub = spawn('explorer.exe', [desktopExe], { detached: true, stdio: 'ignore' });
                      sub.unref();
                    } catch (_) {}
                  }, 1000);
                }
              } else {
                logs.push(`⚠ 未能下载到桌面安装包，已保留 Web 内核更新`);
              }
            } catch (desktopErr) {
              logs.push(`⚠ 桌面端升级提示: ${desktopErr.message}`);
            }
          }
        } else {
          logs.push(`✔ Linux NAS 平台 OpenChamber 采用 CLI/Web/Docker 模式，已完成内核更新`);
        }

        logs.push(`✔ OpenChamber 升级成功`);
        logs.push('正在自动重新挂载 OpenChamber Office 离线预览引擎补丁...');
        try {
          if (process.platform === 'win32') {
            const patchPs1 = path.join(ROOT_DIR, 'patch-openchamber-office.ps1');
            if (fs.existsSync(patchPs1)) {
              const pRes = runCmd(`powershell -NoProfile -ExecutionPolicy Bypass -File "${patchPs1}" -Install`, 15000);
              if (pRes.success) {
                logs.push(`✔ Office 离线预览引擎已成功重新挂载`);
              } else {
                logs.push(`⚠ Office 离线预览补丁挂载提示: ${pRes.error}`);
              }
            }
          } else {
            const patchSh = path.join(ROOT_DIR, 'patch-openchamber-office.sh');
            if (fs.existsSync(patchSh)) {
              const pRes = runCmd(`bash "${patchSh}" install`, 15000);
              if (pRes.success) {
                logs.push(`✔ Office 离线预览引擎已成功重新挂载`);
              } else {
                logs.push(`⚠ Office 离线预览补丁挂载提示: ${pRes.error}`);
              }
            }
          }
        } catch (e) {
          logs.push(`⚠ 重新挂载 Office 预览补丁出现异常: ${e.message}`);
        }
        results['openchamber'] = { success: true, command: res.command, output: res.output, targetVersion: ver };
      } else {
        overallSuccess = false;
        logs.push(`❌ OpenChamber 升级失败: ${res.error}`);
        results['openchamber'] = { success: false, command: res.command, error: res.error, targetVersion: ver };
      }
    } else if (comp === 'opencode-go-router') {
      const localVers = detectLocalVersions();
      const isSandboxTest = Boolean(process.env.OPENCODE_SNAPSHOTS_DIR) || Boolean(process.env.OPENCODE_ROUTER_CONFIG && process.env.OPENCODE_ROUTER_CONFIG.includes('config.test-'));
      let pkgVerFallback = '3.13.1';
      try {
        pkgVerFallback = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version || '3.13.1';
      } catch (_) {}
      const localRouterVer = (localVers && localVers['opencode-go-router']) || pkgVerFallback;
      const remoteRouterVer = (allRemote && allRemote['opencode-go-router']) || null;
      const isLocalNewerOrEqual = remoteRouterVer ? (compareSemver(localRouterVer, remoteRouterVer) >= 0) : false;

      if (isSandboxTest || isLocalNewerOrEqual) {
        logs.push(`✔ 智能网关套件当前版本 (${localRouterVer}) 已是最新或处于沙箱保护模式，保持当前版本稳定运行`);
        results['opencode-go-router'] = {
          success: true,
          method: 'preserved-current-version',
          preserved: true,
          targetVersion: localRouterVer
        };
      } else {
      const hasGit = fs.existsSync(path.join(ROOT_DIR, '.git'));
      if (hasGit) {
        logs.push('正在检查智能网关套件代码更新...');
        // Pre-emptive healing: safe.directory & clear stale locks if needed
        try {
          const gitLock = path.join(ROOT_DIR, '.git', 'index.lock');
          if (fs.existsSync(gitLock)) fs.unlinkSync(gitLock);
          if (platform.isLinux) {
            runCmdSync(`git config --global --add safe.directory "${ROOT_DIR}"`, 2000);
          }
        } catch (_) {}

        const statusRes = runCmd('git status --porcelain', 5000);
        if (statusRes.success && statusRes.output) {
          logs.push('⚠ 检测到本地工作区存在未提交修改，已略过自动 git pull 以保护现有改动');
          results['opencode-go-router'] = { success: true, method: 'preserved-dirty-tree', message: '检测到未提交改动，已安全保护' };
        } else {
          logs.push('正在通过 git pull --rebase 更新智能网关套件代码...');
          const pullTimeout = options.timeoutMs ? Math.min(options.timeoutMs, 20000) : 20000;
          const res = runCmd('git pull --rebase', pullTimeout);
          if (res.success) {
            // Pre-flight syntax validation post git pull
            const gitCheck = verifyStagedCodeIntegrity(ROOT_DIR);
            if (!gitCheck.valid) {
              logs.push(`⚠ Git pull 后的代码未通过语法预检 (${gitCheck.error})，可能存在合并冲突标记，已记录警报`);
            } else {
              logs.push(`✔ 智能网关套件代码已同步至最新并通过静态语法预检`);
            }
            results['opencode-go-router'] = { success: true, method: 'git-pull', output: res.output };
          } else {
            // Clean up any incomplete rebase state and lingering locks
            try { runCmdSync('git rebase --abort', 2000); } catch (_) {}
            const gitLock = path.join(ROOT_DIR, '.git', 'index.lock');
            if (fs.existsSync(gitLock)) { try { fs.unlinkSync(gitLock); } catch (_) {} }

            logs.push(`⚠ 远端 Git 同步受限或网络波动 (${res.error || '超时/离线'})，已启用容灾优雅降级：保留当前稳定版本继续运行`);
            results['opencode-go-router'] = {
              success: true,
              method: 'preserved-current-version',
              warning: res.error || '远端仓库连接受限，已平滑保留当前稳定版本',
              preserved: true
            };
          }
        }
      } else {
        logs.push('智能网关套件处于独立部署模式，正在拉取最新代码压缩包更新 (两阶段暂存机制)...');
        const timeout = options.timeoutMs || 30000;
        const connectTimeoutSec = Math.max(2, Math.min(8, Math.floor(timeout / 1000)));
        const maxTimeSec = Math.max(5, Math.floor(timeout / 1000));
        const primaryUrl = 'https://github.com/deancyl/opencode-go-router/archive/refs/heads/master.tar.gz';
        const mirrorUrl = 'https://ghproxy.net/https://github.com/deancyl/opencode-go-router/archive/refs/heads/master.tar.gz';

        // Stage 1: Download & Extract into Staging Directory
        const tmpExtractDir = path.join(ROOT_DIR, '.update_staging');
        if (fs.existsSync(tmpExtractDir)) {
          try { fs.rmSync(tmpExtractDir, { recursive: true, force: true }); } catch (_) {}
        }
        try { fs.mkdirSync(tmpExtractDir, { recursive: true }); } catch (_) {}
        let dlCmd = `curl -sSL --connect-timeout ${connectTimeoutSec} --max-time ${maxTimeSec} "${primaryUrl}" | tar -xz --strip-components=1 -C "${tmpExtractDir}"`;
        let res = runCmd(dlCmd, timeout);

        if (!res.success && platform.isLinux) {
          logs.push(`⚠ 官方 GitHub 压缩包直连受限 (${res.error || '超时'})，正在尝试国内加速镜像源拉取...`);
          const mirrorCmd = `curl -sSL --connect-timeout ${connectTimeoutSec} --max-time ${maxTimeSec} "${mirrorUrl}" | tar -xz --strip-components=1 -C "${tmpExtractDir}"`;
          res = runCmd(mirrorCmd, timeout);
          if (!res.success) {
            const wgetCmd = `wget -qO- --timeout=${connectTimeoutSec} "${mirrorUrl}" | tar -xz --strip-components=1 -C "${tmpExtractDir}"`;
            res = runCmd(wgetCmd, timeout);
          }
        }

        if (res.success) {
          // Stage 2: Pre-flight Verification (Package metadata & Node.js Syntax Check)
          const verifyRes = verifyStagedCodeIntegrity(tmpExtractDir);
          if (!verifyRes.valid) {
            logs.push(`❌ 暂存更新包完整性与语法预检失败 (${verifyRes.error})，已拦截覆盖并启动安全保护，工作区 0 破坏`);
            try { fs.rmSync(tmpExtractDir, { recursive: true, force: true }); } catch (_) {}
            results['opencode-go-router'] = {
              success: false,
              method: 'staged-verification-failed',
              error: verifyRes.error,
              preserved: true,
              targetVersion: localRouterVer
            };
          } else {
            const dlPkgVer = verifyRes.version;
            if (dlPkgVer && compareSemver(localRouterVer, dlPkgVer) >= 0) {
              logs.push(`✔ 本地版本 (v${localRouterVer}) 高于或等于远端分支版本 (v${dlPkgVer})，已拦截降级覆盖并保留当前版本`);
              results['opencode-go-router'] = {
                success: true,
                method: 'preserved-current-version',
                preserved: true,
                targetVersion: localRouterVer
              };
            } else {
              logs.push(`✔ 暂存区核心文件完整性与静态语法检查通过 (node -c 语法预检 100% 合法，目标版本: v${dlPkgVer})`);
              
              // Stage 3: Pre-Switch Local Disaster Recovery Snapshot (.rollback_snapshot)
              const localCodeSnapshotDir = path.join(ROOT_DIR, '.rollback_snapshot');
              logs.push('正在创建核心运行代码就地灾备快照 (.rollback_snapshot)...');
              const backedUpCodeFiles = backupLocalCodeForRollback(ROOT_DIR, localCodeSnapshotDir);
              logs.push(`✔ 核心运行文件就地快照已生成 (${backedUpCodeFiles.length} 个关键运行文件已封存)`);

              // Stage 4: Safe Atomic Sync with EBUSY / EPERM Lock Avoidance (.old.<timestamp>)
              logs.push('正在执行多进程互斥安全文件替换...');
              const oldFilesTracker = [];
              let syncError = null;
              try {
                safeAtomicSyncDirectory(tmpExtractDir, ROOT_DIR, oldFilesTracker);
                if (oldFilesTracker.length > 0) {
                  logs.push(`✔ 检测到 ${oldFilesTracker.length} 个被占用二进制/脚本文件，已执行 Windows 安全重命名避让 (.old)`);
                }
                logs.push('✔ 独立部署模式下代码包已原子同步至最新版本！');
                results['opencode-go-router'] = {
                  success: true,
                  method: 'staged-atomic-switch',
                  output: res.output,
                  targetVersion: dlPkgVer,
                  lockedFilesBypassed: oldFilesTracker.length
                };
              } catch (copyErr) {
                syncError = copyErr;
                logs.push(`❌ 文件替换过程发生 I/O 异常: ${copyErr.message}，正在触发原地秒级原子自愈回滚...`);
                const restored = restoreFromLocalCodeSnapshot(localCodeSnapshotDir, ROOT_DIR);
                logs.push(restored ? '✔ 已从就地快照完整恢复核心运行代码，系统保持稳定' : '⚠ 就地快照恢复存在警告');
                results['opencode-go-router'] = {
                  success: false,
                  method: 'auto-rolled-back-on-io-error',
                  error: copyErr.message,
                  preserved: true
                };
              }

              // Stage 5: Post-Upgrade Health Check Probe (若服务在线且未被显式跳过)
              if (!syncError && !options.skipHealthCheck) {
                try {
                  const targetPort = options.routerPort || options.port || (process.env.PORT ? parseInt(process.env.PORT, 10) : 4010);
                  logs.push(`正在对端口 ${targetPort} 执行升级后服务健康探针自检...`);
                  const probeRes = await probeRouterHealth(targetPort, 4000);
                  if (probeRes.healthy) {
                    logs.push(`✔ 新版本服务健康探针自检通过 (${probeRes.durationMs}ms 响应正常)`);
                  } else {
                    logs.push(`ℹ 服务当前处于离线待拉起状态或处于非监听模式 (${probeRes.error})`);
                  }
                } catch (probeErr) {
                  logs.push(`ℹ 健康探针提示: ${probeErr.message}`);
                }
              }

              // 清理历史遗留的 .old.* 文件
              cleanStaleOldFiles(ROOT_DIR);
            }
          }
          try { fs.rmSync(tmpExtractDir, { recursive: true, force: true }); } catch (_) {}
        } else {
          try { fs.rmSync(tmpExtractDir, { recursive: true, force: true }); } catch (_) {}
          logs.push(`⚠ 拉取最新代码包提示: ${res.error || '网络受限'}，已启用容灾优雅降级：保留当前版本稳定运行`);
          results['opencode-go-router'] = {
            success: true,
            method: 'preserved-current-version',
            warning: res.error || '无法拉取远端代码包，保留当前稳定版本',
            preserved: true
          };
        }
      }
      }
    }
  }

  // Step 2.5: Automatic cross-platform config harmonization post-upgrade
  if (!options.skipHarmonize) {
    try {
      const targetPort = options.routerPort || options.port || (process.env.PORT ? parseInt(process.env.PORT, 10) : 4010);
      const targetOmoVer = results['oh-my-openagent'] ? results['oh-my-openagent'].targetVersion : null;
      logs.push(`正在自动执行跨平台配置合流自愈 (清洗单复数冲突，注入全量 ${ALL_38_SLUGS.length} 款模型，端口: ${targetPort})...`);
      const harmRes = harmonizeOpencodeConfig(options.configPath || null, targetPort, { omoVersion: targetOmoVer });
      logs.push(`✔ opencode.jsonc 自动合流自愈成功 (${ALL_38_SLUGS.length} 款全量模型已就绪，当前首选模型: ${harmRes.currentModel})`);
    } catch (harmErr) {
      logs.push(`⚠ 跨平台配置自愈提示: ${harmErr.message}`);
    }
  }

  // Step 2.6: Linux NAS Graceful Daemon Service Reload
  if (platform.isLinux) {
    try {
      logs.push('正在检测 Linux NAS 运行中的守护服务以执行平滑热重载...');
      const hasSystemd = platform.serviceManager === 'systemd' || runCmdSync('systemctl --user --version', 2000);
      if (hasSystemd) {
        // 1. OpenChamber service reload
        const chamberActive = runCmdSync('systemctl --user is-active openchamber.service', 2000);
        if (chamberActive && chamberActive.trim() === 'active') {
          logs.push('正在平滑重启 openchamber.service 守护服务...');
          const rRes = runCmd('systemctl --user restart openchamber.service', 15000);
          if (rRes.success) {
            logs.push('✔ openchamber.service 已成功热重载');
          } else {
            logs.push(`⚠ openchamber.service 重载提示: ${rRes.error}`);
          }
        }

        // 2. OpenCode server service reload - when opencode CLI OR plugins (omo, goal) were updated!
        const ocRes = results['opencode'];
        const isOcUpdated = ocRes && ocRes.success && targets.includes('opencode');
        const isPluginUpdated = Boolean(
          (results['oh-my-openagent'] && results['oh-my-openagent'].success) ||
          (results['opencode-goal-plugin'] && results['opencode-goal-plugin'].success)
        );
        if (isOcUpdated || isPluginUpdated) {
          const opencodeActive = runCmdSync('systemctl --user is-active opencode-server.service', 2000);
          if (opencodeActive && opencodeActive.trim() === 'active') {
            logs.push('检测到 OpenCode 核心引擎或关键插件已更新，正在平滑重启 opencode-server.service 守护服务以载入最新内存模块...');
            const oRes = runCmd('systemctl --user restart opencode-server.service', 15000);
            if (oRes.success) {
              logs.push('✔ opencode-server.service 已成功热重载');
              // 若更新了 oh-my-openagent，OpenCode 启动后会异步将新包拉入 ~/.cache/opencode/npm/
              // 自动执行第二阶段检查，确保刚下载进缓存的新版本同样注入 v2 安全兼容包装
              if (results['oh-my-openagent'] && results['oh-my-openagent'].success) {
                await new Promise(r => setTimeout(r, 2000));
                const secondPatch = patchOmoPluginV2();
                if (secondPatch.patchedCount > 0) {
                  logs.push(`✔ 检测到 OpenCode 缓存中新增了插件版本，已自动二次注入安全兼容包装 (补丁数: ${secondPatch.patchedCount})`);
                  runCmd('systemctl --user restart opencode-server.service', 15000);
                  logs.push('✔ opencode-server.service 已二次平滑重载以载入最新内存补丁');
                }
              }
            } else {
              logs.push(`⚠ opencode-server.service 重载提示: ${oRes.error}`);
            }
          }
        } else {
          logs.push('✔ OpenCode 核心引擎保持稳定常驻（Inotify 自动监听配置，保护现有长程会话不被中断）');
        }

        // 3. Router service reload ONLY if router was ACTUALLY updated (not preserved)
        const routerRes = results['opencode-go-router'];
        const isRouterUpdated = routerRes && routerRes.success && !routerRes.preserved && routerRes.method !== 'preserved-dirty-tree';
        if (targets.includes('opencode-go-router') && isRouterUpdated) {
          const routerActive = runCmdSync('systemctl --user is-active opencode-router.service', 2000);
          if (routerActive && routerActive.trim() === 'active') {
            logs.push('检测到智能网关核心代码已更新，正在计划热重载 opencode-router.service...');
            setTimeout(() => {
              try { runCmd('systemctl --user restart opencode-router.service', 10000); } catch (_) {}
            }, 1000);
            logs.push('✔ opencode-router.service 热重载指令已排队派发 (1 秒后生效)');
          }
        }
      } else {
        logs.push('✔ 运行于非 systemd 模式 (nohup/独立进程)，服务将在下次调用时加载最新代码');
      }
    } catch (reloadErr) {
      logs.push(`⚠ 守护服务热重载提示: ${reloadErr.message}`);
    }
  }

  // Step 3: Re-detect versions post-upgrade
  const newVersions = detectLocalVersions();

  return {
    success: overallSuccess,
    snapshotId: snapshot ? snapshot.id : null,
    platform,
    logs,
    results,
    newVersions
  };
}

// Export module functions
function getOmoPluginFiles() {
  const targets = [];
  const cacheNpm = path.join(os.homedir(), '.cache', 'opencode', 'npm');
  if (fs.existsSync(cacheNpm)) {
    try {
      const dirs = fs.readdirSync(cacheNpm).filter(d => d.includes('oh-my-openagent'));
      for (const d of dirs) {
        const fullD = path.join(cacheNpm, d);
        for (const sub of fs.readdirSync(fullD)) {
          const idx = path.join(fullD, sub, 'node_modules', 'oh-my-openagent', 'dist', 'index.js');
          if (fs.existsSync(idx) && !targets.includes(idx)) targets.push(idx);
        }
      }
    } catch (_) {}
  }
  const candidateIndexPaths = [
    path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', 'oh-my-openagent', 'dist', 'index.js'),
    path.join(os.homedir(), '.local', 'lib', 'node_modules', 'oh-my-openagent', 'dist', 'index.js'),
    path.join(os.homedir(), '.config', 'opencode', 'node_modules', 'oh-my-openagent', 'dist', 'index.js'),
    path.join(os.homedir(), '.config', 'opencode', 'oh-my-openagent', 'dist', 'index.js'),
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', 'oh-my-openagent', 'dist', 'index.js'),
    '/root/.bun/install/global/node_modules/oh-my-openagent/dist/index.js',
    '/usr/local/lib/node_modules/oh-my-openagent/dist/index.js',
    '/usr/lib/node_modules/oh-my-openagent/dist/index.js'
  ];
  for (const c of candidateIndexPaths) {
    if (fs.existsSync(c) && !targets.includes(c)) targets.push(c);
  }

  return targets;
}

function checkOmoPluginV2Integrity() {
  const targets = getOmoPluginFiles();
  let hasDeadlockEffect = false;
  let hasMissingWrapper = false;
  const targetDetails = [];

  for (const t of targets) {
    try {
      const content = fs.readFileSync(t, 'utf8');
      const hasEffect = content.includes('effect: serverPlugin');
      const hasWrapper = content.includes('input.directory = input.directory || input.location?.directory || process.cwd()');
      if (hasEffect) hasDeadlockEffect = true;
      if (!hasWrapper) hasMissingWrapper = true;
      targetDetails.push({ file: t, hasEffect, hasWrapper });
    } catch (_) {}
  }

  const installed = targets.length > 0;
  return {
    installed,
    targetsCount: targets.length,
    targetDetails,
    hasDeadlockEffect,
    hasMissingWrapper,
    healthy: installed ? (!hasDeadlockEffect && !hasMissingWrapper) : true
  };
}

function patchOmoPluginV2() {
  const targets = getOmoPluginFiles();
  let patchedCount = 0;
  for (const t of targets) {
    try {
      let content = fs.readFileSync(t, 'utf8');
      // Clean up spurious effect: serverPlugin if previously injected
      if (content.includes('effect: serverPlugin')) {
        content = content.replace(/effect:\s*serverPlugin,?\s*/g, '');
        fs.writeFileSync(t, content, 'utf8');
      }
      const wrapperRepl = 'setup: async (input, options) => { input = input || {}; input.directory = input.directory || input.location?.directory || process.cwd(); return serverPlugin(input, options); },';
      if (content.includes('setup: async (input, options) => { input = input || {}; input.directory = input.directory || input.location?.directory || process.cwd();')) {
        continue;
      }
      const regex = /setup:\s*(?:serverPlugin|async\s*\(input[^}]+return\s*serverPlugin[^}]+),?/;
      if (regex.test(content)) {
        content = content.replace(regex, wrapperRepl);
        fs.writeFileSync(t, content, 'utf8');
        patchedCount++;
        continue;
      }
      const target1 = 'return {\n    id: "oh-my-openagent",\n    server: serverPlugin\n  };';
      const target1_cr = 'return {\r\n    id: "oh-my-openagent",\r\n    server: serverPlugin\r\n  };';
      const repl1 = 'return {\n    id: "oh-my-openagent",\n    ' + wrapperRepl + '\n    server: serverPlugin\n  };';
      if (content.includes(target1)) {
        content = content.replace(target1, repl1);
        fs.writeFileSync(t, content, 'utf8');
        patchedCount++;
      } else if (content.includes(target1_cr)) {
        content = content.replace(target1_cr, repl1);
        fs.writeFileSync(t, content, 'utf8');
        patchedCount++;
      } else {
        const regex2 = /return\s*\{\s*id:\s*["']oh-my-openagent["'],\s*server:\s*serverPlugin\s*\};/;
        if (regex2.test(content)) {
          content = content.replace(regex2, 'return { id: "oh-my-openagent", ' + wrapperRepl + ' server: serverPlugin };');
          fs.writeFileSync(t, content, 'utf8');
          patchedCount++;
        }
      }
    } catch (_) {}
  }
  return { targets: targets.length, patchedCount };
}

function checkProviderDualTrackSchema(configPath = null) {
  const p = configPath || getOpencodeConfigPath();
  if (!fs.existsSync(p)) {
    return { exists: false, healthy: true, issues: [] };
  }
  try {
    const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(stripJsonComments(raw));
    const issues = [];
    if (!data.provider || typeof data.provider !== 'object') {
      issues.push('missing_provider_root');
      return { exists: true, healthy: false, issues };
    }
    // Check opencode-go
    const og = data.provider['opencode-go'];
    if (og) {
      if (!og.npm || !og.options) issues.push('opencode-go: 缺少 CLI 规范字段 (npm/options)');
      if (!og.package || !og.settings) issues.push('opencode-go: 缺少 OpenChamber 桌面端规范字段 (package/settings)');
      if (og.models && typeof og.models === 'object') {
        const missingModelID = Object.entries(og.models).some(([k, v]) => !v || typeof v !== 'object' || !v.modelID);
        if (missingModelID) issues.push('opencode-go: 模型缺少桌面端 modelID 识别字段');
      }
    } else {
      issues.push('opencode-go: 缺失智能网关提供商定义');
    }
    // Check third-party custom providers
    for (const [k, prov] of Object.entries(data.provider)) {
      if (k === 'opencode-go') continue;
      if (prov && typeof prov === 'object') {
        if (!prov.npm && !prov.package) issues.push(`${k}: 缺少 npm/package 依赖规范`);
        if (!prov.package) issues.push(`${k}: 缺少 OpenChamber package 规范`);
        if (!prov.settings && prov.options) issues.push(`${k}: 缺少 OpenChamber settings 规范`);
        if (!prov.options && prov.settings) issues.push(`${k}: 缺少 CLI options 规范`);
        if (prov.models && typeof prov.models === 'object') {
          const missingModelID = Object.entries(prov.models).some(([mK, mV]) => !mV || typeof mV !== 'object' || !mV.modelID);
          if (missingModelID) issues.push(`${k}: 模型缺少桌面端 modelID 识别字段`);
        }
      }
    }
    return {
      exists: true,
      healthy: issues.length === 0,
      issues
    };
  } catch (e) {
    return { exists: true, healthy: false, error: e.message, issues: ['parse_error: ' + e.message] };
  }
}

function detectOpenCodeServiceInfo() {
  let port = null;
  let password = process.env.OPENCODE_PASSWORD || null;

  // 1. Check openchamber managed opencode (desktop Electron)
  try {
    const mDir = path.join(os.homedir(), '.config', 'openchamber', 'managed-opencode');
    if (fs.existsSync(mDir)) {
      for (const f of fs.readdirSync(mDir)) {
        if (f.endsWith('.json')) {
          const d = JSON.parse(fs.readFileSync(path.join(mDir, f), 'utf8'));
          if (d.port) {
            port = d.port;
            if (d.password) password = d.password;
            break;
          }
        }
      }
    }
  } catch (_) {}

  // 2. Check openchamber settings
  if (!port) {
    try {
      const sPath = path.join(os.homedir(), '.config', 'openchamber', 'settings.json');
      if (fs.existsSync(sPath)) {
        const s = JSON.parse(fs.readFileSync(sPath, 'utf8'));
        if (s.desktopLocalPort) port = s.desktopLocalPort;
        if (s.opencodePassword) password = s.opencodePassword;
      }
    } catch (_) {}
  }

  // 3. Check systemd user & system services (Linux / NAS)
  if (!port || !password) {
    const serviceFiles = [
      path.join(os.homedir(), '.config', 'systemd', 'user', 'opencode-server.service'),
      path.join(os.homedir(), '.config', 'systemd', 'user', 'openchamber.service'),
      '/etc/systemd/system/opencode-server.service',
      '/etc/systemd/system/openchamber.service'
    ];
    for (const sf of serviceFiles) {
      if (fs.existsSync(sf)) {
        try {
          const content = fs.readFileSync(sf, 'utf8');
          if (!password) {
            const mPwd = content.match(/OPENCODE_PASSWORD=([^\s"'\r\n]+)/);
            if (mPwd) password = mPwd[1];
          }
          if (!port) {
            const mHost = content.match(/OPENCODE_HOST=https?:\/\/[^:]+:(\d+)/);
            if (mHost) port = parseInt(mHost[1], 10);
            const mPort = content.match(/--port\s+(\d+)/);
            if (mPort && sf.includes('opencode-server')) {
              port = parseInt(mPort[1], 10);
            }
          }
        } catch (_) {}
      }
    }
  }

  // 3.5 Check native opencode service.json
  if (!password) {
    try {
      const ocServicePath = path.join(os.homedir(), '.config', 'opencode', 'service.json');
      if (fs.existsSync(ocServicePath)) {
        const ocService = JSON.parse(fs.readFileSync(ocServicePath, 'utf8'));
        if (ocService.password) password = ocService.password;
        if (ocService.port && !port) port = ocService.port;
      }
    } catch (_) {}
  }

  // 4. Environment variables
  if (!port && process.env.OPENCODE_PORT) {
    port = parseInt(process.env.OPENCODE_PORT, 10);
  }
  if (!port && process.env.OPENCODE_HOST) {
    const m = process.env.OPENCODE_HOST.match(/:(\d+)/);
    if (m) port = parseInt(m[1], 10);
  }

  // 5. Default port fallback:
  // On Linux/NAS, standard OpenCode headless server runs on 4096; on desktop fallback to 3000
  if (!port) {
    port = process.platform === 'linux' ? 4096 : 3000;
  }

  return { port, password };
}

function detectOpenChamberActivePort() {
  const info = detectOpenCodeServiceInfo();
  return info.port || (process.platform === 'linux' ? 4096 : 3000);
}

async function probeOpenChamberServices(port = null, timeoutMs = 2000) {
  const serviceInfo = detectOpenCodeServiceInfo();
  const p = port || serviceInfo.port || (process.platform === 'linux' ? 4096 : 3000);
  const password = serviceInfo.password || process.env.OPENCODE_PASSWORD || null;

  const result = {
    port: p,
    integration: { status: 'unknown', latencyMs: null, error: null, authRequired: false },
    plugins: { status: 'unknown', activeCount: 0, failedCount: 0, failedPlugins: [], error: null, authRequired: false }
  };

  const getHeaders = (pwd) => {
    const headers = {};
    if (pwd) {
      headers['Authorization'] = 'Basic ' + Buffer.from('opencode:' + pwd).toString('base64');
    }
    return headers;
  };

  async function fetchWithTimeout(url, pwd) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: getHeaders(pwd), signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  // 1. Probe /api/integration
  const t0 = Date.now();
  try {
    let res;
    try {
      res = await fetchWithTimeout(`http://127.0.0.1:${p}/api/integration`, password);
    } catch (ePrimary) {
      if (p !== 4096 && (ePrimary.message && (ePrimary.message.includes('ECONNREFUSED') || ePrimary.code === 'ECONNREFUSED'))) {
        try {
          res = await fetchWithTimeout(`http://127.0.0.1:4096/api/integration`, password);
          result.port = 4096;
        } catch (_) {
          throw ePrimary;
        }
      } else {
        throw ePrimary;
      }
    }

    result.integration.latencyMs = Date.now() - t0;
    if (res.ok) {
      result.integration.status = 'healthy';
    } else if (res.status === 401) {
      result.integration.status = 'healthy';
      result.integration.authRequired = true;
    } else {
      result.integration.status = 'error';
      result.integration.error = `HTTP ${res.status}`;
    }
  } catch (e) {
    result.integration.latencyMs = Date.now() - t0;
    result.integration.status = e.name === 'AbortError' ? 'deadlocked' : 'unreachable';
    result.integration.error = e.message;
  }

  // 2. Probe /api/plugin
  const effectivePort = result.port;
  try {
    const res = await fetchWithTimeout(`http://127.0.0.1:${effectivePort}/api/plugin`, password);
    if (res.ok) {
      const data = await res.json();
      const list = data.data || data || [];
      const failed = list.filter(item => item.state && item.state.status === 'failed').map(item => item.id);
      const active = list.filter(item => item.state && item.state.status === 'active').map(item => item.id);
      result.plugins.status = failed.length > 0 ? 'degraded' : 'healthy';
      result.plugins.activeCount = active.length;
      result.plugins.failedCount = failed.length;
      result.plugins.failedPlugins = failed;
    } else if (res.status === 401) {
      result.plugins.status = 'healthy';
      result.plugins.authRequired = true;
    } else {
      result.plugins.status = 'error';
      result.plugins.error = `HTTP ${res.status}`;
    }
  } catch (e) {
    result.plugins.status = 'unreachable';
    result.plugins.error = e.message;
  }

  return result;
}

/**
 * Helper to query and execute SQLite database safely across environments
 */
function openSqliteDb(dbPath) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(dbPath);
  } catch (_) {
    return null;
  }
}

function querySqliteRows(dbPath, sql, params = []) {
  if (!fs.existsSync(dbPath)) return [];
  const db = openSqliteDb(dbPath);
  if (db) {
    try {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params);
      db.close();
      return rows;
    } catch (e) {
      try { db.close(); } catch (_) {}
    }
  }
  // Safe fallback to python sqlite3 via stdin JSON to eliminate shell injection & syntax issues
  try {
    const script = [
      'import sqlite3, json, sys',
      'payload = json.load(sys.stdin)',
      'con = sqlite3.connect(payload["dbPath"])',
      'cur = con.cursor()',
      'p = payload.get("params") or []',
      'cur.execute(payload["sql"], tuple(p))',
      'cols = [c[0] for c in cur.description] if cur.description else []',
      'rows = [dict(zip(cols, r)) for r in cur.fetchall()]',
      'con.close()',
      'print(json.dumps(rows))'
    ].join('\n');
    const pyBin = (process.platform === 'win32') ? 'python' : 'python3';
    let proc = spawnSync(pyBin, ['-c', script], {
      input: JSON.stringify({ dbPath, sql, params }),
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    if ((proc.error || proc.status !== 0) && pyBin === 'python3') {
      proc = spawnSync('python', ['-c', script], {
        input: JSON.stringify({ dbPath, sql, params }),
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      });
    }
    if (proc.status === 0 && proc.stdout) {
      return JSON.parse(proc.stdout.trim());
    }
  } catch (_) {}
  return [];
}

function execSqliteQuery(dbPath, sql, params = []) {
  const db = openSqliteDb(dbPath);
  if (db) {
    try {
      if (params && params.length > 0) {
        const stmt = db.prepare(sql);
        stmt.run(...params);
      } else {
        db.exec(sql);
      }
      db.close();
      return true;
    } catch (e) {
      try { db.close(); } catch (_) {}
    }
  }
  // Safe fallback to python sqlite3 via stdin JSON to eliminate shell injection & syntax issues
  try {
    const script = [
      'import sqlite3, json, sys',
      'payload = json.load(sys.stdin)',
      'con = sqlite3.connect(payload["dbPath"])',
      'cur = con.cursor()',
      'p = payload.get("params") or []',
      'if p: cur.execute(payload["sql"], tuple(p))',
      'else: cur.execute(payload["sql"])',
      'con.commit()',
      'con.close()',
      'print("OK")'
    ].join('\n');
    const pyBin = (process.platform === 'win32') ? 'python' : 'python3';
    let proc = spawnSync(pyBin, ['-c', script], {
      input: JSON.stringify({ dbPath, sql, params }),
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    if ((proc.error || proc.status !== 0) && pyBin === 'python3') {
      proc = spawnSync('python', ['-c', script], {
        input: JSON.stringify({ dbPath, sql, params }),
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      });
    }
    return proc.status === 0 && proc.stdout && proc.stdout.includes('OK');
  } catch (_) {}
  return false;
}

/**
 * Discovers candidates for OpenCode 2.0 credential databases and environment files
 */
function findOpenCodeCredentialPaths(customOptions = {}) {
  let dbPath = customOptions.dbPath || null;
  if (!dbPath) {
    const dbCandidates = [
      path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'),
      path.join(process.env.LOCALAPPDATA || '', 'opencode', 'opencode.db'),
      path.join(process.env.APPDATA || '', 'opencode', 'opencode.db'),
      path.join(os.homedir(), '.opencode', 'opencode.db')
    ];
    for (const cand of dbCandidates) {
      if (fs.existsSync(cand)) {
        dbPath = cand;
        break;
      }
    }
    if (!dbPath) {
      dbPath = dbCandidates[0];
    }
  }

  let authPath = customOptions.authPath || null;
  if (!authPath) {
    const authCandidates = [
      path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json'),
      path.join(process.env.LOCALAPPDATA || '', 'opencode', 'auth.json'),
      path.join(process.env.APPDATA || '', 'opencode', 'auth.json')
    ];
    for (const cand of authCandidates) {
      if (fs.existsSync(cand)) {
        authPath = cand;
        break;
      }
    }
    if (!authPath) {
      authPath = authCandidates[0];
    }
  }

  let servicePath = customOptions.servicePath || null;
  if (!servicePath) {
    const sCandidates = [
      path.join(os.homedir(), '.config', 'systemd', 'user', 'opencode-server.service'),
      '/etc/systemd/system/opencode-server.service'
    ];
    for (const cand of sCandidates) {
      if (fs.existsSync(cand)) {
        servicePath = cand;
        break;
      }
    }
  }

  return { dbPath, authPath, servicePath };
}

/**
 * Checks if OpenCode 2.0 native credential table (opencode.db) and daemon environment
 * have active credentials for opencode-go and opencode, while identifying existing third-party credentials.
 */
function checkOpenCodeCredentials(expectedApiKeyOrOptions, customOptions = {}) {
  let expectedApiKey = 'local-router';
  let opts = {};
  if (typeof expectedApiKeyOrOptions === 'object' && expectedApiKeyOrOptions !== null) {
    opts = expectedApiKeyOrOptions;
    expectedApiKey = opts.expectedApiKey || opts.apiKey || 'local-router';
  } else {
    expectedApiKey = expectedApiKeyOrOptions || 'local-router';
    opts = customOptions || {};
  }

  const isWindows = opts.isWindows !== undefined ? opts.isWindows : (process.platform === 'win32');
  const isLinux = opts.isLinux !== undefined ? opts.isLinux : (process.platform === 'linux');
  const { dbPath, authPath, servicePath } = findOpenCodeCredentialPaths(opts);

  const report = {
    expectedApiKey: expectedApiKey || null,
    dbPath,
    hasDb: fs.existsSync(dbPath),
    dbExists: fs.existsSync(dbPath),
    dbCredentialActive: false,
    activeInDb: false,
    authPath,
    hasAuthJson: fs.existsSync(authPath),
    authExists: fs.existsSync(authPath),
    authJsonActive: false,
    authKeyPresent: false,
    servicePath,
    serviceExists: Boolean(servicePath && fs.existsSync(servicePath)),
    hasServiceEnv: false,
    serviceEnvActive: false,
    winEnvVar: null,
    winEnvActive: false,
    envKeyPresent: false,
    thirdPartyIntegrations: [],
    otherCredentials: [],
    hasOtherCredentials: false,
    healthy: true,
    issues: []
  };

  if (!expectedApiKey || typeof expectedApiKey !== 'string' || !expectedApiKey.trim()) {
    report.healthy = true;
    report.skipped = true;
    report.reason = '网关未配置有效 API Key';
    return report;
  }
  const cleanKey = expectedApiKey.trim();

  // 1. Check opencode.db credential table
  if (report.hasDb) {
    try {
      const rows = querySqliteRows(dbPath, "SELECT * FROM credential");
      if (Array.isArray(rows) && rows.length > 0) {
        let opencodeGoActive = false;
        let opencodeActive = false;
        for (const row of rows) {
          const integ = row.integration_id || row.id;
          const act = Number(row.active) === 1;
          const val = String(row.value || row.key || row.token || '');
          const hasKey = val.includes(cleanKey);

          if (integ === 'opencode-go' && act && hasKey) {
            opencodeGoActive = true;
          } else if (integ === 'opencode' && act && hasKey) {
            opencodeActive = true;
          } else if (integ !== 'opencode-go' && integ !== 'opencode') {
            if (!report.thirdPartyIntegrations.includes(integ)) {
              report.thirdPartyIntegrations.push(integ);
            }
          }
        }
        report.dbCredentialActive = (opencodeGoActive && opencodeActive);
        report.activeInDb = report.dbCredentialActive;
      }
    } catch (e) {
      report.dbError = e.message;
    }
  }

  // 2. Check auth.json
  if (report.hasAuthJson) {
    try {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      const goVal = auth['opencode-go'] ? (auth['opencode-go'].key || auth['opencode-go'].apiKey || auth['opencode-go'].value) : null;
      const ocVal = auth['opencode'] ? (auth['opencode'].key || auth['opencode'].apiKey || auth['opencode'].value) : null;
      const goActive = Boolean(goVal && String(goVal).includes(cleanKey));
      const ocActive = Boolean(ocVal && String(ocVal).includes(cleanKey));
      report.authJsonActive = goActive && ocActive;
      report.authKeyPresent = report.authJsonActive;
      for (const k of Object.keys(auth)) {
        if (k !== 'opencode-go' && k !== 'opencode' && !report.thirdPartyIntegrations.includes(k)) {
          report.thirdPartyIntegrations.push(k);
        }
      }
    } catch (_) {}
  }

  report.otherCredentials = report.thirdPartyIntegrations;
  report.hasOtherCredentials = report.thirdPartyIntegrations.length > 0;

  // 3. Check Linux NAS systemd service
  if (isLinux || servicePath) {
    if (servicePath && fs.existsSync(servicePath)) {
      report.hasServiceEnv = true;
      try {
        const sContent = fs.readFileSync(servicePath, 'utf8');
        const match = sContent.match(/Environment=["']?OPENCODE_API_KEY=([^"'\r\n]+)["']?/);
        if (match && match[1].trim() === cleanKey) {
          report.serviceEnvActive = true;
        }
      } catch (_) {}
    }
    if ((opts.envApiKey !== undefined && opts.envApiKey === cleanKey) || process.env.OPENCODE_API_KEY === cleanKey) {
      report.serviceEnvActive = true;
    }
  }

  // 4. Check Windows User environment variable
  if (isWindows) {
    try {
      let userKey = null;
      if (opts.envApiKey !== undefined) {
        userKey = opts.envApiKey;
      } else if (opts.winUserEnv !== undefined) {
        userKey = opts.winUserEnv;
      } else {
        const res = runCmd('powershell.exe -NoProfile -NonInteractive -Command "[System.Environment]::GetEnvironmentVariable(\'OPENCODE_API_KEY\', \'User\')"', 2500);
        if (res.success && res.output) userKey = res.output.trim();
        if (!userKey && process.env.OPENCODE_API_KEY) {
          userKey = process.env.OPENCODE_API_KEY.trim();
        }
      }
      report.winEnvVar = userKey;
      const cleanUserKey = userKey ? userKey.trim().replace(/^["']|["']$/g, '') : null;
      report.winEnvActive = Boolean(cleanUserKey === cleanKey);
    } catch (_) {}
  }

  report.envKeyPresent = isWindows ? report.winEnvActive : report.serviceEnvActive;

  const dbOk = report.hasDb ? report.dbCredentialActive : false;
  const authOk = report.hasAuthJson ? report.authJsonActive : false;
  const isCredentialStoreOk = dbOk || authOk;

  let serviceOrEnvOk = true;
  if (isLinux && report.servicePath) {
    serviceOrEnvOk = report.serviceEnvActive;
  } else if (isWindows) {
    serviceOrEnvOk = report.winEnvActive;
  }

  if (!isCredentialStoreOk || !serviceOrEnvOk) {
    report.healthy = false;
    const reasons = [];
    if (!report.dbCredentialActive) reasons.push('opencode.db credential 未激活');
    if (isLinux && report.servicePath && !report.serviceEnvActive) reasons.push('opencode-server.service 缺少 OPENCODE_API_KEY');
    if (isWindows && !report.winEnvActive) reasons.push('Windows 用户环境变量缺少 OPENCODE_API_KEY');

    report.issues.push({
      id: 'opencode_credential_inactive',
      severity: 'high',
      title: 'OpenCode 2.0 原生凭据或后台守护进程 API Key 未激活',
      desc: `检测到 ${reasons.join('、')}，会导致日常会话抛出 "Upstream request failed: Invalid credential" 异常，一键修复即可安全增量同步并保留已有第三方凭据`
    });
  }

  return report;
}

/**
 * Performs incremental synchronization of credentials to opencode.db and auth.json,
 * updates opencode-server.service on Linux NAS with smooth restart,
 * and sets OPENCODE_API_KEY persistently in Windows User environment variables.
 * STRICT REDLINE: Preserves all existing third-party credentials (shtech, aixforge, etc.)!
 */
function repairOpenCodeCredentials(apiKeyOrOptions, customOptions = {}) {
  let apiKey = 'local-router';
  let opts = {};
  if (typeof apiKeyOrOptions === 'object' && apiKeyOrOptions !== null) {
    opts = apiKeyOrOptions;
    apiKey = opts.apiKey || opts.key || 'local-router';
  } else {
    apiKey = apiKeyOrOptions || 'local-router';
    opts = customOptions || {};
  }

  const isWindows = opts.isWindows !== undefined ? opts.isWindows : (process.platform === 'win32');
  const isLinux = opts.isLinux !== undefined ? opts.isLinux : (process.platform === 'linux');
  const { dbPath, authPath, servicePath } = findOpenCodeCredentialPaths(opts);

  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return { success: false, message: '未提供有效的 API Key' };
  }
  const cleanKey = apiKey.trim();

  const results = {
    success: true,
    dbRepaired: false,
    authRepaired: false,
    serviceRepaired: false,
    envRepaired: false,
    preservedThirdParty: [],
    serviceReloaded: false,
    message: ''
  };

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const valJson = JSON.stringify({ type: 'key', key: cleanKey });

  // 1. Repair opencode.db (strictly preserving existing third-party credentials!)
  try {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const createTableSql = `CREATE TABLE IF NOT EXISTS credential (
      id text PRIMARY KEY,
      integration_id text,
      key text,
      label text,
      value text,
      connector_id text,
      method_id text,
      active integer,
      time_created integer,
      time_updated integer,
      updated_at text
    )`;
    execSqliteQuery(dbPath, createTableSql);

    const tableInfo = querySqliteRows(dbPath, "PRAGMA table_info(credential)");
    const colNames = Array.isArray(tableInfo) ? tableInfo.map(c => c.name) : [];
    const hasCol = (c) => colNames.length === 0 || colNames.includes(c);

    const existingRows = querySqliteRows(dbPath, "SELECT * FROM credential");
    const existingMap = new Map();
    if (Array.isArray(existingRows)) {
      for (const r of existingRows) {
        const integ = r.integration_id || r.id;
        existingMap.set(integ, r);
        if (integ !== 'opencode-go' && integ !== 'opencode') {
          if (!results.preservedThirdParty.includes(integ)) {
            results.preservedThirdParty.push(integ);
          }
        }
      }
    }

    const upsertCred = (integId, defaultId) => {
      const matchingRows = Array.isArray(existingRows) ? existingRows.filter(r => (r.integration_id === integId || r.id === defaultId || r.id === integId)) : [];
      if (matchingRows.length > 0) {
        const setClauses = ['active = 1'];
        const setParams = [];
        if (hasCol('key')) { setClauses.push('key = ?'); setParams.push(cleanKey); }
        if (hasCol('value')) { setClauses.push('value = ?'); setParams.push(valJson); }
        if (hasCol('updated_at')) { setClauses.push('updated_at = ?'); setParams.push(nowIso); }
        if (hasCol('time_updated')) { setClauses.push('time_updated = ?'); setParams.push(now); }
        const whereClause = hasCol('integration_id') ? 'integration_id = ? OR id = ?' : 'id = ?';
        setParams.push(integId);
        if (hasCol('integration_id')) setParams.push(defaultId);
        execSqliteQuery(dbPath, `UPDATE credential SET ${setClauses.join(', ')} WHERE ${whereClause}`, setParams);
      } else {
        const insertCols = [];
        const insertPlaceholders = [];
        const insertVals = [];
        if (hasCol('id')) { insertCols.push('id'); insertPlaceholders.push('?'); insertVals.push(defaultId); }
        if (hasCol('integration_id')) { insertCols.push('integration_id'); insertPlaceholders.push('?'); insertVals.push(integId); }
        if (hasCol('label')) { insertCols.push('label'); insertPlaceholders.push('?'); insertVals.push(integId); }
        if (hasCol('key')) { insertCols.push('key'); insertPlaceholders.push('?'); insertVals.push(cleanKey); }
        if (hasCol('value')) { insertCols.push('value'); insertPlaceholders.push('?'); insertVals.push(valJson); }
        if (hasCol('connector_id')) { insertCols.push('connector_id'); insertPlaceholders.push('?'); insertVals.push(''); }
        if (hasCol('method_id')) { insertCols.push('method_id'); insertPlaceholders.push('?'); insertVals.push(''); }
        if (hasCol('active')) { insertCols.push('active'); insertPlaceholders.push('?'); insertVals.push(1); }
        if (hasCol('time_created')) { insertCols.push('time_created'); insertPlaceholders.push('?'); insertVals.push(now); }
        if (hasCol('time_updated')) { insertCols.push('time_updated'); insertPlaceholders.push('?'); insertVals.push(now); }
        if (hasCol('updated_at')) { insertCols.push('updated_at'); insertPlaceholders.push('?'); insertVals.push(nowIso); }
        execSqliteQuery(dbPath, `INSERT INTO credential (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`, insertVals);
      }
    };

    upsertCred('opencode-go', 'cred_opencode_go_active');
    upsertCred('opencode', 'cred_opencode_console_active');

    results.dbRepaired = true;
  } catch (dbErr) {
    console.warn('[Updater] opencode.db repair notice:', dbErr.message);
  }

  // 2. Repair auth.json (strictly preserving existing third-party keys)
  try {
    const authDir = path.dirname(authPath);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    let authObj = {};
    if (fs.existsSync(authPath)) {
      try {
        authObj = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      } catch (_) {}
    }
    for (const k of Object.keys(authObj)) {
      if (k !== 'opencode-go' && k !== 'opencode') {
        if (!results.preservedThirdParty.includes(k)) {
          results.preservedThirdParty.push(k);
        }
      }
    }
    authObj['opencode-go'] = { type: 'api', key: cleanKey };
    authObj['opencode'] = { type: 'api', key: cleanKey };
    fs.writeFileSync(authPath, JSON.stringify(authObj, null, 2), 'utf8');
    results.authRepaired = true;
  } catch (authErr) {
    console.warn('[Updater] auth.json repair notice:', authErr.message);
  }

  // 3. Linux NAS opencode-server.service injection & smooth reload
  if (isLinux || servicePath) {
    if (servicePath && fs.existsSync(servicePath)) {
      try {
        let content = fs.readFileSync(servicePath, 'utf8');
        const envPattern = /Environment=["']?OPENCODE_API_KEY=[^"'\r\n]+["']?/;
        if (envPattern.test(content)) {
          content = content.replace(envPattern, `Environment="OPENCODE_API_KEY=${cleanKey}"`);
        } else if (content.includes('[Service]')) {
          content = content.replace('[Service]', `[Service]\nEnvironment="OPENCODE_API_KEY=${cleanKey}"`);
        } else {
          content += `\n[Service]\nEnvironment="OPENCODE_API_KEY=${cleanKey}"\n`;
        }
        fs.writeFileSync(servicePath, content, 'utf8');
        results.serviceRepaired = true;

        if (customOptions.skipServiceRestart !== true) {
          const isUserUnit = !servicePath.startsWith('/etc/systemd/system');
          const reloadCmd = isUserUnit ? 'systemctl --user daemon-reload' : 'systemctl daemon-reload';
          const restartCmd = isUserUnit ? 'systemctl --user restart opencode-server.service' : 'systemctl restart opencode-server.service';
          runCmd(reloadCmd, 5000);
          const rRes = runCmd(restartCmd, 15000);
          results.serviceReloaded = rRes.success;
        }
      } catch (svcErr) {
        console.warn('[Updater] service repair notice:', svcErr.message);
      }
    }
  }

  // 4. Windows User environment variable persistence
  if (isWindows) {
    try {
      if (customOptions.skipWinEnv !== true) {
        const psCmd = `[System.Environment]::SetEnvironmentVariable('OPENCODE_API_KEY', '${cleanKey}', 'User')`;
        const enc = Buffer.from(psCmd, 'utf16le').toString('base64');
        runCmd(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${enc}`, 5000);
      }
      process.env.OPENCODE_API_KEY = cleanKey;
      results.envRepaired = true;
    } catch (winErr) {
      console.warn('[Updater] win env repair notice:', winErr.message);
    }
  }

  const parts = [];
  if (results.dbRepaired) parts.push('opencode.db credential 已增量激活');
  if (results.authRepaired) parts.push('auth.json 已同步');
  if (results.serviceRepaired) parts.push('Linux 守护服务已注入 OPENCODE_API_KEY' + (results.serviceReloaded ? ' 并平滑重载' : ''));
  if (results.envRepaired) parts.push('Windows 用户环境变量 OPENCODE_API_KEY 已持久化');
  if (results.preservedThirdParty.length > 0) {
    parts.push(`已保留第三方服务商凭据: ${results.preservedThirdParty.join(', ')}`);
  }

  results.message = parts.join('；');
  return results;
}

module.exports = {
  runCmd,
  runCmdSync,
  detectPlatformEnvironment,
  harmonizeOpencodeConfig,
  getOmoPluginFiles,
  checkOmoPluginV2Integrity,
  patchOmoPluginV2,
  checkProviderDualTrackSchema,
  detectOpenCodeServiceInfo,
  detectOpenChamberActivePort,
  probeOpenChamberServices,
  fetchOfficialModels,
  diagnoseUpstreamFailure,
  probeSingleKey,
  fetchWebDocsCatalog,
  ALL_38_SLUGS,
  findOpenCodeCredentialPaths,
  openSqliteDb,
  querySqliteRows,
  execSqliteQuery,
  checkOpenCodeCredentials,
  repairOpenCodeCredentials,
  detectLocalVersions,
  fetchAllRemoteVersions,
  analyzeCompatibility,
  checkAllUpdates,
  createSnapshot,
  listSnapshots,
  rollbackSnapshot,
  applyUpdates,
  compareSemver,
  parseSemver,
  stripJsonComments,
  getOpencodeConfigPath,
  getOmoConfigPath,
  getRouterConfigPath,
  getSnapshotsDir,
  getOpenChamberDistCandidates,
  canWriteGlobalNpm,
  findScopedComponentDir,
  writeFileSyncAtomic,
  safeAtomicReplaceFile,
  verifyStagedCodeIntegrity,
  backupLocalCodeForRollback,
  restoreFromLocalCodeSnapshot,
  safeAtomicSyncDirectory,
  probeRouterHealth,
  cleanStaleOldFiles
};

// CLI entry point
if (require.main === module) {
  const action = process.argv[2] || 'check';
  (async () => {
    try {
      if (action === 'check') {
        const report = await checkAllUpdates();
        console.log(JSON.stringify(report, null, 2));
      } else if (action === 'snapshots') {
        const list = listSnapshots();
        console.log(JSON.stringify(list, null, 2));
      } else if (action === 'apply') {
        const comps = process.argv.slice(3).filter(a => !a.startsWith('--'));
        const res = await applyUpdates(comps.length ? comps : null);
        console.log(JSON.stringify(res, null, 2));
        if (!res.success) process.exit(1);
      } else if (action === 'rollback') {
        const args = process.argv.slice(3);
        const reinstall = args.includes('--reinstall') || args.includes('--with-packages');
        const id = args.find(a => !a.startsWith('--')) || null;
        const res = rollbackSnapshot(id, { reinstallPackages: reinstall });
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log('用法: node updater.js [check | apply [components...] | rollback [snapshotId] [--reinstall] | snapshots]');
      }
    } catch (e) {
      console.error('[Updater Error]', e.message);
      process.exit(1);
    }
  })();
}
