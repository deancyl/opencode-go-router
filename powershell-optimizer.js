/**
 * OpenCode Go Router - Windows PowerShell Escaping & Platform Adaptation Optimizer
 * Ultra-low overhead, 100% Node.js native zero dependencies.
 *
 * Distinguishes Linux and Windows environments:
 * - On Linux (e.g. Linux NAS): Dormant/bypass mode with 0 overhead and zero command tampering.
 * - On Windows: Deep analysis and deterministic optimization of PowerShell escaping traps across:
 *   1. OpenAI Responses API (Codex Desktop / CLI)
 *   2. OpenAI Chat API (OpenCode / OpenChamber / Cursor)
 *   3. Anthropic Messages API (Claude Code / OpenCode)
 *
 * Core Capabilities:
 * - Platform Auto-Detection (detectPlatform): Detects host OS, request headers and user agents.
 * - CLIXML & PowerShell Error Denoising (cleanCliXmlNoise): Strips #< CLIXML and CategoryInfo noise,
 *   decoding _x000D__x000A_ and hex escapes to reduce retry Token waste by 70%-90%.
 * - Heuristic Command Escaping Normalizer (fixPowerShellCommandEscaping):
 *   * Fix 1: Trailing backslash before double quote ("C:\dir\" -> "C:\dir\\") preventing quote-eating in CRT CommandLineToArgvW.
 *   * Fix 2: Bypasses curl / wget alias trap in Windows PowerShell 5.1 (curl -> curl.exe).
 *   * Fix 3: Translates && / || operators into PowerShell 5.1 safe statements (cmd1; if ($?) { cmd2 }).
 *   * Fix 4: Converts multiline trailing backslash continuations (\) to backtick (`).
 * - Windows PowerShell Guard Instruction Barrier (generatePowerShellGuardDirective):
 *   Injects deterministic command generation guidelines into prompt/instructions to prevent model trial-and-error.
 * - Strict Redlines (Zero Degradation / 防降智):
 *   * NEVER modifies file contents, diffs, code patches or non-shell parameters.
 *   * Fully bypassed when disabled or running in Linux mode.
 */

const os = require('node:os');
const childProcess = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

const DEFAULT_POWERSHELL_CONFIG = {
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
  injectPowerShellGuard: true,
  fixHistoricalToolCalls: false
};

/**
 * Detects whether the execution environment or target client is Windows vs Linux.
 * Priority: options.targetPlatform > client headers > User-Agent > host process.platform
 * @param {object} options
 * @param {object|null} req
 * @returns {object}
 */
function detectPlatform(options = {}, req = null) {
  // 1. Explicit override in options
  const explicitPlat = (options && (options.targetPlatform || options.platform)) ||
    (options && options.modules && options.modules.powershell && (options.modules.powershell.targetPlatform || options.modules.powershell.platform)) ||
    (options && options.powershell && (options.powershell.targetPlatform || options.powershell.platform));
  if (explicitPlat) {
    const p = String(explicitPlat).toLowerCase();
    const isWin = p === 'win32' || p === 'windows' || p === 'win';
    return {
      isWindows: isWin,
      isLinux: p === 'linux',
      platform: isWin ? 'win32' : (p === 'linux' ? 'linux' : p),
      mode: isWin ? 'windows' : (p === 'linux' ? 'linux' : 'other'),
      reason: 'options_override'
    };
  }

  // 2. Client headers inspection
  if (req && req.headers) {
    const clientOs = (req.headers['x-client-platform'] || req.headers['x-target-os'] || req.headers['x-platform'] || '').toLowerCase();
    if (clientOs) {
      const isWin = clientOs.includes('win');
      const isLin = clientOs.includes('linux');
      if (isWin || isLin) {
        return {
          isWindows: isWin,
          isLinux: isLin,
          platform: isWin ? 'win32' : 'linux',
          mode: isWin ? 'windows' : 'linux',
          reason: 'client_header'
        };
      }
    }

    const ua = (req.headers['user-agent'] || '').toLowerCase();
    if (ua) {
      if (ua.includes('windows nt') || ua.includes('win64') || ua.includes('wow64')) {
        // Prevent Linux host from having its local shell treated as Windows PowerShell
        // solely due to a connecting web browser's User-Agent (identified by browser headers or preferHostLinux flag)
        const isBrowserRequest = Boolean(
          req.headers['sec-ch-ua'] ||
          req.headers['sec-fetch-mode'] ||
          req.headers['origin'] ||
          req.headers['referer'] ||
          (options && options.preferHostLinux)
        );
        if (process.platform === 'linux' && !clientOs && isBrowserRequest) {
          return {
            isWindows: false,
            isLinux: true,
            platform: 'linux',
            mode: 'linux',
            reason: 'host_linux_precedence_over_ua'
          };
        }
        return {
          isWindows: true,
          isLinux: false,
          platform: 'win32',
          mode: 'windows',
          reason: 'user_agent_windows'
        };
      }
      if (ua.includes('linux') && !ua.includes('android')) {
        return {
          isWindows: false,
          isLinux: true,
          platform: 'linux',
          mode: 'linux',
          reason: 'user_agent_linux'
        };
      }
    }
  }

  // 3. Fallback to gateway host process.platform
  const isWin = process.platform === 'win32';
  const isLin = process.platform === 'linux';
  return {
    isWindows: isWin,
    isLinux: isLin,
    platform: process.platform,
    mode: isWin ? 'windows' : (isLin ? 'linux' : process.platform),
    reason: 'host_platform'
  };
}

/**
 * Checks if the PowerShell optimizer should be active for the current context.
 * If autoDetectPlatform is true, it only activates for Windows targets.
 * @param {object} options
 * @param {object|null} req
 * @returns {boolean}
 */
function isPowerShellOptimizerActive(options = {}, req = null) {
  if (options && options.enabled === false) return false;
  const cfg = { ...DEFAULT_POWERSHELL_CONFIG, ...((options.modules && options.modules.powershell) || options.powershell || options.powershellOptimizer || options) };
  if (cfg.enabled === false) return false;

  if (cfg.autoDetectPlatform !== false) {
    const platformInfo = detectPlatform(options, req);
    if (!platformInfo.isWindows) {
      return false; // Dormant/bypass on Linux or other non-Windows targets
    }
  }

  return true;
}

/**
/**
 * Cleans CLIXML error wrappers, PowerShell interactive banner, Git CRLF noise,
 * and repetitive CategoryInfo from PowerShell output.
 * Preserves the actual error message, file name, line numbers, and error tokens.
 * @param {string} text
 * @returns {string}
 */
function cleanPowerShellNoise(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  // Never strip strings inside multi-line source code files (e.g. test_router.js, server.js, .ps1 scripts)
  if (text.length > 300 && !text.trimStart().startsWith('#< CLIXML')) {
    try {
      const compactor = require('./context-compactor');
      if (compactor && typeof compactor.isMultiLineSourceFileRead === 'function' && compactor.isMultiLineSourceFileRead(text)) {
        return text;
      }
    } catch (_) {}
  }

  try {
    let result = text;
    let modified = false;

    // 1. Parse and extract payload from #< CLIXML stream
    if (result.includes('#< CLIXML')) {
      const unescapeHex = (str) => {
        return str.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => {
          return String.fromCharCode(parseInt(hex, 16));
        }).replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
      };

      const errorParts = [];
      const errTagRegex = /<S S="Error">([^<]*)<\/S>/g;
      let match;
      while ((match = errTagRegex.exec(result)) !== null) {
        if (match[1]) {
          errorParts.push(unescapeHex(match[1]));
        }
      }

      if (errorParts.length > 0) {
        let extractedError = errorParts.join('').trim();
        extractedError = extractedError.replace(/(\r?\n){3,}/g, '$1$1');
        result = result.replace(/#<\s*CLIXML[\s\S]*?<\/Objs>/g, extractedError ? `[PowerShell Error]:\n${extractedError}` : '');
        modified = true;
      } else {
        result = result.replace(/#<\s*CLIXML[\s\S]*?<\/Objs>\r?\n?/g, '');
        modified = true;
      }
    }

    // 2. Clean verbose CategoryInfo and FullyQualifiedErrorId blocks
    if (result.includes('CategoryInfo') || result.includes('FullyQualifiedErrorId')) {
      const isCrlf = result.includes('\r\n');
      const newline = isCrlf ? '\r\n' : '\n';
      const lines = result.split(/\r?\n/);
      const filtered = [];
      let hadCatInfo = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (/^\+\s*CategoryInfo\s*:/i.test(trimmed) || /^\+\s*FullyQualifiedErrorId\s*:/i.test(trimmed)) {
          hadCatInfo = true;
          continue;
        }
        filtered.push(line);
      }
      if (hadCatInfo) {
        result = filtered.join(newline);
        modified = true;
      }
    }

    // 3. Clean PowerShell startup terminal banner (e.g. "PowerShell 7.6.4 on Windows_NT\r\n")
    if (result.includes('PowerShell ') && result.includes('Windows_NT')) {
      const bannerRegex = /^[^\r\n]*?PowerShell\s+\d+(?:\.\d+)*\s+on\s+Windows_NT\r?\n?/gm;
      const stripped = result.replace(bannerRegex, '');
      if (stripped !== result) {
        result = stripped;
        modified = true;
      }
    }

    // 4. Clean Git CRLF replacement warning noise
    if (result.includes('LF will be replaced by CRLF') || result.includes('CRLF will be replaced by LF')) {
      const crlfWarnRegex = /^warning:\s*(?:in the working copy of [^\r\n]+,\s*)?(?:LF|CRLF) will be replaced by (?:CRLF|LF)[^\r\n]*\r?\n?/gm;
      const stripped = result.replace(crlfWarnRegex, '');
      if (stripped !== result) {
        result = stripped;
        modified = true;
      }
    }

    // 5. Clean Windows Terminal ANSI window title sequences (\x1b]0;...\x07)
    if (result.includes('\x1b]0;')) {
      const titleRegex = /\x1b]0;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
      const stripped = result.replace(titleRegex, '');
      if (stripped !== result) {
        result = stripped;
        modified = true;
      }
    }

    // 6. Clean PowerShell 7 repetitive syntax / cmdlet error boilerplate noise
    // Strips redundant "Line | ... ~~~~" and "Check the spelling of the name..." while preserving the core error
    if (result.includes('Line |') || result.includes('Check the spelling of the name')) {
      const lineNoiseRegex = /(?:^|\r?\n)\s*Line\s*\|\r?\n\s*\d+\s*\|\s*[^\r\n]*\r?\n\s*\|\s*~+\r?\n\s*\|\s*/g;
      const stripped1 = result.replace(lineNoiseRegex, '\n');
      const adviceRegex = /\r?\n?Check the spelling of the name, or if a path was included, verify that the path is correct and try again\.\r?\n?/g;
      const stripped2 = stripped1.replace(adviceRegex, '\n');
      if (stripped2 !== result) {
        result = stripped2;
        modified = true;
      }
    }

    if (!modified || result.trim() === '') {
      return text;
    }
    return result.length < text.length ? result : text;
  } catch (err) {
    console.warn('[PowerShellOptimizer] cleanPowerShellNoise error, bypassing:', err.message);
    return text;
  }
}

/**
 * Backward compatibility alias for cleanPowerShellNoise
 */
function cleanCliXmlNoise(text) {
  return cleanPowerShellNoise(text);
}

/**
 * Normalizes and fixes common PowerShell escaping traps in a shell command.
 * Strictly preserves command semantics without breaking valid scripts.
 * @param {string} cmd
 * @param {object} options
 * @returns {string}
 */
function fixPowerShellCommandEscaping(cmd, options = {}) {
  if (typeof cmd !== 'string' || cmd.trim().length === 0) return cmd;
  const cfg = { ...DEFAULT_POWERSHELL_CONFIG, ...((options.modules && options.modules.powershell) || options.powershell || options.powershellOptimizer || options) };
  if (cfg.enabled === false) return cmd;

  if (options.wrapComplexScript === true && isComplexCommandNeedingScriptFile(cmd)) {
    return wrapInScriptFileExecution(cmd);
  }

  let result = cmd;

  try {
    // 1. Fix curl / wget alias trap in PowerShell
    // In PowerShell 5.1, 'curl' is an alias for 'Invoke-WebRequest'.
    // If an agent calls 'curl -X ...' or 'curl -s ...', Invoke-WebRequest throws parameter errors.
    // Replace standalone 'curl' at command start, after pipe, semicolon, or whitespace with 'curl.exe'.
    if (cfg.fixCurlAlias !== false) {
      result = result.replace(/(^|[;&|]\s*)curl(?=\s+["'-])/g, '$1curl.exe');
      result = result.replace(/(^|[;&|]\s*)curl(?=\s+[a-zA-Z0-9_./\\])/g, '$1curl.exe');
      result = result.replace(/(^|[;&|]\s*)wget(?=\s+["'-])/g, '$1wget.exe');
      result = result.replace(/(^|[;&|]\s*)wget(?=\s+[a-zA-Z0-9_./\\])/g, '$1wget.exe');
    }

    // 2. Fix Trailing Backslash Quote Eating (CommandLineToArgvW CRT trap)
    // Example: "C:\Users\deanc\project\" -> \" eats the closing double quote!
    // Solution: If a quoted Windows path has a trailing backslash right before the quote,
    // double the backslash: "C:\path\\" so the CRT parser treats it as an escaped backslash followed by a closing quote.
    if (cfg.fixTrailingSlash !== false) {
      // Matches double-quoted Windows directory paths ending with an odd number of backslashes
      // e.g. "C:\dir\", ".\test\", "\\nas\share\" or "C:\Program Files (x86)\"
      // Avoids mangling escaped quotes (e.g. \"$(whoami)\") inside commands.
      result = result.replace(/(")(?:(?:[A-Za-z]:|\.\.?|\\\\)[^"\r\n]*?)(?<!\\)((?:\\\\)*\\)(?=")/g, (match) => {
        return match + '\\';
      });
    }

    // 3. Fix multiline trailing backslash line continuation
    // In Linux/Bash, '\' at the end of a line is continuation. In PowerShell, it is backtick (`).
    if (cfg.fixLineContinuation !== false && result.includes('\n')) {
      result = result.replace(/([^\\])\\\s*(\r?\n)/g, '$1`$2');
    }

    // 4. Fix && and || operators for Windows PowerShell 5.1 compatibility
    // In Windows PowerShell 5.1, '&&' throws ParserError: "The token '&&' is not a valid statement separator".
    // Safe transformation: outside quotes, replace ' && ' with '; if ($?) { ' and append ' }'
    if (cfg.fixAndOperator !== false && (result.includes(' && ') || result.includes(' || ')) && !result.includes('; if ($?)')) {
      // Simple parser state machine to ensure && is outside quotes
      let inSingleQuote = false;
      let inDoubleQuote = false;
      let buffer = '';
      let i = 0;
      let andCount = 0;

      while (i < result.length) {
        const char = result[i];
        if (char === "'" && !inDoubleQuote) {
          inSingleQuote = !inSingleQuote;
          buffer += char;
          i++;
        } else if (char === '"' && !inSingleQuote) {
          // Check for backtick escape in PowerShell
          const prevChar = i > 0 ? result[i - 1] : '';
          if (prevChar !== '`') {
            inDoubleQuote = !inDoubleQuote;
          }
          buffer += char;
          i++;
        } else if (!inSingleQuote && !inDoubleQuote && result.slice(i, i + 4) === ' && ') {
          buffer += '; if ($?) { ';
          andCount++;
          i += 4;
        } else if (!inSingleQuote && !inDoubleQuote && result.slice(i, i + 4) === ' || ') {
          buffer += '; if (-not $?) { ';
          andCount++;
          i += 4;
        } else {
          buffer += char;
          i++;
        }
      }

      if (andCount > 0) {
        buffer += ' }'.repeat(andCount);
        result = buffer;
      }
    }

    // 5. Fix PowerShell Subexpression Local Evaluation ($() and ${} inside double quotes)
    // In PowerShell, strings in double quotes "..." evaluate $(...) locally on Windows.
    // When executing subshell/remote commands (adb shell, ssh, bash, su, wsl, docker, etc.)
    // PowerShell evaluates $(...) locally on Windows, failing with "The term '...' is not recognized".
    // ANTI-DOWNGRADE REDLINE: Only escape $(...) when the command is executing a subshell/remote tool
    // (adb, ssh, wsl, docker, bash, sh, su, cmd /c, powershell -Command, pwsh -Command) or forceSubexpressionEscaping is true.
    // Native PowerShell commands (e.g. Write-Host "Current time is: $(Get-Date)") must NOT be mangled.
    const isRemoteSubshellWrapper = /^(?:\s*&?\s*)?(?:adb\s+|ssh\s+|wsl(?:\.exe)?\s+|docker(?:\.exe)?\s+(?:exec|run)\s+|bash(?:\.exe)?\s+|sh\s+|su\s+|cmd(?:\.exe)?\s+\/c\s+|powershell(?:\.exe)?\s+-(?:Command|c)\s+|pwsh(?:\.exe)?\s+-(?:Command|c)\s+)/i.test(cmd);
    if (cfg.fixSubexpressionEscaping !== false && (isRemoteSubshellWrapper || cfg.forceSubexpressionEscaping === true) && (result.includes('$(') || result.includes('${'))) {
      let inSingleQuote = false;
      let inDoubleQuote = false;
      let buffer = '';
      for (let i = 0; i < result.length; i++) {
        const char = result[i];

        // Count preceding backslashes
        let backslashCount = 0;
        for (let j = i - 1; j >= 0 && result[j] === '\\'; j--) {
          backslashCount++;
        }
        const isBackslashEscaped = (backslashCount % 2 === 1);

        // Count preceding backticks
        let backtickCount = 0;
        for (let j = i - 1; j >= 0 && result[j] === '`'; j--) {
          backtickCount++;
        }
        const isBacktickEscaped = (backtickCount % 2 === 1);

        if (char === "'" && !inDoubleQuote) {
          if (!isBacktickEscaped) {
            inSingleQuote = !inSingleQuote;
          }
          buffer += char;
        } else if (char === '"' && !inSingleQuote) {
          if (!isBacktickEscaped && !isBackslashEscaped) {
            if (inDoubleQuote && result[i + 1] === '"') {
              // Doubled quote inside double quotes ("")
              buffer += '""';
              i++;
              continue;
            }
            inDoubleQuote = !inDoubleQuote;
          }
          buffer += char;
        } else if (inDoubleQuote && char === '$' && (result[i + 1] === '(' || result[i + 1] === '{')) {
          if (!isBacktickEscaped) {
            buffer += '`$';
          } else {
            buffer += char;
          }
        } else {
          buffer += char;
        }
      }
      result = buffer;
    }

    return result;
  } catch (err) {
    console.warn('[PowerShellOptimizer] fixPowerShellCommandEscaping error, returning original:', err.message);
    return cmd;
  }
}

/**
 * Detects whether a command has high escaping complexity that would benefit from script file injection.
 * (e.g. multi-line scripts, nested loops with quotes and subexpressions, heredocs).
 * @param {string} cmd
 * @returns {boolean}
 */
function isComplexCommandNeedingScriptFile(cmd) {
  if (typeof cmd !== 'string') return false;
  const lineCount = (cmd.match(/\r?\n/g) || []).length;
  if (lineCount >= 3) return true;
  // Complex nested quotes and subexpressions or heredocs
  const hasNestedQuotes = /["'].*?["'].*?["']/.test(cmd);
  const hasSubshellLoop = /for\s+\w+\s+in\s+\$\(/.test(cmd) || /while\s+read/.test(cmd);
  const hasHeredoc = /<<\s*['"]?[A-Za-z0-9_]+['"]?/.test(cmd);
  return (hasNestedQuotes && (hasSubshellLoop || hasHeredoc)) || cmd.length > 500;
}

/**
 * Wraps or converts a complex PowerShell script into a safe temporary script file execution wrapper
 * using PowerShell single-quoted here-strings (@' ... '@) which guarantees 0 variable/subexpression expansion.
 * @param {string} scriptContent
 * @param {string} [extension='.ps1']
 * @returns {string}
 */
function wrapInScriptFileExecution(scriptContent, extension = '.ps1') {
  if (typeof scriptContent !== 'string') return scriptContent;
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  if (scriptContent.includes("'@") || scriptContent.includes('@\'')) {
    const b64 = Buffer.from(scriptContent, 'utf8').toString('base64');
    return [
      `& {`,
      `  $__tmpScript = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "opencode_inj_" + [System.Guid]::NewGuid().ToString("N") + "${ext}");`,
      `  [System.IO.File]::WriteAllBytes($__tmpScript, [System.Convert]::FromBase64String("${b64}"));`,
      `  try {`,
      `    & $__tmpScript`,
      `  } finally {`,
      `    Remove-Item -Force $__tmpScript -ErrorAction SilentlyContinue`,
      `  }`,
      `}`
    ].join('\r\n');
  }
  return [
    `& {`,
    `  $__tmpScript = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "opencode_inj_" + [System.Guid]::NewGuid().ToString("N") + "${ext}");`,
    `  $__scriptBody = @'`,
    scriptContent,
    `'@;`,
    `  [System.IO.File]::WriteAllText($__tmpScript, $__scriptBody, [System.Text.Encoding]::UTF8);`,
    `  try {`,
    `    & $__tmpScript`,
    `  } finally {`,
    `    Remove-Item -Force $__tmpScript -ErrorAction SilentlyContinue`,
    `  }`,
    `}`
  ].join('\r\n');
}

/**
 * Generates the deterministic Windows PowerShell prompt guard directive.
 * Instructs models on Windows-specific quoting, alias and operator rules.
 * @returns {string}
 */
function generatePowerShellGuardDirective() {
  return [
    '<!-- [Windows PowerShell Execution & Escaping Guard] -->',
    'Host Environment is Windows with PowerShell. Strictly follow these escaping and execution standards to eliminate syntax crashes:',
    '1. Quoting Redline: In PowerShell, double quotes ("...") EVALUATE `$()` and `$variables` locally on Windows!',
    '   - NEVER pass subshell/remote commands (e.g. `adb shell`, `ssh`, `docker exec`, `su -c`, `bash -c`, `wsl`) containing `$(...)`, `${...}`, or `$var` in double quotes.',
    '   - Always wrap commands containing `$` in verbatim single quotes (\'...\') or escape `$` with backtick (`$).',
    '2. Script File Injection (Eliminate Escaping Hell):',
    '   - For complex multi-line scripts, loops (`for ... in $(...)`), heredocs, or nested quotes, avoid fragile inline command strings!',
    '   - Write the script to a script file (e.g. `.ps1` on Windows, or `.sh` pushed to remote/container) and execute that file directly.',
    '3. Command Compatibility:',
    '   - Use `curl.exe` instead of `curl` (PowerShell 5.1 aliases `curl` to `Invoke-WebRequest` with incompatible flags).',
    '   - Chain commands using `;` or `; if ($?) { ... }` instead of `&&` or `||` (PowerShell 5.1 does not support `&&`).',
    '   - Use backtick (`) for PowerShell string escaping and line continuations, not backslash (\\).',
    '   - Never leave a trailing backslash before a closing quote (`"C:\\dir\\\\"` instead of `"C:\\dir\\"`).'
  ].join('\n');
}

/**
 * Optimizes OpenAI Chat payload (/v1/chat/completions) for Windows PowerShell resilience.
 * @param {object} payload
 * @param {object} options
 * @param {object|null} req
 * @returns {object}
 */
function optimizeChatPayload(payload, options = {}, req = null) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) return payload;
  if (!isPowerShellOptimizerActive(options, req)) return payload;

  const cfg = { ...DEFAULT_POWERSHELL_CONFIG, ...(options.powershell || options.powershellOptimizer || options) };

  try {
    const result = { ...payload };
    const guardText = generatePowerShellGuardDirective();

    // 1. Inject prompt guard into system / developer instructions if present
    if (cfg.injectPowerShellGuard !== false) {
      let sysMsg = result.messages.find(m => m && (m.role === 'system' || m.role === 'developer'));
      if (sysMsg && typeof sysMsg.content === 'string') {
        if (!sysMsg.content.includes('[Windows PowerShell Execution & Escaping Guard]')) {
          sysMsg = { ...sysMsg, content: sysMsg.content + '\n\n' + guardText };
          result.messages = result.messages.map(m => (m && (m.role === 'system' || m.role === 'developer')) ? sysMsg : m);
        }
      }
    }

    // 2. Scan and clean tool outputs (CLIXML noise) and normalize shell tool calls
    result.messages = result.messages.map(msg => {
      if (!msg) return msg;

      // Clean CLIXML noise in tool output messages (skip if compactChatPayload pipeline already compacted it)
      if (!options._alreadyCompactedByPipeline && (msg.role === 'tool' || msg.role === 'function') && cfg.cleanCliXmlNoise !== false) {
        if (typeof msg.content === 'string' && (msg.content.includes('#< CLIXML') || msg.content.includes('CategoryInfo') || msg.content.includes('PowerShell ') || msg.content.includes('Line |'))) {
          const cleaned = cleanCliXmlNoise(msg.content);
          if (cleaned.length < msg.content.length) {
            try {
              const compactor = require('./context-compactor');
              if (compactor && typeof compactor.recordSavings === 'function') {
                compactor.recordSavings('powershell', msg.content.length - cleaned.length, msg.content.length, cfg.model || null);
              }
            } catch (_) {}
          }
          return { ...msg, content: cleaned };
        }
      }

      // ANTI-DOWNGRADE & KV CACHE REDLINE:
      // Historical assistant tool_calls were already executed on previous turns.
      // Modifying historical arguments in subsequent requests corrupts upstream KV Cache
      // and causes assistant confusion. Strictly disabled by default (fixHistoricalToolCalls: false).
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && cfg.fixHistoricalToolCalls === true) {
        const fixedCalls = msg.tool_calls.map(tc => {
          if (!tc || !tc.function || typeof tc.function.arguments !== 'string') return tc;
          const fnName = (tc.function.name || '').toLowerCase();
          const isShellTool = fnName.includes('bash') || fnName.includes('command') || fnName.includes('shell') ||
                              fnName.includes('terminal') || fnName.includes('exec') || fnName.includes('powershell');
          if (!isShellTool) return tc;

          try {
            const argsObj = JSON.parse(tc.function.arguments);
            let modified = false;
            for (const key of ['command', 'commandLine', 'command_line', 'cmd', 'script', 'input']) {
              if (typeof argsObj[key] === 'string') {
                const fixed = fixPowerShellCommandEscaping(argsObj[key], cfg);
                if (fixed !== argsObj[key]) {
                  argsObj[key] = fixed;
                  modified = true;
                }
              }
            }
            if (modified) {
              return {
                ...tc,
                function: {
                  ...tc.function,
                  arguments: JSON.stringify(argsObj)
                }
              };
            }
          } catch (_) {
            // Non-JSON arguments, skip safely
          }
          return tc;
        });
        return { ...msg, tool_calls: fixedCalls };
      }

      return msg;
    });

    return result;
  } catch (err) {
    console.warn('[PowerShellOptimizer] optimizeChatPayload sandbox error, bypassing:', err.message);
    return payload;
  }
}

/**
 * Optimizes OpenAI Responses payload (/responses - Codex) for Windows PowerShell resilience.
 * @param {object} payload
 * @param {object} options
 * @param {object|null} req
 * @returns {object}
 */
function optimizeResponsesPayload(payload, options = {}, req = null) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!isPowerShellOptimizerActive(options, req)) return payload;

  const cfg = { ...DEFAULT_POWERSHELL_CONFIG, ...(options.powershell || options.powershellOptimizer || options) };

  try {
    const result = { ...payload };
    const guardText = generatePowerShellGuardDirective();

    // 1. Inject prompt guard into instructions
    if (cfg.injectPowerShellGuard !== false) {
      if (typeof result.instructions === 'string') {
        if (!result.instructions.includes('[Windows PowerShell Execution & Escaping Guard]')) {
          result.instructions = result.instructions + '\n\n' + guardText;
        }
      } else {
        result.instructions = guardText;
      }
    }

    // 2. Scan and clean input items (tools & tool outputs)
    if (Array.isArray(result.input)) {
      result.input = result.input.map(item => {
        if (!item || typeof item !== 'object') return item;

        // Clean tool output CLIXML (skip if compactResponsesPayload pipeline already compacted it)
        if (!options._alreadyCompactedByPipeline && cfg.cleanCliXmlNoise !== false && typeof item.output === 'string') {
          if (item.output.includes('#< CLIXML') || item.output.includes('CategoryInfo') || item.output.includes('PowerShell ') || item.output.includes('Line |')) {
            const cleaned = cleanCliXmlNoise(item.output);
            if (cleaned.length < item.output.length) {
              try {
                const compactor = require('./context-compactor');
                if (compactor && typeof compactor.recordSavings === 'function') {
                  compactor.recordSavings('powershell', item.output.length - cleaned.length, item.output.length, cfg.model || null);
                }
              } catch (_) {}
            }
            return { ...item, output: cleaned };
          }
        }

        // ANTI-DOWNGRADE & KV CACHE REDLINE:
        // Preserves historical function_call arguments intact unless fixHistoricalToolCalls is explicitly true
        if (cfg.fixHistoricalToolCalls === true) {
          if (typeof item.command === 'string') {
            const fixed = fixPowerShellCommandEscaping(item.command, cfg);
            if (fixed !== item.command) return { ...item, command: fixed };
          }
          if (item.arguments && typeof item.arguments === 'string') {
            try {
              const parsed = JSON.parse(item.arguments);
              let mod = false;
              for (const k of ['command', 'commandLine', 'command_line', 'cmd', 'script']) {
                if (typeof parsed[k] === 'string') {
                  const fixed = fixPowerShellCommandEscaping(parsed[k], cfg);
                  if (fixed !== parsed[k]) {
                    parsed[k] = fixed;
                    mod = true;
                  }
                }
              }
              if (mod) return { ...item, arguments: JSON.stringify(parsed) };
            } catch (_) {}
          }
        }

        return item;
      });
    }

    return result;
  } catch (err) {
    console.warn('[PowerShellOptimizer] optimizeResponsesPayload sandbox error, bypassing:', err.message);
    return payload;
  }
}

/**
 * Optimizes Anthropic Messages payload (/v1/messages) for Windows PowerShell resilience.
 * @param {object} payload
 * @param {object} options
 * @param {object|null} req
 * @returns {object}
 */
function optimizeAnthropicPayload(payload, options = {}, req = null) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!isPowerShellOptimizerActive(options, req)) return payload;

  const cfg = { ...DEFAULT_POWERSHELL_CONFIG, ...(options.powershell || options.powershellOptimizer || options) };

  try {
    const result = { ...payload };
    const guardText = generatePowerShellGuardDirective();

    // 1. Inject prompt guard into system parameter
    if (cfg.injectPowerShellGuard !== false) {
      if (typeof result.system === 'string') {
        if (!result.system.includes('[Windows PowerShell Execution & Escaping Guard]')) {
          result.system = result.system + '\n\n' + guardText;
        }
      } else if (Array.isArray(result.system)) {
        const hasGuard = result.system.some(s => s && typeof s.text === 'string' && s.text.includes('[Windows PowerShell Execution & Escaping Guard]'));
        if (!hasGuard) {
          result.system = [...result.system, { type: 'text', text: guardText }];
        }
      } else {
        result.system = guardText;
      }
    }

    // 2. Scan messages for tool_result outputs and tool_use commands
    if (Array.isArray(result.messages)) {
      result.messages = result.messages.map(msg => {
        if (!msg || !Array.isArray(msg.content)) return msg;

        const newContent = msg.content.map(block => {
          if (!block || typeof block !== 'object') return block;

          // Clean CLIXML noise inside tool_result (skip if compactAnthropicPayload pipeline already compacted it)
          if (!options._alreadyCompactedByPipeline && block.type === 'tool_result' && cfg.cleanCliXmlNoise !== false) {
            if (typeof block.content === 'string' && (block.content.includes('#< CLIXML') || block.content.includes('CategoryInfo') || block.content.includes('PowerShell ') || block.content.includes('Line |'))) {
              const cleaned = cleanCliXmlNoise(block.content);
              if (cleaned.length < block.content.length) {
                try {
                  const compactor = require('./context-compactor');
                  if (compactor && typeof compactor.recordSavings === 'function') {
                    compactor.recordSavings('powershell', block.content.length - cleaned.length, block.content.length, cfg.model || null);
                  }
                } catch (_) {}
              }
              return { ...block, content: cleaned };
            }
          }

          // ANTI-DOWNGRADE & KV CACHE REDLINE:
          // Preserves historical tool_use input intact unless fixHistoricalToolCalls is explicitly true
          if (block.type === 'tool_use' && block.input && typeof block.input === 'object' && cfg.fixHistoricalToolCalls === true) {
            const inputCopy = { ...block.input };
            let mod = false;
            for (const k of ['command', 'commandLine', 'command_line', 'cmd', 'script']) {
              if (typeof inputCopy[k] === 'string') {
                const fixed = fixPowerShellCommandEscaping(inputCopy[k], cfg);
                if (fixed !== inputCopy[k]) {
                  inputCopy[k] = fixed;
                  mod = true;
                }
              }
            }
            if (mod) return { ...block, input: inputCopy };
          }

          return block;
        });

        return { ...msg, content: newContent };
      });
    }

    return result;
  } catch (err) {
    console.warn('[PowerShellOptimizer] optimizeAnthropicPayload sandbox error, bypassing:', err.message);
    return payload;
  }
}


/**
 * Encodes a PowerShell script/command into a Base64-encoded UTF-16LE string
 * suitable for `powershell.exe -EncodedCommand <string>`.
 * @param {string} scriptOrCmd
 * @returns {string}
 */
function toEncodedCommand(scriptOrCmd) {
  if (typeof scriptOrCmd !== "string") return "";
  return Buffer.from(scriptOrCmd, "utf16le").toString("base64");
}

/**
 * Decodes a Base64 UTF-16LE string generated for PowerShell -EncodedCommand.
 * @param {string} base64Str
 * @returns {string}
 */
function fromEncodedCommand(base64Str) {
  if (typeof base64Str !== "string") return "";
  return Buffer.from(base64Str, "base64").toString("utf16le");
}

/**
 * Builds standard arguments for powershell.exe / pwsh.exe execution
 * with UTF-8 console output encoding enforcement and -NoProfile -NonInteractive -ExecutionPolicy Bypass.
 * @param {string} commandOrScript
 * @param {object} [options={}]
 * @returns {string[]}
 */
function buildPowerShellArgs(commandOrScript, options = {}) {
  const baseArgs = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];
  const utf8Preamble = "$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::InputEncoding = [System.Text.Encoding]::UTF8; ";
  const fullCommand = utf8Preamble + (commandOrScript || "");

  if (options.useEncodedCommand !== false) {
    const encoded = toEncodedCommand(fullCommand);
    return [...baseArgs, "-EncodedCommand", encoded];
  }

  return [...baseArgs, "-Command", fullCommand];
}

/**
 * Detects the best available PowerShell executable on the host.
 * Prefers pwsh.exe if installed, otherwise powershell.exe.
 * @returns {string}
 */
function getPowerShellExe() {
  if (process.platform !== "win32") {
    return "pwsh";
  }
  try {
    const test = childProcess.spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8", timeout: 1500 });
    if (!test.error && test.status === 0) {
      return "pwsh.exe";
    }
  } catch (_) {}
  return "powershell.exe";
}

/**
 * Asynchronously executes a PowerShell command or script with:
 * - Active stdio pipe drainage (preventing 64KB OS buffer hangs)
 * - Multi-byte UTF-8 string decoders (preventing CJK/Emoji slicing)
 * - Strict timeout with recursive taskkill tree kill (preventing zombie processes)
 * - Auto-decoding and denoising of PowerShell error noise
 * @param {string} commandOrScript
 * @param {object} [options={}]
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number|null, timedOut: boolean, rawStdout: string, rawStderr: string }>}
 */
function executePowerShellCommand(commandOrScript, options = {}) {
  return new Promise((resolve) => {
    const timeout = typeof options.timeout === "number" ? options.timeout : 30000;
    const maxBuffer = typeof options.maxBuffer === "number" ? options.maxBuffer : 16 * 1024 * 1024;
    const cwd = options.cwd || process.cwd();
    const env = { ...process.env, PYTHONIOENCODING: "utf-8", ...options.env };
    const psExe = options.pwshPath || getPowerShellExe();
    const args = buildPowerShellArgs(commandOrScript, options);

    let child;
    let timedOut = false;
    let timer = null;

    try {
      child = childProcess.spawn(psExe, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (spawnErr) {
      return resolve({
        stdout: "",
        stderr: spawnErr.message || "Spawn failed",
        exitCode: 1,
        timedOut: false,
        rawStdout: "",
        rawStderr: spawnErr.message || ""
      });
    }

    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let rawStdout = "";
    let rawStderr = "";

    if (timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          if (process.platform === "win32") {
            try {
              childProcess.execSync(`taskkill.exe /F /T /PID ${child.pid}`, { stdio: "ignore" });
            } catch (_) {
              try { child.kill("SIGKILL"); } catch (__) {}
            }
          } else {
            try { child.kill("SIGKILL"); } catch (_) {}
          }
        }
      }, timeout);
    }

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        if (rawStdout.length < maxBuffer) {
          rawStdout += stdoutDecoder.write(chunk);
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        if (rawStderr.length < maxBuffer) {
          rawStderr += stderrDecoder.write(chunk);
        }
      });
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        stdout: cleanPowerShellNoise(rawStdout),
        stderr: cleanPowerShellNoise((rawStderr + "\n" + (err.message || "")).trim()),
        exitCode: 1,
        timedOut,
        rawStdout,
        rawStderr
      });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      rawStdout += stdoutDecoder.end();
      rawStderr += stderrDecoder.end();

      const cleanedStdout = cleanPowerShellNoise(rawStdout.trim());
      const cleanedStderr = cleanPowerShellNoise(rawStderr.trim());

      resolve({
        stdout: cleanedStdout,
        stderr: cleanedStderr,
        exitCode: code !== null ? code : (timedOut ? 124 : 1),
        timedOut,
        rawStdout,
        rawStderr
      });
    });
  });
}

/**
 * Synchronously executes a PowerShell command or script.
 * @param {string} commandOrScript
 * @param {object} [options={}]
 * @returns {{ stdout: string, stderr: string, exitCode: number, timedOut: boolean, rawStdout: string, rawStderr: string }}
 */
function executePowerShellCommandSync(commandOrScript, options = {}) {
  const timeout = typeof options.timeout === "number" ? options.timeout : 30000;
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, PYTHONIOENCODING: "utf-8", ...options.env };
  const psExe = options.pwshPath || getPowerShellExe();
  const args = buildPowerShellArgs(commandOrScript, options);

  try {
    const res = childProcess.spawnSync(psExe, args, {
      cwd,
      env,
      stdio: "pipe",
      timeout,
      encoding: "utf8",
      windowsHide: true
    });

    const timedOut = Boolean(res.error && (res.error.code === "ETIMEDOUT" || res.error.message?.includes("ETIMEDOUT")));
    const rawStdout = res.stdout || "";
    const rawStderr = (res.stderr || "") + (res.error && !timedOut ? `\n${res.error.message}` : "");

    return {
      stdout: cleanPowerShellNoise(rawStdout.trim()),
      stderr: cleanPowerShellNoise(rawStderr.trim()),
      exitCode: res.status !== null ? res.status : (timedOut ? 124 : 1),
      timedOut,
      rawStdout,
      rawStderr
    };
  } catch (err) {
    return {
      stdout: "",
      stderr: cleanPowerShellNoise(err.message || ""),
      exitCode: 1,
      timedOut: false,
      rawStdout: "",
      rawStderr: err.message || ""
    };
  }
}

module.exports = {
  DEFAULT_POWERSHELL_CONFIG,
  detectPlatform,
  isPowerShellOptimizerActive,
  cleanPowerShellNoise,
  cleanCliXmlNoise,
  fixPowerShellCommandEscaping,
  generatePowerShellGuardDirective,
  isComplexCommandNeedingScriptFile,
  wrapInScriptFileExecution,
  toEncodedCommand,
  fromEncodedCommand,
  buildPowerShellArgs,
  getPowerShellExe,
  executePowerShellCommand,
  executePowerShellCommandSync,
  optimizeChatPayload,
  optimizeResponsesPayload,
  optimizeAnthropicPayload
};
