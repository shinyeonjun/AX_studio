param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [Parameter(Mandatory = $true)][string]$SourceSha,
  [string]$InstalledDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
$Repo = [IO.Path]::GetFullPath($Repo)
$guardArgs = @((Join-Path $PSScriptRoot 'runner-safety.mjs'), '--path', $Repo)
if ($InstalledDirectory) { $guardArgs += @('--path', $InstalledDirectory) }
& node @guardArgs | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Disposable runner guard rejected metadata check.' }
$package = Get-Content -LiteralPath (Join-Path $Repo 'apps/desktop/package.json') -Raw | ConvertFrom-Json
$release = Join-Path $Repo 'apps/desktop/release'
$executable = if ($InstalledDirectory) { Join-Path $InstalledDirectory 'AX Studio.exe' } else { Join-Path $release 'win-unpacked/AX Studio.exe' }
$installer = Join-Path $release "AX Studio Setup $($package.version).exe"
function Read-Metadata([string]$Path) {
  $file = Get-Item -LiteralPath $Path
  if ($file.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) { throw 'Reparse executable rejected.' }
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  return @{ productName = $file.VersionInfo.ProductName; productVersion = $file.VersionInfo.ProductVersion;
    fileVersion = $file.VersionInfo.FileVersion; signature = $signature.Status.ToString() }
}
$metadata = @{ app = Read-Metadata $executable; installer = Read-Metadata $installer }
if ($InstalledDirectory) {
  $built = Get-Content -LiteralPath (Join-Path $release 'pe-metadata.json') -Raw | ConvertFrom-Json
  foreach ($key in @('productName', 'productVersion', 'fileVersion', 'signature')) {
    if ($metadata.app[$key] -cne $built.app.$key) { throw "Installed PE metadata changed: $key" }
  }
  & node (Join-Path $PSScriptRoot 'verify-assets.mjs') --repo $Repo --source-sha $SourceSha --manifest (Join-Path $release 'installation-manifest.json') --installed $InstalledDirectory
} else {
  [IO.File]::WriteAllText((Join-Path $release 'pe-metadata.json'), ($metadata | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
  & node (Join-Path $PSScriptRoot 'verify-assets.mjs') --repo $Repo --source-sha $SourceSha --manifest (Join-Path $release 'installation-manifest.json')
}
if ($LASTEXITCODE -ne 0) { throw 'Exact package identity/hash verification failed.' }
