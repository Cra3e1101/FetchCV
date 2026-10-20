param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [Parameter(Mandatory = $true)][string]$StageRoot,
    [Parameter(Mandatory = $true)][string]$ManifestPath
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$stage = (Resolve-Path -LiteralPath $StageRoot).Path
if ((Get-ChildItem -LiteralPath $stage -Force | Measure-Object).Count -ne 0) {
    throw "Staging directory is not empty: $stage"
}
if (Test-Path -LiteralPath $ManifestPath) {
    throw "Refusing to overwrite manifest: $ManifestPath"
}

$sourceRoot = Join-Path $project 'backend'
$packageNames = @('applyos_agent', 'applyos_api', 'applyos_domain', 'applyos_harness', 'integrations')
$sourceFiles = @((Join-Path $sourceRoot 'pyproject.toml'))
foreach ($packageName in $packageNames) {
    $packageRoot = Join-Path $sourceRoot $packageName
    $sourceFiles += Get-ChildItem -LiteralPath $packageRoot -Recurse -File |
        Where-Object { $_.Extension -in @('.py', '.md') } |
        Select-Object -ExpandProperty FullName
}

$totalBytes = [long]0
$records = foreach ($sourceFile in ($sourceFiles | Sort-Object)) {
    $relative = [System.IO.Path]::GetRelativePath($sourceRoot, $sourceFile)
    $destination = Join-Path $stage $relative
    $destinationParent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    Copy-Item -LiteralPath $sourceFile -Destination $destination
    $sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $stagedHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceHash -ne $stagedHash) {
        throw "Hash mismatch after staging: $relative"
    }
    $fileBytes = (Get-Item -LiteralPath $destination).Length
    $totalBytes += $fileBytes
    [pscustomobject][ordered]@{
        path = $relative.Replace('\\', '/')
        bytes = $fileBytes
        sha256 = $stagedHash
    }
}

$manifest = [ordered]@{
    source_root = $sourceRoot
    stage_root = $stage
    file_count = @($records).Count
    total_bytes = $totalBytes
    files = @($records)
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ManifestPath -Encoding utf8
[pscustomobject]$manifest | Select-Object source_root, stage_root, file_count, total_bytes | Format-List
