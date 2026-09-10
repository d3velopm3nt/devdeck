<#
  Capture a single top-level window to PNG.

  Per-window PrintWindow with PW_RENDERFULLCONTENT (flag 2) is the only thing
  that works for a WebView2 host: a plain BitBlt of the screen returns black,
  and full-screen capture is unavailable in a non-interactive session. The
  window is forced topmost first because WebView2 suspends rendering while it
  is occluded, which produces a black capture that looks like a bug in the app
  rather than a bug in the capture.

  Usage: capture-window.ps1 -Title DevDeck -Out shot.png
#>
param(
  [string]$Title = 'DevDeck',
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$SettleMs = 700
)

Add-Type -AssemblyName System.Drawing

$sig = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Cap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  /// Every visible top-level window, by title.
  ///
  /// `Process.MainWindowTitle` is not good enough here for two reasons, both of
  /// which have produced a "screenshot of the wrong thing" that looked like a
  /// bug in the app: a process owning several windows reports whichever one
  /// Windows enumerates first (DevDeck has a floating Command Widget, and it
  /// wins about half the time), and a terminal whose title happens to be the
  /// path to devdeck.exe matches a substring search for "devdeck".
  public static List<KeyValuePair<string, IntPtr>> Visible() {
    var found = new List<KeyValuePair<string, IntPtr>>();
    EnumWindows((h, l) => {
      if (IsWindowVisible(h)) {
        int n = GetWindowTextLength(h);
        if (n > 0) {
          var sb = new StringBuilder(n + 1);
          GetWindowText(h, sb, sb.Capacity);
          found.Add(new KeyValuePair<string, IntPtr>(sb.ToString(), h));
        }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
if (-not ('Win32Cap' -as [type])) { Add-Type -TypeDefinition $sig }

# An exact title wins over a substring, so 'DevDeck' picks the app window and
# not a terminal whose title is the path to devdeck.exe.
$windows = [Win32Cap]::Visible()
$hit = $windows | Where-Object { $_.Key -eq $Title } | Select-Object -First 1
if (-not $hit) { $hit = $windows | Where-Object { $_.Key -like "*$Title*" } | Select-Object -First 1 }
if (-not $hit) {
  Write-Error "no visible window titled '$Title'. Visible: $(($windows | ForEach-Object { $_.Key }) -join ' | ')"
  exit 2
}
$h = $hit.Value

# Restore if minimised, raise, and let WebView2 paint.
if ([Win32Cap]::IsIconic($h)) { [void][Win32Cap]::ShowWindow($h, 9) }
[void][Win32Cap]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0043)  # TOPMOST | NOSIZE | NOMOVE | SHOWWINDOW
[void][Win32Cap]::SetForegroundWindow($h)
Start-Sleep -Milliseconds $SettleMs

$r = New-Object Win32Cap+RECT
if (-not [Win32Cap]::GetWindowRect($h, [ref]$r)) { Write-Error 'GetWindowRect failed'; exit 3 }
$w = $r.R - $r.L; $ht = $r.B - $r.T
if ($w -le 0 -or $ht -le 0) { Write-Error "bad window size ${w}x${ht}"; exit 4 }

$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [Win32Cap]::PrintWindow($h, $hdc, 2)   # PW_RENDERFULLCONTENT
$g.ReleaseHdc($hdc)
$g.Dispose()

# Drop the topmost flag again so the window doesn't stay pinned.
[void][Win32Cap]::SetWindowPos($h, [IntPtr](-2), 0, 0, 0, 0, 0x0043)

if (-not $ok) { $bmp.Dispose(); Write-Error 'PrintWindow returned false'; exit 5 }

# A capture that is entirely one colour is a failed capture, not a screenshot.
# Report it rather than writing a black PNG that looks like evidence.
$sample = @()
foreach ($x in 0, [int]($w / 3), [int]($w / 2), [int]($w * 2 / 3)) {
  foreach ($y in [int]($ht / 4), [int]($ht / 2), [int]($ht * 3 / 4)) {
    if ($x -lt $w -and $y -lt $ht) { $sample += $bmp.GetPixel($x, $y).ToArgb() }
  }
}
$distinct = ($sample | Select-Object -Unique).Count

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

if ($distinct -le 1) {
  Write-Output "WARN blank capture (${w}x${ht}, $distinct distinct sample colours) -> $Out"
  exit 6
}
Write-Output "ok ${w}x${ht} ($distinct distinct sample colours) -> $Out"
