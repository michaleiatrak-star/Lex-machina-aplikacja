# The offline runtime bundle with a file deeper than 260 characters (0.1.71: modelscope ...
# __pycache__\...cpython-313.pyc under %TEMP%\LexMachinaOfflineRuntime-<guid> failed with
# DirectoryNotFoundException). Windows PowerShell 5.1, as the installer runs it.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression

$root = Join-Path ([IO.Path]::GetTempPath()) ("lex-zip-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
[IO.Directory]::CreateDirectory($root) | Out-Null
$archive = Join-Path $root "bundle.zip"
$deep = "python/Lib/site-packages/modelscope/msdatasets/dataset_cls/custom_datasets/image_quality_assessment_degradation/" + (("x" * 40) + "/") * 3 + "image_quality_assessment_degradation_dataset.py"
$destination = Join-Path $root ("LexMachinaOfflineRuntime-" + [Guid]::NewGuid().ToString("N"))
if (($destination.Length + $deep.Length) -le 300) { throw "ZIP_LONG_PATH_SELFTEST_NOT_LONG" }

$stream = [IO.File]::Open($archive, [IO.FileMode]::CreateNew)
try {
  $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    foreach ($name in @("component-lock.json", $deep)) {
      $writer = [IO.StreamWriter]::new($zip.CreateEntry($name).Open())
      try { $writer.Write("content of $name") } finally { $writer.Dispose() }
    }
  } finally { $zip.Dispose() }
} finally { $stream.Dispose() }

try {
  & (Join-Path $PSScriptRoot "extract-offline-zip.ps1") -ArchivePath $archive -DestinationPath $destination
  $target = "\\?\" + (Join-Path $destination ($deep -replace '/', '\'))
  if (-not [IO.File]::Exists($target)) { throw "ZIP_LONG_PATH_SELFTEST_NOT_EXTRACTED" }
  if ([IO.File]::ReadAllText($target) -ne "content of $deep") { throw "ZIP_LONG_PATH_SELFTEST_CONTENT" }
} finally {
  cmd.exe /d /c "rd /s /q `"\\?\$root`"" | Out-Null
}
Write-Host "Offline bundle extraction on long paths self-test: PASS ($(($destination.Length + $deep.Length)) characters, PowerShell $($PSVersionTable.PSVersion))"
