param(
  [Parameter(Mandatory=$true)][string]$RuntimeRoot,
  [Parameter(Mandatory=$true)][string]$ManifestPath,
  [Parameter(Mandatory=$true)][string]$ModelId,
  [string]$LocalAiRoot,
  [string]$CacheRoot
)

# The local vision model that reads doubtful OCR lines (models.localVision of the release
# manifest): the model and its projector (mmproj), downloaded and verified the way
# install-local-llm.ps1 installs the text models, into <local-ai>\vision. It runs on the
# llama.cpp engine of the local AI; the AI configuration (config.json) is not changed.

$ErrorActionPreference = "Stop"
$manifestFile = [IO.Path]::GetFullPath($ManifestPath)
$manifest = Get-Content -Raw -LiteralPath $manifestFile | ConvertFrom-Json

$localRoot = if ($LocalAiRoot) {
  [IO.Path]::GetFullPath($LocalAiRoot)
} else {
  Join-Path $env:LOCALAPPDATA "LexMachina\local-ai"
}
$cache = if ($CacheRoot) {
  [IO.Path]::GetFullPath($CacheRoot)
} else {
  Join-Path $env:LOCALAPPDATA "LexMachina\bootstrap-cache\local-llm"
}
$visionDir = Join-Path $localRoot "vision"
New-Item -ItemType Directory -Force -Path $cache | Out-Null
New-Item -ItemType Directory -Force -Path $visionDir | Out-Null
# A failed reinstall must not leave the previous record pointing at replaced files.
Remove-Item -LiteralPath (Join-Path $visionDir "vision.json") -Force -ErrorAction SilentlyContinue

if (-not (Get-Command Get-FileHash -ErrorAction SilentlyContinue)) {
  function Get-FileHash {
    param(
      [string]$Path,
      [string]$LiteralPath,
      [string]$Algorithm = "SHA256"
    )
    if ($Algorithm.ToUpperInvariant() -ne "SHA256") {
      throw "LOCAL_LLM_HASH_ALGORITHM_UNSUPPORTED:$Algorithm"
    }
    $target = if ($LiteralPath) { $LiteralPath } else { $Path }
    if (-not $target) { throw "LOCAL_LLM_HASH_PATH_MISSING" }
    $stream = [IO.File]::OpenRead($target)
    try {
      $sha = [Security.Cryptography.SHA256]::Create()
      try { $bytes = $sha.ComputeHash($stream) }
      finally { $sha.Dispose() }
    } finally { $stream.Dispose() }
    [pscustomobject]@{
      Algorithm = "SHA256"
      Hash = ([BitConverter]::ToString($bytes) -replace '-','')
      Path = [IO.Path]::GetFullPath($target)
    }
  }
}

function Write-LocalAiProgress(
  [string]$Phase,
  [string]$Label,
  [int64]$BytesDownloaded,
  $BytesTotal,
  $Percent
) {
  $payload = [ordered]@{
    phase = $Phase
    label = $Label
    bytesDownloaded = $BytesDownloaded
    bytesTotal = if ($null -eq $BytesTotal) { $null } else { [int64]$BytesTotal }
    percent = if ($null -eq $Percent) { $null } else { [int]$Percent }
  }
  Write-Host ("LEX_LOCAL_AI_PROGRESS:" + ($payload | ConvertTo-Json -Compress))
}

function Get-VerifiedDownload(
  [string]$Url,
  [string]$ExpectedSha256,
  [string]$Destination,
  [string]$Label
) {
  if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') {
    throw "LOCAL_LLM_HASH_INVALID:$Label"
  }

  $expected = $ExpectedSha256.ToLowerInvariant()
  if (Test-Path -LiteralPath $Destination -PathType Leaf) {
    $cached = (Get-FileHash -Algorithm SHA256 -LiteralPath $Destination).Hash.ToLowerInvariant()
    if ($cached -eq $expected) {
      $cachedBytes = (Get-Item -LiteralPath $Destination).Length
      Write-Host "Using verified cache for $Label"
      Write-LocalAiProgress "CACHE_HIT" $Label $cachedBytes $cachedBytes 100
      return
    }
    Remove-Item -LiteralPath $Destination -Force
  }

  $partial = $Destination + ".part"
  Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
  Write-Host "Downloading $Label"

  try {
    Add-Type -AssemblyName System.Net.Http
    $client = [System.Net.Http.HttpClient]::new()
    try {
      $response = $client.GetAsync(
        $Url,
        [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
      ).GetAwaiter().GetResult()

      try {
        $response.EnsureSuccessStatusCode()
        $total = $response.Content.Headers.ContentLength
        $input = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()

        try {
          $output = [IO.File]::Open(
            $partial,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None
          )
          try {
            $buffer = New-Object byte[] (1024 * 1024)
            [int64]$downloaded = 0
            [int]$lastPercent = -1
            [int64]$lastReportedBytes = 0

            Write-LocalAiProgress "DOWNLOAD" $Label 0 $total $(if ($null -ne $total -and $total -gt 0) { 0 } else { $null })

            while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
              $output.Write($buffer, 0, $read)
              $downloaded += $read

              if ($null -ne $total -and $total -gt 0) {
                $percent = [Math]::Min(
                  100,
                  [Math]::Floor(($downloaded * 100.0) / $total)
                )
                if ($percent -gt $lastPercent) {
                  $lastPercent = [int]$percent
                  Write-LocalAiProgress "DOWNLOAD" $Label $downloaded $total $lastPercent
                }
              } elseif (($downloaded - $lastReportedBytes) -ge (64MB)) {
                $lastReportedBytes = $downloaded
                Write-LocalAiProgress "DOWNLOAD" $Label $downloaded $null $null
              }
            }

            $output.Flush()
          } finally {
            $output.Dispose()
          }
        } finally {
          $input.Dispose()
        }
      } finally {
        $response.Dispose()
      }
    } finally {
      $client.Dispose()
    }

    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $partial).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
      throw "LOCAL_LLM_HASH_MISMATCH:$Label expected=$ExpectedSha256 actual=$actual"
    }

    $verifiedBytes = (Get-Item -LiteralPath $partial).Length
    Move-Item -LiteralPath $partial -Destination $Destination -Force
    Write-LocalAiProgress "VERIFIED" $Label $verifiedBytes $verifiedBytes 100
  } catch {
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    throw
  }
}

function Install-VisionFile([object]$File, [string]$Label) {
  if (-not $File.filename -or -not $File.url -or -not $File.sha256) {
    throw "LOCAL_VISION_MANIFEST_FILE_INVALID:$Label"
  }
  if ($File.filename -notmatch '^[A-Za-z0-9._-]+\.gguf$') {
    throw "LOCAL_VISION_FILENAME_INVALID:$Label"
  }
  $expected = ([string]$File.sha256).ToLowerInvariant()
  $cached = Join-Path $cache $File.filename
  $target = Join-Path $visionDir $File.filename
  # An installed copy seeds the verified cache (no second download after a reinstall).
  if (
    -not (Test-Path -LiteralPath $cached -PathType Leaf) -and
    (Test-Path -LiteralPath $target -PathType Leaf)
  ) {
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant() -eq $expected) {
      Copy-Item -LiteralPath $target -Destination $cached -Force
    }
  }
  Get-VerifiedDownload $File.url $File.sha256 $cached $Label | Out-Null
  if (
    (Test-Path -LiteralPath $target -PathType Leaf) -and
    (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant() -eq $expected
  ) {
    return $target
  }
  $temporary = $target + ".tmp"
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $cached -Destination $temporary -Force
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $temporary).Hash.ToLowerInvariant() -ne $expected) {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    throw "LOCAL_VISION_STAGED_HASH_MISMATCH:$Label"
  }
  Move-Item -LiteralPath $temporary -Destination $target -Force
  return $target
}

if ($null -eq $manifest.models.localVision -or @($manifest.models.localVision).Count -lt 1) {
  throw "LOCAL_VISION_MANIFEST_MISSING"
}
$model = @($manifest.models.localVision | Where-Object { $_.id -eq $ModelId }) | Select-Object -First 1
if ($null -eq $model) {
  throw "LOCAL_VISION_MODEL_UNKNOWN:$ModelId"
}
if ($null -eq $model.projector) {
  throw "LOCAL_VISION_PROJECTOR_MISSING:$ModelId"
}

$modelPath = Install-VisionFile $model ("vision:" + $model.id)
$projectorPath = Install-VisionFile $model.projector ("vision-projector:" + $model.id)

# Written last: the runtime takes the vision model as installed only with this file.
$configPath = Join-Path $visionDir "vision.json"
$config = [ordered]@{
  schemaVersion = 1
  installedAt = [DateTimeOffset]::UtcNow.ToString("o")
  model = [ordered]@{
    id = [string]$model.id
    displayName = [string]$model.displayName
    filename = [string]$model.filename
    path = $modelPath
    sha256 = ([string]$model.sha256).ToLowerInvariant()
  }
  projector = [ordered]@{
    filename = [string]$model.projector.filename
    path = $projectorPath
    sha256 = ([string]$model.projector.sha256).ToLowerInvariant()
  }
}
$temporaryConfig = $configPath + ".tmp"
[IO.File]::WriteAllText(
  $temporaryConfig,
  ($config | ConvertTo-Json -Depth 5) + [Environment]::NewLine,
  [Text.UTF8Encoding]::new($false)
)
Move-Item -LiteralPath $temporaryConfig -Destination $configPath -Force

Write-Output ([ordered]@{ status = "READY"; modelId = [string]$model.id; configPath = $configPath } | ConvertTo-Json -Compress)
Write-Host "LEX_LOCAL_VISION_INSTALL_PASS:$visionDir"
