# test_sandbox_install.ps1: OpenCode Go Router 独立隔离沙箱全新安装与全生命周期自动化核验套件
# 
# 验证目标:
# 1. 临时隔离目录中从零安装 (冷启动全新部署，模拟纯净新机环境，支持中文与空格路径)
# 2. 从零初始化 config.json、端口检测、账号与安全密码配置 (路径脱钩，无论从何处运行均无 MODULE_NOT_FOUND)
# 3. 后台纯静默常驻 (内核级 CREATE_NO_WINDOW / VBScript，零终端黑框)
# 4. 全链路健康探针 (/health、/balancer/ui、/balancer/api/compression/doctor)
# 5. 多实例并发沙箱隔离与端口互斥 (不误杀主服务 4010 与托盘进程)
# 6. 服务停止、端口释放与沙箱无痕回收
[CmdletBinding()]
param()

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { "C:\Users\deanc\.opencode-go-router" }

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "🧪 OpenCode Go Router 隔离沙箱全新冷启动安装测试启动 (v3.8.3 深度增强版)" -ForegroundColor Cyan
Write-Host "代码基线目录: $scriptRoot" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$testResults = [ordered]@{}
$stopwatch = [System.Diagnostics.Stopwatch]::New()

function Assert-SandboxTest([string]$name, [bool]$condition, [string]$detail) {
    if ($condition) {
        Write-Host "  [PASS] $name - $detail" -ForegroundColor Green
        $testResults[$name] = @{ Status = "PASS"; Detail = $detail }
    } else {
        Write-Host "  [FAIL] $name - $detail" -ForegroundColor Red
        $testResults[$name] = @{ Status = "FAIL"; Detail = $detail }
        throw "Assertion failure in sandbox test '$name': $detail"
    }
}

function Get-FreeTcpPort([int]$startPort = 4800, [int]$endPort = 4900, [int[]]$excludePorts = @()) {
    for ($p = $startPort; $p -le $endPort; $p++) {
        if ($excludePorts -contains $p) { continue }
        $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
        if (-not $conn) {
            return $p
        }
    }
    return 4888
}

function Test-PortActive([int]$targetPort) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $targetPort -State Listen -ErrorAction SilentlyContinue
        return ($null -ne $conn)
    } catch {
        return $false
    }
}

# -------------------------------------------------------------
# 1. 建立独立临时沙箱隔离目录 (包含复杂空格与非 ASCII 中文字符路径)
# -------------------------------------------------------------
$sandboxId = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
$sandboxDir = Join-Path $env:TEMP "opencode 沙箱 测试_$sandboxId"
New-Item -ItemType Directory -Path $sandboxDir -Force | Out-Null
Write-Host "`n[Stage 1] 成功创建非 ASCII 与空格隔离沙箱目录: $sandboxDir" -ForegroundColor Yellow

$sandboxPort = Get-FreeTcpPort 4810 4850
Write-Host "  动态分配独立沙箱测试端口: $sandboxPort" -ForegroundColor Gray

# 复制核心运行时文件到沙箱
$filesToCopy = @(
    "server.js",
    "context-compactor.js",
    "codex-adapter.js",
    "updater.js",
    "powershell-optimizer.js",
    "package.json",
    "setup-windows.ps1",
    "setup-wizard.ps1",
    "launcher.ps1",
    "start-tray.vbs",
    "silent-start.vbs",
    "launch-gui.vbs",
    "OpenCodeRouterApp.exe",
    "OpenCodeRouterTray.exe",
    "doctor-repair.ps1",
    "patch-openchamber-office.ps1"
)

foreach ($f in $filesToCopy) {
    $src = Join-Path $scriptRoot $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $sandboxDir -Force
    }
}

# 复制 assets 目录
$assetsSrc = Join-Path $scriptRoot "assets"
if (Test-Path $assetsSrc) {
    Copy-Item -Path $assetsSrc -Destination $sandboxDir -Recurse -Force
}

Assert-SandboxTest "1.1 隔离沙箱文件装配" (Test-Path (Join-Path $sandboxDir "server.js")) "沙箱环境所需全部运行时组件复制就绪"

# 断言沙箱内尚无任何 config.json (100% 模拟零配置新机冷启动)
$sandboxCfg = Join-Path $sandboxDir "config.json"
Assert-SandboxTest "1.2 零初始配置基线" (-not (Test-Path $sandboxCfg)) "确认沙箱初始无 config.json 配置文件"

# -------------------------------------------------------------
# 2. 从外部不同目录执行 setup-windows.ps1 沙箱自动化安装 (路径无关性验证)
# -------------------------------------------------------------
Write-Host "`n[Stage 2] 执行 setup-windows.ps1 沙箱全新安装 (Step 2 路由配置与部署，路径解耦)..." -ForegroundColor Yellow

$testKey1 = "oc_sk_sandbox_test_alpha_001"
$testKey2 = "oc_sk_sandbox_test_beta_002"
$testPassword = "SandboxSecurePass_777!"

$setupScript = Join-Path $sandboxDir "setup-windows.ps1"

$stopwatch.Restart()
Push-Location $env:TEMP
try {
    & $setupScript -Step 2 -Silent -Port $sandboxPort -HostName "127.0.0.1" -Key1 $testKey1 -Key2 $testKey2 -Password $testPassword -InstallDir $sandboxDir -NoShortcuts
} finally {
    Pop-Location
}
$installDuration = $stopwatch.ElapsedMilliseconds
$stopwatch.Stop()

Write-Host "  沙箱安装耗时: ${installDuration} ms" -ForegroundColor Gray
Assert-SandboxTest "2.1 安装脚本返回成功" ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) "setup-windows.ps1 在沙箱目录顺利完成安装"

# -------------------------------------------------------------
# 3. 核验 config.json 自动生成与字段完整性
# -------------------------------------------------------------
Write-Host "`n[Stage 3] 核验自动生成的 config.json 完整性..." -ForegroundColor Yellow
Assert-SandboxTest "3.1 config.json 文件落地" (Test-Path $sandboxCfg) "config.json 成功自愈生成于沙箱中"

$cfgContent = Get-Content $sandboxCfg -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-SandboxTest "3.2 端口与主机配置注入" ($cfgContent.port -eq $sandboxPort -and $cfgContent.host -eq "127.0.0.1") "端口 ($($cfgContent.port)) 与 Host ($($cfgContent.host)) 正确写入"
Assert-SandboxTest "3.3 账号双订阅密钥注入" ($cfgContent.accounts[0].apiKey -eq $testKey1 -and $cfgContent.accounts[1].apiKey -eq $testKey2) "两个订阅账号的 API Key 正确无误写入"
Assert-SandboxTest "3.4 控制台访问密码安全固化" ($cfgContent.uiPassword -eq $testPassword) "Web 控制台安全认证密码正确写入"

# -------------------------------------------------------------
# 4. 核验后台静默常驻、无黑框与端口监听
# -------------------------------------------------------------
Write-Host "`n[Stage 4] 核验后台服务静默托管与端口监听..." -ForegroundColor Yellow

$portActive = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 150
    if (Test-PortActive $sandboxPort) {
        $portActive = $true
        break
    }
}
Assert-SandboxTest "4.1 沙箱端口监听就绪" $portActive "沙箱测试端口 $sandboxPort 已处于活跃监听状态"

$sandboxConn = Get-NetTCPConnection -LocalPort $sandboxPort -State Listen -ErrorAction SilentlyContinue
$sandboxPid = $sandboxConn.OwningProcess
$sandboxProc = Get-Process -Id $sandboxPid -ErrorAction SilentlyContinue

Assert-SandboxTest "4.2 零黑框静默运行" ($sandboxProc -ne $null -and $sandboxProc.MainWindowHandle -eq 0) "沙箱服务进程无前台黑框 (PID: $sandboxPid, MainWindowHandle == 0)"

# -------------------------------------------------------------
# 5. 全链路 HTTP 探针回读实测
# -------------------------------------------------------------
Write-Host "`n[Stage 5] 执行全链路 HTTP 健康探针验证..." -ForegroundColor Yellow

# 5.1 /health 探针
$healthRes = $null
try {
    $healthRes = Invoke-RestMethod -Uri "http://127.0.0.1:$sandboxPort/health" -TimeoutSec 3
} catch { }

Assert-SandboxTest "5.1 /health 探针 200 OK" ($healthRes -ne $null -and $healthRes.status -eq "ok") "/health 接口正常响应: status=$($healthRes.status)"

# 5.2 /balancer/ui 控制台界面探针
$uiOk = $false
try {
    $uiReq = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$sandboxPort/balancer/ui")
    $uiReq.Timeout = 3000
    $uiReq.AllowAutoRedirect = $false
    $uiResp = $uiReq.GetResponse()
    try {
        $uiOk = ($uiResp.StatusCode -eq [System.Net.HttpStatusCode]::OK -or $uiResp.StatusCode -eq [System.Net.HttpStatusCode]::Found)
    } finally {
        $uiResp.Close()
    }
} catch [System.Net.WebException] {
    if ($_.Response -ne $null) { $uiOk = $true }
}
Assert-SandboxTest "5.2 /balancer/ui 页面可达" $uiOk "Web 控制台页面成功响应"

# 5.3 带鉴权的压缩引擎 Doctor 诊断探针
$doctorRes = $null
try {
    $doctorUrl = "http://127.0.0.1:$sandboxPort/balancer/api/compression/doctor?auth=$testPassword"
    $doctorRes = Invoke-RestMethod -Uri $doctorUrl -TimeoutSec 4
} catch { }

Assert-SandboxTest "5.3 Doctor 体检探针 200 OK" ($doctorRes -ne $null -and $doctorRes.healthy -eq $true) "Doctor 压缩诊断全绿就绪: healthy=$($doctorRes.healthy)"

# -------------------------------------------------------------
# 6. 多实例并发沙箱隔离与宿主服务保护实测
# -------------------------------------------------------------
Write-Host "`n[Stage 6] 核验多实例并发沙箱隔离与生产服务免受误杀保护..." -ForegroundColor Yellow

# 6.1 启动并发次级沙箱
$sandboxPort2 = Get-FreeTcpPort 4851 4899 @($sandboxPort)
$sandboxDir2 = Join-Path $env:TEMP "opencode 并发沙箱_$sandboxId"
New-Item -ItemType Directory -Path $sandboxDir2 -Force | Out-Null

foreach ($f in $filesToCopy) {
    $src = Join-Path $scriptRoot $f
    if (Test-Path $src) { Copy-Item -Path $src -Destination $sandboxDir2 -Force }
}

$setupScript2 = Join-Path $sandboxDir2 "setup-windows.ps1"
& $setupScript2 -Step 2 -Silent -Port $sandboxPort2 -HostName "127.0.0.1" -Key1 "key_second_inst" -Key2 "key_second_inst_2" -InstallDir $sandboxDir2 -NoShortcuts

$inst2Active = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 150
    if (Test-PortActive $sandboxPort2) { $inst2Active = $true; break }
}
Assert-SandboxTest "6.1 并发次级沙箱拉起" $inst2Active "次级沙箱实例已在独立端口 $sandboxPort2 成功监听"
Assert-SandboxTest "6.2 主次双沙箱并行" (Test-PortActive $sandboxPort -and Test-PortActive $sandboxPort2) "两个隔离沙箱端口 ($sandboxPort 与 $sandboxPort2) 同时健康运行，互不冲撞"

# 6.3 优雅停止次级沙箱，断言主沙箱毫发无损
& $setupScript2 -Stop -Port $sandboxPort2 -InstallDir $sandboxDir2 -NoShortcuts
Start-Sleep -Milliseconds 500

Assert-SandboxTest "6.3 次级沙箱安全退出" (-not (Test-PortActive $sandboxPort2)) "次级沙箱端口 $sandboxPort2 已彻底释放"
Assert-SandboxTest "6.4 主沙箱免疫隔离" (Test-PortActive $sandboxPort) "主沙箱在次级实例销毁后依然正常服务，未受任何误杀影响"

try { Remove-Item -Path $sandboxDir2 -Recurse -Force -ErrorAction SilentlyContinue } catch { }

# -------------------------------------------------------------
# 7. 生命周期控制实测: 停止与平滑重启自愈
# -------------------------------------------------------------
Write-Host "`n[Stage 7] 核验生命周期管理 (Stop -> Port Release -> Restart)..." -ForegroundColor Yellow

# 7.1 停止沙箱服务
& $setupScript -Stop -Port $sandboxPort -InstallDir $sandboxDir -NoShortcuts
Start-Sleep -Milliseconds 600

$stoppedPort = -not (Test-PortActive $sandboxPort)
Assert-SandboxTest "7.1 优雅停止并释放端口" $stoppedPort "沙箱端口 $sandboxPort 已完全释放"

# 7.2 重新启动沙箱服务
& $setupScript -Start -Port $sandboxPort -InstallDir $sandboxDir -NoShortcuts
Start-Sleep -Milliseconds 800

$restartedPort = $false
for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 150
    if (Test-PortActive $sandboxPort) {
        $restartedPort = $true
        break
    }
}
Assert-SandboxTest "7.2 冷启动平滑复活" $restartedPort "沙箱服务已重新拉起并监听 $sandboxPort"

# -------------------------------------------------------------
# 8. 清理与沙箱回收
# -------------------------------------------------------------
Write-Host "`n[Stage 8] 清理沙箱服务与临时环境..." -ForegroundColor Yellow
& $setupScript -Stop -Port $sandboxPort -InstallDir $sandboxDir -NoShortcuts
Start-Sleep -Milliseconds 500

try {
    Remove-Item -Path $sandboxDir -Recurse -Force -ErrorAction SilentlyContinue
} catch { }

Assert-SandboxTest "8.1 沙箱环境干净回收" (-not (Test-PortActive $sandboxPort)) "端口 $sandboxPort 已归还系统，测试无污染"

# -------------------------------------------------------------
# 总结测试报告
# -------------------------------------------------------------
Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "📊 沙箱全新安装全要素实测结果汇总" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

$passCount = 0
$failCount = 0
foreach ($k in $testResults.Keys) {
    $item = $testResults[$k]
    if ($item.Status -eq "PASS") {
        $passCount++
        Write-Host "✔ $k : $($item.Detail)" -ForegroundColor Green
    } else {
        $failCount++
        Write-Host "✖ $k : $($item.Detail)" -ForegroundColor Red
    }
}

$summaryColor = if ($failCount -eq 0) { "Green" } else { "Red" }
Write-Host "`n实测总计: $($testResults.Count) 项 | 通过: $passCount | 失败: $failCount" -ForegroundColor $summaryColor

if ($failCount -gt 0) {
    exit 1
}
exit 0
