param(
  [Parameter(Mandatory = $true)][string]$Accion,   # estado | abrir | modulo
  [string]$Tecla = "",                              # F1 F3 F6 F7 F12 (solo Accion=modulo)
  [string]$OutDir = "screenshots",
  [string]$ExePath = "",                            # exe o .lnk configurado; '' = buscar acceso directo
  [string]$TitleRegex = "^MadisaNet",
  [string]$ShortcutRegex = "madisa|unide",
  [string]$LoginUser = "1"                          # usuario del dialogo de acceso; '' = no auto-login
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
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(UInt32 dwFlags, UInt32 dx, UInt32 dy, UInt32 dwData, UIntPtr dwExtraInfo);
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
# acceso directo (.lnk) del Escritorio / Menu Inicio. Se puntuan TODOS los
# candidatos ('unideges' > 'madisa' > 'unide' a secas) y se excluyen los
# del propio bot y herramientas (JARVIS, panel, edge debug, updater...):
# el 20/07 un lnk equivocado se llevo el primer intento de apertura.
function Find-Launcher {
  if ($ExePath -and (Test-Path -LiteralPath $ExePath)) { return $ExePath }
  $carpetas = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('CommonDesktopDirectory'),
    [Environment]::GetFolderPath('StartMenu'),
    [Environment]::GetFolderPath('CommonStartMenu')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  $mejor = $null
  $mejorPuntos = 0
  $vistos = New-Object System.Collections.Generic.List[string]
  foreach ($carpeta in $carpetas) {
    foreach ($lnk in (Get-ChildItem -LiteralPath $carpeta -Recurse -Filter *.lnk -ErrorAction SilentlyContinue)) {
      $nombre = $lnk.BaseName
      if ($nombre -notmatch $ShortcutRegex) { continue }
      $vistos.Add($nombre) | Out-Null
      if ($nombre -match 'jarvis|bot|panel|debug|edge|update|start|stop') { continue }
      $puntos = 1
      if ($nombre -match 'madisa') { $puntos = 2 }
      if ($nombre -match 'unideges') { $puntos = 3 }
      if ($puntos -gt $mejorPuntos) { $mejorPuntos = $puntos; $mejor = $lnk.FullName }
    }
  }
  if (-not $mejor -and $vistos.Count -gt 0) {
    $warnings.Add("Accesos directos que casan pero se excluyeron: $($vistos -join ', ')") | Out-Null
  }
  return $mejor
}

# Titulos de las ventanas visibles AHORA (para contar que paso cuando el
# menu no aparece: que se abrio en su lugar, si hay un login, etc).
function Visible-Titles {
  $titulos = New-Object System.Collections.Generic.List[string]
  foreach ($par in [W32Menu]::VisibleWindows()) {
    $buf = New-Object System.Text.StringBuilder 512
    [W32Menu]::GetWindowText([IntPtr]$par[0], $buf, 512) | Out-Null
    $t = $buf.ToString()
    if ($t -and -not $titulos.Contains($t)) { $titulos.Add($t) | Out-Null }
  }
  return ($titulos | Select-Object -First 12) -join ' · '
}

# El dialogo de acceso (Usuario/Clave) que sale al arrancar: la receta del
# dueño es teclear el usuario ('1') y Enter dos veces. Se busca entre las
# ventanas de procesos NUEVOS (que no existian antes del Start-Process, asi
# da igual que el lanzador engendre hijos) que no sean ya el menu.
function Send-LoginKeys([IntPtr]$Handle, [string]$Titulo) {
  # Receta EXACTA del dueño (20/07): al abrirse el dialogo el cursor YA
  # esta en la primera caja (Usuario) — usuario y Enter x2, sin clics.
  # OJO: activar la ventana de mas mueve el foco al desplegable (asi acabo
  # el '1' alli en v216), asi que solo se trae al frente si NO lo esta ya.
  if ([W32Menu]::GetForegroundWindow() -ne $Handle) {
    [W32Menu]::SetForegroundWindow($Handle) | Out-Null
    Start-Sleep -Milliseconds 400
    if ([W32Menu]::GetForegroundWindow() -ne $Handle) { return $false }
  }
  $warnings.Add("Login detectado (ventana '$Titulo'): usuario y Enter x2") | Out-Null
  [System.Windows.Forms.SendKeys]::SendWait($LoginUser)
  Start-Sleep -Milliseconds 300
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  # El segundo campo (operario) tarda un momento en rellenarse tras el
  # primer Enter; si el segundo Enter llega pronto no cuaja y el dialogo se
  # queda en la segunda caja (paso el 20/07). Espera larga y, mientras el
  # dialogo siga delante sin menu a la vista, reintentos de Enter.
  Start-Sleep -Milliseconds 1500
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  for ($j = 0; $j -lt 3; $j++) {
    Start-Sleep -Milliseconds 1200
    if (Find-MenuWindow) { break }
    if ([W32Menu]::GetForegroundWindow() -ne $Handle) { break }
    $warnings.Add("El dialogo sigue delante: Enter de nuevo ($($j + 1))") | Out-Null
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  }
  return $true
}

function Try-Login($PidsAntes) {
  if (-not $LoginUser) { return $false }
  foreach ($par in [W32Menu]::VisibleWindows()) {
    if ($PidsAntes.Contains([long]$par[1])) { continue }
    $handle = [IntPtr]$par[0]
    $buf = New-Object System.Text.StringBuilder 512
    [W32Menu]::GetWindowText($handle, $buf, 512) | Out-Null
    $titulo = $buf.ToString()
    if ($titulo -match $TitleRegex) { continue }
    if (Send-LoginKeys $handle $titulo) { return $true }
  }
  return $false
}

# La app puede estar YA abierta con el dialogo de login delante (p. ej. la
# abrio alguien a mano y la dejo ahi). Antes de lanzar OTRA instancia se
# busca una ventana suelta que parezca de UnideGes y se intenta el login
# sobre ella.
function Find-UnidegesLoose {
  $porPid = @{}
  foreach ($proc in Get-Process) { $porPid[[long]$proc.Id] = $proc.ProcessName.ToLowerInvariant() }
  foreach ($par in [W32Menu]::VisibleWindows()) {
    $nombreProc = $porPid[[long]$par[1]]
    if ($nombreProc -and ($procesosExcluidos -contains $nombreProc)) { continue }
    $handle = [IntPtr]$par[0]
    $buf = New-Object System.Text.StringBuilder 512
    [W32Menu]::GetWindowText($handle, $buf, 512) | Out-Null
    $titulo = $buf.ToString()
    if (-not $titulo) { continue }
    if ($titulo -match $TitleRegex) { continue }
    if ($titulo -match 'unide|madisa') { return @{ Handle = $handle; Title = $titulo } }
  }
  return $null
}

function Open-UnidegesAndWait {
  # ¿Ya esta abierta pero parada en el login? Entrar por ahi, sin lanzar
  # una SEGUNDA instancia.
  if ($LoginUser) {
    $suelto = Find-UnidegesLoose
    if ($suelto) {
      $warnings.Add("La app parece ya abierta (ventana '$($suelto.Title)'): pruebo el login sin relanzar") | Out-Null
      Send-LoginKeys $suelto.Handle $suelto.Title | Out-Null
      for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Seconds 2
        $win = Find-MenuWindow
        if ($win) { return $win }
      }
      $warnings.Add("Ventanas visibles: $(Visible-Titles)") | Out-Null
      throw "Habia una ventana de UnideGes ('$($suelto.Title)') pero tras el login el menu no aparecio en 20 s. Mira la captura; no lanzo otra instancia."
    }
  }
  $lanzador = Find-Launcher
  if (-not $lanzador) {
    throw "No encontre con que abrir UnideGes: ni exePath configurado ni acceso directo (patron '$ShortcutRegex') en Escritorio/Menu Inicio. Dime como se llama el icono del escritorio y lo configuro."
  }
  # Foto de los pids de ANTES: cualquier ventana de un pid nuevo despues de
  # lanzar es de UnideGes (o su login), venga del lnk o de un hijo.
  $pidsAntes = New-Object System.Collections.Generic.HashSet[long]
  foreach ($proc in Get-Process) { $pidsAntes.Add([long]$proc.Id) | Out-Null }
  $warnings.Add("Abriendo: $lanzador") | Out-Null
  Start-Process -FilePath $lanzador | Out-Null
  $loginsHechos = 0
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 2
    $win = Find-MenuWindow
    if ($win) { return $win }
    # Darle un par de segundos al dialogo antes del primer intento; como
    # mucho dos intentos de login para no teclear a ciegas en bucle.
    if ($i -ge 1 -and $loginsHechos -lt 2) {
      if (Try-Login $pidsAntes) { $loginsHechos++ ; Start-Sleep -Seconds 2 }
    }
  }
  $warnings.Add("Ventanas visibles al agotar la espera: $(Visible-Titles)") | Out-Null
  throw "Lance '$lanzador' pero la ventana del menu ($TitleRegex) no aparecio en 90 s. Mira la captura y las ventanas listadas abajo para ver que se abrio."
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
