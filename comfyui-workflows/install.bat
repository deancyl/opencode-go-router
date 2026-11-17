@echo off
title ComfyUI Dual-Track Agent Edition Master Installer
echo ==========================================================
echo   ComfyUI Dual-Track Agent Edition - Master Installer
echo ==========================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Installation exited with code %ERRORLEVEL%.
) else (
    echo [SUCCESS] All components configured successfully!
)
pause
