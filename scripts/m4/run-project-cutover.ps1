param([Parameter(Mandatory=$true)][ValidatePattern('^m4c-project-[a-z0-9-]+$')][string]$Label)
$ErrorActionPreference = 'Stop'
$project = 'D:\hesan\Desktop\VSCODES\FetchCV_Windows'
$stable = 'D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136'
$source = Join-Path $project 'backend\data\fetchcv.db'
$runRoot = Join-Path $stable $Label
if (-not (Test-Path -LiteralPath $stable -PathType Container)) { throw 'Stable root missing; no Temp fallback.' }
if (Test-Path -LiteralPath $runRoot) { throw 'A fresh run root is required.' }
foreach ($suffix in @('-wal','-journal')) {
  if (Test-Path -LiteralPath ($source + $suffix)) { throw 'This approved source requires a separate live-WAL quiescence review.' }
}
# Read-only Windows handle denies concurrent write/delete opens for the entire
# final snapshot -> review -> publish -> APP validation interval. No ACL change.
$lease = [System.IO.File]::Open($source,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read)
$previousLocation = Get-Location
$previousPid = $env:M4_SOURCE_LEASE_PID
$previousHash = $env:M4_SOURCE_LEASE_HASH
$code = 1
try {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $before = [BitConverter]::ToString($sha.ComputeHash($lease)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
  $lease.Position = 0
  $env:M4_SOURCE_LEASE_PID = [string]$PID
  $env:M4_SOURCE_LEASE_HASH = $before
  Set-Location -LiteralPath $project
  $ErrorActionPreference = 'Continue' # Native stderr is not the native exit code.
  & 'D:\Nodev\node.exe' 'scripts/m1/run-guarded-node.mjs' --label $Label --temp-root $runRoot -- 'D:\Nodev\node.exe' 'scripts/m4/launch-project-cutover.mjs'
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $after = [BitConverter]::ToString($sha.ComputeHash($lease)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
  $receipt = [pscustomobject]@{ source=$source; runRoot=$runRoot; mode='FileAccess.Read/FileShare.Read'; sourceBefore=$before; sourceAfter=$after; sourceUnchanged=($before -eq $after); childExit=$code; leaseHeldUntilChildExited=$true }
  $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $project ".m1-evidence\$Label-source-lease.json") -Encoding UTF8
  if ($before -ne $after) { $code = 2 }
} finally {
  $lease.Dispose()
  $env:M4_SOURCE_LEASE_PID = $previousPid
  $env:M4_SOURCE_LEASE_HASH = $previousHash
  Set-Location -LiteralPath $previousLocation.Path
}
exit $code
