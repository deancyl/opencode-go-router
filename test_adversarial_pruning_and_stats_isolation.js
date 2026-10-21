/**
 * Adversarial Verification Suite:
 * 1. Sliding Window 100% User Message Preservation Red Line
 * 2. Multi-turn Session Deduplication & Zero-Bloat Fingerprinting
 * 3. Test Environment Disk Isolation Guard
 * 4. Model Palette DeepSeek Pro vs Flash Distinction
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const codexAdapter = require('./codex-adapter');
const contextCompactor = require('./context-compactor');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      await result;
    }
    passedTests++;
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}\n    Error: ${err.message}`);
    throw err;
  }
}

async function runAll() {
  console.log('--- Starting Pruning & Isolation Adversarial Suite ---');

  // =========================================================================
  // Test 1: Responses API Sliding Window 100% User Message Preservation
  // =========================================================================
  await runTest('1.1 Responses API: 100% preserves all intermediate user instructions (Root-cause fix for 01a15d52/01a15c15 crosstalk)', () => {
    const userCorrections = [
      '我有要求你这么做吗？',
      '请先帮我总结我的任务',
      '请仅凭录音相关的文件判断',
      '我是说仅仅凭借获取的录音'
    ];

    const input = [
      { type: 'message', role: 'system', content: 'You are an AI assistant.' },
      { type: 'message', role: 'user', content: 'Initial Task: Check recording and verify.' }
    ];

    // Add intermediate turns with 4 user corrections interleaved with assistant actions & tools
    for (let i = 0; i < 4; i++) {
      input.push({ type: 'message', role: 'assistant', content: `Assistant thinking step ${i}...` });
      input.push({ type: 'function_call', call_id: `call_wrong_pkg_${i}`, name: 'read_package', arguments: '{"pkg":"low_age_study"}' });
      input.push({ type: 'function_call_output', call_id: `call_wrong_pkg_${i}`, output: 'low age study materials...' });
      // User correction:
      input.push({ type: 'message', role: 'user', content: userCorrections[i] });
    }

    // Add 12 trailing recent interaction turns (active tail context)
    for (let i = 0; i < 12; i++) {
      input.push({ type: 'message', role: i % 2 === 0 ? 'assistant' : 'user', content: `Recent active turn ${i}` });
    }

    assert.ok(input.length > 25, `Original input count must be > 25, got ${input.length}`);

    const res = codexAdapter.pruneResponsesPayload({ input }, 'session-crosstalk-test');
    assert.strictEqual(res.modified, true, 'Sliding window must trigger');
    assert.ok(res.input.length < input.length, 'Pruned input count must be less than original');

    // RED LINE VERIFICATION: Every single user message MUST be in res.input!
    const initialUserFound = res.input.some(it => it.type === 'message' && it.role === 'user' && it.content === 'Initial Task: Check recording and verify.');
    assert.ok(initialUserFound, 'Initial user prompt MUST be preserved');

    for (const correction of userCorrections) {
      const found = res.input.some(it => it.content === correction);
      assert.ok(found, `User correction "${correction}" MUST be 100% preserved in pruned payload!`);
    }

    // Verify system sliding window notice is present
    const noticeFound = res.input.some(it => it.role === 'system' && it.content && it.content.includes('滑动窗口折叠'));
    assert.ok(noticeFound, 'Sliding window system notice must be injected');

    // Verify order: initial user appears before corrections, corrections appear before tail
    const initIdx = res.input.findIndex(it => it.content === 'Initial Task: Check recording and verify.');
    const corr0Idx = res.input.findIndex(it => it.content === userCorrections[0]);
    const corr3Idx = res.input.findIndex(it => it.content === userCorrections[3]);
    const lastIdx = res.input.findIndex(it => it.content === 'Recent active turn 11');

    assert.ok(initIdx < corr0Idx, 'Initial task must precede user corrections');
    assert.ok(corr0Idx < corr3Idx, 'User corrections must maintain chronological order');
    assert.ok(corr3Idx < lastIdx, 'User corrections must precede active tail context');
  });

  // =========================================================================
  // Test 2: Chat Messages Sliding Window 100% User Message Preservation
  // =========================================================================
  await runTest('1.2 Chat Messages: 100% preserves all intermediate user instructions', () => {
    const corrections = [
      'Stop doing task X!',
      'Did you read my prompt?',
      'Please focus on Y only!'
    ];

    const messages = [
      { role: 'system', content: 'system instructions' },
      { role: 'user', content: 'Start task X' }
    ];

    for (let i = 0; i < 3; i++) {
      messages.push({ role: 'assistant', content: `step ${i}` });
      messages.push({ role: 'tool', tool_call_id: `t_${i}`, content: 'tool output data...' });
      messages.push({ role: 'user', content: corrections[i] });
    }

    // Trailing 12 messages
    for (let i = 0; i < 12; i++) {
      messages.push({ role: i % 2 === 0 ? 'assistant' : 'user', content: `tail ${i}` });
    }

    assert.ok(messages.length > 20, `Input messages count must be > 20, got ${messages.length}`);

    const res = codexAdapter.pruneChatMessages(messages, 4000, 'chat-session-test');
    assert.strictEqual(res.modified, true, 'Chat sliding window must trigger');
    assert.ok(res.length < messages.length, 'Pruned messages count must be smaller');

    // Verify all corrections are preserved
    for (const c of corrections) {
      assert.ok(res.some(m => m.content === c), `Chat user correction "${c}" MUST be preserved!`);
    }

    assert.ok(res.some(m => m.role === 'system' && m.content && m.content.includes('自动压缩中间')), 'Notice must be present');
  });

  // =========================================================================
  // Test 3: Multi-Turn Session Deduplication & Zero-Bloat Fingerprinting
  // =========================================================================
  await runTest('2.1 Multi-Turn Deduplication: Prevents duplicate recordSavings across 10 rounds of the same tool output', () => {
    codexAdapter.clearPruneFingerprints();

    const sessionId = 'session-dedupe-bench-1';
    const giantOutput = 'Z'.repeat(25000);
    const mockPayload = {
      model: 'deepseek-v4-pro',
      input: [
        { type: 'message', role: 'user', content: 'Run command' },
        { type: 'function_call_output', call_id: 'call_repeated_tool_123', output: giantOutput }
      ]
    };

    const beforeStats = JSON.parse(JSON.stringify(contextCompactor.getCompressionStats()));
    const beforeSavedChars = beforeStats.modules?.headroom?.savedChars || 0;

    // Round 1: Prunes and records savings for the first time
    const res1 = codexAdapter.pruneResponsesPayload(mockPayload, sessionId);
    assert.strictEqual(res1.modified, true);
    assert.ok(res1.input[1].output.includes('智能网关自愈：已自动折叠'));

    const afterRound1Stats = contextCompactor.getCompressionStats();
    const afterRound1SavedChars = afterRound1Stats.modules?.headroom?.savedChars || 0;
    const round1Delta = afterRound1SavedChars - beforeSavedChars;
    assert.ok(round1Delta > 20000, `Round 1 must record ~23800 chars saved, got ${round1Delta}`);

    // Rounds 2 to 10: In multi-turn session, client sends the same giant tool output in history
    for (let round = 2; round <= 10; round++) {
      const resN = codexAdapter.pruneResponsesPayload(mockPayload, sessionId);
      assert.strictEqual(resN.modified, true, `Round ${round} must still fold payload text to keep context compact`);
      assert.ok(resN.input[1].output.includes('智能网关自愈：已自动折叠'));
    }

    // Verify that subsequent rounds DID NOT duplicate recordSavings!
    const afterRound10Stats = contextCompactor.getCompressionStats();
    const afterRound10SavedChars = afterRound10Stats.modules?.headroom?.savedChars || 0;
    const extraSavedAfterRound1 = afterRound10SavedChars - afterRound1SavedChars;
    assert.strictEqual(extraSavedAfterRound1, 0, 'Deduplication MUST prevent duplicate recordSavings across rounds 2..10!');
  });

  // =========================================================================
  // Test 4: Test Environment Disk Isolation Guard
  // =========================================================================
  await runTest('3.1 Test Environment Disk Isolation: Forbids writing to production compression-stats.json and history', async () => {
    assert.strictEqual(contextCompactor.isTestEnvironment(), true, 'isTestEnvironment must return true when running test_*.js');
    assert.strictEqual(contextCompactor.isProductionDiskTarget(), true, 'isProductionDiskTarget must return true when targeting prod files');

    const prodStatsPath = path.join(__dirname, 'compression-stats.json');
    const prodHistPath = path.join(__dirname, 'compression-history.json');

    const mtimeStatsBefore = fs.existsSync(prodStatsPath) ? fs.statSync(prodStatsPath).mtimeMs : 0;
    const mtimeHistBefore = fs.existsSync(prodHistPath) ? fs.statSync(prodHistPath).mtimeMs : 0;

    // Simulate 50 calls to recordSavings (similar to adversarial test loops)
    for (let i = 0; i < 50; i++) {
      contextCompactor.recordSavings('headroom', 5000, 10000, 'deepseek-v4-pro');
    }

    // Wait 1300ms to exceed persistStatsThrottled debounce (1000ms)
    await new Promise(r => setTimeout(r, 1300));

    const mtimeStatsAfter = fs.existsSync(prodStatsPath) ? fs.statSync(prodStatsPath).mtimeMs : 0;
    const mtimeHistAfter = fs.existsSync(prodHistPath) ? fs.statSync(prodHistPath).mtimeMs : 0;

    assert.strictEqual(mtimeStatsAfter, mtimeStatsBefore, 'Production compression-stats.json MUST NOT be modified by test execution!');
    assert.strictEqual(mtimeHistAfter, mtimeHistBefore, 'Production compression-history.json MUST NOT be modified by test execution!');
  });

  // =========================================================================
  // Test 5: Server.js Model Coloring Precision (DeepSeek Pro vs Flash)
  // =========================================================================
  await runTest('4.1 Model Color Precision: Distinct colors for deepseek-v4-pro vs deepseek-v4.1-flash', () => {
    // Extract getModelColor from server.js to verify frontend logic
    const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const funcMatch = serverCode.match(/function getModelColor\([^)]*\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(funcMatch, 'getModelColor function must exist in server.js');

    const paletteMatch = serverCode.match(/const MODEL_PALETTE\s*=\s*\{[\s\S]*?\};/);
    assert.ok(paletteMatch, 'MODEL_PALETTE must exist in server.js');

    // Evaluate in sandbox
    const evalEnv = {};
    const evalFn = new Function(paletteMatch[0] + '\nconst FALLBACK_COLORS = [\'#ea580c\', \'#f59e0b\', \'#38bdf8\'];\n' + funcMatch[0] + '\nreturn getModelColor;');
    const getModelColor = evalFn();

    const proColor = getModelColor('deepseek-v4-pro');
    const flashColor = getModelColor('deepseek-v4.1-flash');

    assert.strictEqual(proColor, '#ea580c', 'deepseek-v4-pro MUST be styled in deep amber-orange (#ea580c)');
    assert.strictEqual(flashColor, '#f59e0b', 'deepseek-v4.1-flash MUST be styled in golden amber (#f59e0b)');
    assert.notStrictEqual(proColor, flashColor, 'Pro and Flash MUST NOT collapse to the same color!');
  });

  console.log(`\n========================================`);
  console.log(`✅ All ${passedTests}/${totalTests} Pruning & Isolation Adversarial Tests PASSED!`);
  console.log(`========================================`);
}

runAll().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
