$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Unide product bot setup" -ForegroundColor Cyan
Write-Host "Folder: $root"

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Node.js was not found." -ForegroundColor Yellow
  Write-Host "Install Node.js LTS from https://nodejs.org/ then run this setup again."
} else {
  $nodeVersion = node -v
  Write-Host "Node.js: $nodeVersion" -ForegroundColor Green

  Write-Host "Installing npm dependencies (puppeteer-core, for Pedidos web automation)..." -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Dependencies installed." -ForegroundColor Green
  } else {
    Write-Host "npm install failed. Check internet connection; start-bot.cmd will retry." -ForegroundColor Yellow
  }
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example" -ForegroundColor Green
} else {
  Write-Host ".env already exists"
}

if (-not (Test-Path "config.local.json")) {
  Copy-Item "config.example.json" "config.local.json"
  Write-Host "Created config.local.json from config.example.json" -ForegroundColor Green
} else {
  Write-Host "config.local.json already exists"
}

if (-not (Test-Path "data\supplier_products_clean.csv")) {
  Write-Host "Missing data\supplier_products_clean.csv" -ForegroundColor Red
} else {
  $csv = Get-Item "data\supplier_products_clean.csv"
  Write-Host "Supplier CSV found: $([Math]::Round($csv.Length / 1MB, 2)) MB" -ForegroundColor Green
}

New-Item -ItemType Directory -Force -Path "logs" | Out-Null
New-Item -ItemType Directory -Force -Path "screenshots" | Out-Null

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Edit .env and paste TELEGRAM_BOT_TOKEN from BotFather."
Write-Host "2. Double-click start-bot.cmd, then send /whoami to the bot."
Write-Host "3. Put that chat id into config.local.json -> telegram.allowedChatIds."
Write-Host "4. Open UnideGes desktop Articulos page."
Write-Host "5. Double-click calibrate-screen.cmd and record the binocular/search-input coordinates."
Write-Host "6. Put the coordinates into config.local.json and set desktop.enabled to true."
Write-Host "7. Double-click start-bot.cmd again."
