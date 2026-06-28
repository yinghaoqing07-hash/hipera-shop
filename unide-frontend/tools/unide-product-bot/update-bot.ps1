param(
  [string]$Url = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not $Url) {
  $urlFile = Join-Path $root "update-url.txt"
  if (Test-Path $urlFile) {
    $Url = (Get-Content -Raw -LiteralPath $urlFile).Trim()
  }
}

if (-not $Url) {
  throw "Missing update URL. Put a GitHub download URL in update-url.txt."
}

$isReleaseUrl = $Url -match '^https://github\.com/.+/releases/.+/unide-product-bot-store-pc\.zip$'
$isRawUrl = $Url -match '^https://raw\.githubusercontent\.com/.+/unide-product-bot-store-pc\.zip$'
if (-not ($isReleaseUrl -or $isRawUrl)) {
  Write-Host "Warning: update URL is not a recognized GitHub zip pattern." -ForegroundColor Yellow
  Write-Host $Url
}

$updatesDir = Join-Path $root "updates"
New-Item -ItemType Directory -Force -Path $updatesDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zipPath = Join-Path $updatesDir "download-$stamp-unide-product-bot-store-pc.zip"

Write-Host "Unide product bot updater" -ForegroundColor Cyan
Write-Host "Folder: $root"
Write-Host "URL: $Url"

if ($DryRun) {
  Write-Host "Dry run only. No download or update performed." -ForegroundColor Yellow
  exit 0
}

Write-Host ""
Write-Host "Please close start-bot.cmd before updating." -ForegroundColor Yellow
Write-Host "Downloading latest package..."

try {
  Invoke-WebRequest -Uri $Url -OutFile $zipPath -UseBasicParsing
} catch {
  throw "Download failed. Check internet/GitHub URL. Details: $($_.Exception.Message)"
}

if (-not (Test-Path $zipPath)) {
  throw "Download did not create zip: $zipPath"
}

$sizeMb = [Math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "Downloaded: $zipPath ($sizeMb MB)" -ForegroundColor Green

$applyScript = Join-Path $root "apply-update.ps1"
if (-not (Test-Path $applyScript)) {
  throw "Missing apply-update.ps1"
}

Write-Host "Applying update..."
powershell -NoProfile -ExecutionPolicy Bypass -File $applyScript -ZipPath $zipPath

Write-Host ""
Write-Host "Update finished." -ForegroundColor Green
Write-Host "Saved .env and config.local.json were preserved."
Write-Host "Double-click start-bot.cmd to start the new version."
