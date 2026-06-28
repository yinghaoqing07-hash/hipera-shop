param(
  [int]$WatchSeconds = 0,
  [string]$OutDir = "screenshots"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseInfo {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);
}
"@

function Get-CursorPoint {
  $point = New-Object MouseInfo+POINT
  [MouseInfo]::GetCursorPos([ref]$point) | Out-Null
  return $point
}

function Take-Screenshot([string]$Directory) {
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  $path = Join-Path $Directory ("calibration-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".png")
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
  return $path
}

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Host "Screen: $($bounds.Width)x$($bounds.Height)"
$shot = Take-Screenshot $OutDir
Write-Host "Screenshot: $shot"

if ($WatchSeconds -gt 0) {
  Write-Host "Move mouse to the target point. Press Ctrl+C to stop."
  $deadline = (Get-Date).AddSeconds($WatchSeconds)
  while ((Get-Date) -lt $deadline) {
    $p = Get-CursorPoint
    Write-Host ("x={0} y={1}" -f $p.X, $p.Y)
    Start-Sleep -Milliseconds 700
  }
}
