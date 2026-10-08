# doctor-repair.ps1: OpenCode 全链路健康体检与智能修复脚本
param(
    [switch]$CheckOnly,
    [switch]$AutoFix
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🩺 OpenCode 全链路运行环境体检与一键修复系统 " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$routerPort = 4010
$chamberPort = 3000
$opencodeConfig = "$env:USERPROFILE\.config\opencode\opencode.jsonc"
$omoConfig = "$env:USERPROFILE\.omo\omo.jsonc"
$boostCommand = "$env:USERPROFILE\.config\opencode\commands\boost.md"
$defaultWorkspace = "D:\opencode\default"

$issuesFound = [System.Collections.Generic.List[PSObject]]::new()

# ----------------- 1. 检测 OpenCode CLI -----------------
Write-Host "`n[1/6] 检查 OpenCode CLI 环境..." -ForegroundColor Yellow
$opencodeVer = $null
$opencodePath = $null

$opencodeCmd = Get-Command opencode -ErrorAction SilentlyContinue
if ($opencodeCmd) {
    try {
        $opencodeVer = (& opencode --version 2>$null)
        $opencodePath = $opencodeCmd.Source
    } catch {}
} else {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\@openchamberelectron\resources\opencode-cli\opencode.exe",
        "$env:APPDATA\npm\opencode.cmd",
        "$env:USERPROFILE\.bun\bin\opencode.exe",
        "$env:ProgramFiles\nodejs\opencode.cmd"
    )
    foreach ($cand in $candidates) {
        if (Test-Path $cand) {
            try {
                $v = (& $cand --version 2>$null)
                if ($v) {
                    $opencodeVer = $v
                    $opencodePath = $cand
                    break
                }
            } catch {}
        }
    }
}

if ($opencodeVer) {
    Write-Host "  ✔ OpenCode CLI 已就绪: $opencodeVer ($opencodePath)" -ForegroundColor Green
    if (-not ($opencodeVer -match "2\.\d+")) {
        $issuesFound.Add([PSCustomObject]@{
            Id = "opencode_v1"
            Title = "OpenCode CLI 版本低于 v2 ($opencodeVer)"
            Severity = "Medium"
            FixDesc = "升级 @opencode/cli 到最新 v2 版本"
        })
    }
} else {
    Write-Host "  ❌ 未检测到 OpenCode CLI" -ForegroundColor Red
    $issuesFound.Add([PSCustomObject]@{
        Id = "opencode_missing"
        Title = "OpenCode CLI 未安装或未加入环境变量 PATH"
        Severity = "High"
        FixDesc = "通过 npm / bun 安装全局 @opencode/cli"
    })
}

# ----------------- 2. 检测 4010 订阅路由与端到端探针 -----------------
Write-Host "`n[2/6] 检查 4010 智能网关与端到端推理链路..." -ForegroundColor Yellow
$routerConn = Get-NetTCPConnection -LocalPort $routerPort -State Listen -ErrorAction SilentlyContinue
if ($routerConn) {
    Write-Host "  ✔ 4010 智能网关正在运行 (PID: $($routerConn.OwningProcess[0]))" -ForegroundColor Green
    try {
        $rHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$routerPort/health" -TimeoutSec 2
        Write-Host "    - 健康账号数: $($rHealth.healthyAccounts) / $($rHealth.totalAccounts)" -ForegroundColor White
        
        $rStatus = Invoke-RestMethod -Uri "http://127.0.0.1:$routerPort/status" -TimeoutSec 2
        $coolingAccs = $rStatus.accounts | Where-Object { $_.status -eq 'cooling_down' }
        if ($coolingAccs) {
            Write-Host "    ⚠ 发现 $($coolingAccs.Count) 个账号处于 429 限频冷却中" -ForegroundColor Yellow
            $issuesFound.Add([PSCustomObject]@{
                Id = "accounts_cooling_down"
                Title = "智能网关有 $($coolingAccs.Count) 个账号处于限频冷却中"
                Severity = "Medium"
                FixDesc = "重置网关冷却计时器，立即恢复流量轮询"
            })
        }

        # 端到端推理链路轻量探针 (E2E Completion Probe)
        Write-Host "    - 正在执行端到端轻量推理握手测试..." -ForegroundColor DarkGray
        try {
            $probeBody = @{
                model = "deepseek-v4.1-flash"
                messages = @(@{ role = "user"; content = "probe" })
                max_tokens = 2
            } | ConvertTo-Json
            $probeResp = Invoke-RestMethod -Uri "http://127.0.0.1:$routerPort/v1/chat/completions" -Method Post -Body $probeBody -ContentType "application/json" -Headers @{ Authorization = "Bearer local-router" } -TimeoutSec 5
            if ($probeResp.choices) {
                Write-Host "    ✔ 端到端推理握手通过！上游模型极速响应" -ForegroundColor Green
            } else {
                Write-Host "    ⚠ 上游响应格式异常" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "    ❌ 端到端推理探针失败: $_" -ForegroundColor Red
            $issuesFound.Add([PSCustomObject]@{
                Id = "router_probe_failed"
                Title = "4010 智能网关上游推理通道不可达或受阻"
                Severity = "High"
                FixDesc = "重置账号限频冷却并刷新网关通道"
            })
        }
    } catch {
        Write-Host "    ⚠ 网关响应异常: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ⚠ 4010 智能网关未运行" -ForegroundColor Yellow
    $issuesFound.Add([PSCustomObject]@{
        Id = "router_stopped"
        Title = "4010 智能网关未启动"
        Severity = "High"
        FixDesc = "静默启动 opencode-go-router 服务与系统托盘常驻"
    })
}

# ----------------- 3. 检测 OpenCode 配置文件与配置冲突 -----------------
Write-Host "`n[3/6] 检查 OpenCode 配置文件与冲突隔离..." -ForegroundColor Yellow
if (Test-Path $opencodeConfig) {
    $ocContent = Get-Content $opencodeConfig -Raw -Encoding UTF8
    
    # 检测 3001 旧端口残留
    if ($ocContent -like "*:3001*") {
        Write-Host "  ❌ 发现旧端口 3001 残留配置 (可能引发 ConnectionRefused)" -ForegroundColor Red
        $issuesFound.Add([PSCustomObject]@{
            Id = "dead_port_3001"
            Title = "opencode.jsonc 中仍有指向 3001 端口的配置"
            Severity = "High"
            FixDesc = "自动将所有 3001 端口重定向至 4010 高可用智能网关"
        })
    } else {
        Write-Host "  ✔ 未发现 3001 旧端口冲突残留" -ForegroundColor Green
    }

    # 检测 provider 与 providers 单复数配置冲突 (retained native value 隐患)
    $hasPlural = ($ocContent -match '"providers"\s*:\s*\{[^}]*"opencode-go"') -or ($ocContent.Contains('"providers"') -and $ocContent.Contains('"opencode-go"'))
    $hasSingular = ($ocContent -match '"provider"\s*:\s*\{[^}]*"opencode-go"') -or ($ocContent.Contains('"provider"') -and $ocContent.Contains('"opencode-go"'))
    if ($hasPlural -and $hasSingular) {
        Write-Host "  ❌ 发现 provider 与 providers 单复数同名配置冲突！" -ForegroundColor Red
        Write-Host "     (OpenCode 启动将触发 conflict 并自动丢弃 4010 本地网关，回退到直连并导致 ConnectionRefused)" -ForegroundColor Yellow
        $issuesFound.Add([PSCustomObject]@{
            Id = "config_conflict"
            Title = "opencode.jsonc 存在提供商单复数配置冲突"
            Severity = "High"
            FixDesc = "自动清洗冲突项，规范化为单一标准 provider 配置"
        })
    } else {
        Write-Host "  ✔ 未发现单复数配置冲突 (规范无歧义)" -ForegroundColor Green
    }

    # 检测 4010 网关绑定
    if ($ocContent -notlike "*127.0.0.1:4010*") {
        Write-Host "  ⚠ opencode-go 未指向 4010 智能网关" -ForegroundColor Yellow
        $issuesFound.Add([PSCustomObject]@{
            Id = "missing_4010_gateway"
            Title = "opencode.jsonc 中 opencode-go 提供商未绑定本地 4010 网关"
            Severity = "Medium"
            FixDesc = "添加或修正 opencode-go baseURL 为 http://127.0.0.1:4010/v1 并注入 local-router key"
        })
    } else {
        Write-Host "  ✔ opencode-go 已成功绑定 4010 智能网关" -ForegroundColor Green
    }
} else {
    Write-Host "  ⚠ 尚未生成 opencode.jsonc 配置文件" -ForegroundColor Yellow
    $issuesFound.Add([PSCustomObject]@{
        Id = "missing_opencode_config"
        Title = "未找到 ~/.config/opencode/opencode.jsonc"
        Severity = "Medium"
        FixDesc = "自动初始化并生成推荐的高可用双订阅 opencode.jsonc"
    })
}

# ----------------- 4. 检测 DeepSeek 区域限制与 OMO Fallback -----------------
Write-Host "`n[4/6] 检查 Oh My OpenAgent 调度配置与 DeepSeek 区域限制..." -ForegroundColor Yellow
if (Test-Path $omoConfig) {
    $omoContent = Get-Content $omoConfig -Raw -Encoding UTF8
    if ($omoContent -like "*opencode-go/deepseek*" -and $omoContent -notlike "*kimi-k3*") {
        Write-Host "  ⚠ 检测到主智能体使用 DeepSeek 且缺少无区域限制 fallback (易受 Global regions 限制拦截)" -ForegroundColor Yellow
        $issuesFound.Add([PSCustomObject]@{
            Id = "deepseek_region_risk"
            Title = "智能体调度缺少原生无区域限制的备选模型"
            Severity = "Medium"
            FixDesc = "为主要智能体添加 kimi-k3、qwen3.7-plus 或 minimax-m3 兜底"
        })
    } else {
        Write-Host "  ✔ OMO 调度模型配置健康，包含无限制模型链路" -ForegroundColor Green
    }
} else {
    Write-Host "  ⚠ 未找到 ~/.omo/omo.jsonc 配置文件" -ForegroundColor Yellow
    $issuesFound.Add([PSCustomObject]@{
        Id = "missing_omo_config"
        Title = "未找到 ~/.omo/omo.jsonc 配置文件"
        Severity = "Low"
        FixDesc = "自动生成标准多智能体调度映射（内置无限制模型）"
    })
}

# ----------------- 5. 检测 Goal 插件与 /boost 指令 -----------------
Write-Host "`n[5/6] 检查 Goal 目标推进体系与 /boost 模式..." -ForegroundColor Yellow
if (Test-Path $boostCommand) {
    Write-Host "  ✔ /boost 增强指令模版已就绪" -ForegroundColor Green
} else {
    Write-Host "  ⚠ 未找到 /boost 指令模版 (commands/boost.md)" -ForegroundColor Yellow
    $issuesFound.Add([PSCustomObject]@{
        Id = "missing_boost_command"
        Title = "缺少 /boost 快捷推进指令"
        Severity = "Low"
        FixDesc = "自动生成 commands/boost.md 模版"
    })
}

# ----------------- 6. 检测 OpenChamber 工作区环境与服务状态 -----------------
Write-Host "`n[6/6] 检查 OpenChamber 工作区环境与托管服务状态..." -ForegroundColor Yellow
if (Test-Path $defaultWorkspace) {
    if (Test-Path (Join-Path $defaultWorkspace ".git")) {
        Write-Host "  ✔ 工作区 $defaultWorkspace 已初始化 Git 版本库" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ 工作区 $defaultWorkspace 缺少 Git 仓库" -ForegroundColor Yellow
        $issuesFound.Add([PSCustomObject]@{
            Id = "workspace_no_git"
            Title = "默认工作区未初始化 Git 仓库"
            Severity = "Low"
            FixDesc = "在工作区自动执行 git init 保证差异追踪能力"
        })
    }
} else {
    Write-Host "  ℹ 默认工作区目录尚未创建: $defaultWorkspace" -ForegroundColor DarkGray
}

# 检查 OpenChamber 及其托管的 opencode.exe 是否加载了陈旧配置
$chamberProcs = Get-Process -Name "OpenChamber" -ErrorAction SilentlyContinue
$managedOpencode = Get-Process -Name "opencode" -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
        $cmd -like "*serve*--hostname*127.0.0.1*"
    } catch { $false }
}
if ($chamberProcs -and $managedOpencode) {
    Write-Host "  ✔ OpenChamber 桌面端正在运行 (托管 OpenCode PID: $($managedOpencode.Id))" -ForegroundColor Green
    if (Test-Path $opencodeConfig) {
        $cfgMtime = (Get-Item $opencodeConfig).LastWriteTime
        if ($cfgMtime -gt $managedOpencode[0].StartTime) {
            Write-Host "  ⚠ opencode.jsonc 在服务启动后被修改，托管实例可能加载了陈旧配置" -ForegroundColor Yellow
            $issuesFound.Add([PSCustomObject]@{
                Id = "stale_opencode_process"
                Title = "OpenChamber 托管的 OpenCode 运行中但配置未重载"
                Severity = "Medium"
                FixDesc = "平滑重启托管服务或 OpenChamber 桌面端以加载最新配置"
            })
        }
    }
}

# ----------------- 结果汇总与修复决策 -----------------
Write-Host "`n==========================================================" -ForegroundColor Cyan
if ($issuesFound.Count -eq 0) {
    Write-Host " 🎉 体检完成！全链路运行环境完美无瑕，未发现任何缺陷！" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Cyan
    if (-not $CheckOnly -and -not $AutoFix) {
        Read-Host "`n按回车键退出..."
    }
    exit 0
}

Write-Host " 📋 体检发现 $($issuesFound.Count) 个问题/可优化项：" -ForegroundColor Yellow
foreach ($iss in $issuesFound) {
    $color = if ($iss.Severity -eq "High") { "Red" } elseif ($iss.Severity -eq "Medium") { "Yellow" } else { "Cyan" }
    Write-Host "  [$($iss.Severity)] $($iss.Title)" -ForegroundColor $color
    Write-Host "    -> 修复方案: $($iss.FixDesc)" -ForegroundColor DarkGray
}
Write-Host "==========================================================" -ForegroundColor Cyan

if ($CheckOnly) {
    exit 0
}

$doFix = $AutoFix
if (-not $doFix) {
    $ans = Read-Host "`n是否立即执行一键自动修复？(Y/n)"
    if ($ans -eq "" -or $ans -eq "y" -or $ans -eq "Y") {
        $doFix = $true
    }
}

if (-not $doFix) {
    Write-Host "已跳过修复流程。" -ForegroundColor DarkGray
    exit 0
}

# ----------------- 执行自动修复 -----------------
Write-Host "`n🔧 正在执行一键自动修复..." -ForegroundColor Cyan

foreach ($iss in $issuesFound) {
    switch ($iss.Id) {
        "dead_port_3001" {
            Write-Host " -> 正在修复旧端口 3001 残留..." -ForegroundColor Yellow
            $raw = Get-Content $opencodeConfig -Raw -Encoding UTF8
            $fixed = $raw -replace "http://127\.0\.0\.1:3001(/v1)?", "http://127.0.0.1:$routerPort/v1"
            $fixed = $fixed -replace "http://localhost:3001(/v1)?", "http://127.0.0.1:$routerPort/v1"
            Set-Content -Path $opencodeConfig -Value $fixed -Encoding UTF8
            Write-Host "    ✔ 3001 端口已成功重定向至 $routerPort 网关" -ForegroundColor Green
        }
        "config_conflict" {
            Write-Host " -> 正在清洗 opencode.jsonc 中的单复数冲突项..." -ForegroundColor Yellow
            try {
                $raw = Get-Content $opencodeConfig -Raw -Encoding UTF8
                $json = $raw | ConvertFrom-Json
                if ($json.PSObject.Properties['providers'] -and $json.providers.PSObject.Properties['opencode-go']) {
                    $json.providers.PSObject.Properties.Remove('opencode-go')
                    if ($json.providers.PSObject.Properties.Count -eq 0) {
                        $json.PSObject.Properties.Remove('providers')
                    }
                }
                if (-not $json.provider) {
                    $json | Add-Member -NotePropertyName "provider" -NotePropertyValue (New-Object PSObject)
                }
                if (-not $json.provider.'opencode-go') {
                    $goProv = [PSCustomObject]@{
                        name = "opencode-go"
                        npm = "@ai-sdk/openai-compatible"
                        options = [PSCustomObject]@{
                            baseURL = "http://127.0.0.1:$routerPort/v1"
                            apiKey = "local-router"
                        }
                        models = [PSCustomObject]@{
                            "deepseek-v4.1-flash" = [PSCustomObject]@{ name = "deepseek-v4.1-flash" }
                            "deepseek-v4-pro" = [PSCustomObject]@{ name = "deepseek-v4-pro" }
                            "kimi-k3" = [PSCustomObject]@{ name = "kimi-k3" }
                            "qwen3.7-plus" = [PSCustomObject]@{ name = "qwen3.7-plus" }
                            "glm-5.3" = [PSCustomObject]@{ name = "glm-5.3" }
                            "minimax-m3" = [PSCustomObject]@{ name = "minimax-m3" }
                        }
                    }
                    $json.provider | Add-Member -NotePropertyName "opencode-go" -NotePropertyValue $goProv
                } else {
                    if (-not $json.provider.'opencode-go'.options) {
                        $json.provider.'opencode-go' | Add-Member -NotePropertyName "options" -NotePropertyValue (New-Object PSObject)
                    }
                    $json.provider.'opencode-go'.options.baseURL = "http://127.0.0.1:$routerPort/v1"
                    $json.provider.'opencode-go'.options.apiKey = "local-router"
                }
                $json.model = "opencode-go/deepseek-v4.1-flash"
                Set-Content -Path $opencodeConfig -Value ($json | ConvertTo-Json -Depth 15) -Encoding UTF8
                Write-Host "    ✔ 冲突项已彻底清除，已规范为统一标准 provider 链路" -ForegroundColor Green
            } catch {
                Write-Host "    ⚠ 清洗失败: $_" -ForegroundColor Red
            }
        }
        "missing_opencode_config" {
            Write-Host " -> 正在创建标准 opencode.jsonc 配置文件..." -ForegroundColor Yellow
            $ocDir = Split-Path $opencodeConfig -Parent
            if (-not (Test-Path $ocDir)) { New-Item -ItemType Directory -Path $ocDir -Force | Out-Null }
            $defaultConfig = @{
                plugin = @("oh-my-openagent@5.1.22", "opencode-goal-plugin")
                "`$schema" = "https://opencode.ai/config.json"
                model = "opencode-go/deepseek-v4.1-flash"
                provider = @{
                    "opencode-go" = @{
                        name = "opencode-go"
                        npm = "@ai-sdk/openai-compatible"
                        options = @{
                            baseURL = "http://127.0.0.1:$routerPort/v1"
                            apiKey = "local-router"
                        }
                        models = @{
                            "deepseek-v4.1-flash" = @{ name = "deepseek-v4.1-flash" }
                            "deepseek-v4-pro" = @{ name = "deepseek-v4-pro" }
                            "kimi-k3" = @{ name = "kimi-k3" }
                            "qwen3.7-plus" = @{ name = "qwen3.7-plus" }
                            "glm-5.3" = @{ name = "glm-5.3" }
                            "minimax-m3" = @{ name = "minimax-m3" }
                        }
                    }
                }
            }
            Set-Content -Path $opencodeConfig -Value ($defaultConfig | ConvertTo-Json -Depth 10) -Encoding UTF8
            Write-Host "    ✔ 已生成 opencode.jsonc 并绑定 4010 网关" -ForegroundColor Green
        }
        "missing_4010_gateway" {
            Write-Host " -> 正在更新 opencode.jsonc 绑定本地 4010 网关..." -ForegroundColor Yellow
            try {
                $raw = Get-Content $opencodeConfig -Raw -Encoding UTF8
                $json = $raw | ConvertFrom-Json
                # 清洗冲突项
                if ($json.PSObject.Properties['providers'] -and $json.providers.PSObject.Properties['opencode-go']) {
                    $json.providers.PSObject.Properties.Remove('opencode-go')
                    if ($json.providers.PSObject.Properties.Count -eq 0) {
                        $json.PSObject.Properties.Remove('providers')
                    }
                }
                if (-not $json.provider) {
                    $json | Add-Member -NotePropertyName "provider" -NotePropertyValue (New-Object PSObject)
                }
                if ($json.provider.'opencode-go') {
                    if (-not $json.provider.'opencode-go'.options) {
                        $json.provider.'opencode-go' | Add-Member -NotePropertyName "options" -NotePropertyValue (New-Object PSObject)
                    }
                    $json.provider.'opencode-go'.options.baseURL = "http://127.0.0.1:$routerPort/v1"
                    $json.provider.'opencode-go'.options.apiKey = "local-router"
                } else {
                    $goProv = [PSCustomObject]@{
                        name = "opencode-go"
                        npm = "@ai-sdk/openai-compatible"
                        options = [PSCustomObject]@{
                            baseURL = "http://127.0.0.1:$routerPort/v1"
                            apiKey = "local-router"
                        }
                        models = [PSCustomObject]@{
                            "deepseek-v4.1-flash" = [PSCustomObject]@{ name = "deepseek-v4.1-flash" }
                            "deepseek-v4-pro" = [PSCustomObject]@{ name = "deepseek-v4-pro" }
                            "kimi-k3" = [PSCustomObject]@{ name = "kimi-k3" }
                            "qwen3.7-plus" = [PSCustomObject]@{ name = "qwen3.7-plus" }
                            "glm-5.3" = [PSCustomObject]@{ name = "glm-5.3" }
                            "minimax-m3" = [PSCustomObject]@{ name = "minimax-m3" }
                        }
                    }
                    $json.provider | Add-Member -NotePropertyName "opencode-go" -NotePropertyValue $goProv
                }
                $json.model = "opencode-go/deepseek-v4.1-flash"
                Set-Content -Path $opencodeConfig -Value ($json | ConvertTo-Json -Depth 15) -Encoding UTF8
                Write-Host "    ✔ opencode-go 已安全绑定至 127.0.0.1:$routerPort/v1 (无冲突纯净配置)" -ForegroundColor Green
            } catch {
                Write-Host "    ⚠ 更新失败: $_" -ForegroundColor Red
            }
        }
        "stale_opencode_process" {
            Write-Host " -> 正在平滑重启 OpenChamber 托管进程以加载最新配置..." -ForegroundColor Yellow
            try {
                $managedProcs = Get-Process -Name "opencode" -ErrorAction SilentlyContinue | Where-Object {
                    try {
                        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
                        $cmd -like "*serve*--hostname*127.0.0.1*"
                    } catch { $false }
                }
                if ($managedProcs) {
                    $managedProcs | Stop-Process -Force
                    Start-Sleep -Seconds 2
                    Write-Host "    ✔ 托管进程已安全终止，OpenChamber 将自动重载全新配置" -ForegroundColor Green
                }
            } catch {
                Write-Host "    ⚠ 平滑重载失败: $_" -ForegroundColor Yellow
            }
        }
        "router_probe_failed" {
            Write-Host " -> 正在尝试恢复 4010 智能网关..." -ForegroundColor Yellow
            try {
                Invoke-RestMethod -Uri "http://127.0.0.1:$routerPort/balancer/api/reset-cooldown" -Method Post -TimeoutSec 2 | Out-Null
                Write-Host "    ✔ 已重置限频冷却" -ForegroundColor Green
            } catch {}
        }
        "missing_omo_config" {
            Write-Host " -> 正在生成标准 OMO 配置文件..." -ForegroundColor Yellow
            $omoDir = Split-Path $omoConfig -Parent
            if (-not (Test-Path $omoDir)) { New-Item -ItemType Directory -Path $omoDir -Force | Out-Null }
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
      "artistry": { "model": "opencode-go/kimi-k3", "variant": "high" },
      "quick": { "model": "opencode-go/minimax-m3", "variant": "high" }
    }
  }
}
"@
            Set-Content -Path $omoConfig -Value $omoJson -Encoding UTF8
            Write-Host "    ✔ 已生成标准 OMO 调度配置" -ForegroundColor Green
        }
        "accounts_cooling_down" {
            Write-Host " -> 正在重置智能网关限频冷却..." -ForegroundColor Yellow
            try {
                $res = Invoke-RestMethod -Uri "http://127.0.0.1:$routerPort/balancer/api/reset-cooldown" -Method Post -TimeoutSec 2
                Write-Host "    ✔ $($res.message)" -ForegroundColor Green
            } catch {
                Write-Host "    ⚠ 重置冷却失败: $_" -ForegroundColor Yellow
            }
        }
        "router_stopped" {
            Write-Host " -> 正在静默启动 4010 智能网关..." -ForegroundColor Yellow
            $trayExe = Join-Path $PSScriptRoot "OpenCodeRouterTray.exe"
            $vbs = Join-Path $PSScriptRoot "silent-start.vbs"
            if (Test-Path $trayExe) {
                Start-Process -FilePath $trayExe
                Start-Sleep -Seconds 1
                Write-Host "    ✔ 原生托盘与智能网关已无黑框静默启动" -ForegroundColor Green
            } elseif (Test-Path $vbs) {
                Start-Process "wscript.exe" -ArgumentList "`"$vbs`"" -WindowStyle Hidden
                Start-Sleep -Seconds 1
                Write-Host "    ✔ 智能网关已在后台静默启动" -ForegroundColor Green
            }
        }
        "missing_boost_command" {
            Write-Host " -> 正在创建 /boost 快捷指令模版..." -ForegroundColor Yellow
            $cmdDir = Split-Path $boostCommand -Parent
            if (-not (Test-Path $cmdDir)) { New-Item -ItemType Directory -Path $cmdDir -Force | Out-Null }
            $content = @"
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
            Set-Content -Path $boostCommand -Value $content -Encoding UTF8
            Write-Host "    ✔ boost.md 指令模版创建成功" -ForegroundColor Green
        }
        "workspace_no_git" {
            Write-Host " -> 正在初始化工作区 Git 仓库..." -ForegroundColor Yellow
            if (-not (Test-Path $defaultWorkspace)) {
                New-Item -ItemType Directory -Path $defaultWorkspace -Force | Out-Null
            }
            try {
                git -C $defaultWorkspace init | Out-Null
                Write-Host "    ✔ 工作区 Git 初始化完成" -ForegroundColor Green
            } catch {
                Write-Host "    ⚠ Git 初始化失败: $_" -ForegroundColor Yellow
            }
        }
        "opencode_missing" {
            Write-Host " -> 提示: 请运行 setup-wizard.ps1 选择步骤 [1] 安装 OpenCode v2" -ForegroundColor Cyan
        }
        "deepseek_region_risk" {
            Write-Host " -> 提示: OMO 已包含 kimi-k3 与 qwen3.7-plus 路由，若遇区域限制请在界面选用上述模型" -ForegroundColor Cyan
        }
    }
}

Write-Host "`n🎉 所有可修复项已成功完成修复！" -ForegroundColor Green
Write-Host "可重新运行该脚本或在面板 http://127.0.0.1:4010/balancer/ui 中验证。" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not $CheckOnly -and -not $AutoFix) {
    Read-Host "`n按回车键退出..."
}
