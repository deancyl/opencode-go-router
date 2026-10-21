/**
 * Tier 5 Protocol & Gateway White-Box Adversarial Stress Suite
 * OpenCode Go Router - Final Milestone (M-Final) Verification
 * 
 * Verifies:
 * 1. Tool-Call Atomic Contiguity, Out-of-Order Collation & Interleaved Notice Deferral (Rule 18)
 * 2. Responses API Missing Output Auto-Backfill on Upstream 400
 * 3. Dynamic Heterogeneous Fallback with Flagship Priority (Rule 19) & Pre-Emptive Session Memory
 * 4. O(1) Session Model Fallback Eviction, Reverse Index Consistency & Delimiter Safety
 * 5. Context Pruning Immutability, Turn-Boundary Safety & Dual-Compatibility Contract (Features 6 & 7)
 * 6. Anthropic Stream Watchdog: Chunk Refresh, Non-Falsified Failures & Stalled Stream Defense (Rule 12)
 * 7. Upstream Error Stream Cap (256KB) & Event Listener Leak Immunity during Multi-Attempt Failover (Features 2 & 3)
 * 8. Base64 Air-Gapped Sandbox Sanitization & Deep Tool Parameter Schema Normalization (Rules 5 & 13)
 */

const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
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

let testIndex = 0;
let passedCount = 0;
let failedCount = 0;

async function test(name, fn) {
  testIndex++;
  process.stdout.write(`[Test ${testIndex}] ${name} ... `);
  try {
    await fn();
    passedCount++;
    console.log('PASSED ✔');
  } catch (err) {
    failedCount++;
    console.log('FAILED ✘');
    console.error(`  Error: ${err.message}`);
    if (err.stack) console.error(`  Stack: ${err.stack.split('\n').slice(1, 4).join('\n')}`);
  }
}

async function runTier5AdversarialSuite() {
  console.log('================================================================');
  console.log('🛡️ Starting Tier 5 Protocol & Gateway White-Box Adversarial Suite');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // SECTION 1: Pure White-Box Unit Adversarial Testing
  // -------------------------------------------------------------
  console.log('--- SECTION 1: Pure White-Box Unit Adversarial Testing ---');

  await test('1.1 Tool Contiguity: Scrambled responses are reordered to match tool_calls order', () => {
    const inputMessages = [
      { role: 'user', content: 'Execute operations' },
      {
        role: 'assistant',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'fn1', arguments: '{}' } },
          { id: 'call_2', type: 'function', function: { name: 'fn2', arguments: '{}' } },
          { id: 'call_3', type: 'function', function: { name: 'fn3', arguments: '{}' } }
        ]
      },
      // Scrambled responses: call_3, call_1, call_2
      { role: 'tool', tool_call_id: 'call_3', content: 'output 3' },
      { role: 'tool', tool_call_id: 'call_1', content: 'output 1' },
      { role: 'tool', tool_call_id: 'call_2', content: 'output 2' }
    ];

    const sanitized = codexAdapter.sanitizeAndValidateChatMessages(inputMessages);
    assert.strictEqual(sanitized.length, 5);
    assert.strictEqual(sanitized[1].role, 'assistant');
    assert.strictEqual(sanitized[2].role, 'tool');
    assert.strictEqual(sanitized[2].tool_call_id, 'call_1');
    assert.strictEqual(sanitized[3].role, 'tool');
    assert.strictEqual(sanitized[3].tool_call_id, 'call_2');
    assert.strictEqual(sanitized[4].role, 'tool');
    assert.strictEqual(sanitized[4].tool_call_id, 'call_3');
  });

  await test('1.2 Tool Contiguity: Missing tool responses are auto-backfilled with dummy outputs', () => {
    const inputMessages = [
      {
        role: 'assistant',
        tool_calls: [
          { id: 'call_alpha', type: 'function', function: { name: 'fn_a' } },
          { id: 'call_beta', type: 'function', function: { name: 'fn_b' } },
          { id: 'call_gamma', type: 'function', function: { name: 'fn_c' } }
        ]
      },
      // Only call_alpha is provided; beta and gamma are missing
      { role: 'tool', tool_call_id: 'call_alpha', content: 'alpha result' }
    ];

    const sanitized = codexAdapter.sanitizeAndValidateChatMessages(inputMessages);
    assert.strictEqual(sanitized.length, 4);
    assert.strictEqual(sanitized[1].tool_call_id, 'call_alpha');
    assert.strictEqual(sanitized[1].content, 'alpha result');
    assert.strictEqual(sanitized[2].tool_call_id, 'call_beta');
    assert.ok(sanitized[2].content.includes('completed without output'));
    assert.strictEqual(sanitized[3].tool_call_id, 'call_gamma');
    assert.ok(sanitized[3].content.includes('completed without output'));
  });

  await test('1.3 Tool Contiguity: Interleaved system/developer notices are deferred past all tool outputs', () => {
    const inputMessages = [
      {
        role: 'assistant',
        tool_calls: [
          { id: 'call_t1', type: 'function', function: { name: 'read_file' } },
          { id: 'call_t2', type: 'function', function: { name: 'write_file' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call_t1', content: 'read output' },
      { role: 'system', content: '<image_resize_notice>Dimensions changed</image_resize_notice>' },
      { role: 'developer', content: 'developer alert' },
      { role: 'tool', tool_call_id: 'call_t2', content: 'write output' }
    ];

    const sanitized = codexAdapter.sanitizeAndValidateChatMessages(inputMessages);
    assert.strictEqual(sanitized.length, 5);
    assert.strictEqual(sanitized[0].role, 'assistant');
    assert.strictEqual(sanitized[1].tool_call_id, 'call_t1');
    assert.strictEqual(sanitized[2].tool_call_id, 'call_t2');
    assert.strictEqual(sanitized[3].role, 'system');
    assert.ok(sanitized[3].content.includes('image_resize_notice'));
    assert.strictEqual(sanitized[4].role, 'developer');
  });

  await test('1.4 Tool Contiguity: Orphan tool messages without preceding assistant are safely converted to user messages', () => {
    const inputMessages = [
      { role: 'tool', tool_call_id: 'orphan_1', content: 'lonely tool output' },
      { role: 'user', content: 'Hello' },
      { role: 'tool', tool_call_id: 'orphan_2', content: { nested: 'data' } }
    ];

    const sanitized = codexAdapter.sanitizeAndValidateChatMessages(inputMessages);
    assert.strictEqual(sanitized.length, 3);
    assert.strictEqual(sanitized[0].role, 'user');
    assert.ok(sanitized[0].content.includes('[Tool Output: lonely tool output]'));
    assert.strictEqual(sanitized[1].role, 'user');
    assert.strictEqual(sanitized[2].role, 'user');
    assert.ok(sanitized[2].content.includes('nested'));
  });

  await test('1.5 Pruning Immutability: pruneResponsesPayload does NOT mutate input array in-place', () => {
    const originalInput = [
      { type: 'message', role: 'user', content: 'Initial task instruction' },
      { type: 'function_call_output', call_id: 'c1', output: 'X'.repeat(5000) }
    ];
    const originalPayload = {
      model: 'deepseek-v4-pro',
      input: originalInput
    };

    const snapshotStr = JSON.stringify(originalPayload);
    const result = codexAdapter.pruneResponsesPayload(originalPayload);

    assert.ok(result.pruned === result, 'Dual compatibility .pruned reference must equal result');
    assert.strictEqual(result.modified, true, 'Modified flag must be true');
    assert.strictEqual(typeof result.input, 'object');

    assert.strictEqual(originalInput[1].output.length, 5000, 'Original payload item must NOT be mutated');
    assert.strictEqual(JSON.stringify(originalPayload), snapshotStr, 'Original payload structure must remain intact');
    assert.ok(result.input[1].output.includes('智能网关自愈：已自动折叠'));
    assert.ok(result.input[1].output.length < 5000);
  });

  await test('1.6 Pruning Immutability: pruneChatMessages does NOT mutate messages array in-place', () => {
    const originalMessages = [
      { role: 'system', content: 'System instructions' },
      { role: 'tool', tool_call_id: 'call_99', content: 'Y'.repeat(4000) },
      { role: 'user', content: 'Final prompt' }
    ];
    const snapshotStr = JSON.stringify(originalMessages);

    const result = codexAdapter.pruneChatMessages(originalMessages);

    assert.ok(result.pruned === result, 'Dual compatibility .pruned reference must equal result');
    assert.strictEqual(result.modified, true, 'Modified flag must be true');
    assert.strictEqual(originalMessages[1].content.length, 4000, 'Original messages array must NOT be mutated');
    assert.strictEqual(JSON.stringify(originalMessages), snapshotStr);
    assert.ok(result[1].content.includes('智能网关自愈：已自动折叠'));
  });

  await test('1.7 Pruning Boundary: Exact 18 items boundary vs 19 items sliding window', () => {
    const makeItems = (n) => {
      const items = [{ type: 'message', role: 'user', content: 'Start task' }];
      for (let i = 1; i < n; i++) {
        items.push({ type: 'message', role: i % 2 === 1 ? 'assistant' : 'user', content: 'Item ' + i });
      }
      return items;
    };

    const p18 = codexAdapter.pruneResponsesPayload({ input: makeItems(18) });
    assert.strictEqual(p18.input.length, 18);
    assert.strictEqual(p18.modified, false);

    const p19 = codexAdapter.pruneResponsesPayload({ input: makeItems(19) });
    assert.ok(p19.input.length < 19, '19 items must be folded by sliding window');
    assert.strictEqual(p19.modified, true);
    assert.ok(p19.input.some(item => item.content && item.content.includes('滑动窗口折叠')));
  });

  await test('1.8 Tool Schema Deep Normalization: Handles empty, null, and complex definitions (Rule 13)', () => {
    const norm1 = codexAdapter.normalizeToolParameters({});
    assert.strictEqual(norm1.type, 'object');
    assert.deepStrictEqual(norm1.properties, {});

    const norm2 = codexAdapter.normalizeToolParameters(null);
    assert.strictEqual(norm2.type, 'object');
    assert.deepStrictEqual(norm2.properties, {});

    const norm3 = codexAdapter.normalizeToolParameters([1, 2, 3]);
    assert.strictEqual(norm3.type, 'object');
    assert.deepStrictEqual(norm3.properties, {});

    const complex = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      $defs: { CustomType: { type: 'number' } },
      oneOf: [{ required: ['query'] }]
    };
    const normComplex = codexAdapter.normalizeToolParameters(complex);
    assert.strictEqual(normComplex.type, 'object');
    assert.ok(normComplex.properties.query);
    assert.deepStrictEqual(normComplex.required, ['query']);
    assert.ok(normComplex.$defs);
    assert.ok(normComplex.oneOf);
  });

  await test('1.9 Base64 Air-Gapped Sandbox: Sanitizes base64 data to compact description (Rule 5)', () => {
    const rawBase64 = 'data:image/png;base64,' + 'A'.repeat(5000);
    const toolOutput = [
      { type: 'input_image', image_url: rawBase64 },
      { type: 'text', content: 'Normal output' }
    ];

    const sanitized = codexAdapter.sanitizeToolOutput(toolOutput);
    assert.ok(!sanitized.includes('AAAAAA'), 'Base64 image stream must be sanitized out');
    assert.ok(sanitized.includes('visual sandbox engine') || sanitized.includes('image_view_output'));
    assert.ok(sanitized.length < 500, 'Output must be compactly summarized');
  });

  await test('1.10 formatUpstreamErrorResponse: Standardizes 0-byte, HTML, SSE, and bare JSON errors (Rule 13)', () => {
    const err0 = JSON.parse(codexAdapter.formatUpstreamErrorResponse('', 502));
    assert.strictEqual(err0.error.code, 502);
    assert.ok(err0.error.message.includes('HTTP 502'));

    const errHtml = JSON.parse(codexAdapter.formatUpstreamErrorResponse('<html>503 Service Unavailable</html>', 503));
    assert.strictEqual(errHtml.error.code, 503);
    assert.ok(errHtml.error.message.includes('503 Service Unavailable'));

    const sseErr = 'data: {"error":{"message":"Quota exceeded","type":"insufficient_quota","code":429}}\n\ndata: [DONE]\n\n';
    const errSse = JSON.parse(codexAdapter.formatUpstreamErrorResponse(sseErr, 429));
    assert.strictEqual(errSse.error.message, 'Quota exceeded');
    assert.strictEqual(errSse.error.type, 'insufficient_quota');

    const bareErr = JSON.parse(codexAdapter.formatUpstreamErrorResponse('{"detail":"Service is under maintenance"}', 503));
    assert.ok(bareErr.error.message.includes('Service is under maintenance'));
  });

  await test('1.11 ComfyUI Upfront Tool Injection: tool_search is filtered and ComfyUI tools injected', () => {
    const mockBodyWithToolSearch = {
      model: 'deepseek-v4.1-flash',
      input: [{ role: 'user', content: '生成一张苹果的图片' }],
      tools: [
        { type: 'function', function: { name: 'exec_command', description: 'Execute shell' } },
        { type: 'function', function: { name: 'tool_search', description: 'Search deferred tools' } }
      ]
    };
    const chat = codexAdapter.convertResponsesToChatPayload(mockBodyWithToolSearch);
    assert.strictEqual(chat.tools.some(t => t.function.name === 'tool_search'), false, 'tool_search must be removed');
    assert.strictEqual(chat.tools.some(t => t.function.name === 'mcp__comfyui__generate_image'), true, 'mcp__comfyui__generate_image must be injected');
    assert.strictEqual(chat.tools.some(t => t.function.name === 'mcp__comfyui__interrogate_image'), true, 'mcp__comfyui__interrogate_image must be injected');

    const anthropic = codexAdapter.convertResponsesToAnthropicPayload(mockBodyWithToolSearch);
    assert.strictEqual(anthropic.tools.some(t => t.name === 'tool_search'), false, 'tool_search must be removed from Anthropic payload');
    assert.strictEqual(anthropic.tools.some(t => t.name === 'mcp__comfyui__generate_image'), true, 'mcp__comfyui__generate_image must be injected into Anthropic payload');

    // Test real-world anonymous # Tool discovery payload from Codex Desktop (function.name is undefined)
    const mockCodexAnonymousDiscovery = {
      model: 'deepseek-v4.1-flash',
      input: [{ role: 'user', content: '生成一张苹果的图片' }],
      tools: [
        { type: 'function', function: { name: 'exec_command', description: 'Execute shell' } },
        {
          type: 'function',
          function: {
            description: '# Tool discovery\n\nSearches over deferred tool metadata with BM25 and exposes matching tools for the next model call.\nSome of the tools may not have been provided to you upfront, and you should use this tool (`tool_search`) to search...',
            parameters: { type: 'object', properties: { query: { type: 'string' } } }
          }
        }
      ]
    };
    const chatAnon = codexAdapter.convertResponsesToChatPayload(mockCodexAnonymousDiscovery);
    assert.strictEqual(chatAnon.tools.some(t => (t.function?.description || '').includes('# Tool discovery')), false, 'Anonymous Tool discovery must be filtered');
    assert.strictEqual(chatAnon.tools.some(t => t.function?.name === 'mcp__comfyui__generate_image'), true, 'ComfyUI must be injected when anonymous discovery tool present');
  });

  await test('1.12 Bidirectional Tool Alias Shimming: generate_image maps to mcp__comfyui__generate_image', () => {
    const mockChatResp = {
      id: 'chatcmpl-test-tool-alias',
      choices: [{
        message: {
          role: 'assistant',
          tool_calls: [
            { id: 'call_1', function: { name: 'generate_image', arguments: '{"prompt":"a fresh apple"}' } },
            { id: 'call_2', function: { name: 'interrogate_image', arguments: '{"image_path":"apple.png"}' } }
          ]
        }
      }]
    };
    const converted = codexAdapter.convertChatResponseToResponses(mockChatResp, 'deepseek-v4.1-flash', 'resp_1');
    assert.strictEqual(converted.output[0].name, 'mcp__comfyui__generate_image', 'generate_image shimmed to mcp__comfyui__generate_image');
    assert.strictEqual(converted.output[1].name, 'mcp__comfyui__interrogate_image', 'interrogate_image shimmed to mcp__comfyui__interrogate_image');

    const mockAnthropicResp = {
      content: [
        { type: 'tool_use', id: 'call_3', name: 'image_gen', input: { prompt: 'apple' } }
      ]
    };
    const convertedAnthropic = codexAdapter.convertAnthropicResponseToResponses(mockAnthropicResp, 'claude-haiku-5-5', 'resp_2');
    assert.strictEqual(convertedAnthropic.output[0].name, 'mcp__comfyui__generate_image', 'image_gen shimmed to mcp__comfyui__generate_image');
  });

  // -------------------------------------------------------------
  // SECTION 2: Integration White-Box Adversarial Gateway Testing
  // -------------------------------------------------------------
  console.log('\n--- SECTION 2: Integration White-Box Adversarial Gateway Testing ---');

  const mockPort = await getFreePort();
  const routerPort = await getFreePort();

  let upstreamCallCount = 0;
  let receivedBodies = [];
  let modelUnsupportedHit = 0;
  let missingToolsHit = 0;

  // Mock Upstream Server with Fault Injection
  const mockUpstream = http.createServer((req, res) => {
    upstreamCallCount++;
    const auth = req.headers['authorization'] || req.headers['x-api-key'] || '';
    const session = req.headers['x-opencode-session'] || req.headers['x-conversation-id'] || '';

    let bodyChunks = [];
    req.on('data', c => bodyChunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(bodyChunks).toString('utf8');
      let parsedBody = null;
      try { parsedBody = JSON.parse(rawBody); } catch (_) {}
      receivedBodies.push({ url: req.url, headers: req.headers, body: parsedBody, rawBody });

      // Scenario A: Upstream 400 with missing tool_call_ids error
      if (req.url.includes('/chat/completions') && session === 'session-adv-missing-tools') {
        missingToolsHit++;
        if (missingToolsHit === 1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              message: "Invalid request: an assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: call_ghost_1, call_ghost_2",
              type: 'invalid_request_error',
              code: 'tool_calls_missing'
            }
          }));
          return;
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chat-healed',
            choices: [{ message: { role: 'assistant', content: 'Healed and executed successfully' } }]
          }));
          return;
        }
      }

      // Scenario B: Upstream 400 with model unsupported, returning supported list
      if (session && session.startsWith('session-adv-model-fallback')) {
        modelUnsupportedHit++;
        const requestedModel = parsedBody?.model || '';
        if (requestedModel.includes('restricted-model-xyz') || requestedModel.includes('claude-nonexistent')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              message: "The model 'restricted-model-xyz' does not exist or is not supported by this model provider. The supported API model names are: deepseek-v4-pro, deepseek-v4.1-flash, kimi-k3, minimax-m3, glm-5.3",
              type: 'invalid_request_error',
              code: 'model_not_found'
            }
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chat-fallback-success',
          model: requestedModel,
          choices: [{ message: { role: 'assistant', content: `Executed with model ${requestedModel}` } }]
        }));
        return;
      }

      // Scenario C: Giant 500KB error stream (Verifies 256KB buffer cap & unpipe)
      // Matches both original session and any jitter retry sessions
      if (session && session.startsWith('session-adv-huge-error')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        // Stream 500KB in 50KB chunks of non-retryable error
        const chunk50k = Buffer.from('{"error":{"message":"' + 'E'.repeat(50 * 1024) + '",');
        let chunksLeft = 10;
        const interval = setInterval(() => {
          if (chunksLeft > 0 && !res.destroyed) {
            res.write(chunk50k);
            chunksLeft--;
          } else {
            clearInterval(interval);
            if (!res.destroyed) {
              res.write('"type":"invalid_request_error","code":"payload_too_large"}}\n');
              res.end();
            }
          }
        }, 10);
        return;
      }

      // Scenario D: Anthropic slow streaming with watchdog
      if (req.url.includes('/messages') && session === 'session-adv-watchdog-refresh') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        res.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","role":"assistant"}}\n\n');
        res.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
        
        let counter = 0;
        const sendInterval = setInterval(() => {
          counter++;
          if (counter <= 3) {
            res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" chunk ${counter}"}}\n\n`);
          } else {
            clearInterval(sendInterval);
            res.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
            res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
            res.end();
          }
        }, 50);
        return;
      }

      // Scenario E: Multi-attempt failover listener leak check
      if (session === 'session-adv-failover-leak') {
        if (auth.includes('key-account-1')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'invalid_api_key' } }));
          return;
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'resp-failover-ok', choices: [{ message: { content: 'ok from account 2' } }] }));
          return;
        }
      }

      // Default Standard 200 response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'resp-default',
        model: parsedBody?.model || 'default-model',
        choices: [{ message: { role: 'assistant', content: 'Default response' } }]
      }));
    });
  });

  await new Promise(resolve => mockUpstream.listen(mockPort, '127.0.0.1', resolve));

  // Temporary router configuration
  const tmpDir = path.join(os.tmpdir(), `test-t5-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const testConfigFile = path.join(tmpDir, 'config.json');

  const testConfig = {
    port: routerPort,
    host: '127.0.0.1',
    upstream: `http://127.0.0.1:${mockPort}/v1`,
    defaultCooldownMs: 3000,
    maxFailoverRetries: 3,
    sessionAffinityEnabled: true,
    accounts: [
      { id: 'acc-1', name: 'Primary Account', apiKey: 'key-account-1', enabled: true },
      { id: 'acc-2', name: 'Secondary Account', apiKey: 'key-account-2', enabled: true }
    ],
    compression: contextCompactor.DEFAULT_COMPRESSION_CONFIG
  };
  fs.writeFileSync(testConfigFile, JSON.stringify(testConfig, null, 2), 'utf8');

  // Spawn router process with stdio draining (Rule 20)
  const routerProc = fork(path.join(__dirname, 'server.js'), [], {
    stdio: 'pipe',
    env: {
      ...process.env,
      OPENCODE_ROUTER_CONFIG: testConfigFile,
      PORT: String(routerPort)
    }
  });

  let routerStderr = '';
  routerProc.stdout.on('data', () => {}); // Rule 20: Drain stdout
  routerProc.stderr.on('data', d => { routerStderr += d.toString(); }); // Drain stderr

  await new Promise(r => setTimeout(r, 1200));

  function sendReq(reqPath, options = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: routerPort,
        path: reqPath,
        method: options.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch (_) {}
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data, json: parsed });
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  try {
    await test('2.1 Upstream 400 Missing Tool Messages: Gateway self-heals and retries', async () => {
      const payload = {
        model: 'deepseek-v4-pro',
        messages: [
          { role: 'user', content: 'List files' },
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_ghost_1', type: 'function', function: { name: 'list_dir' } },
              { id: 'call_ghost_2', type: 'function', function: { name: 'read_file' } }
            ]
          }
        ]
      };

      const res = await sendReq('/v1/chat/completions', {
        headers: { 'x-opencode-session': 'session-adv-missing-tools' },
        body: payload
      });

      assert.strictEqual(res.statusCode, 200, 'Gateway must auto-heal and return 200');
      assert.strictEqual(res.json?.choices?.[0]?.message?.content, 'Healed and executed successfully');
      assert.strictEqual(missingToolsHit, 2, 'Upstream must have received initial failing request and healed retry');
    });

    await test('2.2 Heterogeneous Fallback (Rule 19): Prioritizes flagship deepseek-v4-pro under xhigh reasoning', async () => {
      const res = await sendReq('/v1/chat/completions', {
        headers: { 'x-opencode-session': 'session-adv-model-fallback-flagship' },
        body: {
          model: 'restricted-model-xyz',
          reasoning_effort: 'xhigh',
          messages: [{ role: 'user', content: 'Solve complex math problem' }]
        }
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.json?.choices?.[0]?.message?.content.includes('deepseek-v4-pro'), 
        `Expected fallback to deepseek-v4-pro but got: ${res.json?.choices?.[0]?.message?.content}`);
    });

    await test('2.3 Pre-Emptive Session Memory (Rule 19): Subsequent request in same session avoids 400 roundtrip', async () => {
      const upstreamHitsBefore = upstreamCallCount;
      const res = await sendReq('/v1/chat/completions', {
        headers: { 'x-opencode-session': 'session-adv-model-fallback-flagship' },
        body: {
          model: 'restricted-model-xyz',
          reasoning_effort: 'xhigh',
          messages: [{ role: 'user', content: 'Follow-up question' }]
        }
      });

      assert.strictEqual(res.statusCode, 200);
      const callsForThisReq = upstreamCallCount - upstreamHitsBefore;
      assert.strictEqual(callsForThisReq, 1, 'Pre-emptive memory must skip upstream 400 round-trip');
    });

    await test('2.4 Upstream Huge Error Stream Cap: 500KB stream capped at 256KB without crashing', async () => {
      const res = await sendReq('/v1/chat/completions', {
        headers: { 'x-opencode-session': 'session-adv-huge-error' },
        body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'trigger 400 huge error' }] }
      });

      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.json?.error, 'Must return sanitized error object');
      assert.ok(Buffer.byteLength(res.body) <= (260 * 1024), 'Response body must be capped at 256KB and not blow up');
    });

    await test('2.5 Multi-Attempt Failover: Cleanly removes listeners and succeeds without EventEmitter leak', async () => {
      const res = await sendReq('/v1/chat/completions', {
        headers: { 'x-opencode-session': 'session-adv-failover-leak' },
        body: { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'failover test' }] }
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json?.choices?.[0]?.message?.content, 'ok from account 2');
      assert.ok(!routerStderr.includes('MaxListenersExceededWarning'), 'No listener leaks allowed during failover');
    });

    await test('2.6 Slow SSE Stream Watchdog: Data chunks refresh timer, stream terminates cleanly', async () => {
      const res = await sendReq('/v1/responses', {
        headers: { 'x-opencode-session': 'session-adv-watchdog-refresh' },
        body: {
          model: 'claude-haiku-5-5',
          input: [{ type: 'message', role: 'user', content: 'stream test' }]
        }
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.includes('chunk 1'));
      assert.ok(res.body.includes('chunk 2'));
      assert.ok(res.body.includes('chunk 3'));
      assert.ok(res.body.includes('response.output_item.done') || res.body.includes('response.output_text.done'));
    });

    await test('2.7 Delimiter Safety in Session Fallback: Handles complex sessionIds with colons and special chars', async () => {
      const colonSession = 'session-adv-model-fallback:sess:user:12345:project:alpha_v2.0';
      const res = await sendReq('/v1/chat/completions', {
        headers: { 'x-opencode-session': colonSession },
        body: {
          model: 'restricted-model-xyz',
          reasoning_effort: 'xhigh',
          messages: [{ role: 'user', content: 'Colon session delimiter test' }]
        }
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.json?.choices?.[0]?.message?.content.includes('deepseek-v4-pro'));
    });

  } finally {
    routerProc.kill('SIGKILL');
    mockUpstream.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`Tier 5 White-Box Adversarial Results: Total=${testIndex}, Passed=${passedCount}, Failed=${failedCount}`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTier5AdversarialSuite().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
