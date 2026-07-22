param(
  [Parameter(Mandatory = $true)][string]$Accion,   # estado | abrir | modulo
  [string]$Tecla = "",                              # F1 F3 F6 F7 F12 (solo Accion=modulo)
  [string]$OutDir = "screenshots",
  [string]$ExePath = "",                            # exe o .lnk configurado; '' = buscar acceso directo
  [string]$TitleRegex = "^MadisaNet",
  [string]$ShortcutRegex = "madisa|unide",
  [string]$LoginUser = "1",                         # usuario del dialogo de acceso; '' = no auto-login
  [string]$LogsDir = ""                             # linea viva del panel + caja-negra.txt
)

# Conduce el MENU PRINCIPAL de UnideGes (ventana "MadisaNet"): traerlo al
# frente, abrir la aplicacion si esta cerrada y entrar a un modulo con su
# tecla F (F1 Inicio de dia, F3 Articulos, F6 Utilidades, F7 Albaranes,
# F12 Fin de dia). NO navega dentro de los modulos: abre la puerta, hace
# captura y el dueño ve en la foto que el modulo quedo abierto.
# Salida: una linea JSON en stdout (mismo contrato que unideges-search.ps1).
#
# REGLA DE ESTILO OBLIGATORIA (v223): dentro de cadenas "..." SOLO
# variables simples ($x / ${x}), JAMAS subexpresiones "$(...)". Windows
# PowerShell 5.1 (el que corre en la tienda) tiene rarezas de parseo con
# "$(...)" dentro de cadenas que mataron el script entero en v220-v222;
# pwsh 7 las acepta, asi que un chequeo con pwsh NO las detecta. Calcula
# primero en una variable y luego interpola.
# Y ADEMAS: el archivo se guarda CON BOM UTF-8 y las cadenas son ASCII
# puro. Sin BOM, PS 5.1 lee el archivo como ANSI y el guion largo (em
# dash) contiene el byte 0x94 = comilla tipografica, que CIERRA la cadena
# a mitad y descuadra todas las llaves (el fallo real de v220-v223).

$ErrorActionPreference = "Stop"
# Si algo falla ANTES del try principal (p. ej. el interop no compila),
# hay que EMITIR JSON igualmente: sin esto el bot solo ve stderr suelto.
trap {
  $motivo = $_.Exception.Message
  try {
    (@{ status = 'error'; mensaje = "fallo antes de empezar: $motivo"; ventana = ''; screenshot = $null; warnings = @(); trace = @() } | ConvertTo-Json -Compress)
  } catch { Write-Output '{"status":"error","mensaje":"fallo antes de empezar"}' }
  exit 1
}
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
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, System.Text.StringBuilder lParam);
  [StructLayout(LayoutKind.Sequential)]
  public struct GUITHREADINFO {
    public int cbSize; public int flags;
    public IntPtr hwndActive; public IntPtr hwndFocus; public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret;
    public RECT rcCaret;
  }
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
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

# --- CAJA NEGRA -------------------------------------------------------
# Cada paso queda en $trace con su segundo relativo: que tecla se mando, en
# que ventana/control estaba el foco y QUE quedo escrito de verdad en la
# caja (WM_GETTEXT). La traza viaja en el JSON, la linea actual va a
# logs\desktop-estado.txt (estado vivo del panel) y cada linea se APPENDEA
# a logs\caja-negra.txt, que el panel enseña como un log mas.
$trace = New-Object System.Collections.Generic.List[string]
$cronometro = [System.Diagnostics.Stopwatch]::StartNew()
$estadoFile = ""
$cajaFile = ""
if ($LogsDir) {
  $estadoFile = Join-Path $LogsDir "desktop-estado.txt"
  $cajaFile = Join-Path $LogsDir "caja-negra.txt"
  $cabecera = Get-Date -Format "HH:mm:ss"
  try { Set-Content -LiteralPath $cajaFile -Value "= unideges $Accion $Tecla = $cabecera" -Encoding UTF8 } catch { $cajaFile = "" }
}

function Traza([string]$Texto) {
  $segundos = [Math]::Round($cronometro.Elapsed.TotalSeconds, 1)
  $linea = "+${segundos}s $Texto"
  $trace.Add($linea) | Out-Null
  if ($estadoFile) {
    try { Set-Content -LiteralPath $estadoFile -Value "unideges: $Texto" -Encoding UTF8 } catch { }
  }
  if ($cajaFile) {
    try { Add-Content -LiteralPath $cajaFile -Value $linea -Encoding UTF8 } catch { }
  }
}

function Aviso([string]$Texto) {
  $warnings.Add($Texto) | Out-Null
  Traza "AVISO: $Texto"
}

# Titulo de una ventana cualquiera.
function Titulo-De([IntPtr]$Handle) {
  $buf = New-Object System.Text.StringBuilder 512
  [W32Menu]::GetWindowText($Handle, $buf, 512) | Out-Null
  return $buf.ToString()
}

# ¿Donde esta el foco AHORA y que texto tiene ese control? (ventana en
# primer plano -> su hilo -> hwndFocus -> clase + WM_GETTEXT).
function Get-FocusInfo {
  try {
    $fg = [W32Menu]::GetForegroundWindow()
    $tituloFg = Titulo-De $fg
    $pidOwner = [uint32]0
    $tid = [W32Menu]::GetWindowThreadProcessId($fg, [ref]$pidOwner)
    $gui = New-Object W32Menu+GUITHREADINFO
    $gui.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($gui)
    $descFoco = "?"
    if ([W32Menu]::GetGUIThreadInfo($tid, [ref]$gui) -and $gui.hwndFocus -ne [IntPtr]::Zero) {
      $bufC = New-Object System.Text.StringBuilder 256
      [W32Menu]::GetClassName($gui.hwndFocus, $bufC, 256) | Out-Null
      $clase = $bufC.ToString()
      $bufT = New-Object System.Text.StringBuilder 512
      [W32Menu]::SendMessage($gui.hwndFocus, 0x000D, [IntPtr]512, $bufT) | Out-Null
      $textoCtrl = $bufT.ToString()
      $descFoco = "$clase texto='$textoCtrl'"
    }
    return "ventana '$tituloFg' foco: $descFoco"
  } catch {
    $motivo = $_.Exception.Message
    return "foco ilegible: $motivo"
  }
}

# Texto del control con el foco (para comparar con lo tecleado).
function Read-FocusText {
  try {
    $fg = [W32Menu]::GetForegroundWindow()
    $pidOwner = [uint32]0
    $tid = [W32Menu]::GetWindowThreadProcessId($fg, [ref]$pidOwner)
    $gui = New-Object W32Menu+GUITHREADINFO
    $gui.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($gui)
    if ([W32Menu]::GetGUIThreadInfo($tid, [ref]$gui) -and $gui.hwndFocus -ne [IntPtr]::Zero) {
      $bufT = New-Object System.Text.StringBuilder 512
      [W32Menu]::SendMessage($gui.hwndFocus, 0x000D, [IntPtr]512, $bufT) | Out-Null
      return $bufT.ToString()
    }
  } catch { }
  return $null
}

function Emit([string]$Status, [string]$Mensaje, [string]$Ventana, [string]$Shot) {
  if ($estadoFile) {
    try { Set-Content -LiteralPath $estadoFile -Value "" -Encoding UTF8 } catch { }
  }
  if ($cajaFile) {
    try { Add-Content -LiteralPath $cajaFile -Value "= fin: $Status $Mensaje" -Encoding UTF8 } catch { }
  }
  $out = [ordered]@{
    status = $Status
    mensaje = $Mensaje
    ventana = $Ventana
    screenshot = $Shot
    warnings = @($warnings)
    trace = @($trace)
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
    $titulo = Titulo-De $handle
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
  # Si UnideGes corre elevado y el bot no, el foco no cambia de verdad y
  # las teclas caerian en OTRA aplicacion.
  $fg = [W32Menu]::GetForegroundWindow()
  if ($fg -ne [IntPtr]$win.Handle) {
    $tituloDelante = Titulo-De $fg
    throw "No pude traer UnideGes al frente (delante esta '$tituloDelante'). Causa tipica: el bot no corre como administrador."
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
    $motivo = $_.Exception.Message
    Aviso "Screenshot failed: $motivo"
    return $null
  }
}

# Localiza con que abrir UnideGes: el ExePath configurado o, si no hay, un
# acceso directo (.lnk) del Escritorio / Menu Inicio. Se puntuan TODOS los
# candidatos ('unideges' > 'madisa' > 'unide' a secas) y se excluyen los
# del propio bot y herramientas (JARVIS, panel, edge debug, updater...).
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
    $lista = $vistos -join ', '
    Aviso "Accesos directos que casan pero se excluyeron: $lista"
  }
  return $mejor
}

# Titulos de las ventanas visibles AHORA (diagnostico cuando el menu no
# aparece: que se abrio en su lugar, si hay un login, etc).
function Visible-Titles {
  $titulos = New-Object System.Collections.Generic.List[string]
  foreach ($par in [W32Menu]::VisibleWindows()) {
    $t = Titulo-De ([IntPtr]$par[0])
    if ($t -and -not $titulos.Contains($t)) { $titulos.Add($t) | Out-Null }
  }
  return ($titulos | Select-Object -First 12) -join ' | '
}

# El dialogo de acceso (Usuario/Clave) del arranque. Receta EXACTA del
# dueño (20/07): al abrirse, el cursor YA esta en la primera caja — se
# teclea el usuario y Enter dos veces, sin clics. Activar la ventana de
# mas mueve el foco al desplegable (asi acabo el '1' alli en v216): solo
# se trae al frente si NO lo esta ya.
function Send-LoginKeys([IntPtr]$Handle, [string]$Titulo) {
  if ([W32Menu]::GetForegroundWindow() -ne $Handle) {
    Traza "login: la ventana no esta delante, la activo"
    [W32Menu]::SetForegroundWindow($Handle) | Out-Null
    Start-Sleep -Milliseconds 400
    if ([W32Menu]::GetForegroundWindow() -ne $Handle) {
      $foco = Get-FocusInfo
      Traza "login: no pude activarla - $foco"
      return $false
    }
  }
  Aviso "Login detectado (ventana '$Titulo'): usuario y Enter x2"
  $foco = Get-FocusInfo
  Traza "login: antes de teclear - $foco"
  [System.Windows.Forms.SendKeys]::SendWait($LoginUser)
  Start-Sleep -Milliseconds 300
  # Lectura de vuelta: ¿quedo el usuario escrito en la caja con el foco?
  $leido = Read-FocusText
  Traza "login: tecleado '$LoginUser', la caja con foco contiene '$leido'"
  if ($null -ne $leido -and $leido -ne $LoginUser) {
    Aviso "OJO: teclee '$LoginUser' pero la caja contiene '$leido' (foco en otro control?)"
  }
  Traza "login: Enter 1"
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  # El segundo campo (operario) tarda en rellenarse tras el primer Enter;
  # si el segundo Enter llega pronto no cuaja (20/07). Espera larga y,
  # mientras el dialogo siga delante sin menu, reintentos.
  Start-Sleep -Milliseconds 1500
  $foco = Get-FocusInfo
  Traza "login: tras Enter 1 - $foco"
  Traza "login: Enter 2"
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  for ($j = 0; $j -lt 3; $j++) {
    Start-Sleep -Milliseconds 1200
    if (Find-MenuWindow) { Traza "login: el menu ya esta a la vista"; break }
    if ([W32Menu]::GetForegroundWindow() -ne $Handle) {
      $foco = Get-FocusInfo
      Traza "login: el dialogo ya no esta delante - $foco"
      break
    }
    $intento = $j + 1
    Aviso "El dialogo sigue delante: Enter de nuevo ($intento)"
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  }
  return $true
}

function Try-Login($PidsAntes) {
  if (-not $LoginUser) { return $false }
  foreach ($par in [W32Menu]::VisibleWindows()) {
    if ($PidsAntes.Contains([long]$par[1])) { continue }
    $handle = [IntPtr]$par[0]
    $titulo = Titulo-De $handle
    if ($titulo -match $TitleRegex) { continue }
    if (Send-LoginKeys $handle $titulo) { return $true }
  }
  return $false
}

# La app puede estar YA abierta con el login delante (la abrio alguien a
# mano). Antes de lanzar OTRA instancia se busca una ventana suelta que
# parezca de UnideGes y se intenta el login sobre ella.
function Find-UnidegesLoose {
  $porPid = @{}
  foreach ($proc in Get-Process) { $porPid[[long]$proc.Id] = $proc.ProcessName.ToLowerInvariant() }
  foreach ($par in [W32Menu]::VisibleWindows()) {
    $nombreProc = $porPid[[long]$par[1]]
    if ($nombreProc -and ($procesosExcluidos -contains $nombreProc)) { continue }
    $handle = [IntPtr]$par[0]
    $titulo = Titulo-De $handle
    if (-not $titulo) { continue }
    if ($titulo -match $TitleRegex) { continue }
    if ($titulo -match 'unide|madisa') { return @{ Handle = $handle; Title = $titulo } }
  }
  return $null
}

function Open-UnidegesAndWait {
  # ¿Ya abierta pero parada en el login? Entrar por ahi, sin relanzar.
  if ($LoginUser) {
    $suelto = Find-UnidegesLoose
    if ($suelto) {
      $tituloSuelto = $suelto.Title
      Aviso "La app parece ya abierta (ventana '$tituloSuelto'): pruebo el login sin relanzar"
      Send-LoginKeys $suelto.Handle $tituloSuelto | Out-Null
      for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Seconds 2
        $win = Find-MenuWindow
        if ($win) { return $win }
      }
      $vistas = Visible-Titles
      Aviso "Ventanas visibles: $vistas"
      throw "Habia una ventana de UnideGes ('$tituloSuelto') pero tras el login el menu no aparecio en 20 s. Mira la caja negra; no lanzo otra instancia."
    }
  }
  $lanzador = Find-Launcher
  if (-not $lanzador) {
    throw "No encontre con que abrir UnideGes: ni exePath configurado ni acceso directo (patron '$ShortcutRegex') en Escritorio/Menu Inicio. Dime como se llama el icono del escritorio y lo configuro."
  }
  Traza "lanzo: $lanzador"
  # Foto de los pids de ANTES: cualquier ventana de un pid nuevo despues
  # de lanzar es de UnideGes (o su login), venga del lnk o de un hijo.
  $pidsAntes = New-Object System.Collections.Generic.HashSet[long]
  foreach ($proc in Get-Process) { $pidsAntes.Add([long]$proc.Id) | Out-Null }
  Aviso "Abriendo: $lanzador"
  Start-Process -FilePath $lanzador | Out-Null
  $loginsHechos = 0
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 2
    $win = Find-MenuWindow
    if ($win) { return $win }
    if ($i -ge 1 -and $loginsHechos -lt 2) {
      if (Try-Login $pidsAntes) {
        $loginsHechos++
        Start-Sleep -Seconds 2
      } elseif ($i % 5 -eq 1) {
        $segundos = $i * 2
        $foco = Get-FocusInfo
        Traza "espero al menu o al login (${segundos}s) - $foco"
      }
    }
  }
  $vistas = Visible-Titles
  Aviso "Ventanas visibles al agotar la espera: $vistas"
  throw "Lance '$lanzador' pero la ventana del menu ($TitleRegex) no aparecio en 90 s. Mira la caja negra para ver que se abrio."
}

try {
  if ($Accion -eq 'estado') {
    $win = Find-MenuWindow
    if ($win) { Emit 'ok' 'abierta' $win.Title $null } else { Emit 'ok' 'cerrada' '' $null }
    exit 0
  }

  if ($Accion -eq 'abrir') {
    Traza "accion abrir: busco la ventana del menu"
    $win = Find-MenuWindow
    $yaEstaba = [bool]$win
    if ($yaEstaba) {
      $tituloMenu = $win.Title
      Traza "menu encontrado: '$tituloMenu'"
    } else {
      Traza "menu no encontrado: toca abrir la app"
      $win = Open-UnidegesAndWait
    }
    Focus-MenuWindow $win
    $shot = Take-MenuShot 'abrir'
    $msg = if ($yaEstaba) { 'ya estaba abierto; lo he traido al frente' } else { 'abierto' }
    Emit 'ok' $msg $win.Title $shot
    exit 0
  }

  if ($Accion -eq 'modulo') {
    # Lista blanca dura: SOLO las teclas del menu principal pedidas.
    $teclasPermitidas = @('F1', 'F3', 'F6', 'F7', 'F12')
    if ($teclasPermitidas -notcontains $Tecla) {
      $validas = $teclasPermitidas -join ', '
      throw "Tecla no permitida: '$Tecla' (validas: $validas)"
    }
    Traza "accion modulo: tecla $Tecla"
    $win = Find-MenuWindow
    if (-not $win) { Traza "menu no encontrado: abro la app primero"; $win = Open-UnidegesAndWait }
    Focus-MenuWindow $win
    $tituloMenu = $win.Title
    Traza "menu delante ('$tituloMenu') - mando la tecla $Tecla"
    [System.Windows.Forms.SendKeys]::SendWait("{$Tecla}")
    # El modulo tarda un momento en pintar; la captura es la prueba de vida.
    Start-Sleep -Milliseconds 2500
    $foco = Get-FocusInfo
    Traza "tras la tecla ${Tecla}: $foco"
    $shot = Take-MenuShot "modulo-$Tecla"
    $fg = [W32Menu]::GetForegroundWindow()
    $tituloFinal = Titulo-De $fg
    Emit 'ok' "tecla $Tecla enviada" $tituloFinal $shot
    exit 0
  }

  throw "Accion desconocida: $Accion (validas: estado, abrir, modulo)"
} catch {
  $motivo = $_.Exception.Message
  Traza "ERROR: $motivo"
  $shot = Take-MenuShot 'error'
  Emit 'error' $motivo '' $shot
  exit 1
}
