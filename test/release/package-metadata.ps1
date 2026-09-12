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
  # electron-builder gives the app a numeric PE ProductVersion, even for a
  # prerelease. NSIS retains the full semantic version in ProductVersion.
  # FileVersion must also retain the prerelease identity on both artifacts.
  if ($package.version -notmatch '^(\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
    throw "Unsupported package version: $($package.version)"
  }
  $numericVersion = "$($Matches[1]).0"
  $expectedProductVersions = if ($file.FullName -eq (Get-Item -LiteralPath $Executable).FullName) {
    @($numericVersion)
  } else { @($package.version) }
  $expectedFileVersions = @($package.version)
  if ($package.version -match '^\d+\.\d+\.\d+$') {
    $expectedProductVersions += $numericVersion
    $expectedFileVersions += $numericVersion
  }
  if ($info.ProductVersion -notin $expectedProductVersions) { throw "Incorrect product version: $($file.Name) / $($info.ProductVersion)" }
  if ($info.FileVersion -notin $expectedFileVersions) { throw "Incorrect file version: $($file.Name) / $($info.FileVersion)" }
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($RequireSigned -and $signature.Status -ne 'Valid') { throw "A trusted signature is required: $($file.Name) / $($signature.Status)" }
  Write-Output "[package] PASS: $($file.Name), product=$($info.ProductName), version=$($info.ProductVersion), signature=$($signature.Status)"
  Write-Output "[package] SHA256: $((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash)"
}
