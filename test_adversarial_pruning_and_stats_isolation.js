/**
 * Adversarial Verification Suite:
 * 1. Sliding Window 100% User & System Message Preservation Red Line
 * 2. Multi-turn Session Deduplication & Zero-Bloat Fingerprinting
 * 3. Test Environment Disk Isolation Guard
 * 4. Model Palette DeepSeek Pro vs Flash Distinction
 * 5. UTF-16 Unicode Surrogate Pair Safe Slice (Emoji & Rare CJK Boundary Fidelity)
 * 6. Markdown Code Block Syntax Balance Guard (balanceCodeBlocks)
 * 7. Atomic Tool Call & Response Contiguity in Sliding Window Pruning
 * 8. Numerical Boundary, Extreme Dirty Input & NaN Shield Isolation
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

  // =========================================================================
  // Test 6: UTF-16 Unicode Surrogate Pair Safe Slice (Emoji & CJK Boundary Fidelity)
  // =========================================================================
  await runTest('5.1 Unicode Safe Slice: Never splits UTF-16 surrogate pairs (Emoji & Rare CJK)', () => {
    const safeUnicodeSlice = codexAdapter.safeUnicodeSlice;
    assert.strictEqual(typeof safeUnicodeSlice, 'function', 'safeUnicodeSlice must be exported');

    // Construct string with high-value astral symbols:
    // '🎉' = \uD83C\uDF89 (length 2)
    // '𠮷' = \uD842\uDFB7 (length 2)
    // '👨‍👩‍👧‍👦' = multi-character ZWJ emoji sequence
    const str = 'ABC' + '🎉' + 'DEF' + '𠮷' + 'GHI';
    // Indices: 'ABC' (0..2), '🎉' (3, 4), 'DEF' (5, 6, 7), '𠮷' (8, 9), 'GHI' (10, 11, 12)

    // Slicing at index 4 would normally cut right inside 🎉 (\uD83C | \uDF89)
    const cutInsideEmoji = safeUnicodeSlice(str, 0, 4);
    // safeUnicodeSlice should include the low surrogate (expand to index 5) so 🎉 is not broken
    assert.strictEqual(cutInsideEmoji, 'ABC🎉', 'safeUnicodeSlice must keep high+low surrogate pair intact');

    // Slicing from index 4 would normally start at low surrogate
    const startInsideEmoji = safeUnicodeSlice(str, 4, 8);
    // safeUnicodeSlice should expand start backwards to index 3 to include high surrogate
    assert.strictEqual(startInsideEmoji, '🎉DEF', 'safeUnicodeSlice must include leading high surrogate when start is on low surrogate');

    // Test with oversized message in pruneChatMessages
    const emojiHeavyContent = 'Prefix ' + '🎉'.repeat(800) + '𠮷'.repeat(800) + ' Suffix';
    assert.ok(emojiHeavyContent.length > 3000);
    const messages = [
      { role: 'system', content: 'test sys' },
      { role: 'assistant', content: emojiHeavyContent },
      { role: 'user', content: 'hello' }
    ];
    const pruned = codexAdapter.pruneChatMessages(messages, 4000);
    assert.strictEqual(pruned.modified, true);
    // Check that pruned content contains no lone unpaired surrogates
    const content = pruned[1].content;
    const hasUnpairedSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(content);
    assert.strictEqual(hasUnpairedSurrogate, false, 'Folded content must not contain any lone unpaired surrogates!');
  });

  // =========================================================================
  // Test 7: Markdown Code Block Syntax Balance Guard (balanceCodeBlocks)
  // =========================================================================
  await runTest('6.1 Markdown Code Block Balance: Closes dangling ``` in folded prefix and suffix', () => {
    const balanceCodeBlocks = codexAdapter.balanceCodeBlocks;
    assert.strictEqual(typeof balanceCodeBlocks, 'function', 'balanceCodeBlocks must be exported');

    // Scenario A: Head has 1 opening fence (odd number) -> Must append closing fence
    const head1 = 'Here is code:\n```js\nconst x = 1;\n';
    const tail1 = 'const y = 2;\n```\nDone!';
    const resA = balanceCodeBlocks(head1, tail1);
    assert.ok(resA.head.endsWith('```\n'), 'Unclosed head fence must be closed with ```\\n');
    assert.ok(resA.tail.startsWith('```\n'), 'Unbalanced tail fence must open with ```\\n');

    // Scenario B: Already balanced (even number of fences in head and tail)
    const head2 = '```js\ncode1\n```\nSome text';
    const tail2 = 'More text\n```py\ncode2\n```';
    const resB = balanceCodeBlocks(head2, tail2);
    assert.strictEqual(resB.head, head2, 'Balanced head must not be altered');
    assert.strictEqual(resB.tail, tail2, 'Balanced tail must not be altered');
  });

  // =========================================================================
  // Test 8: Atomic Tool Call & Response Contiguity in Sliding Window Pruning
  // =========================================================================
  await runTest('7.1 Sliding Window Tool Topology: Assistant tool_calls paired with role:tool messages are NEVER broken', () => {
    // Construct 24 messages where an assistant calls 2 tools right at the sliding window boundary
    const messages = [
      { role: 'system', content: 'system base instructions' },
      { role: 'user', content: 'initial task prompt' }
    ];

    // Intermediate conversational steps
    for (let i = 2; i <= 10; i++) {
      messages.push({ role: 'assistant', content: `step ${i}` });
      messages.push({ role: 'user', content: `feedback ${i}` });
    }

    // Atomic tool transaction at boundary
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call_boundary_alpha', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } },
        { id: 'call_boundary_beta', type: 'function', function: { name: 'get_time', arguments: '{"city":"Tokyo"}' } }
      ]
    });
    messages.push({ role: 'tool', tool_call_id: 'call_boundary_alpha', content: 'Sunny 22C' });
    messages.push({ role: 'tool', tool_call_id: 'call_boundary_beta', content: '14:00 JST' });

    // Active trailing messages
    for (let i = 0; i < 8; i++) {
      messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `recent tail ${i}` });
    }

    assert.ok(messages.length > 25, `Messages length must exceed 25, got ${messages.length}`);

    const pruned = codexAdapter.pruneChatMessages(messages, 4000, 'topology-session-test');
    assert.strictEqual(pruned.modified, true);

    // Verify Topological Integrity:
    // Every assistant with tool_calls must have contiguous matching tool messages
    for (let i = 0; i < pruned.length; i++) {
      const msg = pruned[i];
      if (msg && msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          // The corresponding tool message must be present in pruned messages
          const toolMsg = pruned.find(m => m && m.role === 'tool' && m.tool_call_id === tc.id);
          assert.ok(toolMsg, `Tool call ${tc.id} MUST have a matching tool message in pruned messages!`);
        }
      }
      if (msg && msg.role === 'tool') {
        // Must not be an orphan: an assistant preceding this tool must have invoked it,
        // or sanitizeAndValidateChatMessages must have healed it
        const precedingAssistant = pruned.slice(0, i).reverse().find(m => m && m.role === 'assistant' && Array.isArray(m.tool_calls));
        const wasInvoked = precedingAssistant && precedingAssistant.tool_calls.some(tc => tc.id === msg.tool_call_id);
        assert.ok(wasInvoked, `Retained tool message ${msg.tool_call_id} must be paired with preceding assistant tool_calls`);
      }
    }
  });

  // =========================================================================
  // Test 9: Numerical Boundary, Extreme Dirty Input & NaN Shield Isolation
  // =========================================================================
  await runTest('8.1 NaN Shield & Numerical Bounds: All metrics remain finite, non-negative & uncorrupted under dirty inputs', () => {
    // Test dirty inputs to recordSavings
    contextCompactor.recordSavings('headroom', NaN, 1000);
    contextCompactor.recordSavings('headroom', 1000, NaN);
    contextCompactor.recordSavings('rtk', -500, -1000);
    contextCompactor.recordSavings('schema', Infinity, 5000);
    contextCompactor.recordSavings('cacheZone', null, undefined);

    // Test dirty inputs to recordModelSavings
    contextCompactor.recordModelSavings('deepseek-v4-pro', NaN, 5000);
    contextCompactor.recordModelSavings('deepseek-v4.1-flash', -100, -200);
    contextCompactor.recordModelSavings('deepseek-v4-pro', 1000, Infinity);

    // Test dirty inputs to recordModuleOnlySavings & recordOverallSavings
    contextCompactor.recordModuleOnlySavings('rtk', NaN);
    contextCompactor.recordOverallSavings(NaN, 500);
    contextCompactor.recordOverallSavings(500, NaN);
    contextCompactor.recordOverallSavings(500, 1000); // Negative savings: compLen > origLen (inflation)

    // Test recordCompressionEvent with corrupted event objects
    contextCompactor.recordCompressionEvent(null);
    contextCompactor.recordCompressionEvent({});
    contextCompactor.recordCompressionEvent({ savedChars: NaN, originalChars: NaN });
    contextCompactor.recordCompressionEvent({ deltaChars: -999, originalChars: -100 });

    const stats = contextCompactor.getCompressionStats();

    // Verify All Numerical Fields are Finite and Non-Negative
    assert.strictEqual(Number.isFinite(stats.totalOriginalChars), true, 'totalOriginalChars must be finite');
    assert.strictEqual(isNaN(stats.totalOriginalChars), false, 'totalOriginalChars must not be NaN');
    assert.ok(stats.totalOriginalChars >= 0, 'totalOriginalChars must be non-negative');

    assert.strictEqual(Number.isFinite(stats.totalCompressedChars), true, 'totalCompressedChars must be finite');
    assert.strictEqual(isNaN(stats.totalCompressedChars), false, 'totalCompressedChars must not be NaN');
    assert.ok(stats.totalCompressedChars >= 0, 'totalCompressedChars must be non-negative');

    assert.strictEqual(Number.isFinite(stats.totalSavedChars), true, 'totalSavedChars must be finite');
    assert.strictEqual(isNaN(stats.totalSavedChars), false, 'totalSavedChars must not be NaN');
    assert.ok(stats.totalSavedChars >= 0, 'totalSavedChars must be non-negative');

    assert.strictEqual(Number.isFinite(stats.savedTokens), true, 'savedTokens must be finite');
    assert.strictEqual(isNaN(stats.savedTokens), false, 'savedTokens must not be NaN');
    assert.ok(stats.savedTokens >= 0, 'savedTokens must be non-negative');

    assert.strictEqual(Number.isFinite(stats.compressionRatio), true, 'compressionRatio must be finite');
    assert.strictEqual(isNaN(stats.compressionRatio), false, 'compressionRatio must not be NaN');
    assert.ok(stats.compressionRatio >= 0 && stats.compressionRatio <= 100, 'compressionRatio must be between 0 and 100');

    // Verify modules stats
    for (const [modKey, modData] of Object.entries(stats.modules || {})) {
      assert.strictEqual(Number.isFinite(modData.savedChars), true, `module ${modKey}.savedChars must be finite`);
      assert.strictEqual(isNaN(modData.savedChars), false, `module ${modKey}.savedChars must not be NaN`);
      assert.strictEqual(Number.isFinite(modData.savedTokens), true, `module ${modKey}.savedTokens must be finite`);
      assert.strictEqual(isNaN(modData.savedTokens), false, `module ${modKey}.savedTokens must not be NaN`);
    }

    // Verify byModel stats
    for (const [mName, mData] of Object.entries(stats.byModel || {})) {
      assert.strictEqual(Number.isFinite(mData.savedChars), true, `byModel[${mName}].savedChars must be finite`);
      assert.strictEqual(isNaN(mData.savedChars), false, `byModel[${mName}].savedChars must not be NaN`);
      assert.strictEqual(Number.isFinite(mData.savedTokens), true, `byModel[${mName}].savedTokens must be finite`);
      assert.strictEqual(isNaN(mData.savedTokens), false, `byModel[${mName}].savedTokens must not be NaN`);
      assert.strictEqual(Number.isFinite(mData.savedCostUSD), true, `byModel[${mName}].savedCostUSD must be finite`);
      assert.strictEqual(isNaN(mData.savedCostUSD), false, `byModel[${mName}].savedCostUSD must not be NaN`);
    }

    // Verify Malformed Payload Compaction Safety
    const malformedChat = {
      model: 'opencode-go/deepseek-v4-pro',
      messages: [
        null,
        undefined,
        { role: 'user', content: null },
        { role: 'assistant', content: [] },
        { role: 'tool', tool_call_id: 'c1', content: null },
        { role: 'tool', tool_call_id: 'c2', output: undefined }
      ]
    };
    const compChat = contextCompactor.compactChatPayload(malformedChat);
    assert.ok(compChat, 'compactChatPayload must safely handle null and empty elements without crashing');

    const malformedResp = {
      model: 'opencode-go/deepseek-v4-pro',
      input: [
        null,
        { type: 'message', role: 'user', content: null },
        { type: 'function_call_output', call_id: 'f1', output: null }
      ]
    };
    const compResp = contextCompactor.compactResponsesPayload(malformedResp);
    assert.ok(compResp, 'compactResponsesPayload must safely handle null input items without crashing');
  });

  console.log(`\n========================================`);
  console.log(`✅ All ${passedTests}/${totalTests} Pruning & Isolation Adversarial Tests PASSED!`);
  console.log(`========================================`);
}

runAll().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
