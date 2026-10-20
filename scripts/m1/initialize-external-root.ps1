param(
    [Parameter(Mandatory = $true)][string]$RootPath,
    [Parameter(Mandatory = $true)][string]$ManifestPath
)

$ErrorActionPreference = 'Stop'
$expectedRoot = [System.IO.Path]::GetFullPath($RootPath).TrimEnd('\\')
$expectedFixedRoot = 'D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136'
if ($expectedRoot -cne $expectedFixedRoot) {
    throw "External root differs from the approved fixed path: $expectedRoot"
}

if (Test-Path -LiteralPath $ManifestPath) {
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    if ([string]$manifest.root -cne $expectedRoot) {
        throw "External-root manifest points elsewhere: $($manifest.root)"
    }
    if (-not (Test-Path -LiteralPath $expectedRoot -PathType Container)) {
        throw "Manifest exists but its external root is missing; refusing to recreate: $expectedRoot"
    }
    [pscustomobject]@{ action = 'verified'; root = $expectedRoot; manifest = $ManifestPath }
    return
}

$action = 'reused-existing'
if (-not (Test-Path -LiteralPath $expectedRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $expectedRoot -Force | Out-Null
    $action = 'created'
}
$payload = [ordered]@{
    schema_version = 1
    root = $expectedRoot
    initialization_action = $action
    authoritative_for_resumption = $true
    previous_root = 'C:\Users\hesan\AppData\Local\Temp\FetchCV-M1\20260910-235136'
    migration_reason = 'The prior TEMP location disappeared between sessions; cleanup actor is unknown.'
    created_at_utc = [DateTime]::UtcNow.ToString('o')
}
$manifestParent = Split-Path -Parent $ManifestPath
New-Item -ItemType Directory -Path $manifestParent -Force | Out-Null
[System.IO.File]::WriteAllText(
    [System.IO.Path]::GetFullPath($ManifestPath),
    ($payload | ConvertTo-Json -Depth 3) + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
)
[pscustomobject]@{ action = $action; root = $expectedRoot; manifest = $ManifestPath }
