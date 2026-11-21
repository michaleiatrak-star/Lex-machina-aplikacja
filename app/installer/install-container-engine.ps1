param(
  [ValidateSet("Check", "Install", "Decline")]
  [string]$Mode = "Check"
)
# Docker Desktop for the local web search (SearXNG) and the browser for reading pages (Chromium,
# chromedp/headless-shell), installed with the application (user 2026-11-21). The application sets
# both up at its first start once a container engine answers (searxng-local.ts firstRunLocalSearch).
# Exit codes, read by windows/hooks.nsh:
#   10  a container engine (Docker or Podman) is already here
#   11  the user declined earlier (no question again on an update)
#   12  absent: ask the user
#    0  installed (a restart may be needed for WSL 2)
#    1  installation failed (the application works without it)
$ErrorActionPreference = "Stop"
$stateDir = Join-Path $env:LOCALAPPDATA "LexMachina"
$declined = Join-Path $stateDir "container-engine-declined"
$log = Join-Path $stateDir "container-engine-install.log"

function Test-ContainerEngine {
  foreach ($name in @("docker", "podman")) {
    if (Get-Command $name -ErrorAction SilentlyContinue) { return $true }
  }
  $programFiles = if ($env:ProgramFiles) { $env:ProgramFiles } else { "C:\Program Files" }
  return (Test-Path -LiteralPath (Join-Path $programFiles "Docker\Docker\resources\bin\docker.exe") -PathType Leaf)
}

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

if ($Mode -eq "Check") {
  if (Test-ContainerEngine) { exit 10 }
  if (Test-Path -LiteralPath $declined -PathType Leaf) { exit 11 }
  exit 12
}

if ($Mode -eq "Decline") {
  Set-Content -LiteralPath $declined -Value (Get-Date -Format "o") -Encoding UTF8
  exit 11
}

if (Test-ContainerEngine) { exit 10 }
$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) winget missing: install Docker Desktop from https://www.docker.com/products/docker-desktop/"
  exit 1
}
# winget verifies the installer's hash from its manifest and asks for the administrator (UAC).
$arguments = @("install", "--exact", "--id", "Docker.DockerDesktop", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity")
# PowerShell 5.1 turns a native program's stderr into errors under "Stop": "Continue" around the call.
$ErrorActionPreference = "Continue"
$output = & $winget.Source @arguments 2>&1 | Out-String
$code = $LASTEXITCODE
$ErrorActionPreference = "Stop"
Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) winget exit=$code`r`n$output"
# 0 installed; 0x8A15002B (-1978335189) no applicable upgrade (already installed).
if ($code -eq 0 -or $code -eq -1978335189 -or (Test-ContainerEngine)) { exit 0 }
exit 1
