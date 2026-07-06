$ErrorActionPreference = "Stop"

$botPath = Join-Path $PSScriptRoot "start-bot.cmd"
if (-not (Test-Path -LiteralPath $botPath)) {
  throw "Bot launcher not found: $botPath"
}

$botDir = Split-Path -LiteralPath $botPath
$startupDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$oldStartupLauncher = Join-Path $startupDir "Unide Product Bot.cmd"
$startupLauncher = Join-Path $startupDir "Unide Product Bot.lnk"

if (Test-Path -LiteralPath $oldStartupLauncher) {
  Remove-Item -LiteralPath $oldStartupLauncher -Force
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($startupLauncher)
$shortcut.TargetPath = $botPath
$shortcut.WorkingDirectory = $botDir
$shortcut.WindowStyle = 1
$shortcut.Description = "Start Unide Telegram bot after Windows login"
$shortcut.Save()

powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
powercfg /change monitor-timeout-ac 0 | Out-Null

Write-Host "Remote resilience setup complete."
Write-Host "AC sleep timeout: never"
Write-Host "AC hibernate timeout: never"
Write-Host "AC display timeout: never"
Write-Host "Startup shortcut:"
Write-Host $startupLauncher
