param([Parameter(Mandatory = $true)][string]$OutputPath)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
if (-not $outputFullPath.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Measurement output must stay inside the project.'
}
if (Test-Path -LiteralPath $outputFullPath) { throw 'Measurement output already exists; refuse to overwrite.' }
$files = [Collections.Generic.List[object]]::new()
$pending = [Collections.Generic.Stack[string]]::new()
$pending.Push($projectRoot)
$failure = $null
try {
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        foreach ($entry in Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop) {
            $relative = [IO.Path]::GetRelativePath($projectRoot, $entry.FullName).Replace('\', '/')
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Cannot include reparse point without checking its target: $relative"
            }
            if ($entry.PSIsContainer) { $pending.Push($entry.FullName) }
            else { $files.Add(@{path=$relative; bytes=$entry.Length}) }
        }
    }
} catch {
    $failure = @{directory=$directory; error=$_.Exception.Message}
}
$result = @{
    measuredAtUtc=[DateTime]::UtcNow.ToString('o')
    root=$projectRoot
    complete=($null -eq $failure)
    excluded=@()
    files=@($files.ToArray())
    failure=$failure
    note='Logical file bytes for all project directories, including Git and M1 evidence/quarantine/work. Snapshot precedes writing this output. Incomplete results are not whole-project totals.'
}
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $outputFullPath -Encoding utf8
if ($failure) { throw "M1 STOP: tree measurement incomplete. $($failure.error)" }
$files | Group-Object { ($_.path -split '/')[0] } | ForEach-Object {
    [pscustomobject]@{path=$_.Name; files=$_.Count; bytes=($_.Group | Measure-Object -Property bytes -Sum).Sum}
}
