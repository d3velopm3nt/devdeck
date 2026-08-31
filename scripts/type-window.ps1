<#
  Type text into a window, in the same way click-window.ps1 clicks it.

  SendKeys goes through a journal hook Windows refuses to install for some
  session states ("Access is denied") — keybd_event is the same SendInput path
  the click helper uses, and keeps working when SendKeys does not.

  Usage: type-window.ps1 -Title DevDeck -Text "Fitness"
#>
param(
  [string]$Title = 'DevDeck',
  [Parameter(Mandatory = $true)][string]$Text,
  [int]$SettleMs = 400
)

$sig = @'
using System;
using System.Runtime.InteropServices;
public class Win32Type {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char c);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  public const uint UP = 0x0002;
  public const byte SHIFT = 0x10;
}
'@
if (-not ('Win32Type' -as [type])) { Add-Type -TypeDefinition $sig }

$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*$Title*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "no window matching '$Title'"; exit 2 }
[void][Win32Type]::ShowWindow($proc.MainWindowHandle, 9)
[void][Win32Type]::SetForegroundWindow($proc.MainWindowHandle)
Start-Sleep -Milliseconds 250

foreach ($ch in $Text.ToCharArray()) {
  $vk = [Win32Type]::VkKeyScan($ch)
  if ($vk -eq -1) { continue }
  $key = [byte]($vk -band 0xFF)
  $shift = (($vk -shr 8) -band 1) -eq 1
  if ($shift) { [Win32Type]::keybd_event([Win32Type]::SHIFT, 0, 0, [IntPtr]::Zero) }
  [Win32Type]::keybd_event($key, 0, 0, [IntPtr]::Zero)
  [Win32Type]::keybd_event($key, 0, [Win32Type]::UP, [IntPtr]::Zero)
  if ($shift) { [Win32Type]::keybd_event([Win32Type]::SHIFT, 0, [Win32Type]::UP, [IntPtr]::Zero) }
  Start-Sleep -Milliseconds 18
}
Start-Sleep -Milliseconds $SettleMs
Write-Output "typed $($Text.Length) char(s) into '$Title'"
