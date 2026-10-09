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
    candidates.push(
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
      path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', 'oh-my-openagent', 'package.json'),
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'oh-my-openagent', 'package.json'),
      '/usr/local/lib/node_modules/oh-my-openagent/package.json'
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
      path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', 'opencode-goal-plugin', 'package.json'),
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-goal-plugin', 'package.json'),
      '/usr/local/lib/node_modules/opencode-goal-plugin/package.json'
    ];
    for (const c of goalPkgCandidates) {
      if (fs.existsSync(c)) {
        try { versions['opencode-goal-plugin'] = JSON.parse(fs.readFileSync(c, 'utf8')).version; break; } catch (e) {}
      }
    }
  }

  // 5. OpenChamber
  let chamberOut = runCmdSync('openchamber --version');
  if (chamberOut) {
    const m = chamberOut.match(/(?:v)?(\d+\.\d+\.\d+)/);
    if (m) versions['openchamber'] = m[1];
  }
  if (!versions['openchamber']) {
    const chamberCandidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', '@openchamberelectron', 'resources', 'web-dist', 'package.json'),
      path.join(os.homedir(), '.bun', 'install', 'global', 'node_modules', '@openchamber', 'web', 'package.json'),
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openchamber', 'web', 'package.json'),
      '/vol3/1000/docker/openchamber/web/dist/package.json'
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

      // A. Check for provider vs providers single/plural conflict
      let hasSingular = false;
      let hasPlural = false;
      if (parsed) {
        hasSingular = Boolean(parsed.provider && parsed.provider['opencode-go']);
        hasPlural = Boolean(parsed.providers && parsed.providers['opencode-go']);
      } else {
        hasSingular = /"provider"\s*:\s*\{[^}]*"opencode-go"/.test(raw);
        hasPlural = /"providers"\s*:\s*\{[^}]*"opencode-go"/.test(raw);
      }
      if (hasSingular && hasPlural) {
        isBreaking = true;
        riskLevel = 'critical';
        warnings.push({
          component: 'opencode.jsonc',
          level: 'critical',
          title: 'opencode.jsonc 存在 provider 与 providers 单复数配置冲突',
          desc: 'OpenCode 2.0+ 采用单数 provider 规范。单复数同名配置将触发 conflict 导致启动时丢弃本地 4010 智能网关回退直连，进而引发 ConnectionRefused！'
        });
        recommendations.push('可在 doctor-repair.ps1 或体检修复 API 中自动清洗冲突项，规范化为单一标准 provider 配置。');
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
          const res = runCmd(`bash "${patchSh}" -i`, 10000);
          restoredItems.push({ action: 'reapply_office_patch', status: res.success ? 'success' : 'failed' });
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
    snapshot = createSnapshot('一键安全更新前自动灾备快照');
  }

  const logs = [];
  const results = {};
  let overallSuccess = true;

  // Step 2: Perform component upgrades
  for (const comp of targets) {
    if (comp === 'opencode') {
      const ver = allRemote['opencode'] || 'latest';
      let cmd = pm === 'bun' ? `bun add -g --trust @opencode/cli@latest` : `npm install -g @opencode/cli@latest`;
      logs.push(`正在升级 OpenCode CLI: ${cmd}...`);
      let res = runCmd(cmd, 120000);
      if (!res.success && pm === 'bun') {
        const fallbackCmd = `npm install -g @opencode/cli@latest`;
        logs.push(`bun 升级环境受限，正在自动回退至 npm 安全升级: ${fallbackCmd}...`);
        res = runCmd(fallbackCmd, 120000);
      }
      if (res.success) {
        // Windows binary synchronization & cleanup
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
        results['opencode'] = { success: true, command: cmd, output: res.output, targetVersion: ver };
      } else {
        overallSuccess = false;
        logs.push(`❌ OpenCode CLI 升级失败: ${res.error}`);
        results['opencode'] = { success: false, command: cmd, error: res.error, targetVersion: ver };
      }
    } else if (comp === 'oh-my-openagent') {
      const ver = allRemote['oh-my-openagent'] || '5.1.24';
      const cmd = pm === 'bun' ? `bun add -g oh-my-openagent@latest` : `npm install -g oh-my-openagent@latest`;
      logs.push(`正在升级 Oh My OpenAgent: ${cmd}...`);
      let res = runCmd(cmd, 60000);
      if (!res.success && pm === 'bun') {
        const fallbackCmd = `npm install -g oh-my-openagent@latest`;
        logs.push(`bun 升级环境受限，正在回退至 npm 升级: ${fallbackCmd}...`);
        res = runCmd(fallbackCmd, 120000);
      }
      if (res.success) {
        logs.push(`✔ Oh My OpenAgent 升级成功`);
        // Synchronize opencode.jsonc plugin list to new version
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
        results['oh-my-openagent'] = { success: true, command: cmd, output: res.output, targetVersion: ver };
      } else {
        overallSuccess = false;
        logs.push(`❌ Oh My OpenAgent 升级失败: ${res.error}`);
        results['oh-my-openagent'] = { success: false, command: cmd, error: res.error, targetVersion: ver };
      }
    } else if (comp === 'opencode-goal-plugin') {
      const ver = allRemote['opencode-goal-plugin'] || '0.11.0';
      const cmd = pm === 'bun' ? `bun add -g opencode-goal-plugin@latest` : `npm install -g opencode-goal-plugin@latest`;
      logs.push(`正在升级 Goal 目标推进插件: ${cmd}...`);
      let res = runCmd(cmd, 60000);
      if (!res.success && pm === 'bun') {
        const fallbackCmd = `npm install -g opencode-goal-plugin@latest`;
        logs.push(`bun 升级环境受限，正在回退至 npm 升级: ${fallbackCmd}...`);
        res = runCmd(fallbackCmd, 120000);
      }
      if (res.success) {
        logs.push(`✔ Goal 目标推进插件升级成功`);
        results['opencode-goal-plugin'] = { success: true, command: cmd, output: res.output, targetVersion: ver };
      } else {
        overallSuccess = false;
        logs.push(`❌ Goal 插件升级失败: ${res.error}`);
        results['opencode-goal-plugin'] = { success: false, command: cmd, error: res.error, targetVersion: ver };
      }
    } else if (comp === 'openchamber') {
      const ver = allRemote['openchamber'] || 'latest';
      const cmd = pm === 'bun' ? `bun add -g @openchamber/web@latest` : `npm install -g @openchamber/web@latest`;
      logs.push(`正在升级 OpenChamber: ${cmd}...`);
      let res = runCmd(cmd, 60000);
      if (!res.success && pm === 'bun') {
        const fallbackCmd = `npm install -g @openchamber/web@latest`;
        logs.push(`bun 升级环境受限，正在回退至 npm 升级: ${fallbackCmd}...`);
        res = runCmd(fallbackCmd, 120000);
      }
      if (res.success) {
        logs.push(`✔ OpenChamber 升级成功`);
        // Post-upgrade critical hook: Re-mount Air-Gapped Office Preview Engine!
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
              const pRes = runCmd(`bash "${patchSh}" -i`, 15000);
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
        results['openchamber'] = { success: true, command: cmd, output: res.output, targetVersion: ver };
      } else {
        overallSuccess = false;
        logs.push(`❌ OpenChamber 升级失败: ${res.error}`);
        results['openchamber'] = { success: false, command: cmd, error: res.error, targetVersion: ver };
      }
    } else if (comp === 'opencode-go-router') {
      if (fs.existsSync(path.join(ROOT_DIR, '.git'))) {
        logs.push('正在检查智能网关套件代码更新...');
        const statusRes = runCmd('git status --porcelain', 5000);
        if (statusRes.success && statusRes.output) {
          logs.push('⚠ 检测到本地工作区存在未提交修改，已略过自动 git pull 以保护现有改动');
          results['opencode-go-router'] = { success: true, method: 'preserved-dirty-tree', message: '检测到未提交改动，已安全保护' };
        } else {
          logs.push('正在通过 git pull --rebase 更新智能网关套件代码...');
          const res = runCmd('git pull --rebase', 20000);
          if (res.success) {
            logs.push(`✔ 智能网关套件代码已同步至最新`);
            results['opencode-go-router'] = { success: true, method: 'git-pull', output: res.output };
          } else {
            overallSuccess = false;
            logs.push(`❌ git pull 失败: ${res.error}`);
            results['opencode-go-router'] = { success: false, method: 'git-pull', error: res.error };
          }
        }
      } else {
        logs.push('智能网关套件处于独立部署模式，无需 git pull');
        results['opencode-go-router'] = { success: true, method: 'standalone' };
      }
    }
  }

  // Step 3: Re-detect versions post-upgrade
  const newVersions = detectLocalVersions();

  return {
    success: overallSuccess,
    snapshotId: snapshot ? snapshot.id : null,
    logs,
    results,
    newVersions
  };
}

// Export module functions
module.exports = {
  runCmd,
  runCmdSync,
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
  getOpenChamberDistCandidates
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
