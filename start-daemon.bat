@echo off
cd /d "%~dp0"
node "%~dp0server.js" >> "%~dp0router.log" 2>&1
