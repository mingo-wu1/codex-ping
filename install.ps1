param(
    [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex-bazaar'),
    [string]$SkillRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.agents\skills\codexbazaar'),
    [string]$PingState = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex-ping'),
    [string]$RelayServer = 'https://codex-ping.mingowu1.workers.dev',
    [string]$BoardServer = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RelayServer = $RelayServer.TrimEnd('/')
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw 'Python 3 is required. Install it from https://www.python.org/downloads/'
}

New-Item -ItemType Directory -Force -Path $InstallRoot, $SkillRoot, (Join-Path $SkillRoot 'agents'), (Join-Path $InstallRoot 'market') | Out-Null
Copy-Item -Force -LiteralPath (Join-Path $repoRoot 'codexping.py') -Destination (Join-Path $InstallRoot 'codexping.py')
$marketRoot = Join-Path $InstallRoot 'market'
foreach ($file in @('marketboard.py', 'marketadmin.py', 'package.json', 'package-lock.json', 'wrangler.toml', 'README.md')) {
    Copy-Item -Force -LiteralPath (Join-Path $repoRoot "market\$file") -Destination $marketRoot
}
foreach ($directory in @('src', 'scripts', 'test-assets')) {
    $destination = Join-Path $marketRoot $directory
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Copy-Item -Recurse -Force -Path (Join-Path $repoRoot "market\$directory\*") -Destination $destination
}
Copy-Item -Force -LiteralPath (Join-Path $repoRoot '.agents\skills\codexbazaar\SKILL.md') -Destination $SkillRoot
Copy-Item -Force -LiteralPath (Join-Path $repoRoot '.agents\skills\codexbazaar\agents\openai.yaml') -Destination (Join-Path $SkillRoot 'agents')

# Keep legacy state so existing Codex Ping identities survive the upgrade.
New-Item -ItemType Directory -Force -Path $PingState | Out-Null
$configPath = Join-Path $PingState 'config.json'
$config = @{}
if (Test-Path -LiteralPath $configPath) {
    $existing = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
    if ($existing.me) { $config.me = $existing.me }
}
$config.server = $RelayServer
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))

if ($BoardServer) {
    & python (Join-Path $InstallRoot 'market\marketboard.py') server $BoardServer
}

try {
    $health = Invoke-RestMethod -Uri "$RelayServer/health" -TimeoutSec 10
    if (-not $health.ok) { throw 'Unexpected health response' }
    Write-Host 'Ping relay: online'
} catch {
    Write-Warning 'Installed, but the Ping relay could not be reached.'
}

Write-Host "Codex Bazaar: $InstallRoot"
Write-Host "Skill:         $SkillRoot"
Write-Host 'Done. Restart Codex and invoke: $codexbazaar'
