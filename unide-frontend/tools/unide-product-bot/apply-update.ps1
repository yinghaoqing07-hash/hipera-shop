param(
  [Parameter(Mandatory = $true)][string]$ZipPath
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$updatesDir = Join-Path $root "updates"
$temp = Join-Path $updatesDir ("apply-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

$resolvedRoot = [System.IO.Path]::GetFullPath($root)
$resolvedUpdates = [System.IO.Path]::GetFullPath($updatesDir)
$resolvedTemp = [System.IO.Path]::GetFullPath($temp)
if (-not $resolvedUpdates.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use updates folder outside app root: $resolvedUpdates"
}
if (-not $resolvedTemp.StartsWith($resolvedUpdates, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use temp folder outside updates folder: $resolvedTemp"
}

$zipResolved = Resolve-Path -LiteralPath $ZipPath
New-Item -ItemType Directory -Force -Path $temp | Out-Null

try {
  Expand-Archive -LiteralPath $zipResolved.Path -DestinationPath $temp -Force

  $source = Join-Path $temp "unide-product-bot"
  if (-not (Test-Path $source)) {
    $source = Get-ChildItem -LiteralPath $temp -Directory |
      Where-Object { Test-Path (Join-Path $_.FullName "package.json") } |
      Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $source -or -not (Test-Path $source)) {
    throw "Could not find unide-product-bot folder inside zip."
  }

  $excludeNames = @(".env", "config.local.json", "logs", "screenshots", "updates", "node_modules")
  Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
    if ($excludeNames -contains $_.Name) { return }
    Copy-Item -LiteralPath $_.FullName -Destination $root -Recurse -Force
  }

  Write-Host "Update applied. Preserved .env and config.local.json. Restart start-bot.cmd to load the new code."
} finally {
  if (Test-Path $temp) {
    Remove-Item -LiteralPath $temp -Recurse -Force
  }
}
