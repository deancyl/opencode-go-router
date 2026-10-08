# patch-openchamber-office.ps1: OpenChamber 办公全格式 (Word/Excel/PPT) 离线安全预览一键挂载与还原脚本
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Rollback,
    [switch]$Status,
    [string]$TargetDir = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 📑 OpenChamber 办公全格式离线安全预览挂载管理系统 " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$engineSource = Join-Path $scriptRoot "assets\office-preview-engine.js"
if (-not (Test-Path $engineSource)) {
    $engineSource = Join-Path $scriptRoot "office-preview-engine.js"
}

if (-not (Test-Path $engineSource)) {
    Write-Host "❌ 未在 assets 或根目录下找到 office-preview-engine.js 引擎包！" -ForegroundColor Red
    exit 1
}

# 1. 自动发现 OpenChamber web-dist 目录
$candidates = @()
if ($TargetDir -and (Test-Path $TargetDir)) {
    $candidates += $TargetDir
}
$candidates += "$env:LOCALAPPDATA\Programs\@openchamberelectron\resources\web-dist"
$candidates += "$env:USERPROFILE\.bun\install\global\node_modules\@openchamber\web\dist"
$candidates += "$env:USERPROFILE\.bun\install\global\node_modules\@openchamber\web\public"

$webDist = $null
foreach ($c in $candidates) {
    if (Test-Path (Join-Path $c "index.html")) {
        $webDist = $c
        break
    }
}

if (-not $webDist) {
    Write-Host "❌ 未检测到 OpenChamber 的 web-dist 安装目录！" -ForegroundColor Red
    Write-Host "   请使用 -TargetDir 参数指定正确的 OpenChamber 前端目录。" -ForegroundColor Yellow
    exit 1
}

Write-Host "✔ 目标 OpenChamber 前端目录: $webDist" -ForegroundColor Green

$indexHtml = Join-Path $webDist "index.html"
$assetsDir = Join-Path $webDist "assets"
$targetEngine = Join-Path $assetsDir "office-preview-engine.js"

# 查找包含 Zd 占位组件的目标 JS 文件
$filesViewJs = Get-ChildItem -Path $assetsDir -Filter "FilesView-*.js" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $filesViewJs) {
    $filesViewJs = Get-ChildItem -Path $assetsDir -Filter "*.js" | Where-Object {
        (Get-Content $_.FullName -Raw) -like "*filesView.artifact.binary.descriptionWithType*"
    } | Select-Object -First 1
}

if (-not $filesViewJs) {
    Write-Host "❌ 未能定位到 FilesView 核心视图分发文件！" -ForegroundColor Red
    exit 1
}

Write-Host "✔ 定位到视图分发模块: $($filesViewJs.Name)" -ForegroundColor Green

$backupIndex = "$indexHtml.bak"
$backupFilesView = "$($filesViewJs.FullName).bak"

# 检查当前状态
$hasScriptInHtml = (Get-Content $indexHtml -Raw) -like "*office-preview-engine.js*"
$hasHookInJs = (Get-Content $filesViewJs.FullName -Raw) -like "*OpenChamberOfficeViewer*"
$isInstalled = $hasScriptInHtml -and $hasHookInJs -and (Test-Path $targetEngine)

if ($Status) {
    Write-Host "`n[状态检查]" -ForegroundColor Yellow
    if ($isInstalled) {
        Write-Host "  ✔ 全能 Office 离线预览引擎已成功挂载！" -ForegroundColor Green
        Write-Host "  支持格式: .docx, .doc, .xlsx, .xls, .csv, .pptx, .ppt" -ForegroundColor Cyan
    } else {
        Write-Host "  ℹ 尚未挂载 Office 预览引擎（目前处于原厂默认状态）" -ForegroundColor DarkGray
    }
    exit 0
}

# ----------------- 回滚还原 -----------------
if ($Rollback) {
    Write-Host "`n正在执行一键还原与卸载..." -ForegroundColor Yellow
    $restored = $false
    if (Test-Path $backupIndex) {
        Copy-Item $backupIndex $indexHtml -Force
        Remove-Item $backupIndex -Force -ErrorAction SilentlyContinue
        Write-Host "  ✔ index.html 已恢复为原厂备份" -ForegroundColor Green
        $restored = $true
    }
    if (Test-Path $backupFilesView) {
        Copy-Item $backupFilesView $filesViewJs.FullName -Force
        Remove-Item $backupFilesView -Force -ErrorAction SilentlyContinue
        Write-Host "  ✔ $($filesViewJs.Name) 已恢复为原厂备份" -ForegroundColor Green
        $restored = $true
    }
    if (Test-Path $targetEngine) {
        Remove-Item $targetEngine -Force -ErrorAction SilentlyContinue
        Write-Host "  ✔ office-preview-engine.js 已清理" -ForegroundColor Green
        $restored = $true
    }

    if ($restored) {
        Write-Host "`n🎉 OpenChamber 前端已成功恢复出厂纯净默认状态！" -ForegroundColor Green
    } else {
        Write-Host "`nℹ 未发现备份文件，系统已处于初始状态。" -ForegroundColor DarkGray
    }
    exit 0
}

# ----------------- 安装挂载 -----------------
Write-Host "`n正在安装全能 Office 离线安全预览引擎..." -ForegroundColor Yellow

# 1. 备份原文件
if (-not (Test-Path $backupIndex)) {
    Copy-Item $indexHtml $backupIndex -Force
    Write-Host "  ✔ 已创建备份: index.html.bak" -ForegroundColor DarkGray
}
if (-not (Test-Path $backupFilesView)) {
    Copy-Item $filesViewJs.FullName $backupFilesView -Force
    Write-Host "  ✔ 已创建备份: $($filesViewJs.Name).bak" -ForegroundColor DarkGray
}

# 2. 复制引擎文件
Copy-Item $engineSource $targetEngine -Force
Write-Host "  ✔ 已注入离线引擎: assets\office-preview-engine.js" -ForegroundColor Green

# 3. 注入 index.html
$htmlContent = Get-Content $indexHtml -Raw
if ($htmlContent -notlike "*office-preview-engine.js*") {
    $scriptTag = "    <script src=`"/assets/office-preview-engine.js`"></script>`n"
    if ($htmlContent.Contains("</head>")) {
        $htmlContent = $htmlContent.Replace("</head>", "$scriptTag  </head>")
    } else {
        $htmlContent = $htmlContent.Replace("<head>", "<head>`n$scriptTag")
    }
    [System.IO.File]::WriteAllText($indexHtml, $htmlContent, [System.Text.Encoding]::UTF8)
    Write-Host "  ✔ 已在 index.html 的 <head> 中注册全局 office-preview 驱动引擎" -ForegroundColor Green
} else {
    Write-Host "  ℹ index.html 已包含引擎引用" -ForegroundColor DarkGray
}

# 4. 挂载 Hook 到 FilesView JS
$jsContent = Get-Content $filesViewJs.FullName -Raw
if ($jsContent -notlike "*OpenChamberOfficeViewer*") {
    $targetPattern = "Zd=r=>{"
    if ($jsContent.Contains($targetPattern)) {
        $hook = 'if(window.OpenChamberOfficeViewer&&window.OpenChamberOfficeViewer.isOfficeFile(r.path||r.name)){return s.jsx("div",{className:"h-full w-full min-h-0",ref:node=>{if(node&&!node.dataset.mounted){node.dataset.mounted="true";window.OpenChamberOfficeViewer.mount(node,r)}}});}'
        $insertIdx = $jsContent.IndexOf($targetPattern) + $targetPattern.Length
        $jsContent = $jsContent.Insert($insertIdx, $hook)
        [System.IO.File]::WriteAllText($filesViewJs.FullName, $jsContent, [System.Text.Encoding]::UTF8)
        Write-Host "  ✔ 已成功在 FilesView 视图分发层挂载全能 Office 渲染拦截器！" -ForegroundColor Green
    } else {
        Write-Host "  ❌ 未能在 $($filesViewJs.Name) 中匹配到 Zd 组件特征！" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  ℹ FilesView 已挂载 Office 拦截器" -ForegroundColor DarkGray
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " 🎉 OpenChamber 全能 Office 离线预览引擎挂载成功！" -ForegroundColor Green
Write-Host "  - 支持格式: Word (.docx, .doc), Excel (.xlsx, .xls, .csv), PPT (.pptx, .ppt)" -ForegroundColor Cyan
Write-Host "  - 100% 纯本地离线解析，零外网数据泄漏风险" -ForegroundColor Cyan
Write-Host "  - 双轨联动: 内嵌即览 + 一键唤起本地 WPS / Microsoft Office 原厂打开" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
