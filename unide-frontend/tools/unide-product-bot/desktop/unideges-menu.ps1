param(
  [Parameter(Mandatory = $true)][string]$Accion,   # estado | abrir | modulo | albaran | lmanma
  [string]$Tecla = "",                              # F1 F3 F6 F7 F12 (modulo/albaran/lmanma)
  [string]$Submenu = "",                            # patron del submenu a abrir DENTRO del modulo
  [string]$Fase = "",                               # albaran: 'leer' (solo mirar) | 'procesar'
  [string]$Archivo = "",                            # lmanma: ruta completa del fichero a procesar
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
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(UInt32 dwFlags, UInt32 dx, UInt32 dy, UInt32 dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  // TODAS las ventanas top-level visibles con su pid: la del menu puede no
  // ser la "MainWindow" del proceso cuando hay un modulo abierto delante.
  // Controles hijos de una ventana (para localizar el boton Aceptar).
  public static System.Collections.Generic.List<long> ChildWindows(IntPtr parent) {
    var list = new System.Collections.Generic.List<long>();
    EnumChildWindows(parent, delegate(IntPtr h, IntPtr l) { list.Add(h.ToInt64()); return true; }, IntPtr.Zero);
    return list;
  }
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
  # Linea final ESTRUCTURADA (legible por maquina y de un vistazo): la
  # narrativa esta arriba; esta linea dice que paso sin leer español.
  $durSeg = [Math]::Round($cronometro.Elapsed.TotalSeconds, 1)
  $resumenCorto = ($Mensaje -split "`n")[0]
  if ($resumenCorto.Length -gt 100) { $resumenCorto = $resumenCorto.Substring(0, 100) }
  # Claves SIEMPRE identicas a las del RESULT de login (peticion del
  # dueño): step= status= intentos= duration= msg= — un solo formato que
  # parsear, hoy a ojo y mañana por programa.
  $stepGlobal = $Accion
  if ($Tecla) { $stepGlobal = "$Accion-$Tecla" }
  $lineaResult = "RESULT: step=$stepGlobal status=$Status intentos=1 duration=${durSeg}s msg=$resumenCorto"
  $trace.Add($lineaResult) | Out-Null
  if ($cajaFile) {
    try { Add-Content -LiteralPath $cajaFile -Value $lineaResult -Encoding UTF8 } catch { }
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

# --- PROCESADO (v261): utilidades UIA genericas -----------------------
# El procesado de albaranes y LMANMA trabaja sobre VENTANAS NUEVAS que
# abre UnideGes (la lista 'Ficheros albaran electronico', el dialogo
# 'Seleccione fecha', el 'Abrir' de Windows). Estas utilidades las
# localizan por titulo+pid, listan su contenido a la caja negra y pulsan
# botones por nombre. Regla de la casa: TODO se vuelca a la caja negra,
# porque cada instalacion de UnideGes es una caja de sorpresas.

function Uia-Raiz([IntPtr]$Handle) {
  try {
    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
    Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
  } catch { return $null }
  try { return [System.Windows.Automation.AutomationElement]::FromHandle($Handle) } catch { return $null }
}

function Uia-Hijos($Raiz) {
  if (-not $Raiz) { return $null }
  try { return $Raiz.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) } catch { return $null }
}

function Volcar-Elementos($Todos, [string]$Etiqueta, [int]$Max) {
  if (-not $Todos) { Traza "$Etiqueta : UIA no dio elementos"; return }
  $n = $Todos.Count
  Traza "$Etiqueta : $n elementos; con nombre:"
  $vistos = 0
  foreach ($el in $Todos) {
    if ($vistos -ge $Max) { break }
    $nombre = ""
    try { $nombre = [string]$el.Current.Name } catch { $nombre = "" }
    if ($nombre -eq "") { continue }
    $tipo = ""
    try { $tipo = [string]$el.Current.ControlType.ProgrammaticName } catch { $tipo = "" }
    $tipoCorto = $tipo -replace "ControlType\.", ""
    $linea = "  - [" + $tipoCorto + "] " + $nombre
    Traza $linea
    $vistos = $vistos + 1
  }
}

# Filas de datos de una lista (ListView/DataGrid): lo mas parecido a
# "cuantos albaranes hay pendientes" sin conocer el control exacto.
# Fallo real 25/07 20:16: la ventana tenia 3 filas A LA VISTA y el conteo
# por DataItem/ListItem dio 0 (el control no expone filas estandar). Tres
# senales y gana la mayor: items estandar, nombres que acaban en .FEL
# (sin duplicados) y casillas de fila.
function Contar-Filas($Todos) {
  if (-not $Todos) { return 0 }
  $items = 0
  $checks = 0
  $felVistos = @{}
  foreach ($el in $Todos) {
    $tipo = ""
    try { $tipo = [string]$el.Current.ControlType.ProgrammaticName } catch { $tipo = "" }
    if ($tipo -match 'DataItem|ListItem') { $items = $items + 1 }
    if ($tipo -match 'CheckBox') { $checks = $checks + 1 }
    $nombre = ""
    try { $nombre = [string]$el.Current.Name } catch { $nombre = "" }
    if ($nombre -match '\.FEL\s*$') { $felVistos[$nombre] = $true }
  }
  $fel = $felVistos.Count
  $n = $items
  if ($fel -gt $n) { $n = $fel }
  if ($checks -gt $n) { $n = $checks }
  Traza "contar filas: items=$items fel=$fel casillas=$checks -> $n"
  return $n
}

# Nombres de fichero .FEL visibles (hasta 10, sin duplicados): para que el
# bot pueda decirle al dueno QUE hay en la lista, no solo cuantos.
function Listar-Fel($Todos) {
  $vistos = @{}
  $lista = New-Object System.Collections.Generic.List[string]
  if (-not $Todos) { return $lista }
  foreach ($el in $Todos) {
    if ($lista.Count -ge 10) { break }
    $nombre = ""
    try { $nombre = [string]$el.Current.Name } catch { $nombre = "" }
    if ($nombre -notmatch '\.FEL\s*$') { continue }
    if ($vistos.ContainsKey($nombre)) { continue }
    $vistos[$nombre] = $true
    $lista.Add($nombre) | Out-Null
  }
  return $lista
}

# Pulsa el primer elemento cuyo nombre case el patron (Invoke →
# SelectionItem → clic real en el centro, igual que Entrar-Submenu).
function Activar-PorNombre($Raiz, [string]$Patron, [string]$Etiqueta) {
  $todos = Uia-Hijos $Raiz
  if (-not $todos) { Traza "$Etiqueta : sin elementos UIA"; return $false }
  $objetivo = $null
  foreach ($el in $todos) {
    $nombre = ""
    try { $nombre = [string]$el.Current.Name } catch { $nombre = "" }
    if ($nombre -eq "") { continue }
    $tipo = ""
    try { $tipo = [string]$el.Current.ControlType.ProgrammaticName } catch { $tipo = "" }
    if ($tipo -match 'Window|TitleBar') { continue }
    if ($nombre -match $Patron) { $objetivo = $el; break }
  }
  if (-not $objetivo) { Traza "$Etiqueta : nada casa con '$Patron'"; return $false }
  $nombreObj = ""
  try { $nombreObj = [string]$objetivo.Current.Name } catch { $nombreObj = "?" }
  Traza "$Etiqueta : encontrado '$nombreObj', lo pulso"
  try {
    $inv = $objetivo.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $inv.Invoke()
    Traza "$Etiqueta : pulsado con Invoke"
    return $true
  } catch { }
  try {
    $sel = $objetivo.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $sel.Select()
    Traza "$Etiqueta : seleccionado con SelectionItem"
    return $true
  } catch { }
  try {
    $r = $objetivo.Current.BoundingRectangle
    $cx = [int]($r.X + $r.Width / 2)
    $cy = [int]($r.Y + $r.Height / 2)
    [W32Menu]::SetCursorPos($cx, $cy) | Out-Null
    Start-Sleep -Milliseconds 120
    [W32Menu]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [W32Menu]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Traza "$Etiqueta : clic en ${cx},${cy}"
    return $true
  } catch {
    $porQue = $_.Exception.Message
    Traza "$Etiqueta : no pude pulsarlo - $porQue"
    return $false
  }
}

# Ventana top-level por titulo (y pid si se pasa >0), excluyendo navegadores.
function Find-VentanaTitulo([string]$Regex, [long]$PidFiltro) {
  $porPid = @{}
  foreach ($proc in Get-Process) { $porPid[[long]$proc.Id] = $proc.ProcessName.ToLowerInvariant() }
  foreach ($par in [W32Menu]::VisibleWindows()) {
    if ($PidFiltro -gt 0 -and [long]$par[1] -ne $PidFiltro) { continue }
    $nombreProc = $porPid[[long]$par[1]]
    if ($nombreProc -and ($procesosExcluidos -contains $nombreProc)) { continue }
    $handle = [IntPtr]$par[0]
    $titulo = Titulo-De $handle
    if ($titulo -and $titulo -match $Regex) { return @{ Handle = $handle; Title = $titulo; ProcId = [long]$par[1] } }
  }
  return $null
}

function Wait-VentanaTitulo([string]$Regex, [int]$Segundos, [long]$PidFiltro) {
  $tope = [DateTime]::Now.AddSeconds($Segundos)
  while ([DateTime]::Now -lt $tope) {
    $v = Find-VentanaTitulo $Regex $PidFiltro
    if ($v) { return $v }
    Start-Sleep -Milliseconds 400
  }
  return $null
}

# Marca de PASO para el arbol de flujo del panel: el bot las lee de la
# traza y enciende el nodo correspondiente. Formato fijo y sin acentos,
# que lo parsea una expresion regular:  PASO: <id> <ok|fail> <detalle>
function Paso([string]$Id, [string]$Estado, [string]$Detalle) {
  Traza "PASO: $Id $Estado $Detalle"
}

# --- FILAS AZULES de la pantalla de revision (peticion del dueno, 25/07)
# Las filas AZULES son articulos con problemas: hay que abrirlos con F5 y
# mirar que les pasa ANTES de aceptar los cambios. El grid es de dibujo
# propio (el volcado UIA de la ventana de albaranes no expone ni una fila),
# asi que se detectan MIRANDO LOS PIXELES de la ventana: se muestrean
# varias X por cada linea de altura y se busca el azul (B claramente por
# encima de R y G). Ademas se vuelca un histograma de colores de fondo a
# la caja negra, que es lo que permitira afinar el umbral con datos reales.
function Analizar-FilasAzules([IntPtr]$Handle) {
  $salida = @{ bandas = New-Object System.Collections.Generic.List[object]; resumen = ''; alto = 0; ancho = 0 }
  $rect = New-Object W32Menu+RECT
  $okRect = [W32Menu]::GetWindowRect($Handle, [ref]$rect)
  if (-not $okRect) { $salida.resumen = 'no pude medir la ventana'; return $salida }
  $ancho = $rect.Right - $rect.Left
  $alto = $rect.Bottom - $rect.Top
  $salida.ancho = $ancho
  $salida.alto = $alto
  if ($ancho -le 20 -or $alto -le 20) { $salida.resumen = 'ventana demasiado pequena'; return $salida }
  $bmp = $null
  $g = $null
  try {
    $bmp = New-Object System.Drawing.Bitmap $ancho, $alto
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $origen = New-Object System.Drawing.Point $rect.Left, $rect.Top
    $tam = New-Object System.Drawing.Size $ancho, $alto
    $g.CopyFromScreen($origen, [System.Drawing.Point]::Empty, $tam)
  } catch {
    $porQue = $_.Exception.Message
    $salida.resumen = "no pude capturar la ventana - $porQue"
    if ($g) { $g.Dispose() }
    if ($bmp) { $bmp.Dispose() }
    return $salida
  }
  # X de muestreo: repartidas por la mitad izquierda, que es donde estan
  # las columnas de datos (a la derecha suele haber zona vacia).
  $xs = New-Object System.Collections.Generic.List[int]
  foreach ($frac in @(0.06, 0.12, 0.20, 0.28, 0.36, 0.44)) {
    $x = [int]($ancho * $frac)
    if ($x -ge 0 -and $x -lt $ancho) { $xs.Add($x) | Out-Null }
  }
  $histograma = @{}
  $yAzules = New-Object System.Collections.Generic.List[int]
  for ($y = 0; $y -lt $alto; $y = $y + 2) {
    $azules = 0
    $clave = ''
    foreach ($x in $xs) {
      $c = $bmp.GetPixel($x, $y)
      $rr = [int]$c.R
      $gg = [int]$c.G
      $bb = [int]$c.B
      if ($bb -gt ($rr + 30) -and $bb -gt ($gg + 30) -and $bb -gt 90) { $azules = $azules + 1 }
      if ($clave -eq '') { $clave = "$rr,$gg,$bb" }
    }
    if ($histograma.ContainsKey($clave)) { $histograma[$clave] = [int]$histograma[$clave] + 1 } else { $histograma[$clave] = 1 }
    # Mayoria de las muestras en azul = linea de una fila azul (no un
    # icono ni un borde suelto).
    if ($azules -ge ([int]($xs.Count / 2) + 1)) { $yAzules.Add($y) | Out-Null }
  }
  $g.Dispose()
  $bmp.Dispose()

  # Agrupar las lineas azules contiguas en BANDAS (cada banda = una fila).
  $bandaIni = -1
  $bandaFin = -1
  foreach ($y in $yAzules) {
    if ($bandaIni -lt 0) { $bandaIni = $y; $bandaFin = $y; continue }
    if (($y - $bandaFin) -le 4) { $bandaFin = $y; continue }
    $altoBanda = $bandaFin - $bandaIni
    if ($altoBanda -ge 6) { $salida.bandas.Add(@{ Y = $rect.Top + [int](($bandaIni + $bandaFin) / 2); Alto = $altoBanda }) | Out-Null }
    $bandaIni = $y
    $bandaFin = $y
  }
  if ($bandaIni -ge 0) {
    $altoBanda = $bandaFin - $bandaIni
    if ($altoBanda -ge 6) { $salida.bandas.Add(@{ Y = $rect.Top + [int](($bandaIni + $bandaFin) / 2); Alto = $altoBanda }) | Out-Null }
  }

  # Histograma a la caja negra: con esto se calibra el umbral de verdad.
  $top = $histograma.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 8
  $trozos = New-Object System.Collections.Generic.List[string]
  foreach ($par in $top) {
    $col = $par.Key
    $veces = $par.Value
    $trozos.Add("$col x$veces") | Out-Null
  }
  $salida.resumen = $trozos -join ' | '
  return $salida
}

# El boton de cambios ALTERNA su texto segun el estado: 'Aceptar Todos
# Cambio' cuando pulsarlo aceptaria todo, 'Descartar Todos Cambio' cuando
# pulsarlo lo descartaria. Devuelve 'aceptar', 'descartar' o ''.
function Estado-BotonCambios($Raiz) {
  $todos = Uia-Hijos $Raiz
  if (-not $todos) { return '' }
  foreach ($el in $todos) {
    $nombre = ''
    try { $nombre = [string]$el.Current.Name } catch { $nombre = '' }
    if ($nombre -eq '') { continue }
    if ($nombre -match 'Descartar\s+Todos') { return 'descartar' }
    if ($nombre -match 'Aceptar\s+Todos') { return 'aceptar' }
  }
  return ''
}

# Deja TODOS los cambios aceptados ($Aceptar = $true) o TODOS descartados.
# Como el boton alterna, se pulsa hasta que su texto dice lo contrario de
# lo que acabamos de hacer (aceptado todo => el boton ofrece 'Descartar').
function Poner-Cambios([IntPtr]$Handle, [bool]$Aceptar) {
  $meta = 'aceptar'
  if ($Aceptar) { $meta = 'descartar' }
  for ($i = 0; $i -lt 3; $i = $i + 1) {
    $raiz = Uia-Raiz $Handle
    if (-not $raiz) { return $false }
    $estado = Estado-BotonCambios $raiz
    if ($estado -eq '') { Traza "cambios: no encuentro el boton de todos los cambios"; return $false }
    if ($estado -eq $meta) { return $true }
    $queEs = $estado
    Traza "cambios: el boton dice '$queEs', lo pulso"
    Activar-PorNombre $raiz 'Aceptar\s+Todos|Descartar\s+Todos' 'todos los cambios' | Out-Null
    Start-Sleep -Milliseconds 1500
  }
  $raizFin = Uia-Raiz $Handle
  $estadoFin = ''
  if ($raizFin) { $estadoFin = Estado-BotonCambios $raizFin }
  return ($estadoFin -eq $meta)
}

# Ventana top-level del proceso que CONTIENE un elemento con ese nombre.
# Mas fiable que el titulo: la pantalla de revision de precios del albaran
# y la de etiquetas no tienen titulo estable, pero sus botones si.
function Find-VentanaConElemento([string]$Patron, [long]$ProcId) {
  foreach ($par in [W32Menu]::VisibleWindows()) {
    if ([long]$par[1] -ne $ProcId) { continue }
    $h = [IntPtr]$par[0]
    $r = Uia-Raiz $h
    if (-not $r) { continue }
    $todos = Uia-Hijos $r
    if (-not $todos) { continue }
    foreach ($el in $todos) {
      $nombre = ""
      try { $nombre = [string]$el.Current.Name } catch { $nombre = "" }
      if ($nombre -eq "") { continue }
      if ($nombre -match $Patron) {
        $t = Titulo-De $h
        return @{ Handle = $h; Title = $t; ProcId = [long]$par[1] }
      }
    }
  }
  return $null
}

# Ventanas nuevas que NO conocemos: volcado a la caja negra sin tocarlas.
# Es el mecanismo que nos ha ido ensenando el flujo real paso a paso.
function Apuntar-VentanasNuevas([long]$ProcId, $Vistos, [string]$Excluir) {
  foreach ($par in [W32Menu]::VisibleWindows()) {
    if ([long]$par[1] -ne $ProcId) { continue }
    $clave = [string]$par[0]
    if ($Vistos.ContainsKey($clave)) { continue }
    $Vistos[$clave] = $true
    $h = [IntPtr]$par[0]
    $t = Titulo-De $h
    if (-not $t) { continue }
    if ($Excluir -ne "" -and $t -match $Excluir) { continue }
    Traza "ventana nueva: '$t' (no la toco, solo la apunto)"
    $r = Uia-Raiz $h
    if ($r) {
      $todos = Uia-Hijos $r
      Volcar-Elementos $todos "ventana '$t'" 20
    }
  }
}

# Tras pulsar Procesar: atender 'Codigos desconocidos' (regla del dueno:
# Aceptar) y esperar a que aparezca la PANTALLA DE REVISION DE PRECIOS.
# Cualquier otra ventana se vuelca a la caja negra sin tocarla. Devuelve
# cuantos avisos se atendieron y la ventana de revision (o $null).
function Preparar-Revision([long]$ProcId, [int]$Segundos) {
  $res = @{ desconocidos = 0; ventana = $null }
  $vistos = @{}
  $intentosDesconocidos = 0
  foreach ($par in [W32Menu]::VisibleWindows()) { $vistos[[string]$par[0]] = $true }
  $tope = [DateTime]::Now.AddSeconds($Segundos)
  while ([DateTime]::Now -lt $tope) {
    Start-Sleep -Milliseconds 700

    $des = Find-VentanaTitulo 'C.digos desconocidos' $ProcId
    if ($des -and $intentosDesconocidos -lt 3 -and $res.desconocidos -lt 15) {
      $tituloD = $des.Title
      $rD = Uia-Raiz $des.Handle
      if ($rD) { Volcar-Elementos (Uia-Hijos $rD) "dialogo '$tituloD'" 15 }
      Traza "preparar: 'Codigos desconocidos' -> Aceptar (regla del dueno)"
      $okAce = $false
      $rD2 = Uia-Raiz $des.Handle
      if ($rD2) { $okAce = Activar-PorNombre $rD2 '^\s*Aceptar\s*$' 'codigos desconocidos' }
      Start-Sleep -Milliseconds 1800
      $sigue = Find-VentanaTitulo 'C.digos desconocidos' $ProcId
      if ($okAce -and (-not $sigue -or [long]$sigue.Handle -ne [long]$des.Handle)) {
        $res.desconocidos = $res.desconocidos + 1
        $intentosDesconocidos = 0
        Paso 'alb-desconocidos' 'ok' ''
      } else {
        $intentosDesconocidos = $intentosDesconocidos + 1
        Traza "sigue abierto tras Aceptar (intento $intentosDesconocidos de 3)"
      }
      continue
    }

    $rev = Find-VentanaConElemento 'Aceptar\s+Todos|Descartar\s+Todos' $ProcId
    if ($rev) {
      $tituloR = $rev.Title
      Traza "preparar: pantalla de revision de precios delante ('$tituloR')"
      $res.ventana = $rev
      return $res
    }

    Apuntar-VentanasNuevas $ProcId $vistos 'C.digos desconocidos'
  }
  Traza "preparar: se agoto la espera sin ver la pantalla de revision"
  return $res
}

# Tras pulsar Confirmar: responder Si al aviso de que el proceso es
# irreversible, cerrar la ventana de etiquetas MADISA (el dueno las
# imprime a mano) y cerrar la ventana de revision ya procesada, para
# dejar sitio al albaran siguiente.
function Cerrar-Proceso([long]$ProcId, [int]$Segundos) {
  $res = @{ si = 0; etiquetas = 0; cerradas = 0 }
  $vistos = @{}
  $intentosEtiquetas = @{}
  $intentosCierre = @{}
  foreach ($par in [W32Menu]::VisibleWindows()) { $vistos[[string]$par[0]] = $true }
  $tope = [DateTime]::Now.AddSeconds($Segundos)
  while ([DateTime]::Now -lt $tope) {
    Start-Sleep -Milliseconds 700

    # 1) El modal manda: 'el proceso de confirmacion es irreversible'.
    $dlg = Find-VentanaConElemento 'irreversible' $ProcId
    if ($dlg) {
      Traza "cerrar: 'la confirmacion es irreversible' -> Si (regla del dueno)"
      $rd = Uia-Raiz $dlg.Handle
      # 'Si' con y sin tilde; la tilde va como escape de regex .NET para
      # no meter un byte no ASCII en este fichero.
      if ($rd) { Activar-PorNombre $rd '^\s*S(i|\u00ed)\s*$' 'confirmar irreversible' | Out-Null }
      Start-Sleep -Milliseconds 1800
      $res.si = $res.si + 1
      Paso 'alb-si' 'ok' ''
      continue
    }

    # 2) Ventana de etiquetas -> cerrar sin imprimir.
    $etq = Find-VentanaConElemento 'Imprimir\s+Etiquetas' $ProcId
    if ($etq) {
      $claveE = [string]([long]$etq.Handle)
      $yaVa = 0
      if ($intentosEtiquetas.ContainsKey($claveE)) { $yaVa = [int]$intentosEtiquetas[$claveE] }
      if ($yaVa -lt 2) {
        $intentosEtiquetas[$claveE] = $yaVa + 1
        Traza "cerrar: ventana de etiquetas -> la cierro (el dueno las imprime a mano)"
        [W32Menu]::SendMessage($etq.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
        Start-Sleep -Milliseconds 1500
        $res.etiquetas = $res.etiquetas + 1
        Paso 'alb-etiquetas' 'ok' ''
        continue
      }
    }

    # 3) La revision ya confirmada: cerrarla para pasar al siguiente.
    $rev = Find-VentanaConElemento 'Aceptar\s+Todos|Descartar\s+Todos' $ProcId
    if ($rev) {
      $claveR = [string]([long]$rev.Handle)
      $yaVaR = 0
      if ($intentosCierre.ContainsKey($claveR)) { $yaVaR = [int]$intentosCierre[$claveR] }
      if ($yaVaR -lt 2) {
        $intentosCierre[$claveR] = $yaVaR + 1
        Traza "cerrar: ventana del albaran procesado -> la cierro"
        [W32Menu]::SendMessage($rev.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
        Start-Sleep -Milliseconds 1800
        $res.cerradas = $res.cerradas + 1
        Paso 'alb-cerrar' 'ok' ''
        continue
      }
      # No se deja cerrar: se queda ahi y el dueno lo vera en la captura.
      break
    }

    # 4) Ni modal, ni etiquetas, ni revision: hemos terminado.
    Apuntar-VentanasNuevas $ProcId $vistos ''
    if ($res.si -gt 0) { break }
  }
  return $res
}

# CICLO del procesado LMANMA. Reglas del dueno (25/07, video):
#   - 'Errores: alguna linea del fichero era incorrecta' -> Aceptar (el
#     propio aviso dice que despues el proceso continua)
#   - ventana 'Proceso fichero LMmama' -> boton 'Procesar normal'
#   - lo demas: caja negra sin tocar
function Ciclo-Lmanma([long]$ProcId, [int]$SegundosIdle, [int]$TopeTotal) {
  $res = @{ errores = 0; procesado = 0; ventanaAbierta = 0 }
  $inicio = [DateTime]::Now
  $ultima = [DateTime]::Now
  $vistos = @{}
  $intentosProcesar = @{}
  $intentosErrores = 0
  foreach ($par in [W32Menu]::VisibleWindows()) { $vistos[[string]$par[0]] = $true }
  while ($true) {
    $sinNovedad = ([DateTime]::Now - $ultima).TotalSeconds
    $total = ([DateTime]::Now - $inicio).TotalSeconds
    if ($sinNovedad -ge $SegundosIdle) { break }
    if ($total -ge $TopeTotal) { Traza "ciclo lmanma: tope de tiempo, lo dejo aqui"; break }
    Start-Sleep -Milliseconds 700

    # 1) Aviso de lineas incorrectas -> Aceptar y seguir.
    $err = Find-VentanaConElemento 'l.nea del fichero era incorrecta' $ProcId
    if ($err -and $intentosErrores -lt 3) {
      Traza "ciclo lmanma: aviso de lineas incorrectas -> Aceptar (el proceso sigue)"
      $re = Uia-Raiz $err.Handle
      $okE = $false
      if ($re) {
        $todosE = Uia-Hijos $re
        Volcar-Elementos $todosE 'aviso de errores' 15
        $okE = Activar-PorNombre $re '^\s*Aceptar\s*$' 'aviso de errores'
      }
      Start-Sleep -Milliseconds 1500
      if ($okE) { $res.errores = $res.errores + 1 } else { $intentosErrores = $intentosErrores + 1 }
      $ultima = [DateTime]::Now
      continue
    }

    # 2) Ventana de proceso del fichero -> 'Procesar normal'.
    $proc = Find-VentanaConElemento 'Procesar\s+normal' $ProcId
    if ($proc) {
      $claveP = [string]([long]$proc.Handle)
      $yaVa = 0
      if ($intentosProcesar.ContainsKey($claveP)) { $yaVa = [int]$intentosProcesar[$claveP] }
      if ($yaVa -lt 2) {
        $intentosProcesar[$claveP] = $yaVa + 1
        $rp = Uia-Raiz $proc.Handle
        if ($rp) {
          $todosP = Uia-Hijos $rp
          Volcar-Elementos $todosP 'proceso del fichero LMmama' 40
          Traza "ciclo lmanma: pulso 'Procesar normal' (regla del dueno)"
          Activar-PorNombre $rp 'Procesar\s+normal' 'procesar normal' | Out-Null
          $res.procesado = $res.procesado + 1
        }
        Start-Sleep -Milliseconds 2500
        $ultima = [DateTime]::Now
        continue
      }
      # Sigue ahi tras pulsarlo: casi seguro el boton estaba en gris
      # (fichero con lineas invalidas, p. ej. un .FEL de albaran).
      $res.ventanaAbierta = 1
    }

    # 3) Lo desconocido: caja negra.
    Apuntar-VentanasNuevas $ProcId $vistos ''
  }
  return $res
}

# Escribe la ruta del fichero en el dialogo 'Abrir' de Windows: primero el
# Edit que se llame como el campo de nombre; si no, el primer Edit que
# acepte ValuePattern (el de busqueda de arriba no suele aceptar SetValue
# con una ruta, y aunque la tome, el boton Abrir no haria nada malo).
function Poner-NombreFichero($Raiz, [string]$Ruta) {
  $todos = Uia-Hijos $Raiz
  if (-not $todos) { return $false }
  $porNombre = $null
  $primero = $null
  foreach ($el in $todos) {
    $tipo = ""
    try { $tipo = [string]$el.Current.ControlType.ProgrammaticName } catch { $tipo = "" }
    if ($tipo -notmatch 'Edit|ComboBox') { continue }
    $nombre = ""
    try { $nombre = [string]$el.Current.Name } catch { $nombre = "" }
    if (-not $primero) { $primero = $el }
    if ($nombre -match 'nombre|file name|archivo') { $porNombre = $el; break }
  }
  foreach ($candidato in @($porNombre, $primero)) {
    if (-not $candidato) { continue }
    try {
      $vp = $candidato.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $vp.SetValue($Ruta)
      Traza "abrir: ruta escrita en el campo del nombre"
      return $true
    } catch { }
  }
  Traza "abrir: ningun campo acepto la ruta"
  return $false
}

# Dialogos SUELTOS de una corrida anterior ('Abrir' de LMMAMA, 'Seleccione
# fecha'): abiertos roban el foco y las teclas. Se cierran con Cancelar
# (que no procesa nada) o, si no hay boton, con ESC. Solo esos titulos:
# jamas se cierra nada mas.
function Cerrar-DialogosSueltos([long]$ProcId) {
  foreach ($patron in @('^Abrir$', 'Seleccione fecha')) {
    $v = Find-VentanaTitulo $patron $ProcId
    if (-not $v) { continue }
    $tituloV = $v.Title
    Traza "dialogo suelto de antes: '$tituloV' - lo cierro con Cancelar"
    $r = Uia-Raiz $v.Handle
    $cerrado = $false
    if ($r) { $cerrado = Activar-PorNombre $r '^\s*Cancelar\s*$' 'limpiar dialogo' }
    if (-not $cerrado) {
      [W32Menu]::SetForegroundWindow($v.Handle) | Out-Null
      Start-Sleep -Milliseconds 300
      [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
      Traza "limpiar dialogo: mando ESC"
    }
    Start-Sleep -Milliseconds 600
  }
}

# Navegacion comun de los procesados: menu delante + tecla F + submenu.
# Antes de nada se limpian dialogos sueltos de corridas anteriores.
function Entrar-ModuloYSubmenu([string]$TeclaF, [string]$PatronSub) {
  $win = Find-MenuWindow
  if (-not $win) { Traza "menu no encontrado: abro la app primero"; $win = Open-UnidegesAndWait }
  Cerrar-DialogosSueltos $win.ProcId
  Focus-MenuWindow $win
  $tituloMenu = $win.Title
  Traza "menu delante ('$tituloMenu') - mando la tecla $TeclaF"
  [System.Windows.Forms.SendKeys]::SendWait("{$TeclaF}")
  Start-Sleep -Milliseconds 2500
  $okSub = Entrar-Submenu $PatronSub $win
  if (-not $okSub) { throw "no encontre el submenu (patron '$PatronSub'); mira la lista de la caja negra" }
  return $win
}

# Localiza con que abrir UnideGes: el ExePath configurado o, si no hay, un
# acceso directo (.lnk) del Escritorio / Menu Inicio. Se puntuan TODOS los
# candidatos ('unideges' > 'madisa' > 'unide' a secas) y se excluyen los
# del propio bot y herramientas (JARVIS, panel, edge debug, updater...).
# Dentro de un modulo ya abierto: vuelca los nombres de lo que hay (a la
# caja negra) y activa el primero que case con el patron. Devuelve $true
# si lo activo. Primera version a ciegas (24/07): el VOLCADO es la parte
# importante, porque es lo que nos dice que hay dentro sin estar alli.
function Entrar-Submenu([string]$Patron, $Win = $null) {
  try {
    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
    Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
  } catch {
    Traza "submenu: no pude cargar UIAutomation"
    return $false
  }
  $fg = [W32Menu]::GetForegroundWindow()
  if ($fg -eq [IntPtr]::Zero) { Traza "submenu: sin ventana en primer plano"; return $false }
  # Fallo real 25/07 20:06: el foco estaba en OTRO programa (un dialogo
  # Abrir suelto / un Explorer con la carpeta entradas) y el volcado listo
  # ficheros MoveFELLog en vez del menu de UnideGes. Si sabemos de que
  # proceso debe ser la ventana, se comprueba el pid y, si no casa, se
  # vuelve a traer UnideGes al frente antes de buscar nada.
  if ($Win) {
    $pidFg = [uint32]0
    [W32Menu]::GetWindowThreadProcessId($fg, [ref]$pidFg) | Out-Null
    if ([long]$pidFg -ne [long]$Win.ProcId) {
      $tituloIntruso = Titulo-De $fg
      Traza "submenu: el foco esta en otro programa ('$tituloIntruso'); vuelvo a poner UnideGes delante"
      [W32Menu]::SetForegroundWindow($Win.Handle) | Out-Null
      Start-Sleep -Milliseconds 600
      $fg = [W32Menu]::GetForegroundWindow()
      $pidFg2 = [uint32]0
      [W32Menu]::GetWindowThreadProcessId($fg, [ref]$pidFg2) | Out-Null
      if ([long]$pidFg2 -ne [long]$Win.ProcId) {
        Traza "submenu: el foco sigue fuera; uso la ventana del menu directamente"
        $fg = [IntPtr]$Win.Handle
      }
    }
  }
  $raiz = $null
  try { $raiz = [System.Windows.Automation.AutomationElement]::FromHandle($fg) } catch { $raiz = $null }
  if (-not $raiz) { Traza "submenu: no pude leer la ventana con UIA"; return $false }

  $todos = $null
  try {
    $todos = $raiz.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  } catch {
    Traza "submenu: UIA no pudo listar los hijos"
    return $false
  }
  $cuantos = $todos.Count
  Traza "submenu: la ventana tiene $cuantos elementos; los que tienen nombre:"

  $objetivo = $null
  $vistos = 0
  foreach ($el in $todos) {
    $nombre = ""
    $tipo = ""
    try { $nombre = [string]$el.Current.Name } catch { $nombre = "" }
    try { $tipo = [string]$el.Current.ControlType.ProgrammaticName } catch { $tipo = "" }
    if ($nombre -eq "") { continue }
    $tipoCorto = $tipo -replace "ControlType\.", ""
    if ($vistos -lt 60) {
      $linea = "  - [" + $tipoCorto + "] " + $nombre
      Traza $linea
      $vistos = $vistos + 1
    }
    if (-not $objetivo -and $nombre -match $Patron) { $objetivo = $el }
  }
  if (-not $objetivo) { Traza "submenu: nada casa con '$Patron'"; return $false }

  $nombreObj = ""
  try { $nombreObj = [string]$objetivo.Current.Name } catch { $nombreObj = "?" }
  Traza "submenu: encontrado '$nombreObj', intento activarlo"

  # 1) Invoke (botones y entradas de menu normales)
  try {
    $inv = $objetivo.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $inv.Invoke()
    Traza "submenu: activado con Invoke"
    return $true
  } catch { }
  # 2) SelectionItem (listas)
  try {
    $sel = $objetivo.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $sel.Select()
    Traza "submenu: seleccionado con SelectionItem"
    return $true
  } catch { }
  # 3) Doble clic en su centro (lo ultimo que queda)
  try {
    $r = $objetivo.Current.BoundingRectangle
    $cx = [int]($r.X + $r.Width / 2)
    $cy = [int]($r.Y + $r.Height / 2)
    [W32Menu]::SetCursorPos($cx, $cy) | Out-Null
    Start-Sleep -Milliseconds 120
    [W32Menu]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [W32Menu]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 90
    [W32Menu]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [W32Menu]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Traza "submenu: doble clic en ${cx},${cy}"
    return $true
  } catch {
    $porQue = $_.Exception.Message
    Traza "submenu: no pude activarlo - $porQue"
    return $false
  }
}

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
      $puntos = 10
      if ($nombre -match 'madisa') { $puntos = 20 }
      if ($nombre -match 'unideges') { $puntos = 30 }
      # Un acceso directo dentro de BACKUP/copias vale menos que uno normal.
      if ($lnk.FullName -match 'backup|copia|old|antigu') { $puntos = $puntos - 5 }
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
    if (-not $t) { $t = '(sin titulo)' }
    if (-not $titulos.Contains($t)) { $titulos.Add($t) | Out-Null }
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
  Aviso "Login detectado (ventana '$Titulo')"
  # Si el dialogo YA tiene datos (segundo intento: el foco suele estar en
  # el campo del operario con 'Operario 1'), NO teclear encima — el 20/07
  # el reintento machaco el operario con '1' y dejo el dialogo invalido.
  $textoFoco = Read-FocusText
  if ($textoFoco -and $textoFoco -ne $LoginUser) {
    Traza "login: el dialogo ya tiene datos (foco contiene '$textoFoco'); voy directo a Aceptar"
  } else {
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
    Traza "login: Enter 1 (rellena el operario)"
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Start-Sleep -Milliseconds 1500
    $foco = Get-FocusInfo
    Traza "login: tras Enter 1 - $foco"
  }
  # Confirmar: BM_CLICK directo al boton Aceptar — el Enter simulado con el
  # foco en el campo del operario NO disparaba el boton (20/07). BM_CLICK
  # no depende del foco. Si no aparece el boton, Enter como antes.
  Traza-Hijos $Handle
  for ($j = 0; $j -lt 4; $j++) {
    if (Find-MenuWindow) {
      Traza "login: el menu ya esta a la vista"
      $durLogin = [Math]::Round($cronometro.Elapsed.TotalSeconds, 1)
      Traza "RESULT: step=login status=ok intentos=$j duration=${durLogin}s msg=menu_visible"
      return $true
    }
    if ([W32Menu]::GetForegroundWindow() -ne $Handle) {
      $foco = Get-FocusInfo
      Traza "login: el dialogo ya no esta delante - $foco"
      $durLogin = [Math]::Round($cronometro.Elapsed.TotalSeconds, 1)
      Traza "RESULT: step=login status=incierto intentos=$j duration=${durLogin}s msg=la_ventana_ya_no_esta_delante"
      return $true
    }
    $intento = $j + 1
    # Captura ANTES de cada intento: si el clic no surte efecto, la foto
    # dice como estaba la pantalla en ese instante exacto.
    $shotIntento = Take-MenuShot "login-intento-$intento"
    if ($shotIntento) {
      $nombreShot = Split-Path -Leaf $shotIntento
      Traza "login: captura $nombreShot"
    }
    $btn = Find-ChildButton $Handle 'Aceptar'
    if ($btn -ne [IntPtr]::Zero) {
      Traza "login: clic BM_CLICK en Aceptar ($intento)"
      [W32Menu]::SendMessage($btn, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    } elseif (Click-RealAt $Handle 0.33 0.82) {
      Traza "login: clic REAL sobre Aceptar (33% ancho, 82% alto) ($intento)"
    } else {
      Traza "login: no pude mover el raton (UIPI?); Enter ($intento)"
      [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    }
    Start-Sleep -Milliseconds 1500
  }
  $durLogin = [Math]::Round($cronometro.Elapsed.TotalSeconds, 1)
  Traza "RESULT: step=login status=fail intentos=4 duration=${durLogin}s msg=dialogo_sigue_delante"
  return $true
}

# Boton hijo cuyo texto casa (p. ej. 'Aceptar') dentro del dialogo.
function Find-ChildButton([IntPtr]$Parent, [string]$TextoRegex) {
  foreach ($h in [W32Menu]::ChildWindows($Parent)) {
    $hijo = [IntPtr]$h
    $texto = Titulo-De $hijo
    if ($texto -and $texto -match $TextoRegex) { return $hijo }
  }
  return [IntPtr]::Zero
}

# Inventario de los controles del dialogo (clase='texto'): la proxima caja
# negra dira exactamente que control es el boton Aceptar.
function Traza-Hijos([IntPtr]$Handle) {
  $partes = New-Object System.Collections.Generic.List[string]
  foreach ($h in [W32Menu]::ChildWindows($Handle)) {
    $hijo = [IntPtr]$h
    $bufC = New-Object System.Text.StringBuilder 128
    [W32Menu]::GetClassName($hijo, $bufC, 128) | Out-Null
    $clase = $bufC.ToString() -replace '^WindowsForms10\.', ''
    $texto = Titulo-De $hijo
    $partes.Add("$clase='$texto'") | Out-Null
    if ($partes.Count -ge 14) { break }
  }
  $lista = $partes -join ' | '
  Traza "login: controles del dialogo: $lista"
}

# ¿Tiene la ventana algun campo de texto? El dialogo de login SI (las
# cajas Usuario/Clave son EDIT); las ventanitas Sniffer/Scheduler de la
# suite solo tienen etiquetas — sin esto, el 22/07 se intento el login
# sobre 'Sniffer' por casar el nombre de proceso.
function Tiene-CampoTexto([IntPtr]$Handle) {
  foreach ($h in [W32Menu]::ChildWindows($Handle)) {
    $bufC = New-Object System.Text.StringBuilder 128
    [W32Menu]::GetClassName([IntPtr]$h, $bufC, 128) | Out-Null
    if ($bufC.ToString() -match 'EDIT') { return $true }
  }
  return $false
}

# Clic REAL de raton en una fraccion del rectangulo de la ventana (los
# botones ovalados del login son imagenes autodibujadas: ni tienen texto ni
# responden a BM_CLICK; el raton de verdad si funciona).
function Click-RealAt([IntPtr]$Handle, [double]$FracX, [double]$FracY) {
  $r = New-Object W32Menu+RECT
  if (-not [W32Menu]::GetWindowRect($Handle, [ref]$r)) { return $false }
  $x = [int]($r.Left + ($r.Right - $r.Left) * $FracX)
  $y = [int]($r.Top + ($r.Bottom - $r.Top) * $FracY)
  [W32Menu]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 150
  $pos = [System.Windows.Forms.Cursor]::Position
  if ([Math]::Abs($pos.X - $x) -gt 3 -or [Math]::Abs($pos.Y - $y) -gt 3) { return $false }
  [W32Menu]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [W32Menu]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  return $true
}

function Try-Login($PidsAntes) {
  if (-not $LoginUser) { return $false }
  foreach ($par in [W32Menu]::VisibleWindows()) {
    if ($PidsAntes.Contains([long]$par[1])) { continue }
    $handle = [IntPtr]$par[0]
    $titulo = Titulo-De $handle
    if ($titulo -match $TitleRegex) { continue }
    if ($titulo -match 'sniffer|scheduler') { continue }
    if (-not (Tiene-CampoTexto $handle)) { continue }
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
    if ($titulo -match $TitleRegex) { continue }
    # El dialogo de login NO tiene titulo: se reconoce tambien por el
    # nombre del proceso (si no, se lanzaba una segunda instancia encima).
    if ($titulo -match 'sniffer|scheduler') { continue }
    $esUnide = $false
    if ($titulo -and $titulo -match 'unide|madisa') { $esUnide = $true }
    if ($nombreProc -and $nombreProc -match 'unide|madisa') { $esUnide = $true }
    if ($esUnide -and (Tiene-CampoTexto $handle)) {
      if (-not $titulo) { $titulo = '(sin titulo)' }
      return @{ Handle = $handle; Title = $titulo }
    }
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

    # Un escalon mas adentro: dentro del modulo hay submenus (Albaran
    # electronico dentro de F7, LMANMA dentro de F6). Si viene -Submenu, se
    # busca por nombre y se activa. PRIMERA VERSION A CIEGAS: pase lo que
    # pase se VUELCAN los nombres de lo que hay dentro, que es lo que nos
    # dira que apuntar la proxima vez.
    $msgSub = ""
    if ($Submenu -ne "") {
      $encontrado = Entrar-Submenu $Submenu $win
      if ($encontrado) {
        Start-Sleep -Milliseconds 2000
        $focoSub = Get-FocusInfo
        Traza "tras el submenu: $focoSub"
        $msgSub = " + submenu '$Submenu'"
      } else {
        $msgSub = " (el submenu '$Submenu' no se encontro; mira la lista de la caja negra)"
      }
    }

    $shot = Take-MenuShot "modulo-$Tecla"
    $fg = [W32Menu]::GetForegroundWindow()
    $tituloFinal = Titulo-De $fg
    Emit 'ok' "tecla $Tecla enviada$msgSub" $tituloFinal $shot
    exit 0
  }

  # --- PROCESADO albaran electronico (v261) ---------------------------
  # Fase 'leer': abrir la ventana, volcar su contenido, contar filas y
  # captura — SIN tocar nada (el bot ensena la foto y pide confirmacion).
  # Fase 'procesar': ademas pulsa 'Marcar todos' y 'Procesar' y vigila los
  # dialogos que salgan (sin tocarlos: cada uno queda en la caja negra).
  if ($Accion -eq 'albaran') {
    Traza "accion albaran fase '$Fase'"
    # Si la ventana YA esta abierta (la dejo la fase 'leer', o el dueño la
    # abrio a mano) se REUTILIZA: navegar otra vez con ella abierta era el
    # fallo del 25/07 por la noche. Si no, navegacion normal.
    $vent = Find-VentanaTitulo '^Ficheros albar' 0
    if ($vent) {
      $tituloYa = $vent.Title
      Traza "la ventana '$tituloYa' ya estaba abierta: la reutilizo sin navegar"
    } else {
      $win = Entrar-ModuloYSubmenu 'F7' $Submenu
      $vent = Wait-VentanaTitulo '^Ficheros albar' 15 $win.ProcId
      if (-not $vent) {
        # Algunas instalaciones la abren como hija del mismo titulo raro:
        # probar sin pid antes de rendirse.
        $vent = Wait-VentanaTitulo '^Ficheros albar' 5 0
      }
      if (-not $vent) { throw "el submenu se activo pero la ventana 'Ficheros albaran electronico' no aparecio en 20 s" }
    }
    $tituloVent = $vent.Title
    Traza "ventana de albaranes delante: '$tituloVent'"
    [W32Menu]::SetForegroundWindow($vent.Handle) | Out-Null
    Start-Sleep -Milliseconds 400
    $raiz = Uia-Raiz $vent.Handle
    $todos = Uia-Hijos $raiz
    Volcar-Elementos $todos 'albaran: contenido' 80
    $filas = Contar-Filas $todos
    Traza "albaran: $filas filas de datos en la lista"
    $fels = Listar-Fel $todos
    $msgFel = ""
    if ($fels.Count -gt 0) {
      $listaFel = $fels -join ', '
      $msgFel = "; ficheros=$listaFel"
    }
    if ($Fase -ne 'procesar') {
      $shot = Take-MenuShot 'albaran-leer'
      Emit 'ok' "ventana abierta; filas=$filas$msgFel" $tituloVent $shot
      exit 0
    }
    if ($filas -eq 0) {
      # NO se corta aqui: el conteo puede fallar con la lista llena (fallo
      # del 25/07 a la noche). El dueno ya confirmo con la captura delante;
      # con la lista de verdad vacia, Marcar todos + Procesar no hacen nada.
      Traza "albaran: conteo en 0 (lista vacia o control que no se deja leer); sigo, el dueno confirmo con la captura"
    }

    # ---- FASE 'procesar': hasta dejar la revision lista para MIRAR ----
    # Orden dictado por el dueno (25/07): Procesar, Guardar, Descartar
    # todos los cambios, y AHI SE PARA para revisar las filas azules
    # (articulos con problemas) antes de aceptar nada.
    if ($Fase -eq 'procesar') {
      $okMarcar = Activar-PorNombre $raiz '^\s*Marcar todos\s*$' 'albaran: Marcar todos'
      if (-not $okMarcar) { Paso 'alb-marcar' 'fail' 'no encontre Marcar todos'; throw "no encontre el boton 'Marcar todos' (mira la caja negra)" }
      Paso 'alb-marcar' 'ok' ''
      Start-Sleep -Milliseconds 900
      $okProc = Activar-PorNombre $raiz '^\s*Procesar\s*$' 'albaran: Procesar'
      if (-not $okProc) { Paso 'alb-procesar' 'fail' 'no encontre Procesar'; throw "marque todos pero no encontre el boton 'Procesar' (mira la caja negra)" }
      Paso 'alb-procesar' 'ok' ''

      # Codigos desconocidos y cualquier otra ventana rara, hasta que
      # aparezca la pantalla de revision de precios.
      $prep = Preparar-Revision $vent.ProcId 60
      $nDes = $prep.desconocidos
      $rev = $prep.ventana
      if (-not $rev) {
        $shot = Take-MenuShot 'albaran-sin-revision'
        Emit 'ok' "Procesar pulsado pero no vi la pantalla de revision; filas=$filas; desconocidos=$nDes; revision=0" $tituloVent $shot
        exit 0
      }
      Paso 'alb-revision' 'ok' ''

      # Guardar + Descartar todos los cambios (orden del dueno).
      $raizRev = Uia-Raiz $rev.Handle
      $okGuardar = $false
      if ($raizRev) {
        Volcar-Elementos (Uia-Hijos $raizRev) 'revision de precios' 120
        $okGuardar = Activar-PorNombre $raizRev '^\s*Guardar\s*$' 'revision: Guardar'
      }
      $estadoG = 'fail'
      if ($okGuardar) { $estadoG = 'ok' }
      Paso 'alb-guardar1' $estadoG ''
      Start-Sleep -Milliseconds 1500

      $okDesc = Poner-Cambios $rev.Handle $false
      $estadoD = 'fail'
      if ($okDesc) { $estadoD = 'ok' }
      Paso 'alb-descartar' $estadoD ''
      Start-Sleep -Milliseconds 800

      # Filas AZULES = articulos con problemas. Se MIRAN, no se tocan.
      [W32Menu]::SetForegroundWindow($rev.Handle) | Out-Null
      Start-Sleep -Milliseconds 500
      $azul = Analizar-FilasAzules $rev.Handle
      $nAzules = $azul.bandas.Count
      $colores = $azul.resumen
      Traza "revision: colores de fondo mas vistos -> $colores"
      Traza "revision: bandas azules detectadas -> $nAzules"
      foreach ($b in $azul.bandas) {
        $by = $b.Y
        $ba = $b.Alto
        Traza "  - fila azul en y=$by (alto $ba)"
      }
      $estadoA = 'ok'
      Paso 'alb-azules' $estadoA "$nAzules"
      $shot = Take-MenuShot 'albaran-revision'
      Emit 'ok' "revision lista; filas=$filas; desconocidos=$nDes; revision=1; azules=$nAzules; colores=$colores" $tituloVent $shot
      exit 0
    }

    # ---- FASE 'confirmar': el dueno ya reviso las filas azules ----
    # Aceptar todos los cambios, Guardar, Confirmar, Si, cerrar la ventana
    # de etiquetas y cerrar la del albaran ya procesado.
    if ($Fase -eq 'confirmar') {
      $rev = Find-VentanaConElemento 'Aceptar\s+Todos|Descartar\s+Todos' 0
      if (-not $rev) { throw "no encuentro la pantalla de revision de precios abierta; vuelve a lanzar el proceso" }
      [W32Menu]::SetForegroundWindow($rev.Handle) | Out-Null
      Start-Sleep -Milliseconds 500

      $okAcep = Poner-Cambios $rev.Handle $true
      $estadoAc = 'fail'
      if ($okAcep) { $estadoAc = 'ok' }
      Paso 'alb-aceptar-todos' $estadoAc ''
      if (-not $okAcep) { throw "no pude dejar todos los cambios aceptados (mira la caja negra)" }
      Start-Sleep -Milliseconds 1200

      $raizRev2 = Uia-Raiz $rev.Handle
      $okGuardar2 = $false
      if ($raizRev2) { $okGuardar2 = Activar-PorNombre $raizRev2 '^\s*Guardar\s*$' 'revision: Guardar (2)' }
      $estadoG2 = 'fail'
      if ($okGuardar2) { $estadoG2 = 'ok' }
      Paso 'alb-guardar2' $estadoG2 ''
      Start-Sleep -Milliseconds 1500

      $raizRev3 = Uia-Raiz $rev.Handle
      $okConf = $false
      if ($raizRev3) { $okConf = Activar-PorNombre $raizRev3 '^\s*Confirmar\s*$' 'revision: Confirmar' }
      $estadoC = 'fail'
      if ($okConf) { $estadoC = 'ok' }
      Paso 'alb-confirmar' $estadoC ''

      $cierre = Cerrar-Proceso $rev.ProcId 40
      $nSi = $cierre.si
      $nEtq = $cierre.etiquetas
      $nCerr = $cierre.cerradas
      $shot = Take-MenuShot 'albaran-confirmar'
      Emit 'ok' "confirmado; si=$nSi; etiquetas=$nEtq; cerradas=$nCerr" $tituloVent $shot
      exit 0
    }

    throw "Fase de albaran desconocida: '$Fase' (validas: leer, procesar, confirmar)"
  }

  # --- PROCESADO LMANMA / LMMAMA (v261) --------------------------------
  # Camino visto en la tienda (25/07): LMMAMA → dialogo 'Seleccione fecha'
  # (se acepta la fecha por defecto = hoy) → dialogo 'Abrir' → se escribe
  # la ruta del fichero y se pulsa Abrir. Despues, vigilar sin tocar.
  if ($Accion -eq 'lmanma') {
    if ($Archivo -eq "") { throw "falta -Archivo (la ruta del fichero LMANMA)" }
    if (-not (Test-Path -LiteralPath $Archivo)) { throw "el fichero no existe: $Archivo" }
    $nombreFichero = [System.IO.Path]::GetFileName($Archivo)
    Traza "accion lmanma con fichero '$nombreFichero'"
    $win = Entrar-ModuloYSubmenu 'F6' $Submenu
    $fecha = Wait-VentanaTitulo 'Seleccione fecha' 15 $win.ProcId
    if (-not $fecha) { $fecha = Wait-VentanaTitulo 'Seleccione fecha' 5 0 }
    if (-not $fecha) { throw "no aparecio el dialogo 'Seleccione fecha' en 20 s" }
    Traza "dialogo de fecha delante (fecha por defecto = hoy)"
    $raizF = Uia-Raiz $fecha.Handle
    $todosF = Uia-Hijos $raizF
    Volcar-Elementos $todosF 'lmanma: dialogo fecha' 20
    $okFecha = Activar-PorNombre $raizF '^\s*Aceptar\s*$' 'lmanma: Aceptar fecha'
    if (-not $okFecha) { throw "no pude pulsar Aceptar en 'Seleccione fecha'" }
    $abrir = Wait-VentanaTitulo '^Abrir$' 15 $win.ProcId
    if (-not $abrir) { $abrir = Wait-VentanaTitulo '^Abrir$' 5 0 }
    if (-not $abrir) { throw "acepte la fecha pero no aparecio el dialogo 'Abrir'" }
    Traza "dialogo Abrir delante; escribo la ruta del fichero"
    [W32Menu]::SetForegroundWindow($abrir.Handle) | Out-Null
    Start-Sleep -Milliseconds 300
    $raizA = Uia-Raiz $abrir.Handle
    $okNombre = Poner-NombreFichero $raizA $Archivo
    if (-not $okNombre) { throw "no pude escribir la ruta en el dialogo Abrir (mira la caja negra)" }
    Start-Sleep -Milliseconds 400
    $okAbrir = Activar-PorNombre $raizA '^\s*Abrir\s*$' 'lmanma: boton Abrir'
    if (-not $okAbrir) {
      Traza "lmanma: boton Abrir no encontrado; mando ENTER"
      [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    }
    Traza "lmanma: fichero enviado; entro en el ciclo del proceso"
    $cl = Ciclo-Lmanma $win.ProcId 25 120
    $nErr = $cl.errores
    $nProc = $cl.procesado
    $abierta = $cl.ventanaAbierta
    $shot = Take-MenuShot 'lmanma-procesar'
    Emit 'ok' "fichero '$nombreFichero' procesado en LMMAMA (fecha de hoy); errores=$nErr; procesar=$nProc; ventanaAbierta=$abierta" '' $shot
    exit 0
  }

  throw "Accion desconocida: $Accion (validas: estado, abrir, modulo, albaran, lmanma)"
} catch {
  $motivo = $_.Exception.Message
  Traza "ERROR: $motivo"
  $shot = Take-MenuShot 'error'
  Emit 'error' $motivo '' $shot
  exit 1
}
