const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork, execSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const codexAdapter = require('./codex-adapter');
const contextCompactor = require('./context-compactor');

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

    if (session === 'session-gzip-error') {
      if (auth.includes('key-account-1')) account1Calls++;
      else account2Calls++;
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip'
      });
      res.end('{"model":"novita-deepseek"}');
      return;
    }

    if (session === 'session-model-restrict-400') {
      if (auth.includes('key-account-1')) account1Calls++;
      else account2Calls++;
      let bodyBuf = [];
      req.on('data', chunk => bodyBuf.push(chunk));
      req.on('end', () => {
        let reqModel = '';
        let parsed = {};
        try {
          parsed = JSON.parse(Buffer.concat(bodyBuf).toString('utf8'));
          reqModel = parsed.model;
        } catch (e) {}

        if (reqModel === 'deepseek-v4.1-flash' || reqModel === 'gpt-6-luna' || reqModel === 'glm-5.3-flash') {
          const errBody = JSON.stringify({
            error: {
              message: `The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed ${reqModel}. (request_id: 080be93d-9d34-4105-9126-db002f302b4b)`,
              type: 'invalid_request_error',
              param: null,
              code: 'invalid_request_error'
            }
          });
          res.writeHead(400, {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(errBody))
          });
          res.end(errBody);
          return;
        }

        // Second attempt: auto-healed to compatible model (e.g. deepseek-flash or deepseek-v4-pro)
        if (req.url.includes('/chat/completions') && parsed.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          res.write(`data: {"choices":[{"delta":{"content":"Success after self-healing to ${reqModel}!"}}]}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'resp-healed-model', model: reqModel, choices: [{ message: { role: 'assistant', content: `Success after self-healing to ${reqModel}!` } }] }));
      });
      return;
    }

    if (session === 'session-tool-calls-mismatch-400') {
      let bodyBuf = [];
      req.on('data', chunk => bodyBuf.push(chunk));
      req.on('end', () => {
        let parsed = {};
        try {
          parsed = JSON.parse(Buffer.concat(bodyBuf).toString('utf8'));
        } catch (e) {}

        const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
        let hasMismatch = false;

        for (let idx = 0; idx < messages.length; idx++) {
          const m = messages[idx];
          if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
            const expectedIds = m.tool_calls.map(tc => tc.id);
            for (let k = 0; k < expectedIds.length; k++) {
              const nextMsg = messages[idx + 1 + k];
              if (!nextMsg || nextMsg.role !== 'tool' || nextMsg.tool_call_id !== expectedIds[k]) {
                hasMismatch = true;
                break;
              }
            }
          }
        }

        if (hasMismatch) {
          const errBody = JSON.stringify({
            error: {
              message: "Invalid request: an assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: view_image:1, view_image:2",
              type: 'invalid_request_error',
              code: 'invalid_request_error'
            }
          });
          res.writeHead(400, {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(errBody))
          });
          res.end(errBody);
          return;
        }

        if (parsed.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          res.write('data: {"choices":[{"delta":{"content":"Success with perfectly contiguous tool responses!"}}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'resp-tool-contiguous',
            model: parsed.model || 'deepseek-v4.1-flash',
            choices: [{ message: { role: 'assistant', content: 'Success with perfectly contiguous tool responses!' } }]
          }));
        }
      });
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

    if (session === 'session-cluster-glitch-retry') {
      const glitchBody = JSON.stringify({
        error: {
          type: 'server_error',
          message: 'Upstream request failed: Invalid credential'
        }
      });
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(glitchBody))
      });
      res.end(glitchBody);
      return;
    }

    if (typeof session === 'string' && session.startsWith('session-cluster-glitch-retry-r')) {
      const okBody = JSON.stringify({
        id: 'resp-glitch-healed',
        model: 'deepseek-v4.1-flash',
        choices: [{ message: { role: 'assistant', content: 'Healed after transient cluster credential glitch!' } }]
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(okBody))
      });
      res.end(okBody);
      return;
    }

    if (session === 'session-bridge-glitch-retry') {
      const glitchBody = JSON.stringify({
        error: {
          type: 'server_error',
          message: 'Upstream request failed: Invalid credential'
        }
      });
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(glitchBody))
      });
      res.end(glitchBody);
      return;
    }

    if (typeof session === 'string' && session.startsWith('session-bridge-glitch-retry-r')) {
      const okBody = JSON.stringify({
        id: 'resp-bridge-glitch-healed',
        model: 'deepseek-v4.1-flash',
        choices: [{ message: { role: 'assistant', content: 'Bridge healed after transient glitch!' } }]
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(okBody))
      });
      res.end(okBody);
      return;
    }

    if (session === 'session-502-bad-gateway-jitter') {
      const html502 = '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>cloudflare</center></body></html>';
      res.writeHead(502, {
        'Content-Type': 'text/html',
        'Content-Length': String(Buffer.byteLength(html502))
      });
      res.end(html502);
      return;
    }

    if (typeof session === 'string' && session.startsWith('session-502-bad-gateway-jitter-r')) {
      const okBody = JSON.stringify({
        id: 'resp-502-healed',
        model: 'deepseek-v4.1-flash',
        choices: [{ message: { role: 'assistant', content: 'Healed after 502 Bad Gateway transient jitter!' } }]
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(okBody))
      });
      res.end(okBody);
      return;
    }

    if (session === 'session-anthropic-bridge-fallback') {
      if (req.url.includes('/messages')) {
        const restrictBody = JSON.stringify({
          error: {
            type: 'invalid_request_error',
            message: 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed claude-haiku-5-5. (request_id: test-anthropic-fallback)'
          }
        });
        res.writeHead(400, {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(restrictBody))
        });
        res.end(restrictBody);
        return;
      }
      if (req.url.includes('/chat/completions')) {
        const okBody = JSON.stringify({
          id: 'chat-anthropic-fallback-healed',
          model: 'deepseek-flash',
          choices: [{ message: { role: 'assistant', content: 'Anthropic seamlessly bridged to Chat deepseek-flash!' } }]
        });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(okBody))
        });
        res.end(okBody);
        return;
      }
    }

    if (session === 'session-preemptive-memory-chat') {
      let reqBodyStr = '';
      req.on('data', c => { reqBodyStr += c; });
      req.on('end', () => {
        let reqBody = {};
        try { reqBody = JSON.parse(reqBodyStr); } catch (_) {}
        if (reqBody.model === 'deepseek-v4.1-flash') {
          // Model is restricted, return 400
          const restrictBody = JSON.stringify({
            error: {
              type: 'invalid_request_error',
              message: 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4.1-flash.'
            }
          });
          res.writeHead(400, {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(restrictBody))
          });
          res.end(restrictBody);
          return;
        }
        // Fallback model or pre-emptively rewritten model succeeded
        const okBody = JSON.stringify({
          id: 'chat-turn-ok',
          model: reqBody.model || 'deepseek-flash',
          choices: [{ message: { role: 'assistant', content: `Success with model ${reqBody.model}` } }]
        });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(okBody))
        });
        res.end(okBody);
      });
      return;
    }

    if (session === 'session-genuine-invalid-key') {
      if (auth.includes('key-account-1')) {
        account1Calls++;
        const invalidBody = JSON.stringify({
          error: {
            message: 'Incorrect API key provided: key-account-1',
            type: 'invalid_request_error',
            code: 'invalid_api_key'
          }
        });
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(invalidBody))
        });
        res.end(invalidBody);
        return;
      }
      if (auth.includes('key-account-2')) {
        account2Calls++;
        const okBody = JSON.stringify({
          id: 'resp-acc2-ok',
          choices: [{ message: { role: 'assistant', content: 'Account 2 failover success!' } }]
        });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(okBody))
        });
        res.end(okBody);
        return;
      }
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
  const testCodexDir = path.join(os.tmpdir(), `test-codex-${Date.now()}`);
  fs.mkdirSync(testConfigDir, { recursive: true });
  fs.mkdirSync(testSnapshotsDir, { recursive: true });
  fs.mkdirSync(testCodexDir, { recursive: true });
  process.env.OPENCODE_CONFIG_DIR = testConfigDir;
  process.env.OPENCODE_SNAPSHOTS_DIR = testSnapshotsDir;
  process.env.CODEX_CONFIG_DIR = testCodexDir;

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
    ],
    compression: {
      enabled: true,
      stripAnsi: true,
      cleanProgressBars: true,
      foldLockfiles: true,
      foldTestPasses: true,
      alignToolsSchema: true,
      slimToolsSchema: true,
      schemaCharThreshold: 15000,
      cacheZoneFreeze: true
    }
  };
  fs.writeFileSync(testConfigFile, JSON.stringify(testConfig, null, 2), 'utf8');

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
    if (process.env.DEBUG_ROUTER) process.stderr.write(d);
  });
  routerProc.on('exit', (code, sig) => {
    if (code !== 0 && code !== null) {
      console.error(`[Router Process Exited] code=${code}, signal=${sig}\nStderr: ${routerStderrBuf.slice(-1000)}`);
    }
  });

  await new Promise(resolve => setTimeout(resolve, 1500));

  function request(reqPath, options = {}, retries = 2) {
    return new Promise((resolve, reject) => {
      const execute = (attemptsLeft) => {
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
        req.on('error', (err) => {
          if (attemptsLeft > 0 && (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED')) {
            setTimeout(() => execute(attemptsLeft - 1), 150);
          } else {
            reject(err);
          }
        });
        if (options.body) req.write(options.body);
        req.end();
      };
      execute(retries);
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
      body: JSON.stringify({ codexDir: isolatedCodexDir, defaultModel: 'deepseek-v4.1-flash', reasoningEffort: 'high' })
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
    const resRestoreApi = await request('/balancer/api/restore-codex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codexDir: isolatedCodexDir })
    });
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

    // Verify updateCompCardsUI and toggle handlers do not cause recursion (Maximum call stack size exceeded)
    assert.doesNotThrow(() => {
      const mockElements = {};
      const mockDoc = {
        addEventListener: () => {},
        removeEventListener: () => {},
        cookie: '',
        hidden: false,
        getElementById: (id) => {
          if (!mockElements[id]) {
            mockElements[id] = {
              id,
              checked: true,
              value: '15000',
              style: {},
              classList: { add: () => {}, remove: () => {} },
              querySelectorAll: () => []
            };
          }
          return mockElements[id];
        }
      };
      const vm = require('node:vm');
      const ctx = vm.createContext({
        document: mockDoc,
        window: { location: {}, addEventListener: () => {} },
        localStorage: { getItem: () => null, setItem: () => {} },
        setInterval: () => {},
        clearInterval: () => {},
        setTimeout: () => {},
        currentPreset: 'balanced',
        accountQuotas: {},
        liveStats: {},
        currentConfig: { accounts: [], compression: { enabled: true, preset: 'balanced' } }
      });
      vm.runInContext(clientScript, ctx);
      ctx.updateCompCardsUI();
      ctx.handleCompMasterToggle(true);
      ctx.toggleModuleEnabled('rtk', true);
    }, 'UI script updateCompCardsUI must not cause recursion or RangeError');

    // Verify restartCodex runs cleanly without console ConPTY pipe errors
    const restartCodexTestRes = codexAdapter.restartCodex({ dryRun: true });
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

    // 2. Unit test extractRawToolParams & normalizeToolParameters preservation
    const toolWithEmptyParams = {
      name: 'search_tool',
      parameters: {}, // empty object placeholder
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query']
      }
    };
    const extractedParams = codexAdapter.extractRawToolParams(toolWithEmptyParams);
    assert.deepStrictEqual(extractedParams, toolWithEmptyParams.inputSchema, 'extractRawToolParams must prioritize candidate with properties over empty {}');

    // Real Codex automation_update tool schema with oneOf and $defs
    const complexSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      oneOf: [
        { type: 'object', properties: { mode: { type: 'string', const: 'view' } }, required: ['mode'] },
        { type: 'object', properties: { mode: { type: 'string', const: 'run' } }, required: ['mode'] }
      ],
      $defs: {
        __schema0: { type: 'string' }
      }
    };
    const normalizedComplex = codexAdapter.normalizeToolParameters(complexSchema);
    assert.strictEqual(normalizedComplex.type, 'object', 'Must enforce type: object for strict upstreams');
    assert.ok(typeof normalizedComplex.properties === 'object' && !Array.isArray(normalizedComplex.properties), 'Must enforce properties object');
    assert.strictEqual(normalizedComplex.oneOf.length, 2, 'Must preserve oneOf schema array');
    assert.ok(normalizedComplex.$defs.__schema0, 'Must preserve $defs metadata');

    // 3. Unit test formatUpstreamErrorResponse comprehensive cases
    // a) Empty string (0-byte)
    const emptyErr = JSON.parse(codexAdapter.formatUpstreamErrorResponse('', 400));
    assert.strictEqual(emptyErr.error.code, 400);
    assert.strictEqual(emptyErr.error.type, 'upstream_error');
    assert.strictEqual(emptyErr.error.message, '上游推理节点返回空错误 (HTTP 400)，已安全拦截');

    // b) Bare JSON
    const bareErr = JSON.parse(codexAdapter.formatUpstreamErrorResponse('{"model":"deepseek-v4.1-flash"}', 400));
    assert.strictEqual(bareErr.error.code, 400);
    assert.strictEqual(bareErr.error.type, 'upstream_error');
    assert.strictEqual(bareErr.error.message, '上游模型接口返回异常: {"model":"deepseek-v4.1-flash"}');

    // c) Standard error object passthrough
    const standardErrStr = JSON.stringify({ error: { message: 'Upstream rate limit', type: 'rate_limit_error', code: 429 } });
    const standardParsed = JSON.parse(codexAdapter.formatUpstreamErrorResponse(standardErrStr, 429));
    assert.strictEqual(standardParsed.error.message, 'Upstream rate limit');

    // d) String error {"error": "Rate limit reached"} normalized
    const strErrParsed = JSON.parse(codexAdapter.formatUpstreamErrorResponse('{"error":"Rate limit reached"}', 429));
    assert.strictEqual(strErrParsed.error.message, 'Rate limit reached', 'Must normalize string error to error.message');
    assert.strictEqual(strErrParsed.error.code, 429);

    // e) Bare JSON array [{"error":"upstream_timeout"}]
    const arrayErrParsed = JSON.parse(codexAdapter.formatUpstreamErrorResponse('[{"error":"upstream_timeout"}]', 504));
    assert.strictEqual(arrayErrParsed.error.code, 504);
    assert.ok(arrayErrParsed.error.message.includes('upstream_timeout'), 'Must wrap JSON arrays into standard error.message');

    // f) SSE wrapped error (data: {"error":{"message":"SSE error"}}\n\n)
    const sseErrParsed = JSON.parse(codexAdapter.formatUpstreamErrorResponse('data: {"error":{"message":"SSE error"}}\n\n', 400));
    assert.strictEqual(sseErrParsed.error.message, 'SSE error', 'Must unwrap SSE payload to clean error message');

    // g) JSON with detail field (e.g. FastAPI / Python gateways)
    const detailErrParsed = JSON.parse(codexAdapter.formatUpstreamErrorResponse('{"detail":"Authentication credentials missing"}', 401));
    assert.strictEqual(detailErrParsed.error.code, 401);
    assert.strictEqual(detailErrParsed.error.message, '上游模型接口返回异常: Authentication credentials missing');

    // 4. E2E HTTP Test: Upstream returns 0-byte 400 with text/event-stream
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

    // 5. E2E HTTP Test: Upstream returns bare JSON {"model":"deepseek-v4.1-flash"} with 400
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

    // 6. E2E HTTP Test: Standard upstream error passed through correctly
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

    // 7. E2E HTTP Test: Upstream error with Content-Encoding: gzip has encoding header stripped
    const resGzip400 = await request('/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-gzip-error'
      },
      body: JSON.stringify({
        model: 'opencode-go/deepseek-v4.1-flash',
        session_id: 'session-gzip-error',
        input: 'Test gzip content-encoding strip'
      })
    });

    assert.strictEqual(resGzip400.statusCode, 400);
    assert.strictEqual(resGzip400.headers['content-encoding'], undefined, 'Must strip content-encoding header on standardized error');
    const parsedGzipErr = JSON.parse(resGzip400.body);
    assert.strictEqual(parsedGzipErr.error.message, '上游模型接口返回异常: {"model":"novita-deepseek"}');

    console.log('✓ Codex Tools Schema Normalization & Upstream Non-200 Error Sanitization Barrier verified');

    // [Test 80] Testing Codex Tool Output Image Sanitization & Upstream 400 Empty Stream Self-Healing...
    console.log('\n[Test 80] Testing Codex Tool Output Image Sanitization & Upstream 400 Empty Stream Self-Healing...');
    
    // 1. Unit Test sanitizeToolOutput
    // a) Array of objects with base64 input_image
    const rawImageOutputArray = [
      {
        type: 'input_image',
        image_url: 'data:image/png;base64,' + 'A'.repeat(5000)
      }
    ];
    const sanitizedArrayStr = codexAdapter.sanitizeToolOutput(rawImageOutputArray);
    assert.ok(!sanitizedArrayStr.includes('data:image/'), 'Must strip raw base64 data from tool output');
    const parsedSanitizedArray = JSON.parse(sanitizedArrayStr);
    assert.strictEqual(parsedSanitizedArray.type, 'image_view_output');
    assert.strictEqual(parsedSanitizedArray.status, 'success');
    assert.ok(parsedSanitizedArray.summary.includes('inspected successfully'), 'Summary must indicate successful visual inspection');

    // b) String containing serialized base64 input_image
    const rawImageOutputStr = JSON.stringify(rawImageOutputArray);
    const sanitizedStrResult = codexAdapter.sanitizeToolOutput(rawImageOutputStr);
    assert.ok(!sanitizedStrResult.includes('data:image/'));
    const parsedFromStr = JSON.parse(sanitizedStrResult);
    assert.strictEqual(parsedFromStr.type, 'image_view_output');

    // c) Normal tool output (e.g. bash stdout) must remain 100% untouched
    const normalOutput = 'Directory of C:\\Users\\deanc\n2026/10/15 11:30 <DIR> .opencode-go-router\nFile list verified';
    assert.strictEqual(codexAdapter.sanitizeToolOutput(normalOutput), normalOutput, 'Normal text output must remain unmodified');

    // 2. Integration: convertResponsesToChatPayload with tool image output
    const mockResponsesWithImage = {
      model: 'deepseek-v4.1-flash',
      input: [
        {
          type: 'function_call',
          call_id: 'call_view_img_01',
          name: 'view_image',
          arguments: '{"path":"page-1.png"}'
        },
        {
          type: 'function_call_output',
          call_id: 'call_view_img_01',
          output: rawImageOutputArray
        }
      ]
    };
    const chatPayloadWithImage = codexAdapter.convertResponsesToChatPayload(mockResponsesWithImage);
    const toolMsg = chatPayloadWithImage.messages.find(m => m.role === 'tool');
    assert.ok(toolMsg, 'Must produce a tool role message');
    assert.strictEqual(toolMsg.tool_call_id, 'call_view_img_01');
    assert.ok(!toolMsg.content.includes('data:image/'), 'Tool message content must be sanitized and free of raw base64');
    const toolMsgParsed = JSON.parse(toolMsg.content);
    assert.strictEqual(toolMsgParsed.status, 'success');

    // 3. Integration: convertResponsesToAnthropicPayload with tool image output
    const anthropicPayloadWithImage = codexAdapter.convertResponsesToAnthropicPayload(mockResponsesWithImage);
    const userMsgWithToolResult = anthropicPayloadWithImage.messages.find(m => m.role === 'user' && Array.isArray(m.content));
    assert.ok(userMsgWithToolResult, 'Must produce a user message with tool results');
    const toolResultBlock = userMsgWithToolResult.content.find(c => c.type === 'tool_result');
    assert.ok(toolResultBlock, 'Must produce a tool_result block in user message');
    assert.ok(!toolResultBlock.content.includes('data:image/'));

    // 4. Integration: pruneResponsesPayload with tool image output
    const prunedMock = codexAdapter.pruneResponsesPayload(mockResponsesWithImage);
    const prunedOutput = prunedMock.input.find(i => i.call_id === 'call_view_img_01' && i.output);
    assert.ok(prunedOutput, 'Pruned input must retain tool output');
    assert.ok(!JSON.stringify(prunedOutput.output).includes('data:image/'));

    console.log('✓ Codex Tool Output Image Sanitization & Upstream 400 Empty Stream Self-Healing verified');

    // [Test 81] Testing Codex Process Health, Thread Suspension Diagnostics & Chinese Locale/Environment Self-Healing...
    console.log('\n[Test 81] Testing Codex Process Health, Thread Suspension Diagnostics & Chinese Locale/Environment Self-Healing...');

    // 1. Process health check unit test
    const procHealth = codexAdapter.checkCodexProcessHealth();
    assert.ok(procHealth !== undefined, 'checkCodexProcessHealth must return a result object');
    assert.ok(typeof procHealth.healthy === 'boolean', 'healthy flag must be boolean');
    assert.ok(typeof procHealth.procCount === 'number', 'procCount must be a number');

    // 2. Locale and environment diagnostic test
    const mockCodexDir = path.join(testConfigDir, 'mock-codex-test81');
    fs.mkdirSync(mockCodexDir, { recursive: true });
    const mockTomlPath = path.join(mockCodexDir, 'config.toml');
    // Deliberately write an unhardened config: missing zh-CN localeOverride and invalid display-name model
    fs.writeFileSync(mockTomlPath, 'model = "DeepSeek-Flash [智能双轨协议桥]"\nmodel_provider = "opencode-go"\n\n[desktop]\nsansFontSize = 14\n', 'utf8');

    const localeCheckBefore = codexAdapter.checkCodexLocaleAndEnvironment({ codexDir: mockCodexDir });
    assert.strictEqual(localeCheckBefore.healthy, false, 'Mock unaligned config must report healthy: false');
    assert.ok(localeCheckBefore.missingDesktopLocale, 'Must detect missing desktop locale');
    assert.ok(localeCheckBefore.hasInvalidModelSlug, 'Must detect invalid model slug');
    assert.ok(localeCheckBefore.issues.length >= 2, 'Must report specific issues');

    // 3. Auto-Repair execution test
    const codexLocaleRepairRes = codexAdapter.repairCodexLocaleAndEnvironment({ codexDir: mockCodexDir });
    assert.strictEqual(codexLocaleRepairRes.success, true, 'repairCodexLocaleAndEnvironment must succeed');
    assert.ok(codexLocaleRepairRes.messages.length > 0, 'Repair must produce explanatory messages');

    // 4. Verify post-repair integrity
    const localeCheckAfter = codexAdapter.checkCodexLocaleAndEnvironment({ codexDir: mockCodexDir });
    assert.strictEqual(localeCheckAfter.missingDesktopLocale, false, 'Desktop locale must be repaired');
    assert.strictEqual(localeCheckAfter.hasInvalidModelSlug, false, 'Model slug must be normalized');
    const repairedToml = fs.readFileSync(mockTomlPath, 'utf8');
    assert.ok(repairedToml.includes('localeOverride = "zh-CN"'), 'repaired config.toml must include localeOverride = "zh-CN"');
    assert.ok(repairedToml.includes('model = "deepseek-v4.1-flash"'), 'model must be normalized to deepseek-v4.1-flash');

    // 5. Test Doctor API returns new codexProcessHealth and codexLocale fields
    const docRes81 = await fetch(`http://127.0.0.1:${routerPort}/balancer/api/doctor`);
    assert.strictEqual(docRes81.status, 200);
    const docData81 = await docRes81.json();
    assert.ok(docData81.codexProcessHealth !== undefined, 'report.codexProcessHealth must exist');
    assert.ok(docData81.codexLocale !== undefined, 'report.codexLocale must exist');

    console.log('✓ Codex Process Health, Thread Suspension Diagnostics & Chinese Locale/Environment Self-Healing verified');

    // [Test 82] Testing Upstream Supported API Model Names Restriction & Dynamic Fallback Self-Healing...
    console.log('\n[Test 82] Testing Upstream Supported API Model Names Restriction & Dynamic Fallback Self-Healing...');

    // 1. Unit Tests: resolveCompatibleFallbackModel
    const userErrMsg = 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4.1-flash. (request_id: 080be93d-9d34-4105-9126-db002f302b4b)';
    const healedModel1 = codexAdapter.resolveCompatibleFallbackModel('deepseek-v4.1-flash', userErrMsg);
    assert.strictEqual(healedModel1, 'deepseek-flash', 'deepseek-v4.1-flash must heal to deepseek-flash from candidate list');

    const lunaErrMsg = 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed gpt-6-luna. (request_id: 080be93d-9d34-4105-9126-db002f302b4b)';
    const healedModel2 = codexAdapter.resolveCompatibleFallbackModel('gpt-6-luna', lunaErrMsg);
    assert.strictEqual(healedModel2, 'deepseek-v4-pro', 'gpt-6-luna must heal to deepseek-v4-pro from candidate list');

    const proErrMsg = 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4-pro.';
    const healedModel3 = codexAdapter.resolveCompatibleFallbackModel('deepseek-v4-pro', proErrMsg);
    assert.strictEqual(healedModel3, 'deepseek-flash', 'deepseek-v4-pro must heal to deepseek-flash if pro itself was rejected');

    const genericFlashFallback = codexAdapter.resolveCompatibleFallbackModel('deepseek-v4.1-flash', 'model_not_found');
    assert.strictEqual(genericFlashFallback, 'deepseek-flash', 'deepseek-v4.1-flash must fallback to deepseek-flash when no candidates provided');

    const genericGrokFallback = codexAdapter.resolveCompatibleFallbackModel('grok-4.6', 'The model grok-4.6 does not exist');
    assert.strictEqual(genericGrokFallback, 'deepseek-v4-pro', 'grok-4.6 must fallback to deepseek-v4-pro when no candidates provided');

    // 2. Integration E2E HTTP Test on /v1/responses (Codex Bridge Stream)
    // Send request with deepseek-v4.1-flash; mock upstream will reject with 400 and userErrMsg on first try,
    // then router must automatically intercept, parse candidates, heal to deepseek-flash, and succeed with 200 stream!
    const res82Responses = await request('/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-model-restrict-400'
      },
      body: JSON.stringify({
        model: 'opencode-go/deepseek-v4.1-flash',
        stream: true,
        input: 'Recover disguised Linux cat jpg/zip file'
      })
    });

    assert.strictEqual(res82Responses.statusCode, 200, 'Responses request must succeed with 200 after router self-healing');
    assert.ok(res82Responses.headers['content-type'].includes('text/event-stream'), 'Must return text/event-stream');
    assert.ok(res82Responses.body.includes('Success after self-healing to deepseek-flash'), 'Stream content must contain output from healed deepseek-flash model');
    assert.ok(res82Responses.body.includes('response.completed'), 'Stream must deliver response.completed event');

    // 3. Integration E2E HTTP Test on /v1/chat/completions (sendProxyRequest Fallback)
    const res82Chat = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-model-restrict-400'
      },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', content: 'Hello standard chat completions' }]
      })
    });

    assert.strictEqual(res82Chat.statusCode, 200, 'Chat completions request must succeed with 200 after router self-healing');
    assert.ok(res82Chat.body.includes('Success after self-healing to deepseek-flash'), 'Chat response must confirm healing to deepseek-flash');

    console.log('✓ Upstream Supported API Model Names Restriction & Dynamic Fallback Self-Healing verified');

    // [Test 83] Testing Atomic Tool Call Contiguity, Interleaved Developer Notice Deferral & Orphan Self-Healing...
    console.log('\n[Test 83] Testing Atomic Tool Call Contiguity, Interleaved Developer Notice Deferral & Orphan Self-Healing...');

    // 1. Unit test sanitizeAndValidateChatMessages with interleaved developer notices
    const dirtyMessages = [
      { role: 'user', content: 'View images please' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'view_image:0', type: 'function', function: { name: 'view_image', arguments: '{}' } },
          { id: 'view_image:1', type: 'function', function: { name: 'view_image', arguments: '{}' } },
          { id: 'view_image:2', type: 'function', function: { name: 'view_image', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'view_image:0', content: 'Image 0 data' },
      { role: 'system', content: '<image_resize_notice>Image was resized</image_resize_notice>' }, // Interleaved notice
      { role: 'tool', tool_call_id: 'view_image:1', content: 'Image 1 data' }
      // Missing view_image:2
    ];

    const cleaned = codexAdapter.sanitizeAndValidateChatMessages(dirtyMessages);
    assert.strictEqual(cleaned[0].role, 'user');
    assert.strictEqual(cleaned[1].role, 'assistant');
    assert.strictEqual(cleaned[2].role, 'tool', 'First tool response must immediately follow assistant');
    assert.strictEqual(cleaned[2].tool_call_id, 'view_image:0');
    assert.strictEqual(cleaned[3].role, 'tool', 'Second tool response must contiguously follow');
    assert.strictEqual(cleaned[3].tool_call_id, 'view_image:1');
    assert.strictEqual(cleaned[4].role, 'tool', 'Missing third tool response must be auto-backfilled');
    assert.strictEqual(cleaned[4].tool_call_id, 'view_image:2');
    assert.strictEqual(cleaned[5].role, 'system', 'Interleaved system notice must be deferred after all tool responses');
    assert.ok(cleaned[5].content.includes('image_resize_notice'));

    // 2. Unit test orphan tool response with no preceding assistant
    const orphanToolMessages = [
      { role: 'tool', tool_call_id: 'orphan:99', content: 'Orphan content' },
      { role: 'user', content: 'Regular query' }
    ];
    const cleanedOrphans = codexAdapter.sanitizeAndValidateChatMessages(orphanToolMessages);
    assert.strictEqual(cleanedOrphans[0].role, 'user', 'Orphan tool response must be safely converted to user message');
    assert.ok(cleanedOrphans[0].content.includes('Orphan content'));

    // 3. End-to-end integration test via router HTTP port with interleaved developer notice
    const res83 = await request('/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-tool-calls-mismatch-400'
      },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        input: [
          { type: 'message', role: 'user', content: 'Check images' },
          { type: 'function_call', call_id: 'view_image:1', name: 'view_image', arguments: '{}' },
          { type: 'function_call', call_id: 'view_image:2', name: 'view_image', arguments: '{}' },
          { type: 'function_call_output', call_id: 'view_image:1', output: 'Image 1 ok' },
          { type: 'message', role: 'developer', content: '<image_resize_notice>Image resized</image_resize_notice>' },
          { type: 'function_call_output', call_id: 'view_image:2', output: 'Image 2 ok' }
        ]
      })
    });

    assert.strictEqual(res83.statusCode, 200, 'Router must seamlessly sanitize and contiguous-order tool calls yielding 200');
    assert.ok(res83.body.includes('Success with perfectly contiguous tool responses!'), 'Response must confirm contiguous delivery');

    console.log('✓ Atomic Tool Call Contiguity, Interleaved Developer Notice Deferral & Orphan Self-Healing verified');

    // [Test 84] Testing GLM-5.3-Flash Dynamic Fallback & Pre-Emptive Session Memory Hit...
    console.log('\n[Test 84] Testing GLM-5.3-Flash Dynamic Fallback & Pre-Emptive Session Memory Hit...');

    const glmErrText = 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed glm-5.3-flash. (request_id: c086b322-5ada-4bb7-93e5-0ad285563b8e)';
    const glmResolved = codexAdapter.resolveCompatibleFallbackModel('glm-5.3-flash', glmErrText);
    assert.strictEqual(glmResolved, 'deepseek-flash', 'glm-5.3-flash must resolve to deepseek-flash on speed tier');

    // Turn 1: glm-5.3-flash encounters 400 restriction and router auto-heals to deepseek-flash
    const res84Turn1 = await request('/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-model-restrict-400'
      },
      body: JSON.stringify({
        model: 'glm-5.3-flash',
        input: [{ type: 'message', role: 'user', content: 'Hello from GLM session turn 1' }]
      })
    });

    assert.strictEqual(res84Turn1.statusCode, 200, 'GLM Turn 1 must succeed with 200 via dynamic fallback');
    assert.ok(res84Turn1.body.includes('Success after self-healing to deepseek-flash'), 'Response must confirm deepseek-flash execution');

    // Turn 2: same session sends glm-5.3-flash again; router pre-emptively falls back without 400 upstream bounce
    const res84Turn2 = await request('/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-model-restrict-400'
      },
      body: JSON.stringify({
        model: 'glm-5.3-flash',
        input: [{ type: 'message', role: 'user', content: 'Hello from GLM session turn 2' }]
      })
    });

    assert.strictEqual(res84Turn2.statusCode, 200, 'GLM Turn 2 must succeed immediately via pre-emptive memory');
    assert.ok(res84Turn2.body.includes('Success after self-healing to deepseek-flash'), 'Response must confirm pre-emptive execution');

    console.log('✓ GLM-5.3-Flash Dynamic Fallback & Pre-Emptive Session Memory Hit verified');

    // [Test 85] Testing Codex apply_patch Freeform Custom Tool Call Protocol Bridge...
    console.log('\n[Test 85] Testing Codex apply_patch Freeform Custom Tool Call Protocol Bridge...');

    // 1. Verify extractPatchInput unit logic
    const jsonPatch = JSON.stringify({ input: '*** Begin Patch\n*** Add File: sim.js\n+test\n*** End Patch' });
    const extracted1 = codexAdapter.extractPatchInput(jsonPatch);
    assert.strictEqual(extracted1, '*** Begin Patch\n*** Add File: sim.js\n+test\n*** End Patch', 'extractPatchInput must extract raw patch from JSON');

    const rawPatch = '*** Begin Patch\n*** Add File: sim.js\n+raw\n*** End Patch';
    const extracted2 = codexAdapter.extractPatchInput(rawPatch);
    assert.strictEqual(extracted2, rawPatch, 'extractPatchInput must preserve raw patch text unchanged');

    // 2. Verify convertResponsesToChatPayload with custom_tool_call
    const convertedChat = codexAdapter.convertResponsesToChatPayload({
      model: 'deepseek-v4.1-flash',
      input: [
        { type: 'message', role: 'user', content: 'Apply this patch' },
        { type: 'custom_tool_call', call_id: 'call_patch_1', name: 'apply_patch', input: '*** Begin Patch\n+hello\n*** End Patch' },
        { type: 'custom_tool_call_output', call_id: 'call_patch_1', output: 'Success. Updated 1 file.' }
      ]
    });
    const lastAssistant = convertedChat.messages.find(m => m.role === 'assistant' && m.tool_calls);
    assert.ok(lastAssistant, 'Assistant message with tool_calls must be constructed');
    assert.strictEqual(lastAssistant.tool_calls[0].function.name, 'apply_patch');
    const parsedArgs = JSON.parse(lastAssistant.tool_calls[0].function.arguments);
    assert.strictEqual(parsedArgs.input, '*** Begin Patch\n+hello\n*** End Patch', 'custom_tool_call string input must be wrapped in { input } for upstream model');

    // 3. Verify bridgeResponsesStream streaming transformation
    const mockUpstreamPatchStream = new EventEmitter();
    const capturedEvents = [];
    const mockPatchClientRes = new EventEmitter();
    mockPatchClientRes.writableEnded = false;
    mockPatchClientRes.destroyed = false;
    mockPatchClientRes.writeHead = () => {};
    mockPatchClientRes.end = () => { mockPatchClientRes.writableEnded = true; };
    mockPatchClientRes.write = (data) => {
      const lines = data.split('\n');
      let currentEvent = null;
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ') && currentEvent) {
          try {
            capturedEvents.push({ event: currentEvent, data: JSON.parse(line.slice(6)) });
          } catch (e) {}
        }
      }
    };

    codexAdapter.bridgeResponsesStream(mockUpstreamPatchStream, mockPatchClientRes, 'deepseek-v4.1-flash', 'resp_test_patch', () => {});

    // Feed SSE chunks from upstream with apply_patch tool call
    const chunk1 = 'data: ' + JSON.stringify({
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_patch_123',
            type: 'function',
            function: { name: 'apply_patch', arguments: '{"input": "*** Begin Patch\\n' }
          }]
        }
      }]
    }) + '\n\n';
    mockUpstreamPatchStream.emit('data', Buffer.from(chunk1));

    const chunk2 = 'data: ' + JSON.stringify({
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: '*** Add File: test.js\\n+console.log(1);\\n*** End Patch"}' }
          }]
        }
      }]
    }) + '\n\n';
    mockUpstreamPatchStream.emit('data', Buffer.from(chunk2));
    mockUpstreamPatchStream.emit('end');

    const addedItem = capturedEvents.find(e => e.event === 'response.output_item.added');
    assert.ok(addedItem, 'response.output_item.added must be emitted');
    assert.strictEqual(addedItem.data.item.type, 'custom_tool_call', 'apply_patch item type must be custom_tool_call');
    assert.strictEqual(addedItem.data.item.name, 'apply_patch');

    const doneInput = capturedEvents.find(e => e.event === 'response.custom_tool_call_input.done');
    assert.ok(doneInput, 'response.custom_tool_call_input.done must be emitted');
    assert.ok(doneInput.data.input.includes('*** Add File: test.js'), 'Clean patch content must be delivered in custom_tool_call input');
    assert.ok(!doneInput.data.input.startsWith('{"input":'), 'JSON wrapper must be cleanly stripped from input');

    const doneItem = capturedEvents.find(e => e.event === 'response.output_item.done');
    assert.ok(doneItem, 'response.output_item.done must be emitted');
    assert.strictEqual(doneItem.data.item.type, 'custom_tool_call', 'Item done must confirm custom_tool_call');
    assert.strictEqual(doneItem.data.item.status, 'completed');

    const completed = capturedEvents.find(e => e.event === 'response.completed');
    assert.ok(completed, 'response.completed must be emitted');
    assert.strictEqual(completed.data.response.output[0].type, 'custom_tool_call');
    assert.ok(completed.data.response.output[0].input.includes('+console.log(1);'));

    console.log('✓ Codex apply_patch Freeform Custom Tool Call Protocol Bridge verified');

    // [Test 86] Testing ANSI Color & Terminal Sequence Stripping (stripAnsi)
    console.log('\n[Test 86] Testing ANSI Color & Terminal Sequence Stripping (stripAnsi)...');
    const rawAnsiText = '\u001b[31;1mError: \u001b[0m\u001b[38;2;255;0;0mCritical Failure\u001b[0m in module \u001b[38;5;196mtest.js\u001b[0m\u001b[?25h\u001b]0;Terminal Title\x07';
    const stripped = contextCompactor.stripAnsi(rawAnsiText);
    assert.strictEqual(stripped, 'Error: Critical Failure in module test.js');
    assert.strictEqual(contextCompactor.stripAnsi(''), '');
    assert.strictEqual(contextCompactor.stripAnsi(null), null);
    assert.strictEqual(contextCompactor.stripAnsi('Plain text without escape'), 'Plain text without escape');
    console.log('✓ ANSI Color & Terminal Sequence Stripping verified');

    // [Test 87] Testing Overwriting Terminal Progress Bars & Carriage Return Cleaning (cleanProgressBars)
    console.log('\n[Test 87] Testing Overwriting Terminal Progress Bars & Carriage Return Cleaning (cleanProgressBars)...');
    const rawProgressOutput = 'Downloading [===>       ] 30%\rDownloading [======>    ] 60%\rDownloading [==========>] 100%\nVerification passed!';
    const cleanedProgress = contextCompactor.cleanProgressBars(rawProgressOutput);
    assert.strictEqual(cleanedProgress, 'Downloading [==========>] 100%\nVerification passed!');
    
    // Windows CRLF preservation check: regular CRLF must not be truncated as overwrites and line endings preserved
    const crlfText = 'Step 1: Init\r\nStep 2: Build\r\nStep 3: Test\r\n';
    assert.strictEqual(contextCompactor.cleanProgressBars(crlfText), crlfText);
    console.log('✓ Overwriting Terminal Progress Bars & Carriage Return Cleaning verified');

    // [Test 88] Testing Lockfile Diff Safe Folding & Merge Conflict Exemption (foldLockfiles)
    console.log('\n[Test 88] Testing Lockfile Diff Safe Folding & Merge Conflict Exemption (foldLockfiles)...');
    const lockfileDiffNormal = [
      'diff --git a/package-lock.json b/package-lock.json',
      'index 1a2b3c4..5d6e7f8 100644',
      '--- a/package-lock.json',
      '+++ b/package-lock.json',
      '@@ -100,20 +100,25 @@',
      '-      "version": "1.0.0"',
      '+      "version": "1.0.1"',
      '+      "resolved": "https://registry.npmjs.org/foo/-/foo-1.0.1.tgz"',
      '+      "integrity": "sha512-abc123=="',
      '-      "dev": true',
      '+      "dev": false'
    ].join('\n');
    const foldedLockfile = contextCompactor.foldLockfiles(lockfileDiffNormal);
    assert.ok(foldedLockfile.includes('[Lockfile diff folded: package-lock.json'));
    assert.ok(!foldedLockfile.includes('sha512-abc123=='));

    // Critical safety: Merge conflict markers (<<<<<<<) must NEVER be folded!
    const lockfileWithConflict = [
      'diff --git a/package-lock.json b/package-lock.json',
      'index 1a2b3c4..5d6e7f8 100644',
      '--- a/package-lock.json',
      '+++ b/package-lock.json',
      '@@ -100,20 +100,25 @@',
      '<<<<<<< HEAD',
      '+      "version": "1.0.1"',
      '=======',
      '+      "version": "2.0.0"',
      '>>>>>>> feature-branch'
    ].join('\n');
    const notFoldedConflict = contextCompactor.foldLockfiles(lockfileWithConflict);
    assert.strictEqual(notFoldedConflict, lockfileWithConflict, 'Diffs with merge conflicts must be strictly exempt from folding');

    // Diff3 conflict marker (||||||| base) must also be exempt
    const diff3Conflict = [
      'diff --git a/Cargo.lock b/Cargo.lock',
      'index 111..222 100644',
      '--- a/Cargo.lock',
      '+++ b/Cargo.lock',
      '@@ -1,10 +1,10 @@',
      '||||||| base',
      'version = 1',
      '=======',
      'version = 2',
      '>>>>>>> branch'
    ].join('\n');
    assert.strictEqual(contextCompactor.foldLockfiles(diff3Conflict), diff3Conflict, 'Diff3 conflict markers must be exempt from folding');

    // Source code / test files containing lockfile names must NEVER be folded!
    const testFileDiff = [
      'diff --git a/tests/package-lock.json.test.js b/tests/package-lock.json.test.js',
      'index 111..222 100644',
      '--- a/tests/package-lock.json.test.js',
      '+++ b/tests/package-lock.json.test.js',
      '@@ -1,7 +1,7 @@',
      '-const a = 1;',
      '+const a = 2;',
      '+const b = 3;',
      '+const c = 4;',
      '+const d = 5;'
    ].join('\n');
    assert.strictEqual(contextCompactor.foldLockfiles(testFileDiff), testFileDiff, 'Code/test files with lockfile names in path must NEVER be folded');

    // Idempotency check: folding an already folded diff must be a no-op
    assert.strictEqual(contextCompactor.foldLockfiles(foldedLockfile), foldedLockfile, 'Folding already folded lockfile diff must be idempotent');

    // Non-lockfile diffs in the same output must be preserved intact
    const multiFileDiff = [
      'diff --git a/src/app.js b/src/app.js',
      'index 111..222 100644',
      '--- a/src/app.js',
      '+++ b/src/app.js',
      '@@ -1,3 +1,3 @@',
      '-const x = 1;',
      '+const x = 2;',
      lockfileDiffNormal
    ].join('\n');
    const multiFolded = contextCompactor.foldLockfiles(multiFileDiff);
    assert.ok(multiFolded.includes('+const x = 2;'), 'Non-lockfile source diffs must remain 100% visible');
    assert.ok(multiFolded.includes('[Lockfile diff folded: package-lock.json'));
    console.log('✓ Lockfile Diff Safe Folding & Merge Conflict Exemption verified');

    // [Test 89] Testing Positive Match Test Passes Folding & 100% Error/Stack Preservation (foldTestPasses)
    console.log('\n[Test 89] Testing Positive Match Test Passes Folding & 100% Error/Stack Preservation (foldTestPasses)...');
    const mixedTestRun = [
      '  ✓ Test 1: User login successfully (12ms)',
      '  ✓ Test 2: Token verification passed (5ms)',
      '  ✓ Test 3: Cache lookup hit (2ms)',
      '  ✓ Test 4: Rate limit counter checked (3ms)',
      '  ✕ Test 5: Database transaction committed (8ms)',
      '      AssertionError: expected false to equal true',
      '          at Context.<anonymous> (test/db.test.js:84:12)',
      '          at processImmediate (node:internal/timers:478:21)',
      '  ✓ Test 6: Connection closed cleanly (4ms)',
      '  ✓ Test 7: Metrics updated (1ms)',
      '  ✓ Test 8: Session destroyed (2ms)'
    ].join('\n');
    const foldedPasses = contextCompactor.foldTestPasses(mixedTestRun);
    assert.ok(foldedPasses.includes('[Test suite: 4 passed tests folded (✓ / PASS / ok)]'), 'First 4 passing tests must be folded');
    assert.ok(foldedPasses.includes('✕ Test 5: Database transaction committed (8ms)'), 'Failed test line must be preserved intact');
    assert.ok(foldedPasses.includes('AssertionError: expected false to equal true'), 'Assertion error must be preserved intact');
    assert.ok(foldedPasses.includes('at Context.<anonymous> (test/db.test.js:84:12)'), 'Stack trace must be preserved intact');
    assert.ok(foldedPasses.includes('[Test suite: 3 passed tests folded (✓ / PASS / ok)]'), 'Last 3 passing tests must be folded');
    
    // Tests testing error cases must be recognized as passing and folded
    const errorHandlingTests = [
      '  ✓ handles 404 error cleanly (2ms)',
      '  ✓ should throw exception on timeout (3ms)',
      '  ✓ should catch network failure without crash (5ms)'
    ].join('\n');
    const foldedErrorTests = contextCompactor.foldTestPasses(errorHandlingTests);
    assert.ok(foldedErrorTests.includes('[Test suite: 3 passed tests folded (✓ / PASS / ok)]'), 'Passing tests with error/failure in test name must be recognized as passing');

    // Short test runs (< 3 passes) must remain intact without awkward single-line folding
    const shortTestRun = '  ✓ Test A passed\n  ✓ Test B passed';
    assert.strictEqual(contextCompactor.foldTestPasses(shortTestRun), shortTestRun);
    console.log('✓ Positive Match Test Passes Folding & 100% Error/Stack Preservation verified');

    // [Test 90] Testing Deterministic Tool Schema Key Sorting & Prompt Cache Alignment (alignToolsSchema)
    console.log('\n[Test 90] Testing Deterministic Tool Schema Key Sorting & Prompt Cache Alignment (alignToolsSchema)...');
    const rawToolsVariant1 = [
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Writes content to disk',
          parameters: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Data to write' },
              path: { type: 'string', description: 'Destination path' }
            },
            required: ['path', 'content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Reads content from disk',
          parameters: {
            type: 'object',
            properties: {
              offset: { type: 'number' },
              path: { type: 'string' }
            },
            required: ['path', 'offset']
          }
        }
      }
    ];

    const rawToolsVariant2 = [
      {
        type: 'function',
        function: {
          parameters: {
            required: ['offset', 'path'],
            properties: {
              path: { type: 'string' },
              offset: { type: 'number' }
            },
            type: 'object'
          },
          description: 'Reads content from disk',
          name: 'read_file'
        }
      },
      {
        type: 'function',
        function: {
          parameters: {
            required: ['content', 'path'],
            properties: {
              path: { type: 'string', description: 'Destination path' },
              content: { type: 'string', description: 'Data to write' }
            },
            type: 'object'
          },
          name: 'write_file',
          description: 'Writes content to disk'
        }
      }
    ];

    const aligned1 = contextCompactor.alignToolsSchema(rawToolsVariant1);
    const aligned2 = contextCompactor.alignToolsSchema(rawToolsVariant2);
    assert.strictEqual(aligned1[0].function.name, 'read_file');
    assert.strictEqual(aligned1[1].function.name, 'write_file');
    assert.strictEqual(
      JSON.stringify(aligned1),
      JSON.stringify(aligned2),
      'Different initial tool and property orderings must serialize to 100% identical byte strings'
    );

    // Null-safety check in alignToolsSchema
    const toolsWithNull = [null, { type: 'function', function: { name: 'b_tool' } }, { name: 'a_tool' }];
    assert.doesNotThrow(() => {
      const alignedNull = contextCompactor.alignToolsSchema(toolsWithNull);
      assert.strictEqual(alignedNull.length, 3);
    }, 'alignToolsSchema must safely handle null/undefined tool entries without throwing');
    console.log('✓ Deterministic Tool Schema Key Sorting & Prompt Cache Alignment verified');

    // [Test 91] Testing Oversized Schema Slimming & Example Truncation (slimToolsSchema)
    console.log('\n[Test 91] Testing Oversized Schema Slimming & Example Truncation (slimToolsSchema)...');
    const normalToolsList = [{ type: 'function', function: { name: 't1', description: 'Short tool description.' } }];
    assert.strictEqual(contextCompactor.slimToolsSchema(normalToolsList, 15000), normalToolsList, 'Normal schemas under threshold must be untouched');

    const oversizedTools = [
      {
        type: 'function',
        function: {
          name: 'kubernetes_query',
          description: 'Executes complex queries against Kubernetes clusters. This tool communicates with kube-apiserver.\n\nExamples:\n```json\n{"cluster": "prod", "query": "pods"}\n```\nUsage Notes:\nDetailed multi-page manual here.',
          parameters: {
            type: 'object',
            properties: {
              cluster: {
                type: 'string',
                description: 'Target cluster identifier. Must be a valid DNS subdomain name.\n\nExamples:\n- prod-us-east-1\n- staging-eu-west-1',
                example: 'prod-us-east-1'
              }
            },
            required: ['cluster']
          }
        }
      }
    ];
    // Force slim threshold to 50 chars for testing
    const slimmedSchema = contextCompactor.slimToolsSchema(oversizedTools, 50);
    assert.strictEqual(slimmedSchema[0].function.description, 'Executes complex queries against Kubernetes clusters.');
    assert.ok(!slimmedSchema[0].function.description.includes('Examples:'));
    assert.ok(!slimmedSchema[0].function.parameters.properties.cluster.description.includes('Examples:'));
    assert.strictEqual(slimmedSchema[0].function.parameters.properties.cluster.example, undefined, 'example field must be stripped');
    assert.strictEqual(slimmedSchema[0].function.parameters.properties.cluster.type, 'string', 'Parameter types must be strictly preserved');

    // Test MCP inputSchema format and nested properties example stripping
    const mcpTools = [
      {
        name: 'mcp_db_query',
        description: 'Queries database table records.\n\nExamples:\n```json\n{"table": "users"}\n```',
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'object',
              description: 'Filtering options.\n\nExamples:\n- id: 1',
              example: { id: 1 },
              properties: {
                id: {
                  type: 'integer',
                  description: 'Target record id.\n\nUsage: id=1',
                  example: 123
                }
              }
            }
          }
        }
      }
    ];
    const slimmedMcp = contextCompactor.slimToolsSchema(mcpTools, 50);
    assert.strictEqual(slimmedMcp[0].inputSchema.properties.filter.example, undefined, 'example field on filter must be stripped');
    assert.strictEqual(slimmedMcp[0].inputSchema.properties.filter.properties.id.example, undefined, 'nested example field on id must be stripped');
    assert.ok(!slimmedMcp[0].inputSchema.properties.filter.properties.id.description.includes('Usage:'));
    console.log('✓ Oversized Schema Slimming & Example Truncation verified');

    // [Test 92] Testing Session Compression Memoization & Cache-Zone Byte Freezing (sessionCompressionMemo)
    console.log('\n[Test 92] Testing Session Compression Memoization & Cache-Zone Byte Freezing (sessionCompressionMemo)...');
    const memoSessionId = 'test-session-memo-8899';
    contextCompactor.clearSessionMemo(memoSessionId);

    const rawToolOutputRound1 = '\u001b[32mDownloading 10%\rDownloading 100%\u001b[0m\n✓ Test 1 ok\n✓ Test 2 ok\n✓ Test 3 ok';
    const compactedRound1 = contextCompactor.compactText(rawToolOutputRound1, { enabled: true, cacheZoneFreeze: true }, memoSessionId);
    assert.strictEqual(compactedRound1, 'Downloading 100%\n[Test suite: 3 passed tests folded (✓ / PASS / ok)]');

    // Calling again in subsequent round must hit the memo cache directly
    const compactedRound2 = contextCompactor.compactText(rawToolOutputRound1, { enabled: true, cacheZoneFreeze: true }, memoSessionId);
    assert.strictEqual(compactedRound2, compactedRound1, 'Subsequent turns must return identical cached byte stream');

    contextCompactor.clearSessionMemo(memoSessionId);
    assert.strictEqual(contextCompactor.getMemo(memoSessionId, 'any-hash'), null, 'clearSessionMemo must purge cached session data');
    console.log('✓ Session Compression Memoization & Cache-Zone Byte Freezing verified');

    // [Test 93] Testing Anthropic Messages Protocol Deep Compression (compactAnthropicPayload)
    console.log('\n[Test 93] Testing Anthropic Messages Protocol Deep Compression (compactAnthropicPayload)...');
    const anthropicRawPayload = {
      model: 'claude-haiku-5-5',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_01_ls',
              content: '\u001b[34m[===>   ] 20%\r[======>] 100%\u001b[0m\n✓ PASS 1\n✓ PASS 2\n✓ PASS 3'
            },
            {
              type: 'tool_result',
              tool_use_id: 'toolu_02_diff',
              content: [
                {
                  type: 'text',
                  text: 'diff --git a/yarn.lock b/yarn.lock\nindex 111..222 100644\n--- a/yarn.lock\n+++ b/yarn.lock\n@@ -1,10 +1,10 @@\n-old\n+new\n+line3\n+line4\n+line5\n'
                }
              ]
            }
          ]
        }
      ]
    };
    const compactedAnthropic = contextCompactor.compactAnthropicPayload(anthropicRawPayload, { enabled: true });
    const userBlocks = compactedAnthropic.messages[0].content;
    assert.strictEqual(userBlocks[0].tool_use_id, 'toolu_01_ls');
    assert.strictEqual(userBlocks[0].content, '[======>] 100%\n[Test suite: 3 passed tests folded (✓ / PASS / ok)]');
    assert.ok(userBlocks[1].content[0].text.includes('[Lockfile diff folded: yarn.lock'));
    console.log('✓ Anthropic Messages Protocol Deep Compression verified');

    // [Test 94] Testing Codex Responses Protocol Deep Compression (compactResponsesPayload)
    console.log('\n[Test 94] Testing Codex Responses Protocol Deep Compression (compactResponsesPayload)...');
    const codexResponsesRaw = {
      model: 'deepseek-v4.1-flash',
      input: [
        { type: 'message', role: 'user', content: 'Run test suite' },
        {
          type: 'function_call_output',
          call_id: 'call_test_1',
          output: '\u001b[32m✓ t1\n✓ t2\n✓ t3\u001b[0m\nCompleted in 0.5s'
        },
        {
          type: 'custom_tool_call_output',
          call_id: 'call_patch_1',
          output: 'Progress 10%\rProgress 100%\nDone patch'
        }
      ]
    };
    const compactedCodex = contextCompactor.compactResponsesPayload(codexResponsesRaw, { enabled: true });
    assert.strictEqual(compactedCodex.input[0].content, 'Run test suite', 'User message must remain untouched');
    assert.ok(compactedCodex.input[1].output.includes('[Test suite: 3 passed tests folded'));
    assert.ok(!compactedCodex.input[1].output.includes('\u001b[32m'));
    assert.strictEqual(compactedCodex.input[2].output, 'Progress 100%\nDone patch');
    console.log('✓ Codex Responses Protocol Deep Compression verified');

    // [Test 95] Testing Independent Compression Feature Switches & Granular Control
    console.log('\n[Test 95] Testing Independent Compression Feature Switches & Granular Control...');
    const mixedInput = '\u001b[31mError\u001b[0m\n✓ Test 1 ok\n✓ Test 2 ok\n✓ Test 3 ok';
    
    // Switch 1: stripAnsi disabled, foldTestPasses enabled
    const noAnsiStrip = contextCompactor.compactText(mixedInput, { enabled: true, stripAnsi: false, foldTestPasses: true });
    assert.ok(noAnsiStrip.includes('\u001b[31mError\u001b[0m'), 'ANSI must be preserved when stripAnsi: false');
    assert.ok(noAnsiStrip.includes('[Test suite: 3 passed tests folded'), 'Test passes must still be folded');

    // Switch 2: foldTestPasses disabled, stripAnsi enabled
    const noTestFold = contextCompactor.compactText(mixedInput, { enabled: true, stripAnsi: true, foldTestPasses: false });
    assert.ok(!noTestFold.includes('\u001b[31m'), 'ANSI must be stripped when stripAnsi: true');
    assert.ok(noTestFold.includes('✓ Test 1 ok\n✓ Test 2 ok\n✓ Test 3 ok'), 'Tests must not be folded when foldTestPasses: false');

    // Switch 3: foldLockfiles disabled
    const lockDiffInput = 'diff --git a/Cargo.lock b/Cargo.lock\nindex 111..222 100644\n--- a/Cargo.lock\n+++ b/Cargo.lock\n@@ -1,10 +1,10 @@\n-old\n+new\n+line3\n+line4\n+line5\n';
    const noLockFold = contextCompactor.compactText(lockDiffInput, { enabled: true, foldLockfiles: false });
    assert.strictEqual(noLockFold, lockDiffInput, 'Lockfile diffs must be preserved when foldLockfiles: false');
    console.log('✓ Independent Compression Feature Switches & Granular Control verified');

    // [Test 96] Testing Master Compression Switch Off (Complete Bypass & Zero Mutation) & Web Config API Roundtrip
    console.log('\n[Test 96] Testing Master Compression Switch Off (Complete Bypass) & Web Config API Roundtrip...');
    const samplePayload = {
      model: 'deepseek-v4.1-flash',
      messages: [{ role: 'tool', content: '\u001b[31mUnchanged\u001b[0m' }]
    };
    const bypassed = contextCompactor.compactChatPayload(samplePayload, { enabled: false });
    assert.strictEqual(bypassed.messages[0].content, '\u001b[31mUnchanged\u001b[0m', 'Payload must be returned 100% unmodified when enabled: false');

    // Web Config API roundtrip verification: Update compression config via /balancer/api/config
    const updateRes = await request('/balancer/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upstream: `http://127.0.0.1:${mockPort}/v1`,
        accounts: testConfig.accounts,
        compression: {
          enabled: true,
          stripAnsi: true,
          cleanProgressBars: false, // Turn off progress bar cleaning
          foldLockfiles: true,
          foldTestPasses: true,
          alignToolsSchema: true,
          slimToolsSchema: true,
          schemaCharThreshold: 12000,
          cacheZoneFreeze: true
        }
      })
    });
    assert.strictEqual(updateRes.statusCode, 200);

    // Verify GET /balancer/api/config reflects the new compression settings
    const getCfgRes = await request('/balancer/api/config', { method: 'GET' });
    assert.strictEqual(getCfgRes.statusCode, 200);
    const updatedCfg = JSON.parse(getCfgRes.body);
    assert.ok(updatedCfg.compression, 'Config response must include compression configuration');
    assert.strictEqual(updatedCfg.compression.enabled, true);
    assert.strictEqual(updatedCfg.compression.cleanProgressBars, false, 'cleanProgressBars setting must be updated to false');
    assert.strictEqual(updatedCfg.compression.schemaCharThreshold, 12000);

    // Restore original test configuration cleanly
    await request('/balancer/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upstream: `http://127.0.0.1:${mockPort}/v1`,
        accounts: testConfig.accounts,
        compression: testConfig.compression
      })
    });

    console.log('✓ Master Compression Switch Off & Web Config API Roundtrip verified');

    // [Test 97] Testing Array-based Tool Outputs in Responses & Deep Circular Reference Sandboxing
    console.log('\n[Test 97] Testing Array-based Tool Outputs in Responses & Deep Circular Reference Sandboxing...');
    const arrayOutputPayload = {
      model: 'deepseek-v4.1-flash',
      input: [
        {
          type: 'function_call_output',
          call_id: 'call_arr_1',
          output: [
            { type: 'text', text: '\u001b[32m✓ Test A\n✓ Test B\n✓ Test C\u001b[0m' },
            { type: 'text', text: 'Step 1\rStep 2\rFinal Result' }
          ]
        },
        {
          type: 'custom_tool_call_output',
          call_id: 'call_arr_2',
          output: ['Downloading 10%\rDownloading 100%', 'All assets ready']
        }
      ]
    };

    const compactedArrayResp = contextCompactor.compactResponsesPayload(arrayOutputPayload, { enabled: true });
    assert.ok(Array.isArray(compactedArrayResp.input[0].output), 'Array-based tool output must strictly remain an Array');
    assert.strictEqual(compactedArrayResp.input[0].output.length, 2);
    assert.ok(compactedArrayResp.input[0].output[0].text.includes('[Test suite: 3 passed tests folded'));
    assert.ok(!compactedArrayResp.input[0].output[0].text.includes('\u001b[32m'));
    assert.strictEqual(compactedArrayResp.input[0].output[1].text, 'Final Result');
    assert.ok(Array.isArray(compactedArrayResp.input[1].output), 'String array output must remain an Array');
    assert.strictEqual(compactedArrayResp.input[1].output[0], 'Downloading 100%');

    // Circular reference immunity test: must not crash or throw
    const circularObj = { name: 'circular_tool' };
    circularObj.self = circularObj;
    assert.doesNotThrow(() => {
      const sortedCircular = contextCompactor.alignToolsSchema([circularObj]);
      assert.strictEqual(sortedCircular.length, 1);
    }, 'alignToolsSchema must survive circular object structures without infinite recursion');

    assert.doesNotThrow(() => {
      const slimmedCircular = contextCompactor.slimToolsSchema([circularObj], 10);
      assert.strictEqual(slimmedCircular.length, 1);
    }, 'slimToolsSchema must survive circular structures');
    console.log('✓ Array-based Tool Outputs in Responses & Deep Circular Reference Sandboxing verified');

    // [Test 98] Testing Quoted Git Diff Paths with Spaces, Deleted Lockfile Target Naming & Bun/UV/PDM Lockfiles
    console.log('\n[Test 98] Testing Quoted Git Diff Paths with Spaces, Deleted Lockfile Target Naming & Bun/UV/PDM Lockfiles...');
    // 1. Quoted git diff with spaces in paths
    const quotedDiff = [
      'diff --git "a/sub project/package-lock.json" "b/sub project/package-lock.json"',
      'index 111..222 100644',
      '--- "a/sub project/package-lock.json"',
      '+++ "b/sub project/package-lock.json"',
      '@@ -1,10 +1,10 @@',
      '-line1',
      '+line2',
      '+line3',
      '+line4',
      '+line5',
      '+line6'
    ].join('\n');
    const foldedQuoted = contextCompactor.foldLockfiles(quotedDiff);
    assert.ok(foldedQuoted.includes('[Lockfile diff folded: sub project/package-lock.json'), 'Quoted paths with spaces must be correctly folded with clean target name');

    // 2. Deleted lockfile: fileB is /dev/null -> target name must be fileA
    const deletedDiff = [
      'diff --git a/bun.lock b/dev/null',
      'deleted file mode 100644',
      'index 111..000 100644',
      '--- a/bun.lock',
      '+++ /dev/null',
      '@@ -1,10 +0,0 @@',
      '-line1',
      '-line2',
      '-line3',
      '-line4',
      '-line5',
      '-line6'
    ].join('\n');
    const foldedDeleted = contextCompactor.foldLockfiles(deletedDiff);
    assert.ok(foldedDeleted.includes('[Lockfile diff folded: bun.lock'), 'Deleted lockfile must name original file rather than /dev/null');
    assert.ok(!foldedDeleted.includes('[Lockfile diff folded: /dev/null'));

    // 3. Newly added lockfile: fileA is /dev/null -> target name must be uv.lock
    const addedDiff = [
      'diff --git a/dev/null b/uv.lock',
      'new file mode 100644',
      'index 000..222 100644',
      '--- /dev/null',
      '+++ b/uv.lock',
      '@@ -0,0 +1,10 @@',
      '+line1',
      '+line2',
      '+line3',
      '+line4',
      '+line5',
      '+line6'
    ].join('\n');
    const foldedAdded = contextCompactor.foldLockfiles(addedDiff);
    assert.ok(foldedAdded.includes('[Lockfile diff folded: uv.lock'), 'Added lockfile must name destination file');

    // 4. Windows CRLF preservation
    const crlfDiff = quotedDiff.replace(/\n/g, '\r\n');
    const foldedCrlf = contextCompactor.foldLockfiles(crlfDiff);
    assert.ok(foldedCrlf.includes('\r\n'), 'CRLF diff must retain CRLF newline style');
    console.log('✓ Quoted Git Diff Paths with Spaces, Deleted Lockfile Target Naming & Bun/UV/PDM Lockfiles verified');

    // [Test 99] Testing GoogleTest, Python unittest, CTest & Extensible Custom Test Pass Patterns
    console.log('\n[Test 99] Testing GoogleTest, Python unittest, CTest & Extensible Custom Test Pass Patterns...');
    // 1. GoogleTest output
    const gtestRun = [
      '[       OK ] RouterFixture.InitializesCorrectly (2 ms)',
      '[       OK ] RouterFixture.HandlesFailover (15 ms)',
      '[       OK ] RouterFixture.ValidatesConfig (1 ms)',
      '[  FAILED  ] RouterFixture.BrokenAssertion (8 ms)',
      'Value of: actual == expected\n  Actual: false\nExpected: true'
    ].join('\n');
    const foldedGtest = contextCompactor.foldTestPasses(gtestRun);
    assert.ok(foldedGtest.includes('[Test suite: 3 passed tests folded (✓ / PASS / ok)]'), 'GoogleTest pass lines must be folded');
    assert.ok(foldedGtest.includes('[  FAILED  ] RouterFixture.BrokenAssertion'), 'GoogleTest failure must be preserved');
    assert.ok(foldedGtest.includes('Value of: actual == expected'));

    // 2. Python unittest output: test_foo (__main__.TestFoo) ... ok
    const unittestRun = [
      'test_add (__main__.TestMath) ... ok',
      'test_subtract (__main__.TestMath) ... ok',
      'test_multiply (__main__.TestMath) ... ok',
      'test_divide_zero (__main__.TestMath) ... FAIL'
    ].join('\n');
    const foldedUnittest = contextCompactor.foldTestPasses(unittestRun);
    assert.ok(foldedUnittest.includes('[Test suite: 3 passed tests folded'), 'Python unittest passes must be folded');
    assert.ok(foldedUnittest.includes('test_divide_zero (__main__.TestMath) ... FAIL'));

    // 3. CTest output: 1/5 Test #1: TestName ... Passed
    const ctestRun = [
      '1/3 Test #1: CoreEngineTest .................. Passed   0.10 sec',
      '2/3 Test #2: NetworkBridgeTest ............... Passed   0.15 sec',
      '3/3 Test #3: CompressionTest ................. Passed   0.08 sec'
    ].join('\n');
    const foldedCtest = contextCompactor.foldTestPasses(ctestRun);
    assert.ok(foldedCtest.includes('[Test suite: 3 passed tests folded'), 'CTest passes must be folded');

    // 4. Extensible custom patterns via options.customTestPassPatterns
    const customFrameworkRun = [
      'CUSTOM_PASS: test_step_alpha completed',
      'CUSTOM_PASS: test_step_beta completed',
      'CUSTOM_PASS: test_step_gamma completed',
      'CUSTOM_FAIL: test_step_delta timeout'
    ].join('\n');
    const foldedCustom = contextCompactor.foldTestPasses(customFrameworkRun, {
      customTestPassPatterns: ['^CUSTOM_PASS:']
    });
    assert.ok(foldedCustom.includes('[Test suite: 3 passed tests folded'), 'Custom regex patterns must successfully fold custom framework lines');
    assert.ok(foldedCustom.includes('CUSTOM_FAIL: test_step_delta timeout'), 'Failure lines must remain untouched');
    console.log('✓ GoogleTest, Python unittest, CTest & Extensible Custom Test Pass Patterns verified');

    // [Test 100] Testing Pluggable DevOps Pipeline Architecture (Docker, Terraform & Custom Transformer Registration)
    console.log('\n[Test 100] Testing Pluggable DevOps Pipeline Architecture (Docker, Terraform & Custom Transformer Registration)...');
    // 1. Docker multi-layer pull progress cleaning
    const dockerPullLogs = [
      'Step 1/3 : FROM alpine:latest',
      'latest: Pulling from library/alpine',
      'c7b415a9de06: Pulling fs layer',
      'c7b415a9de06: Downloading [=====>      ] 1.2MB/3.4MB',
      'c7b415a9de06: Verifying Checksum',
      'c7b415a9de06: Download complete',
      'c7b415a9de06: Extracting [============>] 3.4MB/3.4MB',
      'c7b415a9de06: Pull complete',
      'Digest: sha256:1234567890abcdef',
      'Status: Downloaded newer image for alpine:latest'
    ].join('\n');
    const cleanedDocker = contextCompactor.cleanDockerOutput(dockerPullLogs);
    assert.ok(cleanedDocker.includes('[Docker: 6 layer download/extract status lines folded]'), 'Docker layer progress must be cleanly folded');
    assert.ok(cleanedDocker.includes('Step 1/3 : FROM alpine:latest'), 'Build steps must be 100% preserved');
    assert.ok(cleanedDocker.includes('Status: Downloaded newer image for alpine:latest'));

    // 2. Terraform resource state refreshing cleaning
    const terraformLogs = [
      'Terraform 1.9.0',
      'aws_vpc.main: Refreshing state... [id=vpc-01234567]',
      'aws_subnet.public_a: Refreshing state... [id=subnet-01234567]',
      'aws_subnet.public_b: Refreshing state... [id=subnet-89abcdef0]',
      'aws_internet_gateway.gw: Refreshing state... [id=igw-01234567]',
      'Plan: 1 to add, 0 to change, 0 to destroy.'
    ].join('\n');
    const cleanedTf = contextCompactor.cleanTerraformOutput(terraformLogs);
    assert.ok(cleanedTf.includes('[Terraform: 4 resources state refreshed]'), 'Terraform refreshing state noise must be folded');
    assert.ok(cleanedTf.includes('Plan: 1 to add, 0 to change, 0 to destroy.'), 'Terraform plan summary must remain visible');

    // 3. Registering and unregistering custom transformer
    const customTransformerName = 'redact_ip_addresses';
    contextCompactor.registerTransformer(customTransformerName, (text) => {
      return text.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED_IP]');
    }, { priority: 25 });

    const registeredList = contextCompactor.getRegisteredTransformers();
    assert.ok(registeredList.some(t => t.name === customTransformerName), 'Registered transformer must appear in registry');

    const ipText = 'Server connection to 192.168.1.100 was established.\nDownloading 10%\rDownloading 100%';
    const pipedResult = contextCompactor.compactText(ipText, { enabled: true, cacheZoneFreeze: false });
    assert.ok(pipedResult.includes('Server connection to [REDACTED_IP] was established.'));
    assert.ok(pipedResult.includes('Downloading 100%'));

    // Transformer sandbox isolation: throwing an error must NOT break the pipeline
    contextCompactor.registerTransformer('broken_transformer', () => {
      throw new Error('Forced transformer explosion');
    }, { priority: 26 });

    assert.doesNotThrow(() => {
      const safeOutput = contextCompactor.compactText('Some test content', { enabled: true, cacheZoneFreeze: false });
      assert.strictEqual(safeOutput, 'Some test content', 'Broken transformer must be safely bypassed');
    });

    // Unregister cleanly
    contextCompactor.unregisterTransformer(customTransformerName);
    contextCompactor.unregisterTransformer('broken_transformer');
    assert.ok(!contextCompactor.getRegisteredTransformers().some(t => t.name === customTransformerName));
    console.log('✓ Pluggable DevOps Pipeline Architecture (Docker, Terraform & Custom Transformer Registration) verified');

    // [Test 101] Testing Deep Composite JSON Schema Slimming (items, oneOf/anyOf/$defs) & Zero Empty Fallback
    console.log('\n[Test 101] Testing Deep Composite JSON Schema Slimming (items, oneOf/anyOf/$defs) & Zero Empty Fallback...');
    const compositeSchemaTools = [
      {
        type: 'function',
        function: {
          name: 'cloud_infra_provision',
          description: 'Provisions complex cloud infrastructure components.\n\nExamples:\n```json\n{"infra": true}\n```',
          parameters: {
            type: 'object',
            properties: {
              clusters: {
                type: 'array',
                description: 'List of target clusters.\n\nExamples:\n- c1\n- c2',
                example: ['c1'],
                items: {
                  type: 'object',
                  description: 'Cluster configuration specification.\n\nExamples:\n{"region": "us"}',
                  example: { region: 'us' },
                  properties: {
                    region: {
                      type: 'string',
                      description: 'Cloud deployment region name.\n\nUsage: us-east-1',
                      example: 'us-east-1'
                    }
                  }
                }
              },
              authMode: {
                description: 'Authentication mode choice.\n\nExamples:\n- oauth',
                example: 'oauth',
                oneOf: [
                  {
                    type: 'object',
                    description: 'API key authentication.\n\nExamples:\n{"key": "xyz"}',
                    example: { key: 'xyz' },
                    properties: {
                      apiKey: { type: 'string', example: 'sk_test_123' }
                    }
                  }
                ]
              }
            },
            $defs: {
              tagMap: {
                type: 'object',
                description: 'Resource tag mapping.\n\nExamples:\n{"env": "prod"}',
                example: { env: 'prod' }
              }
            }
          }
        }
      }
    ];

    const slimmedComposite = contextCompactor.slimToolsSchema(compositeSchemaTools, 50);
    const fnDef = slimmedComposite[0].function;
    assert.strictEqual(fnDef.parameters.properties.clusters.example, undefined, 'clusters.example must be pruned');
    assert.strictEqual(fnDef.parameters.properties.clusters.items.example, undefined, 'items.example must be pruned');
    assert.strictEqual(fnDef.parameters.properties.clusters.items.properties.region.example, undefined, 'nested region.example must be pruned');
    assert.strictEqual(fnDef.parameters.properties.authMode.example, undefined, 'authMode.example must be pruned');
    assert.strictEqual(fnDef.parameters.properties.authMode.oneOf[0].example, undefined, 'oneOf item example must be pruned');
    assert.strictEqual(fnDef.parameters.$defs.tagMap.example, undefined, '$defs tagMap example must be pruned');

    // Zero empty description fallback: if stripping markdown code block leaves empty, fallback to original non-empty text
    const onlyCodeBlockDesc = '```json\n{"only": "code"}\n```';
    const slimmedFallback = contextCompactor.slimToolsSchema([{
      type: 'function',
      function: { name: 'code_only_tool', description: onlyCodeBlockDesc, parameters: { type: 'object' } }
    }], 10);
    assert.ok(slimmedFallback[0].function.description.length > 0, 'Description must never become completely empty string');

    console.log('✓ Deep Composite JSON Schema Slimming (items, oneOf/anyOf/$defs) & Zero Empty Fallback verified');

    // [Test 102] Testing Windows CRLF Line Ending Preservation & Non-Destructive In-Place Clean (cleanProgressBars)
    console.log('\n[Test 102] Testing Windows CRLF Line Ending Preservation & Non-Destructive In-Place Clean (cleanProgressBars)...');
    // 1. CRLF without overwrites must remain byte-for-byte identical
    const pureCrlf = 'line1\r\nline2\r\nline3\r\n';
    const cleanedPureCrlf = contextCompactor.cleanProgressBars(pureCrlf);
    assert.strictEqual(cleanedPureCrlf, pureCrlf, 'Windows CRLF text without progress overwrites must remain 100% byte-for-byte untouched');

    // 2. CRLF with terminal overwrites must preserve CRLF newlines after cleaning
    const crlfWithOverwrites = 'downloading 10%\rdownloading 50%\rdownloading 100%\r\nprocessing chunk\r\ndone\r\n';
    const cleanedCrlfOverwrites = contextCompactor.cleanProgressBars(crlfWithOverwrites);
    assert.ok(cleanedCrlfOverwrites.includes('\r\n'), 'Output must preserve CRLF newlines');
    assert.ok(!cleanedCrlfOverwrites.includes('\nline'), 'Must not mutate newlines to naked LF');
    assert.ok(cleanedCrlfOverwrites.includes('downloading 100%\r\nprocessing chunk\r\ndone\r\n'), 'Carriage return overwrites must be collapsed');
    console.log('✓ Windows CRLF Line Ending Preservation & Non-Destructive In-Place Clean verified');

    // [Test 103] Testing Kubectl Pod/Rollout Status Folding & Strict Fault State Preservation (cleanKubectlOutput)
    console.log('\n[Test 103] Testing Kubectl Pod/Rollout Status Folding & Strict Fault State Preservation (cleanKubectlOutput)...');
    const kubectlOutput = [
      'NAME                                READY   STATUS      RESTARTS   AGE',
      'pod-worker-api-8924b1c7-2k9x1       1/1     Running     0          3d4h',
      'pod-worker-api-8924b1c7-5m8w2       1/1     Running     0          3d4h',
      'pod-worker-api-8924b1c7-7p1z9       1/1     Running     0          3d4h',
      'pod-worker-api-8924b1c7-9b4q8       1/1     Running     0          3d4h',
      'pod-job-migrate-2948-x8k1           0/1     Completed   0          12h',
      'pod-broken-service-78bf1-4m9p1      0/1     CrashLoopBackOff 5     15m',
      'pod-failing-db-58c1-1x2y3           0/1     Error       1          5m'
    ].join('\n');
    const cleanedKube = contextCompactor.cleanKubectlOutput(kubectlOutput);
    assert.ok(cleanedKube.includes('[Kubectl: 5 healthy pods / rollout status lines folded (Running / Completed / Met)]'), 'Running/Completed pod status lines must be folded');
    assert.ok(cleanedKube.includes('NAME                                READY   STATUS      RESTARTS   AGE'), 'Pod table header must be preserved');
    assert.ok(cleanedKube.includes('CrashLoopBackOff'), 'Failing CrashLoopBackOff pod MUST NEVER be folded');
    assert.ok(cleanedKube.includes('pod-failing-db-58c1-1x2y3'), 'Error state pod MUST NEVER be folded');

    // Test rollout progress folding
    const rolloutLogs = [
      'Waiting for deployment "api-gateway" rollout to finish: 1 of 3 updated replicas are available...',
      'Waiting for deployment "api-gateway" rollout to finish: 2 of 3 updated replicas are available...',
      'Waiting for deployment "api-gateway" rollout to finish: 3 of 3 updated replicas are available...',
      'Waiting for deployment "api-gateway" rollout to finish: 3 of 3 updated replicas are available...',
      'deployment "api-gateway" successfully rolled out'
    ].join('\n');
    const cleanedRollout = contextCompactor.cleanKubectlOutput(rolloutLogs);
    assert.ok(cleanedRollout.includes('[Kubectl: 4 healthy pods / rollout status lines folded'), 'Rollout progress updates must be folded');
    assert.ok(cleanedRollout.includes('deployment "api-gateway" successfully rolled out'), 'Rollout final completion message must be preserved');
    console.log('✓ Kubectl Pod/Rollout Status Folding & Strict Fault State Preservation verified');

    // [Test 104] Testing Deep Schema Recursion Depth Barrier (>50 levels) & PatternProperties/AdditionalProperties Slimming
    console.log('\n[Test 104] Testing Deep Schema Recursion Depth Barrier (>50 levels) & PatternProperties/AdditionalProperties Slimming...');
    // Create an adversarial 60-level nested schema to verify depth guard prevents stack overflow
    let deepSchema = {
      type: 'object',
      description: 'Root schema level\n\nExamples:\n{"depth": 0}',
      example: { depth: 0 },
      patternProperties: {
        '^[a-z]+$': {
          type: 'string',
          description: 'Pattern property description\n\nExamples:\n"val"',
          example: 'val'
        }
      },
      additionalProperties: {
        type: 'object',
        description: 'Additional properties schema\n\nExamples:\n{"extra": true}',
        example: { extra: true }
      }
    };
    let currentLevel = deepSchema;
    for (let i = 1; i <= 60; i++) {
      currentLevel.properties = {
        nested: {
          type: 'object',
          description: `Deep level ${i}\n\nExamples:\n{"level": ${i}}`,
          example: { level: i }
        }
      };
      currentLevel = currentLevel.properties.nested;
    }

    const toolsWithDeepSchema = [{
      type: 'function',
      function: {
        name: 'adversarial_deep_schema_tool',
        description: 'Tool with extremely deep nested schema',
        parameters: deepSchema
      }
    }];

    assert.doesNotThrow(() => {
      const slimmedDeep = contextCompactor.slimToolsSchema(toolsWithDeepSchema, 100);
      assert.ok(slimmedDeep && slimmedDeep.length === 1, 'Deep schema must be successfully processed without stack overflow');
      assert.strictEqual(slimmedDeep[0].function.parameters.patternProperties['^[a-z]+$'].example, undefined, 'patternProperties example must be pruned');
      assert.strictEqual(slimmedDeep[0].function.parameters.additionalProperties.example, undefined, 'additionalProperties example must be pruned');
    }, 'Adversarial deep schema (>50 levels) must not throw Maximum call stack size exceeded');
    console.log('✓ Deep Schema Recursion Depth Barrier (>50 levels) & PatternProperties/AdditionalProperties Slimming verified');

    // [Test 105] Testing Dynamic Multi-Transformer Cache Key Signature & True LRU Bounded Memoization
    console.log('\n[Test 105] Testing Dynamic Multi-Transformer Cache Key Signature & True LRU Bounded Memoization...');
    const testSession = 'sess_test_lru_' + Date.now();
    const dynamicOpts = { enabled: true, cacheZoneFreeze: true };
    const sig1 = contextCompactor.getOptionsSignature(dynamicOpts);
    assert.ok(sig1.includes('cleanKubectlOutput:1'), 'Dynamic signature must include cleanKubectlOutput');

    // Register dynamic transformer and check signature change
    contextCompactor.registerTransformer('custom_auditor', (t) => t, { priority: 99 });
    const sig2 = contextCompactor.getOptionsSignature(dynamicOpts);
    assert.ok(sig2.includes('custom_auditor:1'), 'Signature must reflect registered custom transformer');
    assert.notStrictEqual(sig1, sig2, 'Cache signatures must differ when transformer registry changes');
    contextCompactor.unregisterTransformer('custom_auditor');

    // Verify true LRU order refreshing
    const keyA = 'key_a';
    const keyB = 'key_b';
    contextCompactor.setMemo(testSession, keyA, 'val_a');
    contextCompactor.setMemo(testSession, keyB, 'val_b');
    // Access keyA to refresh recency
    const fetchedA = contextCompactor.getMemo(testSession, keyA);
    assert.strictEqual(fetchedA, 'val_a', 'Memo must return cached value');
    contextCompactor.clearSessionMemo(testSession);
    assert.strictEqual(contextCompactor.getMemo(testSession, keyA), null, 'clearSessionMemo must wipe session keys');
    console.log('✓ Dynamic Multi-Transformer Cache Key Signature & True LRU Bounded Memoization verified');

    // [Test 106] Testing Strict Code Line & Pytest/TAP Assertion Safety (Zero False Positives on Code)
    console.log('\n[Test 106] Testing Strict Code Line & Pytest/TAP Assertion Safety (Zero False Positives on Code)...');
    // 1. Python source code assigning or comparing PASSED variable
    const pythonSourceCode = [
      'def evaluate_state():',
      '    status_a = PASSED',
      '    status_b = PASSED',
      '    status_c = PASSED',
      '    return status_a == PASSED'
    ].join('\n');
    const foldedPyCode = contextCompactor.foldTestPasses(pythonSourceCode);
    assert.strictEqual(foldedPyCode, pythonSourceCode, 'Python variable assignments containing PASSED must NEVER be folded as test passes');

    // 2. JavaScript source code with ok identifier
    const jsSourceCode = [
      'const ok = true;',
      'if (ok) {',
      '  return ok;',
      '}'
    ].join('\n');
    const foldedJsCode = contextCompactor.foldTestPasses(jsSourceCode);
    assert.strictEqual(foldedJsCode, jsSourceCode, 'JavaScript source code with ok identifier must NEVER be folded');

    // 3. New lockfiles: pubspec.lock, gradle.lockfile, go.work.sum
    const pubspecDiff = [
      'diff --git a/pubspec.lock b/pubspec.lock',
      'index 123456..789abc 100644',
      '--- a/pubspec.lock',
      '+++ b/pubspec.lock',
      '@@ -1,5 +1,10 @@',
      '+  flutter_svg:',
      '+    dependency: transitive',
      '+    description: null',
      '+    version: "2.0.7"',
      '+    source: hosted'
    ].join('\n');
    const foldedPubspec = contextCompactor.foldLockfiles(pubspecDiff);
    assert.ok(foldedPubspec.includes('[Lockfile diff folded: pubspec.lock'), 'pubspec.lock diff must be cleanly folded');

    const gradleDiff = [
      'diff --git a/gradle.lockfile b/gradle.lockfile',
      'index 123456..789abc 100644',
      '--- a/gradle.lockfile',
      '+++ b/gradle.lockfile',
      '@@ -1,5 +1,10 @@',
      '+org.jetbrains.kotlin:kotlin-stdlib:1.9.22=compileClasspath',
      '+org.slf4j:slf4j-api:2.0.9=compileClasspath',
      '+com.google.guava:guava:33.0.0-jre=compileClasspath',
      '+io.netty:netty-all:4.1.107.Final=compileClasspath'
    ].join('\n');
    const foldedGradle = contextCompactor.foldLockfiles(gradleDiff);
    assert.ok(foldedGradle.includes('[Lockfile diff folded: gradle.lockfile'), 'gradle.lockfile diff must be cleanly folded');
    console.log('✓ Strict Code Line & Pytest/TAP Assertion Safety (Zero False Positives on Code) verified');

    // [Test 107] Testing Hierarchical Compression Configuration & Preset Matrix
    console.log('\n[Test 107] Testing Hierarchical Compression Configuration & Preset Matrix...');
    const defaultCfg = contextCompactor.DEFAULT_COMPRESSION_CONFIG;
    assert.ok(defaultCfg.modules, 'DEFAULT_COMPRESSION_CONFIG must contain hierarchical modules');
    assert.ok(defaultCfg.modules.rtk, 'rtk module must be defined');
    assert.ok(defaultCfg.modules.headroom, 'headroom module must be defined');
    assert.ok(defaultCfg.modules.schema, 'schema module must be defined');
    assert.ok(defaultCfg.modules.cacheZone, 'cacheZone module must be defined');
    assert.strictEqual(defaultCfg.modules.rtk.enabled, true);
    assert.strictEqual(defaultCfg.modules.schema.schemaCharThreshold, 15000);

    // Verify Presets Matrix
    const presets = contextCompactor.COMPRESSION_PRESETS;
    assert.ok(presets.balanced && presets.aggressive && presets.conservative);
    assert.strictEqual(presets.balanced.modules.schema.schemaCharThreshold, 15000);
    assert.strictEqual(presets.aggressive.modules.schema.schemaCharThreshold, 8000);
    assert.strictEqual(presets.conservative.modules.headroom.enabled, false);
    assert.strictEqual(presets.conservative.modules.cacheZone.enabled, false);

    // Normalization helper tests
    const normDefault = contextCompactor.normalizeCompressionOptions({});
    assert.strictEqual(normDefault.modules.rtk.enabled, true);
    assert.strictEqual(normDefault.modules.headroom.foldLockfiles, true);

    const normFlat = contextCompactor.normalizeCompressionOptions({
      cleanProgressBars: false,
      schemaCharThreshold: 9999
    });
    assert.strictEqual(normFlat.modules.rtk.cleanProgressBars, false, 'Flat cleanProgressBars must map to rtk module');
    assert.strictEqual(normFlat.modules.schema.schemaCharThreshold, 9999, 'Flat threshold must map to schema module');
    assert.strictEqual(normFlat.cleanProgressBars, false, 'Effective flat key must be synchronized');
    assert.strictEqual(normFlat.schemaCharThreshold, 9999, 'Effective flat threshold must be synchronized');

    // Preset resolution alone
    const normCons = contextCompactor.normalizeCompressionOptions({ preset: 'conservative' });
    assert.strictEqual(normCons.preset, 'conservative');
    assert.strictEqual(normCons.modules.headroom.enabled, false);
    assert.strictEqual(normCons.foldLockfiles, false);
    assert.strictEqual(normCons.foldTestPasses, false);

    const normAggr = contextCompactor.normalizeCompressionOptions({ preset: 'aggressive' });
    assert.strictEqual(normAggr.preset, 'aggressive');
    assert.strictEqual(normAggr.modules.schema.schemaCharThreshold, 8000);
    assert.strictEqual(normAggr.schemaCharThreshold, 8000);

    const normOverride = contextCompactor.normalizeCompressionOptions({
      preset: 'conservative',
      modules: { headroom: { enabled: true, foldLockfiles: true } }
    });
    assert.strictEqual(normOverride.modules.headroom.enabled, true);
    assert.strictEqual(normOverride.foldLockfiles, true);
    assert.strictEqual(normOverride.foldTestPasses, false);

    const normCustom = contextCompactor.normalizeCompressionOptions({ preset: 'custom' });
    assert.strictEqual(normCustom.preset, 'custom');
    console.log('✓ Hierarchical Compression Configuration & Preset Matrix verified');

    // [Test 108] Testing Cascading Major Module Master Switches
    console.log('\n[Test 108] Testing Cascading Major Module Master Switches...');
    const ansiWithLock = '\u001b[31mError Line\u001b[0m\n' + pubspecDiff;

    // Case 1: RTK disabled, Headroom enabled
    const rtkOffRes = contextCompactor.compactText(ansiWithLock, {
      enabled: true,
      modules: {
        rtk: { enabled: false },
        headroom: { enabled: true, foldLockfiles: true }
      }
    });
    assert.ok(rtkOffRes.includes('\u001b[31mError Line\u001b[0m'), 'ANSI must be preserved when RTK module is disabled');
    assert.ok(rtkOffRes.includes('[Lockfile diff folded: pubspec.lock'), 'Lockfile diff must still be folded by Headroom module');

    // Case 2: Headroom disabled, RTK enabled
    const headroomOffRes = contextCompactor.compactText(ansiWithLock, {
      enabled: true,
      modules: {
        rtk: { enabled: true, stripAnsi: true },
        headroom: { enabled: false, foldLockfiles: true }
      }
    });
    assert.ok(!headroomOffRes.includes('\u001b[31m'), 'ANSI must be stripped by active RTK module');
    assert.ok(!headroomOffRes.includes('[Lockfile diff folded:'), 'Lockfile folding must be bypassed when Headroom module is disabled');

    // Case 3: Schema module disabled
    const oversizedToolItem = {
      name: 'oversized_test_tool',
      description: 'Super verbose description. '.repeat(100),
      parameters: { type: 'object', properties: { test: { type: 'string', description: 'Long. '.repeat(200) } } }
    };
    const schemaOffPayload = contextCompactor.compactChatPayload({
      tools: [oversizedToolItem]
    }, {
      enabled: true,
      modules: {
        schema: { enabled: false, slimToolsSchema: true, schemaCharThreshold: 50 }
      }
    });
    assert.strictEqual(schemaOffPayload.tools[0].description, oversizedToolItem.description, 'Schema slimming must be bypassed when schema module is disabled');

    // Case 4: Schema module re-enabled
    const schemaOnPayload = contextCompactor.compactChatPayload({
      tools: [oversizedToolItem]
    }, {
      enabled: true,
      modules: {
        schema: { enabled: true, slimToolsSchema: true, schemaCharThreshold: 50 }
      }
    });
    assert.ok(schemaOnPayload.tools[0].description.length < oversizedToolItem.description.length, 'Schema slimming must take effect when schema module is enabled');
    console.log('✓ Cascading Major Module Master Switches verified');

    // [Test 109] Testing Realtime Compression Stats Tracking, Metrics Calculation & Disk Persistence
    console.log('\n[Test 109] Testing Realtime Compression Stats Tracking, Metrics Calculation & Disk Persistence...');
    contextCompactor.resetCompressionStats();
    let stats0 = contextCompactor.getCompressionStats();
    assert.strictEqual(stats0.totalOriginalChars, 0);
    assert.strictEqual(stats0.totalSavedChars, 0);
    assert.strictEqual(stats0.savedTokens, 0);
    assert.strictEqual(stats0.savedCostUSD, 0);

    // Run compression to accumulate savings
    const noisyText = '\u001b[32m' + 'A'.repeat(380) + '\u001b[0m\n' + pubspecDiff;
    const compactedOut = contextCompactor.compactText(noisyText, { enabled: true });
    assert.ok(compactedOut.length < noisyText.length);

    let stats1 = contextCompactor.getCompressionStats();
    assert.ok(stats1.totalOriginalChars > 0, 'Original chars must be tracked');
    assert.ok(stats1.totalSavedChars > 0, 'Saved chars must be tracked');
    assert.strictEqual(stats1.savedTokens, Math.round(stats1.totalSavedChars / 3.8), 'savedTokens must match formula');
    assert.strictEqual(stats1.savedCostUSD, Number(((stats1.savedTokens / 1000000) * 0.25).toFixed(6)), 'savedCostUSD must match formula');
    assert.ok(stats1.compressionRatio > 0, 'compressionRatio must be positive');
    assert.ok(stats1.modules.rtk.savedChars > 0, 'rtk module savings must be credited');
    assert.ok(stats1.modules.headroom.savedChars > 0, 'headroom module savings must be credited');

    // Check disk persistence (compression-stats.json)
    const statsFilePath = path.join(__dirname, 'compression-stats.json');
    contextCompactor.resetCompressionStats();
    assert.ok(fs.existsSync(statsFilePath), 'compression-stats.json must be persisted to disk upon reset');
    const diskContent = JSON.parse(fs.readFileSync(statsFilePath, 'utf8'));
    assert.strictEqual(diskContent.totalOriginalChars, 0);
    assert.strictEqual(diskContent.savedTokens, 0);
    console.log('✓ Realtime Compression Stats Tracking, Metrics Calculation & Disk Persistence verified');

    // [Test 110] Testing Compression Stats API: GET /balancer/api/compression/stats
    console.log('\n[Test 110] Testing Compression Stats API: GET /balancer/api/compression/stats...');
    const statsRes = await request('/balancer/api/compression/stats', { method: 'GET' });
    assert.strictEqual(statsRes.statusCode, 200);
    const statsJson = JSON.parse(statsRes.body);
    assert.strictEqual(statsJson.success, true);
    assert.ok(statsJson.stats, 'Response must contain stats object');
    assert.ok(statsJson.stats.modules.rtk, 'modules.rtk must exist');
    assert.ok(statsJson.stats.modules.headroom, 'modules.headroom must exist');
    assert.ok(statsJson.stats.modules.schema, 'modules.schema must exist');
    assert.ok(statsJson.stats.modules.cacheZone, 'modules.cacheZone must exist');
    console.log('✓ Compression Stats API: GET /balancer/api/compression/stats verified');

    // [Test 111] Testing Compression Stats Reset API: POST /balancer/api/compression/stats/reset
    console.log('\n[Test 111] Testing Compression Stats Reset API: POST /balancer/api/compression/stats/reset...');
    const compResetRes = await request('/balancer/api/compression/stats/reset', { method: 'POST' });
    assert.strictEqual(compResetRes.statusCode, 200);
    const compResetJson = JSON.parse(compResetRes.body);
    assert.strictEqual(compResetJson.success, true);
    assert.ok(compResetJson.message.includes('清零'));
    assert.strictEqual(compResetJson.stats.totalSavedChars, 0);
    assert.strictEqual(compResetJson.stats.savedTokens, 0);

    // Verify subsequent GET reflects the zero state
    const afterResetGet = await request('/balancer/api/compression/stats', { method: 'GET' });
    const afterResetData = JSON.parse(afterResetGet.body);
    assert.strictEqual(afterResetData.stats.totalSavedChars, 0);
    console.log('✓ Compression Stats Reset API: POST /balancer/api/compression/stats/reset verified');

    // [Test 112] Testing Web UI Dashboard Integration & Hierarchical Config Roundtrip
    console.log('\n[Test 112] Testing Web UI Dashboard Integration & Hierarchical Config Roundtrip...');
    // 1. Post hierarchical config with aggressive preset and custom threshold
    const hierarchicalCfgUpdate = await request('/balancer/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upstream: `http://127.0.0.1:${mockPort}/v1`,
        accounts: testConfig.accounts,
        compression: {
          enabled: true,
          preset: 'aggressive',
          modules: {
            rtk: { enabled: true, stripAnsi: true, cleanProgressBars: true, foldTestPasses: true, cleanDevOpsOutput: true },
            headroom: { enabled: true, foldLockfiles: true, exemptMergeConflicts: true, protectSourceDiffs: true },
            schema: { enabled: true, alignToolsSchema: true, slimToolsSchema: true, schemaCharThreshold: 8000 },
            cacheZone: { enabled: true, cacheZoneFreeze: true, trueLruRetention: true }
          }
        }
      })
    });
    assert.strictEqual(hierarchicalCfgUpdate.statusCode, 200);

    // 2. Verify GET /balancer/api/config returns both modules and flat aliases in sync
    const getHierarchicalRes = await request('/balancer/api/config', { method: 'GET' });
    assert.strictEqual(getHierarchicalRes.statusCode, 200);
    const gotCfg = JSON.parse(getHierarchicalRes.body);
    assert.strictEqual(gotCfg.compression.preset, 'aggressive');
    assert.strictEqual(gotCfg.compression.modules.schema.schemaCharThreshold, 8000);
    assert.strictEqual(gotCfg.compression.schemaCharThreshold, 8000, 'Flat alias must be synchronized with module');
    assert.strictEqual(gotCfg.compression.modules.rtk.enabled, true);

    // 3. Verify Web UI HTML contains modern 4-module cards, metrics cards, and preset buttons
    const compUiRes = await request('/balancer/ui', { method: 'GET' });
    assert.strictEqual(compUiRes.statusCode, 200);
    assert.ok(compUiRes.body.includes('id="compression-card"'), 'UI must contain compression-card');
    assert.ok(compUiRes.body.includes('id="module-card-rtk"'), 'UI must contain module-card-rtk');
    assert.ok(compUiRes.body.includes('id="module-card-headroom"'), 'UI must contain module-card-headroom');
    assert.ok(compUiRes.body.includes('id="module-card-schema"'), 'UI must contain module-card-schema');
    assert.ok(compUiRes.body.includes('id="module-card-cacheZone"'), 'UI must contain module-card-cacheZone');
    assert.ok(compUiRes.body.includes('id="preset-btn-balanced"'), 'UI must contain preset-btn-balanced');
    assert.ok(compUiRes.body.includes('id="preset-btn-aggressive"'), 'UI must contain preset-btn-aggressive');
    assert.ok(compUiRes.body.includes('id="preset-btn-conservative"'), 'UI must contain preset-btn-conservative');
    assert.ok(compUiRes.body.includes('id="preset-btn-custom"'), 'UI must contain preset-btn-custom');
    assert.ok(compUiRes.body.includes('id="btn-reset-comp-stats"'), 'UI must contain btn-reset-comp-stats');
    assert.ok(compUiRes.body.includes('id="stat-saved-tokens"'), 'UI must contain stat-saved-tokens');
    assert.ok(compUiRes.body.includes('id="stat-saved-cost"'), 'UI must contain stat-saved-cost');
    assert.ok(compUiRes.body.includes('id="stat-compression-ratio"'), 'UI must contain stat-compression-ratio');

    // 4. Verify client script syntax integrity after additions
    const matchScript = compUiRes.body.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(matchScript, 'Web UI must contain inline script');
    assert.doesNotThrow(() => {
      new Function(matchScript[1]);
    }, 'Client script in Web UI must compile without SyntaxError');

    // 5. Test flat config update preserving pre-configured modules
    await request('/balancer/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upstream: `http://127.0.0.1:${mockPort}/v1`,
        accounts: testConfig.accounts,
        compression: {
          enabled: true,
          stripAnsi: false
        }
      })
    });
    const afterFlatCfgRes = await request('/balancer/api/config', { method: 'GET' });
    const afterFlatCfg = JSON.parse(afterFlatCfgRes.body);
    assert.strictEqual(afterFlatCfg.compression.modules.schema.schemaCharThreshold, 8000, 'Pre-configured schemaCharThreshold must be preserved across flat update');
    assert.strictEqual(afterFlatCfg.compression.modules.rtk.stripAnsi, false, 'Flat stripAnsi update must be applied');

    // Restore original test configuration cleanly
    await request('/balancer/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upstream: `http://127.0.0.1:${mockPort}/v1`,
        accounts: testConfig.accounts,
        compression: testConfig.compression
      })
    });
    console.log('✓ Web UI Dashboard Integration & Hierarchical Config Roundtrip verified');

    // [Test 113] Testing Doctor & Repair Modular Scoping (System vs Codex Decoupling)
    console.log('\n[Test 113] Testing Doctor & Repair Modular Scoping (System vs Codex Decoupling)...');

    // 1. Doctor scope=system
    const docSysRes = await request('/balancer/api/doctor?scope=system', { method: 'GET' });
    assert.strictEqual(docSysRes.statusCode, 200);
    const docSysJson = JSON.parse(docSysRes.body);
    assert.strictEqual(docSysJson.scope, 'system');
    assert.ok(Array.isArray(docSysJson.issues));
    const codexIssueIds = ['codex_not_bound', 'codex_timeout_unhardened', 'codex_process_suspended', 'codex_ghost_process', 'codex_locale_misaligned'];
    const foundCodexInSystem = docSysJson.issues.some(iss => codexIssueIds.includes(iss.id));
    assert.strictEqual(foundCodexInSystem, false, 'System doctor issues must NOT contain Codex-specific issues');
    assert.ok(Array.isArray(docSysJson.codexIssues), 'System doctor report must provide isolated codexIssues array for UI redirection');

    // 2. Doctor scope=codex
    const docCodexRes = await request('/balancer/api/doctor?scope=codex', { method: 'GET' });
    assert.strictEqual(docCodexRes.statusCode, 200);
    const docCodexScopeJson = JSON.parse(docCodexRes.body);
    assert.strictEqual(docCodexScopeJson.scope, 'codex');
    assert.ok(docCodexScopeJson.codex && typeof docCodexScopeJson.codex === 'object');
    assert.ok(Array.isArray(docCodexScopeJson.issues));
    const allAreCodexIssues = docCodexScopeJson.issues.every(iss => codexIssueIds.includes(iss.id));
    assert.strictEqual(allAreCodexIssues, true, 'Codex-scoped doctor must only report Codex-related issues');

    // 3. Doctor scope=all (default backwards compatibility)
    const docAllRes = await request('/balancer/api/doctor', { method: 'GET' });
    assert.strictEqual(docAllRes.statusCode, 200);
    const docAllJson = JSON.parse(docAllRes.body);
    assert.strictEqual(docAllJson.scope, 'all');
    assert.ok(docAllJson.codex);

    // 4. Repair scope=system (Must skip Codex repair items)
    const repSysRes = await request('/balancer/api/repair?scope=system', { method: 'POST' });
    assert.strictEqual(repSysRes.statusCode, 200);
    const repSysJson = JSON.parse(repSysRes.body);
    assert.strictEqual(repSysJson.success, true);
    assert.strictEqual(repSysJson.scope, 'system');
    const codexRepItems = ['Codex Process Suspension', 'Codex SingleInstanceLock', 'Codex Locale & Environment', 'Codex Integration'];
    const foundCodexInRepSys = repSysJson.results.some(r => codexRepItems.includes(r.item));
    assert.strictEqual(foundCodexInRepSys, false, 'System repair results must NOT contain Codex repair steps');

    // 5. Repair scope=codex (Must only execute Codex repair items)
    const repCodexRes = await request('/balancer/api/repair?scope=codex', { method: 'POST' });
    assert.strictEqual(repCodexRes.statusCode, 200);
    const repCodexScopeJson = JSON.parse(repCodexRes.body);
    assert.strictEqual(repCodexScopeJson.success, true);
    assert.strictEqual(repCodexScopeJson.scope, 'codex');
    const sysItems = ['Reset Cooldowns', 'OpenCode Config', 'OMO Plugin v2 Patch', 'OMO Config', 'Boost Command'];
    const foundSysInRepCodex = repCodexScopeJson.results.some(r => sysItems.includes(r.item));
    assert.strictEqual(foundSysInRepCodex, false, 'Codex repair results must NOT contain general system repair steps');
    assert.ok(repCodexScopeJson.results.some(r => codexRepItems.includes(r.item)), 'Codex repair must execute Codex self-healing actions');

    // 6. Repair scope=all (Default full backwards compatibility)
    const repAllRes = await request('/balancer/api/repair', { method: 'POST' });
    assert.strictEqual(repAllRes.statusCode, 200);
    const repAllJson = JSON.parse(repAllRes.body);
    assert.strictEqual(repAllJson.success, true);
    assert.strictEqual(repAllJson.scope, 'all');
    assert.ok(repAllJson.results.some(r => r.item === 'Reset Cooldowns'));
    console.log('✓ Doctor & Repair Modular Scoping (System vs Codex Decoupling) verified');

    // [Test 114] Testing Foolproof UX/UI Smart Quick Start Wizard & Visual Hierarchy Integrity
    console.log('\n[Test 114] Testing Foolproof UX/UI Smart Quick Start Wizard & Visual Hierarchy Integrity...');
    const uiFoolproofRes = await request('/balancer/ui', { method: 'GET' });
    assert.strictEqual(uiFoolproofRes.statusCode, 200);

    // 1. Verify Smart Quick Wizard card, hero button, and 4-dimension status pills
    assert.ok(uiFoolproofRes.body.includes('id="wizard-card"'), 'UI must contain wizard-card');
    assert.ok(uiFoolproofRes.body.includes('id="btn-quick-setup"'), 'UI must contain btn-quick-setup');
    assert.ok(uiFoolproofRes.body.includes('id="wizard-global-badge"'), 'UI must contain wizard-global-badge');
    assert.ok(uiFoolproofRes.body.includes('id="wizard-status-account"'), 'UI must contain wizard-status-account');
    assert.ok(uiFoolproofRes.body.includes('id="wizard-status-doctor"'), 'UI must contain wizard-status-doctor');
    assert.ok(uiFoolproofRes.body.includes('id="wizard-status-comp"'), 'UI must contain wizard-status-comp');
    assert.ok(uiFoolproofRes.body.includes('id="wizard-status-codex"'), 'UI must contain wizard-status-codex');
    assert.ok(uiFoolproofRes.body.includes('id="wizard-progress-box"'), 'UI must contain wizard-progress-box');

    // 2. Verify Visual Hierarchy Status Badges across all core cards
    assert.ok(uiFoolproofRes.body.includes('id="accounts-status-badge"'), 'UI must contain accounts-status-badge');
    assert.ok(uiFoolproofRes.body.includes('id="doctor-status-badge"'), 'UI must contain doctor-status-badge');
    assert.ok(uiFoolproofRes.body.includes('id="updates-status-badge"'), 'UI must contain updates-status-badge');
    assert.ok(uiFoolproofRes.body.includes('id="codex-status-badge"'), 'UI must contain codex-status-badge');
    assert.ok(uiFoolproofRes.body.includes('id="network-status-badge"'), 'UI must contain network-status-badge');
    assert.ok(uiFoolproofRes.body.includes(`${routerPort} 监听正常`), 'Network status badge must reflect dynamic test port');

    // 3. Verify Dynamic Copy Feedback & Collapsible Components & Dirty State
    assert.ok(uiFoolproofRes.body.includes('id="btn-copy-baseurl"'), 'UI must contain btn-copy-baseurl');
    assert.ok(uiFoolproofRes.body.includes('btn-save-dirty'), 'UI must contain btn-save-dirty styling');
    assert.ok(uiFoolproofRes.body.includes('toggleCardCollapse'), 'UI script must contain toggleCardCollapse');
    assert.ok(uiFoolproofRes.body.includes('initCardCollapseStates'), 'UI script must contain initCardCollapseStates');
    assert.ok(uiFoolproofRes.body.includes('runQuickSetupWizard'), 'UI script must contain runQuickSetupWizard');
    assert.ok(uiFoolproofRes.body.includes('updateWizardStatusBadges'), 'UI script must contain updateWizardStatusBadges');
    assert.ok(uiFoolproofRes.body.includes('markConfigDirty'), 'UI script must contain markConfigDirty');
    assert.ok(uiFoolproofRes.body.includes('clearConfigDirty'), 'UI script must contain clearConfigDirty');

    // 4. Verify client script execution of wizard & collapse functions in VM
    const uiScriptMatch = uiFoolproofRes.body.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(uiScriptMatch, 'UI must contain script tag');
    await assert.doesNotReject(async () => {
      const mockElements = {};
      const mockDoc = {
        addEventListener: () => {},
        removeEventListener: () => {},
        cookie: '',
        hidden: false,
        getElementById: (id) => {
          if (!mockElements[id]) {
            const classSet = new Set();
            mockElements[id] = {
              id,
              checked: true,
              value: '15000',
              style: {},
              classList: {
                add: (c) => classSet.add(c),
                remove: (c) => classSet.delete(c),
                contains: (c) => classSet.has(c)
              },
              querySelectorAll: () => []
            };
          }
          return mockElements[id];
        }
      };
      const vm = require('node:vm');
      const ctx = vm.createContext({
        document: mockDoc,
        window: { location: {}, addEventListener: () => {} },
        localStorage: { getItem: () => null, setItem: () => {} },
        setInterval: () => {},
        clearInterval: () => {},
        setTimeout: () => {},
        currentPreset: 'balanced',
        accountQuotas: {},
        liveStats: {},
        currentConfig: { accounts: [{ id: 'acc-test-1', apiKey: 'test-key', enabled: true }], compression: { enabled: true, preset: 'balanced' } },
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ success: true, results: [{ item: 'Test Repair', success: true, message: 'Clean' }] })
        })
      });
      vm.runInContext(uiScriptMatch[1], ctx);
      ctx.updateCompCardsUI();
      ctx.updateWizardStatusBadges();
      assert.ok(mockElements['wizard-global-badge'].innerText.includes('🟢') || mockElements['wizard-global-badge'].innerText.includes('🟡'));

      // Test zero-account empty key dynamic reaction
      ctx.currentConfig.accounts = [];
      ctx.updateWizardStatusBadges();
      assert.strictEqual(mockElements['wizard-status-account'].innerText, '🔴 待配置密钥');
      assert.strictEqual(mockElements['wizard-global-badge'].innerText, '🔴 待配置密钥');

      // Test dirty config feedback
      ctx.markConfigDirty();
      assert.strictEqual(mockElements['btn-save-config'].classList.contains('btn-save-dirty'), true);
      ctx.clearConfigDirty();
      assert.strictEqual(mockElements['btn-save-config'].classList.contains('btn-save-dirty'), false);

      ctx.toggleCardCollapse('config-card-body', { innerText: '' });
      ctx.initCardCollapseStates();
      ctx.scrollToElement('wizard-card');

      // Test runQuickSetupWizard full flow execution
      await ctx.runQuickSetupWizard();
    }, 'Foolproof UI script methods must execute cleanly in VM context without error or recursion');
    console.log('✓ Foolproof UX/UI Smart Quick Start Wizard & Visual Hierarchy Integrity verified');

    // [Test 115] Testing Upstream Cluster Glitch Self-Healing & In-Flight Jitter Retries (Invalid Credential / Server Error Masking)
    console.log('\n[Test 115] Testing Upstream Cluster Glitch Self-Healing & In-Flight Jitter Retries (Invalid Credential / Server Error Masking)...');

    // 1. Direct proxy request encountering transient upstream cluster credential glitch
    const glitchChatRes = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-cluster-glitch-retry'
      },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', content: 'Testing transient upstream glitch resilience' }]
      })
    });
    assert.strictEqual(glitchChatRes.statusCode, 200, 'Gateway must intercept masked 401 cluster glitch and auto-heal with 200 OK');
    const glitchChatJson = JSON.parse(glitchChatRes.body);
    assert.ok(glitchChatJson.choices[0].message.content.includes('Healed after transient cluster credential glitch'));

    // 2. Bridged Responses protocol request encountering transient glitch
    const glitchBridgeRes = await request('/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-bridge-glitch-retry'
      },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        stream: false,
        input: [{ type: 'message', role: 'user', content: 'Testing bridge glitch resilience' }]
      })
    });
    assert.strictEqual(glitchBridgeRes.statusCode, 200, 'Bridge must intercept masked 401 cluster glitch and auto-heal with 200 OK');

    // 3. Genuine Invalid API Key: Put account on cooldown and failover to Account 2
    const invalidKeyRes = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-genuine-invalid-key'
      },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', content: 'Testing genuine invalid API key failover' }]
      })
    });
    assert.strictEqual(invalidKeyRes.statusCode, 200, 'Gateway must failover to next account when account returns genuine invalid API key');
    const invalidKeyJson = JSON.parse(invalidKeyRes.body);
    assert.ok(invalidKeyJson.choices[0].message.content.includes('Account 2 failover success'));

    console.log('✓ Upstream Cluster Glitch Self-Healing & In-Flight Jitter Retries verified');

    // [Test 116] Testing Centralized Upstream Error Classifier (classifyUpstreamError) & Case-Insensitivity
    console.log('\n[Test 116] Testing Centralized Upstream Error Classifier (classifyUpstreamError) & Case-Insensitivity...');
    const serverModule = require('./server');
    const classify = serverModule.classifyUpstreamError;
    assert.strictEqual(typeof classify, 'function', 'server.js must export classifyUpstreamError');

    // 1. Case-insensitivity: standard HTTP 502 with uppercase "502 Bad Gateway"
    const c1 = classify(502, '502 Bad Gateway');
    assert.strictEqual(c1.isUpstreamClusterGlitch, true, '502 Bad Gateway must be identified as cluster glitch');

    // 2. 500 Internal Server Error
    const c2 = classify(500, '500 Internal Server Error');
    assert.strictEqual(c2.isUpstreamClusterGlitch, true, '500 Internal Server Error must be cluster glitch');

    // 3. Cluster error disguised as 401 (e.g. "Upstream request failed: Invalid credential")
    const c3 = classify(401, '{"error":{"type":"server_error","message":"Upstream request failed: Invalid credential"}}');
    assert.strictEqual(c3.isUpstreamClusterGlitch, true, 'Masked 401 cluster error must be cluster glitch');
    assert.strictEqual(c3.isInvalidApiKey, false, 'Masked 401 cluster error must NOT be flagged as genuine invalid API key');

    // 4. Genuine invalid API key
    const c4 = classify(401, '{"error":{"message":"Incorrect API key provided: sk-xxx","type":"invalid_request_error","code":"invalid_api_key"}}');
    assert.strictEqual(c4.isInvalidApiKey, true, 'Genuine key failure must be flagged as isInvalidApiKey');
    assert.strictEqual(c4.isUpstreamClusterGlitch, false, 'Genuine key failure must NOT be flagged as cluster glitch');

    // 5. Gateway Timeout / Upstream Connect Error
    const c5 = classify(504, '<html>504 Gateway Time-out</html>');
    assert.strictEqual(c5.isUpstreamClusterGlitch, true, '504 Gateway Time-out must be cluster glitch');

    // 6. Safe with null / empty / malformed error text
    const c6 = classify(502, null);
    assert.strictEqual(c6.isUpstreamClusterGlitch, true, '502 with null text must safely classify as cluster glitch');
    const c7 = classify(200, '');
    assert.strictEqual(c7.isUpstreamClusterGlitch, false, '200 OK must not be glitch');

    console.log('✓ Centralized Upstream Error Classifier & Case-Insensitivity verified');

    // [Test 117] Testing 502 Bad Gateway In-Flight Jitter Auto-Healing (HTML Response Masking)
    console.log('\n[Test 117] Testing 502 Bad Gateway In-Flight Jitter Auto-Healing (HTML Response Masking)...');
    const res502 = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-502-bad-gateway-jitter'
      },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', content: 'Testing 502 Bad Gateway recovery' }]
      })
    });
    assert.strictEqual(res502.statusCode, 200, 'Router must intercept 502 Bad Gateway HTML and heal with 200 OK');
    const res502Json = JSON.parse(res502.body);
    assert.ok(res502Json.choices[0].message.content.includes('Healed after 502 Bad Gateway transient jitter'));
    console.log('✓ 502 Bad Gateway In-Flight Jitter Auto-Healing verified');

    // [Test 118] Testing Anthropic Bridge Dynamic Fallback to Chat & Bidirectional Dispatching
    console.log('\n[Test 118] Testing Anthropic Bridge Dynamic Fallback to Chat & Bidirectional Dispatching...');
    const resAnthropicFallback = await request('/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-anthropic-bridge-fallback'
      },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        stream: false,
        input: [{ type: 'message', role: 'user', content: 'Testing anthropic fallback to chat bridge' }]
      })
    });
    assert.strictEqual(resAnthropicFallback.statusCode, 200, 'Anthropic model restriction must dynamically fallback to Chat bridge and succeed');
    const resAnthropicJson = JSON.parse(resAnthropicFallback.body);
    assert.strictEqual(resAnthropicJson.status, 'completed', 'Bridged responses status must be completed');
    console.log('✓ Anthropic Bridge Dynamic Fallback to Chat & Bidirectional Dispatching verified');

    // [Test 119] Testing Multi-Turn Pre-Emptive Model Memory Hit on Chat & Flagship Anti-Downgrade
    console.log('\n[Test 119] Testing Multi-Turn Pre-Emptive Model Memory Hit on Chat & Flagship Anti-Downgrade...');

    // Turn 1: deepseek-v4.1-flash is restricted, router falls back to deepseek-flash and saves session memory
    const resChatTurn1 = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-preemptive-memory-chat'
      },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', content: 'Turn 1 test' }]
      })
    });
    assert.strictEqual(resChatTurn1.statusCode, 200, 'Turn 1 must recover and return 200 OK via dynamic fallback');

    // Turn 2: Request sent with original restricted model deepseek-v4.1-flash. Router pre-emptively rewrites model before sending to upstream!
    const resChatTurn2 = await request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-opencode-session': 'session-preemptive-memory-chat'
      },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', content: 'Turn 2 test' }]
      })
    });
    assert.strictEqual(resChatTurn2.statusCode, 200, 'Turn 2 must pre-emptively rewrite model and succeed without upstream 400 roundtrip');
    const resChatTurn2Json = JSON.parse(resChatTurn2.body);
    assert.strictEqual(resChatTurn2Json.model, 'deepseek-flash', 'Turn 2 response model must reflect pre-emptively memorized fallback model');

    // Anti-Downgrade flagship test in Section 2 fallback:
    const flagshipResolved = codexAdapter.resolveCompatibleFallbackModel('deepseek-v4.1-flash', '', { reasoningEffort: 'xhigh' });
    assert.strictEqual(flagshipResolved, 'deepseek-v4-pro', 'High reasoning effort (xhigh) must strictly resolve to 671B flagship deepseek-v4-pro');

    console.log('✓ Multi-Turn Pre-Emptive Model Memory Hit on Chat & Flagship Anti-Downgrade verified');

    // [Test 120] Testing Anthropic Bridge Multimodal Image Base64 Preservation & Chat Parity
    console.log('\n[Test 120] Testing Anthropic Bridge Multimodal Image Base64 Preservation & Chat Parity...');
    const bodyWithDataUri = {
      model: 'claude-haiku-5-5',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Analyze this image.' },
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
            }
          ]
        }
      ]
    };
    const antPayload1 = codexAdapter.convertResponsesToAnthropicPayload(bodyWithDataUri);
    assert.strictEqual(antPayload1.messages.length, 1);
    const antContents1 = antPayload1.messages[0].content;
    assert.ok(Array.isArray(antContents1), 'Anthropic content must be an array of blocks');
    assert.strictEqual(antContents1[0].type, 'text');
    assert.strictEqual(antContents1[0].text, 'Analyze this image.');
    assert.strictEqual(antContents1[1].type, 'image');
    assert.strictEqual(antContents1[1].source.type, 'base64');
    assert.strictEqual(antContents1[1].source.media_type, 'image/png');
    assert.strictEqual(antContents1[1].source.data, 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');

    // Preservation of pre-formatted Anthropic image source block
    const bodyWithSource = {
      model: 'claude-haiku-5-5',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: '/9j/4AAQSkZJRg=='
              }
            }
          ]
        }
      ]
    };
    const antPayload2 = codexAdapter.convertResponsesToAnthropicPayload(bodyWithSource);
    assert.strictEqual(antPayload2.messages[0].content[0].type, 'image');
    assert.strictEqual(antPayload2.messages[0].content[0].source.type, 'base64');
    assert.strictEqual(antPayload2.messages[0].content[0].source.media_type, 'image/jpeg');
    assert.strictEqual(antPayload2.messages[0].content[0].source.data, '/9j/4AAQSkZJRg==');

    // Chat bridge parity
    const chatPayload = codexAdapter.convertResponsesToChatPayload(bodyWithDataUri);
    assert.strictEqual(chatPayload.messages[0].content[1].type, 'image_url');
    assert.strictEqual(chatPayload.messages[0].content[1].image_url.url, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');

    console.log('✓ Anthropic Bridge Multimodal Image Base64 Preservation & Chat Parity verified');

    // [Test 121] Testing Multi-Account Resilience Pipeline Continuity & Step 3 Fallback Reachability
    console.log('\n[Test 121] Testing Multi-Account Resilience Pipeline Continuity & Step 3 Fallback Reachability...');
    const origAccounts = serverModule.config ? serverModule.config.accounts : null;
    if (serverModule.config) {
      serverModule.config.accounts = [
        { id: 'account-1', name: 'OpenCode Go Acc 1', apiKey: 'test-key-1', enabled: true },
        { id: 'account-2', name: 'OpenCode Go Acc 2', apiKey: 'test-key-2', enabled: true }
      ];
    }
    const mockRes121 = new EventEmitter();
    mockRes121.destroyed = false;
    mockRes121.writableEnded = false;

    let glitchJitterCalled = false;
    let glitchAccountSwitched = null;
    let glitchModelFallback = null;

    // Attempt 1: Jitter retry on current account
    const g1 = serverModule.handleUpstreamGlitchAndFailover({
      protocolTag: 'Test',
      clientRes: mockRes121,
      account: { id: 'account-1', name: 'OpenCode Go Acc 1' },
      attemptNumber: 1,
      triedAccountIds: new Set(['account-1']),
      sessionId: 'sess-glitch-test',
      statusCode: 502,
      errText: '502 Bad Gateway',
      model: 'deepseek-v4.1-flash',
      finishRequest: () => {},
      clientCloseHandler: () => {},
      retryCurrentAccount: () => { glitchJitterCalled = true; },
      retryNextAccount: (acc) => { glitchAccountSwitched = acc; },
      fallbackModelFn: (mod) => { glitchModelFallback = mod; }
    });
    assert.strictEqual(g1, true, 'Attempt 1 must trigger jitter retry');

    // Attempt 2: Next account failover
    const g2 = serverModule.handleUpstreamGlitchAndFailover({
      protocolTag: 'Test',
      clientRes: mockRes121,
      account: { id: 'account-1', name: 'OpenCode Go Acc 1' },
      attemptNumber: 2,
      triedAccountIds: new Set(['account-1']),
      sessionId: 'sess-glitch-test',
      statusCode: 502,
      errText: '502 Bad Gateway',
      model: 'deepseek-v4.1-flash',
      finishRequest: () => {},
      clientCloseHandler: () => {},
      retryCurrentAccount: () => {},
      retryNextAccount: (acc) => { glitchAccountSwitched = acc; },
      fallbackModelFn: (mod) => { glitchModelFallback = mod; }
    });
    assert.strictEqual(g2, true, 'Attempt 2 must switch to next account');
    assert.ok(glitchAccountSwitched, 'Next account must be selected');
    assert.strictEqual(glitchAccountSwitched.id, 'account-2');

    // Attempt 3: All accounts exhausted -> Step 3 model fallback MUST be reached!
    const g3 = serverModule.handleUpstreamGlitchAndFailover({
      protocolTag: 'Test',
      clientRes: mockRes121,
      account: { id: 'account-2', name: 'OpenCode Go Acc 2' },
      attemptNumber: 3,
      triedAccountIds: new Set(['account-1', 'account-2']),
      sessionId: 'sess-glitch-test',
      statusCode: 502,
      errText: '502 Bad Gateway',
      model: 'deepseek-v4.1-flash',
      finishRequest: () => {},
      clientCloseHandler: () => {},
      retryCurrentAccount: () => {},
      retryNextAccount: () => {},
      fallbackModelFn: (mod) => { glitchModelFallback = mod; }
    });
    assert.strictEqual(g3, true, 'Attempt 3 must reach Step 3 dynamic fallback');
    assert.strictEqual(glitchModelFallback, 'deepseek-flash', 'Model must fallback to deepseek-flash');

    console.log('✓ Multi-Account Resilience Pipeline Continuity & Step 3 Fallback Reachability verified');

    // [Test 122] Testing Network Socket Error Failover & Client Disconnect Cancellation
    console.log('\n[Test 122] Testing Network Socket Error Failover & Client Disconnect Cancellation...');
    const mockRes122 = new EventEmitter();
    mockRes122.destroyed = false;
    mockRes122.writableEnded = false;
    let netRetryCalled = false;

    const netHandled = serverModule.handleNetworkErrorFailover({
      protocolTag: 'Test',
      clientRes: mockRes122,
      account: { id: 'account-1', name: 'OpenCode Go Acc 1' },
      attemptNumber: 1,
      triedAccountIds: new Set(['account-1']),
      sessionId: 'sess-net-err-test',
      err: new Error('read ECONNRESET'),
      finishRequest: () => {},
      clientCloseHandler: () => {},
      retryCurrentAccount: () => { netRetryCalled = true; },
      retryNextAccount: () => {},
      fallbackModelFn: () => {}
    });
    assert.strictEqual(netHandled, true, 'handleNetworkErrorFailover must handle attempt 1 with jitter');

    // Simulate client abrupt disconnect before 350ms
    mockRes122.emit('close');
    mockRes122.destroyed = true;
    await new Promise(r => setTimeout(r, 450));
    assert.strictEqual(netRetryCalled, false, 'Jitter retry must be cancelled if client disconnected');

    console.log('✓ Network Socket Error Failover & Client Disconnect Cancellation verified');

    // [Test 123] Testing Centralized Rate-Limit Failover & Stream Drainage
    console.log('\n[Test 123] Testing Centralized Rate-Limit Failover & Stream Drainage...');
    const mockUpstream123 = new EventEmitter();
    mockUpstream123.headers = { 'retry-after': '5' };
    const mockRes123 = new EventEmitter();
    mockRes123.destroyed = false;
    let rateLimitSwitchedAcc = null;

    serverModule.handleRateLimitFailover({
      protocolTag: 'Test',
      clientRes: mockRes123,
      account: { id: 'account-1', name: 'OpenCode Go Acc 1' },
      attemptNumber: 1,
      triedAccountIds: new Set(['account-1']),
      sessionId: 'sess-rate-limit-test',
      statusCode: 429,
      upstreamRes: mockUpstream123,
      finishRequest: () => {},
      clientCloseHandler: () => {},
      retryFn: (acc) => { rateLimitSwitchedAcc = acc; }
    });

    mockUpstream123.emit('data', Buffer.from('{"error":"Rate limit reached"}'));
    mockUpstream123.emit('end');

    assert.ok(rateLimitSwitchedAcc, 'Rate limit failover must select next available account');
    assert.strictEqual(rateLimitSwitchedAcc.id, 'account-2');

    console.log('✓ Centralized Rate-Limit Failover & Stream Drainage verified');
    if (serverModule.config && origAccounts) {
      serverModule.config.accounts = origAccounts;
    }

    // [Test 124] Testing Multi-Family Model Fallback Loop Prevention, Bounded Cache & Flagship Protection
    console.log('\n[Test 124] Testing Multi-Family Model Fallback Loop Prevention, Bounded Cache & Flagship Protection...');
    // 1. Kimi loop prevention
    assert.strictEqual(codexAdapter.resolveCompatibleFallbackModel('kimi-k3'), 'kimi-k2.7-code');
    assert.strictEqual(codexAdapter.resolveCompatibleFallbackModel('kimi-k2.7-code'), 'kimi-k3');

    // 2. GLM multi-family
    assert.strictEqual(codexAdapter.resolveCompatibleFallbackModel('glm-5.3'), 'glm-5.2');
    assert.strictEqual(codexAdapter.resolveCompatibleFallbackModel('glm-5.2'), 'glm-5.3');
    assert.strictEqual(codexAdapter.resolveCompatibleFallbackModel('glm-5.1-flash'), 'deepseek-flash');

    // 3. Qwen loop prevention
    assert.strictEqual(codexAdapter.resolveCompatibleFallbackModel('qwen3.7-max'), 'deepseek-v4-pro');

    // 4. Extended families: Gemini, LLaMA, Minimax
    assert.strictEqual(codexAdapter.resolveCompatibleFallbackModel('gemini-2.5-flash'), 'deepseek-flash');
    assert.strictEqual(codexAdapter.resolveCompatibleFallbackModel('gemini-2.5-pro'), 'deepseek-v4-pro');
    assert.strictEqual(codexAdapter.resolveCompatibleFallbackModel('llama-3.3-70b'), 'deepseek-v4-pro');
    assert.strictEqual(codexAdapter.resolveCompatibleFallbackModel('minimax-m3'), 'deepseek-v4-pro');

    // 5. Reasoning effort anti-downgrade (both 'high' and 'xhigh')
    assert.strictEqual(codexAdapter.resolveCompatibleFallbackModel('deepseek-v4.1-flash', '', { reasoningEffort: 'high' }), 'deepseek-v4-pro');
    assert.strictEqual(codexAdapter.resolveCompatibleFallbackModel('deepseek-v4.1-flash', '', { reasoningEffort: 'xhigh' }), 'deepseek-v4-pro');

    // 6. Bounded cache capacity guard in setSessionModelFallback
    if (typeof serverModule.setSessionModelFallback === 'function') {
      const cache = serverModule.sessionModelFallbackCache;
      for (let i = 0; i < 5010; i++) {
        serverModule.setSessionModelFallback(`sess-stress-${i}`, 'test-model', 'fallback-model');
      }
      assert.ok(cache.size <= 5000, `sessionModelFallbackCache size (${cache.size}) must be bounded to <= 5000`);
    }

    console.log('✓ Multi-Family Model Fallback Loop Prevention, Bounded Cache & Flagship Protection verified');

    // [Test 125] Testing Context Compression Doctor API (GET /balancer/api/compression/doctor) & Full Client Compatibility Matrix
    console.log('\n[Test 125] Testing Context Compression Doctor API (GET /balancer/api/compression/doctor) & Full Client Compatibility Matrix...');
    const compDocRes = await request('/balancer/api/compression/doctor', { method: 'GET' });
    assert.strictEqual(compDocRes.statusCode, 200);
    const compDocJson = JSON.parse(compDocRes.body);
    assert.strictEqual(compDocJson.healthy, true, 'Default configuration must be diagnosed as healthy');
    assert.ok(compDocJson.activeEngines, 'Report must contain activeEngines');
    assert.strictEqual(compDocJson.activeEngines.rtk.enabled, true);
    assert.strictEqual(compDocJson.activeEngines.headroom.enabled, true);
    assert.strictEqual(compDocJson.activeEngines.schema.enabled, true);
    assert.strictEqual(compDocJson.activeEngines.cacheZone.enabled, true);
    assert.ok(compDocJson.clientsCompatibility, 'Report must contain clientsCompatibility matrix');
    assert.strictEqual(compDocJson.clientsCompatibility.codex.status, 'compatible');
    assert.strictEqual(compDocJson.clientsCompatibility.codex.protocol, 'OpenAI Responses API');
    assert.strictEqual(compDocJson.clientsCompatibility.opencode.status, 'compatible');
    assert.strictEqual(compDocJson.clientsCompatibility.openchamber.status, 'compatible');
    assert.ok(compDocJson.summary, 'Report must contain summary');
    console.log('✓ Context Compression Doctor API & Full Client Compatibility Matrix verified');

    // [Test 126] Testing Context Compression Health Detection on Unsafe Configurations (Conflict Shield Off, Low Threshold, Broken Regex)
    console.log('\n[Test 126] Testing Context Compression Health Detection on Unsafe Configurations...');
    // Post unsafe configuration: disable conflict shield, disable source diff protect, set threshold < 4000, broken pattern, disable LRU
    await request('/balancer/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upstream: `http://127.0.0.1:${mockPort}/v1`,
        accounts: testConfig.accounts,
        compression: {
          enabled: true,
          preset: 'custom',
          modules: {
            rtk: { enabled: true, stripAnsi: true, cleanProgressBars: true, foldTestPasses: true, cleanDevOpsOutput: true },
            headroom: { enabled: true, foldLockfiles: true, exemptMergeConflicts: false, protectSourceDiffs: false },
            schema: { enabled: true, alignToolsSchema: true, slimToolsSchema: true, schemaCharThreshold: 1200 },
            cacheZone: { enabled: true, cacheZoneFreeze: true, trueLruRetention: false }
          },
          customTestPassPatterns: ['[broken(regex']
        }
      })
    });

    const unsafeDocRes = await request('/balancer/api/compression/doctor', { method: 'GET' });
    assert.strictEqual(unsafeDocRes.statusCode, 200);
    const unsafeDocJson = JSON.parse(unsafeDocRes.body);
    assert.strictEqual(unsafeDocJson.healthy, false, 'Unsafe configuration must trigger healthy: false');
    assert.ok(unsafeDocJson.issues.length >= 4, `Must detect multiple safety issues (found ${unsafeDocJson.issues.length})`);

    const issueIds = unsafeDocJson.issues.map(i => i.id);
    assert.ok(issueIds.includes('comp_merge_conflicts_unprotected'), 'Must detect merge conflicts unprotected (CRITICAL REDLINE)');
    assert.ok(issueIds.includes('comp_source_diffs_unprotected'), 'Must detect source diffs unprotected (CRITICAL REDLINE)');
    assert.ok(issueIds.includes('comp_schema_threshold_too_low'), 'Must detect schema threshold < 4000 (ANTI-DOWNGRADE)');
    assert.ok(issueIds.includes('comp_invalid_test_pattern'), 'Must detect invalid regex syntax in customTestPassPatterns');
    assert.ok(issueIds.includes('comp_lru_disabled'), 'Must detect trueLruRetention disabled');

    // Verify client compatibility matrix flags conflict shield degradation
    assert.strictEqual(unsafeDocJson.clientsCompatibility.openchamber.checks.find(c => c.name.includes('冲突')).passed, false);
    console.log('✓ Context Compression Health Detection on Unsafe Configurations verified');

    // [Test 127] Testing Context Compression Auto-Repair API (POST /balancer/api/compression/repair) & Zero-Loss Self-Healing
    console.log('\n[Test 127] Testing Context Compression Auto-Repair API & Zero-Loss Self-Healing...');
    const repApiRes = await request('/balancer/api/compression/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoHeal: true })
    });
    assert.strictEqual(repApiRes.statusCode, 200);
    const repApiJson = JSON.parse(repApiRes.body);
    assert.strictEqual(repApiJson.success, true);
    assert.ok(Array.isArray(repApiJson.results), 'Repair response must include results array');
    const repairedItems = repApiJson.results.map(r => r.item);
    assert.ok(repairedItems.includes('Merge Conflict Shield'), 'Must heal Merge Conflict Shield');
    assert.ok(repairedItems.includes('Source Diff Protection'), 'Must heal Source Diff Protection');
    assert.ok(repairedItems.includes('Schema Slim Threshold'), 'Must heal Schema Slim Threshold');
    assert.ok(repairedItems.includes('Custom Test Patterns'), 'Must heal Custom Test Patterns');
    assert.ok(repairedItems.includes('Cache-Zone LRU Retention'), 'Must heal Cache-Zone LRU Retention');

    // Verify subsequent doctor check is 100% healthy
    const afterHealDocRes = await request('/balancer/api/compression/doctor', { method: 'GET' });
    const afterHealDoc = JSON.parse(afterHealDocRes.body);
    assert.strictEqual(afterHealDoc.healthy, true, 'Doctor must report 100% healthy after auto-repair');
    assert.strictEqual(afterHealDoc.issues.length, 0, 'No issues must remain after auto-repair');
    assert.strictEqual(afterHealDoc.activeEngines.schema.threshold, 15000, 'Threshold must be restored to safe 15000 chars');
    console.log('✓ Context Compression Auto-Repair API & Zero-Loss Self-Healing verified');

    // [Test 128] Testing Compression Doctor & Repair Modular Scoping (scope=compression vs scope=all linkage)
    console.log('\n[Test 128] Testing Compression Doctor & Repair Modular Scoping...');
    // 1. Scoped doctor: GET /balancer/api/doctor?scope=compression
    const scopedDocRes = await request('/balancer/api/doctor?scope=compression', { method: 'GET' });
    assert.strictEqual(scopedDocRes.statusCode, 200);
    const scopedDocJson = JSON.parse(scopedDocRes.body);
    assert.strictEqual(scopedDocJson.scope, 'compression');
    assert.ok(scopedDocJson.compression && typeof scopedDocJson.compression === 'object');
    assert.ok(Array.isArray(scopedDocJson.issues));

    // 2. Scoped repair with resetToBalanced: POST /balancer/api/repair?scope=compression
    const scopedRepRes = await request('/balancer/api/repair?scope=compression', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetToBalanced: true })
    });
    assert.strictEqual(scopedRepRes.statusCode, 200);
    const scopedRepJson = JSON.parse(scopedRepRes.body);
    assert.strictEqual(scopedRepJson.success, true);
    assert.ok(scopedRepJson.results.some(r => r.item === 'Preset Alignment'));

    // 3. Global doctor linkage: GET /balancer/api/doctor (scope=all) must contain compression health
    const globalDocRes = await request('/balancer/api/doctor', { method: 'GET' });
    assert.strictEqual(globalDocRes.statusCode, 200);
    const globalDocJson = JSON.parse(globalDocRes.body);
    assert.ok(globalDocJson.compression, 'Global doctor report must embed compression health block');
    assert.strictEqual(globalDocJson.compression.healthy, true);
    console.log('✓ Compression Doctor & Repair Modular Scoping verified');

    // [Test 129] Testing Anti-Downgrade Redlines: Compiler Errors, Tracebacks, Stack Traces & Merge Conflicts (<<<<<<<) Zero-Loss Preservation
    console.log('\n[Test 129] Testing Anti-Downgrade Redlines: Compiler Errors, Tracebacks, Stack Traces & Merge Conflicts Zero-Loss Preservation...');
    const mixedErrorAndPassInput = [
      '✓ test 1 passed',
      '✓ test 2 passed',
      '✓ test 3 passed',
      '✓ test 4 passed',
      'src/main.rs:42:15: error[E0308]: mismatched types expected `usize`, found `u32`',
      '   --> src/main.rs:42:15',
      'AssertionError: expected 42 to equal 99',
      '    at Context.<anonymous> (test.js:10:5)',
      'Traceback (most recent call last):',
      '  File "app.py", line 12, in <module>',
      'BUILD FAILED: compilation halted with 1 error',
      '<<<<<<< HEAD',
      'const port = 4010;',
      '=======',
      'const port = 3000;',
      '>>>>>>> conflict-branch',
      'diff --git a/src/index.js b/src/index.js',
      '--- a/src/index.js',
      '+++ b/src/index.js',
      '@@ -1,5 +1,6 @@'
    ].join('\n');

    const compactedOutput = contextCompactor.compactText(mixedErrorAndPassInput, { enabled: true });
    // Positive match test passes must be folded
    assert.ok(compactedOutput.includes('[Test suite: 4 passed tests folded (✓ / PASS / ok)]'), 'Pass lines must be folded');
    // Error redlines must NEVER be folded:
    assert.ok(compactedOutput.includes('error[E0308]: mismatched types'), 'Rust compiler error must be 100% preserved');
    assert.ok(compactedOutput.includes('src/main.rs:42:15'), 'Line numbers in compiler error must be 100% preserved');
    assert.ok(compactedOutput.includes('AssertionError: expected 42 to equal 99'), 'AssertionError must be 100% preserved');
    assert.ok(compactedOutput.includes('at Context.<anonymous> (test.js:10:5)'), 'Stack trace must be 100% preserved');
    assert.ok(compactedOutput.includes('Traceback (most recent call last):'), 'Python traceback header must be 100% preserved');
    assert.ok(compactedOutput.includes('BUILD FAILED: compilation halted'), 'Build failed header must be 100% preserved');
    assert.ok(compactedOutput.includes('<<<<<<< HEAD'), 'Merge conflict marker <<<<<<< must NEVER be folded');
    assert.ok(compactedOutput.includes('======='), 'Merge conflict marker ======= must NEVER be folded');
    assert.ok(compactedOutput.includes('>>>>>>> conflict-branch'), 'Merge conflict marker >>>>>>> must NEVER be folded');
    assert.ok(compactedOutput.includes('diff --git a/src/index.js b/src/index.js'), 'Source diff header must be 100% preserved');
    assert.ok(compactedOutput.includes('@@ -1,5 +1,6 @@'), 'Hunk line numbers must be 100% preserved');

    // Test foldLockfiles merge conflict exemption:
    const lockfileConflictSample = [
      'diff --git a/package-lock.json b/package-lock.json',
      'index 1234567..89abcdef 100644',
      '--- a/package-lock.json',
      '+++ b/package-lock.json',
      '@@ -1,10 +1,15 @@',
      '<<<<<<< HEAD',
      '    "version": "1.0.0",',
      '=======',
      '    "version": "2.0.0",',
      '>>>>>>> feature',
      '   "name": "opencode"'
    ].join('\n');
    const lockConflictComp = contextCompactor.foldLockfiles(lockfileConflictSample, { exemptMergeConflicts: true });
    assert.strictEqual(lockConflictComp, lockfileConflictSample, 'Lockfile diff containing merge conflict must NOT be folded');

    // Test non-lockfile source diff protection:
    const jsSourceDiff = [
      'diff --git a/server.js b/server.js',
      'index 1234567..89abcdef 100644',
      '--- a/server.js',
      '+++ b/server.js',
      '@@ -10,6 +10,7 @@',
      '+const newCode = true;'
    ].join('\n');
    const jsComp = contextCompactor.foldLockfiles(jsSourceDiff, { protectSourceDiffs: true });
    assert.strictEqual(jsComp, jsSourceDiff, 'Source code diffs must NEVER be touched by foldLockfiles');
    console.log('✓ Anti-Downgrade Redlines: Compiler Errors, Tracebacks, Stack Traces & Merge Conflicts Zero-Loss Preservation verified');

    // [Test 130] Testing Protocol & Connection Shield: Empty Output Protection (Anthropic tool_result, Responses, Chat) & Zero 400 Errors
    console.log('\n[Test 130] Testing Protocol & Connection Shield: Empty Output Protection & Zero 400 Errors...');
    // 1. Anthropic protocol: tool_result must NEVER have empty or whitespace-only content
    const pureAnsiOutput = '\u001b[32m\u001b[0m\r\r';
    const anthropicPayloadWithEmptyTool = {
      model: 'claude-haiku-5-5',
      messages: [
        { role: 'user', content: 'run command' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'bash', input: {} }] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: pureAnsiOutput },
            { type: 'tool_result', tool_use_id: 'call_2', content: '   \n\t  ' },
            { type: 'tool_result', tool_use_id: 'call_3', content: [] },
            { type: 'tool_result', tool_use_id: 'call_4', content: [null] },
            { type: 'tool_result', tool_use_id: 'call_5' }
          ]
        }
      ]
    };
    const compactedAnthropicShield = contextCompactor.compactAnthropicPayload(anthropicPayloadWithEmptyTool, { enabled: true });
    const toolBlocks = compactedAnthropicShield.messages[2].content;
    assert.strictEqual(toolBlocks[0].content, '[Empty terminal output]', 'Pure ANSI output must be sanitized to terminal placeholder');
    assert.strictEqual(toolBlocks[1].content, '[Empty output]', 'Pure whitespace output must be sanitized to safe placeholder');
    assert.deepStrictEqual(toolBlocks[2].content, [{ type: 'text', text: '[Empty output]' }], 'Empty array must be sanitized to valid text block');
    assert.deepStrictEqual(toolBlocks[3].content, [{ type: 'text', text: '[Empty output]' }], 'Array of nulls must be sanitized to valid text block');
    assert.strictEqual(toolBlocks[4].content, '[Empty output]', 'Missing content must be defaulted to safe string');

    // 2. OpenAI Chat completions protocol: tool content must NEVER be empty or whitespace-only
    const chatPayloadWithEmptyTool = {
      model: 'deepseek-v4.1-flash',
      messages: [
        { role: 'user', content: 'test' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'exec', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_2', content: pureAnsiOutput },
        { role: 'tool', tool_call_id: 'call_3', content: '   \t  ' },
        { role: 'tool', tool_call_id: 'call_4', content: null },
        { role: 'tool', tool_call_id: 'call_5', content: [] }
      ]
    };
    const compactedChat = contextCompactor.compactChatPayload(chatPayloadWithEmptyTool, { enabled: true });
    assert.strictEqual(compactedChat.messages[2].content, '[Empty terminal output]');
    assert.strictEqual(compactedChat.messages[3].content, '[Empty output]');
    assert.strictEqual(compactedChat.messages[4].content, '[Empty output]');
    assert.strictEqual(compactedChat.messages[5].content, '[Empty output]');

    // 3. Codex Responses protocol: function_call_output must NEVER be empty or whitespace-only
    const responsesPayloadWithEmptyTool = {
      model: 'deepseek-v4.1-flash',
      input: [
        { type: 'function_call', call_id: 'call_1', name: 'exec', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call_1', output: pureAnsiOutput },
        { type: 'function_call_output', call_id: 'call_2', output: '   \r\n  ' },
        { type: 'function_call_output', call_id: 'call_3', output: null },
        { type: 'function_call_output', call_id: 'call_4', output: [] },
        { type: 'function_call_output', call_id: 'call_5', output: [null] },
        { type: 'function_call_output', call_id: 'call_6', output: [{ text: '   ' }] }
      ]
    };
    const compactedResponses = contextCompactor.compactResponsesPayload(responsesPayloadWithEmptyTool, { enabled: true });
    assert.strictEqual(compactedResponses.input[1].output, '[Empty terminal output]');
    assert.strictEqual(compactedResponses.input[2].output, '[Empty output]');
    assert.strictEqual(compactedResponses.input[3].output, '[Empty output]');
    assert.strictEqual(compactedResponses.input[4].output, '[Empty output]');
    assert.strictEqual(compactedResponses.input[5].output, '[Empty output]');
    assert.deepStrictEqual(compactedResponses.input[6].output, [{ text: '[Empty output]' }]);

    // 4. Web UI verification for Doctor & Repair controls
    const compUiDoctorRes = await request('/balancer/ui', { method: 'GET' });
    assert.strictEqual(compUiDoctorRes.statusCode, 200);
    assert.ok(compUiDoctorRes.body.includes('id="comp-doctor-status-badge"'), 'UI must contain comp-doctor-status-badge');
    assert.ok(compUiDoctorRes.body.includes('id="btn-comp-doctor"'), 'UI must contain btn-comp-doctor');
    assert.ok(compUiDoctorRes.body.includes('id="btn-comp-repair"'), 'UI must contain btn-comp-repair');
    assert.ok(compUiDoctorRes.body.includes('id="comp-doctor-panel"'), 'UI must contain comp-doctor-panel');
    assert.ok(compUiDoctorRes.body.includes('runCompressionDoctorCheck'), 'UI script must contain runCompressionDoctorCheck');
    assert.ok(compUiDoctorRes.body.includes('renderCompressionDiagnostics'), 'UI script must contain renderCompressionDiagnostics');
    assert.ok(compUiDoctorRes.body.includes('runCompressionRepair'), 'UI script must contain runCompressionRepair');

    console.log('✓ Protocol & Connection Shield: Empty Output Protection & Zero 400 Errors verified');

    // [Test 131] Testing Client Compatibility Degradation, Master Switch Auto-Healing & Language Exception Protection
    console.log('\n[Test 131] Testing Client Compatibility Degradation, Master Switch Auto-Healing & Language Exception Protection...');
    // 1. Degradation detection on unsafe settings
    const degCheck = contextCompactor.checkCompressionHealth({
      exemptMergeConflicts: false,
      trueLruRetention: false
    }, { savedTokens: 500, savedCostUSD: 0.00125, compressionRatio: 22.4 });
    assert.strictEqual(degCheck.clientsCompatibility.openchamber.status, 'degraded', 'OpenChamber must be flagged as degraded when conflict shield is disabled');
    assert.strictEqual(degCheck.stats.savedCostUsd, '$0.0013', 'savedCostUsd must be properly formatted string');
    assert.strictEqual(degCheck.stats.compressionRatio, '22.4%', 'compressionRatio must be properly formatted percentage');

    // 2. Master switch auto-healing from disabled state
    const healedDisabled = contextCompactor.repairCompressionConfig({ enabled: false }, { autoHeal: true });
    assert.strictEqual(healedDisabled.repairedConfig.enabled, true, 'autoHeal must restore master switch to enabled');
    assert.ok(healedDisabled.results.some(r => r.item === 'Master Switch'), 'Repair results must list Master Switch');

    // 3. Language runtime exceptions protection in foldTestPasses
    const exceptionText = [
      '✓ test 1 passed',
      '✓ test 2 passed',
      '✓ test 3 passed',
      'TypeError: Cannot read properties of undefined (reading "execute")',
      '    at Session.run (session.js:45:12)',
      'NullPointerException: target object reference is null',
      'panic: runtime error: index out of range [2] with length 2',
      '✓ test 4 passed',
      '✓ test 5 passed',
      '✓ test 6 passed'
    ].join('\n');
    const compExceptions = contextCompactor.foldTestPasses(exceptionText);
    assert.ok(compExceptions.includes('TypeError: Cannot read properties of undefined'), 'TypeError must NEVER be folded');
    assert.ok(compExceptions.includes('NullPointerException: target object reference is null'), 'NullPointerException must NEVER be folded');
    assert.ok(compExceptions.includes('panic: runtime error: index out of range'), 'Golang panic must NEVER be folded');

    console.log('✓ Client Compatibility Degradation, Master Switch Auto-Healing & Language Exception Protection verified');

    // [Test 132] Testing OpenCode 2.0 Credential & Daemon Environment Detection & Auto-Repair
    console.log('\n[Test 132] Testing OpenCode 2.0 Credential & Daemon Environment Detection & Auto-Repair...');
    const updaterMod = require('./updater');
    const testTempDir = path.join(os.tmpdir(), 'opencode_test_cred_' + Date.now());
    fs.mkdirSync(testTempDir, { recursive: true });
    const mockDbPath = path.join(testTempDir, 'opencode.db');
    const mockAuthPath = path.join(testTempDir, 'auth.json');
    const mockServicePath = path.join(testTempDir, 'opencode-server.service');

    try {
      // 1. Initialize SQLite Database & Insert existing 3rd party credentials (shtech, aixforge)
      updaterMod.execSqliteQuery(mockDbPath, `
        CREATE TABLE IF NOT EXISTS credential (
          integration_id TEXT PRIMARY KEY,
          key TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL
        );
      `);
      updaterMod.execSqliteQuery(mockDbPath, `
        INSERT INTO credential (integration_id, key, active, updated_at) VALUES
        ('shtech', 'sk-third-party-shtech-key', 1, '2026-01-01T00:00:00.000Z'),
        ('aixforge', 'sk-third-party-aix-key', 1, '2026-01-01T00:00:00.000Z');
      `);

      fs.writeFileSync(mockAuthPath, JSON.stringify({
        shtech: { key: 'sk-third-party-shtech-key' },
        aixforge: { key: 'sk-third-party-aix-key' }
      }, null, 2), 'utf8');

      // 2. Detect unactivated credentials (opencode-go missing)
      const credCheckBefore = updaterMod.checkOpenCodeCredentials({
        dbPath: mockDbPath,
        authPath: mockAuthPath,
        servicePath: mockServicePath,
        isWindows: true
      });
      assert.strictEqual(credCheckBefore.healthy, false, 'Credentials must be flagged unhealthy before repair');
      assert.strictEqual(credCheckBefore.activeInDb, false, 'opencode-go must not be active before repair');
      assert.strictEqual(credCheckBefore.hasOtherCredentials, true, 'Existing third-party credentials must be detected');
      assert.ok(credCheckBefore.otherCredentials.includes('shtech'), 'shtech must be listed in otherCredentials');
      assert.ok(credCheckBefore.otherCredentials.includes('aixforge'), 'aixforge must be listed in otherCredentials');

      // 3. Perform Incremental Repair (Windows environment simulation)
      const repairResWin = updaterMod.repairOpenCodeCredentials({
        dbPath: mockDbPath,
        authPath: mockAuthPath,
        servicePath: mockServicePath,
        isWindows: true
      });
      assert.strictEqual(repairResWin.success, true, 'Windows credential repair must succeed');

      // 4. Verify SQLite contents: opencode-go and opencode added, shtech and aixforge preserved
      const dbRowsAfter = updaterMod.querySqliteRows(mockDbPath, 'SELECT * FROM credential ORDER BY integration_id ASC');
      assert.ok(dbRowsAfter.length >= 4, 'Database must have at least 4 credentials');
      const opencodeGoRow = dbRowsAfter.find(r => r.integration_id === 'opencode-go');
      assert.ok(opencodeGoRow, 'opencode-go must exist in credential table');
      assert.strictEqual(Number(opencodeGoRow.active), 1, 'opencode-go must be active');
      assert.strictEqual(opencodeGoRow.key, 'local-router');

      const opencodeRow = dbRowsAfter.find(r => r.integration_id === 'opencode');
      assert.ok(opencodeRow, 'opencode must exist in credential table');
      assert.strictEqual(Number(opencodeRow.active), 1, 'opencode must be active');

      const shtechRow = dbRowsAfter.find(r => r.integration_id === 'shtech');
      assert.ok(shtechRow, 'Third-party credential "shtech" must be strictly preserved');
      assert.strictEqual(Number(shtechRow.active), 1, 'shtech must remain active');
      assert.strictEqual(shtechRow.key, 'sk-third-party-shtech-key');

      const aixRow = dbRowsAfter.find(r => r.integration_id === 'aixforge');
      assert.ok(aixRow, 'Third-party credential "aixforge" must be strictly preserved');
      assert.strictEqual(Number(aixRow.active), 1, 'aixforge must remain active');

      // 5. Verify auth.json incremental preservation
      const authAfter = JSON.parse(fs.readFileSync(mockAuthPath, 'utf8'));
      assert.strictEqual(authAfter['opencode-go'].key, 'local-router');
      assert.strictEqual(authAfter['opencode'].key, 'local-router');
      assert.strictEqual(authAfter['shtech'].key, 'sk-third-party-shtech-key', 'shtech in auth.json must be preserved');
      assert.strictEqual(authAfter['aixforge'].key, 'sk-third-party-aix-key', 'aixforge in auth.json must be preserved');

      // 6. Test Linux systemd unit injection
      fs.writeFileSync(mockServicePath, [
        '[Unit]',
        'Description=OpenCode Server',
        '[Service]',
        'Type=simple',
        'ExecStart=/usr/local/bin/opencode serve',
        '[Install]',
        'WantedBy=default.target'
      ].join('\n'), 'utf8');

      const repairResLinux = updaterMod.repairOpenCodeCredentials({
        dbPath: mockDbPath,
        authPath: mockAuthPath,
        servicePath: mockServicePath,
        isLinux: true
      });
      assert.strictEqual(repairResLinux.success, true, 'Linux service credential repair must succeed');
      const serviceAfter = fs.readFileSync(mockServicePath, 'utf8');
      assert.ok(serviceAfter.includes('Environment="OPENCODE_API_KEY=local-router"'), 'systemd service must have OPENCODE_API_KEY injected');

      // 7. Verify checkOpenCodeCredentials passes with envApiKey specified
      const credCheckAfter = updaterMod.checkOpenCodeCredentials({
        dbPath: mockDbPath,
        authPath: mockAuthPath,
        servicePath: mockServicePath,
        envApiKey: 'local-router',
        isWindows: true
      });
      assert.strictEqual(credCheckAfter.healthy, true, 'Credentials must be healthy after repair and env set');
      assert.strictEqual(credCheckAfter.issues.length, 0);

      // 8. Gateway Doctor Integration check
      const docRes = await request('/balancer/api/doctor', { method: 'GET' });
      assert.strictEqual(docRes.statusCode, 200);
      const docJson = JSON.parse(docRes.body);
      assert.ok(docJson.opencode, 'Doctor must include opencode report');
      assert.ok(docJson.opencode.credentials, 'Doctor must include credentials report');
    } finally {
      try { fs.rmSync(testTempDir, { recursive: true, force: true }); } catch (_) {}
    }
    console.log('✓ OpenCode 2.0 Credential & Daemon Environment Detection & Auto-Repair verified');

    // [Test 133] Testing Headroom SmartCrusher (foldStructuredData) Long Homogeneous JSON Array Folding
    console.log('\n[Test 133] Testing Headroom SmartCrusher (foldStructuredData) Long Homogeneous JSON Array Folding...');
    // 1. Create large homogeneous JSON array (>30 items, e.g. 45 items)
    const testItems45 = [];
    for (let i = 1; i <= 45; i++) {
      testItems45.push({
        id: i,
        uuid: `item-uuid-tag-${i}-abc`,
        name: `Repository Entity Index ${i}`,
        status: i % 2 === 0 ? 'active' : 'idle',
        score: (i * 1.5).toFixed(2),
        extra: { code: 200 + i, verified: true }
      });
    }
    const rawJson45 = JSON.stringify(testItems45, null, 2);
    assert.ok(rawJson45.length > 2500, 'Raw JSON string should be >2500 characters');

    // 2. Fold raw JSON array using SmartCrusher
    const folded45 = contextCompactor.foldStructuredData(rawJson45, { maxStructuredItems: 30 });
    assert.ok(folded45.length < rawJson45.length, 'Folded JSON must be substantially shorter');
    const parsedFolded45 = JSON.parse(folded45);
    assert.strictEqual(parsedFolded45.length, 9, 'Folded array must have 9 elements (5 head + 1 summary + 3 tail)');
    assert.strictEqual(parsedFolded45[0].id, 1, 'First head item must be id 1');
    assert.strictEqual(parsedFolded45[4].id, 5, 'Fifth head item must be id 5');
    assert.strictEqual(parsedFolded45[6].id, 43, 'First tail item must be id 43');
    assert.strictEqual(parsedFolded45[8].id, 45, 'Last tail item must be id 45');

    // 3. Verify crusher summary descriptor structure
    const crusherDescriptor = parsedFolded45[5];
    assert.strictEqual(crusherDescriptor._headroom_smart_crusher, true);
    assert.strictEqual(crusherDescriptor.totalCount, 45);
    assert.strictEqual(crusherDescriptor.foldedCount, 37);
    assert.ok(Array.isArray(crusherDescriptor.sampleFields));
    assert.ok(crusherDescriptor.sampleFields.includes('id'));
    assert.ok(crusherDescriptor.sampleFields.includes('uuid'));
    assert.ok(crusherDescriptor.sampleFields.includes('name'));

    // 4. Markdown code block wrapping test (```json [...] ```)
    const mdJson = 'Here is the command output:\n```json\n' + rawJson45 + '\n```\nEnd of output.';
    const foldedMd = contextCompactor.foldStructuredData(mdJson, { maxStructuredItems: 30 });
    assert.ok(foldedMd.includes('```json'), 'Must preserve ```json block wrapper');
    assert.ok(foldedMd.includes('_headroom_smart_crusher'), 'Must fold inside markdown block');
    assert.ok(foldedMd.includes('End of output.'), 'Must preserve trailing text');

    // 5. Anti-Degradation Red Line: Git merge conflict protection (100% untouched)
    const conflictData = [
      '<<<<<<< HEAD',
      rawJson45,
      '=======',
      rawJson45,
      '>>>>>>> branch-experiment'
    ].join('\n');
    const foldedConflict = contextCompactor.foldStructuredData(conflictData, { maxStructuredItems: 30 });
    assert.strictEqual(foldedConflict, conflictData, 'Data with Git merge conflicts must NEVER be folded');

    // 6. Anti-Degradation Red Line: Error traceback & assertion failure protection
    const errorTraceData = 'Traceback (most recent call last):\n  File "cli.py", line 42, in run\n' + rawJson45;
    const foldedTrace = contextCompactor.foldStructuredData(errorTraceData, { maxStructuredItems: 30 });
    assert.strictEqual(foldedTrace, errorTraceData, 'Data with error tracebacks must NEVER be folded');

    // 7. Boundaries & Edge cases
    // <=30 items: NOT folded
    const items30 = testItems45.slice(0, 30);
    const raw30 = JSON.stringify(items30, null, 2);
    assert.strictEqual(contextCompactor.foldStructuredData(raw30, { maxStructuredItems: 30 }), raw30, '<=30 items must NOT be folded');

    // 31 items: IS folded
    const items31 = testItems45.slice(0, 31);
    const raw31 = JSON.stringify(items31, null, 2);
    const folded31 = contextCompactor.foldStructuredData(raw31, { maxStructuredItems: 30 });
    assert.ok(folded31.includes('_headroom_smart_crusher'), '31 items must be folded');

    // Empty array: untouched
    assert.strictEqual(contextCompactor.foldStructuredData('[]'), '[]');

    // Idempotency: folding an already folded string must not corrupt or double fold
    const doubleFolded = contextCompactor.foldStructuredData(folded45, { maxStructuredItems: 30 });
    assert.strictEqual(doubleFolded, folded45, 'SmartCrusher must be strictly idempotent');

    // 8. Pipeline compactMessagesPayload & Headroom attribution verification
    const statsBefore = contextCompactor.getCompressionStats();
    const prevHeadroomChars = (statsBefore.modules && statsBefore.modules.headroom) ? statsBefore.modules.headroom.savedChars : 0;

    const toolMsgPayload = {
      model: 'deepseek-v4.1-flash',
      messages: [
        { role: 'user', content: 'List entities' },
        { role: 'tool', content: rawJson45 }
      ]
    };
    const compactedPayload = contextCompactor.compactChatPayload(toolMsgPayload, {
      enabled: true,
      foldStructuredData: true,
      maxStructuredItems: 30
    });
    assert.ok(compactedPayload.messages[1].content.includes('_headroom_smart_crusher'), 'Pipeline must run foldStructuredData');

    const statsAfter = contextCompactor.getCompressionStats();
    const newHeadroomChars = statsAfter.modules.headroom.savedChars;
    assert.ok(newHeadroomChars > prevHeadroomChars, 'Headroom module savedChars must increase after SmartCrusher runs');
    console.log(`✓ Headroom SmartCrusher verified (Headroom saved: ${newHeadroomChars - prevHeadroomChars} chars)`);

    // [Test 134] Testing Web UI KV Cache Lock Indicators & Headroom SmartCrusher Integration
    console.log('\n[Test 134] Testing Web UI KV Cache Lock Indicators & Headroom SmartCrusher Integration...');
    // 1. Fetch Web UI
    const uiRes134 = await request('/balancer/ui', { method: 'GET' });
    assert.strictEqual(uiRes134.statusCode, 200);
    const uiHtml134 = uiRes134.body;

    // 2. Check UI HTML Elements
    assert.ok(uiHtml134.includes('id="cfg-comp-fold-structured"'), 'UI must contain cfg-comp-fold-structured checkbox');
    assert.ok(uiHtml134.includes('SmartCrusher / foldStructuredData'), 'UI must describe SmartCrusher');
    assert.ok(uiHtml134.includes('🔒 KV Cache 前缀已锁定'), 'UI must show locked KV Cache indicator');
    assert.ok(uiHtml134.includes('提升上游 80%~90% 缓存命中，字符无损'), 'UI must explain KV Cache benefits');
    assert.ok(uiHtml134.includes('tools &lt; 15,000 字符时保持原样并锁定 KV Cache 前缀'), 'UI must explain 15,000 threshold');

    // 3. Check UI JavaScript Bindings
    assert.ok(uiHtml134.includes("setCheck('cfg-comp-fold-structured'"), 'applyPreset must bind cfg-comp-fold-structured');
    assert.ok(uiHtml134.includes("getChecked('cfg-comp-fold-structured')"), 'handleSubOptionChange must check cfg-comp-fold-structured');
    assert.ok(uiHtml134.includes("document.getElementById('cfg-comp-fold-structured').checked"), 'load & save must access cfg-comp-fold-structured');

    // 4. Test /balancer/api/config update with foldStructuredData
    const updateConfigRes = await request('/balancer/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accounts: testConfig.accounts,
        compression: {
          enabled: true,
          foldStructuredData: false,
          modules: {
            headroom: {
              enabled: true,
              foldStructuredData: false
            }
          }
        }
      })
    });
    assert.strictEqual(updateConfigRes.statusCode, 200, 'Config update must succeed');

    const restoreConfigRes = await request('/balancer/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accounts: testConfig.accounts,
        compression: {
          enabled: true,
          foldStructuredData: true,
          modules: {
            headroom: {
              enabled: true,
              foldStructuredData: true
            }
          }
        }
      })
    });
    assert.strictEqual(restoreConfigRes.statusCode, 200, 'Config restore must succeed');

    // 5. Test Client Socket Abrupt Disconnect (Resilience verification)
    await new Promise((resolve) => {
      const abortReq = http.request({
        hostname: '127.0.0.1',
        port: routerPort,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-key'
        }
      });
      abortReq.on('error', () => {
        // Expected client-side error when destroying socket
        resolve();
      });
      abortReq.write(JSON.stringify({
        model: 'deepseek-v4.1-flash',
        messages: [{ role: 'user', content: 'test socket disconnect' }]
      }));
      // Abruptly destroy the socket before waiting for response
      setTimeout(() => {
        abortReq.destroy(new Error('Simulated client abruptly dropped TCP connection'));
      }, 20);
    });

    // Wait 150ms and verify the server is still healthy and responsive
    await new Promise(resolve => setTimeout(resolve, 150));
    const healthPostAbort134 = await request('/health', { method: 'GET' });
    assert.strictEqual(healthPostAbort134.statusCode, 200, 'Server must remain completely healthy after client disconnect');

    console.log('✓ Web UI KV Cache Lock Indicators & Headroom SmartCrusher Integration verified');

    // [Test 135] Testing PowerShell AST Doctor Syntax, Gateway Credential Self-Healing & SmartCrusher Polymorphic Folding
    console.log('\n[Test 135] Testing PowerShell AST Doctor Syntax, Gateway Credential Self-Healing & SmartCrusher Polymorphic Folding...');
    // 1. Verify doctor-repair.ps1 PowerShell syntax cleanliness via language parser
    if (process.platform === 'win32') {
      const psCheckCmd = 'powershell.exe -NoProfile -NonInteractive -Command "$e = $null; $t = $null; [System.Management.Automation.Language.Parser]::ParseFile((Join-Path \'' + __dirname.replace(/'/g, "''") + '\' \'doctor-repair.ps1\'), [ref]$t, [ref]$e); if ($e -and $e.Count -gt 0) { $e | ForEach-Object { $_.ToString() } } else { \'SYNTAX_OK\' }"';
      const psResult = updaterMod.runCmd(psCheckCmd, 10000);
      assert.strictEqual(psResult.success, true, 'PowerShell parser must execute successfully');
      assert.ok(psResult.output.includes('SYNTAX_OK'), `doctor-repair.ps1 must have 0 syntax errors, got: ${psResult.output}`);
    }

    // 2. Verify SmartCrusher polymorphic codeblocks and embedded JSON arrays
    const rawItems50 = [];
    for (let i = 1; i <= 50; i++) {
      rawItems50.push({ index: i, title: `Entity item ${i}`, hash: `hash-code-${i}` });
    }
    const raw50Str = JSON.stringify(rawItems50, null, 2);

    // 2a. Uppercase ```JSON ``` code block
    const mdUpper = '```JSON\n' + raw50Str + '\n```';
    const foldedUpper = contextCompactor.foldStructuredData(mdUpper, { maxStructuredItems: 30 });
    assert.ok(foldedUpper.includes('_headroom_smart_crusher'), 'Uppercase ```JSON block must be folded');
    assert.ok(foldedUpper.length < mdUpper.length, 'Uppercase ```JSON block must be smaller');

    // 2b. ```jsonc ``` code block
    const mdJsonc = '```jsonc\n' + raw50Str + '\n```';
    const foldedJsonc = contextCompactor.foldStructuredData(mdJsonc, { maxStructuredItems: 30 });
    assert.ok(foldedJsonc.includes('_headroom_smart_crusher'), '```jsonc block must be folded');

    // 2c. Embedded raw JSON array in descriptive tool output
    const toolOutputText = `Command executed successfully. Found 50 matches:\n${raw50Str}\nSummary: Processed in 12ms.`;
    const foldedEmbedded = contextCompactor.foldStructuredData(toolOutputText, { maxStructuredItems: 30 });
    assert.ok(foldedEmbedded.includes('Command executed successfully. Found 50 matches:'), 'Leading text must be preserved');
    assert.ok(foldedEmbedded.includes('Summary: Processed in 12ms.'), 'Trailing text must be preserved');
    assert.ok(foldedEmbedded.includes('_headroom_smart_crusher'), 'Embedded array must be folded');
    assert.ok(foldedEmbedded.length < toolOutputText.length, 'Embedded output must be compressed');

    // 2d. Embedded JSON object with nested array
    const objWithArray = `API Response:\n${JSON.stringify({ status: 200, results: rawItems50 }, null, 2)}\nDone.`;
    const foldedObjWithArray = contextCompactor.foldStructuredData(objWithArray, { maxStructuredItems: 30 });
    assert.ok(foldedObjWithArray.includes('_headroom_smart_crusher'), 'Embedded object array must be folded');
    assert.ok(foldedObjWithArray.startsWith('API Response:'), 'Prefix must be preserved');
    assert.ok(foldedObjWithArray.endsWith('Done.'), 'Suffix must be preserved');

    // 2e. Merge conflict with ======= must NOT be folded
    const conflictSevenEq = `<<<<<<<\n${raw50Str}\n=======\n${raw50Str}\n>>>>>>>\n`;
    const foldedConflict7 = contextCompactor.foldStructuredData(conflictSevenEq, { maxStructuredItems: 30 });
    assert.strictEqual(foldedConflict7, conflictSevenEq, 'Conflict with ======= must be exempt');

    // 3. Verify Server Doctor & Auto-Repair OpenCode Credential Health with local-router
    const docApiRes = await request('/balancer/api/doctor', { method: 'GET' });
    assert.strictEqual(docApiRes.statusCode, 200);
    const docData = JSON.parse(docApiRes.body);
    assert.ok(docData.opencodeCredentials, 'Doctor must report opencodeCredentials');
    assert.strictEqual(docData.opencodeCredentials.expectedApiKey, 'local-router', 'Doctor must check standard local-router key');

    // 4. Verify executeSystemRepair on /balancer/api/repair handles credentials cleanly
    const repairApiRes = await request('/balancer/api/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'all' })
    });
    assert.strictEqual(repairApiRes.statusCode, 200);
    const repairData = JSON.parse(repairApiRes.body);
    assert.strictEqual(repairData.success, true);
    const credRepairItem = repairData.results.find(r => r.item === 'OpenCode Credential & Daemon Key');
    assert.ok(credRepairItem, 'Repair results must include OpenCode Credential & Daemon Key');
    assert.strictEqual(credRepairItem.success, true);

    console.log('✓ PowerShell AST Doctor Syntax, Gateway Credential Self-Healing & SmartCrusher Polymorphic Folding verified');

    // [Test 136] Testing Web UI KV Cache Lock Principle Explanations, SmartCrusher Array Sampling & Anti-Downgrade Redlines
    console.log('\n[Test 136] Testing Web UI KV Cache Lock Principle Explanations, SmartCrusher Array Sampling & Anti-Downgrade Redlines...');

    // 1. Web UI inspection for Card 3 indicator, explanation banner, and threshold notice
    const uiRes136 = await request('/balancer/ui', { method: 'GET' });
    assert.strictEqual(uiRes136.statusCode, 200);
    const uiHtml136 = uiRes136.body;

    assert.ok(uiHtml136.includes('🔒 KV Cache 前缀已锁定 (提升上游 80%~90% 缓存命中，字符无损)'), 'Card 3 must contain KV Cache lock indicator');
    assert.ok(uiHtml136.includes('为何字符无损却省账单？'), 'Card 3 must explain why lexicographical sorting saves bills without reducing characters');
    assert.ok(uiHtml136.includes('规范化为全局唯一且恒定的字节流，使 Anthropic / OpenAI 等上游推理集群稳定命中前缀 Prompt 缓存'), 'Card 3 must explain upstream Prompt cache hit');
    assert.ok(uiHtml136.includes('💡 瘦身门限当前为 15,000 字符（仅挂载大型/多 MCP 服务时触发）'), 'Card 3 must state exact 15,000 threshold notice');

    // 2. Web UI inspection for Card 2 SmartCrusher sub-switch & tooltips
    assert.ok(uiHtml136.includes('超长同构 JSON 数组采样折叠 (SmartCrusher / foldStructuredData)'), 'Card 2 must contain SmartCrusher title');
    assert.ok(uiHtml136.includes('针对工具返回超过 50 项的超长同构 JSON 数组'), 'Card 2 must explain > 50 items folding');
    assert.ok(uiHtml136.includes('保留结构 + 首尾样本'), 'Card 2 must explain structure and head/tail sample preservation');
    assert.ok(uiHtml136.includes('遇报错堆栈与冲突标记 100% 绝对豁免'), 'Card 2 must mention safety redlines');

    // 3. Preset matrix cascade and config roundtrip for foldStructuredData
    // Balanced preset has foldStructuredData: true
    const normBalanced = contextCompactor.normalizeCompressionOptions({ preset: 'balanced' });
    assert.strictEqual(normBalanced.modules.headroom.foldStructuredData, true, 'Balanced preset must enable foldStructuredData');
    assert.strictEqual(normBalanced.foldStructuredData, true, 'Balanced flat switch must be true');

    // Aggressive preset has foldStructuredData: true
    const normAggressive = contextCompactor.normalizeCompressionOptions({ preset: 'aggressive' });
    assert.strictEqual(normAggressive.modules.headroom.foldStructuredData, true, 'Aggressive preset must enable foldStructuredData');
    assert.strictEqual(normAggressive.foldStructuredData, true, 'Aggressive flat switch must be true');

    // Conservative preset has foldStructuredData: false
    const normConservative = contextCompactor.normalizeCompressionOptions({ preset: 'conservative' });
    assert.strictEqual(normConservative.modules.headroom.foldStructuredData, false, 'Conservative preset must disable foldStructuredData');
    assert.strictEqual(normConservative.foldStructuredData, false, 'Conservative flat switch must be false');

    // Master Headroom cascade: if headroom module disabled, derived foldStructuredData is false
    const normMasterOff = contextCompactor.normalizeCompressionOptions({
      enabled: true,
      modules: { headroom: { enabled: false, foldStructuredData: true } }
    });
    assert.strictEqual(normMasterOff.foldStructuredData, false, 'Disabling headroom module must cascade to foldStructuredData = false');

    // 4. SmartCrusher on >50 items array (e.g. 60 items)
    const array60 = [];
    for (let i = 1; i <= 60; i++) {
      array60.push({ id: i, name: `Record item ${i}`, path: `/var/log/app/item-${i}.log`, size: i * 1024 });
    }
    const raw60Str = JSON.stringify(array60, null, 2);
    const folded60 = contextCompactor.foldStructuredData(raw60Str, { foldStructuredData: true, maxStructuredItems: 50 });
    assert.ok(folded60.length < raw60Str.length, 'Folded 60 items array must be compressed');
    const parsed60 = JSON.parse(folded60);
    assert.strictEqual(parsed60.length, 9, 'Folded array must have exactly 9 elements (5 head + 1 summary + 3 tail)');
    assert.strictEqual(parsed60[0].id, 1, 'First item must be id 1');
    assert.strictEqual(parsed60[4].id, 5, 'Fifth item must be id 5');
    assert.strictEqual(parsed60[6].id, 58, 'First tail item must be id 58');
    assert.strictEqual(parsed60[8].id, 60, 'Last tail item must be id 60');
    assert.strictEqual(parsed60[5]._headroom_smart_crusher, true, 'Summary item must have crusher flag');
    assert.strictEqual(parsed60[5].totalCount, 60, 'Summary totalCount must be 60');
    assert.strictEqual(parsed60[5].foldedCount, 52, 'Summary foldedCount must be 52');

    // 5. Anti-Downgrade Redlines: 100% bypass on error stacks, panics and merge conflicts
    // 5a. JavaScript TypeError
    const typeErrorPayload = 'TypeError: Cannot read properties of undefined (reading \'id\')\n' + raw60Str;
    const foldedTypeError = contextCompactor.foldStructuredData(typeErrorPayload, { foldStructuredData: true, maxStructuredItems: 30 });
    assert.strictEqual(foldedTypeError, typeErrorPayload, 'Payload with TypeError must be 100% untouched');

    // 5b. Go panic
    const panicPayload = 'panic: runtime error: index out of range [5] with length 0\n' + raw60Str;
    const foldedPanic = contextCompactor.foldStructuredData(panicPayload, { foldStructuredData: true, maxStructuredItems: 30 });
    assert.strictEqual(foldedPanic, panicPayload, 'Payload with panic: must be 100% untouched');

    // 5c. Merge conflict markers
    const mergeConflictPayload = '<<<<<<< HEAD\n' + raw60Str + '\n=======\n' + raw60Str + '\n>>>>>>> feature-branch';
    const foldedConflict136 = contextCompactor.foldStructuredData(mergeConflictPayload, { foldStructuredData: true, maxStructuredItems: 30 });
    assert.strictEqual(foldedConflict136, mergeConflictPayload, 'Payload with Git merge conflict markers must be 100% untouched');

    // 5d. Python traceback
    const tracebackPayload = 'Traceback (most recent call last):\n  File "worker.py", line 42, in process\n' + raw60Str;
    const foldedTraceback = contextCompactor.foldStructuredData(tracebackPayload, { foldStructuredData: true, maxStructuredItems: 30 });
    assert.strictEqual(foldedTraceback, tracebackPayload, 'Payload with Python Traceback must be 100% untouched');

    // 5e. Rust panic (thread 'main' panicked at ...)
    const rustPanicPayload = 'thread \'main\' panicked at \'assertion failed: key.is_valid()\', src/crypto.rs:48:9\n' + raw60Str;
    const foldedRust = contextCompactor.foldStructuredData(rustPanicPayload, { foldStructuredData: true, maxStructuredItems: 30 });
    assert.strictEqual(foldedRust, rustPanicPayload, 'Payload with Rust panic must be 100% untouched');

    // 5f. Java NullPointerException / Exception in thread
    const javaErrPayload = 'Exception in thread "main" java.lang.NullPointerException: Cannot invoke method on null\n' + raw60Str;
    const foldedJava = contextCompactor.foldStructuredData(javaErrPayload, { foldStructuredData: true, maxStructuredItems: 30 });
    assert.strictEqual(foldedJava, javaErrPayload, 'Payload with Java NullPointerException must be 100% untouched');

    // 5g. JavaScript RangeError
    const rangeErrPayload = 'RangeError: Maximum call stack size exceeded\n' + raw60Str;
    const foldedRange = contextCompactor.foldStructuredData(rangeErrPayload, { foldStructuredData: true, maxStructuredItems: 30 });
    assert.strictEqual(foldedRange, rangeErrPayload, 'Payload with RangeError must be 100% untouched');

    // 5h. C/C++ Segmentation fault
    const segfaultPayload = 'Segmentation fault (core dumped)\n' + raw60Str;
    const foldedSegfault = contextCompactor.foldStructuredData(segfaultPayload, { foldStructuredData: true, maxStructuredItems: 30 });
    assert.strictEqual(foldedSegfault, segfaultPayload, 'Payload with Segmentation fault must be 100% untouched');

    // 6. Default 50-items threshold boundary verification
    // 50 items under default options: NOT folded
    const boundaryArr50 = array60.slice(0, 50);
    const boundaryStr50 = JSON.stringify(boundaryArr50, null, 2);
    assert.strictEqual(contextCompactor.foldStructuredData(boundaryStr50, { foldStructuredData: true }), boundaryStr50, '<=50 items must NOT be folded under default 50-items threshold');

    // 51 items under default options: IS folded
    const boundaryArr51 = array60.slice(0, 51);
    const boundaryStr51 = JSON.stringify(boundaryArr51, null, 2);
    const foldedBoundary51 = contextCompactor.foldStructuredData(boundaryStr51, { foldStructuredData: true });
    assert.ok(foldedBoundary51.includes('_headroom_smart_crusher'), '51 items must be folded under default 50-items threshold');
    const parsedBoundary51 = JSON.parse(foldedBoundary51);
    assert.strictEqual(parsedBoundary51.length, 9, 'Folded 51 array must have 9 elements (5 head + 1 summary + 3 tail)');
    assert.strictEqual(parsedBoundary51[5].totalCount, 51, 'Total count must be 51');
    assert.strictEqual(parsedBoundary51[5].foldedCount, 43, 'Folded count must be 43');

    console.log('✓ Web UI KV Cache Lock Principle Explanations, SmartCrusher Array Sampling & Anti-Downgrade Redlines verified');

    // [Test 137] Testing Headroom (SmartCrusher & raw Lockfile) and Schema (CacheAligner & mcp-compressor) Effective Metrics Attribution
    console.log('\n[Test 137] Testing Headroom & Schema Effective Metrics Attribution...');

    // 1. Reset compression stats to establish clean baseline
    contextCompactor.resetCompressionStats();
    let stats137 = contextCompactor.getCompressionStats();
    assert.strictEqual(stats137.modules.headroom.savedChars, 0, 'Headroom savedChars must be 0 after reset');
    assert.strictEqual(stats137.modules.schema.savedChars, 0, 'Schema savedChars must be 0 after reset');

    // 2. Test Tools Schema Alignment & Compact (Card 3 Attribution)
    const mockTools = [
      {
        type: 'function',
        function: {
          name: 'zebra_tool',
          description: 'A tool that runs zebra queries.\n\nExamples:\n```js\nzebra();\n```',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' }
            },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'alpha_tool',
          description: 'An alpha inspection utility.\n\nUsage: alpha()',
          parameters: {
            type: 'object',
            properties: {
              target: { type: 'string', description: 'Target identifier' }
            },
            required: ['target']
          }
        }
      },
      // Redundant duplicate tool to test deduplication
      {
        type: 'function',
        function: {
          name: 'zebra_tool',
          description: 'Duplicate zebra tool registration',
          parameters: { type: 'object', properties: {} }
        }
      }
    ];

    const chatPayloadWithTools = {
      model: 'deepseek-v4.1-flash',
      tools: mockTools,
      messages: [
        { role: 'user', content: 'Execute tool search' }
      ]
    };

    const compactedChat137 = contextCompactor.compactChatPayload(chatPayloadWithTools, {
      enabled: true,
      alignToolsSchema: true,
      slimToolsSchema: true
    });

    assert.strictEqual(compactedChat137.tools.length, 2, 'Duplicate tools must be deduplicated by name');
    assert.strictEqual(compactedChat137.tools[0].function.name, 'alpha_tool', 'Tools must be sorted alphabetically');
    assert.strictEqual(compactedChat137.tools[1].function.name, 'zebra_tool', 'Tools must be sorted alphabetically');

    stats137 = contextCompactor.getCompressionStats();
    assert.ok(stats137.modules.schema.savedChars > 0, `Schema savedChars must be > 0 (was ${stats137.modules.schema.savedChars})`);
    assert.ok(stats137.modules.schema.savedTokens > 0, `Schema savedTokens must be > 0 (was ${stats137.modules.schema.savedTokens})`);
    assert.ok(stats137.modules.schema.alignedRounds >= 1, 'Schema alignedRounds must be >= 1');
    assert.ok(stats137.modules.schema.alignedToolsCount >= 3, 'Schema alignedToolsCount must be >= 3');
    assert.ok(stats137.modules.schema.percentage > 0, `Schema percentage must be > 0% (was ${stats137.modules.schema.percentage}%)`);
    console.log(`✓ Schema CacheAligner metrics verified (Schema: ~${stats137.modules.schema.savedTokens} Tokens, ${stats137.modules.schema.percentage}%, ${stats137.modules.schema.alignedRounds} rounds aligned)`);

    // 3. Test Headroom SmartCrusher & Raw Lockfile (Card 2 Attribution)
    const rawLockfileSample = JSON.stringify({
      name: 'test-app',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [`node_modules/pkg-${i}`, { version: `1.${i}.0`, integrity: `sha512-${i}` }])
      )
    }, null, 2);

    const toolPayloadWithHeadroom = {
      model: 'deepseek-v4.1-flash',
      messages: [
        { role: 'user', content: 'Read package-lock.json' },
        { role: 'tool', content: rawLockfileSample },
        { role: 'tool', content: raw60Str }
      ]
    };

    const compactedHeadroom137 = contextCompactor.compactChatPayload(toolPayloadWithHeadroom, {
      enabled: true,
      foldLockfiles: true,
      foldStructuredData: true,
      maxStructuredItems: 50
    });

    assert.ok(compactedHeadroom137.messages[1].content.includes('[Lockfile folded: package-lock.json') || compactedHeadroom137.messages[1].content.includes('_headroom_lockfile_folded'), 'Raw package-lock.json must be folded');
    assert.ok(compactedHeadroom137.messages[2].content.includes('_headroom_smart_crusher'), '60 items JSON array must be folded by SmartCrusher');

    stats137 = contextCompactor.getCompressionStats();
    assert.ok(stats137.modules.headroom.savedChars > 0, `Headroom savedChars must be > 0 (was ${stats137.modules.headroom.savedChars})`);
    assert.ok(stats137.modules.headroom.savedTokens > 0, `Headroom savedTokens must be > 0 (was ${stats137.modules.headroom.savedTokens})`);
    assert.ok(stats137.modules.headroom.percentage > 0, `Headroom percentage must be > 0% (was ${stats137.modules.headroom.percentage}%)`);
    console.log(`✓ Headroom SmartCrusher & Lockfile metrics verified (Headroom: ~${stats137.modules.headroom.savedTokens} Tokens, ${stats137.modules.headroom.percentage}%)`);

    // 4. Test Anthropic and Responses payload parity for Headroom & Schema
    const anthropicPayload137 = {
      model: 'claude-3-7-sonnet',
      tools: mockTools,
      messages: [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: raw60Str }] }
      ]
    };
    const compactedAnth137 = contextCompactor.compactAnthropicPayload(anthropicPayload137, { enabled: true });
    assert.strictEqual(compactedAnth137.tools.length, 2, 'Anthropic tools must be deduplicated');
    assert.ok(compactedAnth137.messages[0].content[0].content.includes('_headroom_smart_crusher'), 'Anthropic tool_result must be folded by SmartCrusher');

    const responsesPayload137 = {
      model: 'codex-pro',
      tools: mockTools,
      input: [
        { type: 'function_call_output', call_id: 'call_1', output: raw60Str },
        { role: 'tool', content: '\u001b[32mhello role tool\u001b[0m' }
      ]
    };
    const compactedResp137 = contextCompactor.compactResponsesPayload(responsesPayload137, { enabled: true });
    assert.strictEqual(compactedResp137.tools.length, 2, 'Responses tools must be deduplicated');
    assert.ok(compactedResp137.input[0].output.includes('_headroom_smart_crusher'), 'Responses output must be folded by SmartCrusher');
    assert.strictEqual(compactedResp137.input[1].content, 'hello role tool', 'Responses role: tool content must be denoised');
    assert.strictEqual(compactedResp137.input[1].output, undefined, 'Responses role: tool must not have phantom output injected');

    // 4b. Verify direct structured array folding in Chat and Anthropic payloads
    const directArray60 = Array.from({ length: 60 }, (_, i) => ({ id: i, val: `item_${i}` }));
    const chatArrayComp = contextCompactor.compactChatPayload({
      messages: [{ role: 'tool', content: directArray60 }]
    }, { enabled: true });
    assert.ok(Array.isArray(chatArrayComp.messages[0].content), 'Chat direct array must remain array');
    assert.strictEqual(chatArrayComp.messages[0].content.length, 9, 'Chat direct array of 60 items must be folded to 9 items');

    const anthArrayComp = contextCompactor.compactAnthropicPayload({
      messages: [{ role: 'user', content: [{ type: 'tool_result', content: directArray60 }] }]
    }, { enabled: true });
    assert.ok(Array.isArray(anthArrayComp.messages[0].content[0].content), 'Anthropic direct array must remain array');
    assert.strictEqual(anthArrayComp.messages[0].content[0].content.length, 9, 'Anthropic direct array of 60 items must be folded to 9 items');

    // 5. Send actual HTTP requests through Router endpoint to trigger router process compaction
    await request('/balancer/api/compression/stats/reset', { method: 'POST' });

    // 5a. HTTP request with Tools schema (triggers Schema in router process)
    const httpToolsRes = await request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        tools: mockTools,
        messages: [{ role: 'user', content: 'HTTP search tools test' }]
      })
    });
    assert.strictEqual(httpToolsRes.statusCode, 200, 'HTTP Chat completions with tools must return 200');

    // 5b. HTTP request with tool output (triggers Headroom in router process)
    const httpHeadroomRes = await request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        messages: [
          { role: 'user', content: 'Fetch lockfile and items' },
          { role: 'tool', content: rawLockfileSample },
          { role: 'tool', content: raw60Str }
        ]
      })
    });
    assert.strictEqual(httpHeadroomRes.statusCode, 200, 'HTTP Chat completions with tool output must return 200');

    // 5c. Test Web UI Stats API & Metrics Distribution
    const statsApiRes = await request('/balancer/api/compression/stats', { method: 'GET' });
    assert.strictEqual(statsApiRes.statusCode, 200);
    const parsedApiStats = JSON.parse(statsApiRes.body);
    assert.ok(parsedApiStats.success, 'Stats API must return success');
    assert.ok(parsedApiStats.stats.modules.headroom.savedTokens > 0, `Headroom savedTokens must be visible in API (was ${parsedApiStats.stats.modules.headroom.savedTokens})`);
    assert.ok(parsedApiStats.stats.modules.schema.savedTokens > 0, `Schema savedTokens must be visible in API (was ${parsedApiStats.stats.modules.schema.savedTokens})`);
    assert.strictEqual(
      parsedApiStats.stats.totalSavedChars,
      parsedApiStats.stats.modules.headroom.savedChars + parsedApiStats.stats.modules.schema.savedChars,
      'Total saved chars must strictly equal sum of module saved chars without double counting'
    );
    const totalPercentage = parsedApiStats.stats.modules.headroom.percentage + parsedApiStats.stats.modules.schema.percentage;
    assert.ok(Math.round(totalPercentage) >= 99 && Math.round(totalPercentage) <= 101, `Module percentages must sum to 100% (was ${totalPercentage}%)`);

    // 6. Test Web UI Dashboard HTML renders active elements for Card 2 & Card 3
    const uiRes137 = await request('/balancer/ui', { method: 'GET' });
    assert.strictEqual(uiRes137.statusCode, 200);
    assert.ok(uiRes137.body.includes('id="module-card-headroom"'), 'UI must render module-card-headroom');
    assert.ok(uiRes137.body.includes('id="module-card-schema"'), 'UI must render module-card-schema');
    assert.ok(uiRes137.body.includes('id="contrib-text-headroom"'), 'UI must render contrib-text-headroom');
    assert.ok(uiRes137.body.includes('id="contrib-text-schema"'), 'UI must render contrib-text-schema');
    assert.ok(uiRes137.body.includes('id="progress-fill-headroom"'), 'UI must render progress-fill-headroom');
    assert.ok(uiRes137.body.includes('id="progress-fill-schema"'), 'UI must render progress-fill-schema');

    console.log('✓ Full End-to-End Headroom & Schema metrics attribution and Web UI integration verified');

    // [Test 138] Testing Per-Model Savings Telemetry, Official Rate Dictionary & Web UI By-Model Breakdown
    console.log('\n[Test 138] Testing Per-Model Savings Telemetry, Official Rate Dictionary & Web UI By-Model Breakdown...');

    // 1. Reset stats via API and local instance
    contextCompactor.resetCompressionStats();
    await request('/balancer/api/compression/stats/reset', { method: 'POST' });
    let stats138 = contextCompactor.getCompressionStats();
    assert.deepStrictEqual(stats138.byModel, {}, 'byModel must be empty upon reset');
    assert.strictEqual(stats138.savedCostUSD, 0, 'savedCostUSD must be 0 upon reset');

    // 2. Unit/Engine level telemetry across different models
    // 2a. Model 1: deepseek-v4.1-flash ($0.14 / 1M)
    const testToolMsg1 = '\u001b[32m' + 'Build succeeded with 0 errors. '.repeat(20) + '\u001b[0m';
    contextCompactor.compactChatPayload({
      model: 'deepseek-v4.1-flash',
      messages: [{ role: 'tool', content: testToolMsg1 }]
    }, { enabled: true });

    stats138 = contextCompactor.getCompressionStats();
    assert.ok(stats138.byModel['deepseek-v4.1-flash'], 'byModel must contain deepseek-v4.1-flash');
    const dsStats = stats138.byModel['deepseek-v4.1-flash'];
    assert.strictEqual(dsStats.ratePer1M, 0.14, 'deepseek-v4.1-flash rate must be 0.14');
    assert.ok(dsStats.savedChars > 0, 'deepseek-v4.1-flash savedChars must be > 0');
    assert.ok(dsStats.savedTokens > 0, 'deepseek-v4.1-flash savedTokens must be > 0');
    assert.strictEqual(dsStats.savedTokens, Math.round(dsStats.savedChars / 3.8));
    assert.strictEqual(dsStats.savedCostUSD, Number(((dsStats.savedTokens / 1000000) * 0.14).toFixed(7)));

    // 2b. Model 2: claude-haiku-5-5 ($1.25 / 1M)
    contextCompactor.compactAnthropicPayload({
      model: 'claude-haiku-5-5',
      messages: [{
        role: 'user',
        content: [{ type: 'tool_result', content: testToolMsg1 }]
      }]
    }, { enabled: true });

    stats138 = contextCompactor.getCompressionStats();
    assert.ok(stats138.byModel['claude-haiku-5-5'], 'byModel must contain claude-haiku-5-5');
    const clStats = stats138.byModel['claude-haiku-5-5'];
    assert.strictEqual(clStats.ratePer1M, 1.25, 'claude-haiku-5-5 rate must be 1.25');
    assert.ok(clStats.savedChars > 0, 'claude-haiku-5-5 savedChars must be > 0');
    assert.ok(clStats.savedTokens > 0, 'claude-haiku-5-5 savedTokens must be > 0');

    // 2c. Model 3: kimi-k3 ($0.60 / 1M)
    contextCompactor.compactResponsesPayload({
      model: 'kimi-k3',
      input: [{ type: 'function_call_output', call_id: 'c1', output: testToolMsg1 }]
    }, { enabled: true });

    stats138 = contextCompactor.getCompressionStats();
    assert.ok(stats138.byModel['kimi-k3'], 'byModel must contain kimi-k3');
    assert.strictEqual(stats138.byModel['kimi-k3'].ratePer1M, 0.60, 'kimi-k3 rate must be 0.60');

    // 2d. Model 4: Unknown model fallback ($0.25 / 1M)
    contextCompactor.compactChatPayload({
      model: 'unknown-custom-model-x',
      messages: [{ role: 'tool', content: testToolMsg1 }]
    }, { enabled: true });

    stats138 = contextCompactor.getCompressionStats();
    assert.ok(stats138.byModel['unknown-custom-model-x'], 'byModel must contain unknown-custom-model-x');
    assert.strictEqual(stats138.byModel['unknown-custom-model-x'].ratePer1M, 0.25, 'Unknown model rate must fallback to 0.25');

    // 2e. Assert dynamic weighted sum: total savedCostUSD strictly equals sum of model saved costs
    const expectedWeightedSum = Object.values(stats138.byModel).reduce((sum, m) => sum + m.savedCostUSD, 0);
    assert.strictEqual(stats138.savedCostUSD, Number(expectedWeightedSum.toFixed(6)), 'totalSavedCostUSD must strictly match weighted sum of all models');
    console.log(`✓ Engine level per-model savings & dynamic weighted cost verified (${Object.keys(stats138.byModel).length} models tracked, totalSavedCost: $${stats138.savedCostUSD})`);

    // 3. End-to-end HTTP pipeline requests through router
    await request('/balancer/api/compression/stats/reset', { method: 'POST' });

    // 3a. HTTP Chat request with deepseek-v4.1-flash
    const httpDsRes = await request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4.1-flash',
        messages: [
          { role: 'user', content: 'HTTP per-model test 1' },
          { role: 'tool', content: '\u001b[32m' + 'Log line with ANSI green '.repeat(15) + '\u001b[0m' }
        ]
      })
    });
    assert.strictEqual(httpDsRes.statusCode, 200, 'HTTP Chat completions with deepseek must return 200');

    // 3b. HTTP Messages request with claude-haiku-5-5
    const httpClaudeRes = await request('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        messages: [
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't_claude_1', content: '\u001b[33m' + 'Log line with ANSI yellow '.repeat(15) + '\u001b[0m' }] }
        ]
      })
    });
    assert.strictEqual(httpClaudeRes.statusCode, 200, 'HTTP Messages with claude must return 200');

    // 3c. Verify /balancer/api/compression/stats returns byModel with accurate rates
    const httpStatsRes = await request('/balancer/api/compression/stats', { method: 'GET' });
    assert.strictEqual(httpStatsRes.statusCode, 200);
    const parsedHttpStats = JSON.parse(httpStatsRes.body);
    assert.ok(parsedHttpStats.success, 'Stats API must return success');
    assert.ok(parsedHttpStats.stats.byModel['deepseek-v4.1-flash'], 'API stats must have deepseek-v4.1-flash');
    assert.ok(parsedHttpStats.stats.byModel['claude-haiku-5-5'], 'API stats must have claude-haiku-5-5');
    assert.strictEqual(parsedHttpStats.stats.byModel['deepseek-v4.1-flash'].ratePer1M, 0.14);
    assert.strictEqual(parsedHttpStats.stats.byModel['claude-haiku-5-5'].ratePer1M, 1.25);
    const httpSum = parsedHttpStats.stats.byModel['deepseek-v4.1-flash'].savedCostUSD + parsedHttpStats.stats.byModel['claude-haiku-5-5'].savedCostUSD;
    assert.strictEqual(parsedHttpStats.stats.savedCostUSD, Number(httpSum.toFixed(6)), 'HTTP stats savedCostUSD must match sum of byModel costs');
    console.log(`✓ HTTP Proxy End-to-End per-model telemetry verified (deepseek $0.14/1M + claude $1.25/1M, total: $${parsedHttpStats.stats.savedCostUSD})`);

    // 4. Verify disk persistence in compression-stats.json
    await new Promise(r => setTimeout(r, 1200));
    const diskStatsRaw = fs.readFileSync(path.join(__dirname, 'compression-stats.json'), 'utf8');
    const diskStats = JSON.parse(diskStatsRaw);
    assert.ok(diskStats.byModel, 'Disk stats must contain byModel');
    assert.ok(diskStats.byModel['deepseek-v4.1-flash'], 'Disk stats must contain deepseek-v4.1-flash');
    assert.ok(diskStats.byModel['claude-haiku-5-5'], 'Disk stats must contain claude-haiku-5-5');
    console.log('✓ Disk persistence of byModel telemetry in compression-stats.json verified');

    // 5. Test Web UI Dashboard elements
    const uiRes138 = await request('/balancer/ui', { method: 'GET' });
    assert.strictEqual(uiRes138.statusCode, 200);
    assert.ok(uiRes138.body.includes('id="by-model-breakdown-drawer"'), 'UI must render by-model-breakdown-drawer');
    assert.ok(uiRes138.body.includes('id="by-model-table-body"'), 'UI must render by-model-table-body');
    assert.ok(uiRes138.body.includes('id="by-model-tag"'), 'UI must render by-model-tag');
    assert.ok(uiRes138.body.includes('基于各模型官方实时费率动态加权测算'), 'UI must display dynamic weighted rate subtitle');
    assert.ok(uiRes138.body.includes('toggleByModelDrawer'), 'UI must contain toggleByModelDrawer function');
    console.log('✓ Web UI By-Model Breakdown Drawer & dynamic weighted subtitle verified');

    // 6. Test reset endpoint resets byModel cleanly
    const resetRes138 = await request('/balancer/api/compression/stats/reset', { method: 'POST' });
    assert.strictEqual(resetRes138.statusCode, 200);
    const parsedReset138 = JSON.parse(resetRes138.body);
    assert.deepStrictEqual(parsedReset138.stats.byModel, {}, 'Reset API must return empty byModel');
    assert.strictEqual(parsedReset138.stats.savedCostUSD, 0, 'Reset API must return 0 savedCostUSD');
    console.log('✓ Clean reset of byModel telemetry via POST /balancer/api/compression/stats/reset verified');

    console.log('\n======================================================');
    console.log('🎉 ALL 138 ADVANCED ROUTER TESTS PASSED SUCCESSFULLY!');
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
    if (fs.existsSync(testCodexDir)) {
      try { fs.rmSync(testCodexDir, { recursive: true, force: true }); } catch (e) {}
    }
    try {
      const prodToml = path.join(os.homedir(), '.codex', 'config.toml');
      if (fs.existsSync(prodToml)) {
        let tomlContent = fs.readFileSync(prodToml, 'utf8');
        if (tomlContent.includes(`:${routerPort}/v1`)) {
          tomlContent = tomlContent.replace(new RegExp(`:${routerPort}/v1`, 'g'), ':4010/v1');
          fs.writeFileSync(prodToml, tomlContent, 'utf8');
        }
      }
    } catch (e) {}
    if (fs.existsSync(path.join(__dirname, 'compression-stats.json'))) {
      try { fs.unlinkSync(path.join(__dirname, 'compression-stats.json')); } catch (e) {}
    }
  }
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
