<#
.SYNOPSIS
  ComfyUI Dual-Track Agent Edition - Master Turnkey Installer (All-In-One)
.DESCRIPTION
  One single script to fully install, configure, patch, and deploy the entire
  ComfyUI Agent Edition on any local machine (Fresh Install or Upgrade Existing).
.PARAMETER TargetDir
  Target ComfyUI root directory. If omitted, auto-detects existing ComfyUI.
.PARAMETER SkipModels
  Skip downloading base models and LoRAs.
.PARAMETER NonInteractive
  Run completely non-interactively with sensible defaults.
#>

param (
    [string]$TargetDir = "",
    [switch]$SkipModels,
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  🎨 ComfyUI Dual-Track Agent Edition - Master Installer" -ForegroundColor Cyan
Write-Host "  Repository: https://github.com/deancyl/comfyui-agent-workflows" -ForegroundColor Gray
Write-Host "  Repo Root: $RepoRoot" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

# -------------------------------------------------------------------------
# Step 1: Detect or Initialize Target ComfyUI Directory
# -------------------------------------------------------------------------
Write-Host "`n[Step 1/6] Resolving ComfyUI Target Installation..." -ForegroundColor Yellow

if (-not $TargetDir) {
    $candidates = @(
        "C:\Users\$env:USERNAME\ComfyUI-Zluda",
        "G:\ComfyUI\ComfyUI-aki\ComfyUI-aki-v3.2\ComfyUI",
        "C:\ComfyUI",
        "D:\ComfyUI",
        (Join-Path (Split-Path -Parent $RepoRoot) "ComfyUI")
    )
    foreach ($cand in $candidates) {
        if (Test-Path (Join-Path $cand "main.py")) {
            $TargetDir = (Resolve-Path $cand).Path
            Write-Host "  -> Auto-detected existing ComfyUI at: $TargetDir" -ForegroundColor Green
            break
        }
    }
}

if (-not $TargetDir) {
    if ($NonInteractive) {
        $TargetDir = "C:\Users\$env:USERNAME\ComfyUI-Zluda"
    } else {
        Write-Host "No existing ComfyUI installation detected." -ForegroundColor Yellow
        Write-Host "Please specify path to an existing ComfyUI or a new folder to install fresh:" -ForegroundColor Yellow
        $TargetDir = Read-Host "Target Directory (default: C:\Users\$env:USERNAME\ComfyUI-Zluda)"
        if (-not $TargetDir) {
            $TargetDir = "C:\Users\$env:USERNAME\ComfyUI-Zluda"
        }
    }
}

# If folder doesn't have main.py, offer fresh clone
if (-not (Test-Path (Join-Path $TargetDir "main.py"))) {
    Write-Host "`n[Notice] Target '$TargetDir' does not have ComfyUI source code." -ForegroundColor Yellow
    Write-Host "Cloning official ComfyUI repository to $TargetDir..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    git clone https://github.com/comfyanonymous/ComfyUI.git $TargetDir
    if (-not (Test-Path (Join-Path $TargetDir "main.py"))) {
        Write-Error "Failed to clone ComfyUI repository. Please check your network/git configuration."
        exit 1
    }
    Write-Host "  -> ComfyUI core source cloned successfully!" -ForegroundColor Green
}

# Setup Python venv if missing
$venvPython = Join-Path $TargetDir "venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "Creating Python virtual environment in $TargetDir\venv..." -ForegroundColor Cyan
    python -m venv (Join-Path $TargetDir "venv")
    if (Test-Path $venvPython) {
        Write-Host "  -> Virtual environment created. Installing PyTorch & dependencies..." -ForegroundColor Cyan
        & $venvPython -m pip install --upgrade pip
        & $venvPython -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
        & $venvPython -m pip install -r (Join-Path $TargetDir "requirements.txt")
    } else {
        $venvPython = "python"
    }
}

Write-Host "  [OK] Target Directory Verified: $TargetDir" -ForegroundColor Green

# -------------------------------------------------------------------------
# Step 2: Deploy 17 Industrial Workflows
# -------------------------------------------------------------------------
Write-Host "`n[Step 2/6] Deploying 17 Industrial Dual-Track Workflows..." -ForegroundColor Yellow
$wfDest = Join-Path $TargetDir "user\default\workflows"
New-Item -ItemType Directory -Path $wfDest -Force | Out-Null
Copy-Item -Path (Join-Path $RepoRoot "workflows\*.json") -Destination $wfDest -Force
$count = (Get-ChildItem -Path $wfDest -Filter "*.json").Count
Write-Host "  [OK] Deployed $count standardized workflows to $wfDest" -ForegroundColor Green

# -------------------------------------------------------------------------
# Step 3: Deploy Custom Nodes
# -------------------------------------------------------------------------
Write-Host "`n[Step 3/6] Installing Custom Nodes..." -ForegroundColor Yellow
$customNodesTarget = Join-Path $TargetDir "custom_nodes"
New-Item -ItemType Directory -Path $customNodesTarget -Force | Out-Null

$srcNodes = Join-Path $RepoRoot "custom_nodes\ComfyUI-NSFW-Interrogator"
$dstNodes = Join-Path $customNodesTarget "ComfyUI-NSFW-Interrogator"
if (Test-Path $srcNodes) {
    Copy-Item -Path $srcNodes -Destination $dstNodes -Recurse -Force
    Write-Host "  [OK] Installed ComfyUI-NSFW-Interrogator (with Gacha Randomizer)" -ForegroundColor Green
}

# -------------------------------------------------------------------------
# Step 4: AMD APU / ZLUDA Hardware Acceleration & Tensile Assets
# -------------------------------------------------------------------------
Write-Host "`n[Step 4/6] Configuring Hardware Acceleration (AMD ZLUDA / NVIDIA CUDA)..." -ForegroundColor Yellow
$zludaExe = Join-Path $TargetDir "zluda\zluda.exe"
$gfxLibs = Join-Path $TargetDir "gfx1103_libs"

# Detect if system has AMD graphics
$hasAmd = $false
try {
    $gpu = Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name
    if ($gpu -match "AMD|Radeon|780M|gfx") {
        $hasAmd = $true
        Write-Host "  -> Detected AMD GPU: $gpu" -ForegroundColor Cyan
    }
} catch {}

if ($hasAmd -and ((-not (Test-Path $zludaExe)) -or (-not (Test-Path $gfxLibs)))) {
    Write-Host "  -> Downloading pre-compiled AMD 780M ZLUDA + Tensile release assets from GitHub..." -ForegroundColor Cyan
    $zipUrl = "https://github.com/deancyl/comfyui-agent-workflows/releases/download/v1.0.0/zluda-amd780m-gfx1103-rocm57.zip"
    $zipFile = Join-Path $TargetDir "zluda-amd780m-gfx1103-rocm57.zip"
    try {
        curl.exe -C - -L --ssl-no-revoke "$zipUrl" -o "$zipFile"
        if (Test-Path $zipFile) {
            Write-Host "  -> Extracting ZLUDA runtime..." -ForegroundColor Cyan
            Expand-Archive -Path $zipFile -DestinationPath $TargetDir -Force
            Remove-Item $zipFile -Force
            Write-Host "  [OK] AMD ZLUDA & Tensile libraries installed successfully!" -ForegroundColor Green
        }
    } catch {
        Write-Host "  [Warning] Could not auto-download ZLUDA release zip. Continuing..." -ForegroundColor Yellow
    }
}

# Apply LayerNorm patch
$lnPatch = Join-Path $RepoRoot "patches\apply_zluda_ln_patch.py"
if (Test-Path $lnPatch) {
    & $venvPython $lnPatch $TargetDir
}
# Apply utils safe_globals patch
$utilsPatch = Join-Path $RepoRoot "patches\patch_utils.py"
if (Test-Path $utilsPatch) {
    & $venvPython $utilsPatch $TargetDir
}

# -------------------------------------------------------------------------
# Step 5: Provision Launchers & Desktop Zero-Console Daemon
# -------------------------------------------------------------------------
Write-Host "`n[Step 5/6] Creating Desktop Silent Launchers & Scripts..." -ForegroundColor Yellow
Copy-Item -Path (Join-Path $RepoRoot "scripts\start_zluda_amd.ps1") -Destination (Join-Path $TargetDir "start_zluda_amd.ps1") -Force
Copy-Item -Path (Join-Path $RepoRoot "scripts\start_nvidia.bat") -Destination (Join-Path $TargetDir "start_nvidia.bat") -Force

# Generate launch_gui.vbs
$vbsPath = Join-Path $TargetDir "launch_gui.vbs"
$vbsCode = @"
Set WshShell = CreateObject("WScript.Shell")
' 1. Start server silently in background
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""$TargetDir\start_zluda_amd.ps1""", 0, False
WScript.Sleep 2500
' 2. Open standalone Edge Application window (zero browser chrome)
WshShell.Run "msedge.exe --app=http://127.0.0.1:8284", 1, False
"@
Set-Content -Path $vbsPath -Value $vbsCode -Encoding UTF8
Write-Host "  [OK] Desktop silent launcher created: $vbsPath" -ForegroundColor Green

# -------------------------------------------------------------------------
# Step 6: Model & LoRA Synchronization
# -------------------------------------------------------------------------
Write-Host "`n[Step 6/6] Model & LoRA Asset Provisioning..." -ForegroundColor Yellow
if (-not $SkipModels) {
    $dlScript = Join-Path $RepoRoot "scripts\download_loras.py"
    if (Test-Path $dlScript) {
        Write-Host "  -> Checking and synchronizing 19 curated LoRA models..." -ForegroundColor Cyan
        & $venvPython $dlScript
    }
} else {
    Write-Host "  -> Skipping model download as requested." -ForegroundColor Gray
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  🎉 Turnkey Installation & Deployment Complete!" -ForegroundColor Green
Write-Host "  - ComfyUI Target: $TargetDir" -ForegroundColor Green
Write-Host "  - 17 Standardized Dual-Track Workflows Installed" -ForegroundColor Green
Write-Host "  - Desktop App Launcher: $vbsPath" -ForegroundColor Green
Write-Host "  - Agent SDK & Manifest: Ready for programmatic generation" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
