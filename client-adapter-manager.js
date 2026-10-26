/**
 * OpenCode Go Multi-Client Adapter Manager (client-adapter-manager.js)
 * 
 * 核心设计目标 (SSOT 单一事实来源)：
 * 1. 统一管理三大独立 Agent 客户端矩阵：
 *    - OpenCode 2.0 CLI (~/.config/opencode/opencode.jsonc)
 *    - OpenChamber 桌面工作台 (preferences.json & settings.json)
 *    - OpenAI Codex CLI / Desktop (~/.codex/config.toml & opencode-go-catalog.json)
 * 2. 模型策略调度器 (modelSourcePolicy)：
 *    - official_docs: 仅使用官网公开文档支持模型 (免受 429 干扰，极致纯净)
 *    - api_probed:    仅使用上游 API 接口动态探测模型 (最新尝鲜)
 *    - hybrid:        混合全集模式 (官网基准 + API 动态感知，默认推荐)
 * 3. 零回归防御红线：
 *    - 100% 保护自定义 Provider (如 aixforge) 与自定义 Agent (如 agent.goal)
 *    - 100% 保护 Codex 桌面正在运行的任务与进程 (只读探测与安全原子写入)
 *    - 尊重各客户端已有模型偏好，未设置时以控制中心指定基准下发
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT_DIR = __dirname;
const ASSETS_OFFICIAL_MODELS_PATH = path.join(ROOT_DIR, 'assets', 'official-models.json');

const MODEL_SOURCE_POLICIES = ['official_docs', 'api_probed', 'hybrid'];
const DEFAULT_POLICY = 'hybrid';
const DEFAULT_MODEL = 'deepseek-v4.1-flash';
const DEFAULT_FAVORITES = ['deepseek-v4.1-flash', 'kimi-k3'];
const DEFAULT_REASONING_EFFORT = 'high';

/**
 * 稳妥解析 JSON (去除注释、尾随逗号与 BOM，保护字符串内部的 http:// 或 https:// URL)
 */
function stripJsonComments(str) {
  if (typeof str !== 'string') return '';
  const noComments = str.replace(/\\"|"(?:[^"\\]|\\.)*"|(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m));
  return noComments.replace(/,(\s*[}\]])/g, '$1');
}

function parseJsonSafe(filePath, defaultVal = {}) {
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    if (!raw.trim()) return defaultVal;
    return JSON.parse(stripJsonComments(raw));
  } catch (_) {
    return defaultVal;
  }
}

/**
 * 原子写入文件 (UTF-8 No-BOM，防止写入中途崩溃)
 */
function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const content = JSON.stringify(data, null, 2);
  const tempPath = filePath + '.tmp.' + Date.now() + '.' + Math.random().toString(36).slice(2, 7);
  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (err) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
}

/**
 * 1. 加载官网公开模型基准元数据字典 (official-models.json)
 */
function loadOfficialModels() {
  if (fs.existsSync(ASSETS_OFFICIAL_MODELS_PATH)) {
    try {
      const raw = fs.readFileSync(ASSETS_OFFICIAL_MODELS_PATH, 'utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.models) && parsed.models.length > 0) {
        return parsed.models;
      }
    } catch (e) {
      console.warn(`[ClientAdapterManager] 加载 official-models.json 异常: ${e.message}`);
    }
  }

  // 兜底：从 codex-adapter 静态字典导出
  try {
    const codex = require('./codex-adapter');
    if (Array.isArray(codex.OPENCODE_GO_ALL_MODELS) && codex.OPENCODE_GO_ALL_MODELS.length > 0) {
      return codex.OPENCODE_GO_ALL_MODELS.map(m => ({
        ...m,
        is_official: true,
        quota_tier: m.quota_tier || 'standard'
      }));
    }
  } catch (_) {}

  return [];
}

/**
 * 2. 模型策略调度器 (根据 policy 过滤模型列表)
 * @param {string} policy 'official_docs' | 'api_probed' | 'hybrid'
 * @param {Object} options { officialModels: Array, probedModels: Array<string|Object> }
 * @returns {Array<Object>} 过滤并装配完成的规范模型元数据数组
 */
function filterModelsByPolicy(policy = DEFAULT_POLICY, options = {}) {
  const normPolicy = MODEL_SOURCE_POLICIES.includes(policy) ? policy : DEFAULT_POLICY;
  const officialModels = Array.isArray(options.officialModels) && options.officialModels.length > 0
    ? options.officialModels
    : loadOfficialModels();

  const officialMap = new Map();
  for (const m of officialModels) {
    officialMap.set(m.slug, m);
  }

  const rawProbed = Array.isArray(options.probedModels) ? options.probedModels : [];
  const probedSlugs = rawProbed.map(item => {
    if (typeof item === 'string') return item.trim();
    if (item && typeof item === 'object') return (item.slug || item.id || item.name || '').trim();
    return '';
  }).filter(Boolean);

  // Strategy A: official_docs (仅使用官网公开模型，过滤所有未在文档列出的动态/测试模型)
  if (normPolicy === 'official_docs') {
    return officialModels.map(m => ({ ...m, source: 'official_docs' })).sort((a, b) => (b.priority || 500) - (a.priority || 500));
  }

  // Strategy B: api_probed (仅信任上游 API 实际返回的可用模型)
  if (normPolicy === 'api_probed') {
    if (probedSlugs.length > 0) {
      const result = [];
      const seen = new Set();
      for (const slug of probedSlugs) {
        if (seen.has(slug)) continue;
        seen.add(slug);
        if (officialMap.has(slug)) {
          result.push({ ...officialMap.get(slug), source: 'api_probed' });
        } else {
          // 上游返回了新模型，动态包装元数据
          result.push({
            slug,
            name: slug.toUpperCase(),
            display_name: slug.toUpperCase(),
            vendor: 'OpenCode Go',
            description: `OpenCode Go ${slug} 上游动态探测模型`,
            context_window: 1048576,
            max_context_window: 1048576,
            effective_context_window_percent: 95,
            default_reasoning_level: 'medium',
            supported_reasoning_levels: [
              { effort: 'low', description: '极速轻量思考' },
              { effort: 'medium', description: '常规均衡思考' },
              { effort: 'high', description: '深度思考' },
              { effort: 'xhigh', description: '极限深度推演' }
            ],
            supports_parallel_tool_calls: true,
            input_modalities: ['text'],
            quota_tier: 'standard',
            is_official: false,
            source: 'api_probed',
            priority: 600
          });
        }
      }
      return result.sort((a, b) => (b.priority || 500) - (a.priority || 500));
    }
    // API 探测不可用（如断网/429/无Key），降级回退至官网基准并标记 fallback
    return officialModels.map(m => ({ ...m, source: 'official_docs', fallback: true })).sort((a, b) => (b.priority || 500) - (a.priority || 500));
  }

  // Strategy C: hybrid (默认推荐：以官网基准为核心，动态追加 API 探测到的新模型)
  const combined = new Map();
  // 1. 先注入官网基准模型
  for (const m of officialModels) {
    const isProbed = probedSlugs.includes(m.slug);
    combined.set(m.slug, { ...m, source: isProbed ? 'api_probed' : 'official_docs' });
  }
  // 2. 追加 API 探测到的新模型
  for (const slug of probedSlugs) {
    if (!combined.has(slug)) {
      combined.set(slug, {
        slug,
        name: slug.toUpperCase(),
        display_name: slug.toUpperCase(),
        vendor: 'OpenCode Go',
        description: `OpenCode Go ${slug} 动态感知模型`,
        context_window: 1048576,
        max_context_window: 1048576,
        effective_context_window_percent: 95,
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [
          { effort: 'low', description: '极速轻量思考' },
          { effort: 'medium', description: '常规均衡思考' },
          { effort: 'high', description: '深度思考' },
          { effort: 'xhigh', description: '极限深度推演' }
        ],
        supports_parallel_tool_calls: true,
        input_modalities: ['text'],
        quota_tier: 'standard',
        is_official: false,
        source: 'api_probed',
        priority: 600
      });
    }
  }

  return Array.from(combined.values()).sort((a, b) => (b.priority || 500) - (a.priority || 500));
}

/**
 * 3. 客户端状态探测 (检测三大客户端安装与配置就绪状态)
 * 带 10s 内存级防抖缓存 (Rule 7 Anti-Throttling)，避免 execSync 高频阻塞
 */
let clientStatusCache = null;
let lastClientStatusTime = 0;
const CLIENT_STATUS_TTL_MS = 10000;

function invalidateClientStatusCache() {
  clientStatusCache = null;
  lastClientStatusTime = 0;
}

function getClientStatus(options = {}) {
  const routerPort = options.routerPort || 4010;
  const now = Date.now();
  if (options.force !== true && clientStatusCache && (now - lastClientStatusTime < CLIENT_STATUS_TTL_MS) && clientStatusCache._port === routerPort) {
    const cached = { ...clientStatusCache };
    delete cached._port;
    return cached;
  }
  const homeDir = os.homedir();

  // 3.1 OpenCode 2.0 CLI
  const opencodeDir = options.opencodeConfigDir || process.env.OPENCODE_CONFIG_DIR || path.join(homeDir, '.config', 'opencode');
  let opencodePath = path.join(opencodeDir, 'opencode.jsonc');
  if (!fs.existsSync(opencodePath) && fs.existsSync(path.join(opencodeDir, 'opencode.json'))) {
    opencodePath = path.join(opencodeDir, 'opencode.json');
  }
  const opencodeStatus = {
    detected: false,
    configPath: opencodePath,
    isBound: false,
    currentModel: null,
    modelCount: 0,
    customProviders: [],
    hasNativeAgents: false,
    hasMasterMcp: false
  };

  if (fs.existsSync(opencodePath)) {
    opencodeStatus.detected = true;
    try {
      const ocData = parseJsonSafe(opencodePath, {});
      if (ocData.provider && ocData.provider['opencode-go']) {
        const og = ocData.provider['opencode-go'];
        const baseURL = og.options?.baseURL || og.settings?.baseURL || '';
        opencodeStatus.isBound = baseURL.includes(String(routerPort));
        if (og.models && typeof og.models === 'object') {
          opencodeStatus.modelCount = Object.keys(og.models).length;
        }
      }
      opencodeStatus.currentModel = ocData.model || null;
      if (ocData.provider && typeof ocData.provider === 'object') {
        opencodeStatus.customProviders = Object.keys(ocData.provider).filter(k => k !== 'opencode-go');
      }
      if (ocData.agent && ocData.agent.goal && ocData.agent['goal-verify']) {
        opencodeStatus.hasNativeAgents = true;
      }
      if (ocData.mcp && ocData.mcp['opencode-router']) {
        opencodeStatus.hasMasterMcp = true;
      }
    } catch (_) {}
  }

  // 3.2 OpenChamber 桌面端
  const chamberDirs = [];
  if (options.openchamberDir && fs.existsSync(options.openchamberDir)) {
    chamberDirs.push(options.openchamberDir);
  }
  if (process.env.OPENCHAMBER_DATA_DIR && fs.existsSync(process.env.OPENCHAMBER_DATA_DIR)) {
    chamberDirs.push(process.env.OPENCHAMBER_DATA_DIR);
  }
  const stdChamberDir = path.join(homeDir, '.config', 'openchamber');
  if (!chamberDirs.includes(stdChamberDir) && fs.existsSync(stdChamberDir)) {
    chamberDirs.push(stdChamberDir);
  }

  const openchamberStatus = {
    detected: chamberDirs.length > 0 || fs.existsSync(stdChamberDir),
    targetDirs: chamberDirs.length > 0 ? chamberDirs : [stdChamberDir],
    favoriteModels: [],
    recentModels: [],
    isBound: false
  };

  for (const cDir of openchamberStatus.targetDirs) {
    const prefPath = path.join(cDir, 'preferences.json');
    if (fs.existsSync(prefPath)) {
      try {
        const pref = parseJsonSafe(prefPath, {});
        const favs = (Array.isArray(pref?.fields?.favoriteModels?.value) ? pref.fields.favoriteModels.value : []).filter(f => f && typeof f === 'object');
        const recents = (Array.isArray(pref?.fields?.recentModels?.value) ? pref.fields.recentModels.value : []).filter(r => r && typeof r === 'object');
        openchamberStatus.favoriteModels = favs.map(f => `${f.providerID}/${f.modelID}`);
        openchamberStatus.recentModels = recents.map(r => `${r.providerID}/${r.modelID}`);
        if (favs.some(f => f.providerID === 'opencode-go')) {
          openchamberStatus.isBound = true;
        }
        break;
      } catch (_) {}
    }
  }

  // 3.3 OpenAI Codex CLI / Desktop
  let codexStatus = {
    detected: false,
    configPath: path.join(homeDir, '.codex', 'config.toml'),
    isBound: false,
    currentModel: null,
    currentReasoningEffort: null,
    hasStreamIdleTimeout: false,
    hasMasterMcp: false,
    processHealth: { runningProcesses: 0, healthy: true }
  };

  try {
    const codex = require('./codex-adapter');
    const fullCodexStatus = codex.getCodexStatus ? codex.getCodexStatus(routerPort) : null;
    if (fullCodexStatus) {
      codexStatus = {
        detected: fullCodexStatus.cliInstalled || fullCodexStatus.hasConfig,
        configPath: fullCodexStatus.configPath,
        isBound: fullCodexStatus.isBound,
        currentModel: fullCodexStatus.currentModel,
        currentReasoningEffort: fullCodexStatus.currentReasoningEffort,
        hasStreamIdleTimeout: fullCodexStatus.hasStreamIdleTimeout,
        hasMasterMcp: Boolean(fullCodexStatus.hasMasterMcp),
        processHealth: fullCodexStatus.processHealth || { runningProcesses: 0, healthy: true }
      };
    }
  } catch (_) {}

  opencodeStatus.exists = opencodeStatus.detected;
  opencodeStatus.configured = opencodeStatus.isBound;

  openchamberStatus.exists = openchamberStatus.detected;
  openchamberStatus.configured = openchamberStatus.isBound;

  codexStatus.exists = codexStatus.detected;
  codexStatus.configured = codexStatus.isBound;

  const resObj = {
    routerPort,
    opencode: opencodeStatus,
    openchamber: openchamberStatus,
    codex: codexStatus
  };

  clientStatusCache = { ...resObj, _port: routerPort };
  lastClientStatusTime = now;

  return resObj;
}

/**
 * 4. 规范同步 OpenCode 2.0 配置 (~/.config/opencode/opencode.jsonc)
 * 100% 保护自定义 Provider (如 aixforge) 与自定义 Agent (如 agent.goal)
 */
function syncOpencodeConfig(options = {}) {
  const routerPort = options.routerPort || 4010;
  const opencodeDir = options.targetPath ? path.dirname(options.targetPath) : (process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode'));
  let configPath = options.targetPath;
  if (!configPath) {
    const jsoncPath = path.join(opencodeDir, 'opencode.jsonc');
    const jsonPath = path.join(opencodeDir, 'opencode.json');
    configPath = (!fs.existsSync(jsoncPath) && fs.existsSync(jsonPath)) ? jsonPath : jsoncPath;
  }
  const policy = options.policy || DEFAULT_POLICY;
  const models = (Array.isArray(options.models) && options.models.length > 0)
    ? options.models
    : filterModelsByPolicy(policy, options);
  const defaultModelSlug = options.defaultModel || DEFAULT_MODEL;

  const messages = [];
  if (!fs.existsSync(opencodeDir)) {
    fs.mkdirSync(opencodeDir, { recursive: true });
  }

  // 利用 updater.harmonizeOpencodeConfig 的核心清洗保护机制，同时精确注入策略过滤后的模型清单
  const updater = require('./updater');
  const officialSlugs = models.map(m => m.slug);
  const preferredModelStr = `opencode-go/${defaultModelSlug}`;

  const harmRes = updater.harmonizeOpencodeConfig(configPath, routerPort, {
    officialModels: officialSlugs,
    preferredModel: options.preserveChoice === false ? preferredModelStr : undefined,
    defaultModel: defaultModelSlug,
    strictModels: policy === 'api_probed'
  });

  messages.push(`✔ OpenCode 2.0 配置已成功同步 (共 ${harmRes.modelCount} 款模型，首选模型: ${harmRes.currentModel})`);
  return {
    success: harmRes.success,
    configPath,
    modelCount: harmRes.modelCount,
    currentModel: harmRes.currentModel,
    messages
  };
}

/**
 * 5. 规范同步 OpenChamber 桌面端配置 (preferences.json & settings.json)
 * 双轨兼容，注入首选与置顶收藏夹 (favoriteModels & recentModels)
 */
function syncOpenChamberConfig(options = {}) {
  const policy = options.policy || DEFAULT_POLICY;
  const models = (Array.isArray(options.models) && options.models.length > 0)
    ? options.models
    : filterModelsByPolicy(policy, options);
  const defaultModelSlug = options.defaultModel || DEFAULT_MODEL;
  const favorites = Array.isArray(options.favorites) && options.favorites.length > 0 ? options.favorites : DEFAULT_FAVORITES;
  const homeDir = os.homedir();

  const chamberDirs = [];
  if (options.targetDirs && Array.isArray(options.targetDirs)) {
    chamberDirs.push(...options.targetDirs);
  } else {
    if (process.env.OPENCHAMBER_DATA_DIR && fs.existsSync(process.env.OPENCHAMBER_DATA_DIR)) {
      chamberDirs.push(process.env.OPENCHAMBER_DATA_DIR);
    }
    const stdChamberDir = path.join(homeDir, '.config', 'openchamber');
    chamberDirs.push(stdChamberDir);
  }

  const messages = [];
  let updatedAny = false;

  for (const cDir of chamberDirs) {
    if (!fs.existsSync(cDir)) {
      try { fs.mkdirSync(cDir, { recursive: true }); } catch (_) {}
    }

    // 5.1 更新 preferences.json
    const prefPath = path.join(cDir, 'preferences.json');
    let pref = parseJsonSafe(prefPath, { version: 1, fields: {} });
    if (!pref || typeof pref !== 'object') pref = { version: 1, fields: {} };
    if (!pref.fields || typeof pref.fields !== 'object') pref.fields = {};

    const rawRecents = Array.isArray(pref.fields.recentModels?.value) ? pref.fields.recentModels.value : [];
    const existingRecents = rawRecents.filter(m => m && typeof m === 'object' && m.modelID);
    let topRecents = [];
    if (options.preserveChoice !== false && existingRecents.length > 0) {
      // 尊重用户已有活跃选择：保持第一位不变，将默认模型与收藏追加至其后
      const activeFirst = existingRecents[0];
      const otherRecents = existingRecents.slice(1).filter(m => !(m.providerID === 'opencode-go' && (m.modelID === defaultModelSlug || favorites.includes(m.modelID))));
      const newItems = [
        { providerID: 'opencode-go', modelID: defaultModelSlug },
        ...favorites.filter(f => f !== defaultModelSlug).map(f => ({ providerID: 'opencode-go', modelID: f }))
      ].filter(item => !(item.providerID === activeFirst.providerID && item.modelID === activeFirst.modelID));
      topRecents = [activeFirst, ...newItems, ...otherRecents];
    } else {
      const filteredRecents = existingRecents.filter(m => !(m.providerID === 'opencode-go' && (m.modelID === defaultModelSlug || favorites.includes(m.modelID))));
      topRecents = [
        { providerID: 'opencode-go', modelID: defaultModelSlug },
        ...favorites.filter(f => f !== defaultModelSlug).map(f => ({ providerID: 'opencode-go', modelID: f })),
        ...filteredRecents
      ];
    }

    pref.fields.recentModels = {
      updatedAt: Date.now(),
      value: topRecents
    };

    const rawFavs = Array.isArray(pref.fields.favoriteModels?.value) ? pref.fields.favoriteModels.value : [];
    const existingFavs = rawFavs.filter(m => m && typeof m === 'object' && m.modelID);
    const mergedFavs = [...existingFavs];
    for (const favSlug of [defaultModelSlug, ...favorites]) {
      if (!mergedFavs.some(m => m.providerID === 'opencode-go' && m.modelID === favSlug)) {
        mergedFavs.unshift({ providerID: 'opencode-go', modelID: favSlug });
      }
    }
    pref.fields.favoriteModels = {
      updatedAt: Date.now(),
      value: mergedFavs
    };

    writeJsonAtomic(prefPath, pref);

    // 5.2 更新 settings.json (若存在，双轨兼容新旧桌面版)
    const setPath = path.join(cDir, 'settings.json');
    if (fs.existsSync(setPath)) {
      try {
        let settings = parseJsonSafe(setPath, {});
        if (!settings || typeof settings !== 'object') settings = {};
        const rawSRecents = Array.isArray(settings.recentModels) ? settings.recentModels : [];
        const sRecents = rawSRecents.filter(m => m && typeof m === 'object' && m.modelID);
        let sTopRecents = [];
        if (options.preserveChoice !== false && sRecents.length > 0) {
          const sActiveFirst = sRecents[0];
          const sOther = sRecents.slice(1).filter(m => !(m.providerID === 'opencode-go' && (m.modelID === defaultModelSlug || favorites.includes(m.modelID))));
          const sNewItems = [
            { providerID: 'opencode-go', modelID: defaultModelSlug },
            ...favorites.filter(f => f !== defaultModelSlug).map(f => ({ providerID: 'opencode-go', modelID: f }))
          ].filter(item => !(item.providerID === sActiveFirst.providerID && item.modelID === sActiveFirst.modelID));
          sTopRecents = [sActiveFirst, ...sNewItems, ...sOther];
        } else {
          const sFiltered = sRecents.filter(m => !(m.providerID === 'opencode-go' && (m.modelID === defaultModelSlug || favorites.includes(m.modelID))));
          sTopRecents = [
            { providerID: 'opencode-go', modelID: defaultModelSlug },
            ...favorites.filter(f => f !== defaultModelSlug).map(f => ({ providerID: 'opencode-go', modelID: f })),
            ...sFiltered
          ];
        }
        settings.recentModels = sTopRecents;

        const rawSFavs = Array.isArray(settings.favoriteModels) ? settings.favoriteModels : [];
        const sFavs = rawSFavs.filter(m => m && typeof m === 'object' && m.modelID);
        const sMergedFavs = [...sFavs];
        for (const favSlug of [defaultModelSlug, ...favorites]) {
          if (!sMergedFavs.some(m => m.providerID === 'opencode-go' && m.modelID === favSlug)) {
            sMergedFavs.unshift({ providerID: 'opencode-go', modelID: favSlug });
          }
        }
        settings.favoriteModels = sMergedFavs;
        writeJsonAtomic(setPath, settings);
      } catch (_) {}
    }

    updatedAny = true;
    messages.push(`✔ OpenChamber 工作区配置已更新 (${cDir}): 首选 ${defaultModelSlug}`);
  }

  return {
    success: updatedAny,
    targetDirs: chamberDirs,
    defaultModel: defaultModelSlug,
    messages
  };
}

/**
 * 6. 规范同步 OpenAI Codex 配置 (opencode-go-catalog.json & config.toml)
 * 绝不杀死、重启或干扰正在运行的 Codex 桌面任务与进程！
 */
function syncCodexConfig(options = {}) {
  const routerPort = options.routerPort || 4010;
  const policy = options.policy || DEFAULT_POLICY;
  const models = (Array.isArray(options.models) && options.models.length > 0)
    ? options.models
    : filterModelsByPolicy(policy, options);
  const defaultModelSlug = options.defaultModel || DEFAULT_MODEL;
  const effort = options.reasoningEffort || DEFAULT_REASONING_EFFORT;
  const codexDir = options.codexDir || path.join(os.homedir(), '.codex');

  const codex = require('./codex-adapter');

  // 调用 codex-adapter.bindCodexConfig，传入策略过滤后的 models 与 preserveChoice
  const bindRes = codex.bindCodexConfig({
    routerPort,
    defaultModel: defaultModelSlug,
    reasoningEffort: effort,
    codexDir,
    models,
    preserveChoice: options.preserveChoice
  });

  return {
    success: bindRes.success,
    codexDir,
    defaultModel: defaultModelSlug,
    reasoningEffort: effort,
    modelCount: models.length,
    messages: bindRes.messages || []
  };
}

/**
 * 7. 全端一键原子同步 (统一多端模型获取策略与配置下发)
 */
function syncAllClients(options = {}) {
  const policy = options.policy || DEFAULT_POLICY;
  const routerPort = options.routerPort || 4010;
  const defaultModel = options.defaultModel || DEFAULT_MODEL;
  const favorites = options.favorites || DEFAULT_FAVORITES;
  const reasoningEffort = options.reasoningEffort || DEFAULT_REASONING_EFFORT;
  const targetClients = Array.isArray(options.clients) ? options.clients : ['opencode', 'openchamber', 'codex'];

  // 1. 获取根据策略过滤后的模型清单
  const filteredModels = filterModelsByPolicy(policy, {
    officialModels: options.officialModels,
    probedModels: options.probedModels
  });

  const results = {
    success: true,
    policy,
    modelsCount: filteredModels.length,
    defaultModel,
    opencode: null,
    openchamber: null,
    codex: null,
    messages: []
  };

  // 2. 依次同步目标客户端
  if (targetClients.includes('opencode')) {
    try {
      const ocRes = syncOpencodeConfig({
        routerPort,
        models: filteredModels,
        defaultModel,
        targetPath: options.opencodeConfigPath,
        preserveChoice: options.preserveChoice
      });
      results.opencode = ocRes;
      results.messages.push(...ocRes.messages);
    } catch (err) {
      results.opencode = { success: false, error: err.message };
      results.messages.push(`⚠ OpenCode 同步失败: ${err.message}`);
    }
  }

  if (targetClients.includes('openchamber')) {
    try {
      const ocRes = syncOpenChamberConfig({
        models: filteredModels,
        defaultModel,
        favorites,
        targetDirs: options.openchamberDirs,
        preserveChoice: options.preserveChoice
      });
      results.openchamber = ocRes;
      results.messages.push(...ocRes.messages);
    } catch (err) {
      results.openchamber = { success: false, error: err.message };
      results.messages.push(`⚠ OpenChamber 同步失败: ${err.message}`);
    }
  }

  if (targetClients.includes('codex')) {
    try {
      const codexRes = syncCodexConfig({
        routerPort,
        models: filteredModels,
        defaultModel,
        reasoningEffort,
        codexDir: options.codexDir,
        dryRun: options.dryRun,
        preserveChoice: options.preserveChoice
      });
      results.codex = codexRes;
      results.messages.push(...codexRes.messages);
    } catch (err) {
      results.codex = { success: false, error: err.message };
      results.messages.push(`⚠ OpenAI Codex 同步失败: ${err.message}`);
    }
  }

  invalidateClientStatusCache();
  return results;
}

/**
 * 6. 插件智能体与客户端作用域同步协调器
 */
function syncPluginScopes(pluginId, scopes = {}, options = {}) {
  const routerPort = options.routerPort || 4010;
  const targetClients = [];
  const messages = [];

  if (scopes.opencode) targetClients.push('opencode');
  if (scopes.openchamber) targetClients.push('openchamber');
  if (scopes.codex) targetClients.push('codex');

  // 若为 OMO 插件且启用了 OpenCode，自动触发 OpenCode v2 运行时包装器与死锁自愈
  if (pluginId === 'omo' && scopes.opencode) {
    try {
      const updater = require('./updater');
      const patchRes = updater.patchOmoPluginV2();
      if (patchRes && patchRes.success) {
        messages.push('已为 OpenCode 同步 OMO v2 兼容包装器与智能体环境');
      }
    } catch (_) {}
  }

  // 确保已激活客户端出站挂载 Master-MCP 统一工具总线
  if (scopes.codex) {
    try {
      const codex = require('./codex-adapter');
      const st = codex.getCodexStatus(routerPort);
      if (st && st.missingMasterMcp) {
        codex.repairCodexLocaleAndEnvironment();
        messages.push('已为 OpenAI Codex 挂载 Master-MCP 统一工具总线 (mcp-master.js)');
      }
    } catch (_) {}
  }

  if (scopes.opencode) {
    try {
      const updater = require('./updater');
      const ocPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc');
      if (fs.existsSync(ocPath)) {
        const raw = fs.readFileSync(ocPath, 'utf8');
        if (!raw.includes('opencode-router') || !raw.includes('mcp-master.js')) {
          updater.harmonizeOpencodeConfig(ocPath, routerPort);
          messages.push('已为 OpenCode 2.0 挂载 Master-MCP 统一工具总线 (mcp-master.js)');
        }
      }
    } catch (_) {}
  }

  // 刷新客户端状态缓存，使前端毫秒级感知
  try {
    invalidateClientStatusCache();
  } catch (_) {}

  return {
    success: true,
    pluginId,
    targetClients,
    messages,
    syncedAt: Date.now()
  };
}

// 支持 CLI 直接调用
if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0] || 'status';

  if (action === 'status') {
    const status = getClientStatus();
    console.log(JSON.stringify(status, null, 2));
    process.exit(0);
  }

  if (action === 'sync') {
    let policy = DEFAULT_POLICY;
    for (const a of args) {
      if (a.startsWith('--policy=')) policy = a.slice(9);
    }
    const res = syncAllClients({ policy });
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.success ? 0 : 1);
  }
}

module.exports = {
  MODEL_SOURCE_POLICIES,
  DEFAULT_POLICY,
  DEFAULT_MODEL,
  DEFAULT_FAVORITES,
  DEFAULT_REASONING_EFFORT,
  loadOfficialModels,
  filterModelsByPolicy,
  getClientStatus,
  invalidateClientStatusCache,
  syncOpencodeConfig,
  syncOpenChamberConfig,
  syncCodexConfig,
  syncAllClients,
  syncPluginScopes,
  parseJsonSafe,
  stripJsonComments
};
