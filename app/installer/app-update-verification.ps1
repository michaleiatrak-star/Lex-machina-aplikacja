Set-StrictMode -Version Latest

function Normalize-Thumbprint([string]$Value) {
  return ($Value -replace '\s+', '').ToUpperInvariant()
}

function Get-UpdateVerificationMode([object]$Manifest) {
  if ($null -eq $Manifest.applicationUpdate) {
    throw "UPDATE_TRUST_POLICY_INVALID"
  }

  if (
    $Manifest.applicationUpdate.verification -eq
      "SHA256_AND_AUTHENTICODE_PINNED_PUBLISHER"
  ) {
    return "SIGNED_REQUIRED"
  }

  if (
    $Manifest.applicationUpdate.verification -eq
      "SHA256_REQUIRED_SIGNATURE_OPTIONAL" -and
    $Manifest.applicationUpdate.temporaryUnsignedAllowed -eq $true
  ) {
    return "UNSIGNED_ALLOWED"
  }

  throw "UPDATE_TRUST_POLICY_INVALID"
}

function Get-TrustedSignerThumbprints([object]$Manifest) {
  $mode = Get-UpdateVerificationMode $Manifest
  $raw = @(
    $Manifest.applicationUpdate.trustedSignerThumbprints
  )
  $trusted = @(
    $raw |
      ForEach-Object {
        Normalize-Thumbprint ([string]$_)
      } |
      Where-Object {
        $_ -match '^[A-F0-9]{40}$'
      } |
      Select-Object -Unique
  )

  if (
    $mode -eq "SIGNED_REQUIRED" -and
    $trusted.Count -lt 1
  ) {
    throw "UPDATE_TRUST_POLICY_EMPTY"
  }

  return $trusted
}

function ConvertTo-CanonicalProductVersion(
  [string]$Raw
) {
  $normalized = $Raw.Trim()
  if (
    $normalized -match
      '^(\d+)\.(\d+)\.(\d+)\.0$'
  ) {
    $normalized =
      "$($matches[1]).$($matches[2]).$($matches[3])"
  }

  if (
    $normalized -notmatch
      '^\d+\.\d+\.\d+$'
  ) {
    throw "UPDATE_INSTALLER_PRODUCT_VERSION_INVALID:$Raw"
  }

  return ([Version]$normalized).ToString()
}

function Assert-Authenticode(
  [string]$Installer,
  [string[]]$Trusted,
  [string]$ReceiptThumbprint
) {
  $signature =
    Get-AuthenticodeSignature -LiteralPath $Installer
  if (
    $signature.Status -ne 'Valid' -or
    $null -eq $signature.SignerCertificate
  ) {
    throw "UPDATE_SIGNATURE_INVALID:$($signature.Status)"
  }

  $actual =
    Normalize-Thumbprint(
      $signature.SignerCertificate.Thumbprint
    )
  if (
    $Trusted -notcontains $actual
  ) {
    throw "UPDATE_SIGNER_NOT_TRUSTED:$actual"
  }
  if (
    $actual -ne
      (Normalize-Thumbprint $ReceiptThumbprint)
  ) {
    throw "UPDATE_RECEIPT_SIGNER_MISMATCH"
  }

  return $actual
}

function Assert-InstallerProductVersion(
  [string]$Installer,
  [Version]$Expected
) {
  $raw =
    [string](
      Get-Item -LiteralPath $Installer
    ).VersionInfo.ProductVersion
  if (
    [string]::IsNullOrWhiteSpace($raw)
  ) {
    throw "UPDATE_INSTALLER_PRODUCT_VERSION_MISSING"
  }

  $actual =
    ConvertTo-CanonicalProductVersion $raw
  if (
    [Version]$actual -ne $Expected
  ) {
    throw "UPDATE_INSTALLER_PRODUCT_VERSION_MISMATCH:expected=$Expected actual=$actual"
  }

  return $actual
}

# Copies and removals of the installed application go through robocopy: the backup folder
# adds about 70 characters to paths already deep in node_modules, and Copy-Item and
# Remove-Item of Windows PowerShell 5.1 stop at 260 (0.1.62 -> 0.1.63 aborted on
# ...\@ai-sdk\provider\src\embedding-model-middleware\v3\embedding-model-v3-middleware.ts).
function Copy-TreeLong([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  # No 2>&1: in Windows PowerShell 5.1 with ErrorActionPreference Stop a redirected stderr line
  # of a native program is thrown as an error (robocopy reports on stdout).
  $output = & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NP /NFL /NDL /NJH /NJS
  # robocopy: 0-7 = copied (with or without extra files), 8 and more = failure.
  if ($LASTEXITCODE -ge 8) {
    throw "UPDATE_COPY_FAILED:${LASTEXITCODE}:${Source} -> ${Destination} :: $((@($output) | Select-Object -Last 3) -join ' | ')"
  }
}

function Remove-TreeLong([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $empty = Join-Path ([IO.Path]::GetTempPath()) ("lex-empty-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $empty | Out-Null
  try {
    & robocopy.exe $empty $Path /MIR /R:2 /W:1 /NP /NFL /NDL /NJH /NJS | Out-Null
  } finally {
    Remove-Item -LiteralPath $empty -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
}
