$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot "backend\.venv\Scripts\python.exe"
$Dist = Join-Path $ProjectRoot "backend\dist"
$Work = Join-Path $ProjectRoot "backend\build\pyinstaller"
$Spec = Join-Path $ProjectRoot "backend\build"
$Entry = Join-Path $ProjectRoot "backend\sidecar_entry.py"

if (-not (Test-Path -LiteralPath $Python)) {
  throw "Backend virtual environment not found: $Python"
}

& $Python -m PyInstaller `
  --noconfirm `
  --onedir `
  --name fetchcv-api `
  --paths (Join-Path $ProjectRoot "backend") `
  --collect-all claude_agent_sdk `
  --collect-all reportlab `
  --collect-submodules uvicorn `
  --distpath $Dist `
  --workpath $Work `
  --specpath $Spec `
  $Entry

$Executable = Join-Path $Dist "fetchcv-api\fetchcv-api.exe"
if (-not (Test-Path -LiteralPath $Executable)) {
  throw "Sidecar build did not produce $Executable"
}
Write-Output $Executable
