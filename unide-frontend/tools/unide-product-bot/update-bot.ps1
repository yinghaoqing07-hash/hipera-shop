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

# Impide que dos clics o una actualización manual y otra desde el panel
# escriban el mismo directorio al mismo tiempo. El bloqueo se libera aunque
# PowerShell termine por error, porque Windows cierra el handle del proceso.
$lockFile = Join-Path $logsDir "update.lock"
try {
  $updateLock = [System.IO.File]::Open(
    $lockFile,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
} catch {
  Paso "ERROR: ya hay una actualización en curso"
  try { Stop-Transcript | Out-Null } catch { }
  exit 2
}

# REGLA DE ORO: si llegamos a parar el bot, SIEMPRE hay que volver a
# arrancarlo — aunque la instalacion falle a mitad, el bot vuelve con lo
# que haya en disco. Un update fallido no puede dejar la tienda sin bot.
$botParado = $false
function Reiniciar-Bot {
  $vbs = Join-Path $root "run-bot-hidden.vbs"
  if (Test-Path $vbs) {
    try { Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbs`""; return $true } catch { }
  }
  return $false
}

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
    $botParado = $true
    Start-Sleep -Seconds 1
  } else {
    Write-Host "Please close start-bot.cmd before updating." -ForegroundColor Yellow
  }

  # La instalacion tiene su propio try/catch: aunque falle (OneDrive
  # bloqueando un archivo, zip corrupto...), el reinicio de abajo se
  # ejecuta IGUAL y el bot vuelve con lo que haya en disco.
  $instalado = $true
  $motivoInstalacion = ""
  try {
    powershell -NoProfile -ExecutionPolicy Bypass -File $applyScript -ZipPath $zipPath
    if ($LASTEXITCODE -ne 0) { throw "apply-update.ps1 salio con codigo $LASTEXITCODE" }
  } catch {
    $instalado = $false
    $motivoInstalacion = $_.Exception.Message
    Write-Host "Fallo instalando: $motivoInstalacion" -ForegroundColor Red
  }

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
  if (-not (Reiniciar-Bot)) {
    Write-Host "Double-click start-bot.cmd to start the bot." -ForegroundColor Yellow
  }

  if ($instalado) {
    # Prueba de vida: la version recien instalada tiene que levantar el
    # panel en menos de ~50 s. Si no responde, se restaura la copia que
    # apply-update.ps1 dejo en updates\backup-prev y se arranca la version
    # anterior — un update malo no puede dejar la tienda sin bot.
    Paso "comprobando que la version nueva arranca..."
    $puerto = 8765
    try {
      $cfgLocal = Get-Content -Raw -LiteralPath (Join-Path $root "config.local.json") | ConvertFrom-Json
      if ($cfgLocal.panel -and $cfgLocal.panel.port) { $puerto = [int]$cfgLocal.panel.port }
    } catch { }
    $vivo = $false
    for ($i = 0; $i -lt 25; $i++) {
      Start-Sleep -Seconds 2
      try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$puerto/status" -UseBasicParsing -TimeoutSec 3
        if ($resp.StatusCode -eq 200) { $vivo = $true; break }
      } catch { }
    }
    if (-not $vivo) {
      $backupDir = Join-Path $root "updates\backup-prev"
      if (Test-Path $backupDir) {
        Paso "la version nueva no arranca - restaurando la anterior..."
        try { powershell -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Null } catch { }
        Get-ChildItem -LiteralPath $backupDir -Force | ForEach-Object {
          Copy-Item -LiteralPath $_.FullName -Destination $root -Recurse -Force
        }
        if (-not (Reiniciar-Bot)) {
          Write-Host "Double-click start-bot.cmd to start the bot." -ForegroundColor Yellow
        }
        Paso "ERROR: $v no arranco - restaurada y arrancada la version anterior"
        try { Stop-Transcript | Out-Null } catch { }
        exit 1
      }
      Paso "AVISO: el panel no responde tras el update y no hay copia previa que restaurar"
    }
    Paso "hecho: instalado $v"
    Write-Host ""
    Write-Host "Update finished. Version instalada: $v" -ForegroundColor Green
    Write-Host "Saved .env and config.local.json were preserved."
  } else {
    Paso "ERROR instalando ($motivoInstalacion) - el bot vuelve con la version anterior"
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
  }
} catch {
  $motivo = $_.Exception.Message
  # Si el bot ya estaba parado, revivirlo antes de rendirnos.
  if ($botParado -and (Reiniciar-Bot)) {
    Paso ("ERROR: " + $motivo + " - el bot se ha reiniciado con la version anterior")
  } else {
    Paso ("ERROR: " + $motivo)
  }
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}
try { Stop-Transcript | Out-Null } catch { }
exit 0
