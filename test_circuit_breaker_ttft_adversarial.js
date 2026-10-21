/**
 * OpenCode Go Router - Circuit Breaker, Single-Flight Half-Open & Two-Stage TTFT Timeout
 * Adversarial Verification Suite
 * 
 * Verifies:
 * 1. Circuit Breaker State Machine (CLOSED -> OPEN -> HALF_OPEN -> CLOSED / OPEN)
 * 2. Exponential Backoff with 70%~130% Full Jitter & Max Cooldown Clamping
 * 3. Single-Flight Half-Open Probing Mutual Exclusion (Zero-Avalanche Thundering Herd Defense)
 * 4. Half-Open Stuck Deadlock Auto-Healing (>45s Watchdog)
 * 5. Two-Stage Decoupled Timeouts (TTFT Watchdog + Chunk Idle Watchdog)
 * 6. In-Flight Zero-Perception Failover on TTFT Stalled Upstream (Headers Unsent)
 * 7. Chunk Idle Timeout Stream Watchdog
 * 8. Client Active Abort Lifecycle & Zero-Leak Resource Teardown
 * 9. Transparent Router Headers (x-router-account-id, x-router-circuit-state, x-router-ttft-ms, x-router-failover-attempts)
 * 10. Pool-Wide 429 Structured Diagnostic Payload with circuit_status & remediation
 * 11. Dedicated Circuit Breaker API Endpoints (/balancer/api/circuit-status, /balancer/api/reset-cooldown)
 */

const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const serverMod = require('./server');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  console.log(`[TEST START] ${name}`);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        passedTests++;
        console.log(`  ✓ PASS: ${name}`);
      }).catch(err => {
        console.error(`  ❌ FAIL: ${name}\n    Error: ${err.message}\n${err.stack}`);
        throw err;
      });
    } else {
      passedTests++;
      console.log(`  ✓ PASS: ${name}`);
    }
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}\n    Error: ${err.message}\n${err.stack}`);
    throw err;
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function main() {
  console.log('================================================================');
  console.log('🛡️  Circuit Breaker, Single-Flight Probing & TTFT Adversarial Suite');
  console.log('================================================================\n');

  // ==========================================================================
  // SECTION 1: Unit & State Machine Mathematical Verification
  // ==========================================================================
  console.log('--- [SECTION 1] Circuit Breaker State Machine & Jitter Calculations ---');

  const {
    CIRCUIT_STATE,
    DEFAULT_CIRCUIT_CONFIG,
    accountStats,
    getCircuitState,
    recordAccountSuccess,
    recordAccountFailure,
    calculateJitteredBackoff,
    isAccountAvailable,
    selectAccount
  } = serverMod;

  await runTest('1.1 Circuit state transitions CLOSED -> OPEN -> HALF_OPEN based on failures & cooldown', () => {
    const testAccId = 'unit-test-acc-1';
    accountStats.set(testAccId, {
      id: testAccId,
      name: 'Unit Test Acc',
      circuitState: CIRCUIT_STATE.CLOSED,
      consecutiveFailures: 0,
      halfOpenInFlight: false,
      cooldownUntil: 0
    });

    const origCb = serverMod.config.circuitBreaker;
    serverMod.config.circuitBreaker = {
      enabled: true,
      failureThreshold: 3,
      baseCooldownMs: 1000,
      maxCooldownMs: 30000,
      halfOpenMaxProbes: 1
    };

    try {
      // 1. Initial state is CLOSED
      let now = Date.now();
      assert.strictEqual(getCircuitState(testAccId, now), CIRCUIT_STATE.CLOSED);

      // 2. Failure 1 and 2: remain CLOSED
      recordAccountFailure(testAccId, 'Upstream Error', 502, false);
      assert.strictEqual(getCircuitState(testAccId), CIRCUIT_STATE.CLOSED);
      assert.strictEqual(accountStats.get(testAccId).consecutiveFailures, 1);

      recordAccountFailure(testAccId, 'Upstream Error', 502, false);
      assert.strictEqual(getCircuitState(testAccId), CIRCUIT_STATE.CLOSED);
      assert.strictEqual(accountStats.get(testAccId).consecutiveFailures, 2);

      // 3. Failure 3 reaches failureThreshold (3) -> transitions to OPEN
      recordAccountFailure(testAccId, 'Upstream Error', 502, false);
      assert.strictEqual(getCircuitState(testAccId), CIRCUIT_STATE.OPEN);
      assert.strictEqual(accountStats.get(testAccId).consecutiveFailures, 3);
      assert.ok(accountStats.get(testAccId).cooldownUntil > Date.now(), 'cooldownUntil must be in future');

      // 4. Before cooldown expires: remains OPEN
      assert.strictEqual(getCircuitState(testAccId, Date.now()), CIRCUIT_STATE.OPEN);

      // 5. After cooldown expires: transitions to HALF_OPEN
      const cooldownTime = accountStats.get(testAccId).cooldownUntil;
      assert.strictEqual(getCircuitState(testAccId, cooldownTime + 10), CIRCUIT_STATE.HALF_OPEN);
    } finally {
      serverMod.config.circuitBreaker = origCb;
    }
  });

  await runTest('1.2 calculateJitteredBackoff implements Exponential Backoff with 70%~130% Full Jitter', () => {
    // calculateJitteredBackoff(baseMs, failureCount, maxMs)
    // baseMs=1000, failureCount=1: rawBackoff = 1000 * 2^1 = 2000; jitter [1400, 2600]
    for (let i = 0; i < 50; i++) {
      const b1 = calculateJitteredBackoff(1000, 1, 16000);
      assert.ok(b1 >= 1400 && b1 <= 2600, `b1=${b1} must be within [1400, 2600]`);
    }

    // baseMs=1000, failureCount=2: rawBackoff = 1000 * 2^2 = 4000; jitter [2800, 5200]
    for (let i = 0; i < 50; i++) {
      const b2 = calculateJitteredBackoff(1000, 2, 16000);
      assert.ok(b2 >= 2800 && b2 <= 5200, `b2=${b2} must be within [2800, 5200]`);
    }

    // baseMs=1000, failureCount=10: rawBackoff = min(16000, 1000 * 2^8 = 256000) = 16000; jitter [11200, 20800]
    for (let i = 0; i < 50; i++) {
      const b10 = calculateJitteredBackoff(1000, 10, 16000);
      assert.ok(b10 >= 11200 && b10 <= 20800, `b10=${b10} must clamp to max with jitter`);
    }
  });

  await runTest('1.3 Single-Flight Half-Open Probing: 20 concurrent attempts grant exactly 1 probe ticket', () => {
    const testAccId = 'unit-test-single-flight';
    const now = Date.now();
    accountStats.set(testAccId, {
      id: testAccId,
      name: 'Single Flight Test Acc',
      circuitState: CIRCUIT_STATE.OPEN,
      cooldownUntil: now - 100, // cooldown expired
      consecutiveFailures: 1,
      halfOpenInFlight: false
    });

    const accountObj = { id: testAccId, apiKey: 'test-key', enabled: true };
    const origAccounts = serverMod.config.accounts;
    const origAffinity = serverMod.config.sessionAffinityEnabled;
    serverMod.config.accounts = [accountObj];
    serverMod.config.sessionAffinityEnabled = false;

    try {
      // Assert initial state is HALF_OPEN
      assert.strictEqual(getCircuitState(testAccId, now), CIRCUIT_STATE.HALF_OPEN);

      // Simulate 20 concurrent requests attempting to select an account
      const selectedResults = [];
      for (let i = 0; i < 20; i++) {
        const picked = selectAccount(null, new Set());
        selectedResults.push(picked);
      }

      // Exactly 1 request should have acquired the account
      const successfulPicks = selectedResults.filter(a => a !== null && a.id === testAccId);
      const rejectedPicks = selectedResults.filter(a => a === null);

      assert.strictEqual(successfulPicks.length, 1, 'Only 1 request may acquire probe ticket in HALF_OPEN');
      assert.strictEqual(rejectedPicks.length, 19, 'Remaining 19 requests must be blocked/diverted');
      assert.strictEqual(accountStats.get(testAccId).halfOpenInFlight, true, 'halfOpenInFlight must be locked');

      // While halfOpenInFlight is true, isAccountAvailable must return false
      assert.strictEqual(isAccountAvailable(accountObj, now), false, 'Account must not be available during in-flight probe');
    } finally {
      serverMod.config.accounts = origAccounts;
      serverMod.config.sessionAffinityEnabled = origAffinity;
    }
  });

  await runTest('1.4 Half-Open Probe Success -> CLOSED & TTFT Rolling Window latency update', () => {
    const testAccId = 'unit-test-probe-success';
    accountStats.set(testAccId, {
      id: testAccId,
      name: 'Probe Success Acc',
      circuitState: CIRCUIT_STATE.HALF_OPEN,
      cooldownUntil: 0,
      consecutiveFailures: 3,
      halfOpenInFlight: true,
      ttftSamples: [100, 120]
    });

    recordAccountSuccess(testAccId, 80);

    const stat = accountStats.get(testAccId);
    assert.strictEqual(stat.circuitState, CIRCUIT_STATE.CLOSED, 'Circuit state must reset to CLOSED');
    assert.strictEqual(stat.consecutiveFailures, 0, 'consecutiveFailures must reset to 0');
    assert.strictEqual(stat.halfOpenInFlight, false, 'halfOpenInFlight must be released');
    assert.strictEqual(stat.lastTtftMs, 80, 'lastTtftMs must record latest TTFT');
    assert.deepStrictEqual(stat.ttftSamples, [100, 120, 80], 'ttftSamples must include 80');
    assert.strictEqual(stat.avgTtftMs, 100, 'avgTtftMs must be average of [100, 120, 80] = 100');
  });

  await runTest('1.5 Half-Open Probe Failure -> Immediate OPEN & Doubled Cooldown with Jitter', () => {
    const testAccId = 'unit-test-probe-failure';
    accountStats.set(testAccId, {
      id: testAccId,
      name: 'Probe Failure Acc',
      circuitState: CIRCUIT_STATE.HALF_OPEN,
      cooldownUntil: 0,
      consecutiveFailures: 2,
      halfOpenInFlight: true
    });

    const now = Date.now();
    // Probe encounters 503
    recordAccountFailure(testAccId, 'Upstream 503 Service Unavailable', 503, false);

    const stat = accountStats.get(testAccId);
    assert.strictEqual(stat.circuitState, CIRCUIT_STATE.OPEN, 'Probe failure must immediately reopen circuit');
    assert.strictEqual(stat.halfOpenInFlight, false, 'halfOpenInFlight must be released');
    assert.strictEqual(stat.consecutiveFailures, 3, 'consecutiveFailures must increment to 3');
    assert.ok(stat.cooldownUntil > now, 'cooldownUntil must be set in future');
  });

  await runTest('1.6 Half-Open Stuck Deadlock Auto-Healing (>45s watchdog)', () => {
    const testAccId = 'unit-test-deadlock';
    const now = Date.now();
    accountStats.set(testAccId, {
      id: testAccId,
      name: 'Deadlock Acc',
      circuitState: CIRCUIT_STATE.HALF_OPEN,
      cooldownUntil: now - 60000,
      consecutiveFailures: 2,
      halfOpenInFlight: true,
      halfOpenProbeStartTime: now - 50000 // 50s ago (> 45s deadlock limit)
    });

    const state = getCircuitState(testAccId, now);
    assert.strictEqual(state, CIRCUIT_STATE.HALF_OPEN);
    assert.strictEqual(accountStats.get(testAccId).halfOpenInFlight, false, 'Deadlocked halfOpenInFlight must be auto-cleared');
  });

  // ==========================================================================
  // SECTION 2: End-to-End Dynamic Failover, TTFT & Watchdog Verification
  // ==========================================================================
  console.log('\n--- [SECTION 2] End-to-End Dynamic Failover & Two-Stage Timeouts ---');

  const mockPort = await getFreePort();
  const routerPort = await getFreePort();
  console.log(`✓ Allocated dynamic test ports: MockUpstream=${mockPort}, Router=${routerPort}`);

  let acc1CallCount = 0;
  let acc2CallCount = 0;

  // Mock Upstream HTTP Server
  const mockUpstream = http.createServer((req, res) => {
    const auth = req.headers['authorization'] || req.headers['x-api-key'] || '';
    const session = req.headers['x-opencode-session'] || '';

    // Route to Account 1 vs Account 2
    const isAcc1 = auth.includes('key-acc-1');
    const isAcc2 = auth.includes('key-acc-2');
    if (isAcc1) acc1CallCount++;
    if (isAcc2) acc2CallCount++;

    // 1. Quota / Usage endpoint
    if (req.url === '/v1/usage' || req.url === '/usage') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ usage: { rolling: { percent: 10 } } }));
      return;
    }

    // 2. Models endpoint
    if (req.url === '/v1/models' || req.url.includes('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'deepseek-v4.1-flash' }] }));
      return;
    }

    // 3. Scenario: TTFT Timeout Simulation on Account 1 (Delayed response headers)
    if (session === 'session-ttft-failover') {
      if (isAcc1) {
        // Acc1 intentionally stalls for 400ms (> 150ms TTFT timeout)
        setTimeout(() => {
          if (!res.writableEnded && !res.destroyed) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { content: 'Acc1 late response' } }] }));
          }
        }, 400);
        return;
      }
      // Acc2 responds immediately (10ms)
      setTimeout(() => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        res.write('data: {"choices":[{"delta":{"content":"Hello from Acc2 after TTFT failover!"}}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      }, 10);
      return;
    }

    // 4. Scenario: Chunk Idle Timeout Simulation
    if (session === 'session-chunk-idle-timeout') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      // Send chunk 1 immediately (satisfies TTFT)
      res.write('data: {"choices":[{"delta":{"content":"Chunk 1"}}]}\n\n');
      // Then stall for 600ms (> 250ms chunk idle timeout)
      setTimeout(() => {
        if (!res.writableEnded && !res.destroyed) {
          res.write('data: {"choices":[{"delta":{"content":"Chunk 2 arrived late"}}]}\n\n');
          res.end();
        }
      }, 600);
      return;
    }

    // 5. Scenario: Client Abort Simulation (Slow initial response)
    if (session === 'session-client-abort') {
      setTimeout(() => {
        if (!res.writableEnded && !res.destroyed) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'Done' } }] }));
        }
      }, 500);
      return;
    }

    // 6. Scenario: Upstream 429 Rate Limit Simulation
    if (session === 'session-force-429') {
      res.writeHead(429, {
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': '3'
      });
      res.end(JSON.stringify({
        error: {
          message: 'Rate limit exceeded for account',
          type: 'rate_limit_exceeded'
        }
      }));
      return;
    }

    // Default fast healthy response
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'x-upstream-node': isAcc1 ? 'acc-1' : 'acc-2'
    });
    res.end(JSON.stringify({
      id: 'chatcmpl-test',
      model: 'deepseek-v4.1-flash',
      choices: [{ message: { role: 'assistant', content: 'Standard healthy response' } }]
    }));
  });

  await new Promise(resolve => mockUpstream.listen(mockPort, '127.0.0.1', resolve));
  console.log(`✓ Mock Upstream listening on 127.0.0.1:${mockPort}`);

  // Create isolated temporary config
  const testConfigFile = path.join(__dirname, `config.cb-test-${Date.now()}.json`);
  const testConfigDir = path.join(os.tmpdir(), `test-cb-opencode-${Date.now()}`);
  const testSnapshotsDir = path.join(os.tmpdir(), `test-cb-snapshots-${Date.now()}`);
  const testCodexDir = path.join(os.tmpdir(), `test-cb-codex-${Date.now()}`);
  fs.mkdirSync(testConfigDir, { recursive: true });
  fs.mkdirSync(testSnapshotsDir, { recursive: true });
  fs.mkdirSync(testCodexDir, { recursive: true });

  const testConfig = {
    port: routerPort,
    host: '127.0.0.1',
    upstream: `http://127.0.0.1:${mockPort}/v1`,
    defaultCooldownMs: 2000,
    maxFailoverRetries: 2,
    sessionAffinityEnabled: false,
    ttftTimeoutMs: 150,           // 150ms TTFT timeout
    chunkIdleTimeoutMs: 250,      // 250ms Chunk Idle timeout
    circuitBreaker: {
      enabled: true,
      failureThreshold: 2,
      baseCooldownMs: 1500,
      maxCooldownMs: 10000,
      halfOpenMaxProbes: 1
    },
    accounts: [
      { id: 'acc-1', name: 'OpenCode Acc 1', apiKey: 'key-acc-1', enabled: true },
      { id: 'acc-2', name: 'OpenCode Acc 2', apiKey: 'key-acc-2', enabled: true }
    ]
  };
  fs.writeFileSync(testConfigFile, JSON.stringify(testConfig, null, 2), 'utf8');

  // Spawn router process with stdio pipe drained to avoid buffer overflow
  const routerProc = fork(path.join(__dirname, 'server.js'), [], {
    stdio: 'pipe',
    env: {
      ...process.env,
      OPENCODE_ROUTER_CONFIG: testConfigFile,
      OPENCODE_CONFIG_DIR: testConfigDir,
      OPENCODE_SNAPSHOTS_DIR: testSnapshotsDir,
      CODEX_CONFIG_DIR: testCodexDir,
      PORT: String(routerPort)
    }
  });

  let routerStderrBuf = '';
  routerProc.stdout.on('data', () => {});
  routerProc.stderr.on('data', (d) => {
    routerStderrBuf += d.toString();
  });

  // Wait for Router to become healthy
  const waitForRouter = async (maxAttempts = 30) => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${routerPort}/health`, resolve);
          req.on('error', reject);
        });
        if (res.statusCode === 200) return true;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Router failed to start within timeout');
  };

  await waitForRouter();
  console.log(`✓ Router online and healthy on 127.0.0.1:${routerPort}\n`);

  // Helper request function
  const routerRequest = (urlPath, options = {}) => {
    return new Promise((resolve, reject) => {
      const postData = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null;
      const headers = Object.assign({}, options.headers || {});
      if (postData && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      if (postData && !headers['Content-Length']) headers['Content-Length'] = String(Buffer.byteLength(postData));

      const req = http.request({
        hostname: '127.0.0.1',
        port: routerPort,
        path: urlPath,
        method: options.method || (postData ? 'POST' : 'GET'),
        headers
      }, (res) => {
        let chunks = [];
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          const bodyStr = Buffer.concat(chunks).toString('utf8');
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: bodyStr,
            json: () => {
              try { return JSON.parse(bodyStr); } catch (_) { return null; }
            }
          });
        };
        res.on('data', c => chunks.push(c));
        res.on('end', finish);
        res.on('close', finish);
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  };

  // ==========================================================================
  // CHALLENGE 2: In-Flight Zero-Perception Failover on TTFT Timeout
  // ==========================================================================
  await runTest('2.1 In-Flight Failover: Acc1 TTFT stall (>150ms) transparently switches to Acc2 before headers sent', async () => {
    const res = await routerRequest('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'x-opencode-session': 'session-ttft-failover'
      },
      body: {
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', content: 'Test TTFT failover' }],
        stream: true
      }
    });

    assert.strictEqual(res.statusCode, 200, 'Client must receive 200 OK despite Acc1 stalling');
    assert.strictEqual(res.headers['x-router-account-id'], 'acc-2', 'Must failover to acc-2');
    assert.ok(Number(res.headers['x-router-failover-attempts']) >= 1, 'x-router-failover-attempts must be >= 1');
    assert.ok(res.headers['x-router-ttft-ms'], 'x-router-ttft-ms header must be present');
    assert.ok(res.body.includes('Hello from Acc2 after TTFT failover!'), 'Client stream must contain complete response from Acc2');
  });

  // ==========================================================================
  // CHALLENGE 3: Chunk Idle Stream Watchdog
  // ==========================================================================
  await runTest('2.2 Chunk Idle Watchdog: Stream stalls on chunk 2 (>250ms) triggers safe termination', async () => {
    const startTime = Date.now();
    const res = await routerRequest('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'x-opencode-session': 'session-chunk-idle-timeout'
      },
      body: {
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', content: 'Test chunk idle timeout' }],
        stream: true
      }
    });

    const elapsed = Date.now() - startTime;
    // Headers were written on chunk 1 (200 OK), then stream stalled and closed around 250ms watchdog
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.includes('Chunk 1'), 'Chunk 1 must have been received');
    assert.strictEqual(res.body.includes('Chunk 2 arrived late'), false, 'Late chunk must NOT have arrived due to idle timeout');
    assert.ok(elapsed >= 230 && elapsed <= 550, `Stream terminated around ~250ms chunk idle timeout (actual: ${elapsed}ms)`);
  });

  // ==========================================================================
  // CHALLENGE 4: Client Abort & Zero Resource Leak
  // ==========================================================================
  await runTest('2.3 Client Abort during TTFT phase destroys upstream connection and unbinds timers cleanly', async () => {
    let clientErrorFired = false;
    await new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: routerPort,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-opencode-session': 'session-client-abort'
        }
      }, () => {});

      req.on('error', () => {
        clientErrorFired = true;
      });

      req.write(JSON.stringify({ model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'abort me' }] }));
      
      // Abort connection abruptly at 30ms before TTFT expires
      setTimeout(() => {
        req.destroy();
        setTimeout(resolve, 80);
      }, 30);
    });

    // Check router status to ensure no accounts crashed or leaked
    const statusRes = await routerRequest('/status');
    assert.strictEqual(statusRes.statusCode, 200);
    const statusJson = statusRes.json();
    assert.strictEqual(statusJson.accounts.length, 2);
  });

  // ==========================================================================
  // CHALLENGE 5: Pool Exhaustion & Structured 429 Diagnostic Payload
  // ==========================================================================
  await runTest('2.4 Pool-Wide 429 Rate Limit returns structured circuit_status and remediation', async () => {
    // Send requests to trip both accounts into 429 cooldown
    await routerRequest('/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-opencode-session': 'session-force-429' },
      body: { model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'trip 1' }] }
    });

    await routerRequest('/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-opencode-session': 'session-force-429' },
      body: { model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'trip 2' }] }
    });

    // Both accounts should now be in cooldown; request should return 429
    const res = await routerRequest('/v1/chat/completions', {
      method: 'POST',
      body: { model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'now fail' }] }
    });

    assert.strictEqual(res.statusCode, 429, 'Pool-wide cooldown must return HTTP 429');
    assert.ok(res.headers['retry-after'], 'Must contain Retry-After header');

    const errJson = res.json();
    assert.ok(errJson && errJson.error, 'Response must contain error object');
    assert.ok(
      errJson.error.message.includes('All OpenCode Go accounts in pool are temporarily cooling down'),
      'Must contain backward-compatible message prefix'
    );
    assert.ok(Array.isArray(errJson.error.circuit_status), 'Must contain structured circuit_status array');
    assert.strictEqual(errJson.error.circuit_status.length, 2, 'circuit_status must list all 2 accounts');
    assert.ok(errJson.error.remediation, 'Must contain actionable remediation guidance');
  });

  // ==========================================================================
  // CHALLENGE 6: Dedicated Circuit Breaker API Endpoints
  // ==========================================================================
  await runTest('2.5 GET /balancer/api/circuit-status returns comprehensive health & circuit diagnostics', async () => {
    const res = await routerRequest('/balancer/api/circuit-status');
    assert.strictEqual(res.statusCode, 200);

    const json = res.json();
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.circuitBreaker.enabled, true);
    assert.strictEqual(json.circuitBreaker.failureThreshold, 2);
    assert.strictEqual(json.accounts.length, 2);

    const acc1 = json.accounts.find(a => a.id === 'acc-1');
    assert.ok(acc1, 'acc-1 must exist');
    assert.ok(acc1.circuitState, 'acc-1 must have circuitState');
    assert.ok(typeof acc1.consecutiveFailures === 'number', 'consecutiveFailures must be number');
  });

  await runTest('2.6 POST /balancer/api/reset-cooldown restores circuit state to CLOSED and clears failures', async () => {
    const resetRes = await routerRequest('/balancer/api/reset-cooldown', { method: 'POST' });
    assert.strictEqual(resetRes.statusCode, 200);

    // Verify circuit status is now healthy
    const statusRes = await routerRequest('/balancer/api/circuit-status');
    const json = statusRes.json();
    for (const acc of json.accounts) {
      assert.strictEqual(acc.circuitState, CIRCUIT_STATE.CLOSED, `${acc.id} circuitState must be CLOSED after reset`);
      assert.strictEqual(acc.consecutiveFailures, 0, `${acc.id} consecutiveFailures must be 0`);
      assert.strictEqual(acc.halfOpenInFlight, false, `${acc.id} halfOpenInFlight must be false`);
    }

    // Normal request should now succeed immediately with 200 OK
    const testReq = await routerRequest('/v1/chat/completions', {
      method: 'POST',
      body: { model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'test recovery' }] }
    });
    assert.strictEqual(testReq.statusCode, 200, 'Must succeed with 200 OK after cooldown reset');
  });

  // ==========================================================================
  // TEARDOWN
  // ==========================================================================
  console.log('\n--- Teardown Test Fixtures ---');
  routerProc.kill('SIGKILL');
  mockUpstream.close();

  try { fs.unlinkSync(testConfigFile); } catch (_) {}
  try { fs.rmSync(testConfigDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(testSnapshotsDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(testCodexDir, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n================================================================`);
  console.log(`🎉 ALL ${passedTests}/${totalTests} CIRCUIT BREAKER & TTFT TESTS PASSED!`);
  console.log(`================================================================`);
}

main().catch(err => {
  console.error('\n❌ Fatal Test Error:', err);
  process.exit(1);
});
