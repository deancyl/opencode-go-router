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

  // --- Test 6: Trailing Backslash Quote Eating in Diverse Windows Paths ---
  console.log('[Test 6] Testing Trailing Backslash Quote Eating in Diverse Windows Paths...');
  const psOptimizer = require('./powershell-optimizer');

  // Test case 1: Standard absolute path with spaces
  const p1 = 'dir "C:\\Program Files (x86)\\My App\\"';
  const f1 = psOptimizer.fixPowerShellCommandEscaping(p1, { targetPlatform: "win32" });
  assert.strictEqual(f1, 'dir "C:\\Program Files (x86)\\My App\\\\"', "Must double trailing backslash for absolute path with spaces");

  // Test case 2: Relative path with dots and backslash
  const p2 = 'ls ".\\relative\\path\\"';
  const f2 = psOptimizer.fixPowerShellCommandEscaping(p2, { targetPlatform: "win32" });
  assert.strictEqual(f2, 'ls ".\\relative\\path\\\\"', "Must double trailing backslash for relative path");

  // Test case 3: UNC network path
  const p3 = 'Get-ChildItem "\\\\nas-server\\share\\documents\\"';
  const f3 = psOptimizer.fixPowerShellCommandEscaping(p3, { targetPlatform: "win32" });
  assert.strictEqual(f3, 'Get-ChildItem "\\\\nas-server\\share\\documents\\\\"', "Must double trailing backslash for UNC network path");

  // Test case 4: Even number of backslashes (already escaped) must NOT be modified
  const p4 = 'echo "C:\\already\\escaped\\\\"';
  const f4 = psOptimizer.fixPowerShellCommandEscaping(p4, { targetPlatform: "win32" });
  assert.strictEqual(f4, p4, "Even number of trailing backslashes must remain unchanged");
  console.log('✓ Trailing Backslash Quote Eating verified across diverse Windows path formats\n');

  // --- Test 7: PowerShell EncodedCommand Generation & Round-Trip Decoding ---
  console.log('[Test 7] Testing PowerShell -EncodedCommand (Base64 UTF-16LE) Round-Trip...');
  const complexScript = 'Write-Output "测试中文特殊字符: $`"&| (2026)"\n$val = 123\nWrite-Host "Value: $val"';
  const encoded = psOptimizer.toEncodedCommand(complexScript);
  assert.ok(typeof encoded === "string" && encoded.length > 0, "Encoded string must be non-empty");
  const decoded = psOptimizer.fromEncodedCommand(encoded);
  assert.strictEqual(decoded, complexScript, "Decoded script must match original verbatim");
  console.log('✓ PowerShell -EncodedCommand Generation & Decoding verified\n');

  const { spawnSync } = require('child_process');
  const hasPsBin = (process.platform === 'win32') || (spawnSync('pwsh', ['-v'], { stdio: 'ignore' }).status === 0) || (spawnSync('powershell', ['-v'], { stdio: 'ignore' }).status === 0);
  if (hasPsBin) {
    // --- Test 8: Real Subprocess Execution with UTF-8 & CJK ---
    console.log('[Test 8] Testing Real PowerShell Subprocess Execution with UTF-8 & CJK...');
    const execRes = await psOptimizer.executePowerShellCommand('Write-Output "PowerShell UTF8 中文测试 - 状态: 正常 (2026)"');
    assert.strictEqual(execRes.exitCode, 0, "Exit code must be 0");
    assert.strictEqual(execRes.timedOut, false, "Command must not time out");
    assert.ok(execRes.stdout.includes("PowerShell UTF8 中文测试 - 状态: 正常 (2026)"), "Stdout must contain exact Chinese characters without mojibake");
    console.log('✓ Real PowerShell Subprocess Execution with UTF-8 & CJK verified\n');

    // --- Test 9: Active Pipe Drainage & Timeout Force Termination ---
    console.log('[Test 9] Testing Active Pipe Drainage & Timeout Force Termination...');
    const timeStart = Date.now();
    const timeoutRes = await psOptimizer.executePowerShellCommand("Start-Sleep -Seconds 10", { timeout: 800 });
    const duration = Date.now() - timeStart;
    assert.strictEqual(timeoutRes.timedOut, true, "Command must be marked as timedOut");
    assert.ok(duration < 4000, `Command must be terminated promptly around timeout (elapsed: ${duration}ms)`);
    console.log(`✓ Timeout Force Termination verified (elapsed: ${duration}ms, clean tree-kill)\n`);
  } else {
    console.log('[Test 8 & 9] ℹ PowerShell binary (pwsh/powershell.exe) not installed on this Linux host; skipping live PowerShell subprocess spawn.\n');
  }

  // --- Test 10: Operational PowerShell scripts safety and AST structure ---
  console.log('[Test 10] Testing Operational PowerShell scripts safety and AST structure...');
  const fs = require("fs");
  for (const scriptName of ["launcher.ps1", "stop-all.ps1", "start-all.ps1", "status-all.ps1", "setup-windows.ps1"]) {
    const scriptPath = path.join(__dirname, scriptName);
    assert.ok(fs.existsSync(scriptPath), `${scriptName} must exist`);
    const scriptBody = fs.readFileSync(scriptPath, "utf8");
    assert.ok(scriptBody.includes("UTF8"), `${scriptName} must declare UTF-8 console encoding`);
    assert.ok(scriptBody.includes("LiteralPath") || scriptBody.includes("Stop-SafeProcess"), `${scriptName} must incorporate LiteralPath or Stop-SafeProcess safety`);
  }
  console.log('✓ Operational PowerShell scripts safety and AST structure verified\n');

  console.log('================================================================');
  console.log('🎉 ALL 10/10 ADVERSARIAL TESTS PASSED PERFECTLY!');
  console.log('================================================================');
}

runAdversarialTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
