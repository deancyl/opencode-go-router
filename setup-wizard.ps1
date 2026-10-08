# setup-wizard.ps1: OpenCode 全套体系交互式安装与配置向导
param(
    [int[]]$Step,
    [switch]$All,
    [switch]$Silent
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$rootDir = if ($PSScriptRoot) { $PSScriptRoot } else { "$env:USERPROFILE\.opencode-go-router" }
$port = 4010
$opencodeConfigDir = "$env:USERPROFILE\.config\opencode"
$opencodeConfigFile = "$opencodeConfigDir\opencode.jsonc"
$omoConfigFile = "$env:USERPROFILE\.omo\omo.jsonc"
$commandsDir = "$opencodeConfigDir\commands"
$defaultWorkspace = "D:\opencode\default"

function Write-Header {
    param($title)
    Write-Host "`n==========================================================" -ForegroundColor Cyan
    Write-Host " $title" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
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
    $cfgPath = Join-Path $rootDir "config.json"
    
    $key1 = ""
    $key2 = ""

    if (Test-Path $cfgPath) {
        try {
            $existing = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($existing.accounts -and $existing.accounts.Count -ge 1) {
                $key1 = $existing.accounts[0].apiKey
            }
            if ($existing.accounts -and $existing.accounts.Count -ge 2) {
                $key2 = $existing.accounts[1].apiKey
            }
        } catch {}
    }

    Write-Host "当前订阅账号配置状态：" -ForegroundColor Cyan
    Write-Host " - 账号 1 密钥: $(if ($key1) { $key1.Substring(0, [Math]::Min(12, $key1.Length)) + '...' } else { '（未配置）' })" -ForegroundColor White
    Write-Host " - 账号 2 密钥: $(if ($key2) { $key2.Substring(0, [Math]::Min(12, $key2.Length)) + '...' } else { '（未配置）' })" -ForegroundColor White

    if (-not $Silent) {
        $change = Read-Host "`n是否需要输入或更新 OpenCode Go 订阅 API Key？(y/N)"
        if ($change -eq "y" -or $change -eq "Y") {
            $inKey1 = Read-Host "请输入第 1 个 OpenCode Go API Key (留空保持当前)"
            if ($inKey1) { $key1 = $inKey1.Trim() }
            $inKey2 = Read-Host "请输入第 2 个 OpenCode Go API Key (留空保持当前)"
            if ($inKey2) { $key2 = $inKey2.Trim() }
        }
    }

    $newConfig = @{
        port = $port
        host = "127.0.0.1"
        upstream = "https://opencode.ai/zen/go/v1"
        defaultCooldownMs = 60000
        maxFailoverRetries = 2
        sessionAffinityEnabled = $true
        accounts = @(
            @{ id = "account-1"; name = "OpenCode Go (订阅账号 1)"; apiKey = $key1; enabled = $true },
            @{ id = "account-2"; name = "OpenCode Go (订阅账号 2)"; apiKey = $key2; enabled = $true }
        )
    }

    [System.IO.File]::WriteAllText($cfgPath, ($newConfig | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
    Write-Host "✔ 配置文件已稳妥写入 (UTF-8 No-BOM): $cfgPath" -ForegroundColor Green

    # 同步绑定 OpenCode 主配置文件 ~/.config/opencode/opencode.jsonc
    if (-not (Test-Path $opencodeConfigDir)) { New-Item -ItemType Directory -Path $opencodeConfigDir -Force | Out-Null }
    try {
        $ocObj = $null
        if (Test-Path $opencodeConfigFile) {
            $ocObj = Get-Content $opencodeConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
        } else {
            $ocObj = [PSCustomObject]@{
                plugin = @("oh-my-openagent@5.1.24", "opencode-goal-plugin")
                "`$schema" = "https://opencode.ai/config.json"
                provider = [PSCustomObject]@{}
            }
        }
        # 关键自愈：彻底清理复数 providers 中的冲突项，防止 OpenCode 触发 conflict 导致丢弃本地网关
        if ($ocObj.PSObject.Properties['providers'] -and $ocObj.providers.PSObject.Properties['opencode-go']) {
            $ocObj.providers.PSObject.Properties.Remove('opencode-go')
            if ($ocObj.providers.PSObject.Properties.Count -eq 0) {
                $ocObj.PSObject.Properties.Remove('providers')
            }
        }
        if (-not $ocObj.provider) {
            $ocObj | Add-Member -NotePropertyName "provider" -NotePropertyValue (New-Object PSObject)
        }
        if ($ocObj.provider.'opencode-go') {
            $ocObj.provider.'opencode-go'.options.baseURL = "http://127.0.0.1:$port/v1"
            if (-not $ocObj.provider.'opencode-go'.options.apiKey) {
                $ocObj.provider.'opencode-go'.options.apiKey = "local-router"
            }
        } else {
            $goProv = [PSCustomObject]@{
                name = "opencode-go"
                npm = "@ai-sdk/openai-compatible"
                options = [PSCustomObject]@{
                    baseURL = "http://127.0.0.1:$port/v1"
                    apiKey = "local-router"
                }
                models = [PSCustomObject]@{
                    "kimi-k3" = [PSCustomObject]@{ name = "kimi-k3" }
                    "qwen3.7-plus" = [PSCustomObject]@{ name = "qwen3.7-plus" }
                    "deepseek-v4.1-flash" = [PSCustomObject]@{ name = "deepseek-v4.1-flash" }
                    "deepseek-v4-pro" = [PSCustomObject]@{ name = "deepseek-v4-pro" }
                    "glm-5.3" = [PSCustomObject]@{ name = "glm-5.3" }
                    "minimax-m3" = [PSCustomObject]@{ name = "minimax-m3" }
                }
            }
            $ocObj.provider | Add-Member -NotePropertyName "opencode-go" -NotePropertyValue $goProv
        }
        Set-Content -Path $opencodeConfigFile -Value ($ocObj | ConvertTo-Json -Depth 15) -Encoding UTF8
        Write-Host "✔ opencode.jsonc 已自动绑定本地网关 http://127.0.0.1:$port/v1" -ForegroundColor Green
    } catch {
        Write-Host "⚠ opencode.jsonc 网关绑定提醒: $_" -ForegroundColor Yellow
    }

    # 静默启动原生托盘与路由服务
    Write-Host "正在启动系统托盘常驻进程与后台智能网关..." -ForegroundColor Yellow
    $trayExe = Join-Path $rootDir "OpenCodeRouterTray.exe"
    $trayScript = Join-Path $rootDir "tray-runner.ps1"
    if (Test-Path $trayExe) {
        Start-Process -FilePath $trayExe
    } else {
        Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$trayScript`"") -WindowStyle Hidden
    }
    Start-Sleep -Seconds 2

    try {
        $res = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
        Write-Host "🎉 4010 智能网关就绪！状态: $($res.status)，可用账号: $($res.healthyAccounts)/$($res.totalAccounts)" -ForegroundColor Green
        Write-Host "💡 网页控制面板已在后台开启: http://127.0.0.1:$port/balancer/ui" -ForegroundColor White
    } catch {
        Write-Host "⚠ 网关正在启动中，请在右下角系统托盘查看图标" -ForegroundColor Yellow
    }
}

# ----------------- 步骤 3: 配置 Oh My OpenAgent (OMO) -----------------
function Step-SetupOMO {
    Write-Header "【步骤 3】配置 Oh My OpenAgent (OMO 多智能体调度)"

    # 1. Ensure plugin in opencode.jsonc
    if (-not (Test-Path $opencodeConfigDir)) { New-Item -ItemType Directory -Path $opencodeConfigDir -Force | Out-Null }
    
    $pluginName = "oh-my-openagent@5.1.24"
    if (Test-Path $opencodeConfigFile) {
        $oc = Get-Content $opencodeConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $plugins = [System.Collections.Generic.List[string]]::new()
        if ($oc.plugin) { foreach ($p in $oc.plugin) { $plugins.Add($p) } }
        if (-not ($plugins | Where-Object { $_ -like "oh-my-openagent*" })) {
            $plugins.Add($pluginName)
            $oc.plugin = $plugins.ToArray()
            Set-Content -Path $opencodeConfigFile -Value ($oc | ConvertTo-Json -Depth 10) -Encoding UTF8
            Write-Host "✔ 已在 opencode.jsonc 中注册插件: $pluginName" -ForegroundColor Green
        } else {
            Write-Host "✔ OMO 插件已在 opencode.jsonc 中注册" -ForegroundColor Green
        }
    }

    # 2. Configure ~/.omo/omo.jsonc
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
      "oracle": { "model": "opencode-go/glm-5.2" },
      "librarian": { "model": "opencode-go/qwen3.7-plus", "fallback_models": [{ "model": "opencode-go/minimax-m2.7" }] },
      "explore": { "model": "opencode-go/qwen3.7-plus", "fallback_models": [{ "model": "opencode-go/minimax-m2.7" }] },
      "multimodal-looker": { "model": "opencode-go/kimi-k3" },
      "prometheus": { "model": "opencode-go/kimi-k3", "variant": "high" },
      "metis": { "model": "opencode-go/kimi-k3", "variant": "high" },
      "momus": { "model": "opencode-go/glm-5.2" },
      "atlas": { "model": "opencode-go/kimi-k3", "fallback_models": [{ "model": "opencode-go/minimax-m3" }] },
      "sisyphus-junior": { "model": "opencode-go/kimi-k3", "fallback_models": [{ "model": "opencode-go/minimax-m3" }] }
    },
    "categories": {
      "visual-engineering": { "model": "opencode-go/kimi-k3", "variant": "high" },
      "ultrabrain": { "model": "opencode/gpt-5-nano" },
      "deep-low": { "model": "opencode/gpt-5-nano" },
      "deep-high": { "model": "opencode/gpt-5-nano" },
      "artistry": { "model": "opencode-go/kimi-k3", "variant": "high" },
      "quick": { "model": "opencode-go/minimax-m3", "variant": "high" },
      "unspecified-low": { "model": "opencode-go/mimo-v2.6-pro", "fallback_models": [{ "model": "opencode-go/grok-4.7" }] },
      "unspecified-high": { "model": "opencode-go/mimo-v2.6-pro", "fallback_models": [{ "model": "opencode-go/grok-4.7" }] }
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

    # 1. Ensure opencode-goal-plugin in opencode.jsonc
    if (Test-Path $opencodeConfigFile) {
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
    }

    # 2. Ensure boost.md exists
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

    Write-Host "💡 提示：在 OpenCode 会话中输入 /goal <目标> 或 /boost <目标> 即可激活自主目标推进！" -ForegroundColor Cyan
}

# ----------------- 步骤 5: 配置 OpenChamber 桌面工作台 -----------------
function Step-SetupOpenChamber {
    Write-Header "【步骤 5】配置 OpenChamber 桌面客户端与工作区"

    # 1. 确保默认工作区并初始化 Git
    if (-not (Test-Path $defaultWorkspace)) {
        New-Item -ItemType Directory -Path $defaultWorkspace -Force | Out-Null
        Write-Host "✔ 已创建默认工作区目录: $defaultWorkspace" -ForegroundColor Green
    }
    if (-not (Test-Path (Join-Path $defaultWorkspace ".git"))) {
        try {
            git -C $defaultWorkspace init | Out-Null
            Write-Host "✔ 已在工作区初始化 Git 仓库" -ForegroundColor Green
        } catch {
            Write-Host "⚠ 初始化 Git 失败: $_" -ForegroundColor Yellow
        }
    } else {
        Write-Host "✔ 工作区 Git 仓库正常就绪" -ForegroundColor Green
    }

    # 2. 检查 OpenChamber CLI
    $chamberBin = (Get-Command openchamber.exe -ErrorAction SilentlyContinue).Source
    if (-not $chamberBin) { $chamberBin = "$env:USERPROFILE\.bun\bin\openchamber.exe" }
    if (Test-Path $chamberBin) {
        Write-Host "✔ OpenChamber 可执行文件已就绪: $chamberBin" -ForegroundColor Green
    } else {
        Write-Host "ℹ 提示: 可通过 bun add -g @openchamber/web 或桌面客户端安装 OpenChamber" -ForegroundColor Yellow
    }

    # 3. 验证并配置 OpenChamber 偏好首选模型 (preferences.json)
    $chamberPrefDir = "$env:USERPROFILE\.config\openchamber"
    $chamberPrefFile = Join-Path $chamberPrefDir "preferences.json"
    try {
        if (-not (Test-Path $chamberPrefDir)) { New-Item -ItemType Directory -Path $chamberPrefDir -Force | Out-Null }
        $prefObj = $null
        if (Test-Path $chamberPrefFile) {
            $prefObj = Get-Content $chamberPrefFile -Raw -Encoding UTF8 | ConvertFrom-Json
        } else {
            $prefObj = [PSCustomObject]@{ version = 1; fields = [PSCustomObject]@{} }
        }
        if (-not $prefObj.fields) { $prefObj | Add-Member -NotePropertyName "fields" -NotePropertyValue (New-Object PSObject) }

        $recents = @()
        if ($prefObj.fields.recentModels -and $prefObj.fields.recentModels.value) {
            $recents = @($prefObj.fields.recentModels.value | Where-Object { -not ($_.providerID -eq 'opencode-go' -and $_.modelID -eq 'deepseek-v4.1-flash') })
        }
        $newRecent = @([PSCustomObject]@{ providerID = 'opencode-go'; modelID = 'deepseek-v4.1-flash' }) + $recents
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
        if (-not ($favs | Where-Object { $_.providerID -eq 'opencode-go' -and $_.modelID -eq 'deepseek-v4.1-flash' })) {
            $favs = @([PSCustomObject]@{ providerID = 'opencode-go'; modelID = 'deepseek-v4.1-flash' }) + $favs
        }
        if (-not ($favs | Where-Object { $_.providerID -eq 'opencode-go' -and $_.modelID -eq 'kimi-k3' })) {
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
        Write-Host "✔ OpenChamber 桌面端首选默认模型已成功锁定为: opencode-go / deepseek-v4.1-flash" -ForegroundColor Green
    } catch {
        Write-Host "⚠ OpenChamber 偏好配置提醒: $_" -ForegroundColor Yellow
    }

    # 4. 验证 opencode.jsonc 中 4010 映射
    if (Test-Path $opencodeConfigFile) {
        $raw = Get-Content $opencodeConfigFile -Raw -Encoding UTF8
        if ($raw -like "*127.0.0.1:4010*") {
            Write-Host "✔ OpenCode 配置已正确绑定 4010 智能网关" -ForegroundColor Green
        }
    }

    # 4. 自动扫描并同步 OpenCode 进行中的全部历史项目与会话
    $importScript = Join-Path $rootDir "import_projects.py"
    if (Test-Path $importScript) {
        Write-Host "正在扫描并同步 OpenCode 进行中的全部项目与历史会话到 OpenChamber..." -ForegroundColor Yellow
        try {
            $pyOut = python "$importScript" 2>&1
            Write-Host "✔ 已成功将历史进行中的项目（包括 RootMyGalaxy、工作交接 等）同步至 OpenChamber 工作台" -ForegroundColor Green
        } catch {
            Write-Host "⚠ 项目同步提醒: $_" -ForegroundColor Yellow
        }
    }
}

# ----------------- 步骤 6: 全栈一键自动配置 -----------------
function Step-RunAll {
    Write-Header "【全栈一键自动配置】"
    Write-Host "将依次执行：OpenCode v2 检测 -> 4010 网关部署 -> OMO 配置 -> Goal 插件配置 -> OpenChamber 配置 -> Office 离线预览挂载..." -ForegroundColor Cyan
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

# ----------------- 步骤 7: 执行健康体检与修复 -----------------
function Step-RunDoctor {
    $doctorScript = Join-Path $rootDir "doctor-repair.ps1"
    if (Test-Path $doctorScript) {
        powershell -NoProfile -ExecutionPolicy Bypass -File "`"$doctorScript`""
    }
}

# ----------------- 步骤 8: 挂载/卸载 OpenChamber Office 全格式离线预览引擎 -----------------
function Step-SetupOfficePreview {
    Write-Header "【步骤 8】OpenChamber Office 全格式离线安全预览引擎"
    $patchScript = Join-Path $rootDir "patch-openchamber-office.ps1"
    if (-not (Test-Path $patchScript)) {
        Write-Host "❌ 未找到 patch-openchamber-office.ps1 脚本" -ForegroundColor Red
        return
    }
    Write-Host "离线安全红线保障：纯本地沙箱执行，严禁公网第三方云预览，支持双轨本地应用秒开。" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [1] 一键挂载离线预览引擎 (支持 .docx / .xlsx / .pptx 原生渲染与原厂秒开)" -ForegroundColor White
    Write-Host "  [2] 还原/卸载离线预览引擎 (无损还原官方原始 dist 备份)" -ForegroundColor White
    Write-Host "  [3] 查看当前挂载状态" -ForegroundColor White
    Write-Host "  [0] 返回上级" -ForegroundColor DarkGray
    Write-Host ""
    $opt = Read-Host "请输入编号 [默认: 1]"
    if (-not $opt) { $opt = "1" }
    switch ($opt) {
        "1" { & $patchScript -Install }
        "2" { & $patchScript -Rollback }
        "3" { & $patchScript -Status }
        "0" { return }
        default { & $patchScript -Install }
    }
}

# ----------------- 步骤 9: 一键检测更新、兼容性诊断与安全升级/回滚 -----------------
function Step-ManageUpdates {
    Write-Header "【步骤 9】全组件最新版本监测、兼容性诊断与安全升级/回滚"
    $updaterJs = Join-Path $rootDir "updater.js"
    if (-not (Test-Path $updaterJs)) {
        Write-Host "❌ 未找到 updater.js 模块！" -ForegroundColor Red
        return
    }

    Write-Host "正在联网检测各组件最新发布版本与兼容性状态..." -ForegroundColor Yellow
    $reportRaw = & node $updaterJs check
    if (-not $reportRaw) {
        Write-Host "❌ 获取组件更新状态失败！" -ForegroundColor Red
        return
    }

    $report = $reportRaw | ConvertFrom-Json
    
    Write-Host "`n--- 组件版本诊断矩阵 ---" -ForegroundColor Cyan
    Write-Host ("{0,-35} {1,-14} {2,-14} {3}" -f "组件名称", "当前本地版本", "官方最新版本", "状态") -ForegroundColor DarkGray
    Write-Host ("-" * 75) -ForegroundColor DarkGray
    foreach ($c in $report.components) {
        $st = if ($c.hasUpdate) { "待更新 (可升级)" } else { "已是最新" }
        $color = if ($c.hasUpdate) { "Yellow" } else { "Green" }
        Write-Host ("{0,-35} {1,-14} {2,-14} {3}" -f $c.name, $c.current, $c.latest, $st) -ForegroundColor $color
    }

    Write-Host "`n--- 生态兼容性诊断 ---" -ForegroundColor Cyan
    if ($report.compatibility.riskLevel -eq "critical") {
        Write-Host "🛑 风险评级: 存在重大跨版本破坏性变更预警！" -ForegroundColor Red
    } elseif ($report.compatibility.riskLevel -eq "warning") {
        Write-Host "⚠️ 风险评级: 存在次版本更新或插件需同步升级" -ForegroundColor Yellow
    } else {
        Write-Host "✅ 风险评级: 全生态高度兼容，环境健康" -ForegroundColor Green
    }
    Write-Host "诊断总结: $($report.compatibility.summary)" -ForegroundColor White

    if ($report.compatibility.warnings) {
        Write-Host "`n重点预警：" -ForegroundColor Yellow
        foreach ($w in $report.compatibility.warnings) {
            Write-Host " • $($w.title): $($w.desc)" -ForegroundColor DarkYellow
        }
    }
    if ($report.compatibility.recommendations) {
        Write-Host "`n优化建议：" -ForegroundColor Cyan
        foreach ($r in $report.compatibility.recommendations) {
            Write-Host " • $r" -ForegroundColor Gray
        }
    }

    $snapCount = if ($report.snapshots) { $report.snapshots.Count } else { 0 }
    Write-Host "`n当前已有灾备快照: $snapCount 份" -ForegroundColor DarkGray

    Write-Host "`n请选择操作：" -ForegroundColor Cyan
    Write-Host "  [1] 🚀 一键安全更新所有待更新组件 (自动创建全量灾备快照)" -ForegroundColor White
    Write-Host "  [2] 仅更新 OpenCode CLI 核心引擎 (@opencode/cli)" -ForegroundColor White
    Write-Host "  [3] 仅更新 Oh My OpenAgent 插件与配置" -ForegroundColor White
    Write-Host "  [4] ⏪ 一键灾备回滚 (从最新快照秒级还原)" -ForegroundColor Yellow
    Write-Host "  [5] 📋 查看历史备份快照记录" -ForegroundColor White
    Write-Host "  [0] 返回主菜单" -ForegroundColor DarkGray
    Write-Host ""

    $upChoice = Read-Host "请输入编号 [默认: 1]"
    if (-not $upChoice) { $upChoice = "1" }

    switch ($upChoice) {
        "1" {
            if ($report.compatibility.riskLevel -eq "critical") {
                $confirm = Read-Host "⚠️ 检测到破坏性重大更新风险，是否确认继续升级？系统已提供灾备快照秒级回滚 (y/N)"
                if ($confirm -ne "y" -and $confirm -ne "Y") {
                    Write-Host "已取消升级。" -ForegroundColor DarkGray
                    return
                }
            }
            Write-Host "正在执行一键安全更新流程..." -ForegroundColor Yellow
            & node $updaterJs apply
            Write-Host "🎉 一键更新完成！" -ForegroundColor Green
        }
        "2" {
            Write-Host "正在单独更新 OpenCode CLI 核心..." -ForegroundColor Yellow
            & node $updaterJs apply opencode
            Write-Host "🎉 OpenCode CLI 更新完成！" -ForegroundColor Green
        }
        "3" {
            Write-Host "正在单独更新 Oh My OpenAgent 插件..." -ForegroundColor Yellow
            & node $updaterJs apply oh-my-openagent
            Write-Host "🎉 OMO 插件更新完成！" -ForegroundColor Green
        }
        "4" {
            $confirmRb = Read-Host "⚠️ 确认要执行灾备回滚吗？系统将从最新快照复原配置与状态 (y/N)"
            if ($confirmRb -eq "y" -or $confirmRb -eq "Y") {
                Write-Host "正在执行灾备回滚..." -ForegroundColor Yellow
                & node $updaterJs rollback
                Write-Host "🎉 灾备回滚完成！系统配置已恢复！" -ForegroundColor Green
            }
        }
        "5" {
            Write-Host "`n--- 历史灾备快照列表 ---" -ForegroundColor Cyan
            $snaps = & node $updaterJs snapshots | ConvertFrom-Json
            if ($snaps -and $snaps.Count -gt 0) {
                foreach ($sn in $snaps) {
                    Write-Host " • 快照编号: $($sn.id) | 时间: $($sn.timestamp) | 描述: $($sn.reason)" -ForegroundColor White
                }
            } else {
                Write-Host "暂无快照记录。" -ForegroundColor DarkGray
            }
        }
        "0" { return }
        default { return }
    }
}

# ----------------- 主流程分发 -----------------
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
        }
    }
    exit 0
}

# 交互式向导主循环
while ($true) {
    Write-Header "OpenCode + OpenChamber + OMO + Goal + 智能路由 集成向导"
    Write-Host "请选择要执行的配置步骤（可按需逐项选择，或选 [6] 一键全配）：" -ForegroundColor Cyan
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
    Write-Host "  [0] 退出向导" -ForegroundColor DarkGray
    Write-Host ""

    $selected = Read-Host "请输入编号 [0-9]"
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
        "0" { Write-Host "已退出向导。" -ForegroundColor Gray; break }
        default { Write-Host "无效输入，请重新选择。" -ForegroundColor Red }
    }

    if ($selected -eq "0") { break }
    $continue = Read-Host "`n是否返回主菜单继续其他步骤？(Y/n)"
    if ($continue -eq "n" -or $continue -eq "N") { break }
}
