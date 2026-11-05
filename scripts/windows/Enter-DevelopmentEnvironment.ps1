# Dot-source from PowerShell 5.1 or later. Changes affect this process only.
[CmdletBinding()]
param(
    [string]$SdkDirectory,
    [string]$NodeDirectory,
    [string]$PnpmDirectory,
    [string]$AvdDirectory
)

& {
    param($SdkPath, $NodePath, $PnpmPath, $AvdPath)
    $ErrorActionPreference = 'Stop'
    $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    if (-not $SdkPath) {
        $SdkPath = $env:ANDROID_HOME
        if (-not $SdkPath) { $SdkPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
    }
    $SdkPath = (Resolve-Path -LiteralPath $SdkPath).Path
    foreach ($relativePath in @('platform-tools\adb.exe', 'emulator\emulator.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $SdkPath $relativePath) -PathType Leaf)) {
            throw "Missing Android SDK tool: $relativePath. See docs/development/windows-android.md."
        }
    }
    $paths = @()
    foreach ($directory in @($NodePath, $PnpmPath)) {
        if ($directory) { $paths += (Resolve-Path -LiteralPath $directory).Path }
    }
    $paths += Join-Path $SdkPath 'platform-tools'
    $paths += Join-Path $SdkPath 'emulator'
    $commandLineTools = Join-Path $SdkPath 'cmdline-tools\latest\bin'
    if (Test-Path -LiteralPath $commandLineTools -PathType Container) { $paths += $commandLineTools }
    if ($AvdPath) { $AvdPath = (Resolve-Path -LiteralPath $AvdPath).Path }

    $env:PATH = ($paths -join ';') + ';' + $env:PATH
    $env:ANDROID_HOME = $SdkPath
    if ($AvdPath) { $env:ANDROID_AVD_HOME = $AvdPath }
    Set-Location -LiteralPath $root
    $expectedNode = (Get-Content -LiteralPath (Join-Path $root '.nvmrc') -Raw).Trim().TrimStart('v')
    $expectedPnpm = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).packageManager.Split('@')[1]
    $actualNode = (& node --version).Trim().TrimStart('v')
    if ($LASTEXITCODE -ne 0 -or $actualNode -ne $expectedNode) {
        throw "Select Node $expectedNode, then reload this helper. Found: $actualNode."
    }
    $pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if (-not $pnpmCommand) { $pnpmCommand = Get-Command pnpm.exe -ErrorAction SilentlyContinue }
    if (-not $pnpmCommand) { throw 'pnpm.cmd or pnpm.exe was not found. Select the pinned pnpm installation first.' }
    $actualPnpm = (& $pnpmCommand.Source --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualPnpm -ne $expectedPnpm) {
        throw "Select pnpm $expectedPnpm, then reload this helper. Found: $actualPnpm."
    }
    Write-Host "Repository: $root"
    Write-Host "Node $actualNode; pnpm $actualPnpm; Android SDK: $SdkPath"
    Write-Host 'Environment loaded for this PowerShell window only.'
} $SdkDirectory $NodeDirectory $PnpmDirectory $AvdDirectory
