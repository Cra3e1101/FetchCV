param(
    [Parameter(Mandatory = $true)][string]$OriginalManifest,
    [Parameter(Mandatory = $true)][string]$RevisionManifest
)

$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $RevisionManifest) {
    throw "Refusing to overwrite revision manifest: $RevisionManifest"
}
$original = Get-Content -LiteralPath $OriginalManifest -Raw | ConvertFrom-Json
$totalBytes = [long](($original.files | Measure-Object -Property bytes -Sum).Sum)
$revision = [ordered]@{
    schema_version = 1
    revises = [System.IO.Path]::GetFullPath($OriginalManifest)
    reason = 'The original PowerShell ordered-map records were not property-bindable by Measure-Object.'
    original_total_bytes = $original.total_bytes
    corrected_total_bytes = $totalBytes
    file_count = @($original.files).Count
    files_sha256 = @($original.files | ForEach-Object { $_.sha256 })
}
[System.IO.File]::WriteAllText(
    [System.IO.Path]::GetFullPath($RevisionManifest),
    ($revision | ConvertTo-Json -Depth 4) + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
)
[pscustomobject]$revision | Select-Object revises, reason, corrected_total_bytes, file_count | Format-List
