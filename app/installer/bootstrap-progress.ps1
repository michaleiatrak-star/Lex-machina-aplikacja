# Shared by the installer worker and its independent progress window (PowerShell 5.1).
# Percent (0-100) fills the window's bar for a step whose share of the stage is known; -1 keeps the
# byte count (received/total) or the moving bar. Stage names the installer stage ("Etap 3 z 3: ...").
function Set-BootstrapProgress([string]$Text, [long]$Received = 0, [long]$Total = 0, [bool]$Done = $false, [double]$Percent = -1, [string]$Stage = "") {
  if (-not $env:LEX_BOOTSTRAP_PROGRESS_PATH) { return }
  if (-not $Stage -and $env:LEX_BOOTSTRAP_STAGE) { $Stage = $env:LEX_BOOTSTRAP_STAGE }
  try {
    $json = @{ text=$Text; received=$Received; total=$Total; done=$Done; percent=[Math]::Round($Percent, 1); stage=$Stage } | ConvertTo-Json -Compress
    $temp = $env:LEX_BOOTSTRAP_PROGRESS_PATH + ".next"
    [IO.File]::WriteAllText($temp, $json, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination $env:LEX_BOOTSTRAP_PROGRESS_PATH -Force
  } catch { Write-Verbose "Progress display unavailable: $_" }
}
# A step that covers From..To percent of the stage, Fraction of it done (written at most every whole percent).
function Set-StageProgress([string]$Text, [double]$From, [double]$To, [double]$Fraction) {
  $value = $From + ($To - $From) * [Math]::Max(0, [Math]::Min(1, $Fraction))
  $whole = [Math]::Floor($value)
  if ($script:LastStagePercent -eq $whole -and $script:LastStageText -eq $Text) { return }
  $script:LastStagePercent = $whole
  $script:LastStageText = $Text
  Set-BootstrapProgress $Text 0 0 $false $value
}
function Test-CompletePaddleModel([string]$Directory) {
  foreach ($name in @("inference.pdiparams", "inference.yml")) {
    $file = Join-Path $Directory $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
    if ((Get-Item -LiteralPath $file).Length -eq 0) { return $false }
  }
  return $true
}
