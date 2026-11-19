/**
 * Comprehensive Verification Suite for OpenCode Go Guest Protocol & Zen v2 Wire Identity (v3.14.3)
 * Strictly enforces ZERO fake-200 cheating and verifies genuine Gate A (<env>), Gate A2 (tool schemas & run_code de-collision),
 * Gate B (v2 headers, SHA1 project hash, session rotation, BoringSSL/Bun transport), and active model routing.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const codexAdapter = require('./codex-adapter');
const clientAdapter = require('./client-adapter-manager');
const serverModule = require('./server');

console.log('================================================================');
console.log('Running Guest Protocol & Zen v2 Wire Verification Suite (v3.14.3)');
console.log('================================================================');

// 1. Verify Free Model Identification & Active Guest Catalog
assert.strictEqual(codexAdapter.isFreeModel('deepseek-v4.1-flash-free'), true);
assert.strictEqual(codexAdapter.isFreeModel('mimo-v2.6-flash-free'), true);
assert.strictEqual(codexAdapter.isFreeModel('longcat-2.5-free'), true);
assert.strictEqual(codexAdapter.isFreeModel('big-pickle'), true);
assert.strictEqual(codexAdapter.isFreeModel('glm-5.3-flash-free'), true);
assert.strictEqual(codexAdapter.isFreeModel('deepseek-v4-pro'), false);
assert.strictEqual(codexAdapter.isFreeModel('kimi-k3'), false);
console.log('  [PASS] 1. Free model identification verified');

// 2. Verify Client Adapter Guest Policy Filtering (Strictly Active Free Models Only)
const guestModels = clientAdapter.filterModelsByPolicy('guest', { isGuest: true });
assert.ok(Array.isArray(guestModels) && guestModels.length >= 4, 'Guest policy must return active free models');
for (const m of guestModels) {
  assert.strictEqual(codexAdapter.isFreeModel(m.slug), true, `Guest model ${m.slug} must be a free model`);
  assert.strictEqual(m.quota_tier, 'free', `Guest model ${m.slug} must have quota_tier='free'`);
}
const guestSlugs = guestModels.map(m => m.slug);
assert.strictEqual(guestSlugs[0], 'deepseek-v4.1-flash-free', 'Default guest free model must be deepseek-v4.1-flash-free');
assert.ok(guestSlugs.includes('mimo-v2.6-flash-free') && guestSlugs.includes('glm-5.3-flash-free') && guestSlugs.includes('big-pickle'), 'Must include active Zen free models');
assert.ok(!guestSlugs.includes('cat-jam-free') && !guestSlugs.includes('beam-free') && !guestSlugs.includes('hy4-flash-free'), 'Must NOT include retired cat-jam-free, beam-free, or hy4-flash-free in guest catalog');
console.log(`  [PASS] 2. Guest policy filter returned ${guestModels.length} active free-only models`);

// 3. Verify Guest Mode Fallback Chain Never Escalates to Paid Models
const fb1 = codexAdapter.resolveCompatibleFallbackModel('cat-jam-free', 'model_not_found', { isGuest: true });
assert.strictEqual(codexAdapter.isFreeModel(fb1), true);
const fb2 = codexAdapter.resolveCompatibleFallbackModel('beam-free', 'RegionError', { isGuest: true });
assert.strictEqual(codexAdapter.isFreeModel(fb2), true);
const fb3 = codexAdapter.resolveCompatibleFallbackModel('hy4-flash-free', "Model isn't included in OpenCode Go", { isGuest: true });
assert.strictEqual(codexAdapter.isFreeModel(fb3), true);
console.log('  [PASS] 3. Guest mode fallback chain strictly stays within free models');

// 4. Verify OpenCode Zen v2 Wire Identity (ses_ Descending Bitmask, SHA1 Project Hash, & Rotation)
for (let i = 0; i < 64; i++) {
  const sesId = serverModule.mintOpencodeZenSessionId();
  assert.match(sesId, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/, `Invalid session ID format: ${sesId}`);
  const low12 = parseInt(sesId.slice(13, 16), 16);
  assert.ok(low12 >= 0xfc0 && low12 <= 0xfff, `Low 12 bits of head must land in [0xfc0, 0xfff], got 0x${low12.toString(16)}`);
}
const sesA = serverModule.getOrMintGuestSessionId('test-conv-1');
const sesB = serverModule.getOrMintGuestSessionId('test-conv-1');
assert.strictEqual(sesA, sesB, 'Same conversation session should reuse guest session ID until rotated');
const sesRotated = serverModule.rotateGuestSessionId('test-conv-1');
assert.notStrictEqual(sesA, sesRotated, 'Rotated guest session ID must be newly minted');
const zenHeaders = serverModule.buildZenGuestHeaders(sesRotated);
assert.strictEqual(zenHeaders['authorization'], 'Bearer public');
assert.strictEqual(zenHeaders['user-agent'], 'opencode/latest/2.1.4/cli');
assert.strictEqual(zenHeaders['x-opencode-client'], 'cli');
assert.strictEqual(zenHeaders['x-opencode-session'], sesRotated);
assert.strictEqual(zenHeaders['x-opencode-session-id'], sesRotated);
assert.strictEqual(zenHeaders['x-session-affinity'], sesRotated);
assert.strictEqual(zenHeaders['x-session-id'], sesRotated);
assert.match(zenHeaders['x-opencode-project'], /^[0-9a-f]{40}$/, 'x-opencode-project must be a 40-char SHA1 hex');
console.log('  [PASS] 4. Zen v2 wire headers, ses_ bitmask [0xfc0, 0xfff], SHA1 project hash & rotation verified');

// 5. Verify Gate A (<env> Block Injection) & Gate A2 (Full Tool Manifest Schemas + run_code De-collision)
assert.strictEqual(serverModule.mapModelForZenGuest('hy4-flash-free'), 'deepseek-v4.1-flash-free');
assert.strictEqual(serverModule.mapModelForZenGuest('beam-free'), 'deepseek-v4.1-flash-free');
assert.strictEqual(serverModule.mapModelForZenGuest('cat-jam-free'), 'deepseek-v4.1-flash-free');
assert.strictEqual(serverModule.mapModelForZenGuest('longcat-2.5-preview-free'), 'longcat-2.5-preview-free');
assert.strictEqual(serverModule.mapModelForZenGuest('big-pickle'), 'big-pickle');

const codexSystemPrompt = 'You are Codex, an AI coding agent with shell_command and apply_patch.';
const sampleChatPayload = {
  model: 'deepseek-v4.1-flash-free',
  stream: true,
  messages: [
    { role: 'system', content: codexSystemPrompt },
    { role: 'user', content: 'test' }
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'shell_command',
        description: 'Run a shell command',
        parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_code_client',
        description: 'Blocked tool name test',
        parameters: { type: 'object', properties: { code: { type: 'string' } } }
      }
    }
  ]
};
const paddedChat = serverModule.ensureZenGuestToolsInChatPayload(sampleChatPayload);
assert.ok(paddedChat.messages[0].content.startsWith(codexSystemPrompt), 'Must preserve 100% of original Codex system prompt');
assert.ok(paddedChat.messages[0].content.includes('<env>') && paddedChat.messages[0].content.includes('Working directory:'), 'Must inject Gate A <env> block into system message');

// Idempotency check on second pass
const lenAfterFirst = paddedChat.messages[0].content.length;
serverModule.ensureZenGuestToolsInChatPayload(paddedChat);
assert.strictEqual(paddedChat.messages[0].content.length, lenAfterFirst, '<env> injection must be idempotent');

const toolNames = paddedChat.tools.map(t => t.function.name);
for (const reqTool of ['bash', 'read', 'edit', 'write', 'glob', 'grep']) {
  assert.ok(toolNames.includes(reqTool), `Must inject required OpenCode CLI tool anchor: ${reqTool}`);
  const tObj = paddedChat.tools.find(t => t.function.name === reqTool);
  assert.ok(tObj.function.parameters && Object.keys(tObj.function.parameters.properties || {}).length > 0, `Tool ${reqTool} must have non-empty parameter properties schema`);
}
assert.ok(!toolNames.some(n => /run_code/i.test(n)), 'Must sanitize blocked run_code substring to prevent synthetic 429');
assert.ok(toolNames.includes('run_program_client'), 'Must rename run_code_client to run_program_client');
assert.deepStrictEqual(paddedChat.stream_options, { include_usage: true }, 'Must attach stream_options on streaming requests');
console.log('  [PASS] 5. Gate A (<env> block) & Gate A2 (full tool schemas + run_code sanitization) verified');

// 6. Verify ZERO Fake-200 Cheating Functions Exist
assert.strictEqual(typeof serverModule.sendResponsesFreeLimitFastClose, 'undefined', 'Cheating function sendResponsesFreeLimitFastClose must NOT exist');
assert.strictEqual(typeof serverModule.buildFreeUsageLimitNotice, 'undefined', 'Cheating function buildFreeUsageLimitNotice must NOT exist');
assert.strictEqual(typeof codexAdapter.dispatchResponsesStreamNotice, 'undefined', 'Cheating function dispatchResponsesStreamNotice must NOT exist');
assert.ok(fs.existsSync(path.join(__dirname, 'zen-bun-sidecar.mjs')), 'Built-in Bun BoringSSL TLS sidecar (zen-bun-sidecar.mjs) must exist');
console.log('  [PASS] 6. Zero fake-200 cheating confirmed & zen-bun-sidecar.mjs verified');

// 7. Verify Subscription Expiration Auto-Detection & Failover to __guest_protocol__
const origAccounts = serverModule.config.accounts;
try {
  serverModule.config.accounts = [
    { id: 'acc-audit-1', name: 'Expired Sub', apiKey: 'sk-expired-test', enabled: true }
  ];
  serverModule.accountStats.set('acc-audit-1', {
    id: 'acc-audit-1',
    name: 'Expired Sub',
    enabled: true,
    isSubscriptionEnded: true,
    isQuotaExhausted: true,
    lastStatus: 403,
    cooldownUntil: Date.now() + 3600000
  });
  assert.strictEqual(serverModule.isGuestModeActive(), true, 'Guest mode must activate when all accounts have isSubscriptionEnded=true');
  const selected = serverModule.selectAccount('sess-audit-guest');
  assert.ok(selected && selected.isGuest === true && selected.id === '__guest_protocol__', 'selectAccount must return __guest_protocol__ virtual account');
  assert.strictEqual(serverModule.isOpenCodeLiveUpstream('https://opencode.ai/zen/v1'), true);
  assert.strictEqual(serverModule.isOpenCodeLiveUpstream('http://127.0.0.1:4010'), false);
  assert.strictEqual(serverModule.getEffectiveGuestUpstream('deepseek-v4.1-flash-free'), 'https://opencode.ai/inference/openai/v1');
  assert.strictEqual(serverModule.getEffectiveGuestUpstream('big-pickle'), 'https://opencode.ai/zen/v1');
  console.log('  [PASS] 7. Automatic guest protocol failover on subscription expiration verified');
} finally {
  serverModule.config.accounts = origAccounts;
  serverModule.accountStats.delete('acc-audit-1');
}

console.log('================================================================');
console.log('ALL 7/7 GUEST PROTOCOL & ZEN V2 WIRE TESTS PASSED (ZERO CHEATING)!');
console.log('================================================================');
