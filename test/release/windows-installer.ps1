param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$PreviousInstaller,
  [switch]$AllowHostInstall
)

# Installs the actual artifact, not a renamed/test-appId build. Use a disposable
# Windows runner. Local execution is opt-in and refuses ANY pre-existing footprint.
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Windows is required.' }
if (-not $AllowHostInstall -and $env:GITHUB_ACTIONS -ne 'true') {
  throw 'Use a disposable Windows runner, or explicitly pass -AllowHostInstall on an unused test account.'
}
$releaseRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
if ([IO.Path]::GetExtension($installerPath) -ne '.exe') { throw 'Expected an NSIS .exe installer.' }
$previousPath = if ($PreviousInstaller) { (Resolve-Path -LiteralPath $PreviousInstaller).Path } else { $installerPath }
$desktopPackage = Get-Content -LiteralPath (Join-Path $releaseRepo 'apps/desktop/package.json') -Raw | ConvertFrom-Json
$builderConfig = Get-Content -LiteralPath (Join-Path $releaseRepo 'apps/desktop/electron-builder.yml') -Raw | ConvertFrom-Json
if ($builderConfig.appId -ne 'com.axstudio.desktop' -or $builderConfig.productName -ne 'AX Studio') {
  throw 'Installer safety guards must be reviewed after changing the application identity.'
}
# UUID v5 used by electron-builder for com.axstudio.desktop.
$appGuid = '45355cef-5094-5e47-adc3-1337b8e2577e'
$registryKeys = foreach ($hive in @('HKCU:', 'HKLM:')) {
  foreach ($software in @('Software', 'Software\WOW6432Node')) {
    "$hive\$software\$appGuid"
    "$hive\$software\Microsoft\Windows\CurrentVersion\Uninstall\$appGuid"
  }
}
$shortcutPaths = foreach ($folder in @('DesktopDirectory', 'CommonDesktopDirectory', 'Programs', 'CommonPrograms')) {
  $location = [Environment]::GetFolderPath($folder)
  if ($location) { Join-Path $location 'AX Studio.lnk' }
}
$installerCache = Join-Path $env:LOCALAPPDATA '@ax-studiodesktop-updater'
foreach ($path in @($registryKeys) + @($shortcutPaths) + @($installerCache)) {
  if (Test-Path -LiteralPath $path) { throw "Refusing to touch an existing AX Studio footprint: $path" }
}
if (Get-Process -Name 'AX Studio' -ErrorAction SilentlyContinue) { throw 'AX Studio is already running.' }

$releaseScratch = Join-Path ([IO.Path]::GetTempPath()) ('ax-installer-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $releaseScratch | Out-Null
$releaseScratch = (Resolve-Path -LiteralPath $releaseScratch).Path
$installDir = [IO.Path]::GetFullPath((Join-Path $releaseScratch 'program'))
$acceptanceDir = Join-Path $releaseScratch 'acceptance'
$installedExecutable = Join-Path $installDir 'AX Studio.exe'
$uninstaller = Join-Path $installDir 'Uninstall AX Studio.exe'
$installKey = "HKCU:\Software\$appGuid"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appGuid"
$installed = $false
$passed = $false
$script:installerTerminationUnconfirmed = $false

function Assert-OwnedInstall {
  $resolvedInstall = [IO.Path]::GetFullPath($installDir)
  if (-not $resolvedInstall.StartsWith($releaseScratch + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Install/uninstall target escaped its owned temporary workspace.'
  }
  if (Test-Path -LiteralPath $installKey) {
    $location = (Get-ItemProperty -LiteralPath $installKey).InstallLocation
    if ([IO.Path]::GetFullPath($location) -ne $resolvedInstall) { throw 'Another installation took ownership; refusing cleanup.' }
  }
}
function Run-Installer([string]$Executable, [string]$Arguments) {
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(180000)) {
    $script:installerTerminationUnconfirmed = $true
    throw "Installer timed out; inspect process $($process.Id) before cleanup."
  }
  if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode)." }
}
function Test-InstalledApp([switch]$Reopen, [switch]$CheckVersion) {
  $arguments = @((Join-Path $releaseRepo 'test/release/installed-app.mjs'), '--executable', $installedExecutable, '--workspace', $acceptanceDir)
  if ($Reopen) { $arguments += '--reopen' }
  if ($CheckVersion) { $arguments += @('--version', $desktopPackage.version) }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Installed application acceptance failed.' }
}
function Uninstall-OwnedApp {
  Assert-OwnedInstall
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw "Owned uninstaller is missing: $uninstaller" }
  # _?= suppresses the self-copy/relaunch, so completion really means uninstall finished.
  Run-Installer $uninstaller "/S /currentuser _?=$installDir"
  if (Test-Path -LiteralPath $installedExecutable) { throw 'Executable survived uninstall.' }
  foreach ($path in @($registryKeys) + @($shortcutPaths)) {
    if (Test-Path -LiteralPath $path) { throw "Uninstall left a registry entry or shortcut: $path" }
  }
}

Write-Output "[installer] Evidence and synthetic data: $releaseScratch"
try {
  Assert-OwnedInstall
  $installed = $true # Also cleanup a partial installation if one is registered.
  Run-Installer $previousPath "/S /currentuser --no-desktop-shortcut /D=$installDir"
  Assert-OwnedInstall
  if (-not (Test-Path -LiteralPath $uninstallKey)) { throw 'Installer was not registered for the current user.' }
  Test-InstalledApp
  Write-Output '[installer] PASS: initial per-user install and real application migration'

  # With PreviousInstaller this is a version upgrade; otherwise a same-version reinstall.
  Run-Installer $installerPath "/S /currentuser --no-desktop-shortcut /D=$installDir"
  Assert-OwnedInstall
  if ((Get-ItemProperty -LiteralPath $uninstallKey).DisplayVersion -ne $desktopPackage.version) { throw 'Installed version does not match the release.' }
  Test-InstalledApp -Reopen -CheckVersion
  $scenario = if ($PreviousInstaller) { 'version upgrade' } else { 'same-version reinstall' }
  Write-Output "[installer] PASS: $scenario preserves approvals, history, documents and encrypted credentials"

  $credential = Join-Path $acceptanceDir 'app-data/credentials/secret-OPENAI_API_KEY.cred'
  $database = Join-Path $acceptanceDir 'app-data/data/ax-studio.db'
  $credentialHash = (Get-FileHash -LiteralPath $credential).Hash
  $databaseHash = (Get-FileHash -LiteralPath $database).Hash
  Uninstall-OwnedApp
  $installed = $false
  if ((Get-FileHash -LiteralPath $credential).Hash -ne $credentialHash -or (Get-FileHash -LiteralPath $database).Hash -ne $databaseHash) {
    throw 'Uninstall modified user data.'
  }
  Write-Output '[installer] PASS: uninstall removes program/registration/shortcuts and retains user data byte-for-byte'

  $installed = $true
  Run-Installer $installerPath "/S /currentuser --no-desktop-shortcut /D=$installDir"
  Test-InstalledApp -Reopen -CheckVersion
  Uninstall-OwnedApp
  $installed = $false
  $passed = $true
  Write-Output '[installer] PASS: clean reinstall after uninstall reopens the retained data and OS credentials'
} finally {
  if ($script:installerTerminationUnconfirmed) { throw "Installer exit unconfirmed. Retained $releaseScratch and installer cache; inspect the process before cleanup." }
  if ($installed -and (Test-Path -LiteralPath $uninstaller)) { Uninstall-OwnedApp }
  # Only this run could have created this exact cache (absence checked before install).
  if (Test-Path -LiteralPath $installerCache) {
    $resolvedCache = (Resolve-Path -LiteralPath $installerCache).Path
    $expectedCache = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA '@ax-studiodesktop-updater'))
    if ($resolvedCache -ne $expectedCache -or (Get-Item -LiteralPath $resolvedCache).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) {
      throw 'Installer cache cleanup target is not the owned cache.'
    }
    Remove-Item -LiteralPath $resolvedCache -Recurse -Force
  }
  $removed = -not (Test-Path -LiteralPath $installKey) -and -not (Test-Path -LiteralPath $installedExecutable)
  Write-Output "[installer] Test installation removed=$removed; synthetic data/screenshots retained at $releaseScratch (passed=$passed)"
}
