# launcher.ps1: 智能检测托盘守护并唤出控制台 (加固版: 路径空格/中文/特殊字符与 LiteralPath 免疫)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$rootDir = if ($PSScriptRoot) { $PSScriptRoot } else { Join-Path $env:USERPROFILE ".opencode-go-router" }
$appExe = Join-Path $rootDir "OpenCodeRouterApp.exe"
$port = 4010
$cfgFile = Join-Path $rootDir "config.json"

if (Test-Path -LiteralPath $cfgFile) {
    try {
        $cfg = Get-Content -LiteralPath $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.port) { $port = [int]$cfg.port }
    } catch { }
}

# 先行检测并清理可能霸占 AppProfile 的无窗口僵死浏览器进程 (单实例互斥锁深度自愈)
$appProfileDir = Join-Path $env:LOCALAPPDATA "OpenCodeRouter\AppProfile"
if (Test-Path -LiteralPath $appProfileDir) {
    $lf = Join-Path $appProfileDir "lockfile"
    if (Test-Path -LiteralPath $lf) {
        $ghostProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { 
            $_.CommandLine -like "*OpenCodeRouter*AppProfile*"
        }
        if ($ghostProcs) {
            $hasWin = $false
            foreach ($gp in $ghostProcs) {
                $p = Get-Process -Id $gp.ProcessId -ErrorAction SilentlyContinue
                if ($p -and $p.MainWindowHandle -ne 0) { $hasWin = $true; break }
            }
            if (-not $hasWin) {
                foreach ($gp in $ghostProcs) {
                    Stop-Process -Id $gp.ProcessId -Force -ErrorAction SilentlyContinue
                }
                Remove-Item -LiteralPath $lf -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

if (Test-Path -LiteralPath $appExe) {
    Start-Process -FilePath $appExe -WorkingDirectory $rootDir
    return
}

$trayScript = if (Test-Path -LiteralPath (Join-Path $rootDir "tray-daemon.ps1")) { 
    Join-Path $rootDir "tray-daemon.ps1" 
} else { 
    Join-Path $rootDir "tray-runner.ps1" 
}

$running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { 
    $_.CommandLine -like "*tray-daemon.ps1*" -or $_.CommandLine -like "*tray-runner.ps1*" -or $_.Name -eq "OpenCodeRouterTray.exe"
}

if (-not $running) {
    if (Test-Path -LiteralPath (Join-Path $rootDir "OpenCodeRouterTray.exe")) {
        Start-Process -FilePath (Join-Path $rootDir "OpenCodeRouterTray.exe") -WorkingDirectory $rootDir
    } elseif (Test-Path -LiteralPath $trayScript) {
        Start-Process powershell.exe -ArgumentList @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $trayScript) -WorkingDirectory $rootDir -WindowStyle Hidden
    }
} else {
    $browserCandidates = @(
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    )
    $browserExe = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    $targetUrl = "http://127.0.0.1:$port/balancer/ui"
    if ($browserExe) {
        Start-Process -FilePath $browserExe -ArgumentList "--app=$targetUrl"
    } else {
        Start-Process $targetUrl
    }
}
