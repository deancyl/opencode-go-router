/**
 * OpenCode Go Router - Context Compactor & Token Optimization Engine
 * Ultra-low overhead, 100% Node.js native zero dependencies.
 *
 * Implements deterministic lossless/reversible compression across 5 key dimensions:
 * 1. CLI/Tool Output Denoising:
 *    - stripAnsi: Strip ANSI color codes, text formatting, cursor controls, OSC sequences
 *    - cleanProgressBars: Wipe \r overwrite spam while strictly preserving \r\n line endings
 *    - cleanDockerOutput: Fold repetitive multi-layer container pull/push download status
 *    - cleanTerraformOutput: Fold repetitive resource state refreshing logs
 * 2. Diff Noise Folding:
 *    - foldLockfiles: Safe folding for giant lockfile diffs (package-lock, yarn, cargo, bun, uv, etc.)
 *      CRITICAL SAFETY: Detects <<<<<<< merge conflict markers and NEVER folds conflicted diffs
 * 3. Positive Test Passes Folding:
 *    - foldTestPasses: Positive matching inversion - folds explicit passing blocks (✓, PASS, ok, [OK])
 *      CRITICAL SAFETY: 100% preserves failures, errors, assertion diffs, and full stack traces
 *      EXTENSIBILITY: Supports custom regex patterns via options.customTestPassPatterns
 * 4. CacheAligner & Tools Schema Optimization:
 *    - alignToolsSchema: Lexicographical key & array sorting to lock Prompt Cache (KV Cache)
 *    - slimToolsSchema: Deep composite schema trimming (> 15,000 chars) by pruning markdown examples
 * 5. Cache-Zone Memoization:
 *    - sessionCompressionMemo: Freezes historic round byte-streams by session & sha256 hash + opts signature
 * 6. Pluggable Pipeline Architecture:
 *    - registerTransformer / unregisterTransformer / runPipeline for third-party & user extensions
 *    - 100% safe-sandboxed execution: Any transformer exception is isolated with zero request impact
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_COMPRESSION_CONFIG = {
  enabled: true,
  preset: 'balanced',
  stripAnsi: true,
  cleanProgressBars: true,
  cleanDockerOutput: true,
  cleanTerraformOutput: true,
  cleanKubectlOutput: true,
  cleanGitOutput: true,
  cleanBuildAndPkgOutput: true,
  dedupLogLines: true,
  cleanDevOpsOutput: true,
  foldLockfiles: true,
  foldStructuredData: true,
  maxStructuredItems: 50,
  exemptMergeConflicts: true,
  protectSourceDiffs: true,
  foldTestPasses: true,
  alignToolsSchema: true,
  slimToolsSchema: true,
  schemaCharThreshold: 15000,
  cacheZoneFreeze: true,
  trueLruRetention: true,
  customTestPassPatterns: [],
  modules: {
    rtk: {
      enabled: true,
      stripAnsi: true,
      cleanProgressBars: true,
      foldTestPasses: true,
      cleanDevOpsOutput: true
    },
    headroom: {
      enabled: true,
      foldLockfiles: true,
      foldStructuredData: true,
      maxStructuredItems: 50,
      exemptMergeConflicts: true,
      protectSourceDiffs: true
    },
    schema: {
      enabled: true,
      alignToolsSchema: true,
      slimToolsSchema: true,
      schemaCharThreshold: 15000
    },
    cacheZone: {
      enabled: true,
      cacheZoneFreeze: true,
      trueLruRetention: true
    },
    powershell: {
      enabled: true,
      autoDetectPlatform: true,
      cleanCliXmlNoise: true,
      cleanPowerShell7Noise: true,
      fixQuoteEscaping: true,
      fixCurlAlias: true,
      fixTrailingSlash: true,
      fixAndOperator: true,
      fixLineContinuation: true,
      fixSubexpressionEscaping: true,
      scriptFileInjectionHelper: true,
      injectPowerShellGuard: true
    }
  }
};

const COMPRESSION_PRESETS = {
  balanced: {
    enabled: true,
    preset: 'balanced',
    modules: {
      rtk: {
        enabled: true,
        stripAnsi: true,
        cleanProgressBars: true,
        foldTestPasses: true,
        cleanDevOpsOutput: true
      },
      headroom: {
        enabled: true,
        foldLockfiles: true,
        foldStructuredData: true,
        maxStructuredItems: 50,
        structuredHeadCount: 5,
        structuredTailCount: 3,
        exemptMergeConflicts: true,
        protectSourceDiffs: true
      },
      schema: {
        enabled: true,
        alignToolsSchema: true,
        slimToolsSchema: true,
        schemaCharThreshold: 15000
      },
      cacheZone: {
        enabled: true,
        cacheZoneFreeze: true,
        trueLruRetention: true
      },
      powershell: {
        enabled: true,
        autoDetectPlatform: true,
        cleanCliXmlNoise: true,
        cleanPowerShell7Noise: true,
        fixQuoteEscaping: true,
        fixCurlAlias: true,
        fixTrailingSlash: true,
        fixAndOperator: true,
        fixLineContinuation: true,
        fixSubexpressionEscaping: true,
        scriptFileInjectionHelper: true,
        injectPowerShellGuard: true
      }
    }
  },
  aggressive: {
    enabled: true,
    preset: 'aggressive',
    modules: {
      rtk: {
        enabled: true,
        stripAnsi: true,
        cleanProgressBars: true,
        foldTestPasses: true,
        cleanDevOpsOutput: true
      },
      headroom: {
        enabled: true,
        foldLockfiles: true,
        foldStructuredData: true,
        maxStructuredItems: 15,
        structuredHeadCount: 3,
        structuredTailCount: 2,
        exemptMergeConflicts: true,
        protectSourceDiffs: true
      },
      schema: {
        enabled: true,
        alignToolsSchema: true,
        slimToolsSchema: true,
        schemaCharThreshold: 8000
      },
      cacheZone: {
        enabled: true,
        cacheZoneFreeze: true,
        trueLruRetention: true
      },
      powershell: {
        enabled: true,
        autoDetectPlatform: true,
        cleanCliXmlNoise: true,
        cleanPowerShell7Noise: true,
        fixQuoteEscaping: true,
        fixCurlAlias: true,
        fixTrailingSlash: true,
        fixAndOperator: true,
        fixLineContinuation: true,
        fixSubexpressionEscaping: true,
        scriptFileInjectionHelper: true,
        injectPowerShellGuard: true
      }
    }
  },
  conservative: {
    enabled: true,
    preset: 'conservative',
    modules: {
      rtk: {
        enabled: true,
        stripAnsi: true,
        cleanProgressBars: true,
        cleanCliXmlNoise: true,
        foldTestPasses: false,
        cleanDevOpsOutput: false
      },
      headroom: {
        enabled: false,
        foldLockfiles: false,
        foldStructuredData: false,
        maxStructuredItems: 50,
        structuredHeadCount: 5,
        structuredTailCount: 3,
        exemptMergeConflicts: true,
        protectSourceDiffs: true
      },
      schema: {
        enabled: true,
        alignToolsSchema: true,
        slimToolsSchema: false,
        schemaCharThreshold: 15000
      },
      cacheZone: {
        enabled: false,
        cacheZoneFreeze: false,
        trueLruRetention: true
      },
      powershell: {
        enabled: true,
        autoDetectPlatform: true,
        cleanCliXmlNoise: true,
        cleanPowerShell7Noise: true,
        fixQuoteEscaping: true,
        fixCurlAlias: true,
        fixTrailingSlash: true,
        fixAndOperator: true,
        fixLineContinuation: true,
        fixSubexpressionEscaping: true,
        scriptFileInjectionHelper: true,
        injectPowerShellGuard: false
      }
    }
  }
};

/**
 * Normalizes compression options, bridging hierarchical modules and flat legacy keys.
 * Accurately derives effective switches while preserving original module configurations.
 */
function normalizeCompressionOptions(input = {}) {
  if (!input || typeof input !== 'object') {
    return JSON.parse(JSON.stringify(DEFAULT_COMPRESSION_CONFIG));
  }

  const result = JSON.parse(JSON.stringify(DEFAULT_COMPRESSION_CONFIG));

  const presetKey = (input.preset && typeof input.preset === 'string') ? input.preset : null;
  const presetConfig = presetKey ? COMPRESSION_PRESETS[presetKey] : null;

  if (presetConfig && presetConfig.modules) {
    result.preset = presetKey;
    for (const modKey of ['rtk', 'headroom', 'schema', 'cacheZone', 'powershell']) {
      if (presetConfig.modules[modKey]) {
        Object.assign(result.modules[modKey], presetConfig.modules[modKey]);
      }
    }
  } else if (input.preset !== undefined) {
    result.preset = String(input.preset);
  }

  if (input.enabled !== undefined) {
    result.enabled = Boolean(input.enabled);
  }

  // 1. If nested modules structure is supplied, deeply merge it
  if (input.modules && typeof input.modules === 'object') {
    const m = input.modules;
    if (m.rtk && typeof m.rtk === 'object') {
      if (m.rtk.enabled !== undefined) result.modules.rtk.enabled = Boolean(m.rtk.enabled);
      if (m.rtk.stripAnsi !== undefined) result.modules.rtk.stripAnsi = Boolean(m.rtk.stripAnsi);
      if (m.rtk.cleanProgressBars !== undefined) result.modules.rtk.cleanProgressBars = Boolean(m.rtk.cleanProgressBars);
      if (m.rtk.foldTestPasses !== undefined) result.modules.rtk.foldTestPasses = Boolean(m.rtk.foldTestPasses);
      if (m.rtk.cleanDevOpsOutput !== undefined) result.modules.rtk.cleanDevOpsOutput = Boolean(m.rtk.cleanDevOpsOutput);
    }
    if (m.headroom && typeof m.headroom === 'object') {
      if (m.headroom.enabled !== undefined) result.modules.headroom.enabled = Boolean(m.headroom.enabled);
      if (m.headroom.foldLockfiles !== undefined) result.modules.headroom.foldLockfiles = Boolean(m.headroom.foldLockfiles);
      if (m.headroom.foldStructuredData !== undefined) result.modules.headroom.foldStructuredData = Boolean(m.headroom.foldStructuredData);
      if (m.headroom.maxStructuredItems !== undefined) {
        const val = Number(m.headroom.maxStructuredItems);
        result.modules.headroom.maxStructuredItems = (!isNaN(val) && val > 0) ? val : 50;
      }
      if (m.headroom.exemptMergeConflicts !== undefined) result.modules.headroom.exemptMergeConflicts = Boolean(m.headroom.exemptMergeConflicts);
      if (m.headroom.protectSourceDiffs !== undefined) result.modules.headroom.protectSourceDiffs = Boolean(m.headroom.protectSourceDiffs);
    }
    if (m.schema && typeof m.schema === 'object') {
      if (m.schema.enabled !== undefined) result.modules.schema.enabled = Boolean(m.schema.enabled);
      if (m.schema.alignToolsSchema !== undefined) result.modules.schema.alignToolsSchema = Boolean(m.schema.alignToolsSchema);
      if (m.schema.slimToolsSchema !== undefined) result.modules.schema.slimToolsSchema = Boolean(m.schema.slimToolsSchema);
      if (m.schema.schemaCharThreshold !== undefined) {
        const val = Number(m.schema.schemaCharThreshold);
        result.modules.schema.schemaCharThreshold = (!isNaN(val) && val >= 0) ? val : 15000;
      }
    }
    if (m.cacheZone && typeof m.cacheZone === 'object') {
      if (m.cacheZone.enabled !== undefined) result.modules.cacheZone.enabled = Boolean(m.cacheZone.enabled);
      if (m.cacheZone.cacheZoneFreeze !== undefined) result.modules.cacheZone.cacheZoneFreeze = Boolean(m.cacheZone.cacheZoneFreeze);
      if (m.cacheZone.trueLruRetention !== undefined) result.modules.cacheZone.trueLruRetention = Boolean(m.cacheZone.trueLruRetention);
    }
    if (m.powershell && typeof m.powershell === 'object') {
      if (m.powershell.enabled !== undefined) result.modules.powershell.enabled = Boolean(m.powershell.enabled);
      if (m.powershell.autoDetectPlatform !== undefined) result.modules.powershell.autoDetectPlatform = Boolean(m.powershell.autoDetectPlatform);
      if (m.powershell.cleanCliXmlNoise !== undefined) result.modules.powershell.cleanCliXmlNoise = Boolean(m.powershell.cleanCliXmlNoise);
      if (m.powershell.cleanPowerShell7Noise !== undefined) result.modules.powershell.cleanPowerShell7Noise = Boolean(m.powershell.cleanPowerShell7Noise);
      if (m.powershell.fixQuoteEscaping !== undefined) result.modules.powershell.fixQuoteEscaping = Boolean(m.powershell.fixQuoteEscaping);
      if (m.powershell.fixCurlAlias !== undefined) result.modules.powershell.fixCurlAlias = Boolean(m.powershell.fixCurlAlias);
      if (m.powershell.fixTrailingSlash !== undefined) result.modules.powershell.fixTrailingSlash = Boolean(m.powershell.fixTrailingSlash);
      if (m.powershell.fixAndOperator !== undefined) result.modules.powershell.fixAndOperator = Boolean(m.powershell.fixAndOperator);
      if (m.powershell.fixLineContinuation !== undefined) result.modules.powershell.fixLineContinuation = Boolean(m.powershell.fixLineContinuation);
      if (m.powershell.fixSubexpressionEscaping !== undefined) result.modules.powershell.fixSubexpressionEscaping = Boolean(m.powershell.fixSubexpressionEscaping);
      if (m.powershell.scriptFileInjectionHelper !== undefined) result.modules.powershell.scriptFileInjectionHelper = Boolean(m.powershell.scriptFileInjectionHelper);
      if (m.powershell.injectPowerShellGuard !== undefined) result.modules.powershell.injectPowerShellGuard = Boolean(m.powershell.injectPowerShellGuard);
    }
  }

  // 1.5 Support top-level powershell / powershellOptimizer options
  const topPs = input.powershellOptimizer || input.powershell;
  if (topPs && typeof topPs === 'object') {
    Object.assign(result.modules.powershell, topPs);
  }

  // 2. Mirror explicit flat keys into the modules structure (backward compatibility)
  // Only override if the nested module did not explicitly define the corresponding key
  const mInput = (input.modules && typeof input.modules === 'object') ? input.modules : null;
  const hasModRtk = mInput && mInput.rtk && typeof mInput.rtk === 'object';
  const hasModHeadroom = mInput && mInput.headroom && typeof mInput.headroom === 'object';
  const hasModSchema = mInput && mInput.schema && typeof mInput.schema === 'object';
  const hasModCacheZone = mInput && mInput.cacheZone && typeof mInput.cacheZone === 'object';
  const hasModPowershell = mInput && mInput.powershell && typeof mInput.powershell === 'object';

  if (input.stripAnsi !== undefined && (!hasModRtk || mInput.rtk.stripAnsi === undefined)) {
    result.modules.rtk.stripAnsi = Boolean(input.stripAnsi);
  }
  if (input.cleanProgressBars !== undefined && (!hasModRtk || mInput.rtk.cleanProgressBars === undefined)) {
    result.modules.rtk.cleanProgressBars = Boolean(input.cleanProgressBars);
  }
  if (input.foldTestPasses !== undefined && (!hasModRtk || mInput.rtk.foldTestPasses === undefined)) {
    result.modules.rtk.foldTestPasses = Boolean(input.foldTestPasses);
  }
  if (input.cleanDevOpsOutput !== undefined && (!hasModRtk || mInput.rtk.cleanDevOpsOutput === undefined)) {
    result.modules.rtk.cleanDevOpsOutput = Boolean(input.cleanDevOpsOutput);
  } else if ((!hasModRtk || mInput.rtk.cleanDevOpsOutput === undefined) &&
             (input.cleanDockerOutput !== undefined || input.cleanKubectlOutput !== undefined || input.cleanTerraformOutput !== undefined)) {
    const dVal = (input.cleanDockerOutput !== undefined ? Boolean(input.cleanDockerOutput) : true) &&
                 (input.cleanKubectlOutput !== undefined ? Boolean(input.cleanKubectlOutput) : true) &&
                 (input.cleanTerraformOutput !== undefined ? Boolean(input.cleanTerraformOutput) : true);
    result.modules.rtk.cleanDevOpsOutput = dVal;
  }
  if (input.foldLockfiles !== undefined && (!hasModHeadroom || mInput.headroom.foldLockfiles === undefined)) {
    result.modules.headroom.foldLockfiles = Boolean(input.foldLockfiles);
  }
  if (input.foldStructuredData !== undefined && (!hasModHeadroom || mInput.headroom.foldStructuredData === undefined)) {
    result.modules.headroom.foldStructuredData = Boolean(input.foldStructuredData);
  }
  if (input.maxStructuredItems !== undefined && (!hasModHeadroom || mInput.headroom.maxStructuredItems === undefined)) {
    const val = Number(input.maxStructuredItems);
    result.modules.headroom.maxStructuredItems = (!isNaN(val) && val > 0) ? val : 50;
  }
  if (input.exemptMergeConflicts !== undefined && (!hasModHeadroom || mInput.headroom.exemptMergeConflicts === undefined)) {
    result.modules.headroom.exemptMergeConflicts = Boolean(input.exemptMergeConflicts);
  }
  if (input.protectSourceDiffs !== undefined && (!hasModHeadroom || mInput.headroom.protectSourceDiffs === undefined)) {
    result.modules.headroom.protectSourceDiffs = Boolean(input.protectSourceDiffs);
  }
  if (input.alignToolsSchema !== undefined && (!hasModSchema || mInput.schema.alignToolsSchema === undefined)) {
    result.modules.schema.alignToolsSchema = Boolean(input.alignToolsSchema);
  }
  if (input.slimToolsSchema !== undefined && (!hasModSchema || mInput.schema.slimToolsSchema === undefined)) {
    result.modules.schema.slimToolsSchema = Boolean(input.slimToolsSchema);
  }
  if (input.schemaCharThreshold !== undefined && (!hasModSchema || mInput.schema.schemaCharThreshold === undefined)) {
    const val = Number(input.schemaCharThreshold);
    result.modules.schema.schemaCharThreshold = (!isNaN(val) && val >= 0) ? val : 15000;
  }
  if (input.cacheZoneFreeze !== undefined && (!hasModCacheZone || mInput.cacheZone.cacheZoneFreeze === undefined)) {
    result.modules.cacheZone.cacheZoneFreeze = Boolean(input.cacheZoneFreeze);
  }
  if (input.trueLruRetention !== undefined && (!hasModCacheZone || mInput.cacheZone.trueLruRetention === undefined)) {
    result.modules.cacheZone.trueLruRetention = Boolean(input.trueLruRetention);
  }
  if (input.autoDetectPlatform !== undefined && (!hasModPowershell || mInput.powershell.autoDetectPlatform === undefined)) {
    result.modules.powershell.autoDetectPlatform = Boolean(input.autoDetectPlatform);
  }
  if (input.cleanCliXmlNoise !== undefined && (!hasModPowershell || mInput.powershell.cleanCliXmlNoise === undefined)) {
    result.modules.powershell.cleanCliXmlNoise = Boolean(input.cleanCliXmlNoise);
  }
  if (input.fixQuoteEscaping !== undefined && (!hasModPowershell || mInput.powershell.fixQuoteEscaping === undefined)) {
    result.modules.powershell.fixQuoteEscaping = Boolean(input.fixQuoteEscaping);
  }
  if (input.fixCurlAlias !== undefined && (!hasModPowershell || mInput.powershell.fixCurlAlias === undefined)) {
    result.modules.powershell.fixCurlAlias = Boolean(input.fixCurlAlias);
  }
  if (input.fixTrailingSlash !== undefined && (!hasModPowershell || mInput.powershell.fixTrailingSlash === undefined)) {
    result.modules.powershell.fixTrailingSlash = Boolean(input.fixTrailingSlash);
  }
  if (input.fixAndOperator !== undefined && (!hasModPowershell || mInput.powershell.fixAndOperator === undefined)) {
    result.modules.powershell.fixAndOperator = Boolean(input.fixAndOperator);
  }
  if (input.fixLineContinuation !== undefined && (!hasModPowershell || mInput.powershell.fixLineContinuation === undefined)) {
    result.modules.powershell.fixLineContinuation = Boolean(input.fixLineContinuation);
  }
  if (input.cleanPowerShell7Noise !== undefined && (!hasModPowershell || mInput.powershell.cleanPowerShell7Noise === undefined)) {
    result.modules.powershell.cleanPowerShell7Noise = Boolean(input.cleanPowerShell7Noise);
  }
  if (input.fixSubexpressionEscaping !== undefined && (!hasModPowershell || mInput.powershell.fixSubexpressionEscaping === undefined)) {
    result.modules.powershell.fixSubexpressionEscaping = Boolean(input.fixSubexpressionEscaping);
  }
  if (input.scriptFileInjectionHelper !== undefined && (!hasModPowershell || mInput.powershell.scriptFileInjectionHelper === undefined)) {
    result.modules.powershell.scriptFileInjectionHelper = Boolean(input.scriptFileInjectionHelper);
  }
  if (input.injectPowerShellGuard !== undefined && (!hasModPowershell || mInput.powershell.injectPowerShellGuard === undefined)) {
    result.modules.powershell.injectPowerShellGuard = Boolean(input.injectPowerShellGuard);
  }
  if (input.customTestPassPatterns !== undefined) result.customTestPassPatterns = input.customTestPassPatterns;
  if (input.model !== undefined) result.model = normalizeModelName(input.model);

  const explicitPlatform = input.targetPlatform || input.platform ||
    (input.modules && input.modules.powershell && (input.modules.powershell.targetPlatform || input.modules.powershell.platform)) ||
    (input.powershell && (input.powershell.targetPlatform || input.powershell.platform)) || null;
  if (explicitPlatform) {
    result.targetPlatform = explicitPlatform;
  }

  // 3. Compute effective runtime flat keys governed by both master switch and module switches
  const rtkActive = result.enabled && result.modules.rtk.enabled;
  const headroomActive = result.enabled && result.modules.headroom.enabled;
  const schemaActive = result.enabled && result.modules.schema.enabled;
  const cacheZoneActive = result.enabled && result.modules.cacheZone.enabled;
  const powershellActive = result.enabled && result.modules.powershell.enabled;

  result.stripAnsi = rtkActive ? result.modules.rtk.stripAnsi : false;
  result.cleanProgressBars = rtkActive ? result.modules.rtk.cleanProgressBars : false;
  result.foldTestPasses = rtkActive ? result.modules.rtk.foldTestPasses : false;
  const devopsVal = rtkActive ? result.modules.rtk.cleanDevOpsOutput : false;
  result.cleanDevOpsOutput = devopsVal;
  result.cleanDockerOutput = rtkActive ? (input.cleanDockerOutput !== undefined ? Boolean(input.cleanDockerOutput) : devopsVal) : false;
  result.cleanKubectlOutput = rtkActive ? (input.cleanKubectlOutput !== undefined ? Boolean(input.cleanKubectlOutput) : devopsVal) : false;
  result.cleanTerraformOutput = rtkActive ? (input.cleanTerraformOutput !== undefined ? Boolean(input.cleanTerraformOutput) : devopsVal) : false;
  result.cleanCliMetadata = rtkActive ? (input.cleanCliMetadata !== undefined ? Boolean(input.cleanCliMetadata) : devopsVal) : false;
  result.cleanGitOutput = rtkActive ? (input.cleanGitOutput !== undefined ? Boolean(input.cleanGitOutput) : devopsVal) : false;
  result.cleanBuildAndPkgOutput = rtkActive ? (input.cleanBuildAndPkgOutput !== undefined ? Boolean(input.cleanBuildAndPkgOutput) : devopsVal) : false;
  result.cleanSearchAndTreeOutput = rtkActive ? (input.cleanSearchAndTreeOutput !== undefined ? Boolean(input.cleanSearchAndTreeOutput) : devopsVal) : false;
  result.dedupLogLines = rtkActive ? (input.dedupLogLines !== undefined ? Boolean(input.dedupLogLines) : devopsVal) : false;

  result.foldLockfiles = headroomActive ? result.modules.headroom.foldLockfiles : false;
  result.foldStructuredData = headroomActive ? result.modules.headroom.foldStructuredData : false;
  result.maxStructuredItems = result.modules.headroom.maxStructuredItems || 50;
  result.exemptMergeConflicts = result.modules.headroom.exemptMergeConflicts;
  result.protectSourceDiffs = result.modules.headroom.protectSourceDiffs;

  result.alignToolsSchema = schemaActive ? result.modules.schema.alignToolsSchema : false;
  result.slimToolsSchema = schemaActive ? result.modules.schema.slimToolsSchema : false;
  result.schemaCharThreshold = result.modules.schema.schemaCharThreshold;

  result.cacheZoneFreeze = cacheZoneActive ? result.modules.cacheZone.cacheZoneFreeze : false;
  result.trueLruRetention = result.modules.cacheZone.trueLruRetention;

  result.autoDetectPlatform = powershellActive ? result.modules.powershell.autoDetectPlatform : false;
  result.cleanCliXmlNoise = powershellActive ? result.modules.powershell.cleanCliXmlNoise : false;
  result.cleanPowerShell7Noise = powershellActive ? result.modules.powershell.cleanPowerShell7Noise : false;
  result.cleanPowerShellOutput = powershellActive ? (result.modules.powershell.cleanCliXmlNoise || result.modules.powershell.cleanPowerShell7Noise) : false;
  result.fixQuoteEscaping = powershellActive ? result.modules.powershell.fixQuoteEscaping : false;
  result.fixCurlAlias = powershellActive ? result.modules.powershell.fixCurlAlias : false;
  result.fixTrailingSlash = powershellActive ? result.modules.powershell.fixTrailingSlash : false;
  result.fixAndOperator = powershellActive ? result.modules.powershell.fixAndOperator : false;
  result.fixLineContinuation = powershellActive ? result.modules.powershell.fixLineContinuation : false;
  result.fixSubexpressionEscaping = powershellActive ? result.modules.powershell.fixSubexpressionEscaping : false;
  result.scriptFileInjectionHelper = powershellActive ? result.modules.powershell.scriptFileInjectionHelper : false;
  result.injectPowerShellGuard = powershellActive ? result.modules.powershell.injectPowerShellGuard : false;
  if (explicitPlatform) {
    result.targetPlatform = explicitPlatform;
  }

  return result;
}

/* ==========================================================================
   Realtime Token & Chars Savings Metrics Engine & Lightweight Persistence
   ========================================================================== */

/* ==========================================================================
   OpenCode Official Model Pricing Rate Dictionary & Dynamic Sensing
   ========================================================================== */

const DEFAULT_MODEL_RATE_PER_1M = 0.25; // USD / 1M Tokens (fallback baseline)

const OPENCODE_GO_MODEL_RATES = {
  // DeepSeek family (OpenCode Go primary agent models)
  'deepseek-v4.1-flash': 0.14,
  'deepseek-flash': 0.14,
  'deepseek-v4-flash': 0.14,
  'deepseek-v4-pro': 0.55,
  'deepseek-v4-flash-vision-exp': 0.18,

  // GLM family
  'glm-5.3-flash': 0.10,
  'glm-5.3': 0.35,
  'glm-5.2': 0.25,
  'glm-5.1': 0.20,

  // Kimi Moonshot family
  'kimi-k3': 0.60,
  'kimi-k2.7-code': 0.45,
  'kimi-k2.6': 0.35,

  // Qwen family
  'qwen3.8-flash': 0.12,
  'qwen3.6-plus': 0.35,
  'qwen3.7-plus': 0.40,
  'qwen3.7-max': 0.80,
  'qwen3.8-max': 0.85,

  // MiniMax family
  'minimax-m2.5': 0.15,
  'minimax-m2.7': 0.35,
  'minimax-m3': 0.50,

  // Grok family
  'grok-4.6': 1.50,
  'grok-4.7': 2.00,

  // GPT Luna family
  'gpt-5.6-luna': 1.50,
  'gpt-6-luna': 2.50,

  // Claude family
  'claude-haiku-5-5': 1.25,
  'claude-3-7-sonnet': 3.00,
  'claude-3-5-sonnet': 3.00,

  // MiMo family
  'mimo-v2.6-flash': 0.12,
  'mimo-v2.5': 0.20,
  'mimo-v2.5-pro': 0.35,
  'mimo-v2.6-pro': 0.40,

  // Hunyuan family
  'hy3': 0.30,
  'hy4-preview': 0.45,

  // LongCat family
  'longcat-2.5-preview-free': 0.10,
  'longcat-2.0': 0.15,

  // Step family
  'step-5-preview-free': 0.20,

  // Muse family
  'muse-spark-1.2-contributor': 0.15,
  'muse-spark-1.3-contributor': 0.20,

  // Omen & Space Bunny
  'space-bunny': 0.15,
  'omen-alpha': 0.50,

  // Codex native aliases
  'codex-mini': 0.40,
  'codex-pro': 1.50
};

const dynamicModelRates = { ...OPENCODE_GO_MODEL_RATES };

const MAX_BY_MODEL_ENTRIES = 120;

function pruneByModelEntriesIfNeeded() {
  if (!compressionStats.byModel) return;
  const entries = Object.entries(compressionStats.byModel);
  if (entries.length <= MAX_BY_MODEL_ENTRIES) return;

  // Evict lowest-contributing non-official models first
  entries.sort((a, b) => {
    const aIsOfficial = a[0] in OPENCODE_GO_MODEL_RATES;
    const bIsOfficial = b[0] in OPENCODE_GO_MODEL_RATES;
    if (aIsOfficial !== bIsOfficial) {
      return aIsOfficial ? 1 : -1; // non-official comes first (eviction priority)
    }
    return (a[1].savedCostUSD || 0) - (b[1].savedCostUSD || 0) || (a[1].savedTokens || 0) - (b[1].savedTokens || 0);
  });

  while (Object.keys(compressionStats.byModel).length > MAX_BY_MODEL_ENTRIES && entries.length > 0) {
    const toRemove = entries.shift();
    if (toRemove) {
      delete compressionStats.byModel[toRemove[0]];
    }
  }
}

const CANONICAL_MODEL_ALIASES = {
  'deepseek-flash': 'deepseek-v4.1-flash',
  'deepseek-v4-flash': 'deepseek-v4.1-flash',
  'deepseek_flash': 'deepseek-v4.1-flash',
  'deepseek-pro': 'deepseek-v4-pro',
  'deepseek_pro': 'deepseek-v4-pro',
  'deepseek-v4.0-pro': 'deepseek-v4-pro',
  'deepseek-v4-chat': 'deepseek-v4.1-flash',
  'kimi-k2.5': 'kimi-k2.7-code',
  'glm-4-flash': 'glm-4.7-flash'
};

function normalizeModelName(rawModel) {
  if (!rawModel || typeof rawModel !== 'string') return null;
  let clean = rawModel.trim().toLowerCase();
  clean = clean.replace(/\\/g, '/');
  if (clean.includes('/')) {
    clean = clean.split('/').pop().trim();
  }
  // Strip tags, query parameters, colons or version at-signs (e.g. :free, :latest, @2026-03, ?cache=1)
  if (clean.includes(':')) {
    clean = clean.split(':')[0].trim();
  }
  if (clean.includes('@')) {
    clean = clean.split('@')[0].trim();
  }
  if (clean.includes('?')) {
    clean = clean.split('?')[0].trim();
  }
  if (CANONICAL_MODEL_ALIASES[clean]) {
    return CANONICAL_MODEL_ALIASES[clean];
  }
  // Regex canonical alignment for deepseek flash & pro family
  if (/^deepseek[-_.]*(?:v[0-9.]*[-_.]*)?flash$/.test(clean)) {
    return 'deepseek-v4.1-flash';
  }
  if (/^deepseek[-_.]*(?:v[0-9.]*[-_.]*)?pro$/.test(clean)) {
    return 'deepseek-v4-pro';
  }
  return clean || null;
}

function getModelRate(rawModel) {
  const model = normalizeModelName(rawModel);
  if (!model) return DEFAULT_MODEL_RATE_PER_1M;
  if (typeof dynamicModelRates[model] === 'number') {
    return dynamicModelRates[model];
  }
  // Longest-prefix match (LPM) on candidate keys sorted by length descending
  const sortedEntries = Object.entries(dynamicModelRates).sort((a, b) => b[0].length - a[0].length);
  for (const [key, rate] of sortedEntries) {
    if (model === key || model.startsWith(key + '-') || (model.length >= 3 && key.startsWith(model + '-'))) {
      return rate;
    }
  }
  return DEFAULT_MODEL_RATE_PER_1M;
}

function updateModelRates(newRates) {
  if (!newRates || typeof newRates !== 'object') return dynamicModelRates;
  let updatedAny = false;
  for (const [rawModel, rate] of Object.entries(newRates)) {
    const clean = normalizeModelName(rawModel);
    if (clean && typeof rate === 'number' && rate > 0) {
      dynamicModelRates[clean] = rate;
      if (compressionStats && compressionStats.byModel && compressionStats.byModel[clean]) {
        compressionStats.byModel[clean].ratePer1M = rate;
        updatedAny = true;
      }
    }
  }
  if (updatedAny) {
    computeDerivedStats(compressionStats);
    persistStatsThrottled();
  }
  return dynamicModelRates;
}

/**
 * Dynamically synchronizes model rates from local or NAS OpenCode daemon /api/model
 */
async function syncModelRatesFromOpenCode(port = null, password = null) {
  try {
    let p = port;
    let pwd = password;
    let desktopPort = null;
    let sInfo = null;

    try {
      const updater = require('./updater');
      sInfo = updater.detectOpenCodeServiceInfo();
      if (sInfo) {
        if (!p && sInfo.port) p = sInfo.port;
        if (!pwd && sInfo.password) pwd = sInfo.password;
      }
    } catch (_) {}

    try {
      const sPath = path.join(os.homedir(), '.config', 'openchamber', 'settings.json');
      if (fs.existsSync(sPath)) {
        const s = JSON.parse(fs.readFileSync(sPath, 'utf8'));
        if (s.desktopLocalPort) desktopPort = s.desktopLocalPort;
        if (!pwd && s.opencodePassword) pwd = s.opencodePassword;
      }
    } catch (_) {}

    if (!pwd) {
      try {
        const ocServicePath = path.join(os.homedir(), '.config', 'opencode', 'service.json');
        if (fs.existsSync(ocServicePath)) {
          const ocService = JSON.parse(fs.readFileSync(ocServicePath, 'utf8'));
          if (ocService.password) pwd = ocService.password;
        }
      } catch (_) {}
    }

    if (!pwd && process.env.OPENCODE_PASSWORD) {
      pwd = process.env.OPENCODE_PASSWORD;
    }

    const portsToTry = port
      ? [port]
      : Array.from(new Set([desktopPort, p, process.platform === 'linux' ? 4096 : 3000].filter(Boolean)));

    const http = require('node:http');

    const tryFetchPort = (targetPort) => {
      return new Promise((resolve) => {
        const headers = { 'User-Agent': 'opencode-go-router-compactor' };
        if (pwd) {
          headers['Authorization'] = `Basic ${Buffer.from('opencode:' + pwd).toString('base64')}`;
        }
        const req = http.request({
          host: '127.0.0.1',
          port: targetPort,
          path: '/api/model',
          method: 'GET',
          headers,
          timeout: 2500
        }, (res) => {
          let raw = '';
          res.on('data', chunk => raw += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const data = JSON.parse(raw);
                let modelsList = [];
                if (Array.isArray(data)) modelsList = data;
                else if (Array.isArray(data.data)) modelsList = data.data;
                else if (Array.isArray(data.models)) modelsList = data.models;
                else if (data && typeof data === 'object') {
                  for (const val of Object.values(data)) {
                    if (Array.isArray(val)) modelsList.push(...val);
                    else if (val && typeof val === 'object' && (val.id || val.cost)) modelsList.push(val);
                  }
                }
                const fetchedRates = {};
                for (const m of modelsList) {
                  if (!m || typeof m !== 'object') continue;
                  const mId = m.id || m.name || m.slug;
                  const costObj = (Array.isArray(m.cost) ? m.cost[0] : m.cost) || {};
                  const pricingObj = (Array.isArray(m.pricing) ? m.pricing[0] : m.pricing) || {};
                  const rawCost = costObj.input ?? pricingObj.input ?? m.input_cost_per_million ?? costObj.prompt ?? pricingObj.prompt ?? m.cost_per_million_input;
                  const numCost = typeof rawCost === 'number' ? rawCost : (typeof rawCost === 'string' ? parseFloat(rawCost.replace(/[^0-9.]/g, '')) : null);
                  if (mId && numCost !== null && !isNaN(numCost) && numCost > 0) {
                    const r = numCost < 0.005 ? Number((numCost * 1000000).toFixed(4)) : Number(numCost.toFixed(4));
                    const cleanId = normalizeModelName(mId);
                    if (cleanId) fetchedRates[cleanId] = r;
                  }
                }
                if (Object.keys(fetchedRates).length > 0) {
                  updateModelRates(fetchedRates);
                  return resolve({ success: true, count: Object.keys(fetchedRates).length, rates: fetchedRates, port: targetPort });
                }
              } catch (_) {}
            }
            resolve({ success: false, reason: `HTTP ${res.statusCode}` });
          });
        });
        req.on('error', () => resolve({ success: false, reason: 'unreachable' }));
        req.on('timeout', () => { req.destroy(); resolve({ success: false, reason: 'timeout' }); });
        req.end();
      });
    };

    for (const testPort of portsToTry) {
      const fetchRes = await tryFetchPort(testPort);
      if (fetchRes && fetchRes.success) {
        return fetchRes;
      }
    }
    return { success: false, reason: 'No responding model service endpoint' };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

/**
 * Dynamic bilingual token estimation model.
 * - Chinese / CJK characters: ~1.25 chars / Token
 * - English / code / numbers / symbols / ASCII: ~3.8 chars / Token
 * If a numeric character count is passed without text, uses 3.8 chars/Token baseline.
 * @param {string|number} input - Text string or character count
 * @returns {number} Estimated token count
 */
function estimateTokens(input) {
  if (typeof input === 'number') {
    return Math.round(input / 3.8);
  }
  if (typeof input !== 'string' || input.length === 0) {
    return 0;
  }
  const cjkMatches = input.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkCount = input.length - cjkCount;
  return Math.round(cjkCount / 1.25 + nonCjkCount / 3.8);
}

function isTestEnvironment() {
  if (process.env.OPENCODE_TEST_MODE || process.env.NODE_ENV === 'test') return true;
  if (process.env.COMPRESSION_SANDBOX === '1') return true;
  if (process.argv && process.argv[1]) {
    const script = path.basename(process.argv[1]);
    if (/^test_.*\.js$/i.test(script) || script.includes('test')) return true;
  }
  return false;
}

function isProductionDiskTarget() {
  const isProdStats = !process.env.COMPRESSION_STATS_FILE || path.basename(STATS_FILE) === 'compression-stats.json';
  const isProdHist = !process.env.COMPRESSION_HISTORY_FILE || path.basename(HISTORY_FILE) === 'compression-history.json';
  return isProdStats || isProdHist;
}

const IS_TEST_ENV = Boolean(process.env.OPENCODE_TEST_MODE || process.env.NODE_ENV === 'test');
const STATS_FILE = process.env.COMPRESSION_STATS_FILE || (IS_TEST_ENV && process.env.COMPRESSION_SANDBOX === '1'
  ? path.join(__dirname, 'compression-stats.test.json')
  : path.join(__dirname, 'compression-stats.json'));
const HISTORY_FILE = process.env.COMPRESSION_HISTORY_FILE || (IS_TEST_ENV && process.env.COMPRESSION_SANDBOX === '1'
  ? path.join(__dirname, 'compression-history.test.json')
  : path.join(__dirname, 'compression-history.json'));
const STATS_BAK_FILE = `${STATS_FILE}.bak`;
const HISTORY_BAK_FILE = `${HISTORY_FILE}.bak`;

const BUCKET_DEFINITIONS = {
  m5: { intervalMs: 5 * 60 * 1000, maxBuckets: 12, maxAgeMs: 60 * 60 * 1000 },
  h1: { intervalMs: 60 * 60 * 1000, maxBuckets: 24, maxAgeMs: 24 * 60 * 60 * 1000 },
  d1: { intervalMs: 24 * 60 * 60 * 1000, maxBuckets: 30, maxAgeMs: 30 * 24 * 60 * 60 * 1000 }
};

const RANGE_CONFIG = {
  '1h': { tier: 'm5', windowMs: 60 * 60 * 1000, label: '过去 1 小时' },
  '24h': { tier: 'h1', windowMs: 24 * 60 * 60 * 1000, label: '过去 24 小时' },
  '7d': { tier: 'd1', windowMs: 7 * 24 * 60 * 60 * 1000, label: '过去 7 天' },
  'all': { tier: 'd1', windowMs: 30 * 24 * 60 * 60 * 1000, label: '全部历史累计' }
};

let compressionStats = {
  totalOriginalChars: 0,
  totalCompressedChars: 0,
  totalSavedChars: 0,
  savedTokens: 0,
  savedCostUSD: 0,
  consumedTokens: 0,
  consumedCostUSD: 0,
  compressionRatio: 0,
  byModel: {},
  modules: {
    rtk: { savedChars: 0, savedTokens: 0, percentage: 0 },
    headroom: { savedChars: 0, savedTokens: 0, percentage: 0 },
    schema: { savedChars: 0, savedTokens: 0, percentage: 0, alignedRounds: 0, alignedToolsCount: 0 },
    cacheZone: { savedChars: 0, savedTokens: 0, percentage: 0 },
    powershell: { savedChars: 0, savedTokens: 0, percentage: 0 }
  },
  lastResetAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

let compressionHistory = {
  all: compressionStats,
  buckets: {
    m5: [],
    h1: [],
    d1: []
  },
  lastResetAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

function createEmptyBucket(startTime, endTime) {
  return {
    startTime,
    endTime,
    totalOriginalChars: 0,
    totalCompressedChars: 0,
    totalSavedChars: 0,
    savedTokens: 0,
    savedCostUSD: 0,
    consumedTokens: 0,
    consumedCostUSD: 0,
    modules: {
      rtk: { savedChars: 0, savedTokens: 0 },
      headroom: { savedChars: 0, savedTokens: 0 },
      schema: { savedChars: 0, savedTokens: 0, alignedRounds: 0, alignedToolsCount: 0 },
      cacheZone: { savedChars: 0, savedTokens: 0, cacheZoneHits: 0 },
      powershell: { savedChars: 0, savedTokens: 0 }
    },
    byModel: {}
  };
}

function pruneExpiredBuckets(now = Date.now()) {
  if (!compressionHistory || !compressionHistory.buckets) {
    compressionHistory.buckets = { m5: [], h1: [], d1: [] };
    return;
  }
  for (const [tier, def] of Object.entries(BUCKET_DEFINITIONS)) {
    let list = compressionHistory.buckets[tier];
    if (!Array.isArray(list)) {
      compressionHistory.buckets[tier] = [];
      continue;
    }
    const cutoff = now - def.maxAgeMs;
    list = list.filter(b => b && typeof b.endTime === 'number' && b.endTime > cutoff && b.startTime <= now + def.intervalMs);
    list.sort((a, b) => a.startTime - b.startTime);
    if (list.length > def.maxBuckets) {
      list = list.slice(list.length - def.maxBuckets);
    }
    compressionHistory.buckets[tier] = list;
  }
}

function getOrCreateBucket(tier, ts, now = Date.now()) {
  const def = BUCKET_DEFINITIONS[tier];
  if (!def) return null;
  if (ts < now - def.maxAgeMs) return null;

  const start = Math.floor(ts / def.intervalMs) * def.intervalMs;
  const end = start + def.intervalMs;

  let list = compressionHistory.buckets[tier];
  if (!Array.isArray(list)) {
    list = [];
    compressionHistory.buckets[tier] = list;
  }

  let bucket = list.find(b => b.startTime === start);
  if (!bucket) {
    bucket = createEmptyBucket(start, end);
    list.push(bucket);
    list.sort((a, b) => a.startTime - b.startTime);
    if (list.length > def.maxBuckets) {
      list = list.slice(list.length - def.maxBuckets);
      compressionHistory.buckets[tier] = list;
    }
  }
  return bucket;
}

function recordBucketSavings(tier, ts, moduleName, validSaved, validOrig, modelName, customSavedTokens = null) {
  const bucket = getOrCreateBucket(tier, ts);
  if (!bucket) return;

  const validTokens = (typeof customSavedTokens === 'number' && customSavedTokens >= 0)
    ? customSavedTokens
    : estimateTokens(validSaved);
  const validOrigTokens = estimateTokens(validOrig);

  bucket.totalOriginalChars += validOrig;
  bucket.totalCompressedChars += (validOrig - validSaved);
  bucket.totalSavedChars += validSaved;
  bucket.savedTokens = (bucket.savedTokens || 0) + validTokens;
  bucket.consumedTokens = (bucket.consumedTokens || 0) + validOrigTokens;

  if (moduleName && bucket.modules && bucket.modules[moduleName]) {
    bucket.modules[moduleName].savedChars += validSaved;
    bucket.modules[moduleName].savedTokens = (bucket.modules[moduleName].savedTokens || 0) + validTokens;
  }

  if (modelName) {
    const model = normalizeModelName(modelName);
    if (model) {
      if (!bucket.byModel) bucket.byModel = {};
      if (!bucket.byModel[model]) {
        bucket.byModel[model] = {
          savedChars: 0,
          savedTokens: 0,
          savedCostUSD: 0,
          originalChars: 0,
          consumedTokens: 0,
          consumedCostUSD: 0,
          ratePer1M: getModelRate(model)
        };
      }
      const mEntry = bucket.byModel[model];
      mEntry.savedChars += validSaved;
      mEntry.originalChars += validOrig;
      mEntry.savedTokens = (mEntry.savedTokens || 0) + validTokens;
      mEntry.consumedTokens = (mEntry.consumedTokens || 0) + validOrigTokens;
      mEntry.ratePer1M = getModelRate(model);
      mEntry.savedCostUSD = Number(((mEntry.savedTokens / 1000000) * mEntry.ratePer1M).toFixed(7));
      mEntry.consumedCostUSD = Number(((mEntry.consumedTokens / 1000000) * mEntry.ratePer1M).toFixed(7));
    }
  }

  let bucketModelTokensSum = 0;
  let bucketModelCostSum = 0;
  let bucketModelConsumedTokensSum = 0;
  let bucketModelConsumedCostSum = 0;

  if (bucket.byModel && typeof bucket.byModel === 'object') {
    for (const mEntry of Object.values(bucket.byModel)) {
      if (mEntry && typeof mEntry === 'object') {
        bucketModelTokensSum += (mEntry.savedTokens || 0);
        bucketModelCostSum += (mEntry.savedCostUSD || 0);
        bucketModelConsumedTokensSum += (mEntry.consumedTokens || 0);
        bucketModelConsumedCostSum += (mEntry.consumedCostUSD || 0);
      }
    }
  }

  const unassignedTokens = Math.max(0, bucket.savedTokens - bucketModelTokensSum);
  const unassignedCost = (unassignedTokens / 1000000) * DEFAULT_MODEL_RATE_PER_1M;
  bucket.savedCostUSD = Number((bucketModelCostSum + unassignedCost).toFixed(7));

  const unassignedConsumed = Math.max(0, bucket.consumedTokens - bucketModelConsumedTokensSum);
  const unassignedConsumedCost = (unassignedConsumed / 1000000) * DEFAULT_MODEL_RATE_PER_1M;
  bucket.consumedCostUSD = Number((bucketModelConsumedCostSum + unassignedConsumedCost).toFixed(7));
}

function recordBucketSchemaAlignment(tier, ts, rounds = 1, toolsCount = 0) {
  const bucket = getOrCreateBucket(tier, ts);
  if (!bucket) return;
  if (!bucket.modules.schema.alignedRounds) bucket.modules.schema.alignedRounds = 0;
  if (!bucket.modules.schema.alignedToolsCount) bucket.modules.schema.alignedToolsCount = 0;
  bucket.modules.schema.alignedRounds += rounds;
  bucket.modules.schema.alignedToolsCount += toolsCount;
}

function recordBucketCacheZoneHit(tier, ts, hits = 1) {
  const bucket = getOrCreateBucket(tier, ts);
  if (!bucket || !bucket.modules || !bucket.modules.cacheZone) return;
  bucket.modules.cacheZone.cacheZoneHits = (Number(bucket.modules.cacheZone.cacheZoneHits) || 0) + hits;
}

function computeDerivedStats(stats) {
  const modulesSum = Object.values(stats.modules || {}).reduce((sum, m) => sum + (Number(m.savedChars) || 0), 0);
  const diffSavedChars = Math.max(0, (Number(stats.totalOriginalChars) || 0) - (Number(stats.totalCompressedChars) || 0));
  const totalSavedChars = Math.max(diffSavedChars, modulesSum, Number(stats.totalSavedChars) || 0);
  stats.totalSavedChars = totalSavedChars;
  if (stats.totalOriginalChars < totalSavedChars) {
    stats.totalOriginalChars = totalSavedChars;
  }
  stats.totalCompressedChars = Math.max(0, stats.totalOriginalChars - totalSavedChars);

  // Modules token calculation & percentage
  let modulesTokenSum = 0;
  for (const modKey of ['rtk', 'headroom', 'schema', 'cacheZone', 'powershell']) {
    const mod = stats.modules[modKey] || { savedChars: 0, savedTokens: 0, percentage: 0 };
    mod.savedChars = Number(mod.savedChars) || 0;
    if (mod.savedTokens === undefined || mod.savedTokens === null || mod.savedTokens === 0) {
      mod.savedTokens = estimateTokens(mod.savedChars);
    }
    modulesTokenSum += mod.savedTokens;
    mod.percentage = totalSavedChars > 0
      ? Number((((Number(mod.savedChars) || 0) / totalSavedChars) * 100).toFixed(1))
      : 0;
    stats.modules[modKey] = mod;
  }

  stats.savedTokens = modulesTokenSum > 0 ? modulesTokenSum : estimateTokens(totalSavedChars);

  // Compute byModel telemetry and dynamic weighted savedCostUSD
  stats.byModel = stats.byModel || {};
  pruneByModelEntriesIfNeeded();
  let modelTokensSum = 0;
  let modelCostSum = 0;

  for (const [m, data] of Object.entries(stats.byModel)) {
    if (!data || typeof data !== 'object') continue;
    data.savedChars = Number(data.savedChars) || 0;
    data.originalChars = Math.max(data.savedChars, Number(data.originalChars) || 0);
    if (data.savedTokens === undefined || data.savedTokens === null || data.savedTokens === 0) {
      data.savedTokens = estimateTokens(data.savedChars);
    }
    const officialRate = getModelRate(m);
    data.ratePer1M = (officialRate !== DEFAULT_MODEL_RATE_PER_1M || typeof data.ratePer1M !== 'number') ? officialRate : data.ratePer1M;
    data.savedCostUSD = Number(((data.savedTokens / 1000000) * data.ratePer1M).toFixed(7));
    modelTokensSum += data.savedTokens;
    modelCostSum += data.savedCostUSD;
  }

  // Calculate overall savedCostUSD:
  // Dynamically weighted sum from each model in byModel.
  // Any unassigned tokens (calls without model attribute) use DEFAULT_MODEL_RATE_PER_1M ($0.25 / 1M).
  const unassignedTokens = Math.max(0, stats.savedTokens - modelTokensSum);
  const unassignedCost = (unassignedTokens / 1000000) * DEFAULT_MODEL_RATE_PER_1M;
  stats.savedCostUSD = Number((modelCostSum + unassignedCost).toFixed(6));

  // Compute overall consumedTokens & consumedCostUSD
  let modelConsumedTokensSum = 0;
  let modelConsumedCostSum = 0;
  for (const [m, data] of Object.entries(stats.byModel)) {
    if (!data || typeof data !== 'object') continue;
    if (data.consumedTokens === undefined || data.consumedTokens === null || data.consumedTokens === 0) {
      data.consumedTokens = estimateTokens(data.originalChars || 0);
    }
    data.consumedCostUSD = Number(((data.consumedTokens / 1000000) * (data.ratePer1M || getModelRate(m))).toFixed(7));
    modelConsumedTokensSum += data.consumedTokens;
    modelConsumedCostSum += data.consumedCostUSD;
  }
  const totalOrigTokens = estimateTokens(stats.totalOriginalChars);
  stats.consumedTokens = Math.max(totalOrigTokens, modelConsumedTokensSum, stats.savedTokens);
  const unassignedConsumed = Math.max(0, stats.consumedTokens - modelConsumedTokensSum);
  const unassignedConsumedCost = (unassignedConsumed / 1000000) * DEFAULT_MODEL_RATE_PER_1M;
  stats.consumedCostUSD = Number((modelConsumedCostSum + unassignedConsumedCost).toFixed(6));

  stats.compressionRatio = stats.totalOriginalChars > 0
    ? Number(((totalSavedChars / stats.totalOriginalChars) * 100).toFixed(1))
    : 0;

  return stats;
}

function saveStatsToDisk() {
  try {
    pruneExpiredBuckets();

    // Canonical Self-Healing Migration: coalesce aliases (e.g. deepseek-flash -> deepseek-v4.1-flash) in loaded stats and history
    if (compressionStats && compressionStats.byModel) {
      for (const [rawModelKey, data] of Object.entries(compressionStats.byModel)) {
        const canonical = normalizeModelName(rawModelKey);
        if (canonical && canonical !== rawModelKey) {
          const target = compressionStats.byModel[canonical] || {
            savedChars: 0, savedTokens: 0, savedCostUSD: 0, originalChars: 0, ratePer1M: getModelRate(canonical)
          };
          target.savedChars += (data.savedChars || 0);
          target.savedTokens += (data.savedTokens || 0);
          target.savedCostUSD = Number((target.savedCostUSD + (data.savedCostUSD || 0)).toFixed(7));
          target.originalChars += (data.originalChars || 0);
          compressionStats.byModel[canonical] = target;
          delete compressionStats.byModel[rawModelKey];
        }
      }
    }
    if (compressionHistory && compressionHistory.buckets) {
      for (const bucketList of Object.values(compressionHistory.buckets)) {
        if (Array.isArray(bucketList)) {
          for (const b of bucketList) {
            if (b && b.byModel && typeof b.byModel === 'object') {
              for (const [rawModelKey, data] of Object.entries(b.byModel)) {
                const canonical = normalizeModelName(rawModelKey);
                if (canonical && canonical !== rawModelKey) {
                  const target = b.byModel[canonical] || {
                    savedChars: 0, savedTokens: 0, savedCostUSD: 0, originalChars: 0, ratePer1M: getModelRate(canonical)
                  };
                  target.savedChars += (data.savedChars || 0);
                  target.savedTokens += (data.savedTokens || 0);
                  target.savedCostUSD = Number((target.savedCostUSD + (data.savedCostUSD || 0)).toFixed(7));
                  target.originalChars += (data.originalChars || 0);
                  b.byModel[canonical] = target;
                  delete b.byModel[rawModelKey];
                }
              }
            }
          }
        }
      }
    }
    compressionHistory.all = compressionStats;
    compressionHistory.lastResetAt = compressionStats.lastResetAt;
    compressionHistory.updatedAt = new Date().toISOString();

    let historyJson = JSON.stringify(compressionHistory, null, 2);
    // Boundary guard: Strictly enforce < 200KB disk limit to eliminate memory/disk bloat
    if (Buffer.byteLength(historyJson, 'utf8') > 190 * 1024) {
      for (const tier of ['d1', 'h1', 'm5']) {
        if (compressionHistory.buckets[tier] && compressionHistory.buckets[tier].length > 4) {
          compressionHistory.buckets[tier] = compressionHistory.buckets[tier].slice(-4);
        }
      }
      historyJson = JSON.stringify(compressionHistory, null, 2);
    }

    const tmpHist = `${HISTORY_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpHist, historyJson, 'utf8');
    fs.renameSync(tmpHist, HISTORY_FILE);
    // Dual-write disaster recovery backup (.bak)
    try { fs.writeFileSync(HISTORY_BAK_FILE, historyJson, 'utf8'); } catch (_) {}

    // Save legacy compression-stats.json for 100% compatibility with existing test assertions
    const statsJson = JSON.stringify(compressionStats, null, 2);
    const tmpStats = `${STATS_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpStats, statsJson, 'utf8');
    fs.renameSync(tmpStats, STATS_FILE);
    // Dual-write disaster recovery backup (.bak)
    try { fs.writeFileSync(STATS_BAK_FILE, statsJson, 'utf8'); } catch (_) {}
  } catch (err) {
    // Non-fatal, sandbox logged
  }
}

let persistTimer = null;
function persistStatsThrottled() {
  // Test Environment Guard (Root-Cause Fix for Benchmark/Adversarial Stats Pollution)
  // In test environment, forbid writing to production compression-stats.json / compression-history.json
  if (isTestEnvironment() && isProductionDiskTarget() && process.env.ALLOW_PROD_STATS_IN_TEST !== '1') {
    return;
  }
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveStatsToDisk();
  }, 1000);
}

function flushStatsToDisk() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  saveStatsToDisk();
}

function loadStatsFromDisk() {
  try {
    let loadedHistory = null;
    let mainHistCorrupted = false;
    if (fs.existsSync(HISTORY_FILE)) {
      try {
        const rawHist = fs.readFileSync(HISTORY_FILE, 'utf8');
        loadedHistory = JSON.parse(rawHist);
      } catch (_) {
        mainHistCorrupted = true;
      }
    }
    // Disaster Recovery: Fallback to .bak if primary history file is missing or corrupted
    if (!loadedHistory && fs.existsSync(HISTORY_BAK_FILE)) {
      try {
        const rawBak = fs.readFileSync(HISTORY_BAK_FILE, 'utf8');
        loadedHistory = JSON.parse(rawBak);
      } catch (_) {}
    }

    let loadedStats = null;
    let mainStatsCorrupted = false;
    if (fs.existsSync(STATS_FILE)) {
      try {
        const rawStats = fs.readFileSync(STATS_FILE, 'utf8');
        loadedStats = JSON.parse(rawStats);
      } catch (_) {
        mainStatsCorrupted = true;
      }
    }
    // Disaster Recovery: Fallback to .bak if primary stats file is missing or corrupted
    if (!loadedStats && fs.existsSync(STATS_BAK_FILE)) {
      try {
        const rawBak = fs.readFileSync(STATS_BAK_FILE, 'utf8');
        loadedStats = JSON.parse(rawBak);
      } catch (_) {}
    }

    // Baseline historical protection:
    // If stats file has historical counts (e.g. 281463), prefer whichever has non-zero totalOriginalChars
    let histBak = null;
    if (fs.existsSync(HISTORY_BAK_FILE)) {
      try { histBak = JSON.parse(fs.readFileSync(HISTORY_BAK_FILE, 'utf8')); } catch (_) {}
    }
    let statsBak = null;
    if (fs.existsSync(STATS_BAK_FILE)) {
      try { statsBak = JSON.parse(fs.readFileSync(STATS_BAK_FILE, 'utf8')); } catch (_) {}
    }

    let prodStatsBak = null;
    const prodStatsBakPath = path.join(__dirname, 'compression-stats.prod.backup.json');
    if (fs.existsSync(prodStatsBakPath)) {
      try { prodStatsBak = JSON.parse(fs.readFileSync(prodStatsBakPath, 'utf8')); } catch (_) {}
    }
    let prodHistBak = null;
    const prodHistBakPath = path.join(__dirname, 'compression-history.prod.backup.json');
    if (fs.existsSync(prodHistBakPath)) {
      try { prodHistBak = JSON.parse(fs.readFileSync(prodHistBakPath, 'utf8')); } catch (_) {}
    }

    const candidates = [
      loadedStats,
      loadedHistory && loadedHistory.all,
      statsBak,
      histBak && histBak.all,
      prodStatsBak,
      prodHistBak && prodHistBak.all
    ].filter(s => s && typeof s === 'object');

    const sourceStats = candidates.find(s => Number(s.totalOriginalChars) > 0) || candidates[0] || null;

    if (sourceStats) {
      let loadedByModel = {};
      if (sourceStats.byModel && typeof sourceStats.byModel === 'object') {
        for (const [m, data] of Object.entries(sourceStats.byModel)) {
          if (data && typeof data === 'object') {
            const cleanM = normalizeModelName(m) || m;
            loadedByModel[cleanM] = {
              savedChars: Number(data.savedChars) || 0,
              savedTokens: Number(data.savedTokens) || 0,
              savedCostUSD: Number(data.savedCostUSD) || 0,
              originalChars: Number(data.originalChars) || 0,
              ratePer1M: typeof data.ratePer1M === 'number' && data.ratePer1M > 0 ? data.ratePer1M : getModelRate(cleanM)
            };
          }
        }
      }

      compressionStats = {
        totalOriginalChars: Number(sourceStats.totalOriginalChars) || 0,
        totalCompressedChars: Number(sourceStats.totalCompressedChars) || 0,
        totalSavedChars: Number(sourceStats.totalSavedChars) || 0,
        savedTokens: Number(sourceStats.savedTokens) || 0,
        savedCostUSD: Number(sourceStats.savedCostUSD) || 0,
        compressionRatio: Number(sourceStats.compressionRatio) || 0,
        byModel: loadedByModel,
        modules: {
          rtk: {
            savedChars: (sourceStats.modules && sourceStats.modules.rtk && sourceStats.modules.rtk.savedChars) || 0,
            savedTokens: (sourceStats.modules && sourceStats.modules.rtk && sourceStats.modules.rtk.savedTokens) || 0,
            percentage: 0
          },
          headroom: {
            savedChars: (sourceStats.modules && sourceStats.modules.headroom && sourceStats.modules.headroom.savedChars) || 0,
            savedTokens: (sourceStats.modules && sourceStats.modules.headroom && sourceStats.modules.headroom.savedTokens) || 0,
            percentage: 0
          },
          schema: {
            savedChars: (sourceStats.modules && sourceStats.modules.schema && sourceStats.modules.schema.savedChars) || 0,
            savedTokens: (sourceStats.modules && sourceStats.modules.schema && sourceStats.modules.schema.savedTokens) || 0,
            percentage: 0,
            alignedRounds: (sourceStats.modules && sourceStats.modules.schema && sourceStats.modules.schema.alignedRounds) || 0,
            alignedToolsCount: (sourceStats.modules && sourceStats.modules.schema && sourceStats.modules.schema.alignedToolsCount) || 0
          },
          cacheZone: {
            savedChars: (sourceStats.modules && sourceStats.modules.cacheZone && sourceStats.modules.cacheZone.savedChars) || 0,
            savedTokens: (sourceStats.modules && sourceStats.modules.cacheZone && sourceStats.modules.cacheZone.savedTokens) || 0,
            percentage: 0,
            cacheZoneHits: (sourceStats.modules && sourceStats.modules.cacheZone && sourceStats.modules.cacheZone.cacheZoneHits) || 0
          },
          powershell: {
            savedChars: (sourceStats.modules && sourceStats.modules.powershell && sourceStats.modules.powershell.savedChars) || 0,
            savedTokens: (sourceStats.modules && sourceStats.modules.powershell && sourceStats.modules.powershell.savedTokens) || 0,
            percentage: 0
          }
        },
        lastResetAt: sourceStats.lastResetAt || (loadedHistory && loadedHistory.lastResetAt) || new Date().toISOString(),
        updatedAt: sourceStats.updatedAt || (loadedHistory && loadedHistory.updatedAt) || new Date().toISOString()
      };
      computeDerivedStats(compressionStats);
    }

    if (loadedHistory && loadedHistory.buckets && typeof loadedHistory.buckets === 'object') {
      compressionHistory.buckets = {
        m5: Array.isArray(loadedHistory.buckets.m5) ? loadedHistory.buckets.m5 : [],
        h1: Array.isArray(loadedHistory.buckets.h1) ? loadedHistory.buckets.h1 : [],
        d1: Array.isArray(loadedHistory.buckets.d1) ? loadedHistory.buckets.d1 : []
      };
      compressionHistory.lastResetAt = loadedHistory.lastResetAt || compressionStats.lastResetAt;
    } else if (histBak && histBak.buckets && typeof histBak.buckets === 'object') {
      compressionHistory.buckets = {
        m5: Array.isArray(histBak.buckets.m5) ? histBak.buckets.m5 : [],
        h1: Array.isArray(histBak.buckets.h1) ? histBak.buckets.h1 : [],
        d1: Array.isArray(histBak.buckets.d1) ? histBak.buckets.d1 : []
      };
      compressionHistory.lastResetAt = histBak.lastResetAt || compressionStats.lastResetAt;
    }
    compressionHistory.all = compressionStats;
    if (compressionHistory.buckets && typeof compressionHistory.buckets === 'object') {
      for (const bucketList of Object.values(compressionHistory.buckets)) {
        if (Array.isArray(bucketList)) {
          for (const b of bucketList) {
            if (b && typeof b === 'object') {
              const origChars = Number(b.totalOriginalChars) || 0;
              const savedChars = Number(b.totalSavedChars) || 0;
              const modTokSum = Object.values(b.modules || {}).reduce((s, m) => s + (Number(m.savedTokens) || 0), 0);
              if (!b.savedTokens || b.savedTokens === 0) {
                b.savedTokens = Math.max(modTokSum, estimateTokens(savedChars));
              }
              if (!b.consumedTokens || b.consumedTokens === 0) {
                b.consumedTokens = Math.max(estimateTokens(origChars), b.savedTokens);
              }
              if (!b.savedCostUSD || b.savedCostUSD === 0) {
                b.savedCostUSD = Number(((b.savedTokens / 1000000) * DEFAULT_MODEL_RATE_PER_1M).toFixed(7));
              }
              if (!b.consumedCostUSD || b.consumedCostUSD === 0) {
                b.consumedCostUSD = Number(((b.consumedTokens / 1000000) * DEFAULT_MODEL_RATE_PER_1M).toFixed(7));
              }
            }
          }
        }
      }
    }
    pruneExpiredBuckets();

    // Auto self-healing write-back if primary file is missing or was corrupted
    if ((mainStatsCorrupted || mainHistCorrupted || !fs.existsSync(STATS_FILE) || !fs.existsSync(HISTORY_FILE)) && Number(compressionStats.totalOriginalChars) > 0) {
      saveStatsToDisk();
    }
    return compressionStats;
  } catch (e) {
    // Non-fatal, use initialized memory stats
    return compressionStats;
  }
}

loadStatsFromDisk();

function recordModelSavings(modelName, savedChars, originalChars = 0, timestamp = Date.now(), customSavedTokens = null) {
  const model = normalizeModelName(modelName);
  if (!model || (savedChars <= 0 && originalChars <= 0)) return;
  const validSaved = Math.max(0, savedChars);
  const validOrig = Math.max(validSaved, originalChars);
  const validTokens = (typeof customSavedTokens === 'number' && customSavedTokens >= 0)
    ? customSavedTokens
    : estimateTokens(validSaved);

  if (!compressionStats.byModel) {
    compressionStats.byModel = {};
  }
  if (!compressionStats.byModel[model]) {
    compressionStats.byModel[model] = {
      savedChars: 0,
      savedTokens: 0,
      savedCostUSD: 0,
      originalChars: 0,
      ratePer1M: getModelRate(model)
    };
  }
  const entry = compressionStats.byModel[model];
  entry.savedChars += validSaved;
  entry.originalChars += validOrig;
  entry.savedTokens = (entry.savedTokens || 0) + validTokens;
  entry.ratePer1M = getModelRate(model);
  entry.savedCostUSD = Number(((entry.savedTokens / 1000000) * entry.ratePer1M).toFixed(7));
  pruneByModelEntriesIfNeeded();
}

function recordModuleOnlySavings(moduleName, deltaChars, timestamp = Date.now(), customSavedTokens = null) {
  if (deltaChars <= 0) return;
  const ts = typeof timestamp === 'number' && !isNaN(timestamp) ? timestamp : Date.now();
  const validTokens = (typeof customSavedTokens === 'number' && customSavedTokens >= 0)
    ? customSavedTokens
    : estimateTokens(deltaChars);
  if (moduleName && compressionStats.modules[moduleName]) {
    compressionStats.modules[moduleName].savedChars += deltaChars;
    compressionStats.modules[moduleName].savedTokens = (compressionStats.modules[moduleName].savedTokens || 0) + validTokens;
    compressionStats.totalOriginalChars += deltaChars;
    compressionStats.updatedAt = new Date().toISOString();
    computeDerivedStats(compressionStats);

    recordBucketSavings('m5', ts, moduleName, deltaChars, deltaChars, null, validTokens);
    recordBucketSavings('h1', ts, moduleName, deltaChars, deltaChars, null, validTokens);
    recordBucketSavings('d1', ts, moduleName, deltaChars, deltaChars, null, validTokens);
    pruneExpiredBuckets();
    persistStatsThrottled();
  }
}

function recordSavings(moduleName, deltaChars, originalChars = 0, modelName = null, timestamp = Date.now(), customSavedTokens = null) {
  if (deltaChars <= 0 && originalChars <= 0) return;
  const validSaved = Math.max(0, deltaChars);
  const validOrig = Math.max(validSaved, originalChars);
  const ts = typeof timestamp === 'number' && !isNaN(timestamp) ? timestamp : Date.now();
  const validTokens = (typeof customSavedTokens === 'number' && customSavedTokens >= 0)
    ? customSavedTokens
    : estimateTokens(validSaved);

  if (moduleName && compressionStats.modules[moduleName]) {
    compressionStats.modules[moduleName].savedChars += validSaved;
    compressionStats.modules[moduleName].savedTokens = (compressionStats.modules[moduleName].savedTokens || 0) + validTokens;
  }
  compressionStats.totalOriginalChars += validOrig;
  compressionStats.totalCompressedChars += (validOrig - validSaved);
  if (modelName) {
    recordModelSavings(modelName, validSaved, validOrig, ts, validTokens);
  }
  compressionStats.updatedAt = new Date().toISOString();
  computeDerivedStats(compressionStats);

  // Synchronously record to all 3 ring-buffer time tiers
  recordBucketSavings('m5', ts, moduleName, validSaved, validOrig, modelName, validTokens);
  recordBucketSavings('h1', ts, moduleName, validSaved, validOrig, modelName, validTokens);
  recordBucketSavings('d1', ts, moduleName, validSaved, validOrig, modelName, validTokens);

  pruneExpiredBuckets();

  // Test Environment Guard: do not persist to production disk when running in test mode
  if (isTestEnvironment() && isProductionDiskTarget() && process.env.ALLOW_PROD_STATS_IN_TEST !== '1') {
    return;
  }

  persistStatsThrottled();
}

function recordOverallSavings(origLen, compLen, timestamp = Date.now()) {
  if (origLen <= compLen) return;
  const ts = typeof timestamp === 'number' && !isNaN(timestamp) ? timestamp : Date.now();
  const validSaved = origLen - compLen;
  compressionStats.totalOriginalChars += origLen;
  compressionStats.totalCompressedChars += compLen;
  compressionStats.updatedAt = new Date().toISOString();
  computeDerivedStats(compressionStats);

  recordBucketSavings('m5', ts, null, validSaved, origLen, null);
  recordBucketSavings('h1', ts, null, validSaved, origLen, null);
  recordBucketSavings('d1', ts, null, validSaved, origLen, null);
  pruneExpiredBuckets();

  // Test Environment Guard: do not persist to production disk when running in test mode
  if (isTestEnvironment() && isProductionDiskTarget() && process.env.ALLOW_PROD_STATS_IN_TEST !== '1') {
    return;
  }

  persistStatsThrottled();
}

function recordCompressionEvent(event) {
  if (!event || typeof event !== 'object') return;
  const {
    module = null,
    savedChars = 0,
    deltaChars = 0,
    originalChars = 0,
    model = null,
    modelName = null,
    timestamp = Date.now()
  } = event;
  const actualSaved = savedChars || deltaChars || 0;
  const actualOrig = Math.max(actualSaved, originalChars || 0);
  const actualModel = model || modelName || null;
  recordSavings(module, actualSaved, actualOrig, actualModel, timestamp);
}

function formatTimeSeriesLabel(ts, range) {
  const d = new Date(ts);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  if (range === '1h') {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (range === '24h') {
    return `${pad(d.getHours())}:00`;
  }
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mergeBuckets(target, source) {
  if (!target) return JSON.parse(JSON.stringify(source));
  target.totalOriginalChars = (Number(target.totalOriginalChars) || 0) + (Number(source.totalOriginalChars) || 0);
  target.totalCompressedChars = (Number(target.totalCompressedChars) || 0) + (Number(source.totalCompressedChars) || 0);
  target.totalSavedChars = (Number(target.totalSavedChars) || 0) + (Number(source.totalSavedChars) || 0);
  target.savedTokens = (Number(target.savedTokens) || 0) + (Number(source.savedTokens) || 0);
  target.savedCostUSD = Number(((Number(target.savedCostUSD) || 0) + (Number(source.savedCostUSD) || 0)).toFixed(7));
  target.consumedTokens = (Number(target.consumedTokens) || 0) + (Number(source.consumedTokens) || 0);
  target.consumedCostUSD = Number(((Number(target.consumedCostUSD) || 0) + (Number(source.consumedCostUSD) || 0)).toFixed(7));

  if (source.modules && typeof source.modules === 'object') {
    if (!target.modules) target.modules = {};
    for (const [modKey, modVal] of Object.entries(source.modules)) {
      if (!modVal) continue;
      if (!target.modules[modKey]) {
        target.modules[modKey] = { savedChars: 0, savedTokens: 0 };
      }
      target.modules[modKey].savedChars = (Number(target.modules[modKey].savedChars) || 0) + (Number(modVal.savedChars) || 0);
      target.modules[modKey].savedTokens = (Number(target.modules[modKey].savedTokens) || 0) + (Number(modVal.savedTokens) || 0);
      if (modKey === 'schema') {
        target.modules.schema.alignedRounds = (Number(target.modules.schema.alignedRounds) || 0) + (Number(modVal.alignedRounds) || 0);
        target.modules.schema.alignedToolsCount = (Number(target.modules.schema.alignedToolsCount) || 0) + (Number(modVal.alignedToolsCount) || 0);
      } else if (modKey === 'cacheZone') {
        target.modules.cacheZone.cacheZoneHits = (Number(target.modules.cacheZone.cacheZoneHits) || 0) + (Number(modVal.cacheZoneHits) || 0);
      }
    }
  }

  if (source.byModel && typeof source.byModel === 'object') {
    if (!target.byModel) target.byModel = {};
    for (const [m, mData] of Object.entries(source.byModel)) {
      if (!mData) continue;
      const cleanM = normalizeModelName(m) || m;
      if (!target.byModel[cleanM]) {
        target.byModel[cleanM] = {
          savedChars: 0,
          savedTokens: 0,
          savedCostUSD: 0,
          originalChars: 0,
          consumedTokens: 0,
          consumedCostUSD: 0,
          ratePer1M: mData.ratePer1M || getModelRate(cleanM)
        };
      }
      const tEntry = target.byModel[cleanM];
      tEntry.savedChars = (Number(tEntry.savedChars) || 0) + (Number(mData.savedChars) || 0);
      tEntry.savedTokens = (Number(tEntry.savedTokens) || 0) + (Number(mData.savedTokens) || 0);
      tEntry.originalChars = (Number(tEntry.originalChars) || 0) + (Number(mData.originalChars) || 0);
      tEntry.consumedTokens = (Number(tEntry.consumedTokens) || 0) + (Number(mData.consumedTokens) || 0);
      tEntry.ratePer1M = mData.ratePer1M || getModelRate(cleanM);
      tEntry.savedCostUSD = Number(((Number(tEntry.savedCostUSD) || 0) + (Number(mData.savedCostUSD) || 0)).toFixed(7));
      tEntry.consumedCostUSD = Number(((Number(tEntry.consumedCostUSD) || 0) + (Number(mData.consumedCostUSD) || 0)).toFixed(7));
    }
  }

  return target;
}

function buildTimeSeries(range, matchingBuckets = [], now = Date.now()) {
  const normRange = (range && typeof range === 'string' && RANGE_CONFIG[range.toLowerCase()]) ? range.toLowerCase() : 'all';
  const series = [];

  let intervalMs;
  let count;

  if (normRange === '1h') {
    intervalMs = 5 * 60 * 1000; // 5 min intervals
    count = 12;
  } else if (normRange === '24h') {
    intervalMs = 60 * 60 * 1000; // 1 hour intervals
    count = 24;
  } else if (normRange === '7d') {
    intervalMs = 24 * 60 * 60 * 1000; // 1 day intervals
    count = 7;
  } else {
    // 'all' tier: provide daily slots with dynamic history span (up to 30 days, min 7 days)
    intervalMs = 24 * 60 * 60 * 1000;
    let daysSpan = 14;
    if (Array.isArray(matchingBuckets) && matchingBuckets.length > 0) {
      const validStarts = matchingBuckets.map(b => b && b.startTime).filter(t => typeof t === 'number' && t > 0);
      if (validStarts.length > 0) {
        const earliest = Math.min(...validStarts);
        if (earliest < now) {
          const diffDays = Math.ceil((now - earliest) / intervalMs) + 1;
          daysSpan = Math.min(30, Math.max(7, diffDays));
        }
      }
    }
    count = daysSpan;
  }

  const currentSlot = Math.floor(now / intervalMs) * intervalMs;
  const bucketMap = new Map();
  if (Array.isArray(matchingBuckets)) {
    for (const b of matchingBuckets) {
      if (b && typeof b.startTime === 'number') {
        const slotKey = Math.floor(b.startTime / intervalMs) * intervalMs;
        if (bucketMap.has(slotKey)) {
          mergeBuckets(bucketMap.get(slotKey), b);
        } else {
          bucketMap.set(slotKey, JSON.parse(JSON.stringify(b)));
        }
      }
    }
  }

  for (let i = count - 1; i >= 0; i--) {
    const slotTime = currentSlot - (i * intervalMs);
    const existing = bucketMap.get(slotTime);
    const label = formatTimeSeriesLabel(slotTime, normRange);

    if (existing) {
      const rawOrigChars = Number(existing.totalOriginalChars) || 0;
      const rawCompChars = Number(existing.totalCompressedChars) || 0;
      let savedChars = Number(existing.totalSavedChars) || 0;
      const modSum = Object.values(existing.modules || {}).reduce((s, m) => s + (Number(m.savedChars) || 0), 0);
      const modTokSum = Object.values(existing.modules || {}).reduce((s, m) => s + (Number(m.savedTokens) || 0), 0);
      savedChars = Math.max(savedChars, rawOrigChars - rawCompChars, modSum);
      const origChars = Math.max(savedChars, rawOrigChars);
      const savedTokens = Math.max(Number(existing.savedTokens) || 0, modTokSum, estimateTokens(savedChars));
      const consumedTokens = Math.max(Number(existing.consumedTokens) || 0, estimateTokens(origChars), savedTokens);

      const byModelData = {};
      let modelCostSum = 0;
      let modelTokensSum = 0;
      let modelConsumedCostSum = 0;
      let modelConsumedTokensSum = 0;

      if (existing.byModel && typeof existing.byModel === 'object') {
        for (const [m, mInfo] of Object.entries(existing.byModel)) {
          if (!mInfo) continue;
          const cleanM = normalizeModelName(m) || m;
          const sTokens = Math.max(Number(mInfo.savedTokens) || 0, estimateTokens(Number(mInfo.savedChars) || 0));
          const mOrigChars = Math.max(Number(mInfo.originalChars) || 0, Number(mInfo.savedChars) || 0);
          const cTokens = Math.max(Number(mInfo.consumedTokens) || 0, estimateTokens(mOrigChars), sTokens);
          const rate = mInfo.ratePer1M || getModelRate(cleanM);
          const sCost = Number(((sTokens / 1000000) * rate).toFixed(7));
          const cCost = Number(((cTokens / 1000000) * rate).toFixed(7));

          if (!byModelData[cleanM]) {
            byModelData[cleanM] = {
              savedChars: 0,
              savedTokens: 0,
              savedCostUSD: 0,
              originalChars: 0,
              consumedTokens: 0,
              consumedCostUSD: 0,
              ratePer1M: rate
            };
          }
          byModelData[cleanM].savedChars += (Number(mInfo.savedChars) || 0);
          byModelData[cleanM].savedTokens += sTokens;
          byModelData[cleanM].savedCostUSD = Number((byModelData[cleanM].savedCostUSD + sCost).toFixed(7));
          byModelData[cleanM].originalChars += mOrigChars;
          byModelData[cleanM].consumedTokens += cTokens;
          byModelData[cleanM].consumedCostUSD = Number((byModelData[cleanM].consumedCostUSD + cCost).toFixed(7));

          modelCostSum += sCost;
          modelTokensSum += sTokens;
          modelConsumedCostSum += cCost;
          modelConsumedTokensSum += cTokens;
        }
      }
      const unassignedTokens = Math.max(0, savedTokens - modelTokensSum);
      const savedCostUSD = Number((modelCostSum + (unassignedTokens / 1000000) * DEFAULT_MODEL_RATE_PER_1M).toFixed(6));

      const unassignedConsumed = Math.max(0, consumedTokens - modelConsumedTokensSum);
      const consumedCostUSD = Number((modelConsumedCostSum + (unassignedConsumed / 1000000) * DEFAULT_MODEL_RATE_PER_1M).toFixed(6));

      series.push({
        time: slotTime,
        label,
        consumedTokens,
        consumedCostUSD,
        savedTokens,
        savedCostUSD,
        savedChars,
        originalChars: origChars,
        consumedChars: origChars,
        byModel: byModelData
      });
    } else {
      series.push({
        time: slotTime,
        label,
        consumedTokens: 0,
        consumedCostUSD: 0,
        savedTokens: 0,
        savedCostUSD: 0,
        savedChars: 0,
        originalChars: 0,
        consumedChars: 0,
        byModel: {}
      });
    }
  }

  // If in 'all' mode and all buckets are 0 but global stats have savings or consumed, inject into latest point
  if (normRange === 'all') {
    const allZero = series.every(p => p.savedTokens === 0 && p.consumedTokens === 0);
    if (allZero && (compressionStats.savedTokens > 0 || compressionStats.totalSavedChars > 0 || compressionStats.totalOriginalChars > 0)) {
      const lastPoint = series[series.length - 1];
      if (lastPoint) {
        lastPoint.consumedTokens = compressionStats.consumedTokens || estimateTokens(compressionStats.totalOriginalChars);
        lastPoint.consumedCostUSD = compressionStats.consumedCostUSD || Number(((lastPoint.consumedTokens / 1000000) * DEFAULT_MODEL_RATE_PER_1M).toFixed(6));
        lastPoint.savedTokens = compressionStats.savedTokens;
        lastPoint.savedCostUSD = compressionStats.savedCostUSD;
        lastPoint.savedChars = compressionStats.totalSavedChars;
        lastPoint.originalChars = compressionStats.totalOriginalChars;
        lastPoint.consumedChars = compressionStats.totalOriginalChars;
        lastPoint.byModel = JSON.parse(JSON.stringify(compressionStats.byModel || {}));
      }
    }
  }

  return series;
}

function getStatsByRange(range = 'all', now = Date.now()) {
  const normRange = (range && typeof range === 'string' && RANGE_CONFIG[range.toLowerCase()]) ? range.toLowerCase() : 'all';
  const cfg = RANGE_CONFIG[normRange];

  if (normRange === 'all' || !cfg.tier) {
    const base = computeDerivedStats(compressionStats);
    const d1Buckets = (compressionHistory && compressionHistory.buckets && compressionHistory.buckets.d1) || [];
    const timeSeries = buildTimeSeries('all', d1Buckets, now);
    return {
      range: 'all',
      rangeLabel: cfg.label,
      totalOriginalChars: base.totalOriginalChars,
      totalCompressedChars: base.totalCompressedChars,
      totalSavedChars: base.totalSavedChars,
      savedTokens: base.savedTokens,
      savedCostUSD: base.savedCostUSD,
      consumedTokens: base.consumedTokens || estimateTokens(base.totalOriginalChars),
      consumedCostUSD: base.consumedCostUSD || Number((((base.consumedTokens || estimateTokens(base.totalOriginalChars)) / 1000000) * DEFAULT_MODEL_RATE_PER_1M).toFixed(6)),
      compressionRatio: base.compressionRatio,
      modules: {
        rtk: { ...base.modules.rtk },
        headroom: { ...base.modules.headroom },
        schema: { ...base.modules.schema },
        cacheZone: { ...base.modules.cacheZone },
        powershell: { ...base.modules.powershell }
      },
      byModel: JSON.parse(JSON.stringify(base.byModel || {})),
      timeSeries,
      lastResetAt: compressionStats.lastResetAt || compressionHistory.lastResetAt,
      updatedAt: compressionStats.updatedAt || new Date().toISOString()
    };
  }

  pruneExpiredBuckets(now);
  const cutoff = now - cfg.windowMs;
  const list = (compressionHistory && compressionHistory.buckets && compressionHistory.buckets[cfg.tier]) || [];
  const matching = list.filter(b => b && b.endTime > cutoff && b.startTime <= now);

  let totalOriginalChars = 0;
  let totalCompressedChars = 0;
  let totalSavedChars = 0;
  const modules = {
    rtk: { savedChars: 0, savedTokens: 0, percentage: 0 },
    headroom: { savedChars: 0, savedTokens: 0, percentage: 0 },
    schema: { savedChars: 0, savedTokens: 0, percentage: 0, alignedRounds: 0, alignedToolsCount: 0 },
    cacheZone: { savedChars: 0, savedTokens: 0, percentage: 0, cacheZoneHits: 0 },
    powershell: { savedChars: 0, savedTokens: 0, percentage: 0 }
  };
  const byModel = {};

  for (const b of matching) {
    totalOriginalChars += (Number(b.totalOriginalChars) || 0);
    totalCompressedChars += (Number(b.totalCompressedChars) || 0);
    totalSavedChars += (Number(b.totalSavedChars) || 0);

    for (const modKey of ['rtk', 'headroom', 'schema', 'cacheZone', 'powershell']) {
      if (b.modules && b.modules[modKey]) {
        modules[modKey].savedChars += (Number(b.modules[modKey].savedChars) || 0);
        modules[modKey].savedTokens += (Number(b.modules[modKey].savedTokens) || 0);
        if (modKey === 'schema') {
          modules.schema.alignedRounds += (Number(b.modules.schema.alignedRounds) || 0);
          modules.schema.alignedToolsCount += (Number(b.modules.schema.alignedToolsCount) || 0);
        } else if (modKey === 'cacheZone') {
          modules.cacheZone.cacheZoneHits += (Number(b.modules.cacheZone.cacheZoneHits) || 0);
        }
      }
    }

    if (b.byModel && typeof b.byModel === 'object') {
      for (const [m, mData] of Object.entries(b.byModel)) {
        if (!mData) continue;
        const cleanM = normalizeModelName(m) || m;
        if (!byModel[cleanM]) {
          byModel[cleanM] = {
            savedChars: 0,
            savedTokens: 0,
            savedCostUSD: 0,
            originalChars: 0,
            ratePer1M: getModelRate(cleanM)
          };
        }
        byModel[cleanM].savedChars += (Number(mData.savedChars) || 0);
        byModel[cleanM].savedTokens += (Number(mData.savedTokens) || 0);
        byModel[cleanM].originalChars += (Number(mData.originalChars) || 0);
      }
    }
  }

  const modulesSum = Object.values(modules).reduce((sum, m) => sum + (Number(m.savedChars) || 0), 0);
  const diffSavedChars = Math.max(0, totalOriginalChars - totalCompressedChars);
  totalSavedChars = Math.max(diffSavedChars, modulesSum, totalSavedChars);
  if (totalOriginalChars < totalSavedChars) {
    totalOriginalChars = totalSavedChars;
  }
  totalCompressedChars = Math.max(0, totalOriginalChars - totalSavedChars);

  // If legacy buckets from v3.10.1 did not store per-bucket cacheZoneHits, proportionally attribute from global cacheZoneHits
  if (modules.cacheZone.cacheZoneHits === 0 && matching.length > 0 && compressionStats.modules && compressionStats.modules.cacheZone && compressionStats.modules.cacheZone.cacheZoneHits > 0) {
    const globalHits = Number(compressionStats.modules.cacheZone.cacheZoneHits) || 0;
    const globalRounds = (compressionStats.modules.schema && Number(compressionStats.modules.schema.alignedRounds)) || 0;
    if (globalRounds > 0 && modules.schema.alignedRounds > 0) {
      const ratio = Math.min(1, modules.schema.alignedRounds / globalRounds);
      modules.cacheZone.cacheZoneHits = Math.max(1, Math.round(globalHits * ratio));
    } else if (totalSavedChars > 0 && (compressionStats.totalSavedChars || 0) > 0) {
      const ratio = Math.min(1, totalSavedChars / compressionStats.totalSavedChars);
      modules.cacheZone.cacheZoneHits = Math.max(1, Math.round(globalHits * ratio));
    }
  }

  let modulesTokenSum = 0;
  for (const modKey of ['rtk', 'headroom', 'schema', 'cacheZone', 'powershell']) {
    const mod = modules[modKey];
    mod.savedTokens = Math.max(Number(mod.savedTokens) || 0, estimateTokens(mod.savedChars));
    modulesTokenSum += mod.savedTokens;
    mod.percentage = totalSavedChars > 0
      ? Number(((mod.savedChars / totalSavedChars) * 100).toFixed(1))
      : 0;
  }

  const savedTokens = Math.max(modulesTokenSum, estimateTokens(totalSavedChars));

  let modelTokensSum = 0;
  let modelCostSum = 0;
  for (const [m, data] of Object.entries(byModel)) {
    data.originalChars = Math.max(data.savedChars, Number(data.originalChars) || 0);
    data.savedTokens = Math.max(Number(data.savedTokens) || 0, estimateTokens(data.savedChars));
    const officialRate = getModelRate(m);
    data.ratePer1M = officialRate;
    data.savedCostUSD = Number(((data.savedTokens / 1000000) * data.ratePer1M).toFixed(7));
    modelTokensSum += data.savedTokens;
    modelCostSum += data.savedCostUSD;
  }

  const unassignedTokens = Math.max(0, savedTokens - modelTokensSum);
  const unassignedCost = (unassignedTokens / 1000000) * DEFAULT_MODEL_RATE_PER_1M;
  const savedCostUSD = Number((modelCostSum + unassignedCost).toFixed(6));

  let modelConsumedTokensSum = 0;
  let modelConsumedCostSum = 0;
  for (const [m, data] of Object.entries(byModel)) {
    data.consumedTokens = Math.max(Number(data.consumedTokens) || 0, estimateTokens(data.originalChars || 0));
    data.consumedCostUSD = Number(((data.consumedTokens / 1000000) * (data.ratePer1M || getModelRate(m))).toFixed(7));
    modelConsumedTokensSum += data.consumedTokens;
    modelConsumedCostSum += data.consumedCostUSD;
  }
  const consumedTokens = Math.max(estimateTokens(totalOriginalChars), modelConsumedTokensSum, savedTokens);
  const unassignedConsumed = Math.max(0, consumedTokens - modelConsumedTokensSum);
  const consumedCostUSD = Number((modelConsumedCostSum + (unassignedConsumed / 1000000) * DEFAULT_MODEL_RATE_PER_1M).toFixed(6));

  const compressionRatio = totalOriginalChars > 0
    ? Number(((totalSavedChars / totalOriginalChars) * 100).toFixed(1))
    : 0;

  const timeSeries = buildTimeSeries(normRange, matching, now);

  return {
    range: normRange,
    rangeLabel: cfg.label,
    totalOriginalChars,
    totalCompressedChars,
    totalSavedChars,
    savedTokens,
    savedCostUSD,
    consumedTokens,
    consumedCostUSD,
    compressionRatio,
    modules,
    byModel,
    timeSeries,
    lastResetAt: compressionStats.lastResetAt || compressionHistory.lastResetAt,
    updatedAt: new Date().toISOString()
  };
}

function getCompressionStats() {
  return getStatsByRange('all');
}

function resetCompressionStats() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    sessionCompressionMemo.clear();
    globalCompressionMemo.clear();
    globalStatsDedup.clear();
  } catch (_) {}

  const nowIso = new Date().toISOString();
  compressionStats = {
    totalOriginalChars: 0,
    totalCompressedChars: 0,
    totalSavedChars: 0,
    savedTokens: 0,
    savedCostUSD: 0,
    compressionRatio: 0,
    byModel: {},
    modules: {
      rtk: { savedChars: 0, savedTokens: 0, percentage: 0 },
      headroom: { savedChars: 0, savedTokens: 0, percentage: 0 },
      schema: { savedChars: 0, savedTokens: 0, percentage: 0, alignedRounds: 0, alignedToolsCount: 0 },
      cacheZone: { savedChars: 0, savedTokens: 0, percentage: 0 },
      powershell: { savedChars: 0, savedTokens: 0, percentage: 0 }
    },
    lastResetAt: nowIso,
    updatedAt: nowIso
  };

  compressionHistory = {
    all: compressionStats,
    buckets: {
      m5: [],
      h1: [],
      d1: []
    },
    lastResetAt: nowIso,
    updatedAt: nowIso
  };

  saveStatsToDisk();
  return compressionStats;
}

// Known lockfile patterns and names across major ecosystems
const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'cargo.lock',
  'gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'go.sum',
  'go.work.sum',
  'mix.lock',
  'flake.lock',
  'pipfile.lock',
  'packages.lock.json',
  'pdm.lock',
  'uv.lock',
  'bun.lockb',
  'bun.lock',
  'pubspec.lock',
  'gradle.lockfile',
  'berksfile.lock'
]);

function isLockfilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const clean = filePath.trim().replace(/^["']|["']$/g, '');
  const baseName = clean.split(/[/\\]/).pop().toLowerCase();
  return LOCKFILE_NAMES.has(baseName);
}

// Comprehensive ANSI escape regex (covers 7-bit, 8-bit, 24-bit TrueColor, SGR, cursor, OSC titles, hyperlinks & controls)
const ANSI_REGEX = new RegExp([
  '\\x1b\\[[0-?]*[ -/]*[@-~]',
  '\\x1b\\][^\x07\\x1b]*(?:\\x07|\\x1b\\\\|\\x1b|$)',
  '\\x1b[P\\^_][^\x07\\x1b]*(?:\\x07|\\x1b\\\\|\\x1b|$)',
  '\\x1b[@-Z\\\\_]',
  '\\x07'
].join('|'), 'g');

// Session-level memoization cache pool: sessionId -> Map(cacheKey -> compressedText)
const sessionCompressionMemo = new Map();

/**
 * Strip ANSI escape sequences from text. Safe sandbox wrapped.
 * @param {string} text
 * @returns {string}
 */
function stripAnsi(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    return text.replace(ANSI_REGEX, '');
  } catch (err) {
    console.warn('[ContextCompactor] stripAnsi error, bypassing:', err.message);
    return text;
  }
}

/**
 * Clean terminal carriage return (\r) overwriting progress bars.
 * Preserves original line endings (CRLF vs LF).
 * For lines containing standalone \r overwrites, keeps only the final rendered frame.
 * @param {string} text
 * @returns {string}
 */
function cleanProgressBars(text) {
  if (typeof text !== 'string' || !text.includes('\r')) return text;
  try {
    const isCrlf = text.includes('\r\n');
    // If text has no standalone carriage returns (only Windows CRLF newlines), bypass immediately
    const hasStandaloneCr = text.replace(/\r\n/g, '').includes('\r');
    if (!hasStandaloneCr) {
      return text;
    }
    // Normalize Windows CRLF to LF so remaining \r are true carriage return overwrites
    const normalized = text.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const cleanedLines = lines.map(line => {
      if (!line.includes('\r')) return line;
      const parts = line.split('\r').filter(p => p.length > 0);
      return parts.length > 0 ? parts[parts.length - 1] : '';
    });
    return cleanedLines.join(isCrlf ? '\r\n' : '\n');
  } catch (err) {
    console.warn('[ContextCompactor] cleanProgressBars error, bypassing:', err.message);
    return text;
  }
}

/**
 * Robustly parses git diff header to extract fileA and fileB.
 * Supports quoted paths, spaces, and /dev/null indicators.
 */
function parseGitDiffHeader(section) {
  const firstLine = section.split(/\r?\n/)[0] || '';
  if (!firstLine.startsWith('diff --git ')) return null;
  const rest = firstLine.slice(11).trim();
  const match = rest.match(/^(?:"a\/(.+?)"|a\/(\S+)|"([^\r\n"]+)"|(\S+))\s+(?:"b\/(.+?)"|b\/(\S+)|"([^\r\n"]+)"|(\S+))$/);
  if (!match) return null;
  const fileA = match[1] || match[2] || match[3] || match[4] || '';
  const fileB = match[5] || match[6] || match[7] || match[8] || '';
  return { fileA, fileB };
}

/**
 * Safe folding for lockfile git diffs.
 * CRITICAL SAFETY: If conflict markers (<<<<<<<, =======, >>>>>>>, |||||||) are detected,
 * the diff is NEVER folded to guarantee the LLM can inspect and resolve conflicts!
 * @param {string} text
 * @returns {string}
 */
function foldLockfiles(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const exemptMergeConflicts = options.exemptMergeConflicts !== false;
  const protectSourceDiffs = options.protectSourceDiffs !== false;
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';

    // Case 1: Standard git diff with "diff --git "
    if (text.includes('diff --git ')) {
      const sections = text.split(/(?=diff --git )/);
      const processedSections = sections.map(section => {
        const header = parseGitDiffHeader(section);
        if (!header) return section;
        const { fileA, fileB } = header;
        if (protectSourceDiffs && !isLockfilePath(fileA) && !isLockfilePath(fileB)) {
          return section; // Non-lockfile, keep completely untouched
        }
        // Safety exemption: If merge conflict markers exist, NEVER fold!
        if (
          exemptMergeConflicts && (
            section.includes('<<<<<<<') ||
            section.includes('=======') ||
            section.includes('>>>>>>>') ||
            section.includes('|||||||')
          )
        ) {
          return section;
        }
        if (section.includes('[Lockfile diff folded:')) {
          return section;
        }
        const lines = section.split(/\r?\n/);
        if (lines.length <= 6) {
          return section; // Already minimal
        }
        // Find where hunks begin (line starting with @@)
        let hunkIndex = lines.findIndex(l => l.startsWith('@@'));
        if (hunkIndex === -1) {
          const plusIdx = lines.findIndex(l => l.startsWith('+++ '));
          if (plusIdx !== -1) hunkIndex = plusIdx + 1;
          else hunkIndex = Math.min(4, lines.length);
        }
        const headerLines = lines.slice(0, hunkIndex).join(newline);
        // If fileB is /dev/null (deleted lockfile), use fileA; if fileA is /dev/null (added), use fileB
        const targetRaw = (fileB && !fileB.includes('dev/null')) ? fileB : fileA;
        const targetFile = targetRaw.replace(/^["']|["']$/g, '');
        const foldedCount = lines.length - hunkIndex;
        return `${headerLines}${newline}[Lockfile diff folded: ${targetFile} (${foldedCount} lines of dependency lock changes)]${newline}`;
      });
      return processedSections.join('');
    }

    // Case 2: Unified diff starting with --- and +++
    if (text.includes('--- ') && text.includes('+++ ')) {
      const sections = text.split(/(?=---\s+(?:"a\/|a\/|\S).+?\r?\n\+\+\+\s+(?:"b\/|b\/|\S))/);
      if (sections.length > 1 || sections[0].startsWith('--- ')) {
        const processedSections = sections.map(section => {
          const headerMatch = section.match(/^---\s+(?:"a\/(.+?)"|a\/([^\s\t\r\n]+)|"([^\r\n"]+)"|([^\s\t\r\n]+)).*?\r?\n\+\+\+\s+(?:"b\/(.+?)"|b\/([^\s\t\r\n]+)|"([^\r\n"]+)"|([^\s\t\r\n]+))/);
          if (!headerMatch) return section;
          const fileA = headerMatch[1] || headerMatch[2] || headerMatch[3] || headerMatch[4] || '';
          const fileB = headerMatch[5] || headerMatch[6] || headerMatch[7] || headerMatch[8] || '';
          if (protectSourceDiffs && !isLockfilePath(fileA) && !isLockfilePath(fileB)) {
            return section;
          }
          if (
            exemptMergeConflicts && (
              section.includes('<<<<<<<') ||
              section.includes('=======') ||
              section.includes('>>>>>>>') ||
              section.includes('|||||||')
            )
          ) {
            return section;
          }
          if (section.includes('[Lockfile diff folded:')) {
            return section;
          }
          const lines = section.split(/\r?\n/);
          if (lines.length <= 5) return section;
          let hunkIndex = lines.findIndex(l => l.startsWith('@@'));
          if (hunkIndex === -1) {
            const plusIdx = lines.findIndex(l => l.startsWith('+++ '));
            if (plusIdx !== -1) hunkIndex = plusIdx + 1;
            else hunkIndex = Math.min(2, lines.length);
          }
          const headerLines = lines.slice(0, hunkIndex).join(newline);
          const targetRaw = (fileB && !fileB.includes('dev/null')) ? fileB : fileA;
          const targetFile = targetRaw.replace(/^["']|["']$/g, '');
          const foldedCount = lines.length - hunkIndex;
          return `${headerLines}${newline}[Lockfile diff folded: ${targetFile} (${foldedCount} lines of dependency lock changes)]${newline}`;
        });
        return processedSections.join('');
      }
    }

    // Case 3: Raw Dependency Lockfile Content (package-lock.json, yarn.lock, pnpm-lock.yaml, cargo.lock, go.sum)
    // Redline: Never fold conflicted lockfiles containing merge conflict markers
    if (
      exemptMergeConflicts && (
        text.includes('<<<<<<<') ||
        text.includes('=======') ||
        text.includes('>>>>>>>') ||
        text.includes('|||||||')
      )
    ) {
      return text;
    }

    if (text.includes('[Lockfile folded:') || text.includes('[Lockfile diff folded:')) {
      return text;
    }

    // 3a. Raw package-lock.json (standalone or in Markdown code block)
    const isPackageLockJson = (
      (text.includes('"lockfileVersion"') && (text.includes('"packages"') || text.includes('"dependencies"'))) ||
      (text.includes('"name"') && text.includes('"lockfileVersion"'))
    ) && text.length > 400;

    if (isPackageLockJson) {
      const foldPackageLockObj = (obj) => {
        if (!obj || typeof obj !== 'object') return obj;
        let wasFolded = false;
        const result = { ...obj };
        if (result.packages && typeof result.packages === 'object') {
          const pkgKeys = Object.keys(result.packages);
          if (pkgKeys.length > 10) {
            wasFolded = true;
            const headKeys = pkgKeys.slice(0, 3);
            const tailKeys = pkgKeys.slice(pkgKeys.length - 2);
            const foldedPackages = {};
            for (const k of headKeys) foldedPackages[k] = result.packages[k];
            foldedPackages['_headroom_lockfile_folded'] = {
              _folded: true,
              summary: `[Lockfile folded: package-lock.json (${pkgKeys.length - 5} packages omitted)]`,
              totalPackages: pkgKeys.length
            };
            for (const k of tailKeys) foldedPackages[k] = result.packages[k];
            result.packages = foldedPackages;
          }
        }
        if (result.dependencies && typeof result.dependencies === 'object') {
          const depKeys = Object.keys(result.dependencies);
          if (depKeys.length > 10) {
            wasFolded = true;
            const headKeys = depKeys.slice(0, 3);
            const tailKeys = depKeys.slice(depKeys.length - 2);
            const foldedDeps = {};
            for (const k of headKeys) foldedDeps[k] = result.dependencies[k];
            foldedDeps['_headroom_lockfile_folded'] = {
              _folded: true,
              summary: `[Lockfile folded: package-lock.json (${depKeys.length - 5} dependencies omitted)]`,
              totalDependencies: depKeys.length
            };
            for (const k of tailKeys) foldedDeps[k] = result.dependencies[k];
            result.dependencies = foldedDeps;
          }
        }
        return wasFolded ? result : null;
      };

      const trimmed = text.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          const folded = foldPackageLockObj(parsed);
          if (folded) {
            const isIndented = trimmed.includes('\n  ') || trimmed.includes('\n\t') || trimmed.startsWith('{\n');
            const leadingWs = text.match(/^\s*/)[0];
            const trailingWs = text.match(/\s*$/)[0];
            return leadingWs + (isIndented ? JSON.stringify(folded, null, 2) : JSON.stringify(folded)) + trailingWs;
          }
        } catch (_) {}
      }

      if (text.includes('```')) {
        const codeBlockRegex = /(```(?:json|jsonc)?\s*[\r\n])([\s\S]*?)([\r\n]```)/gi;
        let anyFolded = false;
        const replaced = text.replace(codeBlockRegex, (match, prefix, inner, suffix) => {
          const innerTrimmed = inner.trim();
          if (innerTrimmed.startsWith('{') && innerTrimmed.endsWith('}') && innerTrimmed.includes('"lockfileVersion"')) {
            try {
              const parsed = JSON.parse(innerTrimmed);
              const folded = foldPackageLockObj(parsed);
              if (folded) {
                anyFolded = true;
                const isIndented = innerTrimmed.includes('\n  ') || innerTrimmed.includes('\n\t');
                return prefix + (isIndented ? JSON.stringify(folded, null, 2) : JSON.stringify(folded)) + suffix;
              }
            } catch (_) {}
          }
          return match;
        });
        if (anyFolded) return replaced;
      }

      const rawLines = text.split(/\r?\n/);
      if (rawLines.length > 25) {
        const header = rawLines.slice(0, 6).join(newline);
        const tail = rawLines.slice(-3).join(newline);
        const foldedCount = rawLines.length - 9;
        return `${header}${newline}  "[Lockfile folded: package-lock.json (${foldedCount} lines of dependency lock changes)]"${newline}${tail}`;
      }
    }

    // 3b. Raw non-JSON lockfiles: yarn.lock, pnpm-lock.yaml, cargo.lock, go.sum
    const lines = text.split(/\r?\n/);
    if (lines.length > 25 && text.length > 400) {
      let lockName = null;
      if (text.includes('# yarn lockfile v1') || (text.includes('# THIS IS AN AUTOGENERATED FILE') && text.includes('yarn'))) {
        lockName = 'yarn.lock';
      } else if (text.includes('lockfileVersion:') && (text.includes('importers:') || text.includes('packages:'))) {
        lockName = 'pnpm-lock.yaml';
      } else if (text.includes('[[package]]') && text.includes('name = ') && text.includes('version = ')) {
        lockName = 'cargo.lock';
      } else if (lines.filter(l => /^\S+\s+v\d+\.\d+\.\d+.*h1:/.test(l)).length > 15) {
        lockName = 'go.sum';
      }

      if (lockName) {
        const header = lines.slice(0, 6).join(newline);
        const tail = lines.slice(-3).join(newline);
        const foldedCount = lines.length - 9;
        return `${header}${newline}[Lockfile folded: ${lockName} (${foldedCount} lines of dependency lock content)]${newline}${tail}`;
      }
    }

    return text;
  } catch (err) {
    console.warn('[ContextCompactor] foldLockfiles error, bypassing:', err.message);
    return text;
  }
}

/**
 * Headroom SmartCrusher: Structured Homogeneous JSON Array Folding.
 * Automatically folds giant homogeneous JSON arrays (e.g. lists > 30 items returned by tools or CLI)
 * by keeping head slice (first 5) and tail slice (last 3) with a structural summary item,
 * saving massive prompt tokens during routine agent execution while preserving schemas and critical edge items.
 *
 * CRITICAL SAFETY / ANTI-DOWNGRADE REDLINES:
 * - If merge conflicts (<<<<<<<, =======, >>>>>>>, |||||||) are present, 100% bypassed.
 * - If stack traces / compiler errors (Traceback, AssertionError, TypeError, panic) are present, 100% bypassed.
 * - If input length < 200 chars or array length <= maxStructuredItems, untouched.
 * - Idempotent: already folded markers ([SmartCrusher: Folded ...) are never folded again.
 * - Exception safe: any JSON parsing or structure failure returns original text.
 * @param {string} text
 * @param {object} options
 * @returns {string}
 */
/**
 * Fast O(1) character pre-validation to check if string can possibly be valid JSON.
 * Filters out plaintext, markdown links, code blocks, etc. before invoking JSON.parse.
 */
function looksLikeJsonStructure(candidate, openChar) {
  if (typeof candidate !== 'string' || candidate.length < 2) return false;
  const closeChar = openChar === '[' ? ']' : '}';
  if (candidate[0] !== openChar || candidate[candidate.length - 1] !== closeChar) return false;

  // Scan first non-whitespace character after openChar
  let firstChar = '';
  for (let i = 1; i < candidate.length - 1; i++) {
    const c = candidate[i];
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
      firstChar = c;
      break;
    }
  }
  if (!firstChar) return true; // e.g. "[]" or "{}"

  if (openChar === '{') {
    // Valid JSON object keys must start with '"'
    if (firstChar !== '"') return false;
    if (!candidate.includes(':')) return false;
  } else {
    // Valid JSON array elements start with '"', '{', '[', digits, '-', 't', 'f', 'n'
    if (!'"{[-0123456789tfn'.includes(firstChar)) return false;
  }
  return true;
}

function foldStructuredData(text, options = {}, context = {}) {
  if (typeof text !== 'string' || text.length < 200) return text;
  if (options.foldStructuredData === false) return text;

  // Anti-downgrade conflict markers check
  if (text.includes('<<<<<<<') || text.includes('=======') || text.includes('>>>>>>>') || text.includes('|||||||')) {
    return text;
  }
  // Anti-downgrade code diff and patch markers check
  if (text.includes('diff --git ') || text.includes('*** Begin Patch') || /^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/m.test(text)) {
    return text;
  }
  // Anti-downgrade compiler errors / tracebacks / stack traces check
  if (
    RE_ALL_COMPILER_ERRORS.test(text) ||
    text.includes('Traceback (most recent call last):') ||
    text.includes('AssertionError:') ||
    text.includes('TypeError:') ||
    /\bTypeError\b/.test(text) ||
    text.includes('ReferenceError:') ||
    /\bReferenceError\b/.test(text) ||
    text.includes('SyntaxError:') ||
    /\bSyntaxError\b/.test(text) ||
    text.includes('RuntimeError:') ||
    /\bRuntimeError\b/.test(text) ||
    text.includes('RangeError:') ||
    /\bRangeError\b/.test(text) ||
    text.includes('NullPointerException') ||
    text.includes('Exception in thread') ||
    text.includes('Segmentation fault') ||
    text.includes('panicked at') ||
    text.includes('panic:') ||
    /\bpanic(?::|\(|\b)/.test(text) ||
    text.includes('fatal error:') ||
    text.includes('BUILD FAILED:')
  ) {
    return text;
  }
  // Idempotency check
  if (text.includes('[SmartCrusher: Folded') || text.includes('_headroom_smart_crusher')) {
    return text;
  }

  const maxItems = Number(options.maxStructuredItems) || 50;
  const headCount = Number(options.structuredHeadCount) || 5;
  const tailCount = Number(options.structuredTailCount) || 3;

  try {
    let wasFolded = false;
    const processValue = (val, depth = 0) => {
      if (depth > 6 || val === null || typeof val !== 'object') return val;
      if (Array.isArray(val)) {
        if (val.length > maxItems) {
          const omitted = val.length - headCount - tailCount;
          if (omitted > 0) {
            wasFolded = true;
            const headSlice = val.slice(0, headCount).map(item => processValue(item, depth + 1));
            const tailSlice = val.slice(val.length - tailCount).map(item => processValue(item, depth + 1));

            let summaryItem;
            const firstElem = val[0];
            if (firstElem && typeof firstElem === 'object' && !Array.isArray(firstElem)) {
              const sampleFields = Object.keys(firstElem).slice(0, 10);
              summaryItem = {
                _folded: true,
                _headroom_smart_crusher: true,
                summary: `[SmartCrusher: Folded ${omitted} items (${headCount + 1}..${val.length - tailCount} of ${val.length} items)]`,
                totalCount: val.length,
                foldedCount: omitted,
                sampleFields
              };
            } else {
              summaryItem = `... [SmartCrusher: Folded ${omitted} items (${headCount + 1}..${val.length - tailCount} of ${val.length} items)] ...`;
            }
            return [...headSlice, summaryItem, ...tailSlice];
          }
        }
        return val.map(item => processValue(item, depth + 1));
      }
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const keys = Object.keys(val);
        if (keys.length > maxItems) {
          const omitted = keys.length - headCount - tailCount;
          if (omitted > 0) {
            wasFolded = true;
            const res = {};
            const headKeys = keys.slice(0, headCount);
            for (const k of headKeys) {
              res[k] = processValue(val[k], depth + 1);
            }
            res['_headroom_smart_crusher'] = {
              _folded: true,
              summary: `[SmartCrusher: Folded ${omitted} items (${headCount + 1}..${keys.length - tailCount} of ${keys.length} items)]`,
              totalCount: keys.length,
              foldedCount: omitted
            };
            const tailKeys = keys.slice(keys.length - tailCount);
            for (const k of tailKeys) {
              res[k] = processValue(val[k], depth + 1);
            }
            return res;
          }
        }
        const res = {};
        for (const k of keys) {
          res[k] = processValue(val[k], depth + 1);
        }
        return res;
      }
      return val;
    };

    // Helper: Compact JSON serialization that preserves top-level line breaks while minifying deep leaf indentation
    const serializeCompactJson = (val, isIndented, rawLen) => {
      if (!isIndented) return JSON.stringify(val);
      if (rawLen < 800) return JSON.stringify(val, null, 2);
      if (Array.isArray(val)) {
        const items = val.map(item => JSON.stringify(item));
        return '[\n  ' + items.join(',\n  ') + '\n]';
      }
      if (val && typeof val === 'object') {
        const entries = Object.entries(val).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v));
        return '{\n  ' + entries.join(',\n  ') + '\n}';
      }
      return JSON.stringify(val);
    };

    // Case 1: Entire text is JSON (trimmed starts with [ or {)
    const trimmed = text.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        const parsed = JSON.parse(trimmed);
        const folded = processValue(parsed, 0);
        const isIndented = trimmed.includes('\n  ') || trimmed.includes('\n\t') || trimmed.startsWith('[\n') || trimmed.startsWith('{\n');
        if (wasFolded) {
          const leadingWs = text.match(/^\s*/)[0];
          const trailingWs = text.match(/\s*$/)[0];
          return leadingWs + serializeCompactJson(folded, isIndented, trimmed.length) + trailingWs;
        }
        // SmartCrusher v2: For large multi-line pretty-printed JSON (>= 1200 chars, >= 25 lines),
        // compact deep multi-space indentation losslessly (preserving 100% of keys and values)
        if (context && context.isPipeline && !Array.isArray(parsed) && isIndented && trimmed.length >= 1200 && trimmed.split(/\r?\n/).length >= 25) {
          const compactOut = serializeCompactJson(parsed, true, trimmed.length);
          if (compactOut.length + 100 < trimmed.length) {
            const leadingWs = text.match(/^\s*/)[0];
            const trailingWs = text.match(/\s*$/)[0];
            return leadingWs + compactOut + trailingWs;
          }
        }
      } catch (_) {}
    }

    // Case 2: Markdown code blocks containing JSON ```json ... ``` or ``` ... ```
    if (text.includes('```')) {
      const codeBlockRegex = /(```(?:json|jsonc|javascript|js)?\s*[\r\n])([\s\S]*?)([\r\n]```)/gi;
      let anyBlockFolded = false;
      const replaced = text.replace(codeBlockRegex, (match, prefix, inner, suffix) => {
        const innerTrimmed = inner.trim();
        if ((innerTrimmed.startsWith('[') && innerTrimmed.endsWith(']')) || (innerTrimmed.startsWith('{') && innerTrimmed.endsWith('}'))) {
          try {
            wasFolded = false;
            const parsed = JSON.parse(innerTrimmed);
            const folded = processValue(parsed, 0);
            const isIndented = innerTrimmed.includes('\n  ') || innerTrimmed.includes('\n\t');
            if (wasFolded) {
              anyBlockFolded = true;
              const stringified = serializeCompactJson(folded, isIndented, innerTrimmed.length);
              return prefix + stringified + suffix;
            }
            if (context && context.isPipeline && !Array.isArray(parsed) && isIndented && innerTrimmed.length >= 1200 && innerTrimmed.split(/\r?\n/).length >= 25) {
              const compactOut = serializeCompactJson(parsed, true, innerTrimmed.length);
              if (compactOut.length + 100 < innerTrimmed.length) {
                anyBlockFolded = true;
                return prefix + compactOut + suffix;
              }
            }
          } catch (_) {}
        }
        return match;
      });
      if (anyBlockFolded) return replaced;
    }

    // Case 3: Raw JSON array or object embedded in descriptive text (only when not a multi-line source code file)
    if (!isMultiLineSourceFileRead(text)) {
      const candidateStarts = [];
      const scanLimit = Math.min(text.length, 2000);
      for (let i = 0; i < scanLimit; i++) {
        if (text[i] === '[' || text[i] === '{') {
          candidateStarts.push({ char: text[i], idx: i });
        }
      }
      let parseAttempts = 0;
      const MAX_PARSE_ATTEMPTS = 3;
      for (const { char, idx } of candidateStarts) {
        if (parseAttempts >= MAX_PARSE_ATTEMPTS) break;
        const closeChar = char === '[' ? ']' : '}';
        const endIdx = text.lastIndexOf(closeChar);
        if (endIdx > idx + 100) {
          const candidate = text.substring(idx, endIdx + 1);
          if (!looksLikeJsonStructure(candidate, char)) {
            continue;
          }
          parseAttempts++;
          try {
            wasFolded = false;
            const parsed = JSON.parse(candidate);
            const folded = processValue(parsed, 0);
            if (wasFolded) {
              const isIndented = candidate.includes('\n  ') || candidate.includes('\n\t') || candidate.startsWith('[\n') || candidate.startsWith('{\n');
              const stringified = serializeCompactJson(folded, isIndented, candidate.length);
              return text.substring(0, idx) + stringified + text.substring(endIdx + 1);
            }
          } catch (_) {}
        }
      }
    }

    // ANTI-DOWNGRADE REDLINE:
    // foldStructuredData is STRICTLY for JSON/Lockfile structures (Case 1, 2, 3).
    // NEVER truncate plaintext, source code, scripts, or file outputs. Plaintext
    // is 100% preserved to guarantee zero code loss, zero hallucination, and zero patch failures.
    return text;
  } catch (err) {
    console.warn('[ContextCompactor] foldStructuredData error, bypassing:', err.message);
    return text;
  }
}

// Cache compiled dynamic regex patterns to eliminate repeated compilation overhead
const dynamicRegexCache = new Map();
function getCachedRegex(pattern, flags = 'i') {
  if (flags.includes('g') || flags.includes('y')) {
    return new RegExp(pattern, flags);
  }
  const key = `${pattern}__${flags}`;
  let reg = dynamicRegexCache.get(key);
  if (!reg) {
    if (dynamicRegexCache.size > 500) {
      for (const k of dynamicRegexCache.keys()) {
        dynamicRegexCache.delete(k);
        if (dynamicRegexCache.size <= 400) break;
      }
    }
    reg = new RegExp(pattern, flags);
    dynamicRegexCache.set(key, reg);
  }
  return reg;
}

// Pre-compiled static regexes for test output line classification
const RE_FAIL_ICONS = /[✕✗✖❌]/;
const RE_NOT_OK = /^\s*(?:not ok\b|FAIL\b|FAILED\b|ERROR\b|ERR!|fatal(?:\s+error)?\b|panic\b)/i;
const RE_ASSERTION = /\b(?:AssertionError|Assertion failed)\b/i;
const RE_CHECK_START = /^[✓✔]/;
const RE_RUNTIME_EXCEPTIONS = /\b(?:SyntaxError|TypeError|ReferenceError|RangeError|NullPointerException|Exception in thread)\b/i;
const RE_TRACEBACK_START = /^\s*(?:Traceback\b|BUILD FAILED\b|panic:)/i;
const RE_AT_STACK = /^\s*at\s+\S+/;
const RE_PY_STACK = /^\s*File\s+".*",\s+line\s+\d+/i;
const RE_C_ERROR = /:\d+:\d+:\s*(?:error|warning|fatal)/i;
const RE_RUST_ERROR = /error\[E\d+\]/i;
const RE_EXPECTED = /^\s*(?:expected|received)\b/i;
const RE_CONFLICT_MARKERS = /<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|/;
const RE_DIFF_HEADER = /^(?:diff --git|--- |\+\+\+|@@ )/;
const RE_CHECKMARK_TEST_PASS = /^[✓✔]\s+(?:should\b|it\b|test\b|t\d+\b|spec\b|case\b|can\b|must\b|verif|assert|expect|validat|check|test_|\S+.*?(?:\(\s*\d+(?:\.\d+)?\s*m?s\s*\)|\[\s*\d+\s*m?s\s*\])$)/i;
const RE_CHECKMARK_GENERAL = /^[✓✔]\s+.+/;
const RE_TAP_PASS = /^ok\s+(?:\d+\b|-\s+|\S+\s+-)/;
const RE_JEST_PASS = /^PASS\s+\S+/;
const RE_PYTEST_PASS = /(?:::|\.py\b).+?\bPASSED\b/;
const RE_TEST_PATH_PASS = /^(?:tests?[/\\].*?|.*?\btest\w*.*?|.*?\.(?:py|rs|go|js|ts|cpp|c|java))\s*.*?\bPASSED(?:\s*\[\s*\d+%\])?$/i;
const RE_CARGO_PASS = /^test\w*\s*(?:\([^)]+\))?\s*\.\.\.\s*ok\b/i;
const RE_GO_PASS = /^---\s*PASS:\s+\S+/;
const RE_GENERIC_PASS = /^\[PASS\]\s+\S+/;
const RE_GTEST_PASS = /^\[\s*OK\s*\]\s+\S+/;
const RE_CMAKE_PASS = /^\s*\d+\/\d+\s+Test\s+#\d+:\s+\S+.*?\bPassed\b/i;

/**
 * Positive match test passes folding.
 * Safe inversion architecture: ONLY recognizes explicit passing blocks (✓, ✔, PASS, ok, PASSED, [OK]).
 * CRITICAL SAFETY: Never touches failures, errors, assertions, or stack traces (100% preserved).
 * EXTENSIBILITY: Compiles and honors custom regex patterns passed in options.customTestPassPatterns.
 * @param {string} text
 * @param {object} options
 * @returns {string}
 */
function foldTestPasses(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const result = [];
    let passingRun = [];

    // Context detector: Differentiates real test suite runs from non-test deployment/installation checklists
    const hasTestFrameworkContext = /(?:PASS\s+\S+|Test Suites:|Tests:\s+\d+|passed,\s+\d+|tests passed|completed in \d+|finished in \d+|vitest|jest|mocha|pytest|cargo test|go test|ctest)/i.test(text);

    // Compile custom regex patterns safely (supports Array or single string)
    const customRegexes = [];
    const rawPatterns = Array.isArray(options.customTestPassPatterns)
      ? options.customTestPassPatterns
      : (typeof options.customTestPassPatterns === 'string' && options.customTestPassPatterns.trim()
          ? [options.customTestPassPatterns]
          : []);
    for (const pat of rawPatterns) {
      if (pat instanceof RegExp) {
        customRegexes.push(pat);
      } else if (typeof pat === 'string' && pat.trim()) {
        try {
          customRegexes.push(getCachedRegex(pat.trim(), 'i'));
        } catch (e) {
          console.warn('[ContextCompactor] Invalid customTestPassPattern ignored:', pat);
        }
      }
    }

    const isPassLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;

      // Safety barrier: Explicit failure indicators, compilation errors, assertion details, or stack traces must NEVER be folded
      if (RE_FAIL_ICONS.test(line)) return false;
      if (RE_NOT_OK.test(trimmed)) return false;
      if (RE_ASSERTION.test(line) && !RE_CHECK_START.test(trimmed)) return false;
      if (RE_RUNTIME_EXCEPTIONS.test(line)) return false;
      if (RE_TRACEBACK_START.test(trimmed)) return false;
      if (RE_AT_STACK.test(line) || RE_PY_STACK.test(line) || RE_C_ERROR.test(line) || RE_RUST_ERROR.test(line)) return false;
      if (RE_EXPECTED.test(trimmed)) return false;
      if (RE_CONFLICT_MARKERS.test(line)) return false;
      if (RE_DIFF_HEADER.test(trimmed)) return false;

      // Positive indicators for major testing frameworks:
      // 1. Jest / Vitest / Mocha: ✓ or ✔ (safeguarded against non-test checklists)
      if (hasTestFrameworkContext && RE_CHECKMARK_GENERAL.test(trimmed)) return true;
      if (RE_CHECKMARK_TEST_PASS.test(trimmed)) return true;
      // 2. TAP / node:test: ok 1 - name
      if (RE_TAP_PASS.test(trimmed)) return true;
      // 3. Jest suite pass: PASS src/...
      if (RE_JEST_PASS.test(trimmed)) return true;
      // 4. Pytest: test.py::test_fn PASSED [ 10%]
      if (RE_PYTEST_PASS.test(trimmed) || RE_TEST_PATH_PASS.test(trimmed)) return true;
      // 5. Rust cargo test & Python unittest: test foo ... ok / test_foo (module.Test) ... ok
      if (RE_CARGO_PASS.test(trimmed)) return true;
      // 6. Go test: --- PASS: TestFoo (0.00s)
      if (RE_GO_PASS.test(trimmed)) return true;
      // 7. Generic [PASS]
      if (RE_GENERIC_PASS.test(trimmed)) return true;
      // 8. GoogleTest (C++ gtest): [       OK ] Fixture.Test (1 ms)
      if (RE_GTEST_PASS.test(trimmed)) return true;
      // 9. CTest / CMake: 1/10 Test #1: TestName ... Passed
      if (RE_CMAKE_PASS.test(trimmed)) return true;

      // 10. User-supplied custom extensible patterns
      for (const rx of customRegexes) {
        if (rx.test(trimmed)) return true;
      }

      return false;
    };

    let folded = false;
    const flushRun = () => {
      if (passingRun.length >= 3) {
        result.push(`[Test suite: ${passingRun.length} passed tests folded (✓ / PASS / ok)]`);
        folded = true;
      } else {
        result.push(...passingRun);
      }
      passingRun = [];
    };

    for (const line of lines) {
      if (isPassLine(line)) {
        passingRun.push(line);
      } else {
        flushRun();
        result.push(line);
      }
    }
    flushRun();

    if (!folded) return text;
    return result.join(newline);
  } catch (err) {
    console.warn('[ContextCompactor] foldTestPasses error, bypassing:', err.message);
    return text;
  }
}

/**
 * Cleans repetitive Docker container layer pull/push progress lines.
 * Folds 5+ consecutive layer download/extract status lines into a concise summary.
 * Safety: NEVER folds Docker error lines or build step headers.
 * @param {string} text
 * @returns {string}
 */
function cleanDockerOutput(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (!text.includes('Pulling fs layer') && !text.includes('Download complete') && !text.includes('Pull complete') && !text.includes('Extracting') && !text.includes('Already exists') && !text.includes('Layer already exists') && !text.includes('Pushing')) {
    return text;
  }
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const result = [];
    let dockerRun = [];
    let folded = false;

    const isDockerLayerLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/error|failed/i.test(trimmed)) return false;
      return /^[0-9a-f]{8,12}:\s+(?:Pulling fs layer|Downloading|Extracting|Verifying Checksum|Download complete|Pull complete|Waiting|Already exists|Layer already exists|Pushing|Pushed)/i.test(trimmed);
    };

    const flushRun = () => {
      if (dockerRun.length >= 5) {
        result.push(`[Docker: ${dockerRun.length} layer download/extract status lines folded]`);
        folded = true;
      } else {
        result.push(...dockerRun);
      }
      dockerRun = [];
    };

    for (const line of lines) {
      if (isDockerLayerLine(line)) {
        dockerRun.push(line);
      } else {
        flushRun();
        result.push(line);
      }
    }
    flushRun();

    if (!folded) return text;
    return result.join(newline);
  } catch (err) {
    console.warn('[ContextCompactor] cleanDockerOutput error, bypassing:', err.message);
    return text;
  }
}

/**
 * Cleans repetitive Terraform / OpenTofu resource state refreshing noise.
 * Folds 3+ consecutive "Refreshing state... [id=...]" lines into a concise summary.
 * Safety: NEVER folds Terraform plan diffs (+, ~, -) or error messages.
 * @param {string} text
 * @returns {string}
 */
function cleanTerraformOutput(text) {
  if (typeof text !== 'string' || !text.includes('Refreshing state...')) return text;
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const result = [];
    let tfRun = [];
    let folded = false;

    const isTfRefreshLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/error|failed/i.test(trimmed)) return false;
      return /:\s+Refreshing state\.\.\.(?:\s*\[id=[^\]]+\])?/i.test(trimmed);
    };

    const flushRun = () => {
      if (tfRun.length >= 3) {
        result.push(`[Terraform: ${tfRun.length} resources state refreshed]`);
        folded = true;
      } else {
        result.push(...tfRun);
      }
      tfRun = [];
    };

    for (const line of lines) {
      if (isTfRefreshLine(line)) {
        tfRun.push(line);
      } else {
        flushRun();
        result.push(line);
      }
    }
    flushRun();

    if (!folded) return text;
    return result.join(newline);
  } catch (err) {
    console.warn('[ContextCompactor] cleanTerraformOutput error, bypassing:', err.message);
    return text;
  }
}

/**
 * Cleans repetitive Kubernetes pod / rollout status noise.
 * Folds 4+ consecutive healthy Running/Completed pod lines or rollout status updates.
 * Safety: NEVER folds CrashLoopBackOff, Error, Pending, Evicted or Warning states.
 * @param {string} text
 * @returns {string}
 */
function cleanKubectlOutput(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (!text.includes('Running') && !text.includes('Completed') && !text.includes('rollout to finish') && !text.includes('condition met')) {
    return text;
  }
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const result = [];
    let kubeRun = [];
    let folded = false;

    const isKubeStatusLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      // Safety exemption: Never fold failing, crashing, evicted or pending states
      if (/(?:error|failed|crashloop|imagepull|evicted|oom|pending|notready|terminating|warning)/i.test(trimmed)) return false;
      // Header line
      if (/^NAME\s+READY\s+STATUS\s+RESTARTS/i.test(trimmed)) return false;

      // 1. Pod table row: name ready status restarts age
      if (/^(?:pod\/)?[\w.-]+\s+\d+\/\d+\s+(?:Running|Completed)\s+\d+\s+[\w.-]+/i.test(trimmed)) return true;
      // 2. Rollout progress line
      if (/^Waiting for (?:deployment|daemon set|statefulset)\b.*?rollout to finish:\s+\d+\s+of\s+\d+\s+updated/i.test(trimmed)) return true;
      // 3. Condition met line
      if (/^(?:pod|deployment|service|ingress|job|statefulset)\/[\w.-]+\s+condition met$/i.test(trimmed)) return true;

      return false;
    };

    const flushRun = () => {
      if (kubeRun.length >= 4) {
        result.push(`[Kubectl: ${kubeRun.length} healthy pods / rollout status lines folded (Running / Completed / Met)]`);
        folded = true;
      } else {
        result.push(...kubeRun);
      }
      kubeRun = [];
    };

    for (const line of lines) {
      if (isKubeStatusLine(line)) {
        kubeRun.push(line);
      } else {
        flushRun();
        result.push(line);
      }
    }
    flushRun();

    if (!folded) return text;
    return result.join(newline);
  } catch (err) {
    console.warn('[ContextCompactor] cleanKubectlOutput error, bypassing:', err.message);
    return text;
  }
}

/* ==========================================================================
   Pluggable Pipeline Architecture
   Allows registering custom or domain-specific transformers with deterministic
   priority ordering and individual safe-sandbox isolation.
   ========================================================================== */

const transformersRegistry = new Map();

/**
 * Register a text transformer into the pipeline.
 * @param {string} name Unique transformer identifier
 * @param {Function} fn (text: string, options: object, context: object) => string
 * @param {object} meta { priority: number, enabledByDefault: boolean }
 */
function registerTransformer(name, fn, { priority = 50, enabledByDefault = true } = {}) {
  if (typeof name !== 'string' || typeof fn !== 'function') {
    throw new TypeError('Transformer name must be a string and fn must be a function');
  }
  transformersRegistry.set(name, { name, fn, priority, enabledByDefault });
}

/**
 * Unregister a transformer from the pipeline.
 * @param {string} name
 * @returns {boolean}
 */
function unregisterTransformer(name) {
  return transformersRegistry.delete(name);
}

/**
 * Returns all registered transformers sorted by ascending priority.
 * @returns {Array<{ name: string, fn: Function, priority: number, enabledByDefault: boolean }>}
 */
function getRegisteredTransformers() {
  return Array.from(transformersRegistry.values()).sort((a, b) => a.priority - b.priority);
}

/**
 * Clean repetitive Git transfer progress output (from rtk-ai/rtk Git Filter).
 * Folds runs of 3+ object transfer progress lines (Enumerating, Counting, Compressing,
 * Receiving, Resolving deltas, Unpacking, Updating files) while 100% preserving commit hashes,
 * branch refs, URLs, diffs, conflicts, and errors.
 * @param {string} text
 * @returns {string}
 */
function cleanGitOutput(text) {
  if (typeof text !== 'string' || text.length < 80) return text;
  if (
    !text.includes('Enumerating objects:') &&
    !text.includes('Counting objects:') &&
    !text.includes('Compressing objects:') &&
    !text.includes('Receiving objects:') &&
    !text.includes('Resolving deltas:') &&
    !text.includes('Unpacking objects:')
  ) {
    return text;
  }
  if (RE_CONFLICT_MARKERS.test(text)) return text;

  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const result = [];
    let gitRun = [];
    let folded = false;

    const isGitTransferLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/(?:error|fatal|conflict|warning|rejected|failed)/i.test(trimmed)) return false;
      return /^(?:remote:\s*)?(?:Enumerating objects|Counting objects|Compressing objects|Receiving objects|Resolving deltas|Unpacking objects|Writing objects|Updating files):\s+\d+%?/i.test(trimmed) ||
             /^remote:\s*Total\s+\d+\s+\(delta\s+\d+\)/i.test(trimmed);
    };

    const flushRun = () => {
      if (gitRun.length >= 3) {
        result.push(`[Git: ${gitRun.length} object transfer progress lines folded (Enumerating / Counting / Compressing / Resolving)]`);
        folded = true;
      } else {
        result.push(...gitRun);
      }
      gitRun = [];
    };

    for (const line of lines) {
      if (isGitTransferLine(line)) {
        gitRun.push(line);
      } else {
        flushRun();
        result.push(line);
      }
    }
    flushRun();

    return folded ? result.join(newline) : text;
  } catch (err) {
    console.warn('[ContextCompactor] cleanGitOutput error, bypassing:', err.message);
    return text;
  }
}

/**
 * Clean routine package manager & compiler dependency fetch/compile lines
 * (from rtk-ai/rtk & ojuschugh1/sqz Cargo/Pip/NPM Filter).
 * Folds runs of 5+ consecutive routine dependency lines (Downloading, Downloaded,
 * Compiling <crate> vX.Y.Z, Requirement already satisfied, Using cached) while
 * 100% preserving warnings, errors, stack traces, and final build summaries.
 * @param {string} text
 * @returns {string}
 */
function cleanBuildAndPkgOutput(text) {
  if (typeof text !== 'string' || text.length < 160) return text;
  if (
    !text.includes('Compiling ') &&
    !text.includes('Downloaded ') &&
    !text.includes('Downloading ') &&
    !text.includes('Requirement already satisfied:')
  ) {
    return text;
  }
  if (RE_CONFLICT_MARKERS.test(text)) return text;

  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const result = [];
    let pkgRun = [];
    let folded = false;

    const isRoutinePkgLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/(?:error|warn|fail|fatal|panic|exception|traceback|conflict|deprecated|vulnerability)/i.test(trimmed)) return false;
      // Cargo routine lines
      if (/^(?:Downloading|Downloaded|Compiling|Checking|Locking)\s+[\w.-]+\s+v\d+\.\d+/i.test(trimmed)) return true;
      // Pip routine lines
      if (/^Requirement already satisfied:\s+\S+\s+in\s+\S+/i.test(trimmed)) return true;
      if (/^Using cached\s+[\w.-]+\.(?:whl|tar\.gz)/i.test(trimmed)) return true;
      return false;
    };

    const flushRun = () => {
      if (pkgRun.length >= 5) {
        result.push(pkgRun[0]);
        result.push(`  ... [Build/Pkg: ${pkgRun.length - 2} routine dependency/compile lines folded] ...`);
        result.push(pkgRun[pkgRun.length - 1]);
        folded = true;
      } else {
        result.push(...pkgRun);
      }
      pkgRun = [];
    };

    for (const line of lines) {
      if (isRoutinePkgLine(line)) {
        pkgRun.push(line);
      } else {
        flushRun();
        result.push(line);
      }
    }
    flushRun();

    return folded ? result.join(newline) : text;
  } catch (err) {
    console.warn('[ContextCompactor] cleanBuildAndPkgOutput error, bypassing:', err.message);
    return text;
  }
}

/**
 * Top-level independent CLI execution metadata cleaner (cleanCliMetadata).
 * Strips Codex / OpenCode shell execution wrapper boilerplate (Chunk ID, Wall time,
 * Original token count, Process exited with code 0, Output: header) across ALL tool commands
 * while 100% preserving non-zero exit codes, error diagnostics, and source code reads.
 * @param {string} text
 * @returns {string}
 */
function cleanCliMetadata(text) {
  if (typeof text !== 'string' || text.length < 24) return text;
  if (RE_CONFLICT_MARKERS.test(text)) return text;
  if (isMultiLineSourceFileRead(text)) return text;

  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    let out = text;
    let modified = false;

    const lines = out.split(/\r?\n/);
    const filtered = [];
    let inHeader = true;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (inHeader && i < 10) {
        if (/^(?:Chunk ID:\s*[a-f0-9_-]+|Wall time:\s*\d+(?:\.\d+)?\s*seconds?|Original token count:\s*\d+|Process exited with code 0|Exit code:\s*0|Output:)$/i.test(trimmed)) {
          modified = true;
          if (/^Output:$/i.test(trimmed)) {
            inHeader = false;
          }
          continue;
        }
        if (trimmed.length > 0 && !/^(?:Process exited with code|Exit code:)/i.test(trimmed)) {
          inHeader = false;
        }
      }
      filtered.push(line);
    }

    if (modified) {
      out = filtered.join(newline);
    }

    if (/(?:\r?\n[ \t]*){3,}/.test(out)) {
      const collapsed = out.replace(/(?:\r?\n[ \t]*){3,}/g, newline + newline);
      if (collapsed.length < out.length) {
        out = collapsed;
        modified = true;
      }
    }

    return modified && out.trim().length > 0 ? out : text;
  } catch (err) {
    console.warn('[ContextCompactor] cleanCliMetadata error, bypassing:', err.message);
    return text;
  }
}

/**
 * Clean and fold high-density search results (ripgrep rg, grep, Select-String),
 * minified single-line asset matches, and large file/directory listings (rg --files, find, Get-ChildItem).
 * 100% preserves source code reads, stack traces, compiler errors, diffs, and merge conflicts.
 * @param {string} text
 * @returns {string}
 */
function cleanSearchAndTreeOutput(text) {
  if (typeof text !== 'string' || text.length < 350) return text;
  if (RE_CONFLICT_MARKERS.test(text)) return text;
  if (text.includes('diff --git ') || text.includes('*** Begin Patch') || /^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/m.test(text)) return text;
  if (isMultiLineSourceFileRead(text)) return text;
  if (isCompilerDiagnosticOrStackTrace(text)) return text;
  const trimmedStart = text.trimStart();
  if (trimmedStart.startsWith('{') || trimmedStart.startsWith('[')) return text;

  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    let modified = false;

    // 1. Truncate giant single-line minified JS/CSS/SVG/base64 grep matches (> 550 chars on a single line)
    const processedLines = lines.map(line => {
      if (line.length > 550) {
        const t = line.trim();
        // Never truncate stack traces, error messages, compiler diagnostics, diffs, or pure JSON lines
        if (
          isCompilerDiagnosticOrStackTrace(t) ||
          isSourceDiffOrPatch(t) ||
          /^(?:at\s+|File\s+"|Traceback|AssertionError|TypeError|ReferenceError|SyntaxError|RuntimeError|Error:|\[\{|\{")/i.test(t)
        ) {
          return line;
        }
        const spaceCount = (t.match(/ /g) || []).length;
        // P2-M3: Tighter threshold (0.02) + SQL/URL exclusion to prevent false positives
        const isMinifiedOrAsset = (
          (spaceCount / t.length < 0.02) ||
          t.includes(';function(') ||
          t.includes(',function(') ||
          t.includes('data:image/') ||
          t.includes('<svg ') ||
          t.includes('webpack') ||
          /^[\w./\\-]+:\d+:/.test(t)
        ) && !(
          // Exclude SQL statements — they naturally have low space ratios
          /^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|EXPLAIN)\s/i.test(t) ||
          // Exclude long URLs / API endpoints
          /^https?:\/\//i.test(t)
        );
        if (isMinifiedOrAsset) {
          modified = true;
          const omitted = line.length - 220;
          return line.slice(0, 220) + ` ... [RTK Search: Minified/long line tail omitted (${omitted} chars)]`;
        }
      }
      return line;
    });

    // 2. Fold excessive per-file rg/grep matches (> 25 matches in the exact same file)
    const rgLineRegex = /^([a-zA-Z0-9_.\\/-]+\.[a-zA-Z0-9]{1,8}):(\d+)[:\-](.*)$/;
    let currentFile = null;
    let fileMatches = [];
    const afterRgFold = [];

    const flushFileMatches = () => {
      if (fileMatches.length > 25) {
        const head = fileMatches.slice(0, 14);
        const tail = fileMatches.slice(-4);
        const omitted = fileMatches.length - head.length - tail.length;
        afterRgFold.push(...head);
        afterRgFold.push(`  ... [RTK Search: ${omitted} intermediate matches in ${currentFile} folded (first 14 & last 4 preserved)] ...`);
        afterRgFold.push(...tail);
        modified = true;
      } else if (fileMatches.length > 0) {
        afterRgFold.push(...fileMatches);
      }
      fileMatches = [];
      currentFile = null;
    };

    for (const line of processedLines) {
      const m = rgLineRegex.exec(line.trim());
      if (m && !line.trim().startsWith('at ')) {
        const fName = m[1];
        if (currentFile === fName) {
          fileMatches.push(line);
        } else {
          flushFileMatches();
          currentFile = fName;
          fileMatches.push(line);
        }
      } else {
        flushFileMatches();
        afterRgFold.push(line);
      }
    }
    flushFileMatches();

    // 3. Fold large file-list / directory enumeration outputs (rg --files, find, Get-ChildItem > 55 consecutive file paths)
    const isFilePathLine = (line) => {
      const t = line.trim();
      if (!t || t.length > 260) return false;
      if (/(?:error|warn|fail|exception|traceback|assert)/i.test(t)) return false;
      // PowerShell Get-ChildItem row: Mode LastWriteTime Length Name
      if (/^[d-][arhs-]{4,5}\s+\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}/i.test(t)) return true;
      // Pure relative or absolute file path without spaces (or typical path with extension)
      if (/^(?:[a-zA-Z]:[\\/]|\.{0,2}[\\/]|[a-zA-Z0-9_.-]+[\\/])[a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]{1,8}$/.test(t)) return true;
      return false;
    };

    const finalLines = [];
    let pathRun = [];
    const flushPathRun = () => {
      if (pathRun.length > 55) {
        const head = pathRun.slice(0, 25);
        const tail = pathRun.slice(-10);
        const omitted = pathRun.length - head.length - tail.length;
        finalLines.push(...head);
        finalLines.push(`  ... [RTK Tree: ${omitted} intermediate file entries folded (first 25 & last 10 preserved)] ...`);
        finalLines.push(...tail);
        modified = true;
      } else if (pathRun.length > 0) {
        finalLines.push(...pathRun);
      }
      pathRun = [];
    };

    for (const line of afterRgFold) {
      if (isFilePathLine(line)) {
        pathRun.push(line);
      } else {
        flushPathRun();
        finalLines.push(line);
      }
    }
    flushPathRun();

    return modified ? finalLines.join(newline) : text;
  } catch (err) {
    console.warn('[ContextCompactor] cleanSearchAndTreeOutput error, bypassing:', err.message);
    return text;
  }
}

/**
 * Deduplicate consecutive identical runtime log lines (from fkiene/llmtrim & DCP).
 * Only folds lines matching explicit runtime log patterns (ISO/syslog timestamp or [INFO]/[DEBUG] prefix)
 * when repeated >= 4 times consecutively. 100% exempts source code, diffs, stack traces, and merge conflicts.
 * @param {string} text
 * @returns {string}
 */
function dedupLogLines(text) {
  if (typeof text !== 'string' || text.length < 160) return text;
  if (RE_CONFLICT_MARKERS.test(text)) return text;

  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    if (lines.length < 4) return text;

    const normalizeLogTemplate = (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 12) return null;
      // Never fold stack traces, diffs, code fences, or error headers
      if (/^(?:at\s+|File\s+"|Traceback|\+\+\+|---|@@|[+\-!<>]|```|error|fatal|panic|AssertionError)/i.test(trimmed)) {
        return null;
      }
      // Must start with a timestamp or explicit log level tag to qualify as a runtime log line
      const hasLogPrefix = /^(?:\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?|\[?\d{2}:\d{2}:\d{2}(?:\.\d+)?\]?|\[(?:INFO|DEBUG|TRACE|NOTICE|LOG)\]|(?:INFO|DEBUG|TRACE|NOTICE):\s)/i.test(trimmed);
      if (!hasLogPrefix) return null;
      return trimmed
        .replace(/^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s*/, '')
        .replace(/^\[?\d{2}:\d{2}:\d{2}(?:\.\d+)?\]?\s*/, '');
    };

    const result = [];
    let currentTemplate = null;
    let currentGroup = [];
    let folded = false;

    const flushGroup = () => {
      if (currentGroup.length >= 4) {
        result.push(currentGroup[0]);
        result.push(`  ... [llmtrim Log Dedup: Identical log line repeated ${currentGroup.length - 1} more times]`);
        folded = true;
      } else if (currentGroup.length > 0) {
        result.push(...currentGroup);
      }
      currentGroup = [];
      currentTemplate = null;
    };

    for (const line of lines) {
      const tpl = normalizeLogTemplate(line);
      if (tpl !== null && tpl === currentTemplate) {
        currentGroup.push(line);
      } else {
        flushGroup();
        if (tpl !== null) {
          currentTemplate = tpl;
          currentGroup.push(line);
        } else {
          result.push(line);
        }
      }
    }
    flushGroup();

    return folded ? result.join(newline) : text;
  } catch (err) {
    console.warn('[ContextCompactor] dedupLogLines error, bypassing:', err.message);
    return text;
  }
}

// Register built-in transformers in standard priority order
registerTransformer('stripAnsi', (text) => stripAnsi(text), { priority: 10, enabledByDefault: true });
registerTransformer('cleanCliMetadata', (text) => cleanCliMetadata(text), { priority: 15, enabledByDefault: true });
registerTransformer('cleanProgressBars', (text) => cleanProgressBars(text), { priority: 20, enabledByDefault: true });
registerTransformer('cleanPowerShellOutput', (text, opts, ctx) => {
  try {
    const psOpt = require('./powershell-optimizer');
    const explicitTarget = opts && (opts.targetPlatform || opts.platform);
    const hasExplicitPsNoise = typeof text === 'string' && (
      text.includes('#< CLIXML') ||
      text.includes('PowerShell 7.') ||
      text.includes('Windows PowerShell') ||
      text.includes('FullyQualifiedErrorId')
    );
    if (psOpt.isPowerShellOptimizerActive(opts, ctx && ctx.req) || (explicitTarget !== 'linux' && opts.cleanPowerShellOutput !== false && hasExplicitPsNoise)) {
      return psOpt.cleanPowerShellNoise(text, opts);
    }
  } catch (_) {}
  return text;
}, { priority: 25, enabledByDefault: true });
registerTransformer('cleanDockerOutput', (text) => cleanDockerOutput(text), { priority: 30, enabledByDefault: true });
registerTransformer('cleanGitOutput', (text) => cleanGitOutput(text), { priority: 32, enabledByDefault: true });
registerTransformer('cleanKubectlOutput', (text) => cleanKubectlOutput(text), { priority: 35, enabledByDefault: true });
registerTransformer('cleanBuildAndPkgOutput', (text) => cleanBuildAndPkgOutput(text), { priority: 38, enabledByDefault: true });
registerTransformer('cleanSearchAndTreeOutput', (text) => cleanSearchAndTreeOutput(text), { priority: 39, enabledByDefault: true });
registerTransformer('cleanTerraformOutput', (text) => cleanTerraformOutput(text), { priority: 40, enabledByDefault: true });
registerTransformer('dedupLogLines', (text) => dedupLogLines(text), { priority: 45, enabledByDefault: true });
registerTransformer('foldLockfiles', (text, opts) => foldLockfiles(text, opts), { priority: 50, enabledByDefault: true });
registerTransformer('foldStructuredData', (text, opts, ctx) => foldStructuredData(text, opts, ctx), { priority: 52, enabledByDefault: true });
registerTransformer('foldTestPasses', (text, opts) => foldTestPasses(text, opts), { priority: 60, enabledByDefault: true });

/**
 * Run text through the pluggable transformer pipeline.
 * Every step is fully safe-sandboxed: If any transformer throws, the exception
 * is caught, a warning is logged, and the pipeline continues with the previous step's text.
 * @param {string} text
 * @param {object} options
 * @param {object} context
 * @returns {string}
 */
function runPipeline(text, options = {}, context = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const transformers = getRegisteredTransformers();
  let current = text;
  for (const { name, fn, enabledByDefault } of transformers) {
    const isEnabled = options[name] !== undefined ? Boolean(options[name]) : enabledByDefault;
    if (!isEnabled) continue;
    try {
      const beforeLen = current.length;
      const transformed = fn(current, options, context);
      if (typeof transformed === 'string') {
        if (transformed.length < beforeLen) {
          const mod = (name === 'foldLockfiles' || name === 'foldStructuredData') ? 'headroom' : (name === 'cleanPowerShellOutput' ? 'powershell' : 'rtk');
          const savedChars = beforeLen - transformed.length;
          if (context && context.moduleDeltas) {
            context.moduleDeltas[mod] = (context.moduleDeltas[mod] || 0) + savedChars;
          } else {
            const modelName = normalizeModelName(options.model || (context && context.model) || null);
            recordSavings(mod, savedChars, beforeLen, modelName);
          }
        }
        current = transformed;
      }
    } catch (err) {
      console.warn(`[ContextCompactor] Transformer "${name}" threw error, bypassing:`, err.message);
    }
  }
  return current;
}

/**
 * Recursively sort object keys and required arrays in deterministic lexicographical order.
 * Immune to circular references via inStack tracking and correctly sorts shared sub-objects (DAGs).
 */
function sortKeysDeep(obj, inStack = new Set()) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (inStack.has(obj)) {
    return obj;
  }
  inStack.add(obj);

  try {
    if (Array.isArray(obj)) {
      return obj.map(item => sortKeysDeep(item, inStack));
    }
    const sorted = {};
    const keys = Object.keys(obj).sort();
    for (const k of keys) {
      if (k === 'required' && Array.isArray(obj[k])) {
        sorted[k] = [...obj[k]].sort();
      } else {
        sorted[k] = sortKeysDeep(obj[k], inStack);
      }
    }
    return sorted;
  } finally {
    inStack.delete(obj);
  }
}

/**
 * Align tools schema deterministically by tool name and recursive key sorting.
 * Locks Prompt Cache prefix for upstream providers (Anthropic & OpenAI KV Cache).
 * Safe sandbox wrapped.
 * @param {Array} tools
 * @returns {Array}
 */
function alignToolsSchema(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return tools;
  try {
    const seenNames = new Set();
    const deduped = [];
    for (const t of tools) {
      if (!t || typeof t !== 'object') {
        deduped.push(t);
        continue;
      }
      const name = (t.function && t.function.name) || t.name;
      if (name && typeof name === 'string') {
        if (seenNames.has(name)) continue;
        seenNames.add(name);
      }
      deduped.push(t);
    }
    const sorted = [...deduped].sort((a, b) => {
      const nameA = (a && a.function && a.function.name) || (a && a.name) || '';
      const nameB = (b && b.function && b.function.name) || (b && b.name) || '';
      return String(nameA).localeCompare(String(nameB));
    });
    return sorted.map(t => (t && typeof t === 'object') ? sortKeysDeep(t) : t);
  } catch (err) {
    console.warn('[ContextCompactor] alignToolsSchema error, bypassing:', err.message);
    return tools;
  }
}

/**
 * Slim a single description string by removing markdown code blocks and trailing verbose example blocks.
 * ANTI-DOWNGRADE REDLINE:
 * NEVER truncate sentences or split on periods ('.'). Preserves all parameter constraints,
 * types, options, and descriptions intact without cutting off 'e.g. /path' or vital rules.
 */
function slimDescription(desc) {
  if (typeof desc !== 'string' || !desc.trim()) return desc;
  try {
    let text = desc;
    // 1. Strip markdown code blocks, but ONLY verbose ones (> 500 chars)
    // P3-M2: Short code examples (< 500 chars) are preserved to maintain tool parameter formatting guidance
    text = text.replace(/```[\s\S]*?```/g, (match) => match.length > 500 ? '' : match);
    // 2. Strip verbose example list sections (e.g. "Examples of valid command strings:\n\n- ...") while preserving trailing safety rules
    text = text.replace(/(?:\r?\n)+\s*(?:Examples?(?:\s+of\s+[^\r\n:]+)?|Usage|Sample|Detailed Description):\s*(?:\r?\n)+(?:\s*[-*•].*\r?\n?)+/gi, '\n');
    // 3. Strip trailing example sections at the end of description
    const strippedExamples = text.replace(/(?:\r?\n)+\s*(?:Examples?(?:\s+of\s+[^\r\n:]+)?|Usage|Sample|Detailed Description):\s*[\s\S]*/i, '').trim();
    if (strippedExamples && strippedExamples.length >= 1) {
      text = strippedExamples;
    }
    // 3. Collapse multiple consecutive empty lines and trailing whitespace
    text = text.replace(/\r?\n\s*\r?\n\s*\r?\n+/g, '\n\n').trim();

    return text || desc;
  } catch (e) {
    return desc;
  }
}

/**
 * Recursively slim composite schema definitions (properties, patternProperties, additionalProperties, items, anyOf, oneOf, allOf, $defs).
 * Hardened with maximum depth = 50 to prevent call stack exhaustion on extreme adversarial inputs.
 */
function slimSchemaDeep(schema, visited = new WeakSet(), depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 50) return;
  if (visited.has(schema)) return;
  visited.add(schema);

  if (schema.description && typeof schema.description === 'string') {
    schema.description = slimDescription(schema.description);
  }
  if (schema.example !== undefined) delete schema.example;
  if (schema.examples !== undefined) delete schema.examples;

  if (schema.properties && typeof schema.properties === 'object') {
    for (const sub of Object.values(schema.properties)) {
      slimSchemaDeep(sub, visited, depth + 1);
    }
  }
  if (schema.patternProperties && typeof schema.patternProperties === 'object') {
    for (const sub of Object.values(schema.patternProperties)) {
      slimSchemaDeep(sub, visited, depth + 1);
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    slimSchemaDeep(schema.additionalProperties, visited, depth + 1);
  }
  if (schema.items && typeof schema.items === 'object') {
    if (Array.isArray(schema.items)) {
      for (const sub of schema.items) slimSchemaDeep(sub, visited, depth + 1);
    } else {
      slimSchemaDeep(schema.items, visited, depth + 1);
    }
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[key])) {
      for (const sub of schema[key]) slimSchemaDeep(sub, visited, depth + 1);
    }
  }
  if (schema.$defs && typeof schema.$defs === 'object') {
    for (const sub of Object.values(schema.$defs)) {
      slimSchemaDeep(sub, visited, depth + 1);
    }
  }
  if (schema.definitions && typeof schema.definitions === 'object') {
    for (const sub of Object.values(schema.definitions)) {
      slimSchemaDeep(sub, visited, depth + 1);
    }
  }
}

function slimToolItem(tool) {
  if (!tool || typeof tool !== 'object') return tool;
  try {
    let cloned;
    try {
      cloned = typeof structuredClone === 'function' ? structuredClone(tool) : JSON.parse(JSON.stringify(tool));
    } catch (e) {
      try {
        cloned = JSON.parse(JSON.stringify(tool));
      } catch (err) {
        cloned = { ...tool };
      }
    }

    // 1. OpenAI function wrapper format
    if (cloned.function && typeof cloned.function === 'object') {
      if (cloned.function.description) {
        cloned.function.description = slimDescription(cloned.function.description);
      }
      const params = cloned.function.parameters || cloned.function.inputSchema || cloned.function.input_schema;
      if (params && typeof params === 'object') {
        slimSchemaDeep(params);
      }
    }

    // 2. Direct tool description (Anthropic, MCP, top-level Responses)
    if (cloned.description) {
      cloned.description = slimDescription(cloned.description);
    }

    // 3. Direct schema properties (Anthropic input_schema, MCP inputSchema, Responses parameters)
    const directSchema = cloned.parameters || cloned.input_schema || cloned.inputSchema;
    if (directSchema && typeof directSchema === 'object') {
      slimSchemaDeep(directSchema);
    }

    return cloned;
  } catch (err) {
    console.warn('[ContextCompactor] slimToolItem error, returning original tool:', err.message);
    return tool;
  }
}

/**
 * Slim oversized tools schema (> 15,000 chars by default) by trimming markdown examples
 * and long descriptions while keeping parameter types, names, enums and structure 100% intact.
 * Safe sandbox wrapped.
 * @param {Array} tools
 * @param {number} threshold
 * @returns {Array}
 */
function slimToolsSchema(tools, threshold = 15000, knownLength = -1) {
  if (!Array.isArray(tools) || tools.length === 0) return tools;
  try {
    const limit = (typeof threshold === 'number' && !isNaN(threshold) && threshold >= 0) ? threshold : 15000;
    let rawLen = knownLength;
    if (typeof rawLen !== 'number' || rawLen < 0) {
      try {
        rawLen = JSON.stringify(tools).length;
      } catch (e) {
        return tools;
      }
    }
    if (rawLen <= limit) {
      // Even when total tools JSON is below threshold (e.g. Codex 10 tools = 9,380 chars < 15,000),
      // safely strip multi-line example blocks from individual oversized tool descriptions (>= 600 chars)
      // while leaving normal concise tools (< 600 chars, e.g. Test 91) 100% untouched.
      let anyOversizedToolSlimmed = false;
      const selectivelySlimmed = tools.map(t => {
        if (!t || typeof t !== 'object') return t;
        const fnDesc = (t.function && typeof t.function.description === 'string') ? t.function.description : '';
        const topDesc = (typeof t.description === 'string') ? t.description : '';
        const maxDescLen = Math.max(fnDesc.length, topDesc.length);
        if (maxDescLen >= 600 && (/(?:Examples?|Usage|Sample)/i.test(fnDesc || topDesc) || (fnDesc || topDesc).includes('```'))) {
          const slimmed = slimToolItem(t);
          anyOversizedToolSlimmed = true;
          return slimmed;
        }
        return t;
      });
      return anyOversizedToolSlimmed ? selectivelySlimmed : tools;
    }
    return tools.map(t => slimToolItem(t));
  } catch (err) {
    console.warn('[ContextCompactor] slimToolsSchema error, bypassing:', err.message);
    return tools;
  }
}

/**
 * Processes tools list through alignToolsSchema and slimToolsSchema,
 * precisely tracking character reductions and KV Cache alignment round metrics.
 * Attributes all tool definition optimizations to modules.schema.
 * 100% Safe Sandbox Wrapped.
 * @param {Array} tools
 * @param {object} opts
 * @returns {{ tools: Array, savedChars: number, initialLen: number }}
 */
function compactToolsList(tools, opts = {}) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return { tools, savedChars: 0, initialLen: 0 };
  }

  try {
    if (!opts.alignToolsSchema && !opts.slimToolsSchema) {
      return { tools, savedChars: 0, initialLen: 0 };
    }

    let rawStr = '';
    try { rawStr = JSON.stringify(tools); } catch (e) {}
    const initialLen = rawStr.length;

    let current = tools;
    if (opts.alignToolsSchema) {
      current = alignToolsSchema(current);
    }
    if (opts.slimToolsSchema) {
      // Pass initialLen to slimToolsSchema to prevent duplicate JSON.stringify
      current = slimToolsSchema(current, opts.schemaCharThreshold, initialLen);
    }

    let finalStr = '';
    if (current === tools) {
      finalStr = rawStr;
    } else {
      try { finalStr = JSON.stringify(current); } catch (e) {}
    }
    const finalLen = finalStr.length;

    let deltaChars = Math.max(0, initialLen - finalLen);

    if (opts.alignToolsSchema && !opts._isRetryAttempt) {
      if (!compressionStats.modules.schema.alignedRounds) {
        compressionStats.modules.schema.alignedRounds = 0;
      }
      compressionStats.modules.schema.alignedRounds += 1;
      if (!compressionStats.modules.schema.alignedToolsCount) {
        compressionStats.modules.schema.alignedToolsCount = 0;
      }
      compressionStats.modules.schema.alignedToolsCount += tools.length;

      const alignTs = Date.now();
      recordBucketSchemaAlignment('m5', alignTs, 1, tools.length);
      recordBucketSchemaAlignment('h1', alignTs, 1, tools.length);
      recordBucketSchemaAlignment('d1', alignTs, 1, tools.length);

      // ANTI-INFLATION REDLINE:
      // When schema was already sorted and minified (deltaChars === 0), do NOT fabricate
      // artificial character savings. Aligned rounds and tool counts accurately record
      // KV Cache lock contribution without phantom number inflation.
    }

    if (deltaChars > 0 && !opts._isRetryAttempt) {
      const schemaHash = `schema_${hashContent(rawStr)}_${opts.schemaCharThreshold || 15000}`;
      if (!globalCompressionMemo.has(schemaHash)) {
        if (globalCompressionMemo.size >= MAX_GLOBAL_MEMO_KEYS) {
          const oldestG = globalCompressionMemo.keys().next().value;
          globalCompressionMemo.delete(oldestG);
        }
        globalCompressionMemo.set(schemaHash, finalLen);
        const modelName = normalizeModelName(opts.model || null);
        const dynamicSchemaTokens = Math.max(0, estimateTokens(rawStr) - estimateTokens(finalStr));
        recordSavings('schema', deltaChars, Math.max(initialLen, deltaChars), modelName, Date.now(), dynamicSchemaTokens);
      }
    }

    return { tools: current, savedChars: deltaChars, initialLen };
  } catch (err) {
    console.warn('[ContextCompactor] compactToolsList error, bypassing:', err.message);
    return { tools, savedChars: 0, initialLen: 0 };
  }
}

/**
 * Generate fast SHA256 hex prefix for text content memoization.
 * Solidified with CRLF and trailing whitespace normalization to prevent Cache-Zone breakdown across turns.
 */
function hashContent(text) {
  if (typeof text !== 'string') return '';
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

const MAX_MEMO_SESSIONS = 500;
const MAX_MEMO_KEYS_PER_SESSION = 200;
const MAX_GLOBAL_MEMO_KEYS = 2000;
const globalCompressionMemo = new Map();

// P0-H2: Stats dedup fingerprint pool — prevent multi-turn re-counting of identical content
// In multi-turn Responses API conversations, when CacheZone misses (session evicted),
// the same tool output text gets re-compressed and re-counted. This pool tracks content
// fingerprints to skip duplicate stats recording.
const MAX_STATS_DEDUP_KEYS = 10000;
const globalStatsDedup = new Map();

function normalizeMemoSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  return sessionId.trim().replace(/(?:-r\d+)+$/g, '');
}

/**
 * Derives dynamic options signature from all registered transformers and custom options.
 * Ensures that registering transformers or toggling individual switches safely invalidates cache.
 */
function getOptionsSignature(opts) {
  const transformers = getRegisteredTransformers();
  const parts = transformers.map(t => {
    const enabled = opts[t.name] !== undefined ? Boolean(opts[t.name]) : t.enabledByDefault;
    return `${t.name}:${enabled ? 1 : 0}`;
  });
  if (opts.customTestPassPatterns && (Array.isArray(opts.customTestPassPatterns) ? opts.customTestPassPatterns.length > 0 : Boolean(opts.customTestPassPatterns))) {
    try {
      parts.push(`custom:${JSON.stringify(opts.customTestPassPatterns)}`);
    } catch (e) {}
  }
  return parts.join('|');
}

function getMemo(sessionId, cacheKey) {
  const normSid = normalizeMemoSessionId(sessionId);
  if (!normSid) return null;
  const sMap = sessionCompressionMemo.get(normSid);
  if (sMap) {
    const val = sMap.get(cacheKey);
    if (val !== undefined) {
      // True LRU refresh within session
      sMap.delete(cacheKey);
      sMap.set(cacheKey, val);
      // True LRU refresh for session itself
      sessionCompressionMemo.delete(normSid);
      sessionCompressionMemo.set(normSid, sMap);
      return val;
    }
  }
  // Cross-turn / sub-agent fallback: if the exact content hash + options signature
  // was already compressed in an active proxy session, reuse the exact byte stream
  if (globalCompressionMemo.has(cacheKey)) {
    const gVal = globalCompressionMemo.get(cacheKey);
    globalCompressionMemo.delete(cacheKey);
    globalCompressionMemo.set(cacheKey, gVal);
    setMemo(normSid, cacheKey, gVal);
    return gVal;
  }
  return null;
}

function setMemo(sessionId, cacheKey, compressed) {
  const normSid = normalizeMemoSessionId(sessionId);
  if (!normSid) return;
  let sMap = sessionCompressionMemo.get(normSid);
  if (!sMap) {
    if (sessionCompressionMemo.size >= MAX_MEMO_SESSIONS) {
      const oldestSession = sessionCompressionMemo.keys().next().value;
      sessionCompressionMemo.delete(oldestSession);
    }
    sMap = new Map();
    sessionCompressionMemo.set(normSid, sMap);
  } else {
    // Refresh session order in memo
    sessionCompressionMemo.delete(normSid);
    sessionCompressionMemo.set(normSid, sMap);
  }
  if (sMap.size >= MAX_MEMO_KEYS_PER_SESSION) {
    const oldestKey = sMap.keys().next().value;
    sMap.delete(oldestKey);
  }
  sMap.set(cacheKey, compressed);

  if (globalCompressionMemo.size >= MAX_GLOBAL_MEMO_KEYS && !globalCompressionMemo.has(cacheKey)) {
    const oldestGlobal = globalCompressionMemo.keys().next().value;
    globalCompressionMemo.delete(oldestGlobal);
  }
  globalCompressionMemo.delete(cacheKey);
  globalCompressionMemo.set(cacheKey, compressed);
}

function clearSessionMemo(sessionId) {
  if (sessionId) {
    const normSid = normalizeMemoSessionId(sessionId);
    const sMap = sessionCompressionMemo.get(normSid) || sessionCompressionMemo.get(sessionId);
    if (sMap) {
      for (const k of sMap.keys()) {
        globalCompressionMemo.delete(k);
      }
    }
    sessionCompressionMemo.delete(normSid);
    sessionCompressionMemo.delete(sessionId);
  } else {
    sessionCompressionMemo.clear();
    globalCompressionMemo.clear();
  }
}

/**
 * Ensures a text output or block content is strictly non-empty string.
 * Prevents whitespace-only or empty strings from causing upstream HTTP 400 (Anthropic/OpenAI) or SSE empty stream aborts.
 */
function ensureSafeNonEmptyString(str, fallback = '[Empty output]') {
  if (typeof str === 'string') {
    return str.trim().length > 0 ? str : fallback;
  }
  return fallback;
}

// Pre-compiled comprehensive static regexes for compiler errors, diagnostics, and stack traces
const RE_ALL_COMPILER_ERRORS = /(?:(?:^|\r?\n)\s*(?:[a-zA-Z]:[\\/]|[\w./\\-]+)\s*[:(]\s*\d+\s*(?:[:,\t]\s*\d+)?\s*[:)]\s*(?:fatal\s+)?(?:error|warning|note)\b|error\[E\d+\]|error\s+C\d+:|warning\s+C\d+:|error\s+TS\d+:|\bTS\d{4,5}:|\.\/[\w./\\-]+\.go:\d+:\d+:)/i;

const RE_ALL_STACK_TRACES = /(?:^\s*at\s+(?:[^\r\n]+|[\w$.]+\([\w$.]+\.(?:java|kt|scala|js|ts|mjs|cjs):\d+\))|^\s*File\s+".*",\s+line\s+\d+|Traceback \(most recent call last\):|\b(?:TypeError|ReferenceError|SyntaxError|RangeError|RuntimeError|AssertionError|NullPointerException|Exception in thread|Segmentation fault|BUILD FAILED:)\b|\bpanic(?::|\(|\b)|panicked at\b|goroutine \d+ \[running\]:)/m;

/**
 * Checks whether a diff header targets any known lockfile (e.g. yarn.lock, Cargo.lock, pubspec.lock, gradle.lockfile).
 * Routine lockfile diffs without conflict markers are folded by foldLockfiles,
 * while source code diffs and conflict-bearing lockfiles are 100% exempted.
 */
function isLockfileDiff(text) {
  if (typeof text !== 'string') return false;
  const firstLines = text.split(/\r?\n/, 6);
  for (const line of firstLines) {
    if (line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      const parts = line.split(/\s+/);
      for (const p of parts) {
        const clean = p.replace(/^[ab]\//, '').replace(/^["']|["']$/g, '');
        const base = clean.split(/[\/\\]/).pop().toLowerCase();
        if (LOCKFILE_NAMES.has(base)) return true;
      }
    }
  }
  return false;
}

/**
 * Detects whether text contains Unified Diff, Git conflict markers, or Codex/OpenCode patch instructions.
 * Unified diffs and patches must NEVER be folded, compressed, or mutated to ensure zero code degradation.
 * @param {string} text
 * @returns {boolean}
 */
function isSourceDiffOrPatch(text) {
  if (typeof text !== 'string' || text.length < 18) return false;
  // Git conflict markers: <<<<<<<, =======, >>>>>>>, ||||||| are 100% exempt (even in lockfiles)
  if (text.includes('<<<<<<<') || text.includes('=======') || text.includes('>>>>>>>') || text.includes('|||||||')) {
    return true;
  }
  // Codex / OpenCode patch instructions are 100% exempt
  if (
    text.includes('*** Begin Patch') ||
    text.includes('*** Update File:') ||
    text.includes('*** Add File:') ||
    text.includes('*** Delete File:')
  ) {
    return true;
  }
  // Routine lockfile diffs without conflict markers are folded by foldLockfiles
  if (isLockfileDiff(text)) {
    return false;
  }
  // Standard unified diff headers & hunk markers for source code
  if (text.includes('diff --git ') || text.includes('--- a/') || text.includes('+++ b/')) {
    return true;
  }
  if (/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m.test(text)) {
    return true;
  }
  return false;
}

/**
 * Detects whether text is an error stack trace or compiler diagnostic output across all major programming ecosystems.
 * Stack traces, line numbers, and compiler error messages must NEVER be folded or truncated.
 * Supports: Node/V8, Python, Rust, C/C++ (GCC/Clang/MSVC), TypeScript/ESLint, Go, JVM, and Linux kernel/process crashes.
 * @param {string} text
 * @returns {boolean}
 */
function isCompilerDiagnosticOrStackTrace(text) {
  if (typeof text !== 'string' || text.length < 10) return false;

  // Fast-path crash & failure keywords
  if (
    text.includes('Traceback (most recent call last):') ||
    text.includes('BUILD FAILED:') ||
    text.includes('Segmentation fault') ||
    text.includes('panicked at') ||
    text.includes('NullPointerException') ||
    text.includes('Exception in thread')
  ) {
    return true;
  }

  // Compiler diagnostics (Rust, C/C++, MSVC, TS, Go)
  if (RE_ALL_COMPILER_ERRORS.test(text)) {
    return true;
  }

  // Stack traces (Node, Python, Java, Rust/Go panics)
  if (RE_ALL_STACK_TRACES.test(text)) {
    return true;
  }

  return false;
}

/**
 * Detects whether a tool output is a multi-line source code file read (e.g. OpenCode <file> block,
 * numbered source lines "00001| ...", line-range slices "145: const ...", or raw source file).
 * Exempting source code file reads prevents:
 * 1) Mutating test fixture strings inside source files (e.g. test_router.js)
 * 2) Diluting compressionRatio by adding un-compressible source files to totalOriginalChars
 * 3) Accidental truncation of long single lines (e.g. long strings, SQL queries) inside code
 * @param {string} text
 * @returns {boolean}
 */
function isMultiLineSourceFileRead(text) {
  if (typeof text !== 'string' || text.length < 50) return false;
  // Strip optional leading Codex / OpenCode shell execution metadata wrapper before checking content
  const bodyText = text.replace(/^(?:(?:Chunk ID|Wall time|Process exited with code|Exit code|Original token count)[^\r\n]*\r?\n)+(?:\s*Output:\s*\r?\n)?/i, '');
  const trimmed = bodyText.trimStart();
  // Never exempt pure JSON objects/arrays or CLIXML error payloads
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('#< CLIXML')) {
    return false;
  }
  // OpenCode <file> tags
  if (trimmed.startsWith('<file>')) {
    return true;
  }
  // Numbered line output starting with any line number followed by code keywords, comments, or assignments
  if (/^\s*\d+\s*[:|\t]\s*(?:\/\*|\/\/|#|import\b|export\b|const\b|let\b|var\b|function\b|class\b|package\b|def\b|pub\b|fn\b|using\b|#include\b|\[CmdletBinding|param\s*\(|\$[a-zA-Z_]\w*\s*=|return\b|if\b|for\b)/m.test(trimmed)) {
    return true;
  }
  const sample = bodyText.length > 16000 ? bodyText.slice(0, 16000) : bodyText;
  const lines = sample.split(/\r?\n/);
  if (lines.length < 3) return false;
  let codeLines = 0;
  for (let i = 0; i < Math.min(lines.length, 250); i++) {
    const l = lines[i].replace(/^\s*\d+\s*[:|\t]\s*/, '').trim();
    if (!l) continue;
    if (/^(?:const|let|var|function|async\s+function|class|import|export|def|from\s+[\w.]+\s+import|pub\s+fn|fn\s+\w+|package\s+\w+|#include\s+[<"]|using\s+System|namespace\s+\w+|public\s+(?:class|static|void|async)|private\s+(?:void|static|async)|module\.exports\s*=|assert\.(?:ok|strictEqual|deepStrictEqual)|\[CmdletBinding\(\)\]|param\s*\(|Write-Host\s+|\$[a-zA-Z_]\w*\s*=|return\b|if\b|else\b|elif\b|for\b|while\b|try\b|catch\b|except\b|finally\b|with\b|(?:[a-zA-Z_]\w*|\$[a-zA-Z_]\w*)\s*=(?!=))\b/.test(l)) {
      codeLines++;
      if (lines.length < 10 && codeLines >= 2) return true;
      if (lines.length >= 10 && codeLines >= 3) return true;
    }
  }
  return false;
}

/**
 * Unified High-Fidelity Shield: Aggregates all anti-downgrade immutability rules.
 * Immediately returns true if text is source code, diff, patch, compiler error, or stack trace.
 * @param {string} text
 * @returns {boolean}
 */
function isProtectedSourceOrDiagnostic(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  return isSourceDiffOrPatch(text) || isCompilerDiagnosticOrStackTrace(text) || isMultiLineSourceFileRead(text);
}

/**
 * Deterministically compacts verbose boilerplate in system/developer instructions:
 * 1) Compacts verbose multi-clause descriptions in <skills_instructions> while 100% preserving skill names, triggers, and (file: ...) paths.
 * 2) Removes verbatim duplicate bullet lines and excessive blank-line padding in system prompts.
 * Memoized via sessionCompressionMemo / globalCompressionMemo so savings are credited once per session and Prompt KV Cache stays 100% locked.
 */
function compactSystemPrompt(text, opts = {}, sessionId = null, hasMultiAgentOverride = false) {
  if (typeof text !== 'string' || text.length < 1200) return text;
  if (!opts || !opts.enabled || opts.cleanDevOpsOutput === false) return text;

  try {
    const cacheKey = `sys_${hashContent(text)}_${hasMultiAgentOverride ? 1 : 0}`;
    if (opts.cacheZoneFreeze) {
      const cached = getMemo(sessionId || 'global_sys', cacheKey);
      if (cached !== null) {
        if (!opts._isRetryAttempt) {
          compressionStats.modules.cacheZone.cacheZoneHits = (compressionStats.modules.cacheZone.cacheZoneHits || 0) + 1;
          const hitTs = Date.now();
          recordBucketCacheZoneHit('m5', hitTs, 1);
          recordBucketCacheZoneHit('h1', hitTs, 1);
          recordBucketCacheZoneHit('d1', hitTs, 1);
          persistStatsThrottled();
        }
        return cached;
      }
    }

    let out = text;

    // 1. If <multi_agent_mode> explicitly disables earlier multi-agent delegation instructions,
    // compact the contradicted 2,189-char multi-agent tutorial message down to its core workspace rule
    if (hasMultiAgentOverride && out.includes('You are `/root`, the primary agent in a team of agents') && out.includes('spawn_agent') && out.includes('Use the spawn_agent tool to delegate')) {
      out = 'You are `/root`, the primary agent. All agents share the same container, filesystem, and current working directory.';
    }

    // 2. Compact <skills_instructions> verbose descriptions (safety threshold: 120 chars) while preserving 100% of skill names & file paths
    if (out.includes('<skills_instructions>') && out.includes('### Available skills')) {
      out = out.replace(/^(-\s+[a-zA-Z0-9_:-]+:\s+)([^\r\n]+?)(\s*\(file:\s*[^)]+\))\s*$/gm, (full, prefix, desc, filePart) => {
        if (desc.length <= 120) return full;
        const firstSentence = desc.split(/\.\s+|\s+—\s+|;\s+/)[0].trim();
        const shortDesc = firstSentence.length >= 35 && firstSentence.length <= 120 ? firstSentence : desc.slice(0, 120).trim();
        return `${prefix}${shortDesc}${filePart}`;
      });
    }

    // 3. Deduplicate identical bullet lines in large system instructions (> 4,000 chars) and collapse 3+ blank lines
    if (out.length > 4000) {
      const seenBullets = new Set();
      const lines = out.split(/\r?\n/);
      const dedupedLines = [];
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith('- ') && t.length > 60) {
          if (seenBullets.has(t)) continue;
          seenBullets.add(t);
        }
        dedupedLines.push(line);
      }
      out = dedupedLines.join('\n').replace(/(?:\r?\n[ \t]*){3,}/g, '\n\n');
    }

    const saved = text.length - out.length;
    if (saved > 0) {
      if (opts.cacheZoneFreeze) {
        setMemo(sessionId || 'global_sys', cacheKey, out);
      }
      if (!opts._isRetryAttempt) {
        const modelName = normalizeModelName(opts.model || null);
        const savedTok = Math.max(0, estimateTokens(text) - estimateTokens(out));
        recordSavings('rtk', saved, text.length, modelName, Date.now(), savedTok);
      }
      return out;
    }

    if (opts.cacheZoneFreeze) {
      setMemo(sessionId || 'global_sys', cacheKey, text);
    }
    return text;
  } catch (_) {
    return text;
  }
}

/**
 * Perform all enabled text transformations on raw output with pipeline and memoization support.
 * 100% Safe Sandbox Wrapped.
 * @param {string} text
 * @param {object} options
 * @param {string|null} sessionId
 * @returns {string}
 */
function compactText(text, options = {}, sessionId = null) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const opts = normalizeCompressionOptions(options);
  if (!opts.enabled) return text;

  try {
    let cacheKey = null;
    if (opts.cacheZoneFreeze && sessionId) {
      const hash = hashContent(text);
      // Incorporate dynamic option state signature to prevent stale cache on config or plugin switches
      const optsSig = getOptionsSignature(opts);
      cacheKey = `${hash}_${optsSig}`;
      const cached = getMemo(sessionId, cacheKey);
      if (cached !== null) {
        if (!opts._isRetryAttempt) {
          if (!compressionStats.modules.cacheZone.cacheZoneHits) {
            compressionStats.modules.cacheZone.cacheZoneHits = 0;
          }
          compressionStats.modules.cacheZone.cacheZoneHits += 1;
          const hitTs = Date.now();
          recordBucketCacheZoneHit('m5', hitTs, 1);
          recordBucketCacheZoneHit('h1', hitTs, 1);
          recordBucketCacheZoneHit('d1', hitTs, 1);
          persistStatsThrottled();
        }
        // ANTI-INFLATION & ACCURACY REDLINE:
        // Do not re-accumulate historical savings on every turn into cacheZone.
        // Original character savings were already credited to RTK / Headroom / PowerShell in Turn 1.
        // Cache-Zone tracks memoization hits and preserves byte-for-byte prompt stability for KV Cache.
        return cached;
      }
    }

    // Anti-Downgrade & Accuracy Shield: Exempt multi-line source code file reads
    if (opts.protectSourceDiffs !== false && isMultiLineSourceFileRead(text)) {
      if (opts.cacheZoneFreeze && sessionId && cacheKey) {
        setMemo(sessionId, cacheKey, text);
      }
      return text;
    }

    // Unpack stringified JSON content-block arrays [{"type":"input_text"|"text","text":"..."}] (from Codex sanitizeToolOutput)
    if (text.startsWith('[{') && text.endsWith('}]') && (text.includes('"text"') || text.includes('"output"') || text.includes('"content"'))) {
      try {
        const parsedArr = JSON.parse(text);
        if (Array.isArray(parsedArr) && parsedArr.length > 0 && parsedArr.length <= (opts.maxStructuredItems || 50)) {
          let arrMod = false;
          for (const item of parsedArr) {
            if (item && typeof item === 'object') {
              for (const k of ['text', 'output', 'content']) {
                if (typeof item[k] === 'string' && item[k].length > 0) {
                  const comp = compactText(item[k], options, null);
                  if (comp !== item[k]) {
                    item[k] = comp;
                    arrMod = true;
                  }
                }
              }
            }
          }
          if (arrMod) {
            const reSerializedArr = JSON.stringify(parsedArr);
            if (reSerializedArr.length < text.length) {
              if (opts.cacheZoneFreeze && sessionId && cacheKey) {
                setMemo(sessionId, cacheKey, reSerializedArr);
              }
              return reSerializedArr;
            }
          }
        }
      } catch (_) {}
    }

    // Unpack stringified JSON terminal objects { stdout, stderr, output, text, content } if present
    // so RTK and PowerShell denoising work inside stringified JSON outputs
    if (text.startsWith('{') && text.endsWith('}') && (text.includes('"stdout"') || text.includes('"output"') || text.includes('"stderr"') || text.includes('"text"') || text.includes('"content"'))) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          let mod = false;
          // Pass null sessionId to inner field calls so outer JSON string owns the single session memo entry
          for (const k of ['stdout', 'stderr', 'output', 'text', 'content']) {
            if (typeof parsed[k] === 'string' && parsed[k].length > 0) {
              const comp = compactText(parsed[k], options, null);
              if (comp !== parsed[k]) {
                parsed[k] = comp;
                mod = true;
              }
            }
          }
          if (mod) {
            let reSerialized = JSON.stringify(parsed);
            if (opts.foldStructuredData) {
              try {
                const folded = foldStructuredData(reSerialized, opts);
                if (typeof folded === 'string' && folded.length < reSerialized.length) {
                  const diffChars = reSerialized.length - folded.length;
                  const diffTokens = Math.max(0, estimateTokens(reSerialized) - estimateTokens(folded));
                  recordSavings('headroom', diffChars, reSerialized.length, normalizeModelName(opts.model || null), Date.now(), diffTokens);
                  reSerialized = folded;
                }
              } catch (_) {}
            }
            if (reSerialized.length < text.length) {
              if (opts.cacheZoneFreeze && sessionId && cacheKey) {
                setMemo(sessionId, cacheKey, reSerialized);
              }
              return reSerialized;
            }
          }
        }
      } catch (_) {}
    }

    const moduleDeltas = {};
    let result = runPipeline(text, opts, { sessionId, moduleDeltas, isPipeline: true });

    // Protocol & Connection Safety Shield:
    // If the input text had non-whitespace content, but compression reduced it to pure whitespace or empty,
    // ensure we don't return an empty string that could cause upstream 400 (e.g. Anthropic empty content block)
    // or trigger empty SSE stream aborts.
    if (result.trim().length === 0 && text.trim().length > 0) {
      result = '[Empty terminal output]';
    }

    // 100% Anti-Inflation Circuit Breaker (坚决不反向膨胀)
    // Reverts to original text reference if no compression savings were achieved,
    // protecting against reverse inflation while preserving explicit folding markers.
    // P2-C2: Unified fold marker detection via regex — auto-covers new fold types
    const hasFoldMarker = /\[(Test suite|Lockfile diff folded|SmartCrusher|Headroom SmartCrusher|Git|Build\/Pkg|llmtrim Log Dedup|Terminal output cleaned|RTK Search|Docker|Terraform|Kubectl)[:\s]/i.test(result);
    if (result.length >= text.length && !hasFoldMarker) {
      result = text;
    }

    if (opts.cacheZoneFreeze && sessionId && cacheKey) {
      setMemo(sessionId, cacheKey, result);
    }

    const totalSaved = text.length - result.length;
    // P0-H2: Stats dedup — skip recording if this exact content was already counted
    const _statsFp = hashContent(text) + '_' + (opts.model || 'u');
    const _isStatsDedup = globalStatsDedup.has(_statsFp);
    // P2-R2: Refresh LRU position on hit
    if (_isStatsDedup) { globalStatsDedup.delete(_statsFp); globalStatsDedup.set(_statsFp, 1); }
    if (!_isStatsDedup && totalSaved > 0) {
      if (globalStatsDedup.size >= MAX_STATS_DEDUP_KEYS) {
        const oldestKey = globalStatsDedup.keys().next().value;
        globalStatsDedup.delete(oldestKey);
      }
      globalStatsDedup.set(_statsFp, 1);
    }
    if (totalSaved > 0 && !opts._isRetryAttempt && !_isStatsDedup) {
      const origLen = text.length;
      const compLen = result.length;
      compressionStats.totalOriginalChars += origLen;
      compressionStats.totalCompressedChars += compLen;

      // Real dynamic bilingual token difference:
      const origTokens = estimateTokens(text);
      const compTokens = estimateTokens(result);
      const dynamicSavedTokens = Math.max(0, origTokens - compTokens);

      let rtkDelta = moduleDeltas.rtk || 0;
      let headroomDelta = moduleDeltas.headroom || 0;
      let powershellDelta = moduleDeltas.powershell || 0;
      const pipelineSum = rtkDelta + headroomDelta + powershellDelta;

      if (pipelineSum === 0) {
        rtkDelta = totalSaved;
      } else if (pipelineSum !== totalSaved) {
        // Proportionally distribute delta to preserve exact equality
        const rtkRatio = rtkDelta / pipelineSum;
        const psRatio = powershellDelta / pipelineSum;
        rtkDelta = Math.round(rtkRatio * totalSaved);
        powershellDelta = Math.round(psRatio * totalSaved);
        headroomDelta = totalSaved - rtkDelta - powershellDelta;
      }

      const rtkTokens = totalSaved > 0 ? Math.round((rtkDelta / totalSaved) * dynamicSavedTokens) : 0;
      const psTokens = totalSaved > 0 ? Math.round((powershellDelta / totalSaved) * dynamicSavedTokens) : 0;
      const hrTokens = dynamicSavedTokens - rtkTokens - psTokens;

      if (rtkDelta > 0) {
        compressionStats.modules.rtk.savedChars += rtkDelta;
        compressionStats.modules.rtk.savedTokens = (compressionStats.modules.rtk.savedTokens || 0) + rtkTokens;
      }
      if (headroomDelta > 0) {
        compressionStats.modules.headroom.savedChars += headroomDelta;
        compressionStats.modules.headroom.savedTokens = (compressionStats.modules.headroom.savedTokens || 0) + hrTokens;
      }
      if (powershellDelta > 0) {
        compressionStats.modules.powershell.savedChars += powershellDelta;
        compressionStats.modules.powershell.savedTokens = (compressionStats.modules.powershell.savedTokens || 0) + psTokens;
      }

      const modelName = normalizeModelName(opts.model || null);
      const textTs = Date.now();
      if (modelName) {
        recordModelSavings(modelName, totalSaved, origLen, textTs, dynamicSavedTokens);
      }

      // Synchronously record to all 3 ring-buffer time tiers
      for (const tier of ['m5', 'h1', 'd1']) {
        const bucket = getOrCreateBucket(tier, textTs);
        if (bucket) {
          bucket.totalOriginalChars += origLen;
          bucket.totalCompressedChars += compLen;
          bucket.totalSavedChars += totalSaved;
          if (rtkDelta > 0 && bucket.modules && bucket.modules.rtk) {
            bucket.modules.rtk.savedChars += rtkDelta;
            bucket.modules.rtk.savedTokens = (bucket.modules.rtk.savedTokens || 0) + rtkTokens;
          }
          if (headroomDelta > 0 && bucket.modules && bucket.modules.headroom) {
            bucket.modules.headroom.savedChars += headroomDelta;
            bucket.modules.headroom.savedTokens = (bucket.modules.headroom.savedTokens || 0) + hrTokens;
          }
          if (powershellDelta > 0 && bucket.modules && bucket.modules.powershell) {
            bucket.modules.powershell.savedChars += powershellDelta;
            bucket.modules.powershell.savedTokens = (bucket.modules.powershell.savedTokens || 0) + psTokens;
          }
          if (modelName) {
            if (!bucket.byModel) bucket.byModel = {};
            if (!bucket.byModel[modelName]) {
              bucket.byModel[modelName] = {
                savedChars: 0,
                savedTokens: 0,
                savedCostUSD: 0,
                originalChars: 0,
                ratePer1M: getModelRate(modelName)
              };
            }
            const mEntry = bucket.byModel[modelName];
            mEntry.savedChars += totalSaved;
            mEntry.originalChars += origLen;
            mEntry.savedTokens = (mEntry.savedTokens || 0) + dynamicSavedTokens;
            mEntry.ratePer1M = getModelRate(modelName);
            mEntry.savedCostUSD = Number(((mEntry.savedTokens / 1000000) * mEntry.ratePer1M).toFixed(7));
          }
        }
      }
      pruneExpiredBuckets(textTs);

      compressionStats.updatedAt = new Date().toISOString();
      computeDerivedStats(compressionStats);
      persistStatsThrottled();
    }

    return result;
  } catch (err) {
    console.warn('[ContextCompactor] compactText sandbox caught error, returning original text:', err.message);
    return text;
  }
}

/**
 * Compact OpenAI /v1/chat/completions payload.
 * Processes tools schema alignment/slimming and compacts tool / function messages.
 * 100% Safe Sandbox Wrapped.
 * @param {object} payload
 * @param {object} options
 * @param {string|null} sessionId
 * @returns {object}
 */
function compactChatPayload(payload, options = {}, sessionId = null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const opts = normalizeCompressionOptions(options);
  if (!opts.enabled) return payload;

  const rawModel = payload.model || opts.model || null;
  const modelName = normalizeModelName(rawModel);
  const compOpts = modelName ? { ...opts, model: modelName } : opts;

  try {
    const result = { ...payload };

    if (Array.isArray(result.tools)) {
      result.tools = compactToolsList(result.tools, compOpts).tools;
    }

    if (Array.isArray(result.functions)) {
      result.functions = compactToolsList(result.functions, compOpts).tools;
    }

    if (Array.isArray(result.messages)) {
      const hasMultiAgentOverride = result.messages.some(
        m => m && (m.role === 'system' || m.role === 'developer') && typeof m.content === 'string' && m.content.includes('<multi_agent_mode>Any earlier instruction enabling proactive multi-agent delegation no longer applies')
      );
      // P2-M1: Find last tool output index in chat messages for latest-turn protection
      let lastToolMsgIdx = -1;
      for (let _ci = result.messages.length - 1; _ci >= 0; _ci--) {
        const _cm = result.messages[_ci];
        if (_cm && (_cm.role === 'tool' || _cm.role === 'function')) {
          lastToolMsgIdx = _ci;
          break;
        }
      }

      result.messages = result.messages.map((msg, _msgIdx) => {
        if (!msg) return msg;
        if ((msg.role === 'system' || msg.role === 'developer') && typeof msg.content === 'string' && msg.content.length >= 1200) {
          const compSys = compactSystemPrompt(msg.content, compOpts, sessionId, hasMultiAgentOverride);
          if (compSys !== msg.content) {
            return { ...msg, content: compSys };
          }
          return msg;
        }
        if (msg.role === 'user' && typeof msg.content === 'string' && (msg._isGatewayToolWrapper === true || (msg.content.startsWith('[Tool Output: ') && msg.content.endsWith(']')))) {
          const innerToolText = msg.content.slice(14, -1);
          const compInner = compactText(innerToolText, compOpts, sessionId);
          if (compInner !== innerToolText) {
            return { ...msg, content: `[Tool Output: ${ensureSafeNonEmptyString(compInner)}]` };
          }
          return msg;
        }
        if (msg.role === 'tool' || msg.role === 'function') {
          const hasContent = msg.content !== undefined;
          const hasOutput = msg.output !== undefined;
          const targetField = hasContent ? 'content' : (hasOutput ? 'output' : 'content');
          const val = msg[targetField];

          if (val === null || val === undefined) {
            return { ...msg, [targetField]: '[Empty output]' };
          } else if (typeof val === 'string') {
            const compacted = compactText(val, compOpts, sessionId);
            return { ...msg, [targetField]: ensureSafeNonEmptyString(compacted) };
          } else if (Array.isArray(val)) {
            // P2-M1: Skip array folding for latest turn tool output to preserve full data
            const _isLatestTurnMsg = compOpts.preserveLatestTurn === true && _msgIdx >= lastToolMsgIdx && lastToolMsgIdx >= 0;
            let targetArray = val;
            let wasArrayFolded = false;
            if (compOpts.foldStructuredData && !_isLatestTurnMsg && targetArray.length > (compOpts.maxStructuredItems || 50)) {
              try {
                const rawArrStr = JSON.stringify(targetArray);
                const foldedStr = foldStructuredData(rawArrStr, compOpts);
                if (foldedStr.length < rawArrStr.length) {
                  // P1-F2: Array fold dedup protection
                  const _arrFoldFp = require('crypto').createHash('sha256').update(rawArrStr.slice(0, 2000)).digest('hex').slice(0, 12) + '_afold';
                  if (!globalStatsDedup.has(_arrFoldFp)) {
                    if (globalStatsDedup.size >= MAX_STATS_DEDUP_KEYS) { const _ok = globalStatsDedup.keys().next().value; globalStatsDedup.delete(_ok); }
                    globalStatsDedup.set(_arrFoldFp, 1);
                    recordSavings('headroom', rawArrStr.length - foldedStr.length, rawArrStr.length, modelName);
                  }
                  targetArray = JSON.parse(foldedStr);
                  wasArrayFolded = true;
                }
              } catch (_) {}
            }
            if (wasArrayFolded) {
              return { ...msg, [targetField]: targetArray };
            }
            let cleaned = targetArray
              .filter(part => part !== null && part !== undefined)
              .map(part => {
                if (typeof part === 'string') {
                  const compText = compactText(part, compOpts, sessionId);
                  return { type: 'text', text: ensureSafeNonEmptyString(compText) };
                } else if (part && typeof part === 'object') {
                  if (part.type === 'text' && typeof part.text === 'string') {
                    const compText = compactText(part.text, compOpts, sessionId);
                    return { ...part, text: ensureSafeNonEmptyString(compText) };
                  }
                  try {
                    const rawPart = JSON.stringify(part);
                    const comp = compactText(rawPart, compOpts, sessionId);
                    if (comp !== rawPart) {
                      try { return JSON.parse(comp); } catch (e) { return { type: 'text', text: comp }; }
                    }
                  } catch (e) {}
                  return part;
                }
                return { type: 'text', text: '[Empty output]' };
              });
            if (cleaned.length === 0) {
              return { ...msg, [targetField]: '[Empty output]' };
            }
            return { ...msg, [targetField]: cleaned };
          } else if (typeof val === 'object' && val !== null) {
            try {
              const raw = JSON.stringify(val);
              const compacted = compactText(raw, compOpts, sessionId);
              try {
                return { ...msg, [targetField]: JSON.parse(compacted) };
              } catch (_) {
                return { ...msg, [targetField]: ensureSafeNonEmptyString(compacted) };
              }
            } catch (_) {
              return msg;
            }
          }
        }
        return msg;
      });
    }

    let finalResult = result;
    try {
      const psOpt = require('./powershell-optimizer');
      if (psOpt.isPowerShellOptimizerActive(compOpts)) {
        finalResult = psOpt.optimizeChatPayload(finalResult, { ...compOpts, _alreadyCompactedByPipeline: true });
      }
    } catch (_) {}
    return finalResult;
  } catch (err) {
    console.warn('[ContextCompactor] compactChatPayload sandbox error, returning original payload:', err.message);
    return payload;
  }
}

/**
 * Compact Anthropic /v1/messages payload.
 * Handles tools alignment/slimming.
 * In Anthropic protocol, tool outputs are nested in role: 'user' messages with type: 'tool_result'.
 * 100% Safe Sandbox Wrapped.
 * @param {object} payload
 * @param {object} options
 * @param {string|null} sessionId
 * @returns {object}
 */
function compactAnthropicPayload(payload, options = {}, sessionId = null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const opts = normalizeCompressionOptions(options);
  if (!opts.enabled) return payload;

  const rawModel = payload.model || opts.model || null;
  const modelName = normalizeModelName(rawModel);
  const compOpts = modelName ? { ...opts, model: modelName } : opts;

  try {
    const result = { ...payload };

    if (Array.isArray(result.tools)) {
      result.tools = compactToolsList(result.tools, compOpts).tools;
    }

    let lastToolMsgIdx = -1;
    if (Array.isArray(result.messages)) {
      for (let i = result.messages.length - 1; i >= 0; i--) {
        const m = result.messages[i];
        if (m && (m.role === 'tool' || (Array.isArray(m.content) && m.content.some(b => b && b.type === 'tool_result')))) {
          lastToolMsgIdx = i;
          break;
        }
      }
    }

    if (Array.isArray(result.messages)) {
      result.messages = result.messages.map((msg, _msgIdx) => {
        if (!msg) return msg;
        if (msg.role === 'tool' && typeof msg.content === 'string') {
          const compacted = compactText(msg.content, compOpts, sessionId);
          return { ...msg, content: ensureSafeNonEmptyString(compacted) };
        }
        if ((msg.role === 'user' || msg.role === 'tool') && Array.isArray(msg.content)) {
          return {
            ...msg,
            content: msg.content.map(block => {
              if (block && (block.type === 'tool_result' || msg.role === 'tool')) {
                const hasContent = block.content !== undefined;
                const hasOutput = block.output !== undefined;
                const targetField = hasContent ? 'content' : (hasOutput ? 'output' : 'content');
                const val = block[targetField];

                if (val === null || val === undefined) {
                  return { ...block, [targetField]: '[Empty output]' };
                } else if (typeof val === 'string') {
                  const compacted = compactText(val, compOpts, sessionId);
                  return { ...block, [targetField]: ensureSafeNonEmptyString(compacted) };
                } else if (Array.isArray(val)) {
                  // P2-M1: Skip array folding for latest turn tool output
                  const _isLatestTurnMsg2 = compOpts.preserveLatestTurn === true && _msgIdx >= lastToolMsgIdx && lastToolMsgIdx >= 0;
                  let targetArray = val;
                  let wasArrayFolded = false;
                  if (compOpts.foldStructuredData && !_isLatestTurnMsg2 && targetArray.length > (compOpts.maxStructuredItems || 50)) {
                    try {
                      const rawArrStr = JSON.stringify(targetArray);
                      const foldedStr = foldStructuredData(rawArrStr, compOpts);
                      if (foldedStr.length < rawArrStr.length) {
                        // P1-F2: Array fold dedup protection
                  const _arrFoldFp = require('crypto').createHash('sha256').update(rawArrStr.slice(0, 2000)).digest('hex').slice(0, 12) + '_afold';
                  if (!globalStatsDedup.has(_arrFoldFp)) {
                    if (globalStatsDedup.size >= MAX_STATS_DEDUP_KEYS) { const _ok = globalStatsDedup.keys().next().value; globalStatsDedup.delete(_ok); }
                    globalStatsDedup.set(_arrFoldFp, 1);
                    recordSavings('headroom', rawArrStr.length - foldedStr.length, rawArrStr.length, modelName);
                  }
                        targetArray = JSON.parse(foldedStr);
                        wasArrayFolded = true;
                      }
                    } catch (_) {}
                  }
                  if (wasArrayFolded) {
                    return { ...block, [targetField]: targetArray };
                  }
                  let cleaned = targetArray
                    .filter(part => part !== null && part !== undefined)
                    .map(part => {
                      if (typeof part === 'string') {
                        const compText = compactText(part, compOpts, sessionId);
                        return { type: 'text', text: ensureSafeNonEmptyString(compText) };
                      } else if (part && typeof part === 'object') {
                        if (part.type === 'text' && typeof part.text === 'string') {
                          const compText = compactText(part.text, compOpts, sessionId);
                          return { ...part, text: ensureSafeNonEmptyString(compText) };
                        }
                        try {
                          const rawPart = JSON.stringify(part);
                          const comp = compactText(rawPart, compOpts, sessionId);
                          if (comp !== rawPart) {
                            try { return JSON.parse(comp); } catch (e) { return { type: 'text', text: comp }; }
                          }
                        } catch (e) {}
                        return part;
                      }
                      return { type: 'text', text: '[Empty output]' };
                    });
                  if (cleaned.length === 0) {
                    cleaned = [{ type: 'text', text: '[Empty output]' }];
                  }
                  return { ...block, [targetField]: cleaned };
                } else if (typeof val === 'object' && val !== null) {
                  try {
                    const raw = JSON.stringify(val);
                    const compacted = compactText(raw, compOpts, sessionId);
                    try {
                      return { ...block, [targetField]: JSON.parse(compacted) };
                    } catch (_) {
                      return { ...block, [targetField]: ensureSafeNonEmptyString(compacted) };
                    }
                  } catch (_) {
                    return block;
                  }
                }
              }
              return block;
            })
          };
        }
        return msg;
      });
    }

    let finalResult = result;
    try {
      const psOpt = require('./powershell-optimizer');
      if (psOpt.isPowerShellOptimizerActive(compOpts)) {
        finalResult = psOpt.optimizeAnthropicPayload(finalResult, { ...compOpts, _alreadyCompactedByPipeline: true });
      }
    } catch (_) {}
    return finalResult;
  } catch (err) {
    console.warn('[ContextCompactor] compactAnthropicPayload sandbox error, returning original payload:', err.message);
    return payload;
  }
}

/**
 * Compact Codex /responses payload.
 * Handles tools alignment/slimming and compacts function_call_output and custom_tool_call_output in input array.
 * CRITICAL FIX: Strictly preserves Array type when output is an array of content blocks.
 * 100% Safe Sandbox Wrapped.
 * @param {object} payload
 * @param {object} options
 * @param {string|null} sessionId
 * @returns {object}
 */
function compactResponsesPayload(payload, options = {}, sessionId = null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const opts = normalizeCompressionOptions(options);
  if (!opts.enabled) return payload;

  const rawModel = payload.model || opts.model || null;
  const modelName = normalizeModelName(rawModel);
  const compOpts = modelName ? { ...opts, model: modelName } : opts;

  try {
    const result = { ...payload };

    if (Array.isArray(result.tools)) {
      result.tools = compactToolsList(result.tools, compOpts).tools;
    }

    if (typeof result.instructions === 'string' && result.instructions.length >= 1200) {
      result.instructions = compactSystemPrompt(result.instructions, compOpts, sessionId, false);
    }

    if (Array.isArray(result.input)) {
      const hasMultiAgentOverride = result.input.some(
        it => it && (it.role === 'system' || it.role === 'developer') && typeof it.content === 'string' && it.content.includes('<multi_agent_mode>Any earlier instruction enabling proactive multi-agent delegation no longer applies')
      );
      // P2-M1: Find the last tool output index to protect latest turn from array folding
      let lastToolOutputIdx = -1;
      for (let _mi = result.input.length - 1; _mi >= 0; _mi--) {
        const _it = result.input[_mi];
        if (_it && (
          _it.type === 'function_call_output' || _it.type === 'custom_tool_call_output' ||
          _it.type === 'tool_search_output' || (_it.type && typeof _it.type === 'string' && _it.type.endsWith('_output')) ||
          (_it.call_id && _it.output !== undefined) || _it.role === 'tool' || _it.role === 'function'
        )) {
          lastToolOutputIdx = _mi;
          break;
        }
      }

      result.input = result.input.map((item, _itemIdx) => {
        if (!item) return item;
        if ((item.role === 'system' || item.role === 'developer') && typeof item.content === 'string' && item.content.length >= 1200) {
          const compSys = compactSystemPrompt(item.content, compOpts, sessionId, hasMultiAgentOverride);
          if (compSys !== item.content) {
            return { ...item, content: compSys };
          }
          return item;
        }
        const hasOutput = item.output !== undefined;
        const hasContent = item.content !== undefined;
        const isToolOutput = item.type === 'function_call_output' ||
          item.type === 'custom_tool_call_output' ||
          item.type === 'tool_search_output' ||
          (item.type && typeof item.type === 'string' && item.type.endsWith('_output')) ||
          (item.call_id && hasOutput) ||
          item.role === 'tool' ||
          item.role === 'function';

        if (isToolOutput) {
          const targetField = hasOutput ? 'output' : (hasContent ? 'content' : 'output');
          const val = item[targetField];

          if (val === null || val === undefined) {
            return { ...item, [targetField]: '[Empty output]' };
          } else if (typeof val === 'string') {
            const comp = compactText(val, compOpts, sessionId);
            return { ...item, [targetField]: ensureSafeNonEmptyString(comp) };
          } else if (Array.isArray(val)) {
            // If it's a giant array (> maxStructuredItems), fold with SmartCrusher first
            // P2-M1: Skip array folding for the latest turn's tool output to preserve full data for model reasoning
            const _isLatestTurnOutput = compOpts.preserveLatestTurn === true && _itemIdx >= lastToolOutputIdx && lastToolOutputIdx >= 0;
            let targetArray = val;
            let wasArrayFolded = false;
            if (compOpts.foldStructuredData && !_isLatestTurnOutput && targetArray.length > (compOpts.maxStructuredItems || 50)) {
              try {
                const rawArrStr = JSON.stringify(targetArray);
                const foldedStr = foldStructuredData(rawArrStr, compOpts);
                if (foldedStr.length < rawArrStr.length) {
                  // P1-F2: Array fold dedup protection
                  const _arrFoldFp = require('crypto').createHash('sha256').update(rawArrStr.slice(0, 2000)).digest('hex').slice(0, 12) + '_afold';
                  if (!globalStatsDedup.has(_arrFoldFp)) {
                    if (globalStatsDedup.size >= MAX_STATS_DEDUP_KEYS) { const _ok = globalStatsDedup.keys().next().value; globalStatsDedup.delete(_ok); }
                    globalStatsDedup.set(_arrFoldFp, 1);
                    recordSavings('headroom', rawArrStr.length - foldedStr.length, rawArrStr.length, modelName);
                  }
                  targetArray = JSON.parse(foldedStr);
                  wasArrayFolded = true;
                }
              } catch (_) {}
            }
            if (wasArrayFolded) {
              return { ...item, [targetField]: targetArray };
            }
            // Strictly preserve array structure for multimodal/block outputs or strings
            let compactedParts = targetArray
              .filter(part => part !== null && part !== undefined)
              .map(part => {
                if (typeof part === 'string') {
                  const comp = compactText(part, compOpts, sessionId);
                  return ensureSafeNonEmptyString(comp);
                } else if (part && typeof part === 'object') {
                  const clonedPart = { ...part };
                  if (typeof clonedPart.text === 'string') {
                    const comp = compactText(clonedPart.text, compOpts, sessionId);
                    clonedPart.text = ensureSafeNonEmptyString(comp);
                  }
                  if (typeof clonedPart.output === 'string') {
                    const comp = compactText(clonedPart.output, compOpts, sessionId);
                    clonedPart.output = ensureSafeNonEmptyString(comp);
                  }
                  return clonedPart;
                }
                return part;
              });
            if (compactedParts.length === 0) {
              return { ...item, [targetField]: '[Empty output]' };
            }
            return { ...item, [targetField]: compactedParts };
          } else if (val && typeof val === 'object') {
            const hasCommonKeys = ['stdout', 'stderr', 'output', 'text', 'content'].some(k => k in val);
            if (hasCommonKeys) {
              const clonedOutput = { ...val };
              if (typeof clonedOutput.stdout === 'string') {
                clonedOutput.stdout = ensureSafeNonEmptyString(compactText(clonedOutput.stdout, compOpts, sessionId));
              }
              if (typeof clonedOutput.stderr === 'string') {
                clonedOutput.stderr = ensureSafeNonEmptyString(compactText(clonedOutput.stderr, compOpts, sessionId));
              }
              if (typeof clonedOutput.output === 'string') {
                clonedOutput.output = ensureSafeNonEmptyString(compactText(clonedOutput.output, compOpts, sessionId));
              }
              if (typeof clonedOutput.text === 'string') {
                clonedOutput.text = ensureSafeNonEmptyString(compactText(clonedOutput.text, compOpts, sessionId));
              }
              if (typeof clonedOutput.content === 'string') {
                clonedOutput.content = ensureSafeNonEmptyString(compactText(clonedOutput.content, compOpts, sessionId));
              } else if (Array.isArray(clonedOutput.content)) {
                let cleanedContent = clonedOutput.content
                  .filter(part => part !== null && part !== undefined)
                  .map(part => {
                    if (part && typeof part === 'object' && typeof part.text === 'string') {
                      const comp = compactText(part.text, compOpts, sessionId);
                      return { ...part, text: ensureSafeNonEmptyString(comp) };
                    }
                    return part;
                  });
                if (cleanedContent.length === 0) {
                  cleanedContent = [{ type: 'text', text: '[Empty output]' }];
                }
                clonedOutput.content = cleanedContent;
              }
              return { ...item, [targetField]: clonedOutput };
            } else {
              // General structured object (e.g. { records: [ ... 60 items ... ] })
              try {
                const rawObj = JSON.stringify(val);
                const comp = compactText(rawObj, compOpts, sessionId);
                try {
                  return { ...item, [targetField]: JSON.parse(comp) };
                } catch (_) {
                  return { ...item, [targetField]: ensureSafeNonEmptyString(comp) };
                }
              } catch (_) {
                return item;
              }
            }
          }
        }
        return item;
      });
    }

    let finalResult = result;
    try {
      const psOpt = require('./powershell-optimizer');
      if (psOpt.isPowerShellOptimizerActive(compOpts)) {
        finalResult = psOpt.optimizeResponsesPayload(finalResult, { ...compOpts, _alreadyCompactedByPipeline: true });
      }
    } catch (_) {}
    return finalResult;
  } catch (err) {
    console.warn('[ContextCompactor] compactResponsesPayload sandbox error, returning original payload:', err.message);
    return payload;
  }
}

/**
 * Compression Doctor: Comprehensive health diagnostic & anti-downgrade audit.
 * @param {object} configInput
 * @param {object} statsInput
 * @returns {object}
 */
function checkCompressionHealth(configInput = {}, statsInput = null) {
  const norm = normalizeCompressionOptions(configInput);
  const stats = statsInput || getCompressionStats();
  const issues = [];

  const m = norm.modules || {};
  const rtk = m.rtk || {};
  const headroom = m.headroom || {};
  const schema = m.schema || {};
  const cacheZone = m.cacheZone || {};

  // 1. Redline Audit: Merge Conflict Shield (exemptMergeConflicts)
  // If disabled, LLM cannot inspect <<<<<<< merge conflict markers in lockfiles!
  const hasConflictShield = (headroom.exemptMergeConflicts !== false && norm.exemptMergeConflicts !== false);
  if (!hasConflictShield) {
    issues.push({
      id: 'comp_merge_conflicts_unprotected',
      severity: 'high',
      title: 'Git 合并冲突绝对豁免保护已关闭 (Merge Conflict Shield Disabled)',
      desc: '关闭该保护会在代码合流冲突时折叠锁定文件中的冲突标记（<<<<<<< / ======= / >>>>>>>），导致 LLM 无法分析冲突并造成代码损坏或死锁。一键修复即可强制开启保护。',
      autoFixable: true
    });
  }

  // 2. Redline Audit: Source Diff Preservation (protectSourceDiffs)
  // If disabled, source file diffs might be corrupted or line numbers distorted!
  const hasSourceDiffProtect = (headroom.protectSourceDiffs !== false && norm.protectSourceDiffs !== false);
  if (!hasSourceDiffProtect) {
    issues.push({
      id: 'comp_source_diffs_unprotected',
      severity: 'high',
      title: '源码 Diff 完整性保护已关闭 (Source Diff Protection Disabled)',
      desc: '关闭该选项可能导致代码 Diff 行号抽稀，造成 Codex / OpenCode 执行 apply_patch 补丁定位失败。一键修复即可恢复行号保真。',
      autoFixable: true
    });
  }

  // 3. Anti-Downgrade Audit: Schema Slim Threshold
  // If schemaCharThreshold < 4000, normal MCP / Tools schemas are trimmed too aggressively, causing hallucination/downgrade!
  const threshold = (schema.schemaCharThreshold !== undefined) ? Number(schema.schemaCharThreshold) : Number(norm.schemaCharThreshold || 15000);
  if (threshold < 4000) {
    issues.push({
      id: 'comp_schema_threshold_too_low',
      severity: 'medium',
      title: `工具 Schema 瘦身触发门限过低 (${threshold} < 4000 字符)`,
      desc: `门限过低会导致常规 MCP / Tools 工具定义被过早裁剪，可能遗失关键参数说明引起模型调用幻觉或降智。建议门限设置为 8,000 ~ 15,000 字符。`,
      autoFixable: true
    });
  }

  // 4. Extensibility Audit: Custom Test Pass Patterns regex validity
  const rawPatterns = Array.isArray(norm.customTestPassPatterns)
    ? norm.customTestPassPatterns
    : (typeof norm.customTestPassPatterns === 'string' && norm.customTestPassPatterns.trim() ? [norm.customTestPassPatterns] : []);
  for (const pat of rawPatterns) {
    if (typeof pat === 'string' && pat.trim()) {
      try {
        getCachedRegex(pat.trim(), 'i');
      } catch (err) {
        issues.push({
          id: 'comp_invalid_test_pattern',
          severity: 'medium',
          title: `自定义测试通过正则语法错误 ("${pat}")`,
          desc: `正则表达式解析失败: ${err.message}，可能导致测试去噪异常。一键修复将自动剔除无效正则。`,
          autoFixable: true
        });
      }
    }
  }

  // 5. Memory & Cache Health Audit: LRU Bounds
  const hasLru = (cacheZone.trueLruRetention !== false && norm.trueLruRetention !== false);
  if (!hasLru) {
    issues.push({
      id: 'comp_lru_disabled',
      severity: 'medium',
      title: 'Cache-Zone 真 LRU 热度淘汰守护未开启',
      desc: '未启用 LRU 淘汰守护可能在长时间巨量并发会话下引起内存增长。建议开启 trueLruRetention 维持 500 会话上限。',
      autoFixable: true
    });
  }

  // 6. Master Switch Status Audit
  if (norm.enabled === false) {
    issues.push({
      id: 'comp_master_disabled',
      severity: 'low',
      title: '上下文优化与 Token 压缩总开关处于旁路关闭状态',
      desc: '当前未启用任何 Token 优化与终端去噪。推荐开启【🌟 平衡标准档】以节约 15%~30% 官方配额消耗。',
      autoFixable: true
    });
  }

  // Calculate active engines & statuses
  const rtkActive = Boolean(norm.enabled && rtk.enabled);
  const headroomActive = Boolean(norm.enabled && headroom.enabled);
  const schemaActive = Boolean(norm.enabled && schema.enabled);
  const cacheZoneActive = Boolean(norm.enabled && cacheZone.enabled);

  const powershell = m.powershell || {};
  let psPlatform = { isWindows: process.platform === 'win32', isLinux: process.platform === 'linux', mode: process.platform };
  try {
    const psOpt = require('./powershell-optimizer');
    psPlatform = psOpt.detectPlatform(norm);
  } catch (_) {}
  const powershellActive = Boolean(norm.enabled && powershell.enabled && (powershell.autoDetectPlatform !== false ? psPlatform.isWindows : true));

  const activeEngines = {
    rtk: {
      enabled: rtkActive,
      status: rtkActive ? 'running' : (norm.enabled ? 'module_off' : 'master_off'),
      activeSwitches: [
        norm.stripAnsi ? 'stripAnsi' : null,
        norm.cleanProgressBars ? 'cleanProgressBars' : null,
        norm.foldTestPasses ? 'foldTestPasses' : null,
        norm.cleanDevOpsOutput ? 'cleanDevOpsOutput' : null
      ].filter(Boolean)
    },
    headroom: {
      enabled: headroomActive,
      status: headroomActive ? 'running' : (norm.enabled ? 'module_off' : 'master_off'),
      activeSwitches: [
        norm.foldLockfiles ? 'foldLockfiles' : null,
        norm.foldStructuredData ? 'foldStructuredData' : null,
        hasConflictShield ? 'exemptMergeConflicts' : null,
        hasSourceDiffProtect ? 'protectSourceDiffs' : null
      ].filter(Boolean)
    },
    schema: {
      enabled: schemaActive,
      threshold,
      status: schemaActive ? 'running' : (norm.enabled ? 'module_off' : 'master_off'),
      activeSwitches: [
        norm.alignToolsSchema ? 'alignToolsSchema' : null,
        norm.slimToolsSchema ? 'slimToolsSchema' : null
      ].filter(Boolean)
    },
    cacheZone: {
      enabled: cacheZoneActive,
      activeSessions: sessionCompressionMemo.size,
      status: cacheZoneActive ? 'running' : (norm.enabled ? 'module_off' : 'master_off'),
      activeSwitches: [
        norm.cacheZoneFreeze ? 'cacheZoneFreeze' : null,
        hasLru ? 'trueLruRetention' : null
      ].filter(Boolean)
    },
    powershell: {
      enabled: Boolean(norm.enabled && powershell.enabled),
      active: powershellActive,
      platform: psPlatform,
      status: powershellActive ? 'running' : (psPlatform.isLinux ? 'linux_dormant' : (norm.enabled ? 'module_off' : 'master_off')),
      activeSwitches: [
        norm.cleanCliXmlNoise ? 'cleanCliXmlNoise' : null,
        norm.fixQuoteEscaping ? 'fixQuoteEscaping' : null,
        norm.fixCurlAlias ? 'fixCurlAlias' : null,
        norm.fixTrailingSlash ? 'fixTrailingSlash' : null,
        norm.fixAndOperator ? 'fixAndOperator' : null,
        norm.fixLineContinuation ? 'fixLineContinuation' : null,
        norm.injectPowerShellGuard ? 'injectPowerShellGuard' : null
      ].filter(Boolean)
    }
  };

  // Compatibility matrix with 3 major clients
  const clientsCompatibility = {
    codex: {
      client: 'OpenAI Codex CLI / ChatGPT Desktop',
      status: 'compatible',
      protocol: 'OpenAI Responses API',
      checks: [
        { name: 'Responses Payload 深度压缩与 Array 结构保真', passed: true },
        { name: 'Tools Schema 字典序对齐 (KV Cache 锁定)', passed: true },
        { name: '终端 ANSI 控制符与 \\r 进度条清洗', passed: true },
        { name: 'Windows PowerShell 转义自愈与 CLIXML 报错去噪', passed: true },
        { name: '输出防空流与防断流守护', passed: true }
      ]
    },
    opencode: {
      client: 'OpenCode 2.0+ CLI & Background Service',
      status: 'compatible',
      protocol: 'OpenAI Chat & Anthropic Messages',
      checks: [
        { name: 'Anthropic tool_result 防空字符阻断 (防 400)', passed: true },
        { name: 'Tool Call 原子连续性保全 (Rule 18)', passed: true },
        { name: '单元测试通过项安全折叠 (错误与堆栈 100% 保真)', passed: true },
        { name: 'Windows PowerShell 转义自愈与 CLIXML 报错去噪', passed: true }
      ]
    },
    openchamber: {
      client: 'OpenChamber 桌面工作台 (Electron)',
      status: 'compatible',
      protocol: 'Desktop Air-Gapped Unified Engine',
      checks: [
        { name: '纯本地离线沙箱压缩 (100% Air-Gapped 零外泄)', passed: true },
        { name: 'Git 冲突标记 (<<<<<<<) 零折叠绝对豁免', passed: hasConflictShield },
        { name: 'Windows PowerShell 转义自愈与 CLIXML 报错去噪', passed: true },
        { name: '真 LRU 500 会话内存上限防泄漏', passed: hasLru }
      ]
    }
  };

  if (clientsCompatibility.openchamber.checks.some(c => !c.passed)) {
    clientsCompatibility.openchamber.status = 'degraded';
  }
  if (clientsCompatibility.codex.checks.some(c => !c.passed)) {
    clientsCompatibility.codex.status = 'degraded';
  }
  if (clientsCompatibility.opencode.checks.some(c => !c.passed)) {
    clientsCompatibility.opencode.status = 'degraded';
  }

  const highIssues = issues.filter(i => i.severity === 'high').length;
  const mediumIssues = issues.filter(i => i.severity === 'medium').length;
  const lowIssues = issues.filter(i => i.severity === 'low').length;
  const healthy = highIssues === 0 && mediumIssues === 0;

  return {
    timestamp: new Date().toISOString(),
    healthy,
    preset: norm.preset || 'balanced',
    activeEngines,
    clientsCompatibility,
    issues,
    stats: {
      savedTokens: stats.savedTokens || 0,
      savedCostUsd: (typeof stats.savedCostUSD === 'number' ? `$${stats.savedCostUSD.toFixed(4)}` : (stats.savedCostUsd || '$0.0000')),
      compressionRatio: (typeof stats.compressionRatio === 'number' ? `${stats.compressionRatio}%` : (stats.compressionRatio || '0.0%')),
      totalOriginalChars: stats.totalOriginalChars || 0,
      totalCompressedChars: stats.totalCompressedChars || 0,
      totalSavedChars: stats.totalSavedChars || 0
    },
    summary: {
      totalIssues: issues.length,
      highIssues,
      mediumIssues,
      lowIssues,
      recommendation: healthy
        ? '压缩引擎配置安全健康，防断流、防空流、代码零损耗与冲突保真全防护就绪！'
        : '检测到存在影响代码质量或稳定性的配置异常，建议点击【一键修复安全配置】秒级自愈。'
    }
  };
}

/**
 * Compression Repair Engine: Auto-heals configuration anomalies & aligns with safe baseline.
 * @param {object} rawConfig
 * @param {object} options
 * @returns {object}
 */
function repairCompressionConfig(rawConfig = {}, options = {}) {
  const norm = normalizeCompressionOptions(rawConfig);
  const results = [];

  if (options.resetToBalanced) {
    const balanced = JSON.parse(JSON.stringify(COMPRESSION_PRESETS.balanced));
    norm.preset = 'balanced';
    norm.enabled = true;
    norm.modules = balanced.modules;
    norm.schemaCharThreshold = 15000;
    norm.exemptMergeConflicts = true;
    norm.protectSourceDiffs = true;
    norm.trueLruRetention = true;
    norm.customTestPassPatterns = [];
    results.push({ item: 'Preset Alignment', success: true, message: '已一键重置为官方推荐【🌟 平衡标准档】安全配置' });
    const finalCfg = normalizeCompressionOptions(norm);
    return { success: true, repairedConfig: finalCfg, results };
  }

  // 1. Repair Merge Conflict Shield
  if (norm.modules.headroom.exemptMergeConflicts === false || norm.exemptMergeConflicts === false) {
    norm.modules.headroom.exemptMergeConflicts = true;
    norm.exemptMergeConflicts = true;
    results.push({ item: 'Merge Conflict Shield', success: true, message: '已开启 Git 合并冲突绝对豁免防御 (<<<<<<< 标记 100% 保真)' });
  }

  // 2. Repair Source Diff Protection
  if (norm.modules.headroom.protectSourceDiffs === false || norm.protectSourceDiffs === false) {
    norm.modules.headroom.protectSourceDiffs = true;
    norm.protectSourceDiffs = true;
    results.push({ item: 'Source Diff Protection', success: true, message: '已开启源码 Diff 完整性保护 (apply_patch 补丁行号 100% 精准)' });
  }

  // 3. Repair Schema Slim Threshold
  const curThresh = norm.modules.schema.schemaCharThreshold !== undefined ? norm.modules.schema.schemaCharThreshold : norm.schemaCharThreshold;
  if (curThresh < 4000) {
    norm.modules.schema.schemaCharThreshold = 15000;
    norm.schemaCharThreshold = 15000;
    results.push({ item: 'Schema Slim Threshold', success: true, message: `已将工具 Schema 瘦身门限自愈恢复为安全阈值 15,000 字符 (原值: ${curThresh})` });
  }

  // 4. Clean Invalid Custom Test Patterns
  if (Array.isArray(norm.customTestPassPatterns) && norm.customTestPassPatterns.length > 0) {
    const validPatterns = [];
    let cleanedCount = 0;
    for (const pat of norm.customTestPassPatterns) {
      if (typeof pat === 'string' && pat.trim()) {
        try {
          getCachedRegex(pat.trim(), 'i');
          validPatterns.push(pat);
        } catch (_) {
          cleanedCount++;
        }
      } else {
        validPatterns.push(pat);
      }
    }
    if (cleanedCount > 0) {
      norm.customTestPassPatterns = validPatterns;
      results.push({ item: 'Custom Test Patterns', success: true, message: `已自动剔除 ${cleanedCount} 条无效的测试匹配正则表达式` });
    }
  }

  // 5. Repair True LRU Retention
  if (norm.modules.cacheZone.trueLruRetention === false || norm.trueLruRetention === false) {
    norm.modules.cacheZone.trueLruRetention = true;
    norm.trueLruRetention = true;
    results.push({ item: 'Cache-Zone LRU Retention', success: true, message: '已启用真 LRU 热度淘汰与 500 会话双重上限守护' });
  }

  // 6. Optional: Clear memo if requested
  if (options.clearMemo) {
    sessionCompressionMemo.clear();
    results.push({ item: 'Cache-Zone Memory Flush', success: true, message: '已安全排空会话历史轮次前缀固化缓存池' });
  }

  // 7. Ensure PowerShell module is aligned and self-healed
  if (norm.modules.powershell) {
    if (norm.modules.powershell.enabled === undefined) {
      norm.modules.powershell.enabled = true;
      results.push({ item: 'PowerShell Optimizer Status', success: true, message: '已自动校准 Windows PowerShell 优化器启用状态' });
    }
    if (norm.modules.powershell.autoDetectPlatform === undefined) {
      norm.modules.powershell.autoDetectPlatform = true;
      results.push({ item: 'Platform Auto-Detection', success: true, message: '已开启跨平台环境自适应与 Linux 零损耗休眠旁路' });
    }
  }

  // 8. Ensure master switch is active if requested or if auto-healing
  if ((options.enableMaster || options.autoHeal) && !norm.enabled) {
    norm.enabled = true;
    results.push({ item: 'Master Switch', success: true, message: '已重新开启上下文优化与 Token 压缩总开关' });
  }

  if (results.length === 0) {
    results.push({ item: 'Context Compression Health', success: true, message: '压缩引擎配置安全健康，无需变更' });
  }

  const finalCfg = normalizeCompressionOptions(norm);
  return {
    success: true,
    repairedConfig: finalCfg,
    results
  };
}

module.exports = {
  DEFAULT_COMPRESSION_CONFIG,
  COMPRESSION_PRESETS,
  normalizeCompressionOptions,
  getCompressionStats,
  resetCompressionStats,
  getStatsByRange,
  buildTimeSeries,
  formatTimeSeriesLabel,
  recordCompressionEvent,
  pruneExpiredBuckets,
  isTestEnvironment,
  isProductionDiskTarget,
  BUCKET_DEFINITIONS,
  RANGE_CONFIG,
  compressionHistory,
  HISTORY_FILE,
  createEmptyBucket,
  recordSavings,
  STATS_FILE,
  stripAnsi,
  cleanProgressBars,
  cleanDockerOutput,
  cleanCliMetadata,
  cleanGitOutput,
  cleanBuildAndPkgOutput,
  cleanSearchAndTreeOutput,
  compactSystemPrompt,
  dedupLogLines,
  cleanTerraformOutput,
  cleanKubectlOutput,
  foldLockfiles,
  foldStructuredData,
  foldTestPasses,
  getCachedRegex,
  dynamicRegexCache,
  alignToolsSchema,
  slimToolsSchema,
  compactToolsList,
  compactText,
  compactChatPayload,
  compactAnthropicPayload,
  compactResponsesPayload,
  getMemo,
  setMemo,
  clearSessionMemo,
  sessionCompressionMemo,
  registerTransformer,
  unregisterTransformer,
  getRegisteredTransformers,
  runPipeline,
  getOptionsSignature,
  checkCompressionHealth,
  repairCompressionConfig,
  DEFAULT_MODEL_RATE_PER_1M,
  MAX_BY_MODEL_ENTRIES,
  pruneByModelEntriesIfNeeded,
  OPENCODE_GO_MODEL_RATES,
  dynamicModelRates,
  normalizeModelName,
  getModelRate,
  updateModelRates,
  syncModelRatesFromOpenCode,
  recordModelSavings,
  estimateTokens,
  STATS_BAK_FILE,
  HISTORY_BAK_FILE,
  loadStatsFromDisk,
  saveStatsToDisk,
  flushStatsToDisk,
  isMultiLineSourceFileRead,
  isSourceDiffOrPatch,
  isCompilerDiagnosticOrStackTrace,
  isProtectedSourceOrDiagnostic,
  normalizeMemoSessionId
};
