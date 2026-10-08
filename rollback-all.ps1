# OpenCode 系统一键回滚脚本 (100% 恢复初始状态)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================================" -ForegroundColor Red
Write-Host " ⚠️ 正在执行 OpenCode 系统配置一键回滚恢复... " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Red

$backupDir = "$env:USERPROFILE\.opencode_backup_20261007_init"
if (-not (Test-Path $backupDir)) {
    Write-Host "❌ 错误: 未找到初始备份目录: $backupDir" -ForegroundColor Red
    exit 1
}

# 1. 停止所有运行中的服务
Write-Host "[1/4] 正在停止所有相关后台服务..." -ForegroundColor Yellow
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

# 2. 还原 ~/.config/opencode
Write-Host "[2/4] 正在还原 OpenCode 原始配置文件 (~/.config/opencode)..." -ForegroundColor Yellow
$opencodeTarget = "$env:USERPROFILE\.config\opencode"
if (Test-Path "$backupDir\config_opencode") {
    # 移除自定义 commands
    if (Test-Path "$opencodeTarget\commands") {
        Remove-Item -Path "$opencodeTarget\commands" -Recurse -Force -ErrorAction SilentlyContinue
    }
    Copy-Item -Path "$backupDir\config_opencode\*" -Destination $opencodeTarget -Recurse -Force
    Write-Host "      ✔ OpenCode 初始配置已完整恢复" -ForegroundColor Green
}

# 3. 还原 ~/.omo
Write-Host "[3/4] 正在还原 OMO 原始状态 (~/.omo)..." -ForegroundColor Yellow
$omoTarget = "$env:USERPROFILE\.omo"
if (Test-Path "$backupDir\omo") {
    # 移除迁移产生的新文件
    if (Test-Path "$omoTarget\omo.jsonc") {
        Remove-Item -Path "$omoTarget\omo.jsonc" -Force -ErrorAction SilentlyContinue
    }
    Copy-Item -Path "$backupDir\omo\*" -Destination $omoTarget -Recurse -Force
    Write-Host "      ✔ OMO 初始配置已完整恢复" -ForegroundColor Green
}

# 4. 可选清理全局包提示
Write-Host "[4/4] 回滚完成！" -ForegroundColor Green
Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "系统配置已精确还原至本次安装实施前的初始状态。" -ForegroundColor Green
Write-Host "如需彻底卸载全局工具，可运行:" -ForegroundColor Cyan
Write-Host "  bun remove -g @openchamber/web oh-my-openagent @opencode/cli opencode-ai" -ForegroundColor White
Write-Host "  npm uninstall -g @openchamber/web oh-my-openagent @opencode/cli opencode-ai" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Red
