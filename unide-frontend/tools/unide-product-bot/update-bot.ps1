param(
  [string]$Url = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
# Sin consola visible, pintar la barra de progreso de Invoke-WebRequest
# puede colgar o ralentizar PowerShell: fuera.
$ProgressPreference = "SilentlyContinue"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# Progreso observable: cada paso se escribe en logs\update-estado.txt.
# El bot lo lee y el panel lo va enseñando en la barra de estado — asi la
# actualizacion nunca es una caja negra, ni siquiera corriendo oculta
# (Write-Host va a la consola, que oculta no la ve nadie).
$logsDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
$estadoFile = Join-Path $logsDir "update-estado.txt"
function Paso([string]$texto) {
  try { Set-Content -LiteralPath $estadoFile -Value $texto -Encoding UTF8 } catch { }
  Write-Host $texto
}

# Transcripcion completa para depurar (captura tambien Write-Host).
try { Start-Transcript -Path (Join-Path $logsDir "update-transcript.log") -Append -Force | Out-Null } catch { }

try {
  Paso "preparando..."

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
    Paso "dry run: nada que hacer"
    exit 0
  }

  Paso "descargando el paquete de GitHub..."
  try {
    # ?t=... esquiva la cache CDN de GitHub (hasta 5 min sirviendo el zip viejo).
    $sep = if ($Url.Contains('?')) { '&' } else { '?' }
    Invoke-WebRequest -Uri ($Url + $sep + "t=$stamp") -OutFile $zipPath -UseBasicParsing -TimeoutSec 180 -Headers @{ 'Cache-Control' = 'no-cache' }
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

  # El bot se para SOLO despues de que la descarga haya ido bien: si la red
  # falla, el bot sigue corriendo como estaba. Necesita ir elevado
  # (update-bot.cmd o el propio bot elevan antes de llamar aqui).
  Paso "parando el bot e instalando..."
  $stopScript = Join-Path $root "stop-bot.ps1"
  if (Test-Path $stopScript) {
    powershell -NoProfile -ExecutionPolicy Bypass -File $stopScript
    if ($LASTEXITCODE -ne 0) {
      # Si el bot viejo no muere, arrancar otro encima seria PEOR (dos bots
      # peleandose por Telegram): mejor parar aqui y contarlo.
      throw "No pude parar el bot (el puerto del panel sigue ocupado). Prueba stop-bot.cmd y vuelve a actualizar."
    }
    Start-Sleep -Seconds 1
  } else {
    Write-Host "Please close start-bot.cmd before updating." -ForegroundColor Yellow
  }

  powershell -NoProfile -ExecutionPolicy Bypass -File $applyScript -ZipPath $zipPath

  # Version instalada: el numero de version.txt (v127, v128...) es lo que
  # el panel pinta en su esquina — comparar numeros es trivial.
  $v = ""
  $verFile = Join-Path $root "version.txt"
  if (Test-Path $verFile) {
    $v = "v" + (Get-Content -Raw -LiteralPath $verFile).Trim()
  } elseif (Test-Path (Join-Path $root "src\panel.js")) {
    $v = "v " + (Get-Item -LiteralPath (Join-Path $root "src\panel.js")).LastWriteTime.ToString("dd/MM HH:mm")
  }

  # Reinicio en segundo plano (sin ventana): este proceso ya va elevado,
  # asi que el vbs oculto arranca el bot sin ningun aviso UAC.
  Paso "reiniciando el bot..."
  $vbs = Join-Path $root "run-bot-hidden.vbs"
  if (Test-Path $vbs) {
    Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbs`""
  } else {
    Write-Host "Double-click start-bot.cmd to start the new version."
  }

  Paso "hecho: instalado $v"
  Write-Host ""
  Write-Host "Update finished. Version instalada: $v" -ForegroundColor Green
  Write-Host "Saved .env and config.local.json were preserved."
} catch {
  Paso ("ERROR: " + $_.Exception.Message)
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
try { Stop-Transcript | Out-Null } catch { }
exit 0
