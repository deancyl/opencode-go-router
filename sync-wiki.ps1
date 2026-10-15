# OpenCode Go Router - One-Click Sync Docs to GitHub Wiki (PowerShell)
param(
    [string]$RepoUrl = "https://github.com/deancyl/opencode-go-router.wiki.git",
    [string]$DocsDir = "$PSScriptRoot\docs"
)

$ErrorActionPreference = "Stop"
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  OpenCode Go Router - GitHub Wiki 一键同步工具     " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

if (-not (Test-Path $DocsDir)) {
    Write-Error "文档目录不存在: $DocsDir"
    exit 1
}

$TempWikiDir = Join-Path $env:TEMP "opencode-go-router-wiki-sync"
if (Test-Path $TempWikiDir) {
    Remove-Item -Recurse -Force $TempWikiDir
}

Write-Host "正在拉取 GitHub Wiki 仓库..." -ForegroundColor Yellow
try {
    git clone $RepoUrl $TempWikiDir
} catch {
    Write-Host "⚠️ 克隆 Wiki 仓库失败。" -ForegroundColor Red
    Write-Host "提示: GitHub Wiki 仓库必须在 GitHub Web 界面先创建第一页后才会初始化。" -ForegroundColor Yellow
    Write-Host "请前往: https://github.com/deancyl/opencode-go-router/wiki 点击 'Create the first page'，然后重试此脚本。" -ForegroundColor Cyan
    exit 1
}

Write-Host "正在同步 docs/ 文档至 Wiki 仓库..." -ForegroundColor Yellow
Copy-Item -Path "$DocsDir\*" -Destination $TempWikiDir -Recurse -Force

Push-Location $TempWikiDir
try {
    git config user.name "deancyl"
    git config user.email "deancyl@users.noreply.github.com"
    git add -A
    $status = git status --porcelain
    if ($status) {
        git commit -m "docs(wiki): sync latest docs from repository"
        git push origin master
        Write-Host "✔ GitHub Wiki 同步成功！" -ForegroundColor Green
    } else {
        Write-Host "✔ GitHub Wiki 内容已是最新，无需更新。" -ForegroundColor Green
    }
} finally {
    Pop-Location
    Remove-Item -Recurse -Force $TempWikiDir
}
