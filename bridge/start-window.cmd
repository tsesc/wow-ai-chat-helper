@echo off
rem Adapted from wow-ai (MIT) by chelinho139: bridge/start-window.cmd
rem Opens the bridge in its own console window (a .cmd running inline would make Ctrl+C
rem ask "Terminate batch job?"). Goes through start.ps1 so the Claude login check runs first.
cd /d "%~dp0"
start "WoW Chat Helper bridge" powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0start.ps1"
