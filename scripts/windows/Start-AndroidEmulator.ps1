# Run in a separate terminal; keep it open while using the emulator.
[CmdletBinding()]
param(
    [string]$Avd = 'Cascade_API_36',
    [string]$DnsServers,
    [switch]$ColdBoot
)

$ErrorActionPreference = 'Stop'
if (-not $env:ANDROID_HOME) { throw 'Load Enter-DevelopmentEnvironment.ps1 first.' }
$emulator = Join-Path $env:ANDROID_HOME 'emulator\emulator.exe'
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $emulator -PathType Leaf)) { throw 'Android emulator executable was not found.' }
$available = @(& $emulator -list-avds)
if ($LASTEXITCODE -ne 0 -or $available -notcontains $Avd) { throw "AVD '$Avd' not found. Create it in Android Studio Device Manager." }
# Query only responsive emulators. An offline one must be closed before retrying.
foreach ($line in @(& $adb devices)) {
    if ($line -match '^(emulator-\d+)\s+device$') {
        $serial = $Matches[1]
        $runningName = @(& $adb -s $serial emu avd name)
        if ($runningName -contains $Avd) { throw "AVD '$Avd' is already running ($serial). Use it or close it first." }
    }
}
$arguments = @('-avd', $Avd)
if ($DnsServers) {
    foreach ($server in $DnsServers.Split(',')) {
        $parsed = $null
        if (-not [System.Net.IPAddress]::TryParse($server, [ref]$parsed) -or $parsed.AddressFamily -ne 'InterNetwork') {
            throw 'DnsServers must be a comma-separated list of IPv4 addresses.'
        }
    }
    $arguments += @('-dns-server', $DnsServers)
}
if ($ColdBoot) { $arguments += '-no-snapshot-load' }
& $emulator @arguments
if ($LASTEXITCODE -ne 0) { throw "Emulator exited with code $LASTEXITCODE. Inspect its output above." }
