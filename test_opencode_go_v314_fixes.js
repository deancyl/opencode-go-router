const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const codexAdapter = require('./codex-adapter');
const updater = require('./updater');
const serverModule = require('./server');

console.log('================================================================');
console.log('Running test_opencode_go_v314_fixes.js - Upstream & Screenshot Bug Regression Suite');
console.log('================================================================');

// 1. Verify deprecated OpenCode Go model alias normalization
assert.strictEqual(codexAdapter.normalizeOpencodeGoLiveModel('deepseek-flash'), 'deepseek-v4.1-flash');
assert.strictEqual(codexAdapter.normalizeOpencodeGoLiveModel('cat-jam-free'), 'deepseek-v4.1-flash');
assert.strictEqual(codexAdapter.normalizeOpencodeGoLiveModel('opencode-go/cat-jam-free'), 'opencode-go/deepseek-v4.1-flash');
assert.strictEqual(codexAdapter.normalizeOpencodeGoLiveModel('minimax-m3.1-flash-free'), 'minimax-m3.1-flash');
assert.strictEqual(codexAdapter.normalizeOpencodeGoLiveModel('crouton-alpha-free'), 'hy4-flash-free');
assert.strictEqual(codexAdapter.normalizeOpencodeGoLiveModel('pulse-alpha-free'), 'hy4-flash-free');
assert.strictEqual(codexAdapter.normalizeOpencodeGoLiveModel('glm-5.3-flash'), 'glm-5.3-flash');
console.log('  [PASS] 1. Deprecated OpenCode Go model aliases normalize cleanly');

// 2. Verify resolveCompatibleFallbackModel never falls back to deprecated deepseek-flash on OpenCode Go errors
const errNotIncluded = '{"error":{"type":"server_error","message":"Model deepseek-flash isn\'t included in OpenCode Go. See the models it includes at https://opencode.ai/console/go."}}';
const fb1 = codexAdapter.resolveCompatibleFallbackModel('cat-jam-free', errNotIncluded);
assert.notStrictEqual(fb1, 'deepseek-flash', 'Must never return deprecated deepseek-flash');
assert.strictEqual(fb1, 'glm-5.3-flash');

const fb2 = codexAdapter.resolveCompatibleFallbackModel('deepseek-v4.1-flash', 'Specify "Global" under Regions in Settings › Privacy on https://opencode.ai/console/go');
assert.strictEqual(fb2, 'glm-5.3-flash', 'Region-restricted deepseek-v4.1-flash must fall back to non-restricted glm-5.3-flash');

const fb3 = codexAdapter.resolveCompatibleFallbackModel('glm-5.3-flash', errNotIncluded);
assert.strictEqual(fb3, 'qwen3.8-flash', 'glm-5.3-flash must step to qwen3.8-flash');
console.log('  [PASS] 2. resolveCompatibleFallbackModel avoids deprecated deepseek-flash and steps across non-restricted OpenCode Go models');

// 3. Verify classifyUpstreamError classifies HTTP 500 "Model ... isn't included in OpenCode Go" as isModelUnsupported and NOT isUpstreamClusterGlitch
const classified = serverModule.classifyUpstreamError(500, errNotIncluded);
assert.strictEqual(classified.isModelUnsupported, true, 'Must detect model unsupported from OpenCode Go message even on HTTP 500');
assert.strictEqual(classified.isUpstreamClusterGlitch, false, 'Deterministic model error must NOT be treated as cluster glitch');

const classifiedPrivacy = serverModule.classifyUpstreamError(403, 'Specify "Global" under Regions in Settings › Privacy to use deepseek-v4.1-flash');
assert.strictEqual(classifiedPrivacy.isModelUnsupported, true, 'Console privacy region block must trigger model fallback');
assert.strictEqual(classifiedPrivacy.isUpstreamClusterGlitch, false);
console.log('  [PASS] 3. classifyUpstreamError isolates model catalog & privacy errors from circuit breaker failure counter');

// 4. Verify harmonizeOpencodeConfig injects provider.opencode-go.api and migrates deprecated model choices
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-v314-test-'));
const ocConfigPath = path.join(tmpDir, 'opencode.jsonc');
fs.writeFileSync(ocConfigPath, JSON.stringify({
  model: 'opencode-go/cat-jam-free',
  small_model: 'opencode-go/deepseek-flash',
  provider: {
    'opencode-go': {
      options: { baseURL: 'http://127.0.0.1:4010/v1', apiKey: 'sk-test' }
    }
  }
}, null, 2), 'utf8');

const harmRes = updater.harmonizeOpencodeConfig(ocConfigPath, 4010);
assert.strictEqual(harmRes.success, true);
const parsedOc = JSON.parse(fs.readFileSync(ocConfigPath, 'utf8'));
assert.strictEqual(parsedOc.provider['opencode-go'].api, 'http://127.0.0.1:4010/v1', 'Must set provider.opencode-go.api for OpenCode 2.0');
assert.strictEqual(parsedOc.provider['opencode-go'].options.baseURL, 'http://127.0.0.1:4010/v1');
assert.strictEqual(parsedOc.model, 'opencode-go/deepseek-v4.1-flash', 'Must migrate deprecated cat-jam-free to deepseek-v4.1-flash');
assert.strictEqual(parsedOc.small_model, 'opencode-go/deepseek-v4.1-flash', 'Must migrate deprecated deepseek-flash to deepseek-v4.1-flash');
console.log('  [PASS] 4. harmonizeOpencodeConfig sets provider.api and migrates deprecated model slugs');

// 5. Verify bindCodexConfig heals deprecated cat-jam-free in config.toml even when preserveChoice is true
const codexDir = path.join(tmpDir, '.codex');
fs.mkdirSync(codexDir, { recursive: true });
const tomlPath = path.join(codexDir, 'config.toml');
fs.writeFileSync(tomlPath, 'model_provider = "opencode_go"\nmodel = "cat-jam-free"\nmodel_reasoning_effort = "low"\n', 'utf8');

codexAdapter.bindCodexConfig({
  routerPort: 4010,
  codexDir,
  preserveChoice: true
});
const updatedToml = fs.readFileSync(tomlPath, 'utf8');
assert.ok(updatedToml.includes('model = "deepseek-v4.1-flash"'), 'Codex config.toml must heal deprecated cat-jam-free to deepseek-v4.1-flash');
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('  [PASS] 5. bindCodexConfig heals deprecated model slugs in config.toml');

console.log('================================================================');
console.log('ALL 5/5 OPENCODE GO V3.14.1 REGRESSION TESTS PASSED!');
console.log('================================================================');
