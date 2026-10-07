# Adapted from wow-ai (MIT) by chelinho139: bridge/start.ps1
# Runs the bridge in the current terminal (auto-restarts on crash). Ctrl+C stops it cleanly.
# If PowerShell refuses to run scripts:  powershell -ExecutionPolicy Bypass -File .\start.ps1
# start-window.cmd is the double-click version that opens its own window.
#
# Before starting, make sure Claude Code is installed and logged in: the bridge talks to Claude
# through the local `claude` CLI, so the user's Claude subscription is the only "credential".
$local = Join-Path $env:USERPROFILE '.local\bin'
if ((Test-Path $local) -and ($env:Path -notlike "*$local*")) { $env:Path = "$local;$env:Path" }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host 'Claude Code is not installed. Install it with:  irm https://claude.ai/install.ps1 | iex' -ForegroundColor Red
  Write-Host 'then run `claude auth login` once, and start the bridge again.'
  exit 1
}
$loggedIn = $false
try { $st = (& claude auth status 2>$null) | ConvertFrom-Json; $loggedIn = [bool]$st.loggedIn } catch { }
if (-not $loggedIn) {
  Write-Host 'Not logged in to Claude yet. A browser window will open; sign in with the account that has your subscription.' -ForegroundColor Yellow
  & claude auth login
  try { $st = (& claude auth status 2>$null) | ConvertFrom-Json; $loggedIn = [bool]$st.loggedIn } catch { }
  if (-not $loggedIn) { Write-Host 'Login did not complete; run `claude auth login` and try again.' -ForegroundColor Red; exit 1 }
}
& node (Join-Path $PSScriptRoot 'supervisor.js')
