@echo off
rem Adapted from wow-ai (MIT) by chelinho139: bridge/start-window.cmd
rem Opens the bridge in its own console window (a .cmd running inline would make Ctrl+C
rem ask "Terminate batch job?").
cd /d "%~dp0"
start "WoW Chat Helper bridge" cmd /k node supervisor.js
