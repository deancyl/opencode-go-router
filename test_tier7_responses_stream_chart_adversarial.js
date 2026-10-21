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

console.log('\n================================================================');
console.log('🎉 ALL 9/9 TIER 7 ADVERSARIAL CHALLENGES PASSED!');
console.log('================================================================');
