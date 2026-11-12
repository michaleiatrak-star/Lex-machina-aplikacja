param(
  [Parameter(Mandatory=$true)][string]$ArchivePath,
  [Parameter(Mandatory=$true)][string]$DestinationPath
)

$ErrorActionPreference = "Stop"

$archive = (Resolve-Path -LiteralPath $ArchivePath).Path
$destination = [IO.Path]::GetFullPath($DestinationPath)
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$destinationPrefix =
  $destination.TrimEnd([char]92, [char]47) +
  [IO.Path]::DirectorySeparatorChar

Add-Type -AssemblyName System.IO.Compression

# Paths over 260 characters (deep Python packages): the \\?\ form lifts MAX_PATH for .NET on Windows 10/11.
function ConvertTo-LongPath([string]$Path) {
  if ($Path.StartsWith('\\?\')) { return $Path }
  if ($Path.StartsWith('\\')) { return '\\?\UNC\' + $Path.Substring(2) }
  return '\\?\' + $Path
}

$stream = [IO.File]::Open(
  $archive,
  [IO.FileMode]::Open,
  [IO.FileAccess]::Read,
  [IO.FileShare]::Read
)

try {
  $zip = [IO.Compression.ZipArchive]::new(
    $stream,
    [IO.Compression.ZipArchiveMode]::Read,
    $false
  )

  try {
    $seen = New-Object "System.Collections.Generic.HashSet[string]" (
      [StringComparer]::OrdinalIgnoreCase
    )
    $fileCount = 0

    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName.Replace('\', '/')

      if (
        [string]::IsNullOrWhiteSpace($name) -or
        $name.EndsWith("/")
      ) {
        continue
      }

      if (
        $name.StartsWith("/") -or
        $name.StartsWith("\") -or
        $name -match '^[A-Za-z]:' -or
        $name.Split('/') -contains ".."
      ) {
        throw "OFFLINE_ZIP_UNSAFE_ENTRY:$name"
      }

      $relative = $name.Replace('/', [IO.Path]::DirectorySeparatorChar)
      # Plain join, not GetFullPath: Windows PowerShell 5.1 throws PathTooLongException there over 260
      # characters. Safe: absolute names and ".." segments are refused above.
      $target = $destinationPrefix + $relative

      if (
        -not $target.StartsWith(
          $destinationPrefix,
          [StringComparison]::OrdinalIgnoreCase
        )
      ) {
        throw "OFFLINE_ZIP_ENTRY_ESCAPES_ROOT:$name"
      }

      if (-not $seen.Add($target)) {
        throw "OFFLINE_ZIP_DUPLICATE_ENTRY:$name"
      }

      $parent = [IO.Path]::GetDirectoryName($target)
      if ($parent) {
        [IO.Directory]::CreateDirectory((ConvertTo-LongPath $parent)) | Out-Null
      }

      $input = $entry.Open()
      try {
        $output = [IO.File]::Open(
          (ConvertTo-LongPath $target),
          [IO.FileMode]::CreateNew,
          [IO.FileAccess]::Write,
          [IO.FileShare]::None
        )
        try {
          $input.CopyTo($output)
        } finally {
          $output.Dispose()
        }
      } finally {
        $input.Dispose()
      }

      $fileCount++
    }

    if ($fileCount -lt 1) {
      throw "OFFLINE_ZIP_EMPTY_ARCHIVE"
    }

    Write-Host "LEX_OFFLINE_ZIP_EXTRACT_PASS:$fileCount"
  } finally {
    $zip.Dispose()
  }
} finally {
  $stream.Dispose()
}
