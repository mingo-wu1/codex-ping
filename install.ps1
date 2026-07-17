param(
    [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex-ping'),
    [string]$SkillRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.agents\skills\codexping'),
    [string]$Server = 'https://codex-ping.mingowu1.workers.dev'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Server = $Server.TrimEnd('/')

$serverUri = $null
if (-not [Uri]::TryCreate($Server, [UriKind]::Absolute, [ref]$serverUri) -or $serverUri.Scheme -notin @('http', 'https')) {
    throw 'Server must be a complete http:// or https:// URL.'
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw 'Python 3 is required. Install it from https://www.python.org/downloads/'
}

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $SkillRoot 'agents') | Out-Null

Copy-Item -Force -LiteralPath (Join-Path $repoRoot 'codexping.py') -Destination $InstallRoot
Copy-Item -Force -LiteralPath (Join-Path $repoRoot '.agents\skills\codexping\SKILL.md') -Destination $SkillRoot
Copy-Item -Force -LiteralPath (Join-Path $repoRoot '.agents\skills\codexping\agents\openai.yaml') -Destination (Join-Path $SkillRoot 'agents')

$configPath = Join-Path $InstallRoot 'config.json'
$config = @{}
if (Test-Path -LiteralPath $configPath) {
    $existing = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
    if ($existing.me) { $config.me = $existing.me }
}
$config.server = $Server
$configJson = $config | ConvertTo-Json
[System.IO.File]::WriteAllText($configPath, $configJson, [System.Text.UTF8Encoding]::new($false))

try {
    $health = Invoke-RestMethod -Uri "$Server/health" -TimeoutSec 10
    if (-not $health.ok) { throw 'Unexpected health response' }
    Write-Host 'Relay: online'
} catch {
    Write-Warning 'Codex Ping was installed, but the public relay could not be reached.'
}

Write-Host "Client: $InstallRoot"
Write-Host "Skill:  $SkillRoot"
Write-Host "Server: $Server"
Write-Host 'Done. Start a new Codex task with: $codexping set my identity.'
