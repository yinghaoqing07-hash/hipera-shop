$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# Para el bot oculto: mata al proceso que escucha en el puerto del panel y
# VERIFICA que el puerto queda libre (reintentando). Sale con 0 si el bot
# quedo parado (o no corria), con 1 si el puerto sigue ocupado; el updater
# usa ese codigo para NO arrancar un segundo bot encima del viejo.
# Señal para el bucle vigilante de start-bot.cmd: esta parada es A
# PROPOSITO (stop manual o updater), que no relance el bot. Se escribe
# ANTES de matar el proceso; el vigilante la borra al verla.
try {
  New-Item -ItemType Directory -Force -Path (Join-Path $root "logs") | Out-Null
  Set-Content -LiteralPath (Join-Path $root "logs\stop.flag") -Value (Get-Date).ToString("s")
} catch { }

$port = 8765
try {
  $cfg = Get-Content -Raw -LiteralPath (Join-Path $root "config.local.json") | ConvertFrom-Json
  if ($cfg.panel -and $cfg.panel.port) { $port = [int]$cfg.panel.port }
} catch { }

for ($i = 0; $i -lt 10; $i++) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) {
    if ($i -eq 0) { Write-Host "El bot no esta corriendo (nada escucha en el puerto $port)." }
    else { Write-Host "Bot parado (puerto $port libre)." -ForegroundColor Green }
    exit 0
  }
  $pids = $conns | ForEach-Object { $_.OwningProcess } | Sort-Object -Unique
  foreach ($botPid in $pids) {
    try {
      Stop-Process -Id $botPid -Force -ErrorAction Stop
      Write-Host "Matado proceso $botPid."
    } catch {
      Write-Host "No se pudo parar el proceso ${botPid}: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
  Start-Sleep -Milliseconds 700
}

Write-Host "AVISO: el puerto $port SIGUE ocupado despues de varios intentos." -ForegroundColor Red
exit 1
