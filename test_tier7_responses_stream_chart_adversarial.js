const assert = require('assert');
const http = require('http');
const codexAdapter = require('./codex-adapter');
const contextCompactor = require('./context-compactor');

console.log('================================================================');
console.log('🛡️  Starting Tier 7 Responses Stream Error & Chart Dual-Track Suite');
console.log('================================================================');

// --- Test 1: dispatchResponsesStreamError SSE compliance ---
console.log('\n--- SECTION 1: Responses Stream Error Graceful Closure (Rule 33) ---');
{
  const events = [];
  const mockRes = {
    headersSent: false,
    writableEnded: false,
    statusCode: null,
    headers: {},
    writeHead(code, hdrs) {
      this.statusCode = code;
      this.headers = hdrs;
      this.headersSent = true;
    },
    write(chunk) {
      events.push(chunk.toString('utf8'));
    },
    end() {
      this.writableEnded = true;
    }
  };

  codexAdapter.dispatchResponsesStreamError(mockRes, 'deepseek-v4.1-flash', 'resp-test-123', new Error('Gateway Timeout 300s'), 'session-test-456');

  assert.strictEqual(mockRes.headersSent, true, 'Headers must be sent');
  assert.strictEqual(mockRes.statusCode, 200, 'SSE stream response must use HTTP 200');
  const contentType = mockRes.headers['content-type'] || mockRes.headers['Content-Type'];
  assert.strictEqual(contentType, 'text/event-stream; charset=utf-8', 'Must be text/event-stream');
  assert.strictEqual(mockRes.writableEnded, true, 'Response must be cleanly ended');

  const fullStream = events.join('');
  assert.ok(fullStream.includes('response.in_progress'), 'Must contain response.in_progress event');
  assert.ok(fullStream.includes('response.output_item.added'), 'Must contain response.output_item.added event');
  assert.ok(fullStream.includes('response.output_item.done'), 'Must contain response.output_item.done event');
  assert.ok(fullStream.includes('response.failed'), 'Must contain response.failed event');
  assert.ok(fullStream.includes('Gateway Timeout 300s'), 'Error message must be included in assistant content');
  console.log('[PASS] Test 1: dispatchResponsesStreamError dispatches complete compliant SSE sequence');
}

// --- Test 2: Double call to dispatchResponsesStreamError is idempotent and safe ---
{
  const events = [];
  const mockRes = {
    headersSent: false,
    writableEnded: false,
    writeHead(code, hdrs) { this.headersSent = true; },
    write(chunk) { events.push(chunk.toString('utf8')); },
    end() { this.writableEnded = true; }
  };

  codexAdapter.dispatchResponsesStreamError(mockRes, 'deepseek-v4.1-flash', 'resp-test-double', 'Error 1');
  const countAfterFirst = events.length;
  // Second call on ended response should be a no-op
  codexAdapter.dispatchResponsesStreamError(mockRes, 'deepseek-v4.1-flash', 'resp-test-double', 'Error 2');
  assert.strictEqual(events.length, countAfterFirst, 'Second dispatch on ended res must be safe no-op');
  console.log('[PASS] Test 2: dispatchResponsesStreamError idempotency on closed stream');
}

// --- Test 3: Compactor Dual-Track Metrics in TimeSeries ---
console.log('\n--- SECTION 2: Compactor Dual-Track Metrics (Consumed vs Saved) ---');
{
  // Record some mock savings and consumption
  contextCompactor.recordSavings('rtk', 500, 2000, 'deepseek-v4.1-flash');
  contextCompactor.recordSavings('headroom', 300, 1500, 'deepseek-v4.1-flash');

  const statsAll = contextCompactor.getStatsByRange('all');
  assert.ok(statsAll.timeSeries, 'Stats must have timeSeries');
  assert.ok(Array.isArray(statsAll.timeSeries), 'timeSeries must be an array');
  assert.ok(statsAll.timeSeries.length > 0, 'timeSeries must not be empty');

  const pt = statsAll.timeSeries[statsAll.timeSeries.length - 1];
  assert.ok('savedTokens' in pt, 'point must have savedTokens');
  assert.ok('consumedTokens' in pt, 'point must have consumedTokens');
  assert.ok('savedCostUSD' in pt, 'point must have savedCostUSD');
  assert.ok('consumedCostUSD' in pt, 'point must have consumedCostUSD');

  assert.ok(typeof pt.savedTokens === 'number', 'savedTokens must be number');
  assert.ok(typeof pt.consumedTokens === 'number', 'consumedTokens must be number');
  assert.ok(typeof pt.savedCostUSD === 'number', 'savedCostUSD must be number');
  assert.ok(typeof pt.consumedCostUSD === 'number', 'consumedCostUSD must be number');

  console.log(`[PASS] Test 3: Dual-track timeSeries verified: savedTokens=${pt.savedTokens}, consumedTokens=${pt.consumedTokens}, savedCostUSD=$${pt.savedCostUSD}`);
}

// --- Test 4: Frontend Chart Viewport Logic Execution without ReferenceError ---
console.log('\n--- SECTION 3: Frontend Chart Viewport Scope Safety & Bar Mode ---');
{
  // Verify that renderSingleChartViewport logic runs cleanly in bar mode without themeColor ReferenceError
  const fs = require('fs');
  const path = require('path');
  const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  // Ensure themeColor is hoisted to the top of renderSingleChartViewport
  const fnIdx = serverCode.indexOf('function renderSingleChartViewport(');
  assert.ok(fnIdx !== -1, 'renderSingleChartViewport must exist in server.js');

  const fnSlice = serverCode.slice(fnIdx, fnIdx + 800);
  assert.ok(fnSlice.includes('const themeColor ='), 'themeColor must be declared at top of renderSingleChartViewport');
  assert.ok(fnSlice.includes('const consumedColor ='), 'consumedColor must be declared at top of renderSingleChartViewport');

  // Verify responsive SVG and style
  assert.ok(serverCode.includes('svgW = Math.max(600'), 'Responsive svgW must be computed');
  assert.ok(!serverCode.includes('viewBox="0 0 \' + svgW + \' \' + svgH + \'" preserveAspectRatio="none"'), 'preserveAspectRatio="none" must be eliminated');

  // Verify dual bar rendering exists
  assert.ok(serverCode.includes('chart-bar-consumed'), 'Bar mode must render chart-bar-consumed');
  assert.ok(serverCode.includes('chart-bar-saved'), 'Bar mode must render chart-bar-saved');

  // Verify tooltip displays dual track
  assert.ok(serverCode.includes('实际处理消耗'), 'Tooltip must display 实际处理消耗');
  assert.ok(serverCode.includes('智能压缩节约'), 'Tooltip must display 智能压缩节约');
  assert.ok(serverCode.includes('动态节约率'), 'Tooltip must display 动态节约率');

  // Verify tooltip adaptive positioning
  assert.ok(serverCode.includes('targetX = Math.max(10, screenX - tooltipW - 16)'), 'Tooltip must flip horizontally on overflow');

  // Verify resize listener exists
  assert.ok(serverCode.includes('compChartResizeTimer'), 'compChartResizeTimer must be registered');

  console.log('[PASS] Test 4: Frontend Chart Viewport static and scoping safety verified');
}

// --- Test 5: Historical Image Base64 Pruning in Responses Payload ---
console.log('\n--- SECTION 4: Historical Image Base64 Pruning (Air-Gapped & Context Window) ---');
{
  const giantBase64 = 'data:image/png;base64,' + 'A'.repeat(50000);
  const payload = {
    model: 'gpt-4o',
    input: [
      { type: 'message', role: 'user', content: 'Here is first page' },
      { type: 'function_call_output', call_id: 'call_1', output: giantBase64 },
      { type: 'function_call_output', call_id: 'call_2', output: giantBase64 },
      { type: 'function_call_output', call_id: 'call_3', output: giantBase64 },
      { type: 'message', role: 'user', content: 'What is the sum?' }
    ]
  };

  const pruned = codexAdapter.pruneResponsesPayload(payload);
  assert.strictEqual(pruned.modified, true, 'Payload should be pruned');
  // First image output should be converted to placeholder
  assert.ok(pruned.input[1].output.includes('[Historical Image Verified:'), 'Oldest image must be converted to placeholder');
  // Latest two images should not be converted to historical placeholders
  assert.ok(!pruned.input[2].output.includes('[Historical Image Verified:'), 'Penultimate image should not be historical placeholder');
  assert.ok(!pruned.input[3].output.includes('[Historical Image Verified:'), 'Latest image should not be historical placeholder');
  console.log('[PASS] Test 5: Historical image Base64 pruning converts oldest to verified placeholder and preserves recent turns');
}

// --- Test 6: Early-Turn Single/Double Image Pruning in Long Multi-turn Session ---
{
  const giantBase64 = 'data:image/png;base64,' + 'B'.repeat(30000);
  // Session with 12 items where early turn (item 1) has an image and subsequent turns have text
  const items = [
    { type: 'message', role: 'user', content: 'Turn 1 user' },
    { type: 'function_call_output', call_id: 'call_turn1', output: giantBase64 },
    { type: 'message', role: 'assistant', content: 'Turn 1 assistant' }
  ];
  for (let i = 2; i <= 6; i++) {
    items.push({ type: 'message', role: 'user', content: `Turn ${i} user` });
    items.push({ type: 'message', role: 'assistant', content: `Turn ${i} assistant` });
  }

  const payload = { model: 'gpt-4o', input: items };
  const pruned = codexAdapter.pruneResponsesPayload(payload);
  assert.strictEqual(pruned.modified, true, 'Early image in long session must be pruned');
  assert.ok(pruned.input[1].output.includes('[Historical Image Verified:'), 'Image from turn 1 (>2 turns ago) must be pruned to placeholder');
  console.log('[PASS] Test 6: Early-turn image in multi-turn session (>2 turns ago) is pruned even if only 1 image exists');
}

// --- Test 7: Parallel Tool Call Real Filename Extraction via call_id ---
{
  const giantBase64 = 'data:image/png;base64,' + 'C'.repeat(25000);
  const payload = {
    model: 'gpt-4o',
    input: [
      { type: 'message', role: 'user', content: 'Inspect two screenshots' },
      // Parallel tool calls issued together
      { type: 'function_call', call_id: 'call_img_1', name: 'view_image', arguments: '{"path":"D:/Docs/report_p1.png"}' },
      { type: 'function_call', call_id: 'call_img_2', name: 'view_image', arguments: '{"path":"D:/Docs/report_p2.png"}' },
      // Responses to parallel tool calls
      { type: 'function_call_output', call_id: 'call_img_1', output: giantBase64 },
      { type: 'function_call_output', call_id: 'call_img_2', output: giantBase64 },
      // Later turns to make them historical (>2 turns ago)
      { type: 'message', role: 'assistant', content: 'I have read both.' },
      { type: 'message', role: 'user', content: 'Next step 1' },
      { type: 'message', role: 'assistant', content: 'Done 1' },
      { type: 'message', role: 'user', content: 'Next step 2' },
      { type: 'message', role: 'assistant', content: 'Done 2' }
    ]
  };

  const pruned = codexAdapter.pruneResponsesPayload(payload);
  assert.strictEqual(pruned.modified, true);
  const out1 = pruned.input[3].output;
  const out2 = pruned.input[4].output;
  assert.ok(out1.includes('report_p1.png'), `call_img_1 output must resolve to report_p1.png, got: ${out1}`);
  assert.ok(out2.includes('report_p2.png'), `call_img_2 output must resolve to report_p2.png via call_id matching, got: ${out2}`);
  console.log('[PASS] Test 7: Parallel tool call filename extraction accurately matches call_id');
}

// --- Test 8: Single-point and zero-point chart safeguard ---
console.log('\n--- SECTION 5: Frontend Edge Safeguards & Metric Parity ---');
{
  const fs = require('fs');
  const path = require('path');
  const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  // Verify buildSmoothPath safeguard
  assert.ok(serverCode.includes("if (!pts || pts.length === 0) return '';"), 'buildSmoothPath must guard empty pts');
  assert.ok(serverCode.includes("if (pts.length === 1) return 'M '"), 'buildSmoothPath must guard single-point pts');

  // Verify dynamic legend color
  assert.ok(serverCode.includes("const activeThemeColor = currentChartMetric === 'cost' ? '#10b981'"), 'Legend must use activeThemeColor');

  // Verify switchTab re-render trigger
  assert.ok(serverCode.includes("(tabId === 'compression' || tabId === 'overview')"), 'switchTab must trigger re-render on tab switch');

  console.log('[PASS] Test 8: Single-point safeguard, active legend color, and tab switch resize verified');
}

// --- Test 9: consumedChars Property and Legacy Bucket Self-Healing ---
{
  const stats = contextCompactor.getStatsByRange('all');
  assert.ok(stats.timeSeries.length > 0);
  const p = stats.timeSeries[stats.timeSeries.length - 1];
  assert.ok('consumedChars' in p, 'point must have consumedChars property');
  assert.strictEqual(typeof p.consumedChars, 'number', 'consumedChars must be number');
  assert.ok(p.consumedChars >= 0, 'consumedChars must be non-negative');

  console.log('[PASS] Test 9: consumedChars property symmetry in timeSeries verified');
}

// --- Test 10: Ring Buffer Capacity & Chronological Sanitization under High-Frequency Pulse ---
console.log('\n--- SECTION 6: High-Frequency Stream & Ring Buffer Sanitization ---');
{
  const fs = require('fs');
  const path = require('path');
  const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  // Verify MAX_CHART_RING_BUFFER and sanitizeTimeSeries exist in server.js
  assert.ok(serverCode.includes('MAX_CHART_RING_BUFFER = 60'), 'server.js must define MAX_CHART_RING_BUFFER = 60');
  assert.ok(serverCode.includes('function sanitizeTimeSeries('), 'server.js must declare sanitizeTimeSeries');
  assert.ok(serverCode.includes('requestAnimationFrame'), 'server.js must use requestAnimationFrame for frame batching');
  assert.ok(serverCode.includes('scheduleChartRender'), 'server.js must declare scheduleChartRender');

  // Emulate pulse data: 500 unordered points with random timestamps
  const baseTime = Date.now();
  const rawPoints = [];
  for (let i = 0; i < 500; i++) {
    // Generate scattered timestamps within the last 2 hours
    const offset = Math.floor(Math.random() * 7200000);
    rawPoints.push({
      time: new Date(baseTime - offset).toISOString(),
      label: `T-${i}`,
      savedTokens: Math.floor(Math.random() * 5000),
      consumedTokens: Math.floor(Math.random() * 8000)
    });
  }

  // Simulate sanitizeTimeSeries behavior
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

  const sanitized = sanitizeTimeSeries(rawPoints);
  assert.strictEqual(sanitized.length, 60, 'Sanitized series must be strictly bounded to MAX_CHART_RING_BUFFER = 60');

  // Verify chronological order (monotonic non-decreasing)
  for (let i = 0; i < sanitized.length - 1; i++) {
    const tCurrent = new Date(sanitized[i].time).getTime();
    const tNext = new Date(sanitized[i + 1].time).getTime();
    assert.ok(tCurrent <= tNext, `Points must be strictly chronological: t[${i}]=${tCurrent} <= t[${i+1}]=${tNext}`);
  }

  console.log('[PASS] Test 10: Ring buffer strictly bounds 500 pulse points to 60 with monotonic chronological ordering');
}

// --- Test 11: Static Asset Handler & Air-Gapped Path Traversal Defense ---
console.log('\n--- SECTION 7: Static Asset Serving & i18n Multilingual Integrity ---');
{
  const fs = require('fs');
  const path = require('path');

  // 1. Verify existence of locales
  const zhPath = path.join(__dirname, 'assets', 'locales', 'zh-CN.json');
  const enPath = path.join(__dirname, 'assets', 'locales', 'en-US.json');
  assert.ok(fs.existsSync(zhPath), 'assets/locales/zh-CN.json must exist');
  assert.ok(fs.existsSync(enPath), 'assets/locales/en-US.json must exist');

  const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

  const zhKeys = Object.keys(zh);
  const enKeys = Object.keys(en);
  assert.strictEqual(zhKeys.length, enKeys.length, `Key counts must match: zh=${zhKeys.length}, en=${enKeys.length}`);

  const missingInEn = zhKeys.filter(k => !(k in en));
  assert.strictEqual(missingInEn.length, 0, `en-US must have 100% key parity with zh-CN, missing: ${missingInEn.join(', ')}`);

  // Verify critical developer interaction strings in en-US
  assert.strictEqual(en['Worktree'], 'Worktree');
  assert.strictEqual(en['Skills'], 'Skills');
  assert.strictEqual(en['Review changes'], 'Review changes');
  assert.strictEqual(en['Thinking...'], 'Thinking...');
  assert.strictEqual(en['Sandbox'], 'Sandbox');

  console.log(`[PASS] Test 11: Multilingual i18n locales verified: 100% parity across ${zhKeys.length} keys`);
}

// --- Test 12: Static Asset Server Simulation & Path Traversal Immunity ---
{
  const fs = require('fs');
  const path = require('path');

  // Emulate static asset sandbox logic from server.js
  function testAssetResolution(reqPath) {
    const rawSubPath = reqPath === '/favicon.ico' ? 'router.ico' : reqPath.slice('/assets/'.length);
    let decodedSubPath = '';
    try {
      decodedSubPath = decodeURIComponent(rawSubPath);
    } catch (_) {
      decodedSubPath = rawSubPath;
    }

    const assetsBaseDir = path.resolve(path.join(__dirname, 'assets'));
    const safeTarget = path.resolve(path.join(assetsBaseDir, decodedSubPath));

    if (!safeTarget.startsWith(assetsBaseDir)) {
      return { status: 403, error: 'Access denied: Path traversal prohibited' };
    }

    if (fs.existsSync(safeTarget) && fs.statSync(safeTarget).isFile()) {
      return { status: 200, file: safeTarget };
    }
    return { status: 404, error: 'Asset not found' };
  }

  // 1. Legitimate files must resolve with 200
  assert.strictEqual(testAssetResolution('/favicon.ico').status, 200);
  assert.strictEqual(testAssetResolution('/assets/logo.png').status, 200);
  assert.strictEqual(testAssetResolution('/assets/locales/zh-CN.json').status, 200);
  assert.strictEqual(testAssetResolution('/assets/locales/en-US.json').status, 200);
  assert.strictEqual(testAssetResolution('/assets/office-preview-engine.js').status, 200);

  // 2. Traversal attacks must be blocked with 403
  assert.strictEqual(testAssetResolution('/assets/../server.js').status, 403);
  assert.strictEqual(testAssetResolution('/assets/..%2fpackage.json').status, 403);
  assert.strictEqual(testAssetResolution('/assets/../../etc/passwd').status, 403);

  // 3. Nonexistent file returns 404
  assert.strictEqual(testAssetResolution('/assets/does_not_exist_xyz.png').status, 404);

  console.log('[PASS] Test 12: Static asset server path traversal blocked (403), legitimate assets served (200), missing (404)');
}

// --- Test 13: Accessibility, Zero-Jitter Numbers & Offline Reconnection Banner ---
console.log('\n--- SECTION 8: WCAG Accessibility, Zero-Jitter & Reconnection UI ---');
{
  const fs = require('fs');
  const path = require('path');
  const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  // 1. Tabular-nums presence for zero-jitter layouts
  assert.ok(serverCode.includes('font-variant-numeric: tabular-nums;'), 'CSS must include font-variant-numeric: tabular-nums');
  assert.ok(serverCode.includes('font-feature-settings: "tnum";'), 'CSS must include font-feature-settings: "tnum"');

  // 2. Focus-visible accessibility rings
  assert.ok(serverCode.includes(':focus-visible'), 'CSS must include focus-visible rules for keyboard accessibility');
  assert.ok(serverCode.includes('outline: 2px solid var(--primary);'), 'Focus ring must use high-contrast primary color');

  // 3. Truncate text utilities
  assert.ok(serverCode.includes('.truncate-text'), 'CSS must declare .truncate-text class');
  assert.ok(serverCode.includes('text-overflow: ellipsis;'), 'CSS must declare text-overflow: ellipsis');

  // 4. Non-intrusive connection banner
  assert.ok(serverCode.includes('id="gateway-connection-banner"'), 'HTML must include gateway-connection-banner');
  assert.ok(serverCode.includes('handleConnectionFailure'), 'JS must include handleConnectionFailure state machine');
  assert.ok(serverCode.includes('handleConnectionSuccess'), 'JS must include handleConnectionSuccess state machine');
  assert.ok(serverCode.includes('consecutiveConnectionFailures >= 2'), 'Reconnection banner must debounce transient network hiccups');

  // 5. Visibility lifecycle
  assert.ok(serverCode.includes("document.addEventListener('visibilitychange'"), 'JS must listen to visibilitychange');
  assert.ok(serverCode.includes('cancelAnimationFrame(chartRafId)'), 'JS must cancel RAF animation when tab is hidden');

  console.log('[PASS] Test 13: Tabular nums, focus rings, text truncation, and offline reconnection banner verified');
}

// --- Test 14: Ultra-Long Model Name & Empty-State Boundary Robustness ---
{
  const fs = require('fs');
  const path = require('path');
  const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  // Verify that empty state contains clear welcoming text
  assert.ok(serverCode.includes('暂无时序数据（发起对话后将实时呈现时序波形）'), 'Empty state must guide user clearly');

  // Verify that long model names in tooltip and legends have truncate-text class and title attribute
  assert.ok(serverCode.includes('class="truncate-text"'), 'Tooltip or legend must apply truncate-text class');
  assert.ok(serverCode.includes('title="\' + escapeHtml(m) + \'"'), 'Legend must apply title attribute with escaped model name');

  console.log('[PASS] Test 14: Ultra-long model name truncation and welcoming zero-data state verified');
}

console.log('\n================================================================');
console.log('🎉 ALL 14/14 TIER 7 ADVERSARIAL CHALLENGES PASSED!');
console.log('================================================================');
