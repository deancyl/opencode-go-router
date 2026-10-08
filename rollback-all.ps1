# OpenCode 系统一键回滚脚本 (支持最新灾备快照与初始状态秒级恢复)
[CmdletBinding()]
param(
    [string]$SnapshotId = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================================" -ForegroundColor Red
Write-Host " ⚠️ 正在执行 OpenCode 系统配置与生态一键回滚恢复... " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Red

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$updaterJs = Join-Path $scriptDir "updater.js"

# 1. 优先尝试使用 updater.js 的现代快照系统
if (Test-Path $updaterJs) {
    try {
        $snapshotsRaw = & node $updaterJs snapshots 2>$null
        if ($snapshotsRaw) {
            $snapshots = $snapshotsRaw | ConvertFrom-Json
            if ($snapshots -and $snapshots.Count -gt 0) {
                $targetSnap = if ($SnapshotId) {
                    $snapshots | Where-Object { $_.id -eq $SnapshotId } | Select-Object -First 1
                } else {
                    $snapshots[0]
                }

                if ($targetSnap) {
                    Write-Host "[1/3] 检测到灾备快照: $($targetSnap.id)" -ForegroundColor Cyan
                    Write-Host "      备份时间: $($targetSnap.timestamp) | 原因: $($targetSnap.reason)" -ForegroundColor DarkGray
                    Write-Host "[2/3] 正在秒级复原配置与生态环境..." -ForegroundColor Yellow

                    $rbCmd = if ($SnapshotId) { "node `"$updaterJs`" rollback `"$SnapshotId`"" } else { "node `"$updaterJs`" rollback" }
                    $rbResultRaw = Invoke-Expression $rbCmd
                    $rbResult = $rbResultRaw | ConvertFrom-Json

                    if ($rbResult -and $rbResult.success) {
                        Write-Host "[3/3] 回滚恢复成功！" -ForegroundColor Green
                        Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
                        foreach ($it in $rbResult.restoredItems) {
                            Write-Host "  ✔ 已还原: $($it.file)$($it.action) ($($it.status))" -ForegroundColor Green
                        }
                        Write-Host "系统配置已恢复至快照记录点！" -ForegroundColor Green
                        Write-Host "==========================================================" -ForegroundColor Red
                        exit 0
                    }
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

# 停止服务
Write-Host "[1/4] 正在停止相关后台服务..." -ForegroundColor Yellow
try { openchamber stop } catch {}
$chamberConns = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($chamberConns) {
    foreach ($conn in $chamberConns) {
        try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
}
$routerConns = Get-NetTCPConnection -LocalPort 4010 -ErrorAction SilentlyContinue
if ($routerConns) {
    foreach ($conn in $routerConns) {
        try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
}

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
