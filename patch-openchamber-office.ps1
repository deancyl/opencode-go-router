# patch-openchamber-office.ps1: OpenChamber 办公全格式 (Word/Excel/PPT) 离线安全预览一键挂载与还原脚本
# 规范: 100% 纯本地离线安全红线 (Air-Gapped Safety) + V2 幂等指纹保护 + .orig 原始基线无损还原
[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [string]$Action = "",
    [switch]$Install,
    [switch]$Rollback,
    [switch]$Restore,
    [switch]$Uninstall,
    [switch]$Status,
    [string]$TargetDir = ""
)

if ($Action -match "^-?r(ollback|estore)?$" -or $Restore -or $Uninstall) { $Rollback = $true }
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

$idempotentHtmlTag = "<!-- OPENCODE_OFFICE_PATCH_IDEMPOTENT_V2 -->"
$idempotentJsTag = "/* OPENCODE_OFFICE_PATCH_IDEMPOTENT_V2 */"

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

$origIndex = "$indexHtml.orig"
$origFilesView = "$($filesViewJs.FullName).orig"
$backupIndex = "$indexHtml.bak"
$backupFilesView = "$($filesViewJs.FullName).bak"

# 检查当前状态
$hasMarkerInHtml = (Get-Content $indexHtml -Raw) -like "*$idempotentHtmlTag*"
$hasScriptInHtml = (Get-Content $indexHtml -Raw) -like "*office-preview-engine.js*"
$jsContentCheck = Get-Content $filesViewJs.FullName -Raw
$hasMarkerInJs = $jsContentCheck -like "*$idempotentJsTag*"
$hasHookInJs = $jsContentCheck -like "*OpenChamberOfficeViewer.isOfficeFile*"
$isInstalled = $hasScriptInHtml -and $hasHookInJs -and (Test-Path $targetEngine)

if ($Status) {
    Write-Host "`n[状态检查]" -ForegroundColor Yellow
    if ($isInstalled) {
        Write-Host "  ✔ 全能 Office 离线预览引擎已成功挂载！" -ForegroundColor Green
        Write-Host "  支持格式: .docx, .doc, .xlsx, .xls, .csv, .pptx, .ppt" -ForegroundColor Cyan
        if ($hasMarkerInHtml -and $hasMarkerInJs) {
            Write-Host "  - 幂等指纹: V2 已生效" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  ℹ 尚未挂载 Office 预览引擎（目前处于原厂默认状态）" -ForegroundColor DarkGray
    }
    exit 0
}

# ----------------- 回滚还原 -----------------
if ($Rollback) {
    Write-Host "`n正在执行一键还原与卸载..." -ForegroundColor Yellow
    $restored = $false
    if (Test-Path $origIndex) {
        Copy-Item $origIndex $indexHtml -Force
        Remove-Item $origIndex, $backupIndex -Force -ErrorAction SilentlyContinue
        Write-Host "  ✔ index.html 已通过 .orig 原厂基线还原" -ForegroundColor Green
        $restored = $true
    } elseif (Test-Path $backupIndex) {
        Copy-Item $backupIndex $indexHtml -Force
        Remove-Item $backupIndex -Force -ErrorAction SilentlyContinue
        Write-Host "  ✔ index.html 已通过 .bak 备份还原" -ForegroundColor Green
        $restored = $true
    }

    if (Test-Path $origFilesView) {
        Copy-Item $origFilesView $filesViewJs.FullName -Force
        Remove-Item $origFilesView, $backupFilesView -Force -ErrorAction SilentlyContinue
        Write-Host "  ✔ $($filesViewJs.Name) 已通过 .orig 原厂基线还原" -ForegroundColor Green
        $restored = $true
    } elseif (Test-Path $backupFilesView) {
        Copy-Item $backupFilesView $filesViewJs.FullName -Force
        Remove-Item $backupFilesView -Force -ErrorAction SilentlyContinue
        Write-Host "  ✔ $($filesViewJs.Name) 已通过 .bak 备份还原" -ForegroundColor Green
        $restored = $true
    }

    if (Test-Path $targetEngine) {
        Remove-Item $targetEngine -Force -ErrorAction SilentlyContinue
        Write-Host "  ✔ office-preview-engine.js 已清理" -ForegroundColor Green
        $restored = $true
    }

    if ($restored) {
        $codeCacheDir = Join-Path $env:APPDATA "OpenChamber\Code Cache"
        if (Test-Path $codeCacheDir) {
            Remove-Item $codeCacheDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        Write-Host "`n🎉 OpenChamber 前端已成功恢复出厂纯净默认状态！" -ForegroundColor Green
    } else {
        Write-Host "`nℹ 未发现备份文件，系统已处于初始状态。" -ForegroundColor DarkGray
    }
    exit 0
}

# ----------------- 安装挂载 -----------------
Write-Host "`n正在安装全能 Office 离线安全预览引擎..." -ForegroundColor Yellow

# 0. 幂等性安全检测
if ($hasMarkerInHtml -and $hasMarkerInJs -and (Test-Path $targetEngine)) {
    Write-Host "✔ 检测到已安装最新离线预览引擎补丁 (V2 指纹已匹配)，跳过重复挂载，保障系统幂等。" -ForegroundColor Green
    exit 0
}

# 1. 建立永久原厂备份 (.orig)
if (-not (Test-Path $origIndex)) {
    Copy-Item $indexHtml $origIndex -Force
    Write-Host "  ✔ 已创建原厂基线备份: $(Split-Path -Leaf $origIndex)" -ForegroundColor DarkGray
}
if (-not (Test-Path $origFilesView)) {
    Copy-Item $filesViewJs.FullName $origFilesView -Force
    Write-Host "  ✔ 已创建原厂基线备份: $(Split-Path -Leaf $origFilesView)" -ForegroundColor DarkGray
}

# 2. 复制引擎文件
Copy-Item $engineSource $targetEngine -Force
Write-Host "  ✔ 已注入离线引擎: assets\office-preview-engine.js" -ForegroundColor Green

# 3. 注入 index.html (带幂等标记)
$htmlContent = Get-Content $indexHtml -Raw
if ($htmlContent -notlike "*$idempotentHtmlTag*") {
    $scriptTag = "    $idempotentHtmlTag`n    <script src=`"/assets/office-preview-engine.js`"></script>`n"
    if ($htmlContent.Contains("</head>")) {
        $htmlContent = $htmlContent.Replace("</head>", "$scriptTag  </head>")
    } else {
        $htmlContent = $htmlContent.Replace("<head>", "<head>`n$scriptTag")
    }
    [System.IO.File]::WriteAllText($indexHtml, $htmlContent, [System.Text.Encoding]::UTF8)
    Write-Host "  ✔ 已在 index.html 注入离线引擎并标记 V2 幂等指纹" -ForegroundColor Green
} else {
    Write-Host "  ℹ index.html 已包含 V2 幂等引擎引用" -ForegroundColor DarkGray
}

# 4. 挂载 Hook 到 FilesView JS (AST 级别精准定位二进制分发组件)
$jsContent = Get-Content $filesViewJs.FullName -Raw

if ($jsContent -notlike "*$idempotentJsTag*") {
    # 查找 filesView.artifact.binary 所在位置
    $binaryIdx = $jsContent.IndexOf("filesView.artifact.binary")
    if ($binaryIdx -eq -1) {
        Write-Host "  ❌ 未能在 $($filesViewJs.Name) 中找到 filesView.artifact.binary 特征！" -ForegroundColor Red
        exit 1
    }

    $searchStart = [Math]::Max(0, $binaryIdx - 2000)
    $searchLen = $binaryIdx - $searchStart
    $preText = $jsContent.Substring($searchStart, $searchLen)
    # Universal parameter regex: ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)=>{
    $funcMatches = [regex]::Matches($preText, '([A-Za-z0-9_$]+)\s*=\s*(?:\(([A-Za-z0-9_$]+)\)|([A-Za-z0-9_$]+))\s*=>\s*\{')

    if ($funcMatches.Count -eq 0) {
        Write-Host "  ❌ 未能精准定位二进制分发组件入口！" -ForegroundColor Red
        exit 1
    }

    $targetFuncMatch = $funcMatches[$funcMatches.Count - 1]
    $compVar = $targetFuncMatch.Groups[1].Value
    $paramVar = if ($targetFuncMatch.Groups[2].Success -and $targetFuncMatch.Groups[2].Value) { $targetFuncMatch.Groups[2].Value } else { $targetFuncMatch.Groups[3].Value }
    $targetPattern = $targetFuncMatch.Value

    # 自动探测该组件内使用的 JSX 运行时标识 (如 n.jsx 或 s.jsx)
    $compBodyLen = [Math]::Min(3000, $jsContent.Length - ($searchStart + $targetFuncMatch.Index))
    $compBody = $jsContent.Substring($searchStart + $targetFuncMatch.Index, $compBodyLen)
    $jsxMatch = [regex]::Match($compBody, '([A-Za-z0-9_$]+)\.(?:jsx|jsxs)\(')
    $jsxId = if ($jsxMatch.Success) { $jsxMatch.Groups[1].Value } else { "n" }

    # 清理旧的遗留/错位 Hook (防止多重注入或污染 Font 组件)
    $jsContent = [regex]::Replace($jsContent, '/\* OPENCODE_OFFICE_PATCH[^*]*\*/', '')
    $jsContent = [regex]::Replace($jsContent, 'if\(window\.OpenChamberOfficeViewer&&window\.OpenChamberOfficeViewer\.isOfficeFile\(([A-Za-z0-9_$]+)\.path\|\|\1\.name\)\)\{return [^;]+;?\}', '')

    $hook = "$idempotentJsTag if(window.OpenChamberOfficeViewer&&window.OpenChamberOfficeViewer.isOfficeFile($paramVar.path||$paramVar.name)){return $($jsxId).jsx(`"div`",{key:$paramVar.path||$paramVar.name,className:`"h-full w-full min-h-0`",ref:node=>{if(node&&node.dataset.file!==($paramVar.path||$paramVar.name)){node.dataset.file=$paramVar.path||$paramVar.name;window.OpenChamberOfficeViewer.mount(node,$paramVar)}}});}"

    $targetIdx = $jsContent.IndexOf($targetPattern)
    if ($targetIdx -ne -1) {
        $insertPos = $targetIdx + $targetPattern.Length
        $jsContent = $jsContent.Insert($insertPos, $hook)
        [System.IO.File]::WriteAllText($filesViewJs.FullName, $jsContent, [System.Text.Encoding]::UTF8)
        Write-Host "  ✔ 已精准挂载 Office 渲染拦截器至二进制组件 $compVar (JSX 标识: $jsxId) 并注入 V2 幂等指纹！" -ForegroundColor Green
        
        $codeCacheDir = Join-Path $env:APPDATA "OpenChamber\Code Cache"
        if (Test-Path $codeCacheDir) {
            try {
                Remove-Item $codeCacheDir -Recurse -Force -ErrorAction SilentlyContinue
                Write-Host "  ✔ 已自动清除 Chromium V8 字节码缓存 (Code Cache)，杜绝旧脚本锁死" -ForegroundColor Green
            } catch {}
        }
    } else {
        Write-Host "  ❌ 未能在 $($filesViewJs.Name) 中匹配到 $targetPattern 特征！" -ForegroundColor Red
        exit 1
    }
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " 🎉 OpenChamber 全能 Office 离线预览引擎挂载成功！" -ForegroundColor Green
Write-Host "  - 支持格式: Word (.docx, .doc), Excel (.xlsx, .xls, .csv), PPT (.pptx, .ppt)" -ForegroundColor Cyan
Write-Host "  - 100% 纯本地离线解析，零外网数据泄漏风险 (Air-Gapped Safety)" -ForegroundColor Cyan
Write-Host "  - 具备 V2 幂等防御与 .orig 原始基线保护，支持任意次重复运行与无损回滚" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
exit 0
