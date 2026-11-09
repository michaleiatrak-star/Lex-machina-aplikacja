param([string]$StatusPath, [int]$OwnerPid)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$form.Text = "Przygotowanie Lex Machina"
$form.ClientSize = New-Object Drawing.Size(540, 190)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.ControlBox = $false
$label = New-Object Windows.Forms.Label
$label.SetBounds(24, 24, 490, 48)
$label.Text = "Sprawdzanie potrzebnych narzędzi…"
$label.Font = New-Object Drawing.Font("Segoe UI", 12)
$bar = New-Object Windows.Forms.ProgressBar
$bar.SetBounds(24, 84, 490, 22)
$bar.Style = "Marquee"
$hint = New-Object Windows.Forms.Label
$hint.SetBounds(24, 122, 490, 50)
$hint.Text = "Pierwsze przygotowanie może potrwać kilka minut. Gotowe narzędzia zostaną zachowane."
$form.Controls.AddRange(@($label, $bar, $hint))
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 300
$timer.Add_Tick({
  if (-not (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)) { $form.Close(); return }
  try {
    $state = Get-Content -Raw -LiteralPath $StatusPath | ConvertFrom-Json
    $label.Text = $state.text
    if ($state.done) { $form.Close(); return }
    if ($state.total -gt 0) {
      $bar.Style = "Continuous"
      $bar.Value = [Math]::Min(100, [int](100 * $state.received / $state.total))
      $hint.Text = "Pobrano {0:N1} z {1:N1} MB" -f ($state.received / 1MB), ($state.total / 1MB)
    } else {
      $bar.Style = "Marquee"
      $hint.Text = if ($state.received -gt 0) { "Pobrano {0:N1} MB" -f ($state.received / 1MB) } else { "Trwa przygotowanie. To okno zamknie się automatycznie." }
    }
  } catch { } # Atomic replacement can briefly make the status unavailable.
})
try { $timer.Start(); [void]$form.ShowDialog() } finally { $timer.Dispose(); $form.Dispose() }
