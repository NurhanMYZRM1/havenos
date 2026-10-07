# HavenOS mobile

Expo (SDK 57) app that reuses the desktop/web code from the repository root (`../app`,
`../components`, `../lib`, `../desktop/core`). See `AGENTS.md` for the day-to-day commands and
`migration-progress.md` for the migration status.

## Build & release

Builds and over-the-air (OTA) updates run on EAS under the Expo account
[`squadralennox`](https://expo.dev/accounts/squadralennox) (`expo.owner` in `app.json`).
Run all `eas` commands from this `mobile/` folder.

> **TODO before the first build: link the EAS project.** `extra.eas.projectId` and
> `updates.url` are intentionally not in `app.json` yet; they need the project ID, which only
> exists after the project is created on expo.dev. Do the one-time setup below and commit
> the resulting `app.json` change.

### One-time setup

```bash
npx eas-cli@latest login            # your Expo account (squadralennox)
npx eas-cli@latest init --force     # creates/links the project, writes extra.eas.projectId
npx eas-cli@latest update:configure # writes updates.url (needs the project ID from the step above)
git diff app.json                   # expect extra.eas.projectId + updates.url; commit them
```

### Everyday commands

```bash
npx eas-cli@latest build --profile development --platform ios   # dev client (internal)
npx eas-cli@latest build --profile preview --platform ios       # internal test build
npx eas-cli@latest build --profile production --platform ios    # store build, build number auto-increments
npx eas-cli@latest update --channel preview --message "what changed"
```

Internal-distribution iOS builds (`development`, `preview`) install on registered devices only:
run `npx eas-cli@latest device:create` once per device, then build.

### Profiles and channels

| Build profile | Distribution | Channel | Notes |
|---|---|---|---|
| `development` | internal | `development` | `developmentClient: true` |
| `preview` | internal | `preview` | |
| `production` | store | `production` | `autoIncrement: true` |

`cli.appVersionSource` is `remote`: EAS owns the build number (and bumps it on `production`),
so do not edit it by hand. `version` in `app.json` is still the marketing version.

### OTA updates and native code

`runtimeVersion` uses the `fingerprint` policy. EAS hashes everything that makes up the native
binary (native modules, config plugins, `app.json` native settings, and `eas.json`); an update
is only delivered to builds with the same hash, so a JS-only update can never reach a binary
with different native code. To see the current hash: `npx fingerprint fingerprint:generate .`.

If you add or upgrade a native dependency, change a config plugin or native settings in
`app.json`, or edit `eas.json`, ship a new build (`eas build`) rather than only `eas update`.
Updates published for the old hash simply do not reach the new binary.

### Why the repo root matters (monorepo)

The app imports code from the repository root (`../app`, `../components`, `../lib`,
`../desktop/core`). EAS CLI archives the **whole git repository** (it clones the repo root, then
runs the build in the folder it was started from, here `mobile/`), not just `mobile/`. So no
special layout is needed: keep `eas.json` in `mobile/`, run `eas` from `mobile/`, and keep the
files the build needs **committed** (git-ignored files are not uploaded). The repo root is not
an npm workspace; the lockfile that applies is `mobile/package-lock.json`.

### Android

`eas.json` has no Android-specific settings and no Android build has been tested; the
commands above are iOS-only.

### CI (optional)

To build or update from CI instead of a laptop, create an Expo access token at
https://expo.dev/accounts/squadralennox/settings/access-tokens and store it as the
`EXPO_TOKEN` secret in the CI system. Never commit the token. EAS CLI reads `EXPO_TOKEN`
automatically.
