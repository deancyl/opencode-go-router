# launcher.ps1: 智能检测托盘守护并唤出控制台
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$rootDir = if ($PSScriptRoot) { $PSScriptRoot } else { "$env:USERPROFILE\.opencode-go-router" }
$trayScript = Join-Path $rootDir "tray-runner.ps1"
$port = 4010

$running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*tray-runner.ps1*" }

if (-not $running) {
    Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$trayScript`"", "-ShowUI") -WindowStyle Hidden
} else {
    $edgePaths = @(
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    )
    $edgeExe = $edgePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($edgeExe) {
        Start-Process -FilePath $edgeExe -ArgumentList "--app=http://127.0.0.1:$port/balancer/ui"
    } else {
        Start-Process "http://127.0.0.1:$port/balancer/ui"
    }
}
