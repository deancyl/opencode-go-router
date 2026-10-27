const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// --- Test Sandbox Isolation Setup (Rule 55: Never pollute production stats) ---
const testTempDir = path.join(os.tmpdir(), 'opencode-test-telemetry-' + Date.now() + '-' + Math.random().toString(36).slice(2));
fs.mkdirSync(testTempDir, { recursive: true });
const tempStatsFile = path.join(testTempDir, 'compression-stats.test.json');
const tempHistFile = path.join(testTempDir, 'compression-history.test.json');

process.env.OPENCODE_TEST_MODE = '1';
process.env.COMPRESSION_SANDBOX = '1';
process.env.COMPRESSION_STATS_FILE = tempStatsFile;
process.env.COMPRESSION_HISTORY_FILE = tempHistFile;
delete process.env.ALLOW_PROD_STATS_IN_TEST;

const prodStatsPath = path.join(__dirname, 'compression-stats.json');
const prodHistPath = path.join(__dirname, 'compression-history.json');
const prodStatsMtimeBefore = fs.existsSync(prodStatsPath) ? fs.statSync(prodStatsPath).mtimeMs : 0;
const prodHistMtimeBefore = fs.existsSync(prodHistPath) ? fs.statSync(prodHistPath).mtimeMs : 0;
const prodStatsContentBefore = fs.existsSync(prodStatsPath) ? fs.readFileSync(prodStatsPath, 'utf8') : '';
const prodHistContentBefore = fs.existsSync(prodHistPath) ? fs.readFileSync(prodHistPath, 'utf8') : '';
let bucketsD1CountBefore = 0;
let bucketsH1CountBefore = 0;
let bucketsM5CountBefore = 0;
try {
  const parsedBefore = JSON.parse(prodHistContentBefore);
  bucketsD1CountBefore = parsedBefore.buckets?.d1?.length || 0;
  bucketsH1CountBefore = parsedBefore.buckets?.h1?.length || 0;
  bucketsM5CountBefore = parsedBefore.buckets?.m5?.length || 0;
} catch (_) {}

function cleanupSandbox() {
  try {
    if (fs.existsSync(testTempDir)) {
      if (typeof fs.rmSync === 'function') {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      } else {
        if (fs.existsSync(tempStatsFile)) fs.unlinkSync(tempStatsFile);
        if (fs.existsSync(tempHistFile)) fs.unlinkSync(tempHistFile);
        if (fs.existsSync(tempStatsFile + '.bak')) fs.unlinkSync(tempStatsFile + '.bak');
        if (fs.existsSync(tempHistFile + '.bak')) fs.unlinkSync(tempHistFile + '.bak');
        fs.rmdirSync(testTempDir);
      }
    }
  } catch (_) {}
}
process.on('exit', cleanupSandbox);

console.log('================================================================');
console.log('🧪 Starting Telemetry, 3-Tier Pricing & Day Slots Verification');
console.log('================================================================');

const contextCompactor = require('./context-compactor');

// --- Test 1: OpenCode 3-Tier Pricing Model ---
console.log('\n--- TEST 1: OpenCode 3-Tier Pricing Model ---');
{
  assert.ok(contextCompactor.OPENCODE_OFFICIAL_PRICING, 'OPENCODE_OFFICIAL_PRICING must be exported');
  
  // 1. Verify DeepSeek v4.1 flash pricing
  const dsPricing = contextCompactor.getModelPricing('deepseek-v4.1-flash');
  assert.strictEqual(dsPricing.input, 0.14, 'DS flash input price should be 0.14');
  assert.strictEqual(dsPricing.cacheRead, 0.014, 'DS flash cacheRead price should be 0.014');
  assert.strictEqual(dsPricing.output, 0.28, 'DS flash output price should be 0.28');

  // 2. Verify Claude 3.5 Sonnet pricing
  const claudePricing = contextCompactor.getModelPricing('claude-3-5-sonnet');
  assert.strictEqual(claudePricing.input, 3.00, 'Claude 3.5 Sonnet input price should be 3.00');
  assert.strictEqual(claudePricing.cacheRead, 0.30, 'Claude 3.5 Sonnet cacheRead price should be 0.30');
  assert.strictEqual(claudePricing.output, 15.00, 'Claude 3.5 Sonnet output price should be 15.00');

  // 3. Backward compatibility of getModelRate
  assert.strictEqual(contextCompactor.getModelRate('deepseek-v4.1-flash'), 0.14);
  assert.strictEqual(contextCompactor.getModelRate('claude-haiku-5-5:latest'), 1.25);

  // 4. calculateCost calculation verification
  // Input: 10,000 tokens (5,000 cached, 5,000 regular), Output: 2,000 tokens, Saved: 1,000 tokens
  // Expected actualCost = (5000/1e6)*0.14 + (5000/1e6)*0.014 + (2000/1e6)*0.28
  //                     = 0.0007 + 0.00007 + 0.00056 = 0.00133
  // Expected savedCost  = (1000/1e6)*0.14 = 0.00014
  const costRes = contextCompactor.calculateCost('deepseek-v4.1-flash', 10000, 2000, 5000, 1000);
  assert.ok(Math.abs(costRes.actualCost - 0.00133) < 1e-8, `actualCost should be 0.00133, got ${costRes.actualCost}`);
  assert.ok(Math.abs(costRes.savedCost - 0.00014) < 1e-8, `savedCost should be 0.00014, got ${costRes.savedCost}`);

  console.log('[PASS] Test 1: 3-tier pricing and calculateCost verified');
}

// --- Test 2: Local Day Natural Slotting ---
console.log('\n--- TEST 2: Local Day Natural Slotting (UTC+8 / Local Midnight) ---');
{
  assert.ok(typeof contextCompactor.getLocalDayStartTimestamp === 'function', 'getLocalDayStartTimestamp must be exported');

  const now = Date.now();
  const dayStart = contextCompactor.getLocalDayStartTimestamp(now);
  const d = new Date(dayStart);

  assert.strictEqual(d.getHours(), 0, 'Hour must be 00');
  assert.strictEqual(d.getMinutes(), 0, 'Minute must be 00');
  assert.strictEqual(d.getSeconds(), 0, 'Second must be 00');
  assert.strictEqual(d.getMilliseconds(), 0, 'Millisecond must be 000');

  // Morning timestamp and afternoon timestamp on the same day must map to the same slot
  const morningTs = new Date(now).setHours(2, 30, 0, 0);
  const eveningTs = new Date(now).setHours(22, 45, 0, 0);
  assert.strictEqual(
    contextCompactor.getLocalDayStartTimestamp(morningTs),
    contextCompactor.getLocalDayStartTimestamp(eveningTs),
    'Morning and evening on the same day must share the exact same slot'
  );

  console.log(`[PASS] Test 2: Local day alignment verified at ${d.toISOString()}`);
}

// --- Test 3: Upstream Request Telemetry Recording ---
console.log('\n--- TEST 3: recordRequestTelemetry Integration ---');
{
  const beforeStats = contextCompactor.getStatsByRange('all');
  const beforeConsumed = beforeStats.consumedTokens || 0;
  const beforeSaved = beforeStats.savedTokens || 0;

  // Record a simulated request
  contextCompactor.recordRequestTelemetry({
    model: 'deepseek-v4.1-flash',
    inputTokens: 3000,
    outputTokens: 500,
    cachedTokens: 1000,
    savings: { savedTokens: 800, savedChars: 3200 },
    timestamp: Date.now()
  });

  const afterStats = contextCompactor.getStatsByRange('all');
  const afterConsumed = afterStats.consumedTokens || 0;
  const afterSaved = afterStats.savedTokens || 0;

  assert.strictEqual(afterConsumed, beforeConsumed + 3500, 'Consumed tokens should increment by input + output (3500)');
  assert.strictEqual(afterSaved, beforeSaved + 800, 'Saved tokens should increment by 800');

  console.log(`[PASS] Test 3: Telemetry recorded: Consumed ${beforeConsumed} -> ${afterConsumed}, Saved ${beforeSaved} -> ${afterSaved}`);
}

// --- Test 4: Verification of 90-Day Retention Configuration ---
console.log('\n--- TEST 4: 90-Day Retention Configuration ---');
{
  assert.strictEqual(contextCompactor.BUCKET_DEFINITIONS.d1.maxBuckets, 90, 'd1 bucket maxBuckets must be 90');
  assert.strictEqual(contextCompactor.BUCKET_DEFINITIONS.d1.maxAgeMs, 90 * 24 * 3600 * 1000, 'd1 bucket maxAgeMs must be 90 days');
  assert.strictEqual(contextCompactor.RANGE_CONFIG.all.windowMs, 90 * 24 * 3600 * 1000, 'RANGE_CONFIG.all windowMs must be 90 days');

  console.log('[PASS] Test 4: 90-day retention verified');
}

// --- Test 5: Elimination of Today Single-Point Burst Bug ---
console.log('\n--- TEST 5: Elimination of Today Single-Point Burst Bug ---');
{
  // When there are no historical buckets in a range, buildTimeSeries must NOT inject
  // historical compressionStats into today's single point!
  const emptyBuckets = [];
  const series = contextCompactor.buildTimeSeries('all', emptyBuckets, Date.now());
  assert.ok(Array.isArray(series), 'series must be an array');
  assert.ok(series.length > 0, 'series must have slots');

  // Verify all points are honest 0s and lastPoint is NOT inflated to historical total
  const lastPoint = series[series.length - 1];
  assert.strictEqual(lastPoint.savedTokens, 0, 'Empty buckets should yield 0 savedTokens on last point, not historical dump');
  assert.strictEqual(lastPoint.consumedTokens, 0, 'Empty buckets should yield 0 consumedTokens on last point, not historical dump');

  console.log('[PASS] Test 5: Single-point burst bug elimination verified');
}

// --- Test 6: Frontend Dual-Track SVG and Tooltip Markup in server.js ---
console.log('\n--- TEST 6: Frontend Dual-Track SVG and Tooltip Markup in server.js ---');
{
  const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  // Legends
  assert.ok(serverCode.includes('理论总输入 (左柱灰)'), 'Legends must include 理论总输入 (左柱灰)');
  assert.ok(serverCode.includes('实际发出消耗 (右柱实色)'), 'Legends must include 实际发出消耗 (右柱实色)');
  assert.ok(serverCode.includes('压缩节约 (虚线帽/节约带)'), 'Legends must include 压缩节约 (虚线帽/节约带)');

  // Bar rendering classes
  assert.ok(serverCode.includes('chart-bar-consumed chart-bar-orig'), 'Must render chart-bar-consumed chart-bar-orig for left bar');
  assert.ok(serverCode.includes('chart-bar-actual'), 'Must render chart-bar-actual for right bar bottom');
  assert.ok(serverCode.includes('chart-bar-saved chart-bar-saved-cap'), 'Must render chart-bar-saved chart-bar-saved-cap for dashed hat');

  // Area rendering
  assert.ok(serverCode.includes('savingsBandD'), 'Area mode must compute savingsBandD for translucent band');
  assert.ok(serverCode.includes('origPathD'), 'Area mode must compute origPathD for theoretical dashed line');

  // Tooltip
  assert.ok(serverCode.includes('理论总输入 (未压缩):'), 'Tooltip must display 理论总输入 (未压缩):');
  assert.ok(serverCode.includes('实际处理消耗 (压缩后):'), 'Tooltip must display 实际处理消耗 (压缩后):');
  assert.ok(serverCode.includes('智能压缩节约 (虚线砍掉):'), 'Tooltip must display 智能压缩节约 (虚线砍掉):');
  assert.ok(serverCode.includes('动态节约率 (实省比例):'), 'Tooltip must display 动态节约率 (实省比例):');
  assert.ok(serverCode.includes('节省金额 (USD):'), 'Tooltip must display 节省金额 (USD):');

  console.log('[PASS] Test 6: Frontend SVG markup and tooltip verified');
}

// --- Test 7: Nested Usage Extraction & Merging Defense ---
console.log('\n--- TEST 7: Nested Usage Extraction & Multi-Chunk Merging Defense ---');
{
  const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(serverCode.includes('function extractUsageFromBuffer'), 'server.js must define extractUsageFromBuffer');
  assert.ok(serverCode.includes('function mergeUsageObjects'), 'server.js must define mergeUsageObjects');

  // Eval extractUsageFromBuffer and mergeUsageObjects directly from server.js
  const vm = require('vm');
  const sandbox = {};
  const extractCode = serverCode.match(/function extractUsageFromBuffer[\s\S]+?return null;\s*\}/)[0];
  const mergeCode = serverCode.match(/function mergeUsageObjects[\s\S]+?return res;\s*\}/)[0];
  vm.runInNewContext(extractCode + '\n' + mergeCode, sandbox);

  // 1. Nested prompt_tokens_details parsing (standard OpenAI / DeepSeek prompt cache)
  const nestedOpenAI = JSON.stringify({
    id: "chatcmpl-test",
    usage: {
      prompt_tokens: 1500,
      completion_tokens: 300,
      total_tokens: 1800,
      prompt_tokens_details: { cached_tokens: 1200 }
    }
  });
  const parsed1 = sandbox.extractUsageFromBuffer(nestedOpenAI);
  assert.ok(parsed1, 'Must extract nested usage object');
  assert.strictEqual(parsed1.prompt_tokens, 1500);
  assert.strictEqual(parsed1.completion_tokens, 300);
  assert.strictEqual(parsed1.prompt_tokens_details.cached_tokens, 1200);

  // 2. Multi-chunk Anthropic SSE merging (message_start has input, message_delta has output)
  const part1 = { input_tokens: 800, cache_read_input_tokens: 600 };
  const part2 = { output_tokens: 250 };
  const merged = sandbox.mergeUsageObjects(part1, part2);
  assert.strictEqual(merged.input_tokens, 800);
  assert.strictEqual(merged.cache_read_input_tokens, 600);
  assert.strictEqual(merged.output_tokens, 250);

  console.log('[PASS] Test 7: Nested usage extraction and multi-chunk merging verified');
}

// --- Test 8: 1h, 24h & 7d Range Stats Accumulate Real Consumed Tokens & Cost ---
console.log('\n--- TEST 8: 1h, 24h & 7d Range Stats Accumulate Real Consumed Tokens & Cost ---');
{
  const testNow = Date.now();
  contextCompactor.recordRequestTelemetry({
    model: 'deepseek-v4.1-flash',
    inputTokens: 4000,
    outputTokens: 1000,
    cachedTokens: 2000,
    timestamp: testNow
  });

  const s1h = contextCompactor.getStatsByRange('1h', testNow);
  assert.ok(s1h.consumedTokens >= 5000, `1h consumedTokens must be at least 5000, got ${s1h.consumedTokens}`);
  assert.ok(s1h.consumedCostUSD > 0, `1h consumedCostUSD must be > 0, got ${s1h.consumedCostUSD}`);
  assert.ok(s1h.byModel['deepseek-v4.1-flash'], '1h byModel must include deepseek-v4.1-flash');
  assert.ok(s1h.byModel['deepseek-v4.1-flash'].consumedTokens >= 5000, 'byModel consumedTokens must be at least 5000');

  const s24h = contextCompactor.getStatsByRange('24h', testNow);
  assert.ok(s24h.consumedTokens >= 5000, `24h consumedTokens must be at least 5000, got ${s24h.consumedTokens}`);

  const s7d = contextCompactor.getStatsByRange('7d', testNow);
  assert.ok(s7d.consumedTokens >= 5000, `7d consumedTokens must be at least 5000, got ${s7d.consumedTokens}`);

  console.log(`[PASS] Test 8: 1h/24h/7d range accumulation verified (1h tokens=${s1h.consumedTokens}, cost=$${s1h.consumedCostUSD})`);
}

// --- Test 9: Dual Protocol Cache Math (OpenAI inTok >= cTok vs Anthropic inTok < cTok) ---
console.log('\n--- TEST 9: Dual Protocol Cache Read Math ---');
{
  // OpenAI: prompt_tokens=1000 (which includes cached_tokens=800)
  const oaiCost = contextCompactor.calculateCost('deepseek-v4.1-flash', 1000, 200, 800, 0);
  // regular = 200, cached = 800, output = 200
  // (200/1e6)*0.14 + (800/1e6)*0.014 + (200/1e6)*0.28 = 0.000028 + 0.0000112 + 0.000056 = 0.0000952
  assert.ok(Math.abs(oaiCost.actualCost - 0.0000952) < 1e-7, `OpenAI cost expected ~0.0000952, got ${oaiCost.actualCost}`);

  // Anthropic: input_tokens=200 (uncached), cached_tokens=800 (reported separately)
  const anthropicCost = contextCompactor.calculateCost('deepseek-v4.1-flash', 200, 200, 800, 0);
  assert.ok(Math.abs(anthropicCost.actualCost - 0.0000952) < 1e-7, `Anthropic cost expected ~0.0000952, got ${anthropicCost.actualCost}`);

  console.log('[PASS] Test 9: Dual protocol cache read math verified');
}

// --- Test 10: getDaySlotTimestamp DST Resilience & Alignment ---
console.log('\n--- TEST 10: getDaySlotTimestamp DST Resilience & Alignment ---');
{
  assert.strictEqual(typeof contextCompactor.getDaySlotTimestamp, 'function', 'getDaySlotTimestamp must be exported');
  const todayStart = contextCompactor.getLocalDayStartTimestamp();
  const dayBefore = contextCompactor.getDaySlotTimestamp(todayStart, 1);
  const dBefore = new Date(dayBefore);

  assert.strictEqual(dBefore.getHours(), 0, 'Hour must be 00');
  assert.strictEqual(dBefore.getMinutes(), 0, 'Minute must be 00');
  assert.strictEqual(dBefore.getSeconds(), 0, 'Second must be 00');
  assert.strictEqual(dBefore.getMilliseconds(), 0, 'Millisecond must be 000');

  const dToday = new Date(todayStart);
  assert.strictEqual((dToday.getDate() - dBefore.getDate() + 31) % 31, 1, 'Date difference must be exactly 1 day');

  console.log('[PASS] Test 10: getDaySlotTimestamp DST resilience and midnight alignment verified');
}

// --- Test 11: Bezier Curve Lower Bound Clamp (Anti-Negative Overshoot) & Band Smoothing ---
console.log('\n--- TEST 11: Bezier Curve Lower Bound Clamp (Anti-Negative Overshoot) & Band Smoothing ---');
{
  const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  // Verify server.js contains the clamp logic in both buildSmoothPath and buildSmoothBand
  assert.ok(serverCode.includes('cp1y = Math.min(xBaseY, cp1y)'), 'buildSmoothPath must clamp cp1y to xBaseY');
  assert.ok(serverCode.includes('cp2y = Math.min(xBaseY, cp2y)'), 'buildSmoothPath must clamp cp2y to xBaseY');
  assert.ok(serverCode.includes('if ((p1.val === 0 && p2.val === 0) || (p1.y >= xBaseY && p2.y >= xBaseY))'), 'Must flatten baseline when adjacent points are 0');

  const xBaseY = 220;
  const vm = require('vm');
  const smoothFnCode = serverCode.match(/const buildSmoothPath = \([\s\S]+?\n        \};/)[0];
  const smoothBandCode = serverCode.match(/const buildSmoothBand = \([\s\S]+?\n        \};/)[0];

  const verifyPathCurves = (pathD, expectedCurveCount, desc) => {
    assert.ok(pathD, `${desc} must return non-empty path`);
    const cubicRegex = /C\s+([\d.-]+)\s+([\d.-]+),\s+([\d.-]+)\s+([\d.-]+),\s+([\d.-]+)\s+([\d.-]+)/g;
    let match;
    let count = 0;
    while ((match = cubicRegex.exec(pathD)) !== null) {
      const cp1y = parseFloat(match[2]);
      const cp2y = parseFloat(match[4]);
      const p2y = parseFloat(match[6]);
      assert.ok(cp1y <= xBaseY + 1e-4, `${desc}: curve ${count} cp1y (${cp1y}) must NOT exceed baseline xBaseY (${xBaseY})`);
      assert.ok(cp2y <= xBaseY + 1e-4, `${desc}: curve ${count} cp2y (${cp2y}) must NOT exceed baseline xBaseY (${xBaseY})`);
      assert.ok(p2y <= xBaseY + 1e-4, `${desc}: curve ${count} p2y (${p2y}) must NOT exceed baseline xBaseY (${xBaseY})`);
      count++;
    }
    if (expectedCurveCount !== null) {
      assert.strictEqual(count, expectedCurveCount, `${desc}: curve count must be ${expectedCurveCount}`);
    }
  };

  // 1. Case A: User Issue Replication: 10-24: 1000, 10-25: 0, 10-26: 0, 10-27: 6000
  {
    const pts = [
      { x: 50, y: 180, val: 1000 },
      { x: 100, y: xBaseY, val: 0 },
      { x: 150, y: xBaseY, val: 0 },
      { x: 200, y: 50, val: 6000 }
    ];
    const sandbox = { xBaseY, Math, pts };
    vm.runInNewContext(smoothFnCode + '\nresult = buildSmoothPath(pts);', sandbox);
    verifyPathCurves(sandbox.result, 3, 'Case A (Double Zero Baseline)');

    // Verify curve 1 (10-25 to 10-26) is strictly flat
    const cubicRegex = /C\s+([\d.-]+)\s+([\d.-]+),\s+([\d.-]+)\s+([\d.-]+),\s+([\d.-]+)\s+([\d.-]+)/g;
    cubicRegex.exec(sandbox.result);
    const m2 = cubicRegex.exec(sandbox.result);
    assert.strictEqual(parseFloat(m2[2]), xBaseY, 'Zero-interval cp1y must be strictly flat');
    assert.strictEqual(parseFloat(m2[4]), xBaseY, 'Zero-interval cp2y must be strictly flat');
    assert.strictEqual(parseFloat(m2[6]), xBaseY, 'Zero-interval p2y must be strictly flat');
  }

  // 2. Case B: Isolated Single Zero Drop: [1000, 0, 6000]
  {
    const pts = [
      { x: 50, y: 180, val: 1000 },
      { x: 100, y: xBaseY, val: 0 },
      { x: 150, y: 50, val: 6000 }
    ];
    const sandbox = { xBaseY, Math, pts };
    vm.runInNewContext(smoothFnCode + '\nresult = buildSmoothPath(pts);', sandbox);
    verifyPathCurves(sandbox.result, 2, 'Case B (Isolated Single Zero)');
  }

  // 3. Case C: Extreme Spike Drop: [0, 1000000, 0]
  {
    const pts = [
      { x: 50, y: xBaseY, val: 0 },
      { x: 100, y: 20, val: 1000000 },
      { x: 150, y: xBaseY, val: 0 }
    ];
    const sandbox = { xBaseY, Math, pts };
    vm.runInNewContext(smoothFnCode + '\nresult = buildSmoothPath(pts);', sandbox);
    verifyPathCurves(sandbox.result, 2, 'Case C (Extreme Spike Drop)');
  }

  // 4. Case D: Continuous All-Zeroes: [0, 0, 0, 0]
  {
    const pts = [
      { x: 50, y: xBaseY, val: 0 },
      { x: 100, y: xBaseY, val: 0 },
      { x: 150, y: xBaseY, val: 0 },
      { x: 200, y: xBaseY, val: 0 }
    ];
    const sandbox = { xBaseY, Math, pts };
    vm.runInNewContext(smoothFnCode + '\nresult = buildSmoothPath(pts);', sandbox);
    verifyPathCurves(sandbox.result, 3, 'Case D (Continuous Zeroes)');
  }

  // 5. Case E: buildSmoothBand Dual-Curve Area Banding Clamp
  {
    const topPts = [
      { x: 50, y: 140, val: 2000 },
      { x: 100, y: xBaseY, val: 0 },
      { x: 150, y: xBaseY, val: 0 },
      { x: 200, y: 30, val: 8000 }
    ];
    const btmPts = [
      { x: 50, y: 180, val: 1000 },
      { x: 100, y: xBaseY, val: 0 },
      { x: 150, y: xBaseY, val: 0 },
      { x: 200, y: 50, val: 6000 }
    ];
    const sandbox = { xBaseY, Math, topPts, btmPts };
    vm.runInNewContext(smoothBandCode + '\nresult = buildSmoothBand(topPts, btmPts);', sandbox);
    verifyPathCurves(sandbox.result, 6, 'Case E (buildSmoothBand top & bottom curves)');
  }

  console.log('[PASS] Test 11: Bezier curve lower bound clamp and flat zero baseline verified across all cases');
}

// --- Test 12: Historical Days Slots Alignment & 100% Mathematical Conservation ---
console.log('\n--- TEST 12: Historical Days Slots Alignment & 100% Mathematical Conservation ---');
{
  const hist = JSON.parse(prodHistContentBefore);
  const d1Buckets = hist.buckets?.d1 || [];
  assert.strictEqual(d1Buckets.length, 10, 'd1 buckets must contain exactly 10 historical days (10-18 to 10-27)');

  const testNow = Date.now();
  const allSeries = contextCompactor.buildTimeSeries('all', d1Buckets, testNow);
  assert.strictEqual(allSeries.length, 10, 'all timeSeries must contain exactly 10 daily slots without phantom leading day');
  assert.strictEqual(allSeries[0].label, '10-18', 'First slot must be 10-18');
  assert.strictEqual(allSeries[0].consumedTokens, 9152, '10-18 consumedTokens must be 9152');
  assert.strictEqual(allSeries[0].savedTokens, 7159, '10-18 savedTokens must be 7159');

  const todaySlot = allSeries[allSeries.length - 1];
  assert.strictEqual(todaySlot.label, '10-27', 'Last slot must be today 10-27');
  assert.strictEqual(todaySlot.consumedTokens, 0, 'Today consumedTokens must be strictly 0');
  assert.strictEqual(todaySlot.savedTokens, 0, 'Today savedTokens must be strictly 0');

  const sumTokens = allSeries.reduce((acc, p) => ({
    consumed: acc.consumed + p.consumedTokens,
    saved: acc.saved + p.savedTokens,
    origChars: acc.origChars + (p.originalChars || p.consumedChars || 0),
    savedChars: acc.savedChars + (p.savedChars || 0)
  }), { consumed: 0, saved: 0, origChars: 0, savedChars: 0 });

  assert.strictEqual(sumTokens.consumed, 74069, 'Sum of consumedTokens across all slots must equal 74069');
  assert.strictEqual(sumTokens.saved, 57940, 'Sum of savedTokens across all slots must equal 57940');
  assert.strictEqual(sumTokens.origChars, 281463, 'Sum of originalChars across all slots must equal 281463');
  assert.strictEqual(sumTokens.savedChars, 220171, 'Sum of savedChars across all slots must equal 220171');

  // Verify 7d slice waveform
  const d7Series = contextCompactor.buildTimeSeries('7d', d1Buckets, testNow);
  assert.strictEqual(d7Series.length, 7, '7d timeSeries must contain exactly 7 daily slots');
  assert.strictEqual(d7Series[0].label, '10-21', '7d start slot must be 10-21');
  assert.strictEqual(d7Series[6].label, '10-27', '7d end slot must be 10-27');
  assert.strictEqual(d7Series[6].consumedTokens, 0, '7d today slot must be 0');

  // Verify byModel 3-tier pricing rate & cost sum
  let bucketSavedCostSum = 0;
  let bucketConsumedCostSum = 0;
  for (const b of d1Buckets) {
    bucketSavedCostSum += (b.savedCostUSD || 0);
    bucketConsumedCostSum += (b.consumedCostUSD || 0);
    if (b.byModel && b.byModel['deepseek-v4.1-flash']) {
      assert.strictEqual(b.byModel['deepseek-v4.1-flash'].ratePer1M, 0.14, 'deepseek-v4.1-flash rate must be 0.14');
    }
  }
  assert.ok(Math.abs(bucketSavedCostSum - 0.0081116) < 1e-6, `Saved cost sum must be 0.0081116, got ${bucketSavedCostSum}`);
  assert.ok(Math.abs(bucketConsumedCostSum - 0.0103697) < 1e-6, `Consumed cost sum must be 0.0103697, got ${bucketConsumedCostSum}`);

  console.log('[PASS] Test 12: Historical days slots (10-18 to 10-26) alignment, waveform continuity & conservation verified');
}

// --- Test 13: Production Disk Files Zero-Pollution Verification (Rule 55) ---
console.log('\n--- TEST 13: Production Disk Files Zero-Pollution Verification ---');
{
  const mtimeStatsAfter = fs.existsSync(prodStatsPath) ? fs.statSync(prodStatsPath).mtimeMs : 0;
  const mtimeHistAfter = fs.existsSync(prodHistPath) ? fs.statSync(prodHistPath).mtimeMs : 0;

  assert.strictEqual(mtimeStatsAfter, prodStatsMtimeBefore, 'Production compression-stats.json mtime must NOT be touched by test');
  assert.strictEqual(mtimeHistAfter, prodHistMtimeBefore, 'Production compression-history.json mtime must NOT be touched by test');

  const prodStatsContentAfter = fs.existsSync(prodStatsPath) ? fs.readFileSync(prodStatsPath, 'utf8') : '';
  const prodHistContentAfter = fs.existsSync(prodHistPath) ? fs.readFileSync(prodHistPath, 'utf8') : '';

  assert.strictEqual(prodStatsContentAfter, prodStatsContentBefore, 'Production compression-stats.json content must be 100% byte-for-byte identical');
  assert.strictEqual(prodHistContentAfter, prodHistContentBefore, 'Production compression-history.json content must be 100% byte-for-byte identical');

  const liveHist = JSON.parse(prodHistContentAfter);
  assert.strictEqual(liveHist.buckets.d1.length, bucketsD1CountBefore, 'Production d1 buckets count must remain identical before and after test');
  assert.strictEqual(liveHist.buckets.h1.length, bucketsH1CountBefore, 'Production h1 buckets count must remain identical before and after test');
  assert.strictEqual(liveHist.buckets.m5.length, bucketsM5CountBefore, 'Production m5 buckets count must remain identical before and after test');

  // Verify that today's date slot (if any) in production is NOT polluted with test tokens (e.g. 6000 tokens)
  const todayStartTs = contextCompactor.getLocalDayStartTimestamp();
  const todayBucket = liveHist.buckets.d1.find(b => b.startTime === todayStartTs);
  if (todayBucket) {
    assert.strictEqual(todayBucket.consumedTokens, 0, 'Today bucket in production must have 0 consumed tokens');
  }

  console.log('[PASS] Test 13: Production files 100% byte-for-byte unpolluted and untouched');
}

console.log('\n================================================================');
console.log('🎉 ALL TELEMETRY, DAY SLOTS & CURVE TESTS PASSED (13/13)');
console.log('================================================================');


