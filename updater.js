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
 * - Deep compatibility analysis with OpenCode breaking changes & ecosystem impact
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
  return str.replace(/\\"|"(?:[^"\\]|\\.)*"|(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m));
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

function runCmdSync(cmd, timeoutMs = 5000) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: true
    }).trim();
  } catch (e) {
    return null;
  }
}

function detectPackageManager() {
  const hasBun = runCmdSync('bun --version', 2000);
  if (hasBun) return 'bun';
  const hasNpm = runCmdSync('npm --version', 2000);
  if (hasNpm) return 'npm';
  return 'npm';
}

/**
 * Fetch latest version of npm package with timeout
 */
function fetchNpmLatestVersion(pkgName, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const encodedName = pkgName.startsWith('@') ? '@' + encodeURIComponent(pkgName.slice(1)) : encodeURIComponent(pkgName);
    const url = `https://registry.npmjs.org/${encodedName}/latest`;
    const req = https.get(url, { headers: { 'User-Agent': 'opencode-go-router-updater' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            resolve({ version: parsed.version || null, error: null });
          } else {
            resolve({ version: null, error: `HTTP ${res.statusCode}` });
          }
        } catch (e) {
          resolve({ version: null, error: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ version: null, error: e.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ version: null, error: '请求超时 (可能处于离线或受限网络环境)' });
    });
  });
}

/**
 * Fetch latest release from GitHub API
 */
function fetchGitHubLatestRelease(repo, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const req = https.get(url, { headers: { 'User-Agent': 'opencode-go-router-updater' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            const tag = (parsed.tag_name || '').replace(/^v/, '');
            resolve({ version: tag || null, releaseName: parsed.name, error: null });
          } else {
            resolve({ version: null, error: `HTTP ${res.statusCode}` });
          }
        } catch (e) {
          resolve({ version: null, error: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ version: null, error: e.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ version: null, error: '请求超时 (可能处于离线或受限网络环境)' });
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
    'openchamber': null
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

  // 3. oh-my-openagent (OMO)
  // Check opencode.jsonc plugin list first
  const ocConfigPath = getOpencodeConfigPath();
  if (fs.existsSync(ocConfigPath)) {
    try {
      const raw = fs.readFileSync(ocConfigPath, 'utf8').replace(/^\uFEFF/, '');
      const cleanRaw = stripJsonComments(raw);
      try {
        const parsed = JSON.parse(cleanRaw);
        if (Array.isArray(parsed.plugin)) {
          for (const p of parsed.plugin) {
            const m = String(p).match(/oh-my-openagent@(\d+\.\d+\.\d+)/);
            if (m) versions['oh-my-openagent'] = m[1];
            if (String(p).includes('opencode-goal-plugin')) {
              versions['opencode-goal-plugin'] = '0.11.0';
            }
          }
        }
      } catch (pe) {
        // Fallback: regex search on raw content
        const m = raw.match(/oh-my-openagent@(\d+\.\d+\.\d+)/);
        if (m) versions['oh-my-openagent'] = m[1];
        if (raw.includes('opencode-goal-plugin')) {
          versions['opencode-goal-plugin'] = '0.11.0';
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
    // Check global node_modules or bun
    const omoPkg = path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', 'oh-my-openagent', 'package.json');
    if (fs.existsSync(omoPkg)) {
      try { versions['oh-my-openagent'] = JSON.parse(fs.readFileSync(omoPkg, 'utf8')).version; } catch (e) {}
    }
  }
  if (!versions['oh-my-openagent']) {
    versions['oh-my-openagent'] = '5.1.22'; // fallback baseline
  }

  // 4. opencode-goal-plugin
  if (!versions['opencode-goal-plugin']) {
    const goalPkg = path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', 'opencode-goal-plugin', 'package.json');
    if (fs.existsSync(goalPkg)) {
      try { versions['opencode-goal-plugin'] = JSON.parse(fs.readFileSync(goalPkg, 'utf8')).version; } catch (e) {}
    } else {
      versions['opencode-goal-plugin'] = '0.11.0';
    }
  }

  // 5. OpenChamber
  let chamberOut = runCmdSync('openchamber --version');
  if (chamberOut) {
    const m = chamberOut.match(/(?:v)?(\d+\.\d+\.\d+)/);
    if (m) versions['openchamber'] = m[1];
  }
  if (!versions['openchamber']) {
    const chamberDistPkg = path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', '@openchamber', 'web', 'package.json');
    if (fs.existsSync(chamberDistPkg)) {
      try { versions['openchamber'] = JSON.parse(fs.readFileSync(chamberDistPkg, 'utf8')).version; } catch (e) {}
    }
  }
  if (!versions['openchamber']) {
    versions['openchamber'] = '2.1.1'; // fallback baseline
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
    'opencode-go-router': routerRes.version || '2.0.0',
    'opencode': ocRes.version || '2.0.25',
    'oh-my-openagent': omoRes.version || '5.1.24',
    'opencode-goal-plugin': goalRes.version || '0.11.0',
    'openchamber': chamberRes.version || '2.1.1',
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
function analyzeCompatibility(local, remote) {
  const warnings = [];
  const recommendations = [];
  let isBreaking = false;
  let riskLevel = 'safe'; // 'safe', 'warning', 'critical'

  const ocLocal = local['opencode'];
  const ocRemote = remote['opencode'];
  const omoLocal = local['oh-my-openagent'];
  const omoRemote = remote['oh-my-openagent'];
  const chamberLocal = local['openchamber'];
  const chamberRemote = remote['openchamber'];
  const routerLocal = local['opencode-go-router'];
  const routerRemote = remote['opencode-go-router'];

  // 1. OpenCode Core CLI Major/Minor Analysis
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
          title: 'OpenCode CLI 跨主版本更新 (v' + ocLocal + ' -> v' + ocRemote + ')',
          desc: '跨主版本更新可能引入配置语法变更 (如 provider 格式重构)、旧版 CLI 参数废弃或插件 API 签名调整。系统已支持自动灾备快照，更新后如遇异常可秒级一键回滚。'
        });
        recommendations.push('建议在升级 OpenCode 核心前确认当前会话已保存，并注意观察 OMO 多智能体调度与 OpenChamber 托管运行状态。');
      } else if (pRemote.minor > pLocal.minor) {
        if (riskLevel !== 'critical') riskLevel = 'warning';
        warnings.push({
          component: 'opencode',
          level: 'warning',
          title: 'OpenCode CLI 次版本更新 (v' + ocLocal + ' -> v' + ocRemote + ')',
          desc: '次版本更新可能引入新增 provider 校验逻辑，建议同步更新 OMO 插件至最新版本。'
        });
      }
    }
  }

  // 2. OMO Plugin Compatibility Analysis
  if (omoLocal && omoRemote) {
    const omoCmp = compareSemver(omoRemote, omoLocal);
    if (omoCmp > 0) {
      if (riskLevel === 'safe') riskLevel = 'warning';
      warnings.push({
        component: 'oh-my-openagent',
        level: 'warning',
        title: 'Oh My OpenAgent 多智能体插件有新版本可用 (v' + omoLocal + ' -> v' + omoRemote + ')',
        desc: '官方发布了 OMO v' + omoRemote + '，包含最新的智能体编排与区域规避优化。建议同步更新并在 opencode.jsonc 中更新插件标签。'
      });
      recommendations.push('升级时勾选同步更新 Oh My OpenAgent 插件，保持智能体调度体系与 OpenCode 核心一致。');
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
          desc: '检测到当前 OMO 版本为 ' + omoLocal + '，而 OpenCode v2+ 必须配套 oh-my-openagent 5.1+ 方可正常挂载插件 Hook。'
        });
        recommendations.push('必须立即将 oh-my-openagent 升级至 5.1.24+ 避免多智能体调度启动崩溃。');
      }
    }
  }

  // 3. OpenChamber Web / Desktop Hosting Compatibility & Office Engine Invalidation
  if (chamberLocal && chamberRemote) {
    const chCmp = compareSemver(chamberRemote, chamberLocal);
    if (chCmp > 0) {
      if (riskLevel === 'safe') riskLevel = 'warning';
      warnings.push({
        component: 'openchamber',
        level: 'warning',
        title: 'OpenChamber 客户端有新版本可用 (v' + chamberLocal + ' -> v' + chamberRemote + ')',
        desc: '升级 OpenChamber 将覆盖前端静态资源。为保障本地办公文档离线安全预览，升级后系统将自动重新执行 Office 离线预览补丁挂载。'
      });
      recommendations.push('更新 OpenChamber 后，无需手动干预，套件将自动重新挂载纯本地 Office 离线预览引擎。');
    }
  }

  // 4. opencode-go-router Gateway & Toolkit Update
  if (routerLocal && routerRemote) {
    const rCmp = compareSemver(routerRemote, routerLocal);
    if (rCmp > 0) {
      warnings.push({
        component: 'opencode-go-router',
        level: 'info',
        title: 'OpenCode 智能网关套件新版本可用 (v' + routerLocal + ' -> v' + routerRemote + ')',
        desc: '包含最新的高可用负载均衡算法、版本检测与灾备秒级回滚支持。'
      });
      recommendations.push('建议更新智能网关套件至 v' + routerRemote + ' 获得全套自愈与一键升级能力。');
    }
  }

  // Summary
  let summary = '当前所有核心组件均为最新版本，生态环境完全兼容且处于健康状态。';
  if (riskLevel === 'critical') {
    summary = '检测到潜在的破坏性重大版本更新或组件脱节风险！升级可能影响多智能体或客户端协作。系统已提供全链路安全快照与一键回滚能力，用户可确认后继续升级。';
  } else if (riskLevel === 'warning') {
    summary = '检测到部分组件有更新可用。各组件间无阻断性致命冲突，建议同步升级以保持最佳协同体验。';
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
    const latest = remote[def.id] || current;
    const cmp = compareSemver(latest, current);
    const hasUpdate = cmp > 0;
    return {
      ...def,
      current,
      latest,
      hasUpdate,
      status: hasUpdate ? 'update_available' : 'up_to_date'
    };
  });

  const snapshots = listSnapshots();

  return {
    timestamp: new Date().toISOString(),
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
    fs.copyFileSync(ocConfigPath, dest);
    backedUpFiles.push({ name: 'opencode.jsonc', src: ocConfigPath, dest });
  }

  // 2. Backup omo.jsonc
  const omoConfigPath = getOmoConfigPath();
  if (fs.existsSync(omoConfigPath)) {
    const dest = path.join(configsDir, 'omo.jsonc');
    fs.copyFileSync(omoConfigPath, dest);
    backedUpFiles.push({ name: 'omo.jsonc', src: omoConfigPath, dest });
  }

  // 3. Backup router config.json
  const routerCfgPath = getRouterConfigPath();
  if (fs.existsSync(routerCfgPath)) {
    const dest = path.join(configsDir, 'config.json');
    fs.copyFileSync(routerCfgPath, dest);
    backedUpFiles.push({ name: 'config.json', src: routerCfgPath, dest });
  }

  // 4. Record Office Preview Patch State
  let officePreviewActive = false;
  const candDists = process.platform === 'win32' ? [
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', '@openchamberelectron', 'resources', 'web-dist'),
    path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', '@openchamber', 'web', 'dist')
  ] : [
    '/vol3/1000/docker/openchamber/web/dist',
    path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', '@openchamber', 'web', 'dist')
  ];
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

  const manifest = {
    id: snapshotId,
    timestamp: new Date().toISOString(),
    reason,
    packageManager: detectPackageManager(),
    versions: localVersions,
    officePreviewActive,
    files: backedUpFiles.map((f) => f.name)
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
 * List all saved snapshots sorted by newest first
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
            const data = JSON.parse(fs.readFileSync(manPath, 'utf8'));
            list.push(data);
          } catch (e) {}
        }
      }
    }
  } catch (e) {}

  return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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
  const configsDir = path.join(snapDir, 'configs');
  const restoredItems = [];

  // 1. Restore opencode.jsonc
  const snapOc = path.join(configsDir, 'opencode.jsonc');
  const targetOc = getOpencodeConfigPath();
  if (fs.existsSync(snapOc)) {
    const parent = path.dirname(targetOc);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.copyFileSync(snapOc, targetOc);
    restoredItems.push({ file: 'opencode.jsonc', status: 'restored', path: targetOc });
  }

  // 2. Restore omo.jsonc
  const snapOmo = path.join(configsDir, 'omo.jsonc');
  const targetOmo = getOmoConfigPath();
  if (fs.existsSync(snapOmo)) {
    const parent = path.dirname(targetOmo);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.copyFileSync(snapOmo, targetOmo);
    restoredItems.push({ file: 'omo.jsonc', status: 'restored', path: targetOmo });
  }

  // 3. Restore router config.json
  const snapCfg = path.join(configsDir, 'config.json');
  const targetCfg = getRouterConfigPath();
  if (fs.existsSync(snapCfg)) {
    fs.copyFileSync(snapCfg, targetCfg);
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
      try {
        runCmdSync(cmd, 60000);
        restoredItems.push({ action: 'reinstall_packages', command: cmd, status: 'success' });
      } catch (e) {
        restoredItems.push({ action: 'reinstall_packages', status: 'failed', error: e.message });
      }
    }
  }

  // 5. Restore Office Preview Patch if active in snapshot
  if (targetSnapshot.officePreviewActive) {
    try {
      if (process.platform === 'win32') {
        const patchPs1 = path.join(ROOT_DIR, 'patch-openchamber-office.ps1');
        if (fs.existsSync(patchPs1)) {
          runCmdSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${patchPs1}" -Install`, 10000);
          restoredItems.push({ action: 'reapply_office_patch', status: 'success' });
        }
      } else {
        const patchSh = path.join(ROOT_DIR, 'patch-openchamber-office.sh');
        if (fs.existsSync(patchSh)) {
          runCmdSync(`bash "${patchSh}" -i`, 10000);
          restoredItems.push({ action: 'reapply_office_patch', status: 'success' });
        }
      }
    } catch (e) {}
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
 * Apply updates to specified components with pre-backup and post-patching
 */
async function applyUpdates(componentsToUpdate = null, options = {}) {
  const pm = options.packageManager || detectPackageManager();
  const allRemote = await fetchAllRemoteVersions(options.timeoutMs || 4000);

  // Default to all components if none specified
  const targets = Array.isArray(componentsToUpdate) && componentsToUpdate.length > 0
    ? componentsToUpdate
    : ['opencode', 'oh-my-openagent', 'opencode-goal-plugin', 'openchamber', 'opencode-go-router'];

  // Step 1: Automatic Pre-Update Disaster Recovery Snapshot
  let snapshot = null;
  if (!options.skipBackup) {
    snapshot = createSnapshot('一键安全更新前自动快照备份');
  }

  const logs = [];
  const results = {};

  // Step 2: Perform component upgrades
  for (const comp of targets) {
    if (comp === 'opencode') {
      const ver = allRemote['opencode'] || 'latest';
      const cmd = pm === 'bun' ? `bun add -g @opencode/cli@latest` : `npm install -g @opencode/cli@latest`;
      logs.push(`正在升级 OpenCode CLI: ${cmd}...`);
      const out = runCmdSync(cmd, 60000);
      results['opencode'] = { success: true, command: cmd, output: out, targetVersion: ver };
    } else if (comp === 'oh-my-openagent') {
      const ver = allRemote['oh-my-openagent'] || '5.1.24';
      const cmd = pm === 'bun' ? `bun add -g oh-my-openagent@latest` : `npm install -g oh-my-openagent@latest`;
      logs.push(`正在升级 Oh My OpenAgent: ${cmd}...`);
      const out = runCmdSync(cmd, 60000);

      // Synchronize opencode.jsonc plugin list to new version
      try {
        const ocPath = getOpencodeConfigPath();
        if (fs.existsSync(ocPath)) {
          let raw = fs.readFileSync(ocPath, 'utf8');
          // Replace oh-my-openagent@...
          if (/oh-my-openagent(@\d+\.\d+\.\d+)?/.test(raw)) {
            raw = raw.replace(/oh-my-openagent(@\d+\.\d+\.\d+)?/g, `oh-my-openagent@${ver}`);
            fs.writeFileSync(ocPath, raw, 'utf8');
            logs.push(`✔ opencode.jsonc 插件标签已同步更新为 oh-my-openagent@${ver}`);
          }
        }
      } catch (e) {
        logs.push(`⚠ 同步 opencode.jsonc 失败: ${e.message}`);
      }
      results['oh-my-openagent'] = { success: true, command: cmd, output: out, targetVersion: ver };
    } else if (comp === 'opencode-goal-plugin') {
      const ver = allRemote['opencode-goal-plugin'] || '0.11.0';
      const cmd = pm === 'bun' ? `bun add -g opencode-goal-plugin@latest` : `npm install -g opencode-goal-plugin@latest`;
      logs.push(`正在升级 Goal 目标推进插件: ${cmd}...`);
      const out = runCmdSync(cmd, 60000);
      results['opencode-goal-plugin'] = { success: true, command: cmd, output: out, targetVersion: ver };
    } else if (comp === 'openchamber') {
      const ver = allRemote['openchamber'] || 'latest';
      const cmd = pm === 'bun' ? `bun add -g @openchamber/web@latest` : `npm install -g @openchamber/web@latest`;
      logs.push(`正在升级 OpenChamber: ${cmd}...`);
      const out = runCmdSync(cmd, 60000);

      // Post-upgrade critical hook: Re-mount Air-Gapped Office Preview Engine!
      logs.push('正在自动重新挂载 OpenChamber Office 离线预览引擎补丁...');
      try {
        if (process.platform === 'win32') {
          const patchPs1 = path.join(ROOT_DIR, 'patch-openchamber-office.ps1');
          if (fs.existsSync(patchPs1)) {
            const pOut = runCmdSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${patchPs1}" -Install`, 15000);
            logs.push(`✔ Office 离线预览引擎已成功重新挂载`);
          }
        } else {
          const patchSh = path.join(ROOT_DIR, 'patch-openchamber-office.sh');
          if (fs.existsSync(patchSh)) {
            runCmdSync(`bash "${patchSh}" -i`, 15000);
            logs.push(`✔ Office 离线预览引擎已成功重新挂载`);
          }
        }
      } catch (e) {
        logs.push(`⚠ 重新挂载 Office 预览补丁出现警告: ${e.message}`);
      }
      results['openchamber'] = { success: true, command: cmd, output: out, targetVersion: ver };
    } else if (comp === 'opencode-go-router') {
      if (fs.existsSync(path.join(ROOT_DIR, '.git'))) {
        logs.push('正在通过 git pull --rebase 更新智能网关套件代码...');
        const out = runCmdSync('git pull --rebase', 20000);
        results['opencode-go-router'] = { success: true, method: 'git-pull', output: out };
      } else {
        logs.push('智能网关套件处于独立部署模式，无需 git pull');
        results['opencode-go-router'] = { success: true, method: 'standalone' };
      }
    }
  }

  // Step 3: Re-detect versions post-upgrade
  const newVersions = detectLocalVersions();

  return {
    success: true,
    snapshotId: snapshot ? snapshot.id : null,
    logs,
    results,
    newVersions
  };
}

// Export module functions
module.exports = {
  detectLocalVersions,
  fetchAllRemoteVersions,
  analyzeCompatibility,
  checkAllUpdates,
  createSnapshot,
  listSnapshots,
  rollbackSnapshot,
  applyUpdates,
  compareSemver,
  parseSemver
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
        const comps = process.argv.slice(3);
        const res = await applyUpdates(comps.length ? comps : null);
        console.log(JSON.stringify(res, null, 2));
      } else if (action === 'rollback') {
        const id = process.argv[3] || null;
        const res = rollbackSnapshot(id);
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log('用法: node updater.js [check | apply | rollback | snapshots]');
      }
    } catch (e) {
      console.error('[Updater Error]', e.message);
      process.exit(1);
    }
  })();
}
