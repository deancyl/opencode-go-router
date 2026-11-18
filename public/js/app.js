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

  if (tabId === 'clients') {
    if (typeof loadModelsHubData === 'function') {
      loadModelsHubData(false);
    }
  }
  if (tabId === 'plugins') {
    if (typeof checkOmoPluginStatus === 'function') {
      checkOmoPluginStatus(false);
    }
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

const MAX_CHART_RING_BUFFER = 60;
function sanitizeTimeSeries(rawSeries) {
  if (!Array.isArray(rawSeries)) return [];
  const sorted = rawSeries.slice().sort((a, b) => {
    const tA = (a && a.time) ? new Date(a.time).getTime() : 0;
    const tB = (b && b.time) ? new Date(b.time).getTime() : 0;
    return tA - tB;
  });
  if (sorted.length > MAX_CHART_RING_BUFFER) {
    return sorted.slice(sorted.length - MAX_CHART_RING_BUFFER);
  }
  return sorted;
}

let chartRafId = null;
function scheduleChartRender() {
  if (document.hidden) return;
  if (chartRafId) return;
  chartRafId = requestAnimationFrame(() => {
    chartRafId = null;
    executeChartRender();
  });
}

function renderCompressionTimeSeriesChart(series = [], range = 'all', stats = {}) {
  cachedTimeSeriesData = sanitizeTimeSeries(series);
  cachedTimeSeriesRange = range;
  cachedTimeSeriesStats = stats;
  scheduleChartRender();
}

function executeChartRender() {
  const series = cachedTimeSeriesData;
  const range = cachedTimeSeriesRange;
  const stats = cachedTimeSeriesStats || {};

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
        '<span style="color:#94a3b8;font-weight:500;">理论总输入 (左柱灰)</span>' +
        '<span style="display:inline-block;width:9px;height:9px;background:#f59e0b;border-radius:2px;margin-left:4px;"></span>' +
        '<span style="color:#f59e0b;font-weight:500;">实际发出消耗 (右柱实色)</span>' +
        '<span style="display:inline-block;width:9px;height:9px;background:rgba(56,189,248,0.22);border:1px dashed #38bdf8;border-radius:2px;margin-left:4px;"></span>' +
        '<span style="color:#38bdf8;font-weight:500;">压缩节约 (虚线帽/节约带)</span>' +
        '</div>';
      legendsEl.innerHTML = trackLegend + activeModels.map((m, idx) => {
        const color = getModelColor(m, idx);
        return '<div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;">' +
          '<span style="display:inline-block;width:9px;height:9px;background:' + color + ';border-radius:2px;"></span>' +
          '<span style="font-family:monospace;color:#cbd5e1;" class="truncate-text" title="' + escapeHtml(m) + '">' + escapeHtml(m) + '</span>' +
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
    viewport.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:0.85rem;"><span style="margin-right:6px;">💤</span> 暂无时序数据（发起对话后将实时呈现时序波形）</div>';
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

      // 1) 理论总输入柱 (左柱 - 中性炭灰)
      if (origVal > 0) {
        const origH = Math.max(2, (origVal / maxVal) * chartH);
        const origY = xBaseY - origH;
        contentSvg += '<rect class="chart-bar-rect chart-bar-consumed chart-bar-orig" data-index="' + i + '" x="' + origBarX + '" y="' + origY + '" width="' + barW + '" height="' + origH + '" fill="' + consumedColor + '" opacity="0.85" rx="2" />';
      } else {
        contentSvg += '<rect data-index="' + i + '" x="' + origBarX + '" y="' + (xBaseY - 2) + '" width="' + barW + '" height="2" fill="#27272a" opacity="0.4" rx="1" />';
      }

      // 2) 实际使用柱 + 顶部虚线差额帽 (右柱)
      if (origVal > 0) {
        const modelEntries = Object.entries(pt.byModel || {});
        const color = modelEntries.length === 1 ? getModelColor(modelEntries[0][0], 0) : (modelEntries.length > 1 ? getModelColor(modelEntries[0][0], 0) : '#f59e0b');

        const origH = Math.max(2, (origVal / maxVal) * chartH);
        const cH = cVal > 0 ? Math.max(2, (cVal / maxVal) * chartH) : 0;

        // 右柱实心下半截：实际发出消耗 (cVal)，高度对应实际发出
        if (cH > 0) {
          const cY = xBaseY - cH;
          contentSvg += '<rect class="chart-bar-rect chart-bar-actual" data-index="' + i + '" x="' + actBarX + '" y="' + cY + '" width="' + barW + '" height="' + cH + '" fill="' + color + '" rx="2" ry="2" />';
        }

        // 右柱顶部虚线差额帽：直观提示省下的部分 (sVal)，高度为 diffH
        const diffH = Math.max(0, origH - cH);
        if (sVal > 0 && diffH > 0) {
          const sY = xBaseY - origH;
          contentSvg += '<rect class="chart-bar-rect chart-bar-saved chart-bar-saved-cap" data-index="' + i + '" x="' + actBarX + '" y="' + sY + '" width="' + barW + '" height="' + diffH + '" fill="rgba(56, 189, 248, 0.18)" stroke="#38bdf8" stroke-width="1" stroke-dasharray="2,2" rx="2" ry="2" />';
        }
      } else {
        contentSvg += '<rect data-index="' + i + '" x="' + actBarX + '" y="' + (xBaseY - 2) + '" width="' + barW + '" height="2" fill="#27272a" opacity="0.4" rx="1" />';
      }
    });
  } else {
    const origPoints = series.map((pt, i) => {
      const val = getConsumedVal(pt) + getSavedVal(pt);
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

    const savedPoints = series.map((pt, i) => {
      const val = getSavedVal(pt);
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
        let cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        let cp2y = p2.y - (p3.y - p1.y) / 6;
        // 贝塞尔单调性与下界约束 (Clamp): 控制点 y 绝不能超过基线 xBaseY (杜绝负数下潜穿模)
        if ((p1.val === 0 && p2.val === 0) || (p1.y >= xBaseY && p2.y >= xBaseY)) {
          cp1y = xBaseY;
          cp2y = xBaseY;
        } else {
          cp1y = Math.min(xBaseY, cp1y);
          cp2y = Math.min(xBaseY, cp2y);
        }
        pathD += ' C ' + cp1x.toFixed(1) + ' ' + cp1y.toFixed(1) + ', ' + cp2x.toFixed(1) + ' ' + cp2y.toFixed(1) + ', ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
      }
      return pathD;
    };

    const origPathD = buildSmoothPath(origPoints);
    const consumedPathD = buildSmoothPath(consumedPoints);
    const consumedAreaD = consumedPathD + ' L ' + consumedPoints[consumedPoints.length - 1].x + ' ' + xBaseY + ' L ' + consumedPoints[0].x + ' ' + xBaseY + ' Z';

    // 构造理论上限与实际使用之间的半透明节约带 (高保真平滑贝塞尔对齐)
    const buildSmoothBand = (topPts, btmPts) => {
      if (!topPts || topPts.length === 0 || !btmPts || btmPts.length === 0) return '';
      const len = topPts.length;
      if (len === 1) {
        return 'M ' + (topPts[0].x - 8) + ' ' + topPts[0].y + ' L ' + (topPts[0].x + 8) + ' ' + topPts[0].y +
               ' L ' + (btmPts[0].x + 8) + ' ' + btmPts[0].y + ' L ' + (btmPts[0].x - 8) + ' ' + btmPts[0].y + ' Z';
      }
      let bandD = 'M ' + topPts[0].x + ' ' + topPts[0].y;
      for (let i = 0; i < len - 1; i++) {
        const p0 = i > 0 ? topPts[i - 1] : topPts[i];
        const p1 = topPts[i];
        const p2 = topPts[i + 1];
        const p3 = i < len - 2 ? topPts[i + 2] : p2;
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        let cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        let cp2y = p2.y - (p3.y - p1.y) / 6;
        if ((p1.val === 0 && p2.val === 0) || (p1.y >= xBaseY && p2.y >= xBaseY)) {
          cp1y = xBaseY;
          cp2y = xBaseY;
        } else {
          cp1y = Math.min(xBaseY, cp1y);
          cp2y = Math.min(xBaseY, cp2y);
        }
        bandD += ' C ' + cp1x.toFixed(1) + ' ' + cp1y.toFixed(1) + ', ' + cp2x.toFixed(1) + ' ' + cp2y.toFixed(1) + ', ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
      }
      bandD += ' L ' + btmPts[len - 1].x + ' ' + btmPts[len - 1].y;
      for (let i = len - 2; i >= 0; i--) {
        const p0 = i > 0 ? btmPts[i - 1] : btmPts[i];
        const p1 = btmPts[i];
        const p2 = btmPts[i + 1];
        const p3 = i < len - 2 ? btmPts[i + 2] : p2;
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        let cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        let cp2y = p2.y - (p3.y - p1.y) / 6;
        if ((p1.val === 0 && p2.val === 0) || (p1.y >= xBaseY && p2.y >= xBaseY)) {
          cp1y = xBaseY;
          cp2y = xBaseY;
        } else {
          cp1y = Math.min(xBaseY, cp1y);
          cp2y = Math.min(xBaseY, cp2y);
        }
        bandD += ' C ' + cp2x.toFixed(1) + ' ' + cp2y.toFixed(1) + ', ' + cp1x.toFixed(1) + ' ' + cp1y.toFixed(1) + ', ' + p1.x.toFixed(1) + ' ' + p1.y.toFixed(1);
      }
      bandD += ' Z';
      return bandD;
    };

    const savingsBandD = buildSmoothBand(origPoints, consumedPoints);

    const gradId = 'compAreaGrad_' + cfg.viewportId;
    contentSvg += '<defs>' +
      '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + themeColor + '" stop-opacity="0.38"/>' +
      '<stop offset="100%" stop-color="' + themeColor + '" stop-opacity="0.02"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<path d="' + savingsBandD + '" fill="rgba(56, 189, 248, 0.16)" />' +
      '<path d="' + origPathD + '" fill="none" stroke="' + consumedColor + '" stroke-width="1.8" stroke-dasharray="4,3" stroke-linecap="round" stroke-linejoin="round" opacity="0.8" />' +
      '<path d="' + consumedAreaD + '" fill="url(#' + gradId + ')" />' +
      '<path d="' + consumedPathD + '" fill="none" stroke="' + themeColor + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />';

    origPoints.forEach(p => {
      if (p.val > 0) {
        contentSvg += '<circle cx="' + p.x + '" cy="' + p.y + '" r="2.8" fill="' + consumedColor + '" stroke="#121215" stroke-width="1.5" />';
      }
    });
    consumedPoints.forEach(p => {
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
      const cVal = getConsumedVal(pt);
      const origVal = cVal + sVal;
      const yPos = isAllZero ? xBaseY : (xBaseY - (cVal / maxVal) * chartH);

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
              '<span><span style="color:' + col + ';">■</span> <span class="truncate-text" style="max-width:140px;" title="' + escapeHtml(m) + '">' + escapeHtml(m) + '</span></span>' +
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
        '<span>📊 理论总输入 (未压缩):</span>' +
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
        '<div style="display:flex;justify-content:space-between;gap:12px;color:#10b981;font-size:0.72rem;">' +
        '<span>💰 节省金额 (USD):</span>' +
        '<span style="font-family:monospace;font-weight:600;color:#10b981;">$' + sCost.toFixed(5) + '</span>' +
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

// ==========================================
// Gateway Offline & Auto-Reconnection Banner
// ==========================================
let consecutiveConnectionFailures = 0;
let isShowingOfflineBanner = false;

function handleConnectionFailure(err) {
  consecutiveConnectionFailures++;
  const banner = document.getElementById('gateway-connection-banner');
  const textEl = document.getElementById('gateway-connection-text');
  if (banner && textEl && consecutiveConnectionFailures >= 2) {
    banner.style.display = 'flex';
    banner.classList.remove('reconnected');
    banner.classList.add('visible');
    textEl.innerText = '⚠️ 与智能网关通信中断，正在尝试重新连接 (第 ' + consecutiveConnectionFailures + ' 次重试)...';
    isShowingOfflineBanner = true;
  }
}

function handleConnectionSuccess() {
  if (isShowingOfflineBanner) {
    const banner = document.getElementById('gateway-connection-banner');
    const textEl = document.getElementById('gateway-connection-text');
    if (banner && textEl) {
      banner.classList.add('reconnected');
      textEl.innerText = '🟢 已重新连接到智能网关';
      setTimeout(() => {
        banner.classList.remove('visible');
        setTimeout(() => {
          banner.style.display = 'none';
          banner.classList.remove('reconnected');
        }, 300);
      }, 1500);
    }
    isShowingOfflineBanner = false;
  }
  consecutiveConnectionFailures = 0;
}

async function fetchCompressionStats() {
  if (document.hidden) return;
  try {
    const queryParam = currentCompRange ? '?range=' + encodeURIComponent(currentCompRange) : '';
    const res = await fetch('/balancer/api/compression/stats' + queryParam, { headers: apiHeaders() });
    if (!res.ok) {
      handleConnectionFailure(new Error('HTTP ' + res.status));
      return;
    }
    const data = await res.json();
    if (!data || !data.stats) return;
    handleConnectionSuccess();
    const stats = data.stats;
    const hasData = (stats.totalOriginalChars || 0) > 0 || (stats.totalSavedChars || 0) > 0;

    const tokensEl = document.getElementById('stat-saved-tokens');
    const costEl = document.getElementById('stat-saved-cost');
    const ratioEl = document.getElementById('stat-compression-ratio');
    const origEl = document.getElementById('stat-original-chars');
    const savedCharsSub = document.getElementById('stat-saved-chars-sub');
    const compCharsSub = document.getElementById('stat-compressed-chars-sub');

    const savedTokens = Number(stats.savedTokens || 0);
    const rawConsumedTokens = Number(stats.consumedTokens || 0);
    // P0-S1: consumedTokens from backend = original total (before compression)
    // actualConsumed = what the model actually processes after compression
    const totalTokens = Math.max(rawConsumedTokens, savedTokens);
    const consumedTokens = Math.max(0, totalTokens - savedTokens);
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
        ? ('压缩后实际消耗 ~' + consumedTokens.toLocaleString() + ' T · 压缩前原需 ~' + totalTokens.toLocaleString() + ' T')
        : '基于中英双语动态模型 (~1.25 中文 / ~3.8 英文代码 字符/Token)';
    }

    const dynRatioEl = document.getElementById('stat-dynamic-savings-ratio');
    const dynRatioSub = document.getElementById('stat-dynamic-savings-sub');
    if (dynRatioEl) dynRatioEl.innerText = dynamicSavingsRatio.toFixed(1) + '%';
    if (dynRatioSub) {
      dynRatioSub.innerText = hasData
        ? ('压缩前原需 ~' + totalTokens.toLocaleString() + ' T → 压缩后实消 ~' + consumedTokens.toLocaleString() + ' T · 打 ' + discountRate + ' 折')
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
  } catch (e) {
    handleConnectionFailure(e);
  }
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

  const telemetryBanner = usage.mode === 'passive_telemetry'
    ? '<div style="display:flex; justify-content:space-between; align-items:center; font-size:0.7rem; color:var(--muted); margin-bottom:6px; padding:3px 6px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.2); border-radius:4px;"><span>网关实时遥测 (密钥已验证通过)</span><a href="https://opencode.ai/console/go" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:none;">官方控制台 ↗</a></div>'
    : '';
  return telemetryBanner + '<div class="quota-row">' +
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
    const match = document.cookie.match(/(?:^|;s*)router_auth=([^;]+)/);
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
  const url = 'http://' + (window.location.hostname || '127.0.0.1') + ':' + ((currentConfig && currentConfig.port) || window.location.port || 4010);
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

function showToast(msg, typeOrIsError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  const isError = (typeOrIsError === true || typeOrIsError === 'error' || typeOrIsError === 'danger');
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
    const port = (currentConfig && currentConfig.port) || window.location.port || 4010;
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
    const activePort = currentConfig.port || window.location.port || 4010;
    const activeHost = currentConfig.host || '127.0.0.1';
    if (document.getElementById('cfg-upstream')) document.getElementById('cfg-upstream').value = currentConfig.upstream || 'https://opencode.ai/zen/go/v1';
    if (document.getElementById('cfg-host')) document.getElementById('cfg-host').value = activeHost;
    if (document.getElementById('cfg-port')) document.getElementById('cfg-port').value = activePort;
    if (document.getElementById('cfg-uipassword')) document.getElementById('cfg-uipassword').value = currentConfig.uiPassword || '';
    if (document.getElementById('cfg-cooldown')) document.getElementById('cfg-cooldown').value = Math.round((currentConfig.defaultCooldownMs || 60000) / 1000);
    if (document.getElementById('cfg-retries')) document.getElementById('cfg-retries').value = (currentConfig.maxFailoverRetries !== undefined ? currentConfig.maxFailoverRetries : 2);
    if (document.getElementById('cfg-affinity')) document.getElementById('cfg-affinity').checked = currentConfig.sessionAffinityEnabled !== false;
    const baseUrlEl = document.getElementById('lbl-baseurl');
    if (baseUrlEl) baseUrlEl.innerText = 'http://' + (window.location.hostname || '127.0.0.1') + ':' + activePort;
    document.querySelectorAll('.sidebar-port-label').forEach(el => { el.innerText = '端口: ' + activePort; });
    if (currentConfig.comfyui) {
      const cf = currentConfig.comfyui;
      if (document.getElementById('comfy-cfg-repo-url') && cf.repoUrl) document.getElementById('comfy-cfg-repo-url').value = cf.repoUrl;
      if (document.getElementById('comfy-cfg-local-dir') && cf.localDir !== undefined) document.getElementById('comfy-cfg-local-dir').value = cf.localDir || '';
      if (document.getElementById('comfy-cfg-host') && cf.host) document.getElementById('comfy-cfg-host').value = cf.host;
      if (document.getElementById('comfy-cfg-dir') && cf.workflowsDir !== undefined) document.getElementById('comfy-cfg-dir').value = cf.workflowsDir || '';
      if (document.getElementById('comfy-cfg-timeout') && cf.timeoutSec) document.getElementById('comfy-cfg-timeout').value = cf.timeoutSec;
    }
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

      // Module PowerShell
      if (document.getElementById('cfg-module-powershell-enabled')) {
        document.getElementById('cfg-module-powershell-enabled').checked = (!m.powershell || m.powershell.enabled !== false);
      }
      if (document.getElementById('cfg-comp-ps-autodetect')) {
        document.getElementById('cfg-comp-ps-autodetect').checked = (m.powershell ? m.powershell.autoDetectPlatform !== false : comp.autoDetectPlatform !== false);
      }
      if (document.getElementById('cfg-comp-ps-clixml')) {
        document.getElementById('cfg-comp-ps-clixml').checked = (m.powershell ? m.powershell.cleanCliXmlNoise !== false : comp.cleanCliXmlNoise !== false);
      }
      if (document.getElementById('cfg-comp-ps-trailing-slash')) {
        document.getElementById('cfg-comp-ps-trailing-slash').checked = (m.powershell ? m.powershell.fixTrailingSlash !== false : comp.fixTrailingSlash !== false);
      }
      if (document.getElementById('cfg-comp-ps-curl-alias')) {
        document.getElementById('cfg-comp-ps-curl-alias').checked = (m.powershell ? m.powershell.fixCurlAlias !== false : comp.fixCurlAlias !== false);
      }
      if (document.getElementById('cfg-comp-ps-and-operator')) {
        document.getElementById('cfg-comp-ps-and-operator').checked = (m.powershell ? m.powershell.fixAndOperator !== false : comp.fixAndOperator !== false);
      }
      if (document.getElementById('cfg-comp-ps-line-continuation')) {
        document.getElementById('cfg-comp-ps-line-continuation').checked = (m.powershell ? m.powershell.fixLineContinuation !== false : comp.fixLineContinuation !== false);
      }
      if (document.getElementById('cfg-comp-ps-subexpression')) {
        document.getElementById('cfg-comp-ps-subexpression').checked = (m.powershell ? m.powershell.fixSubexpressionEscaping !== false : comp.fixSubexpressionEscaping !== false);
      }
      if (document.getElementById('cfg-comp-ps-guard-directive')) {
        document.getElementById('cfg-comp-ps-guard-directive').checked = (m.powershell ? m.powershell.injectPowerShellGuard !== false : comp.injectPowerShellGuard !== false);
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
    if (!res.ok) {
      handleConnectionFailure(new Error('HTTP ' + res.status));
      return;
    }
    const data = await res.json();
    for (const acc of data.accounts) {
      liveStats[acc.id] = acc;
    }
    updateMetricsUI();
    updateWizardStatusBadges();
    handleConnectionSuccess();
  } catch (e) {
    handleConnectionFailure(e);
  }
}

function renderAccounts() {
  const container = document.getElementById('accounts-container');
  container.innerHTML = '';

  if (!currentConfig.accounts || currentConfig.accounts.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px 20px; text-align: center; border: 1px dashed var(--border); border-radius: 12px; background: rgba(255, 255, 255, 0.02); color: var(--text-muted);">
        <div style="font-size: 32px; margin-bottom: 12px; opacity: 0.7;">📭</div>
        <div style="font-size: 15px; font-weight: 500; color: var(--text); margin-bottom: 6px;">暂未配置任何订阅账号</div>
        <div style="font-size: 13px; line-height: 1.5; margin-bottom: 18px;">配置主账号与备用账号后，网关可实现跨账号负载均衡与 429 智能故障转移。</div>
        <button type="button" class="btn btn-primary" onclick="addAccountCard()" style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; font-size: 13px;">
          <span>➕</span> 立即添加第一个账号
        </button>
      </div>
    `;
    return;
  }

  currentConfig.accounts.forEach((acc, index) => {
    const stat = liveStats[acc.id] || {};
    let badgeClass = 'badge-disabled';
    let statusText = '未配置密钥/已禁用';
    if (acc.enabled && acc.apiKey) {
      const cState = stat.circuitState || (stat.status === 'cooling_down' ? 'OPEN' : 'CLOSED');
      if (cState === 'HALF_OPEN' || stat.status === 'half_open') {
        badgeClass = 'badge-halfopen';
        statusText = '🟡 半开探测中';
      } else if (cState === 'OPEN' || stat.status === 'cooling_down') {
        badgeClass = 'badge-cooling';
        statusText = '🔴 熔断冷却 (' + (stat.remainingCooldownSec || 0) + 's)';
      } else {
        badgeClass = 'badge-healthy';
        statusText = '🟢 正常 (CLOSED)';
      }
    }

    const card = document.createElement('div');
    card.className = 'account-card';
    card.id = 'acc-card-' + acc.id;
    card.innerHTML = `
      <div class="acc-header">
        <input type="text" class="acc-title-input" value="${acc.name || '账号 ' + (index + 1)}" onchange="updateAccountField('${acc.id}', 'name', this.value)">
        <span class="badge ${badgeClass}" id="badge-${acc.id}">${statusText}</span>
      </div>

      <div class="form-group">
        <label>API Key (密钥)</label>
        <div class="input-wrapper">
          <input type="password" id="key-input-${acc.id}" class="form-control" placeholder="输入订阅密钥..." value="${acc.apiKey || ''}" onchange="updateAccountField('${acc.id}', 'apiKey', this.value)">
          <button type="button" class="toggle-eye" onclick="toggleEye('${acc.id}')">👁️</button>
        </div>
        <div class="test-result-box" id="test-res-${acc.id}"></div>
      </div>

      <div class="quota-box" id="quota-box-${acc.id}">
        <div class="quota-header">
          <div style="display:flex; align-items:center;">
            <span>📊 官方限额 (Usage Quota)</span>
            <span id="quota-updated-${acc.id}" class="quota-time-tag"></span>
          </div>
          <button type="button" id="quota-btn-${acc.id}" class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="fetchSingleQuota('${acc.id}', true)">🔄 刷新</button>
        </div>
        <div id="quota-content-${acc.id}">
          ${accountQuotas[acc.id] ? buildQuotaContent(accountQuotas[acc.id]) : '<div style="color:var(--muted); font-size:0.75rem; text-align:center; padding: 4px 0;">点击【测速】或【刷新】查询官方 5h、周、月配额</div>'}
        </div>
      </div>

      <div class="acc-metrics">
        <div class="metric-item"><span class="metric-label">活跃请求:</span><span class="metric-val" id="m-act-${acc.id}">${stat.activeRequests || 0}</span></div>
        <div class="metric-item"><span class="metric-label">总请求数:</span><span class="metric-val" id="m-tot-${acc.id}">${stat.totalRequests || 0}</span></div>
        <div class="metric-item"><span class="metric-label">平均 TTFT:</span><span class="metric-val" id="m-ttft-${acc.id}">${stat.avgTtftMs ? stat.avgTtftMs + 'ms' : (stat.lastTtftMs ? stat.lastTtftMs + 'ms' : '--')}</span></div>
        <div class="metric-item"><span class="metric-label">连续失败:</span><span class="metric-val" id="m-fail-${acc.id}">${stat.consecutiveFailures || 0}</span></div>
        <div class="metric-item"><span class="metric-label">429 限频:</span><span class="metric-val" id="m-429-${acc.id}">${stat.rateLimitCount || 0}</span></div>
        <div class="metric-item"><span class="metric-label">故障转移:</span><span class="metric-val" id="m-flv-${acc.id}">${stat.failoverCount || 0}</span></div>
      </div>

      <div class="acc-actions">
        <label class="switch-label">
          <input type="checkbox" ${acc.enabled ? 'checked' : ''} onchange="updateAccountField('${acc.id}', 'enabled', this.checked)">
          <span>启用此账号</span>
        </label>
        <div>
          <button class="btn btn-secondary btn-sm" onclick="resetSingleCooldown('${acc.id}')">🔄 解除冷却</button>
          <button class="btn btn-secondary btn-sm" style="margin-left:4px;" onclick="testSingleAccount('${acc.id}')">⚡ 测速</button>
          ${currentConfig.accounts.length > 1 ? `<button class="btn btn-danger btn-sm" style="margin-left:4px;" onclick="deleteAccount('${acc.id}')">🗑️ 删除</button>` : ''}
        </div>
      </div>
    `;
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
    let html = `
      <div style="margin-bottom:8px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
        <span><strong>OpenCode CLI:</strong> ${doc.opencode.installed ? '<span style="color:var(--success)">✔ ' + doc.opencode.version + '</span>' : '<span style="color:var(--warning)">⚠ 未找到</span>'}</span>
        <span><strong>路由端口:</strong> <span style="color:var(--success)">✔ ${doc.router.port}</span></span>
        <span><strong>OpenChamber:</strong> ${doc.openchamber.reachable ? '<span style="color:var(--success)">✔ 运行中</span>' : (doc.openchamber.ghost ? '<span style="color:var(--danger)">❌ 僵死死锁</span>' : '<span style="color:var(--muted)">未运行</span>')} <button class="btn btn-secondary btn-sm" style="padding:1px 6px; font-size:11px; margin-left:4px;" onclick="launchOpenChamber()">💻 唤醒桌面端</button></span>
        <span><strong>Office 预览:</strong> ${doc.openchamber.officePreview && doc.openchamber.officePreview.installed ? '<span style="color:var(--success)">✔ 已挂载</span>' : '<span style="color:var(--muted)">未挂载</span>'}</span>
        <span><strong>OMO 插件:</strong> ${doc.omoIntegrity ? (doc.omoIntegrity.healthy ? '<span style="color:var(--success)">✔ v2安全</span>' : '<span style="color:var(--danger)">❌ 存在缺陷</span>') : '<span style="color:var(--muted)">-</span>'}</span>
        <span><strong>双轨 Schema:</strong> ${doc.dualTrackSchema ? (doc.dualTrackSchema.healthy ? '<span style="color:var(--success)">✔ 镜像正常</span>' : '<span style="color:var(--warning)">⚠ 缺失规范</span>') : '<span style="color:var(--muted)">-</span>'}</span>
        <span><strong>提供商接口:</strong> ${doc.openchamberProbe && doc.openchamberProbe.integration ? (doc.openchamberProbe.integration.status === 'healthy' ? '<span style="color:var(--success)">✔ ' + doc.openchamberProbe.integration.latencyMs + 'ms' + (doc.openchamberProbe.integration.authRequired ? ' (鉴权)' : '') + '</span>' : (doc.openchamberProbe.integration.status === 'deadlocked' ? '<span style="color:var(--danger)">❌ 死锁挂死</span>' : (doc.openchamberProbe.integration.status === 'unreachable' ? '<span style="color:var(--muted)">未连接</span>' : '<span style="color:var(--warning)">⚠ ' + (doc.openchamberProbe.integration.error || doc.openchamberProbe.integration.status) + '</span>'))) : '<span style="color:var(--muted)">-</span>'}</span>
        <span><strong>/boost 指令:</strong> ${doc.commands.boostMdExists ? '<span style="color:var(--success)">✔ 已就绪</span>' : '<span style="color:var(--muted)">未安装</span>'}</span>
        <span><strong>回路互通门禁:</strong> ${doc.gatewayLoopbackAuth ? (doc.gatewayLoopbackAuth.healthy ? '<span style="color:var(--success)">✔ 守卫正常</span>' : '<span style="color:var(--danger)">❌ 存在阻断</span>') : '<span style="color:var(--muted)">-</span>'}</span>
        <span><strong>模型自愈屏障:</strong> <span style="color:var(--success)">✔ 异构节点防护</span></span>
      </div>
    `;
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
        html += `
          <div class="issue-item ${cls}">
            <div>
              <strong>${iss.title}</strong>: <span style="color:var(--muted);">${iss.desc}</span>
            </div>
          </div>
        `;
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
      html += `
        <div style="margin-top:10px; padding:8px 12px; background:rgba(56, 189, 248, 0.08); border:1px solid rgba(56, 189, 248, 0.25); border-radius:6px; font-size:0.83rem; color:#93c5fd; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <span>🤖 检测到 OpenAI Codex 存在 <strong>${doc.codexIssues.length}</strong> 个待优化项（已隔离至 Codex 专项面板进行管理）</span>
          <button class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="scrollToCodexCard()">👉 前往 Codex 专属卡片查看与修复</button>
        </div>
      `;
    }
    if (doc.compression && doc.compression.issues && doc.compression.issues.length > 0) {
      html += `
        <div style="margin-top:10px; padding:8px 12px; background:rgba(234, 179, 8, 0.08); border:1px solid rgba(234, 179, 8, 0.25); border-radius:6px; font-size:0.83rem; color:#fde047; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <span>⚡ 检测到上下文压缩配置存在 <strong>${doc.compression.issues.length}</strong> 个待优化项（已关联至压缩专属面板）</span>
          <button class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="scrollToCompressionCard()">👉 前往压缩卡片查看与一键修复</button>
        </div>
      `;
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
      html += `<div style="padding:4px 0; color:${color}">${r.success ? '✔' : '❌'} [${r.item}]: ${r.message}</div>`;
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
  const proxyModels = proxyModelsStr ? proxyModelsStr.split(/[,，s]+/).map(s => s.trim()).filter(Boolean) : ['gpt-5.6-luna', 'gpt-6-luna', 'claude-haiku-5-5'];

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
        const newToken = btoa(unescape(encodeURIComponent(uiPassword)));
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

    if (act) act.innerText = stat.activeRequests || 0;
    if (tot) tot.innerText = stat.totalRequests || 0;
    const ttft = document.getElementById('m-ttft-' + id);
    if (ttft) ttft.innerText = stat.avgTtftMs ? stat.avgTtftMs + 'ms' : (stat.lastTtftMs ? stat.lastTtftMs + 'ms' : '--');
    const fail = document.getElementById('m-fail-' + id);
    if (fail) fail.innerText = stat.consecutiveFailures || 0;
    if (r429) r429.innerText = stat.rateLimitCount || 0;
    if (flv) flv.innerText = stat.failoverCount || 0;

    if (badge) {
      if (!stat.hasKey || !stat.enabled) {
        badge.className = 'badge badge-disabled';
        badge.innerText = '未配置密钥/已禁用';
      } else if (stat.circuitState === 'HALF_OPEN' || stat.status === 'half_open') {
        badge.className = 'badge badge-halfopen';
        badge.innerText = '🟡 半开探测中';
      } else if (stat.circuitState === 'OPEN' || stat.status === 'cooling_down') {
        badge.className = 'badge badge-cooling';
        badge.innerText = '🔴 熔断冷却 (' + stat.remainingCooldownSec + 's)';
      } else {
        badge.className = 'badge badge-healthy';
        badge.innerText = '🟢 正常 (CLOSED)';
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
      const rawErr = data.error || '未返回配额数据';
      const renderedErr = (typeof escapeHtml === 'function' ? escapeHtml(rawErr) : rawErr).replace(/(https:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--primary);text-decoration:underline;word-break:break-all;">$1</a>');
      if (qBox) qBox.innerHTML = '<div style="color:var(--danger); font-size:0.75rem; text-align:center; padding:4px 0; line-height:1.4;">' + (rawErr.startsWith('官方订阅失效') ? '' : '查询失败: ') + renderedErr + '</div>';
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

let _isRefreshingQuotas = false;
async function refreshAllQuotas(silent = true, force = false) {
  if (_isRefreshingQuotas) return;
  if (!currentConfig || !currentConfig.accounts) return;
  const validAccounts = currentConfig.accounts.filter(a => a.apiKey && a.apiKey.trim() && a.enabled);
  if (validAccounts.length === 0) return;

  const refreshBtn = document.getElementById('btn-refresh-quotas');
  const originalText = refreshBtn ? refreshBtn.innerHTML : '';
  _isRefreshingQuotas = true;
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<span class="spin" style="margin-right:4px;">🔄</span>刷新中...';
  }

  try {
    await Promise.all(validAccounts.map(a => fetchSingleQuota(a.id, force)));
    if (!silent) {
      showToast('✔ 已完成所有账号官方限额刷新！');
    }
  } catch (e) {
    if (!silent) showToast('刷新配额异常: ' + e.message, true);
  } finally {
    _isRefreshingQuotas = false;
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = originalText || '🔄 刷新配额/状态';
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
        '<td style="text-align:center;"><button class="btn btn-secondary btn-sm" onclick="applySingleUpdate(\'' + c.id + '\')">单独升级</button></td>' +
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
  if (!confirm('⚠️ 确认要单独升级【' + name + '】吗？\n\n系统将在升级前自动创建灾备快照。')) return;
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

  let msg = '即将安全升级以下组件：\n' + targetNames.map(function(n) { return '• ' + n; }).join('\n') + '\n\n';
  if (lastUpdateReport.compatibility.riskLevel === 'critical') {
    msg += '🛑 警告：检测到存在破坏性大版本更新或生态冲突风险！\n系统已启用自动快照备份，若更新后出现异常可秒级一键回滚。\n\n是否确认继续一键升级？';
  } else if (lastUpdateReport.compatibility.riskLevel === 'warning') {
    msg += '⚠️ 提示：系统将在更新前自动创建全量灾备快照。\n\n是否确认执行安全升级？';
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
      const vStr = s.versions ? ('opencode: ' + (s.versions.opencode || '-') + ', omo: ' + (s.versions['oh-my-openagent'] || '-')) : '-';
      html += '<tr>' +
        '<td style="font-family:monospace; font-weight:600;">' + s.id + '</td>' +
        '<td style="font-size:0.8rem; color:var(--muted);">' + new Date(s.timestamp).toLocaleString() + '</td>' +
        '<td>' + (s.reason || '自动快照') + '</td>' +
        '<td style="font-size:0.75rem; color:var(--muted); font-family:monospace;">' + vStr + '</td>' +
        '<td><button class="btn btn-danger btn-sm" onclick="executeRollback(\'' + s.id + '\')">恢复此快照</button></td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    box.innerHTML = html;
  } catch (e) {
    box.innerHTML = '<span style="color:var(--danger)">查询快照失败: ' + e.message + '</span>';
  }
}

async function executeRollback(snapshotId) {
  if (!confirm('⚠️ 确认要执行灾备回滚至快照 [' + snapshotId + '] 吗？\n\n系统将秒级复原配置与组件状态。')) return;
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
    // Auto-refresh diagnostics immediately so UI badges and issue cards update in real-time
    await runCodexDoctorCheck();
    if (confirm('🎉 OpenAI Codex 专项自愈与加固完成！\n\n是否立即平滑重启 Codex 客户端以彻底清理互斥锁并加载最新环境？')) {
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
      if (confirm('🎉 Codex 已成功接入 4010 本地网关！\n\n是否立即平滑重启 Codex 客户端以立即加载最新配置与 38 款模型？')) {
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
      if (confirm('✔ Codex 原始配置已恢复！\n\n是否立即平滑重启 Codex 客户端以重新加载原始配置？')) {
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
  html += '<button type="button" class="btn btn-secondary btn-sm" style="padding:2px 6px; font-size:0.75rem;" onclick="document.getElementById(\'comp-doctor-panel\').style.display=\'none\'">✕ 收起</button>';
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
  if (!confirm('确认执行压缩引擎安全自愈？\n\n将自动开启 Git 冲突豁免防御、源码 Diff 完整性保护、修正瘦身门限为安全档 (15,000字符) 并开启真 LRU 守护，杜绝断流与降智隐患。')) {
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
if (baseUrlElem) baseUrlElem.innerText = 'http://' + currentHost + ':' + ((currentConfig && currentConfig.port) || window.location.port || 4010);
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
    if (typeof scheduleChartRender === 'function' && cachedTimeSeriesData && cachedTimeSeriesData.length > 0) {
      scheduleChartRender();
    }
    if (quotaRefreshInterval > 0 && quotaCountdown <= 3) {
      quotaCountdown = quotaRefreshInterval;
      updateQuotaCountdownBadge();
      refreshAllQuotas(true, false);
    }
  } else {
    if (typeof chartRafId !== 'undefined' && chartRafId) {
      cancelAnimationFrame(chartRafId);
      chartRafId = null;
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
// ComfyUI Visual Plugin Management & Lifecycle
// ==========================================
var comfyUiStatusData = null;

function cleanDeviceName(raw) {
  if (!raw || typeof raw !== 'string') return 'GPU 加速设备';
  var s = raw.replace(/^cuda:[0-9]+ */i, '').replace(/ *: *native *$/i, '').trim();
  s = s.replace(/ Graphics/i, '');
  s = s.split('[').join('(').split(']').join(')');
  return s.trim() || raw;
}

function appendComfyLog(msg) {
  const container = document.getElementById('comfy-terminal-log-container');
  const logEl = document.getElementById('comfy-terminal-log');
  if (container) container.style.display = 'block';
  if (logEl) {
    const timeStr = new Date().toLocaleTimeString();
    logEl.textContent += '[' + timeStr + '] ' + msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function clearComfyLog() {
  const logEl = document.getElementById('comfy-terminal-log');
  const container = document.getElementById('comfy-terminal-log-container');
  if (logEl) logEl.textContent = '';
  if (container) container.style.display = 'none';
}

async function loadComfyUiPluginStatus(force) {
  try {
    const url = '/balancer/api/comfyui/status' + (force ? '?force=true' : '');
    const res = await fetch(url, { headers: apiHeaders() });
    const data = await res.json();
    if (!data || !data.success) return;

    comfyUiStatusData = data;
    const st = data.status || {};
    const isOnline = Boolean(st.isOnline);
    const isEnabled = data.enabled !== false;
    const devName = cleanDeviceName(st.deviceInfo?.name || '未知设备');
    const vramGb = st.deviceInfo?.vramTotal ? (st.deviceInfo.vramTotal / (1024 * 1024 * 1024)).toFixed(1) + ' GB' : '--';
    const wfCount = data.workflowsCount || 0;

    // 1. Update Master Switch Toggle & Badges
    const toggleBtn = document.getElementById('comfy-enabled-toggle');
    if (toggleBtn) {
      if (isEnabled) {
        toggleBtn.textContent = '🟢 插件已启用';
        toggleBtn.style.borderColor = '#10b981';
        toggleBtn.style.background = 'rgba(16,185,129,0.15)';
        toggleBtn.style.color = '#34d399';
      } else {
        toggleBtn.textContent = '⚪ 插件已停用';
        toggleBtn.style.borderColor = '#71717a';
        toggleBtn.style.background = 'rgba(113,113,122,0.15)';
        toggleBtn.style.color = '#a1a1aa';
      }
    }

    const badge = document.getElementById('comfy-status-badge');
    if (badge) {
      if (!isEnabled) {
        badge.className = 'badge badge-disabled';
        badge.textContent = '⚪ 插件已停用';
      } else {
        badge.className = isOnline ? 'badge badge-healthy' : 'badge badge-disabled';
        badge.textContent = isOnline ? '🟢 已连接 (' + (st.serverUrl || '8284') + ')' : '⚪ 服务离线 (未启动)';
      }
    }

    const navBadge = document.getElementById('nav-badge-plugins');
    if (navBadge) {
      navBadge.textContent = isEnabled ? (isOnline ? '在线' : '离线') : '已停用';
      navBadge.style.color = isEnabled ? (isOnline ? '#34d399' : '#eab308') : '#71717a';
    }

    const barCount = document.getElementById('plugins-bar-active-count');
    if (barCount) {
      barCount.textContent = isEnabled ? (isOnline ? '外挂系统运作中 (1 个已激活)' : '外挂系统待命中 (服务离线)') : '外挂系统已停用 (0 个已激活)';
    }

    const ovBadge = document.getElementById('plugins-overview-badge');
    if (ovBadge) {
      ovBadge.className = isEnabled && isOnline ? 'badge badge-healthy' : 'badge badge-disabled';
      ovBadge.textContent = isEnabled && isOnline ? '🟢 1 个在线' : (isEnabled ? '⚪ 未连接' : '⚪ 已停用');
    }

    const ovVal = document.getElementById('plugins-overview-val');
    if (ovVal) {
      ovVal.textContent = isEnabled ? (isOnline ? 'ComfyUI 就绪' : 'ComfyUI 离线') : '插件已停用';
      ovVal.style.color = isEnabled ? (isOnline ? '#38bdf8' : '#eab308') : '#71717a';
    }

    // 2. Update service lifecycle buttons and status
    const sPill = document.getElementById('comfy-service-state-pill');
    const sSubtext = document.getElementById('comfy-service-subtext');
    const btnStartGpu = document.getElementById('btn-comfy-start-gpu');
    const btnStartCpu = document.getElementById('btn-comfy-start-cpu');
    const btnStop = document.getElementById('btn-comfy-stop');
    const btnRestart = document.getElementById('btn-comfy-restart');

    if (sPill) {
      if (!isEnabled) {
        sPill.className = 'badge badge-disabled';
        sPill.textContent = '⚪ 插件已停用';
      } else if (isOnline) {
        sPill.className = 'badge badge-healthy';
        sPill.textContent = '🟢 服务在线 (' + (st.serverUrl || '8284') + ')';
      } else {
        sPill.className = 'badge badge-disabled';
        sPill.textContent = '⚪ 服务未运行';
      }
    }

    if (sSubtext) {
      if (isOnline) {
        sSubtext.innerHTML = '已通过 <strong style="color:#38bdf8;">' + (st.serverUrl || '8284') + '</strong> 成功挂载 <strong>' + devName + '</strong>，显存 <strong>' + vramGb + '</strong>。';
      } else {
        sSubtext.textContent = '内核级静默脱钩常驻，无终端黑框占用；点击启动后后台秒级唤起守护进程。';
      }
    }

    if (btnStartGpu) btnStartGpu.style.display = isOnline ? 'none' : 'inline-flex';
    if (btnStartCpu) btnStartCpu.style.display = isOnline ? 'none' : 'inline-flex';
    if (btnStop) btnStop.style.display = isOnline ? 'inline-flex' : 'none';
    if (btnRestart) btnRestart.style.display = isOnline ? 'inline-flex' : 'none';

    // 3. Update device and workflows info
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

    // 4. Auto-populate inputs if empty
    const localDirInput = document.getElementById('comfy-cfg-local-dir');
    if (localDirInput && !localDirInput.value.trim() && data.localDir) {
      localDirInput.value = data.localDir;
    }
    const repoUrlInput = document.getElementById('comfy-cfg-repo-url');
    if (repoUrlInput && !repoUrlInput.value.trim() && data.repoUrl) {
      repoUrlInput.value = data.repoUrl;
    }

    // 5. Populate workflow dropdown in test sandbox
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

    // 6. Populate catalog accordion
    const catalogList = document.getElementById('comfy-workflows-catalog-list');
    if (catalogList && Array.isArray(data.workflows)) {
      var items = [];
      for (var i = 0; i < data.workflows.length; i++) {
        var wf = data.workflows[i];
        var tagsHtml = '';
        if (Array.isArray(wf.tags)) {
          for (var j = 0; j < wf.tags.length; j++) {
            tagsHtml += '<span style="background:#18181b; border:1px solid #27272a; border-radius:3px; padding:1px 5px; color:#a1a1aa; font-size:0.68rem;">#' + escapeHtml(wf.tags[j]) + '</span>';
          }
        }
        items.push('<div style="background:#09090b; border:1px solid #27272a; border-radius:6px; padding:8px 10px; font-size:0.75rem;"><div style="margin-bottom:2px;"><span style="color:#38bdf8; font-weight:700; margin-right:4px;">[' + escapeHtml(wf.id) + ']</span><span style="font-weight:600; color:#f4f4f5;">' + escapeHtml(wf.name) + '</span></div><div style="color:var(--muted); margin-bottom:4px; font-size:0.72rem;">' + escapeHtml(wf.description || '') + '</div><div style="display:flex; flex-wrap:wrap; gap:4px;">' + tagsHtml + '</div></div>');
      }
      catalogList.innerHTML = items.join('');
    }

    if (force) {
      showToast(isOnline ? 'ComfyUI 服务嗅探成功，工作流已实时重载！' : 'ComfyUI 未响应，请确认本地 8284/8188 端口是否已启动', isOnline ? 'success' : 'error');
    }

    // Sync plugin center status and checkboxes
    try {
      fetch('/balancer/api/plugins', { headers: apiHeaders() }).then(r => r.json()).then(pData => {
        if (pData && pData.success && Array.isArray(pData.plugins)) {
          pData.plugins.forEach(p => {
            const ocBox = document.getElementById('scope-' + p.id + '-opencode');
            const chBox = document.getElementById('scope-' + p.id + '-openchamber');
            const cdBox = document.getElementById('scope-' + p.id + '-codex');
            if (ocBox && p.clients) ocBox.checked = p.clients.opencode !== false;
            if (chBox && p.clients) chBox.checked = p.clients.openchamber !== false;
            if (cdBox && p.clients) cdBox.checked = p.clients.codex !== false;
          });
          renderDiscoveredPlugins(pData.plugins);
        }
      }).catch(() => {});
    } catch (_) {}
  } catch (e) {
    console.warn('获取 ComfyUI 状态失败:', e);
  }
}

async function rescanPlugins(manual) {
  try {
    const res = await fetch('/balancer/api/plugins/rescan', {
      method: 'POST',
      headers: apiHeaders()
    });
    const d = await res.json();
    if (d && d.success) {
      if (manual) showToast('成功扫描 plugins/ 目录，发现 ' + d.count + ' 个扩展插件！', 'success');
      renderDiscoveredPlugins(d.plugins || []);
      await loadComfyUiPluginStatus(false);
    } else {
      showToast('扫描插件失败: ' + (d?.error || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('扫描请求异常: ' + e.message, 'error');
  }
}

async function updatePluginClientScope(pluginId, client, checked) {
  try {
    const res = await fetch('/balancer/api/plugins/clients', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: pluginId, clients: { [client]: checked } })
    });
    const d = await res.json();
    if (d && d.success) {
      showToast('已' + (checked ? '为' : '从') + ' ' + client + ' ' + (checked ? '启用' : '禁用') + ' "' + pluginId + '" 插件能力', 'success');
    } else {
      showToast('修改客户端作用域失败: ' + (d?.error || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('请求异常: ' + e.message, 'error');
  }
}

async function runPluginPreflight(pluginId) {
  try {
    const res = await fetch('/balancer/api/plugins/preflight', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: pluginId })
    });
    const d = await res.json();
    if (d && d.success) {
      const topo = d.topology || {};
      let msg = '【' + pluginId + ' 静态拓扑预检报告】\n';
      msg += topo.ok ? '✔ 拓扑兼容性预检 100% 通过！\n' : '❌ 存在阻断性拓扑冲突！\n';
      if (topo.errors && topo.errors.length > 0) {
        msg += '\n阻断项 (Errors):\n' + topo.errors.map(function(e) { return ' • ' + e; }).join('\n');
      }
      if (topo.warnings && topo.warnings.length > 0) {
        msg += '\n告警/自愈提示 (Warnings):\n' + topo.warnings.map(function(w) { return ' • ' + w; }).join('\n');
      }
      if (topo.ok && (!topo.warnings || topo.warnings.length === 0)) {
        msg += '\n✔ 端口、GPU/显存预算、MCP工具命名空间与依赖互斥校验完全就绪，可安全激活使用。';
      }
      alert(msg);
    } else {
      showToast('预检请求失败: ' + (d?.error || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('请求异常: ' + e.message, 'error');
  }
}

function renderDiscoveredPlugins(plugins) {
  const container = document.getElementById('dynamic-plugins-container');
  if (!container) return;
  const customPlugins = plugins.filter(function(p) { return p.id !== 'comfyui' && p.id !== 'omo'; });
  if (customPlugins.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '<div style="margin-bottom:8px; font-weight:600; font-size:0.85rem; color:#f4f4f5; display:flex; align-items:center; gap:6px;"><span>🧩 已扫描到的本地外部扩展 (' + customPlugins.length + ')</span></div>';
  customPlugins.forEach(function(p) {
    const isEnabled = p.enabled !== false;
    html += '<div class="card" style="margin-bottom:12px; border:1px solid ' + (isEnabled ? '#3f3f46' : '#27272a') + '; background:#0e0e11;">';
    html += '<div class="section-title" style="margin-bottom:8px;">';
    html += '<div class="section-title-left" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">';
    html += '<span style="font-size:0.95rem; font-weight:600; color:#f4f4f5;">🔌 ' + escapeHtml(p.name) + '</span>';
    html += '<span class="badge ' + (isEnabled ? 'badge-healthy' : 'badge-disabled') + '">' + (isEnabled ? '🟢 已启用' : '⚪ 已停用') + '</span>';
    html += '<span class="badge" style="background:#27272a; color:#a1a1aa;">v' + escapeHtml(p.version) + '</span>';
    html += '<span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8;">' + escapeHtml(p.category) + '</span>';
    html += '</div>';
    html += '<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">';
    html += '<div style="display:inline-flex; align-items:center; gap:8px; font-size:0.75rem; color:#a1a1aa; background:#09090b; padding:4px 8px; border-radius:6px; border:1px solid #27272a;">';
    html += '<span style="font-weight:600; color:#cbd5e1;">客户端:</span>';
    html += '<label style="display:inline-flex; align-items:center; gap:3px; cursor:pointer;"><input type="checkbox" onchange="updatePluginClientScope(&quot;' + p.id + '&quot;, &quot;opencode&quot;, this.checked)" ' + (p.clients && p.clients.opencode ? 'checked' : '') + '> OpenCode</label>';
    html += '<label style="display:inline-flex; align-items:center; gap:3px; cursor:pointer;"><input type="checkbox" onchange="updatePluginClientScope(&quot;' + p.id + '&quot;, &quot;openchamber&quot;, this.checked)" ' + (p.clients && p.clients.openchamber ? 'checked' : '') + '> OpenChamber</label>';
    html += '<label style="display:inline-flex; align-items:center; gap:3px; cursor:pointer;"><input type="checkbox" onchange="updatePluginClientScope(&quot;' + p.id + '&quot;, &quot;codex&quot;, this.checked)" ' + (p.clients && p.clients.codex ? 'checked' : '') + '> Codex</label>';
    html += '</div>';
    html += '<button class="btn btn-secondary btn-sm" onclick="runPluginPreflight(&quot;' + p.id + '&quot;)">🔍 拓扑预检</button>';
    html += '<button class="btn ' + (isEnabled ? 'btn-danger' : 'btn-primary') + ' btn-sm" onclick="toggleGenericPlugin(&quot;' + p.id + '&quot;, ' + (!isEnabled) + ')">' + (isEnabled ? '🛑 停用' : '⚡ 启用') + '</button>';
    html += '</div>';
    html += '</div>';
    html += '<div style="font-size:0.8rem; color:var(--muted); line-height:1.5; margin-bottom:8px;">' + escapeHtml(p.description || '暂无描述') + '</div>';
    html += '<div style="display:flex; gap:12px; flex-wrap:wrap; font-size:0.75rem; color:#a1a1aa;">';
    html += '<span>🛠️ 暴露工具: <strong style="color:#38bdf8;">' + (p.toolCount || 0) + ' 个</strong></span>';
    html += '<span>🤖 智能体: <strong style="color:#c084fc;">' + (p.agentCount || 0) + ' 个</strong></span>';
    html += '<span>⚡ 端口: <strong style="color:#f4f4f5;">' + escapeHtml((p.system && p.system.ports) ? p.system.ports.join(', ') : '无') + '</strong></span>';
    html += '</div></div>';
  });
  container.innerHTML = html;
}

async function toggleGenericPlugin(pluginId, targetEnabled) {
  try {
    const res = await fetch('/balancer/api/plugins/toggle', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: pluginId, enabled: targetEnabled })
    });
    const d = await res.json();
    if (d && d.success) {
      showToast(targetEnabled ? ('插件 "' + pluginId + '" 已成功启用！') : ('插件 "' + pluginId + '" 已停用'), 'success');
      await rescanPlugins(false);
    } else {
      showToast('操作失败: ' + (d?.errors?.join('; ') || d?.error || '预检未通过'), 'error');
    }
  } catch (e) {
    showToast('请求异常: ' + e.message, 'error');
  }
}

async function toggleComfyUiPlugin() {
  const currentEnabled = comfyUiStatusData?.enabled !== false;
  const targetEnabled = !currentEnabled;
  try {
    const res = await fetch('/balancer/api/comfyui/toggle', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ enabled: targetEnabled })
    });
    const d = await res.json();
    if (d.success) {
      showToast(d.message || (targetEnabled ? '已启用 ComfyUI 插件' : '已停用 ComfyUI 插件'), 'success');
      await loadComfyUiPluginStatus(false);
    } else {
      showToast('切换失败: ' + (d.error || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('请求异常: ' + e.message, 'error');
  }
}

async function startComfyUiService(mode) {
  const hostInput = document.getElementById('comfy-cfg-host');
  const localDirInput = document.getElementById('comfy-cfg-local-dir');
  let port = 8284;
  try {
    if (hostInput && hostInput.value) {
      const u = new URL(hostInput.value.trim());
      if (u.port) port = parseInt(u.port, 10);
    }
  } catch (_) {}

  const localDir = localDirInput ? localDirInput.value.trim() : '';

  appendComfyLog('[Service] 正在请求启动本地 ComfyUI 服务 (模式: ' + mode + ', 端口: ' + port + ')...');
  const btn = mode === 'gpu' ? document.getElementById('btn-comfy-start-gpu') : document.getElementById('btn-comfy-start-cpu');
  const oldText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 正在静默拉起...'; }

  try {
    const res = await fetch('/balancer/api/comfyui/service/start', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mode: mode || 'gpu', port: port, localDir: localDir })
    });
    const d = await res.json();
    if (d.success) {
      appendComfyLog('[Service] ' + (d.message || ('服务启动命令已派发，PID: ' + d.pid)));
      showToast(d.message || 'ComfyUI 本地服务启动成功！正在等待端口就绪...', 'success');
      // Polling status
      setTimeout(() => { loadComfyUiPluginStatus(true); }, 2000);
      setTimeout(() => { loadComfyUiPluginStatus(true); }, 5000);
    } else {
      appendComfyLog('[Service 启动失败] ' + (d.error || '未知错误'));
      showToast('启动失败: ' + (d.error || '未知错误'), 'error');
    }
  } catch (e) {
    appendComfyLog('[Service 启动异常] ' + e.message);
    showToast('请求异常: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = oldText; }
  }
}

async function stopComfyUiService() {
  if (!confirm('确定要停止本地 ComfyUI 守护服务吗？\n这将释放端口与 GPU 显存。')) return;

  appendComfyLog('[Service] 正在终止本地 ComfyUI 守护进程树...');
  const btn = document.getElementById('btn-comfy-stop');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 正在停止...'; }

  try {
    const res = await fetch('/balancer/api/comfyui/service/stop', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({})
    });
    const d = await res.json();
    if (d.success) {
      appendComfyLog('[Service] ' + (d.message || '服务已彻底终止'));
      showToast(d.message || '本地 ComfyUI 服务已停止！', 'success');
      await loadComfyUiPluginStatus(true);
    } else {
      appendComfyLog('[Service 停止失败] ' + (d.error || '未知错误'));
      showToast('停止失败: ' + (d.error || '未知错误'), 'error');
    }
  } catch (e) {
    appendComfyLog('[Service 停止异常] ' + e.message);
    showToast('请求异常: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🛑 停止服务'; }
  }
}

async function restartComfyUiService() {
  if (!confirm('确定要平滑重启本地 ComfyUI 服务吗？')) return;

  appendComfyLog('[Service] 正在重启本地 ComfyUI 服务...');
  const btn = document.getElementById('btn-comfy-restart');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 正在重启...'; }

  try {
    const res = await fetch('/balancer/api/comfyui/service/restart', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({})
    });
    const d = await res.json();
    if (d.success) {
      appendComfyLog('[Service] ' + (d.message || '重启指令已派发'));
      showToast(d.message || 'ComfyUI 服务重启已派发，正在重新建立连接...', 'success');
      setTimeout(() => { loadComfyUiPluginStatus(true); }, 2500);
      setTimeout(() => { loadComfyUiPluginStatus(true); }, 6000);
    } else {
      appendComfyLog('[Service 重启失败] ' + (d.error || '未知错误'));
      showToast('重启失败: ' + (d.error || '未知错误'), 'error');
    }
  } catch (e) {
    appendComfyLog('[Service 重启异常] ' + e.message);
    showToast('请求异常: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 重启'; }
  }
}

async function openComfyUiWebGui() {
  const hostInput = document.getElementById('comfy-cfg-host');
  const targetUrl = hostInput ? hostInput.value.trim() : 'http://127.0.0.1:8284';
  try {
    const res = await fetch('/balancer/api/comfyui/open-gui', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ url: targetUrl })
    });
    const d = await res.json();
    if (d.success) {
      showToast('已唤起无边框独立桌面 Web 界面！', 'success');
    } else {
      showToast('唤起失败: ' + (d.error || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('请求异常: ' + e.message, 'error');
  }
}

async function syncComfyWorkflowsFromGitHub() {
  const repoInput = document.getElementById('comfy-cfg-repo-url');
  const dirInput = document.getElementById('comfy-cfg-dir');
  const repoUrl = repoInput ? repoInput.value.trim() : 'https://github.com/deancyl/comfyui-agent-workflows';
  const targetDir = dirInput ? dirInput.value.trim() : '';

  appendComfyLog('[Sync] 开始从 GitHub 仓库同步: ' + repoUrl);
  const btn = document.getElementById('btn-comfy-sync-github');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 同步中...'; }

  try {
    const res = await fetch('/balancer/api/comfyui/sync-workflows', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ repoUrl, targetDir })
    });
    const d = await res.json();
    if (d.success) {
      if (Array.isArray(d.logs)) {
        d.logs.forEach(l => appendComfyLog(l));
      }
      if (dirInput && d.workflowsDir) dirInput.value = d.workflowsDir;
      showToast('🎉 成功同步并载入 ' + (d.workflowsCount || 17) + ' 套工业级工作流！', 'success');
      await loadComfyUiPluginStatus(true);
    } else {
      appendComfyLog('[Sync 失败] ' + (d.error || '未知错误'));
      showToast('同步工作流失败: ' + (d.error || '未知错误'), 'error');
    }
  } catch (e) {
    appendComfyLog('[Sync 异常] ' + e.message);
    showToast('请求异常: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📥 同步工作流'; }
  }
}

async function detectComfyLocalDirs() {
  const btn = document.getElementById('btn-comfy-detect-dirs');
  const dirInput = document.getElementById('comfy-cfg-local-dir');
  if (btn) { btn.disabled = true; btn.textContent = '🔍 探测中...'; }

  try {
    const res = await fetch('/balancer/api/comfyui/detect-dirs', { headers: apiHeaders() });
    const d = await res.json();
    if (d.success && Array.isArray(d.dirs) && d.dirs.length > 0) {
      const chosen = d.dirs[0].path;
      if (dirInput) dirInput.value = chosen;
      appendComfyLog('[Detect] 自动探测到本地 ComfyUI 根目录: ' + chosen + ' (类型: ' + d.dirs[0].type + ')');
      showToast('已自动匹配本地 ComfyUI 目录: ' + chosen, 'success');
    } else {
      appendComfyLog('[Detect] 未探测到默认路径下的 ComfyUI 根目录，请手动输入路径。');
      showToast('未在常见位置自动匹配到 ComfyUI，请手动输入完整路径', 'error');
    }
  } catch (e) {
    showToast('探测失败: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 自动探测'; }
  }
}

async function deployWorkflowsToLocalComfy() {
  const localDirInput = document.getElementById('comfy-cfg-local-dir');
  const dirInput = document.getElementById('comfy-cfg-dir');
  const targetComfyDir = localDirInput ? localDirInput.value.trim() : '';
  const workflowsDir = dirInput ? dirInput.value.trim() : '';

  appendComfyLog('[Deploy] 开始一键部署工作流、自定义扩展节点与静默启动脚本至本地 ComfyUI...');
  const btn = document.getElementById('btn-comfy-deploy-local');
  if (btn) { btn.disabled = true; btn.textContent = '⚡ 正在部署...'; }

  try {
    const res = await fetch('/balancer/api/comfyui/deploy-to-comfyui', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ targetComfyDir, workflowsDir })
    });
    const d = await res.json();
    if (d.success) {
      if (Array.isArray(d.logs)) {
        d.logs.forEach(l => appendComfyLog(l));
      }
      if (localDirInput && d.targetComfyDir) localDirInput.value = d.targetComfyDir;
      showToast(d.message || '🎉 工作流与扩展套件已全部成功部署至本地 ComfyUI！', 'success');
      await loadComfyUiPluginStatus(true);
    } else {
      appendComfyLog('[Deploy 失败] ' + (d.error || '未知错误'));
      showToast('部署失败: ' + (d.error || '未知错误'), 'error');
    }
  } catch (e) {
    appendComfyLog('[Deploy 异常] ' + e.message);
    showToast('请求异常: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ 一键部署'; }
  }
}

async function saveComfyUiConfig(andTest) {
  const hostInput = document.getElementById('comfy-cfg-host');
  const dirInput = document.getElementById('comfy-cfg-dir');
  const localDirInput = document.getElementById('comfy-cfg-local-dir');
  const repoUrlInput = document.getElementById('comfy-cfg-repo-url');
  const timeoutInput = document.getElementById('comfy-cfg-timeout');

  const comfyCfg = {
    enabled: comfyUiStatusData ? (comfyUiStatusData.enabled !== false) : true,
    host: hostInput ? hostInput.value.trim() : 'http://127.0.0.1:8284',
    workflowsDir: dirInput ? dirInput.value.trim() : '',
    localDir: localDirInput ? localDirInput.value.trim() : '',
    repoUrl: repoUrlInput ? repoUrlInput.value.trim() : 'https://github.com/deancyl/comfyui-agent-workflows',
    timeoutSec: timeoutInput ? (parseInt(timeoutInput.value, 10) || 180) : 180
  };

  try {
    const res = await fetch('/balancer/api/config', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
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
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
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
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ scope: 'codex' })
    });
    const d = await res.json();
    if (d.success) {
      showToast('已成功为 Codex Desktop 注册 ComfyUI 图像智能体 (mcp-comfyui.js)！', 'success');
      if (confirm('🎉 已成功为 OpenAI Codex 注册 ComfyUI 图像智能体！\n\n是否立即平滑重启 Codex 客户端以立即加载最新生图与反推工具？')) {
        restartCodexClient();
      }
    } else {
      showToast('注册 MCP 失败: ' + (d.error || '未知错误'), 'error');
    }
  } catch (e) {
    showToast('请求异常: ' + e.message, 'error');
  }
}

// ==========================================
// Unified Model Hub & Clients Adapter Engine
// ==========================================
let cachedHubData = null;

async function loadModelsHubData(force = false) {
  const policyBadge = document.getElementById('hub-policy-badge');
  const upstreamBadge = document.getElementById('hub-upstream-badge');
  const countBadge = document.getElementById('hub-models-count-badge');
  const upstreamDetail = document.getElementById('hub-upstream-detail');

  if (policyBadge) policyBadge.innerText = '正在对齐...';
  try {
    const url = '/balancer/api/models/hub' + (force ? '?force=1' : '');
    const res = await fetch(url, { headers: apiHeaders() });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '获取 Hub 数据失败');
    cachedHubData = data;
    renderModelHubUI(data);
  } catch (err) {
    if (upstreamBadge) {
      upstreamBadge.className = 'badge badge-cooling';
      upstreamBadge.innerText = '探测受限/离线';
    }
    if (upstreamDetail) {
      upstreamDetail.innerHTML = '<span style="color:var(--danger)">⚠️ 探测或加载失败: ' + err.message + '，已平滑采纳内置高保真官方基准。</span>';
    }
    showToast('模型调度中枢加载异常: ' + err.message, true);
  }
}

function renderModelHubUI(data) {
  if (!data) return;
  const policyBadge = document.getElementById('hub-policy-badge');
  const upstreamBadge = document.getElementById('hub-upstream-badge');
  const countBadge = document.getElementById('hub-models-count-badge');
  const policySelect = document.getElementById('hub-policy-select');
  const defaultModelSelect = document.getElementById('hub-default-model-select');
  const upstreamDetail = document.getElementById('hub-upstream-detail');
  const activeCountTag = document.getElementById('hub-active-count-tag');
  const bannerCountText = document.getElementById('clients-model-count-text');

  if (policyBadge) {
    policyBadge.className = 'badge badge-healthy';
    const pNames = { hybrid: '智能混合推荐 (hybrid)', official_docs: '官方基准 SSOT (official_docs)', api_probed: '上游探测 (api_probed)' };
    policyBadge.innerText = '策略: ' + (pNames[data.policy] || data.policy);
  }
  if (policySelect) policySelect.value = data.policy || 'hybrid';

  if (upstreamBadge) {
    if (data.upstreamStatus && data.upstreamStatus.healthy) {
      upstreamBadge.className = 'badge badge-healthy';
      upstreamBadge.innerText = '🟢 上游就绪 (' + data.counts.probedCount + ' 款在线)';
    } else {
      const diagType = (data.upstreamStatus && data.upstreamStatus.diagnostic && data.upstreamStatus.diagnostic.type) || 'PROBE_FAILED';
      upstreamBadge.className = 'badge badge-cooling';
      upstreamBadge.innerText = '🟡 上游兜底 (' + diagType + ')';
    }
  }

  if (countBadge) {
    countBadge.innerText = data.counts.activeCount + ' 款模型就绪';
  }
  if (activeCountTag) {
    activeCountTag.innerText = '(' + data.counts.activeCount + ' 款)';
  }
  if (bannerCountText) {
    bannerCountText.innerText = data.counts.activeCount + ' 款全量模型已就绪';
  }

  if (upstreamDetail) {
    let diagMsg = '';
    if (data.upstreamStatus && data.upstreamStatus.diagnostic && data.upstreamStatus.diagnostic.suggestion) {
      diagMsg = ' 💡 ' + data.upstreamStatus.diagnostic.suggestion;
    }
    upstreamDetail.innerHTML = '<strong>数据信源状态：</strong>官方基准表 <strong>' + data.counts.officialCount + '</strong> 款，上游探活 <strong>' + data.counts.probedCount + '</strong> 款，当前策略激活 <strong>' + data.counts.activeCount + '</strong> 款。' + diagMsg;
  }

  // Populate default model dropdown
  if (defaultModelSelect && Array.isArray(data.models)) {
    const currentVal = defaultModelSelect.value || data.defaultModel;
    defaultModelSelect.innerHTML = '';
    data.models.forEach(function(m) {
      const opt = document.createElement('option');
      opt.value = m.slug;
      opt.textContent = m.name + ' (' + m.slug + ')';
      if (m.slug === currentVal || m.slug === data.defaultModel) opt.selected = true;
      defaultModelSelect.appendChild(opt);
    });
  }

  // Populate codex select as well if exists
  const codexSelect = document.getElementById('codex-model-select');
  if (codexSelect && Array.isArray(data.models)) {
    const curCodexVal = codexSelect.value;
    codexSelect.innerHTML = '';
    data.models.forEach(function(m) {
      const opt = document.createElement('option');
      opt.value = m.slug;
      opt.textContent = m.name + ' (' + m.slug + ')';
      if (m.slug === curCodexVal) opt.selected = true;
      codexSelect.appendChild(opt);
    });
  }

  // Update clients status cards
  if (data.clients) {
    renderClientStatusItem('opencode', data.clients.opencode);
    renderClientStatusItem('openchamber', data.clients.openchamber);
    renderClientStatusItem('codex', data.clients.codex);
  }

  // Populate model table
  renderHubModelTable(data.models || []);
}

function renderClientStatusItem(clientKey, clientObj) {
  const badge = document.getElementById('hub-client-' + clientKey + '-badge');
  const info = document.getElementById('hub-client-' + clientKey + '-info');
  if (!clientObj) return;

  if (badge) {
    if (clientObj.configured) {
      badge.className = 'badge badge-healthy';
      badge.innerText = '🟢 已对齐网关 (' + (clientObj.modelCount || 0) + ' 款)';
    } else if (clientObj.exists) {
      badge.className = 'badge badge-cooling';
      badge.innerText = '🟡 未接驳网关';
    } else {
      badge.className = 'badge';
      badge.style.background = '#27272a';
      badge.style.color = '#a1a1aa';
      badge.innerText = '⚪ 配置文件不存在';
    }
  }
  if (info) {
    let txt = clientObj.configPath || '';
    if (clientObj.defaultModel) txt += ' | 首选: ' + clientObj.defaultModel;
    info.innerText = txt;
  }
}

function renderHubModelTable(models) {
  const tbody = document.getElementById('hub-models-table-body');
  if (!tbody) return;
  if (!models || models.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted); padding:16px;">无匹配模型</td></tr>';
    return;
  }
  let html = '';
  models.forEach(function(m) {
    const vendorBadge = '<span class="badge" style="font-size:0.7rem; background:rgba(255,255,255,0.06); color:#cbd5e1;">' + (m.vendor || 'Unknown') + '</span>';
    const ctxStr = m.context_window ? (Math.round(m.context_window / 1000) + 'k') : '-';
    const reasoningLevels = Array.isArray(m.supported_reasoning_levels) && m.supported_reasoning_levels.length > 0
      ? m.supported_reasoning_levels.join('/')
      : '<span style="color:var(--muted)">不支持</span>';
    const srcBadge = m.source === 'api_probed'
      ? '<span class="badge badge-healthy" style="font-size:0.68rem;">在线探活</span>'
      : '<span class="badge" style="font-size:0.68rem; background:rgba(2,132,199,0.18); color:#38bdf8; border:1px solid rgba(2,132,199,0.3);">官方基准</span>';

    html += '<tr data-slug="' + m.slug + '" data-vendor="' + (m.vendor || '').toLowerCase() + '" data-name="' + (m.name || '').toLowerCase() + '">' +
      '<td><div style="font-weight:600; color:#f1f5f9;">' + m.name + '</div><div style="font-family:monospace; color:#38bdf8; font-size:0.72rem;">' + m.slug + '</div></td>' +
      '<td>' + vendorBadge + '</td>' +
      '<td style="font-family:monospace; color:#cbd5e1;">' + ctxStr + '</td>' +
      '<td style="font-size:0.72rem; color:#a1a1aa;">' + reasoningLevels + '</td>' +
      '<td style="text-align:center;">' + srcBadge + '</td>' +
    '</tr>';
  });
  tbody.innerHTML = html;
  filterHubModelTable();
}

function filterHubModelTable() {
  const searchInput = document.getElementById('hub-model-search');
  const vendorInput = document.getElementById('hub-vendor-filter');
  const search = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const vendor = (vendorInput ? vendorInput.value : 'all').toLowerCase().trim();
  const rows = document.querySelectorAll('#hub-models-table-body tr[data-slug]');
  let visible = 0;
  rows.forEach(function(r) {
    const rowSlug = r.getAttribute('data-slug') || '';
    const rowVendor = r.getAttribute('data-vendor') || '';
    const rowName = r.getAttribute('data-name') || '';

    const matchSearch = !search || rowSlug.indexOf(search) !== -1 || rowName.indexOf(search) !== -1 || rowVendor.indexOf(search) !== -1;
    const matchVendor = (vendor === 'all') || rowVendor.indexOf(vendor) !== -1;

    if (matchSearch && matchVendor) {
      r.style.display = '';
      visible++;
    } else {
      r.style.display = 'none';
    }
  });
  const activeCountTag = document.getElementById('hub-active-count-tag');
  if (activeCountTag && cachedHubData && cachedHubData.models) {
    activeCountTag.innerText = '(' + visible + ' / ' + cachedHubData.models.length + ' 款)';
  }
}

function handlePolicySelectChange(policy) {}

async function applyHubPolicyAndDefault() {
  const pSel = document.getElementById('hub-policy-select');
  const dSel = document.getElementById('hub-default-model-select');
  const policy = (pSel ? pSel.value : '') || 'hybrid';
  const defaultModel = (dSel ? dSel.value : '') || 'deepseek-v4.1-flash';

  showToast('正在保存模型获取策略【' + policy + '】...');
  try {
    const res = await fetch('/balancer/api/models/policy', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ policy: policy, defaultModel: defaultModel, syncClients: true })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✔ ' + data.message);
      await loadModelsHubData(false);
    } else {
      showToast('保存策略失败: ' + (data.error || '未知错误'), true);
    }
  } catch (e) {
    showToast('请求异常: ' + e.message, true);
  }
}

async function syncAllClientsAction() {
  const pSel = document.getElementById('hub-policy-select');
  const dSel = document.getElementById('hub-default-model-select');
  const policy = (pSel ? pSel.value : '') || 'hybrid';
  const defaultModel = (dSel ? dSel.value : '') || 'deepseek-v4.1-flash';

  showToast('正在将模型目录与策略同步写入全端客户端...');
  try {
    const res = await fetch('/balancer/api/models/sync', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ policy: policy, defaultModel: defaultModel })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✔ ' + (data.message || '全端客户端同步成功！'));
      await loadModelsHubData(false);
    } else {
      showToast('同步未完全成功: ' + (data.error || '部分失败'), true);
    }
  } catch (e) {
    showToast('同步请求异常: ' + e.message, true);
  }
}

async function syncSingleClientAction(clientKey) {
  showToast('正在单独同步 ' + clientKey + ' 配置...');
  try {
    const res = await fetch('/balancer/api/models/sync', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ clients: [clientKey] })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✔ ' + clientKey + ' 配置同步成功！');
      await loadModelsHubData(false);
    } else {
      showToast('同步失败: ' + (data.error || '未知错误'), true);
    }
  } catch (e) {
    showToast('同步异常: ' + e.message, true);
  }
}

// ==========================================
// OMO Plugin Status & Repair Functions
// ==========================================
async function checkOmoPluginStatus(manual = false) {
  const badge = document.getElementById('omo-status-badge');
  const details = document.getElementById('omo-integrity-details');
  if (manual && badge) badge.innerText = '体检中...';

  try {
    const res = await fetch('/balancer/api/doctor', { headers: apiHeaders() });
    const doc = await res.json();
    const omoInteg = doc.omoIntegrity;

    if (omoInteg && omoInteg.healthy) {
      if (badge) {
        badge.className = 'badge badge-healthy';
        badge.innerText = '🟢 v2 安全兼容';
      }
      if (details) {
        details.innerHTML = '<span style="color:var(--success)">✔ 插件完整且已注入安全目录包装器，无 Effect-TS 死锁标记。</span><br>' +
          '<span style="color:var(--muted)">已探测目标文件: ' + (omoInteg.targets || 0) + ' 处</span>';
      }
    } else if (omoInteg && (omoInteg.hasDeadlockEffect || omoInteg.hasMissingWrapper)) {
      if (badge) {
        badge.className = 'badge badge-cooling';
        badge.innerText = '⚠️ 存在兼容缺陷/死锁';
      }
      if (details) {
        details.innerHTML = '<span style="color:var(--warning)">⚠️ 检测到 ' +
          (omoInteg.hasDeadlockEffect ? '【Effect-TS 死锁标记】' : '') +
          (omoInteg.hasMissingWrapper ? '【缺少 v2 运行时包装器】' : '') +
          '，建议点击【🛠️ 注入补丁与自愈】一键修复。</span>';
      }
    } else {
      if (badge) {
        badge.className = 'badge';
        badge.style.background = '#27272a';
        badge.style.color = '#a1a1aa';
        badge.innerText = '⚪ 未安装或未检测到';
      }
      if (details) {
        details.innerHTML = '<span style="color:var(--muted)">未在 OpenCode 缓存中检测到 oh-my-openagent 模块。OMO 为可选外挂，不影响网关正常运转。</span>';
      }
    }
    if (manual) showToast('OMO 状态体检完成');
  } catch (e) {
    if (details) details.innerHTML = '<span style="color:var(--danger)">体检异常: ' + e.message + '</span>';
  }
}

async function repairOmoPlugin() {
  showToast('正在自愈 OMO 插件并注入 v2 兼容包装...');
  try {
    const res = await fetch('/balancer/api/repair', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ scope: 'omo' })
    });
    const d = await res.json();
    if (d.success) {
      showToast('🎉 OMO 兼容补丁注入成功！');
      await checkOmoPluginStatus(false);
    } else {
      showToast('自愈未完成: ' + (d.message || d.error), true);
    }
  } catch (e) {
    showToast('自愈请求异常: ' + e.message, true);
  }
}

async function openOmoConfigFile() {
  try {
    const res = await fetch('/balancer/api/repair', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ scope: 'omo-config' })
    });
    const d = await res.json();
    showToast('已确认 ~/.omo/omo.jsonc 配置文件就绪');
    checkOmoPluginStatus(false);
  } catch (e) {
    showToast('检查异常: ' + e.message, true);
  }
}

// Auto-load ComfyUI and Hub status on initialization
setTimeout(function() {
  loadComfyUiPluginStatus(false);
  if (getHashTab() === 'clients') {
    loadModelsHubData(false);
  }
  if (getHashTab() === 'plugins') {
    checkOmoPluginStatus(false);
  }
}, 400);
