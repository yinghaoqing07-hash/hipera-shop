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

# Tras pulsar Procesar (o mandar el fichero a LMMAMA) pueden salir dialogos
# que NO conocemos: se vigilan N segundos, se vuelca su contenido a la caja
# negra y NO SE TOCA NADA. La captura final + esta lista son el material
# para ensenarle al bot el paso siguiente.
function Vigilar-Dialogos([long]$ProcId, [int]$Segundos) {
  $conocidas = @{}
  foreach ($par in [W32Menu]::VisibleWindows()) {
    if ([long]$par[1] -ne $ProcId) { continue }
    $t = Titulo-De ([IntPtr]$par[0])
    if ($t) { $conocidas[$t] = $true }
  }
  $tope = [DateTime]::Now.AddSeconds($Segundos)
  while ([DateTime]::Now -lt $tope) {
    Start-Sleep -Milliseconds 800
    foreach ($par in [W32Menu]::VisibleWindows()) {
      if ([long]$par[1] -ne $ProcId) { continue }
      $h = [IntPtr]$par[0]
      $t = Titulo-De $h
      if (-not $t) { continue }
      if ($conocidas.ContainsKey($t)) { continue }
      $conocidas[$t] = $true
      Traza "dialogo nuevo: '$t' (no lo toco, solo lo apunto)"
      $r = Uia-Raiz $h
      if ($r) {
        $todosD = Uia-Hijos $r
        Volcar-Elementos $todosD "dialogo '$t'" 20
      }
    }
  }
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
    $okMarcar = Activar-PorNombre $raiz '^\s*Marcar todos\s*$' 'albaran: Marcar todos'
    if (-not $okMarcar) { throw "no encontre el boton 'Marcar todos' (mira la caja negra)" }
    Start-Sleep -Milliseconds 900
    $okProc = Activar-PorNombre $raiz '^\s*Procesar\s*$' 'albaran: Procesar'
    if (-not $okProc) { throw "marque todos pero no encontre el boton 'Procesar' (mira la caja negra)" }
    Traza "albaran: Procesar pulsado; vigilo 20 s por si salen dialogos"
    Vigilar-Dialogos $vent.ProcId 20
    $shot = Take-MenuShot 'albaran-procesar'
    Emit 'ok' "Marcar todos + Procesar pulsados; filas=$filas; revisa la captura y la caja negra" $tituloVent $shot
    exit 0
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
    Traza "lmanma: fichero enviado; vigilo 25 s por si salen dialogos"
    Vigilar-Dialogos $win.ProcId 25
    $shot = Take-MenuShot 'lmanma-procesar'
    Emit 'ok' "fichero '$nombreFichero' mandado a LMMAMA (fecha de hoy); revisa la captura y la caja negra" '' $shot
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
