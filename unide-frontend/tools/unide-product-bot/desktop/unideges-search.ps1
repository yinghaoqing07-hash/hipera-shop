param(
  [Parameter(Mandatory = $true)][string]$Query,
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [ValidateSet("search", "searchCode", "clear", "priceRead", "priceApply", "orderApply", "uiaDump")][string]$Mode = "search",
  [string]$VariablesJson = "{}"
)

$ErrorActionPreference = "Stop"

# Salida SIEMPRE en UTF-8: sin esto, PowerShell 5.1 escribe stdout en la
# página de códigos de consola (CP850) y la Ñ de rutas como
# "UNION DETALLISTAS ESPAÑOLES" llega rota al bot, que entonces no
# encuentra el fichero de la captura.
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {
  # Some locked-down Windows setups may not expose UI Automation assemblies.
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(UInt32 dwFlags, UInt32 dx, UInt32 dy, UInt32 dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
public class WinEnum {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  // Ventanas top-level VISIBLES de un proceso. Se usa para la foto fija de
  // "ventanas que ya existían" al enfocar: closeDialog solo puede cerrar
  // ventanas que NO estén en esa foto (las que aparecieron después).
  public static System.Collections.Generic.List<long> VisibleWindowsOfPid(uint pid) {
    var list = new System.Collections.Generic.List<long>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p == pid) list.Add(h.ToInt64());
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@

$warnings = New-Object System.Collections.Generic.List[string]
$values = [ordered]@{}
$variables = $VariablesJson | ConvertFrom-Json
$script:TargetPid = $null
$script:KnownHandles = $null
$script:TargetWindowHandle = $null

function Add-WarningText([string]$Text) {
  if ($Text) { $warnings.Add($Text) | Out-Null }
}

function Get-ScreenInfo {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  [ordered]@{ width = $bounds.Width; height = $bounds.Height }
}


# ---- UI Automation por identidad de control (sin coordenadas ni Tab) ----
function Get-UiaRoot {
  if (-not $script:TargetWindowHandle) { throw "uia: falta el paso focus antes de usar pasos uia*" }
  return [System.Windows.Automation.AutomationElement]::FromHandle($script:TargetWindowHandle)
}

function Find-UiaElement([string]$AutomationId, [string]$NameRegex) {
  $root = Get-UiaRoot
  if ($AutomationId) {
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
    $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if ($el) { return $el }
  }
  if ($NameRegex) {
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($cand in $all) {
      if (([string]$cand.Current.Name) -match $NameRegex) { return $cand }
    }
  }
  return $null
}


# Localiza un control por su ETIQUETA: los AutomationId de este UnideGes
# son HWND numericos que cambian en cada arranque, pero los textos de las
# etiquetas (Código, PC Medio, ...) son fijos. Se busca el elemento cuyo
# Name coincide EXACTO con la etiqueta y se devuelve el control de entrada
# (EDIT/COMBOBOX/RichEdit/fecha) situado a su derecha en la misma fila,
# ordenado por X; Index elige la columna (0 = primera, 1 = segunda, p. ej.
# la columna % de P. defecto). Con -Self se devuelve el propio elemento
# nombrado (p. ej. el checkbox Bloq.Venta, cuyo Name ES su etiqueta).
function Find-UiaByLabel([string]$Label, [int]$Index = 0, [bool]$Self = $false) {
  $root = Get-UiaRoot
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $labelEl = $null
  foreach ($cand in $all) {
    if (([string]$cand.Current.Name).Trim() -eq $Label) { $labelEl = $cand; break }
  }
  if (-not $labelEl) { return $null }
  if ($Self) { return $labelEl }
  $lr = $labelEl.Current.BoundingRectangle
  $row = @()
  foreach ($cand in $all) {
    $cls = [string]$cand.Current.ClassName
    if ($cls -notmatch 'EDIT|RichEdit|COMBOBOX|SysDateTimePick') { continue }
    $r = $cand.Current.BoundingRectangle
    if ([Math]::Abs($r.Y - $lr.Y) -gt 10) { continue }
    if ($r.X -le $lr.X) { continue }
    $row += ,@($r.X, $cand)
  }
  if (-not $row.Count) { return $null }
  $sorted = $row | Sort-Object { $_[0] }
  if ($Index -ge $sorted.Count) { return $null }
  return ($sorted[$Index])[1]
}

function Get-UiaValue($Element) {
  $vp = $null
  if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
    return ([string]$vp.Current.Value).Trim()
  }
  $tp = $null
  if ($Element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) {
    return ($tp.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On)
  }
  return ([string]$Element.Current.Name).Trim()
}


function Resolve-UiaTarget($Step) {
  $label = ""
  $index = 0
  $self = $false
  if ($Step.PSObject.Properties.Name -contains "label") { $label = [string]$Step.label }
  if ($Step.PSObject.Properties.Name -contains "index") { $index = [int]$Step.index }
  if ($Step.PSObject.Properties.Name -contains "self") { $self = [System.Convert]::ToBoolean($Step.self) }
  if ($label) { return Find-UiaByLabel $label $index $self }
  return Find-UiaElement ([string]$Step.automationId) ([string]$Step.nameRegex)
}

function Write-UiaDump([string]$Directory) {
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $path = Join-Path $Directory "uia-dump-$stamp.txt"
  $root = Get-UiaRoot
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("ventana: '$($root.Current.Name)' clase $($root.Current.ClassName)") | Out-Null
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $lines.Add("controles: $($all.Count)") | Out-Null
  $i = 0
  foreach ($el in $all) {
    $i++
    if ($i -gt 600) { $lines.Add("... truncado en 600") | Out-Null; break }
    try {
      $c = $el.Current
      $val = ""
      $vp = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) { $val = [string]$vp.Current.Value }
      $r = $c.BoundingRectangle
      $lines.Add(("{0}|type={1}|id={2}|name={3}|class={4}|value={5}|rect={6},{7}" -f $i, $c.ControlType.ProgrammaticName, $c.AutomationId, $c.Name, $c.ClassName, $val, [int]$r.X, [int]$r.Y)) | Out-Null
    } catch {
      $lines.Add("$i|<error leyendo control>") | Out-Null
    }
  }
  [System.IO.File]::WriteAllLines($path, $lines, (New-Object System.Text.UTF8Encoding($false)))
  return $path
}

function Focus-Window($Regex, $ExcludedProcessNames, [bool]$Reactivate = $false) {
  # UnideGes tiene VARIAS ventanas top-level (menú principal, Artículo
  # alimentación, …) y la "MainWindow" del proceso cambia según cuál
  # estuviera activa: si se traía al frente el menú principal, tapaba la
  # de Artículo y TODOS los clics/lecturas caían en un panel vacío (los
  # campos "leían vacío" aunque el artículo estuviera en pantalla). Se
  # enumeran todas las ventanas visibles de los procesos candidatos y se
  # trae al frente LA QUE CASA por título, prefiriendo la de Artículos.
  $excluded = @($ExcludedProcessNames) | ForEach-Object { ([string]$_).ToLowerInvariant() }
  $candidates = Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and
    ($excluded.Count -eq 0 -or $excluded -notcontains $_.ProcessName.ToLowerInvariant())
  }
  $best = $null
  $bestScore = -1
  $seen = New-Object System.Collections.Generic.List[string]
  foreach ($proc in $candidates) {
    foreach ($h in [WinEnum]::VisibleWindowsOfPid([uint32]$proc.Id)) {
      $titleBuf = New-Object System.Text.StringBuilder 512
      [Win32]::GetWindowText([IntPtr]$h, $titleBuf, 512) | Out-Null
      $title = $titleBuf.ToString()
      if (-not $title) { continue }
      $seen.Add($title) | Out-Null
      if ($title -notmatch $Regex) { continue }
      $score = 1
      if ($title -match 'Art[ií]cul') { $score = 2 }
      if ($score -gt $bestScore) {
        $bestScore = $score
        $best = @{ Handle = [IntPtr]$h; Title = $title; ProcId = $proc.Id }
      }
    }
  }
  if (-not $best) {
    $visible = ($seen | Select-Object -First 10) -join " · "
    throw "Could not find a window matching: $Regex — ventanas visibles: $visible"
  }
  if ($Reactivate) {
    # Minimizar y restaurar fuerza una activación "fresca": el usuario
    # confirmó que al activarse la ventana de Artículos el foco cae SIEMPRE
    # en el campo Código — ese es el ancla del flujo de teclado puro.
    [Win32]::ShowWindow($best.Handle, 6) | Out-Null
    Start-Sleep -Milliseconds 300
    [Win32]::ShowWindow($best.Handle, 9) | Out-Null
    Start-Sleep -Milliseconds 300
  }
  if ([Win32]::IsIconic($best.Handle)) { [Win32]::ShowWindow($best.Handle, 9) | Out-Null }
  [Win32]::SetForegroundWindow($best.Handle) | Out-Null
  Start-Sleep -Milliseconds 400
  $script:TargetPid = $best.ProcId
  $script:TargetWindowHandle = $best.Handle
  # Foto fija de las ventanas del proceso que YA existen al enfocar: solo
  # lo que aparezca DESPUÉS puede considerarse emergente y cerrarse.
  $script:KnownHandles = [WinEnum]::VisibleWindowsOfPid([uint32]$best.ProcId)
  return $best.Title
}

# Cierra la ventana emergente si la hay: una ventana del proceso de
# UnideGes en primer plano que NO estaba en la foto de Focus-Window (es
# decir, que apareció después: el aviso post-búsqueda). Las ventanas que
# ya existían —la principal Y la de Artículo alimentación— no se tocan
# jamás (antes se comparaba solo con la "principal" y se llevó por delante
# la de Artículo). Por defecto manda Alt+F4, que es lo que cierra estos
# avisos; keys/attempts configurables. Sin emergente no hace nada y deja
# el título de lo cerrado en warnings.
function Close-DialogIfAny([string]$Keys = "%{F4}", [int]$Attempts = 3) {
  for ($i = 0; $i -lt $Attempts; $i++) {
    $handle = [Win32]::GetForegroundWindow()
    if ($handle -eq [IntPtr]::Zero) { return }
    $ownerPid = [uint32]0
    [Win32]::GetWindowThreadProcessId($handle, [ref]$ownerPid) | Out-Null
    if (-not $script:TargetPid -or $ownerPid -ne [uint32]$script:TargetPid) { return }
    if ($null -eq $script:KnownHandles) { return }
    if ($script:KnownHandles.Contains($handle.ToInt64())) { return }
    $titleBuf = New-Object System.Text.StringBuilder 512
    [Win32]::GetWindowText($handle, $titleBuf, 512) | Out-Null
    Add-WarningText "Cerrada ventana emergente: '$($titleBuf.ToString())' (keys $Keys)"
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    Start-Sleep -Milliseconds 400
  }
}

function Click-Point([int]$X, [int]$Y) {
  if ($X -le 0 -or $Y -le 0) { throw "Click step has invalid coordinate: x=$X y=$Y" }
  [Win32]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 120
  # Verificar que el ratón se movió DE VERDAD. Si la app objetivo corre
  # elevada (como administrador) y el bot no, Windows (UIPI) descarta el
  # movimiento y los clics EN SILENCIO: sin esto el flujo "corría" entero
  # sin tocar nada y parecía que las coordenadas estaban mal.
  $pos = [System.Windows.Forms.Cursor]::Position
  if ([Math]::Abs($pos.X - $X) -gt 3 -or [Math]::Abs($pos.Y - $Y) -gt 3) {
    throw "El raton NO se movio a ($X,$Y): esta en ($($pos.X),$($pos.Y)). Causa tipica: UnideGes corre como administrador y el bot no -> cierra el bot y arranca start-bot.cmd con 'Ejecutar como administrador'."
  }
  [Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

function Send-Text([string]$Text) {
  Set-Clipboard -Value $Text
  Start-Sleep -Milliseconds 100
  [System.Windows.Forms.SendKeys]::SendWait("^v")
}

function Send-StepKeys([string]$Keys) { [System.Windows.Forms.SendKeys]::SendWait($Keys) }

function Resolve-Template([string]$Text) {
  $out = $Text.Replace("{{query}}", $Query)
  foreach ($prop in $variables.PSObject.Properties) {
    $out = $out.Replace("{{" + $prop.Name + "}}", [string]$prop.Value)
  }
  return $out
}

function Send-OrderLines($Step) {
  $items = @($variables.items)
  if ($items.Count -eq 0) { throw "No order items were provided" }

  if (($Step.PSObject.Properties.Name -contains "lineClickX") -and ($Step.PSObject.Properties.Name -contains "lineClickY")) {
    $x = [int]$Step.lineClickX
    $y = [int]$Step.lineClickY
    if ($x -gt 0 -and $y -gt 0) { Click-Point $x $y }
  }

  $autocompleteMs = 700
  $selectedMs = 500
  $betweenLinesMs = 700
  $selectKeys = "{ENTER}"
  $quantityKeys = "{TAB}"
  $finishLineKeys = "{ENTER}"
  if ($Step.PSObject.Properties.Name -contains "autocompleteMs") { $autocompleteMs = [int]$Step.autocompleteMs }
  if ($Step.PSObject.Properties.Name -contains "selectedMs") { $selectedMs = [int]$Step.selectedMs }
  if ($Step.PSObject.Properties.Name -contains "betweenLinesMs") { $betweenLinesMs = [int]$Step.betweenLinesMs }
  if ($Step.PSObject.Properties.Name -contains "selectKeys") { $selectKeys = [string]$Step.selectKeys }
  if ($Step.PSObject.Properties.Name -contains "quantityKeys") { $quantityKeys = [string]$Step.quantityKeys }
  if ($Step.PSObject.Properties.Name -contains "finishLineKeys") { $finishLineKeys = [string]$Step.finishLineKeys }

  foreach ($item in $items) {
    $code = [string]$item.code
    $quantity = [string]$item.quantity
    if (-not $code) { continue }

    Send-Text $code
    Start-Sleep -Milliseconds $autocompleteMs
    if ($selectKeys) { Send-StepKeys $selectKeys }
    Start-Sleep -Milliseconds $selectedMs
    if ($quantityKeys) { Send-StepKeys $quantityKeys }
    Start-Sleep -Milliseconds 120
    Send-Text $quantity
    Start-Sleep -Milliseconds 120
    if ($finishLineKeys) { Send-StepKeys $finishLineKeys }
    Start-Sleep -Milliseconds $betweenLinesMs
  }
}

function Copy-Field([int]$X, [int]$Y) {
  $automationValue = Read-ValueAtPoint $X $Y
  if ($automationValue) { return $automationValue }

  # Vaciar el portapapeles antes de copiar: si el campo está vacío (o el
  # clic cayó fuera), ^c no copia nada y nos quedaríamos con el valor
  # anterior; y Get-Clipboard puede devolver NULL, sobre el que .Trim()
  # reventaba con "No se puede llamar a un método ... con valor NULL".
  try { Set-Clipboard -Value " " } catch { }
  Click-Point $X $Y
  Start-Sleep -Milliseconds 120
  Send-StepKeys "^a"
  Start-Sleep -Milliseconds 80
  Send-StepKeys "^c"
  Start-Sleep -Milliseconds 150
  $clip = $null
  try { $clip = Get-Clipboard -Raw } catch { $clip = $null }
  if ($null -eq $clip) { return "" }
  return ([string]$clip).Trim()
}

function Read-ValueAtPoint([int]$X, [int]$Y) {
  try {
    $point = New-Object System.Windows.Point($X, $Y)
    $element = [System.Windows.Automation.AutomationElement]::FromPoint($point)
    if (-not $element) { return $null }

    $pattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      $value = ([string]$pattern.Current.Value).Trim()
      if ($value) { return $value }
    }

    $name = ([string]$element.Current.Name).Trim()
    if ($name) { return $name }
  } catch {
    return $null
  }
  return $null
}

function Test-CheckboxChecked([int]$X, [int]$Y, [int]$Size = 12) {
  if ($Size -lt 18) { $Size = 18 }
  $half = [Math]::Floor($Size / 2)
  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($X - $half, $Y - $half, 0, 0, $bitmap.Size)
  $ink = 0
  for ($ix = 4; $ix -lt ($Size - 4); $ix++) {
    for ($iy = 4; $iy -lt ($Size - 4); $iy++) {
      $p = $bitmap.GetPixel($ix, $iy)
      $brightness = (($p.R * 0.299) + ($p.G * 0.587) + ($p.B * 0.114))
      if ($brightness -lt 170) { $ink++ }
    }
  }
  $graphics.Dispose()
  $bitmap.Dispose()
  return ($ink -ge 6)
}

function Take-Screenshot([string]$Directory, [string]$QueryText) {
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
  $safeQuery = $QueryText -replace '[^\w.-]+', '_'
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $path = Join-Path $Directory "unideges-$Mode-$safeQuery-$stamp.png"
  try {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose(); $bitmap.Dispose()
    return $path
  } catch {
    Add-WarningText "Screenshot failed: $($_.Exception.Message)"
    return $null
  }
}

function Get-Steps($Config, [string]$ActionMode) {
  if ($ActionMode -eq "clear") { $steps = @($Config.desktop.clearSteps) }
  elseif ($ActionMode -eq "priceRead") { $steps = @($Config.desktop.priceReadSteps) }
  elseif ($ActionMode -eq "priceApply") { $steps = @($Config.desktop.priceApplySteps) }
  elseif ($ActionMode -eq "orderApply") { $steps = @($Config.desktop.orderApplySteps) }
  elseif ($ActionMode -eq "uiaDump") {
    $steps = @([pscustomobject]@{ type = "focus" }, [pscustomobject]@{ type = "uiaDump" })
  }
  elseif ($ActionMode -eq "searchCode") {
    # Búsqueda por CÓDIGO: exige codeSearchSteps calibrado. Antes caía en el
    # catalejo/EAN de siempre, que con un código no encuentra nada, y el
    # flujo seguía sobre un formulario vacío fingiendo éxito ("啥也没做").
    $steps = @($Config.desktop.codeSearchSteps)
    if ($steps.Count -eq 0) {
      throw "codeSearchSteps sin configurar en config.local.json: copia la plantilla de config.example.json y pon la coordenada del campo Código (la búsqueda por código NO funciona por el catalejo/EAN)."
    }
  }
  else { $steps = @($Config.desktop.steps) }
  if ($steps.Count -eq 0) { throw "$ActionMode steps are not configured in config.local.json" }
  return $steps
}

try {
  # Leer el config SIEMPRE como UTF-8: Get-Content en PowerShell 5.1 adivina
  # la codificación y un config.local.json guardado por el Bloc de notas
  # (UTF-8 sin BOM) llegaba con "Artículos" convertido en "ArtÃ­culos", con
  # lo que el windowTitleRegex no casaba con ninguna ventana.
  $config = [System.IO.File]::ReadAllText($ConfigPath) | ConvertFrom-Json
  $screen = Get-ScreenInfo
  $windowTitle = $null
  $screenshotPath = $null
  $stepsToRun = Get-Steps $config $Mode

  if ($config.desktop.expectedScreen.width -gt 0 -and $config.desktop.expectedScreen.height -gt 0) {
    if ($config.desktop.expectedScreen.width -ne $screen.width -or $config.desktop.expectedScreen.height -ne $screen.height) {
      Add-WarningText "Screen size is $($screen.width)x$($screen.height), expected $($config.desktop.expectedScreen.width)x$($config.desktop.expectedScreen.height). Coordinates may need recalibration."
    }
  }

  foreach ($step in $stepsToRun) {
    switch ($step.type) {
      "focus" {
        $reactivate = $false
        if ($step.PSObject.Properties.Name -contains "reactivate") { $reactivate = [System.Convert]::ToBoolean($step.reactivate) }
        $windowTitle = Focus-Window $config.desktop.windowTitleRegex $config.desktop.excludedProcessNames $reactivate
      }
      "click" { Click-Point ([int]$step.x) ([int]$step.y) }
      "conditionalClick" {
        $key = [string]$step.if
        $shouldClick = $false
        if ($variables.PSObject.Properties.Name -contains $key) { $shouldClick = [System.Convert]::ToBoolean($variables.$key) }
        elseif ($values.Contains($key)) { $shouldClick = [System.Convert]::ToBoolean($values[$key]) }
        if ($shouldClick) { Click-Point ([int]$step.x) ([int]$step.y) }
      }
      "wait" { Start-Sleep -Milliseconds ([int]$step.ms) }
      "closeDialog" {
        $dlgKeys = "%{F4}"
        $dlgTries = 3
        if ($step.PSObject.Properties.Name -contains "keys") { $dlgKeys = [string]$step.keys }
        if ($step.PSObject.Properties.Name -contains "attempts") { $dlgTries = [int]$step.attempts }
        Close-DialogIfAny $dlgKeys $dlgTries
      }
      "hotkey" { Send-StepKeys ([string]$step.keys) }
      "key" { Send-StepKeys ([string]$step.keys) }
      "text" { Send-Text (Resolve-Template ([string]$step.value)) }
      "tab" {
        # N tabulaciones con pausa: navegación por teclado entre campos.
        $tabCount = 1
        if ($step.PSObject.Properties.Name -contains "count") { $tabCount = [int]$step.count }
        for ($t = 0; $t -lt $tabCount; $t++) {
          [System.Windows.Forms.SendKeys]::SendWait("{TAB}")
          Start-Sleep -Milliseconds 90
        }
      }
      "readFocused" {
        # Lee el valor del control CON FOCO vía UI Automation (sin
        # portapapeles ni coordenadas). Para checkboxes devuelve
        # true/false por TogglePattern. Fallback: ^a^c al portapapeles.
        $focusedValue = $null
        try {
          $el = [System.Windows.Automation.AutomationElement]::FocusedElement
          if ($el) {
            $vp = $null
            if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
              $focusedValue = ([string]$vp.Current.Value).Trim()
            }
            if (-not $focusedValue) {
              $tp = $null
              if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) {
                $focusedValue = ($tp.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On)
              }
            }
          }
        } catch { $focusedValue = $null }
        if ($null -eq $focusedValue -or $focusedValue -eq '') {
          try { Set-Clipboard -Value " " } catch { }
          Send-StepKeys "^a"
          Start-Sleep -Milliseconds 80
          Send-StepKeys "^c"
          Start-Sleep -Milliseconds 150
          $clip = $null
          try { $clip = Get-Clipboard -Raw } catch { $clip = $null }
          if ($null -ne $clip) { $focusedValue = ([string]$clip).Trim() }
        }
        $values[[string]$step.name] = $focusedValue
        if ($null -eq $focusedValue -or $focusedValue -eq '') {
          Add-WarningText "readFocused '$($step.name)' leyó vacío"
        }
      }
      "conditionalKey" {
        # Manda teclas SOLO si la variable/valor indicado es verdadero
        # (p. ej. espacio para desmarcar Bloq.Venta si estaba marcado).
        $flagName = [string]$step.if
        $shouldSend = $false
        if ($variables.PSObject.Properties.Name -contains $flagName) { $shouldSend = [System.Convert]::ToBoolean($variables.$flagName) }
        elseif ($values.Contains($flagName)) { $shouldSend = [System.Convert]::ToBoolean($values[$flagName]) }
        if ($shouldSend) { Send-StepKeys ([string]$step.keys) }
      }
      "uiaDump" { $values["uiaDumpFile"] = Write-UiaDump $OutDir }
      "uiaFocus" {
        $el = Resolve-UiaTarget $step
        if (-not $el) { throw "uiaFocus: no se encontro el control (label='$($step.label)' id='$($step.automationId)')" }
        $el.SetFocus()
        Start-Sleep -Milliseconds 200
      }
      "uiaRead" {
        $el = Resolve-UiaTarget $step
        if (-not $el) {
          Add-WarningText "uiaRead '$($step.name)': control no encontrado (label='$($step.label)' id='$($step.automationId)')"
          $values[[string]$step.name] = ""
        } elseif (($step.PSObject.Properties.Name -contains "checkbox") -and [System.Convert]::ToBoolean($step.checkbox)) {
          # Checkbox: TogglePattern si existe; si no, heuristica de pixeles
          # sobre el cuadradito (borde izquierdo del control).
          $tp = $null
          if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) {
            $values[[string]$step.name] = ($tp.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On)
          } else {
            $r = $el.Current.BoundingRectangle
            $values[[string]$step.name] = Test-CheckboxChecked ([int]($r.X + 8)) ([int]($r.Y + $r.Height / 2)) 18
          }
        } else {
          $values[[string]$step.name] = Get-UiaValue $el
        }
      }
      "uiaSet" {
        $el = Resolve-UiaTarget $step
        if (-not $el) { throw "uiaSet: no se encontro el control (label='$($step.label)' id='$($step.automationId)')" }
        $vp = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
          $vp.SetValue((Resolve-Template ([string]$step.value)))
        } else {
          $el.SetFocus()
          Start-Sleep -Milliseconds 150
          Send-StepKeys "^a"
          Start-Sleep -Milliseconds 80
          $literal = Resolve-Template ([string]$step.value)
          $escaped = $literal -replace '([+^%~(){}\[\]])', '{$1}'
          [System.Windows.Forms.SendKeys]::SendWait($escaped)
        }
        Start-Sleep -Milliseconds 150
      }
      "typeText" {
        # Teclear el texto con PULSACIONES reales (SendKeys), no con pegar
        # del portapapeles: algunos campos de WinForms antiguos ignoran ^v
        # o no disparan sus validaciones con él. Se escapan los caracteres
        # especiales de SendKeys; para códigos numéricos es transparente.
        $literal = Resolve-Template ([string]$step.value)
        $escaped = $literal -replace '([+^%~(){}\[\]])', '{$1}'
        [System.Windows.Forms.SendKeys]::SendWait($escaped)
      }
      "setField" {
        Click-Point ([int]$step.x) ([int]$step.y)
        Start-Sleep -Milliseconds 100
        Send-StepKeys "^a"
        Start-Sleep -Milliseconds 80
        Send-Text (Resolve-Template ([string]$step.value))
      }
      "copyField" {
        $copied = Copy-Field ([int]$step.x) ([int]$step.y)
        $values[[string]$step.name] = $copied
        if (-not $copied) { Add-WarningText "copyField '$($step.name)' leyó vacío: revisar la coordenada ($($step.x),$($step.y))" }
      }
      "orderLines" { Send-OrderLines $step }
      "checkboxState" {
        $size = 12
        if ($step.PSObject.Properties.Name -contains "size") { $size = [int]$step.size }
        $values[[string]$step.name] = Test-CheckboxChecked ([int]$step.x) ([int]$step.y) $size
      }
      "screenshot" { $screenshotPath = Take-Screenshot $OutDir $Query }
      default { Add-WarningText "Unknown desktop step type: $($step.type)" }
    }
    Start-Sleep -Milliseconds 120
  }

  if (-not $screenshotPath) { $screenshotPath = Take-Screenshot $OutDir $Query }

  [ordered]@{
    status = "ok"; mode = $Mode; query = $Query; values = $values; screenshot = $screenshotPath;
    screen = $screen; windowTitle = $windowTitle; warnings = @($warnings); ranAt = (Get-Date).ToString("o")
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  [ordered]@{
    status = "error"; mode = $Mode; query = $Query; error = $_.Exception.Message;
    values = $values; warnings = @($warnings); ranAt = (Get-Date).ToString("o")
  } | ConvertTo-Json -Compress -Depth 8
  exit 1
}
