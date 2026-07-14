param(
  [Parameter(Mandatory = $true)][string]$Query,
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [ValidateSet("search", "searchCode", "searchName", "clear", "priceRead", "priceApply", "bloqApply", "orderApply", "discard", "uiaDump")][string]$Mode = "search",
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

Add-Type -ReferencedAssemblies Accessibility @"
using System;
using System.Runtime.InteropServices;
using Accessibility;
public class Msaa {
  [DllImport("oleacc.dll")]
  static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint dwId, ref Guid riid, [In, Out, MarshalAs(UnmanagedType.IUnknown)] ref object ppvObject);
  // Estado REAL de un checkbox de WinForms via MSAA (el propio control lo
  // declara por accesibilidad): bit 0x10 = CHECKED. Devuelve 1/0, o -1 si
  // no se pudo leer.
  public static int CheckState(IntPtr hwnd) {
    try {
      Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
      object obj = null;
      int hr = AccessibleObjectFromWindow(hwnd, 0xFFFFFFFC, ref iid, ref obj);
      if (hr != 0 || obj == null) return -1;
      IAccessible acc = (IAccessible)obj;
      object state = acc.get_accState(0);
      if (state is int) return (((int)state & 0x10) != 0) ? 1 : 0;
      return -1;
    } catch { return -1; }
  }
}
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
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, System.Text.StringBuilder lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
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
$script:EditableSnapshot = @{}
$script:LastUiaClickPoint = $null

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
  # @() imprescindible: con UN solo candidato el pipeline desenvuelve la
  # tupla y el indexado devolvía $null ("no se encontró el control" en
  # filas de un solo campo, como Inventariable).
  $sorted = @($row | Sort-Object { $_[0] })
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



# HWND del control (estos controles son ventanas Win32 de verdad): permite
# hablarles por MENSAJES directos, el canal mas fiable con esta app —
# WM_SETTEXT/WM_GETTEXT para texto, BM_GETCHECK/BM_CLICK para checkboxes.
# Ni foco, ni teclado, ni raton.
function Get-UiaHwnd($Element) {
  try { return [IntPtr]([int]$Element.Current.NativeWindowHandle) } catch { return [IntPtr]::Zero }
}

function Read-ControlText($Element) {
  $hwnd = Get-UiaHwnd $Element
  if ($hwnd -ne [IntPtr]::Zero) {
    $len = [int][Win32]::SendMessage($hwnd, 0x000E, [IntPtr]::Zero, [IntPtr]::Zero)  # WM_GETTEXTLENGTH
    $buf = New-Object System.Text.StringBuilder ($len + 2)
    [Win32]::SendMessage($hwnd, 0x000D, [IntPtr]($len + 1), $buf) | Out-Null       # WM_GETTEXT
    return $buf.ToString().Trim()
  }
  return [string](Get-UiaValue $Element)
}

function Write-ControlText($Element, [string]$Text) {
  $hwnd = Get-UiaHwnd $Element
  if ($hwnd -ne [IntPtr]::Zero) {
    [Win32]::SendMessage($hwnd, 0x000C, [IntPtr]::Zero, $Text) | Out-Null           # WM_SETTEXT
    return $true
  }
  return $false
}

function Get-UiaElementKey($Element) {
  if (-not $Element) { return "" }
  $hwnd = Get-UiaHwnd $Element
  if ($hwnd -ne [IntPtr]::Zero) { return "hwnd:$($hwnd.ToInt64())" }
  try {
    $runtimeId = @($Element.GetRuntimeId())
    if ($runtimeId.Count -gt 0) { return "runtime:$($runtimeId -join '.')" }
  } catch { }
  try {
    $r = $Element.Current.BoundingRectangle
    return ("fallback:{0}|{1}|{2}|{3}|{4}|{5}" -f [string]$Element.Current.ClassName, [string]$Element.Current.AutomationId, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
  } catch { return "" }
}

function Get-UiaEditableElements($Root) {
  $result = @()
  if (-not $Root) { return $result }
  try {
    $all = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($cand in $all) {
      try {
        $cls = [string]$cand.Current.ClassName
        $controlType = [string]$cand.Current.ControlType.ProgrammaticName
        if ($cls -notmatch 'EDIT|RichEdit' -and $controlType -notmatch 'ControlType.Edit') { continue }
        $r = $cand.Current.BoundingRectangle
        if ($r.Width -le 0 -or $r.Height -le 0 -or $cand.Current.IsOffscreen) { continue }
        $result += ,$cand
      } catch { }
    }
  } catch { }
  return @($result)
}

function Get-UiaEditableSnapshot($Root) {
  $snapshot = @{}
  foreach ($cand in @(Get-UiaEditableElements $Root)) {
    $key = Get-UiaElementKey $cand
    if ($key) { $snapshot[$key] = $true }
  }
  return $snapshot
}

function Find-UiaEditorByLabel($Root, [string]$Label) {
  if (-not $Root) { return $null }
  $edits = @(Get-UiaEditableElements $Root)
  if ($edits.Count -eq 0) { return $null }
  try {
    $all = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($labelEl in $all) {
      if (([string]$labelEl.Current.Name).Trim() -notmatch ("^(?i:" + [regex]::Escape($Label) + ")$")) { continue }
      $lr = $labelEl.Current.BoundingRectangle
      $sameRow = @()
      foreach ($edit in $edits) {
        $er = $edit.Current.BoundingRectangle
        $labelCenter = $lr.Y + ($lr.Height / 2)
        $editCenter = $er.Y + ($er.Height / 2)
        if ([Math]::Abs($editCenter - $labelCenter) -gt 18) { continue }
        if ($er.X -le $lr.X -or ($er.X - ($lr.X + $lr.Width)) -gt 500) { continue }
        $sameRow += ,$edit
      }
      $sorted = @($sameRow | Sort-Object { $_.Current.BoundingRectangle.X })
      if ($sorted.Count -gt 0) { return $sorted[0] }
    }
  } catch { }
  return $null
}

function Find-UiaInputEditor($Root, $BeforeSnapshot, [bool]$AllowExisting = $false) {
  $candidates = @(Get-UiaEditableElements $Root)
  if ($candidates.Count -eq 0) { return $null }
  if (-not $BeforeSnapshot) { $BeforeSnapshot = @{} }

  $newCandidates = @()
  foreach ($cand in $candidates) {
    $key = Get-UiaElementKey $cand
    if ($key -and -not $BeforeSnapshot.ContainsKey($key)) { $newCandidates += ,$cand }
  }

  $focused = $null
  try { $focused = [System.Windows.Automation.AutomationElement]::FocusedElement } catch { }
  if ($focused) {
    $focusedKey = Get-UiaElementKey $focused
    foreach ($cand in $newCandidates) {
      if ((Get-UiaElementKey $cand) -eq $focusedKey) { return $cand }
    }
  }

  $labeled = Find-UiaEditorByLabel $Root "Ean"
  if ($labeled -and $newCandidates.Count -gt 0) {
    $labeledKey = Get-UiaElementKey $labeled
    foreach ($cand in $newCandidates) {
      if ((Get-UiaElementKey $cand) -eq $labeledKey) { return $labeled }
    }
  }

  if ($newCandidates.Count -eq 1) { return $newCandidates[0] }
  if ($newCandidates.Count -gt 1) {
    if ($script:LastUiaClickPoint) {
      $sorted = @($newCandidates | Sort-Object {
        $r = $_.Current.BoundingRectangle
        $cx = $r.X + ($r.Width / 2)
        $cy = $r.Y + ($r.Height / 2)
        [Math]::Pow($cx - $script:LastUiaClickPoint.x, 2) + [Math]::Pow($cy - $script:LastUiaClickPoint.y, 2)
      })
      return $sorted[0]
    }
    return $newCandidates[0]
  }

  # Some UnideGes builds create the EAN editor in advance. In that case it
  # is not "new", but the modal's Ean label still identifies it safely.
  if ($labeled) { return $labeled }

  if ($AllowExisting) {
    if ($focused) {
      $focusedKey = Get-UiaElementKey $focused
      foreach ($cand in $candidates) {
        if ((Get-UiaElementKey $cand) -eq $focusedKey) { return $cand }
      }
    }
    return $candidates[0]
  }
  return $null
}

function Write-UiaTextVerified($Element, [string]$Text) {
  if (-not $Element) { return $false }
  try { $Element.SetFocus() } catch { }
  Start-Sleep -Milliseconds 80

  if (Write-ControlText $Element $Text) {
    Start-Sleep -Milliseconds 80
    if ((Read-ControlText $Element) -eq $Text) { return $true }
  }

  try {
    $vp = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp) -and -not $vp.Current.IsReadOnly) {
      $vp.SetValue($Text)
      Start-Sleep -Milliseconds 80
      if (([string]$vp.Current.Value).Trim() -eq $Text) { return $true }
    }
  } catch { }

  try {
    $Element.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait("^a")
    [System.Windows.Forms.SendKeys]::SendWait($Text)
    Start-Sleep -Milliseconds 100
    if ((Read-ControlText $Element) -eq $Text) { return $true }
  } catch { }
  return $false
}


# Estado de un checkbox de WinForms por píxeles: se muestrea un cuadrito
# 10x10 CENTRADO EN EL INTERIOR de la casilla (el borde queda fuera). El
# muestreo anterior pisaba el borde, que es oscuro, y devolvía "marcado"
# SIEMPRE — por eso Bloq.Venta se intentaba alternar aunque no hiciera
# falta y acababa en "el estado NO cambió".
function Read-CheckBoxPixels([int]$CenterX, [int]$CenterY) {
  $size = 10
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($CenterX - 5, $CenterY - 5, 0, 0, $bitmap.Size)
  $ink = 0
  for ($ix = 0; $ix -lt $size; $ix++) {
    for ($iy = 0; $iy -lt $size; $iy++) {
      $p = $bitmap.GetPixel($ix, $iy)
      $brightness = (($p.R * 0.299) + ($p.G * 0.587) + ($p.B * 0.114))
      if ($brightness -lt 140) { $ink++ }
    }
  }
  $graphics.Dispose()
  $bitmap.Dispose()
  return ($ink -ge 5)
}

function Read-ControlChecked($Element) {
  # OJO: los checkbox de WinForms NO implementan BM_GETCHECK (devuelve 0
  # siempre, por eso Bloq.Venta "leyó desmarcado" y no se desmarcó). Orden:
  # BM_GETCHECK solo para BUTTON nativos; TogglePattern; y como verdad
  # visual, los píxeles del cuadradito en el rect del propio control.
  $cls = [string]$Element.Current.ClassName
  $hwnd = Get-UiaHwnd $Element
  if ($hwnd -ne [IntPtr]::Zero -and $cls -notmatch 'WindowsForms') {
    $state = [int][Win32]::SendMessage($hwnd, 0x00F0, [IntPtr]::Zero, [IntPtr]::Zero) # BM_GETCHECK
    return ($state -eq 1)
  }
  # MSAA: el propio checkbox declara su estado por accesibilidad. Es la
  # fuente fiable — los píxeles fallaban porque en este control el TEXTO va
  # a la izquierda y el cuadradito a la DERECHA, y muestreábamos las letras.
  if ($hwnd -ne [IntPtr]::Zero) {
    $msaaState = [Msaa]::CheckState($hwnd)
    if ($msaaState -ge 0) { return ($msaaState -eq 1) }
  }
  $tp = $null
  if ($Element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) {
    return ($tp.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On)
  }
  $r = $Element.Current.BoundingRectangle
  # último recurso: píxeles en el lado DERECHO (ahí está el cuadradito)
  return (Read-CheckBoxPixels ([int]($r.X + $r.Width - 8)) ([int]($r.Y + $r.Height / 2)))
}

function Toggle-UiaCheckboxPhysical($Element) {
  $before = Read-ControlChecked $Element
  $r = $Element.Current.BoundingRectangle
  if ($r.IsEmpty -or $r.Width -lt 8 -or $r.Height -lt 8) {
    throw "uiaToggleIf: rectangulo invalido para '$($Element.Current.Name)'"
  }

  if ([Win32]::IsIconic($script:TargetWindowHandle)) {
    [Win32]::ShowWindow($script:TargetWindowHandle, 9) | Out-Null
  }
  [Win32]::SetForegroundWindow($script:TargetWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 220

  # En este WinForms el cuadrado de Bloq.Venta esta a la DERECHA del texto.
  # UnideGes ignora BM_CLICK/WM_LBUTTON*, por eso usamos un clic fisico real.
  $clickX = [int]($r.X + $r.Width - 8)
  $clickY = [int]($r.Y + ($r.Height / 2))
  Click-Point $clickX $clickY

  for ($attempt = 0; $attempt -lt 7; $attempt++) {
    Start-Sleep -Milliseconds 160
    $after = Read-ControlChecked $Element
    if ($after -ne $before) { return $after }
  }

  $cls = [string]$Element.Current.ClassName
  throw "uiaToggleIf: el clic fisico no cambio '$($Element.Current.Name)' (class='$cls', before=$before, x=$clickX, y=$clickY, bounds=$([int]$r.X),$([int]$r.Y),$([int]$r.Width),$([int]$r.Height))"
}
function Resolve-UiaTarget($Step) {
  $label = ""
  $index = 0
  $self = $false
  if ($Step.PSObject.Properties.Name -contains "label") { $label = [string]$Step.label }
  if ($Step.PSObject.Properties.Name -contains "index") { $index = [int]$Step.index }
  if ($Step.PSObject.Properties.Name -contains "self") { $self = [System.Convert]::ToBoolean($Step.self) }
  if ($label) { return Find-UiaByLabel $label $index $self }
  if ($Step.PSObject.Properties.Name -contains "classRegex") {
    $root = Get-UiaRoot
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($cand in $all) {
      if (([string]$cand.Current.ClassName) -match [string]$Step.classRegex) { return $cand }
    }
    return $null
  }
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

# Garantía de orden en los modos que ESCRIBEN (priceApply/bloqApply):
# Ctrl+S tiene que ser lo último que modifica. Dos protecciones:
#   1. Un paso "vaciar/limpiar pantalla" ANTES del Ctrl+S se SALTA (con
#      aviso): limpiar con cambios pendientes dispara el diálogo
#      "¿guardar cambios?" que se queda bloqueando todo lo demás.
#   2. Un paso que modifica DESPUÉS del último Ctrl+S corta con error
#      claro: hay que moverlo antes del ^s en config.local.json.
function Assert-SaveIsLast($Steps, [string]$ActionMode) {
  $saveIdx = -1
  for ($i = 0; $i -lt $Steps.Count; $i++) {
    $s = $Steps[$i]
    if (($s.type -eq "hotkey" -or $s.type -eq "key") -and (([string]$s.keys) -match "\^s")) { $saveIdx = $i }
  }
  if ($saveIdx -lt 0) { return ,@($Steps) }
  $out = @()
  for ($i = 0; $i -lt $Steps.Count; $i++) {
    $s = $Steps[$i]
    $stepName = ""
    if ($s.PSObject.Properties.Name -contains "name") { $stepName = [string]$s.name }
    if ($i -lt $saveIdx -and $stepName -match "(?i)vaciar|limpiar") {
      Add-WarningText "Paso '$stepName' saltado en ${ActionMode}: limpiar pantalla antes de Ctrl+S dispara el dialogo de guardar"
      continue
    }
    if ($i -gt $saveIdx -and @("wait", "closeDialog", "screenshot", "focus") -notcontains $s.type) {
      throw "${ActionMode}: el paso '$($s.type)' va DESPUES del Ctrl+S. Guardar debe ser lo ultimo que modifica; mueve ese paso antes del hotkey ^s en config.local.json."
    }
    $out += $s
  }
  return ,$out
}

function Get-Steps($Config, [string]$ActionMode) {
  if ($ActionMode -eq "clear") { $steps = @($Config.desktop.clearSteps) }
  elseif ($ActionMode -eq "priceRead") { $steps = @($Config.desktop.priceReadSteps) }
  elseif ($ActionMode -eq "priceApply") { $steps = Assert-SaveIsLast @($Config.desktop.priceApplySteps) "priceApply" }
  elseif ($ActionMode -eq "bloqApply") {
    $steps = @($Config.desktop.bloqApplySteps)
    if ($steps.Count -eq 0) {
      throw "bloqApplySteps sin configurar en config.local.json: copia la plantilla de config.example.json (marcar/desmarcar Bloq.Venta + Ctrl+S)."
    }
    $steps = Assert-SaveIsLast $steps "bloqApply"
  }
  elseif ($ActionMode -eq "discard") {
    # Descartar cambios sin guardar: vaciar pantalla + responder "No" al
    # aviso de guardar. Sin discardSteps calibrados se reutiliza el PREFIJO
    # de codeSearchSteps (focus + clic en vaciar + closeDialog con 'n'),
    # que la tienda ya tiene afinado — se corta justo antes del primer
    # paso que escribe algo.
    $steps = @()
    if ($Config.desktop.PSObject.Properties.Name -contains "discardSteps") {
      $steps = @($Config.desktop.discardSteps) | Where-Object { $_ }
    }
    if (@($steps).Count -eq 0) {
      $steps = @()
      foreach ($s in @($Config.desktop.codeSearchSteps)) {
        if (-not $s) { continue }
        if (@("uiaSet", "setField", "text", "hotkey", "key", "tab") -contains $s.type) { break }
        $steps += $s
      }
    }
    if (@($steps).Count -eq 0) { throw "discard: ni discardSteps ni un prefijo utilizable de codeSearchSteps en config.local.json" }
  }
  elseif ($ActionMode -eq "orderApply") { $steps = @($Config.desktop.orderApplySteps) }
  elseif ($ActionMode -eq "uiaDump") {
    $steps = @([pscustomobject]@{ type = "focus" }, [pscustomobject]@{ type = "uiaDump" })
  }
  elseif ($ActionMode -eq "searchName") {
    # Búsqueda por NOMBRE en Artículos: el campo del nombre está a UN Tab
    # del campo Código, y admite comodines (*nombre*). Sin nameSearchSteps
    # calibrados se deriva de codeSearchSteps: mismo flujo (vaciar, F3,
    # fila TIENDA, captura), pero en vez de escribir en Código se enfoca
    # Código, Tab al nombre y se pega *{{query}}*.
    $steps = @()
    if ($Config.desktop.PSObject.Properties.Name -contains "nameSearchSteps") {
      $steps = @($Config.desktop.nameSearchSteps) | Where-Object { $_ }
    }
    if (@($steps).Count -eq 0) {
      $steps = @()
      foreach ($s in @($Config.desktop.codeSearchSteps)) {
        if (-not $s) { continue }
        if ($s.type -eq "uiaSet" -and ($s.PSObject.Properties.Name -contains "label") -and (([string]$s.label) -eq "Código")) {
          $steps += [pscustomobject]@{ type = "uiaFocus"; label = "Código"; name = "Foco en Código para saltar al nombre" }
          $steps += [pscustomobject]@{ type = "tab"; count = 1 }
          $steps += [pscustomobject]@{ type = "text"; value = "*{{query}}*"; name = "Nombre con comodines" }
        } else {
          $steps += $s
        }
      }
    }
    if (@($steps).Count -eq 0) { throw "searchName: ni nameSearchSteps ni codeSearchSteps utilizables en config.local.json" }
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
  else {
    # Modo search = búsqueda por EAN (el "catalejo" junto al grid Ean).
    # Prioridad: eanSearchSteps calibrados > secuencia integrada > steps
    # legado. Los steps legados eran coordenadas de pantalla de hace mucho
    # y en la tienda ya no dan en el botón (clics al vacío, "no pasa nada").
    # La secuencia integrada no usa coordenadas absolutas: reutiliza el
    # prefijo de codeSearchSteps de la tienda (vaciar pantalla + responder
    # No al aviso) y pulsa el catalejo por su desplazamiento respecto a la
    # BARRA DE HERRAMIENTAS (ancla estable), teclea el EAN y Enter; después
    # el mismo cierre que la búsqueda por código (aviso, fila TIENDA, foto).
    $steps = @()
    if ($Config.desktop.PSObject.Properties.Name -contains "eanSearchSteps") {
      $steps = @($Config.desktop.eanSearchSteps) | Where-Object { $_ }
    }
    if (@($steps).Count -eq 0) {
      $prefijo = @()
      foreach ($s in @($Config.desktop.codeSearchSteps)) {
        if (-not $s) { continue }
        if (@("uiaSet", "setField", "text", "hotkey", "key", "tab") -contains $s.type) { break }
        $prefijo += $s
      }
      if (@($prefijo).Count -gt 0) {
        $steps = $prefijo + @(
          [pscustomobject]@{ type = "uiaClickAt"; anchorClassRegex = "ToolbarWindow32"; dx = 299; dy = 491; name = "Catalejo del grid Ean (offset desde la barra de herramientas)" },
          [pscustomobject]@{ type = "wait"; ms = 900 },
          [pscustomobject]@{ type = "typeInEmergent"; value = "{{query}}"; name = "EAN en el dialogo del catalejo (foco + WM_SETTEXT + Enter)" },
          [pscustomobject]@{ type = "wait"; ms = 2000 },
          [pscustomobject]@{ type = "closeDialog"; name = "Aviso inutil post-busqueda; sin aviso no hace nada" },
          [pscustomobject]@{ type = "listSelectLast"; classRegex = "SysListView32"; name = "Seleccionar la fila TIENDA (la ultima)" },
          [pscustomobject]@{ type = "wait"; ms = 800 },
          [pscustomobject]@{ type = "screenshot"; name = "Articulo cargado por EAN" }
        )
      }
    }
    if (@($steps).Count -eq 0) { $steps = @($Config.desktop.steps) }
  }
  if (@($steps).Count -eq 0) { throw "$ActionMode steps are not configured in config.local.json" }
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
      "typeInEmergent" {
        $valueTxt = Resolve-Template ([string]$step.value)
        $endKeys = "{ENTER}"
        if ($step.PSObject.Properties.Name -contains "keys") { $endKeys = [string]$step.keys }

        # El catalejo puede crear otro top-level o mostrar el editor EAN
        # dentro de la ventana principal. El clic por WM_* no transfiere
        # necesariamente el foco, por lo que se identifica el EDIT real y
        # se verifica que contenga el EAN antes de mandar Enter.
        $emergentWaitMs = 1500
        if ($step.PSObject.Properties.Name -contains "waitMs") { $emergentWaitMs = [int]$step.waitMs }
        $waitLimit = [DateTime]::Now.AddMilliseconds($emergentWaitMs)
        $emergent = [IntPtr]::Zero
        $editor = $null
        $retryAt = [DateTime]::Now.AddMilliseconds(450)
        $retriedPhysicalClick = $false

        while ([DateTime]::Now -lt $waitLimit) {
          $newWindowSeen = $false
          $ahora = [WinEnum]::VisibleWindowsOfPid([uint32]$script:TargetPid)
          foreach ($h in $ahora) {
            if ($script:KnownHandles.Contains($h)) { continue }
            $newWindowSeen = $true
            try {
              $candidateWindow = [IntPtr]$h
              $candidateRoot = [System.Windows.Automation.AutomationElement]::FromHandle($candidateWindow)
              $candidateEditor = Find-UiaInputEditor $candidateRoot @{} $true
              if ($candidateEditor) {
                $emergent = $candidateWindow
                $editor = $candidateEditor
                break
              }
            } catch { }
          }

          if (-not $editor) {
            try {
              $mainRoot = Get-UiaRoot
              $editor = Find-UiaInputEditor $mainRoot $script:EditableSnapshot $false
            } catch { }
          }

          if (-not $editor -and -not $newWindowSeen -and -not $retriedPhysicalClick -and [DateTime]::Now -ge $retryAt -and $script:LastUiaClickPoint) {
            [Win32]::SetForegroundWindow($script:TargetWindowHandle) | Out-Null
            Start-Sleep -Milliseconds 120
            Click-Point ([int]$script:LastUiaClickPoint.x) ([int]$script:LastUiaClickPoint.y)
            $retriedPhysicalClick = $true
            Add-WarningText "Catalejo EAN: primer clic sin editor; se hizo un segundo clic fisico"
            continue
          }

          if ($editor) { break }
          Start-Sleep -Milliseconds 150
        }

        if (-not $editor) {
          throw "typeInEmergent: el catalejo no abrio un campo EAN despues del clic fisico"
        }

        $targetHandle = if ($emergent -ne [IntPtr]::Zero) { $emergent } else { $script:TargetWindowHandle }
        [Win32]::SetForegroundWindow($targetHandle) | Out-Null
        Start-Sleep -Milliseconds 150

        if (-not (Write-UiaTextVerified $editor $valueTxt)) {
          throw "typeInEmergent: se encontro el campo EAN, pero no se pudo escribir/verificar '$valueTxt'"
        }

        $values["eanEditor"] = Get-UiaElementKey $editor
        try { $editor.SetFocus() } catch { }
        Start-Sleep -Milliseconds 120
        [System.Windows.Forms.SendKeys]::SendWait($endKeys)
      }
      "uiaClickAt" {
        # Clic REAL en un punto definido por un desplazamiento desde un
        # control ancla. WM_LBUTTONDOWN/UP parecia funcionar, pero UnideGes
        # ignoraba esos mensajes en el catalejo EAN. El raton fisico replica
        # exactamente el clic manual que si abre el editor.
        $anchor = $null
        $root = Get-UiaRoot
        $script:EditableSnapshot = Get-UiaEditableSnapshot $root
        $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($cand in $all) {
          if (([string]$cand.Current.ClassName) -match [string]$step.anchorClassRegex) { $anchor = $cand; break }
        }
        if (-not $anchor) { throw "uiaClickAt: ancla no encontrada (classRegex '$($step.anchorClassRegex)')" }

        $ar = $anchor.Current.BoundingRectangle
        $px = [int]($ar.X + [int]$step.dx)
        $py = [int]($ar.Y + [int]$step.dy)
        $script:LastUiaClickPoint = [pscustomobject]@{ x = $px; y = $py }

        if ([Win32]::IsIconic($script:TargetWindowHandle)) {
          [Win32]::ShowWindow($script:TargetWindowHandle, 9) | Out-Null
        }
        [Win32]::SetForegroundWindow($script:TargetWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 220
        Click-Point $px $py
        Start-Sleep -Milliseconds 200
      }
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
          $values[[string]$step.name] = Read-ControlChecked $el
        } else {
          $values[[string]$step.name] = Read-ControlText $el
        }
      }
      "uiaSet" {
        $el = Resolve-UiaTarget $step
        if (-not $el) { throw "uiaSet: no se encontro el control (label='$($step.label)' id='$($step.automationId)')" }
        $textValue = Resolve-Template ([string]$step.value)
        if (-not (Write-ControlText $el $textValue)) {
          $vp = $null
          if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
            $vp.SetValue($textValue)
          } else {
            throw "uiaSet: el control (label='$($step.label)') no tiene HWND ni ValuePattern"
          }
        }
        Start-Sleep -Milliseconds 150
      }
      "uiaToggleIf" {
        # Alterna el checkbox solo cuando la variable lo pide. Tiene que ser
        # un clic fisico: esta version de UnideGes ignora BM_CLICK y mensajes
        # WM_LBUTTON enviados en segundo plano aunque el cursor parezca estar
        # encima del control.
        $flagName = [string]$step.if
        $shouldToggle = $false
        if ($variables.PSObject.Properties.Name -contains $flagName) { $shouldToggle = [System.Convert]::ToBoolean($variables.$flagName) }
        elseif ($values.Contains($flagName)) { $shouldToggle = [System.Convert]::ToBoolean($values[$flagName]) }
        if ($shouldToggle) {
          $el = Resolve-UiaTarget $step
          if (-not $el) { throw "uiaToggleIf: no se encontro el control (label='$($step.label)')" }
          $values["bloqVentaAfterClick"] = Toggle-UiaCheckboxPhysical $el
        }
      }
      "listSelectLast" {
        # Selecciona la ULTIMA fila de la lista SDC/TIENDA (SysListView32):
        # la fila TIENDA — la editable — es la de abajo; el formulario de
        # arriba muestra el registro seleccionado. Se manda VK_END por
        # mensaje al propio control (procesa la tecla y notifica al padre,
        # que recarga el formulario con TIENDA); si no cambia la seleccion,
        # clic por mensajes en la fila estimada.
        $el = Resolve-UiaTarget $step
        if (-not $el) { throw "listSelectLast: no se encontro la lista (classRegex='$($step.classRegex)')" }
        $hwnd = Get-UiaHwnd $el
        if ($hwnd -eq [IntPtr]::Zero) { throw "listSelectLast: la lista no tiene HWND" }
        $count = [int][Win32]::SendMessage($hwnd, 0x1004, [IntPtr]::Zero, [IntPtr]::Zero)  # LVM_GETITEMCOUNT
        if ($count -le 0) { throw "listSelectLast: la lista esta vacia (¿articulo no cargado?)" }
        [Win32]::SendMessage($hwnd, 0x0100, [IntPtr]0x23, [IntPtr]::Zero) | Out-Null  # WM_KEYDOWN VK_END
        [Win32]::SendMessage($hwnd, 0x0101, [IntPtr]0x23, [IntPtr]::Zero) | Out-Null  # WM_KEYUP
        Start-Sleep -Milliseconds 500
        $sel = [int][Win32]::SendMessage($hwnd, 0x100C, [IntPtr](-1), [IntPtr]2)  # LVM_GETNEXTITEM LVNI_SELECTED
        if ($sel -ne ($count - 1)) {
          # Fallback: clic por mensajes sobre la fila estimada (cabecera ~20px, fila ~18px)
          $yy = 20 + (($count - 1) * 18) + 9
          $pt = [IntPtr](($yy -shl 16) -bor 40)
          [Win32]::SendMessage($hwnd, 0x0201, [IntPtr]1, $pt) | Out-Null
          Start-Sleep -Milliseconds 60
          [Win32]::SendMessage($hwnd, 0x0202, [IntPtr]0, $pt) | Out-Null
          Start-Sleep -Milliseconds 500
          $sel = [int][Win32]::SendMessage($hwnd, 0x100C, [IntPtr](-1), [IntPtr]2)
        }
        if ($sel -ne ($count - 1)) {
          Add-WarningText "listSelectLast: seleccion en fila $sel de $count (se esperaba la ultima)"
        }
      }
      "uiaKey" {
        # Manda una tecla POR MENSAJE directamente al control (p. ej. F2 en
        # P. defecto para que recalcule el P.TPV). No necesita foco.
        $el = Resolve-UiaTarget $step
        if (-not $el) { throw "uiaKey: no se encontro el control (label='$($step.label)')" }
        $hwnd = Get-UiaHwnd $el
        if ($hwnd -eq [IntPtr]::Zero) { throw "uiaKey: el control no tiene HWND" }
        $vkMap = @{ "F2" = 0x71; "F3" = 0x72; "ENTER" = 0x0D; "END" = 0x23; "TAB" = 0x09; "ESC" = 0x1B }
        $vk = 0
        $vkName = [string]$step.vk
        if ($vkMap.ContainsKey($vkName.ToUpperInvariant())) { $vk = [int]$vkMap[$vkName.ToUpperInvariant()] }
        elseif ($vkName -match '^\d+$') { $vk = [int]$vkName }
        if ($vk -le 0) { throw "uiaKey: vk desconocida '$vkName'" }
        [Win32]::SendMessage($hwnd, 0x0100, [IntPtr]$vk, [IntPtr]::Zero) | Out-Null
        Start-Sleep -Milliseconds 60
        [Win32]::SendMessage($hwnd, 0x0101, [IntPtr]$vk, [IntPtr]::Zero) | Out-Null
        Start-Sleep -Milliseconds 200
      }
      "uiaClickMsg" {
        # Clic POR MENSAJES dentro de un control, en un offset relativo a su
        # esquina (no es un clic inyectado: el control lo procesa el mismo).
        # Se usa para el boton "Vaciar pantalla" de la barra de herramientas,
        # que no tiene atajo de teclado.
        $el = Resolve-UiaTarget $step
        if (-not $el) { throw "uiaClickMsg: no se encontro el control (classRegex='$($step.classRegex)')" }
        $hwnd = Get-UiaHwnd $el
        if ($hwnd -eq [IntPtr]::Zero) { throw "uiaClickMsg: el control no tiene HWND" }
        $ox = [int]$step.offsetX
        $oy = [int]$step.offsetY
        $pt = [IntPtr](($oy -shl 16) -bor ($ox -band 0xFFFF))
        [Win32]::SendMessage($hwnd, 0x0201, [IntPtr]1, $pt) | Out-Null
        Start-Sleep -Milliseconds 80
        [Win32]::SendMessage($hwnd, 0x0202, [IntPtr]0, $pt) | Out-Null
        Start-Sleep -Milliseconds 300
      }
      "uiaSelectIfEmpty" {
        # Rellena un combo SOLO si está vacío (regla del usuario: fruta sin
        # proveedor conocido → elegir uno minoritario; Inventariable → si).
        # Lo que ya tiene valor no se toca jamás.
        $el = Resolve-UiaTarget $step
        if (-not $el) { throw "uiaSelectIfEmpty: no se encontro el control (label='$($step.label)')" }
        $current = Read-ControlText $el
        if (-not $current) {
          $hwnd = Get-UiaHwnd $el
          if ($hwnd -eq [IntPtr]::Zero) { throw "uiaSelectIfEmpty: el control no tiene HWND" }
          $target = Resolve-Template ([string]$step.value)
          $cls = [string]$el.Current.ClassName
          if ($cls -match 'COMBOBOX') {
            # Combo: seleccionar la opción que empieza por el texto.
            $res = [int][Win32]::SendMessage($hwnd, 0x014D, [IntPtr](-1), $target)  # CB_SELECTSTRING
            if ($res -lt 0) {
              Add-WarningText "uiaSelectIfEmpty '$($step.label)': ninguna opción empieza por '$target'"
            } else {
              Add-WarningText "Autorrellenado '$($step.label)' = '$target' (estaba vacío)"
            }
          } else {
            # Cuadro de texto (p. ej. el CÓDIGO de proveedor): escribirlo.
            Write-ControlText $el $target | Out-Null
            Add-WarningText "Autorrellenado '$($step.label)' = '$target' (estaba vacío)"
          }
          Start-Sleep -Milliseconds 250
        }
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
