param(
  [Parameter(Mandatory = $true)][int]$AppProcessId,
  [Parameter(Mandatory = $true)][string]$FilePath,
  [Parameter(Mandatory = $true)][ValidateSet('open', 'save')][string]$Kind
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$contextJson = & node (Join-Path $PSScriptRoot 'runner-safety.mjs') --path $FilePath
if ($LASTEXITCODE -ne 0) { throw 'Disposable runner guard rejected native dialog control.' }
$context = $contextJson | ConvertFrom-Json
if (-not $FilePath.StartsWith($context.acceptance + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Native file dialogs may only touch synthetic acceptance files.' }
$process = Get-Process -Id $AppProcessId -ErrorAction Stop
if ($process.Path -ine (Join-Path $context.install 'AX Studio.exe')) { throw 'Dialog process is not this owned installed app.' }
if ($Kind -eq 'save' -and (Test-Path -LiteralPath $FilePath)) { throw 'Save test will not overwrite an existing file.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$processCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $AppProcessId)
$deadline = [DateTime]::UtcNow.AddSeconds(30)
do {
  $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $processCondition)
  foreach ($window in $windows) {
    if ($window.Current.ClassName -ne '#32770') { continue }
    # Windows common file dialogs: filename ComboBox/Edit is 1148; OK button is 1.
    $filenameCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty, '1148')
    $filename = $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $filenameCondition)
    if ($null -eq $filename) { continue }
    $pattern = $null
    if (-not $filename.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      $editCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Edit)
      $filename = $filename.FindFirst([Windows.Automation.TreeScope]::Descendants, $editCondition)
      if ($null -eq $filename -or -not $filename.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { continue }
    }
    # Recheck safety immediately before the native UI action.
    & node (Join-Path $PSScriptRoot 'runner-safety.mjs') --path $FilePath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Runner ownership changed before dialog action.' }
    ([Windows.Automation.ValuePattern]$pattern).SetValue($FilePath)
    $buttonCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty, '1')
    $button = $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    if ($null -eq $button) { throw 'Native file dialog confirmation is missing.' }
    ([Windows.Automation.InvokePattern]$button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    exit 0
  }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
throw 'Owned native file dialog was not found before the timeout.'
