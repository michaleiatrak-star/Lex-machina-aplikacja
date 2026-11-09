# Native Windows lifecycle check. Only temporary fixture folders are modified.
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ('Lex bootstrap fixture ' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $root 'runtime') -Force | Out-Null
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$process = $null
try {
  $status = Join-Path $root 'window.json'
  $env:LEX_BOOTSTRAP_PROGRESS_PATH = $status
  . (Join-Path $PSScriptRoot 'bootstrap-progress.ps1')
  Set-BootstrapProgress 'Test' 1 2
  $window = Join-Path $PSScriptRoot 'bootstrap-progress-window.ps1'
  $process = Start-Process $powershell -PassThru -ArgumentList @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ('"'+$window+'"'), '-StatusPath', ('"'+$status+'"'), '-OwnerPid', $PID)
  $null = $process.Handle
  Start-Sleep -Seconds 2
  if ($process.HasExited) { throw 'Progress window exited before completion' }
  Set-BootstrapProgress 'Done' 0 0 $true
  if (-not $process.WaitForExit(10000) -or $process.ExitCode -ne 0) { throw 'Progress window did not close cleanly' }
  $process = $null
  $env:LEX_BOOTSTRAP_NO_UI = '1'
  foreach ($exitCode in @(0, 23)) {
    $fixture = Join-Path $root 'worker.ps1'
    [IO.File]::WriteAllText($fixture, ('param([string]$RuntimeRoot)' + "`r`nWrite-Output 'fixture diagnostic'`r`nexit " + $exitCode))
    $wrapper = Join-Path $PSScriptRoot 'bootstrap-run.ps1'
    & $powershell -NoProfile -ExecutionPolicy Bypass -File $wrapper -Script $fixture -RuntimeRoot (Join-Path $root 'runtime')
    if ($LASTEXITCODE -ne $exitCode) { throw "Worker exit code lost: $exitCode" }
    if ((Get-Content -Raw (Join-Path $root 'bootstrap-install.log')) -notmatch 'fixture diagnostic') { throw 'Diagnostic log missing' }
    if (@(Get-ChildItem $root -Filter 'bootstrap-progress-*.json').Count) { throw 'Progress status left behind' }
  }
  Write-Host 'WINDOWS_BOOTSTRAP_WRAPPER_PASS'
  # The last scenario ends the worker with 23 on purpose: that code must not become the step's result.
  $global:LASTEXITCODE = 0
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  Remove-Item Env:LEX_BOOTSTRAP_PROGRESS_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:LEX_BOOTSTRAP_NO_UI -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $root
}
