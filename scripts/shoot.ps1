<#
  Capture the app window, but only once it has actually painted.

  `devdeck.exe` appears in the task list long before WebView2 has drawn
  anything, and a capture in that gap returns a pure white frame that is
  indistinguishable from a React crash. That has now cost two cold restarts
  and most of an hour, twice, chasing a bug that was never there -- so the wait
  belongs in the harness rather than in whoever is driving it.

  The readiness signal is the sample-colour count `capture-window.ps1` already
  prints. An unpainted frame is one flat colour plus the window border, so it
  reports 2. Anything drawn reports more. That is a weak signal for "is this
  screen CORRECT" -- it cannot tell a good screen from a broken one, and the
  project notes are emphatic that you must open the image -- but it is a sound
  signal for "has this screen been drawn at all", which is the only question
  being asked here.

  Kept deliberately ASCII-only: Windows PowerShell 5.1 reads a BOM-less
  script as ANSI, so a single em dash in a string breaks the parse with
  "the string is missing the terminator", pointing at the wrong line.

  Usage: shoot.ps1 -Out shot.png [-Title DevDeck] [-Tries 30] [-Every 2]
#>
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Title = 'DevDeck',
  [int]$Tries = 30,
  [int]$Every = 2
)

$ErrorActionPreference = 'Stop'
$capture = Join-Path $PSScriptRoot 'capture-window.ps1'

for ($i = 1; $i -le $Tries; $i++) {
  $line = & powershell -ExecutionPolicy Bypass -File $capture -Title $Title -Out $Out 2>&1 |
    Select-Object -Last 1
  $text = "$line"

  if ($text -match '(\d+) distinct sample colours') {
    $colours = [int]$Matches[1]
    if ($colours -gt 2) {
      Write-Output "painted after $i attempt(s): $text"
      exit 0
    }
    Write-Output "attempt ${i}: still blank ($colours colours), waiting..."
  }
  else {
    # No window yet, or the script failed outright. Both are worth retrying:
    # the window can arrive seconds after the process does.
    Write-Output "attempt ${i}: $text"
  }

  Start-Sleep -Seconds $Every
}

Write-Error "gave up after $Tries attempts -- the window never painted. Open $Out anyway: a genuinely blank screen looks exactly like this, and this script cannot tell the difference."
exit 1
