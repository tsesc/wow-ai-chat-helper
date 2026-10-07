<#
WoW Chat Helper - one-line Windows installer.

    irm https://raw.githubusercontent.com/tsesc/wow-ai-chat-helper/main/install.ps1 | iex

What it does (each step is skipped when already done):
  1. Node.js 22+        (winget install OpenJS.NodeJS.LTS)
  2. Claude Code        (irm https://claude.ai/install.ps1 | iex), then `claude auth login`
                        if you are not logged in yet - this is where your Claude subscription
                        (Pro / Max / Team) gets connected. No API key is needed.
  3. Downloads this project as a zip (no Git needed) into %LOCALAPPDATA%\WoWChatHelper\app
  4. node setup.js      (copies the addon into WoW, builds the slot addons, writes bridge\config.json)
  5. A desktop shortcut "WoW Chat Helper" that starts the bridge
  6. Optionally starts the bridge automatically when you log in to Windows

Re-running it updates the app and keeps your bridge\config.json.

Options (when running the file directly instead of the one-liner):
  .\install.ps1 -WowPath "G:\battle.net\World of Warcraft\_classic_beta_"
  .\install.ps1 -Ref main -InstallDir "D:\WoWChatHelper" -NoShortcut -AutoStart
  .\install.ps1 -Zip .\wow-ai-chat-helper-main.zip    # install from a local zip (testing)
  .\install.ps1 -NonInteractive                       # never prompt; fail instead
#>
[CmdletBinding()]
param(
  [string]$Ref = 'main',
  [string]$Repo = 'tsesc/wow-ai-chat-helper',
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'WoWChatHelper'),
  [string]$WowPath = '',
  [string]$Zip = '',
  [switch]$NoShortcut,
  [switch]$AutoStart,
  [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Step($n, $msg) { Write-Host ""; Write-Host "[$n/6] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  OK   $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "       $msg" }
function Fail($msg) { Write-Host ""; Write-Host "  FAIL $msg" -ForegroundColor Red; exit 1 }
function Ask($question, $default) {
  if ($NonInteractive) { return $default }
  $a = Read-Host "$question"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return $a
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  # Claude Code installs to ~\.local\bin and adds it to the user PATH; make sure it is visible now.
  $local = Join-Path $env:USERPROFILE '.local\bin'
  if ((Test-Path $local) -and ($env:Path -notlike "*$local*")) { $env:Path = "$local;$env:Path" }
}
function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') { Fail 'This installer is for the Windows PC that runs World of Warcraft.' }

Write-Host "WoW Chat Helper installer  ($Repo @ $Ref)" -ForegroundColor Yellow
Write-Host "Install folder: $InstallDir"

# ---------------------------------------------------------------- 1. Node.js
Step 1 'Node.js 22 or newer'
Refresh-Path
$nodeOk = $false
if (Have node) {
  $v = (& node --version) -replace '^v', ''
  $nodeOk = ([version]$v) -ge [version]'22.2'
  if ($nodeOk) { Ok "node v$v" } else { Info "node v$v is too old (need 22.2+)" }
}
if (-not $nodeOk) {
  if (-not (Have winget)) { Fail 'Node.js is missing and winget is not available. Install Node.js 22+ from https://nodejs.org and run this again.' }
  Info 'installing Node.js LTS with winget (this can take a minute)...'
  & winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
  Refresh-Path
  if (-not (Have node)) { Fail 'Node.js was installed but is not on PATH yet. Close this window, open a new PowerShell and run the installer again.' }
  Ok "node $(& node --version)"
}

# ---------------------------------------------------------------- 2. Claude Code + login
Step 2 'Claude Code (the bridge talks to Claude through it; your Claude subscription is used)'
Refresh-Path
if (-not (Have claude)) {
  Info 'installing Claude Code...'
  Invoke-Expression (Invoke-RestMethod 'https://claude.ai/install.ps1')
  Refresh-Path
  if (-not (Have claude)) { Fail 'Claude Code was installed but `claude` is not on PATH yet. Close this window, open a new PowerShell and run the installer again.' }
}
Ok "claude $(& claude --version 2>$null)"
$loggedIn = $false
try { $st = (& claude auth status 2>$null) | ConvertFrom-Json; $loggedIn = [bool]$st.loggedIn } catch { $loggedIn = $false }
if ($loggedIn) {
  Ok "logged in as $($st.email) ($($st.subscriptionType))"
} else {
  if ($NonInteractive) { Fail 'Not logged in to Claude. Run `claude auth login` once, then run the installer again.' }
  Info 'Not logged in yet. A browser window will open: sign in with the Claude account that has your subscription.'
  & claude auth login
  try { $st = (& claude auth status 2>$null) | ConvertFrom-Json; $loggedIn = [bool]$st.loggedIn } catch { $loggedIn = $false }
  if (-not $loggedIn) { Fail 'Login did not complete. Run `claude auth login`, then run the installer again.' }
  Ok "logged in as $($st.email) ($($st.subscriptionType))"
}

# ---------------------------------------------------------------- 3. Download / update the app
Step 3 'Downloading WoW Chat Helper'
$app = Join-Path $InstallDir 'app'
$tmp = Join-Path $env:TEMP ("wch-install-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $InstallDir, $tmp | Out-Null
$zipFile = Join-Path $tmp 'src.zip'
if ($Zip) {
  Copy-Item $Zip $zipFile
  Info "using local zip $Zip"
} else {
  $url = "https://github.com/$Repo/archive/refs/heads/$Ref.zip"
  Info "GET $url"
  Invoke-WebRequest -Uri $url -OutFile $zipFile -UseBasicParsing
}
Expand-Archive -Path $zipFile -DestinationPath $tmp -Force
$src = Get-ChildItem $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'setup.js') } | Select-Object -First 1
if (-not $src) { Fail 'The downloaded zip does not contain setup.js. Wrong -Ref or -Repo?' }
# Keep the user's bridge settings across updates.
$keep = @('bridge\config.json', 'bridge\state.json')
$saved = @{}
foreach ($k in $keep) { $p = Join-Path $app $k; if (Test-Path $p) { $saved[$k] = Get-Content $p -Raw -Encoding UTF8 } }
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
Move-Item $src.FullName $app
foreach ($k in $saved.Keys) { $p = Join-Path $app $k; New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null; [IO.File]::WriteAllText($p, $saved[$k]) }
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
$ver = (Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version
$kept = if ($saved.Count) { " (kept $($saved.Keys -join ', '))" } else { '' }
Ok "version $ver in $app$kept"

# ---------------------------------------------------------------- 4. setup.js (addon into WoW)
Step 4 'Installing the addon into World of Warcraft'
Push-Location $app
try {
  $setupArgs = @()
  if ($WowPath) { $setupArgs += @('--wow', $WowPath) }
  $out = & node setup.js @setupArgs 2>&1
  $rc = $LASTEXITCODE
  if ($rc -ne 0 -and -not $WowPath) {
    # Auto-detect failed: look on every drive for a Forever / classic-beta client.
    Info 'WoW was not found in the usual places, scanning drives...'
    $found = @()
    foreach ($d in (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -ne $null })) {
      foreach ($base in @("$($d.Root)World of Warcraft", "$($d.Root)battle.net\World of Warcraft", "$($d.Root)Games\World of Warcraft", "$($d.Root)Program Files (x86)\World of Warcraft", "$($d.Root)Program Files\World of Warcraft")) {
        foreach ($f in @('_forever_', '_classic_beta_')) {
          $c = Join-Path $base $f
          if ((Test-Path (Join-Path $c 'Interface')) -and (Get-ChildItem $c -Filter 'Wow*.exe' -ErrorAction SilentlyContinue)) { $found += $c }
        }
      }
    }
    $found = $found | Select-Object -Unique
    if ($found.Count -eq 1) { $WowPath = $found[0]; Info "found $WowPath" }
    elseif ($found.Count -gt 1) {
      $i = 0; foreach ($f in $found) { $i++; Info "  [$i] $f" }
      $pick = Ask "Several clients found. Which one? [1-$($found.Count)] (default 1)" '1'
      $WowPath = $found[[int]$pick - 1]
    } else {
      $WowPath = Ask 'WoW client folder (the one that contains Wow*.exe and Interface\), e.g. G:\battle.net\World of Warcraft\_classic_beta_' ''
      if (-not $WowPath) { Fail 'No WoW client folder. Run again with -WowPath "<folder>".' }
    }
    $out = & node setup.js --wow $WowPath 2>&1
    $rc = $LASTEXITCODE
  }
  $out | ForEach-Object { Info $_ }
  if ($rc -ne 0) { Fail 'setup.js failed (see above).' }
} finally { Pop-Location }
Ok 'addon, glossaries and slot pool installed'

# ---------------------------------------------------------------- 5. Desktop shortcut
Step 5 'Desktop shortcut'
$launcher = Join-Path $app 'bridge\start-window.cmd'
if ($NoShortcut) { Info 'skipped (-NoShortcut)' } else {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'WoW Chat Helper.lnk'
  $ws = New-Object -ComObject WScript.Shell
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = $launcher
  $s.WorkingDirectory = Join-Path $app 'bridge'
  $s.Description = 'Start the WoW Chat Helper bridge (leave its window open while you play)'
  $nodeExe = (Get-Command node).Source
  $s.IconLocation = if (Test-Path $nodeExe) { "$nodeExe,0" } else { '%SystemRoot%\System32\shell32.dll,25' }
  $s.Save()
  Ok $lnk
}

# ---------------------------------------------------------------- 6. Auto-start at logon (optional)
Step 6 'Start the bridge automatically when you log in to Windows (optional)'
$taskName = 'WoW Chat Helper bridge'
$want = $AutoStart
if (-not $AutoStart) {
  $a = Ask 'Start the bridge automatically at logon? [y/N]' 'N'
  $want = ($a -match '^(y|yes)$')
}
if ($want) {
  $action = New-ScheduledTaskAction -Execute $launcher -WorkingDirectory (Join-Path $app 'bridge')
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Ok "scheduled task '$taskName' (remove with: Unregister-ScheduledTask -TaskName '$taskName')"
} else {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Info "existing task '$taskName' left as is" } else { Info 'not enabled; start it from the desktop shortcut' }
}

Write-Host ""
Write-Host 'Done. Next:' -ForegroundColor Yellow
Write-Host '  1. Fully quit and relaunch World of Warcraft (it only discovers new addon files at launch).'
Write-Host '  2. On the character screen open AddOns and tick "WoW Chat Helper" (leave the slot/Glossary entries alone).'
Write-Host '  3. Double-click "WoW Chat Helper" on the desktop and leave that window open while you play.'
Write-Host '  4. In game: /wch opens the status window (the light turns green once the bridge is connected);'
Write-Host '     /wtr <your text> translates it into English reply candidates.'
Write-Host "  Update later: run this installer again. Uninstall: delete $InstallDir, the desktop shortcut, and WoWChatHelper* in Interface\AddOns."
