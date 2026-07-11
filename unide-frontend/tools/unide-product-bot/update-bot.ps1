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
  # ?t=... esquiva la cache CDN de GitHub (hasta 5 min sirviendo el zip viejo).
  $sep = if ($Url.Contains('?')) { '&' } else { '?' }
  Invoke-WebRequest -Uri ($Url + $sep + "t=$stamp") -OutFile $zipPath -UseBasicParsing -Headers @{ 'Cache-Control' = 'no-cache' }
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

# La fecha de src/panel.js es la "version" que el panel pinta en la esquina:
# imprimirla aqui permite comprobar al momento que la actualizacion entro.
$panelFile = Join-Path $root "src\panel.js"
if (Test-Path $panelFile) {
  $v = (Get-Item -LiteralPath $panelFile).LastWriteTime.ToString("dd/MM HH:mm")
  Write-Host "Version instalada: v $v (debe salir igual en la esquina del panel)" -ForegroundColor Cyan
}
Write-Host "Double-click start-bot.cmd to start the new version."
