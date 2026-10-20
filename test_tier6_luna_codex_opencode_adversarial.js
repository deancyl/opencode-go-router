/**
 * Test Tier 6 Adversarial Verification Suite:
 * 1. Luna Responses 404/405/501 auto-downgrade & loop prevention
 * 2. Codex Rule 33 empty stream assistant injection & in-place stream reconnect
 * 3. OpenCode 2.0 agent declaration doctor audit, custom prompt preservation & Luna support
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const codexAdapter = require('./codex-adapter');
const updater = require('./updater');

async function main() {
  console.log('================================================================');
  console.log('🛡️  Starting Tier 6 Luna, Codex Rule 33 & OpenCode 2.0 Verification');
  console.log('================================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  async function test(name, fn) {
    totalTests++;
    try {
      await fn();
      passedTests++;
      console.log(`[PASS] Test ${totalTests}: ${name}`);
    } catch (err) {
      console.error(`[FAIL] Test ${totalTests}: ${name}`);
      console.error(err);
      process.exit(1);
    }
  }

  // -------------------------------------------------------------
  // SECTION 1: Luna Responses 404/405/501 & Loop Prevention
  // -------------------------------------------------------------
  console.log('--- SECTION 1: Luna Dynamic Pool & Responses Downgrade ---');

  await test('1.1 Initial Native Responses model status for Luna', async () => {
    codexAdapter.clearNativeResponsesUnsupported();
    assert.strictEqual(codexAdapter.isNativeResponsesModel('gpt-5.6-luna'), true);
    assert.strictEqual(codexAdapter.isNativeResponsesModel('opencode-go/gpt-5.6-luna'), true);
    assert.strictEqual(codexAdapter.isNativeResponsesUnsupported('gpt-5.6-luna'), false);
  });

  await test('1.2 markNativeResponsesUnsupported updates status and blocks loop', async () => {
    codexAdapter.markNativeResponsesUnsupported('gpt-5.6-luna');
    assert.strictEqual(codexAdapter.isNativeResponsesUnsupported('gpt-5.6-luna'), true);
    assert.strictEqual(codexAdapter.isNativeResponsesUnsupported('opencode-go/gpt-5.6-luna'), true);
    assert.strictEqual(codexAdapter.isNativeResponsesModel('gpt-5.6-luna'), false);
    assert.strictEqual(codexAdapter.isNativeResponsesModel('opencode-go/gpt-5.6-luna'), false);

    // Other native models remain unaffected
    assert.strictEqual(codexAdapter.isNativeResponsesModel('gpt-6-luna'), true);

    // Clear pool restores
    codexAdapter.clearNativeResponsesUnsupported();
    assert.strictEqual(codexAdapter.isNativeResponsesModel('gpt-5.6-luna'), true);
  });

  // -------------------------------------------------------------
  // SECTION 2: Codex Rule 33 Empty Stream Assistant Injection & Reconnect
  // -------------------------------------------------------------
  console.log('\n--- SECTION 2: Rule 33 Graceful Closure & Reconnect ---');

  class MockClientRes extends EventEmitter {
    constructor() {
      super();
      this.headersSent = false;
      this.writableEnded = false;
      this.events = [];
      this.writtenData = [];
    }
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    }
    write(chunk) {
      this.writtenData.push(chunk);
      const str = chunk.toString();
      const lines = str.split('\n');
      for (const l of lines) {
        if (l.startsWith('event: ')) {
          const ev = l.slice(7).trim();
          this.events.push(ev);
        }
      }
    }
    end() {
      this.writableEnded = true;
      this.emit('finish');
    }
  }

  await test('2.1 Non-streaming Chat empty output injects assistant block (no bare output: [])', async () => {
    const emptyChatJson = { id: 'chat_empty_1', choices: [{ message: { content: '' } }] };
    const resp = codexAdapter.convertChatResponseToResponses(emptyChatJson, 'deepseek-v4.1-flash');
    assert.strictEqual(resp.status, 'failed');
    assert.ok(Array.isArray(resp.output));
    assert.strictEqual(resp.output.length, 1);
    assert.strictEqual(resp.output[0].type, 'message');
    assert.strictEqual(resp.output[0].role, 'assistant');
    assert.ok(resp.output[0].content[0].text.includes('网关服务提示'));
  });

  await test('2.2 Non-streaming Anthropic empty output injects assistant block (no bare output: [])', async () => {
    const emptyAnthropicJson = { id: 'msg_empty_1', content: [] };
    const resp = codexAdapter.convertAnthropicResponseToResponses(emptyAnthropicJson, 'claude-3-5-sonnet');
    assert.strictEqual(resp.status, 'failed');
    assert.ok(Array.isArray(resp.output));
    assert.strictEqual(resp.output.length, 1);
    assert.strictEqual(resp.output[0].type, 'message');
    assert.strictEqual(resp.output[0].role, 'assistant');
    assert.ok(resp.output[0].content[0].text.includes('网关服务提示'));
  });

  await test('2.3 bridgeResponsesStream injects assistant events before response.failed on empty stream', async () => {
    const upstream = new EventEmitter();
    upstream.destroy = () => {};
    const client = new MockClientRes();

    let finishedCalled = false;
    codexAdapter.bridgeResponsesStream(upstream, client, 'gpt-5.6-luna', 'resp_test_1', () => {
      finishedCalled = true;
    });

    upstream.emit('end');

    assert.strictEqual(finishedCalled, true);
    assert.strictEqual(client.writableEnded, true);

    const itemAddedIdx = client.events.indexOf('response.output_item.added');
    const partAddedIdx = client.events.indexOf('response.content_part.added');
    const itemDoneIdx = client.events.indexOf('response.output_item.done');
    const failedIdx = client.events.indexOf('response.failed');

    assert.ok(itemAddedIdx !== -1, 'Must have output_item.added');
    assert.ok(partAddedIdx !== -1, 'Must have content_part.added');
    assert.ok(itemDoneIdx !== -1, 'Must have output_item.done');
    assert.ok(failedIdx !== -1, 'Must have response.failed');

    assert.ok(itemAddedIdx < partAddedIdx, 'output_item.added before content_part.added');
    assert.ok(partAddedIdx < itemDoneIdx, 'content_part.added before output_item.done');
    assert.ok(itemDoneIdx < failedIdx, 'output_item.done before response.failed to unlock UI spinner');

    const failedPayloadStr = client.writtenData.find(c => c.includes('response.failed'));
    assert.ok(failedPayloadStr, 'Must contain response.failed payload');
    const dataLine = failedPayloadStr.split('\n').find(l => l.startsWith('data: '));
    const parsedFailed = JSON.parse(dataLine.slice(6));
    assert.strictEqual(parsedFailed.response.status, 'failed');
    assert.strictEqual(parsedFailed.response.output.length, 1);
    assert.strictEqual(parsedFailed.response.output[0].role, 'assistant');
  });

  await test('2.4 bridgeResponsesStream triggers transparent reconnectFn on 0-chunk disconnect', async () => {
    const upstream1 = new EventEmitter();
    upstream1.destroy = () => {};
    const upstream2 = new EventEmitter();
    upstream2.destroy = () => {};
    const client = new MockClientRes();

    let reconnectCalled = false;
    const reconnectFn = (onSuccess, onFail) => {
      reconnectCalled = true;
      onSuccess(upstream2);
    };

    let finishedCalled = false;
    codexAdapter.bridgeResponsesStream(upstream1, client, 'gpt-5.6-luna', 'resp_test_recon', () => {
      finishedCalled = true;
    }, null, reconnectFn);

    upstream1.emit('close');
    assert.strictEqual(reconnectCalled, true, 'reconnectFn must be called when stream closed with 0 chunks');

    upstream2.emit('data', 'data: {"choices":[{"delta":{"content":"Hello from reconnect"}}]}\n\n');
    upstream2.emit('end');

    assert.strictEqual(finishedCalled, true);
    assert.strictEqual(client.writableEnded, true);
    assert.ok(client.events.includes('response.completed'), 'Must complete successfully after reconnect');
    assert.strictEqual(client.events.includes('response.failed'), false, 'Must not emit failed when reconnected');
  });

  await test('2.5 bridgeAnthropicStream injects assistant events before response.failed on empty stream', async () => {
    const upstream = new EventEmitter();
    upstream.destroy = () => {};
    const client = new MockClientRes();

    let finishedCalled = false;
    codexAdapter.bridgeAnthropicStream(upstream, client, 'claude-3-5-sonnet', 'resp_test_anth_1', () => {
      finishedCalled = true;
    });

    upstream.emit('end');

    assert.strictEqual(finishedCalled, true);
    assert.strictEqual(client.writableEnded, true);

    const itemAddedIdx = client.events.indexOf('response.output_item.added');
    const partAddedIdx = client.events.indexOf('response.content_part.added');
    const itemDoneIdx = client.events.indexOf('response.output_item.done');
    const failedIdx = client.events.indexOf('response.failed');

    assert.ok(itemAddedIdx !== -1, 'Must have output_item.added');
    assert.ok(partAddedIdx !== -1, 'Must have content_part.added');
    assert.ok(itemDoneIdx !== -1, 'Must have output_item.done');
    assert.ok(failedIdx !== -1, 'Must have response.failed');
    assert.ok(itemDoneIdx < failedIdx, 'output_item.done before response.failed');
  });

  await test('2.6 bridgeAnthropicStream triggers transparent reconnectFn on 0-chunk disconnect', async () => {
    const upstream1 = new EventEmitter();
    upstream1.destroy = () => {};
    const upstream2 = new EventEmitter();
    upstream2.destroy = () => {};
    const client = new MockClientRes();

    let reconnectCalled = false;
    const reconnectFn = (onSuccess, onFail) => {
      reconnectCalled = true;
      onSuccess(upstream2);
    };

    let finishedCalled = false;
    codexAdapter.bridgeAnthropicStream(upstream1, client, 'claude-3-5-sonnet', 'resp_test_anth_recon', () => {
      finishedCalled = true;
    }, null, reconnectFn);

    upstream1.emit('close');
    assert.strictEqual(reconnectCalled, true, 'reconnectFn must be called on Anthropic empty stream disconnect');

    upstream2.emit('data', 'data: {"type":"content_block_start","content_block":{"type":"text"}}\n\n');
    upstream2.emit('data', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello Anthropic"}}\n\n');
    upstream2.emit('end');

    assert.strictEqual(finishedCalled, true);
    assert.strictEqual(client.writableEnded, true);
    assert.ok(client.events.includes('response.completed'));
  });

  // -------------------------------------------------------------
  // SECTION 3: OpenCode 2.0 Agent Declaration & Custom Prompt Defense
  // -------------------------------------------------------------
  console.log('\n--- SECTION 3: OpenCode 2.0 Agent Declaration & Luna Support ---');

  const tmpDir = path.join(os.tmpdir(), 'opencode-test-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  await test('3.1 harmonizeOpencodeConfig creates agent.goal and agent[\'goal-verify\']', async () => {
    const configPath = path.join(tmpDir, 'opencode.jsonc');
    const res = updater.harmonizeOpencodeConfig(configPath, 4010);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.agentGoalInjected, true);

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(saved.agent, 'Must have agent field');
    assert.ok(saved.agent.goal, 'Must have agent.goal');
    assert.strictEqual(saved.agent.goal.mode, 'primary');
    assert.ok(saved.agent.goal.prompt.includes('Execute explicit goals'));
    assert.ok(saved.agent['goal-verify'], 'Must have agent["goal-verify"]');
    assert.strictEqual(saved.agent['goal-verify'].mode, 'subagent');
    assert.strictEqual(saved.agent['goal-verify'].hidden, true);
  });

  await test('3.2 harmonizeOpencodeConfig strictly preserves user customized prompt', async () => {
    const configPath = path.join(tmpDir, 'opencode-custom.jsonc');
    const customPrompt = 'My Custom Specialized Prompt for Goal Agent: Do not deviate.';
    const initialData = {
      provider: { 'opencode-go': { models: {} } },
      agent: {
        goal: {
          mode: 'primary',
          prompt: customPrompt,
          description: 'Custom description'
        }
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(initialData, null, 2), 'utf8');

    const res = updater.harmonizeOpencodeConfig(configPath, 4010);
    assert.strictEqual(res.success, true);

    const updated = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.strictEqual(updated.agent.goal.prompt, customPrompt, 'Custom prompt MUST be strictly preserved');
    assert.ok(updated.agent['goal-verify'], 'Must backfill missing goal-verify');
  });

  await test('3.3 harmonizeOpencodeConfig supports Luna as preferred model', async () => {
    const configPath = path.join(tmpDir, 'opencode-luna.jsonc');
    const res = updater.harmonizeOpencodeConfig(configPath, 4010, { preferredModel: 'opencode-go/gpt-5.6-luna' });
    assert.strictEqual(res.success, true);

    const updated = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.strictEqual(updated.model, 'opencode-go/gpt-5.6-luna');
    assert.ok(updated.provider['opencode-go'].models['gpt-5.6-luna'], 'Luna must be present in models map');
  });

  // Clean up tmpDir
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TIER 6 ADVERSARIAL TESTS PASSED!`);
  console.log('================================================================');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
