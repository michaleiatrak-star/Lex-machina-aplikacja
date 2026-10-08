param()

# Install-VcRuntime of windows-online-bootstrap.ps1 (read from the script, not
# copied) against vc_redist outcomes seen on user machines: success codes, MSI
# 1603 with a newer / older / missing system runtime, a declined UAC prompt,
# a timeout, and the app-local runtime missing or too old. Start-Process, the
# registry probe and DLL versions are stand-ins; the decisions are the bootstrap's.

$ErrorActionPreference = "Stop"

$bootstrapPath = Join-Path $PSScriptRoot "windows-online-bootstrap.ps1"
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($bootstrapPath, [ref]$null, [ref]$errors)
if ($errors) { throw "BOOTSTRAP_PARSE_FAILED: $($errors -join '; ')" }
$floor = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$script:VcRuntimeFloor' }, $true) | Select-Object -First 1
if (-not $floor) { throw "VC_RUNTIME_FLOOR_MISSING" }
. ([scriptblock]::Create($floor.Extent.Text))
$wanted = @("Get-VcRuntimeAppLocal", "Copy-VcRuntimeAppLocal", "Install-VcRuntime")
$functions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $wanted }, $true)
if ($functions.Count -ne $wanted.Count) { throw "VC_FUNCTIONS_MISSING" }
. ([scriptblock]::Create((($functions | ForEach-Object { $_.Extent.Text }) -join "`n")))

# Stand-ins: no real installer, registry or PE version resource.
$script:FakeExit = 0
$script:FakeDeclined = $false
$script:FakeHangs = $false
$script:FakePresent = $null
$script:FakeDllVersion = @{}
function Test-IsAdministrator { return $false }
function Test-RebootPending { return $false }
function Get-VcRuntimeVersion { return $script:FakePresent }
function Get-DllVersion([string]$path) { return $script:FakeDllVersion[[IO.Path]::GetFileName($path)] }
function Start-Process {
  if ($script:FakeDeclined) { throw "This command cannot be run due to the error: The operation was canceled by the user." }
  $process = [pscustomobject]@{ Id = 0; ExitCode = $script:FakeExit; Hangs = $script:FakeHangs }
  $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($ms) -not $this.Hangs }
  $process | Add-Member -MemberType ScriptMethod -Name Refresh -Value { }
  return $process
}
function Stop-Process { }

$root = Join-Path ([IO.Path]::GetTempPath()) ("lex-vc-selftest-" + [Guid]::NewGuid().ToString("N"))
$runtime = Join-Path $root "runtime"
$appLocal = Join-Path $runtime "prerequisites\vc-applocal"
$logDir = Join-Path $root "logs"
$required = [Version]"14.44.35211"
$older = [Version]"14.29.30139"
$current = [Version]"14.44.35211"

function Reset-Case([bool]$withAppLocal = $true, [Version]$appLocalVersion = $current) {
  $script:FakeExit = 0
  $script:FakeDeclined = $false
  $script:FakeHangs = $false
  $script:FakePresent = $null
  $script:VcAppLocalDir = $null
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $appLocal | Out-Null
  $script:FakeDllVersion = @{}
  if ($withAppLocal) {
    foreach ($name in @("vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll", "concrt140.dll")) {
      Set-Content -LiteralPath (Join-Path $appLocal $name) -Value $name
      $script:FakeDllVersion[$name] = $appLocalVersion
    }
  }
}

$failures = [Collections.Generic.List[string]]::new()
function Check([string]$name, [scriptblock]$body) {
  try {
    & $body
    Write-Host "PASS $name"
  } catch {
    $failures.Add("$name :: $($_.Exception.Message)")
    Write-Host "FAIL $name :: $($_.Exception.Message)"
  }
}
function Expect([bool]$condition, [string]$message) { if (-not $condition) { throw $message } }
function Install { return Install-VcRuntime "vc_redist.x64.exe" $required $logDir "BOOTSTRAP_VC_RUNTIME" }

try {
  foreach ($code in @(0, 1638, 3010)) {
    Check "exit $code is success" {
      Reset-Case
      $script:FakeExit = $code
      Expect ((Install) -eq $code) "returned code"
      Expect (-not $script:VcAppLocalDir) "app-local used"
    }
  }

  Check "1603 with the required runtime already present continues" {
    Reset-Case
    $script:FakeExit = 1603
    $script:FakePresent = $required
    $null = Install
    Expect (-not $script:VcAppLocalDir) "app-local used"
  }

  Check "1603 with an installed runtime above the floor keeps it" {
    Reset-Case
    $script:FakeExit = 1603
    $script:FakePresent = $script:VcRuntimeFloor
    $null = Install
    Expect (-not $script:VcAppLocalDir) "app-local used"
  }

  Check "1603 with an older system runtime deploys the runtime next to the application" {
    Reset-Case
    $script:FakeExit = 1603
    $script:FakePresent = $older
    $null = Install
    Expect ($script:VcAppLocalDir -eq $appLocal) "app-local not chosen"
  }

  Check "1603 without any runtime deploys the runtime next to the application" {
    Reset-Case
    $script:FakeExit = 1603
    $null = Install
    Expect ($script:VcAppLocalDir -eq $appLocal) "app-local not chosen"
  }

  Check "declined UAC prompt deploys the runtime next to the application" {
    Reset-Case
    $script:FakeDeclined = $true
    $script:FakePresent = $older
    $null = Install
    Expect ($script:VcAppLocalDir -eq $appLocal) "app-local not chosen"
  }

  Check "declined UAC prompt with a working runtime continues" {
    Reset-Case
    $script:FakeDeclined = $true
    $script:FakePresent = $required
    $null = Install
    Expect (-not $script:VcAppLocalDir) "app-local used"
  }

  Check "1603 without an app-local runtime explains what to do" {
    Reset-Case -withAppLocal $false
    $script:FakeExit = 1603
    $message = ""
    try { $null = Install } catch { $message = $_.Exception.Message }
    Expect ($message -like "BOOTSTRAP_VC_RUNTIME_FAILED:1603*") "no failure: $message"
    Expect ($message -match "Co zrobic") "no hint: $message"
    Expect ($message -match "VC_APPLOCAL_NOT_BUNDLED") "no app-local cause: $message"
  }

  Check "1603 with a too old app-local runtime fails" {
    Reset-Case -appLocalVersion $older
    $script:FakeExit = 1603
    $message = ""
    try { $null = Install } catch { $message = $_.Exception.Message }
    Expect ($message -match "VC_APPLOCAL_TOO_OLD") "accepted old app-local: $message"
  }

  Check "vc_redist that never ends times out" {
    Reset-Case
    $script:FakeHangs = $true
    $message = ""
    try { $null = Install } catch { $message = $_.Exception.Message }
    Expect ($message -eq "BOOTSTRAP_VC_RUNTIME_TIMEOUT") "no timeout: $message"
  }

  Check "app-local runtime lands next to every executable folder" {
    Reset-Case
    $targets = @((Join-Path $runtime "node"), (Join-Path $runtime "python"), (Join-Path $runtime "missing"))
    New-Item -ItemType Directory -Force -Path $targets[0], $targets[1] | Out-Null
    Copy-VcRuntimeAppLocal $appLocal $targets | Out-Null
    foreach ($target in $targets[0..1]) {
      foreach ($name in @("vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll")) {
        Expect (Test-Path -LiteralPath (Join-Path $target $name)) "$name not in $target"
      }
    }
    Expect (-not (Test-Path -LiteralPath $targets[2])) "created a missing folder"
  }
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures.Count) {
  throw "VC_RUNTIME_INSTALL_SELFTEST_FAILED: $($failures -join ' | ')"
}
Write-Host "VC_RUNTIME_INSTALL_SELFTEST_PASS"
