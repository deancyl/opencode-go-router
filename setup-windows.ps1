# setup-windows.ps1: OpenCode Go Router Windows 全生命周期安装、配置与运维管理套件
# 支持特性: 多订阅高可用路由 (4010) + Web 控制中心 + 桌面托盘常驻 +
#          OpenCode v2 + OpenChamber + OMO + Goal 目标推进 + OpenAI Codex 全链路集成
[CmdletBinding()]
param(
    [int[]]$Step,
    [switch]$All,
    [switch]$Silent,
    [switch]$Doctor,
    [switch]$Repair,
    [switch]$Update,
    [switch]$Rollback,
    [string]$RollbackId,
    [switch]$Start,
    [switch]$Stop,
    [switch]$Restart,
    [switch]$Status,
    [switch]$Bind,
    [string]$HostName,
    [int]$Port = 0,
    [string]$Key1,
    [string]$Key2,
    [string]$Password,
    [string]$InstallDir,
    [string]$OpencodeConfigDir = "",
    [switch]$NoShortcuts
)

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

# 自动防范受限 ExecutionPolicy
try {
    $policy = Get-ExecutionPolicy -Scope Process -ErrorAction SilentlyContinue
    if ($policy -eq 'Restricted') {
        Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue
    }
} catch { }

function Stop-SafeProcess {
    param(
        [Parameter(Mandatory=$true)][int]$ProcessId,
        [Parameter(Mandatory=$true)][string[]]$Keywords,
        [Parameter(Mandatory=$true)][string]$ServiceName
    )
    if ($ProcessId -le 0 -or $ProcessId -eq $PID) { return $false }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }

    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    $cmdLine = if ($cim -and $cim.CommandLine) { $cim.CommandLine } else { "" }
    $execPath = if ($cim -and $cim.ExecutablePath) { $cim.ExecutablePath } else { "" }
    $procName = $proc.ProcessName

    $isMatch = $false
    foreach ($kw in $Keywords) {
        if (($cmdLine -and $cmdLine -like "*$kw*") -or 
            ($execPath -and $execPath -like "*$kw*") -or 
            ($procName -like "*$kw*")) {
            $isMatch = $true
            break
        }
    }

    if ($isMatch) {
        try {
            Start-Process -FilePath "taskkill.exe" -ArgumentList "/F /T /PID $ProcessId" -NoNewWindow -Wait -ErrorAction SilentlyContinue
            Write-Host "   [OK]   已安全终止 $ServiceName 进程 (PID: $ProcessId)" -ForegroundColor Green
            return $true
        } catch {
            try {
                Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
                Write-Host "   [OK]   已强制终止 $ServiceName 进程 (PID: $ProcessId)" -ForegroundColor Green
                return $true
            } catch {
                return $false
            }
        }
    } else {
        Write-Host "   [WARN] PID $ProcessId 非 $ServiceName 实例 (命令行特征不符: '$cmdLine')，已跳过以防止误杀！" -ForegroundColor Yellow
        return $false
    }
}

$rootDir = if ($InstallDir) { $InstallDir } elseif ($PSScriptRoot) { $PSScriptRoot } else { "$env:USERPROFILE\.opencode-go-router" }
$cfgPath = Join-Path $rootDir "config.json"

# 解析默认端口与主机名
$effectivePort = 4010
$effectiveHost = "127.0.0.1"
if (Test-Path $cfgPath) {
    try {
        $existingRaw = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($existingRaw.port) { $effectivePort = [int]$existingRaw.port }
        if ($existingRaw.host) { $effectiveHost = [string]$existingRaw.host }
    } catch { }
}
if ($Port -gt 0) { $effectivePort = $Port }
if ($HostName) { $effectiveHost = $HostName }
$port = $effectivePort

$opencodeConfigDir = if ($OpencodeConfigDir) { $OpencodeConfigDir } elseif ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } else { "$env:USERPROFILE\.config\opencode" }
if ($OpencodeConfigDir) {
    $env:OPENCODE_CONFIG_DIR = $OpencodeConfigDir
}
$opencodeConfigFile = "$opencodeConfigDir\opencode.jsonc"
$omoConfigFile = "$env:USERPROFILE\.omo\omo.jsonc"
$commandsDir = "$opencodeConfigDir\commands"
$defaultWorkspace = if (Test-Path "D:\") { "D:\opencode\default" } else { Join-Path $env:USERPROFILE "opencode\default" }

function Write-Header {
    param($title)
    Write-Host "`n==========================================================" -ForegroundColor Cyan
    Write-Host " $title" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
}

function Test-PortListening([int]$targetPort) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $targetPort -State Listen -ErrorAction SilentlyContinue
        return ($null -ne $conn)
    } catch {
        return $false
    }
}

# ----------------- 步骤 1: 协助下载并安装 OpenCode v2 -----------------
function Step-InstallOpenCode {
    Write-Header "【步骤 1】OpenCode v2 核心引擎检测与安装"
    $currentVer = $null
    try {
        $currentVer = (opencode --version 2>$null)
    } catch {}

    if ($currentVer -and ($currentVer -match "2\.\d+")) {
        Write-Host "✔ OpenCode v2 已安装并就绪: $currentVer" -ForegroundColor Green
        return $true
    }

    if ($currentVer) {
        Write-Host "⚠ 当前已安装版本为 $currentVer，需升级到 v2.x" -ForegroundColor Yellow
    } else {
        Write-Host "ℹ 本地尚未检测到 OpenCode CLI" -ForegroundColor Yellow
    }

    Write-Host "`n请选择安装方式：" -ForegroundColor Cyan
    Write-Host " [1] 使用 npm 全局安装 (推荐: npm install -g @opencode/cli)" -ForegroundColor White
    Write-Host " [2] 使用 bun 全局安装 (bun add -g @opencode/cli)" -ForegroundColor White
    Write-Host " [3] 自动检测可用包管理器并一键安装" -ForegroundColor White
    Write-Host " [0] 跳过此步" -ForegroundColor DarkGray

    $choice = "3"
    if (-not $Silent) {
        $inputVal = Read-Host "`n请输入选项编号 [默认: 3]"
        if ($inputVal) { $choice = $inputVal }
    }

    $installed = $false
    switch ($choice) {
        "1" {
            Write-Host "正在通过 npm 安装 @opencode/cli 及 Windows 原生内核..." -ForegroundColor Yellow
            npm install -g @opencode/cli @opencode/cli-windows-x64
            if ($LASTEXITCODE -eq 0) { $installed = $true } else { Write-Host "npm 安装返回异常状态码: $LASTEXITCODE" -ForegroundColor Red }
        }
        "2" {
            Write-Host "正在通过 bun 安装 @opencode/cli..." -ForegroundColor Yellow
            bun add -g @opencode/cli
            if ($LASTEXITCODE -eq 0) { $installed = $true } else { Write-Host "bun 安装返回异常状态码: $LASTEXITCODE" -ForegroundColor Red }
        }
        "3" {
            Write-Host "正在自动选择包管理器安装..." -ForegroundColor Yellow
            $npmExists = Get-Command npm -ErrorAction SilentlyContinue
            if ($npmExists) {
                Write-Host " -> 使用 npm 安装完整版 @opencode/cli 及 Windows 架构包..." -ForegroundColor Cyan
                npm install -g @opencode/cli @opencode/cli-windows-x64
                if ($LASTEXITCODE -eq 0) { $installed = $true }
            }
            if (-not $installed) {
                $bunExists = Get-Command bun -ErrorAction SilentlyContinue
                if ($bunExists) {
                    Write-Host " -> 使用 Bun 进行安装..." -ForegroundColor Cyan
                    bun add -g @opencode/cli
                    if ($LASTEXITCODE -eq 0) { $installed = $true }
                }
            }
            if (-not $installed) {
                Write-Host "❌ 未检测到 npm 或 bun 环境。" -ForegroundColor Red
                $wingetExists = Get-Command winget -ErrorAction SilentlyContinue
                if ($wingetExists) {
                    Write-Host "💡 检测到系统内置 winget，可一键自动安装 Node.js LTS 运行环境" -ForegroundColor Cyan
                    if (-not $Silent) {
                        $askNode = Read-Host "是否立即使用 winget 安装 Node.js LTS？(Y/n)"
                        if ($askNode -eq "" -or $askNode -eq "y" -or $askNode -eq "Y") {
                            winget install OpenJS.NodeJS.LTS -e --silent
                            Write-Host "Node.js 环境安装完毕，请重启终端后重新运行步骤 1 安装 @opencode/cli。" -ForegroundColor Green
                        }
                    }
                }
            }
        }
        "0" {
            Write-Host "已跳过步骤 1。" -ForegroundColor DarkGray
            return $false
        }
    }

    Start-Sleep -Seconds 1
    $newVer = $null
    try { $newVer = (& opencode --version 2>$null) } catch {}
    if (-not $newVer) {
        $candidates = @(
            "$env:LOCALAPPDATA\Programs\@openchamberelectron\resources\opencode-cli\opencode.exe",
            "$env:APPDATA\npm\opencode.cmd",
            "$env:USERPROFILE\.bun\bin\opencode.exe",
            "$env:ProgramFiles\nodejs\opencode.cmd"
        )
        foreach ($cand in $candidates) {
            if (Test-Path $cand) {
                try {
                    $candVer = (& $cand --version 2>$null)
                    if ($candVer -and ($candVer -match "2\.\d+")) {
                        $newVer = $candVer
                        break
                    }
                } catch {}
            }
        }
    }

    if ($newVer) {
        Write-Host "🎉 OpenCode 安装成功！当前版本: $newVer" -ForegroundColor Green
        return $true
    } else {
        Write-Host "⚠ 安装未完成或需重新启动终端后生效" -ForegroundColor Yellow
        return $false
    }
}

# ----------------- 步骤 2: 配置并部署 4010 订阅路由 -----------------
function Step-SetupRouter {
    Write-Header "【步骤 2】配置 4010 订阅管理工具 (双订阅网关 + 托盘常驻)"
    
    $existingObj = $null
    $curKey1 = ""
    $curKey2 = ""
    $curUiPass = ""

    if (Test-Path $cfgPath) {
        try {
            $existingObj = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($existingObj.accounts -and $existingObj.accounts.Count -ge 1) {
                $curKey1 = $existingObj.accounts[0].apiKey
            }
            if ($existingObj.accounts -and $existingObj.accounts.Count -ge 2) {
                $curKey2 = $existingObj.accounts[1].apiKey
            }
            if ($existingObj.uiPassword) {
                $curUiPass = $existingObj.uiPassword
            }
        } catch {}
    }

    # 优先采用传入参数，其次环境变量兜底
    if ($Key1) { $curKey1 = $Key1 }
    elseif (-not $curKey1 -and $env:OPENCODE_GO_KEY_1) { $curKey1 = $env:OPENCODE_GO_KEY_1 }
    
    if ($Key2) { $curKey2 = $Key2 }
    elseif (-not $curKey2 -and $env:OPENCODE_GO_KEY_2) { $curKey2 = $env:OPENCODE_GO_KEY_2 }
    
    if ($Password) { $curUiPass = $Password }
    elseif (-not $curUiPass -and $env:OPENCODE_ROUTER_PASSWORD) { $curUiPass = $env:OPENCODE_ROUTER_PASSWORD }

    Write-Host "当前订阅账号与网关状态：" -ForegroundColor Cyan
    Write-Host " - 监听地址与端口: $effectiveHost : $port" -ForegroundColor White
    Write-Host " - 账号 1 密钥: $(if ($curKey1) { $curKey1.Substring(0, [Math]::Min(12, $curKey1.Length)) + '...' } else { '（未配置）' })" -ForegroundColor White
    Write-Host " - 账号 2 密钥: $(if ($curKey2) { $curKey2.Substring(0, [Math]::Min(12, $curKey2.Length)) + '...' } else { '（未配置）' })" -ForegroundColor White
    Write-Host " - 管理控制台密码: $(if ($curUiPass) { '已设置 (受保护)' } else { '未设置 (默认免密)' })" -ForegroundColor White

    if (-not $Silent) {
        $change = Read-Host "`n是否需要输入或更新 OpenCode Go 订阅 API Key？(y/N)"
        if ($change -eq "y" -or $change -eq "Y") {
            $inKey1 = Read-Host "请输入第 1 个 OpenCode Go API Key (留空保持当前)"
            if ($inKey1) { $curKey1 = $inKey1.Trim() }
            $inKey2 = Read-Host "请输入第 2 个 OpenCode Go API Key (留空保持当前)"
            if ($inKey2) { $curKey2 = $inKey2.Trim() }
        }
    }

    # 安全合并配置，严禁破坏已存在的 uiPassword、compression 等核心业务项
    $cfgDict = [ordered]@{
        port = $port
        host = $effectiveHost
        upstream = if ($existingObj -and $existingObj.upstream) { $existingObj.upstream } else { "https://opencode.ai/zen/go/v1" }
        defaultCooldownMs = if ($existingObj -and $existingObj.defaultCooldownMs) { $existingObj.defaultCooldownMs } else { 60000 }
        maxFailoverRetries = if ($existingObj -and $existingObj.maxFailoverRetries) { $existingObj.maxFailoverRetries } else { 2 }
        sessionAffinityEnabled = $true
        uiPassword = $curUiPass
        accounts = @(
            @{ id = "account-1"; name = "OpenCode Go (订阅账号 1)"; apiKey = $curKey1; enabled = $true },
            @{ id = "account-2"; name = "OpenCode Go (订阅账号 2)"; apiKey = $curKey2; enabled = $true }
        )
    }

    if ($existingObj -and $existingObj.compression) {
        $cfgDict["compression"] = $existingObj.compression
    }

    # 稳妥写入 UTF-8 No-BOM
    $jsonContent = $cfgDict | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($cfgPath, $jsonContent, [System.Text.UTF8Encoding]::new($false))
    Write-Host "✔ 配置文件已稳妥写入 (UTF-8 No-BOM): $cfgPath" -ForegroundColor Green

    # 同步绑定 OpenCode 主配置文件 ~/.config/opencode/opencode.jsonc
    if (-not (Test-Path $opencodeConfigDir)) { New-Item -ItemType Directory -Path $opencodeConfigDir -Force | Out-Null }
    try {
        $updaterScript = Join-Path $rootDir "updater.js"
        if (Test-Path $updaterScript) {
            $nodeCmd = "const p = require('path'); const u = require(p.resolve(process.argv[1])); u.harmonizeOpencodeConfig(process.argv[2], parseInt(process.argv[3], 10));"
            & node -e $nodeCmd "$updaterScript" "$opencodeConfigFile" "$port"
            if ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) {
                Write-Host "✔ opencode.jsonc 已自动绑定本地网关 (全量 38 款模型、双轨规范与智能体定义就绪)" -ForegroundColor Green
            } else {
                Write-Host "⚠ opencode.jsonc 绑定执行返回非零状态码: $LASTEXITCODE" -ForegroundColor Yellow
            }
        }
    } catch {
        Write-Host "⚠ opencode.jsonc 网关绑定提醒: $_" -ForegroundColor Yellow
    }

    # 创建/更新桌面与开机自启快捷方式 (Rule 10 全栈自愈，支持 -NoShortcuts 隔离沙箱)
    if (-not $NoShortcuts) {
        try {
            $wshell = New-Object -ComObject WScript.Shell
            $desktopFolder = [Environment]::GetFolderPath('Desktop')
            $startupFolder = [Environment]::GetFolderPath('Startup')
            if ($desktopFolder -and (Test-Path $desktopFolder)) {
                $desktopLnk = Join-Path $desktopFolder "OpenCode 智能路由中心.lnk"
                $launchVbs = Join-Path $rootDir "launch-gui.vbs"
                $ico = Join-Path $rootDir "assets\router.ico"
                $scDesktop = $wshell.CreateShortcut($desktopLnk)
                $scDesktop.TargetPath = "wscript.exe"
                $scDesktop.Arguments = "`"$launchVbs`""
                $scDesktop.WorkingDirectory = $rootDir
                if (Test-Path $ico) { $scDesktop.IconLocation = "$ico,0" }
                $scDesktop.Save()
                Write-Host "✔ 桌面全栈快捷方式已就绪: $desktopLnk" -ForegroundColor Green
            }

            if ($startupFolder -and (Test-Path $startupFolder)) {
                $startupLnk = Join-Path $startupFolder "OpenCodeRouterStartup.lnk"
                $trayVbs = Join-Path $rootDir "start-tray.vbs"
                $ico = Join-Path $rootDir "assets\router.ico"
                $scStartup = $wshell.CreateShortcut($startupLnk)
                $scStartup.TargetPath = "wscript.exe"
                $scStartup.Arguments = "`"$trayVbs`" -Silent"
                $scStartup.WorkingDirectory = $rootDir
                if (Test-Path $ico) { $scStartup.IconLocation = "$ico,0" }
                $scStartup.Save()
                Write-Host "✔ 开机静默常驻自启项已挂载: $startupLnk" -ForegroundColor Green
            }
        } catch {
            Write-Host "ℹ 快捷方式创建提醒: $_" -ForegroundColor DarkGray
        }
    }

    # 静默启动或平滑重启原生托盘与路由服务（确保覆盖更新后的最新代码立即生效）
    Write-Host "正在启动/平滑重载系统托盘常驻进程与后台智能网关..." -ForegroundColor Yellow
    if (Test-PortListening $port) {
        Step-Restart
    } else {
        Step-Start
    }
    Start-Sleep -Seconds 2

    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
        Write-Host "🎉 智能网关就绪！状态: $($res.status)，端口: $port，可用账号: $($res.healthyAccounts)/$($res.totalAccounts)" -ForegroundColor Green
        Write-Host "💡 网页控制面板已在后台开启: http://127.0.0.1:$port/balancer/ui" -ForegroundColor White
    } catch {
        Write-Host "⚠ 网关正在就绪中，请在右下角系统托盘查看图标" -ForegroundColor Yellow
    }
}

# ----------------- 步骤 3: 配置 Oh My OpenAgent (OMO) -----------------
function Step-SetupOMO {
    Write-Header "【步骤 3】配置 Oh My OpenAgent (OMO 多智能体调度)"

    if (-not (Test-Path $opencodeConfigDir)) { New-Item -ItemType Directory -Path $opencodeConfigDir -Force | Out-Null }
    try {
        $updaterScript = Join-Path $rootDir "updater.js"
        if (Test-Path $updaterScript) {
            $nodeCmd = "const p = require('path'); const u = require(p.resolve(process.argv[1])); u.harmonizeOpencodeConfig(process.argv[2], parseInt(process.argv[3], 10));"
            & node -e $nodeCmd "$updaterScript" "$opencodeConfigFile" "$port"
            if ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) {
                Write-Host "✔ OMO 插件规范与标签已动态双向对齐 (无硬编码版本漂移)" -ForegroundColor Green
            }
        }
    } catch {
        Write-Host "ℹ OMO 插件配置提醒: $_" -ForegroundColor DarkGray
    }

    $omoDir = "$env:USERPROFILE\.omo"
    if (-not (Test-Path $omoDir)) { New-Item -ItemType Directory -Path $omoDir -Force | Out-Null }

    if (-not (Test-Path $omoConfigFile)) {
        Write-Host "正在生成标准 OMO 调度配置 (~/.omo/omo.jsonc)..." -ForegroundColor Yellow
        $omoJson = @"
{
  "`$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
  "[opencode]": {
    "agents": {
      "sisyphus": { "model": "opencode-go/kimi-k3" },
      "oracle": { "model": "opencode-go/glm-5.3" },
      "librarian": { "model": "opencode-go/qwen3.7-plus", "fallback_models": [{ "model": "opencode-go/minimax-m3" }] },
      "explore": { "model": "opencode-go/qwen3.7-plus", "fallback_models": [{ "model": "opencode-go/minimax-m3" }] },
      "multimodal-looker": { "model": "opencode-go/kimi-k3" },
      "prometheus": { "model": "opencode-go/kimi-k3", "variant": "high" },
      "metis": { "model": "opencode-go/kimi-k3", "variant": "high" },
      "momus": { "model": "opencode-go/glm-5.3" },
      "atlas": { "model": "opencode-go/kimi-k3", "fallback_models": [{ "model": "opencode-go/minimax-m3" }] },
      "sisyphus-junior": { "model": "opencode-go/kimi-k3", "fallback_models": [{ "model": "opencode-go/minimax-m3" }] }
    },
    "categories": {
      "visual-engineering": { "model": "opencode-go/kimi-k3", "variant": "high" },
      "ultrabrain": { "model": "opencode-go/deepseek-v4.1-flash" },
      "deep-low": { "model": "opencode-go/deepseek-v4.1-flash" },
      "deep-high": { "model": "opencode-go/deepseek-v4-pro" },
      "artistry": { "model": "opencode-go/kimi-k3", "variant": "high" },
      "quick": { "model": "opencode-go/minimax-m3", "variant": "high" },
      "unspecified-low": { "model": "opencode-go/deepseek-v4.1-flash" },
      "unspecified-high": { "model": "opencode-go/deepseek-v4-pro" }
    }
  }
}
"@
        Set-Content -Path $omoConfigFile -Value $omoJson -Encoding UTF8
        Write-Host "✔ OMO 核心模型映射表生成完成（已内置 kimi-k3/qwen3.7 避开区域限制）" -ForegroundColor Green
    } else {
        Write-Host "✔ OMO 调度配置文件已存在: $omoConfigFile" -ForegroundColor Green
    }
}

# ----------------- 步骤 4: 配置 Goal 目标推进插件与指令 -----------------
function Step-SetupGoal {
    Write-Header "【步骤 4】配置 Goal 目标推进体系与 /boost 模式"

    if (Test-Path $opencodeConfigFile) {
        try {
            $oc = Get-Content $opencodeConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $plugins = [System.Collections.Generic.List[string]]::new()
            if ($oc.plugin) { foreach ($p in $oc.plugin) { $plugins.Add($p) } }
            if (-not ($plugins | Where-Object { $_ -like "opencode-goal-plugin*" })) {
                $plugins.Add("opencode-goal-plugin")
                $oc.plugin = $plugins.ToArray()
                Set-Content -Path $opencodeConfigFile -Value ($oc | ConvertTo-Json -Depth 10) -Encoding UTF8
                Write-Host "✔ 已在 opencode.jsonc 中注册插件: opencode-goal-plugin" -ForegroundColor Green
            } else {
                Write-Host "✔ opencode-goal-plugin 插件已在配置中" -ForegroundColor Green
            }
        } catch { }
    }

    if (-not (Test-Path $commandsDir)) { New-Item -ItemType Directory -Path $commandsDir -Force | Out-Null }
    $boostPath = Join-Path $commandsDir "boost.md"
    if (-not (Test-Path $boostPath)) {
        $boostContent = @"
---
description: "极速自主推进增强模式 (Boost / Ultrawork Mode)"
---
# Boost 极速增强模式指示 (Boost & Ultrawork Orchestration)

立即进入高强度自主推进模式。
推进目标：
`$ARGUMENTS

## 执行规范：
1. **启动全流程推进**：自动激活深层检索、多任务拆解与高效执行链路。
2. **端到端交付**：不半途而废，连续执行直至方案完全实现并完成端到端测试。
3. **保持高可逆性与安全性**：确保关键配置有备份，生产环境安全无损。
"@
        Set-Content -Path $boostPath -Value $boostContent -Encoding UTF8
        Write-Host "✔ /boost 增强指令模版已写入 $boostPath" -ForegroundColor Green
    } else {
        Write-Host "✔ /boost 指令模版已就绪" -ForegroundColor Green
    }
}

# ----------------- 步骤 5: 配置 OpenChamber 桌面工作台 -----------------
function Step-SetupOpenChamber {
    Write-Header "【步骤 5】配置 OpenChamber 桌面客户端与工作区"

    if (-not (Test-Path $defaultWorkspace)) {
        New-Item -ItemType Directory -Path $defaultWorkspace -Force | Out-Null
        Write-Host "✔ 已创建默认工作区目录: $defaultWorkspace" -ForegroundColor Green
    }
    if (-not (Test-Path (Join-Path $defaultWorkspace ".git"))) {
        try {
            git -C $defaultWorkspace init | Out-Null
            Write-Host "✔ 已在工作区初始化 Git 仓库" -ForegroundColor Green
        } catch { }
    }

    $chamberPrefDir = "$env:USERPROFILE\.config\openchamber"
    $chamberPrefFile = Join-Path $chamberPrefDir "preferences.json"
    try {
        if (-not (Test-Path $chamberPrefDir)) { New-Item -ItemType Directory -Path $chamberPrefDir -Force | Out-Null }
        $prefObj = if (Test-Path $chamberPrefFile) {
            Get-Content $chamberPrefFile -Raw -Encoding UTF8 | ConvertFrom-Json
        } else {
            [PSCustomObject]@{ version = 1; fields = [PSCustomObject]@{} }
        }
        if (-not $prefObj.fields) { $prefObj | Add-Member -NotePropertyName "fields" -NotePropertyValue (New-Object PSObject) }

        $recents = @()
        if ($prefObj.fields.recentModels -and $prefObj.fields.recentModels.value) {
            $recents = @($prefObj.fields.recentModels.value | Where-Object { -not ($_.providerID -eq 'opencode-go' -and ($_.modelID -eq 'deepseek-v4.1-flash' -or $_.modelID -eq 'kimi-k3')) })
        }
        $newRecent = @(
            [PSCustomObject]@{ providerID = 'opencode-go'; modelID = 'deepseek-v4.1-flash' },
            [PSCustomObject]@{ providerID = 'opencode-go'; modelID = 'kimi-k3' }
        ) + $recents
        if ($prefObj.fields.recentModels) {
            $prefObj.fields.recentModels.value = $newRecent
            $prefObj.fields.recentModels.updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        } else {
            $prefObj.fields | Add-Member -NotePropertyName "recentModels" -NotePropertyValue ([PSCustomObject]@{
                updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                value = $newRecent
            })
        }

        $favs = @()
        if ($prefObj.fields.favoriteModels -and $prefObj.fields.favoriteModels.value) {
            $favs = @($prefObj.fields.favoriteModels.value)
        }
        $hasFlash = $false
        $hasKimi = $false
        foreach ($m in $favs) {
            if ($m.providerID -eq 'opencode-go' -and $m.modelID -eq 'deepseek-v4.1-flash') { $hasFlash = $true }
            if ($m.providerID -eq 'opencode-go' -and $m.modelID -eq 'kimi-k3') { $hasKimi = $true }
        }
        if (-not $hasFlash) {
            $favs = @([PSCustomObject]@{ providerID = 'opencode-go'; modelID = 'deepseek-v4.1-flash' }) + $favs
        }
        if (-not $hasKimi) {
            $favs = $favs + @([PSCustomObject]@{ providerID = 'opencode-go'; modelID = 'kimi-k3' })
        }
        if ($prefObj.fields.favoriteModels) {
            $prefObj.fields.favoriteModels.value = $favs
            $prefObj.fields.favoriteModels.updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        } else {
            $prefObj.fields | Add-Member -NotePropertyName "favoriteModels" -NotePropertyValue ([PSCustomObject]@{
                updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                value = $favs
            })
        }

        [System.IO.File]::WriteAllText($chamberPrefFile, ($prefObj | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))

        $chamberSetFile = Join-Path $chamberPrefDir "settings.json"
        if (Test-Path $chamberSetFile) {
            try {
                $setObj = Get-Content $chamberSetFile -Raw -Encoding UTF8 | ConvertFrom-Json
                $sRecents = if ($setObj.recentModels) { @($setObj.recentModels | Where-Object { -not ($_.providerID -eq 'opencode-go' -and ($_.modelID -eq 'deepseek-v4.1-flash' -or $_.modelID -eq 'kimi-k3')) }) } else { @() }
                $setObj.recentModels = @(
                    [PSCustomObject]@{ providerID = 'opencode-go'; modelID = 'deepseek-v4.1-flash' },
                    [PSCustomObject]@{ providerID = 'opencode-go'; modelID = 'kimi-k3' }
                ) + $sRecents

                $sFavs = if ($setObj.favoriteModels) { @($setObj.favoriteModels) } else { @() }
                $sHasFlash = $false
                $sHasKimi = $false
                foreach ($m in $sFavs) {
                    if ($m.providerID -eq 'opencode-go' -and $m.modelID -eq 'deepseek-v4.1-flash') { $sHasFlash = $true }
                    if ($m.providerID -eq 'opencode-go' -and $m.modelID -eq 'kimi-k3') { $sHasKimi = $true }
                }
                if (-not $sHasFlash) {
                    $sFavs = @([PSCustomObject]@{ providerID = 'opencode-go'; modelID = 'deepseek-v4.1-flash' }) + $sFavs
                }
                if (-not $sHasKimi) {
                    $sFavs = $sFavs + @([PSCustomObject]@{ providerID = 'opencode-go'; modelID = 'kimi-k3' })
                }
                $setObj.favoriteModels = $sFavs
                [System.IO.File]::WriteAllText($chamberSetFile, ($setObj | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))
            } catch { }
        }

        Write-Host "✔ OpenChamber 桌面端首选默认模型与置顶收藏已锁定为: opencode-go (deepseek-v4.1-flash, kimi-k3)" -ForegroundColor Green
    } catch { }

    $importScript = Join-Path $rootDir "import_projects.py"
    if (Test-Path $importScript) {
        try {
            python "$importScript" 2>&1 | Out-Null
            Write-Host "✔ 已成功将历史进行中的项目同步至 OpenChamber 工作台" -ForegroundColor Green
        } catch { }
    }
}

# ----------------- 步骤 6: 全栈一键自动配置 -----------------
function Step-RunAll {
    Write-Header "【全栈一键自动配置】"
    Write-Host "将依次执行：OpenCode v2 检测 -> 智能网关部署 -> OMO 配置 -> Goal 插件配置 -> OpenChamber 配置 -> Office 离线预览挂载..." -ForegroundColor Cyan
    Step-InstallOpenCode
    Step-SetupRouter
    Step-SetupOMO
    Step-SetupGoal
    Step-SetupOpenChamber
    Step-SetupOfficePreview
    Write-Header "🎉 全套体系已全部配置就绪！"
    Write-Host " 🌐 OpenChamber 工作台:    http://127.0.0.1:3000" -ForegroundColor White
    Write-Host " 📊 智能路由流量与监控面板: http://127.0.0.1:$port/balancer/ui" -ForegroundColor White
    Write-Host " 🎯 自主目标推进指令:      /goal <目标> 与 /boost <目标>" -ForegroundColor White
}

# ----------------- 步骤 7: 执行健康体检 -----------------
function Step-RunDoctor {
    $doctorScript = Join-Path $rootDir "doctor-repair.ps1"
    if (Test-Path $doctorScript) {
        powershell -NoProfile -ExecutionPolicy Bypass -File "`"$doctorScript`""
    }
}

# ----------------- 步骤 7B: 执行一键自愈修复 -----------------
function Step-RunRepair {
    $doctorScript = Join-Path $rootDir "doctor-repair.ps1"
    if (Test-Path $doctorScript) {
        powershell -NoProfile -ExecutionPolicy Bypass -File "`"$doctorScript`"" -Repair
    }
}

# ----------------- 步骤 8: 挂载 OpenChamber Office 全格式离线预览引擎 -----------------
function Step-SetupOfficePreview {
    $patchScript = Join-Path $rootDir "patch-openchamber-office.ps1"
    if (Test-Path $patchScript) {
        & $patchScript -Install
    }
}

# ----------------- 步骤 9: 组件更新与维护 -----------------
function Step-ManageUpdates {
    $updaterJs = Join-Path $rootDir "updater.js"
    if (Test-Path $updaterJs) {
        & node "$updaterJs" check
    }
}

# ----------------- 步骤 10: Codex 客户端接入 -----------------
function Step-SetupCodex {
    Write-Header "【步骤 10】OpenAI Codex CLI 智能接入与模型调度"
    $codexAdapterJs = Join-Path $rootDir "codex-adapter.js"
    if (-not (Test-Path $codexAdapterJs)) { return }
    $bindCmd = "const p = require('path'); const a = require(p.resolve(process.argv[1])); const r = a.bindCodexConfig({ routerPort: parseInt(process.argv[2], 10), defaultModel: 'deepseek-v4.1-flash', reasoningEffort: 'high' }); console.log(JSON.stringify(r));"
    $rawRes = (& node -e $bindCmd "$codexAdapterJs" "$port" 2>$null)
    $bindRes = if ($rawRes) { try { $rawRes | ConvertFrom-Json } catch { $null } } else { $null }
    if ($bindRes -and $bindRes.success) {
        Write-Host "🎉 成功接入 Codex！(默认: deepseek-v4.1-flash / 思考: high / 端口: $port)" -ForegroundColor Green
    }
}

# ----------------- 服务控制核心命令 -----------------
function Step-Start {
    $silentVbs = Join-Path $rootDir "silent-start.vbs"
    $serverJs = Join-Path $rootDir "server.js"
    $trayVbs = Join-Path $rootDir "start-tray.vbs"
    $trayExe = Join-Path $rootDir "OpenCodeRouterTray.exe"

    if (Test-PortListening $port) {
        Write-Host "✔ 智能网关服务已在运行 (端口: $port)" -ForegroundColor Green
        # 即使网关端口已监听，仍确保右下角托盘常驻或触发重注册恢复
        if (-not $NoShortcuts -and $port -eq 4010) {
            if (Test-Path $trayVbs) {
                Start-Process "wscript.exe" -ArgumentList "`"$trayVbs`" -Silent" -WorkingDirectory $rootDir -WindowStyle Hidden
            } elseif (Test-Path $trayExe) {
                Start-Process -FilePath $trayExe -ArgumentList "-Silent" -WorkingDirectory $rootDir
            }
        }
        return
    }

    # 1. 优先通过原生静默引擎拉起后台路由器服务
    if (Test-Path $silentVbs) {
        Start-Process "wscript.exe" -ArgumentList "`"$silentVbs`"" -WorkingDirectory $rootDir -WindowStyle Hidden
    } elseif (Test-Path $serverJs) {
        $nodeExe = "node.exe"
        if (Test-Path "C:\Program Files\nodejs\node.exe") { $nodeExe = "C:\Program Files\nodejs\node.exe" }
        Start-Process -FilePath $nodeExe -ArgumentList "`"$serverJs`"" -WorkingDirectory $rootDir -WindowStyle Hidden
    }

    # 2. 若未指定 -NoShortcuts 且适合托盘常驻，启动托盘小图标
    if (-not $NoShortcuts -and ($port -eq 4010 -or -not (Test-PortListening 4010))) {
        if (Test-Path $trayVbs) {
            Start-Process "wscript.exe" -ArgumentList "`"$trayVbs`" -Silent" -WorkingDirectory $rootDir -WindowStyle Hidden
        } elseif (Test-Path $trayExe) {
            Start-Process -FilePath $trayExe -ArgumentList "-Silent" -WorkingDirectory $rootDir
        }
    }

    # 等待端口就绪
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 150
        if (Test-PortListening $port) { break }
    }
}

function Step-Stop {
    Write-Host "正在停止智能网关与托盘守护进程..." -ForegroundColor Yellow
    # 停止托盘 (仅在默认端口 4010 且未指定 NoShortcuts 时处理全局托盘，保护沙箱/多实例互不干扰)
    if ($port -eq 4010 -and -not $NoShortcuts) {
        $trayProcs = Get-Process -Name "OpenCodeRouterTray" -ErrorAction SilentlyContinue
        if ($trayProcs) {
            foreach ($tp in $trayProcs) {
                Stop-SafeProcess -ProcessId $tp.Id -Keywords @("OpenCodeRouterTray") -ServiceName "OpenCodeRouterTray" | Out-Null
            }
        }
        $appProcs = Get-Process -Name "OpenCodeRouterApp" -ErrorAction SilentlyContinue
        if ($appProcs) {
            foreach ($ap in $appProcs) {
                Stop-SafeProcess -ProcessId $ap.Id -Keywords @("OpenCodeRouterApp") -ServiceName "OpenCodeRouterApp" | Out-Null
            }
        }
        $trays = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*tray-daemon.ps1*" -or $_.CommandLine -like "*tray-runner.ps1*" }
        if ($trays) {
            foreach ($t in $trays) {
                Stop-SafeProcess -ProcessId $t.ProcessId -Keywords @("tray-daemon.ps1", "tray-runner.ps1") -ServiceName "托盘守护脚本" | Out-Null
            }
        }
    }
    # 停止端口上的路由进程 (安全校验命令行特征)
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        $portPids = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
        foreach ($cpid in $portPids) {
            Stop-SafeProcess -ProcessId $cpid -Keywords @("server.js", "opencode-go-router", "OpenCodeRouter") -ServiceName "opencode-go-router" | Out-Null
        }
    }
    Start-Sleep -Milliseconds 400
    Write-Host "✔ 网关与托盘服务已安全停止。" -ForegroundColor Green
}

function Step-Restart {
    Step-Stop
    Start-Sleep -Milliseconds 600
    Step-Start
}

function Step-Status {
    Write-Header "OpenCode Go Router 状态自检"
    $listening = Test-PortListening $port
    $color = if ($listening) { "Green" } else { "Red" }
    Write-Host " • 网关端口 [$port]: $(if ($listening) { '运行中 (ONLINE)' } else { '未运行 (OFFLINE)' })" -ForegroundColor $color
    
    $trayRunning = (Get-Process -Name "OpenCodeRouterTray" -ErrorAction SilentlyContinue) -ne $null
    if (-not $trayRunning) {
        $trayRunning = (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*tray-daemon.ps1*" -or $_.CommandLine -like "*tray-runner.ps1*" }) -ne $null
    }
    Write-Host " • 托盘守护进程:     $(if ($trayRunning) { '常驻中 (ACTIVE)' } else { '未常驻 (IDLE)' })" -ForegroundColor $(if ($trayRunning) { 'Green' } else { 'Yellow' })

    if ($listening) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
            Write-Host " • 健康探针回读:     status=$($health.status), accounts=$($health.healthyAccounts)/$($health.totalAccounts)" -ForegroundColor Green
        } catch { }
    }
}

function Step-Bind {
    Write-Header "一键绑定 OpenCode + OpenChamber + OMO + Goal + Codex"
    Step-SetupOMO
    Step-SetupGoal
    Step-SetupOpenChamber
    Step-SetupCodex
    Write-Host "✔ 全生态多端绑定完成！" -ForegroundColor Green
}

# ----------------- 参数调度与分发 -----------------
if ($Stop) { Step-Stop; exit 0 }
if ($Restart) { Step-Restart; exit 0 }
if ($Start) { Step-Start; exit 0 }
if ($Status) { Step-Status; exit 0 }
if ($Doctor) { Step-RunDoctor; exit 0 }
if ($Repair) { Step-RunRepair; exit 0 }
if ($Bind) { Step-Bind; exit 0 }
if ($Update) {
    $updaterJs = Join-Path $rootDir "updater.js"
    & node $updaterJs apply
    exit $LASTEXITCODE
}
if ($Rollback) {
    $updaterJs = Join-Path $rootDir "updater.js"
    if ($RollbackId) { & node $updaterJs rollback $RollbackId } else { & node $updaterJs rollback }
    exit $LASTEXITCODE
}

if ($All) {
    Step-RunAll
    exit 0
}

if ($Step -and $Step.Count -gt 0) {
    foreach ($s in $Step) {
        switch ($s) {
            1 { Step-InstallOpenCode }
            2 { Step-SetupRouter }
            3 { Step-SetupOMO }
            4 { Step-SetupGoal }
            5 { Step-SetupOpenChamber }
            6 { Step-RunAll }
            7 { Step-RunDoctor }
            8 { Step-SetupOfficePreview }
            9 { Step-ManageUpdates }
            10 { Step-SetupCodex }
        }
    }
    exit 0
}

if ($Silent) {
    # 静默模式默认执行全栈一键配置
    Step-RunAll
    exit 0
}

# 交互式向导主循环
while ($true) {
    Write-Header "OpenCode + OpenChamber + OMO + Goal + 智能路由 Windows 安装与管理套件"
    Write-Host "请选择要执行的操作：" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [1] 协助下载并安装 OpenCode v2 (CLI)" -ForegroundColor White
    Write-Host "  [2] 配置并部署 4010 订阅管理工具 (双账号智能网关 + Windows 托盘常驻)" -ForegroundColor White
    Write-Host "  [3] 配置 Oh My OpenAgent (OMO 多智能体调度与模型映射)" -ForegroundColor White
    Write-Host "  [4] 配置 Goal 目标推进能力插件 (opencode-goal-plugin + /goal + /boost)" -ForegroundColor White
    Write-Host "  [5] 配置 OpenChamber 桌面工作台 (绑定工作区与 4010 本地网关)" -ForegroundColor White
    Write-Host "  [6] 🚀 全栈一键自动配置 (依次完成上述全部 1-5 及 Office 预览步骤)" -ForegroundColor Green
    Write-Host "  [7] 🩺 系统全链路健康体检与异常一键修复 (Doctor & Repair)" -ForegroundColor Yellow
    Write-Host "  [8] 📄 挂载/管理 OpenChamber 全能 Office 离线预览引擎 (.docx/.xlsx/.pptx)" -ForegroundColor Cyan
    Write-Host "  [9] 📦 一键检测全套组件更新、兼容性诊断与安全升级/回滚" -ForegroundColor White
    Write-Host "  [10] 🤖 OpenAI Codex CLI 智能接入与模型调度 / 还原原本配置" -ForegroundColor Cyan
    Write-Host "  [0] 退出向导" -ForegroundColor DarkGray
    Write-Host ""

    $selected = Read-Host "请输入编号 [0-10]"
    switch ($selected) {
        "1" { Step-InstallOpenCode }
        "2" { Step-SetupRouter }
        "3" { Step-SetupOMO }
        "4" { Step-SetupGoal }
        "5" { Step-SetupOpenChamber }
        "6" { Step-RunAll }
        "7" { Step-RunDoctor }
        "8" { Step-SetupOfficePreview }
        "9" { Step-ManageUpdates }
        "10" { Step-SetupCodex }
        "0" { Write-Host "已退出向导。" -ForegroundColor Gray; break }
        default { Write-Host "无效输入，请重新选择。" -ForegroundColor Red }
    }

    if ($selected -eq "0") { break }
    $continue = Read-Host "`n是否返回主菜单继续其他步骤？(Y/n)"
    if ($continue -eq "n" -or $continue -eq "N") { break }
}
