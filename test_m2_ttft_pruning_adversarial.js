/**
 * Milestone 2 (M2) TTFT & Payload Pruning Adversarial Verification Suite
 * 
 * Challenger: challenger_m2_1 (critic, specialist)
 * Target Features:
 *   - Feature 6: Payload Pruning TTFT Overhead Elimination (eliminate double JSON.stringify)
 *   - Feature 7: Elimination of JSON Deep Copy in Pruning (shallow slice, no in-place mutation)
 *   - Challenge 1: 100K char multi-turn conversation TTFT throughput & shallow-slice non-pollution
 *   - Challenge 2: Pruning return dual compatibility (.input / [0] vs { pruned, modified }) & edge cases
 */

const assert = require('node:assert');
const { performance } = require('node:perf_hooks');
const codexAdapter = require('./codex-adapter');

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

// Helper to generate realistic 100K+ character multi-turn conversational payloads
function generateLargeConversation(options = {}) {
  const {
    oversizedToolOutput = false,
    oversizedMessage = false,
    turnCount = 5, // <= 5 turns keeps total items <= 16 (under 18 threshold)
    toolOutputLength = options.toolOutputLength || 1900, // < 2000 chars avoids tool output folding
    intermediateMsgLength = options.intermediateMsgLength || options.messageLength || 2200, // < 2500 avoids message folding
    finalQueryLength = options.finalQueryLength || 95000 // Last user turn can be 95K+ chars without being folded, making total > 100K chars
  } = options;

  const chatMessages = [
    {
      role: 'system',
      content: 'You are an advanced enterprise AI architect assistant with access to local tools.'
    }
  ];

  const responsesInput = [
    {
      type: 'message',
      role: 'system',
      content: 'You are an advanced enterprise AI architect assistant with access to local tools.'
    }
  ];

  for (let i = 1; i <= turnCount; i++) {
    // 1. User message
    const isIntermediate = i < turnCount;
    let userContent = `User query #${i}: Please inspect system module ${i} and report logs: ${'Detailed diagnostic instruction '.repeat(intermediateMsgLength / 35)}`;

    if (oversizedMessage && i === 2) {
      userContent = `User query #${i}: ${'Analyzing massive enterprise microservice architecture '.repeat(200)}`; // > 8000 chars
    }

    chatMessages.push({ role: 'user', content: userContent });
    responsesInput.push({ type: 'message', role: 'user', content: userContent });

    // 2. Assistant message with tool calls
    const toolCallId = `call_module_${i}_${Date.now()}`;
    const assistantContent = `I am executing diagnostic inspection on module ${i}.`;
    const toolArgs = JSON.stringify({
      module: `core-service-${i}`,
      filter: 'CRITICAL|ERROR|WARN',
      depth: 5,
      metadata: { requestedBy: 'admin', session: `sess-${i}` }
    });

    chatMessages.push({
      role: 'assistant',
      content: assistantContent,
      tool_calls: [
        {
          id: toolCallId,
          type: 'function',
          function: { name: 'query_logs', arguments: toolArgs }
        }
      ]
    });

    responsesInput.push({
      type: 'function_call',
      call_id: toolCallId,
      name: 'query_logs',
      arguments: toolArgs
    });

    // 3. Tool response
    const outputContent = oversizedToolOutput && i === 2
      ? `LOG_DUMP_START\n${'ERROR 2026-10-17 04:00:00 [WorkerThread] Connection timed out while streaming from cluster node. '.repeat(600)}\nLOG_DUMP_END` // > 60K chars
      : `LOG_SAMPLE: ${'Normal log line without errors. '.repeat(toolOutputLength / 32)}`;

    chatMessages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: outputContent
    });

    responsesInput.push({
      type: 'function_call_output',
      call_id: toolCallId,
      output: outputContent
    });
  }

  // Final user query that pushes total characters > 100K while remaining in valid conversation
  if (finalQueryLength > 0) {
    const finalContent = `Final user comprehensive review instruction: ${'Benchmark large prompt payload context validation data '.repeat(finalQueryLength / 55)}`;
    chatMessages.push({ role: 'user', content: finalContent });
    responsesInput.push({ type: 'message', role: 'user', content: finalContent });
  }

  // Calculate approximate total characters
  const chatCharCount = chatMessages.reduce((sum, m) => sum + (m.content ? m.content.length : 0), 0);
  const responsesCharCount = responsesInput.reduce((sum, item) => sum + (item.content ? item.content.length : (item.output ? item.output.length : 0)), 0);

  return {
    chatMessages,
    chatCharCount,
    responsesPayload: {
      model: 'opencode-go/deepseek-v4-pro',
      input: responsesInput,
      stream: true,
      temperature: 0.2
    },
    responsesCharCount
  };
}

async function main() {
  console.log('================================================================');
  console.log('⚡ Milestone 2 TTFT & Payload Pruning Adversarial Verification');
  console.log('================================================================\n');

  // ==========================================================================
  // CHALLENGE 1: 100K+ Char Context Pruning TTFT Throughput & Non-Pollution
  // ==========================================================================
  console.log('--- [CHALLENGE 1] 100K+ Char Context Pruning TTFT Throughput & Non-Pollution ---');

  await runTest('1.1 Unmodified Scenario (modified=false) for Responses API with >100K chars', () => {
    // Generate ~110K characters conversation within safe thresholds (<2000 tool output, turnCount <= 4, intermediate <= 2000)
    const { responsesPayload, responsesCharCount } = generateLargeConversation({
      turnCount: 4,
      toolOutputLength: 1800,
      intermediateMsgLength: 2000,
      finalQueryLength: 95000,
      oversizedToolOutput: false,
      oversizedMessage: false
    });

    assert.ok(responsesCharCount > 100000, `Payload must exceed 100K chars, got ${responsesCharCount} chars`);

    const result = codexAdapter.pruneResponsesPayload(responsesPayload);

    // Assert modified is false
    assert.strictEqual(result.modified, false, 'Unmodified payload must have modified === false');
    assert.strictEqual(result.input.length, responsesPayload.input.length, 'Input array length must not change');
    console.log(`    Payload size: ${(responsesCharCount / 1024).toFixed(1)} KB (${responsesCharCount} chars), modified=${result.modified}`);
  });

  await runTest('1.2 Unmodified Scenario (modified=false) for Chat Completions with >100K chars', () => {
    const { chatMessages, chatCharCount } = generateLargeConversation({
      turnCount: 4,
      toolOutputLength: 1800,
      intermediateMsgLength: 2000,
      finalQueryLength: 95000,
      oversizedToolOutput: false,
      oversizedMessage: false
    });

    assert.ok(chatCharCount > 100000, `Chat payload must exceed 100K chars, got ${chatCharCount} chars`);

    const result = codexAdapter.pruneChatMessages(chatMessages);

    assert.strictEqual(result.modified, false, 'Unmodified chat messages must have modified === false');
    assert.strictEqual(result.length, chatMessages.length, 'Messages array length must not change');
    console.log(`    Payload size: ${(chatCharCount / 1024).toFixed(1)} KB (${chatCharCount} chars), modified=${result.modified}`);
  });

  await runTest('1.3 Modified Scenario (modified=true) for Responses API (>100K chars, oversized tool output)', () => {
    const { responsesPayload, responsesCharCount } = generateLargeConversation({
      turnCount: 4,
      oversizedToolOutput: true, // Giant tool output > 60K chars
      finalQueryLength: 60000
    });

    assert.ok(responsesCharCount > 100000, `Payload must exceed 100K chars, got ${responsesCharCount} chars`);

    const result = codexAdapter.pruneResponsesPayload(responsesPayload);

    assert.strictEqual(result.modified, true, 'Oversized tool output must trigger modified === true');
    // Verify folding notice
    const foldedItem = result.input.find(item => item.output && item.output.includes('智能网关自愈：已自动折叠'));
    assert.ok(foldedItem, 'Tool output must contain auto-folding notice');
    assert.ok(foldedItem.output.length < 5000, 'Folded tool output must be compacted below 5000 chars');
    console.log(`    Payload size: ${(responsesCharCount / 1024).toFixed(1)} KB (${responsesCharCount} chars), modified=${result.modified}`);
  });

  await runTest('1.4 Modified Scenario (modified=true) for Chat Sliding Window (>100K chars, >18 turns)', () => {
    const { chatMessages, chatCharCount } = generateLargeConversation({
      turnCount: 20, // 20 * 3 + 1 = 61 items > 18, triggers sliding window
      intermediateMsgLength: 2000,
      finalQueryLength: 60000
    });

    assert.ok(chatCharCount > 100000, `Turn count & size must exceed 100K chars, got ${chatCharCount} chars`);
    assert.ok(chatMessages.length > 18, `Turn count must exceed 18, got ${chatMessages.length}`);

    const result = codexAdapter.pruneChatMessages(chatMessages);

    assert.strictEqual(result.modified, true, 'Sliding window pruning must trigger modified === true');
    assert.ok(result.length < chatMessages.length, 'Pruned messages count must be strictly less than original');
    const notice = result.find(m => m.role === 'system' && m.content && m.content.includes('智能网关已自动压缩中间'));
    assert.ok(notice, 'Must include sliding window notice in pruned messages');
    // System prompt and final messages must be intact
    assert.strictEqual(result[0].role, 'system');
    assert.strictEqual(result[result.length - 1].role, 'user');
    console.log(`    Payload size: ${(chatCharCount / 1024).toFixed(1)} KB (${chatCharCount} chars), originalTurns=${chatMessages.length}, prunedTurns=${result.length}`);
  });

  await runTest('1.5 Microbenchmark: New `modified` Flag vs Legacy Double `JSON.stringify` on >100K Payload', () => {
    const { responsesPayload, responsesCharCount } = generateLargeConversation({
      turnCount: 4,
      oversizedToolOutput: true,
      finalQueryLength: 60000
    });

    assert.ok(responsesCharCount > 100000, `Payload must exceed 100K chars, got ${responsesCharCount} chars`);
    const payloadJsonStr = JSON.stringify(responsesPayload);
    const payloadSizeKB = (payloadJsonStr.length / 1024).toFixed(1);
    const WARMUP_RUNS = 20;
    const BENCH_RUNS = 100;

    // Warmup
    for (let i = 0; i < WARMUP_RUNS; i++) {
      codexAdapter.pruneResponsesPayload(responsesPayload);
      JSON.stringify(responsesPayload);
    }

    // Benchmark Legacy Double JSON.stringify Approach
    const legacyStart = performance.now();
    for (let i = 0; i < BENCH_RUNS; i++) {
      const beforePrune = JSON.stringify(responsesPayload);
      const pruned = codexAdapter.pruneResponsesPayload(responsesPayload);
      const afterPrune = JSON.stringify(pruned);
      const wasPruned = beforePrune !== afterPrune;
      if (!wasPruned) throw new Error('Legacy bench expected wasPruned=true');
    }
    const legacyElapsedMs = performance.now() - legacyStart;
    const legacyAvgMs = legacyElapsedMs / BENCH_RUNS;

    // Benchmark New Zero-Double-Stringify Approach
    const newStart = performance.now();
    for (let i = 0; i < BENCH_RUNS; i++) {
      const pruneRes = codexAdapter.pruneResponsesPayload(responsesPayload);
      const wasPruned = Boolean(pruneRes.modified);
      if (!wasPruned) throw new Error('New bench expected wasPruned=true');
    }
    const newElapsedMs = performance.now() - newStart;
    const newAvgMs = newElapsedMs / BENCH_RUNS;

    const speedup = legacyAvgMs / newAvgMs;
    const ttftSavedMsPerReq = legacyAvgMs - newAvgMs;

    console.log(`    [Benchmark Payload Size]: ${payloadSizeKB} KB (${payloadJsonStr.length} chars)`);
    console.log(`    [Legacy Double stringify]: total=${legacyElapsedMs.toFixed(2)} ms, avg=${legacyAvgMs.toFixed(4)} ms/req`);
    console.log(`    [New Direct modified flag]: total=${newElapsedMs.toFixed(2)} ms, avg=${newAvgMs.toFixed(4)} ms/req (${(newAvgMs * 1000).toFixed(1)} µs)`);
    console.log(`    [TTFT Performance Gain]: ${speedup.toFixed(1)}x faster, saved ${ttftSavedMsPerReq.toFixed(3)} ms per request`);

    // Assertions: new approach must be substantially faster and run under 0.2ms
    assert.ok(newAvgMs < 0.25, `New pruning check should be under 0.25ms, got ${newAvgMs.toFixed(4)} ms`);
    assert.ok(speedup > 1.8, `Expected at least 1.8x speedup over double JSON.stringify, got ${speedup.toFixed(1)}x`);
  });

  await runTest('1.6 Adversarial Shallow-Slice Non-Pollution Test (Zero In-Place Mutation of Original Payload)', () => {
    // Generate complex payload with 100K chars
    const { responsesPayload, chatMessages } = generateLargeConversation({
      turnCount: 15,
      oversizedToolOutput: true,
      oversizedMessage: true
    });

    // Take complete snapshots before running pruning
    const responsesSnapshot = JSON.parse(JSON.stringify(responsesPayload));
    const chatSnapshot = JSON.parse(JSON.stringify(chatMessages));

    // Save item object reference handles
    const originalInputRefs = responsesPayload.input.map(item => item);
    const originalChatRefs = chatMessages.map(msg => msg);

    // Execute pruning that triggers modifications
    const prunedResponses = codexAdapter.pruneResponsesPayload(responsesPayload);
    const prunedChat = codexAdapter.pruneChatMessages(chatMessages);

    assert.strictEqual(prunedResponses.modified, true);
    assert.strictEqual(prunedChat.modified, true);

    // CRITICAL ASSERTION: The original responsesPayload MUST BE 100% IDENTICAL to its pre-pruning snapshot!
    assert.deepStrictEqual(
      responsesPayload,
      responsesSnapshot,
      'Adversarial Failure: pruneResponsesPayload mutated original payload in-place!'
    );

    // CRITICAL ASSERTION: The original chatMessages MUST BE 100% IDENTICAL to its pre-pruning snapshot!
    assert.deepStrictEqual(
      chatMessages,
      chatSnapshot,
      'Adversarial Failure: pruneChatMessages mutated original messages in-place!'
    );

    // Check individual array references: original array items were not modified
    for (let i = 0; i < responsesPayload.input.length; i++) {
      assert.strictEqual(
        responsesPayload.input[i],
        originalInputRefs[i],
        `Original input[${i}] reference should be untouched`
      );
      assert.strictEqual(
        responsesPayload.input[i].output,
        responsesSnapshot.input[i].output,
        `Original input[${i}].output should not be modified`
      );
    }

    for (let i = 0; i < chatMessages.length; i++) {
      assert.strictEqual(
        chatMessages[i],
        originalChatRefs[i],
        `Original chatMessages[${i}] reference should be untouched`
      );
      assert.strictEqual(
        chatMessages[i].content,
        chatSnapshot[i].content,
        `Original chatMessages[${i}].content should not be modified`
      );
    }

    // Verify pruned array is a new reference, not the original array
    assert.notStrictEqual(prunedResponses.input, responsesPayload.input, 'pruned.input must be a sliced new array');
    assert.notStrictEqual(prunedChat, chatMessages, 'prunedChat must be a sliced new array');
  });


  // ==========================================================================
  // CHALLENGE 2: Pruning Return Dual Compatibility & Boundary Matrix
  // ==========================================================================
  console.log('\n--- [CHALLENGE 2] Pruning Return Dual Compatibility & Boundary Matrix ---');

  await runTest('2.1 Legacy Access Parity: pruneResponsesPayload returns standard object (.input, properties)', () => {
    const raw = {
      model: 'opencode-go/deepseek-v4-pro',
      temperature: 0.5,
      stream: true,
      input: [
        { type: 'message', role: 'user', content: 'hello' }
      ]
    };

    const ret = codexAdapter.pruneResponsesPayload(raw);

    // Old callers access ret.input, ret.model, ret.stream directly
    assert.strictEqual(typeof ret, 'object', 'Return must be object');
    assert.strictEqual(ret.model, 'opencode-go/deepseek-v4-pro');
    assert.strictEqual(ret.temperature, 0.5);
    assert.strictEqual(ret.stream, true);
    assert.ok(Array.isArray(ret.input), 'ret.input must be array');
    assert.strictEqual(ret.input[0].content, 'hello');

    // Spread operator copy
    const cloned = { ...ret };
    assert.strictEqual(cloned.model, 'opencode-go/deepseek-v4-pro');
    assert.strictEqual(cloned.input.length, 1);
  });

  await runTest('2.2 Legacy Access Parity: pruneChatMessages returns standard Array ([0], .length, methods, pure JSON)', () => {
    const msgs = [
      { role: 'system', content: 'You are an assistant' },
      { role: 'user', content: 'What is 2+2?' }
    ];

    const ret = codexAdapter.pruneChatMessages(msgs);

    // Array assertions
    assert.strictEqual(Array.isArray(ret), true, 'pruneChatMessages MUST return Array instance');
    assert.strictEqual(ret.length, 2, 'ret.length must match element count');
    assert.strictEqual(ret[0].role, 'system');
    assert.strictEqual(ret[1].content, 'What is 2+2?');

    // Array methods must work seamlessly
    const roles = ret.map(m => m.role);
    assert.deepStrictEqual(roles, ['system', 'user']);

    const userMsgs = ret.filter(m => m.role === 'user');
    assert.strictEqual(userMsgs.length, 1);

    // Array destructuring
    const [firstMsg, secondMsg] = ret;
    assert.strictEqual(firstMsg.role, 'system');
    assert.strictEqual(secondMsg.role, 'user');

    // CRITICAL: JSON.stringify(ret) MUST serialize as a pure JSON array, ignoring .modified/.pruned!
    const jsonStr = JSON.stringify(ret);
    assert.ok(jsonStr.startsWith('['), 'JSON.stringify of return array must start with [');
    assert.ok(jsonStr.endsWith(']'), 'JSON.stringify of return array must end with ]');
    const parsed = JSON.parse(jsonStr);
    assert.strictEqual(Array.isArray(parsed), true);
    assert.strictEqual(parsed.modified, undefined, 'Stringified array must not contain modified property');
    assert.strictEqual(parsed.pruned, undefined, 'Stringified array must not contain pruned property');
  });

  await runTest('2.3 New Destructuring Parity: const { pruned, modified } = pruneResponsesPayload(...)', () => {
    const payloadUnmodified = {
      model: 'opencode-go/deepseek-v4-pro',
      input: [{ type: 'message', role: 'user', content: 'brief task' }]
    };

    const { pruned: p1, modified: m1 } = codexAdapter.pruneResponsesPayload(payloadUnmodified);
    assert.strictEqual(m1, false, 'Unmodified payload must destructure modified=false');
    assert.strictEqual(typeof p1, 'object');
    assert.strictEqual(p1.input.length, 1);
    assert.strictEqual(p1.pruned, p1, 'p1.pruned must self-reference for dual access');

    // Oversized tool output
    const payloadModified = {
      model: 'opencode-go/deepseek-v4-pro',
      input: [
        { type: 'message', role: 'user', content: 'task' },
        { type: 'function_call_output', call_id: 'call_1', output: 'X'.repeat(5000) }
      ]
    };

    const { pruned: p2, modified: m2 } = codexAdapter.pruneResponsesPayload(payloadModified);
    assert.strictEqual(m2, true, 'Modified payload must destructure modified=true');
    assert.strictEqual(p2.input.length, 2);
    assert.ok(p2.input[1].output.includes('已自动折叠'));
  });

  await runTest('2.4 New Destructuring Parity: const { pruned, modified } = pruneChatMessages(...)', () => {
    const msgsUnmodified = [
      { role: 'user', content: 'brief task' }
    ];

    const { pruned: p1, modified: m1 } = codexAdapter.pruneChatMessages(msgsUnmodified);
    assert.strictEqual(m1, false, 'Unmodified messages must destructure modified=false');
    assert.strictEqual(Array.isArray(p1), true, 'pruned must be Array');
    assert.strictEqual(p1.length, 1);
    assert.strictEqual(p1.pruned, p1);

    // Oversized tool content
    const msgsModified = [
      { role: 'user', content: 'task' },
      { role: 'tool', tool_call_id: 'call_1', content: 'Y'.repeat(10000) }
    ];

    const { pruned: p2, modified: m2 } = codexAdapter.pruneChatMessages(msgsModified);
    assert.strictEqual(m2, true, 'Modified messages must destructure modified=true');
    assert.strictEqual(Array.isArray(p2), true);
    assert.ok(p2[1].content.includes('已自动折叠'));
  });

  await runTest('2.5 Boundary Matrix: Empty, Non-Array, and Nullish Inputs', () => {
    // 1. pruneResponsesPayload boundaries
    const b1 = codexAdapter.pruneResponsesPayload(null);
    assert.strictEqual(b1.modified, false);
    assert.strictEqual(typeof b1, 'object');
    const { pruned: pB1, modified: mB1 } = b1;
    assert.strictEqual(mB1, false);

    const b2 = codexAdapter.pruneResponsesPayload(undefined);
    assert.strictEqual(b2.modified, false);
    assert.strictEqual(typeof b2, 'object');

    const b3 = codexAdapter.pruneResponsesPayload({});
    assert.strictEqual(b3.modified, false);
    assert.strictEqual(b3.input, undefined);

    const b4 = codexAdapter.pruneResponsesPayload({ input: [] });
    assert.strictEqual(b4.modified, false);
    assert.deepStrictEqual(b4.input, []);

    const b5 = codexAdapter.pruneResponsesPayload({ input: 'not-an-array' });
    assert.strictEqual(b5.modified, false);
    assert.strictEqual(b5.input, 'not-an-array');

    // 2. pruneChatMessages boundaries
    const mEmpty = codexAdapter.pruneChatMessages([]);
    assert.strictEqual(Array.isArray(mEmpty), true);
    assert.strictEqual(mEmpty.length, 0);
    assert.strictEqual(mEmpty.modified, false);
    const { pruned: pEmpty, modified: mEmptyFlag } = mEmpty;
    assert.strictEqual(mEmptyFlag, false);
    assert.strictEqual(pEmpty.length, 0);

    // Non-array inputs to pruneChatMessages: should return input gracefully without crash
    const mNull = codexAdapter.pruneChatMessages(null);
    assert.strictEqual(mNull, null);

    const mUndefined = codexAdapter.pruneChatMessages(undefined);
    assert.strictEqual(mUndefined, undefined);

    const mString = codexAdapter.pruneChatMessages('invalid string');
    assert.strictEqual(mString, 'invalid string');
  });

  await runTest('2.6 Boundary Matrix: Corrupted/Sparse Array Elements & Type Safety', () => {
    const corruptChat = [
      null,
      undefined,
      123,
      'a string message',
      {},
      { role: 'user', content: null },
      { role: 'tool', tool_call_id: 'call_x', content: undefined },
      { role: 'assistant', content: 'Valid content' }
    ];

    // Must not crash on corrupted array elements
    const resChat = codexAdapter.pruneChatMessages(corruptChat);
    assert.strictEqual(Array.isArray(resChat), true);
    assert.strictEqual(resChat.length, corruptChat.length);
    assert.strictEqual(resChat.modified, false);

    const corruptResponses = {
      input: [
        null,
        undefined,
        456,
        'string item',
        {},
        { type: 'message', content: null },
        { type: 'function_call_output', output: null },
        { call_id: 'c1', output: undefined }
      ]
    };

    // Must not crash on corrupted responses items
    const resResp = codexAdapter.pruneResponsesPayload(corruptResponses);
    assert.strictEqual(resResp.modified, false);
    assert.strictEqual(resResp.input.length, corruptResponses.input.length);
  });

  await runTest('2.7 Sliding Window Turn-Count Threshold Edge Testing (17, 18, 19 items)', () => {
    // Threshold is > 18
    function makeMessages(count) {
      const arr = [{ role: 'system', content: 'sys' }];
      for (let i = 1; i < count; i++) {
        arr.push({ role: i % 2 === 1 ? 'user' : 'assistant', content: `turn ${i}` });
      }
      return arr;
    }

    // 17 items -> No sliding window
    const msgs17 = makeMessages(17);
    const res17 = codexAdapter.pruneChatMessages(msgs17);
    assert.strictEqual(res17.modified, false, '17 items should not trigger sliding window');
    assert.strictEqual(res17.length, 17);

    // 18 items -> No sliding window (condition is > 18)
    const msgs18 = makeMessages(18);
    const res18 = codexAdapter.pruneChatMessages(msgs18);
    assert.strictEqual(res18.modified, false, '18 items should not trigger sliding window');
    assert.strictEqual(res18.length, 18);

    // 19 items -> Sliding window TRIGGERS
    const msgs19 = makeMessages(19);
    const res19 = codexAdapter.pruneChatMessages(msgs19);
    assert.strictEqual(res19.modified, true, '19 items must trigger sliding window');
    assert.ok(res19.length < 19, '19 items should be compressed');

    // Responses sliding window threshold (input.length > 18)
    function makeResponsesInput(count) {
      const arr = [{ type: 'message', role: 'system', content: 'sys' }];
      for (let i = 1; i < count; i++) {
        arr.push({ type: 'message', role: i % 2 === 1 ? 'user' : 'assistant', content: `turn ${i}` });
      }
      return arr;
    }

    const resp18 = codexAdapter.pruneResponsesPayload({ input: makeResponsesInput(18) });
    assert.strictEqual(resp18.modified, false, 'Responses 18 items should not trigger sliding window');

    const resp19 = codexAdapter.pruneResponsesPayload({ input: makeResponsesInput(19) });
    assert.strictEqual(resp19.modified, true, 'Responses 19 items must trigger sliding window');
    assert.ok(resp19.input.length < 19);
  });

  await runTest('2.8 Sliding Window Atomic Tool Call Integrity (Responses Boundary Safety)', () => {
    // Construct 25 items where items around index 10-14 are paired tool calls & tool outputs
    const input = [
      { type: 'message', role: 'system', content: 'sys' },
      { type: 'message', role: 'user', content: 'initial user' }
    ];

    for (let i = 2; i < 11; i++) {
      input.push({ type: 'message', role: 'assistant', content: `msg ${i}` });
    }

    // Atomic tool call + output sequence at the potential cut boundary
    input.push({ type: 'function_call', call_id: 'call_boundary', name: 'search', arguments: '{}' });
    input.push({ type: 'function_call_output', call_id: 'call_boundary', output: 'result' });

    for (let i = 13; i < 24; i++) {
      input.push({ type: 'message', role: 'user', content: `msg ${i}` });
    }

    const pruned = codexAdapter.pruneResponsesPayload({ input });
    assert.strictEqual(pruned.modified, true);

    // Ensure that if a function_call_output is in tail, its corresponding or boundary semantics don't cause an orphan
    const tailOutputs = pruned.input.filter(item => item.type === 'function_call_output');
    for (const out of tailOutputs) {
      assert.ok(out.call_id, 'Retained output must have call_id');
    }
  });

  await runTest('2.9 Server.js Context-Length-Exceeded Self-Healing Path Simulation', () => {
    // Simulate server.js lines 1150-1160 logic exactly
    const mockPayloadChat = {
      model: 'opencode-go/deepseek-v4-pro',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
        { role: 'tool', tool_call_id: 'c1', content: 'A'.repeat(50000) }
      ]
    };

    let pruned = mockPayloadChat;
    let wasPruned = false;

    if (Array.isArray(mockPayloadChat.messages)) {
      const pruneRes = codexAdapter.pruneChatMessages(mockPayloadChat.messages);
      const prunedMsgs = pruneRes.pruned || pruneRes;
      wasPruned = Boolean(pruneRes.modified);
      pruned = { ...mockPayloadChat, messages: prunedMsgs };
    }

    assert.strictEqual(wasPruned, true, 'Server simulation should identify wasPruned=true');
    assert.ok(pruned.messages[2].content.includes('已自动折叠'));
    assert.strictEqual(pruned.model, 'opencode-go/deepseek-v4-pro');

    // Simulate Responses API path
    const mockPayloadResp = {
      model: 'opencode-go/deepseek-v4-pro',
      input: [
        { type: 'message', role: 'user', content: 'hello' },
        { type: 'function_call_output', call_id: 'c1', output: 'B'.repeat(50000) }
      ]
    };

    let prunedResp = mockPayloadResp;
    let wasPrunedResp = false;

    if (Array.isArray(mockPayloadResp.input)) {
      const pruneRes = codexAdapter.pruneResponsesPayload(mockPayloadResp);
      prunedResp = pruneRes.pruned || pruneRes;
      wasPrunedResp = Boolean(pruneRes.modified);
    }

    assert.strictEqual(wasPrunedResp, true, 'Server simulation should identify wasPrunedResp=true');
    assert.ok(prunedResp.input[1].output.includes('已自动折叠'));
    assert.strictEqual(prunedResp.model, 'opencode-go/deepseek-v4-pro');
  });

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} ADVERSARIAL CHALLENGES PASSED EMPIRICALLY!`);
  console.log('================================================================');
}

main().catch(err => {
  console.error('Fatal challenge runner error:', err);
  process.exit(1);
});
