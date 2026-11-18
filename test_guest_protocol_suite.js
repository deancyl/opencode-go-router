/**
 * OpenCode Go Router - Guest Protocol Mode & Free Models Infiltration Suite
 */

const assert = require('assert');
const http = require('http');
const codexAdapter = require('./codex-adapter');
const clientAdapter = require('./client-adapter-manager');
const serverModule = require('./server');

console.log('================================================================');
console.log('Running test_guest_protocol_suite.js - Guest Mode & Free Models');
console.log('================================================================');

// 1. Verify Free Model Identification
assert.strictEqual(codexAdapter.isFreeModel('hy4-flash-free'), true);
assert.strictEqual(codexAdapter.isFreeModel('longcat-2.5-free'), true);
assert.strictEqual(codexAdapter.isFreeModel('mimo-v2.6-flash-free'), true);
assert.strictEqual(codexAdapter.isFreeModel('glm-5.3-flash-free'), true);
assert.strictEqual(codexAdapter.isFreeModel('big-pickle'), true);
assert.strictEqual(codexAdapter.isFreeModel('beam-free'), true);
assert.strictEqual(codexAdapter.isFreeModel('cat-jam-free'), true);
assert.strictEqual(codexAdapter.isFreeModel('deepseek-v4.1-flash'), false);
assert.strictEqual(codexAdapter.isFreeModel('deepseek-v4-pro'), false);
assert.strictEqual(codexAdapter.isFreeModel('qwen3.8-max'), false);
assert.strictEqual(codexAdapter.isFreeModel('claude-haiku-5-5'), false);
console.log('  [PASS] 1. codexAdapter.isFreeModel accurately identifies free vs paid models');

// 2. Verify filterModelsByPolicy with guest / freeOnly policy
const freeModels = clientAdapter.filterModelsByPolicy('guest');
assert.ok(freeModels.length >= 5, `Must have at least 5 free models, got ${freeModels.length}`);
for (const m of freeModels) {
  assert.strictEqual(codexAdapter.isFreeModel(m.slug || m.id), true, `Model ${m.slug} must be free`);
}
const hybridModels = clientAdapter.filterModelsByPolicy('hybrid');
assert.ok(hybridModels.length > freeModels.length, 'Hybrid policy must include paid models');
console.log(`  [PASS] 2. filterModelsByPolicy in guest mode returns ${freeModels.length} free-only models`);

// 3. Verify Fallback inside Free Model Ladder
const fb1 = codexAdapter.resolveCompatibleFallbackModel('cat-jam-free', 'model_not_found', { isGuest: true });
assert.strictEqual(fb1, 'hy4-flash-free');
const fb2 = codexAdapter.resolveCompatibleFallbackModel('beam-free', 'RegionError', { isGuest: true });
assert.strictEqual(fb2, 'hy4-flash-free');
const fb3 = codexAdapter.resolveCompatibleFallbackModel('hy4-flash-free', "Model isn't included in OpenCode Go", { isGuest: true });
assert.strictEqual(fb3, 'longcat-2.5-free');
console.log('  [PASS] 3. Fallback within guest mode strictly traverses free models ladder');

// 4. Verify classifyUpstreamError handling
const freeUsageErr = serverModule.classifyUpstreamError(429, 'Free usage limit reached. Free models work in OpenCode...');
assert.strictEqual(freeUsageErr.isFreeUsageLimit, true);
assert.strictEqual(freeUsageErr.isQuotaExhausted, true);

const subEndedErr = serverModule.classifyUpstreamError(403, '{"error":{"type":"permission_error","message":"Your OpenCode Go subscription ended because its payment method needs authorization"}}');
assert.strictEqual(subEndedErr.isSubscriptionEnded, true);
assert.strictEqual(subEndedErr.isRegionBlocked, false);

console.log('  [PASS] 4. classifyUpstreamError precisely distinguishes FreeUsageLimit and SubscriptionEnded');

console.log('================================================================');
console.log('ALL 4/4 GUEST PROTOCOL TESTS PASSED!');
console.log('================================================================');
