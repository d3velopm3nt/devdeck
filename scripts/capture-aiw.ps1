<#
  Capture the AI Workspace screens from the running app.

  This session cannot deliver clicks to a WebView2 window (no interactive
  desktop; posted input is ignored), so instead of driving the UI each screen
  is selected by a small harness file and the app binary is restarted to pick
  it up. Restarting rather than relying on HMR is deliberate: Vite stops hot
  updates at App.tsx's component boundary, so the zustand stores are never
  recreated and a value read at construction time keeps its first value.

  Everything on screen still comes from the real backend — the harness chooses
  which screen is open and nothing else.

  Requires a standalone Vite on 5173 (`npx vite`) and a built
  src-tauri/target/debug/devdeck.exe. Vite must NOT be started via
  `npm run tauri dev`, because killing the app would take the dev server with it.
#>
param(
  [string]$Out = 'test-results\ai-workspace\screenshots',
  [int]$SettleMs = 9000
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
  param([string]$Page, [string]$Project, [string]$Feature, [bool]$Autorun)
  $body = @"
// Screenshot harness - TEMPORARY, removed after the test report is captured.
// Chooses which screen is open at load time; every value on screen still comes
// from the real backend.
export const CAPTURE_RAIL = 'aiworkspace'
export const CAPTURE_PAGE = '$Page'
export const CAPTURE_PROJECT = '$Project'
export const CAPTURE_FEATURE = '$Feature'
export const CAPTURE_AUTORUN = $($Autorun.ToString().ToLower())
"@
  # Vite reads this file on its watcher thread and holds it briefly.
  for ($i = 0; $i -lt 12; $i++) {
    try { Set-Content -Path $harness -Value $body -Encoding utf8; return } catch { Start-Sleep -Milliseconds 400 }
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

$shots = @(
  @{ page = 'overview';   feature = '';                        name = '01-overview';          autorun = $true  },
  @{ page = 'features';   feature = '';                        name = '02-features';          autorun = $true },
  @{ page = 'feature';    feature = 'offline-synchronisation'; name = '03-feature-detail';    autorun = $true },
  @{ page = 'context';    feature = 'offline-synchronisation'; name = '04-context-inspector'; autorun = $true },
  @{ page = 'conflicts';  feature = '';                        name = '05-conflict-center';   autorun = $true },
  @{ page = 'agents';     feature = '';                        name = '06-agents';            autorun = $true },
  @{ page = 'activity';   feature = '';                        name = '07-activity';          autorun = $true },
  @{ page = 'decisions';  feature = '';                        name = '08-decisions';         autorun = $true },
  @{ page = 'git';        feature = '';                        name = '09-git-history';       autorun = $true },
  @{ page = 'tests';      feature = '';                        name = '10-test-report';       autorun = $true },
  @{ page = 'tools';      feature = '';                        name = '11-tools';             autorun = $true },
  @{ page = 'knowledge';  feature = '';                        name = '12-knowledge';         autorun = $true }
)

foreach ($s in $shots) {
  Set-View -Page $s.page -Project 'tyrex' -Feature $s.feature -Autorun $s.autorun
  Start-Sleep -Milliseconds 800
  # The demo rebuilds the whole workspace, so that shot needs longer.
  $wait = $SettleMs
  Restart-App -WaitMs $wait
  $target = Join-Path $outDir "$($s.name).png"

  # A white "still loading" page samples as 2 distinct colours; a rendered
  # screen is 3+. Retry rather than shipping a blank as evidence.
  $line = ''
  for ($try = 1; $try -le 3; $try++) {
    $line = & powershell -ExecutionPolicy Bypass -File $capture -Title DevDeck -Out $target 2>&1
    if ("$line" -match '\((\d+) distinct') {
      if ([int]$Matches[1] -ge 3) { break }
    }
    if ($try -lt 3) {
      Write-Output "  $($s.name): looked blank, retrying ($try)"
      Start-Sleep -Milliseconds 6000
    }
  }
  Write-Output "$($s.name): $line"
}

Set-View -Page '' -Project '' -Feature '' -Autorun $false
Write-Output '--- done ---'
