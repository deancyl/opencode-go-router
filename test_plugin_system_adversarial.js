/**
 * test_plugin_system_adversarial.js
 * =========================================================================
 * Full-Spectrum Adversarial & Regression Test Suite for:
 *  1. PluginManager Microkernel & Manifest Schema Validation
 *  2. 4-Level Pre-flight Topology Checks (Port, VRAM, Tool Collisions, Conflicts)
 *  3. Master-MCP JSON-RPC 2.0 Stdio Aggregator Bus Handshake & Tool Execution
 *  4. Granular Client Scopes & Per-Client Dynamic Tool Masking
 *  5. Windows Silent Daemon Lifecycle & AV-Immune Compliance
 *  6. HTTP Gateway Plugin Center Endpoints (/balancer/api/plugins/*)
 *  7. ComfyUI and OMO 100% Backward Compatibility & Zero-Regression Guard
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const { PluginManager } = require('./plugin-manager.js');
const mcpMaster = require('./mcp-master.js');
const serverModule = require('./server.js');
const comfyAdapter = require('./comfyui-adapter.js');
const updater = require('./updater.js');
const clientAdapter = require('./client-adapter-manager.js');

console.log('================================================================================');
console.log('🛡️  Starting Plugin System Microkernel & Master-MCP Adversarial Suite');
console.log('================================================================================\n');

let passCount = 0;
let failCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    console.error(err.stack);
    failCount++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    console.error(err.stack);
    failCount++;
  }
}

(async () => {
  const ROOT_DIR = __dirname;
  const testTmpDir = path.join(os.tmpdir(), 'test-plugin-sandbox-' + Date.now());
  fs.mkdirSync(testTmpDir, { recursive: true });

  const pm = new PluginManager({
    rootDir: ROOT_DIR,
    configPath: path.join(testTmpDir, 'config.test.json'),
    routerPort: 4010
  });

  // ---------------------------------------------------------------------------
  // Group 1: Scanning, Manifest Parsing & Schema Normalization
  // ---------------------------------------------------------------------------
  console.log('\n[Group 1] 插件目录扫描、清单校验与 Schema 规范化审计...');

  runTest('1.1 自动扫描并发现核心插件 (ComfyUI, OMO, ExampleGreeter)', () => {
    const list = pm.scanPlugins();
    assert(Array.isArray(list), 'scanPlugins 必须返回数组');
    const ids = list.map(p => p.id);
    assert(ids.includes('comfyui'), '必须发现 ComfyUI 插件');
    assert(ids.includes('omo'), '必须发现 OMO 插件');
    assert(ids.includes('example-greeter'), '必须发现 custom/example-greeter 插件');
  });

  runTest('1.2 插件 Manifest 结构与能力字段规范化', () => {
    const comfy = pm.discoveredPlugins.get('comfyui');
    assert.strictEqual(comfy.category, 'service');
    assert.strictEqual(comfy.entry, 'index.js');
    assert.ok(comfy.capabilities.service.daemonSupported);
    assert.strictEqual(comfy.capabilities.service.defaultPort, 8284);
    assert.ok(Array.isArray(comfy.capabilities.tools));
    assert(comfy.capabilities.tools.some(t => t.name === 'generate_image'));
    assert(comfy.capabilities.tools.some(t => t.name === 'interrogate_image'));

    const omo = pm.discoveredPlugins.get('omo');
    assert.strictEqual(omo.category, 'agent');
    assert.ok(Array.isArray(omo.capabilities.agents));
    assert(omo.capabilities.agents.some(a => a.id === 'sisyphus'));
  });

  runTest('1.3 非法 Manifest 格式阻断校验 (防御脏数据与路径注入)', () => {
    assert.throws(() => {
      pm.validateManifest({ id: 'Invalid ID with spaces', name: 'Bad' }, testTmpDir);
    }, /id 格式非法/);

    assert.throws(() => {
      pm.validateManifest({ id: 'valid-id', version: '1.0.0' }, testTmpDir);
    }, /缺少有效的 name 字段/);
  });

  runTest('1.4 路径穿透入口阻断防御 (越权逃逸 entry 与 ui.cardComponent 目录阻断)', () => {
    // Relative escape
    assert.throws(() => {
      pm.validateManifest({ id: 'evil-plugin', name: 'Evil', version: '1.0.0', entry: '../../server.js' }, testTmpDir);
    }, /越权逃逸出插件目录/);

    // Absolute path escape
    assert.throws(() => {
      pm.validateManifest({ id: 'evil-plugin-abs', name: 'Evil Abs', version: '1.0.0', entry: 'C:\\Windows\\System32\\cmd.exe' }, testTmpDir);
    }, /越权逃逸出插件目录/);

    // ui.cardComponent escape
    assert.throws(() => {
      pm.validateManifest({
        id: 'evil-ui',
        name: 'Evil UI',
        version: '1.0.0',
        capabilities: { ui: { cardComponent: '../../secret.html' } }
      }, testTmpDir);
    }, /越权逃逸出插件目录/);
  });

  // ---------------------------------------------------------------------------
  // Group 2: 4 级静态拓扑预检 (Ports, VRAM, Tool Collisions, Conflicts)
  // ---------------------------------------------------------------------------
  console.log('\n[Group 2] 4 级静态拓扑预检矩阵 (Pre-flight Topology Check)...');

  await runAsyncTest('2.1 网关端口冲突拦截 (检测与 4010 智能网关核心端口撞车)', async () => {
    // Register a mock plugin declaring port 4010
    pm.discoveredPlugins.set('conflict-gateway-plugin', {
      id: 'conflict-gateway-plugin',
      name: '冲突网关插件',
      version: '1.0.0',
      entry: 'index.js',
      system: { ports: [4010], hardware: {}, conflictsWith: [], requires: [] },
      capabilities: { service: null, tools: [], agents: [] }
    });

    const topo = await pm.checkTopology('conflict-gateway-plugin');
    assert.strictEqual(topo.ok, false, '声明网关核心端口 4010 必须被拓扑预检拦截');
    assert(topo.errors.some(e => e.includes('智能网关核心端口重叠')));
    pm.discoveredPlugins.delete('conflict-gateway-plugin');
  });

  await runAsyncTest('2.2 多插件同端口互斥拦截', async () => {
    // Mock plugin 1 (port 8999) already enabled
    pm.savePluginConfig('mock-port-occupier', { enabled: true });
    pm.discoveredPlugins.set('mock-port-occupier', {
      id: 'mock-port-occupier',
      name: '占用 8999 的插件',
      system: { ports: [8999], hardware: {}, conflictsWith: [], requires: [] },
      capabilities: { service: null, tools: [], agents: [] }
    });

    // Mock plugin 2 also wants port 8999
    pm.discoveredPlugins.set('mock-port-competitor', {
      id: 'mock-port-competitor',
      name: '竞争 8999 的插件',
      system: { ports: [8999], hardware: {}, conflictsWith: [], requires: [] },
      capabilities: { service: null, tools: [], agents: [] }
    });

    const topo = await pm.checkTopology('mock-port-competitor');
    assert.strictEqual(topo.ok, false, '端口重复占用必须被拓扑拦截');
    assert(topo.errors.some(e => e.includes('已被启用的插件 "占用 8999 的插件"')));

    pm.discoveredPlugins.delete('mock-port-occupier');
    pm.discoveredPlugins.delete('mock-port-competitor');
  });

  await runAsyncTest('2.3 工具命名空间防撞车与自动安全映射 (Tool Collision Guard)', async () => {
    // Register tool "search" owned by plugin-alpha
    pm.activeTools.set('search', {
      name: 'search',
      pluginId: 'plugin-alpha',
      handler: async () => ({ text: 'alpha search' })
    });

    // Plugin-beta also declares tool "search"
    pm.discoveredPlugins.set('plugin-beta', {
      id: 'plugin-beta',
      name: '测试插件 Beta',
      system: { ports: [], hardware: {}, conflictsWith: [], requires: [] },
      capabilities: {
        tools: [{ name: 'search', description: 'beta search tool' }],
        service: null,
        agents: []
      }
    });

    const topo = await pm.checkTopology('plugin-beta');
    assert.strictEqual(topo.collisionFixes['search'], 'plugin-beta_search', '重名工具必须自动加注插件前缀命名空间');
    assert(topo.warnings.some(w => w.includes('已自动安全映射为 "plugin-beta_search"')));

    pm.activeTools.delete('search');
    pm.discoveredPlugins.delete('plugin-beta');
  });

  await runAsyncTest('2.4 conflictsWith 互斥声明刚性阻断', async () => {
    pm.savePluginConfig('legacy-driver', { enabled: true });
    pm.discoveredPlugins.set('new-driver', {
      id: 'new-driver',
      name: '新版驱动插件',
      system: { ports: [], hardware: {}, conflictsWith: ['legacy-driver'], requires: [] },
      capabilities: { service: null, tools: [], agents: [] }
    });

    const topo = await pm.checkTopology('new-driver');
    assert.strictEqual(topo.ok, false, '互斥依赖未解除前必须阻断激活');
    assert(topo.errors.some(e => e.includes('conflictsWith')));

    pm.discoveredPlugins.delete('new-driver');
  });

  await runAsyncTest('2.5 非数字/越界端口安全解析防御 (防止 Socket 同步 RangeError 导致网关崩溃)', async () => {
    pm.discoveredPlugins.set('invalid-port-plugin', {
      id: 'invalid-port-plugin',
      name: '非法端口插件',
      version: '1.0.0',
      entry: 'index.js',
      system: { ports: ['not-a-port', 70000, -1], hardware: {}, conflictsWith: [], requires: [] },
      capabilities: { service: null, tools: [], agents: [] }
    });

    const topo = await pm.checkTopology('invalid-port-plugin');
    assert.strictEqual(topo.ok, false, '非法端口必须被静态拓扑预检拦截');
    assert(topo.errors.some(e => e.includes('端口非法')));
    pm.discoveredPlugins.delete('invalid-port-plugin');
  });

  await runAsyncTest('2.6 字符串端口与整型端口跨类型冲撞精准排查', async () => {
    pm.savePluginConfig('int-port-occupier', { enabled: true });
    pm.discoveredPlugins.set('int-port-occupier', {
      id: 'int-port-occupier',
      name: '整型占用插件',
      system: { ports: [9123], hardware: {}, conflictsWith: [], requires: [] },
      capabilities: { service: null, tools: [], agents: [] }
    });

    pm.discoveredPlugins.set('str-port-competitor', {
      id: 'str-port-competitor',
      name: '字符串竞争插件',
      system: { ports: ['9123'], hardware: {}, conflictsWith: [], requires: [] },
      capabilities: { service: null, tools: [], agents: [] }
    });

    const topo = await pm.checkTopology('str-port-competitor');
    assert.strictEqual(topo.ok, false, '跨类型 (String vs Number) 端口重复必须被精准识别并阻断');
    assert(topo.errors.some(e => e.includes('9123') && e.includes('端口冲突')));

    pm.discoveredPlugins.delete('int-port-occupier');
    pm.discoveredPlugins.delete('str-port-competitor');
  });

  // ---------------------------------------------------------------------------
  // Group 3: Master-MCP Stdio JSON-RPC 2.0 Protocol & Execution
  // ---------------------------------------------------------------------------
  console.log('\n[Group 3] Master-MCP 统一聚合总线协议与工具调用...');

  await runAsyncTest('3.1 Master-MCP JSON-RPC Handshake (initialize, ping & tools/list)', async () => {
    const mcpProc = spawn('node', [path.join(ROOT_DIR, 'mcp-master.js')], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    let mcpOut = '';
    mcpProc.stdout.on('data', d => { mcpOut += d.toString(); });

    // Send initialize
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 101, method: 'initialize' }) + '\n');
    // Send ping
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 102, method: 'ping' }) + '\n');
    // Send tools/list
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 103, method: 'tools/list' }) + '\n');

    await new Promise(r => setTimeout(r, 800));
    mcpProc.kill();

    assert(mcpOut.includes('"id":101'), '必须响应 initialize');
    assert(mcpOut.includes('opencode-go-master-mcp'), 'serverInfo 必须为 opencode-go-master-mcp');
    assert(mcpOut.includes('"id":102'), '必须响应 ping');
    assert(mcpOut.includes('"id":103'), '必须响应 tools/list');
    assert(mcpOut.includes('generate_image'), 'Master-MCP 必须聚合 ComfyUI 的 generate_image 工具');
    assert(mcpOut.includes('greet_developer'), 'Master-MCP 必须聚合 example-greeter 的 greet_developer 工具');
  });

  await runAsyncTest('3.2 Master-MCP 端到端执行插件工具 (tools/call)', async () => {
    const mcpProc = spawn('node', [path.join(ROOT_DIR, 'mcp-master.js')], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    let mcpOut = '';
    mcpProc.stdout.on('data', d => { mcpOut += d.toString(); });

    // Execute greet_developer tool
    mcpProc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 201,
      method: 'tools/call',
      params: {
        name: 'greet_developer',
        arguments: { name: 'Antigravity Tester' }
      }
    }) + '\n');

    await new Promise(r => setTimeout(r, 800));
    mcpProc.kill();

    assert(mcpOut.includes('"id":201'), '必须响应 tools/call id 201');
    assert(mcpOut.includes('Antigravity Tester'), '返回内容必须包含传递的开发者参数');
    assert(mcpOut.includes('微内核插槽化契约'), '返回内容必须包含示例工具返回的正文');
  });

  await runAsyncTest('3.3 Master-MCP 错误码规范 (-32601, -32602, -32700)', async () => {
    const mcpProc = spawn('node', [path.join(ROOT_DIR, 'mcp-master.js')], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    let mcpOut = '';
    mcpProc.stdout.on('data', d => { mcpOut += d.toString(); });

    // Method not found
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 301, method: 'non_existent_method' }) + '\n');
    // Invalid params (tools/call with missing name)
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 302, method: 'tools/call', params: {} }) + '\n');
    // Parse error (malformed JSON)
    mcpProc.stdin.write('{ broken json line \n');

    await new Promise(r => setTimeout(r, 600));
    mcpProc.kill();

    assert(mcpOut.includes('"code":-32601'), '未知方法必须返回 -32601');
    assert(mcpOut.includes('"code":-32602'), '缺少工具参数必须返回 -32602');
    assert(mcpOut.includes('"code":-32700'), '畸变 JSON 必须返回 -32700');
  });

  await runAsyncTest('3.4 JSON-RPC 2.0 畸形 Request 校验 (无 method 字段返回 -32600 Invalid Request)', async () => {
    const mcpProc = spawn('node', [path.join(ROOT_DIR, 'mcp-master.js')], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    let mcpOut = '';
    mcpProc.stdout.on('data', d => { mcpOut += d.toString(); });

    // Request missing method
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 304, params: {} }) + '\n');

    await new Promise(r => setTimeout(r, 600));
    mcpProc.kill();

    assert(mcpOut.includes('"code":-32600'), '缺少 method 字段必须返回 -32600 Invalid Request');
  });

  await runAsyncTest('3.5 字符串形态工具参数安全自动反序列化 (支持 stringified arguments)', async () => {
    const mcpProc = spawn('node', [path.join(ROOT_DIR, 'mcp-master.js')], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    let mcpOut = '';
    mcpProc.stdout.on('data', d => { mcpOut += d.toString(); });

    // Call greet_developer with JSON string arguments
    mcpProc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 305,
      method: 'tools/call',
      params: {
        name: 'greet_developer',
        arguments: JSON.stringify({ name: 'Stringified JSON Tester' })
      }
    }) + '\n');

    await new Promise(r => setTimeout(r, 800));
    mcpProc.kill();

    assert(mcpOut.includes('"id":305'), '必须成功响应');
    assert(mcpOut.includes('Stringified JSON Tester'), '必须成功解析序列化字符串中的参数');
  });

  // ---------------------------------------------------------------------------
  // Group 4: Granular Client Scopes & Per-Client Dynamic Tool Masking
  // ---------------------------------------------------------------------------
  console.log('\n[Group 4] 卡片级客户端分发作用域 ([x] OpenCode, [x] OpenChamber, [x] Codex)...');

  await runAsyncTest('4.1 客户端作用域动态过滤 (对指定客户端隐藏与阻止工具调用)', async () => {
    await pm.enablePlugin('example-greeter');

    // 1. Initial: enabled for codex
    let codexTools = pm.getActiveTools('codex');
    assert(codexTools.some(t => t.name === 'greet_developer'), '默认应在 codex 作用域中可见');

    // 2. Disable for codex
    pm.setClientScopes('example-greeter', { codex: false, opencode: true, openchamber: true });
    codexTools = pm.getActiveTools('codex');
    assert(!codexTools.some(t => t.name === 'greet_developer'), '禁用 codex 后，codex 工具列表中必须立刻隐藏');

    const opencodeTools = pm.getActiveTools('opencode');
    assert(opencodeTools.some(t => t.name === 'greet_developer'), 'opencode 保持勾选，工具必须依然可见');

    // 3. Execution attempt from disabled client must be rejected
    await assert.rejects(async () => {
      await pm.executeTool('greet_developer', { name: 'Test' }, 'codex');
    }, /已在客户端 "codex" 中被禁用/);

    // 4. Restore codex
    pm.setClientScopes('example-greeter', { codex: true, opencode: true, openchamber: true });
    const restored = await pm.executeTool('greet_developer', { name: 'Restored' }, 'codex');
    assert.ok(restored.content[0].text.includes('Restored'));
  });

  await runAsyncTest('4.2 客户端专属工具前缀兼容 (支持 mcp__<server>__<tool> 前缀智能剥离)', async () => {
    // Calling with client mcp prefix should resolve to the original tool
    const prefixedRes = await pm.executeTool('mcp__codex__greet_developer', { name: 'Prefixed User' });
    assert.ok(prefixedRes.content[0].text.includes('Prefixed User'), '带 mcp 前缀调用必须能够命中原工具');
  });

  // ---------------------------------------------------------------------------
  // Group 5: Windows Silent Daemon & AV-Immune Compliance
  // ---------------------------------------------------------------------------
  console.log('\n[Group 5] Windows 桌面静默脱钩与杀软防误报合规性 (AV-Immune)...');

  runTest('5.1 验证进程创建 API 为原生标准 API (无 -EncodedCommand, windowsHide: true)', () => {
    const pmSource = fs.readFileSync(path.join(ROOT_DIR, 'plugin-manager.js'), 'utf8');
    assert(!pmSource.includes('-EncodedCommand'), '严禁使用 powershell -EncodedCommand 混淆代码');
    assert(pmSource.includes('windowsHide: true'), '必须使用 windowsHide: true 抑制黑框');
    assert(pmSource.includes('taskkill'), '终止服务必须使用 Windows 原生 taskkill /PID /T /F');
  });

  await runAsyncTest('5.2 核心服务关键 PID (Codex PID 25076 与网关自身 PID) 终身免杀防御屏障', async () => {
    // Mock active service returning Codex PID 25076
    pm.activeServices.set('mock-rogue-service', { pid: 25076 });
    const stopRes1 = await pm.stopService('mock-rogue-service');
    assert.strictEqual(stopRes1.success, false, '尝试终止 PID 25076 必须被安全屏障刚性拦截');
    assert(stopRes1.message.includes('受保护的关键进程'));

    // Mock active service returning gateway process.pid
    pm.activeServices.set('mock-self-kill', { pid: process.pid });
    const stopRes2 = await pm.stopService('mock-self-kill');
    assert.strictEqual(stopRes2.success, false, '尝试终止网关自身 PID 必须被安全屏障刚性拦截');
  });

  // ---------------------------------------------------------------------------
  // Group 6: HTTP Gateway Plugins API Integration
  // ---------------------------------------------------------------------------
  console.log('\n[Group 6] 网关 HTTP 插件中心 REST API 综合验证 (/balancer/api/plugins/*)...');

  const { fork } = require('child_process');
  const net = require('net');
  const testRouterPort = 14028;
  const testCfgPath = path.join(testTmpDir, 'router-test-config.json');
  fs.writeFileSync(testCfgPath, JSON.stringify({
    port: testRouterPort,
    host: '127.0.0.1',
    accounts: [{ id: 'test-acc', apiKey: 'key-test', enabled: true }]
  }, null, 2));

  const sandboxOcDir = path.join(testTmpDir, 'opencode-config');
  fs.mkdirSync(sandboxOcDir, { recursive: true });

  let serverLog = '';
  const testServerProc = fork(path.join(ROOT_DIR, 'server.js'), [], {
    stdio: 'pipe',
    env: {
      ...process.env,
      OPENCODE_CONFIG_DIR: sandboxOcDir,
      OPENCODE_ROUTER_CONFIG: testCfgPath,
      PORT: String(testRouterPort)
    }
  });

  const killTestServer = () => {
    try {
      if (testServerProc && testServerProc.pid) {
        if (process.platform === 'win32') {
          require('child_process').execSync(`taskkill /PID ${testServerProc.pid} /T /F`, { stdio: 'ignore' });
        } else {
          testServerProc.kill('SIGKILL');
        }
      }
    } catch (_) {}
  };
  process.on('exit', killTestServer);

  // Rule 20: 必须显式排空并记录 stdout / stderr，防止管道缓冲撑爆并能捕获异常
  if (testServerProc.stdout) {
    testServerProc.stdout.on('data', d => { serverLog += d.toString(); });
  }
  if (testServerProc.stderr) {
    testServerProc.stderr.on('data', d => { serverLog += d.toString(); });
  }

  // Wait for test server to listen
  await new Promise((resolve, reject) => {
    let resolved = false;
    testServerProc.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(new Error(`Test server exited prematurely with code ${code}. Logs:\n${serverLog}`));
      }
    });

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Test server failed to listen on port ${testRouterPort} within 12000ms. Logs:\n${serverLog}`));
      }
    }, 12000);

    const check = () => {
      if (resolved) return;
      const s = net.createConnection(testRouterPort, '127.0.0.1', () => {
        s.destroy();
        if (!resolved) { resolved = true; clearTimeout(timer); resolve(); }
      });
      s.on('error', () => {
        if (!resolved) setTimeout(check, 150);
      });
    };
    check();
  });

  try {
    await runAsyncTest('6.1 GET /balancer/api/plugins 列出全量插件元数据', async () => {
      const res = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${testRouterPort}/balancer/api/plugins`, r => {
          let body = '';
          r.on('data', c => { body += c; });
          r.on('end', () => resolve({ status: r.statusCode, data: JSON.parse(body) }));
        });
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.count >= 2);
      const pIds = res.data.plugins.map(p => p.id);
      assert(pIds.includes('comfyui'));
      assert(pIds.includes('omo'));
    });

    await runAsyncTest('6.2 POST /balancer/api/plugins/preflight 执行 4 级静态拓扑预检', async () => {
      const postData = JSON.stringify({ id: 'comfyui' });
      const res = await new Promise((resolve) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: testRouterPort,
          path: '/balancer/api/plugins/preflight',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, r => {
          let body = '';
          r.on('data', c => { body += c; });
          r.on('end', () => resolve({ status: r.statusCode, data: JSON.parse(body) }));
        });
        req.write(postData);
        req.end();
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.pluginId, 'comfyui');
      assert.ok(res.data.topology);
      assert.strictEqual(typeof res.data.topology.ok, 'boolean');
    });

    await runAsyncTest('6.3 POST /balancer/api/plugins/clients 动态修改客户端生效作用域', async () => {
      const postData = JSON.stringify({
        id: 'comfyui',
        clients: { opencode: true, openchamber: false, codex: true }
      });
      const res = await new Promise((resolve) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: testRouterPort,
          path: '/balancer/api/plugins/clients',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, r => {
          let body = '';
          r.on('data', c => { body += c; });
          r.on('end', () => resolve({ status: r.statusCode, data: JSON.parse(body) }));
        });
        req.write(postData);
        req.end();
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.clients.openchamber, false);
      assert.strictEqual(res.data.clients.codex, true);
    });

    await runAsyncTest('6.4 GET /balancer/api/plugins/tools 返回聚合工具清单', async () => {
      const res = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${testRouterPort}/balancer/api/plugins/tools?client=codex`, r => {
          let body = '';
          r.on('data', c => { body += c; });
          r.on('end', () => resolve({ status: r.statusCode, data: JSON.parse(body) }));
        });
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(Array.isArray(res.data.tools));
    });
  } finally {
    killTestServer();
  }

  // ---------------------------------------------------------------------------
  // Group 7: ComfyUI and OMO 100% Backward Compatibility Guard
  // ---------------------------------------------------------------------------
  console.log('\n[Group 7] 现有核心插件 (ComfyUI & OMO) 零回归保真度断言...');

  runTest('7.1 ComfyUI 插件 index.js 包装器与原 ComfyUIAdapter 方法 100% 对应', () => {
    const comfyIndex = require('./plugins/comfyui/index.js');
    assert.strictEqual(typeof comfyIndex.init, 'function');
    assert.strictEqual(typeof comfyIndex.probe, 'function');
    assert.strictEqual(typeof comfyIndex.executeTool, 'function');
    assert.strictEqual(typeof comfyIndex.startService, 'function');
    assert.strictEqual(typeof comfyIndex.stopService, 'function');
    assert.strictEqual(typeof comfyIndex.restartService, 'function');
  });

  runTest('7.2 OMO 插件 index.js 包装器完整链接 updater 核心自愈与探针', async () => {
    const omoIndex = require('./plugins/omo/index.js');
    assert.strictEqual(typeof omoIndex.init, 'function');
    assert.strictEqual(typeof omoIndex.probe, 'function');
    assert.strictEqual(typeof omoIndex.repair, 'function');

    const probeRes = await omoIndex.probe({});
    assert.strictEqual(typeof probeRes.installed, 'boolean');
    assert.strictEqual(typeof probeRes.healthy, 'boolean');
  });

  await runAsyncTest('7.3 插件生命周期 init(context) 动态注册工具 handlers 保留断言 (杜绝 enable 覆写抹杀)', async () => {
    const dynamicPluginId = 'dynamic-tool-provider';
    let dynamicCalled = false;

    // Create a mock plugin module with init that registers a custom handler
    pm.discoveredPlugins.set(dynamicPluginId, {
      id: dynamicPluginId,
      name: '动态工具插件',
      version: '1.0.0',
      entry: 'index.js',
      entryFullPath: path.join(testTmpDir, 'dynamic-index.js'),
      dirPath: testTmpDir,
      system: { ports: [], hardware: {}, conflictsWith: [], requires: [] },
      capabilities: {
        tools: [{ name: 'custom_dynamic_tool', description: 'custom dynamic' }],
        service: null,
        agents: []
      },
      clientScopes: { supported: ['opencode', 'codex'], defaultEnabled: ['opencode', 'codex'] }
    });

    pm.loadedPlugins.set(dynamicPluginId, {
      module: {
        init: async (ctx) => {
          ctx.registerTool({ name: 'custom_dynamic_tool' }, async () => {
            dynamicCalled = true;
            return { text: 'custom handler executed' };
          });
        }
      },
      context: {},
      manifest: pm.discoveredPlugins.get(dynamicPluginId)
    });

    // Run init hook
    await pm.loadedPlugins.get(dynamicPluginId).module.init({
      registerTool: (t, h) => pm.registerTool(dynamicPluginId, t, h)
    });

    // Enable plugin - must not wipe out the handler
    await pm.enablePlugin(dynamicPluginId);
    const execRes = await pm.executeTool('custom_dynamic_tool', {});
    assert.strictEqual(dynamicCalled, true, '动态注册的工具 handler 必须得以完整保留并执行');
    assert.strictEqual(execRes.text, 'custom handler executed');

    pm.discoveredPlugins.delete(dynamicPluginId);
    pm.unregisterTools(dynamicPluginId);
  });

  runTest('7.4 Rule 13 动态参数 Schema 规范化与空对象防遮蔽深度审计', () => {
    pm.registerTool('test-schema-plugin', {
      name: 'test_empty_schema',
      parameters: {} // empty object
    }, () => {});

    const emptyTool = pm.activeTools.get('test_empty_schema');
    assert.deepStrictEqual(emptyTool.parameters, { type: 'object', properties: {} }, '空对象 {} 必须强制补齐 { type: "object", properties: {} }');

    pm.registerTool('test-schema-plugin', {
      name: 'test_snake_case_schema',
      input_schema: { properties: { query: { type: 'string' } } }
    }, () => {});

    const snakeTool = pm.activeTools.get('test_snake_case_schema');
    assert.strictEqual(snakeTool.parameters.type, 'object', 'input_schema 必须被探测并补齐 type: "object"');
    assert.ok(snakeTool.parameters.properties.query, 'input_schema 内字段必须完整保留');

    pm.unregisterTools('test-schema-plugin');
  });

  // Cleanup sandbox
  try {
    fs.rmSync(testTmpDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n================================================================================');
  console.log(`🎉 插件系统全对抗套件执行完成！通过: ${passCount} | 失败: ${failCount}`);
  console.log('================================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
  process.exit(0);
})();
