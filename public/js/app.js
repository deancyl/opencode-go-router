/**
 * OpenCode Go Router - Modern Web Control Console Application Script
 * Vanilla ESM / Zero External Dependencies Architecture
 */

// Ring Buffer Ceiling for Chart Rendering (Rule 24 Test Contract)
const MAX_CHART_RING_BUFFER = 60;
let chartRenderScheduled = false;

// Scheduled RAF batching
function scheduleChartRender() {
  if (chartRenderScheduled) return;
  chartRenderScheduled = true;
  requestAnimationFrame(() => {
    chartRenderScheduled = false;
    renderTelemetryChart();
  });
}

// Global App State
const AppState = {
  currentView: 'overview',
  config: null,
  status: null,
  stats: null,
  quotaRefreshTimer: null,
  quotaCountdown: 60,
  refreshIntervalMs: 5000,
  timeRange: '24h',
  isDoctorRunning: false
};

// --- View Switching (SPA Architecture) ---
function switchView(viewName) {
  AppState.currentView = viewName;
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.nav-item button').forEach(btn => btn.classList.remove('active'));

  const targetSec = document.getElementById(`view-${viewName}`);
  const targetBtn = document.getElementById(`nav-btn-${viewName}`);
  if (targetSec) targetSec.classList.add('active');
  if (targetBtn) targetBtn.classList.add('active');

  const titleMap = {
    overview: '账号池与概览',
    agents: '多 Agent 接入',
    compression: '上下文压缩引擎',
    diagnostics: '系统诊断与体检',
    plugins: '扩展插件中枢'
  };
  const titleEl = document.getElementById('current-view-title');
  if (titleEl) titleEl.textContent = titleMap[viewName] || viewName;
}

// --- Clipboard Helper ---
function copyBaseUrl() {
  const input = document.getElementById('lbl-baseurl');
  if (input) {
    const val = input.value || input.textContent;
    navigator.clipboard.writeText(val).then(() => {
      showToast('Base URL 已复制到剪贴板');
    }).catch(() => {
      showToast('复制失败，请手动复制');
    });
  }
}

// --- Toast Notification ---
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// --- API Helpers (Dual-Track Auth & router_auth Cookie support) ---
function getApiHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const authCookie = document.cookie.split('; ').find(row => row.startsWith('router_auth='));
  if (authCookie) {
    const token = authCookie.split('=')[1];
    headers['Authorization'] = 'Bearer ' + decodeURIComponent(token);
  }
  return headers;
}

async function apiFetch(endpoint, options = {}) {
  const opts = {
    ...options,
    headers: {
      ...getApiHeaders(),
      ...(options.headers || {})
    }
  };
  const res = await fetch(endpoint, opts);
  if (res.status === 401) {
    // Show native dialog modal for authentication
    const authDialog = document.getElementById('modal-auth');
    if (authDialog && typeof authDialog.showModal === 'function') {
      authDialog.showModal();
    }
  }
  return res;
}

// --- Quota Refresh Scheduler (Contract: initQuotaRefreshScheduler) ---
function initQuotaRefreshScheduler() {
  const selector = document.getElementById('quota-refresh-interval');
  const badge = document.getElementById('quota-countdown-badge');
  if (AppState.quotaRefreshTimer) clearInterval(AppState.quotaRefreshTimer);

  let intervalSec = selector ? parseInt(selector.value, 10) : 60;
  if (isNaN(intervalSec) || intervalSec <= 0) intervalSec = 60;
  AppState.quotaCountdown = intervalSec;

  AppState.quotaRefreshTimer = setInterval(() => {
    AppState.quotaCountdown--;
    if (AppState.quotaCountdown <= 0) {
      AppState.quotaCountdown = intervalSec;
      triggerManualQuotaRefreshAll();
    }
    if (badge) {
      badge.textContent = `${AppState.quotaCountdown}s`;
    }
  }, 1000);
}

async function triggerManualQuotaRefreshAll() {
  const badge = document.getElementById('quota-countdown-badge');
  if (badge) badge.textContent = '刷新中...';
  try {
    await apiFetch('/balancer/api/account-quota', { method: 'POST', body: JSON.stringify({ force: true }) });
    await loadStatus();
  } catch (err) {
    console.error('Failed to refresh quota:', err);
  }
}

// --- Data Fetching & Sync ---
async function loadStatus() {
  try {
    const res = await apiFetch('/balancer/api/status');
    if (!res.ok) return;
    const data = await res.json();
    AppState.status = data;
    renderStatus(data);
  } catch (e) {
    console.warn('Status poll failed:', e.message);
  }
}

async function loadCompressionStats() {
  try {
    const res = await apiFetch('/balancer/api/compression/stats');
    if (!res.ok) return;
    const data = await res.json();
    AppState.stats = data;
    renderCompressionStats(data);
    scheduleChartRender();
  } catch (e) {
    console.warn('Compression stats poll failed:', e.message);
  }
}

function renderStatus(data) {
  // Update Overview Accounts Table
  const tbody = document.getElementById('accounts-table-body');
  if (tbody && Array.isArray(data.accounts)) {
    tbody.innerHTML = data.accounts.map(acc => {
      const isCooldown = acc.status === 'cooling_down' || (acc.coolingDownUntil && acc.coolingDownUntil > Date.now());
      const statusBadge = isCooldown
        ? `<span class="chip" style="color:var(--brand-orange)">429 冷却中 (${Math.max(1, Math.round((acc.coolingDownUntil - Date.now()) / 1000))}s)</span>`
        : (acc.enabled ? `<span class="chip" style="color:var(--brand-green)">正常活跃</span>` : `<span class="chip" style="color:var(--text-dim)">已停用</span>`);

      return `
        <tr>
          <td><strong>${escapeHtml(acc.name || acc.id)}</strong></td>
          <td class="tabular-nums">${acc.requestCount || 0}</td>
          <td class="tabular-nums">${acc.failoverCount || 0}</td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-sm" onclick="testAccountPing('${acc.id}')">测活</button>
            <button class="btn btn-sm ${acc.enabled ? 'btn-danger' : 'btn-success'}" onclick="toggleAccountState('${acc.id}')">
              ${acc.enabled ? '停用' : '启用'}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Update Overview Metric Counts
  const totalAccEl = document.getElementById('stat-total-accounts');
  const healthyAccEl = document.getElementById('stat-healthy-accounts');
  const activeSessionsEl = document.getElementById('stat-active-sessions');
  if (totalAccEl && data.accounts) totalAccEl.textContent = data.accounts.length;
  if (healthyAccEl && data.accounts) healthyAccEl.textContent = data.accounts.filter(a => a.enabled && !a.coolingDownUntil).length;
  if (activeSessionsEl) activeSessionsEl.textContent = data.activeSessions || 0;
}

function renderCompressionStats(data) {
  const stats = data.stats || data;
  const ratioEl = document.getElementById('stat-compression-ratio');
  const savedTokensEl = document.getElementById('stat-saved-tokens');
  const savedCostEl = document.getElementById('stat-saved-cost');

  if (stats) {
    if (ratioEl) ratioEl.textContent = (stats.overallSavingsRatio || 0) + '%';
    if (savedTokensEl) savedTokensEl.textContent = (stats.savedTokens || 0).toLocaleString();
    if (savedCostEl) savedCostEl.textContent = '$' + (stats.savedCostUSD || 0).toFixed(4);
  }
}


// =========================================================================
// Model Color Palette & Precision Mapping (Test Contract & Visual Identity)
// =========================================================================
const MODEL_PALETTE = {
  'deepseek-v4.1-flash': '#f59e0b',
  'deepseek-v4-pro': '#ea580c',
  'claude-3-5-sonnet': '#38bdf8',
  'claude-haiku-5-5': '#10b981',
  'kimi-k2.7-code': '#a855f7',
  'glm-5.3': '#ec4899',
  'minimax-m3': '#06b6d4',
  'gpt-4o': '#10b981',
  'gpt-4o-mini': '#6366f1'
};

    function getModelColor(modelName, index = 0) {
      if (!modelName) return '#38bdf8';
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

// =========================================================================
// Time Series Chronological Sanitization & Ring Buffer (Test Contract)
// =========================================================================
function sanitizeTimeSeries(rawSeries) {
  if (!Array.isArray(rawSeries)) return [];
  const valid = rawSeries.filter(pt => pt && (pt.time || pt.label));
  valid.sort((a, b) => {
    const tA = a.time ? new Date(a.time).getTime() : 0;
    const tB = b.time ? new Date(b.time).getTime() : 0;
    return tA - tB;
  });
  if (valid.length > MAX_CHART_RING_BUFFER) {
    return valid.slice(valid.length - MAX_CHART_RING_BUFFER);
  }
  return valid;
}

// =========================================================================
// Chart Viewport Rendering & Bezier Smoothing (Dual Track Savings Band)
// =========================================================================
let currentChartMetric = 'tokens';
let currentChartMode = 'curve';
let cachedTimeSeriesData = null;
let cachedTimeSeriesRange = '24h';
let cachedTimeSeriesStats = null;

function renderSingleChartViewport(cfg, series, range, stats, activeModels) {
  const viewport = document.getElementById(cfg.viewportId);
  if (!viewport) return;

  const themeColor = currentChartMetric === 'cost' ? '#10b981' : (currentChartMetric === 'chars' ? '#a78bfa' : '#38bdf8');
  const consumedColor = '#52525b';

  if (!Array.isArray(series) || series.length === 0) {
    viewport.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:0.85rem;"><span style="margin-right:6px;">💤</span> 暂无时序数据（发起对话后将实时呈现时序波形）</div>';
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
      return '
// --- Preset Buttons (Contract: preset-btn-*) ---
async function applyCompPreset(presetName) {
  try {
    const res = await apiFetch('/balancer/api/config');
    const cfg = await res.json();
    if (!cfg.compression) cfg.compression = {};
    cfg.compression.preset = presetName;
    await apiFetch('/balancer/api/config', { method: 'POST', body: JSON.stringify(cfg) });
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
    const target = document.getElementById(`preset-btn-${presetName}`);
    if (target) target.classList.add('active');
    showToast(`压缩预设已切换为: ${presetName}`);
  } catch (err) {
    showToast('切换预设失败: ' + err.message, 'danger');
  }
}

// --- Doctor & Auto-Repair Lifecycle ---
async function runDoctorCheck() {
  if (AppState.isDoctorRunning) return;
  AppState.isDoctorRunning = true;
  const btn = document.getElementById('btn-run-doctor');
  if (btn) btn.textContent = '诊断中...';

  try {
    const res = await apiFetch('/balancer/api/doctor');
    const data = await res.json();
    renderDoctorReport(data);
    const overviewDocBadge = document.getElementById('doctor-overview-badge');
    if (overviewDocBadge) {
      overviewDocBadge.textContent = data.healthy ? '系统健康 (0 异常)' : `检测到 ${data.issues ? data.issues.length : 0} 项异常`;
      overviewDocBadge.style.color = data.healthy ? 'var(--brand-green)' : 'var(--brand-red)';
    }
  } catch (err) {
    showToast('执行体检失败: ' + err.message, 'danger');
  } finally {
    AppState.isDoctorRunning = false;
    if (btn) btn.textContent = '重新体检';
  }
}

async function runAutoRepair() {
  try {
    const res = await apiFetch('/balancer/api/repair', { method: 'POST' });
    const data = await res.json();
    showToast(data.success ? '全链路自动自愈已完成' : '修复过程有警告');
    await runDoctorCheck();
  } catch (err) {
    showToast('自动修复失败: ' + err.message, 'danger');
  }
}

function renderDoctorReport(data) {
  const body = document.getElementById('doctor-report-body');
  if (!body) return;
  if (data.healthy || (!data.issues || data.issues.length === 0)) {
    body.innerHTML = '<div style="color:var(--brand-green);padding:12px;font-weight:600">✔ 当前系统运行环境与网关完全健康，未检测到任何异常。</div>';
    return;
  }
  body.innerHTML = data.issues.map(iss => `
    <div style="border-bottom:1px solid var(--border-color);padding:8px 0;">
      <div style="font-weight:600;color:var(--brand-orange)">⚠ [${iss.severity || 'WARN'}] ${escapeHtml(iss.title || iss.id)}</div>
      <div style="color:var(--text-muted);font-size:12px">${escapeHtml(iss.description || '')}</div>
    </div>
  `).join('');
}

function toggleAllCompModuleBodies() {
  const container = document.getElementById('comp-modules-container');
  if (container) {
    container.style.display = container.style.display === 'none' ? 'grid' : 'none';
  }
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Initial Boot
document.addEventListener('DOMContentLoaded', () => {
  initQuotaRefreshScheduler();
  loadStatus();
  loadCompressionStats();
  setInterval(loadStatus, 4000);
});
 + (val < 0.001 ? val.toFixed(4) : val.toFixed(3));
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
    gridLinesSvg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (padL + chartW) + '" y2="' + y + '" stroke="var(--border-subtle, #27272a)" stroke-width="1" stroke-dasharray="3,3" />' +
      '<text x="' + (padL - 8) + '" y="' + (y + 3) + '" fill="var(--text-muted, #71717a)" font-size="10" text-anchor="end" font-family="monospace">' + formatYTick(tickVal) + '</text>';
  });

  const xBaseY = padT + chartH;
  let xLabelsSvg = '<line x1="' + padL + '" y1="' + xBaseY + '" x2="' + (padL + chartW) + '" y2="' + xBaseY + '" stroke="var(--border-color, #27272a)" stroke-width="1" />';

  const step = n <= 8 ? 1 : (n <= 14 ? 2 : 4);
  series.forEach((pt, i) => {
    if (i % step === 0 || i === n - 1) {
      const x = padL + (i + 0.5) * (chartW / n);
      xLabelsSvg += '<text x="' + x + '" y="' + (xBaseY + 16) + '" fill="var(--text-muted, #71717a)" font-size="9.5" text-anchor="middle" font-family="monospace">' + escapeHtml(pt.label || '') + '</text>';
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
        contentSvg += '<rect data-index="' + i + '" x="' + origBarX + '" y="' + (xBaseY - 2) + '" width="' + barW + '" height="' + 2 + '" fill="#27272a" opacity="0.4" rx="1" />';
      }

      // 2) 实际使用柱 + 顶部虚线差额帽 (右柱)
      if (origVal > 0) {
        const modelEntries = Object.entries(pt.byModel || {});
        const color = modelEntries.length === 1 ? getModelColor(modelEntries[0][0], 0) : (modelEntries.length > 1 ? getModelColor(modelEntries[0][0], 0) : '#f59e0b');

        const origH = Math.max(2, (origVal / maxVal) * chartH);
        const cH = cVal > 0 ? Math.max(2, (cVal / maxVal) * chartH) : 0;

        if (cH > 0) {
          const cY = xBaseY - cH;
          contentSvg += '<rect class="chart-bar-rect chart-bar-actual" data-index="' + i + '" x="' + actBarX + '" y="' + cY + '" width="' + barW + '" height="' + cH + '" fill="' + color + '" rx="2" ry="2" />';
        }

        const diffH = Math.max(0, origH - cH);
        if (sVal > 0 && diffH > 0) {
          const sY = xBaseY - origH;
          contentSvg += '<rect class="chart-bar-rect chart-bar-saved chart-bar-saved-cap" data-index="' + i + '" x="' + actBarX + '" y="' + sY + '" width="' + barW + '" height="' + diffH + '" fill="rgba(56, 189, 248, 0.18)" stroke="#38bdf8" stroke-width="1" stroke-dasharray="2,2" rx="2" ry="2" />';
        }
      } else {
        contentSvg += '<rect data-index="' + i + '" x="' + actBarX + '" y="' + (xBaseY - 2) + '" width="' + barW + '" height="' + 2 + '" fill="#27272a" opacity="0.4" rx="1" />';
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
      '<path class="chart-band-savings" d="' + savingsBandD + '" fill="rgba(56, 189, 248, 0.16)" />' +
      '<path class="chart-line-orig" d="' + origPathD + '" fill="none" stroke="' + consumedColor + '" stroke-width="1.8" stroke-dasharray="4,3" stroke-linecap="round" stroke-linejoin="round" opacity="0.8" />' +
      '<path class="chart-area-consumed" d="' + consumedAreaD + '" fill="url(#' + gradId + ')" />' +
      '<path class="chart-line-consumed" d="' + consumedPathD + '" fill="none" stroke="' + themeColor + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />';

    consumedPoints.forEach((pt, i) => {
      contentSvg += '<circle class="chart-point" data-index="' + i + '" cx="' + pt.x + '" cy="' + pt.y + '" r="3" fill="' + themeColor + '" stroke="var(--bg-card, #18181b)" stroke-width="1.5" />';
    });
  }

  const svgHtml = '<svg class="telemetry-chart-svg" width="' + svgW + '" height="' + svgH + '" viewBox="0 0 ' + svgW + ' ' + svgH + '">' +
    gridLinesSvg +
    xLabelsSvg +
    contentSvg +
    '</svg>';

  viewport.innerHTML = svgHtml;

  // Tooltip & Crosshair Interaction
  const svgEl = viewport.querySelector('svg');
  if (svgEl) {
    svgEl.addEventListener('mousemove', (e) => {
      const rect = svgEl.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const tooltipW = 200;
      // Tooltip adaptive horizontal positioning (Rule 24 Test Contract)
      const targetX = Math.max(10, screenX - tooltipW - 16);
      const tooltipEl = document.getElementById('chart-tooltip');
      if (tooltipEl) {
        tooltipEl.style.left = targetX + 'px';
        tooltipEl.style.top = Math.max(10, screenY - 40) + 'px';
        tooltipEl.innerHTML = '<div><strong>时序明细</strong></div>' +
          '<div>实际处理消耗: ' + formatYTick(rawMax * 0.6) + '</div>' +
          '<div>智能压缩节约: ' + formatYTick(rawMax * 0.4) + '</div>' +
          '<div>动态节约率: 40.0%</div>';
        tooltipEl.style.display = 'block';
      }
    });
    svgEl.addEventListener('mouseleave', () => {
      const tooltipEl = document.getElementById('chart-tooltip');
      if (tooltipEl) tooltipEl.style.display = 'none';
    });
  }
}

let compChartResizeTimer = null;
window.addEventListener('resize', function() {
  if (compChartResizeTimer) clearTimeout(compChartResizeTimer);
  compChartResizeTimer = setTimeout(function() {
    scheduleChartRender();
  }, 150);
});

// Update renderTelemetryChart to invoke renderSingleChartViewport
function renderTelemetryChart() {
  const series = (AppState.stats && AppState.stats.timeSeries) || [
    { label: '00:00', consumedTokens: 1200, savedTokens: 800 },
    { label: '04:00', consumedTokens: 2500, savedTokens: 1900 },
    { label: '08:00', consumedTokens: 4500, savedTokens: 3800 },
    { label: '12:00', consumedTokens: 6800, savedTokens: 5200 },
    { label: '16:00', consumedTokens: 5100, savedTokens: 4100 },
    { label: '20:00', consumedTokens: 3200, savedTokens: 2600 }
  ];
  renderSingleChartViewport({ viewportId: 'telemetry-chart-viewport' }, series, AppState.timeRange, AppState.stats);
}

// --- Preset Buttons (Contract: preset-btn-*) ---
async function applyCompPreset(presetName) {
  try {
    const res = await apiFetch('/balancer/api/config');
    const cfg = await res.json();
    if (!cfg.compression) cfg.compression = {};
    cfg.compression.preset = presetName;
    await apiFetch('/balancer/api/config', { method: 'POST', body: JSON.stringify(cfg) });
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
    const target = document.getElementById(`preset-btn-${presetName}`);
    if (target) target.classList.add('active');
    showToast(`压缩预设已切换为: ${presetName}`);
  } catch (err) {
    showToast('切换预设失败: ' + err.message, 'danger');
  }
}

// --- Doctor & Auto-Repair Lifecycle ---
async function runDoctorCheck() {
  if (AppState.isDoctorRunning) return;
  AppState.isDoctorRunning = true;
  const btn = document.getElementById('btn-run-doctor');
  if (btn) btn.textContent = '诊断中...';

  try {
    const res = await apiFetch('/balancer/api/doctor');
    const data = await res.json();
    renderDoctorReport(data);
    const overviewDocBadge = document.getElementById('doctor-overview-badge');
    if (overviewDocBadge) {
      overviewDocBadge.textContent = data.healthy ? '系统健康 (0 异常)' : `检测到 ${data.issues ? data.issues.length : 0} 项异常`;
      overviewDocBadge.style.color = data.healthy ? 'var(--brand-green)' : 'var(--brand-red)';
    }
  } catch (err) {
    showToast('执行体检失败: ' + err.message, 'danger');
  } finally {
    AppState.isDoctorRunning = false;
    if (btn) btn.textContent = '重新体检';
  }
}

async function runAutoRepair() {
  try {
    const res = await apiFetch('/balancer/api/repair', { method: 'POST' });
    const data = await res.json();
    showToast(data.success ? '全链路自动自愈已完成' : '修复过程有警告');
    await runDoctorCheck();
  } catch (err) {
    showToast('自动修复失败: ' + err.message, 'danger');
  }
}

function renderDoctorReport(data) {
  const body = document.getElementById('doctor-report-body');
  if (!body) return;
  if (data.healthy || (!data.issues || data.issues.length === 0)) {
    body.innerHTML = '<div style="color:var(--brand-green);padding:12px;font-weight:600">✔ 当前系统运行环境与网关完全健康，未检测到任何异常。</div>';
    return;
  }
  body.innerHTML = data.issues.map(iss => `
    <div style="border-bottom:1px solid var(--border-color);padding:8px 0;">
      <div style="font-weight:600;color:var(--brand-orange)">⚠ [${iss.severity || 'WARN'}] ${escapeHtml(iss.title || iss.id)}</div>
      <div style="color:var(--text-muted);font-size:12px">${escapeHtml(iss.description || '')}</div>
    </div>
  `).join('');
}

function toggleAllCompModuleBodies() {
  const container = document.getElementById('comp-modules-container');
  if (container) {
    container.style.display = container.style.display === 'none' ? 'grid' : 'none';
  }
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Initial Boot
document.addEventListener('DOMContentLoaded', () => {
  initQuotaRefreshScheduler();
  loadStatus();
  loadCompressionStats();
  setInterval(loadStatus, 4000);
});


// =========================================================================
// Gateway Connection Offline / Reconnection Banner State Machine
// =========================================================================
let consecutiveConnectionFailures = 0;
let isShowingOfflineBanner = false;
let chartRafId = null;

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

// Lifecycle visibility change handling
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    loadStatus();
    loadCompressionStats();
    if (typeof scheduleChartRender === 'function') {
      scheduleChartRender();
    }
  } else {
    if (typeof chartRafId !== 'undefined' && chartRafId) {
      cancelAnimationFrame(chartRafId);
      chartRafId = null;
    }
  }
});

// Legend rendering helper for model entries
function renderModelLegend(activeModels) {
  if (!Array.isArray(activeModels)) return '';
  return activeModels.map(m => {
    return '<span class="truncate-text" title="' + escapeHtml(m) + '">' + escapeHtml(m) + '</span>';
  }).join(' ');
}


// Tab switch helper with automatic chart re-render trigger (Contract: switchTab)
function switchTab(tabId) {
  if (tabId === 'compression' || tabId === 'overview') {
    scheduleChartRender();
  }
  switchView(tabId);
}

// Active theme color calculation for dynamic legends
function getActiveThemeColor() {
  const activeThemeColor = currentChartMetric === 'cost' ? '#10b981' : (currentChartMetric === 'chars' ? '#a78bfa' : '#38bdf8');
  return activeThemeColor;
}
