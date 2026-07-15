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
  if ($_.Name -like "*-dump.html") { return }
  Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Compress-Archive can emit Windows-style backslashes in entry names. Those
# archives extract incorrectly with some updater/runtime combinations, so add
# every file explicitly with the ZIP-standard forward slash separator.
$zipStream = $null
$archive = $null
try {
  $zipStream = [System.IO.File]::Open($zip, [System.IO.FileMode]::CreateNew)
  $archive = New-Object System.IO.Compression.ZipArchive(
    $zipStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $false
  )

  Get-ChildItem -LiteralPath $dest -File -Recurse -Force | ForEach-Object {
    $entryName = $_.FullName.Substring($temp.Length + 1).Replace("\", "/")
    $entry = $archive.CreateEntry(
      $entryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    )
    $entry.LastWriteTime = $_.LastWriteTime

    $inputStream = $null
    $outputStream = $null
    try {
      $inputStream = $_.OpenRead()
      $outputStream = $entry.Open()
      $inputStream.CopyTo($outputStream)
    } finally {
      if ($outputStream) { $outputStream.Dispose() }
      if ($inputStream) { $inputStream.Dispose() }
    }
  }
} finally {
  if ($archive) { $archive.Dispose() }
  if ($zipStream) { $zipStream.Dispose() }
}
Remove-Item -LiteralPath $temp -Recurse -Force

Write-Host "Created package:"
Write-Host $zip
if ($NoData) {
  Write-Host "Data folder was excluded for update publishing."
}
