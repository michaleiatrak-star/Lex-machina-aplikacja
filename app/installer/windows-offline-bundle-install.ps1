param(
  [Parameter(Mandatory=$true)][string]$RuntimeRoot,
  [Parameter(Mandatory=$true)][string]$BundlePath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "bootstrap-progress.ps1")
Set-BootstrapProgress "Sprawdzanie pełnego pakietu instalacyjnego…"

$runtime = [IO.Path]::GetFullPath($RuntimeRoot)
$bundle = (Resolve-Path -LiteralPath $BundlePath).Path
$receiptPath = Join-Path $runtime "offline-runtime.json"

# NSIS invokes Windows PowerShell directly. On some clean-machine/CI hosts its
# inherited module path does not expose the built-in Get-FileHash cmdlet.
# Provide a SHA-256-compatible fallback so this installer and child self-tests
# stay independent of PowerShell module auto-loading.
if (-not (Get-Command Get-FileHash -ErrorAction SilentlyContinue)) {
  function Get-FileHash {
    param(
      [string]$Path,
      [string]$LiteralPath,
      [string]$Algorithm = "SHA256"
    )
    if ($Algorithm.ToUpperInvariant() -ne "SHA256") {
      throw "OFFLINE_HASH_ALGORITHM_UNSUPPORTED:$Algorithm"
    }
    $target = if ($LiteralPath) { $LiteralPath } else { $Path }
    if (-not $target) { throw "OFFLINE_HASH_PATH_MISSING" }
    $stream = [IO.File]::OpenRead($target)
    try {
      $sha = [Security.Cryptography.SHA256]::Create()
      try {
        $bytes = $sha.ComputeHash($stream)
      } finally {
        $sha.Dispose()
      }
    } finally {
      $stream.Dispose()
    }
    [pscustomobject]@{
      Algorithm = "SHA256"
      Hash = ([BitConverter]::ToString($bytes) -replace '-','')
      Path = [IO.Path]::GetFullPath($target)
    }
  }
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Visual C++ 2015-2022 x64 runtime: the newest version seen in the registry
# (both views) and in the System32 DLLs. A machine whose Package Cache was
# cleaned keeps a working runtime but cannot be upgraded (MSI 1603), so the
# DLLs count as well as the registry.
$script:VcRuntimeFloor = [Version]"14.40.33810" # VS 17.10 runtime: oldest that runs current llama.cpp/ONNX builds
function Get-VcRuntimeVersion {
  $found = @()
  foreach ($key in @(
    "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"
  )) {
    try {
      if ((Get-ItemPropertyValue -Path $key -Name Installed -ErrorAction Stop) -eq 1) {
        $found += [Version]((Get-ItemPropertyValue -Path $key -Name Version -ErrorAction Stop).ToString().TrimStart("v"))
      }
    } catch {}
  }
  $dllVersions = @()
  foreach ($dll in @("vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll")) {
    $path = Join-Path $env:SystemRoot "System32\$dll"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $dllVersions = @(); break }
    $info = (Get-Item -LiteralPath $path).VersionInfo
    $dllVersions += [Version]::new($info.FileMajorPart, $info.FileMinorPart, $info.FileBuildPart, $info.FilePrivatePart)
  }
  if ($dllVersions.Count -eq 3) {
    $found += ($dllVersions | Sort-Object | Select-Object -First 1)
  }
  if (-not $found.Count) { return $null }
  return ($found | Sort-Object -Descending | Select-Object -First 1)
}

function Test-RebootPending {
  return (
    (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending") -or
    (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired") -or
    [bool](Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager" -Name PendingFileRenameOperations -ErrorAction SilentlyContinue)
  )
}

# App-local Visual C++ runtime, as in the online installer: when the system runtime is older
# than required and cannot be upgraded (MSI 1603 after a cleaned Package Cache), the runtime
# bundled at build time (prerequisites\vc-applocal) goes next to the executables. Windows loads
# DLLs from the executable's folder first. A file already in place is left untouched: it is
# covered by the component lock made at build time.
$script:VcAppLocalDir = $null
function Get-DllVersion([string]$path) {
  $info = (Get-Item -LiteralPath $path).VersionInfo
  return [Version]::new($info.FileMajorPart, $info.FileMinorPart, $info.FileBuildPart, $info.FilePrivatePart)
}
function Get-VcRuntimeAppLocal([string]$runtimeRoot, [Version]$required) {
  $dir = Join-Path $runtimeRoot "prerequisites\vc-applocal"
  foreach ($needed in @("vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll")) {
    $path = Join-Path $dir $needed
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "VC_APPLOCAL_NOT_BUNDLED:$needed" }
    $version = Get-DllVersion $path
    if ($version -lt $required) { throw "VC_APPLOCAL_TOO_OLD:${needed}:$version<$required" }
  }
  return $dir
}
function Copy-VcRuntimeAppLocal([string]$dllDir, [string[]]$targets) {
  foreach ($target in $targets) {
    if (-not $target -or -not (Test-Path -LiteralPath $target -PathType Container)) { continue }
    Get-ChildItem -LiteralPath $dllDir -File -Filter "*.dll" | ForEach-Object {
      $destination = Join-Path $target $_.Name
      if (-not (Test-Path -LiteralPath $destination)) { Copy-Item -LiteralPath $_.FullName -Destination $destination }
    }
    Write-Host "Visual C++ runtime (app-local) placed in $target"
  }
}

# Runs vc_redist with a log; on failure accepts an already working runtime
# (>= floor), then deploys the required runtime app-local, and otherwise
# explains the cause instead of a bare exit code.
function Install-VcRuntime([string]$installer, [Version]$required, [string]$logDir, [string]$errorPrefix, [int]$timeoutMs = 600000) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $log = Join-Path $logDir ("vc_redist-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  $startArgs = @{
    FilePath = $installer
    ArgumentList = @("/install", "/quiet", "/norestart", "/log", "`"$log`"")
    PassThru = $true
  }
  if (-not (Test-IsAdministrator)) {
    $startArgs.Verb = "RunAs"
  }
  # A declined UAC prompt throws instead of returning a code: 1223 (ERROR_CANCELLED)
  # takes the same fallback as a failed upgrade.
  $process = $null
  try {
    $process = Start-Process @startArgs
  } catch {
    Write-Warning "vc_redist did not start: $($_.Exception.Message)"
  }
  if ($process) {
    if (-not $process.WaitForExit($timeoutMs)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "${errorPrefix}_TIMEOUT"
    }
    $process.Refresh()
    $code = $process.ExitCode
  } else {
    $code = 1223
  }
  # 0 ok, 3010 ok after restart, 1638 a newer version is already installed.
  if ($code -in @(0, 1638, 3010)) { return $code }
  $present = Get-VcRuntimeVersion
  if ($present -and $present -ge $required) {
    Write-Host "Visual C++ runtime $present present despite vc_redist exit $code; continuing"
    return $code
  }
  if ($present -and $present -ge $script:VcRuntimeFloor) {
    Write-Warning "Visual C++ runtime update to $required failed (exit $code, log $log); using installed $present (>= $($script:VcRuntimeFloor))"
    return $code
  }
  # The system runtime stays older: the required version goes next to the application instead.
  try {
    $script:VcAppLocalDir = Get-VcRuntimeAppLocal $runtime $script:VcRuntimeFloor
    Write-Warning "Visual C++ runtime update to $required failed (exit $code, log $log); installed $(if ($present) { $present } else { 'none' }) stays, the required runtime is deployed next to the application"
    return $code
  } catch {
    Write-Warning "App-local Visual C++ runtime unavailable: $($_.Exception.Message)"
  }
  $logText = ""
  Get-ChildItem -LiteralPath $logDir -Filter ([IO.Path]::GetFileNameWithoutExtension($log) + "*") -ErrorAction SilentlyContinue |
    ForEach-Object { $logText += (Get-Content -Raw -LiteralPath $_.FullName -ErrorAction SilentlyContinue) }
  $hints = @()
  if (Test-RebootPending) {
    $hints += "system czeka na ponowne uruchomienie - uruchom komputer ponownie i powtorz instalacje"
  }
  if ($logText -match "(?i)1612|source (file )?(is )?not (available|found)|Package Cache") {
    $hints += "brak pakietu poprzedniej wersji Visual C++ w C:\ProgramData\Package Cache (usuniete instalatory) - odinstaluj 'Microsoft Visual C++ 2015-2022 Redistributable (x64)' w Panelu sterowania (albo narzedziem Microsoft 'Program Install and Uninstall troubleshooter'), nastepnie powtorz instalacje"
  }
  if (-not $hints.Count) {
    $hints += "napraw albo odinstaluj 'Microsoft Visual C++ 2015-2022 Redistributable (x64)' w Panelu sterowania, uruchom komputer ponownie i powtorz instalacje"
  }
  $installedText = if ($present) { "zainstalowana $present" } else { "brak runtime" }
  throw "${errorPrefix}_FAILED:$code - Visual C++ $required nie zainstalowal sie ($installedText). Co zrobic: $($hints -join '; '). Log: $log"
}

if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
  throw "OFFLINE_BUNDLE_RECEIPT_MISSING"
}
$receipt = Get-Content -Raw -LiteralPath $receiptPath | ConvertFrom-Json
if ($receipt.schemaVersion -ne 1) {
  throw "OFFLINE_BUNDLE_RECEIPT_SCHEMA_INVALID"
}
if ($receipt.bundleFile -ne (Split-Path -Leaf $bundle)) {
  throw "OFFLINE_BUNDLE_FILENAME_MISMATCH"
}
if ($receipt.sha256 -notmatch '^[a-fA-F0-9]{64}$') {
  throw "OFFLINE_BUNDLE_RECEIPT_HASH_INVALID"
}
if ([int64]$receipt.bytes -ne (Get-Item -LiteralPath $bundle).Length) {
  throw "OFFLINE_BUNDLE_SIZE_MISMATCH"
}

$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $bundle).Hash.ToLowerInvariant()
if ($actualHash -ne $receipt.sha256.ToLowerInvariant()) {
  throw "OFFLINE_BUNDLE_HASH_MISMATCH:expected=$($receipt.sha256) actual=$actualHash"
}

$stage = Join-Path $env:TEMP ("LexMachinaOfflineRuntime-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stage | Out-Null
$vcFirewallRule = $null

try {
  Set-BootstrapProgress "Rozpakowywanie narzędzi z pełnego instalatora…"
  Write-Host "Extracting verified offline runtime bundle"
  $extractor = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "extract-offline-zip.ps1"
  if (-not (Test-Path -LiteralPath $extractor -PathType Leaf)) {
    throw "OFFLINE_BUNDLE_EXTRACTOR_MISSING"
  }
  & $extractor -ArchivePath $bundle -DestinationPath $stage

  $lockPath = Join-Path $stage "component-lock.json"
  if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
    throw "OFFLINE_BUNDLE_COMPONENT_LOCK_MISSING"
  }
  $lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
  if ($lock.networkRequiredAtInstall -ne $false) {
    throw "OFFLINE_BUNDLE_NETWORK_POLICY_INVALID"
  }
  if ($lock.runtimeNetworkRequiredAfterBootstrap -ne $false) {
    throw "OFFLINE_BUNDLE_RUNTIME_NETWORK_POLICY_INVALID"
  }

  Set-BootstrapProgress "Sprawdzanie przygotowanych plików…"
  Write-Host "Verifying component-lock before installation"
  foreach ($entry in $lock.files) {
    $path = Join-Path $stage ($entry.path -replace '/','\')
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "OFFLINE_BUNDLE_LOCK_FILE_MISSING:$($entry.path)"
    }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    if ($hash -ne $entry.sha256) {
      throw "OFFLINE_BUNDLE_LOCK_HASH_MISMATCH:$($entry.path)"
    }
  }

  Set-BootstrapProgress "Przygotowanie narzędzi aplikacji…"
  Write-Host "Installing verified private runtime into $runtime"
  $null = robocopy.exe $stage $runtime /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
  $robocopyCode = $LASTEXITCODE
  if ($robocopyCode -gt 7) {
    throw "OFFLINE_BUNDLE_COPY_FAILED:$robocopyCode"
  }

  $manifestPath = Join-Path $runtime "release-source.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "OFFLINE_BUNDLE_RELEASE_SOURCE_MISSING"
  }
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $vc = $manifest.systemPrerequisites.visualCppRuntime
  $vcPresent = Get-VcRuntimeVersion
  $vcInstalled = [bool]($vcPresent -and $vcPresent -ge [Version]$vc.version)
  if ($vcPresent) { Write-Host "Visual C++ runtime found: $vcPresent (required $($vc.version))" }

  $forceVcInstall = $env:LEX_FORCE_VC_RUNTIME_INSTALL -eq "1"
  if ($forceVcInstall) {
    Write-Host "Forcing bundled Visual C++ runtime fallback for acceptance coverage"
    $vcInstalled = $false
  }

  if (-not $vcInstalled) {
    $vcInstaller = Join-Path $runtime "prerequisites\vc_redist.x64.exe"
    if (-not (Test-Path -LiteralPath $vcInstaller -PathType Leaf)) {
      throw "OFFLINE_BUNDLE_VC_RUNTIME_MISSING"
    }
    $vcHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $vcInstaller).Hash.ToLowerInvariant()
    if ($vcHash -ne $vc.sha256.ToLowerInvariant()) {
      throw "OFFLINE_BUNDLE_VC_RUNTIME_HASH_MISMATCH"
    }

    if ($env:LEX_ACCEPTANCE_BLOCK_NETWORK -eq "1") {
      if (-not (Test-IsAdministrator)) {
        throw "OFFLINE_BUNDLE_VC_FIREWALL_REQUIRES_ELEVATION"
      }
      $vcFirewallRule = "LexMachina-Acceptance-vc-redist-$([Guid]::NewGuid().ToString('N'))"
      New-NetFirewallRule `
        -DisplayName $vcFirewallRule `
        -Direction Outbound `
        -Action Block `
        -Program $vcInstaller `
        -Profile Any | Out-Null
      Write-Host "Acceptance firewall: outbound blocked for bundled VC++ installer"
    }

    Set-BootstrapProgress "Przygotowanie składników systemu Windows…"
  Write-Host "Installing verified bundled Visual C++ runtime"
    $vcExit = Install-VcRuntime $vcInstaller ([Version]$vc.version) (Join-Path $env:LOCALAPPDATA "LexMachina\logs") "OFFLINE_BUNDLE_VC_RUNTIME"
    Write-Host "Bundled Visual C++ runtime fallback exercised; exit=$vcExit"
  }
  if ($script:VcAppLocalDir) {
    $vcTargets = @($runtime) + @(
      Get-ChildItem -LiteralPath $runtime -Recurse -File -Filter "*.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\(prerequisites|bootstrap)\\' } |
        ForEach-Object { $_.DirectoryName }
    ) | Sort-Object -Unique
    Copy-VcRuntimeAppLocal $script:VcAppLocalDir $vcTargets
  }

  Set-BootstrapProgress "Sprawdzanie gotowości aplikacji…"
  $selfTest = Join-Path $runtime "bootstrap\windows-payload-selftest.ps1"
  if (-not (Test-Path -LiteralPath $selfTest -PathType Leaf)) {
    throw "OFFLINE_BUNDLE_SELFTEST_SCRIPT_MISSING"
  }
  $selfTestLog = Join-Path $runtime "bootstrap\offline-payload-selftest.log"
  Remove-Item -LiteralPath $selfTestLog -Force -ErrorAction SilentlyContinue
  $selfTestErrLog = $selfTestLog + ".stderr"
  Remove-Item -LiteralPath $selfTestErrLog -Force -ErrorAction SilentlyContinue
  try {
    # Run the self-test as a separate process with file redirection. Piping
    # it through *>&1 turned harmless native stderr lines (e.g. PaddleOCR
    # UserWarning) into terminating errors under Windows PowerShell 5.1.
    $selfTestShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    # A parent PowerShell 7 exports its own PSModulePath; Windows PowerShell
    # 5.1 inheriting it cannot autoload built-in cmdlets such as Get-FileHash.
    $savedModulePath = $env:PSModulePath
    $env:PSModulePath = @(
      (Join-Path $env:ProgramFiles "WindowsPowerShell\Modules"),
      (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\Modules")
    ) -join ";"
    try {
    $selfTestProcess = Start-Process `
      -FilePath $selfTestShell `
      -ArgumentList @(
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-File", ('"' + $selfTest + '"'),
        "-PayloadRoot", ('"' + $runtime + '"')
      ) `
      -RedirectStandardOutput $selfTestLog `
      -RedirectStandardError $selfTestErrLog `
      -NoNewWindow `
      -PassThru
    } finally {
      $env:PSModulePath = $savedModulePath
    }
    # Reading Handle keeps ExitCode available after WaitForExit.
    $null = $selfTestProcess.Handle
    # A hung stage must fail with its log, not stall the whole install.
    if (-not $selfTestProcess.WaitForExit(45 * 60 * 1000)) {
      Add-Content -LiteralPath $selfTestLog -Value "SELFTEST_TIMEOUT_45_MIN" -Encoding UTF8
      $runtimePrefix = $runtime.TrimEnd([char]92, [char]47) + [IO.Path]::DirectorySeparatorChar
      Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
        try {
          if ($_.Path -and $_.Path.StartsWith($runtimePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            Add-Content -LiteralPath $selfTestLog -Value ("SELFTEST_TIMEOUT_PROCESS:" + $_.ProcessName + ":" + $_.Id) -Encoding UTF8
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
          }
        } catch {}
      }
      Stop-Process -Id $selfTestProcess.Id -Force -ErrorAction SilentlyContinue
      throw "OFFLINE_BUNDLE_SELFTEST_TIMEOUT"
    }
    $selfTestProcess.Refresh()
    # Nothing started by the self-test may outlive it (it would hold the logs).
    $runtimePrefix = $runtime.TrimEnd([char]92, [char]47) + [IO.Path]::DirectorySeparatorChar
    Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        if ($_.Path -and $_.Path.StartsWith($runtimePrefix, [StringComparison]::OrdinalIgnoreCase)) {
          Write-Host "Self-test leftover stopped: $($_.ProcessName) pid=$($_.Id)"
          Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
      } catch {}
    }
    Start-Sleep -Milliseconds 500
    if (Test-Path -LiteralPath $selfTestErrLog -PathType Leaf) {
      try {
        Get-Content -LiteralPath $selfTestErrLog -ErrorAction Stop |
          Add-Content -LiteralPath $selfTestLog -Encoding UTF8 -ErrorAction Stop
      } catch {
        Write-Host "Self-test stderr not merged: $($_.Exception.Message)"
      }
    }
    Get-Content -LiteralPath $selfTestLog -ErrorAction SilentlyContinue | Out-Host
    if ($selfTestProcess.ExitCode -ne 0) {
      throw "OFFLINE_BUNDLE_SELFTEST_EXIT:$($selfTestProcess.ExitCode)"
    }
  } catch {
    Add-Content -LiteralPath $selfTestLog -Value ("SELFTEST_EXCEPTION:" + $_.Exception.Message) -Encoding UTF8 -ErrorAction SilentlyContinue
    Write-Host "OFFLINE_BUNDLE_SELFTEST_LOG_TAIL"
    Get-Content -LiteralPath $selfTestLog -Tail 120 -ErrorAction SilentlyContinue | Out-Host
    throw "OFFLINE_BUNDLE_SELFTEST_FAILED:$($_.Exception.Message)"
  }

  $nativeWebConfigurator = Join-Path $runtime "bootstrap\configure-llama-native-web.ps1"
  if (-not (Test-Path -LiteralPath $nativeWebConfigurator -PathType Leaf)) {
    throw "OFFLINE_BUNDLE_LLAMA_NATIVE_WEB_CONFIGURATOR_MISSING"
  }
  & $nativeWebConfigurator -RuntimeRoot $runtime | Out-Host

  Write-Host "LEX_OFFLINE_BUNDLE_INSTALL_PASS"
} finally {
  if ($vcFirewallRule) {
    Remove-NetFirewallRule -DisplayName $vcFirewallRule -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}