param(
  [Parameter(Mandatory=$true)][string]$Script,
  [Parameter(Mandatory=$true)][string]$RuntimeRoot,
  [string]$BundlePath
)

# Keep full diagnostics in a log; NSIS receives a short, readable result.
$ErrorActionPreference = "Continue"
# Outside the runtime folder: step 6 hashes every runtime file and must not meet the log
# this wrapper is still writing.
$installRoot = Split-Path -Parent ([IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\'))
$log = Join-Path $installRoot "bootstrap-install.log"
$psArgs = @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $Script, "-RuntimeRoot", $RuntimeRoot)
if ($BundlePath) { $psArgs += @("-BundlePath", $BundlePath) }
$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

. (Join-Path $PSScriptRoot "bootstrap-progress.ps1")
$env:LEX_BOOTSTRAP_PROGRESS_PATH = Join-Path $installRoot ("bootstrap-progress-" + $PID + ".json")
Set-BootstrapProgress "Sprawdzanie potrzebnych narzędzi…"
$window = $null
if ($env:LEX_BOOTSTRAP_NO_UI -ne "1" -and [Environment]::UserInteractive) {
  try {
    $windowScript = Join-Path $PSScriptRoot "bootstrap-progress-window.ps1"
    $window = Start-Process -FilePath $powershell -WindowStyle Hidden -PassThru -ArgumentList @(
      "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", ('"' + $windowScript + '"'),
      "-StatusPath", ('"' + $env:LEX_BOOTSTRAP_PROGRESS_PATH + '"'), "-OwnerPid", $PID
    )
  } catch { Write-Verbose "Progress window unavailable: $_" }
}
$LASTEXITCODE = 1
& $powershell @psArgs 2>&1 | ForEach-Object { "$_" } | Out-File -LiteralPath $log -Encoding utf8
$code = $LASTEXITCODE
Set-BootstrapProgress "Kończenie przygotowania…" 0 0 $true
if ($window) { if (-not $window.WaitForExit(3000)) { Stop-Process -Id $window.Id -ErrorAction SilentlyContinue } }
Remove-Item -LiteralPath @($env:LEX_BOOTSTRAP_PROGRESS_PATH, ($env:LEX_BOOTSTRAP_PROGRESS_PATH + ".next")) -Force -ErrorAction SilentlyContinue
if ($code -eq 0) {
  Write-Output "OK (log: $log)"
  exit 0
}

Write-Output "Nie udało się przygotować wszystkich narzędzi. Sprawdź połączenie z internetem oraz wolne miejsce na dysku i uruchom instalator ponownie."
Write-Output "Gotowe, sprawdzone pliki zostaną wykorzystane ponownie."
# NSIS keeps only the first NSIS_MAX_STRLEN characters: the cause, briefly, before the log path.
$cause = @(Get-Content -LiteralPath $log -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)(BOOTSTRAP_|_FAILED|_MISSING|VC_APPLOCAL|Exception|\bError\b)' } | Select-Object -Last 3)
if ($cause.Count) {
  Write-Output "Przyczyna:"
  $cause | ForEach-Object { $line = "$_".Trim(); if ($line.Length -gt 160) { $line = $line.Substring(0, 160) + "…" }; Write-Output $line }
}
Write-Output "Szczegóły dla pomocy technicznej: $log (kod $code)"
exit $code
