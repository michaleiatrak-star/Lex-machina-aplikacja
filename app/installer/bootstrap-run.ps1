param(
  [Parameter(Mandatory=$true)][string]$Script,
  [Parameter(Mandatory=$true)][string]$RuntimeRoot,
  [string]$BundlePath
)

# NSIS nsExec::ExecToStack keeps only the first NSIS_MAX_STRLEN characters of the output:
# a bootstrap that failed after its long progress lines showed the progress and lost the
# cause. The script runs here with its whole output in a log file; on failure the cause
# comes first, then the last lines and the log path, so the installer dialog shows them.
$ErrorActionPreference = "Continue"
# Outside the runtime folder: step 6 hashes every runtime file and must not meet the log
# this wrapper is still writing.
$installRoot = Split-Path -Parent ([IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\'))
$log = Join-Path $installRoot "bootstrap-install.log"
$psArgs = @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $Script, "-RuntimeRoot", $RuntimeRoot)
if ($BundlePath) { $psArgs += @("-BundlePath", $BundlePath) }
$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

& $powershell @psArgs 2>&1 | ForEach-Object { "$_" } | Out-File -LiteralPath $log -Encoding utf8
$code = $LASTEXITCODE
if ($code -eq 0) {
  Write-Output "OK (log: $log)"
  exit 0
}

$lines = @(Get-Content -LiteralPath $log -ErrorAction SilentlyContinue)
$cause = @($lines | Where-Object { $_ -match '(?i)(BOOTSTRAP_|_FAILED|_MISSING|VC_APPLOCAL|Exception|\bError\b|At .+:\d+ char:)' } | Select-Object -Last 4)
if ($cause.Count) {
  Write-Output "Przyczyna:"
  $cause | ForEach-Object { Write-Output $_ }
  Write-Output ""
}
Write-Output "Ostatnie wiersze (kod $code):"
$lines | Select-Object -Last 10 | ForEach-Object { Write-Output $_ }
Write-Output ""
Write-Output "Pelny log: $log"
exit $code
