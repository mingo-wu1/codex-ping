param([string]$Server = "")

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:USERPROFILE ".codex-market-board"
$skillDir = Join-Path $env:USERPROFILE ".agents\skills\marketboard"
$binDir = Join-Path $env:USERPROFILE ".local\bin"

New-Item -ItemType Directory -Force $installDir, $skillDir, $binDir | Out-Null
Copy-Item -LiteralPath (Join-Path $repo "marketboard.py") -Destination (Join-Path $installDir "marketboard.py") -Force
Copy-Item -LiteralPath (Join-Path $repo ".agents\skills\marketboard\SKILL.md") -Destination (Join-Path $skillDir "SKILL.md") -Force

$launcher = @"
@echo off
chcp 65001 >nul
set PYTHONUTF8=1
python "%USERPROFILE%\.codex-market-board\marketboard.py" %*
"@
Set-Content -LiteralPath (Join-Path $binDir "marketboard.cmd") -Value $launcher -Encoding ascii

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $binDir) {
  [Environment]::SetEnvironmentVariable("Path", (($userPath.TrimEnd(";"), $binDir) -join ";"), "User")
}

if ($Server) {
  & python (Join-Path $installDir "marketboard.py") server $Server
}

Write-Host "Installed. Restart Codex, then invoke the marketboard skill to search for a product."
