# patch-openchamber-office.ps1: OpenChamber 办公全格式 (Word/Excel/PPT) 离线安全预览一键挂载与还原脚本
[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [string]$Action = "",
    [switch]$Install,
    [switch]$Rollback,
    [switch]$Status,
    [string]$TargetDir = ""
)

if ($Action -match "^-?r(ollback)?$") { $Rollback = $true }
elseif ($Action -match "^-?s(tatus)?$") { $Status = $true }
elseif ($Action -match "^-?i(nstall)?$") { $Install = $true }

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
$candidates += "$env:LOCALAPPDATA\Programs\OpenChamber\resources\web-dist"
$candidates += "$env:USERPROFILE\.bun\install\global\node_modules\@openchamber\web\dist"
$candidates += "$env:USERPROFILE\.bun\install\global\node_modules\@openchamber\web\public"
$candidates += "$env:APPDATA\npm\node_modules\@openchamber\web\dist"

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
$jsContentCheck = Get-Content $filesViewJs.FullName -Raw
$hasHookInJs = $jsContentCheck -like "*OpenChamberOfficeViewer.isOfficeFile*" -and ($jsContentCheck -match '([A-Za-z0-9_$]+)=r=>\{if\(window\.OpenChamberOfficeViewer')
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

# 1. 备份原文件 (若已有纯净备份，优先从干净备份恢复基准)
if (-not (Test-Path $backupIndex)) {
    Copy-Item $indexHtml $backupIndex -Force
    Write-Host "  ✔ 已创建备份: index.html.bak" -ForegroundColor DarkGray
}
if (-not (Test-Path $backupFilesView)) {
    Copy-Item $filesViewJs.FullName $backupFilesView -Force
    Write-Host "  ✔ 已创建备份: $($filesViewJs.Name).bak" -ForegroundColor DarkGray
} else {
    $bakContent = Get-Content $backupFilesView -Raw
    if ($bakContent -notlike "*OpenChamberOfficeViewer*") {
        Copy-Item $backupFilesView $filesViewJs.FullName -Force
    }
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

# 4. 挂载 Hook 到 FilesView JS (AST 级别精准定位二进制分发组件)
$jsContent = Get-Content $filesViewJs.FullName -Raw

# 查找 filesView.artifact.binary 所在位置
$binaryIdx = $jsContent.IndexOf("filesView.artifact.binary")
if ($binaryIdx -eq -1) {
    Write-Host "  ❌ 未能在 $($filesViewJs.Name) 中找到 filesView.artifact.binary 特征！" -ForegroundColor Red
    exit 1
}

# 向前寻找最近的函数定义入口 ([A-Za-z0-9_$]+)=r=>\{
$searchStart = [Math]::Max(0, $binaryIdx - 2000)
$searchLen = $binaryIdx - $searchStart
$preText = $jsContent.Substring($searchStart, $searchLen)
$funcMatches = [regex]::Matches($preText, '([A-Za-z0-9_$]+)=r=>\{')

if ($funcMatches.Count -eq 0) {
    Write-Host "  ❌ 未能精准定位二进制分发组件入口！" -ForegroundColor Red
    exit 1
}

$targetFuncMatch = $funcMatches[$funcMatches.Count - 1]
$compVar = $targetFuncMatch.Groups[1].Value
$targetPattern = "$compVar=r=>{"

# 自动探测该组件内使用的 JSX 运行时标识 (如 n.jsx 或 s.jsx)
$compBodyLen = [Math]::Min(3000, $jsContent.Length - ($searchStart + $targetFuncMatch.Index))
$compBody = $jsContent.Substring($searchStart + $targetFuncMatch.Index, $compBodyLen)
$jsxMatch = [regex]::Match($compBody, '([A-Za-z0-9_$]+)\.(?:jsx|jsxs)\(')
$jsxId = if ($jsxMatch.Success) { $jsxMatch.Groups[1].Value } else { "n" }

# 清理旧的遗留/错位 Hook (防止多重注入或污染 Font 组件)
if ($jsContent.Contains("OpenChamberOfficeViewer")) {
    $jsContent = [regex]::Replace($jsContent, 'if\(window\.OpenChamberOfficeViewer&&window\.OpenChamberOfficeViewer\.isOfficeFile\(r\.path\|\|r\.name\)\)\{return [^;]+;?\}', '')
}

$hook = "if(window.OpenChamberOfficeViewer&&window.OpenChamberOfficeViewer.isOfficeFile(r.path||r.name)){return $($jsxId).jsx(`"div`",{key:r.path||r.name,className:`"h-full w-full min-h-0`",ref:node=>{if(node&&node.dataset.file!==(r.path||r.name)){node.dataset.file=r.path||r.name;window.OpenChamberOfficeViewer.mount(node,r)}}});}"

$targetIdx = $jsContent.IndexOf($targetPattern)
if ($targetIdx -ne -1) {
    $insertPos = $targetIdx + $targetPattern.Length
    $jsContent = $jsContent.Insert($insertPos, $hook)
    [System.IO.File]::WriteAllText($filesViewJs.FullName, $jsContent, [System.Text.Encoding]::UTF8)
    Write-Host "  ✔ 已精准挂载 Office 渲染拦截器至二进制组件 $compVar (JSX 标识: $jsxId)！" -ForegroundColor Green
} else {
    Write-Host "  ❌ 未能在 $($filesViewJs.Name) 中匹配到 $targetPattern 特征！" -ForegroundColor Red
    exit 1
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " 🎉 OpenChamber 全能 Office 离线预览引擎挂载成功！" -ForegroundColor Green
Write-Host "  - 支持格式: Word (.docx, .doc), Excel (.xlsx, .xls, .csv), PPT (.pptx, .ppt)" -ForegroundColor Cyan
Write-Host "  - 100% 纯本地离线解析，零外网数据泄漏风险" -ForegroundColor Cyan
Write-Host "  - 双轨联动: 内嵌即览 + 一键唤起本地 WPS / Microsoft Office 原厂打开" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
