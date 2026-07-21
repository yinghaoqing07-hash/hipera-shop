param(
  [Parameter(Mandatory = $true)][string]$Accion,   # estado | abrir | modulo
  [string]$Tecla = "",                              # F1 F3 F6 F7 F12 (solo Accion=modulo)
  [string]$OutDir = "screenshots",
  [string]$ExePath = "",                            # exe o .lnk configurado; '' = buscar acceso directo
  [string]$TitleRegex = "^MadisaNet",
  [string]$ShortcutRegex = "madisa|unide"
)

# Conduce el MENU PRINCIPAL de UnideGes (ventana "MadisaNet"): traerlo al
# frente, abrir la aplicacion si esta cerrada y entrar a un modulo con su
# tecla F (F1 Inicio de dia, F3 Articulos, F6 Utilidades, F7 Albaranes,
# F12 Fin de dia). NO navega dentro de los modulos: abre la puerta, hace
# captura y el dueño ve en la foto que el modulo quedo abierto.
# Salida: una linea JSON en stdout (mismo contrato que unideges-search.ps1).

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class W32Menu {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  // TODAS las ventanas top-level visibles con su pid: la del menu puede no
  // ser la "MainWindow" del proceso cuando hay un modulo abierto delante.
  public static System.Collections.Generic.List<long[]> VisibleWindows() {
    var list = new System.Collections.Generic.List<long[]>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      uint p;
      GetWindowThreadProcessId(h, out p);
      list.Add(new long[] { h.ToInt64(), (long)p });
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@

$warnings = New-Object System.Collections.Generic.List[string]

function Emit([string]$Status, [string]$Mensaje, [string]$Ventana, [string]$Shot) {
  $out = [ordered]@{
    status = $Status
    mensaje = $Mensaje
    ventana = $Ventana
    screenshot = $Shot
    warnings = @($warnings)
  }
  ($out | ConvertTo-Json -Compress -Depth 4)
}

# Los navegadores quedan fuera SIEMPRE: una pestaña titulada "UnideGes"
# no es la aplicacion de escritorio.
$procesosExcluidos = @('chrome', 'msedge', 'firefox')

function Find-MenuWindow {
  $porPid = @{}
  foreach ($proc in Get-Process) { $porPid[[long]$proc.Id] = $proc.ProcessName.ToLowerInvariant() }
  foreach ($par in [W32Menu]::VisibleWindows()) {
    $handle = [IntPtr]$par[0]
    $nombreProc = $porPid[[long]$par[1]]
    if ($nombreProc -and ($procesosExcluidos -contains $nombreProc)) { continue }
    $buf = New-Object System.Text.StringBuilder 512
    [W32Menu]::GetWindowText($handle, $buf, 512) | Out-Null
    $titulo = $buf.ToString()
    if ($titulo -and $titulo -match $TitleRegex) {
      return @{ Handle = $handle; Title = $titulo; ProcId = [long]$par[1] }
    }
  }
  return $null
}

function Focus-MenuWindow($win) {
  if ([W32Menu]::IsIconic($win.Handle)) { [W32Menu]::ShowWindow($win.Handle, 9) | Out-Null; Start-Sleep -Milliseconds 300 }
  [W32Menu]::SetForegroundWindow($win.Handle) | Out-Null
  Start-Sleep -Milliseconds 500
  # Igual que Click-Point en unideges-search.ps1: si UnideGes corre elevado
  # y el bot no, el foco no cambia de verdad y las teclas caerian en OTRA app.
  $fg = [W32Menu]::GetForegroundWindow()
  if ($fg -ne [IntPtr]$win.Handle) {
    $buf = New-Object System.Text.StringBuilder 512
    [W32Menu]::GetWindowText($fg, $buf, 512) | Out-Null
    throw "No pude traer UnideGes al frente (delante esta '$($buf.ToString())'). Causa tipica: el bot no corre como administrador."
  }
}

function Take-MenuShot([string]$Etiqueta) {
  try {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $ruta = Join-Path $OutDir "unideges-menu-$Etiqueta-$stamp.png"
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($ruta, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose(); $bitmap.Dispose()
    return $ruta
  } catch {
    $warnings.Add("Screenshot failed: $($_.Exception.Message)") | Out-Null
    return $null
  }
}

# Localiza con que abrir UnideGes: el ExePath configurado o, si no hay, un
# acceso directo (.lnk) del Escritorio / Menu Inicio cuyo nombre case con
# el patron (madisa|unide).
function Find-Launcher {
  if ($ExePath -and (Test-Path -LiteralPath $ExePath)) { return $ExePath }
  $carpetas = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('CommonDesktopDirectory'),
    [Environment]::GetFolderPath('StartMenu'),
    [Environment]::GetFolderPath('CommonStartMenu')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  foreach ($carpeta in $carpetas) {
    $lnk = Get-ChildItem -LiteralPath $carpeta -Recurse -Filter *.lnk -ErrorAction SilentlyContinue |
      Where-Object { $_.BaseName -match $ShortcutRegex } |
      Select-Object -First 1
    if ($lnk) { return $lnk.FullName }
  }
  return $null
}

function Open-UnidegesAndWait {
  $lanzador = Find-Launcher
  if (-not $lanzador) {
    throw "No encontre con que abrir UnideGes: ni exePath configurado ni acceso directo (patron '$ShortcutRegex') en Escritorio/Menu Inicio."
  }
  $warnings.Add("Abriendo: $lanzador") | Out-Null
  Start-Process -FilePath $lanzador | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $win = Find-MenuWindow
    if ($win) { return $win }
  }
  throw "Lance '$lanzador' pero la ventana del menu ($TitleRegex) no aparecio en 60 s."
}

try {
  if ($Accion -eq 'estado') {
    $win = Find-MenuWindow
    if ($win) { Emit 'ok' 'abierta' $win.Title $null } else { Emit 'ok' 'cerrada' '' $null }
    exit 0
  }

  if ($Accion -eq 'abrir') {
    $win = Find-MenuWindow
    $yaEstaba = [bool]$win
    if (-not $win) { $win = Open-UnidegesAndWait }
    Focus-MenuWindow $win
    $shot = Take-MenuShot 'abrir'
    $msg = if ($yaEstaba) { 'ya estaba abierto; lo he traido al frente' } else { 'abierto' }
    Emit 'ok' $msg $win.Title $shot
    exit 0
  }

  if ($Accion -eq 'modulo') {
    # Lista blanca dura: SOLO las teclas del menu principal que se pidieron.
    $teclasPermitidas = @('F1', 'F3', 'F6', 'F7', 'F12')
    if ($teclasPermitidas -notcontains $Tecla) { throw "Tecla no permitida: '$Tecla' (validas: $($teclasPermitidas -join ', '))" }
    $win = Find-MenuWindow
    if (-not $win) { $win = Open-UnidegesAndWait }
    Focus-MenuWindow $win
    [System.Windows.Forms.SendKeys]::SendWait("{$Tecla}")
    # El modulo tarda un momento en pintar; la captura es la prueba de vida.
    Start-Sleep -Milliseconds 2500
    $shot = Take-MenuShot "modulo-$Tecla"
    $fg = [W32Menu]::GetForegroundWindow()
    $buf = New-Object System.Text.StringBuilder 512
    [W32Menu]::GetWindowText($fg, $buf, 512) | Out-Null
    Emit 'ok' "tecla $Tecla enviada" $buf.ToString() $shot
    exit 0
  }

  throw "Accion desconocida: $Accion (validas: estado, abrir, modulo)"
} catch {
  $shot = Take-MenuShot 'error'
  Emit 'error' $_.Exception.Message '' $shot
  exit 1
}
