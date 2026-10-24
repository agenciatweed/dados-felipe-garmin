@echo off
powershell.exe -NoProfile -File "%~dp0abrir-dashboard.ps1"
if errorlevel 1 pause
