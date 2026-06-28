param(
  [Parameter(Mandatory = $true)][string]$Query,
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [ValidateSet("search", "clear", "priceRead", "priceApply")][string]$Mode = "search",
  [string]$VariablesJson = "{}"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(UInt32 dwFlags, UInt32 dx, UInt32 dy, UInt32 dwData, UIntPtr dwExtraInfo);
}
"@

$warnings = New-Object System.Collections.Generic.List[string]
$values = [ordered]@{}
$variables = $VariablesJson | ConvertFrom-Json

function Add-WarningText([string]$Text) {
  if ($Text) { $warnings.Add($Text) | Out-Null }
}

function Get-ScreenInfo {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  [ordered]@{ width = $bounds.Width; height = $bounds.Height }
}

function Focus-Window($Regex, $ExcludedProcessNames) {
  $excluded = @($ExcludedProcessNames) | ForEach-Object { ([string]$_).ToLowerInvariant() }
  $process = Get-Process |
    Where-Object {
      $_.MainWindowTitle -and $_.MainWindowTitle -match $Regex -and
      ($excluded.Count -eq 0 -or $excluded -notcontains $_.ProcessName.ToLowerInvariant())
    } |
    Sort-Object ProcessName |
    Select-Object -First 1
  if (-not $process) { throw "Could not find a window matching: $Regex" }
  $handle = $process.MainWindowHandle
  if ([Win32]::IsIconic($handle)) { [Win32]::ShowWindow($handle, 9) | Out-Null }
  [Win32]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 400
  return $process.MainWindowTitle
}

function Click-Point([int]$X, [int]$Y) {
  if ($X -le 0 -or $Y -le 0) { throw "Click step has invalid coordinate: x=$X y=$Y" }
  [Win32]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 120
  [Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

function Send-Text([string]$Text) {
  Set-Clipboard -Value $Text
  Start-Sleep -Milliseconds 100
  [System.Windows.Forms.SendKeys]::SendWait("^v")
}

function Send-StepKeys([string]$Keys) { [System.Windows.Forms.SendKeys]::SendWait($Keys) }

function Resolve-Template([string]$Text) {
  $out = $Text.Replace("{{query}}", $Query)
  foreach ($prop in $variables.PSObject.Properties) {
    $out = $out.Replace("{{" + $prop.Name + "}}", [string]$prop.Value)
  }
  return $out
}

function Copy-Field([int]$X, [int]$Y) {
  Click-Point $X $Y
  Start-Sleep -Milliseconds 120
  Send-StepKeys "^a"
  Start-Sleep -Milliseconds 80
  Send-StepKeys "^c"
  Start-Sleep -Milliseconds 150
  return (Get-Clipboard -Raw).Trim()
}

function Test-CheckboxChecked([int]$X, [int]$Y, [int]$Size = 12) {
  $half = [Math]::Floor($Size / 2)
  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($X - $half, $Y - $half, 0, 0, $bitmap.Size)
  $dark = 0
  for ($ix = 2; $ix -lt ($Size - 2); $ix++) {
    for ($iy = 2; $iy -lt ($Size - 2); $iy++) {
      $p = $bitmap.GetPixel($ix, $iy)
      if ($p.R -lt 90 -and $p.G -lt 90 -and $p.B -lt 90) { $dark++ }
    }
  }
  $graphics.Dispose()
  $bitmap.Dispose()
  return ($dark -ge 3)
}

function Take-Screenshot([string]$Directory, [string]$QueryText) {
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  $safeQuery = $QueryText -replace '[^\w.-]+', '_'
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $path = Join-Path $Directory "unideges-$Mode-$safeQuery-$stamp.png"
  try {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose(); $bitmap.Dispose()
    return $path
  } catch {
    Add-WarningText "Screenshot failed: $($_.Exception.Message)"
    return $null
  }
}

function Get-Steps($Config, [string]$ActionMode) {
  if ($ActionMode -eq "clear") { $steps = @($Config.desktop.clearSteps) }
  elseif ($ActionMode -eq "priceRead") { $steps = @($Config.desktop.priceReadSteps) }
  elseif ($ActionMode -eq "priceApply") { $steps = @($Config.desktop.priceApplySteps) }
  else { $steps = @($Config.desktop.steps) }
  if ($steps.Count -eq 0) { throw "$ActionMode steps are not configured in config.local.json" }
  return $steps
}

try {
  $config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
  $screen = Get-ScreenInfo
  $windowTitle = $null
  $screenshotPath = $null
  $stepsToRun = Get-Steps $config $Mode

  if ($config.desktop.expectedScreen.width -gt 0 -and $config.desktop.expectedScreen.height -gt 0) {
    if ($config.desktop.expectedScreen.width -ne $screen.width -or $config.desktop.expectedScreen.height -ne $screen.height) {
      Add-WarningText "Screen size is $($screen.width)x$($screen.height), expected $($config.desktop.expectedScreen.width)x$($config.desktop.expectedScreen.height). Coordinates may need recalibration."
    }
  }

  foreach ($step in $stepsToRun) {
    switch ($step.type) {
      "focus" { $windowTitle = Focus-Window $config.desktop.windowTitleRegex $config.desktop.excludedProcessNames }
      "click" { Click-Point ([int]$step.x) ([int]$step.y) }
      "conditionalClick" {
        $key = [string]$step.if
        $shouldClick = $false
        if ($variables.PSObject.Properties.Name -contains $key) { $shouldClick = [System.Convert]::ToBoolean($variables.$key) }
        elseif ($values.Contains($key)) { $shouldClick = [System.Convert]::ToBoolean($values[$key]) }
        if ($shouldClick) { Click-Point ([int]$step.x) ([int]$step.y) }
      }
      "wait" { Start-Sleep -Milliseconds ([int]$step.ms) }
      "hotkey" { Send-StepKeys ([string]$step.keys) }
      "key" { Send-StepKeys ([string]$step.keys) }
      "text" { Send-Text (Resolve-Template ([string]$step.value)) }
      "setField" {
        Click-Point ([int]$step.x) ([int]$step.y)
        Start-Sleep -Milliseconds 100
        Send-StepKeys "^a"
        Start-Sleep -Milliseconds 80
        Send-Text (Resolve-Template ([string]$step.value))
      }
      "copyField" { $values[[string]$step.name] = Copy-Field ([int]$step.x) ([int]$step.y) }
      "checkboxState" {
        $size = 12
        if ($step.PSObject.Properties.Name -contains "size") { $size = [int]$step.size }
        $values[[string]$step.name] = Test-CheckboxChecked ([int]$step.x) ([int]$step.y) $size
      }
      "screenshot" { $screenshotPath = Take-Screenshot $OutDir $Query }
      default { Add-WarningText "Unknown desktop step type: $($step.type)" }
    }
    Start-Sleep -Milliseconds 120
  }

  if (-not $screenshotPath) { $screenshotPath = Take-Screenshot $OutDir $Query }

  [ordered]@{
    status = "ok"; mode = $Mode; query = $Query; values = $values; screenshot = $screenshotPath;
    screen = $screen; windowTitle = $windowTitle; warnings = @($warnings); ranAt = (Get-Date).ToString("o")
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  [ordered]@{
    status = "error"; mode = $Mode; query = $Query; error = $_.Exception.Message;
    values = $values; warnings = @($warnings); ranAt = (Get-Date).ToString("o")
  } | ConvertTo-Json -Compress -Depth 8
  exit 1
}
