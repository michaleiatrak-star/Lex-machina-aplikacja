param([Parameter(Mandatory=$true)][string]$BaseUrl)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'bootstrap-progress.ps1')
$originalProgress = (Get-Command Set-BootstrapProgress).ScriptBlock
$script:progressEvents = [Collections.Generic.List[object]]::new()
function Set-BootstrapProgress([string]$Text, [long]$Received = 0, [long]$Total = 0, [bool]$Done = $false) {
  $script:progressEvents.Add(@{text=$Text; received=$Received; total=$Total})
  & $originalProgress $Text $Received $Total $Done
}
$source = Get-Content -Raw (Join-Path $PSScriptRoot 'windows-online-bootstrap.ps1')
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$null, [ref]$null)
$download = $ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-VerifiedDownload'}, $true)
. ([scriptblock]::Create($download.Extent.Text))
# Retry delays are irrelevant to the deterministic transport fixture.
function Start-Sleep { param($Seconds) }
function Assert($condition, $message) { if (-not $condition) { throw "ASSERT: $message" } }
$root = Join-Path ([IO.Path]::GetTempPath()) ('lex-bootstrap-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $root | Out-Null
try {
  $env:LEX_BOOTSTRAP_PROGRESS_PATH = Join-Path $root 'progress.json'
  Set-BootstrapProgress 'Test' 10 20
  $state = Get-Content -Raw $env:LEX_BOOTSTRAP_PROGRESS_PATH | ConvertFrom-Json
  Assert ($state.received -eq 10 -and $state.total -eq 20 -and -not $state.done) 'progress counts'
  $expected = [Text.Encoding]::UTF8.GetBytes(('fixture-content-' * 10000))
  $hash = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($expected)) -replace '-', '').ToLowerInvariant()
  $target = Join-Path $root 'archive.zip'
  Get-VerifiedDownload "$BaseUrl/file" $hash $target 'node-runtime'
  Assert ((Get-FileHash $target).Hash.ToLowerInvariant() -eq $hash) 'verified download'
  Assert (@($script:progressEvents | Where-Object { $_.received -gt 20 -and $_.total -eq $expected.Length }).Count -gt 0) 'real streamed byte progress'
  # An unreachable URL proves verified cache reuse without any request.
  Get-VerifiedDownload 'http://127.0.0.1:1/unreachable' $hash $target 'node-runtime'
  foreach ($route in @('range', 'ignore-range', 'bad-range', 'disconnect', 'range-416')) {
    Remove-Item $target
    [IO.File]::WriteAllBytes("$target.part", $expected[0..1233])
    Get-VerifiedDownload "$BaseUrl/$route" $hash $target 'node-runtime'
    Assert ((Get-FileHash $target).Hash.ToLowerInvariant() -eq $hash) "safe retry/resume: $route"
  }
  Remove-Item $target
  $failed = $false
  try { Get-VerifiedDownload "$BaseUrl/corrupt" $hash $target 'node-runtime' } catch { $failed = $true }
  Assert ($failed -and -not (Test-Path $target) -and -not (Test-Path "$target.part")) 'reject corrupt download'
  $model = Join-Path $root 'model'
  New-Item -ItemType Directory $model | Out-Null
  Assert (-not (Test-CompletePaddleModel $model)) 'empty model rejected'
  Set-Content (Join-Path $model 'inference.yml') 'model'
  [IO.File]::WriteAllBytes((Join-Path $model 'inference.pdiparams'), [byte[]]@())
  Assert (-not (Test-CompletePaddleModel $model)) 'zero-byte model rejected'
  Set-Content (Join-Path $model 'inference.pdiparams') 'weights'
  Assert (Test-CompletePaddleModel $model) 'complete model retained'
  # Execute the actual readiness decision, without invoking model libraries.
  $runtime = Join-Path $root 'runtime'
  foreach ($kind in @('tokenize', 'ner', 'pretrain')) {
    $dir = Join-Path $runtime "models/stanza/pl/$kind"
    New-Item -ItemType Directory -Force $dir | Out-Null
    Set-Content (Join-Path $dir 'model.pt') 'weights'
  }
  Set-Content (Join-Path $runtime 'models/stanza/resources.json') '{}'
  $begin = $source.IndexOf('$modelRoot = Join-Path $runtime "models"')
  $end = $source.IndexOf('if (-not $modelsReady)', $begin)
  $decision = [scriptblock]::Create($source.Substring($begin, $end - $begin))
  . $decision
  foreach ($name in $requiredPaddle) {
    $dir = Join-Path $paddleOfficial $name
    New-Item -ItemType Directory -Force $dir | Out-Null
    Copy-Item (Join-Path $model '*') $dir
  }
  . $decision
  Assert $modelsReady 'missing optional model must not trigger downloads'
  Remove-Item (Join-Path $paddleOfficial 'UVDoc/inference.pdiparams')
  . $decision
  Assert (-not $modelsReady) 'missing required model triggers repair'
  # Execute the fallback cleanup directly from the production script.
  $begin = $source.IndexOf('      foreach ($name in $requiredPaddle)', $source.IndexOf('Model prefetch source failed'))
  $end = $source.IndexOf('      Start-Sleep', $begin)
  . ([scriptblock]::Create($source.Substring($begin, $end - $begin)))
  Assert (-not (Test-Path (Join-Path $paddleOfficial 'UVDoc'))) 'partial model removed'
  Assert (Test-CompletePaddleModel (Join-Path $paddleOfficial 'PP-OCRv6_medium_rec')) 'complete model survives source fallback'
  Set-BootstrapProgress 'Done' 0 0 $true
  Assert ((Get-Content -Raw $env:LEX_BOOTSTRAP_PROGRESS_PATH | ConvertFrom-Json).done) 'terminal status'
  Write-Host 'WINDOWS_BOOTSTRAP_PROGRESS_PASS: 17 scenarios'
} finally {
  Remove-Item Env:LEX_BOOTSTRAP_PROGRESS_PATH -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $root
}
