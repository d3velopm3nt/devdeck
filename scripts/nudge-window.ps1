<#
  Force a window to repaint by resizing it one pixel and back.

  WebView2 composes lazily when nothing is interacting with it, and
  PrintWindow then returns the last frame it composed -- which can be a screen
  from a minute ago. A capture of that looks like the UI never changed, which
  has already sent one session chasing a hot-reload bug that was not there.
  A resize forces a layout and a fresh frame; the window ends up exactly where
  it was.

  Usage: nudge-window.ps1 [-Title DevDeck]
#>
param(
  [string]$Title = 'DevDeck',
  [int]$SettleMs = 400
)

$sig = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Nudge {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static IntPtr Find(string title) {
    IntPtr hit = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int n = GetWindowTextLength(h);
      if (n <= 0) return true;
      var sb = new StringBuilder(n + 1);
      GetWindowText(h, sb, sb.Capacity);
      if (sb.ToString() == title) { hit = h; return false; }
      return true;
    }, IntPtr.Zero);
    return hit;
  }
}
'@
if (-not ('Win32Nudge' -as [type])) { Add-Type -TypeDefinition $sig }

$h = [Win32Nudge]::Find($Title)
if ($h -eq [IntPtr]::Zero) { Write-Error "no window titled '$Title'"; exit 1 }
$r = New-Object Win32Nudge+RECT
[Win32Nudge]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $hgt = $r.B - $r.T
# SWP_NOZORDER (0x4) | SWP_NOACTIVATE (0x10)
[Win32Nudge]::SetWindowPos($h, [IntPtr]::Zero, $r.L, $r.T, $w + 1, $hgt, 0x14) | Out-Null
Start-Sleep -Milliseconds $SettleMs
[Win32Nudge]::SetWindowPos($h, [IntPtr]::Zero, $r.L, $r.T, $w, $hgt, 0x14) | Out-Null
Start-Sleep -Milliseconds $SettleMs
"nudged"
