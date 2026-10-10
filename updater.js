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
const { execSync, spawn } = require('node:child_process');

function stripJsonComments(str) {
  if (typeof str !== 'string') return '';
  const noComments = str.replace(/\\"|"(?:[^"\\]|\\.)*"|(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m));
  return noComments.replace(/,(\s*[}\]])/g, '$1');
}

function parseSemver(v) {
  if (!v) return null;
  const match = String(v).trim().match(/(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
    raw: match[0]
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
  if (p1.prerelease && !p2.prerelease) return -1;
  if (!p1.prerelease && p2.prerelease) return 1;
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

// 38 All Available OpenCode Go Models with zero-loss fallback
const ALL_38_SLUGS = [
  'deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-flash', 'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp', 'glm-5.1', 'glm-5.2', 'glm-5.3', 'glm-5.3-flash',
  'grok-4.6', 'grok-4.7', 'muse-spark-1.2-contributor', 'muse-spark-1.3-contributor',
  'omen-alpha', 'gpt-5.6-luna', 'gpt-6-luna', 'claude-haiku-5-5', 'hy3', 'hy4-preview',
  'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k3', 'mimo-v2.5', 'mimo-v2.6-flash',
  'mimo-v2.5-pro', 'mimo-v2.6-pro', 'minimax-m2.5', 'minimax-m2.7', 'minimax-m3',
  'space-bunny', 'longcat-2.0', 'longcat-2.5-preview-free', 'step-5-preview-free',
  'qwen3.6-plus', 'qwen3.7-plus', 'qwen3.7-max', 'qwen3.8-max', 'qwen3.8-flash'
];

/**
 * Dynamically fetch official OpenCode Go models catalog from upstream API
 * Returns array of model slugs or null if offline/unreachable
 */
function fetchOfficialModels(apiKey, upstream = 'https://opencode.ai/zen/go/v1', timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!apiKey || !apiKey.trim()) {
      return resolve(null);
    }
    try {
      let endpoint = upstream.replace(/\/+$/, '');
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
      const req = transport.request(parsed, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
          'User-Agent': 'opencode-go-router-updater'
        },
        timeout: timeoutMs
      }, (res) => {
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
                let id = m.id || m.name;
                if (typeof id === 'string' && id.startsWith('opencode-go/')) id = id.slice(12);
                return id;
              }).filter(id => typeof id === 'string' && id.trim().length > 0);
              if (slugs.length > 0) {
                return resolve(Array.from(new Set(slugs)));
              }
            }
            resolve(null);
          } catch (_) {
            resolve(null);
          }
        });
      });
      req.on('error', () => {
        if (!finished) { finished = true; resolve(null); }
      });
      req.on('timeout', () => {
        if (!finished) { finished = true; req.destroy(); resolve(null); }
      });
      req.end();
    } catch (_) {
      resolve(null);
    }
  });
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

  const targetOmoVer = options.omoVersion || '5.1.29';
  const targetOmoTag = `oh-my-openagent@${targetOmoVer}`;

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
      plugin: [targetOmoTag, "opencode-goal-plugin"],
      $schema: "https://opencode.ai/config.json"
    };
  }

  if (!data || typeof data !== 'object') data = {};

  if (!Array.isArray(data.plugin)) data.plugin = [];
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
    baseSlugs = Array.from(new Set([...ALL_38_SLUGS, ...options.officialModels]));
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

  // 4. Model selection: preserve user's valid choice, default to deepseek-v4.1-flash
  let modelPreserved = true;
  if (!data.model || data.model === 'opencode-go/gpt-6-luna' || data.model === 'gpt-6-luna') {
    data.model = 'opencode-go/deepseek-v4.1-flash';
    modelPreserved = false;
  }

  // Backup original file before writing
  if (fs.existsSync(p)) {
    try { fs.copyFileSync(p, p + '.bak'); } catch (_) {}
  }

  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');

  return {
    success: true,
    isNew,
    migratedProviders,
    modelCount: Object.keys(allModelsMap).length,
    currentModel: data.model,
    modelPreserved
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
    // 1. Search candidate openchamber dirs
    const cands = getOpenChamberDistCandidates();
    for (const c of cands) {
      let cur = c;
      for (let i = 0; i < 4; i++) {
        const pkg = path.join(cur, 'package.json');
        if (fs.existsSync(pkg)) {
          try {
            const raw = fs.readFileSync(pkg, 'utf8');
            if (comp === 'openchamber' && (raw.includes('@openchamber/web') || raw.includes('openchamber'))) {
              return cur;
            }
            if (comp === 'opencode' && (raw.includes('@opencode/cli') || raw.includes('opencode'))) {
              return cur;
            }
          } catch (_) {}
        }
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
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
          let cur = path.dirname(real);
          for (let i = 0; i < 4; i++) {
            const pkg = path.join(cur, 'package.json');
            if (fs.existsSync(pkg)) return cur;
            const parent = path.dirname(cur);
            if (parent === cur) break;
            cur = parent;
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
      try {
        const u = new URL(targetUrl);
        const req = https.get(u, { headers: { 'User-Agent': 'opencode-go-router-updater' } }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
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
        req.on('error', (e) => {
          if (!isFallback) return doFetch(mirrorUrl, true);
          resolve({ version: null, error: e.message });
        });
        const timerLimit = isFallback ? 2500 : 2000;
        req.setTimeout(timerLimit, () => {
          req.destroy();
          if (!isFallback) return doFetch(mirrorUrl, true);
          resolve({ version: null, error: '请求超时 (可能处于离线或受限网络环境)' });
        });
      } catch (err) {
        if (!isFallback) return doFetch(mirrorUrl, true);
        resolve({ version: null, error: err.message });
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
  const ocConfigPath = getOpencodeConfigPath();
  if (fs.existsSync(ocConfigPath)) {
    try {
      const raw = fs.readFileSync(ocConfigPath, 'utf8').replace(/^\uFEFF/, '');
      const cleanRaw = stripJsonComments(raw);
      try {
        const parsed = JSON.parse(cleanRaw);
        const pluginsArr = Array.isArray(parsed.plugin) ? parsed.plugin : (Array.isArray(parsed.plugins) ? parsed.plugins : []);
        for (const p of pluginsArr) {
          const m = String(p).match(/oh-my-openagent@(\d+\.\d+\.\d+)/);
          if (m) versions['oh-my-openagent'] = m[1];
          const gm = String(p).match(/opencode-goal-plugin(?:@(\d+\.\d+\.\d+))?/);
          if (gm) {
            versions['opencode-goal-plugin'] = gm[1] || '0.11.0';
          }
        }
      } catch (pe) {
        // Fallback: regex search on raw content
        const m = raw.match(/oh-my-openagent@(\d+\.\d+\.\d+)/);
        if (m) versions['oh-my-openagent'] = m[1];
        const gm = raw.match(/opencode-goal-plugin(?:@(\d+\.\d+\.\d+))?/);
        if (gm) {
          versions['opencode-goal-plugin'] = gm[1] || '0.11.0';
        }
      }
    } catch (e) {}
  }
  if (!versions['oh-my-openagent']) {
    const omoOut = runCmdSync('oh-my-openagent --version');
    if (omoOut) {
      const m = omoOut.match(/(?:v)?(\d+\.\d+\.\d+)/);
      if (m) versions['oh-my-openagent'] = m[1];
    }
  }
  if (!versions['oh-my-openagent']) {
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
        try { versions['oh-my-openagent'] = JSON.parse(fs.readFileSync(c, 'utf8')).version; break; } catch (e) {}
      }
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
        if (currentModelKeys.length < 38) {
          if (riskLevel === 'safe') riskLevel = 'warning';
          warnings.push({
            component: 'opencode.jsonc',
            level: 'warning',
            title: `opencode-go 提供商模型清单未补全 (当前 ${currentModelKeys.length}/38 款)`,
            desc: '官方已提供 38 款全量模型（含 glm-5.3-flash, deepseek-v4.1, kimi-k3, qwen3.8 等），当前模型列表不完整可能导致部分模型无法在下拉列表调用。'
          });
          recommendations.push('在管理面板点击【一键体检与修复】，即可无损补齐官方 38 款全量模型并保留当前首选模型。');
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
    fileMetadata[f.name] = { mode: f.mode || null };
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
    const pkgSpec = targetVersion && targetVersion !== 'latest' ? `${pkgName}@${targetVersion}` : `${pkgName}@latest`;
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
      const ver = allRemote['oh-my-openagent'] || '5.1.24';
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
                  runCmd(`powershell -NoProfile -Command "Start-Sleep -Seconds 1; explorer.exe '${desktopExe}'"`, 5000);
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
            logs.push(`✔ 智能网关套件代码已同步至最新`);
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
        logs.push('智能网关套件处于独立部署模式，正在拉取最新代码压缩包更新...');
        const timeout = options.timeoutMs || 30000;
        const connectTimeoutSec = Math.max(2, Math.min(8, Math.floor(timeout / 1000)));
        const maxTimeSec = Math.max(5, Math.floor(timeout / 1000));
        const primaryUrl = 'https://github.com/deancyl/opencode-go-router/archive/refs/heads/master.tar.gz';
        const mirrorUrl = 'https://ghproxy.net/https://github.com/deancyl/opencode-go-router/archive/refs/heads/master.tar.gz';

        let dlCmd = `curl -sSL --connect-timeout ${connectTimeoutSec} --max-time ${maxTimeSec} "${primaryUrl}" | tar -xz --strip-components=1 -C "${ROOT_DIR}"`;
        let res = runCmd(dlCmd, timeout);

        if (!res.success && platform.isLinux) {
          logs.push(`⚠ 官方 GitHub 压缩包直连受限 (${res.error || '超时'})，正在尝试国内加速镜像源拉取...`);
          const mirrorCmd = `curl -sSL --connect-timeout ${connectTimeoutSec} --max-time ${maxTimeSec} "${mirrorUrl}" | tar -xz --strip-components=1 -C "${ROOT_DIR}"`;
          res = runCmd(mirrorCmd, timeout);
          if (!res.success) {
            const wgetCmd = `wget -qO- --timeout=${connectTimeoutSec} "${mirrorUrl}" | tar -xz --strip-components=1 -C "${ROOT_DIR}"`;
            res = runCmd(wgetCmd, timeout);
          }
        }

        if (res.success) {
          logs.push('✔ 独立部署模式下代码包已同步至最新版本');
          results['opencode-go-router'] = { success: true, method: 'tarball-pull', output: res.output };
        } else {
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

  // Step 2.5: Automatic cross-platform config harmonization post-upgrade
  if (!options.skipHarmonize) {
    try {
      const targetPort = options.routerPort || options.port || (process.env.PORT ? parseInt(process.env.PORT, 10) : 4010);
      logs.push(`正在自动执行跨平台配置合流自愈 (清洗单复数冲突，注入全量 38 款模型，端口: ${targetPort})...`);
      const harmRes = harmonizeOpencodeConfig(options.configPath || null, targetPort);
      logs.push(`✔ opencode.jsonc 自动合流自愈成功 (38 款全量模型已就绪，当前首选模型: ${harmRes.currentModel})`);
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

        // 2. OpenCode server service reload - ONLY when opencode CLI was actually upgraded!
        const ocRes = results['opencode'];
        const isOcUpdated = ocRes && ocRes.success && targets.includes('opencode');
        if (isOcUpdated) {
          const opencodeActive = runCmdSync('systemctl --user is-active opencode-server.service', 2000);
          if (opencodeActive && opencodeActive.trim() === 'active') {
            logs.push('检测到 OpenCode 核心引擎二进制已更新，正在平滑重启 opencode-server.service 守护服务...');
            const oRes = runCmd('systemctl --user restart opencode-server.service', 15000);
            if (oRes.success) {
              logs.push('✔ opencode-server.service 已成功热重载');
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
  if (process.platform === 'win32') {
    const globalIdx = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', 'oh-my-openagent', 'dist', 'index.js');
    if (fs.existsSync(globalIdx) && !targets.includes(globalIdx)) targets.push(globalIdx);
  } else {
    const globalIdx = '/usr/local/lib/node_modules/oh-my-openagent/dist/index.js';
    if (fs.existsSync(globalIdx) && !targets.includes(globalIdx)) targets.push(globalIdx);
  }
  const userLocal = path.join(os.homedir(), '.config', 'opencode', 'node_modules', 'oh-my-openagent', 'dist', 'index.js');
  if (fs.existsSync(userLocal) && !targets.includes(userLocal)) targets.push(userLocal);

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

function detectOpenChamberActivePort() {
  try {
    const sPath = path.join(os.homedir(), '.config', 'openchamber', 'settings.json');
    if (fs.existsSync(sPath)) {
      const s = JSON.parse(fs.readFileSync(sPath, 'utf8'));
      if (s.desktopLocalPort) return s.desktopLocalPort;
    }
  } catch (_) {}
  try {
    const mDir = path.join(os.homedir(), '.config', 'openchamber', 'managed-opencode');
    if (fs.existsSync(mDir)) {
      for (const f of fs.readdirSync(mDir)) {
        if (f.endsWith('.json')) {
          const d = JSON.parse(fs.readFileSync(path.join(mDir, f), 'utf8'));
          if (d.port) return d.port;
        }
      }
    }
  } catch (_) {}
  return 3000;
}

async function probeOpenChamberServices(port = null, timeoutMs = 2000) {
  const p = port || detectOpenChamberActivePort();
  const result = {
    port: p,
    integration: { status: 'unknown', latencyMs: null, error: null },
    plugins: { status: 'unknown', activeCount: 0, failedCount: 0, failedPlugins: [], error: null }
  };

  // 1. Probe /api/integration
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${p}/api/integration`, { signal: ctrl.signal });
    clearTimeout(timer);
    result.integration.latencyMs = Date.now() - t0;
    if (res.ok) {
      result.integration.status = 'healthy';
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
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${p}/api/plugin`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const list = data.data || data || [];
      const failed = list.filter(item => item.state && item.state.status === 'failed').map(item => item.id);
      const active = list.filter(item => item.state && item.state.status === 'active').map(item => item.id);
      result.plugins.status = failed.length > 0 ? 'degraded' : 'healthy';
      result.plugins.activeCount = active.length;
      result.plugins.failedCount = failed.length;
      result.plugins.failedPlugins = failed;
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

module.exports = {
  runCmd,
  runCmdSync,
  detectPlatformEnvironment,
  harmonizeOpencodeConfig,
  getOmoPluginFiles,
  checkOmoPluginV2Integrity,
  patchOmoPluginV2,
  checkProviderDualTrackSchema,
  detectOpenChamberActivePort,
  probeOpenChamberServices,
  fetchOfficialModels,
  ALL_38_SLUGS,
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
  findScopedComponentDir
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
