$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BuildScript = Join-Path $PSScriptRoot "build-sidecar.mjs"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required to build the FetchCV sidecar."
}

Push-Location $ProjectRoot
try {
  & node $BuildScript
  if ($LASTEXITCODE -ne 0) {
    throw "FetchCV sidecar build failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}

$Executable = Join-Path $ProjectRoot "backend\dist\fetchcv-api\fetchcv-api.exe"
if (-not (Test-Path -LiteralPath $Executable)) {
  throw "Sidecar build did not produce $Executable"
}
Write-Output $Executable
