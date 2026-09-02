<#
  Capture the thread-and-Team screens from the running app.

  Same approach as capture-aiw.ps1 and for the same reason: this session cannot
  deliver clicks or keystrokes to a WebView2 window, so each screen is selected
  by rewriting the harness file and restarting the binary rather than by driving
  the UI. Everything on screen still comes from the real backend — the harness
  chooses which screen is open and, for the thread shots, what gets *said*.
  Nothing about what comes back is scripted.

  Requires a standalone Vite on 5173 (`npx vite`) and a built
  src-tauri/target/debug/devdeck.exe. Vite must NOT be started by
  `npm run tauri dev`, because killing the app would take the server with it.

  Usage: capture-team.ps1 [-Out test-results\node-thread\screenshots]
#>
param(
  [string]$Out = 'test-results\node-thread\screenshots',
  [int]$SettleMs = 20000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$harness = Join-Path $root 'src\lib\devCapture.ts'
$capture = Join-Path $PSScriptRoot 'capture-window.ps1'
$exe = Join-Path $root 'src-tauri\target\debug\devdeck.exe'
$outDir = Join-Path $root $Out
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
if (-not (Test-Path $exe)) { Write-Error "missing $exe"; exit 2 }

function Set-View {
  param(
    [string]$Rail = '', [string]$Page = '', [string]$Project = '', [string]$Feature = '',
    [string]$TeamTab = '', [string]$Goal = '', [string]$Node = '', [string]$Bot = '',
    [string]$BotTab = '', [string]$SettingsTab = '', [string]$Expand = '', [string]$Workspace = '',
    [string[]]$Say = @()
  )
  $sayLines = if ($Say.Count -eq 0) { '' } else { ($Say | ForEach-Object { "  '" + ($_ -replace "'", "\'") + "'," }) -join "`n" }
  $body = @"
// Screenshot harness - dev only, empty in every shipped build.
// Chooses which screen is open at load time; every value on screen still comes
// from the real backend. See scripts/capture-team.ps1.
export const CAPTURE_RAIL: string = '$Rail'
export const CAPTURE_PAGE = '$Page'
export const CAPTURE_PROJECT = '$Project'
export const CAPTURE_FEATURE = '$Feature'
export const CAPTURE_AUTORUN = false
export const CAPTURE_BOT: string = '$Bot'
export const CAPTURE_BOT_TAB: string = '$BotTab'
export const CAPTURE_BOT_MODAL: string = ''
export const CAPTURE_SETTINGS_TAB: string = '$SettingsTab'
export const CAPTURE_SAY: string[] = [
$sayLines
]
export const CAPTURE_TEAM_TAB: string = '$TeamTab'
export const CAPTURE_GOAL: string = '$Goal'
export const CAPTURE_NODE: string = '$Node'
export const CAPTURE_EXPAND: string = '$Expand'
export const CAPTURE_WORKSPACE: string = '$Workspace'
"@
  # Vite reads this file on its watcher thread and holds it briefly.
  for ($i = 0; $i -lt 12; $i++) {
    try {
      Set-Content -Path $harness -Value $body -Encoding utf8
      # Ask the dev server for the module we just changed, so it is transformed
      # before the app asks for it. Without this the first load after a change
      # is a white window for as long as the rebuild takes, and a screenshot of
      # that is a screenshot of nothing.
      try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 'http://localhost:5173/src/lib/devCapture.ts' | Out-Null } catch {}
      try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 'http://localhost:5173/src/App.tsx' | Out-Null } catch {}
      return
    } catch { Start-Sleep -Milliseconds 400 }
  }
  Write-Error "could not write $harness"
}

function Restart-App {
  param([int]$WaitMs)
  Get-Process devdeck -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 900
  Start-Process -FilePath $exe
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    if (Get-Process devdeck -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }) { break }
    Start-Sleep -Milliseconds 700
  }
  Start-Sleep -Milliseconds $WaitMs
}

function Shot {
  param([string]$Name, [int]$Wait = $SettleMs)
  Restart-App -WaitMs $Wait
  $target = Join-Path $outDir "$Name.png"
  # A white "still loading" page samples as 2 distinct colours; a rendered
  # screen is 3 or more. Retry rather than shipping a blank as evidence.
  $line = ''
  for ($try = 1; $try -le 5; $try++) {
    $line = & powershell -ExecutionPolicy Bypass -File $capture -Title DevDeck -Out $target 2>&1
    if ("$line" -match '\((\d+) distinct') { if ([int]$Matches[1] -ge 3) { break } }
    if ($try -lt 5) { Start-Sleep -Milliseconds 9000 }
  }
  Write-Output "$Name : $line"
}

# ---------------------------------------------------------------------------
# The shots
# ---------------------------------------------------------------------------

Set-View -Rail 'team' -TeamTab 'goals' -Goal '4:offline-sync'
Shot '01-team-goals'

Set-View -Rail 'team' -TeamTab 'goals' -Goal '12:node-as-conversation'
Shot '02-two-bots-in-a-room'

Set-View -Rail 'team' -TeamTab 'features'
Shot '03-team-features'

Set-View -Rail 'team' -TeamTab 'work'
Shot '04-team-work'

Set-View -Rail 'team' -TeamTab 'bots'
Shot '05-team-bots'

Set-View -Rail 'projects' -Node '12' -Workspace '1'
Shot '06-node-thread'

Set-View -Rail 'projects' -Node '1' -Workspace '1'
Shot '07-parent-headlines'

Set-View -Rail 'projects' -Expand '1,2' -Workspace '1' -Node '2'
Shot '08-spaces-tree'

Set-View -Rail 'inbox'
Shot '09-inbox'

Set-View -Rail 'home'
Shot '10-home'

Set-View -Rail 'settings' -SettingsTab 'routines'
Shot '11-settings-routines'

Set-View -Rail 'settings' -SettingsTab 'assistant'
Shot '12-settings-assistant'

Set-View
Write-Output '--- done ---'
