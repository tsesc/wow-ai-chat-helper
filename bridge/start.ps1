# Adapted from wow-ai (MIT) by chelinho139: bridge/start.ps1
# Runs the bridge in the current terminal (auto-restarts on crash). Ctrl+C stops it cleanly.
# If PowerShell refuses to run scripts:  powershell -ExecutionPolicy Bypass -File .\start.ps1
# start-window.cmd is the double-click version that opens its own window.
#
# Before starting, make sure the AI CLI named by "agent" in config.json (claude by default,
# or codex) is installed and logged in: the bridge talks to the model through that local
# CLI, so the user's own subscription / login is the only "credential".
$local = Join-Path $env:USERPROFILE '.local\bin'
if ((Test-Path $local) -and ($env:Path -notlike "*$local*")) { $env:Path = "$local;$env:Path" }
$npmBin = Join-Path $env:APPDATA 'npm'
if ((Test-Path $npmBin) -and ($env:Path -notlike "*$npmBin*")) { $env:Path = "$env:Path;$npmBin" }

# Native commands run with the default $ErrorActionPreference ('Continue', -NoProfile): a
# stderr line is not an exception here, and $LASTEXITCODE says how they ended.
$ErrorActionPreference = 'Continue'

$agent = 'claude'
$c = $null
$cfgFile = Join-Path $PSScriptRoot 'config.json'
if (Test-Path $cfgFile) {
  try { $c = Get-Content $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json; if ($c.agent) { $agent = ([string]$c.agent).Trim().ToLower() } } catch { }
}

# The executable: the path set in config.json (claudePath / codexPath) when it exists, else
# the first of $names on PATH (.exe / npm .cmd; never an npm .ps1 shim, which the execution
# policy may block). -> full path or $null.
function Find-Cli($configured, $names) {
  if ($configured -and (Test-Path -LiteralPath $configured -PathType Leaf)) { return $configured }
  foreach ($n in $names) { $cmd = Get-Command $n -ErrorAction SilentlyContinue | Select-Object -First 1; if ($cmd) { return $cmd.Source } }
  return $null
}

if ($agent -eq 'codex') {
  $codex = Find-Cli $(if ($c) { [string]$c.codexPath }) @('codex.exe', 'codex.cmd')
  if (-not $codex) {
    Write-Host 'Codex is not installed. Install it with:  npm install -g @openai/codex' -ForegroundColor Red
    Write-Host 'then run `codex login` once, and start the bridge again.'
    if ($c -and $c.codexPath) { Write-Host "(codexPath in config.json, $($c.codexPath), does not exist either.)" }
    exit 1
  }
  # `codex login status` exits 0 when logged in (it prints on stderr, so discard all streams).
  & $codex login status *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Not logged in to Codex yet. A browser window will open; sign in with your ChatGPT account.' -ForegroundColor Yellow
    & $codex login
    & $codex login status *> $null
    if ($LASTEXITCODE -ne 0) { Write-Host 'Login did not complete; run `codex login` and try again.' -ForegroundColor Red; exit 1 }
  }
} elseif ($agent -eq 'claude') {
  $claude = Find-Cli $(if ($c) { [string]$c.claudePath }) @('claude.exe', 'claude.cmd', 'claude')
  if (-not $claude) {
    Write-Host 'Claude Code is not installed. Install it with:  irm https://claude.ai/install.ps1 | iex' -ForegroundColor Red
    Write-Host 'then run `claude auth login` once, and start the bridge again.'
    if ($c -and $c.claudePath) { Write-Host "(claudePath in config.json, $($c.claudePath), does not exist either.)" }
    exit 1
  }
  $loggedIn = $false
  try { $st = (& $claude auth status 2>$null) | ConvertFrom-Json; $loggedIn = [bool]$st.loggedIn } catch { }
  if (-not $loggedIn) {
    Write-Host 'Not logged in to Claude yet. A browser window will open; sign in with the account that has your subscription.' -ForegroundColor Yellow
    & $claude auth login
    try { $st = (& $claude auth status 2>$null) | ConvertFrom-Json; $loggedIn = [bool]$st.loggedIn } catch { }
    if (-not $loggedIn) { Write-Host 'Login did not complete; run `claude auth login` and try again.' -ForegroundColor Red; exit 1 }
  }
}
# Any other "agent" value: no check here; the bridge stops with the list of valid names.
& node (Join-Path $PSScriptRoot 'supervisor.js')
