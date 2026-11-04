# The backup of the installed application before an update and its removal, on paths longer
# than 260 characters, in Windows PowerShell 5.1 (the update runner's host). 0.1.62 -> 0.1.63
# aborted here: Copy-Item could not reach a file deep in node_modules once the backup folder
# was added to the path.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "app-update-verification.ps1")

function Long([string]$Path) { return "\\?\" + $Path }

$root = Join-Path ([IO.Path]::GetTempPath()) ("lex-long-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
$source = Join-Path $root "install"
$deep = $source + "\runtime\app\node_modules\@ai-sdk\google\node_modules\@ai-sdk\provider\src\embedding-model-middleware\v3"
$deep = $deep + ("\" + ("x" * 40)) * 3
$file = Join-Path $deep "embedding-model-v3-middleware.ts"
[IO.Directory]::CreateDirectory((Long $deep)) | Out-Null
[IO.File]::WriteAllText((Long $file), "export {};")
[IO.File]::WriteAllText((Long (Join-Path $source "app.exe")), "MZ")

$backup = Join-Path $root ("update-backups\20261104121420-abcdef\install")
$copied = $file.Replace($source, $backup)
if ($copied.Length -le 300) { throw "LONG_PATH_SELFTEST_NOT_LONG:$($copied.Length)" }

try {
  Copy-TreeLong $source $backup
  if (-not [IO.File]::Exists((Long $copied))) { throw "LONG_PATH_SELFTEST_NOT_COPIED:$copied" }
  if ([IO.File]::ReadAllText((Long $copied)) -ne "export {};") { throw "LONG_PATH_SELFTEST_CONTENT" }
  if (-not [IO.File]::Exists((Long (Join-Path $backup "app.exe")))) { throw "LONG_PATH_SELFTEST_TOP_FILE" }

  Remove-TreeLong (Join-Path $root "update-backups")
  if ([IO.Directory]::Exists((Long (Join-Path $root "update-backups")))) { throw "LONG_PATH_SELFTEST_NOT_REMOVED" }

  $failed = $false
  try { Copy-TreeLong (Join-Path $root "missing") (Join-Path $root "target") } catch { $failed = $_.Exception.Message -like "UPDATE_COPY_FAILED:*" }
  if (-not $failed) { throw "LONG_PATH_SELFTEST_MISSING_SOURCE_NOT_REPORTED" }
} finally {
  Remove-TreeLong $root
}
Write-Host "Application update backup on long paths self-test: PASS ($($copied.Length) characters, PowerShell $($PSVersionTable.PSVersion))"
# robocopy leaves 1 ("files copied") in $LASTEXITCODE, which would become the exit code.
exit 0
