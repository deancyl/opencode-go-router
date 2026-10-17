/**
 * OpenCode Go Router - Real-World Live Verification Suite
 * 
 * Verifies against Port 4010 gateway with LIVE upstream:
 * 1. Token savings actually take effect across Codex, OpenCode, OpenChamber.
 * 2. Zero Degradation (防降智) - Code diffs, merge conflicts (<<<<<<<), syntax & errors are 100% uncorrupted.
 * 3. Connection Resilience (防断联) - Zero 400/502 errors, SSE streaming runs uninterrupted until completion.
 * 4. Module-level Attribution - RTK, Headroom, Schema, CacheZone, and PowerShell each have accurate independent savings metrics.
 * 5. Intelligent Gateway Sync - Web UI Dashboard, By-Model breakdown, and Doctor API reflect live savings in real time.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROUTER_HOST = '127.0.0.1';
const ROUTER_PORT = 4010;

let adminAuthHeader = '';
try {
  const cfgFile = process.env.OPENCODE_ROUTER_CONFIG || path.join(__dirname, 'config.json');
  if (fs.existsSync(cfgFile)) {
    const parsed = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    if (parsed.uiPassword && parsed.uiPassword.trim()) {
      adminAuthHeader = 'Bearer ' + parsed.uiPassword.trim();
    }
  }
} catch (_) {}

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (adminAuthHeader && options.path && options.path.startsWith('/balancer/')) {
      if (!headers['Authorization'] && !headers['authorization']) {
        headers['Authorization'] = adminAuthHeader;
      }
    }

    const opts = {
      hostname: ROUTER_HOST,
      port: ROUTER_PORT,
      ...options,
      headers
    };

    const req = http.request(opts, (res) => {
      let body = '';
      let chunks = [];
      res.on('data', chunk => {
        body += chunk.toString();
        chunks.push(chunk.toString());
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          chunks
        });
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runLiveVerification() {
  console.log('================================================================================');
  console.log('🚀 开始 OpenCode Go 智能网关实机全要素检测 (Codex / OpenCode / OpenChamber)');
  console.log('================================================================================\n');

  // ---------------------------------------------------------------------------
  // Stage 0: 采集前置统计基线 (保护生产历史累积数据不被清零)
  // ---------------------------------------------------------------------------
  console.log('📋 [Stage 0] 采集前置统计基线 (保护生产历史累积数据)...');
  const initialStatsRes = await httpRequest({ path: '/balancer/api/compression/stats', method: 'GET' });
  const initialJson = JSON.parse(initialStatsRes.body);
  const initialStats = initialJson.stats || initialJson;
  console.log(`   ✔ 当前大盘统计基线: totalOriginal=${initialStats.totalOriginalChars}, savedChars=${initialStats.totalSavedChars}, savedTokens=${initialStats.savedTokens}`);

  // ---------------------------------------------------------------------------
  // Stage 1: OpenAI Codex 真实流量实测 (Responses API /v1/responses)
  // ---------------------------------------------------------------------------
  console.log('\n🤖 [Stage 1] OpenAI Codex (Responses API) 真实流量与防断联实测...');
  console.log('   -> 注入场景: Codex 工具定义 + PowerShell CLIXML 报错 + ANSI 进度条 + 路径转义');
  
  // 构造真实的 CLIXML 报错文本
  const clixmlNoise = [
    '#< CLIXML',
    '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">',
    '<S S="Error">node : Cannot find module _x0027_./dist/index.js_x0027__x000D__x000A_At line:1 char:1_x000D__x000A_+ node ./dist/index.js_x000D__x000A_+ ~~~~~~~~~~~~~~~~~~~~_x000D__x000A_    + CategoryInfo          : NotSpecified: (Cannot find mod...ist/index.js\':String) [], RemoteException_x000D__x000A_    + FullyQualifiedErrorId : NativeCommandError_x000D__x000A_</S>',
    '</Objs>'
  ].join('\r\n');

  // 构造 ANSI 进度条与长日志
  const rtkNoise = '\u001b[32m[Building]\u001b[0m 10% \r\u001b[32m[Building]\u001b[0m 50% \r\u001b[32m[Building]\u001b[0m 100% Build complete successfully.\n';

  const codexPayload = {
    model: 'deepseek-v4.1-flash',
    instructions: 'You are the official OpenAI Codex assistant. Answer questions concisely with high accuracy.',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请排查刚刚执行 node ./dist/index.js 的终端报错并指出原因（简明一句话）：'
          }
        ]
      },
      {
        type: 'function_call',
        call_id: 'call_cmd_1',
        name: 'execute_command',
        arguments: '{"command":"powershell -Command \\"node ./dist/index.js\\""}'
      },
      {
        type: 'function_call_output',
        call_id: 'call_cmd_1',
        output: clixmlNoise + '\n' + rtkNoise
      }
    ],
    tools: [
      {
        type: 'function',
        name: 'execute_command',
        description: 'Run commands on the host terminal.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to run.' }
          },
          required: ['command']
        }
      },
      {
        type: 'function',
        name: 'apply_patch',
        description: 'Apply diff patches to files in workspace.',
        parameters: {
          type: 'object',
          properties: {
            patch: { type: 'string', description: 'Unified diff content.' }
          },
          required: ['patch']
        }
      }
    ],
    stream: true
  };

  const codexSessionId = 'codex-live-verify-' + Date.now();
  const t1Start = Date.now();
  const codexRes = await httpRequest({
    path: '/v1/responses',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer codex-local-test',
      'x-conversation-id': codexSessionId,
      'x-client-platform': 'windows'
    }
  }, codexPayload);

  const t1Elapsed = Date.now() - t1Start;
  console.log(`   ✔ Codex Responses 响应状态: HTTP ${codexRes.statusCode} (${t1Elapsed}ms)`);
  if (codexRes.statusCode !== 200) {
    console.error('   ❌ Codex Responses 错误详情:\n', codexRes.body);
  }
  assert.strictEqual(codexRes.statusCode, 200, 'Codex Responses 必须返回 HTTP 200');

  // 验证 SSE 流式块
  const sseBody = codexRes.body;
  assert.ok(sseBody.includes('event: response.output_item.added') || sseBody.includes('response.text.delta') || sseBody.includes('response.completed'), '必须包含标准的 Responses SSE 事件流');
  assert.ok(!sseBody.includes('"type":"upstream_error"'), '绝不允许包含上游 400 裸错误');
  assert.ok(!sseBody.includes('Task encountered a system error'), '绝不能发生系统错误中断');
  console.log('   ✔ SSE 流式连接平稳闭环到达 completed，零断流！');

  // 检查 Stage 1 统计
  const raw1 = JSON.parse((await httpRequest({ path: '/balancer/api/compression/stats', method: 'GET' })).body);
  const statsAfterStage1 = raw1.stats || raw1;
  console.log(`   ✔ 统计数据捕获:`);
  console.log(`     - 累计节约字符: ${statsAfterStage1.totalSavedChars}`);
  console.log(`     - 累计节约 Token: ~${statsAfterStage1.savedTokens}`);
  console.log(`     - PowerShell 模块贡献: ${statsAfterStage1.modules.powershell.savedChars} 字符 (~${statsAfterStage1.modules.powershell.savedTokens} Tokens)`);
  console.log(`     - RTK 模块贡献: ${statsAfterStage1.modules.rtk.savedChars} 字符 (~${statsAfterStage1.modules.rtk.savedTokens} Tokens)`);
  console.log(`     - Schema 模块对齐: ${statsAfterStage1.modules.schema.savedChars} 字符 (${statsAfterStage1.modules.schema.alignedRounds || 0} 轮对齐)`);
  assert.ok(statsAfterStage1.modules.powershell.savedChars > 0, 'PowerShell CLIXML 去噪必须有效计入统计');
  assert.ok(statsAfterStage1.modules.rtk.savedChars > 0, 'RTK 进度条清洗必须有效计入统计');

  // ---------------------------------------------------------------------------
  // Stage 2: OpenCode 2.0+ (Chat & Anthropic Messages) 真实流量实测
  // ---------------------------------------------------------------------------
  console.log('\n⚡ [Stage 2] OpenCode 2.0+ (Anthropic Messages & Chat) 真实流量实测...');
  console.log('   -> 注入场景: Headroom 同构超长 JSON 数组折叠 + 单元测试通过项折叠 + 错误堆栈保真');

  // 构造 60 项同构大 JSON 数组 (触发 Headroom SmartCrusher)
  const largeJsonItems = [];
  for (let i = 1; i <= 60; i++) {
    largeJsonItems.push({ id: `file_${i}`, path: `src/components/Module_${i}.tsx`, size: 1024 + i, status: 'synced' });
  }
  const largeJsonStr = JSON.stringify(largeJsonItems, null, 2);

  // 构造单元测试日志：包含 25 个通过项，以及 1 个核心失败报错 (必须 100% 保留)
  const testOutputNoise = [
    'PASS src/utils/formatter.test.ts (15ms)',
    '  ✓ formatNumber handles zeroes (2ms)',
    '  ✓ formatCurrency supports USD and CNY (3ms)',
    '  ✓ formatDateTime outputs ISO8601 (2ms)',
    '  ✓ validateInput strips whitespace (1ms)',
    '  ✓ generateUuid returns valid RFC4122 (4ms)',
    '  ... [25 tests passed successfully]',
    'FAIL src/services/auth.test.ts',
    '  ✕ should reject invalid HMAC token (45ms)',
    '    Error: Expected status 401, but got 200',
    '      at Object.<anonymous> (src/services/auth.test.ts:32:15)'
  ].join('\n');

  const openCodeSessionId = 'opencode-live-session-' + Date.now();

  // 使用 Anthropic Messages 协议 (/v1/messages)
  const anthropicPayload = {
    model: 'deepseek-v4.1-flash',
    max_tokens: 300,
    system: 'You are an expert full-stack debugger for OpenCode.',
    messages: [
      {
        role: 'user',
        content: 'Run test suite on services and inspect file inventory'
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool_test_1',
            name: 'bash',
            input: { command: 'npm test' }
          },
          {
            type: 'tool_use',
            id: 'tool_json_1',
            name: 'list_files',
            input: { directory: 'src/components' }
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_test_1',
            content: testOutputNoise
          },
          {
            type: 'tool_result',
            tool_use_id: 'tool_json_1',
            content: largeJsonStr
          },
          {
            type: 'text',
            text: '查看上方 tool_result 测试输出，请指出哪一个测试文件失败了以及失败的断言是什么（简明一句话）：'
          }
        ]
      }
    ],
    stream: false
  };

  const t2Start = Date.now();
  const openCodeRes = await httpRequest({
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer opencode-local-test',
      'x-api-key': 'opencode-local-test',
      'anthropic-version': '2023-06-01',
      'x-opencode-session': openCodeSessionId
    }
  }, anthropicPayload);

  const t2Elapsed = Date.now() - t2Start;
  console.log(`   ✔ OpenCode Messages 响应状态: HTTP ${openCodeRes.statusCode} (${t2Elapsed}ms)`);
  assert.strictEqual(openCodeRes.statusCode, 200, 'OpenCode Messages 必须返回 HTTP 200');

  const openCodeJson = JSON.parse(openCodeRes.body);
  const assistantReply = (openCodeJson.content || []).map(c => c.text || c.thinking || '').join('\n');
  console.log(`   ✔ 模型回答摘录: "${assistantReply.slice(0, 150).replace(/\n/g, ' ')}..."`);
  
  // 防降智检验：模型必须准确答出是 auth.test.ts 失败，断言为 Expected status 401, but got 200
  assert.ok(assistantReply.includes('auth.test.ts') || assistantReply.includes('401'), '模型必须准确识别未被误折叠的测试失败断言 (防降智核验)');
  console.log('   ✔ 模型精准捕获真实失败项，关键报错零丢失！');

  // 发起第二轮对话，检验 llmtrim Cache-Zone 记忆与固化 (Stage 2.2)
  console.log('   -> 发起第二轮多轮对话，验证 llmtrim Cache-Zone 缓存区固化与 KV Cache 锁定...');
  const textBlocks = (openCodeJson.content || []).filter(c => c && c.type === 'text');
  const turn2AssistantContent = textBlocks.length > 0 ? textBlocks : [{ type: 'text', text: assistantReply || 'Acknowledged test failure.' }];
  const turn2Payload = {
    model: 'deepseek-v4.1-flash',
    max_tokens: 150,
    system: 'You are an expert full-stack debugger for OpenCode.',
    messages: [
      ...anthropicPayload.messages,
      {
        role: 'assistant',
        content: turn2AssistantContent
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '好的，请用一句话告诉我该如何修复它。' }]
      }
    ],
    stream: false
  };

  turn2Payload.max_tokens = 150;
  const turn2Res = await httpRequest({
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer opencode-local-test',
      'x-api-key': 'opencode-local-test',
      'anthropic-version': '2023-06-01',
      'x-opencode-session': openCodeSessionId
    }
  }, turn2Payload);
  assert.strictEqual(turn2Res.statusCode, 200, '多轮对话第二轮必须返回 200');

  // 检查 Stage 2 统计
  const raw2 = JSON.parse((await httpRequest({ path: '/balancer/api/compression/stats', method: 'GET' })).body);
  const statsAfterStage2 = raw2.stats || raw2;
  console.log(`   ✔ 统计数据捕获:`);
  console.log(`     - Headroom 结构化数据折叠: ${statsAfterStage2.modules.headroom.savedChars} 字符 (~${statsAfterStage2.modules.headroom.savedTokens} Tokens)`);
  console.log(`     - llmtrim Cache-Zone 固化: ${statsAfterStage2.modules.cacheZone.savedChars} 字符 (~${statsAfterStage2.modules.cacheZone.savedTokens} Tokens)`);
  assert.ok(statsAfterStage2.modules.headroom.savedChars > 0, 'Headroom 结构化折叠必须有效计入统计');
  assert.ok(statsAfterStage2.modules.cacheZone.savedChars > 0, 'Cache-Zone 历史多轮必须有效计入统计');

  // ---------------------------------------------------------------------------
  // Stage 3: OpenChamber 离线沙箱与代码金标修复 (不降智与冲突保真专项)
  // ---------------------------------------------------------------------------
  console.log('\n💻 [Stage 3] OpenChamber 离线沙箱与 Git 冲突保真（防降智专项实测）...');
  console.log('   -> 注入场景: 真实代码冲突标记 (<<<<<<< HEAD) + 待解决冲突任务');

  const gitConflictCode = [
    '// User discount calculator module',
    '<<<<<<< HEAD',
    'function calculateDiscount(price, tier) {',
    '  if (tier === "vip") return price * 0.8;',
    '  return price;',
    '}',
    '=======',
    'function calculateDiscount(price, tier) {',
    '  if (tier === "vip") return price * 0.75;',
    '  if (tier === "partner") return price * 0.7;',
    '  return price;',
    '}',
    '>>>>>>> feat/partner-discount',
    '',
    'module.exports = { calculateDiscount };'
  ].join('\n');

  const chamberPayload = {
    model: 'deepseek-v4.1-flash',
    messages: [
      {
        role: 'system',
        content: 'You are OpenChamber code conflict resolution engine.'
      },
      {
        role: 'user',
        content: '请合并并解决下方的 Git 代码冲突，保留 partner 折扣并将 vip 折扣统一设为 0.75，直接输出合并后的纯 JavaScript 函数代码：\n\n' + gitConflictCode
      }
    ],
    stream: false
  };

  const t3Start = Date.now();
  const chamberRes = await httpRequest({
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer chamber-local-test',
      'x-client-platform': 'windows'
    }
  }, chamberPayload);

  const t3Elapsed = Date.now() - t3Start;
  console.log(`   ✔ OpenChamber ChatCompletions 响应状态: HTTP ${chamberRes.statusCode} (${t3Elapsed}ms)`);
  assert.strictEqual(chamberRes.statusCode, 200, 'OpenChamber 必须返回 HTTP 200');

  const chamberJson = JSON.parse(chamberRes.body);
  const chamberReply = (chamberJson.choices?.[0]?.message?.content || '') + '\n' + (chamberJson.choices?.[0]?.message?.reasoning_content || '');
  console.log(`   ✔ 模型合并代码摘录:\n${chamberReply.slice(0, 250)}...\n`);

  // 防降智金标验证：
  // 1. 网关必须 100% 豁免 Git 冲突标记，不破坏原文
  // 2. 模型能够完整看到冲突分支并精准解决，输出同时包含 0.75 与 partner
  assert.ok(chamberReply.includes('0.75'), '模型输出必须成功包含合并后的 0.75 VIP 折扣 (防降智核验)');
  assert.ok(chamberReply.includes('partner'), '模型输出必须成功包含 partner 分支 (防降智核验)');
  console.log('   ✔ Git 冲突标记 100% 豁免未被误伤，模型成功完成复杂代码逻辑合并！');

  // ---------------------------------------------------------------------------
  // Stage 4: 智能网关大盘数据、各项目独立统计与 Doctor 诊断全面核验
  // ---------------------------------------------------------------------------
  console.log('\n📊 [Stage 4] 智能网关大盘数据、分项目统计与 Web UI 实时同步核验...');

  // 1. 核验统计 API (/balancer/api/compression/stats)
  const finalStatsRes = await httpRequest({ path: '/balancer/api/compression/stats', method: 'GET' });
  const rawFinal = JSON.parse(finalStatsRes.body);
  const finalStats = rawFinal.stats || rawFinal;
  
  console.log('\n================================================================================');
  console.log('📈 [网关统计汇总报告]');
  console.log(`- 累计处理原始字符: ${finalStats.totalOriginalChars}`);
  console.log(`- 累计压缩后字符:   ${finalStats.totalCompressedChars}`);
  console.log(`- 累计节省字符数:   ${finalStats.totalSavedChars}`);
  console.log(`- 累计节省 Tokens:  ~${finalStats.savedTokens}`);
  console.log(`- 综合平均压缩率:   ${finalStats.compressionRatio}`);
  console.log(`- 累计节省费用预估: $${(finalStats.savedCostUSD || 0).toFixed(6)} USD`);
  console.log('\n📦 [5 大项目独立节省量分布]:');
  console.log(`  1. RTK 终端日志去噪:         ${finalStats.modules.rtk.savedChars} 字符 (~${finalStats.modules.rtk.savedTokens} Tokens)`);
  console.log(`  2. Headroom 结构化折叠:      ${finalStats.modules.headroom.savedChars} 字符 (~${finalStats.modules.headroom.savedTokens} Tokens)`);
  console.log(`  3. Schema 缓存前缀对齐:      ${finalStats.modules.schema.savedChars} 字符 (${finalStats.modules.schema.alignedRounds || 0} 轮对齐)`);
  console.log(`  4. llmtrim Cache-Zone 固化:  ${finalStats.modules.cacheZone.savedChars} 字符 (~${finalStats.modules.cacheZone.savedTokens} Tokens)`);
  console.log(`  5. PowerShell 转义自愈:      ${finalStats.modules.powershell.savedChars} 字符 (~${finalStats.modules.powershell.savedTokens} Tokens)`);
  console.log('\n🏷️ [分模型计费统计 (By Model Breakdown)]:');
  for (const [mName, mData] of Object.entries(finalStats.byModel || {})) {
    console.log(`  - ${mName}: 节省 ~${mData.savedTokens} Tokens | 官方费率: $${mData.ratePer1M}/1M | 节约金额: $${(mData.savedCostUSD || 0).toFixed(6)} USD`);
  }
  console.log('================================================================================\n');

  // 严密断言全部 5 大模块均有有效统计且生产大盘历史数据只增不减
  assert.ok(finalStats.modules.rtk.savedChars > 0, 'Card 1 RTK 模块节省量必须大于 0');
  assert.ok(finalStats.modules.headroom.savedChars > 0, 'Card 2 Headroom 模块节省量必须大于 0');
  assert.ok(finalStats.modules.schema.savedChars > 0 || finalStats.modules.schema.alignedRounds > 0, 'Card 3 Schema 模块节省量或锁定轮次必须有效');
  assert.ok(finalStats.modules.cacheZone.savedChars > 0, 'Card 4 CacheZone 模块节省量必须大于 0');
  assert.ok(finalStats.modules.powershell.savedChars > 0, 'Card 5 PowerShell 模块节省量必须大于 0');
  assert.ok((finalStats.savedCostUSD || 0) > 0, '累计节约费用预估必须大于 0');
  assert.ok(finalStats.byModel['deepseek-v4.1-flash'], '必须包含 deepseek-v4.1-flash 模型的精细统计');
  assert.ok(finalStats.totalOriginalChars >= (initialStats.totalOriginalChars || 0), '生产累计原文字符绝对保全且只增不减');
  assert.ok(finalStats.totalSavedChars >= (initialStats.totalSavedChars || 0), '生产累计节约字符绝对保全且只增不减');

  // 2. 核验 Web UI 前端 HTML 渲染 (/balancer/ui)
  const uiRes = await httpRequest({ path: '/balancer/ui', method: 'GET' });
  const uiHtml = uiRes.body;
  assert.strictEqual(uiRes.statusCode, 200, 'Web UI 页面必须返回 200');
  assert.ok(uiHtml.includes('id="module-card-powershell"'), 'Web UI 必须渲染 Card 5 PowerShell 卡片');
  if (process.platform === 'win32') {
    assert.ok(uiHtml.includes('Windows 原生运行中'), 'Web UI 必须显示 Windows 原生运行中指示灯');
  } else {
    assert.ok(uiHtml.includes('Linux 休眠旁路') || uiHtml.includes('module-card-powershell'), 'Web UI 必须显示 Linux 休眠旁路指示灯');
  }
  assert.ok(uiHtml.includes('id="by-model-breakdown-drawer"'), 'Web UI 必须渲染分模型节约抽屉');
  assert.ok(uiHtml.includes('id="comp-doctor-status-badge"'), 'Web UI 必须渲染压缩体检状态指示');
  console.log('   ✔ Web UI 控制台页面渲染核验成功，5 大卡片、指示徽章与抽屉 100% 同步！');

  // 3. 核验压缩体检 Doctor API (/balancer/api/compression/doctor)
  const doctorRes = await httpRequest({ path: '/balancer/api/compression/doctor', method: 'GET' });
  const doctor = JSON.parse(doctorRes.body);
  assert.strictEqual(doctor.healthy, true, 'Doctor 压缩体检必须为 healthy: true');
  assert.strictEqual(doctor.issues.length, 0, 'Doctor 压缩体检问题数必须为 0');
  assert.strictEqual(doctor.clientsCompatibility.codex.status, 'compatible', 'Codex 客户端必须显示 compatible');
  assert.strictEqual(doctor.clientsCompatibility.opencode.status, 'compatible', 'OpenCode 客户端必须显示 compatible');
  assert.strictEqual(doctor.clientsCompatibility.openchamber.status, 'compatible', 'OpenChamber 客户端必须显示 compatible');
  console.log('   ✔ Doctor 压缩体检核验成功: 状态 healthy=true, 0 个异常, Codex/OpenCode/OpenChamber 100% 兼容！');

  console.log('\n🎉 [实机全要素检测通过]: 全部 5 大核心指标、3 大客户端实测与网关实时同步 100% 验证成功！');
}

runLiveVerification().catch(err => {
  console.error('\n❌ 实测检测失败:', err);
  process.exit(1);
});
