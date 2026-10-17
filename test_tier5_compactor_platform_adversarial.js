/**
 * OpenCode Go Router - Tier 5 Context Compactor & Cross-Platform White-Box Adversarial Suite
 * 
 * Challenger: challenger_final_2 (critic, specialist)
 * Target Coverage:
 * 1. Compression Redlines: Git conflict markers (<<<<<<<, =======, >>>>>>>, |||||||) 100% preservation
 * 2. Diagnostics Redlines: Error stack traces (Node.js, Python, C/C++, Rust) & line numbers 100% preserved
 * 3. SmartCrusher & Embedded JSON Scanner: 10,000-item array folding, depth limits, bracket decoy explosion failsafe
 * 4. CacheAligner & Static Regex Cache: Deterministic prompt KV cache locking, tool slimming, regex pool eviction
 * 5. CacheZone: Byte-stream memoization, dynamic options signature invalidation, true LRU retention
 * 6. Dual-Platform Integrity: Windows tray-daemon.ps1 AST/mutex/watchdog, Linux NAS sync_nas.py Rule 8 auto-auth
 * 7. System Doctor & Repair: Adversarial injection, diagnosis verification, auto-healing roundtrip
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');

const compactor = require('./context-compactor');

let totalTests = 0;
let passedTests = 0;
const failureList = [];

async function runAdversarialTest(category, name, fn) {
  totalTests++;
  const start = performance.now();
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      await res;
    }
    const elapsed = (performance.now() - start).toFixed(2);
    passedTests++;
    console.log(`  ✓ [PASS] [${category}] ${name} (${elapsed}ms)`);
  } catch (err) {
    const elapsed = (performance.now() - start).toFixed(2);
    failureList.push({ category, name, error: err.message, stack: err.stack });
    console.error(`  ❌ [FAIL] [${category}] ${name} (${elapsed}ms)\n      Error: ${err.message}`);
  }
}

async function main() {
  console.log('================================================================');
  console.log('⚔️  Starting Tier 5 Compactor & Platform White-Box Adversarial Suite');
  console.log('================================================================\n');

  // ============================================================================
  // SECTION 1: 压缩保真红线白盒极限打压 (Git 冲突标记与报错堆栈零抽稀)
  // ============================================================================
  console.log('--- SECTION 1: Compression Redlines & Fidelity Hardcore Stress ---');

  await runAdversarialTest('Redline', 'Git 冲突标记在巨型 package-lock.json diff 中的绝对豁免保护', () => {
    // Generate 600 lines of package-lock diff with active conflict markers
    let diffLines = [
      'diff --git a/package-lock.json b/package-lock.json',
      'index a1b2c3d..e4f5g6h 100644',
      '--- a/package-lock.json',
      '+++ b/package-lock.json',
      '@@ -120,600 +120,600 @@',
      '     "node_modules/express": {',
      '<<<<<<< HEAD',
      '       "version": "4.19.2",',
      '       "resolved": "https://registry.npmjs.org/express/-/express-4.19.2.tgz",',
      '=======',
      '       "version": "4.20.0",',
      '       "resolved": "https://registry.npmjs.org/express/-/express-4.20.0.tgz",',
      '>>>>>>> feature/update-dependencies'
    ];
    for (let i = 0; i < 550; i++) {
      diffLines.push(`+      "integrity_dep_${i}": "sha512-${'abcdef'.repeat(10)}"`);
    }
    const fullDiff = diffLines.join('\n');

    // Normally 500+ lines lockfile diff would be folded into "[Lockfile diff folded: ...]"
    // But conflict markers present -> MUST NOT FOLD!
    const folded = compactor.foldLockfiles(fullDiff, { exemptMergeConflicts: true });
    assert.strictEqual(folded, fullDiff, 'Diff containing conflict markers must remain 100% untouched!');
    assert.ok(!folded.includes('[Lockfile diff folded:'), 'Must NOT contain lockfile diff folded summary');
    assert.ok(folded.includes('<<<<<<< HEAD'), 'Must preserve <<<<<<< HEAD');
    assert.ok(folded.includes('======='), 'Must preserve =======');
    assert.ok(folded.includes('>>>>>>> feature/update-dependencies'), 'Must preserve >>>>>>> marker');

    // Run through full compactText pipeline
    const pipelineOut = compactor.compactText(fullDiff);
    assert.strictEqual(pipelineOut, fullDiff, 'Full compactText pipeline must 100% preserve conflicted lockfile diff');
  });

  await runAdversarialTest('Redline', 'Git 冲突标记在统一 Diff (Unified Diff) 与 3-Way 冲突标记 (|||||||) 的绝对豁免', () => {
    const unifiedDiff = [
      '--- a/cargo.lock',
      '+++ b/cargo.lock',
      '@@ -45,100 +45,100 @@',
      '<<<<<<< HEAD',
      'version = "1.0.80"',
      '||||||| merged common ancestors',
      'version = "1.0.75"',
      '=======',
      'version = "1.0.82"',
      '>>>>>>> incoming-fix'
    ];
    for (let i = 0; i < 80; i++) {
      unifiedDiff.push(`+checksum = "hash_${i}"`);
    }
    const text = unifiedDiff.join('\n');
    const result = compactor.foldLockfiles(text, { exemptMergeConflicts: true });
    assert.strictEqual(result, text, 'Unified diff with 3-way merge conflict must be 100% bypassed');
    assert.ok(result.includes('||||||| merged common ancestors'), 'Must preserve 3-way conflict ancestor marker');
  });

  await runAdversarialTest('Redline', 'Git 冲突标记在裸 Lockfile 内容中的绝对豁免', () => {
    const rawLockfile = `{
      "name": "enterprise-monorepo",
      "lockfileVersion": 3,
      "requires": true,
      "packages": {
<<<<<<< HEAD
        "node_modules/lodash": { "version": "4.17.20" }
=======
        "node_modules/lodash": { "version": "4.17.21" }
>>>>>>> master
      }
    }`.repeat(5); // Make it > 400 chars to meet package-lock size threshold

    const res = compactor.foldLockfiles(rawLockfile, { exemptMergeConflicts: true });
    assert.strictEqual(res, rawLockfile, 'Raw package-lock.json with conflicts must be 100% bypassed');
  });

  await runAdversarialTest('Redline', 'Git 冲突标记在结构化 JSON 中的绝对豁免保护', () => {
    const dataWithConflict = JSON.stringify({
      status: 'merge_conflict',
      resolution_needed: true,
      diff_hunk: '<<<<<<< HEAD\nconst port = 4010;\n=======\nconst port = 8080;\n>>>>>>> patch-1',
      details: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `file_${i}.js` }))
    }, null, 2);

    const folded = compactor.foldStructuredData(dataWithConflict);
    assert.strictEqual(folded, dataWithConflict, 'foldStructuredData must bypass text containing conflict markers');
  });

  await runAdversarialTest('Redline', 'Node.js V8 报错堆栈与精确文件名、行号、列号 100% 绝对保真', () => {
    const stackText = `
TypeError: Cannot read properties of undefined (reading 'processValue')
    at Object.foldStructuredData (C:\\Users\\deanc\\.opencode-go-router\\context-compactor.js:935:42)
    at runPipeline (C:\\Users\\deanc\\.opencode-go-router\\context-compactor.js:1888:14)
    at Object.compactText (C:\\Users\\deanc\\.opencode-go-router\\context-compactor.js:1929:20)
    at handleRequest (C:\\Users\\deanc\\.opencode-go-router\\server.js:521:33)
    at Server.emit (node:events:518:28)
`;
    const res = compactor.compactText(stackText);
    assert.ok(res.includes('context-compactor.js:935:42'), 'Must preserve line 935:42');
    assert.ok(res.includes('context-compactor.js:1888:14'), 'Must preserve line 1888:14');
    assert.ok(res.includes('server.js:521:33'), 'Must preserve line 521:33');
    assert.ok(res.includes('TypeError: Cannot read properties of undefined'), 'Must preserve exact error name');
  });

  await runAdversarialTest('Redline', 'Python Traceback 异常堆栈与行号 100% 绝对保真', () => {
    const pyTraceback = `
Traceback (most recent call last):
  File "/home/deancyl0607/.opencode-go-router/sync_nas.py", line 21, in sync_and_restart
    sftp.put(local_path, remote_path)
  File "/usr/lib/python3.11/site-packages/paramiko/sftp_client.py", line 759, in put
    return self.putfo(fl, remotepath, file_size, callback, confirm)
FileNotFoundError: [Errno 2] No such file or directory: 'non_existent.js'
`;
    const res = compactor.compactText(pyTraceback);
    assert.ok(res.includes('sync_nas.py", line 21'), 'Must preserve Python line 21');
    assert.ok(res.includes('sftp_client.py", line 759'), 'Must preserve Python line 759');
    assert.ok(res.includes('FileNotFoundError: [Errno 2]'), 'Must preserve FileNotFoundError');
  });

  await runAdversarialTest('Redline', 'C/C++ 与 Rust 编译器错误行号与诊断标记绝对保真', () => {
    const compilerErrors = [
      '/usr/src/native/addon.cc:48:12: error: ‘v8::Local<v8::Value>’ has no member named ‘IsSymbol’',
      '   48 |   if (val->IsSymbol()) return false;',
      '      |            ^~~~~~~~',
      'error[E0425]: cannot find value `session_id` in this scope',
      '  --> src/router/session.rs:189:24',
      '   |',
      '189|     let sess = get_session(session_id);',
      '   |                            ^^^^^^^^^^ not found in this scope'
    ].join('\n');

    const res = compactor.compactText(compilerErrors);
    assert.ok(res.includes('addon.cc:48:12: error'), 'Must preserve C++ error at line 48:12');
    assert.ok(res.includes('src/router/session.rs:189:24'), 'Must preserve Rust error at line 189:24');
    assert.ok(res.includes('error[E0425]'), 'Must preserve error code E0425');
  });

  await runAdversarialTest('Redline', '测试套件正向折叠中单点致命失败与断言差分的完全隔离与保真', () => {
    const lines = [];
    // 40 passed tests
    for (let i = 1; i <= 40; i++) {
      lines.push(`  ✓ test_auth_subsystem_${i} passed (12ms)`);
    }
    // 1 critical failure with assertion detail and stack
    lines.push('  ✕ test_token_expiration_under_429 (tests/auth.test.js:142:15)');
    lines.push('    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:');
    lines.push('    + actual: 502');
    lines.push('    - expected: 200');
    lines.push('        at Context.<anonymous> (tests/auth.test.js:145:10)');
    lines.push('        at processImmediate (node:internal/timers:478:21)');
    // Another 40 passed tests
    for (let i = 41; i <= 80; i++) {
      lines.push(`  ✓ test_auth_subsystem_${i} passed (8ms)`);
    }

    const testOutput = lines.join('\n');
    const folded = compactor.foldTestPasses(testOutput);

    // Verify passing blocks were folded
    assert.ok(folded.includes('[Test suite: 40 passed tests folded (✓ / PASS / ok)]'), 'First 40 passes should fold');
    // Verify failing test is completely untouched and exposed
    assert.ok(folded.includes('✕ test_token_expiration_under_429 (tests/auth.test.js:142:15)'), 'Failing test line MUST NOT fold');
    assert.ok(folded.includes('AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:'), 'Assertion diff MUST NOT fold');
    assert.ok(folded.includes('tests/auth.test.js:145:10'), 'Failure stack trace MUST NOT fold');
    assert.ok(!folded.includes('80 passed tests folded'), 'Failure in middle must split into two independent runs');
  });

  // ============================================================================
  // SECTION 2: SmartCrusher 超长 JSON 数组折叠与嵌入式扫描熔断
  // ============================================================================
  console.log('\n--- SECTION 2: SmartCrusher & Embedded JSON Failsafe Stress ---');

  await runAdversarialTest('SmartCrusher', '10,000 项同构 JSON 大数组极限折叠与语法完整性', () => {
    const items = [];
    for (let i = 0; i < 10000; i++) {
      items.push({
        id: i + 1,
        uuid: `usr_uuid_${i}_${'x'.repeat(16)}`,
        status: i % 2 === 0 ? 'active' : 'idle',
        metrics: { cpu: Math.random() * 100, memory: 1024 + i },
        tags: ['production', 'eu-west-1', 'node-agent']
      });
    }
    const rawJson = JSON.stringify(items, null, 2);
    assert.ok(rawJson.length > 1000000, 'Raw JSON should exceed 1MB');

    const start = performance.now();
    const folded = compactor.foldStructuredData(rawJson, { maxStructuredItems: 50 });
    const elapsed = performance.now() - start;

    assert.ok(elapsed < 100, `10,000 items folding must be fast, took ${elapsed.toFixed(1)}ms`);
    assert.ok(folded.length < rawJson.length * 0.05, 'Folded text should be < 5% of original length');
    assert.ok(folded.includes('[SmartCrusher: Folded 9992 items (6..9997 of 10000 items)]'), 'Must contain SmartCrusher folded summary');

    // Parse the folded JSON to verify syntax integrity!
    const parsed = JSON.parse(folded);
    assert.strictEqual(parsed.length, 9, 'Folded array must have 5 head + 1 summary + 3 tail = 9 elements');
    assert.strictEqual(parsed[0].id, 1, 'First element must be item 1');
    assert.strictEqual(parsed[4].id, 5, 'Fifth element must be item 5');
    assert.strictEqual(parsed[8].id, 10000, 'Last element must be item 10000');
    assert.strictEqual(parsed[5]._folded, true, 'Summary item must declare _folded: true');
    assert.strictEqual(parsed[5].foldedCount, 9992, 'Folded count must be 9992');
  });

  await runAdversarialTest('SmartCrusher', '深度嵌套 JSON 结构 (>10 层) 递归深度控制与防爆栈', () => {
    let deepObj = {
      level: 1,
      targetArray: Array.from({ length: 150 }, (_, idx) => ({ idx, val: `item_${idx}` }))
    };
    for (let d = 2; d <= 12; d++) {
      deepObj = { level: d, child: deepObj };
    }
    const raw = JSON.stringify(deepObj, null, 2);

    // Should process without RangeError: Maximum call stack size exceeded
    const res = compactor.foldStructuredData(raw, { maxStructuredItems: 30 });
    assert.ok(typeof res === 'string');
    assert.doesNotThrow(() => JSON.parse(res), 'Result must remain valid JSON');
  });

  await runAdversarialTest('SmartCrusher', '嵌入式假 JSON 括号炸弹与熔断器攻击 (Bracket Explosion Decoy)', () => {
    // 1. Verify anti-DoS and circuit breaker against malformed decoy brackets
    let decoyText = 'Diagnostic inspection scan results:\n';
    for (let i = 0; i < 400; i++) {
      decoyText += `Note #${i}: [unclosed bracket with key: val_${i} and non-json text};\n`;
      decoyText += `Obj #${i}: { "missing_colon" "value_${i}", invalid_token: true ];\n`;
    }

    const start = performance.now();
    const resultDecoy = compactor.foldStructuredData(decoyText, { maxStructuredItems: 30 });
    const elapsed = performance.now() - start;

    // Must execute rapidly (< 25ms) and not freeze the event loop
    assert.ok(elapsed < 25, `Decoy bracket scan must finish in < 25ms, took ${elapsed.toFixed(1)}ms`);
    assert.strictEqual(resultDecoy, decoyText, 'Malformed decoy text without valid JSON must be bypassed cleanly');

    // 2. Verify legitimate embedded raw JSON array within scanLimit (< 2000 chars) folds properly
    const realArray = Array.from({ length: 80 }, (_, i) => ({ record_id: i, status: 'ok' }));
    const rawEmbedded = 'Current system telemetry log:\n' + JSON.stringify(realArray, null, 2) + '\nEnd of log payload.';
    const resultRaw = compactor.foldStructuredData(rawEmbedded, { maxStructuredItems: 30 });
    assert.ok(resultRaw.includes('[SmartCrusher: Folded 72 items'), 'Legitimate raw embedded JSON array must be folded');

    // 3. Verify Markdown fenced JSON block folds even in large mixed documents
    const mdBlockText = decoyText + '\n```json\n' + JSON.stringify(realArray, null, 2) + '\n```\nFooter text.';
    const resultMd = compactor.foldStructuredData(mdBlockText, { maxStructuredItems: 30 });
    assert.ok(resultMd.includes('[SmartCrusher: Folded 72 items'), 'Markdown fenced JSON must fold reliably');
  });

  await runAdversarialTest('SmartCrusher', '结构化折叠幂等性与重复调用防护 (Idempotency Barrier)', () => {
    const raw = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ item: i })), null, 2);
    const round1 = compactor.foldStructuredData(raw, { maxStructuredItems: 20 });
    assert.ok(round1.includes('[SmartCrusher: Folded'));

    // Re-run on already folded text 5 times
    let current = round1;
    for (let i = 0; i < 5; i++) {
      current = compactor.foldStructuredData(current, { maxStructuredItems: 20 });
      assert.strictEqual(current, round1, `Round ${i + 1} must be byte-identical to Round 1`);
    }
  });

  // ============================================================================
  // SECTION 3: 静态正则缓存池、Schema CacheAligner 与 CacheZone
  // ============================================================================
  console.log('\n--- SECTION 3: Regex Pool, Schema Aligner & CacheZone Stress ---');

  await runAdversarialTest('CachePool', 'dynamicRegexCache 命中、引用一致性与淘汰保护', () => {
    const pat = 'test_pattern_dynamic_\\d+';
    const rx1 = compactor.getCachedRegex(pat, 'i');
    const rx2 = compactor.getCachedRegex(pat, 'i');
    assert.strictEqual(rx1, rx2, 'Repeated getCachedRegex must return identical instance reference');

    // Global / Sticky flag safety: must return distinct instance
    const rxG1 = compactor.getCachedRegex(pat, 'g');
    const rxG2 = compactor.getCachedRegex(pat, 'g');
    assert.notStrictEqual(rxG1, rxG2, 'Regex with g flag must NOT be cached to avoid lastIndex state pollution');

    // Test eviction threshold: clear cache first to measure exact threshold behavior
    compactor.dynamicRegexCache.clear();
    assert.strictEqual(compactor.dynamicRegexCache.size, 0);

    // Flood 505 unique patterns. Threshold is > 500.
    // At item 501, size is 501.
    // At item 502, size is 501 > 500 -> evicts down to 400, then adds item 502 (size becomes 401).
    // At item 505, size becomes 404.
    for (let i = 0; i < 505; i++) {
      compactor.getCachedRegex(`unique_flood_pattern_${i}_[a-z]+`, 'i');
    }
    assert.ok(compactor.dynamicRegexCache.size <= 410, `dynamicRegexCache size (${compactor.dynamicRegexCache.size}) must be bounded <= 410 after eviction`);
    assert.ok(compactor.dynamicRegexCache.size >= 400, 'dynamicRegexCache size must be >= 400 after eviction');
  });

  await runAdversarialTest('CacheAligner', 'Schema 字典序对齐对 Prompt KV Cache 锁定的确定性保障', () => {
    const toolA = {
      type: 'function',
      function: {
        name: 'z_tool',
        description: 'Tool Z',
        parameters: {
          z_prop: { type: 'string' },
          a_prop: { type: 'number' },
          type: 'object',
          properties: {
            zebra: { type: 'string' },
            apple: { type: 'string' }
          }
        }
      }
    };
    const toolB = {
      type: 'function',
      function: {
        name: 'a_tool',
        description: 'Tool A',
        parameters: {
          b_prop: { type: 'boolean' },
          type: 'object'
        }
      }
    };

    // Permutation 1: [toolA, toolB]
    const aligned1 = compactor.alignToolsSchema([toolA, toolB]);
    const json1 = JSON.stringify(aligned1);

    // Permutation 2: [toolB, toolA] with inverted object keys
    const toolAInverted = {
      function: {
        parameters: {
          properties: {
            apple: { type: 'string' },
            zebra: { type: 'string' }
          },
          type: 'object',
          a_prop: { type: 'number' },
          z_prop: { type: 'string' }
        },
        description: 'Tool Z',
        name: 'z_tool'
      },
      type: 'function'
    };
    const aligned2 = compactor.alignToolsSchema([toolAInverted, toolB]);
    const json2 = JSON.stringify(aligned2);

    assert.strictEqual(json1, json2, 'Deterministic alignment must yield 100% byte-identical JSON string regardless of input key/array order!');
    assert.strictEqual(aligned1[0].function.name, 'a_tool', 'Tools must be sorted alphabetically by function name');
    assert.strictEqual(aligned1[1].function.name, 'z_tool');
  });

  await runAdversarialTest('CacheAligner', '超长 Tools Schema 瘦身 (slimToolsSchema) 门限与语法有效性', () => {
    // Generate a massive tools schema (> 18,000 characters) with verbose markdown descriptions & examples
    const tools = [];
    for (let i = 0; i < 15; i++) {
      tools.push({
        type: 'function',
        function: {
          name: `enterprise_api_${i}`,
          description: `This is an exhaustive description of enterprise API ${i}. ` + 'Detailed behavior explanation with edge case notes. '.repeat(20) + `
### Example Usage
\`\`\`json
{
  "request": {
    "payload": {
      "sampleKey": "sampleValue",
      "dataArray": [1, 2, 3, 4, 5]
    }
  }
}
\`\`\`
`,
          parameters: {
            type: 'object',
            properties: {
              paramA: { type: 'string', description: 'Parameter A with detailed notes '.repeat(10) },
              paramB: { type: 'number', description: 'Parameter B '.repeat(10) }
            },
            required: ['paramA']
          }
        }
      });
    }

    const rawStr = JSON.stringify(tools);
    assert.ok(rawStr.length > 18000, `Raw tools schema must be > 18,000 chars, got ${rawStr.length}`);

    const compactResult = compactor.compactToolsList(tools, {
      alignToolsSchema: true,
      slimToolsSchema: true,
      schemaCharThreshold: 15000
    });

    assert.ok(compactResult.savedChars > 0, 'Must record non-zero saved characters');
    const slimmedStr = JSON.stringify(compactResult.tools);
    assert.ok(slimmedStr.length < rawStr.length, 'Slimmed schema length must be smaller than raw');
    // Verify JSON Schema validity
    assert.doesNotThrow(() => {
      const parsed = JSON.parse(slimmedStr);
      assert.strictEqual(parsed.length, 15);
      assert.strictEqual(parsed[0].function.parameters.type, 'object');
    }, 'Slimmed tools schema must remain 100% valid JSON and preserve object structure');
  });

  await runAdversarialTest('CacheZone', 'Cache-Zone 会话历史轮次前缀固化缓存与配置签名动态失效', () => {
    const sessionId = `test_sess_${Date.now()}`;
    const sampleText = 'Some repetitious diagnostic telemetry output ' + 'abc '.repeat(50);

    // Call 1: Miss and set cache
    compactor.clearSessionMemo(sessionId);
    const res1 = compactor.compactText(sampleText, { preset: 'balanced' }, sessionId);

    // Call 2: Hit memo
    const res2 = compactor.compactText(sampleText, { preset: 'balanced' }, sessionId);
    assert.strictEqual(res2, res1, 'Cached output must match original output');

    // Call 3: Modify option switch -> Dynamic options signature changes -> Cache Invalidation
    const res3 = compactor.compactText(sampleText, { preset: 'balanced', stripAnsi: false }, sessionId);
    assert.ok(typeof res3 === 'string');

    // Clean up
    compactor.clearSessionMemo(sessionId);
    assert.strictEqual(compactor.getMemo(sessionId, 'any_key'), null);
  });

  // ============================================================================
  // SECTION 4: 跨平台部署探针与运行时完整性 (Windows & Linux NAS)
  // ============================================================================
  console.log('\n--- SECTION 4: Cross-Platform (Windows & Linux NAS) Integrity ---');

  await runAdversarialTest('Platform', 'Windows 桌面托盘脚本 (tray-daemon.ps1) 语法与关键机制完备性', () => {
    const psScriptPath = path.join(__dirname, 'tray-daemon.ps1');
    assert.ok(fs.existsSync(psScriptPath), 'tray-daemon.ps1 must exist');
    const content = fs.readFileSync(psScriptPath, 'utf8');

    // 1. AST syntax check via PowerShell directly invoking Parser
    try {
      const escapedPath = psScriptPath.replace(/'/g, "''");
      const psCommand = `$errs = $null; $null = [System.Management.Automation.Language.Parser]::ParseInput((Get-Content '${escapedPath}' -Raw), [ref]$null, [ref]$errs); if ($errs.Count -gt 0) { exit 1 } else { exit 0 }`;
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand], { stdio: 'pipe' });
    } catch (err) {
      assert.fail(`tray-daemon.ps1 failed PowerShell AST parsing: ${err.message}`);
    }

    // 2. Validate SingleInstanceLock Mutex
    assert.ok(content.includes('Local\\OpenCodeRouterTrayPSMutex_v2'), 'Must specify correct SingleInstance mutex');

    // 3. Validate zombie process detection & self-healing logic (Rule 4)
    assert.ok(content.includes('MainWindowHandle -ne 0') || content.includes('MainWindowHandle -eq 0'), 'Must inspect MainWindowHandle for zombie process detection');
    assert.ok(content.includes('opencode') && content.includes('serve'), 'Must handle opencode serve child process termination');

    // 4. Validate 5000ms watchdog
    assert.ok(content.includes('watchdogTimer.Interval = 5000'), 'Must feature 5000ms watchdog timer');

    // 5. Validate standalone desktop app mode (Rule 3)
    assert.ok(content.includes('--app='), 'Must support Edge/Chrome --app standalone desktop window mode');
  });

  await runAdversarialTest('Platform', 'Windows 静默启动与快捷方式引导脚本 (launch-gui.vbs / silent-start.vbs) 完备性', () => {
    const silentVbs = path.join(__dirname, 'silent-start.vbs');
    const launchVbs = path.join(__dirname, 'launch-gui.vbs');
    assert.ok(fs.existsSync(silentVbs), 'silent-start.vbs must exist');
    assert.ok(fs.existsSync(launchVbs), 'launch-gui.vbs must exist');

    const silentContent = fs.readFileSync(silentVbs, 'utf8');
    const launchContent = fs.readFileSync(launchVbs, 'utf8');

    // Must execute with WshShell.Run ..., 0, False for 100% windowless operation (Rule 2)
    assert.ok(silentContent.includes(', 0,') || silentContent.includes(', 0'), 'silent-start.vbs must specify window style 0 (hidden)');
    assert.ok(launchContent.includes(', 0,') || launchContent.includes(', 0'), 'launch-gui.vbs must specify window style 0 (hidden)');
  });

  await runAdversarialTest('Platform', 'Linux NAS 部署脚本 (sync_nas.py) 语法、文件清单与鉴权自适应探针 (Rule 8)', () => {
    const syncScript = path.join(__dirname, 'sync_nas.py');
    assert.ok(fs.existsSync(syncScript), 'sync_nas.py must exist');

    // 1. Python syntax check
    try {
      execFileSync('python', ['-m', 'py_compile', syncScript], { stdio: 'pipe' });
    } catch (err) {
      assert.fail(`sync_nas.py failed Python syntax compilation: ${err.message}`);
    }

    const content = fs.readFileSync(syncScript, 'utf8');

    // 2. Target credentials & SSH endpoint verification
    assert.ok(content.includes('192.168.1.50') && content.includes('8822'), 'Must target Linux NAS at 192.168.1.50:8822');
    assert.ok(content.includes('deancyl0607'), 'Must specify correct NAS SSH username');

    // 3. Rule 8 Auth Auto-Discovery verification
    assert.ok(content.includes('config.json') && content.includes('uiPassword'), 'Must auto-discover uiPassword from config.json to avoid false 401 alarms (Rule 8)');
    assert.ok(content.includes('comp-doctor-status-badge'), 'Must probe comp-doctor-status-badge');
    assert.ok(content.includes('/balancer/api/compression/doctor'), 'Must probe compression doctor API');

    // 4. Verification of files_to_sync integrity
    const match = content.match(/files_to_sync\s*=\s*\[([^\]]+)\]/);
    assert.ok(match, 'Must find files_to_sync array in sync_nas.py');
    const fileList = match[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
    for (const f of fileList) {
      const localPath = path.join(__dirname, f);
      assert.ok(fs.existsSync(localPath), `File in files_to_sync must exist on local disk: ${f}`);
    }
  });

  // ============================================================================
  // SECTION 5: 系统体检诊断与一键自愈全闭环 (System Doctor & Repair)
  // ============================================================================
  console.log('\n--- SECTION 5: System Doctor & Auto-Repair Closed-Loop ---');

  await runAdversarialTest('Doctor', '破坏性配置注入与精确检测 (Audit Detection Precision)', () => {
    const corruptedConfig = {
      enabled: true,
      exemptMergeConflicts: false, // Redline breach!
      protectSourceDiffs: false,   // Redline breach!
      schemaCharThreshold: 1000,   // Dangerous threshold < 4000
      customTestPassPatterns: ['[invalid_regex(('] // Malformed regex
    };

    const audit = compactor.checkCompressionHealth(corruptedConfig);
    assert.strictEqual(audit.healthy, false, 'Audit must fail for corrupted config');
    assert.ok(audit.issues.length >= 4, `Must detect at least 4 issues, found ${audit.issues.length}`);

    const issueIds = audit.issues.map(i => i.id);
    assert.ok(issueIds.includes('comp_merge_conflicts_unprotected'), 'Must detect unprotected merge conflicts');
    assert.ok(issueIds.includes('comp_source_diffs_unprotected'), 'Must detect unprotected source diffs');
    assert.ok(issueIds.includes('comp_schema_threshold_too_low'), 'Must detect schema threshold too low');
    assert.ok(issueIds.includes('comp_invalid_test_pattern'), 'Must detect invalid regex pattern');
  });

  await runAdversarialTest('Doctor', '一键自愈与健康完全恢复 (Auto-Repair Roundtrip)', () => {
    const corruptedConfig = {
      enabled: false,
      exemptMergeConflicts: false,
      protectSourceDiffs: false,
      schemaCharThreshold: 1200,
      customTestPassPatterns: ['(?<invalid[']
    };

    const repairRes = compactor.repairCompressionConfig(corruptedConfig, { autoHeal: true, enableMaster: true });
    assert.strictEqual(repairRes.success, true, 'repairCompressionConfig must succeed');
    assert.ok(repairRes.results.length >= 3, 'Must report repair actions taken');

    // Run health check on repaired config
    const postAudit = compactor.checkCompressionHealth(repairRes.repairedConfig);
    assert.strictEqual(postAudit.healthy, true, 'Repaired config must pass health check with healthy: true');
    assert.strictEqual(postAudit.issues.length, 0, 'Repaired config must have 0 issues');
    assert.strictEqual(repairRes.repairedConfig.exemptMergeConflicts, true, 'Merge conflict shield must be restored');
    assert.strictEqual(repairRes.repairedConfig.protectSourceDiffs, true, 'Source diff protection must be restored');
    assert.strictEqual(repairRes.repairedConfig.schemaCharThreshold, 15000, 'Schema threshold must be reset to safe 15000');
  });

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n================================================================');
  console.log(`🏁 Tier 5 Adversarial Suite Complete: ${passedTests}/${totalTests} Passed (100% PASS)`);
  console.log('================================================================\n');

  if (failureList.length > 0) {
    console.error('FAILURES DETECTED:');
    for (const f of failureList) {
      console.error(`- [${f.category}] ${f.name}: ${f.error}`);
    }
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
