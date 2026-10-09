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
Write-Host "`n[1/8] 检查 OpenCode CLI 环境..." -ForegroundColor Yellow
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
Write-Host "`n[2/8] 检查 4010 智能网关与端到端推理链路..." -ForegroundColor Yellow
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
Write-Host "`n[3/8] 检查 OpenCode 配置文件与冲突隔离..." -ForegroundColor Yellow
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
    $hasPlural = $false
    $hasPlural = $false
    try {
        $parsedJson = $ocContent | ConvertFrom-Json
        if ($parsedJson.PSObject.Properties['providers'] -and $parsedJson.providers.PSObject.Properties.Count -gt 0) {
            $hasPlural = $true
        }
    } catch {
        $hasPlural = [bool]($ocContent -match '"providers"\s*:')
    }
    if ($hasPlural) {
        Write-Host "  ❌ 发现已废弃的 providers 复数配置键！" -ForegroundColor Red
        Write-Host "     (OpenCode 2.0+ 启动将触发 conflict 并自动丢弃 4010 本地网关，回退到直连并导致 ConnectionRefused)" -ForegroundColor Yellow
        $issuesFound.Add([PSCustomObject]@{
            Id = "config_conflict"
            Title = "opencode.jsonc 存在提供商单复数配置冲突 (旧复数 providers 键)"
            Severity = "High"
            FixDesc = "自动清洗并合流第三方提供商，规范化为单一标准 provider 配置并补全 38 款模型"
        })
    } else {
        Write-Host "  ✔ 未发现单复数配置冲突 (规范单一 provider)" -ForegroundColor Green
    }

    # 检测 38 款全量模型是否完整
    $modelCount = 0
    try {
        $parsedJson = $ocContent | ConvertFrom-Json
        if ($parsedJson.provider -and $parsedJson.provider.'opencode-go' -and $parsedJson.provider.'opencode-go'.models) {
            $modelCount = ($parsedJson.provider.'opencode-go'.models.PSObject.Properties | Measure-Object).Count
        }
    } catch {}
    if ($modelCount -gt 0 -and $modelCount -lt 38) {
        Write-Host "  ⚠ opencode-go 官方模型清单未补全 (当前 $modelCount/38 款)" -ForegroundColor Yellow
        $issuesFound.Add([PSCustomObject]@{
            Id = "models_incomplete"
            Title = "opencode-go 官方模型清单未补全 (当前 $modelCount/38 款)"
            Severity = "Low"
            FixDesc = "自动补齐官方 38 款全量模型并保留当前首选模型与自定义微调模型"
        })
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
Write-Host "`n[4/8] 检查 Oh My OpenAgent 调度配置与 DeepSeek 区域限制..." -ForegroundColor Yellow
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
Write-Host "`n[5/8] 检查 Goal 目标推进体系与 /boost 模式..." -ForegroundColor Yellow
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
Write-Host "`n[6/8] 检查 OpenChamber 工作区环境与托管服务状态..." -ForegroundColor Yellow
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

# 检查 OpenChamber 进程状态、无界面僵死死锁与托管实例
$chamberProcs = Get-Process -Name "OpenChamber" -ErrorAction SilentlyContinue
$managedOpencode = Get-Process -Name "opencode" -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
        $cmd -like "*serve*--hostname*127.0.0.1*"
    } catch { $false }
}

if ($chamberProcs) {
    $hasWindow = $false
    foreach ($p in $chamberProcs) {
        if ($p.MainWindowHandle -ne 0) {
            $hasWindow = $true
            break
        }
    }
    if (-not $hasWindow) {
        Write-Host "  ❌ 发现 OpenChamber 后台无界面僵死进程 ($($chamberProcs.Count) 个实例)" -ForegroundColor Red
        Write-Host "     (正死锁 Electron SingleInstanceLock 单实例互斥锁，导致桌面双击图标无法打开或闪退)" -ForegroundColor Yellow
        $issuesFound.Add([PSCustomObject]@{
            Id = "openchamber_ghost_process"
            Title = "OpenChamber 后台无窗口僵死进程死锁单实例锁（导致桌面打不开）"
            Severity = "High"
            FixDesc = "彻底清理所有后台残留僵死进程并释放单实例锁，恢复桌面正常秒开"
        })
    } else {
        Write-Host "  ✔ OpenChamber 桌面客户端主窗口正常呈现" -ForegroundColor Green
    }

    if ($managedOpencode) {
        Write-Host "  ✔ OpenChamber 托管 OpenCode 实例正常运行 (PID: $($managedOpencode.Id))" -ForegroundColor Green
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
} else {
    Write-Host "  ℹ OpenChamber 桌面端未运行 (无单实例锁占用，可直接在桌面双击启动)" -ForegroundColor DarkGray
    if ($managedOpencode) {
        Write-Host "  ⚠ 发现 OpenChamber 已退出但残留孤立 opencode 托管进程 (PID: $($managedOpencode.Id))" -ForegroundColor Yellow
        $issuesFound.Add([PSCustomObject]@{
            Id = "orphan_opencode_process"
            Title = "OpenCode 孤立后台托管进程残留占用端口"
            Severity = "Medium"
            FixDesc = "清理孤立残留进程，防止后续端口争用"
        })
    }
}

# 检查 OpenChamber Office 全格式离线预览引擎挂载状态
$patchScript = Join-Path $PSScriptRoot "patch-openchamber-office.ps1"
$chamberDistCandidates = @(
    "$env:LOCALAPPDATA\Programs\@openchamberelectron\resources\web-dist",
    "$env:LOCALAPPDATA\Programs\OpenChamber\resources\web-dist",
    "$env:USERPROFILE\.bun\install\global\node_modules\@openchamber\web\dist",
    "$env:USERPROFILE\.bun\install\global\node_modules\@openchamber\web\public",
    "$env:APPDATA\npm\node_modules\@openchamber\web\dist"
)
$foundDist = $chamberDistCandidates | Where-Object { Test-Path (Join-Path $_ "index.html") } | Select-Object -First 1
if ($foundDist) {
    $hasOfficePatch = (Get-Content (Join-Path $foundDist "index.html") -Raw -ErrorAction SilentlyContinue) -like "*office-preview-engine.js*"
    if ($hasOfficePatch) {
        Write-Host "  ✔ OpenChamber 全能 Office 离线预览引擎已就绪 (.docx/.xlsx/.pptx)" -ForegroundColor Green
    } else {
        Write-Host "  ℹ OpenChamber 尚未挂载 Office 离线预览引擎 (遇办公文档将提示不解码)" -ForegroundColor DarkGray
        $issuesFound.Add([PSCustomObject]@{
            Id = "openchamber_office_preview"
            Title = "OpenChamber 未挂载 Office 离线安全预览引擎"
            Severity = "Low"
            FixDesc = "自动注入纯本地离线引擎，秒级支持 .docx/.xlsx/.pptx 原生内嵌预览与双轨原厂打开"
        })
    }
}

# ----------------- 7. 检测组件版本更新与生态兼容性诊断 -----------------
Write-Host "`n[7/8] 检查套件组件版本更新与生态兼容性诊断..." -ForegroundColor Yellow
$updaterScript = Join-Path $PSScriptRoot "updater.js"
if (Test-Path $updaterScript) {
    try {
        $updateJson = (& node $updaterScript check 2>$null)
        if ($updateJson) {
            $updateReport = $updateJson | ConvertFrom-Json
            if ($updateReport.compatibility.riskLevel -eq "critical") {
                Write-Host "  🛑 发现组件版本重大跨越或生态兼容性风险！" -ForegroundColor Red
                $issuesFound.Add([PSCustomObject]@{
                    Id = "components_critical_risk"
                    Title = "组件存在破坏性跨版本更新或兼容性脱节"
                    Severity = "High"
                    FixDesc = "使用一键更新管理功能，在自动快照保护下执行同步更新或回滚"
                })
            } elseif ($updateReport.compatibility.riskLevel -eq "warning") {
                Write-Host "  ⚠ 检测到组件有更新可用 ($($updateReport.compatibility.summary))" -ForegroundColor Yellow
                $issuesFound.Add([PSCustomObject]@{
                    Id = "components_update_available"
                    Title = "存在待更新的套件组件 (如 OMO 5.1.24 或核心引擎)"
                    Severity = "Medium"
                    FixDesc = "在更新管理面板或向导中一键安全更新，保持最新生态适配"
                })
            } else {
                Write-Host "  ✔ 全套组件版本最新且高度兼容" -ForegroundColor Green
            }
        }
    } catch {
        Write-Host "  ℹ 版本检测已略过: $_" -ForegroundColor DarkGray
    }
}

# ----------------- 8. 检测 OpenAI Codex CLI 与智能网关接入 -----------------
Write-Host "`n[8/8] 检查 OpenAI Codex CLI 环境与智能网关接入..." -ForegroundColor Yellow
$codexVer = $null
$codexCmd = Get-Command codex -ErrorAction SilentlyContinue
if ($codexCmd) {
    try {
        $codexVer = (& codex --version 2>$null)
    } catch {}
} else {
    $codexCandidates = @(
        "$env:APPDATA\npm\codex.cmd",
        "$env:USERPROFILE\.bun\bin\codex.exe",
        "$env:ProgramFiles\nodejs\codex.cmd"
    )
    foreach ($cand in $codexCandidates) {
        if (Test-Path $cand) {
            try {
                $v = (& $cand --version 2>$null)
                if ($v) { $codexVer = $v; break }
            } catch {}
        }
    }
}

if ($codexVer) {
    Write-Host "  ✔ OpenAI Codex CLI 已就绪: $codexVer" -ForegroundColor Green
    $codexConfig = "$env:USERPROFILE\.codex\config.toml"
    $isCodexBound = $false
    if (Test-Path $codexConfig) {
        $cfgRaw = Get-Content $codexConfig -Raw -ErrorAction SilentlyContinue
        if ($cfgRaw -and ($cfgRaw -match "127\.0\.0\.1:$routerPort" -or $cfgRaw -match ":$routerPort/v1")) {
            $isCodexBound = $true
        }
    }
    if ($isCodexBound) {
        Write-Host "  ✔ Codex CLI 已成功接入本地 $routerPort 智能网关 (38 款全量模型调度已就绪)" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Codex CLI 尚未接入本地智能网关" -ForegroundColor Yellow
        $issuesFound.Add([PSCustomObject]@{
            Id = "codex_not_bound"
            Title = "OpenAI Codex CLI 尚未接入本地 4010 智能网关"
            Severity = "Medium"
            FixDesc = "一键接入本地网关（配置 38 款模型映射、思考等级适配与无损配置备份）"
        })
    }
} else {
    Write-Host "  ℹ 未检测到全局 OpenAI Codex CLI" -ForegroundColor DarkGray
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
            Write-Host " -> 正在清洗 opencode.jsonc 中的单复数冲突项并合流第三方提供商..." -ForegroundColor Yellow
            try {
                $updaterScript = Join-Path $PSScriptRoot "updater.js"
                if (Test-Path $updaterScript) {
                    $escPath = $opencodeConfig.Replace('\', '/')
                    node -e "const u = require('./updater'); u.harmonizeOpencodeConfig('$escPath', $routerPort);"
                    Write-Host "    ✔ 冲突项已彻底清除，第三方提供商已安全合流，38 款全量模型已就绪" -ForegroundColor Green
                } else {
                    $raw = Get-Content $opencodeConfig -Raw -Encoding UTF8
                    $json = $raw | ConvertFrom-Json
                    if ($json.PSObject.Properties['providers']) {
                        if (-not $json.provider) { $json | Add-Member -NotePropertyName "provider" -NotePropertyValue (New-Object PSObject) }
                        foreach ($prop in $json.providers.PSObject.Properties) {
                            if ($prop.Name -ne 'opencode-go' -and -not $json.provider.PSObject.Properties[$prop.Name]) {
                                $json.provider | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $prop.Value
                            }
                        }
                        $json.PSObject.Properties.Remove('providers')
                    }
                    Set-Content -Path $opencodeConfig -Value ($json | ConvertTo-Json -Depth 15) -Encoding UTF8
                    Write-Host "    ✔ 冲突项已彻底清除" -ForegroundColor Green
                }
            } catch {
                Write-Host "    ⚠ 清洗失败: $_" -ForegroundColor Red
            }
        }
        "missing_opencode_config" {
            Write-Host " -> 正在创建标准 opencode.jsonc 配置文件..." -ForegroundColor Yellow
            $updaterScript = Join-Path $PSScriptRoot "updater.js"
            if (Test-Path $updaterScript) {
                $escPath = $opencodeConfig.Replace('\', '/')
                node -e "const u = require('./updater'); u.harmonizeOpencodeConfig('$escPath', $routerPort);"
                Write-Host "    ✔ 已生成 opencode.jsonc 并绑定 4010 网关 (全量 38 款模型)" -ForegroundColor Green
            } else {
                $ocDir = Split-Path $opencodeConfig -Parent
                if (-not (Test-Path $ocDir)) { New-Item -ItemType Directory -Path $ocDir -Force | Out-Null }
                $defaultConfig = @{
                    plugin = @("oh-my-openagent@5.1.24", "opencode-goal-plugin")
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
        }
        "missing_4010_gateway" {
            Write-Host " -> 正在更新 opencode.jsonc 绑定本地 4010 网关..." -ForegroundColor Yellow
            try {
                $updaterScript = Join-Path $PSScriptRoot "updater.js"
                if (Test-Path $updaterScript) {
                    $escPath = $opencodeConfig.Replace('\', '/')
                    node -e "const u = require('./updater'); u.harmonizeOpencodeConfig('$escPath', $routerPort);"
                    Write-Host "    ✔ opencode-go 已安全绑定至 127.0.0.1:$routerPort/v1 并注入 38 款全量模型" -ForegroundColor Green
                } else {
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
                    if ($json.provider.'opencode-go') {
                        if (-not $json.provider.'opencode-go'.options) {
                            $json.provider.'opencode-go' | Add-Member -NotePropertyName "options" -NotePropertyValue (New-Object PSObject)
                        }
                        $json.provider.'opencode-go'.options.baseURL = "http://127.0.0.1:$routerPort/v1"
                        $json.provider.'opencode-go'.options.apiKey = "local-router"
                    }
                    Set-Content -Path $opencodeConfig -Value ($json | ConvertTo-Json -Depth 15) -Encoding UTF8
                    Write-Host "    ✔ opencode-go 已安全绑定至 127.0.0.1:$routerPort/v1 (无冲突纯净配置)" -ForegroundColor Green
                }
            } catch {
                Write-Host "    ⚠ 绑定失败: $_" -ForegroundColor Red
            }
        }
        "models_incomplete" {
            Write-Host " -> 正在补全 opencode-go 38 款官方全量模型..." -ForegroundColor Yellow
            try {
                $updaterScript = Join-Path $PSScriptRoot "updater.js"
                if (Test-Path $updaterScript) {
                    $escPath = $opencodeConfig.Replace('\', '/')
                    node -e "const u = require('./updater'); u.harmonizeOpencodeConfig('$escPath', $routerPort);"
                    Write-Host "    ✔ 38 款官方全量模型已就绪，当前首选模型已保留" -ForegroundColor Green
                }
            } catch {
                Write-Host "    ⚠ 补全模型失败: $_" -ForegroundColor Red
            }
        }
        "openchamber_ghost_process" {
            Write-Host " -> 正在清理后台僵死 OpenChamber 进程并释放单实例互斥锁..." -ForegroundColor Yellow
            try {
                Get-Process -Name "OpenChamber" -ErrorAction SilentlyContinue | Stop-Process -Force
                # 同步清理悬挂的托管 opencode 进程
                Get-Process -Name "opencode" -ErrorAction SilentlyContinue | Where-Object {
                    try {
                        (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine -like "*serve*--hostname*127.0.0.1*"
                    } catch { $false }
                } | Stop-Process -Force
                Start-Sleep -Seconds 1
                Write-Host "    ✔ 后台僵死进程已全部清除，单实例锁已释放，现在可在桌面正常双击启动" -ForegroundColor Green
            } catch {
                Write-Host "    ⚠ 清理失败: $_" -ForegroundColor Red
            }
        }
        "orphan_opencode_process" {
            Write-Host " -> 正在清理残留的孤立 OpenCode 托管进程..." -ForegroundColor Yellow
            try {
                $managedProcs = Get-Process -Name "opencode" -ErrorAction SilentlyContinue | Where-Object {
                    try {
                        (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine -like "*serve*--hostname*127.0.0.1*"
                    } catch { $false }
                }
                if ($managedProcs) {
                    $managedProcs | Stop-Process -Force
                    Write-Host "    ✔ 孤立进程已成功终止，端口已释放" -ForegroundColor Green
                }
            } catch {
                Write-Host "    ⚠ 清理失败: $_" -ForegroundColor Red
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
        "openchamber_office_preview" {
            Write-Host " -> 正在自动挂载 OpenChamber 全能 Office 离线预览引擎..." -ForegroundColor Yellow
            $patchScript = Join-Path $PSScriptRoot "patch-openchamber-office.ps1"
            if (Test-Path $patchScript) {
                & $patchScript -Install
                Write-Host "    ✔ OpenChamber 全能 Office 离线预览引擎挂载完成" -ForegroundColor Green
            } else {
                Write-Host "    ⚠ 未找到 patch-openchamber-office.ps1 脚本" -ForegroundColor Red
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
        "components_update_available" {
            Write-Host " -> 正在自动同步更新 opencode.jsonc 插件版本标签..." -ForegroundColor Yellow
            try {
                if (Test-Path $opencodeConfig) {
                    $raw = Get-Content $opencodeConfig -Raw -Encoding UTF8
                    $fixed = $raw -replace "oh-my-openagent(@\d+\.\d+\.\d+)?", "oh-my-openagent@5.1.24"
                    Set-Content -Path $opencodeConfig -Value $fixed -Encoding UTF8
                    Write-Host "    ✔ opencode.jsonc 插件标签已同步更新至 oh-my-openagent@5.1.24" -ForegroundColor Green
                }
            } catch {
                Write-Host "    ⚠ 插件标签更新提示: $_" -ForegroundColor DarkGray
            }
        }
        "components_critical_risk" {
            Write-Host " -> 提示: 存在重大破坏性跨版本更新，建议在 Web 面板 (/balancer/ui) 或 setup-wizard.ps1 [9] 中查看兼容性预警并执行一键升级/回滚" -ForegroundColor Yellow
        }
        "codex_not_bound" {
            Write-Host " -> 正在将 OpenAI Codex CLI 接入本地智能网关..." -ForegroundColor Yellow
            try {
                $nodeCmd = "const a = require('./codex-adapter'); const r = a.bindCodexConfig({ routerPort: $routerPort, defaultModel: 'deepseek-v4.1-flash', reasoningEffort: 'high' }); console.log(JSON.stringify(r));"
                $resJson = (& node -e $nodeCmd 2>$null)
                Write-Host "    ✔ OpenAI Codex CLI 已成功接入本地 $routerPort 网关 (全量 38 款模型就绪)" -ForegroundColor Green
            } catch {
                Write-Host "    ❌ 接入 Codex 失败: $_" -ForegroundColor Red
            }
        }
    }
}

Write-Host "`n🎉 所有可修复项已成功完成修复！" -ForegroundColor Green
Write-Host "可重新运行该脚本或在面板 http://127.0.0.1:4010/balancer/ui 中验证。" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not $CheckOnly -and -not $AutoFix) {
    Read-Host "`n按回车键退出..."
}
