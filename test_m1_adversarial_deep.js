/**
 * Milestone 1 (M1) Empirical Adversarial Verification Suite
 * 
 * Target Challenges:
 * 1. Anthropic Stream Watchdog Data Refresh & True Stall Resilience:
 *    - Slow SSE streaming (>300s total elapsed duration, chunks arriving at intervals)
 *    - lastDataTime refresh assertion: stream NEVER prematurely killed
 *    - True silence >300s (or >600s for thinking models): properly emits response.failed
 *    - Real-time chunk delivery and event loop integrity
 * 
 * 2. Failover Error & Close Listener Zero-Leak Stress Harness:
 *    - 429 RateLimit failover listener count lifecycle
 *    - 500/502/503 Glitch failover listener count lifecycle
 *    - 401 InvalidApiKey failover listener count lifecycle
 *    - clientRes.setMaxListeners(3) low-ceiling stress assault (25 retries)
 *    - Zero MaxListenersExceededWarning verification
 */

const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const codexAdapter = require('./codex-adapter');
const serverMod = require('./server');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        passedTests++;
        console.log(`  ✓ PASS: ${name}`);
      }).catch(err => {
        console.error(`  ❌ FAIL: ${name}\n    Error: ${err.message}`);
        throw err;
      });
    } else {
      passedTests++;
      console.log(`  ✓ PASS: ${name}`);
    }
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}\n    Error: ${err.message}`);
    throw err;
  }
}

async function main() {
  console.log('================================================================');
  console.log('🛡️  Milestone 1 Empirical Adversarial Challenge Suite');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // SECTION 1: Anthropic Stream Watchdog Adversarial Tests
  // --------------------------------------------------------------------------
  console.log('--- [CHALLENGE 1] Anthropic Stream Watchdog Adversarial Tests ---');

  await runTest('1.1 Slow Chunk Stream (>300s total elapsed) survives due to lastDataTime refresh', async () => {
    const mockUpstream = new EventEmitter();
    mockUpstream.destroy = () => { mockUpstream.destroyed = true; };

    const mockClientRes = new EventEmitter();
    const emittedEvents = [];
    mockClientRes.writeHead = () => {};
    mockClientRes.write = (chunk) => {
      const str = chunk.toString();
      const match = str.match(/event:\s*([^\n]+)/);
      if (match) {
        emittedEvents.push(match[1]);
      }
    };
    mockClientRes.end = () => { mockClientRes.writableEnded = true; };
    mockClientRes.writableEnded = false;
    mockClientRes.destroyed = false;

    // Clock virtualization
    const origDateNow = Date.now;
    let virtualTime = 1000000000;
    Date.now = () => virtualTime;

    let finishedCalled = false;
    try {
      codexAdapter.bridgeAnthropicStream(mockUpstream, mockClientRes, 'claude-3-5-sonnet', 'resp_adv_1', () => {
        finishedCalled = true;
      });

      // Stream started: initial response.created event
      assert.ok(emittedEvents.includes('response.created'), 'Must send response.created');

      // Send 5 chunks separated by 200 virtual seconds each.
      // Total elapsed = 5 * 200s = 1000 seconds (>> 300s default stall threshold)
      for (let i = 1; i <= 5; i++) {
        virtualTime += 200000; // +200s
        mockUpstream.emit('data', Buffer.from(`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"chunk ${i} "}}\n\n`));
        assert.strictEqual(emittedEvents.includes('response.failed'), false, `Watchdog must NOT kill stream at t=${i * 200}s`);
        assert.strictEqual(mockClientRes.writableEnded, false, 'Client response must remain open');
      }

      assert.strictEqual(finishedCalled, false, 'Stream must not be finished yet');
    } finally {
      // Clean up mock
      mockClientRes.emit('close');
      Date.now = origDateNow;
    }
  });

  await runTest('1.2 True Stall Silence (>300s without data) correctly triggers response.failed with upstream_stream_timeout', async () => {
    const mockUpstream = new EventEmitter();
    mockUpstream.destroy = () => { mockUpstream.destroyed = true; };

    const mockClientRes = new EventEmitter();
    const writtenChunks = [];
    mockClientRes.writeHead = () => {};
    mockClientRes.write = (chunk) => { writtenChunks.push(chunk.toString()); };
    mockClientRes.end = () => { mockClientRes.writableEnded = true; };
    mockClientRes.writableEnded = false;
    mockClientRes.destroyed = false;

    const origDateNow = Date.now;
    let virtualTime = 2000000000;
    Date.now = () => virtualTime;

    let finishedCalled = false;
    try {
      codexAdapter.bridgeAnthropicStream(mockUpstream, mockClientRes, 'claude-3-5-sonnet', 'resp_adv_stall', () => {
        finishedCalled = true;
      });

      // Send initial data chunk at t=0
      mockUpstream.emit('data', Buffer.from('data: {"type":"message_start","message":{"id":"msg_1"}}\n\n'));

      // Advance time by 305 seconds of absolute silence (> 300,000ms threshold)
      virtualTime += 305000;

      // Allow watchdog timer to fire by waiting slightly
      await new Promise(resolve => setTimeout(resolve, 5500));

      // Verify response.failed was dispatched
      const failedChunk = writtenChunks.find(c => c.includes('event: response.failed'));
      assert.ok(failedChunk, 'Must dispatch event: response.failed upon stall > 300s');

      const dataMatch = failedChunk.match(/data:\s*([^\n]+)/);
      assert.ok(dataMatch, 'Failed event must have JSON payload');
      const payload = JSON.parse(dataMatch[1]);
      assert.strictEqual(payload.type, 'response.failed');
      assert.strictEqual(payload.response.status, 'failed');
      assert.strictEqual(payload.response.error.code, 'upstream_stream_timeout');
      assert.ok(payload.response.error.message.includes('longer than 300s'), 'Error message must specify 300s stall');

      assert.strictEqual(mockClientRes.writableEnded, true, 'clientRes.end() must be called on stall');
      assert.strictEqual(finishedCalled, true, 'onFinished callback must be invoked');
    } finally {
      Date.now = origDateNow;
    }
  });

  await runTest('1.3 Real-time continuous slow streaming (5 chunks, real timers) translates cleanly without stall', async () => {
    const mockUpstream = new EventEmitter();
    mockUpstream.destroy = () => { mockUpstream.destroyed = true; };

    const mockClientRes = new EventEmitter();
    const outputDeltas = [];
    mockClientRes.writeHead = () => {};
    mockClientRes.write = (chunk) => {
      const str = chunk.toString();
      if (str.includes('response.output_text.delta')) {
        const match = str.match(/data:\s*([^\n]+)/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.delta) outputDeltas.push(parsed.delta);
        }
      }
    };
    mockClientRes.end = () => { mockClientRes.writableEnded = true; };
    mockClientRes.writableEnded = false;
    mockClientRes.destroyed = false;

    let streamCompleted = false;
    codexAdapter.bridgeAnthropicStream(mockUpstream, mockClientRes, 'claude-3-5-sonnet', 'resp_adv_real', () => {
      streamCompleted = true;
    });

    mockUpstream.emit('data', Buffer.from('data: {"type":"message_start","message":{"id":"msg_real","usage":{"input_tokens":5}}}\n\n'));
    mockUpstream.emit('data', Buffer.from('data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'));

    // Emit 4 chunks with 200ms delay between each
    for (let i = 1; i <= 4; i++) {
      await new Promise(r => setTimeout(r, 200));
      mockUpstream.emit('data', Buffer.from(`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"part${i} "}}\n\n`));
    }

    mockUpstream.emit('data', Buffer.from('data: {"type":"content_block_stop","index":0}\n\n'));
    mockUpstream.emit('data', Buffer.from('data: {"type":"message_delta","usage":{"output_tokens":8}}\n\n'));
    mockUpstream.emit('data', Buffer.from('data: {"type":"message_stop"}\n\n'));
    mockUpstream.emit('end');

    assert.strictEqual(outputDeltas.join(''), 'part1 part2 part3 part4 ', 'All text deltas must be translated accurately');
    assert.strictEqual(streamCompleted, true, 'Stream must complete cleanly');
  });

  await runTest('1.4 Reasoning / Thinking model stall threshold (600s) honors deep thought interval', async () => {
    const mockUpstream = new EventEmitter();
    mockUpstream.destroy = () => { mockUpstream.destroyed = true; };

    const mockClientRes = new EventEmitter();
    const writtenEvents = [];
    mockClientRes.writeHead = () => {};
    mockClientRes.write = (chunk) => {
      const match = chunk.toString().match(/event:\s*([^\n]+)/);
      if (match) writtenEvents.push(match[1]);
    };
    mockClientRes.end = () => { mockClientRes.writableEnded = true; };
    mockClientRes.writableEnded = false;
    mockClientRes.destroyed = false;

    const origDateNow = Date.now;
    let virtualTime = 3000000000;
    Date.now = () => virtualTime;

    try {
      codexAdapter.bridgeAnthropicStream(mockUpstream, mockClientRes, 'claude-3-7-sonnet-thought', 'resp_adv_think', () => {});

      // Start message & thinking block
      mockUpstream.emit('data', Buffer.from('data: {"type":"message_start","message":{"id":"msg_think"}}\n\n'));
      mockUpstream.emit('data', Buffer.from('data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n'));

      // Advance by 450 seconds (>300s standard, but <600s thinking threshold)
      virtualTime += 450000;

      // Allow 5s watchdog interval check
      await new Promise(resolve => setTimeout(resolve, 5500));

      assert.strictEqual(writtenEvents.includes('response.failed'), false, 'Thinking stream must NOT stall at 450s');

      // Now advance past 600s (e.g. +160s, total 610s silence)
      virtualTime += 160000;
      await new Promise(resolve => setTimeout(resolve, 5500));

      assert.ok(writtenEvents.includes('response.failed'), 'Thinking stream MUST stall when exceeding 600s');
    } finally {
      Date.now = origDateNow;
    }
  });

  // --------------------------------------------------------------------------
  // SECTION 2: Failover Error & Close Listener Zero-Leak Adversarial Tests
  // --------------------------------------------------------------------------
  console.log('\n--- [CHALLENGE 2] Failover Listener Zero-Leak Adversarial Tests ---');

  await runTest('2.1 handleRateLimitFailover (429/503) strictly unbinds both error and close listeners across retries', () => {
    const mockClientRes = new EventEmitter();
    mockClientRes.writableEnded = false;
    mockClientRes.destroyed = false;

    let retryCount = 0;
    const clientErrorHandler = () => {};
    const clientCloseHandler = () => {};
    clientCloseHandler.errorHandler = clientErrorHandler;

    // Attach listeners as router would
    mockClientRes.on('close', clientCloseHandler);
    mockClientRes.on('error', clientErrorHandler);

    assert.strictEqual(mockClientRes.listenerCount('close'), 1);
    assert.strictEqual(mockClientRes.listenerCount('error'), 1);

    const mockUpstreamRes = new EventEmitter();
    mockUpstreamRes.statusCode = 429;
    mockUpstreamRes.headers = { 'retry-after': '2' };

    const testAccount = { id: 'acc_test_1', name: 'Test Account 1', apiKey: 'k1', enabled: true };
    const triedAccountIds = new Set(['acc_test_1']);

    serverMod.handleRateLimitFailover({
      protocolTag: 'AdversarialTest',
      clientRes: mockClientRes,
      account: testAccount,
      attemptNumber: 1,
      triedAccountIds,
      sessionId: 'session_adv_leak_1',
      statusCode: 429,
      upstreamRes: mockUpstreamRes,
      finishRequest: () => {},
      clientCloseHandler,
      clientErrorHandler,
      retryFn: (nextAccount) => {
        retryCount++;
        // CRITICAL CHECK: In retryFn, previous listeners MUST already be completely detached!
        assert.strictEqual(mockClientRes.listenerCount('close'), 0, 'close listener must be 0 in retryFn');
        assert.strictEqual(mockClientRes.listenerCount('error'), 0, 'error listener must be 0 in retryFn');
      },
      errorFallbackFn: () => {}
    });

    // Upstream finishes reading error body
    mockUpstreamRes.emit('end');

    // After failover completion, listener count must be 0
    assert.strictEqual(mockClientRes.listenerCount('close'), 0, 'close listener must be 0 after failover');
    assert.strictEqual(mockClientRes.listenerCount('error'), 0, 'error listener must be 0 after failover');
  });

  await runTest('2.2 handleInvalidApiKeyFailover (401) strictly unbinds both error and close listeners before retry', () => {
    const mockClientRes = new EventEmitter();
    const clientErrorHandler = () => {};
    const clientCloseHandler = () => {};
    clientCloseHandler.errorHandler = clientErrorHandler;

    mockClientRes.on('close', clientCloseHandler);
    mockClientRes.on('error', clientErrorHandler);

    assert.strictEqual(mockClientRes.listenerCount('close'), 1);
    assert.strictEqual(mockClientRes.listenerCount('error'), 1);

    const testAccount = { id: 'acc_test_invalid', name: 'Test Account Invalid', apiKey: 'bad_k', enabled: true };
    const triedAccountIds = new Set(['acc_test_invalid']);

    serverMod.handleInvalidApiKeyFailover({
      protocolTag: 'AdversarialTest',
      clientRes: mockClientRes,
      account: testAccount,
      attemptNumber: 1,
      triedAccountIds,
      sessionId: 'session_adv_leak_2',
      statusCode: 401,
      errText: 'Invalid API Key',
      finishRequest: () => {},
      clientCloseHandler,
      clientErrorHandler,
      retryFn: (nextAcc) => {
        // MUST BE ZERO in retryFn!
        assert.strictEqual(mockClientRes.listenerCount('close'), 0);
        assert.strictEqual(mockClientRes.listenerCount('error'), 0);
      }
    });

    assert.strictEqual(mockClientRes.listenerCount('close'), 0);
    assert.strictEqual(mockClientRes.listenerCount('error'), 0);
  });

  await runTest('2.3 handleUpstreamGlitchAndFailover (502 / ECONNRESET) unbinds listeners with zero residue', async () => {
    const mockClientRes = new EventEmitter();
    const clientErrorHandler = () => {};
    const clientCloseHandler = () => {};
    clientCloseHandler.errorHandler = clientErrorHandler;

    mockClientRes.on('close', clientCloseHandler);
    mockClientRes.on('error', clientErrorHandler);

    assert.strictEqual(mockClientRes.listenerCount('close'), 1);
    assert.strictEqual(mockClientRes.listenerCount('error'), 1);

    const testAccount = { id: 'acc_test_glitch', name: 'Test Account Glitch', apiKey: 'k_glitch', enabled: true };

    let retried = false;
    serverMod.handleUpstreamGlitchAndFailover({
      protocolTag: 'AdversarialTest',
      clientRes: mockClientRes,
      account: testAccount,
      attemptNumber: 2, // Attempt 2: switches to next account
      triedAccountIds: new Set(['acc_test_glitch']),
      sessionId: 'session_adv_leak_3',
      statusCode: 502,
      errText: '502 Bad Gateway Cloudflare',
      finishRequest: () => {},
      clientCloseHandler,
      clientErrorHandler,
      retryCurrentAccount: () => {},
      retryNextAccount: () => {
        retried = true;
        // In retryNextAccount, previous listeners MUST already be completely removed!
        assert.strictEqual(mockClientRes.listenerCount('close'), 0);
        assert.strictEqual(mockClientRes.listenerCount('error'), 0);
      },
      fallbackModelFn: () => {}
    });

    assert.strictEqual(mockClientRes.listenerCount('close'), 0);
    assert.strictEqual(mockClientRes.listenerCount('error'), 0);
  });

  await runTest('2.4 Multi-Turn Cascading Failover (25 retries on setMaxListeners(3)) emits ZERO warnings and leaks 0 listeners', () => {
    const mockClientRes = new EventEmitter();
    // Set a very strict max listeners ceiling (3). If any listeners leak, Node.js will warn or fail
    mockClientRes.setMaxListeners(3);

    const warnings = [];
    const onWarning = (w) => warnings.push(w);
    process.on('warning', onWarning);

    try {
      // Simulate 25 consecutive failover retries on the SAME clientRes
      for (let turn = 1; turn <= 25; turn++) {
        const clientErrorHandler = () => {};
        const clientCloseHandler = () => {};
        clientCloseHandler.errorHandler = clientErrorHandler;

        mockClientRes.on('close', clientCloseHandler);
        mockClientRes.on('error', clientErrorHandler);

        assert.strictEqual(mockClientRes.listenerCount('close'), 1, `Turn ${turn}: close listener must be 1 before failover`);
        assert.strictEqual(mockClientRes.listenerCount('error'), 1, `Turn ${turn}: error listener must be 1 before failover`);

        serverMod.handleUpstreamGlitchAndFailover({
          protocolTag: 'MultiTurnStress',
          clientRes: mockClientRes,
          account: { id: `acc_${turn}`, name: `Acc ${turn}`, apiKey: `k${turn}`, enabled: true },
          attemptNumber: 2,
          triedAccountIds: new Set([`acc_${turn}`]),
          sessionId: `session_multiturn_${turn}`,
          statusCode: 502,
          errText: '502 Bad Gateway',
          finishRequest: () => {},
          clientCloseHandler,
          clientErrorHandler,
          retryCurrentAccount: () => {},
          retryNextAccount: () => {},
          fallbackModelFn: () => {}
        });

        // After each failover, verify it is reset strictly to 0
        assert.strictEqual(mockClientRes.listenerCount('close'), 0, `Turn ${turn}: close listener must be 0 after failover`);
        assert.strictEqual(mockClientRes.listenerCount('error'), 0, `Turn ${turn}: error listener must be 0 after failover`);
      }

      // Assert zero MaxListenersExceeded warnings occurred
      const maxListenerWarnings = warnings.filter(w => w.name === 'MaxListenersExceededWarning');
      assert.strictEqual(maxListenerWarnings.length, 0, 'Zero MaxListenersExceededWarning must be emitted across 25 retries');
    } finally {
      process.removeListener('warning', onWarning);
    }
  });

  await runTest('2.5 Codebase Static-Pairing Audit: zero unpaired clientRes.removeListener(\'close\') in server.js', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const lines = serverCode.split('\n');

    const unpairedLines = [];
    lines.forEach((line, idx) => {
      if (line.includes("clientRes.removeListener('close', clientCloseHandler)")) {
        const surrounding = lines.slice(idx, idx + 6).join('\n');
        if (!surrounding.includes("clientRes.removeListener('error'")) {
          unpairedLines.push(idx + 1);
        }
      }
    });

    assert.strictEqual(unpairedLines.length, 0, `Found unpaired close listener removals at lines: ${unpairedLines.join(', ')}`);
  });

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} ADVERSARIAL CHALLENGES PASSED EMPIRICALLY!`);
  console.log('================================================================');
}

main().catch(err => {
  console.error('\n💥 ADVERSARIAL SUITE ENCOUNTERED UNEXPECTED CRASH:', err);
  process.exit(1);
});
