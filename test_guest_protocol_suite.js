/**
 * OpenCode Go Router - Guest Protocol Mode, Entitlement State Machine & Bridge Audit Suite
 */

const assert = require('assert');
const EventEmitter = require('events');
const codexAdapter = require('./codex-adapter');
const clientAdapter = require('./client-adapter-manager');
const serverModule = require('./server');

console.log('================================================================');
console.log('Running test_guest_protocol_suite.js - Guest Mode & Entitlement State Machine');
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

// 2. Verify filterModelsByPolicy with guest / freeOnly policy AND 44-model SSOT preservation
const official44 = clientAdapter.loadOfficialModels();
assert.strictEqual(official44.length, 44, 'official-models.json SSOT must strictly remain 44 models');

const freeModels = clientAdapter.filterModelsByPolicy('guest');
assert.ok(freeModels.length >= 5, `Must have at least 5 free models, got ${freeModels.length}`);
for (const m of freeModels) {
  assert.strictEqual(codexAdapter.isFreeModel(m.slug || m.id), true, `Model ${m.slug} must be free`);
}
const hybridModels = clientAdapter.filterModelsByPolicy('hybrid');
assert.ok(hybridModels.length > freeModels.length, 'Hybrid policy must include paid models');
console.log(`  [PASS] 2. filterModelsByPolicy in guest mode returns ${freeModels.length} free-only models without polluting 44-model SSOT`);

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

// 5. Verify handleQuotaExhaustedFailover marks stat.isSubscriptionEnded = true and seamlessly fails over to __guest_protocol__, and recordAccountSuccess recovers to Scheme A
const savedAccounts = serverModule.config.accounts;
try {
  serverModule.config.accounts = [
    { id: 'acc-audit-1', name: 'Audit Paid Account 1', apiKey: 'oc_sk_expired_test', enabled: true }
  ];
  serverModule.accountStats.set('acc-audit-1', {
    id: 'acc-audit-1',
    name: 'Audit Paid Account 1',
    circuitState: 'CLOSED',
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    cooldownUntil: 0,
    activeRequests: 1,
    totalRequests: 1,
    rateLimitCount: 0,
    failoverCount: 0
  });

  let failoverNextAccount = null;
  const mockRes = new EventEmitter();
  const handled = serverModule.handleQuotaExhaustedFailover({
    protocolTag: 'Bridge',
    clientRes: mockRes,
    account: serverModule.config.accounts[0],
    attemptNumber: 1,
    triedAccountIds: new Set(['acc-audit-1']),
    sessionId: 'sess-audit-guest',
    statusCode: 403,
    errText: '{"type":"error","error":{"type":"EntitlementError","message":"Your OpenCode Go subscription ended because its payment method needs authorization."}}',
    finishRequest: () => {},
    clientCloseHandler: () => {},
    retryFn: (nextAcc) => { failoverNextAccount = nextAcc; }
  });

  const stAfterFail = serverModule.accountStats.get('acc-audit-1');
  assert.strictEqual(stAfterFail.isSubscriptionEnded, true, 'handleQuotaExhaustedFailover must set stat.isSubscriptionEnded = true');
  assert.strictEqual(stAfterFail.lastStatus, 403, 'handleQuotaExhaustedFailover must set stat.lastStatus = 403');
  assert.strictEqual(serverModule.isGuestModeActive(), true, 'isGuestModeActive must become true after all accounts hit EntitlementError');
  assert.strictEqual(handled, true, 'Must seamlessly failover to guest account on first 403 EntitlementError');
  assert.ok(failoverNextAccount && failoverNextAccount.isGuest === true && failoverNextAccount.id === '__guest_protocol__', 'Next account must be __guest_protocol__');

  // Verify Scheme B -> Scheme A recovery when recordAccountSuccess is called (e.g. after user re-authorizes payment and clicks Test Speed)
  serverModule.recordAccountSuccess('acc-audit-1', 120);
  const stAfterRecover = serverModule.accountStats.get('acc-audit-1');
  assert.strictEqual(stAfterRecover.isSubscriptionEnded, false, 'recordAccountSuccess must clear isSubscriptionEnded');
  assert.strictEqual(stAfterRecover.isQuotaExhausted, false, 'recordAccountSuccess must clear isQuotaExhausted');
  assert.strictEqual(stAfterRecover.lastStatus, 200, 'recordAccountSuccess must update lastStatus to 200');
  assert.strictEqual(serverModule.isGuestModeActive(), false, 'isGuestModeActive must immediately deactivate once paid account recovers');
  const selectedPaid = serverModule.selectAccount('sess-audit-paid');
  assert.strictEqual(selectedPaid.id, 'acc-audit-1', 'Traffic must automatically return to Scheme A paid account');
  console.log('  [PASS] 5. Scheme A <-> Scheme B bidirectional state transition & failover verified');
} finally {
  serverModule.config.accounts = savedAccounts;
  serverModule.accountStats.delete('acc-audit-1');
}

console.log('================================================================');
console.log('ALL 5/5 GUEST PROTOCOL & STATE MACHINE TESTS PASSED!');
console.log('================================================================');
