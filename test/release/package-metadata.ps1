param(
  [string]$Executable,
  [string]$Installer,
  [string]$ReleaseDirectory,
  [switch]$RequireSigned
)
$ErrorActionPreference = 'Stop'
# npm/Node can pass PowerShell 7's module path to Windows PowerShell 5.1.
# Resolve the security cmdlets from this shell, not an incompatible inherited module.
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$packageFile = Join-Path $PSScriptRoot '../../apps/desktop/package.json'
$package = Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json
if ($ReleaseDirectory) {
  if ($Executable -or $Installer) { throw 'Use ReleaseDirectory or explicit Executable/Installer paths, not both.' }
  $Executable = Join-Path $ReleaseDirectory 'win-unpacked/AX Studio.exe'
  $Installer = Join-Path $ReleaseDirectory "AX Studio Setup $($package.version).exe"
}
if (-not $Executable -or -not $Installer) { throw 'Both executable and installer paths are required.' }
foreach ($path in @($Executable, $Installer)) {
  $file = Get-Item -LiteralPath $path
  $info = $file.VersionInfo
  if ($info.ProductName -ne 'AX Studio') { throw "Incorrect product identity: $($file.Name) / $($info.ProductName)" }
  # PE resources normalize a stable three-part version to four numeric components.
  $expectedVersions = @($package.version)
  if ($package.version -match '^\d+\.\d+\.\d+$') { $expectedVersions += "$($package.version).0" }
  if ($info.ProductVersion -notin $expectedVersions) { throw "Incorrect product version: $($file.Name) / $($info.ProductVersion)" }
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($RequireSigned -and $signature.Status -ne 'Valid') { throw "A trusted signature is required: $($file.Name) / $($signature.Status)" }
  Write-Output "[package] PASS: $($file.Name), product=$($info.ProductName), version=$($info.ProductVersion), signature=$($signature.Status)"
  Write-Output "[package] SHA256: $((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash)"
}
