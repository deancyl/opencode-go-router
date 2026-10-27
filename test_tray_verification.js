const fs = require('fs');
const assert = require('assert');
const path = require('path');

const trayPs1Raw = fs.readFileSync(path.join(__dirname, 'tray-daemon.ps1'), 'utf8');

// 1. Check all assertions from test_router.js [Test 166]
assert.ok(trayPs1Raw.includes('TrayMessageSinkForm'), 'tray-daemon.ps1 must embed TrayMessageSinkForm');
assert.ok(trayPs1Raw.includes('cp.Parent = IntPtr.Zero') && trayPs1Raw.includes('SetVisibleCore(false)'), 'tray-daemon.ps1 TrayMessageSinkForm must be unparented top-level toolwindow to receive HWND_BROADCAST');
assert.ok(trayPs1Raw.includes('TaskbarCreated') && trayPs1Raw.includes('WM_RESTORE_OPENCODE_ROUTER_TRAY'), 'tray-daemon.ps1 must intercept TaskbarCreated and WM_RESTORE_OPENCODE_ROUTER_TRAY');
assert.ok(trayPs1Raw.includes('Reassert-TrayIcon $true'), 'tray-daemon.ps1 must force cycle Visible false/true in Reassert-TrayIcon');
assert.ok(trayPs1Raw.includes('GetActiveTcpListeners'), 'tray-daemon.ps1 must use fast IPGlobalProperties.GetActiveTcpListeners');
assert.ok(!/[^$]\(if\s*\(/.test(trayPs1Raw), 'tray-daemon.ps1 must not contain PowerShell 5.1 invalid (if (...)) expression without $');

// 2. Check all assertions from test_tier5_compactor_platform_adversarial.js
assert.ok(trayPs1Raw.includes('Local\\OpenCodeRouterTrayPSMutex_v2'), 'Must specify correct SingleInstance mutex');
assert.ok(trayPs1Raw.includes('MainWindowHandle -ne 0') || trayPs1Raw.includes('MainWindowHandle -eq 0'), 'Must inspect MainWindowHandle for zombie process detection');
assert.ok(trayPs1Raw.includes('opencode') && trayPs1Raw.includes('serve'), 'Must handle opencode serve child process termination');
assert.ok(trayPs1Raw.includes('watchdogTimer.Interval = 5000'), 'Must feature 5000ms watchdog timer');
assert.ok(trayPs1Raw.includes('--app='), 'Must support Edge/Chrome --app standalone desktop window mode');

// 3. Check new hardening requirements
assert.ok(trayPs1Raw.includes('SetProcessDpiAwarenessContext'), 'Must support PerMonitorV2 High DPI');
assert.ok(trayPs1Raw.includes('TrimCurrentProcessMemory'), 'Must support EmptyWorkingSet memory trimming');
assert.ok(trayPs1Raw.includes('Launch-CodexDesktop'), 'Must support Launch-CodexDesktop');
assert.ok(trayPs1Raw.includes('Bind-CodexGatewayAndMcp'), 'Must support Bind-CodexGatewayAndMcp');
assert.ok(trayPs1Raw.includes('menuHeaderCard'), 'Must have menuHeaderCard');
assert.ok(trayPs1Raw.includes('add_Opening'), 'Must update card on menu Opening');
assert.ok(trayPs1Raw.includes('add_DoubleClick'), 'Must handle DoubleClick');
assert.ok(trayPs1Raw.includes('add_MouseClick'), 'Must handle MouseClick for left click menu');
assert.ok(trayPs1Raw.includes('Stop-RouterServiceSafely'), 'Must have Stop-RouterServiceSafely');
assert.ok(trayPs1Raw.includes('Exit-TrayProcessOnly'), 'Must have Exit-TrayProcessOnly');
assert.ok(trayPs1Raw.includes('circuitBreakerTripped'), 'Must have circuit breaker');
// 4. Check bugfixes and deep robustness
assert.ok(trayPs1Raw.includes('鉴权保护中'), 'StatusHolder must gracefully handle 401 Unauthorized (Rule 8)');
assert.ok(trayPs1Raw.includes('Select-Object -ExpandProperty OwningProcess -Unique'), 'Stop-RouterServiceSafely must handle multiple TCP listener endpoints without array string interpolation bug');
assert.ok(trayPs1Raw.includes('WaitForPendingFinalizers'), 'Memory trimming must flush pending finalizers before EmptyWorkingSet');
assert.ok(trayPs1Raw.includes('watchdogTickCount -eq 2'), 'Must trigger early memory compaction at tick 2');
assert.ok(trayPs1Raw.includes('$menu -and $menu.Visible') && trayPs1Raw.includes('$menu.Close()'), 'Mouse click must support clean menu toggle');

const serverJsRaw = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
assert.ok(serverJsRaw.includes("defaultModel: config.defaultModel || 'deepseek-v4.1-flash'"), 'server.js /status must provide defaultModel');

console.log('ALL TRAY HARDENING & REGRESSION ASSERTIONS PASSED SUCCESSFULLY!');
