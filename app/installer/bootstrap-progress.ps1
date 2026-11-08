# Shared by the installer worker and its independent progress window (PowerShell 5.1).
function Set-BootstrapProgress([string]$Text, [long]$Received = 0, [long]$Total = 0, [bool]$Done = $false) {
  if (-not $env:LEX_BOOTSTRAP_PROGRESS_PATH) { return }
  try {
    $json = @{ text=$Text; received=$Received; total=$Total; done=$Done } | ConvertTo-Json -Compress
    $temp = $env:LEX_BOOTSTRAP_PROGRESS_PATH + ".next"
    [IO.File]::WriteAllText($temp, $json, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination $env:LEX_BOOTSTRAP_PROGRESS_PATH -Force
  } catch { Write-Verbose "Progress display unavailable: $_" }
}
function Test-CompletePaddleModel([string]$Directory) {
  foreach ($name in @("inference.pdiparams", "inference.yml")) {
    $file = Join-Path $Directory $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
    if ((Get-Item -LiteralPath $file).Length -eq 0) { return $false }
  }
  return $true
}
