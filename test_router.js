const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');

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
  let simulate429Triggered = false;

  const mockUpstream = http.createServer((req, res) => {
    mockCallCount++;
    const auth = req.headers['authorization'] || '';
    const session = req.headers['x-opencode-session'] || '';

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
  fs.mkdirSync(testConfigDir, { recursive: true });

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

    console.log('\n======================================================');
    console.log('🎉 ALL 15 ADVANCED ROUTER TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================');
  } finally {
    routerProc.kill();
    mockUpstream.close();
    if (fs.existsSync(testConfigFile)) {
      try { fs.unlinkSync(testConfigFile); } catch (e) {}
    }
    if (fs.existsSync(testConfigDir)) {
      try { fs.rmSync(testConfigDir, { recursive: true, force: true }); } catch (e) {}
    }
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
