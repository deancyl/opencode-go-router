# OpenCode 系统一键回滚脚本 (支持最新灾备快照、历史快照选择与初始状态秒级恢复 - Angle 9)
[CmdletBinding()]
param(
    [string]$SnapshotId = "",
    [switch]$ListSnapshots,
    [switch]$RestoreProductionStats,
    [switch]$DryRun
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================================" -ForegroundColor Red
Write-Host " ⚠️ 正在执行 OpenCode 系统配置与生态一键回滚恢复... " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Red

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$updaterJs = Join-Path $scriptDir "updater.js"

# 进程特征白名单安全终止函数 (免死红线守护)
function Stop-TargetProcessSafe {
    param(
        [int]$Port,
        [string[]]$AllowedPatterns = @("*node*", "*electron*", "*openchamber*", "*opencode*", "*server.js*", "*OpenCodeRouter*")
    )
    $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if (-not $conns) { return }
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) {
        if ($p -le 4) { continue }
        try {
            $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
            if (-not $proc) { continue }
            $procName = $proc.ProcessName
            $cmdLine = ""
            try {
                $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $p" -ErrorAction SilentlyContinue).CommandLine
            } catch {}
            $full = "$procName $cmdLine"
            $isTarget = $false
            foreach ($pat in $AllowedPatterns) {
                if ($full -like $pat) {
                    $isTarget = $true
                    break
                }
            }
            if ($isTarget) {
                Write-Host "      ✔ 端口 $($Port): 安全终止生态进程 [$procName (PID: $p)]" -ForegroundColor Green
                Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
            } else {
                Write-Host "      ⚠ 端口 $($Port) 占用进程未匹配生态特征 [$procName (PID: $p)]，启动免死保护跳过强杀" -ForegroundColor Yellow
            }
        } catch {}
    }
}

# 1. 优先尝试使用 updater.js 的现代快照系统
if (Test-Path $updaterJs) {
    try {
        $snapshotsRaw = & node $updaterJs snapshots 2>$null
        if ($snapshotsRaw) {
            $snapshots = $snapshotsRaw | ConvertFrom-Json
            if ($snapshots -and $snapshots.Count -gt 0) {
                if ($ListSnapshots) {
                    Write-Host " 📋 检测到以下可用灾备快照点 (共 $($snapshots.Count) 个):" -ForegroundColor Cyan
                    $i = 1
                    foreach ($s in $snapshots) {
                        Write-Host "   [$i] ID: $($s.id) | 时间: $($s.timestamp)" -ForegroundColor White
                        Write-Host "       原因: $($s.reason) | 文件数: $($s.files.Count)" -ForegroundColor DarkGray
                        $i++
                    }
                    Write-Host "==========================================================" -ForegroundColor Red
                    exit 0
                }

                $targetSnap = if ($SnapshotId) {
                    $snapshots | Where-Object { $_.id -eq $SnapshotId } | Select-Object -First 1
                } else {
                    $snapshots[0]
                }

                if ($targetSnap) {
                    Write-Host "[1/3] 锁定目标灾备快照: $($targetSnap.id)" -ForegroundColor Cyan
                    Write-Host "      备份时间: $($targetSnap.timestamp) | 原因: $($targetSnap.reason)" -ForegroundColor DarkGray
                    Write-Host "      包含配置文件: $($targetSnap.files -join ', ')" -ForegroundColor DarkGray
                    
                    if ($DryRun) {
                        Write-Host "`n[DRY RUN] 试运行模式：快照验证有效，未执行实际回滚写入操作。" -ForegroundColor Yellow
                        exit 0
                    }

                    Write-Host "[2/3] 正在秒级复原配置与生态环境 (原子文件恢复)..." -ForegroundColor Yellow

                    $rbArgs = if ($SnapshotId) { @("rollback", $SnapshotId) } else { @("rollback") }
                    $rbResultRaw = & node $updaterJs @rbArgs
                    $rbResult = $rbResultRaw | ConvertFrom-Json

                    if ($rbResult -and $rbResult.success) {
                        Write-Host "[3/3] 回滚恢复成功！" -ForegroundColor Green
                        Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
                        Write-Host " 📋 结构化快照恢复清单 (Snapshot Restored Items):" -ForegroundColor White
                        foreach ($it in $rbResult.restoredItems) {
                            $statusColor = if ($it.status -eq 'restored') { "Green" } elseif ($it.status -like "*preserved*") { "Cyan" } else { "Yellow" }
                            Write-Host "  ✔ 文件/动作: $($it.file)$($it.action) -> 状态: $($it.status)" -ForegroundColor $statusColor
                        }
                        Write-Host "`n系统配置与生态组件已完整还原至快照点 [$($targetSnap.id)]！" -ForegroundColor Green
                        Write-Host "生产统计账本与关键历史已获得安全防护与对齐。" -ForegroundColor White
                        Write-Host "==========================================================" -ForegroundColor Red
                        exit 0
                    } else {
                        Write-Host "  ⚠ 现代快照恢复返回异常: $($rbResult.error)" -ForegroundColor Yellow
                    }
                } else {
                    Write-Host "❌ 错误: 未在快照库中找到指定快照 ID [$SnapshotId]！" -ForegroundColor Red
                }
            }
        }
    } catch {
        Write-Host "  ℹ 现代快照回滚调用异常: $_，尝试回退检查传统备份..." -ForegroundColor DarkGray
    }
}

# 2. 回退传统备份逻辑
$backupDir = "$env:USERPROFILE\.opencode_backup_20261007_init"
if (-not (Test-Path $backupDir)) {
    Write-Host "❌ 错误: 未在系统中检索到任何灾备快照或初始备份目录！" -ForegroundColor Red
    Write-Host "   快照目录: $(Join-Path $scriptDir 'snapshots')" -ForegroundColor Yellow
    Write-Host "   传统目录: $backupDir" -ForegroundColor Yellow
    exit 1
}

Write-Host "正在从传统初始备份恢复: $backupDir..." -ForegroundColor Yellow

if ($DryRun) {
    Write-Host "`n[DRY RUN] 试运行模式：传统备份目录存在，未执行覆盖操作。" -ForegroundColor Yellow
    exit 0
}

# 停止服务 (严格核验进程特征白名单)
Write-Host "[1/4] 正在安全停止相关后台服务 (特征核验)..." -ForegroundColor Yellow
try { openchamber stop } catch {}
Stop-TargetProcessSafe -Port 3000
Stop-TargetProcessSafe -Port 4010

# 还原 ~/.config/opencode
Write-Host "[2/4] 正在还原 OpenCode 原始配置文件 (~/.config/opencode)..." -ForegroundColor Yellow
$opencodeTarget = "$env:USERPROFILE\.config\opencode"
if (Test-Path "$backupDir\config_opencode") {
    if (Test-Path "$opencodeTarget\commands") {
        Remove-Item -Path "$opencodeTarget\commands" -Recurse -Force -ErrorAction SilentlyContinue
    }
    Copy-Item -Path "$backupDir\config_opencode\*" -Destination $opencodeTarget -Recurse -Force
    Write-Host "      ✔ OpenCode 初始配置已完整恢复" -ForegroundColor Green
}

# 还原 ~/.omo
Write-Host "[3/4] 正在还原 OMO 原始状态 (~/.omo)..." -ForegroundColor Yellow
$omoTarget = "$env:USERPROFILE\.omo"
if (Test-Path "$backupDir\omo") {
    if (Test-Path "$omoTarget\omo.jsonc") {
        Remove-Item -Path "$omoTarget\omo.jsonc" -Force -ErrorAction SilentlyContinue
    }
    Copy-Item -Path "$backupDir\omo\*" -Destination $omoTarget -Recurse -Force
    Write-Host "      ✔ OMO 初始配置已完整恢复" -ForegroundColor Green
}

Write-Host "[4/4] 回滚完成！" -ForegroundColor Green
Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "系统配置已精确还原至稳定初始状态。" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Red
