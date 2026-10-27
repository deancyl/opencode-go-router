@echo off
cd /d "%~dp0"
set "NODE_EXE=node"
if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
"%NODE_EXE%" "%~dp0server.js" >> "%~dp0router.log" 2>&1
