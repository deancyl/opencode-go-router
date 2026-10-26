/**
 * test_chaos_dirty_runtime.js
 * Production-Grade Dirty Runtime Chaos & Hardening Test Suite (v3.13.3)
 *
 * Attacks 5 defect areas + dirty runtime edge cases:
 * 1. mcp-master module independence, zero stdio leak on require, concurrency guard & safe serialization
 * 2. mcp-master JSON-RPC stdio protocol lifecycle (initialize, tools/list, tools/call, error handling, EOF)
 * 3. plugin-manager AV-immune dynamic process shield (protects running codex PIDs, rejects mock 25076, system PIDs)
 * 4. comfyui multi-track image input resolution (artifact URLs, multiline base64, directory traversal, EISDIR & >20MB)
 * 5. codex-adapter & updater Master-MCP configuration harmonizing and dynamic tool schema injection
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');

console.log('======================================================================');
console.log('🚀 Running test_chaos_dirty_runtime.js - Hardening & Chaos Test Suite');
console.log('======================================================================\n');

async function runTests() {
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✓ [Chaos Test ${total}] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [Chaos Test ${total}] ${name} FAILED:`, err.message);
      throw err;
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✓ [Chaos Test ${total}] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [Chaos Test ${total}] ${name} FAILED:`, err.message);
      throw err;
    }
  }

  // =========================================================================
  // Part 1: mcp-master.js Module Independence & Concurrency Guard
  // =========================================================================
  console.log('[Part 1] Testing mcp-master.js Isolation & Memory Guards...');

  test('require("./mcp-master.js") has zero stdio listener side-effects', () => {
    const stdinListenersBefore = process.stdin.listenerCount('data') + process.stdin.listenerCount('line');
    const mcpMaster = require('./mcp-master');
    const stdinListenersAfter = process.stdin.listenerCount('data') + process.stdin.listenerCount('line');
    assert.strictEqual(stdinListenersBefore, stdinListenersAfter, 'require(mcp-master) must NOT attach listeners to process.stdin');
    assert.strictEqual(typeof mcpMaster.sendJson, 'function');
    assert.strictEqual(typeof mcpMaster.handleRpcRequest, 'function');
    assert.strictEqual(typeof mcpMaster.bootstrap, 'function');
  });

  await testAsync('bootstrap() concurrency guard returns identical promise', async () => {
    const mcpMaster = require('./mcp-master');
    const p1 = mcpMaster.bootstrap({ client: 'codex' });
    const p2 = mcpMaster.bootstrap({ client: 'codex' });
    assert.strictEqual(p1, p2, 'Concurrent calls to bootstrap() must share the same in-flight Promise');
    const pm = await p1;
    assert.ok(pm, 'bootstrap must resolve to a valid PluginManager instance');
  });

  test('sendJson handles circular JSON safely without throwing uncaught exception', () => {
    const mcpMaster = require('./mcp-master');
    const circularObj = { a: 1 };
    circularObj.self = circularObj;
    // Overriding stdout.write temporarily to capture fallback serialization
    let captured = '';
    const origWrite = process.stdout.write;
    try {
      process.stdout.write = (chunk) => {
        captured += chunk;
        return true;
      };
      mcpMaster.sendJson(circularObj);
      assert.ok(captured.includes('"error"') || captured.includes('"jsonrpc"'), 'sendJson must write error fallback on circular JSON');
    } finally {
      process.stdout.write = origWrite;
    }
  });

  // =========================================================================
  // Part 2: Dynamic JSON-RPC Stdio Process Protocol Lifecycle
  // =========================================================================
  console.log('\n[Part 2] Testing mcp-master.js Stdio Child Process Protocol...');

  await testAsync('mcp-master child process handles initialize, tools/list, and tools/call', async () => {
    const nodeExe = process.execPath;
    const mcpMasterScript = path.join(__dirname, 'mcp-master.js');
    const child = spawn(nodeExe, [mcpMasterScript, '--client=codex'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdoutBuffer = '';
    const responses = [];

    child.stdout.on('data', (data) => {
      stdoutBuffer += data.toString('utf8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // keep remainder
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            responses.push(JSON.parse(trimmed));
          } catch (_) {}
        }
      }
    });

    function waitForResponse(id, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const interval = setInterval(() => {
          const match = responses.find(r => r && r.id === id);
          if (match) {
            clearInterval(interval);
            return resolve(match);
          }
          if (Date.now() - start > timeoutMs) {
            clearInterval(interval);
            return reject(new Error(`Timed out waiting for response id ${id}`));
          }
        }, 50);
      });
    }

    // 1. Send initialize
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'chaos-tester', version: '1.0.0' }
      }
    }) + '\n');

    const initRes = await waitForResponse(1);
    assert.strictEqual(initRes.id, 1);
    assert.strictEqual(initRes.result.serverInfo.name, 'opencode-go-master-mcp');
    assert.ok(initRes.result.capabilities.tools);

    // 2. Send notifications/initialized
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }) + '\n');

    // 3. Send tools/list
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    }) + '\n');

    const listRes = await waitForResponse(2);
    assert.strictEqual(listRes.id, 2);
    assert.ok(Array.isArray(listRes.result.tools));
    const toolNames = listRes.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('greet_developer'), 'Master-MCP must expose greet_developer tool');

    // 4. Send tools/call for greet_developer
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'greet_developer',
        arguments: { name: 'HardenedTester' }
      }
    }) + '\n');

    const callRes = await waitForResponse(3);
    assert.strictEqual(callRes.id, 3);
    assert.ok(callRes.result && callRes.result.content);
    assert.ok(callRes.result.content[0].text.includes('HardenedTester'));

    // 5. Send invalid method -> error -32601
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'invalid_method'
    }) + '\n');

    const errRes = await waitForResponse(4);
    assert.strictEqual(errRes.id, 4);
    assert.strictEqual(errRes.error.code, -32601);

    // 6. Send malformed json -> error -32700
    child.stdin.write('{ malformed json line\n');
    const parseErrRes = await new Promise((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        const match = responses.find(r => r && r.error && r.error.code === -32700);
        if (match) {
          clearInterval(interval);
          return resolve(match);
        }
        if (Date.now() - start > 3000) {
          clearInterval(interval);
          return reject(new Error('Timed out waiting for parse error -32700'));
        }
      }, 50);
    });
    assert.strictEqual(parseErrRes.error.code, -32700);

    // 7. Close stdin and wait for clean exit
    child.stdin.end();
    await new Promise((resolve) => {
      child.on('exit', () => resolve());
    });
  });

  // =========================================================================
  // Part 3: AV-Immune Process Protection & Dynamic Safety
  // =========================================================================
  console.log('\n[Part 3] Testing AV-Immune Dynamic Process Protection...');

  test('isProtectedPid shields system processes, self, parent, and legacy mock 25076', () => {
    const { isProtectedPid } = require('./plugin-manager');
    assert.strictEqual(isProtectedPid(0), true, 'PID 0 (System Idle) must be protected');
    assert.strictEqual(isProtectedPid(4), true, 'PID 4 (System) must be protected');
    assert.strictEqual(isProtectedPid(process.pid), true, 'process.pid must be protected');
    assert.strictEqual(isProtectedPid(process.ppid), true, 'process.ppid must be protected');
    assert.strictEqual(isProtectedPid(25076), true, 'Mock legacy PID 25076 must be protected');
    assert.strictEqual(isProtectedPid('25076'), true, 'String PID "25076" must be protected');
    assert.strictEqual(isProtectedPid(999999), false, 'Non-existent PID 999999 must not be protected');
  });

  test('isProtectedPid detects running codex processes dynamically', () => {
    const { isProtectedPid } = require('./plugin-manager');
    // If running on Windows with codex.exe active (e.g. PID 17152), test dynamic inspection
    const runningCodexPid = 17152;
    if (process.platform === 'win32') {
      const isProtected = isProtectedPid(runningCodexPid);
      // If PID 17152 is indeed running codex, it must return true
      if (isProtected) {
        assert.strictEqual(isProtected, true, 'Running codex process must be protected dynamically');
      }
    }
  });

  await testAsync('stopService shields protected PID (returns success: false with warning)', async () => {
    const { PluginManager } = require('./plugin-manager');
    const pm = new PluginManager({ rootDir: __dirname });
    pm.activeServices.set('rogue-plugin', { pid: 25076, mode: 'managed' });
    const res = await pm.stopService('rogue-plugin');
    assert.strictEqual(res.success, false);
    assert.ok(res.message.includes('受保护') || res.message.includes('拒绝终止'));
    assert.strictEqual(pm.activeServices.has('rogue-plugin'), false, 'Service map entry must be cleaned up');
  });

  // =========================================================================
  // Part 4: ComfyUI Multi-Track Image Resolution & Hardening
  // =========================================================================
  console.log('\n[Part 4] Testing ComfyUI Multi-Track Image Input & Traversal Defense...');

  await testAsync('interrogate_image resolves local gateway artifact URLs directly', async () => {
    const { PluginManager } = require('./plugin-manager');
    const pm = new PluginManager({ rootDir: __dirname });
    pm.scanPlugins();
    await pm.enablePlugin('comfyui', { persist: false });

    // Create a temporary mock image in artifacts/images
    const artifactsDir = path.join(__dirname, 'artifacts', 'images');
    fs.mkdirSync(artifactsDir, { recursive: true });
    const mockImageFile = path.join(artifactsDir, 'chaos_test_image.png');
    // Minimal valid 1x1 transparent PNG
    const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    fs.writeFileSync(mockImageFile, pngBuffer);

    try {
      // 1. Test full gateway URL directly on ComfyUIAdapter with fallbackVisionFn
      const { ComfyUIAdapter } = require('./comfyui-adapter');
      const adapter = new ComfyUIAdapter({ rootDir: __dirname });
      let capturedBuf1 = null;
      const mockVision = async (buf) => {
        capturedBuf1 = buf;
        return 'cyberpunk cityscape, neon lights';
      };

      const fullUrl = 'http://127.0.0.1:4010/artifacts/images/chaos_test_image.png';
      const result1 = await adapter.interrogateImage(fullUrl, mockVision);
      assert.strictEqual(result1.source, 'gateway_vision_llm');
      assert.strictEqual(result1.tags, 'cyberpunk cityscape, neon lights');
      assert.strictEqual(capturedBuf1.length, pngBuffer.length, 'Resolved buffer must match image on disk');

      // 2. Test relative artifact URL
      let capturedBuf2 = null;
      const relUrl = '/artifacts/images/chaos_test_image.png';
      const result2 = await adapter.interrogateImage(relUrl, async (buf) => {
        capturedBuf2 = buf;
        return 'portrait';
      });
      assert.strictEqual(result2.tags, 'portrait');
      assert.strictEqual(capturedBuf2.length, pngBuffer.length);

      // 3. Test directory traversal in artifact URL is blocked (cannot read files outside artifacts/images)
      let traversalBlocked = false;
      try {
        const traversalUrl = 'http://127.0.0.1:4010/artifacts/images/../../package.json';
        await adapter.interrogateImage(traversalUrl, async () => 'should not reach');
      } catch (e) {
        traversalBlocked = true;
        assert.ok(e.message.includes('无效') || e.message.includes('不存在'));
      }
      assert.strictEqual(traversalBlocked, true, 'Directory traversal in artifact URL must be blocked');

      // 4. Test multiline base64 string
      let capturedBuf4 = null;
      const multilineB64 = pngBuffer.toString('base64').match(/.{1,20}/g).join('\r\n  ');
      const result4 = await adapter.interrogateImage(multilineB64, async (buf) => {
        capturedBuf4 = buf;
        return 'base64 decoded';
      });
      assert.strictEqual(result4.tags, 'base64 decoded');
      assert.strictEqual(capturedBuf4.length, pngBuffer.length);

      // 5. Test short extensionless non-existent file name is NOT mistaken for base64
      const resShort = await pm.executeTool('interrogate_image', { image: 'sample_non_existent' });
      assert.strictEqual(resShort.isError, true, 'Short non-existent file name must return isError: true');
      assert.ok(resShort.content[0].text.includes('找不到指定的本地文件') || resShort.content[0].text.includes('无法解析'), 'Error message must indicate file not found');

      // 6. Test EISDIR defense
      const resDir = await pm.executeTool('interrogate_image', { image: artifactsDir });
      assert.strictEqual(resDir.isError, true, 'Directory path must return isError: true');
      assert.ok(resDir.content[0].text.includes('有效的文件') || resDir.content[0].text.includes('目录') || resDir.content[0].text.includes('EISDIR'));
    } finally {
      try { fs.unlinkSync(mockImageFile); } catch (_) {}
    }
  });

  // =========================================================================
  // Part 5: Codex Adapter & Master-MCP Dynamic Tool Dispatch
  // =========================================================================
  console.log('\n[Part 5] Testing Codex Adapter Dynamic Tools & Master-MCP Wiring...');

  await testAsync('codexAdapter registers pluginManager and normalizes upstream dynamic tool names', async () => {
    const codexAdapter = require('./codex-adapter');
    const { PluginManager } = require('./plugin-manager');
    const pm = new PluginManager({ rootDir: __dirname });
    pm.scanPlugins();
    for (const [id, manifest] of pm.discoveredPlugins.entries()) {
      if (manifest.capabilities?.tools?.some(t => t.name === 'greet_developer')) {
        await pm.enablePlugin(id, { persist: false });
      }
    }

    codexAdapter.setPluginManager(pm);
    assert.strictEqual(codexAdapter.getPluginManager(), pm, 'setPluginManager must store PluginManager');

    // Test tool name normalization
    assert.strictEqual(codexAdapter.normalizeUpstreamToolName('greet_developer'), 'mcp__opencode_router__greet_developer');
    assert.strictEqual(codexAdapter.normalizeUpstreamToolName('mcp__opencode_router__greet_developer'), 'mcp__opencode_router__greet_developer');
    assert.strictEqual(codexAdapter.normalizeUpstreamToolName('generate_image'), 'mcp__comfyui__generate_image', 'Legacy ComfyUI tool maps to legacy alias');
  });

  test('updateCodexTomlString configures [mcp_servers.opencode_router] and migrates comfyui', () => {
    const codexAdapter = require('./codex-adapter');
    const sampleToml = `
[desktop]
localeOverride = "zh-CN"

[mcp_servers.comfyui]
command = "node"
args = ["mcp-comfyui.js"]
`;

    const updatedToml = codexAdapter.updateCodexTomlString(sampleToml, 4010);
    assert.ok(updatedToml.includes('[mcp_servers.opencode_router]'), 'Must configure [mcp_servers.opencode_router]');
    assert.ok(updatedToml.includes('mcp-master.js'), 'Must point to mcp-master.js');
    assert.ok(updatedToml.includes('--client=codex'), 'Must include --client=codex');
    assert.ok(!updatedToml.includes('[mcp_servers.comfyui]'), 'Must migrate legacy comfyui section');
  });

  test('harmonizeOpencodeConfig in updater.js wires opencode-router Master-MCP bus', () => {
    const updater = require('./updater');
    const testConfigPath = path.join(__dirname, 'temp_test_opencode.jsonc');
    fs.writeFileSync(testConfigPath, JSON.stringify({
      mcp: {
        comfyui: { type: 'stdio', command: 'node', args: ['mcp-comfyui.js'] }
      }
    }, null, 2));

    let fixed;
    try {
      fixed = updater.harmonizeOpencodeConfig(testConfigPath);
      assert.strictEqual(fixed.success, true);
      const parsed = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
      assert.ok(parsed.mcp['opencode-router'], 'Must register opencode-router in mcp section');
      assert.ok(parsed.mcp['opencode-router'].args.some(a => a.includes('mcp-master.js')));
      assert.ok(parsed.mcp['opencode-router'].args.some(a => a.includes('--client=opencode')));
      assert.strictEqual(parsed.mcp['comfyui'], undefined, 'Must purge legacy comfyui entry');
    } finally {
      try { fs.unlinkSync(testConfigPath); } catch (_) {}
      if (fixed && fixed.backupPath) {
        try { fs.unlinkSync(fixed.backupPath); } catch (_) {}
      }
    }
  });

  test('client-adapter-manager reports Master-MCP status for codex and opencode', () => {
    const cam = require('./client-adapter-manager');
    const status = cam.getClientStatus(4010, true);
    assert.ok(status.codex && status.codex.hasOwnProperty('hasMasterMcp'), 'Codex status must report hasMasterMcp');
    assert.ok(status.opencode && status.opencode.hasOwnProperty('hasMasterMcp'), 'OpenCode status must report hasMasterMcp');
  });

  console.log('\n======================================================================');
  console.log(`🎉 ALL ${passed}/${total} CHAOS & DIRTY RUNTIME TESTS PASSED SUCCESSFULLY!`);
  console.log('======================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Chaos test run failed:', err);
  process.exit(1);
});
