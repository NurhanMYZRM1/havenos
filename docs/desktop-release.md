# Building, packaging and installing HavenOS (Windows & macOS)

## Requirements

- Node.js 22.12 or newer (developed with Node 26); npm 10+.
- `npm install`. The Electron binary downloads on first use. With npm 11's
  install-script allowlist it may be skipped; if so, run
  `node node_modules/electron/install.js` once.
- Building needs internet access once, to fetch the Electron runtime and the
  Fraunces/Inter fonts (the fonts are then bundled into the app).

## Everyday commands

| Command | What it does |
|---|---|
| `npm run desktop:dev` | Next.js dev server + Electron pointed at it (hot reload) |
| `npm run desktop:start` | Production build, then run it from source (`app://havenos`, no server) |
| `npm test` | Core tests (database, rent, overlaps, backup/restore, cloud client) — Node's test runner |
| `npm run test:cloud-functions` | Server-side entitlement / Stripe / cloud-function tests |
| `npm run test:e2e` | Builds, then drives the real Electron app with Playwright |
| `npm run typecheck` | TypeScript for the UI and for the desktop process |
| `npm run lint` | ESLint (Next.js rules: React, hooks, accessibility, TypeScript) |

Every push and pull request runs these checks, plus all three builds, on GitHub
(`.github/workflows/ci.yml`).

Tests use temporary data folders; they never touch your real data.
`HAVENOS_DATA_DIR=/some/folder` points any run at a different data folder.

## Packaging

| Command | Output (in `release/`) |
|---|---|
| `npm run desktop:package:mac` | `HavenOS-<v>-arm64.dmg`, `HavenOS-<v>.dmg` (Intel), `.zip` for each |
| `npm run desktop:package:win` | `HavenOS Setup <v>.exe` (x64 and arm64 NSIS installer) |
| `npm run desktop:package:mac:unsigned` | macOS build that skips signing (local testing) |

To include optional cloud backup, set `HAVENOS_CLOUD_URL` and
`HAVENOS_CLOUD_ANON_KEY` when packaging (see [cloud-backup.md](cloud-backup.md)).

The app bundle contains only the compiled main process, the preload script and
the static UI. There is no `node_modules` and no native modules, so Windows
installers can be built on a Mac.

### What has been built and checked

- **macOS arm64, unsigned:**
  - Built `release/HavenOS-0.2.0-arm64.dmg`; `hdiutil verify` passes.
  - Launched the packaged `HavenOS.app`. It served its UI from `app.asar`, loaded
    the bundled fonts, and kept a record across a restart. Its page has no
    access to `require` or `process`, and unknown IPC methods are rejected.
- **macOS x64:** configured but not built or run here.
- **Windows x64:** `HavenOS Setup 0.2.0.exe` was cross-built on macOS. It is a
  valid NSIS PE32 installer, but **unsigned**, and it was **not installed or
  run on Windows**. Please test it on a Windows 10/11 machine before release.
- **Windows arm64:** configured but not built here.

## Signing and notarisation (needs the owner's credentials)

Unsigned builds work but trigger security warnings:

- **macOS:** Gatekeeper blocks the first launch. Right-click → Open, or System
  Settings → Privacy & Security → Open Anyway.
- **Windows:** SmartScreen shows "Windows protected your PC". Click More info →
  Run anyway.

### macOS

1. Join the Apple Developer Program, then create a **Developer ID Application**
   certificate. Export it as `.p12`.
2. Provide the certificate to electron-builder: `CSC_LINK=<path or base64 of
   .p12>` and `CSC_KEY_PASSWORD=<password>`.
3. For notarisation, create an app-specific password and set
   `APPLE_ID=<apple id email>`, `APPLE_APP_SPECIFIC_PASSWORD=<password>` and
   `APPLE_TEAM_ID=<team id>`. Alternatively use an App Store Connect API key
   (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`).
4. Add `"notarize": true` under `build.mac` in `package.json`, then run
   `npm run desktop:package:mac`. Hardened runtime and entitlements
   ([desktop/build/entitlements.mac.plist](../desktop/build/entitlements.mac.plist))
   are already configured.

### Windows

- **Traditional certificate (OV/EV).** Buy a code-signing certificate from a
  CA. Current rules require the key to live in hardware or a cloud HSM. Either
  set `CSC_LINK`/`CSC_KEY_PASSWORD` (file-based certificates) or configure
  `build.win.signtoolOptions` for your HSM or token.
- **Or Azure Trusted Signing.** Configure `build.win.azureSignOptions`
  (publisher name, endpoint, certificate profile) and provide
  `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`.
- Sign on Windows or in CI for the most predictable results.

## Installing (for landlords)

- **macOS:** open the `.dmg` and drag **HavenOS** to Applications.
- **Windows:** run `HavenOS Setup <v>.exe`. It installs for the current user
  and you can choose the folder; no administrator rights are needed.

Records are kept in `~/Library/Application Support/HavenOS` (macOS) or
`%APPDATA%\HavenOS` (Windows). Installing a newer version keeps them; the app
copies the database before any schema upgrade. Uninstalling does not delete
records. Settings → Storage & backup shows the folder and makes a backup file.

## Not included yet

- Auto-update (for example `electron-updater` with a release feed). Install new
  versions manually for now.
- Linux packages.
