param([Parameter(Mandatory = $true)][string]$InputPath)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-EntryText($Zip, [string]$Name) {
  $entry = $Zip.GetEntry($Name)
  if (-not $entry) { return $null }
  $reader = [System.IO.StreamReader]::new($entry.Open(), [System.Text.Encoding]::UTF8)
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Column-Index([string]$Reference) {
  $letters = ([regex]::Match($Reference, '^[A-Z]+')).Value
  $index = 0
  foreach ($char in $letters.ToCharArray()) { $index = ($index * 26) + ([int]$char - [int][char]'A' + 1) }
  return $index - 1
}

try {
  $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $InputPath))
  try {
    $shared = @()
    $sharedXml = Get-EntryText $zip 'xl/sharedStrings.xml'
    if ($sharedXml) {
      [xml]$doc = $sharedXml
      $ns = [System.Xml.XmlNamespaceManager]::new($doc.NameTable)
      $ns.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
      foreach ($si in $doc.SelectNodes('//x:si', $ns)) {
        $parts = @($si.SelectNodes('.//x:t', $ns) | ForEach-Object { $_.'#text' })
        $shared += ($parts -join '')
      }
    }

    $sheetName = 'xl/worksheets/sheet1.xml'
    $workbookXml = Get-EntryText $zip 'xl/workbook.xml'
    $relsXml = Get-EntryText $zip 'xl/_rels/workbook.xml.rels'
    if ($workbookXml -and $relsXml) {
      [xml]$workbook = $workbookXml
      [xml]$rels = $relsXml
      $wNs = [System.Xml.XmlNamespaceManager]::new($workbook.NameTable)
      $wNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
      $wNs.AddNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
      $firstSheet = $workbook.SelectSingleNode('//x:sheets/x:sheet[1]', $wNs)
      if ($firstSheet) {
        $relId = $firstSheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
        $rel = @($rels.Relationships.Relationship | Where-Object { $_.Id -eq $relId }) | Select-Object -First 1
        if ($rel -and $rel.Target) {
          $target = [string]$rel.Target
          if ($target.StartsWith('/')) { $sheetName = $target.TrimStart('/') }
          elseif ($target.StartsWith('xl/')) { $sheetName = $target }
          else { $sheetName = 'xl/' + $target.TrimStart('./') }
        }
      }
    }

    $sheetXml = Get-EntryText $zip $sheetName
    if (-not $sheetXml) { throw "No se encontro la primera hoja: $sheetName" }
    [xml]$sheet = $sheetXml
    $sNs = [System.Xml.XmlNamespaceManager]::new($sheet.NameTable)
    $sNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    $rows = @()
    foreach ($rowNode in $sheet.SelectNodes('//x:sheetData/x:row', $sNs)) {
      $values = @{}
      $max = -1
      foreach ($cell in $rowNode.SelectNodes('./x:c', $sNs)) {
        $index = Column-Index ([string]$cell.r)
        if ($index -gt $max) { $max = $index }
        $type = [string]$cell.t
        $valueNode = $cell.SelectSingleNode('./x:v', $sNs)
        $value = if ($valueNode) { [string]$valueNode.InnerText } else { '' }
        if ($type -eq 's' -and $value -match '^\d+$') { $value = [string]$shared[[int]$value] }
        elseif ($type -eq 'inlineStr') {
          $value = (@($cell.SelectNodes('.//x:t', $sNs) | ForEach-Object { $_.'#text' }) -join '')
        }
        elseif ($type -eq 'b') { $value = if ($value -eq '1') { 'true' } else { 'false' } }
        $values[$index] = $value
      }
      if ($max -ge 0) {
        $array = @()
        for ($i = 0; $i -le $max; $i++) { $array += $(if ($values.ContainsKey($i)) { [string]$values[$i] } else { '' }) }
        $rows += ,$array
      }
    }
    [ordered]@{ status = 'ok'; rows = $rows; sheet = $sheetName } | ConvertTo-Json -Compress -Depth 8
  } finally { $zip.Dispose() }
} catch {
  [ordered]@{ status = 'error'; error = $_.Exception.Message } | ConvertTo-Json -Compress -Depth 5
  exit 1
}
