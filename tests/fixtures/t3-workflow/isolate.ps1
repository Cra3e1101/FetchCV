param([string]$Name='backend-final')
$t3Root = Join-Path (Get-Location) ('artifacts/t3-independent/' + $Name)
New-Item -ItemType Directory -Force -Path $t3Root | Out-Null
foreach ($t3Key in @(Get-ChildItem Env: | Where-Object Name -Match '^(FETCHCV_|OPENAI_|ANTHROPIC_|DEEPSEEK_|FIRECRAWL_|NODE_OPTIONS$)')) { Remove-Item -LiteralPath ('Env:' + $t3Key.Name) }
$env:FETCHCV_T3_TEST_ROOT=$t3Root
$env:APPDATA=Join-Path $t3Root 'roaming'
$env:LOCALAPPDATA=Join-Path $t3Root 'local'
$env:TEMP=Join-Path $t3Root 'temp'
$env:TMP=$env:TEMP
$env:FETCHCV_DATABASE_URL='sqlite:///'+(Join-Path $t3Root 'test.db').Replace('\','/')
$env:FETCHCV_SETTINGS_FILE=Join-Path $t3Root 'settings.json'
$env:FETCHCV_ARTIFACT_ROOT=Join-Path $t3Root 'artifacts'
$env:FETCHCV_WORKSPACE_ROOT=Join-Path $t3Root 'workspace'
$env:FETCHCV_AGENT_RUNTIME='mock'
$env:FETCHCV_ALLOW_MOCK_RUNTIME='1'
$env:FETCHCV_PROVIDER_MODEL='T3_OFFLINE_MOCK'
$env:FETCHCV_DESKTOP_STARTUP_GATE='0'
$env:PYTHONIOENCODING='utf-8'
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
New-Item -ItemType Directory -Force -Path $env:APPDATA,$env:LOCALAPPDATA,$env:TEMP | Out-Null
