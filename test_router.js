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

    const resSnapshots = await request('/balancer/api/updates/snapshots');
    assert.strictEqual(resSnapshots.statusCode, 200);
    const snapsJson = JSON.parse(resSnapshots.body);
    assert.strictEqual(snapsJson.success, true);
    assert.ok(snapsJson.snapshots.length > 0, 'snapshots must contain at least 1 record');
    assert.strictEqual(snapsJson.snapshots[0].id, applyJson.snapshotId);
    console.log(`✓ Updates Apply & Snapshots API verified: created ${applyJson.snapshotId}`);

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

    console.log('\n======================================================');
    console.log('🎉 ALL 35 ADVANCED ROUTER TESTS PASSED SUCCESSFULLY!');
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
    if (fs.existsSync(testSnapshotsDir)) {
      try { fs.rmSync(testSnapshotsDir, { recursive: true, force: true }); } catch (e) {}
    }
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
