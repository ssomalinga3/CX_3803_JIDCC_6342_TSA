# Windows: Android development client, Metro and local GIS API

Run the native Android app in an Android Emulator, compile its development client
on EAS, and run Metro and the Worker locally. MapLibre requires this development
client; Expo Go cannot load it. Windows cannot run Apple's iOS Simulator. Keep
the existing [macOS/iOS workflow](../../mobile/README.md) and shared Expo/EAS
configuration for teammates using iOS.

## 1. Install and check prerequisites

Use Windows PowerShell 5.1 or later. Installation, administrator actions and any
required restart are separate manual steps; the repository helpers install
nothing and do not change persistent environment variables or execution policy.

| Tool                  | Setup and check                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Git                   | Install [Git for Windows](https://git-scm.com/downloads/win); `git --version`.                                                                                                                                                                                                                                                                                                                                                                   |
| Node and pnpm         | Select the exact Node version in [`.nvmrc`](../../.nvmrc) and pnpm version in root [`package.json`](../../package.json). At this guide's verification: Node 24.21.0 and pnpm 10.26.2. Use a Windows version manager or the matching [Node distribution](https://nodejs.org/dist/) and [pnpm installation instructions](https://pnpm.io/installation). `node --version`; `pnpm --version`. The macOS `nvm.sh` commands do not work in PowerShell. |
| Android Studio        | Install [Android Studio](https://developer.android.com/studio). Complete its setup wizard. Its bundled JDK is sufficient for SDK tools; a separate JDK/local Gradle installation is not required for EAS cloud compilation. `java -version` may need Studio's `jbr\bin` on this terminal's PATH.                                                                                                                                                 |
| Android SDK           | In Studio's SDK Manager, install Android SDK Platform-Tools, Android Emulator, Command-line Tools (latest), Android 36 platform, and a Google APIs API 36 system image matching the host architecture. The verified machine used x86_64. Accept SDK licenses. Record the SDK location; the usual Windows location is `$env:LOCALAPPDATA\Android\Sdk`.                                                                                            |
| Virtualization        | Enable firmware virtualization. Check Task Manager → Performance → CPU and the emulator's `emulator -accel-check`. If the check requests Windows Hypervisor Platform, enable that Windows feature with administrator approval, then restart when convenient. Do not disable Hyper-V used by WSL2/Docker to install a competing hypervisor.                                                                                                       |
| Docker Desktop / WSL2 | Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) with its WSL2 engine and follow its host requirements. Check `wsl --status`, `wsl --list --verbose`, and `docker version`. Docker must show a **Server** section; the client alone is insufficient. No Docker sign-in is needed for this local public image.                                                                                |
| Python 3              | Needed for source-map conversion/fidelity tests, not normal Worker startup. Check `python3 --version`; ensure that command resolves to a real Python installation when running the backend suite.                                                                                                                                                                                                                                                |

Create a phone AVD in Studio's Device Manager named `Cascade_API_36`, using the
API 36 Google APIs image. The name is a local convention, not an Expo identifier.
Keep its data when troubleshooting; cold booting does not wipe it.

## 2. Checkout and load this terminal's environment

For a new checkout, choose your own project directory:

```powershell
git clone https://github.com/ssomalinga3/CX_3803_JIDCC_6342_TSA.git
cd CX_3803_JIDCC_6342_TSA
git status --short --branch
Get-Content AGENTS.md
```

In an existing checkout, inspect status before switching branches or updating.
Preserve uncommitted work; fetch first and use `git pull --ff-only` only on a
clean, appropriate branch. Do not reset, force-push or delete teammates' work.

From the repository root, load the helper in **each new PowerShell window**:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
. .\scripts\windows\Enter-DevelopmentEnvironment.ps1
```

The policy change lasts for that process. Organizational policy may prohibit it;
follow that policy rather than changing machine-wide settings. The helper adds
SDK tools to this terminal's PATH and verifies the repository's Node/pnpm pins.
It does not install those tools. For portable tools or a custom SDK/AVD directory:

```powershell
. .\scripts\windows\Enter-DevelopmentEnvironment.ps1 `
  -SdkDirectory 'D:\DevTools\android-sdk' `
  -NodeDirectory 'D:\DevTools\node-v24.21.0-win-x64' `
  -PnpmDirectory 'D:\DevTools\bin' `
  -AvdDirectory 'D:\DevTools\android-user\avd'
```

Replace those example directories with your existing paths. `PnpmDirectory`
contains `pnpm.cmd` or `pnpm.exe`; `AvdDirectory` contains the AVD's `.ini` and `.avd` entries.
Otherwise the helper preserves existing AVD settings. Keep SDKs, emulators,
package stores, caches and portable installations outside the checkout.

```powershell
pnpm install --frozen-lockfile
adb version
emulator -list-avds
emulator -accel-check
docker version
```

Install once at the workspace root and retain the root lockfile. If a restricted
Codex sandbox specifically rejects pnpm symlink creation with `EPERM`, prefer
running installation in normal PowerShell. A local fallback verified in that
sandbox was `pnpm install --frozen-lockfile --node-linker=hoisted`; this is not the
team default. Do not commit a linker override or regenerate the lockfile to fix
a machine-specific permission error.

## 3. Obtain the Android development build

Use a terminal that is free for commands, not a running Metro/Worker/emulator:

```powershell
pnpm --dir mobile exec eas login
pnpm --dir mobile exec eas whoami
pnpm --dir mobile exec eas build --platform android --profile development --no-wait
```

The account needs access to `cx3803jidcc6342tsa`. The app is already linked to
`@cx3803jidcc6342tsa/cascade-springs`, project ID
`bca3cac0-3a82-45b8-9df3-3ad9186796ef`. Android package and iOS bundle identifier
are `com.cx3803team6342.cascadesprings`. Preserve these values and the current
`development`, `preview` and `production` profiles. Do not run project relinking
or build-configuration initialization to solve login problems.

Save the returned build link. The cloud build continues when the laptop sleeps;
local Metro/Worker/emulator do not. Wait for EAS to show success before installing.
With the emulator running, install the exact completed build:

```powershell
pnpm --dir mobile exec eas build:run --platform android --id <build-id>
```

Replace `<build-id>` with the UUID from your build URL. Alternatively use
`--profile development --latest` instead of `--id`, after checking that the latest
build matches this checkout. Do not trigger a new build for ordinary JS/TS edits.
Rebuild after native dependency/plugin/configuration changes.

## 4. Keep three local terminals running

Start Docker Desktop and wait for its engine. Use separate PowerShell windows
or tabs for the emulator, Worker, and Metro. Load the environment helper in each.
Use another free terminal for checks. Do not type commands into an active server
unless they are that server's keyboard shortcuts.

### Terminal A: emulator

```powershell
.\scripts\windows\Start-AndroidEmulator.ps1
```

Use the already-running AVD if one exists. In a free terminal, check:

```powershell
adb devices
adb -s emulator-5554 shell getprop sys.boot_completed
```

Use the actual serial from `adb devices`. Expected: `device` and boot result `1`.
An initial black screen or `offline` can mean it is still booting. Wait for Home;
if needed run `adb reconnect offline` once and recheck. Do not launch a second
copy of the same AVD. Keep this terminal open; closing it can stop the emulator.

### Terminal B: PostGIS and Worker

This runbook uses an isolated Compose project and port 55434; the repository
default remains 55432. Use these same overrides in every backend terminal,
including tests and shutdown, so commands use the same database and volume.

```powershell
$env:COMPOSE_PROJECT_NAME = 'cascade-springs-local'
$env:CASCADE_DB_PORT = '55434'
pnpm backend:setup
pnpm --dir backend db:seed
pnpm --dir backend db:import:source
pnpm --dir backend dev --ip 127.0.0.1 --port 8787
```

`backend:setup` generates Worker types, starts PostGIS, applies migrations and
checks the database. Seeding/import are repeatable. The seed is synthetic demo
data; sourced map geometry and approximate boundaries retain their provenance
warnings and are not approved safety data. No GPS policy is established by setup.
No `.env` is required for these local defaults. An existing `DATABASE_URL` or
Hyperdrive connection override takes precedence: inspect your own configuration
before using it and do not paste credentials into shared logs.

Wait for `Ready on http://127.0.0.1:8787`. This is the backend Worker, not Metro.
From the free terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod http://127.0.0.1:8787/ready
(Invoke-RestMethod http://127.0.0.1:8787/api/v1/layers).layers |
  Select-Object layerId, isDemo
```

Readiness should return `status: ok` and `database: ok`. The catalog should include
the demo and sourced layers after both imports. This establishes local backend
health; emulator connectivity still needs the mobile check below.

### Terminal C: Metro

```powershell
$env:EXPO_PUBLIC_API_URL = 'http://10.0.2.2:8787/api/v1'
pnpm mobile
```

Wait for the QR code and `Using development build`, then press **a** in this
terminal to open Android. The first JS bundle can take several minutes. Metro
normally uses 8081. Its printed `exp+cascade-springs://...` link opens the installed
development client; the development-client launcher by itself is not the app UI.

`10.0.2.2` is the Android Emulator's alias for the Windows host loopback. Android's
own `localhost` points at the emulator. Keep the Worker on loopback for this
workflow. Physical Android devices require a different reachable address and
network setup; these commands do not verify that path. The API URL is public
bundle configuration, never a place for secrets. iOS teammates should keep their
own local API address rather than committing the Android address.

After changing `EXPO_PUBLIC_API_URL`, stop Metro with Ctrl+C, set it in the same
window, and restart. Use `pnpm mobile --clear` if a stale value persists.

## 5. Verify the app and diagnose connectivity

Verify each part separately:

1. The installed native client opens and Metro reports `Android Bundled`.
2. Basemap tiles/labels load; pan and use zoom/return controls.
3. The GIS catalog and geometry load, including the demo warning and sourced
   layers when imported. This checks emulator → Worker → PostGIS connectivity.
4. Open Explore and return, reload with `r` in Metro, then close/reopen the app.
   Record which interactions you actually checked.

`MapLibre ... Unable to resolve host tiles.openfreemap.org` is emulator DNS for
the public basemap. A working API does not fix it. Check Windows separately:

```powershell
Resolve-DnsName tiles.openfreemap.org
```

If Windows resolves it but Android does not, close the existing emulator normally,
wait for it to exit, then relaunch with an explicit DNS override and cold boot:

```powershell
.\scripts\windows\Start-AndroidEmulator.ps1 -DnsServers '8.8.8.8,1.1.1.1' -ColdBoot
```

Use DNS servers permitted/reachable on your network; public DNS can be blocked
on campus/VPN networks. This changes only that emulator launch. Do not wipe the
AVD, hardcode tile-provider IPs, or change global DNS. Check the app's Retry and
the emulator browser's access to the tile host. If a stale AVD process remains,
close only that AVD; do not kill all Java, Node or emulator processes by name.

Other common failures:

- **`pnpm` / `adb` not recognized:** reload the helper in this window with the
  correct tool directories. Another window's process PATH does not carry over.
- **Missing `.android` directory error:** create only the named missing Android
  user directory if needed: `New-Item -ItemType Directory -Force -Path
(Join-Path $env:USERPROFILE '.android')`. Do not delete an existing directory.
- **Docker pipe missing:** Docker's engine is not ready. Wait until `docker version`
  includes Server; then run setup again. Do not start unrelated existing images.
- **GIS API not configured:** restart Metro with the API URL above. Basemap loading
  alone does not establish backend connectivity.
- **API request fails:** check `/ready` on Windows, the API URL/port, emulator
  connectivity and Android logs. Cleartext HTTP/network-security behavior must be
  checked against the installed build; do not add broad permissions or globally
  relax Android network security as a troubleshooting shortcut.
- **Metro unreachable:** check the address Metro printed, Wi-Fi/VPN/firewall
  restrictions and that the intended checkout's server is still running. Do not
  disable the firewall. An emulator-only alternative is `adb reverse tcp:8081
tcp:8081`, then enter `http://127.0.0.1:8081` in the development client's server
  field. This alternative was not part of the recorded smoke test.

Internet access is needed for basemap tiles and EAS. Browsing works with location
off. The existing `expo-location` plugin configures foreground location; Android
background location and foreground service, and iOS background location, are
explicitly disabled. Preserve those settings. Runtime location consent and denial
need separate device checks; this setup does not grant permission. New native
permissions for background GPS, storage or notifications require review and a new
build. Offline behavior is not established by the online smoke test.

## 6. Checks, daily use and shutdown

Use a free terminal with the same backend port/project overrides:

```powershell
pnpm verify
$env:GIS_SOURCE_MAP = '1'
pnpm --dir backend test:integration
pnpm backend:check
pnpm --dir backend test:fresh
```

`test:fresh` creates and drops a uniquely named disposable database on the local
server, repeats migrations/seeds/imports, and runs integration/Worker checks.
Worker checks use ports 18787/18788; run them sequentially with no other checks
on those ports. The Windows CI job covers command/process portability and Worker
failure handling; existing Linux CI retains full PostGIS integration. CI and JS
bundle exports do not replace Android or iOS native smoke tests.

On later days: load the helper, start Docker, start the emulator, rerun backend
setup for new migrations, start the Worker, then start Metro with the API URL.
Keep existing data. Use Ctrl+C in Metro and Worker terminals, and close the
emulator normally. Docker data persists. To stop this project's database without
deleting its volume, in a free terminal with the same overrides:

```powershell
pnpm --dir backend db:down
```

Do not add `-v`. Commit portable scripts, docs and intentional source changes;
exclude SDK/AVD files, local environment files, caches, credentials, downloaded
APKs and generated `android/` / `ios/` projects.

## Verification record and limits

On November 4, 2026, Windows PowerShell 5.1, Node 24.21.0, pnpm 10.26.2, the
API 36 x86_64 emulator, Docker Desktop/WSL2 and loopback PostGIS were used for
this workflow. [EAS build ec347c51](https://expo.dev/accounts/cx3803jidcc6342tsa/projects/cascade-springs/builds/ec347c51-7934-48b5-af04-baafe07bf03d)
compiled the native client. Its installation, Metro connection, native MapLibre
tiles/labels, API-backed GIS geometry and sourced/demo data were verified. An
earlier basemap DNS failure was resolved with the emulator launch DNS override.
That build predates these tooling/docs changes; no new native dependencies or
Expo/EAS identifiers are introduced here.

This is evidence for that machine/build, not a clean-install test of every host.
The portable helpers passed PowerShell 5.1 parsing, environment loading with the
custom tool/SDK/AVD directories, and the missing-AVD guard. Launching a new AVD
through the wrapper was not repeated while the existing emulator was in use.
In the Codex sandbox, `taskkill` rejects child-tree termination and Docker pipe access is
restricted; normal PowerShell and Windows CI must verify those command paths.
One existing mobile layout test timed out at its default 5-second limit in that
sandbox and passed when run diagnostically with 30 seconds; this guide does not
change that timeout or claim a full mobile test pass. Android physical devices,
GPS consent, offline operation and a fresh iOS regression run remain untested.
The existing [iOS verification record](../../mobile/README.md#verified-simulator-baseline)
remains separate.
