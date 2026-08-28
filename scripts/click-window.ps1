<#
  Click at a point inside a window, in window-relative coordinates.

  Uses SendInput against the real cursor rather than PostMessage: WebView2
  hosts its own child HWND and ignores synthesised WM_LBUTTONDOWN sent to the
  top-level window, so message-posting looks like it works and does nothing.

  Usage: click-window.ps1 -Title DevDeck -X 33 -Y 317
#>
param(
  [string]$Title = 'DevDeck',
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [int]$SettleMs = 500
)

$sig = @'
using System;
using System.Runtime.InteropServices;
public class Win32Click {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public const uint DOWN = 0x0002, UP = 0x0004;
}
'@
if (-not ('Win32Click' -as [type])) { Add-Type -TypeDefinition $sig }

$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*$Title*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "no window matching '$Title'"; exit 2 }
$h = $proc.MainWindowHandle

[void][Win32Click]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0043)
[void][Win32Click]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 250

$r = New-Object Win32Click+RECT
[void][Win32Click]::GetWindowRect($h, [ref]$r)
$sx = $r.L + $X
$sy = $r.T + $Y

[void][Win32Click]::SetCursorPos($sx, $sy)
Start-Sleep -Milliseconds 90
[Win32Click]::mouse_event([Win32Click]::DOWN, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 60
[Win32Click]::mouse_event([Win32Click]::UP, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds $SettleMs

[void][Win32Click]::SetWindowPos($h, [IntPtr](-2), 0, 0, 0, 0, 0x0043)
Write-Output "clicked window($X,$Y) -> screen($sx,$sy)"
