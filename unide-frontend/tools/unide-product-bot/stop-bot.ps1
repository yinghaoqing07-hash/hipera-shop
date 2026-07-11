$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# El bot corre oculto (sin ventana) desde run-bot-hidden.vbs: para pararlo
# se localiza el proceso que escucha en el puerto del panel y se mata.
$port = 8765
try {
  $cfg = Get-Content -Raw -LiteralPath (Join-Path $root "config.local.json") | ConvertFrom-Json
  if ($cfg.panel -and $cfg.panel.port) { $port = [int]$cfg.panel.port }
} catch { }

try {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
} catch {
  Write-Host "El bot no esta corriendo (nada escucha en el puerto $port)."
  exit 0
}

$pids = $conns | ForEach-Object { $_.OwningProcess } | Sort-Object -Unique
foreach ($botPid in $pids) {
  try {
    Stop-Process -Id $botPid -Force
    Write-Host "Bot parado (proceso $botPid)." -ForegroundColor Green
  } catch {
    Write-Host "No se pudo parar el proceso ${botPid}: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}
