param(
  [switch]$NoData
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageRoot = Split-Path -Parent $root
$temp = Join-Path $packageRoot ".unide-product-bot-package-tmp"
$zip = Join-Path $packageRoot "unide-product-bot-store-pc.zip"

$resolvedPackageRoot = [System.IO.Path]::GetFullPath($packageRoot)
$resolvedTemp = [System.IO.Path]::GetFullPath($temp)
if (-not $resolvedTemp.StartsWith($resolvedPackageRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to clean temp folder outside package root: $resolvedTemp"
}

if (Test-Path $temp) {
  Remove-Item -LiteralPath $temp -Recurse -Force
}
if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}

New-Item -ItemType Directory -Force -Path $temp | Out-Null
$dest = Join-Path $temp "unide-product-bot"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$excludeNames = @(".env", "config.local.json", "logs", "screenshots", "updates", "node_modules")
if ($NoData) {
  $excludeNames += "data"
}

Get-ChildItem -LiteralPath $root -Force | ForEach-Object {
  if ($excludeNames -contains $_.Name) { return }
  Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
}

Compress-Archive -LiteralPath $dest -DestinationPath $zip -Force
Remove-Item -LiteralPath $temp -Recurse -Force

Write-Host "Created package:"
Write-Host $zip
if ($NoData) {
  Write-Host "Data folder was excluded for update publishing."
}
