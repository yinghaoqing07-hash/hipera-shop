# =====================================================================
# raw-print.ps1 — envia un archivo de bytes "tal cual" (RAW) a una
# impresora de Windows, usando la API del spooler (WritePrinter).
# =====================================================================
# Por que asi: la XP-80T ya tiene su driver de Windows instalado
# (XP-80C). Mandando los bytes ESC/POS con tipo de datos "RAW" el
# spooler los pasa al puerto sin reinterpretarlos (sin GDI). Es la forma
# estandar de imprimir ESC/POS en una impresora con driver de Windows,
# sin tener que reemplazar el driver por WinUSB (Zadig).
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File raw-print.ps1 `
#       -PrinterName "XP-80C" -FilePath "C:\ruta\ticket.bin"
#
# Codigos de salida:
#   0 = OK
#   2 = no se pudo abrir la impresora (nombre mal o impresora offline)
#   3 = error escribiendo
#   4 = archivo no encontrado

param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$FilePath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $FilePath)) {
  Write-Error "Archivo no encontrado: $FilePath"
  exit 4
}

$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  // Devuelve: 0 OK, 2 no abre, 3 error escritura.
  public static int Send(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return 2;
    try {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = "HIPERA Ticket";
      di.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, di)) return 3;
      try {
        if (!StartPagePrinter(hPrinter)) return 3;
        IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
          int written;
          if (!WritePrinter(hPrinter, pUnmanaged, bytes.Length, out written)) return 3;
        } finally {
          Marshal.FreeCoTaskMem(pUnmanaged);
        }
        EndPagePrinter(hPrinter);
      } finally {
        EndDocPrinter(hPrinter);
      }
    } finally {
      ClosePrinter(hPrinter);
    }
    return 0;
  }
}
"@

Add-Type -TypeDefinition $code -Language CSharp

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$result = [RawPrinter]::Send($PrinterName, $bytes)

if ($result -eq 0) {
  exit 0
} elseif ($result -eq 2) {
  Write-Error "No se pudo abrir la impresora '$PrinterName' (nombre incorrecto u offline)."
  exit 2
} else {
  Write-Error "Error escribiendo en la impresora '$PrinterName'."
  exit 3
}
