const assert = require('assert');
const path = require('path');
const http = require('http');

const codexAdapter = require('./codex-adapter');
const contextCompactor = require('./context-compactor');

async function runAdversarialTests() {
  console.log('================================================================');
  console.log('🛡️ Starting Degeneration Guard & PowerShell Anchor Adversarial Suite');
  console.log('================================================================\n');

  // --- Test 1: Canonical Model Aliases & Normalization ---
  console.log('[Test 1] Testing Canonical Model Aliases Normalization (Zero-Drift)...');
  assert.strictEqual(contextCompactor.normalizeModelName('deepseek-flash'), 'deepseek-v4.1-flash');
  assert.strictEqual(contextCompactor.normalizeModelName('deepseek-v4-flash'), 'deepseek-v4.1-flash');
  assert.strictEqual(contextCompactor.normalizeModelName('deepseek_flash'), 'deepseek-v4.1-flash');
  assert.strictEqual(contextCompactor.normalizeModelName('DEEPSEEK-FLASH'), 'deepseek-v4.1-flash');
  assert.strictEqual(contextCompactor.normalizeModelName('opencode-go/deepseek-flash'), 'deepseek-v4.1-flash');
  assert.strictEqual(contextCompactor.normalizeModelName('deepseek-v4.1-flash'), 'deepseek-v4.1-flash');
  assert.strictEqual(contextCompactor.normalizeModelName('deepseek-pro'), 'deepseek-v4-pro');
  console.log('✓ Canonical Model Aliases Normalization verified: zero model name splitting\n');

  // --- Test 2: Windows Tool Arguments Auto-Correction Barrier ---
  console.log('[Test 2] Testing Tool Arguments Auto-Correction Barrier (Bash to PowerShell)...');
  const originalPlatform = process.platform;
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const rawArgsBash = JSON.stringify({
      cmd: "& '.\\restart_and_wait.ps1'",
      shell: "bash",
      workdir: "C:\\Users\\deanc\\ComfyUI-Zluda"
    });
    const correctedArgs = codexAdapter.autoCorrectToolArgs('exec_command', rawArgsBash);
    const parsed = JSON.parse(correctedArgs);
    assert.strictEqual(parsed.shell, 'powershell', 'Bash shell must be auto-corrected to powershell on Windows');
    assert.strictEqual(parsed.cmd, "& '.\\restart_and_wait.ps1'");

    // Verify non-exec_command tools are untouched
    const customToolArgs = JSON.stringify({ shell: "bash", file: "test.py" });
    assert.strictEqual(codexAdapter.autoCorrectToolArgs('custom_tool', customToolArgs), customToolArgs);
    console.log('✓ Tool Arguments Auto-Correction Barrier verified: bash successfully corrected to powershell\n');
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }

  // --- Test 3: Windows Tool Schema Normalization & Environment Anchor Injection ---
  console.log('[Test 3] Testing Tool Schema Normalization & Environment Anchor...');
  const responsesReqWithShell = {
    model: 'deepseek-v4.1-flash',
    platform: 'win32',
    instructions: 'You are Codex.',
    tools: [
      {
        type: 'function',
        name: 'exec_command',
        description: 'Runs a shell command',
        parameters: {
          type: 'object',
          properties: {
            cmd: { type: 'string' },
            shell: { type: 'string', enum: ['bash', 'powershell'] }
          }
        }
      }
    ],
    input: [
      { type: 'message', role: 'user', content: 'Check status' }
    ]
  };

  const convertedChat = codexAdapter.convertResponsesToChatPayload(responsesReqWithShell);
  const toolExec = convertedChat.tools.find(t => t.function?.name === 'exec_command');
  assert.ok(toolExec, 'exec_command tool present');
  assert.strictEqual(toolExec.function.parameters.properties.shell.default, 'powershell', 'Default shell must be powershell');
  assert.strictEqual(toolExec.function.parameters.properties.shell.enum[0], 'powershell', 'powershell must be first in enum');
  assert.ok(toolExec.function.description.includes('PowerShell'), 'Tool description must mention PowerShell');

  const sysMsg = convertedChat.messages.find(m => m.role === 'system');
  assert.ok(sysMsg, 'System message present');
  assert.ok(sysMsg.content.includes('Windows Native PowerShell'), 'System instructions must include Windows Environment Lock');
  console.log('✓ Tool Schema Normalization & Environment Anchor verified\n');

  // --- Test 4: Stream Degeneration & Repetition Loop Circuit Breaker ---
  console.log('[Test 4] Testing Stream Degeneration & Repetition Loop Detector...');
  const detector = new codexAdapter.StreamDegenerationDetector({ maxRepeatCount: 4, minPhraseLen: 6 });

  // Normal text chunk streaming
  assert.strictEqual(detector.feed('Here is the content of the file.\n\n').shouldHalt, false);
  assert.strictEqual(detector.feed('Let me search. ').shouldHalt, false);
  assert.strictEqual(detector.feed('Let me search. ').shouldHalt, false);
  assert.strictEqual(detector.feed('Let me search. ').shouldHalt, false);
  // 4th consecutive occurrence -> triggers circuit breaker!
  const degenResult = detector.feed('Let me search. ');
  assert.strictEqual(degenResult.shouldHalt, true, 'Must trigger circuit breaker on 4th consecutive repetition');
  assert.strictEqual(degenResult.triggeredPhrase, 'Let me search.', 'Must identify correct repeating phrase');
  console.log('✓ Stream Degeneration Detector verified: successfully trapped and halted repetition loop\n');

  // --- Test 5: End-to-End Streaming Degeneration Circuit Breaker in bridgeResponsesStream ---
  console.log('[Test 5] Testing End-to-End Streaming Degeneration Circuit Breaker...');
  const { EventEmitter } = require('events');
  const mockUpstream = new EventEmitter();
  mockUpstream.destroy = () => { mockUpstream.destroyed = true; };

  let sseEvents = [];
  const mockClientRes = {
    writableEnded: false,
    destroyed: false,
    writeHead: () => {},
    write: (chunk) => {
      sseEvents.push(chunk);
    },
    end: () => {
      mockClientRes.writableEnded = true;
    },
    once: () => {},
    removeListener: () => {}
  };

  codexAdapter.bridgeResponsesStream(mockUpstream, mockClientRes, 'deepseek-v4.1-flash', 'test_degen_resp_1', () => {});

  // Send normal output
  mockUpstream.emit('data', Buffer.from('data: {"choices":[{"delta":{"content":"File analysis: "}}]}\n\n'));
  // Send repetitive tokens ("Let me search. ") 5 times
  for (let i = 0; i < 5; i++) {
    mockUpstream.emit('data', Buffer.from('data: {"choices":[{"delta":{"content":"Let me search. "}}]}\n\n'));
  }

  // Verify stream was terminated cleanly
  assert.strictEqual(mockClientRes.writableEnded, true, 'Client stream must be ended cleanly on degeneration');
  assert.strictEqual(mockUpstream.destroyed, true, 'Upstream stream must be destroyed to save tokens');

  const allSseText = sseEvents.join('');
  assert.ok(allSseText.includes('网关智能防御：检测到模型输出产生重复循环'), 'SSE output must contain user-friendly circuit breaker notice');
  assert.ok(allSseText.includes('response.completed'), 'SSE stream must emit response.completed');
  console.log('✓ End-to-End Streaming Degeneration Circuit Breaker verified!\n');

  console.log('================================================================');
  console.log('🎉 ALL 5/5 ADVERSARIAL TESTS PASSED PERFECTLY!');
  console.log('================================================================');
}

runAdversarialTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
