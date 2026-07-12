param(
  [Parameter(Mandatory = $true)]
  [string]$Updater,
  [string]$WorkingDirectory = ""
)

$ErrorActionPreference = "Stop"
$taskName = "UnideProductBotUpdater"

if (-not (Test-Path -LiteralPath $Updater)) {
  throw "Updater not found: $Updater"
}
if (-not $WorkingDirectory) {
  $WorkingDirectory = Split-Path -Parent $Updater
}

# A separate scheduled task is deliberate: update-bot.ps1 stops the running
# bot before replacing files. A normal child process can be terminated with
# its parent on this PC, leaving the update half-finished.
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.State -eq "Running") {
  Write-Host "Updater task is already running."
  exit 3
}

$psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $Updater + '"'
$action = New-ScheduledTaskAction -Execute $psExe -Argument $arguments -WorkingDirectory $WorkingDirectory
$principal = New-ScheduledTaskPrincipal `
  -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive `
  -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Milliseconds 500

$started = Get-ScheduledTask -TaskName $taskName
if ($started.State -ne "Running") {
  $info = Get-ScheduledTaskInfo -TaskName $taskName
  throw "Updater task did not stay running (LastTaskResult=$($info.LastTaskResult))."
}

Write-Host "Independent updater task started."
