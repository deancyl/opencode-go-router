/**
 * test_model_hub_and_client_adapter.js
 * 单元测试与端到端对抗验证套件：
 * 1. assets/official-models.json 结构与 44 款模型完整性
 * 2. client-adapter-manager.js 策略过滤 (official_docs / api_probed / hybrid)
 * 3. updater.js 深层故障甄别 (5 大类根因精准分类) 与多账号故障转移
 * 4. 客户端适配同步 (OpenCode / OpenChamber / Codex) 配置保真与孤岛防护
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const clientAdapter = require('./client-adapter-manager');
const updater = require('./updater');

console.log('=================================================================');
console.log('🧪 模型调度中枢、客户端适配器与根因探针综合单元测试套件');
console.log('=================================================================');

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
  // -------------------------------------------------------------
  // Test Group 1: 官方结构化基准元数据 (assets/official-models.json)
  // -------------------------------------------------------------
  console.log('\n[Group 1] 官方模型结构化基准元数据审计...');

  runTest('1.1 模型基准表文件存在且包含 44 款模型', () => {
    const models = clientAdapter.loadOfficialModels();
    assert(Array.isArray(models), '官方模型表应为数组');
    assert.strictEqual(models.length, 44, `官方模型数应严格为 44 款，实测: ${models.length}`);
  });

  runTest('1.2 每一个模型具备必需字段规范且有效上下文窗口比例为 95%', () => {
    const models = clientAdapter.loadOfficialModels();
    const requiredFields = [
      'slug', 'name', 'vendor', 'context_window', 'max_context_window',
      'effective_context_window_percent', 'supported_reasoning_levels',
      'supports_parallel_tool_calls', 'input_modalities', 'quota_tier',
      'foreign_proxy_required', 'priority'
    ];

    for (const m of models) {
      for (const field of requiredFields) {
        assert(m[field] !== undefined, `模型 ${m.slug} 缺少必需字段: ${field}`);
      }
      assert.strictEqual(m.effective_context_window_percent, 95, `模型 ${m.slug} 的有效窗口百分比必须为 95`);
      assert(m.context_window > 0, `模型 ${m.slug} context_window 必须大于 0`);
      assert(m.max_context_window >= m.context_window, `模型 ${m.slug} max_context_window 必须大于等于 context_window`);
      assert(Array.isArray(m.supported_reasoning_levels), `模型 ${m.slug} supported_reasoning_levels 必须为数组`);
      assert(Array.isArray(m.input_modalities), `模型 ${m.slug} input_modalities 必须为数组`);
    }
  });

  runTest('1.3 核心厂商与代表模型完整覆盖', () => {
    const models = clientAdapter.loadOfficialModels();
    const slugs = models.map(m => m.slug);

    const mustHave = [
      'deepseek-v4.1-flash',
      'deepseek-v4-pro',
      'kimi-k3',
      'qwen3.8-max',
      'glm-5.3',
      'gpt-5.6-luna',
      'claude-haiku-5-5',
      'minimax-m3'
    ];

    for (const slug of mustHave) {
      assert(slugs.includes(slug), `必须覆盖模型: ${slug}`);
    }
  });

  // -------------------------------------------------------------
  // Test Group 2: 模型源策略过滤 (filterModelsByPolicy)
  // -------------------------------------------------------------
  console.log('\n[Group 2] 模型获取源策略过滤与调度...');

  runTest('2.1 official_docs 策略严格仅输出官方 44 款模型', () => {
    const res = clientAdapter.filterModelsByPolicy('official_docs', {
      probedModels: ['online-only-test-model']
    });
    assert.strictEqual(res.length, 44);
    assert(!res.some(m => m.slug === 'online-only-test-model'));
  });

  runTest('2.2 api_probed 策略在探活成功时仅输出上游在线模型', () => {
    const probed = ['deepseek-v4.1-flash', 'kimi-k3', 'custom-online-model-1'];
    const res = clientAdapter.filterModelsByPolicy('api_probed', {
      probedModels: probed
    });
    assert.strictEqual(res.length, 3);
    const slugs = res.map(m => m.slug);
    assert(slugs.includes('deepseek-v4.1-flash'));
    assert(slugs.includes('kimi-k3'));
    assert(slugs.includes('custom-online-model-1'));

    // 官方已有模型继承官方结构化元数据
    const ds = res.find(m => m.slug === 'deepseek-v4.1-flash');
    assert.strictEqual(ds.vendor, 'DeepSeek');
    assert.strictEqual(ds.source, 'api_probed');
  });

  runTest('2.3 api_probed 策略在上游为空时平滑降级兜底', () => {
    const res = clientAdapter.filterModelsByPolicy('api_probed', {
      probedModels: []
    });
    assert(res.length >= 44, '探活为空时应安全降级到官方基准');
  });

  runTest('2.4 hybrid 策略融合官方基准与探活模型并标记信源', () => {
    const probed = ['deepseek-v4.1-flash', 'new-frontier-model'];
    const res = clientAdapter.filterModelsByPolicy('hybrid', {
      probedModels: probed
    });
    assert.strictEqual(res.length, 45); // 44 官方 + 1 新模型
    const ds = res.find(m => m.slug === 'deepseek-v4.1-flash');
    assert.strictEqual(ds.source, 'api_probed'); // 在线探活优先标记
    const newM = res.find(m => m.slug === 'new-frontier-model');
    assert.strictEqual(newM.source, 'api_probed');
    const hk = res.find(m => m.slug === 'claude-haiku-5-5');
    assert.strictEqual(hk.source, 'official_docs');
  });

  // -------------------------------------------------------------
  // Test Group 3: 上游 5 大类根因精准甄别与多账号探活
  // -------------------------------------------------------------
  console.log('\n[Group 3] 上游深层故障诊断探针 (5 大类根因)...');

  runTest('3.1 429 月度配额耗尽精准识别为 QUOTA_EXHAUSTED', () => {
    const errBody = JSON.stringify({
      type: 'error',
      error: {
        type: 'GoUsageLimitError',
        message: 'Go usage limit exceeded',
        code: 429
      },
      metadata: {
        workspace: 'wrk_01KNQ5HPTX6VD0R18BNCZRFQW3',
        limitName: 'monthly'
      }
    });

    const diag = updater.diagnoseUpstreamFailure({ statusCode: 429 }, null, errBody);
    assert.strictEqual(diag.type, 'QUOTA_EXHAUSTED');
    assert.strictEqual(diag.retryable, false);
    assert(diag.suggestion.includes('月度额度已用尽') || diag.suggestion.includes('配额'));
  });

  runTest('3.2 瞬态限频精准识别为 TRANSIENT_RATE_LIMIT 并允许重试', () => {
    const errBody = JSON.stringify({
      error: { message: 'Rate limit exceeded, please slow down', code: 429 }
    });

    const diag = updater.diagnoseUpstreamFailure({ statusCode: 429 }, null, errBody);
    assert.strictEqual(diag.type, 'TRANSIENT_RATE_LIMIT');
    assert.strictEqual(diag.retryable, true);
  });

  runTest('3.3 认证失效精准识别为 AUTH_INVALID', () => {
    const diag401 = updater.diagnoseUpstreamFailure({ statusCode: 401 }, null, '{"error":"Invalid API Key"}');
    assert.strictEqual(diag401.type, 'AUTH_INVALID');

    const diag403 = updater.diagnoseUpstreamFailure({ statusCode: 403 }, null, '{"error":"Forbidden: unauthorized token"}');
    assert.strictEqual(diag403.type, 'AUTH_INVALID');
  });

  runTest('3.4 地域封锁精准识别为 GEOGRAPHIC_RESTRICTION', () => {
    const diagGeo = updater.diagnoseUpstreamFailure({ statusCode: 403 }, null, 'Country, region, or territory not supported (RegionBlocked)');
    assert.strictEqual(diagGeo.type, 'GEOGRAPHIC_RESTRICTION');
    assert(diagGeo.suggestion.includes('代理'));
  });

  runTest('3.5 网络脱网断流精准识别为 NETWORK_OFFLINE', () => {
    const netErr = new Error('getaddrinfo ENOTFOUND opencode.ai');
    netErr.code = 'ENOTFOUND';
    const diagNet = updater.diagnoseUpstreamFailure(null, netErr, '');
    assert.strictEqual(diagNet.type, 'NETWORK_OFFLINE');
    assert(diagNet.suggestion.includes('网络连接') || diagNet.suggestion.includes('离线'));
  });

  // -------------------------------------------------------------
  // Test Group 4: 客户端适配同步 (OpenCode / OpenChamber / Codex)
  // -------------------------------------------------------------
  console.log('\n[Group 4] 统一客户端适配管理器 (配置保真与隔离验证)...');

  const tmpTestDir = path.join(os.tmpdir(), 'opencode_adapter_test_' + Date.now());
  fs.mkdirSync(tmpTestDir, { recursive: true });

  runTest('4.1 syncOpencodeConfig 保留用户定制 Provider 并注入 44 款模型与双模式智能体', () => {
    const ocPath = path.join(tmpTestDir, 'opencode.jsonc');
    // 模拟用户现有配置：含自定义 provider 和自定义 prompt
    const initialConfig = {
      provider: {
        'my-custom-llm': {
          npm: '@custom/llm',
          options: { apiKey: 'secret' }
        }
      },
      agent: {
        goal: {
          description: 'User customized prompt',
          mode: 'primary'
        }
      }
    };
    fs.writeFileSync(ocPath, JSON.stringify(initialConfig, null, 2), 'utf8');

    const res = clientAdapter.syncOpencodeConfig({
      routerPort: 4899,
      targetPath: ocPath,
      policy: 'hybrid'
    });

    assert(res.success, `OpenCode 同步应成功: ${res.messages?.join(', ')}`);
    const written = JSON.parse(fs.readFileSync(ocPath, 'utf8'));

    // 验证用户自定义 provider 未被冲掉
    assert(written.provider['my-custom-llm'], '用户原有 provider 必须被完整保护');
    // 验证 opencode-go 已注入且指向 4899
    assert(written.provider['opencode-go'], '必须注入 opencode-go provider');
    assert.strictEqual(written.provider['opencode-go'].options.baseURL, 'http://127.0.0.1:4899/v1');
    assert(Object.keys(written.provider['opencode-go'].models).length >= 44, '必须注入全套模型基准');

    // 验证 agent 保护：保留用户现有自定义 description
    assert.strictEqual(written.agent.goal.description, 'User customized prompt');
    assert(written.agent['goal-verify'], '必须补齐 goal-verify 智能体');
  });

  runTest('4.2 syncOpenChamberConfig 成功注入 models 与 favorites', () => {
    const chamberDir = path.join(tmpTestDir, 'openchamber');
    fs.mkdirSync(chamberDir, { recursive: true });

    const res = clientAdapter.syncOpenChamberConfig({
      targetDirs: [chamberDir],
      defaultModel: 'deepseek-v4.1-flash',
      favorites: ['deepseek-v4.1-flash', 'kimi-k3']
    });

    assert(res.success, `OpenChamber 同步应成功: ${res.messages?.join(', ')}`);
    const prefFile = path.join(chamberDir, 'preferences.json');
    assert(fs.existsSync(prefFile), '必须生成 preferences.json');
    const writtenPref = JSON.parse(fs.readFileSync(prefFile, 'utf8'));
    const favs = writtenPref.fields?.favoriteModels?.value || [];
    const recents = writtenPref.fields?.recentModels?.value || [];
    assert(favs.some(f => f.modelID === 'deepseek-v4.1-flash'), 'favoriteModels 必须包含 deepseek-v4.1-flash');
    assert(recents.some(r => r.modelID === 'deepseek-v4.1-flash'), 'recentModels 必须包含 deepseek-v4.1-flash');
  });

  runTest('4.3 syncCodexConfig 生成完整 model_catalog_json 且不干扰进程', () => {
    const codexDir = path.join(tmpTestDir, 'codex');
    fs.mkdirSync(codexDir, { recursive: true });

    const res = clientAdapter.syncCodexConfig({
      routerPort: 4899,
      codexDir,
      defaultModel: 'deepseek-v4.1-flash',
      reasoningEffort: 'high'
    });

    assert(res.success, `Codex 同步应成功: ${res.messages?.join(', ')}`);
    const writtenToml = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
    assert(writtenToml.includes('http://127.0.0.1:4899/v1'));
    assert(writtenToml.includes('deepseek-v4.1-flash'));
    assert(writtenToml.includes('model_catalog_json'));
    assert(writtenToml.includes('localeOverride = "zh-CN"'));
  });

  runTest('4.4 syncAllClients 全端适配协调器一次性完成三端安全同步', () => {
    const fullTestDir = path.join(tmpTestDir, 'all_clients');
    const ocP = path.join(fullTestDir, 'opencode.jsonc');
    const chDir = path.join(fullTestDir, 'openchamber');
    const cdDir = path.join(fullTestDir, 'codex');
    fs.mkdirSync(fullTestDir, { recursive: true });
    fs.mkdirSync(chDir, { recursive: true });
    fs.mkdirSync(cdDir, { recursive: true });

    const allRes = clientAdapter.syncAllClients({
      routerPort: 4899,
      policy: 'hybrid',
      opencodeConfigPath: ocP,
      openchamberDirs: [chDir],
      codexDir: cdDir,
      clients: ['opencode', 'openchamber', 'codex']
    });

    assert(allRes.success, '全端同步必须成功');
    assert.strictEqual(allRes.modelsCount, 44);
    assert(fs.existsSync(ocP));
    assert(fs.existsSync(path.join(chDir, 'preferences.json')));
    assert(fs.existsSync(path.join(cdDir, 'config.toml')));
  });

  // 清理临时文件
  try {
    fs.rmSync(tmpTestDir, { recursive: true, force: true });
  } catch (_) {}

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log('\n=================================================================');
  console.log(`测试完成！通过: ${passCount} | 失败: ${failCount}`);
  console.log('=================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
  process.exit(0);
})();
