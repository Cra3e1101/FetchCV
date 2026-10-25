$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $project '.m1-work\desktop-dev-local.json'
try {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    foreach ($required in @($config.node, $config.workRoot)) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Missing development path: $required" }
    }
    # The Node launcher owns Electron selection, including environment overrides
    # and version checks. This shortcut keeps only the user's explicit profile setup.
    $arguments = '"{0}" --work-root "{1}"' -f (Join-Path $PSScriptRoot 'dev-desktop.mjs'), $config.workRoot
    if ($config.userData) {
        if (-not [System.IO.Path]::IsPathRooted($config.userData) -or -not (Test-Path -LiteralPath (Join-Path $config.userData 'data\fetchcv.db'))) {
            throw "Installed FetchCV profile not found: $($config.userData)"
        }
        $arguments += ' --user-data "{0}"' -f $config.userData
    }
    Start-Process -FilePath $config.node -ArgumentList $arguments -WorkingDirectory $project -WindowStyle Hidden
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'FetchCV development startup failed') | Out-Null
    exit 1
}
