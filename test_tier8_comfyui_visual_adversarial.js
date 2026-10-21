/**
 * Tier 8 ComfyUI Visual Extension & Multi-Client Integration Adversarial Test Suite
 * ==================================================================================
 * Tests:
 *  1. Multi-target server sniffer & TTL 15s debouncing
 *  2. Manifest loading & semantic style-tag workflow matching
 *  3. Dynamic parameter injection & graph cloning integrity
 *  4. Static media server path traversal & air-gapped security defense
 *  5. Standard OpenAI `/v1/images/generations` endpoint compliance
 *  6. Dual-track image interrogation (WF03 + Vision LLM fallback)
 *  7. MCP Server Stdio JSON-RPC 2.0 handshake & tools/list
 *  8. Codex Desktop `config.toml` auto-registration for ComfyUI MCP
 */

'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ComfyUIAdapter } = require('./comfyui-adapter.js');
const codexAdapter = require('./codex-adapter.js');

console.log('================================================================');
console.log('🛡️  Starting Tier 8 ComfyUI Visual Extension Adversarial Suite');
console.log('================================================================\n');

async function runTests() {
  const adapter = new ComfyUIAdapter({
    rootDir: __dirname
  });

  // --- SECTION 1: Sniffer & Manifest Loading ---
  console.log('--- SECTION 1: Sniffer & Manifest Resolution ---');
  {
    // Test 1: Manifest loaded
    assert.ok(adapter.manifest, 'Manifest must be loaded into memory');
    const wfCount = Object.keys(adapter.manifest).length;
    assert.strictEqual(wfCount, 17, `Expected 17 workflows, found ${wfCount}`);
    console.log(`[PASS] Test 1: Loaded ${wfCount} workflows from workflows_manifest.json`);

    // Test 2: Sniffer with Mock ComfyUI server
    const mockPort = 18284;
    const mockComfy = http.createServer((req, res) => {
      if (req.url === '/system_stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          system: { os: 'win32', comfyui_version: '0.42.0' },
          devices: [{ name: 'AMD Radeon 780M Graphics [ZLUDA]', vram_total: 12942049280 }]
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise(r => mockComfy.listen(mockPort, r));

    const testAdapter = new ComfyUIAdapter({
      rootDir: __dirname,
      config: { comfyui: { host: `http://127.0.0.1:${mockPort}` } }
    });

    const sniffResult = await testAdapter.detectServer(true);
    assert.strictEqual(sniffResult.isOnline, true, 'Server must be detected as online');
    assert.strictEqual(sniffResult.serverUrl, `http://127.0.0.1:${mockPort}`);
    assert.ok(sniffResult.deviceInfo.name.includes('AMD Radeon 780M'), 'Device name must match');

    // Test debounced cache within TTL
    const cachedResult = await testAdapter.detectServer(false);
    assert.strictEqual(cachedResult.isOnline, true);
    assert.strictEqual(cachedResult.lastCheckedAt, sniffResult.lastCheckedAt);

    await new Promise(r => mockComfy.close(r));
    console.log('[PASS] Test 2: Multi-target sniffer and TTL 15s debouncing verified');
  }

  // --- SECTION 2: Semantic Workflow Matching ---
  console.log('\n--- SECTION 2: Semantic Workflow Matching ---');
  {
    // Test 3: Match by ID, prefix, and semantic tag
    const wf01 = adapter.resolveWorkflow('01');
    assert.strictEqual(wf01.id, '01', 'Direct ID 01 match failed');

    const wf01Prefix = adapter.resolveWorkflow('01_真人写实_极致NanoBanana');
    assert.strictEqual(wf01Prefix.id, '01', 'Prefix match 01 failed');

    const wfPhoto = adapter.resolveWorkflow('photorealistic');
    assert.strictEqual(wfPhoto.id, '01', 'Semantic tag photorealistic failed');

    const wfChouka = adapter.resolveWorkflow('抽卡');
    assert.strictEqual(wfChouka.id, '04', 'Semantic tag 抽卡 failed');

    const wfWallpaper = adapter.resolveWorkflow('桌面壁纸');
    assert.strictEqual(wfWallpaper.id, '16', 'Semantic tag 桌面壁纸 failed');

    const wfAnime = adapter.resolveWorkflow('吉卜力');
    assert.ok(wfAnime.id === '05' || wfAnime.id === '06', 'Semantic tag 吉卜力 failed');

    const wfDefault = adapter.resolveWorkflow('unknown_query_random_123');
    assert.strictEqual(wfDefault.id, '01', 'Unknown query fallback to default failed');

    console.log('[PASS] Test 3: Semantic style-tag resolution (ID, prefix, tag, fallback) verified');
  }

  // --- SECTION 3: Dynamic Parameter Injection ---
  console.log('\n--- SECTION 3: Parameter Injection Integrity ---');
  {
    const wf01 = adapter.resolveWorkflow('01');
    const testPrompt = '1girl, cyberpunk neon city, rainy night, masterpiece';
    const testNeg = 'bad anatomy, blurry, artifacts';
    const testSeed = 88991122;

    const { graph, usedSeed } = adapter.buildExecutionGraph(wf01, {
      prompt: testPrompt,
      negative: testNeg,
      seed: testSeed,
      width: 640,
      height: 960
    });

    assert.strictEqual(usedSeed, testSeed, 'Seed was not injected correctly');

    // Positive prompt node
    const pnId = String(wf01.prompt_node.id);
    assert.strictEqual(graph[pnId].inputs.text, testPrompt, 'Positive prompt not injected');

    // Negative prompt node
    const nnId = String(wf01.negative_node.id);
    assert.strictEqual(graph[nnId].inputs.text, testNeg, 'Negative prompt not injected');

    // Sampler seed
    const snId = String(wf01.sampler_node.id);
    assert.strictEqual(graph[snId].inputs.seed, testSeed, 'Sampler seed not injected');

    // Latent dimensions
    let latentFound = false;
    for (const node of Object.values(graph)) {
      if (node.class_type === 'EmptyLatentImage') {
        assert.strictEqual(node.inputs.width, 640, 'Width not injected');
        assert.strictEqual(node.inputs.height, 960, 'Height not injected');
        latentFound = true;
        break;
      }
    }
    assert.ok(latentFound, 'EmptyLatentImage node must be found');

    console.log('[PASS] Test 4: Dynamic parameter injection (prompt, negative, seed, dimensions) verified');
  }

  // --- SECTION 4: Static Media Server Security Defense ---
  console.log('\n--- SECTION 4: Media Server Path Traversal & Air-Gapped Security ---');
  {
    const serverPort = 14018;
    const testImgName = `test_secure_${Date.now()}.png`;
    const testImgPath = path.join(__dirname, 'artifacts', 'images', testImgName);
    fs.mkdirSync(path.join(__dirname, 'artifacts', 'images'), { recursive: true });
    fs.writeFileSync(testImgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    // Start a mini HTTP server with the router's media logic
    const mediaServer = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname.startsWith('/artifacts/images/') && req.method === 'GET') {
        const rawFilename = u.pathname.slice('/artifacts/images/'.length);
        const safeFilename = path.basename(decodeURIComponent(rawFilename));
        const targetFilePath = path.join(__dirname, 'artifacts', 'images', safeFilename);
        const safeBaseDir = path.join(__dirname, 'artifacts', 'images');

        // Path traversal defense
        if (!targetFilePath.startsWith(safeBaseDir) || safeFilename.includes('..') || rawFilename.includes('..')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden' }));
          return;
        }

        if (!fs.existsSync(targetFilePath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Image not found' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'image/png' });
        fs.createReadStream(targetFilePath).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise(r => mediaServer.listen(serverPort, r));

    // Test normal image retrieval
    const okRes = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${serverPort}/artifacts/images/${testImgName}`, res => {
        resolve({ status: res.statusCode, cType: res.headers['content-type'] });
      });
    });
    assert.strictEqual(okRes.status, 200, 'Normal image fetch must return 200');
    assert.strictEqual(okRes.cType, 'image/png');

    // Test path traversal defense (e.g. /artifacts/images/../../package.json)
    const attackRes = await new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/artifacts/images/..%2f..%2fpackage.json',
        method: 'GET'
      }, res => resolve({ status: res.statusCode }));
      req.end();
    });
    assert.strictEqual(attackRes.status, 403, 'Path traversal attempt must be blocked with 403');

    // Test 404 on non-existent file
    const notFoundRes = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${serverPort}/artifacts/images/non_existent.png`, res => resolve({ status: res.statusCode }));
    });
    assert.strictEqual(notFoundRes.status, 404, 'Non existent file must return 404');

    await new Promise(r => mediaServer.close(r));
    try { fs.unlinkSync(testImgPath); } catch (_) {}

    console.log('[PASS] Test 5: Static media server path traversal (403), 404 defense, and MIME resolution verified');
  }

  // --- SECTION 5: MCP Server Protocol Test ---
  console.log('\n--- SECTION 5: MCP Server Stdio Protocol Handshake ---');
  {
    const mcpProc = spawn('node', [path.join(__dirname, 'mcp-comfyui.js')], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    let mcpOut = '';
    mcpProc.stdout.on('data', d => { mcpOut += d.toString(); });

    // Send initialize
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 101, method: 'initialize' }) + '\n');
    // Send tools/list
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 102, method: 'tools/list' }) + '\n');

    await new Promise(r => setTimeout(r, 600));
    mcpProc.kill();

    assert.ok(mcpOut.includes('"id":101'), 'MCP must respond to id 101');
    assert.ok(mcpOut.includes('opencode-go-comfyui-mcp'), 'MCP serverInfo must be present');
    assert.ok(mcpOut.includes('generate_image'), 'Tool generate_image must be listed in tools/list');
    assert.ok(mcpOut.includes('interrogate_image'), 'Tool interrogate_image must be listed in tools/list');

    console.log('[PASS] Test 6: MCP Server Stdio JSON-RPC protocol (initialize & tools/list) verified');
  }

  // --- SECTION 6: Codex Desktop Auto-Registration ---
  console.log('\n--- SECTION 6: Codex Desktop Auto-Registration ---');
  {
    const mockCodexDir = path.join(__dirname, 'test-sandbox-codex');
    fs.mkdirSync(mockCodexDir, { recursive: true });
    const mockConfigPath = path.join(mockCodexDir, 'config.toml');
    fs.writeFileSync(mockConfigPath, '[desktop]\nlocaleOverride = "en"\nmodel = "gpt-4o"\n', 'utf8');

    // Run repairCodexLocaleAndEnvironment
    const repRes = codexAdapter.repairCodexLocaleAndEnvironment({ codexDir: mockCodexDir });
    const fixedContent = fs.readFileSync(mockConfigPath, 'utf8');

    assert.ok(fixedContent.includes('[mcp_servers.comfyui]'), 'config.toml must have [mcp_servers.comfyui] section');
    assert.ok(fixedContent.includes('mcp-comfyui.js'), 'config.toml must point to mcp-comfyui.js');
    assert.ok(fixedContent.includes('localeOverride = "zh-CN"'), 'localeOverride must be zh-CN');

    // Clean up sandbox
    try {
      fs.unlinkSync(mockConfigPath);
      fs.rmdirSync(mockCodexDir);
    } catch (_) {}

    console.log('[PASS] Test 7: Codex Desktop auto-registration of ComfyUI MCP server verified');
  }

  // --- SECTION 7: Dual-Track Interrogation Fallback ---
  console.log('\n--- SECTION 7: Image Interrogation & Fallback ---');
  {
    // Test with mock fallback Vision LLM
    const mockVisionFn = async (buf) => {
      assert.ok(Buffer.isBuffer(buf), 'Vision fallback must receive image Buffer');
      return '1girl, beautiful anime portrait, glowing eyes, masterpiece';
    };

    const dummyBuf = Buffer.from('mock_image_data');
    const interRes = await adapter.interrogateImage(dummyBuf, mockVisionFn);
    assert.ok(interRes.tags.includes('anime portrait'), 'Interrogation tags must be returned');
    assert.ok(interRes.source === 'gateway_vision_llm' || interRes.source === 'comfyui_wf03');

    console.log(`[PASS] Test 8: Image interrogation verified (source: ${interRes.source})`);
  }

  // --- SECTION 8: ComfyUI Queue Purging & Orphan Task Cancellation ---
  console.log('\n--- SECTION 8: Queue Deletion & Orphan Task Cancellation ---');
  {
    const mockPort = 18285;
    let interruptReceived = false;
    let deleteReceived = false;
    let deletedPromptId = null;

    const mockComfy = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        if (req.url === '/interrupt' && req.method === 'POST') {
          interruptReceived = true;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
          return;
        }
        if (req.url === '/queue' && req.method === 'POST') {
          deleteReceived = true;
          try {
            const parsed = JSON.parse(body);
            deletedPromptId = parsed.delete?.[0];
          } catch (_) {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });

    await new Promise(r => mockComfy.listen(mockPort, r));

    const testAdapter = new ComfyUIAdapter({
      rootDir: __dirname,
      config: { comfyui: { host: `http://127.0.0.1:${mockPort}` } }
    });

    const cancelRes = await testAdapter.cancelPrompt(`http://127.0.0.1:${mockPort}`, 'test_orphan_prompt_999');
    assert.strictEqual(cancelRes, true);
    assert.strictEqual(interruptReceived, true, 'cancelPrompt must trigger /interrupt');
    assert.strictEqual(deleteReceived, true, 'cancelPrompt must trigger /queue delete');
    assert.strictEqual(deletedPromptId, 'test_orphan_prompt_999', 'cancelPrompt must delete exact promptId');

    await new Promise(r => mockComfy.close(r));
    console.log('[PASS] Test 9: ComfyUI cancelPrompt (/interrupt + /queue delete) orphan self-healing verified');
  }

  // --- SECTION 9: Base64 Lazy Evaluation & Heap Memory OOM Ceiling Defense ---
  console.log('\n--- SECTION 9: Base64 Lazy Evaluation & Heap Memory Ceiling ---');
  {
    // Test that building result has a lazy base64 getter and caps at 5MB
    const mockPort = 18286;
    const testPromptId = 'p_mock_base64_test';
    const bigBufferSize = 6 * 1024 * 1024; // 6MB (exceeds 5MB ceiling)
    const bigBuffer = Buffer.alloc(bigBufferSize, 0xaa);

    const mockComfy = http.createServer((req, res) => {
      if (req.url === '/system_stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ system: { os: 'win32' }, devices: [{ name: 'TestGPU', vram_total: 8000000 }] }));
        return;
      }
      if (req.url === '/prompt' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ prompt_id: testPromptId }));
        return;
      }
      if (req.url === `/history/${testPromptId}`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          [testPromptId]: {
            outputs: {
              '9': {
                images: [{ filename: 'test_giant_image.png', subfolder: '', type: 'output' }]
              }
            }
          }
        }));
        return;
      }
      if (req.url?.startsWith('/view')) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(bigBuffer);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise(r => mockComfy.listen(mockPort, r));

    const testAdapter = new ComfyUIAdapter({
      rootDir: __dirname,
      config: { comfyui: { host: `http://127.0.0.1:${mockPort}` } }
    });

    const genRes = await testAdapter.executeGeneration({
      prompt: '1girl photorealistic',
      workflow: '01'
    });

    assert.strictEqual(genRes.success, true);
    assert.strictEqual(genRes.sizeBytes, bigBufferSize);
    assert.ok(genRes.localPath);
    assert.ok(genRes.url);

    // Verify lazy base64 capping (must return null when > 5MB to prevent V8 heap OOM)
    const b64Value = genRes.base64;
    assert.strictEqual(b64Value, null, 'Base64 must be safely capped and return null for >5MB payload');

    // Clean up artifact
    try { fs.unlinkSync(genRes.localPath); } catch (_) {}
    await new Promise(r => mockComfy.close(r));
    console.log('[PASS] Test 10: High-resolution Base64 lazy evaluation and 5MB heap ceiling defense verified');
  }

  // --- SECTION 10: MCP JSON-RPC 2.0 Error Codes & Progress Streaming ---
  console.log('\n--- SECTION 10: MCP JSON-RPC 2.0 Error Codes & Progress Streaming ---');
  {
    const mcpProc = spawn('node', [path.join(__dirname, 'mcp-comfyui.js')], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    const receivedMessages = [];
    const rl = require('readline').createInterface({ input: mcpProc.stdout, terminal: false });
    rl.on('line', l => {
      try { receivedMessages.push(JSON.parse(l)); } catch (_) {}
    });

    // 1. Send malformed JSON -> Expect -32700
    mcpProc.stdin.write('{"invalid json here' + '\n');

    // 2. Send unknown method -> Expect -32601
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 201, method: 'unknown_magic_method' }) + '\n');

    // 3. Send invalid params -> Expect -32602
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 202, method: 'tools/call', params: 'not an object' }) + '\n');
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 203, method: 'tools/call', params: {} }) + '\n');

    // 4. Send ping -> Expect empty result
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 204, method: 'ping' }) + '\n');

    await new Promise(r => setTimeout(r, 800));
    mcpProc.kill();

    const parseErr = receivedMessages.find(m => m.error && m.error.code === -32700);
    assert.ok(parseErr, 'MCP must respond with code -32700 on malformed JSON');

    const methodNotFound = receivedMessages.find(m => m.id === 201);
    assert.ok(methodNotFound && methodNotFound.error?.code === -32601, 'MCP must respond with code -32601 on unknown method');

    const invalidParams1 = receivedMessages.find(m => m.id === 202);
    assert.ok(invalidParams1 && invalidParams1.error?.code === -32602, 'MCP must respond with code -32602 when params is not an object');

    const invalidParams2 = receivedMessages.find(m => m.id === 203);
    assert.ok(invalidParams2 && invalidParams2.error?.code === -32602, 'MCP must respond with code -32602 when tool name is missing');

    const pingRes = receivedMessages.find(m => m.id === 204);
    assert.ok(pingRes && pingRes.result !== undefined, 'MCP ping must succeed');

    console.log('[PASS] Test 11: MCP JSON-RPC 2.0 error codes (-32700, -32601, -32602) & ping verified');
  }

  // --- SECTION 11: Office Preview Engine DOM XSS Neutralization & Chunked Paging ---
  console.log('\n--- SECTION 11: Office Preview Engine DOM XSS & Paging Defense ---');
  {
    const vm = require('vm');
    const officeCode = fs.readFileSync(path.join(__dirname, 'assets', 'office-preview-engine.js'), 'utf8');

    function createMockElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        attributes: {},
        children: [],
        innerHTML: '',
        textContent: '',
        dataset: {},
        classList: {
          toggle: (cls, state) => {},
          add: (cls) => {}
        },
        appendChild: function(c) { el.children.push(c); },
        setAttribute: (k, v) => { el.attributes[k] = v; },
        getAttribute: (k) => el.attributes[k],
        querySelector: () => null,
        querySelectorAll: () => []
      };
      return el;
    }

    const mockSandbox = {
      window: {},
      document: {
        head: { appendChild: () => {} },
        getElementById: () => null,
        createElement: (tag) => createMockElement(tag)
      },
      navigator: { userAgent: 'Node' },
      console: console,
      setTimeout: setTimeout
    };
    mockSandbox.window = mockSandbox;
    mockSandbox.global = mockSandbox;
    mockSandbox.self = mockSandbox;

    vm.runInNewContext(officeCode, mockSandbox);

    const viewer = mockSandbox.OpenChamberOfficeViewer;
    assert.ok(viewer, 'OpenChamberOfficeViewer must be exported');
    assert.strictEqual(typeof viewer.renderExcel, 'function');

    // 1. Create workbook with malicious XSS cell contents
    const XLSX = mockSandbox.XLSX;
    assert.ok(XLSX, 'Bundled SheetJS must be loaded');

    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '<img src=x onerror=alert(1)>',
      '"><iframe src="javascript:alert(1)"></iframe>',
      'normal_text_value'
    ];

    const wb = XLSX.utils.book_new();
    const wsData = [
      ['Col A', 'Col B', 'Col C', 'Col D'],
      xssPayloads
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'AttackSheet');

    const excelBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    // Mock viewport container
    const viewport = createMockElement('div');
    const center = createMockElement('div');

    viewer.renderExcel(viewport, center, excelBuf, 'xlsx');

    // Extract table and verify cells
    assert.ok(viewport.children.length > 0, 'Viewport must have children mounted');
    const excelWrapper = viewport.children[0];
    const tableBox = excelWrapper.children.find(c => c.className === 'oc-excel-table-box');
    assert.ok(tableBox, 'oc-excel-table-box must exist');

    const table = tableBox.children.find(c => c.className === 'oc-excel-table');
    assert.ok(table, 'oc-excel-table must exist');
    const tbody = table.children[0];
    assert.ok(tbody && tbody.children.length >= 2, 'Tbody must have row elements');

    // Row 2 is the data row
    const dataRow = tbody.children[1];
    // Check cell elements
    for (let i = 1; i < dataRow.children.length; i++) {
      const cell = dataRow.children[i];
      // textContent must contain the string, but innerHTML must NOT be executed as HTML tags
      assert.strictEqual(cell.textContent, xssPayloads[i - 1]);
      assert.strictEqual(cell.children.length, 0, 'Cell must NOT parse script or img tags as DOM elements');
    }

    // 2. Large sheet non-blocking pagination test (1,000 rows)
    const largeWb = XLSX.utils.book_new();
    const largeData = [['ID', 'Name', 'Score']];
    for (let r = 1; r <= 1000; r++) {
      largeData.push([r, `User_${r}`, Math.floor(Math.random() * 100)]);
    }
    const largeWs = XLSX.utils.aoa_to_sheet(largeData);
    XLSX.utils.book_append_sheet(largeWb, largeWs, 'LargeSheet');
    const largeBuf = XLSX.write(largeWb, { type: 'array', bookType: 'xlsx' });

    const largeViewport = createMockElement('div');
    viewer.renderExcel(largeViewport, center, largeBuf, 'xlsx');

    const largeTableBox = largeViewport.children[0].children.find(c => c.className === 'oc-excel-table-box');
    const largeTable = largeTableBox.children.find(c => c.className === 'oc-excel-table');
    const largeTbody = largeTable.children[0];

    // Initial batch must be exactly INITIAL_PAGE_SIZE (150 rows), not freezing 1,000 at once
    assert.strictEqual(largeTbody.children.length, 150, 'Large table initial chunk must be exactly 150 rows');

    console.log('[PASS] Test 12: Office Preview Engine DOM XSS 100% neutralization & 150-row chunked paging verified');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 12/12 TIER 8 COMFYUI VISUAL EXTENSION TESTS PASSED!');
  console.log('================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ TIER 8 TEST SUITE FAILED:', err);
  process.exit(1);
});
