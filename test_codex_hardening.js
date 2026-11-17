/**
 * Test Suite: Codex Hardening & Channel Isolation Verification
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const codexAdapter = require('./codex-adapter');

console.log('=== Starting Codex Hardening & Channel Isolation Tests ===\n');

// 1. Test findLatestCuaNodeExecutable (with sandbox fixture fallback on non-Windows/clean hosts)
console.log('Test 1: Testing findLatestCuaNodeExecutable...');
const os = require('os');
let mockProfileRoot = null;
const origUserProfile = process.env.USERPROFILE;
let latestCua = codexAdapter.findLatestCuaNodeExecutable();
if (!latestCua) {
  mockProfileRoot = path.join(os.tmpdir(), 'mock-codex-profile-' + Date.now());
  const binDir = path.join(mockProfileRoot, 'AppData', 'Local', 'OpenAI', 'Codex', 'runtimes', 'cua_node', '9f8e7d6c5b4a3210', 'bin', 'node_modules', '@oai', 'sky', 'bin', 'windows');
  fs.mkdirSync(binDir, { recursive: true });
  const fakeExe = path.join(binDir, 'codex-computer-use.exe');
  fs.writeFileSync(fakeExe, 'MZ-mock', 'utf8');
  process.env.USERPROFILE = mockProfileRoot;
  latestCua = codexAdapter.findLatestCuaNodeExecutable();
}
console.log('  Resolved latest CUA executable:', latestCua);
assert(latestCua, 'Expected findLatestCuaNodeExecutable to return a valid path');
assert(fs.existsSync(latestCua), `Expected path to exist on disk: ${latestCua}`);
console.log('  ✔ Test 1 Passed: Latest cua_node executable dynamically resolved.\n');

// 2. Test Channel Isolation in updateCodexTomlString
console.log('Test 2: Testing updateCodexTomlString channel isolation (custom provider must not be hijacked)...');
const sampleToml = `model = "deepseek-flash"
model_provider = "custom"
model_reasoning_effort = "xhigh"
notify = [ "C:\\\\Users\\\\deanc\\\\AppData\\\\Local\\\\OpenAI\\\\Codex\\\\runtimes\\\\cua_node\\\\3dd31cfff853001c\\\\bin\\\\node_modules\\\\@oai\\\\sky\\\\bin\\\\windows\\\\codex-computer-use.exe", "turn-ended" ]

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true
base_url = "https://api.deepseek.com/"

[desktop]
localeOverride = "zh-CN"
`;

const updated = codexAdapter.updateCodexTomlString(sampleToml, {
  model: 'deepseek-v4.1-flash',
  provider: 'opencode-go',
  reasoningEffort: 'high',
  routerUrl: 'http://127.0.0.1:4010/v1',
  catalogRelativePath: 'model-catalogs/opencode-go-catalog.json'
});

console.log('  Checking custom section in updated TOML...');
assert(updated.includes('base_url = "https://api.deepseek.com/"'), 'Expected [model_providers.custom] base_url to remain untouched (https://api.deepseek.com/)');
assert(updated.includes('[model_providers."opencode-go"]'), 'Expected [model_providers."opencode-go"] section to be added');
assert(updated.includes('base_url = "http://127.0.0.1:4010/v1"'), 'Expected opencode-go base_url to point to routerUrl');

// 3. Test notify auto-healing in updateCodexTomlString
console.log('Test 3: Testing notify auto-healing in updateCodexTomlString...');
assert(!updated.includes('3dd31cfff853001c'), 'Expected old 3dd31cfff853001c path to be replaced');
assert(updated.includes(latestCua.replace(/\\/g, '\\\\')), `Expected updated notify to contain ${latestCua}`);
if (mockProfileRoot) {
  if (origUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserProfile;
  try { fs.rmSync(mockProfileRoot, { recursive: true, force: true }); } catch (_) {}
}
console.log('  ✔ Test 2 & 3 Passed: custom provider channel protected & notify healed.\n');

// 4. Test Stream Keep-Alive and Rule 33 Graceful Closure
console.log('Test 4: Testing Rule 33 & Keep-Alive mechanism...');
const mockClientRes = {
  written: [],
  headers: {},
  writableEnded: false,
  writeHead(status, headers) { this.status = status; this.headers = headers; },
  write(chunk) { this.written.push(chunk); return true; },
  end() { this.writableEnded = true; },
  on(event, handler) { return this; },
  once(event, handler) { return this; },
  removeListener(event, handler) { return this; }
};

const EventEmitter = require('events');
const mockUpstream = new EventEmitter();

// Run bridgeResponsesStream and simulate an empty disconnect
let finished = false;
codexAdapter.bridgeResponsesStream(mockUpstream, mockClientRes, 'deepseek-flash', 'test_req_1', () => {
  finished = true;
});

// Upstream disconnects unexpectedly with 0 tokens
mockUpstream.emit('close');

setTimeout(() => {
  assert(finished, 'Expected onFinished callback to be called');
  const allOutput = mockClientRes.written.join('');
  assert(allOutput.includes('response.output_item.added'), 'Expected output_item.added to be dispatched');
  assert(allOutput.includes('response.output_item.done'), 'Expected output_item.done to be dispatched to unlock UI spinner');
  assert(allOutput.includes('response.failed'), 'Expected response.failed to be dispatched');
  assert(allOutput.includes('网关服务提示：上游推理连接异常中断'), 'Expected polite Chinese diagnosis in healed output');
  console.log('  ✔ Test 4 Passed: Rule 33 successfully injected output_item.done and released UI thinking spinner.\n');

  console.log('🎉 All Codex Hardening & Channel Isolation Tests Passed Successfully!');
  process.exit(0);
}, 200);
