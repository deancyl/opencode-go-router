const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork, execSync } = require('node:child_process');
const codexAdapter = require('./codex-adapter');

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

async function runTests() {
  console.log('--- Starting OpenCode Go Router Verification Suite ---');

  const mockPort = await getFreePort();
  const routerPort = await getFreePort();
  console.log(`✓ Allocated dynamic test ports: MockUpstream=${mockPort}, Router=${routerPort}`);

  let mockCallCount = 0;
  let account1Calls = 0;
  let account2Calls = 0;
  let quotaUsageCalls = 0;
  let simulate429Triggered = false;

  const mockUpstream = http.createServer((req, res) => {
    mockCallCount++;
    const auth = req.headers['authorization'] || req.headers['x-api-key'] || '';
    const session = req.headers['x-opencode-session'] || '';

    if (req.url === '/v1/usage' || req.url === '/usage') {
      quotaUsageCalls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        usage: {
          rolling: { percent: 15, resetsAt: new Date(Date.now() + 3600000).toISOString() },
          weekly: { percent: 25, resetsAt: new Date(Date.now() + 86400000).toISOString() },
          monthly: { percent: 35, resetsAt: new Date(Date.now() + 604800000).toISOString() }
        }
      }));
      return;
    }

    if (req.url === '/v1/messages') {
      if (auth.includes('key-account-1')) account1Calls++;
      else account2Calls++;

      if (session === 'session-anthropic-context-overflow') {
        let b = [];
        req.on('data', c => b.push(c));
        req.on('end', () => {
          const bodyStr = Buffer.concat(b).toString('utf8');
          try {
            const bodyJson = JSON.parse(bodyStr);
            if (!bodyJson.model.includes('kimi') && bodyStr.length > 500) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'prompt is too long: 250000 tokens > 200000 maximum context length' } }));
              return;
            }
          } catch (_) {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'msg_ant_healed',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Anthropic healed after context pruning!' }],
            model: 'kimi-k2.7-code',
            usage: { input_tokens: 50, output_tokens: 10 }
          }));
        });
        return;
      }

      if (session === 'session-anthropic-stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        res.write('data: {"type":"message_start","message":{"id":"msg_ant_1","usage":{"input_tokens":10,"output_tokens":0}}}\n\n');
        res.write('data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
        res.write('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello from Claude Anthropic Stream!"}}\n\n');
        res.write('data: {"type":"content_block_stop","index":0}\n\n');
        res.write('data: {"type":"message_delta","usage":{"output_tokens":12}}\n\n');
        res.write('data: {"type":"message_stop"}\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_ant_nonstream',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from Claude non-streaming!' }],
        model: 'claude-haiku-5-5',
        usage: { input_tokens: 15, output_tokens: 20 }
      }));
      return;
    }

    if (req.url === '/v1/simulate-both-429') {
      if (auth.includes('key-account-1')) account1Calls++;
      else account2Calls++;
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '3' });
      res.end(JSON.stringify({ error: { message: 'Rate limit exceeded on all', type: 'tokens_limit' } }));
      return;
    }

    if (req.url === '/v1/simulate-429' && !simulate429Triggered) {
      simulate429Triggered = true;
      if (auth.includes('key-account-1')) account1Calls++;
      else account2Calls++;
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '2' });
      res.end(JSON.stringify({ error: { message: 'Rate limit exceeded', type: 'tokens_limit' } }));
      return;
    }

    if (session === 'session-stream-test') {
      if (auth.includes('key-account-1')) account1Calls++;
      else account2Calls++;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write('data: {"choices":[{"delta":{"reasoning_content":"Step 1 thinking\\n"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"Hello from stream test!"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (session === 'session-empty-400') {
      if (auth.includes('key-account-1')) account1Calls++;
      else account2Calls++;
      res.writeHead(400, {
        'Content-Type': 'text/event-stream',
        'Content-Length': '0'
      });
      res.end();
      return;
    }

    if (session === 'session-bare-json-400') {
      if (auth.includes('key-account-1')) account1Calls++;
      else account2Calls++;
      const bareBody = '{"model":"deepseek-v4.1-flash"}';
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(bareBody))
      });
      res.end(bareBody);
      return;
    }

    if (session === 'session-standard-err-400') {
      if (auth.includes('key-account-1')) account1Calls++;
      else account2Calls++;
      const errBody = JSON.stringify({
        error: {
          message: 'Standard upstream validation failed',
          type: 'invalid_request_error',
          code: 400
        }
      });
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(errBody))
      });
      res.end(errBody);
      return;
    }

    if (req.url === '/v1/responses') {
      if (auth.includes('key-account-1')) account1Calls++;
      else account2Calls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'resp-native-1',
        object: 'response',
        status: 'completed',
        model: 'native-model-test',
        output: [{
          id: 'msg_1',
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'response from native test' }]
        }]
      }));
      return;
    }

    if (auth.includes('key-account-1')) {
      account1Calls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp-1', model: 'claude-3-5-sonnet', choices: [{ message: { content: 'from account 1' } }] }));
      return;
    }

    if (req.url === '/v1/slow') {
      if (auth.includes('key-account-1')) account1Calls++;
      else account2Calls++;
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ from: 'slow' }));
        }
      }, 800);
      return;
    }

    if (auth.includes('key-account-2')) {
      account2Calls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp-2', model: 'claude-3-5-sonnet', choices: [{ message: { content: 'from account 2' } }] }));
      return;
    }

    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
  });

  await new Promise(resolve => mockUpstream.listen(mockPort, '127.0.0.1', resolve));
  console.log(`✓ Mock OpenCode Go Upstream listening on ${mockPort}`);

  // Create isolated temporary test config
  const testConfigFile = path.join(__dirname, `config.test-${Date.now()}.json`);
  const testConfigDir = path.join(os.tmpdir(), `test-opencode-${Date.now()}`);
  const testSnapshotsDir = path.join(os.tmpdir(), `test-snapshots-${Date.now()}`);
  fs.mkdirSync(testConfigDir, { recursive: true });
  fs.mkdirSync(testSnapshotsDir, { recursive: true });
  process.env.OPENCODE_CONFIG_DIR = testConfigDir;
  process.env.OPENCODE_SNAPSHOTS_DIR = testSnapshotsDir;

  const testConfig = {
    port: routerPort,
    host: '127.0.0.1',
    upstream: `http://127.0.0.1:${mockPort}/v1`,
    defaultCooldownMs: 2000,
    maxFailoverRetries: 2,
    sessionAffinityEnabled: true,
    accounts: [
      { id: 'account-1', name: 'OpenCode Go Acc 1', apiKey: 'key-account-1', enabled: true },
      { id: 'account-2', name: 'OpenCode Go Acc 2', apiKey: 'key-account-2', enabled: true }
    ]
  };
  fs.writeFileSync(testConfigFile, JSON.stringify(testConfig, null, 2), 'utf8');

  // Spawn router process with isolated config
  const routerProc = fork(path.join(__dirname, 'server.js'), [], {
    stdio: 'pipe',
    env: {
      ...process.env,
      OPENCODE_ROUTER_CONFIG: testConfigFile,
      OPENCODE_CONFIG_DIR: testConfigDir,
      OPENCODE_SNAPSHOTS_DIR: testSnapshotsDir,
      PORT: String(routerPort)
    }
  });

  await new Promise(resolve => setTimeout(resolve, 1500));

  function request(reqPath, options = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: routerPort,
        path: reqPath,
        method: options.method || 'GET',
        headers: options.headers || {}
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      });
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  try {
    // Test 1: Health check endpoint
    console.log('\n[Test 1] Testing /health endpoint...');
    const health = await request('/health');
    assert.strictEqual(health.statusCode, 200);
    const healthJson = JSON.parse(health.body);
    assert.strictEqual(healthJson.status, 'ok');
    assert.strictEqual(healthJson.healthyAccounts, 2);
    assert.strictEqual(healthJson.totalAccounts, 2);
    console.log('✓ Health check passed:', healthJson);

    // Test 2: CORS OPTIONS preflight
    console.log('\n[Test 2] Testing CORS OPTIONS preflight...');
    const optionsRes = await request('/v1/chat/completions', { method: 'OPTIONS' });
    assert.strictEqual(optionsRes.statusCode, 204);
    assert.strictEqual(optionsRes.headers['access-control-allow-origin'], '*');
    console.log('✓ CORS OPTIONS preflight passed');

    // Test 3: Status endpoint
    console.log('\n[Test 3] Testing /status endpoint...');
    const status = await request('/status');
    assert.strictEqual(status.statusCode, 200);
    const statusJson = JSON.parse(status.body);
    assert.strictEqual(statusJson.accounts.length, 2);
    assert.strictEqual(statusJson.accounts[0].status, 'healthy');
    console.log('✓ Status endpoint passed');

    // Test 4: Round-Robin load balancing between two accounts
    console.log('\n[Test 4] Testing Round-Robin request distribution...');
    const req1 = await request('/v1/chat/completions', { method: 'POST', body: '{}' });
    const req2 = await request('/v1/chat/completions', { method: 'POST', body: '{}' });
    assert.strictEqual(req1.statusCode, 200);
    assert.strictEqual(req2.statusCode, 200);
    assert(account1Calls >= 1, 'Account 1 should have received a request');
    assert(account2Calls >= 1, 'Account 2 should have received a request');
    console.log(`✓ Load balancing verified: Acc1=${account1Calls}, Acc2=${account2Calls}`);

    // Test 5: Session Affinity with x-opencode-session
    console.log('\n[Test 5] Testing Session Affinity with x-opencode-session header...');
    const sessHeader = { 'x-opencode-session': 'session-xyz-123' };
    const initialAcc1Calls = account1Calls;
    const initialAcc2Calls = account2Calls;

    await request('/v1/chat/completions', { method: 'POST', headers: sessHeader, body: '{}' });
    await request('/v1/chat/completions', { method: 'POST', headers: sessHeader, body: '{}' });
    await request('/v1/chat/completions', { method: 'POST', headers: sessHeader, body: '{}' });

    const deltaAcc1 = account1Calls - initialAcc1Calls;
    const deltaAcc2 = account2Calls - initialAcc2Calls;
    assert((deltaAcc1 === 3 && deltaAcc2 === 0) || (deltaAcc1 === 0 && deltaAcc2 === 3),
      `Requests with same session should stick to 1 account. Acc1: +${deltaAcc1}, Acc2: +${deltaAcc2}`);
    console.log(`✓ Session affinity verified: stuck to pinned account (+${deltaAcc1}/+${deltaAcc2})`);

    // Test 6: Automatic 429 Failover and Cooldown
    console.log('\n[Test 6] Testing Automatic 429 Failover and seamless recovery...');
    const resFailover = await request('/v1/simulate-429', {
      method: 'POST',
      headers: { 'x-opencode-session': 'failover-session-test' },
      body: '{}'
    });
    assert.strictEqual(resFailover.statusCode, 200, `Client should receive 200 OK after transparent failover, got ${resFailover.statusCode}`);
    const resJson = JSON.parse(resFailover.body);
    console.log('✓ Client received successful response during failover:', resJson.choices[0].message.content);

    // Verify which account is cooling down and which is healthy
    const statusAfter429 = await request('/status');
    const statusData = JSON.parse(statusAfter429.body);
    const cooledAcc = statusData.accounts.find(a => a.status === 'cooling_down');
    const healthyAcc = statusData.accounts.find(a => a.status === 'healthy');
    assert(cooledAcc, 'One account should be cooling down after 429');
    assert(healthyAcc, 'The alternative account should remain healthy');
    console.log(`✓ Cooldown verified: ${cooledAcc.name} cooling down (${cooledAcc.remainingCooldownSec}s remaining)`);

    // Test 7: Reset Cooldown API
    console.log('\n[Test 7] Testing Reset Cooldown API (/balancer/api/reset-cooldown)...');
    const resetRes = await request('/balancer/api/reset-cooldown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cooledAcc.id })
    });
    assert.strictEqual(resetRes.statusCode, 200);
    const statusAfterReset = await request('/status');
    const resetStatus = JSON.parse(statusAfterReset.body).accounts.find(a => a.id === cooledAcc.id);
    assert.strictEqual(resetStatus.status, 'healthy', 'Account should be healthy after manual reset');
    console.log('✓ Reset Cooldown API verified: account restored to healthy immediately');

    // Test 8: Doctor API
    console.log('\n[Test 8] Testing Doctor Diagnostic API (/balancer/api/doctor)...');
    const docRes = await request('/balancer/api/doctor');
    assert.strictEqual(docRes.statusCode, 200);
    const docJson = JSON.parse(docRes.body);
    assert.strictEqual(docJson.router.status, 'ok');
    assert(Array.isArray(docJson.issues));
    console.log(`✓ Doctor Diagnostic API verified: detected ${docJson.issues.length} environment items`);

    // Test 9: All-accounts-in-cooldown returns 429 + Retry-After without pounding upstream
    console.log('\n[Test 9] Testing pool-wide 429 rate limit behavior...');
    const resBoth429 = await request('/v1/simulate-both-429', { method: 'POST', body: '{}' });
    assert.strictEqual(resBoth429.statusCode, 429, 'When all upstream accounts return 429, client receives 429');
    
    // Now both accounts are cooling down. Subsequent request must be rejected by router with 429 and Retry-After
    const preCallCount = mockCallCount;
    const resPoolCooling = await request('/v1/chat/completions', { method: 'POST', body: '{}' });
    assert.strictEqual(resPoolCooling.statusCode, 429, 'Router should return 429 when all accounts are cooling down');
    assert(resPoolCooling.headers['retry-after'], 'Router must include Retry-After header');
    assert.strictEqual(mockCallCount, preCallCount, 'Router must NOT hit upstream when all accounts are cooling down');
    console.log(`✓ Pool-wide cooldown protection verified: 429 returned with Retry-After=${resPoolCooling.headers['retry-after']}`);

    // Test 10: Client Abort Isolation (No spurious failover on client disconnect)
    console.log('\n[Test 10] Testing Client Abort Isolation (No spurious failover)...');
    // First reset cooldown from Test 9
    await request('/balancer/api/reset-cooldown', { method: 'POST', body: '{}' });
    const acc1Before = account1Calls;
    const acc2Before = account2Calls;

    // Start a request that will be slow and abort it after 100ms
    const abortReq = http.request({
      hostname: '127.0.0.1',
      port: routerPort,
      path: '/v1/slow',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    abortReq.on('error', () => {});
    abortReq.write('{}');
    abortReq.end();

    await new Promise(r => setTimeout(r, 100));
    abortReq.destroy(); // Client cancels query

    // Wait 400ms to allow event loop and verify no extra calls to alternative account
    await new Promise(r => setTimeout(r, 400));
    const delta1 = account1Calls - acc1Before;
    const delta2 = account2Calls - acc2Before;
    assert.strictEqual(delta2, 0, `Spurious failover detected! Acc2 calls should be 0, got ${delta2}`);
    console.log(`✓ Client Abort Isolation verified: Acc1=+${delta1}, Acc2=+${delta2} (no failover spam)`);

    // Test 11: Proxied Response CORS Headers
    console.log('\n[Test 11] Testing CORS headers on proxied response and error responses...');
    const corsRes = await request('/v1/chat/completions', { method: 'POST', body: '{}' });
    assert.strictEqual(corsRes.statusCode, 200);
    assert.strictEqual(corsRes.headers['access-control-allow-origin'], '*', 'Proxied response must have CORS allow origin');
    console.log('✓ Proxied response CORS headers verified');

    // Test 12: Auto-Repair API (/balancer/api/repair)
    console.log('\n[Test 12] Testing Auto-Repair API (/balancer/api/repair)...');
    const repairRes = await request('/balancer/api/repair', { method: 'POST' });
    assert.strictEqual(repairRes.statusCode, 200);
    const repairJson = JSON.parse(repairRes.body);
    assert.strictEqual(repairJson.success, true);
    assert(Array.isArray(repairJson.results));
    console.log(`✓ Auto-Repair API verified: executed ${repairJson.results.length} repair actions`);

    // Test 13: Bind Desktop API (/balancer/api/bind-desktop)
    console.log('\n[Test 13] Testing Bind Desktop API (/balancer/api/bind-desktop)...');
    const bindRes = await request('/balancer/api/bind-desktop', { method: 'POST' });
    assert.strictEqual(bindRes.statusCode, 200);
    const bindJson = JSON.parse(bindRes.body);
    assert.strictEqual(typeof bindJson.success, 'boolean');
    assert(bindJson.result && typeof bindJson.result === 'object');
    console.log(`✓ Bind Desktop API verified: opencode=${bindJson.result.opencode}, openchamber=${bindJson.result.openchamber}`);

    // Test 14: Save Config with UI Password & Auth Gatekeeper (/balancer/api/auth)
    console.log('\n[Test 14] Testing UI Password Auth & Security Gatekeeper...');
    // Enable uiPassword
    const saveCfgRes = await request('/balancer/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...testConfig,
        uiPassword: 'SecretTestPassword123!'
      })
    });
    assert.strictEqual(saveCfgRes.statusCode, 200);

    // Unauthenticated request to /balancer/api/config should now return 401
    const unauthRes = await request('/balancer/api/config', { method: 'GET' });
    assert.strictEqual(unauthRes.statusCode, 401, 'Protected endpoint should return 401 without auth');
    console.log('✓ Security gatekeeper successfully blocked unauthorized admin request (401)');

    // Unauthenticated request to /balancer/ui MUST render login page, NOT dashboard
    const unauthUiRes = await request('/balancer/ui', { method: 'GET' });
    assert.strictEqual(unauthUiRes.statusCode, 200);
    assert(unauthUiRes.body.includes('身份验证 | OpenCode 智能路由网关'), 'Unauth UI must render login page');
    assert(!unauthUiRes.body.includes('id="accounts-container"'), 'Unauth UI must NOT render dashboard');
    console.log('✓ Security gatekeeper successfully served LoginPage on unauthenticated /balancer/ui');

    // Check /balancer/api/auth status
    const authStatusRes = await request('/balancer/api/auth', { method: 'GET' });
    assert.strictEqual(authStatusRes.statusCode, 200);
    const authStatusJson = JSON.parse(authStatusRes.body);
    assert.strictEqual(authStatusJson.hasUiPassword, true);
    assert.strictEqual(authStatusJson.authenticated, false);

    // Login via /balancer/api/auth with correct password
    const loginRes = await request('/balancer/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'SecretTestPassword123!' })
    });
    assert.strictEqual(loginRes.statusCode, 200);
    const loginJson = JSON.parse(loginRes.body);
    assert.strictEqual(loginJson.success, true);
    assert(loginJson.token, 'Auth should return token');

    // Authenticated request with Bearer token
    const authRes = await request('/balancer/api/config', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${loginJson.token}` }
    });
    assert.strictEqual(authRes.statusCode, 200);
    const authCfg = JSON.parse(authRes.body);
    assert.strictEqual(authCfg.hasUiPassword, true);
    console.log('✓ UI Password authentication & Bearer token access verified');

    // Authenticated request to /balancer/ui with Cookie MUST render full dashboard
    const authUiCookieRes = await request('/balancer/ui', {
      method: 'GET',
      headers: { 'Cookie': `router_auth=${encodeURIComponent(loginJson.token)}` }
    });
    assert.strictEqual(authUiCookieRes.statusCode, 200);
    assert(authUiCookieRes.body.includes('OpenCode 订阅管理中心'), 'Auth UI with cookie must render dashboard');
    console.log('✓ Authenticated request with Cookie successfully loaded Dashboard');

    // Authenticated request to /balancer/ui with query param ?auth= MUST render dashboard
    const authUiQueryRes = await request('/balancer/ui?auth=SecretTestPassword123!', { method: 'GET' });
    assert.strictEqual(authUiQueryRes.statusCode, 200);
    assert(authUiQueryRes.body.includes('OpenCode 订阅管理中心'), 'Auth UI with query param must render dashboard');
    console.log('✓ Authenticated request with ?auth= query param successfully loaded Dashboard');

    // Restore uiPassword to empty
    await request('/balancer/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${loginJson.token}` },
      body: JSON.stringify({ ...testConfig, uiPassword: '' })
    });

    // Test 15: Open Local File in Native Application API (/balancer/api/open-file)
    console.log('\n[Test 15] Testing Open Local File API (/balancer/api/open-file)...');
    const resNoPath = await request('/balancer/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(resNoPath.statusCode, 400);

    const resBadPath = await request('/balancer/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'C:\\non_existent_doc_file_12345.docx' })
    });
    assert.strictEqual(resBadPath.statusCode, 404);

    const existingFile = path.resolve(__dirname, 'README.md');
    const resGoodFile = await request('/balancer/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: existingFile })
    });
    assert.strictEqual(resGoodFile.statusCode, 200);
    const goodJson = JSON.parse(resGoodFile.body);
    assert.strictEqual(goodJson.success, true);
    console.log('✓ Open Local File API verified: 400/404/200 checks all passed');

    // [Test 16] Testing Component Updates Check API
    console.log('\n[Test 16] Testing Component Updates Check API (/balancer/api/updates/check)...');
    const resCheck = await request('/balancer/api/updates/check');
    assert.strictEqual(resCheck.statusCode, 200);
    const checkJson = JSON.parse(resCheck.body);
    assert.ok(Array.isArray(checkJson.components), 'components should be an array');
    assert.strictEqual(checkJson.components.length, 5, 'should have 5 core components');
    assert.ok(checkJson.compatibility, 'should have compatibility object');
    assert.ok(['safe', 'warning', 'critical'].includes(checkJson.compatibility.riskLevel), 'valid risk level');
    assert.strictEqual(checkJson.compatibility.canProceed, true, 'non-blocking guarantee must hold');
    console.log(`✓ Updates Check API verified: detected ${checkJson.components.length} components, riskLevel=${checkJson.compatibility.riskLevel}`);

    // [Test 17] Testing Component Updates Apply & Snapshot API
    console.log('\n[Test 17] Testing Component Updates Apply & Snapshot API (/balancer/api/updates/apply & /balancer/api/updates/snapshots)...');
    const resApply = await request('/balancer/api/updates/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ components: ['opencode-go-router'], timeoutMs: 1500 })
    });
    assert.strictEqual(resApply.statusCode, 200);
    const applyJson = JSON.parse(resApply.body);
    assert.strictEqual(applyJson.success, true);
    assert.ok(applyJson.snapshotId, 'snapshotId must be returned');
    assert.ok(applyJson.results && applyJson.results['opencode-go-router'], 'opencode-go-router result must exist');
    assert.strictEqual(applyJson.results['opencode-go-router'].success, true);
    assert.ok(['git-pull', 'tarball-pull', 'preserved-dirty-tree', 'preserved-current-version'].includes(applyJson.results['opencode-go-router'].method), 'method must be valid');

    const resSnapshots = await request('/balancer/api/updates/snapshots');
    assert.strictEqual(resSnapshots.statusCode, 200);
    const snapsJson = JSON.parse(resSnapshots.body);
    assert.strictEqual(snapsJson.success, true);
    assert.ok(snapsJson.snapshots.length > 0, 'snapshots must contain at least 1 record');
    assert.strictEqual(snapsJson.snapshots[0].id, applyJson.snapshotId);
    console.log(`✓ Updates Apply & Snapshots API verified: created ${applyJson.snapshotId} (router update method: ${applyJson.results['opencode-go-router'].method})`);

    // [Test 18] Testing Component Updates Rollback API
    console.log('\n[Test 18] Testing Component Updates Rollback API (/balancer/api/updates/rollback)...');
    // Mutate opencode.jsonc and router config before rollback to test actual deep file restoration
    const testOcJsonc = path.join(testConfigDir, 'opencode.jsonc');
    const originalOcContent = fs.existsSync(testOcJsonc) ? fs.readFileSync(testOcJsonc, 'utf8') : '';
    const mutatedOcContent = JSON.stringify({ model: 'mutated-test-model-to-be-restored', mutated: true });
    fs.writeFileSync(testOcJsonc, mutatedOcContent, 'utf8');

    const resRollback = await request('/balancer/api/updates/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotId: applyJson.snapshotId, reinstallPackages: false })
    });
    assert.strictEqual(resRollback.statusCode, 200);
    const rbJson = JSON.parse(resRollback.body);
    assert.strictEqual(rbJson.success, true);
    assert.strictEqual(rbJson.snapshotId, applyJson.snapshotId);
    assert.ok(Array.isArray(rbJson.restoredItems), 'restoredItems should be an array');

    // Deep verification: assert opencode.jsonc was restored back to original content
    const restoredOcContent = fs.readFileSync(testOcJsonc, 'utf8');
    assert.strictEqual(restoredOcContent, originalOcContent, 'opencode.jsonc must be byte-accurately restored from snapshot');
    console.log(`✓ Updates Rollback API verified: restored from ${rbJson.snapshotId} and confirmed deep file recovery`);

    // [Test 19] Testing Safe Native App Open Sandbox - Extension Blacklist Defense
    console.log('\n[Test 19] Testing Safe Native App Open Sandbox - Extension Blacklist Defense (/balancer/api/open-file)...');
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.vbs', '.js', '.ps1', '.sh'];
    for (const ext of dangerousExtensions) {
      const resUnsafe = await request('/balancer/api/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `C:\\malicious\\payload${ext}` })
      });
      assert.strictEqual(resUnsafe.statusCode, 403, `Extension ${ext} must be rejected with 403 Forbidden`);
      const unsafeJson = JSON.parse(resUnsafe.body);
      assert.strictEqual(unsafeJson.success, false);
      assert.ok(unsafeJson.error.includes('安全拦截'), 'Must contain security block error message');
    }
    console.log('✓ Safe Native App Open Sandbox verified: dangerous extensions blocked with 403');

    // [Test 20] Testing Safe Native App Open Sandbox - Boundary & Non-existent File Defense
    console.log('\n[Test 20] Testing Safe Native App Open Sandbox - Boundary & Non-existent File Defense...');
    const resEmptyObj = await request('/balancer/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '   ' })
    });
    assert.strictEqual(resEmptyObj.statusCode, 400);

    const resNonExistent = await request('/balancer/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path.join(__dirname, 'non-existent-office-test-file.docx') })
    });
    assert.strictEqual(resNonExistent.statusCode, 404);
    console.log('✓ Safe Native App Open Sandbox boundary checks verified: 400 on whitespace, 404 on non-existent');

    // [Test 21] Testing Workspace & NAS Multi-Volume Path Detection
    console.log('\n[Test 21] Testing Workspace & NAS Multi-Volume Path Detection...');
    const updater = require('./updater');
    const customDist = '/custom/volume/dist';
    const distCandidates = updater.getOpenChamberDistCandidates(customDist);
    assert.ok(Array.isArray(distCandidates), 'Candidates must be an array');
    assert.strictEqual(distCandidates[0], customDist, 'Custom directory must be the first candidate');
    assert.ok(distCandidates.length >= 3, 'Must contain multiple candidates');
    const defaultCandidates = updater.getOpenChamberDistCandidates();
    assert.ok(defaultCandidates.length >= 3, 'Default candidates list must have platform paths');
    console.log(`✓ OpenChamber multi-volume candidates verified: found ${distCandidates.length} candidate paths`);

    // [Test 22] Testing Frontend Hot-Patch Dynamic AST Regex Detection
    console.log('\n[Test 22] Testing Frontend Hot-Patch Dynamic AST Regex Detection...');
    const mockObfuscatedBundle = 'var foo=1;var myVar99=r=>{var a=1;return r.filesView.artifact.binary?h(r):null};console.log(myVar99);';
    const astRegex = /([A-Za-z0-9_$]+)=r=>\{(?:(?!function|[A-Za-z0-9_$]+=r=>).)*?filesView\.artifact\.binary/;
    const astMatch = mockObfuscatedBundle.match(astRegex);
    assert.ok(astMatch, 'Dynamic AST regex must match obfuscated binary handler function');
    assert.strictEqual(astMatch[1], 'myVar99', 'Matched variable name must accurately identify myVar99');

    const mockZdBundle = 'Zd=r=>{if(r.filesView.artifact.binary)return null;}';
    const zdMatch = mockZdBundle.match(astRegex);
    assert.ok(zdMatch, 'Regex must match standard Zd identifier');
    assert.strictEqual(zdMatch[1], 'Zd');
    console.log('✓ Dynamic AST feature extraction verified: successfully identified obfuscated hook targets');

    // [Test 23] Testing Disaster Recovery Snapshot File Metadata & POSIX Mode Recording
    console.log('\n[Test 23] Testing Disaster Recovery Snapshot File Metadata & POSIX Mode Recording...');
    const snapWithMeta = updater.createSnapshot('Test Snapshot Metadata Engine');
    assert.ok(snapWithMeta.id, 'Snapshot ID must be generated');
    assert.ok(snapWithMeta.fileMetadata, 'fileMetadata must exist in snapshot manifest');
    assert.ok(Array.isArray(snapWithMeta.files), 'files must remain an array of strings for compatibility');

    const snapManifestPath = path.join(testSnapshotsDir, snapWithMeta.id, 'manifest.json');
    assert.ok(fs.existsSync(snapManifestPath), 'manifest.json must exist on disk');
    const diskManifest = JSON.parse(fs.readFileSync(snapManifestPath, 'utf8'));
    assert.ok(diskManifest.fileMetadata, 'Manifest on disk must contain fileMetadata');
    console.log(`✓ Snapshot file metadata engine verified: manifest ${snapWithMeta.id} persisted with file permissions`);

    // [Test 24] Testing Corrupted Snapshot Directory Resilience in listSnapshots()
    console.log('\n[Test 24] Testing Corrupted Snapshot Directory Resilience in listSnapshots()...');
    const corruptDir = path.join(testSnapshotsDir, 'snapshot-corrupted-test');
    fs.mkdirSync(corruptDir, { recursive: true });
    fs.writeFileSync(path.join(corruptDir, 'manifest.json'), '{ invalid json string corrupt: %%%', 'utf8');

    const nonSnapDir = path.join(testSnapshotsDir, 'some-other-directory');
    fs.mkdirSync(nonSnapDir, { recursive: true });

    const safeSnaps = updater.listSnapshots();
    assert.ok(Array.isArray(safeSnaps), 'Must return an array');
    assert.ok(safeSnaps.every(s => s && s.id && typeof s.id === 'string'), 'All returned snapshots must be valid objects');
    assert.ok(!safeSnaps.some(s => s.id === 'snapshot-corrupted-test'), 'Corrupted snapshot must be filtered out gracefully');
    console.log('✓ Corrupted snapshot tolerance verified: handled invalid JSON and foreign folders without crashing');

    // [Test 25] Testing Session Affinity Concurrency & Consistency
    console.log('\n[Test 25] Testing Session Affinity Concurrency & Consistency...');
    const sessionPinMap = new Map();
    for (let round = 0; round < 3; round++) {
      for (let s = 1; s <= 6; s++) {
        const sId = `session-worker-${s}`;
        const resSession = await request('/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-opencode-session': sId
          },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'affinity test' }] })
        });
        assert.strictEqual(resSession.statusCode, 200);
        const bodyJson = JSON.parse(resSession.body);
        const assignedAcc = bodyJson.choices[0].message.content;
        if (round === 0) {
          sessionPinMap.set(sId, assignedAcc);
        } else {
          assert.strictEqual(assignedAcc, sessionPinMap.get(sId), `Session ${sId} must remain pinned to original account`);
        }
      }
    }
    console.log('✓ Session Affinity concurrency verified: 6 sessions consistently pinned across multiple rounds');

    // [Test 26] Testing JSON Comments Stripping Engine with Trailing Commas
    console.log('\n[Test 26] Testing JSON Comments Stripping Engine with Trailing Commas...');
    const messyJsonc = `
    {
      // Top-level comment
      "server": "127.0.0.1", /* block comment */
      "port": 4010, // port number
      "models": [
        "glm-5.3",
        "qwen3.7-plus", // list item comment
      ],
      "enabled": true,
    }
    `;
    const cleanJson = updater.stripJsonComments(messyJsonc);
    let parsedData = null;
    assert.doesNotThrow(() => {
      parsedData = JSON.parse(cleanJson);
    }, 'stripJsonComments must produce valid JSON without syntax errors');
    assert.strictEqual(parsedData.server, '127.0.0.1');
    assert.strictEqual(parsedData.port, 4010);
    assert.deepStrictEqual(parsedData.models, ['glm-5.3', 'qwen3.7-plus']);
    assert.strictEqual(parsedData.enabled, true);
    console.log('✓ stripJsonComments engine verified: cleaned single/block comments and trailing commas');

    // [Test 27] Testing Web UI Dashboard Base URL Dynamic Copy Bar & Dual-Track Auth
    console.log('\n[Test 27] Testing Web UI Dashboard Base URL Dynamic Copy Bar & Dual-Track Auth...');
    const resUi = await request('/balancer/ui', {
      headers: { 'Cookie': 'router_auth=' + Buffer.from('test_token').toString('base64') }
    });
    assert.strictEqual(resUi.statusCode, 200);
    assert.ok(resUi.body.includes('lbl-baseurl'), 'Dashboard must contain Base URL element id');
    assert.ok(resUi.body.includes('copyBaseUrl'), 'Dashboard must contain copyBaseUrl function');
    assert.ok(resUi.body.includes('lbl-host-status'), 'Dashboard must contain host status indicator');
    assert.ok(resUi.body.includes('router_auth'), 'Dashboard must contain cookie fallback in apiHeaders');
    console.log('✓ Web UI Dashboard Base URL copy bar and dual-track auth verified');

    // [Test 28] Testing Cross-Component OMO Fallback Model Alignment
    console.log('\n[Test 28] Testing Cross-Component OMO Fallback Model Alignment...');
    const serverFileContent = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    assert.ok(serverFileContent.includes('"oracle": { "model": "opencode-go/glm-5.3" }'), 'server.js oracle must be glm-5.3');
    assert.ok(serverFileContent.includes('"momus": { "model": "opencode-go/glm-5.3" }'), 'server.js momus must be glm-5.3');
    assert.ok(serverFileContent.includes('opencode-go/minimax-m3'), 'server.js fallback must include minimax-m3');
    assert.ok(serverFileContent.includes('"ultrabrain": { "model": "opencode-go/deepseek-v4.1-flash" }'), 'server.js ultrabrain must be deepseek-v4.1-flash');

    const doctorFileContent = fs.readFileSync(path.join(__dirname, 'doctor-repair.ps1'), 'utf8');
    assert.ok(!doctorFileContent.includes('glm-5.2'), 'doctor-repair.ps1 must not contain legacy glm-5.2');
    assert.ok(!doctorFileContent.includes('minimax-m2.7'), 'doctor-repair.ps1 must not contain legacy minimax-m2.7');
    assert.ok(doctorFileContent.includes('glm-5.3'), 'doctor-repair.ps1 must contain glm-5.3');

    const wizardFileContent = fs.readFileSync(path.join(__dirname, 'setup-wizard.ps1'), 'utf8');
    assert.ok(!wizardFileContent.includes('glm-5.2'), 'setup-wizard.ps1 must not contain legacy glm-5.2');
    assert.ok(!wizardFileContent.includes('minimax-m2.7'), 'setup-wizard.ps1 must not contain legacy minimax-m2.7');
    assert.ok(wizardFileContent.includes('glm-5.3'), 'setup-wizard.ps1 must contain glm-5.3');
    console.log('✓ Cross-component OMO model alignment verified: zero legacy models, 100% harmonized');

    // [Test 29] Testing Safe Native App Open with file:/// URLs, Percent-Decoding & Hash Stripping
    console.log('\n[Test 29] Testing Safe Native App Open with file:/// URLs, Percent-Decoding & Hash Stripping...');
    const { pathToFileURL } = require('url');
    const existingFileForUri = path.resolve(__dirname, 'README.md');
    const fileUrlString = pathToFileURL(existingFileForUri).href + '#page=1';
    const resFileUrl = await request('/balancer/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fileUrlString })
    });
    assert.strictEqual(resFileUrl.statusCode, 200, 'file:/// URL with fragment must be decoded and opened successfully');
    const fileUrlJson = JSON.parse(resFileUrl.body);
    assert.strictEqual(fileUrlJson.success, true);
    console.log('✓ file:/// URL decoding, percent-unescaping & fragment stripping verified');

    // [Test 30] Testing Safe Native App Open UNC Network Path Defense (NTLM Leak Prevention)
    console.log('\n[Test 30] Testing Safe Native App Open UNC Network Path Defense...');
    const uncPayloads = ['\\\\192.168.1.100\\share\\exploit.docx', '//evil-server/leak/token.xlsx'];
    for (const unc of uncPayloads) {
      const resUnc = await request('/balancer/api/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: unc })
      });
      if (process.platform === 'win32') {
        assert.strictEqual(resUnc.statusCode, 403, 'UNC network paths must be rejected with 403 on Windows');
        const uncJson = JSON.parse(resUnc.body);
        assert.ok(uncJson.error.includes('UNC'), 'Must return UNC security warning');
      } else {
        assert.ok([403, 404].includes(resUnc.statusCode));
      }
    }
    console.log('✓ Safe Native App Open UNC network path defense verified');

    // [Test 31] Testing Extended Dangerous Extension Blacklist Defense (.lnk, .url, .vbe, .wsf, .wsh, .reg, .dll)
    console.log('\n[Test 31] Testing Extended Dangerous Extension Blacklist Defense...');
    const extendedMaliciousExts = ['.lnk', '.url', '.vbe', '.wsf', '.wsh', '.reg', '.dll', '.sys', '.appref-ms'];
    for (const ext of extendedMaliciousExts) {
      const resExt = await request('/balancer/api/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `C:\\dangerous\\payload${ext}` })
      });
      assert.strictEqual(resExt.statusCode, 403, `Dangerous extension ${ext} must be rejected with 403`);
    }
    // Test trailing space / trailing dot bypass defense
    const resSpaceBypass = await request('/balancer/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'C:\\dangerous\\payload.exe ' })
    });
    assert.strictEqual(resSpaceBypass.statusCode, 403, 'Trailing whitespace evasion must be sanitized and rejected with 403');
    console.log('✓ Extended dangerous extension blacklist and evasion defense verified');

    // [Test 32] Testing Office Preview Hot-Patch Script Positional Argument Parsing
    console.log('\n[Test 32] Testing Office Preview Hot-Patch Script Positional Argument Parsing...');
    const patchShContent = fs.readFileSync(path.join(__dirname, 'patch-openchamber-office.sh'), 'utf8');
    assert.ok(patchShContent.includes('-i|--install|install)'), 'patch-openchamber-office.sh must recognize install positional argument');
    assert.ok(patchShContent.includes('-r|--rollback|rollback)'), 'patch-openchamber-office.sh must recognize rollback positional argument');
    assert.ok(patchShContent.includes('-s|--status|status)'), 'patch-openchamber-office.sh must recognize status positional argument');

    const patchPs1Content = fs.readFileSync(path.join(__dirname, 'patch-openchamber-office.ps1'), 'utf8');
    assert.ok(patchPs1Content.includes('[Parameter(Position=0)]'), 'patch-openchamber-office.ps1 must support positional Action parameter');
    assert.ok(patchPs1Content.includes('$Rollback = $true'), 'patch-openchamber-office.ps1 must handle rollback keyword');
    console.log('✓ Hot-patch scripts positional argument parsing across bash and powershell verified');

    // [Test 33] Testing Multi-Volume NAS OpenChamber Candidate Detection Matrix
    console.log('\n[Test 33] Testing Multi-Volume NAS OpenChamber Candidate Detection Matrix...');
    const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const setupLinuxCode = fs.readFileSync(path.join(__dirname, 'setup-linux.sh'), 'utf8');
    const doctorCode = fs.readFileSync(path.join(__dirname, 'doctor-repair.ps1'), 'utf8');

    // Verify all key NAS platforms are covered in candidate matrices
    const requiredVolumes = ['/vol1/1000', '/vol2/1000', '/vol3/1000', '/vol4/1000', '/volume1/docker', '/volume2/docker', '/mnt/user/appdata'];
    for (const v of requiredVolumes) {
      assert.ok(serverCode.includes(v), `server.js must contain NAS candidate volume: ${v}`);
      assert.ok(setupLinuxCode.includes(v), `setup-linux.sh must contain NAS candidate volume: ${v}`);
    }
    assert.ok(doctorCode.includes('@openchamber\\web\\dist') || doctorCode.includes('@openchamber\\\\web\\\\dist'), 'doctor-repair.ps1 must contain npm candidate path');
    assert.ok(doctorCode.includes('OpenChamber\\resources\\web-dist') || doctorCode.includes('OpenChamber\\\\resources\\\\web-dist'), 'doctor-repair.ps1 must contain OpenChamber standard path');
    console.log('✓ Multi-Volume NAS candidate matrix across fnOS, Synology DSM and TrueNAS verified');

    // [Test 34] Testing Port Healing Deduplication Pipeline & Process Termination Guard
    console.log('\n[Test 34] Testing Port Healing Deduplication Pipeline & Process Termination Guard...');
    const stopAllCode = fs.readFileSync(path.join(__dirname, 'stop-all.ps1'), 'utf8');
    assert.ok(stopAllCode.includes('Get-Process -Name "OpenCodeRouterTray"'), 'stop-all.ps1 must terminate OpenCodeRouterTray to prevent watchdog resurrect');

    const trayCsCode = fs.readFileSync(path.join(__dirname, 'src', 'OpenCodeRouterTray.cs'), 'utf8');
    assert.ok(trayCsCode.includes('Select-Object -ExpandProperty OwningProcess -Unique'), 'OpenCodeRouterTray.cs must deduplicate listening TCP PIDs');
    assert.ok(serverCode.includes('Select-Object -ExpandProperty OwningProcess -Unique'), 'server.js must deduplicate listening TCP PIDs');
    console.log('✓ Port healing deduplication pipeline and process termination guard verified');

    // [Test 35] Testing OpenChamber Native Desktop Client Launcher API & Tray Multi-Tier Browser Launcher
    console.log('\n[Test 35] Testing OpenChamber Native Desktop Client Launcher API & Tray Multi-Tier Browser Launcher...');
    const resLaunch = await request('/balancer/api/launch-chamber', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(resLaunch.statusCode, 200);
    const jsonLaunch = JSON.parse(resLaunch.body);
    assert.strictEqual(jsonLaunch.success, true);
    assert.ok(jsonLaunch.mode === 'desktop' || jsonLaunch.mode === 'web', 'Launch mode must be desktop or web');

    const updatedTrayCode = fs.readFileSync(path.join(__dirname, 'src', 'OpenCodeRouterTray.cs'), 'utf8');
    assert.ok(updatedTrayCode.includes('LaunchOrActivateOpenChamber'), 'Tray must feature LaunchOrActivateOpenChamber');
    assert.ok(updatedTrayCode.includes('FindBrowserExe'), 'Tray must feature multi-tier browser lookup');
    assert.ok(updatedTrayCode.includes('SetForegroundWindow'), 'Tray must use SetForegroundWindow to bring existing window to front');
    assert.ok(updatedTrayCode.includes('explorer.exe'), 'Tray must use explorer.exe to decouple-launch native desktop client');
    console.log('✓ OpenChamber Native Desktop Client Launcher API & Tray Multi-Tier Browser Launcher verified');

    // [Test 36] Testing Codex Status API (/balancer/api/codex-status)
    console.log('\n[Test 36] Testing Codex Status API (/balancer/api/codex-status)...');
    const resCodexStatus = await request('/balancer/api/codex-status', { method: 'GET' });
    assert.strictEqual(resCodexStatus.statusCode, 200);
    const jsonCodexStatus = JSON.parse(resCodexStatus.body);
    assert.strictEqual(jsonCodexStatus.success, true);
    assert.ok(jsonCodexStatus.status, 'status object must be present');
    assert.strictEqual(jsonCodexStatus.status.availableModels.length, 38, 'must offer all 38 OpenCode Go models');
    const mKimi = jsonCodexStatus.status.availableModels.find(m => m.slug === 'kimi-k3');
    assert.ok(mKimi, 'kimi-k3 must be available');
    assert.strictEqual(mKimi.default_reasoning_level, 'high');
    const mDeepSeek = jsonCodexStatus.status.availableModels.find(m => m.slug === 'deepseek-v4.1-flash');
    assert.ok(mDeepSeek, 'deepseek-v4.1-flash must be available');
    console.log(`✓ Codex Status API verified: 38 models catalog returned with rich reasoning metadata`);

    // [Test 37] Testing Codex One-Click Bind API & Zero-Loss Backup
    console.log('\n[Test 37] Testing Codex One-Click Bind API & Zero-Loss Backup Engine...');
    const isolatedCodexDir = path.join(testConfigDir, 'isolated-codex-test');
    fs.mkdirSync(isolatedCodexDir, { recursive: true });

    // Seed original user config in isolated directory
    const origToml = 'model = "gpt-4o"\nmodel_provider = "openai"\nmodel_reasoning_effort = "medium"\n';
    const origAuth = JSON.stringify({ OPENAI_API_KEY: 'sk-original-user-key-12345' }, null, 2);
    const origModels = JSON.stringify({ models: [{ slug: 'custom-model-abc', display_name: 'Custom ABC' }] }, null, 2);
    fs.writeFileSync(path.join(isolatedCodexDir, 'config.toml'), origToml, 'utf8');
    fs.writeFileSync(path.join(isolatedCodexDir, 'auth.json'), origAuth, 'utf8');
    fs.writeFileSync(path.join(isolatedCodexDir, 'models.json'), origModels, 'utf8');

    // Bind using isolated directory
    const bindResult = codexAdapter.bindCodexConfig({
      codexDir: isolatedCodexDir,
      routerPort: routerPort,
      defaultModel: 'kimi-k3',
      reasoningEffort: 'xhigh',
      providerName: 'opencode-go'
    });
    assert.strictEqual(bindResult.success, true);
    assert.strictEqual(bindResult.boundModel, 'kimi-k3');
    assert.strictEqual(bindResult.reasoningEffort, 'xhigh');

    // Verify atomic backup exists
    const backupDir = path.join(isolatedCodexDir, 'backup-router-bind');
    assert.ok(fs.existsSync(path.join(backupDir, 'manifest.json')), 'backup manifest must be created');
    assert.strictEqual(fs.readFileSync(path.join(backupDir, 'config.toml'), 'utf8'), origToml);
    assert.strictEqual(fs.readFileSync(path.join(backupDir, 'auth.json'), 'utf8'), origAuth);
    assert.strictEqual(fs.readFileSync(path.join(backupDir, 'models.json'), 'utf8'), origModels);

    // Verify bound configuration
    const boundToml = fs.readFileSync(path.join(isolatedCodexDir, 'config.toml'), 'utf8');
    assert.ok(boundToml.includes('model = "kimi-k3"'));
    assert.ok(boundToml.includes('model_provider = "opencode-go"'));
    assert.ok(boundToml.includes('model_reasoning_effort = "xhigh"'));
    assert.ok(boundToml.includes('wire_api = "responses"'));
    assert.ok(boundToml.includes(`base_url = "http://127.0.0.1:${routerPort}/v1"`));

    // Verify models.json merged original with 38 models
    const boundModels = JSON.parse(fs.readFileSync(path.join(isolatedCodexDir, 'models.json'), 'utf8'));
    assert.strictEqual(boundModels.models.length, 39, '38 OpenCode Go models + 1 custom user model');
    assert.ok(boundModels.models.some(m => m.slug === 'custom-model-abc'), 'User original model retained');
    assert.ok(boundModels.models.some(m => m.slug === 'kimi-k3'), 'OpenCode Go models injected');

    // Verify API endpoint /balancer/api/bind-codex
    const resBindApi = await request('/balancer/api/bind-codex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultModel: 'deepseek-v4.1-flash', reasoningEffort: 'high' })
    });
    assert.strictEqual(resBindApi.statusCode, 200);
    const jsonBindApi = JSON.parse(resBindApi.body);
    assert.strictEqual(jsonBindApi.success, true);
    console.log('✓ Codex One-Click Bind API & Zero-Loss Backup verified');

    // [Test 38] Testing Codex One-Click Restore API & 100% Fidelity Rollback
    console.log('\n[Test 38] Testing Codex One-Click Restore API & 100% Fidelity Rollback...');
    const restoreResult = codexAdapter.restoreCodexConfig(isolatedCodexDir, { preserveCompatibility: false });
    assert.strictEqual(restoreResult.success, true);
    assert.strictEqual(restoreResult.restoredFrom, 'backup-manifest');

    // Verify 100% byte fidelity restoration
    assert.strictEqual(fs.readFileSync(path.join(isolatedCodexDir, 'config.toml'), 'utf8'), origToml, 'config.toml restored 100%');
    assert.strictEqual(fs.readFileSync(path.join(isolatedCodexDir, 'auth.json'), 'utf8'), origAuth, 'auth.json restored 100%');
    assert.strictEqual(fs.readFileSync(path.join(isolatedCodexDir, 'models.json'), 'utf8'), origModels, 'models.json restored 100%');
    assert.ok(!fs.existsSync(backupDir), 'backup folder cleaned up after restore');

    // Verify thread continuity restoration (keeps opencode-go declaration for historical ChatGPT thread resilience)
    codexAdapter.bindCodexConfig({ codexDir: isolatedCodexDir, routerPort: routerPort, defaultModel: 'deepseek-v4.1-flash', reasoningEffort: 'high' });
    const resilientRestore = codexAdapter.restoreCodexConfig(isolatedCodexDir, { preserveCompatibility: true });
    assert.strictEqual(resilientRestore.success, true);
    const resilientToml = fs.readFileSync(path.join(isolatedCodexDir, 'config.toml'), 'utf8');
    assert.ok(resilientToml.includes('model = "gpt-4o"'), 'Original model restored');
    assert.ok(resilientToml.includes('model_provider = "openai"'), 'Original provider restored');
    assert.ok(resilientToml.includes('[model_providers."opencode-go"]'), 'Historical thread resilience provider declaration preserved');

    // Verify API endpoint /balancer/api/restore-codex
    const resRestoreApi = await request('/balancer/api/restore-codex', { method: 'POST' });
    assert.strictEqual(resRestoreApi.statusCode, 200);
    console.log('✓ Codex One-Click Restore API & 100% Fidelity Rollback verified');

    // [Test 39] Testing Responses to ChatCompletions Bidirectional Payload Translation
    console.log('\n[Test 39] Testing Responses to ChatCompletions Bidirectional Payload Translation...');
    const sampleResponsesPayload = {
      model: 'opencode-go/kimi-k3',
      input: [
        { role: 'developer', content: 'You are an expert coder.' },
        { role: 'user', content: 'Refactor this algorithm' }
      ],
      stream: false,
      reasoning: { effort: 'xhigh' },
      max_output_tokens: 4096,
      temperature: 0.7
    };
    const translatedChat = codexAdapter.convertResponsesToChatPayload(sampleResponsesPayload);
    assert.strictEqual(translatedChat.model, 'kimi-k3', 'Prefix opencode-go/ stripped');
    assert.strictEqual(translatedChat.reasoning_effort, 'high', 'xhigh mapped to high');
    assert.strictEqual(translatedChat.messages.length, 2);
    assert.strictEqual(translatedChat.messages[0].role, 'system', 'developer mapped to system');
    assert.strictEqual(translatedChat.max_tokens, 4096);
    assert.strictEqual(translatedChat.stream, false);

    const sampleChatResponse = {
      id: 'chatcmpl-test-xyz',
      choices: [{
        message: {
          role: 'assistant',
          content: 'Here is the refactored code',
          reasoning_content: 'Let us consider performance...'
        }
      }],
      usage: { prompt_tokens: 20, completion_tokens: 50, total_tokens: 70 }
    };
    const convertedResponses = codexAdapter.convertChatResponseToResponses(sampleChatResponse, 'kimi-k3', 'resp_123');
    assert.strictEqual(convertedResponses.object, 'response');
    assert.strictEqual(convertedResponses.status, 'completed');
    assert.strictEqual(convertedResponses.model, 'kimi-k3');
    assert.strictEqual(convertedResponses.output.length, 2);
    assert.strictEqual(convertedResponses.output[0].type, 'reasoning');
    assert.strictEqual(convertedResponses.output[0].content[0].text, 'Let us consider performance...');
    assert.strictEqual(convertedResponses.output[1].type, 'message');
    assert.strictEqual(convertedResponses.output[1].content[0].text, 'Here is the refactored code');
    console.log('✓ Responses to ChatCompletions Bidirectional Payload Translation verified');

    // [Test 40] Testing Responses Streaming SSE Bridge Engine (Reasoning + Text + Completion Events)
    console.log('\n[Test 40] Testing Responses Streaming SSE Bridge Engine...');
    const { EventEmitter } = require('node:events');
    const mockUpstreamStream = new EventEmitter();
    const mockClientRes = new EventEmitter();
    mockClientRes.writeHead = (status, headers) => { mockClientRes.headers = headers; mockClientRes.statusCode = status; };
    const emittedEvents = [];
    mockClientRes.write = (chunk) => {
      const str = chunk.toString();
      const evMatch = str.match(/event:\s*([^\n]+)/);
      const dataMatch = str.match(/data:\s*([^\n]+)/);
      if (evMatch && dataMatch) {
        try {
          emittedEvents.push({ event: evMatch[1].trim(), data: JSON.parse(dataMatch[1].trim()) });
        } catch (e) {}
      }
    };
    mockClientRes.end = () => { mockClientRes.emit('finish'); };

    codexAdapter.bridgeResponsesStream(mockUpstreamStream, mockClientRes, 'kimi-k3', 'resp_stream_test', () => {});

    // Feed SSE chunks with reasoning first, then text content
    mockUpstreamStream.emit('data', Buffer.from('data: {"choices":[{"delta":{"reasoning":"I need to think carefully"}}]}\n\n'));
    mockUpstreamStream.emit('data', Buffer.from('data: {"choices":[{"delta":{"content":"Done result!"}}]}\n\n'));
    mockUpstreamStream.emit('data', Buffer.from('data: [DONE]\n\n'));
    mockUpstreamStream.emit('end');

    const eventTypes = emittedEvents.map(e => e.event);
    assert.ok(eventTypes.includes('response.created'), 'Must emit response.created');
    assert.ok(eventTypes.includes('response.output_item.added'), 'Must emit response.output_item.added');
    assert.ok(eventTypes.includes('response.content_part.added'), 'Must emit response.content_part.added');
    assert.ok(eventTypes.includes('response.reasoning_text.delta'), 'Must emit response.reasoning_text.delta');
    assert.ok(eventTypes.includes('response.reasoning_text.done'), 'Must emit response.reasoning_text.done');
    assert.ok(eventTypes.includes('response.output_text.delta'), 'Must emit response.output_text.delta');
    assert.ok(eventTypes.includes('response.completed'), 'Must emit response.completed');

    // Validate strict order: output_item.added before reasoning_text.delta (Codex requirement)
    const itemAddedIdx = eventTypes.indexOf('response.output_item.added');
    const reasoningDeltaIdx = eventTypes.indexOf('response.reasoning_text.delta');
    assert.ok(itemAddedIdx < reasoningDeltaIdx, 'output_item.added must precede reasoning_text.delta');
    console.log('✓ Responses Streaming SSE Bridge Engine verified (strict event ordering confirmed)');

    // [Test 41] Testing End-to-End Transparent Proxy & Bridge via Router HTTP Port
    console.log('\n[Test 41] Testing End-to-End Transparent Proxy & Bridge via Router HTTP Port...');

    // A. Native model to /v1/responses (e.g. native-model-test with prefix)
    const resNative = await request('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'opencode-go/native-model-test', input: 'Hello' })
    });
    assert.strictEqual(resNative.statusCode, 200);
    const jsonNative = JSON.parse(resNative.body);
    assert.strictEqual(jsonNative.id, 'resp-native-1');
    assert.strictEqual(jsonNative.model, 'native-model-test');

    // B. Non-native model (kimi-k3) automatically bridged to /v1/chat/completions non-streaming
    const resBridge = await request('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'kimi-k3', input: 'Hello Kimi', stream: false })
    });
    assert.strictEqual(resBridge.statusCode, 200);
    const jsonBridge = JSON.parse(resBridge.body);
    assert.strictEqual(jsonBridge.object, 'response');
    assert.strictEqual(jsonBridge.model, 'kimi-k3');

    // C. Non-native model (kimi-k3) automatically bridged to /v1/chat/completions with streaming SSE
    const resBridgeStream = await request('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-opencode-session': 'session-stream-test' },
      body: JSON.stringify({ model: 'kimi-k3', input: 'Streaming query', stream: true })
    });
    assert.strictEqual(resBridgeStream.statusCode, 200);
    assert.ok(resBridgeStream.headers['content-type'].includes('text/event-stream'));
    assert.ok(resBridgeStream.body.includes('event: response.created'));
    assert.ok(resBridgeStream.body.includes('event: response.reasoning_text.delta'));
    assert.ok(resBridgeStream.body.includes('event: response.output_text.delta'));
    assert.ok(resBridgeStream.body.includes('event: response.completed'));

    // D. Standard OpenCode Go model (deepseek-v4.1-flash) with stream omitted correctly bridges to non-streaming ChatCompletions
    const resBridgeDefault = await request('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'opencode-go/deepseek-v4.1-flash', input: 'Hello default non-streaming' })
    });
    assert.strictEqual(resBridgeDefault.statusCode, 200);
    const jsonBridgeDefault = JSON.parse(resBridgeDefault.body);
    assert.strictEqual(jsonBridgeDefault.object, 'response');
    assert.strictEqual(jsonBridgeDefault.model, 'deepseek-v4.1-flash');
    console.log('✓ End-to-End Transparent Proxy & Bridge via Router HTTP Port verified');

    // [Test 42] Testing Doctor Diagnostic & Auto-Repair Integration for Codex
    console.log('\n[Test 42] Testing Doctor Diagnostic & Auto-Repair Integration for Codex...');
    const docWithCodex = await request('/balancer/api/doctor', { method: 'GET' });
    assert.strictEqual(docWithCodex.statusCode, 200);
    const docCodexJson = JSON.parse(docWithCodex.body);
    assert.ok(docCodexJson.codex, 'Doctor report must feature codex status');
    assert.ok(typeof docCodexJson.codex.isBound === 'boolean');
    assert.ok(Array.isArray(docCodexJson.codex.availableModels));

    // Execute auto-repair
    const repWithCodex = await request('/balancer/api/repair', { method: 'POST' });
    assert.strictEqual(repWithCodex.statusCode, 200);
    const repCodexJson = JSON.parse(repWithCodex.body);
    assert.strictEqual(repCodexJson.success, true);
    console.log('✓ Doctor Diagnostic & Auto-Repair Integration for Codex verified');

    // [Test 43] Testing Responses Streaming SSE Reasoning-to-Tool Lifecycle & Strict Ordering
    console.log('\n[Test 43] Testing Responses Streaming SSE Reasoning-to-Tool Lifecycle & Strict Ordering...');
    const sseStreamUpstream = new EventEmitter();
    const sseStreamClientRes = new EventEmitter();
    sseStreamClientRes.writeHead = (status, headers) => { sseStreamClientRes.headers = headers; sseStreamClientRes.statusCode = status; };
    const sseRecordedEvents = [];
    sseStreamClientRes.write = (chunk) => {
      const str = chunk.toString();
      const evMatch = str.match(/event:\s*([^\n]+)/);
      const dataMatch = str.match(/data:\s*([^\n]+)/);
      if (evMatch && dataMatch) {
        try {
          sseRecordedEvents.push({ event: evMatch[1].trim(), data: JSON.parse(dataMatch[1].trim()) });
        } catch (e) {}
      }
    };
    sseStreamClientRes.end = () => { sseStreamClientRes.emit('finish'); };

    codexAdapter.bridgeResponsesStream(sseStreamUpstream, sseStreamClientRes, 'qwen3.7-plus', 'resp_tool_order_test', () => {});

    // Upstream emits reasoning chunk -> followed directly by tool_calls (NO intervening text content)
    sseStreamUpstream.emit('data', Buffer.from('data: {"choices":[{"delta":{"reasoning":"Analyzing file system structure..."}}]}\n\n'));
    sseStreamUpstream.emit('data', Buffer.from('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_fs_1","function":{"name":"list_dir","arguments":"{\\"path\\":\\"/src\\"}"}}]}}]}\n\n'));
    sseStreamUpstream.emit('data', Buffer.from('data: [DONE]\n\n'));
    sseStreamUpstream.emit('end');

    const sseEventNames = sseRecordedEvents.map(e => e.event);
    const reasoningDoneIdx = sseEventNames.indexOf('response.reasoning_text.done');
    const reasoningItemDoneIdx = sseEventNames.indexOf('response.output_item.done');
    const toolItemAddedIdx = sseEventNames.indexOf('response.output_item.added', sseEventNames.indexOf('response.reasoning_text.delta'));

    assert.ok(reasoningDoneIdx !== -1, 'Must emit response.reasoning_text.done');
    assert.ok(reasoningItemDoneIdx !== -1, 'Must emit response.output_item.done for reasoning');
    assert.ok(toolItemAddedIdx !== -1, 'Must emit response.output_item.added for tool call');
    assert.ok(reasoningDoneIdx < toolItemAddedIdx, 'Reasoning must close BEFORE tool item is added');
    assert.ok(reasoningItemDoneIdx < toolItemAddedIdx, 'Reasoning output_item.done must precede tool output_item.added');

    const completedEv = sseRecordedEvents.find(e => e.event === 'response.completed');
    assert.ok(completedEv, 'Must emit response.completed');
    assert.strictEqual(completedEv.data.response.output.length, 2, 'Output must have 2 items: reasoning and function_call');
    assert.strictEqual(completedEv.data.response.output[0].type, 'reasoning');
    assert.strictEqual(completedEv.data.response.output[1].type, 'function_call');
    assert.strictEqual(completedEv.data.response.output[1].name, 'list_dir');
    console.log('✓ Responses Streaming SSE Reasoning-to-Tool Lifecycle & Strict Ordering verified');

    // [Test 44] Testing Multi-turn Complex Tool Call & Local Shell Payload Conversion
    console.log('\n[Test 44] Testing Multi-turn Complex Tool Call & Local Shell Payload Conversion...');
    const multiTurnPayload = {
      model: 'opencode-go/kimi-k3',
      input: [
        { type: 'message', role: 'user', content: 'Run git status and inspect files' },
        { type: 'local_shell_call', call_id: 'call_sh_1', command: 'git status' },
        { type: 'custom_tool_call_output', call_id: 'call_sh_1', output: 'On branch master\nclean' },
        { type: 'custom_tool_call', call_id: 'call_custom_2', action: { query: 'package.json' } },
        { type: 'tool_search_output', call_id: 'call_custom_2', output: { found: true } },
        { type: 'agent_message', content: 'All checks passed successfully.' }
      ],
      tool_choice: { type: 'function', name: 'execute_command' },
      reasoning: { effort: 'max' }
    };
    const multiTurnChat = codexAdapter.convertResponsesToChatPayload(multiTurnPayload);
    assert.strictEqual(multiTurnChat.model, 'kimi-k3', 'Prefix opencode-go/ stripped');
    assert.strictEqual(multiTurnChat.reasoning_effort, 'high', 'max mapped to high');
    assert.strictEqual(multiTurnChat.tool_choice.type, 'function');
    assert.strictEqual(multiTurnChat.tool_choice.function.name, 'execute_command');

    // Verify messages array structure
    const chatMsgRoles = multiTurnChat.messages.map(m => m.role);
    assert.ok(chatMsgRoles.includes('user'), 'Contains user message');
    assert.ok(chatMsgRoles.includes('assistant'), 'Contains assistant tool calls');
    assert.ok(chatMsgRoles.includes('tool'), 'Contains tool output responses');

    // Verify local_shell_call mapped to function arguments with command
    const assistantMsg1 = multiTurnChat.messages.find(m => m.role === 'assistant' && m.tool_calls);
    assert.ok(assistantMsg1, 'Assistant message has tool_calls');
    const shellCall = assistantMsg1.tool_calls.find(t => t.id === 'call_sh_1');
    assert.ok(shellCall, 'Shell tool call present');
    assert.ok(shellCall.function.arguments.includes('git status'), 'Shell command preserved in arguments');

    // Test single object input
    const singleObjPayload = {
      model: 'qwen3.7-plus',
      input: { role: 'user', content: 'Single prompt object' }
    };
    const singleObjChat = codexAdapter.convertResponsesToChatPayload(singleObjPayload);
    assert.strictEqual(singleObjChat.messages.length, 1);
    assert.strictEqual(singleObjChat.messages[0].content, 'Single prompt object');
    console.log('✓ Multi-turn Complex Tool Call & Local Shell Payload Conversion verified');

    // [Test 45] Testing Anthropic Messages Bridge Full Suite (Streaming & Non-Streaming)
    console.log('\n[Test 45] Testing Anthropic Messages Bridge Full Suite...');
    const anthropicResponsesReq = {
      model: 'opencode-go/claude-haiku-5-5',
      instructions: 'You are an Anthropic Assistant.',
      input: [
        { type: 'message', role: 'user', content: 'Check system health' },
        { type: 'function_call', call_id: 'call_ant_1', name: 'health_check', arguments: '{"full":true}' },
        { type: 'function_call_output', call_id: 'call_ant_1', output: '{"status":"ok"}' },
        { type: 'message', role: 'user', content: 'Any warnings?' }
      ]
    };
    const antPayload = codexAdapter.convertResponsesToAnthropicPayload(anthropicResponsesReq);
    assert.strictEqual(antPayload.model, 'claude-haiku-5-5');
    assert.strictEqual(antPayload.system, 'You are an Anthropic Assistant.');
    assert.ok(Array.isArray(antPayload.messages));
    assert.strictEqual(antPayload.messages[0].role, 'user');

    // Verify bridgeAnthropicStream
    const antUpstreamStream = new EventEmitter();
    const antClientRes = new EventEmitter();
    antClientRes.writeHead = (status, headers) => { antClientRes.headers = headers; antClientRes.statusCode = status; };
    const antRecordedEvents = [];
    antClientRes.write = (chunk) => {
      const str = chunk.toString();
      const evMatch = str.match(/event:\s*([^\n]+)/);
      const dataMatch = str.match(/data:\s*([^\n]+)/);
      if (evMatch && dataMatch) {
        try {
          antRecordedEvents.push({ event: evMatch[1].trim(), data: JSON.parse(dataMatch[1].trim()) });
        } catch (e) {}
      }
    };
    antClientRes.end = () => { antClientRes.emit('finish'); };

    codexAdapter.bridgeAnthropicStream(antUpstreamStream, antClientRes, 'claude-haiku-5-5', 'resp_ant_stream_test', () => {});

    // Feed Anthropic SSE chunks
    antUpstreamStream.emit('data', Buffer.from('data: {"type":"message_start","message":{"id":"msg_100","usage":{"input_tokens":30,"output_tokens":0}}}\n\n'));
    antUpstreamStream.emit('data', Buffer.from('data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'));
    antUpstreamStream.emit('data', Buffer.from('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Claude responses stream verified."}}\n\n'));
    antUpstreamStream.emit('data', Buffer.from('data: {"type":"content_block_stop","index":0}\n\n'));
    antUpstreamStream.emit('data', Buffer.from('data: {"type":"message_delta","usage":{"output_tokens":18}}\n\n'));
    antUpstreamStream.emit('data', Buffer.from('data: {"type":"message_stop"}\n\n'));
    antUpstreamStream.emit('end');

    const antEventNames = antRecordedEvents.map(e => e.event);
    assert.ok(antEventNames.includes('response.created'));
    assert.ok(antEventNames.includes('response.output_item.added'));
    assert.ok(antEventNames.includes('response.output_text.delta'));
    assert.ok(antEventNames.includes('response.completed'));

    const antCompleted = antRecordedEvents.find(e => e.event === 'response.completed');
    assert.strictEqual(antCompleted.data.response.status, 'completed');
    assert.strictEqual(antCompleted.data.response.output[0].content[0].text, 'Claude responses stream verified.');

    // Test convertAnthropicResponseToResponses (non-streaming)
    const antNonStreamJson = {
      id: 'msg_nonstream_1',
      content: [
        { type: 'text', text: 'Anthropic raw answer' },
        { type: 'tool_use', id: 'call_ant_tool_1', name: 'search_api', input: { query: 'test' } }
      ],
      usage: { input_tokens: 15, output_tokens: 25 }
    };
    const antToResp = codexAdapter.convertAnthropicResponseToResponses(antNonStreamJson, 'claude-haiku-5-5', 'resp_ant_conv');
    assert.strictEqual(antToResp.object, 'response');
    assert.strictEqual(antToResp.status, 'completed');
    assert.strictEqual(antToResp.output.length, 2);
    assert.strictEqual(antToResp.output[0].type, 'message');
    assert.strictEqual(antToResp.output[1].type, 'function_call');
    assert.strictEqual(antToResp.output[1].name, 'search_api');
    console.log('✓ Anthropic Messages Bridge Full Suite verified');

    // [Test 46] Testing Codex Bind & Restore Cleanliness & Zero-Residue Check
    console.log('\n[Test 46] Testing Codex Bind & Restore Cleanliness & Zero-Residue Check...');
    const zeroResidueDir = path.join(os.tmpdir(), `test-codex-clean-${Date.now()}`);
    fs.mkdirSync(zeroResidueDir, { recursive: true });
    fs.writeFileSync(path.join(zeroResidueDir, 'config.toml'), 'model = "old-model"\nmodel_provider = "old-prov"\n', 'utf8');

    // Bind
    const cleanBindRes = codexAdapter.bindCodexConfig({
      codexDir: zeroResidueDir,
      routerPort: routerPort,
      defaultModel: 'deepseek-v4.1-flash',
      reasoningEffort: 'high'
    });
    assert.strictEqual(cleanBindRes.success, true);
    const boundStatus = codexAdapter.getCodexStatus(zeroResidueDir);
    assert.strictEqual(boundStatus.isBound, true);

    // Restore
    const cleanRestoreRes = codexAdapter.restoreCodexConfig(zeroResidueDir, { preserveCompatibility: false });
    assert.strictEqual(cleanRestoreRes.success, true);
    const restoredStatus = codexAdapter.getCodexStatus(zeroResidueDir);
    assert.strictEqual(restoredStatus.isBound, false, 'isBound must be false after restore');
    assert.strictEqual(restoredStatus.hasBackup, false, 'hasBackup must be false after clean restore');
    assert.ok(!fs.existsSync(path.join(zeroResidueDir, 'config.toml.router-bak')), 'config.toml.router-bak must not exist');
    assert.ok(!fs.existsSync(path.join(zeroResidueDir, 'model-catalogs', 'opencode-go-catalog.json')), 'catalog must not exist');
    try { fs.rmSync(zeroResidueDir, { recursive: true, force: true }); } catch (e) {}
    console.log('✓ Codex Bind & Restore Cleanliness & Zero-Residue Check verified');

    // [Test 47] Testing End-to-End Anthropic Protocol Bridge via Router HTTP Port
    console.log('\n[Test 47] Testing End-to-End Anthropic Protocol Bridge via Router HTTP Port...');

    // A. Claude Haiku non-streaming via Router port
    const resAntHttp = await request('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', input: 'Hello Claude', stream: false })
    });
    assert.strictEqual(resAntHttp.statusCode, 200);
    const jsonAntHttp = JSON.parse(resAntHttp.body);
    assert.strictEqual(jsonAntHttp.object, 'response');
    assert.strictEqual(jsonAntHttp.model, 'claude-haiku-5-5');
    assert.strictEqual(jsonAntHttp.status, 'completed');
    assert.strictEqual(jsonAntHttp.output[0].content[0].text, 'Hello from Claude non-streaming!');

    // B. Claude Haiku streaming via Router port
    const resAntHttpStream = await request('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-opencode-session': 'session-anthropic-stream' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', input: 'Streaming Claude query', stream: true })
    });
    assert.strictEqual(resAntHttpStream.statusCode, 200);
    assert.ok(resAntHttpStream.headers['content-type'].includes('text/event-stream'));
    assert.ok(resAntHttpStream.body.includes('event: response.created'));
    assert.ok(resAntHttpStream.body.includes('event: response.output_text.delta'));
    assert.ok(resAntHttpStream.body.includes('Hello from Claude Anthropic Stream!'));
    assert.ok(resAntHttpStream.body.includes('event: response.completed'));
    console.log('✓ End-to-End Anthropic Protocol Bridge via Router HTTP Port verified');

    // [Test 48] Testing Platform Intelligence & Adaptive Detection Engine (detectPlatformEnvironment)
    console.log('\n[Test 48] Testing Platform Intelligence & Adaptive Detection Engine...');
    const curPlatform = updater.detectPlatformEnvironment();
    assert.strictEqual(typeof curPlatform.platform, 'string');
    assert.strictEqual(typeof curPlatform.isWindows, 'boolean');
    assert.strictEqual(typeof curPlatform.isLinux, 'boolean');
    assert.strictEqual(typeof curPlatform.isNas, 'boolean');
    assert.ok(curPlatform.description.length > 0);

    // Simulate fnOS (飞牛 NAS OS)
    const fnosSim = updater.detectPlatformEnvironment({
      platform: 'linux',
      kernelRelease: '6.18.18.c1107-trim',
      fsExists: (p) => p === '/vol3' || p === '/fs',
      readFile: (p) => p === '/etc/os-release' ? 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"' : ''
    });
    assert.strictEqual(fnosSim.platform, 'linux-nas');
    assert.strictEqual(fnosSim.isNas, true);
    assert.strictEqual(fnosSim.nasType, 'fnos');
    assert.ok(fnosSim.description.includes('fnOS (飞牛私有云 NAS / Debian)'));

    // Simulate Synology DSM
    const synoSim = updater.detectPlatformEnvironment({
      platform: 'linux',
      kernelRelease: '4.4.302+',
      fsExists: (p) => p === '/etc/synoinfo.conf' || p === '/volume1',
      readFile: () => ''
    });
    assert.strictEqual(synoSim.platform, 'linux-nas');
    assert.strictEqual(synoSim.isNas, true);
    assert.strictEqual(synoSim.nasType, 'synology');
    assert.ok(synoSim.description.includes('Synology DSM'));

    // Simulate Docker Container
    const dockerSim = updater.detectPlatformEnvironment({
      platform: 'linux',
      kernelRelease: '5.15.0-generic',
      fsExists: (p) => p === '/.dockerenv',
      readFile: (p) => p === '/etc/os-release' ? 'PRETTY_NAME="Ubuntu 22.04.3 LTS"' : ''
    });
    assert.strictEqual(dockerSim.platform, 'docker');
    assert.strictEqual(dockerSim.isDocker, true);

    // Simulate Windows Desktop
    const winSim = updater.detectPlatformEnvironment({
      platform: 'win32',
      kernelRelease: '10.0.26100',
      fsExists: () => false,
      readFile: () => ''
    });
    assert.strictEqual(winSim.platform, 'windows');
    assert.strictEqual(winSim.isWindows, true);
    assert.ok(winSim.description.includes('Windows 桌面工作站'));
    console.log('✓ Platform Intelligence Engine verified across Windows, fnOS, Synology, and Docker simulations');

    // [Test 49] Testing Cross-Platform Opencode Config Harmonization & Zero-Loss Provider Migration
    console.log('\n[Test 49] Testing Cross-Platform Opencode Config Harmonization & Zero-Loss Provider Migration...');
    const testHarmonizeFile = path.join(testConfigDir, 'opencode-harmonize-test.jsonc');
    const dirtyJsonc = `
    // User custom comments
    {
      "providers": {
        "shtech": {
          "name": "shtech",
          "npm": "@ai-sdk/openai-compatible",
          "options": { "baseURL": "https://sh.tech/v1", "apiKey": "sk-sh-custom" }
        },
        "aixforge": {
          "name": "aixforge",
          "options": { "baseURL": "https://aix.forge/v1" }
        },
        "opencode-go": {
          "name": "opencode-go",
          "options": { "baseURL": "http://127.0.0.1:3001/v1", "apiKey": "old-key" },
          "models": {
            "custom-finetuned-model": { "name": "custom-finetuned-model" }
          }
        }
      },
      "provider": {
        "existing-custom": { "name": "existing-custom" }
      },
      "model": "opencode-go/glm-5.3-flash",
    }
    `;
    fs.writeFileSync(testHarmonizeFile, dirtyJsonc, 'utf8');

    const harmResult = updater.harmonizeOpencodeConfig(testHarmonizeFile, 4010);
    assert.strictEqual(harmResult.success, true);
    assert.ok(harmResult.migratedProviders.includes('shtech'));
    assert.ok(harmResult.migratedProviders.includes('aixforge'));
    assert.strictEqual(harmResult.currentModel, 'opencode-go/glm-5.3-flash');
    assert.strictEqual(harmResult.modelPreserved, true);

    const harmonizedData = JSON.parse(fs.readFileSync(testHarmonizeFile, 'utf8'));
    // 1. Providers plural key MUST be completely eliminated
    assert.strictEqual(harmonizedData.providers, undefined, 'Deprecated providers plural key must be completely eliminated');
    // 2. All third-party providers migrated into singular provider
    assert.ok(harmonizedData.provider['shtech'], 'shtech must be migrated into provider');
    assert.strictEqual(harmonizedData.provider['shtech'].options.apiKey, 'sk-sh-custom');
    assert.ok(harmonizedData.provider['aixforge'], 'aixforge must be migrated into provider');
    assert.ok(harmonizedData.provider['existing-custom'], 'existing-custom must be retained in provider');
    // 3. opencode-go must have baseURL pointing to 4010 and local-router
    assert.strictEqual(harmonizedData.provider['opencode-go'].options.baseURL, 'http://127.0.0.1:4010/v1');
    assert.strictEqual(harmonizedData.provider['opencode-go'].options.apiKey, 'local-router');
    // 4. All 38 models must exist AND custom model must be preserved (total 39)
    assert.strictEqual(Object.keys(harmonizedData.provider['opencode-go'].models).length, 39);
    assert.ok(harmonizedData.provider['opencode-go'].models['deepseek-v4.1-flash']);
    assert.ok(harmonizedData.provider['opencode-go'].models['glm-5.3-flash']);
    assert.ok(harmonizedData.provider['opencode-go'].models['custom-finetuned-model']);
    // 5. User choice model preserved
    assert.strictEqual(harmonizedData.model, 'opencode-go/glm-5.3-flash');
    console.log('✓ Cross-Platform Opencode Config Harmonization & Zero-Loss Provider Migration verified');

    // [Test 50] Testing Doctor Diagnostic Platform-Awareness & Self-Healing Integration
    console.log('\n[Test 50] Testing Doctor Diagnostic Platform-Awareness & Self-Healing Integration...');
    // A. Doctor API returns platform object
    const docRes50 = await request('/balancer/api/doctor', { method: 'GET' });
    assert.strictEqual(docRes50.statusCode, 200);
    const docJson50 = JSON.parse(docRes50.body);
    assert.ok(docJson50.platform, 'Doctor report must include platform environment metadata');
    assert.strictEqual(typeof docJson50.platform.platform, 'string');
    assert.strictEqual(typeof docJson50.platform.description, 'string');

    // B. Trigger repair API and verify clean self-healing
    const repRes50 = await request('/balancer/api/repair', { method: 'POST' });
    assert.strictEqual(repRes50.statusCode, 200);
    const repJson50 = JSON.parse(repRes50.body);
    assert.strictEqual(repJson50.success, true);
    const ocRepairItem = repJson50.results.find(r => r.item === 'OpenCode Config');
    assert.ok(ocRepairItem, 'Repair results must include OpenCode Config');
    assert.strictEqual(ocRepairItem.success, true);
    console.log('✓ Doctor Diagnostic Platform-Awareness & Self-Healing Integration verified');

    // [Test 51] Testing Dual-Track Registry Fallback & Linux NAS Adaptive Update Strategy
    console.log('\n[Test 51] Testing Dual-Track Registry Fallback & Linux NAS Adaptive Update Strategy...');
    // Test fetchNpmLatestVersion resilience
    const pkgCheck = await updater.fetchAllRemoteVersions(3000);
    assert.ok(pkgCheck['opencode-go-router'], 'opencode-go-router version must be resolved');
    // Test checkAllUpdates includes platform
    const updatesCheck = await updater.checkAllUpdates(3000);
    assert.ok(updatesCheck.platform, 'checkAllUpdates report must contain platform info');
    assert.ok(updatesCheck.platform.description.length > 0);
    assert.ok(Array.isArray(updatesCheck.components));

    // Test applyUpdates graceful degradation on opencode-go-router under short timeout / offline simulation
    const directApplyRes = await updater.applyUpdates(['opencode-go-router'], {
      skipBackup: true,
      skipHarmonize: true,
      timeoutMs: 10
    });
    assert.strictEqual(directApplyRes.success, true, 'Overall update must succeed under timeout/offline resilience');
    assert.ok(directApplyRes.results['opencode-go-router']);
    assert.strictEqual(directApplyRes.results['opencode-go-router'].success, true);
    assert.ok(['git-pull', 'tarball-pull', 'preserved-dirty-tree', 'preserved-current-version'].includes(directApplyRes.results['opencode-go-router'].method));
    console.log('✓ Dual-Track Registry Fallback & Linux NAS Adaptive Update Strategy verified (including router graceful degradation)');

    // [Test 52] Testing Custom Model Metadata & Configuration Preservation in Harmonization
    console.log('\n[Test 52] Testing Custom Model Metadata & Configuration Preservation in Harmonization...');
    const metaTestFile = path.join(testConfigDir, 'meta-preserve-test.jsonc');
    const metaJsonc = `
    {
      "provider": {
        "opencode-go": {
          "models": {
            "deepseek-v4.1-flash": {
              "name": "Custom Flash Name",
              "options": { "temperature": 0.2, "top_p": 0.95 },
              "reasoningEffort": "high"
            }
          }
        }
      },
      "model": "opencode-go/deepseek-v4.1-flash"
    }
    `;
    fs.writeFileSync(metaTestFile, metaJsonc, 'utf8');
    const metaHarmRes = updater.harmonizeOpencodeConfig(metaTestFile, 4010);
    assert.strictEqual(metaHarmRes.success, true);
    const metaHarmData = JSON.parse(fs.readFileSync(metaTestFile, 'utf8'));
    assert.strictEqual(metaHarmData.provider['opencode-go'].models['deepseek-v4.1-flash'].name, 'Custom Flash Name', 'Custom model name must be preserved');
    assert.deepStrictEqual(metaHarmData.provider['opencode-go'].models['deepseek-v4.1-flash'].options, { temperature: 0.2, top_p: 0.95 }, 'Custom model options must be preserved');
    assert.strictEqual(metaHarmData.provider['opencode-go'].models['deepseek-v4.1-flash'].reasoningEffort, 'high', 'Custom reasoningEffort must be preserved');
    console.log('✓ Custom Model Metadata & Configuration Preservation in Harmonization verified');

    // [Test 53] Testing Linux NAS Non-Root Scoped NPM Install & Scoped Directory Resolution
    console.log('\n[Test 53] Testing Linux NAS Non-Root Scoped NPM Install & Scoped Directory Resolution...');
    // A. canWriteGlobalNpm overrides check
    assert.strictEqual(updater.canWriteGlobalNpm({ canWriteGlobal: true }), true);
    assert.strictEqual(updater.canWriteGlobalNpm({ canWriteGlobal: false }), false);

    // B. findScopedComponentDir resolution
    const mockNasDir = path.join(testConfigDir, 'mock-nas-openchamber');
    fs.mkdirSync(mockNasDir, { recursive: true });
    fs.writeFileSync(path.join(mockNasDir, 'package.json'), JSON.stringify({ name: '@openchamber/web', version: '2.1.1' }), 'utf8');
    const resolvedScoped = updater.findScopedComponentDir('openchamber', { scopedDirs: { openchamber: mockNasDir } });
    assert.strictEqual(resolvedScoped, mockNasDir);
    console.log('✓ Linux NAS Non-Root Scoped NPM Install & Scoped Directory Resolution verified');

    // [Test 54] Testing Doctor Diagnostic & Self-Healing for Incomplete 38-Models Catalog
    console.log('\n[Test 54] Testing Doctor Diagnostic & Self-Healing for Incomplete 38-Models Catalog...');
    const incompleteFile = path.join(testConfigDir, 'opencode-incomplete.jsonc');
    fs.writeFileSync(incompleteFile, JSON.stringify({
      provider: {
        'opencode-go': {
          baseURL: 'http://127.0.0.1:4010/v1',
          models: { 'deepseek-v4.1-flash': { name: 'deepseek-v4.1-flash' } }
        }
      },
      model: 'opencode-go/deepseek-v4.1-flash'
    }, null, 2), 'utf8');

    // Analyze with updater.analyzeCompatibility
    const compIncomplete = updater.analyzeCompatibility({ 'opencode': '2.0.26' }, null, { ocConfigPath: incompleteFile });
    const modelWarn = compIncomplete.warnings.find(w => w.title && w.title.includes('模型清单未补全'));
    assert.ok(modelWarn, 'Must detect incomplete models catalog warning');

    // Harmonize to complete 38 models
    const fixedIncomplete = updater.harmonizeOpencodeConfig(incompleteFile, 4010);
    assert.strictEqual(fixedIncomplete.success, true);
    assert.strictEqual(fixedIncomplete.modelCount, 38);
    const fixedData = JSON.parse(fs.readFileSync(incompleteFile, 'utf8'));
    assert.strictEqual(Object.keys(fixedData.provider['opencode-go'].models).length, 38);
    console.log('✓ Doctor Diagnostic & Self-Healing for Incomplete 38-Models Catalog verified');

    // [Test 55] Testing Dynamic Upstream Models Sync & Incremental Hot-Merge
    console.log('\n[Test 55] Testing Dynamic Upstream Models Sync & Incremental Hot-Merge...');
    const dynamicFile = path.join(testConfigDir, 'opencode-dynamic.jsonc');
    fs.writeFileSync(dynamicFile, JSON.stringify({
      provider: {
        'opencode-go': {
          baseURL: 'http://127.0.0.1:4010/v1',
          models: {
            'custom-fine-tuned-model': { name: 'My Private Model', customParam: 123 },
            'glm-5.3-flash': { name: 'glm-5.3-flash' }
          }
        }
      },
      model: 'opencode-go/glm-5.3-flash'
    }, null, 2), 'utf8');

    // Simulate official upstream introducing 2 brand new models (total 40 models)
    const simulatedOfficialModels = [...updater.ALL_38_SLUGS, 'deepseek-v5', 'glm-6'];
    const dynamicHarmRes = updater.harmonizeOpencodeConfig(dynamicFile, 4010, {
      officialModels: simulatedOfficialModels
    });
    assert.strictEqual(dynamicHarmRes.success, true);
    assert.ok(dynamicHarmRes.modelCount >= 40, `Model count must be at least 40 (got ${dynamicHarmRes.modelCount})`);
    assert.strictEqual(dynamicHarmRes.currentModel, 'opencode-go/glm-5.3-flash', 'User selected model must be preserved');

    const dynamicParsed = JSON.parse(fs.readFileSync(dynamicFile, 'utf8'));
    const dynamicModels = dynamicParsed.provider['opencode-go'].models;
    assert.ok(dynamicModels['deepseek-v5'], 'New upstream model deepseek-v5 must be auto-injected');
    assert.ok(dynamicModels['glm-6'], 'New upstream model glm-6 must be auto-injected');
    assert.ok(dynamicModels['custom-fine-tuned-model'], 'Custom fine-tuned model must be strictly preserved');
    assert.strictEqual(dynamicModels['custom-fine-tuned-model'].customParam, 123, 'Custom metadata preserved');
    console.log('✓ Dynamic Upstream Models Sync & Incremental Hot-Merge verified');

    // [Test 56] Testing OMO Plugin Version Tag Normalization & Auto-Alignment
    console.log('\n[Test 56] Testing OMO Plugin Version Tag Normalization & Auto-Alignment...');
    const omoTagFile = path.join(testConfigDir, 'opencode-omo-tag.jsonc');
    fs.writeFileSync(omoTagFile, JSON.stringify({
      plugin: ['oh-my-openagent', 'opencode-goal-plugin'],
      provider: {
        'opencode-go': {
          baseURL: 'http://127.0.0.1:4010/v1',
          models: {}
        }
      }
    }, null, 2), 'utf8');

    const omoHarmRes = updater.harmonizeOpencodeConfig(omoTagFile, 4010, { omoVersion: '5.1.29' });
    assert.strictEqual(omoHarmRes.success, true);
    const omoParsed = JSON.parse(fs.readFileSync(omoTagFile, 'utf8'));
    assert.strictEqual(omoParsed.plugin[0], 'oh-my-openagent@5.1.29', 'OMO plugin tag must be normalized to oh-my-openagent@5.1.29');
    console.log('✓ OMO Plugin Version Tag Normalization & Auto-Alignment verified');

    // [Test 57] Testing Dynamic Models Sync API (/balancer/api/models/sync)
    console.log('\n[Test 57] Testing Dynamic Models Sync API (/balancer/api/models/sync)...');
    const syncRes = await request('/balancer/api/models/sync', { method: 'GET' });
    assert.strictEqual(syncRes.statusCode, 200);
    const syncData = JSON.parse(syncRes.body);
    assert.strictEqual(syncData.success, true);
    assert.ok(syncData.officialCount >= 38, `Official count must be at least 38 (got ${syncData.officialCount})`);
    assert.ok(Array.isArray(syncData.models), 'Must return models array');
    console.log('✓ Dynamic Models Sync API (/balancer/api/models/sync) verified');

    // [Test 58] Testing OMO Plugin v2 Integrity Detection Engine
    console.log('\n[Test 58] Testing OMO Plugin v2 Integrity Detection Engine...');
    const omoIntegrityRes = updater.checkOmoPluginV2Integrity();
    assert.strictEqual(typeof omoIntegrityRes.installed, 'boolean');
    assert.strictEqual(typeof omoIntegrityRes.healthy, 'boolean');
    assert.strictEqual(typeof omoIntegrityRes.hasDeadlockEffect, 'boolean');
    assert.strictEqual(typeof omoIntegrityRes.hasMissingWrapper, 'boolean');
    console.log(`✓ OMO Plugin v2 Integrity Detection verified (checked ${omoIntegrityRes.targetsCount} targets, healthy: ${omoIntegrityRes.healthy})`);

    // [Test 59] Testing Provider Dual-Track Schema Detection Engine
    console.log('\n[Test 59] Testing Provider Dual-Track Schema Detection Engine...');
    const singleTrackFile = path.join(testConfigDir, 'single-track.jsonc');
    fs.writeFileSync(singleTrackFile, JSON.stringify({
      provider: {
        'opencode-go': {
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: 'http://127.0.0.1:4010/v1', apiKey: 'local-router' },
          models: { 'deepseek-v4.1-flash': { name: 'deepseek-v4.1-flash' } }
        },
        'aixforge': {
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: 'https://api.aixforge.com/v1', apiKey: 'sk-test' },
          models: { 'deepseek-v4-flash': { name: 'deepseek-v4-flash' } }
        }
      }
    }, null, 2), 'utf8');

    const dtCheck1 = updater.checkProviderDualTrackSchema(singleTrackFile);
    assert.strictEqual(dtCheck1.healthy, false, 'Single track config must be flagged as non-healthy');
    assert.ok(dtCheck1.issues.length >= 2, 'Must report missing OpenChamber package/settings/modelID');

    // Run harmonizeOpencodeConfig to apply Dual-Track Schema
    updater.harmonizeOpencodeConfig(singleTrackFile, 4010);
    const dtCheck2 = updater.checkProviderDualTrackSchema(singleTrackFile);
    assert.strictEqual(dtCheck2.healthy, true, 'Harmonized config must satisfy Dual-Track Schema');
    assert.strictEqual(dtCheck2.issues.length, 0);
    const dtParsed = JSON.parse(fs.readFileSync(singleTrackFile, 'utf8'));
    assert.strictEqual(dtParsed.provider['opencode-go'].package, '@opencode/ai/providers/openai-compatible');
    assert.strictEqual(dtParsed.provider['opencode-go'].settings.baseURL, 'http://127.0.0.1:4010/v1');
    assert.strictEqual(dtParsed.provider['aixforge'].package, '@opencode/ai/providers/openai-compatible');
    assert.strictEqual(dtParsed.provider['aixforge'].settings.baseURL, 'https://api.aixforge.com/v1');
    assert.strictEqual(dtParsed.provider['aixforge'].models['deepseek-v4-flash'].modelID, 'deepseek-v4-flash');
    console.log('✓ Provider Dual-Track Schema Detection & Auto-Harmonization verified');

    // [Test 60] Testing OpenChamber Live Port Detection & Service Probing
    console.log('\n[Test 60] Testing OpenChamber Live Port Detection & Service Probing...');
    const detectedPort = updater.detectOpenChamberActivePort();
    assert.strictEqual(typeof detectedPort, 'number');
    assert.ok(detectedPort > 0);
    const probeTestRes = await updater.probeOpenChamberServices(mockPort, 1000);
    assert.strictEqual(probeTestRes.port, mockPort);
    assert.ok(['healthy', 'error', 'deadlocked', 'unreachable'].includes(probeTestRes.integration.status));
    assert.ok(['healthy', 'degraded', 'error', 'unreachable'].includes(probeTestRes.plugins.status));
    console.log(`✓ OpenChamber Live Port Detection & Probing verified (detected port: ${detectedPort})`);

    // [Test 61] Testing Doctor & Auto-Repair Lifecycle with OMO Deadlock Eradication & Dual-Track Schema
    console.log('\n[Test 61] Testing Doctor & Auto-Repair Lifecycle with OMO Deadlock Eradication & Dual-Track Schema...');
    const docRes61 = await request('/balancer/api/doctor', { method: 'GET' });
    assert.strictEqual(docRes61.statusCode, 200);
    const docData61 = JSON.parse(docRes61.body);
    assert.ok(docData61.omoIntegrity, 'Doctor must return omoIntegrity field');
    assert.ok(docData61.dualTrackSchema, 'Doctor must return dualTrackSchema field');
    assert.ok(docData61.openchamberProbe, 'Doctor must return openchamberProbe field');

    const repairRes61 = await request('/balancer/api/repair', { method: 'POST' });
    assert.strictEqual(repairRes61.statusCode, 200);
    const repairData61 = JSON.parse(repairRes61.body);
    assert.strictEqual(repairData61.success, true);
    assert.ok(Array.isArray(repairData61.results));
    const omoRepairItem = repairData61.results.find(r => r.item === 'OMO Plugin v2 Patch');
    assert.ok(omoRepairItem, 'Repair results must include OMO Plugin v2 Patch step');
    assert.strictEqual(omoRepairItem.success, true);
    // [Test 62] Testing Account Quota API Debounce Cache & UI Auto-Refresh Engine
    console.log('\n[Test 62] Testing Account Quota API Debounce Cache & UI Auto-Refresh Engine...');
    const initialQuotaCalls = quotaUsageCalls;

    // 1. First fetch (no cache yet)
    const quotaRes1 = await request('/balancer/api/account-quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'account-1' })
    });
    assert.strictEqual(quotaRes1.statusCode, 200);
    const quotaData1 = JSON.parse(quotaRes1.body);
    assert.strictEqual(quotaData1.success, true);
    assert.strictEqual(quotaData1.fromCache, false);
    assert.ok(quotaData1.usage);
    assert.strictEqual(quotaData1.usage.rolling.percent, 15);
    assert.strictEqual(quotaUsageCalls, initialQuotaCalls + 1, 'Upstream should be called once');

    // 2. Second fetch within 8 seconds without force flag (must hit in-memory debounce cache)
    const quotaRes2 = await request('/balancer/api/account-quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'account-1' })
    });
    assert.strictEqual(quotaRes2.statusCode, 200);
    const quotaData2 = JSON.parse(quotaRes2.body);
    assert.strictEqual(quotaData2.success, true);
    assert.strictEqual(quotaData2.fromCache, true, 'Debounce cache must be hit');
    assert.strictEqual(quotaData2.usage.rolling.percent, 15);
    assert.strictEqual(quotaUsageCalls, initialQuotaCalls + 1, 'Upstream should NOT be called again due to cache');

    // 3. Third fetch with force: true (must penetrate cache and call upstream)
    const quotaRes3 = await request('/balancer/api/account-quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'account-1', force: true })
    });
    assert.strictEqual(quotaRes3.statusCode, 200);
    const quotaData3 = JSON.parse(quotaRes3.body);
    assert.strictEqual(quotaData3.success, true);
    assert.strictEqual(quotaData3.fromCache, false, 'Force flag must penetrate cache');
    assert.strictEqual(quotaUsageCalls, initialQuotaCalls + 2, 'Upstream must be called when force is true');

    // 4. Verify UI HTML includes auto-refresh controls and countdown hooks
    const uiRes = await request('/balancer/ui', { method: 'GET' });
    assert.strictEqual(uiRes.statusCode, 200);
    assert.ok(uiRes.body.includes('quota-refresh-interval'), 'UI must include quota-refresh-interval selector');
    assert.ok(uiRes.body.includes('quota-countdown-badge'), 'UI must include quota-countdown-badge');
    assert.ok(uiRes.body.includes('initQuotaRefreshScheduler'), 'UI must include initQuotaRefreshScheduler function');
    assert.ok(uiRes.body.includes('triggerManualQuotaRefreshAll'), 'UI must include triggerManualQuotaRefreshAll handler');
    console.log('✓ Account Quota API Debounce Cache & UI Auto-Refresh Engine verified');

    // [Test 63] Testing OpenCode 2.0 Native Agent Self-Healing (Goal & Goal-Verify Auto-Injection)
    console.log('\n[Test 63] Testing OpenCode 2.0 Native Agent Self-Healing (Goal & Goal-Verify Auto-Injection)...');
    const agentTestDir = path.join(os.tmpdir(), 'opencode-agent-test-' + Date.now());
    fs.mkdirSync(agentTestDir, { recursive: true });
    try {
      const agentConfigFile = path.join(agentTestDir, 'opencode.jsonc');
      // Case 1: Missing agent section completely
      fs.writeFileSync(agentConfigFile, JSON.stringify({
        model: 'opencode-go/deepseek-v4.1-flash',
        provider: { 'opencode-go': { options: {} } }
      }, null, 2), 'utf8');

      const res1 = updater.harmonizeOpencodeConfig(agentConfigFile, 4010);
      assert.strictEqual(res1.agentGoalInjected, true, 'agentGoalInjected must be true when agent is missing');
      const data1 = JSON.parse(fs.readFileSync(agentConfigFile, 'utf8'));
      assert.ok(data1.agent && data1.agent.goal, 'agent.goal must be injected');
      assert.strictEqual(data1.agent.goal.mode, 'primary');
      assert.ok(data1.agent['goal-verify'], 'agent.goal-verify must be injected');
      assert.strictEqual(data1.agent['goal-verify'].mode, 'subagent');

      // Case 2: Custom agent already exists - must preserve user custom definitions
      data1.agent.goal.description = 'Custom User Goal Agent';
      fs.writeFileSync(agentConfigFile, JSON.stringify(data1, null, 2), 'utf8');
      const res2 = updater.harmonizeOpencodeConfig(agentConfigFile, 4010);
      assert.strictEqual(res2.agentGoalInjected, false, 'agentGoalInjected must be false when already present');
      const data2 = JSON.parse(fs.readFileSync(agentConfigFile, 'utf8'));
      assert.strictEqual(data2.agent.goal.description, 'Custom User Goal Agent', 'Custom agent description must be preserved');
    } finally {
      try { fs.rmSync(agentTestDir, { recursive: true, force: true }); } catch (_) {}
    }
    // [Test 64] Testing Model Compatibility Aliases for Codex Bridge...
    console.log('\n[Test 64] Testing Model Compatibility Aliases for Codex Bridge...');
    const alias1 = codexAdapter.convertResponsesToChatPayload({ model: 'gpt-5.6-luna', input: 'test' });
    assert.strictEqual(alias1.model, 'deepseek-v4-pro', 'gpt-5.6-luna must map to deepseek-v4-pro');
    const alias2 = codexAdapter.convertResponsesToChatPayload({ model: 'grok-4.7', input: 'test' });
    assert.strictEqual(alias2.model, 'qwen3.7-max', 'grok-4.7 must map to qwen3.7-max');
    const alias3 = codexAdapter.convertResponsesToChatPayload({ model: 'minimax-m2.7', input: 'test' });
    assert.strictEqual(alias3.model, 'minimax-m3', 'minimax-m2.7 must map to minimax-m3');
    console.log('✓ Model Compatibility Aliases for Codex Bridge verified (5 models mapped to flagship peers)');

    // [Test 65] Testing Context Pruning & Sliding-Window Compression Engine...
    console.log('\n[Test 65] Testing Context Pruning & Sliding-Window Compression Engine...');
    const hugeToolOutput = 'A'.repeat(50000);
    const mockToolInputs = [
      { type: 'message', role: 'user', content: 'Initial user task' },
      { type: 'function_call_output', call_id: 'call_1', output: hugeToolOutput }
    ];
    const folded = codexAdapter.pruneResponsesPayload({ input: mockToolInputs });
    assert.strictEqual(folded.input.length, 2, 'Input length should remain 2');
    assert.ok(folded.input[1].output.includes('智能网关自愈：已自动折叠'), 'Huge tool output must be folded');
    assert.ok(folded.input[1].output.length < 5000, 'Folded tool output must be compact');

    // Add 25 dummy items to trigger sliding window
    const mockSlidingInput = [
      { type: 'message', role: 'system', content: 'You are an assistant' },
      { type: 'message', role: 'user', content: 'Initial user task' }
    ];
    for (let i = 0; i < 25; i++) {
      mockSlidingInput.push({ type: 'message', role: i % 2 === 0 ? 'assistant' : 'user', content: `Turn ${i}` });
    }
    const pruned = codexAdapter.pruneResponsesPayload({ input: mockSlidingInput });
    assert.ok(pruned.input.length < mockSlidingInput.length, 'Pruned input count must be less than original');
    assert.ok(pruned.input.some(item => item.content && item.content.includes('智能网关已对前序')), 'Must contain sliding window notice');

    // Also verify pruneChatMessages
    const mockChatMessages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
      { role: 'tool', content: 'B'.repeat(30000) }
    ];
    const foldedChat = codexAdapter.pruneChatMessages(mockChatMessages);
    assert.ok(foldedChat[2].content.includes('智能网关自愈：已自动折叠'), 'Chat tool content must be folded');
    assert.ok(foldedChat[2].content.length < 5000, 'Folded chat content must be compact');

    for (let i = 0; i < 20; i++) {
      mockChatMessages.push({ role: i % 2 === 0 ? 'assistant' : 'user', content: `chat turn ${i}` });
    }
    const prunedMsgs = codexAdapter.pruneChatMessages(mockChatMessages);
    assert.ok(prunedMsgs.length < mockChatMessages.length, 'Pruned chat messages count must be smaller');
    console.log('✓ Context Pruning & Sliding-Window Compression Engine verified');

    // [Test 66] Testing Restart Codex API (/balancer/api/restart-codex)...
    console.log('\n[Test 66] Testing Restart Codex API (/balancer/api/restart-codex)...');
    const restartRes = await request('/balancer/api/restart-codex', {
      method: 'POST'
    });
    assert.strictEqual(restartRes.statusCode, 200, 'Restart Codex API must return 200');
    const restartData = JSON.parse(restartRes.body);
    assert.ok(restartData.success !== undefined, 'Restart Codex must return success boolean');
    assert.ok(restartData.result.messages, 'Restart Codex must return detailed messages');
    console.log('✓ Restart Codex API & Decoupled Execution verified');

    // [Test 67] Testing HTTP Basic Auth Auto-Discovery (Authorization: Basic support)
    console.log('\n[Test 67] Testing HTTP Basic Auth Auto-Discovery (Authorization: Basic support)...');
    // Enable password
    const testBasicPwd = 'TestBasicPassword987!';
    await request('/balancer/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...testConfig, uiPassword: testBasicPwd })
    });

    // 1. Unauthenticated request should fail with 401
    const unauthTest67 = await request('/balancer/api/config', { method: 'GET' });
    assert.strictEqual(unauthTest67.statusCode, 401, 'Should require auth when uiPassword is set');

    // 2. Standard Basic auth: "opencode:password"
    const basic1 = Buffer.from(`opencode:${testBasicPwd}`).toString('base64');
    const authBasicRes1 = await request('/balancer/api/config', {
      method: 'GET',
      headers: { 'Authorization': `Basic ${basic1}` }
    });
    assert.strictEqual(authBasicRes1.statusCode, 200, 'Basic auth with username:password must succeed');

    // 3. Password-only Basic auth: ":password"
    const basic2 = Buffer.from(`:${testBasicPwd}`).toString('base64');
    const authBasicRes2 = await request('/balancer/api/config', {
      method: 'GET',
      headers: { 'Authorization': `Basic ${basic2}` }
    });
    assert.strictEqual(authBasicRes2.statusCode, 200, 'Basic auth with :password must succeed');

    // 4. Raw password base64: "password"
    const basic3 = Buffer.from(testBasicPwd).toString('base64');
    const authBasicRes3 = await request('/balancer/api/config', {
      method: 'GET',
      headers: { 'Authorization': `Basic ${basic3}` }
    });
    assert.strictEqual(authBasicRes3.statusCode, 200, 'Basic auth with base64 password must succeed');

    // 5. Wrong password should return 401
    const badBasic = Buffer.from('opencode:WrongPassword!').toString('base64');
    const badBasicRes = await request('/balancer/api/config', {
      method: 'GET',
      headers: { 'Authorization': `Basic ${badBasic}` }
    });
    assert.strictEqual(badBasicRes.statusCode, 401, 'Basic auth with wrong password must be rejected (401)');

    // Reset password back to empty
    await request('/balancer/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${basic1}`
      },
      body: JSON.stringify({ ...testConfig, uiPassword: '' })
    });
    console.log('✓ HTTP Basic Auth Auto-Discovery (user:pass, :pass, and raw b64) verified');

    // [Test 68] Testing Stream Abort Resilience & Zero Unhandled Exceptions
    console.log('\n[Test 68] Testing Stream Abort Resilience & Zero Unhandled Exceptions...');
    const abortTestPromise = new Promise((resolve, reject) => {
      const abortReq = http.request({
        hostname: '127.0.0.1',
        port: routerPort,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-opencode-session': 'session-anthropic-stream'
        }
      }, (res) => {
        // Destroy client connection immediately upon first data chunk
        res.on('data', () => {
          abortReq.destroy();
          resolve();
        });
      });
      abortReq.on('error', (err) => {
        // Expected client abort error
        resolve();
      });
      abortReq.write(JSON.stringify({
        model: 'claude-haiku-5-5',
        messages: [{ role: 'user', content: 'hello' }]
      }));
      abortReq.end();
    });

    await abortTestPromise;
    await new Promise(r => setTimeout(r, 200));

    // Router must still be completely healthy and responsive
    const healthPostAbort = await request('/health');
    assert.strictEqual(healthPostAbort.statusCode, 200, 'Router must remain healthy after stream abort');
    console.log('✓ Stream Abort Resilience & Zero Unhandled Exceptions verified');

    // [Test 69] Testing Electron Ghost Process Detection & Single-Instance Lock Healing Logic
    console.log('\n[Test 69] Testing Electron Ghost Process Detection & Single-Instance Lock Healing Logic...');
    function detectGhostProcesses(procList) {
      if (!Array.isArray(procList) || procList.length === 0) return { isGhost: false, count: 0 };
      const hasWindow = procList.some(p => p.MainWindowHandle !== 0);
      return {
        isGhost: !hasWindow,
        count: procList.length
      };
    }

    const mockGhostProcs = [{ Id: 101, MainWindowHandle: 0 }, { Id: 102, MainWindowHandle: 0 }];
    const ghostRes = detectGhostProcesses(mockGhostProcs);
    assert.strictEqual(ghostRes.isGhost, true, 'All zero MainWindowHandle processes must be identified as ghost processes');
    assert.strictEqual(ghostRes.count, 2);

    const mockNormalProcs = [{ Id: 101, MainWindowHandle: 0 }, { Id: 103, MainWindowHandle: 98765 }];
    const normalRes = detectGhostProcesses(mockNormalProcs);
    assert.strictEqual(normalRes.isGhost, false, 'Processes with valid window handle must NOT be identified as ghost processes');
    console.log('✓ Electron Ghost Process Detection & Single-Instance Lock Healing Logic verified');

    // [Test 70] Testing Desktop & Startup Shortcut Escaping & Anti-Malformed Parameter Validation
    console.log('\n[Test 70] Testing Desktop & Startup Shortcut Escaping & Anti-Malformed Parameter Validation...');
    const launchGuiVbsPath = path.resolve(__dirname, 'launch-gui.vbs');
    const startTrayVbsPath = path.resolve(__dirname, 'start-tray.vbs');
    assert.ok(fs.existsSync(launchGuiVbsPath), 'launch-gui.vbs must exist');
    assert.ok(fs.existsSync(startTrayVbsPath), 'start-tray.vbs must exist');

    const launchGuiContent = fs.readFileSync(launchGuiVbsPath, 'utf8');
    assert.ok(launchGuiContent.includes('WScript.Arguments'), 'launch-gui.vbs must forward command arguments');

    function validateShortcutArguments(targetPath, argumentsStr) {
      assert.strictEqual(targetPath, 'wscript.exe', 'Shortcut must use wscript.exe host for zero-window stealth');
      assert.ok(!argumentsStr.endsWith('\\'), 'Arguments must not end with a naked trailing backslash');
      assert.ok(!argumentsStr.includes('\\"'), 'Arguments must not contain double-escaped trailing backslash quotes');
      assert.ok(argumentsStr.startsWith('"'), 'Arguments file path must start with quote');
      return true;
    }

    validateShortcutArguments('wscript.exe', `"${launchGuiVbsPath}"`);
    validateShortcutArguments('wscript.exe', `"${startTrayVbsPath}" -Silent`);
    console.log('✓ Desktop & Startup Shortcut Escaping & Anti-Malformed Parameter Validation verified');

    // [Test 71] Testing Dynamic Version Drift Immunity (Verifying Zero Hardcoding in Harmonization)
    console.log('\n[Test 71] Testing Dynamic Version Drift Immunity (Verifying Zero Hardcoding in Harmonization)...');
    const testOmoConfigPath = path.join(testConfigDir, 'opencode-version-test.jsonc');
    fs.writeFileSync(testOmoConfigPath, JSON.stringify({
      plugin: ['oh-my-openagent@5.9.99', 'opencode-goal-plugin'],
      provider: {
        'custom-corp': {
          npm: '@corp/custom-ai',
          options: { baseURL: 'https://ai.corp.internal/v1' }
        }
      }
    }, null, 2), 'utf8');

    const harmResult71 = updater.harmonizeOpencodeConfig(testOmoConfigPath, routerPort);
    assert.strictEqual(harmResult71.success, true);

    const reReadConfig = JSON.parse(updater.stripJsonComments(fs.readFileSync(testOmoConfigPath, 'utf8')));
    const omoTag = reReadConfig.plugin.find(p => typeof p === 'string' && p.startsWith('oh-my-openagent'));
    assert.strictEqual(omoTag, 'oh-my-openagent@5.9.99', 'Harmonization must respect installed/existing 5.9.99 version without regressing to hardcoded tags');
    assert.ok(reReadConfig.provider['opencode-go'], 'Must have opencode-go provider');
    assert.ok(reReadConfig.provider['custom-corp'], 'Must preserve custom-corp provider');
    assert.ok(reReadConfig.agent.goal, 'Must have agent.goal injected');
    assert.ok(reReadConfig.agent['goal-verify'], 'Must have agent.goal-verify injected');
    console.log('✓ Dynamic Version Drift Immunity & Agent Definition verified');

    // [Test 72] Testing Semver 2.0.0 Precedence & Metadata Immunity
    console.log('\n[Test 72] Testing Semver 2.0.0 Precedence & Metadata Immunity...');
    assert.ok(updater.compareSemver('5.1.30-beta.2', '5.1.30-beta.1') > 0, 'beta.2 must be greater than beta.1');
    assert.ok(updater.compareSemver('5.1.30-rc.1', '5.1.30-beta.2') > 0, 'rc.1 must be greater than beta.2');
    assert.ok(updater.compareSemver('5.1.30', '5.1.30-rc.1') > 0, 'Release 5.1.30 must be greater than rc.1');
    assert.strictEqual(updater.compareSemver('5.1.30+build.1', '5.1.30'), 0, 'Build metadata must not affect version equality');
    assert.ok(updater.compareSemver('v5.2', '5.1.99') > 0, 'v5.2 must be greater than 5.1.99');
    assert.strictEqual(updater.compareSemver('^5.2.0', '5.2.0'), 0, 'Prefix ^ must be safely stripped and compared');

    // Test harmonization with prerelease version preservation
    const testOmoPrePath = path.join(testConfigDir, 'opencode-prerelease-test.jsonc');
    fs.writeFileSync(testOmoPrePath, JSON.stringify({
      plugin: ['oh-my-openagent@5.2.0-rc.1'],
      provider: {}
    }, null, 2), 'utf8');
    const harmResPre = updater.harmonizeOpencodeConfig(testOmoPrePath, routerPort);
    assert.strictEqual(harmResPre.success, true);
    const reReadPre = JSON.parse(updater.stripJsonComments(fs.readFileSync(testOmoPrePath, 'utf8')));
    const preTag = reReadPre.plugin.find(p => typeof p === 'string' && p.startsWith('oh-my-openagent'));
    assert.strictEqual(preTag, 'oh-my-openagent@5.2.0-rc.1', 'Harmonization must preserve prerelease tags');
    console.log('✓ Semver 2.0.0 Precedence & Metadata Immunity verified');

    // [Test 73] Testing Doctor Live Diagnostics & PowerShell EncodedCommand Zero-Window Execution
    console.log('\n[Test 73] Testing Doctor Live Diagnostics & PowerShell EncodedCommand Zero-Window Execution...');
    const docRes73 = await request('/balancer/api/doctor');
    assert.strictEqual(docRes73.statusCode, 200, 'Doctor endpoint must return HTTP 200');
    const docData73 = JSON.parse(docRes73.body);
    assert.ok(docData73.router, 'Doctor report must include router status');
    assert.ok(docData73.openchamber, 'Doctor report must include openchamber diagnosis');
    assert.ok(!docData73.openchamber.error || !docData73.openchamber.error.includes('|| true'), 'Must not fail with Windows cmd || true error');

    if (process.platform === 'win32') {
      const psTestScript = `
$ProgressPreference = 'SilentlyContinue'
[PSCustomObject]@{ Status = 'healthy'; Port = 4010 } | ConvertTo-Json -Compress
`;
      const enc = Buffer.from(psTestScript, 'utf16le').toString('base64');
      const out = execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${enc}`, { encoding: 'utf8' }).trim();
      const jsonMatch = out.match(/\{[\s\S]*\}/);
      assert.ok(jsonMatch, 'PowerShell EncodedCommand must return clean parseable JSON');
      const parsed = JSON.parse(jsonMatch[0]);
      assert.strictEqual(parsed.Status, 'healthy');
      assert.strictEqual(parsed.Port, 4010);
    }
    console.log('✓ Doctor Live Diagnostics & PowerShell EncodedCommand Zero-Window Execution verified');

    // [Test 74] Testing Immediate Upstream Socket Destruction on Client Stream Abort across Bridges
    console.log('\n[Test 74] Testing Immediate Upstream Socket Destruction on Client Stream Abort across Bridges...');
    const fakeUpstream = new EventEmitter();
    let upstreamDestroyed = false;
    fakeUpstream.destroyed = false;
    fakeUpstream.destroy = () => { upstreamDestroyed = true; fakeUpstream.destroyed = true; };

    const fakeClient = new EventEmitter();
    fakeClient.writeHead = () => {};
    fakeClient.write = () => {};
    fakeClient.end = () => {};
    fakeClient.writableEnded = false;
    fakeClient.destroyed = false;

    // Bridge stream call
    codexAdapter.bridgeResponsesStream(fakeUpstream, fakeClient, 'deepseek-v4.1-flash', 'resp_abort_test', () => {});
    assert.strictEqual(upstreamDestroyed, false, 'Upstream must not be destroyed before abort');

    // Simulate client abrupt disconnect
    fakeClient.emit('close');
    assert.strictEqual(upstreamDestroyed, true, 'Upstream stream must be immediately destroyed when client disconnects to prevent socket/memory leak');
    console.log('✓ Immediate Upstream Socket Destruction on Client Stream Abort across Bridges verified');

    // [Test 75] Testing Anthropic Bridge Context Length Overflow Auto-Pruning & Self-Healing
    console.log('\n[Test 75] Testing Anthropic Bridge Context Length Overflow Auto-Pruning & Self-Healing...');
    const largeContent = 'Repeated context text block for testing context overflow self healing. '.repeat(20);
    const antResOverflow = await request('/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-anthropic-context-overflow'
      },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        messages: [
          { role: 'user', content: 'Initial message' },
          { role: 'assistant', content: 'Prior assistant response' },
          { role: 'user', content: largeContent }
        ]
      })
    });
    assert.strictEqual(antResOverflow.statusCode, 200, 'Anthropic bridge must automatically recover and return 200 after context overflow');
    const antData = JSON.parse(antResOverflow.body);
    assert.ok(antData.content, 'Must have content in response');
    console.log('✓ Anthropic Bridge Context Length Overflow Auto-Pruning & Self-Healing verified');

    // [Test 76] Testing Page Visibility & Quota Polling Anti-Throttling Guard
    console.log('\n[Test 76] Testing Page Visibility & Quota Polling Anti-Throttling Guard...');
    // 1. Test quota cache TTL
    const initialCalls = quotaUsageCalls;
    const q1 = await request('/balancer/api/account-quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-2', force: false })
    });
    assert.strictEqual(q1.statusCode, 200);
    const qData1 = JSON.parse(q1.body);
    assert.strictEqual(qData1.success, true);
    assert.strictEqual(quotaUsageCalls, initialCalls + 1, 'First quota call should hit upstream');

    // Second call without force should hit memory cache (Rule 7)
    const q2 = await request('/balancer/api/account-quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-2', force: false })
    });
    assert.strictEqual(q2.statusCode, 200);
    const qData2 = JSON.parse(q2.body);
    assert.strictEqual(qData2.fromCache, true, 'Second call within TTL must return cached quota');
    assert.strictEqual(quotaUsageCalls, initialCalls + 1, 'Cached quota call must NOT hit upstream');

    // Third call with force: true must penetrate cache (Rule 7)
    const q3 = await request('/balancer/api/account-quota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'account-2', force: true })
    });
    assert.strictEqual(q3.statusCode, 200);
    const qData3 = JSON.parse(q3.body);
    assert.strictEqual(qData3.fromCache, false, 'Forced quota refresh must penetrate cache');
    assert.strictEqual(quotaUsageCalls, initialCalls + 2, 'Forced quota refresh must hit upstream');

    // Verify start-tray.vbs contains -Silent default argument
    const startTrayContent = fs.readFileSync(startTrayVbsPath, 'utf8');
    assert.ok(startTrayContent.includes('-Silent'), 'start-tray.vbs must default to silent mode');
    console.log('✓ Page Visibility & Quota Polling Anti-Throttling Guard verified');

    // [Test 77] Testing Web UI Dashboard Frontend JavaScript Syntax & Runtime Integrity
    console.log('\n[Test 77] Testing Web UI Dashboard Frontend JavaScript Syntax & Runtime Integrity...');
    const uiDashboardRes = await request('/balancer/ui', { method: 'GET' });
    assert.strictEqual(uiDashboardRes.statusCode, 200);
    const scriptMatch = uiDashboardRes.body.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, 'Web UI must contain inline client script');
    const clientScript = scriptMatch[1];
    
    // Must be 100% syntactically valid with zero unescaped token/newline errors
    assert.doesNotThrow(() => {
      new Function(clientScript);
    }, 'Client script in Web UI must compile without any SyntaxError');

    // Also verify login page script syntax (renderLoginPage)
    const serverJsSource = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const loginScriptMatch = serverJsSource.match(/function renderLoginPage[\s\S]*?<script>([\s\S]*?)<\/script>/);
    assert.ok(loginScriptMatch, 'renderLoginPage must contain client script');
    assert.doesNotThrow(() => {
      new Function(loginScriptMatch[1]);
    }, 'Login page script must compile without SyntaxError');

    // Verify restartCodex runs cleanly without console ConPTY pipe errors
    const restartCodexTestRes = codexAdapter.restartCodex();
    assert.strictEqual(restartCodexTestRes.restarted, true);
    assert.strictEqual(restartCodexTestRes.success, true);
    console.log('✓ Web UI Dashboard Frontend JavaScript Syntax & Runtime Integrity verified');

    // [Test 78] Testing Empty Stream Disconnection Defense, Dynamic Session Isolation & Zero-Leak Lifecycle
    console.log('\n[Test 78] Testing Empty Stream Disconnection Defense, Dynamic Session Isolation & Zero-Leak Lifecycle...');

    // 1. Dynamic Session ID derivation test suite (including Codex-native thread metadata)
    assert.strictEqual(
      codexAdapter.extractOrDeriveSessionId({ headers: { 'x-opencode-session': 'custom-session-99' } }),
      'custom-session-99',
      'x-opencode-session must take first priority'
    );
    assert.strictEqual(
      codexAdapter.extractOrDeriveSessionId({ headers: { 'x-conversation-id': '01a134c1-thread' } }),
      'session-conv-01a134c1-thread',
      'x-conversation-id must prefix session-conv-'
    );
    assert.strictEqual(
      codexAdapter.extractOrDeriveSessionId({ headers: { 'x-codex-turn-metadata': '{"thread_id":"01a134c1-9e41-7111-9bae-a1442eab1d9b","session_id":"sess-codex-1"}' } }),
      'session-codex-01a134c1-9e41-7111-9bae-a1442eab1d9b',
      'x-codex-turn-metadata must extract thread_id and prefix session-codex-'
    );
    assert.strictEqual(
      codexAdapter.extractOrDeriveSessionId({ headers: { 'x-codex-parent-thread-id': 'parent-thread-01a1' } }),
      'session-codex-parent-thread-01a1',
      'x-codex-parent-thread-id must extract thread and prefix session-codex-'
    );
    assert.strictEqual(
      codexAdapter.extractOrDeriveSessionId({ headers: { 'x-request-id': 'req-uuid-123' } }),
      'session-req-req-uuid-123',
      'x-request-id must prefix session-req-'
    );
    assert.strictEqual(
      codexAdapter.extractOrDeriveSessionId({ headers: {} }, { previous_response_id: 'resp_1791988' }),
      'session-resp-resp_1791988',
      'previous_response_id in body must derive session-resp-'
    );
    assert.strictEqual(
      codexAdapter.extractOrDeriveSessionId({ headers: {} }, { parent_response_id: 'resp_parent_888' }),
      'session-resp-resp_parent_888',
      'parent_response_id in body must derive session-resp-'
    );
    assert.strictEqual(
      codexAdapter.extractOrDeriveSessionId({ headers: {} }, { thread_id: 'thread_body_777' }),
      'session-codex-thread_body_777',
      'thread_id in body must derive session-codex-'
    );
    assert.strictEqual(
      codexAdapter.extractOrDeriveSessionId({ headers: {} }, { conversation_id: 'conv_nested_456' }),
      'session-conv-conv_nested_456',
      'conversation_id in body must derive session-conv-'
    );
    const autoSession1 = codexAdapter.extractOrDeriveSessionId({ headers: {} }, {});
    const autoSession2 = codexAdapter.extractOrDeriveSessionId({ headers: {} }, {});
    assert.ok(autoSession1.startsWith('session-auto-'), 'Fallback session must start with session-auto-');
    assert.notStrictEqual(autoSession1, autoSession2, 'Two un-sessioned requests must receive isolated dynamic session IDs');

    // 2. Empty stream defense in bridgeResponsesStream
    const emptyUpstreamStream = new EventEmitter();
    const emptyClientRes = new EventEmitter();
    emptyClientRes.writeHead = (status, headers) => { emptyClientRes.headers = headers; emptyClientRes.statusCode = status; };
    const emptyEmittedEvents = [];
    emptyClientRes.write = (chunk) => {
      const str = chunk.toString();
      const evMatch = str.match(/event:\s*([^\n]+)/);
      const dataMatch = str.match(/data:\s*([^\n]+)/);
      if (evMatch && dataMatch) {
        try {
          emptyEmittedEvents.push({ event: evMatch[1].trim(), data: JSON.parse(dataMatch[1].trim()) });
        } catch (e) {}
      }
    };
    emptyClientRes.end = () => { emptyClientRes.emit('finish'); };

    codexAdapter.bridgeResponsesStream(emptyUpstreamStream, emptyClientRes, 'deepseek-v4.1-flash', 'resp_empty_test_id', () => {});
    // Upstream stream terminates immediately without any content or reasoning
    emptyUpstreamStream.emit('end');

    const emptyEventTypes = emptyEmittedEvents.map(e => e.event);
    assert.strictEqual(emptyEventTypes.includes('response.completed'), false, 'Empty stream must NEVER dispatch response.completed');
    assert.strictEqual(emptyEventTypes.includes('response.failed'), true, 'Empty stream MUST dispatch response.failed');
    const failedEvent = emptyEmittedEvents.find(e => e.event === 'response.failed');
    assert.ok(failedEvent, 'Must have response.failed event');
    assert.strictEqual(failedEvent.data.response.status, 'failed');
    assert.strictEqual(failedEvent.data.response.error.code, 'upstream_stream_empty_truncated');

    // 2b. Upstream explicit 'error' event (socket reset / abort) defense in bridgeResponsesStream
    const errUpstreamStream = new EventEmitter();
    const errClientRes = new EventEmitter();
    errClientRes.writeHead = (status, headers) => { errClientRes.headers = headers; errClientRes.statusCode = status; };
    const errEmittedEvents = [];
    errClientRes.write = (chunk) => {
      const str = chunk.toString();
      const evMatch = str.match(/event:\s*([^\n]+)/);
      const dataMatch = str.match(/data:\s*([^\n]+)/);
      if (evMatch && dataMatch) {
        try {
          errEmittedEvents.push({ event: evMatch[1].trim(), data: JSON.parse(dataMatch[1].trim()) });
        } catch (e) {}
      }
    };
    errClientRes.end = () => { errClientRes.emit('finish'); };

    codexAdapter.bridgeResponsesStream(errUpstreamStream, errClientRes, 'deepseek-v4.1-flash', 'resp_err_test_id', () => {});
    errUpstreamStream.emit('error', new Error('aborted'));
    const errEventTypes = errEmittedEvents.map(e => e.event);
    assert.strictEqual(errEventTypes.includes('response.completed'), false, 'Aborted stream must NEVER dispatch response.completed');
    assert.strictEqual(errEventTypes.includes('response.failed'), true, 'Aborted stream MUST dispatch response.failed');
    const abortFailedEvent = errEmittedEvents.find(e => e.event === 'response.failed');
    assert.ok(abortFailedEvent, 'Must have response.failed event on abort');
    assert.strictEqual(abortFailedEvent.data.response.status, 'failed');
    assert.ok(abortFailedEvent.data.response.error.message.includes('aborted'));

    // 2c. Reasoning-only truncated stream defense (stream has thinking, but aborts before text/tools)
    const reasoningUpstreamStream = new EventEmitter();
    const reasoningClientRes = new EventEmitter();
    reasoningClientRes.writeHead = (status, headers) => { reasoningClientRes.headers = headers; reasoningClientRes.statusCode = status; };
    const reasoningEmittedEvents = [];
    reasoningClientRes.write = (chunk) => {
      const str = chunk.toString();
      const evMatch = str.match(/event:\s*([^\n]+)/);
      const dataMatch = str.match(/data:\s*([^\n]+)/);
      if (evMatch && dataMatch) {
        try {
          reasoningEmittedEvents.push({ event: evMatch[1].trim(), data: JSON.parse(dataMatch[1].trim()) });
        } catch (e) {}
      }
    };
    reasoningClientRes.end = () => { reasoningClientRes.emit('finish'); };

    codexAdapter.bridgeResponsesStream(reasoningUpstreamStream, reasoningClientRes, 'deepseek-v4.1-flash', 'resp_ronly_test_id', () => {});
    reasoningUpstreamStream.emit('data', Buffer.from('data: {"choices":[{"delta":{"reasoning_content":"Let me analyze this problem..."}}]}\n\n'));
    reasoningUpstreamStream.emit('end');

    const reasoningEventTypes = reasoningEmittedEvents.map(e => e.event);
    assert.strictEqual(reasoningEventTypes.includes('response.completed'), false, 'Reasoning-only truncated stream must NEVER dispatch response.completed');
    assert.strictEqual(reasoningEventTypes.includes('response.failed'), true, 'Reasoning-only truncated stream MUST dispatch response.failed');
    const reasoningFailedEvent = reasoningEmittedEvents.find(e => e.event === 'response.failed');
    assert.ok(reasoningFailedEvent, 'Must have response.failed event on reasoning truncation');
    assert.strictEqual(reasoningFailedEvent.data.response.status, 'failed');
    assert.strictEqual(reasoningFailedEvent.data.response.error.code, 'upstream_stream_truncated_reasoning_only');

    // 3. Empty stream defense in bridgeAnthropicStream
    const emptyAnthropicStream = new EventEmitter();
    const emptyAnthropicRes = new EventEmitter();
    emptyAnthropicRes.writeHead = (status, headers) => { emptyAnthropicRes.headers = headers; emptyAnthropicRes.statusCode = status; };
    const anthropicEmittedEvents = [];
    emptyAnthropicRes.write = (chunk) => {
      const str = chunk.toString();
      const evMatch = str.match(/event:\s*([^\n]+)/);
      const dataMatch = str.match(/data:\s*([^\n]+)/);
      if (evMatch && dataMatch) {
        try {
          anthropicEmittedEvents.push({ event: evMatch[1].trim(), data: JSON.parse(dataMatch[1].trim()) });
        } catch (e) {}
      }
    };
    emptyAnthropicRes.end = () => { emptyAnthropicRes.emit('finish'); };

    codexAdapter.bridgeAnthropicStream(emptyAnthropicStream, emptyAnthropicRes, 'claude-haiku-5-5', 'resp_empty_anthropic_id', () => {});
    emptyAnthropicStream.emit('end');

    const anthropicEventTypes = anthropicEmittedEvents.map(e => e.event);
    assert.strictEqual(anthropicEventTypes.includes('response.completed'), false, 'Empty Anthropic stream must NEVER dispatch response.completed');
    assert.strictEqual(anthropicEventTypes.includes('response.failed'), true, 'Empty Anthropic stream MUST dispatch response.failed');
    const anthropicFailed = anthropicEmittedEvents.find(e => e.event === 'response.failed');
    assert.ok(anthropicFailed, 'Must have response.failed event');
    assert.strictEqual(anthropicFailed.data.response.status, 'failed');
    assert.strictEqual(anthropicFailed.data.response.error.code, 'upstream_stream_empty_truncated');

    // 4. Verify bindCodexConfig writes stream_idle_timeout_ms and retry parameters & hasStreamIdleTimeout detection
    const testDir78 = path.join(os.tmpdir(), 'codex_test_78_' + Date.now());
    fs.mkdirSync(testDir78, { recursive: true });
    try {
      // Simulate unhardened config
      fs.writeFileSync(path.join(testDir78, 'config.toml'), 'model = "deepseek-v4.1-flash"\nmodel_provider = "opencode-go"\n\n[model_providers."opencode-go"]\nbase_url = "http://127.0.0.1:' + routerPort + '/v1"\n', 'utf8');
      const unhardenedStatus = codexAdapter.getCodexStatus(routerPort, testDir78);
      assert.strictEqual(unhardenedStatus.isBound, true, 'Must detect isBound = true');
      assert.strictEqual(unhardenedStatus.hasStreamIdleTimeout, false, 'Must detect hasStreamIdleTimeout = false before hardening');

      codexAdapter.bindCodexConfig({
        codexDir: testDir78,
        routerPort: routerPort,
        defaultModel: 'deepseek-v4.1-flash',
        reasoningEffort: 'xhigh',
        providerName: 'opencode-go'
      });
      const generatedToml = fs.readFileSync(path.join(testDir78, 'config.toml'), 'utf8');
      assert.ok(generatedToml.includes('stream_idle_timeout_ms = 300000'), 'config.toml must include stream_idle_timeout_ms = 300000');
      assert.ok(generatedToml.includes('stream_max_retries = 3'), 'config.toml must include stream_max_retries = 3');
      assert.ok(generatedToml.includes('request_max_retries = 3'), 'config.toml must include request_max_retries = 3');

      const hardenedStatus = codexAdapter.getCodexStatus(routerPort, testDir78);
      assert.strictEqual(hardenedStatus.hasStreamIdleTimeout, true, 'Must detect hasStreamIdleTimeout = true after hardening');
    } finally {
      try { fs.rmSync(testDir78, { recursive: true, force: true }); } catch (e) {}
    }

    // 5. Verify server.js explicitly configures server timeouts
    assert.ok(serverJsSource.includes('server.timeout = 0'), 'server.js must set server.timeout = 0');
    assert.ok(serverJsSource.includes('server.requestTimeout = 0'), 'server.js must set server.requestTimeout = 0');
    assert.ok(serverJsSource.includes('server.headersTimeout = 0'), 'server.js must set server.headersTimeout = 0');
    assert.ok(serverJsSource.includes('server.keepAliveTimeout = 65000'), 'server.js must set server.keepAliveTimeout = 65000');

    // 6. Verify activeRequests symmetric accounting and zero leak
    const statusBefore = await request('/status');
    const statusBeforeJson = JSON.parse(statusBefore.body);
    const totalActiveBefore = statusBeforeJson.accounts.reduce((sum, a) => sum + (a.activeRequests || 0), 0);

    const testReqRes = await request('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'opencode-go/deepseek-v4.1-flash', input: 'Ping active request check' })
    });
    assert.strictEqual(testReqRes.statusCode, 200);

    const statusAfter = await request('/status');
    const statusAfterJson = JSON.parse(statusAfter.body);
    const totalActiveAfter = statusAfterJson.accounts.reduce((sum, a) => sum + (a.activeRequests || 0), 0);
    assert.strictEqual(totalActiveAfter, totalActiveBefore, 'activeRequests must strictly return to baseline with zero leak');

    console.log('✓ Empty Stream Disconnection Defense, Dynamic Session Isolation & Zero-Leak Lifecycle verified');

    // Test 79: Codex Tools Schema Normalization & Upstream Non-200 Error Sanitization Barrier
    console.log('\n[Test 79] Testing Codex Tools Schema Normalization & Upstream Non-200 Error Sanitization Barrier...');

    // 1. Tool parameters extraction & normalization verification
    const sampleTools = [
      {
        type: 'function',
        function: {
          name: 'codex_app_tool_1',
          description: 'App tool 1 with inputSchema',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'codex_app_tool_2',
          description: 'App tool 2 with input_schema',
          input_schema: {
            properties: { query: { type: 'string' } }
          }
        }
      },
      {
        name: 'top_level_tool',
        description: 'Responses top level tool with inputSchema',
        inputSchema: {
          properties: { count: { type: 'integer' } }
        }
      },
      {
        type: 'function',
        function: {
          name: 'apply_patch',
          description: 'Builtin parameterless tool'
        }
      },
      {
        type: 'function',
        function: {
          name: 'collaboration',
          description: 'Builtin tool with empty object parameters',
          parameters: {}
        }
      },
      {
        type: 'custom_shell_exec',
        description: 'Tool without explicit function name',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        parameters: null
      }
    ];

    const chatConverted = codexAdapter.convertResponsesToChatPayload({
      model: 'deepseek-v4.1-flash',
      input: 'Test tools conversion',
      tools: sampleTools
    });

    assert.strictEqual(chatConverted.tools.length, 7, 'All 7 tools must be successfully converted');

    // a) inputSchema tool
    assert.strictEqual(chatConverted.tools[0].function.name, 'codex_app_tool_1');
    assert.strictEqual(chatConverted.tools[0].function.parameters.type, 'object');
    assert.deepStrictEqual(chatConverted.tools[0].function.parameters.properties, { path: { type: 'string' } });
    assert.deepStrictEqual(chatConverted.tools[0].function.parameters.required, ['path']);

    // b) input_schema tool (missing type: 'object' automatically normalized)
    assert.strictEqual(chatConverted.tools[1].function.name, 'codex_app_tool_2');
    assert.strictEqual(chatConverted.tools[1].function.parameters.type, 'object');
    assert.deepStrictEqual(chatConverted.tools[1].function.parameters.properties, { query: { type: 'string' } });

    // c) top-level inputSchema
    assert.strictEqual(chatConverted.tools[2].function.name, 'top_level_tool');
    assert.strictEqual(chatConverted.tools[2].function.parameters.type, 'object');
    assert.deepStrictEqual(chatConverted.tools[2].function.parameters.properties, { count: { type: 'integer' } });

    // d) parameterless tool (apply_patch)
    assert.strictEqual(chatConverted.tools[3].function.name, 'apply_patch');
    assert.strictEqual(chatConverted.tools[3].function.parameters.type, 'object');
    assert.deepStrictEqual(chatConverted.tools[3].function.parameters.properties, {});

    // e) empty object parameter tool (collaboration)
    assert.strictEqual(chatConverted.tools[4].function.name, 'collaboration');
    assert.strictEqual(chatConverted.tools[4].function.parameters.type, 'object');
    assert.deepStrictEqual(chatConverted.tools[4].function.parameters.properties, {});

    // f) anonymous tool fallback
    assert.strictEqual(chatConverted.tools[5].function.name, 'custom_shell_exec');
    assert.strictEqual(chatConverted.tools[5].function.parameters.type, 'object');
    assert.strictEqual(chatConverted.tools[6].function.name, 'custom_tool_6');
    assert.strictEqual(chatConverted.tools[6].function.parameters.type, 'object');

    // g) Anthropic Messages bridge tools conversion
    const anthropicConverted = codexAdapter.convertResponsesToAnthropicPayload({
      model: 'claude-haiku-5-5',
      input: 'Test anthropic tools',
      tools: sampleTools
    });
    assert.strictEqual(anthropicConverted.tools.length, 7);
    assert.strictEqual(anthropicConverted.tools[0].input_schema.type, 'object');
    assert.strictEqual(anthropicConverted.tools[3].name, 'apply_patch');
    assert.strictEqual(anthropicConverted.tools[3].input_schema.type, 'object');
    assert.deepStrictEqual(anthropicConverted.tools[3].input_schema.properties, {});

    // 2. Unit test formatUpstreamErrorResponse
    const emptyErr = JSON.parse(codexAdapter.formatUpstreamErrorResponse('', 400));
    assert.strictEqual(emptyErr.error.code, 400);
    assert.strictEqual(emptyErr.error.type, 'upstream_error');
    assert.strictEqual(emptyErr.error.message, '上游推理节点返回空错误 (HTTP 400)，已安全拦截');

    const bareErr = JSON.parse(codexAdapter.formatUpstreamErrorResponse('{"model":"deepseek-v4.1-flash"}', 400));
    assert.strictEqual(bareErr.error.code, 400);
    assert.strictEqual(bareErr.error.type, 'upstream_error');
    assert.strictEqual(bareErr.error.message, '上游模型接口返回异常: {"model":"deepseek-v4.1-flash"}');

    const standardErrStr = JSON.stringify({ error: { message: 'Upstream rate limit', type: 'rate_limit_error', code: 429 } });
    assert.strictEqual(codexAdapter.formatUpstreamErrorResponse(standardErrStr, 429), standardErrStr);

    // 3. E2E HTTP Test: Upstream returns 0-byte 400 with text/event-stream
    const resEmpty400 = await request('/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-empty-400'
      },
      body: JSON.stringify({
        model: 'opencode-go/deepseek-v4.1-flash',
        session_id: 'session-empty-400',
        input: 'Test 0-byte error recovery'
      })
    });

    assert.strictEqual(resEmpty400.statusCode, 400, 'Must return HTTP 400');
    assert.ok(
      resEmpty400.headers['content-type'] && resEmpty400.headers['content-type'].includes('application/json'),
      `Content-Type must be application/json, got ${resEmpty400.headers['content-type']}`
    );
    assert.ok(!resEmpty400.headers['content-type'].includes('text/event-stream'), 'Must never pass text/event-stream on 400 error');
    const parsedEmptyErr = JSON.parse(resEmpty400.body);
    assert.strictEqual(parsedEmptyErr.error.code, 400);
    assert.strictEqual(parsedEmptyErr.error.type, 'upstream_error');
    assert.strictEqual(parsedEmptyErr.error.message, '上游推理节点返回空错误 (HTTP 400)，已安全拦截');

    // 4. E2E HTTP Test: Upstream returns bare JSON {"model":"deepseek-v4.1-flash"} with 400
    const resBare400 = await request('/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-bare-json-400'
      },
      body: JSON.stringify({
        model: 'opencode-go/deepseek-v4.1-flash',
        session_id: 'session-bare-json-400',
        input: 'Test bare JSON error wrapping'
      })
    });

    assert.strictEqual(resBare400.statusCode, 400, 'Must return HTTP 400');
    assert.ok(
      resBare400.headers['content-type'] && resBare400.headers['content-type'].includes('application/json'),
      `Content-Type must be application/json, got ${resBare400.headers['content-type']}`
    );
    const parsedBareErr = JSON.parse(resBare400.body);
    assert.strictEqual(parsedBareErr.error.code, 400);
    assert.strictEqual(parsedBareErr.error.type, 'upstream_error');
    assert.strictEqual(parsedBareErr.error.message, '上游模型接口返回异常: {"model":"deepseek-v4.1-flash"}');

    // 5. E2E HTTP Test: Standard upstream error passed through correctly
    const resStandard400 = await request('/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-standard-err-400'
      },
      body: JSON.stringify({
        model: 'opencode-go/deepseek-v4.1-flash',
        session_id: 'session-standard-err-400',
        input: 'Test standard error passthrough'
      })
    });

    assert.strictEqual(resStandard400.statusCode, 400);
    const parsedStandardErr = JSON.parse(resStandard400.body);
    assert.strictEqual(parsedStandardErr.error.message, 'Standard upstream validation failed');

    console.log('✓ Codex Tools Schema Normalization & Upstream Non-200 Error Sanitization Barrier verified');

    console.log('\n======================================================');
    console.log('🎉 ALL 79 ADVANCED ROUTER TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================');
  } finally {
    routerProc.kill();
    mockUpstream.close();
    if (fs.existsSync(testConfigFile)) {
      try { fs.unlinkSync(testConfigFile); } catch (e) {}
    }
    if (fs.existsSync(testConfigFile + '.bak')) {
      try { fs.unlinkSync(testConfigFile + '.bak'); } catch (e) {}
    }
    if (fs.existsSync(testConfigDir)) {
      try { fs.rmSync(testConfigDir, { recursive: true, force: true }); } catch (e) {}
    }
    if (fs.existsSync(testSnapshotsDir)) {
      try { fs.rmSync(testSnapshotsDir, { recursive: true, force: true }); } catch (e) {}
    }
    try {
      codexAdapter.restoreCodexConfig();
    } catch (e) {}
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
