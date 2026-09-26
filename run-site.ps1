$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeCommand = (Get-Command node -ErrorAction SilentlyContinue).Source
if (Test-Path -LiteralPath $bundledNode) { $nodeCommand = $bundledNode }
if (-not $nodeCommand) { throw '请安装 Node.js 22.13 或更新版本。' }
$nodeVersion = (& $nodeCommand --version).TrimStart('v')
if ([version]$nodeVersion -lt [version]'22.13.0') { throw '需要 Node.js 22.13 或更新版本。' }
$env:PATH = (Split-Path -Parent $nodeCommand) + ';' + $env:PATH
$env:NODE_USE_SYSTEM_CA = '1'
$env:NODE_USE_ENV_PROXY = '1'
$env:NO_PROXY = 'localhost,127.0.0.1'
if (-not $env:HTTPS_PROXY) {
  $internetSettings = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
  if ($internetSettings.ProxyEnable -eq 1 -and $internetSettings.ProxyServer -match '^[\w.-]+:\d+$') {
    $env:HTTPS_PROXY = 'http://' + $internetSettings.ProxyServer
    $env:HTTP_PROXY = $env:HTTPS_PROXY
  }
}
if (-not (Test-Path 'node_modules')) { throw '请先按 README.md 安装网站依赖。' }
if (-not (Test-Path 'dist/server/wrangler.json')) {
  & $nodeCommand 'scripts/run-framework.mjs' build
  if ($LASTEXITCODE -ne 0) { throw '构建失败。' }
}
New-Item -ItemType Directory -Force -Path '.sites-runtime' | Out-Null
$appliedPath = Join-Path $PSScriptRoot '.sites-runtime\local-migrations.json'
$applied = @()
if (Test-Path -LiteralPath $appliedPath) { $applied = @(Get-Content -LiteralPath $appliedPath -Raw | ConvertFrom-Json) }
foreach ($migration in (Get-ChildItem -LiteralPath 'drizzle' -Filter '*.sql' | Sort-Object Name)) {
  if ($migration.Name -notin $applied) {
    # Existing task previews may already have applied a migration. Probe the
    # schema table before first use instead of replaying that known initial set.
    if ($migration.Name -in @('0000_yellow_bulldozer.sql','0001_safe_goliath.sql')) {
      $tableName = if ($migration.Name -like '0000*') { 'source_snapshots' } else { 'api_budgets' }
      $probe = & $nodeCommand '--import' './scripts/sites-env.mjs' './node_modules/wrangler/bin/wrangler.js' 'd1' 'execute' 'DB' '--local' '--config' 'dist/server/wrangler.json' '--persist-to' '.wrangler/state' '--command' "SELECT name FROM sqlite_master WHERE name='$tableName'" '--json' 2>$null
      if (($probe -join '') -match ('"name"\s*:\s*"' + $tableName + '"')) {
        $applied += $migration.Name
        ConvertTo-Json -InputObject $applied | Set-Content -LiteralPath $appliedPath
        continue
      }
    }
    & $nodeCommand '--import' './scripts/sites-env.mjs' './node_modules/wrangler/bin/wrangler.js' 'd1' 'execute' 'DB' '--local' '--config' 'dist/server/wrangler.json' '--persist-to' '.wrangler/state' '--file' $migration.FullName
    if ($LASTEXITCODE -ne 0) { throw ('本地迁移失败：' + $migration.Name) }
    $applied += $migration.Name
    ConvertTo-Json -InputObject $applied | Set-Content -LiteralPath $appliedPath
  }
}
Write-Host 'Trend Atlas 正在启动。访问 http://127.0.0.1:4188/ ，Ctrl+C 停止。'
& $nodeCommand '--import' './scripts/sites-env.mjs' './node_modules/wrangler/bin/wrangler.js' 'dev' '--config' 'dist/server/wrangler.json' '--local' '--persist-to' '.wrangler/state' '--ip' '127.0.0.1' '--port' '4188' '--inspector-port' '0'
