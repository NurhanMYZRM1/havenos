# Shipping HavenOS to the App Store & Play Store

> **Status (desktop release):** HavenOS now ships first as a Windows/macOS desktop app that stores records locally (see [desktop-architecture.md](desktop-architecture.md)). The Capacitor shell below still builds but is **deferred** — it has not been updated for local storage, and no mobile submission work was done in this release.

The web app and the mobile app are **one codebase, two build targets**:

| Target | Command | Output | Runtime |
|---|---|---|---|
| Web (Vercel) | `npm run build` | `.next/` | SSR + middleware + tenant custom domains |
| Mobile (Capacitor) | `npm run build:mobile` | `out/` | Static bundle in a native shell, Supabase over HTTPS under RLS |

Routes named `page.web.tsx` exist **only** in the web build — that is how the
dynamic tenant-domain route stays out of the static export.

---

## ⚠️ Read this first: App Store Guideline 4.2

Apple rejects apps that are "a repackaged website" under
[Guideline 4.2 — Minimum Functionality](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality).
A webview pointing at your site **will** get rejected. This is the single most
common rejection reason for Capacitor/Cordova apps.

HavenOS ships native capabilities so the app does things the website cannot.
All of them live in [`lib/native.ts`](../lib/native.ts) and degrade gracefully on web:

| Capability | Plugin | Where it is used | Why it satisfies 4.2 |
|---|---|---|---|
| Camera capture | `@capacitor/camera` | Photo evidence on work orders | Hardware access, core to the field workflow |
| Push notifications | `@capacitor/push-notifications` | Critical work orders page on-call staff | Background delivery a web page cannot do |
| Haptics | `@capacitor/haptics` | Confirmation on status changes | Native-only feedback |
| Offline cache | `@capacitor/preferences` | Portfolio readable in basements/lifts | Works with no connectivity |
| Network awareness | `@capacitor/network` | Offline banner | OS-level connectivity events |
| Biometric app lock | `@capgo/capacitor-native-biometric` | Face ID / Touch ID / fingerprint curtain over the console | Secure-enclave hardware a browser cannot reach |

**Strengthen the case before you submit** — the more of these you finish, the
safer the review:

- Add **background geolocation check-in** for maintenance staff arriving on site.
- Make push **actually deliver** (see below) rather than just registering.

In App Review notes, state plainly which native features to test and how to
reach them. Reviewers who cannot find native behavior assume there is none.

---

## One-time setup

### Prerequisites (neither is installed on this machine yet)

```bash
# iOS — full Xcode, not just Command Line Tools
xcode-select --install
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo gem install cocoapods
```

```bash
# Android — JDK 21 + Android Studio
brew install --cask temurin android-studio
```

### Generate icons and splash screens

Source art lives in [`assets/`](../assets); `scripts/gen-icons.mjs` rasterizes
the PWA set and the 1024px sources.

```bash
npm i -D sharp && node scripts/gen-icons.mjs
```

Then expand into every native size (run after adding platforms):

```bash
npx @capacitor/assets generate --iconBackgroundColor "#09090b" --splashBackgroundColor "#09090b"
```

### Add the native platforms

```bash
npm run build:mobile && npx cap add ios && npx cap add android
```

Commit `ios/` and `android/` — they hold signing config and native tweaks.

---

## The build loop

```bash
npm run cap:ios       # build:mobile + cap sync + open Xcode
```

```bash
npm run cap:android   # build:mobile + cap sync + open Android Studio
```

`cap sync` copies `out/` into both native projects and installs plugin
dependencies. **Re-run it after every web change** — the native app serves a
snapshot, not your dev server.

---

## Push notifications (required for the 4.2 case)

1. **iOS** — create an APNs key in the Apple Developer portal, enable *Push
   Notifications* + *Background Modes → Remote notifications* in Xcode's
   Signing & Capabilities.
2. **Android** — create a Firebase project, download `google-services.json` into
   `android/app/`.
3. Store the device token from `registerPush()` against the operator's row, and
   fan out from a Supabase Edge Function when a `work_orders` row goes
   `priority = 'critical'`.

---

## Biometric app lock

Implemented in [`components/shell/biometric-lock.tsx`](../components/shell/biometric-lock.tsx),
wrapping `{children}` in [`app/layout.tsx`](../app/layout.tsx), on top of
`requireBiometricUnlock()` / `checkBiometrics()` in [`lib/native.ts`](../lib/native.ts).

**Behavior**

- Locks on cold launch and again whenever the app returns from more than
  **30 seconds** in the background (`@capacitor/app`'s `appStateChange`).
  The grace window exists because opening the camera on a work order — and, on
  iOS, the Face ID sheet itself — resigns the app's active state; without it
  every photo capture would bounce the operator back to the lock screen.
- **The web build is never gated.** `isNative()` is false on Vercel, so the
  curtain never arms and no plugin is imported.
- The prompt allows the device passcode as a fallback (`useFallback: true`), so
  an operator who has not enrolled Face ID still gets a lock rather than a bypass.

**It always falls open rather than trapping anyone.** This lock sits over an
already-authenticated Supabase session — RLS is the real security boundary, and
a curtain nobody can lift is a support call, not a safeguard. So:

| Situation | Result |
|---|---|
| No sensor, nothing enrolled, no passcode | Never locks at all |
| Enrollment removed while backgrounded | Falls open on the next attempt |
| Cancelled, failed match, or lockout | Curtain holds, with a retry **and** a "Continue without unlocking" escape |

**Setup** — iOS needs `NSFaceIDUsageDescription` in `Info.plist` (see below);
Android needs nothing beyond `cap sync`, which adds the `USE_BIOMETRIC`
permission from the plugin's manifest.

**Point reviewers at it.** Backgrounding the app and reopening it is a native
behavior they can verify in ten seconds without a device-specific setup, which
makes it the single most useful thing to name in the App Review notes.

---

## App Store (iOS) submission

1. **App ID** — `co.havenos.operations` (matches `capacitor.config.ts`).
2. In Xcode: set your Team, bump *Version* and *Build*.
3. **Privacy strings** are mandatory — a missing one is an automatic rejection.
   Add to `ios/App/App/Info.plist`:

   ```xml
   <key>NSCameraUsageDescription</key>
   <string>HavenOS uses the camera to attach photos to maintenance work orders.</string>
   <key>NSPhotoLibraryAddUsageDescription</key>
   <string>HavenOS saves work-order photos to your library.</string>
   <key>NSPhotoLibraryUsageDescription</key>
   <string>HavenOS attaches existing photos to maintenance work orders.</string>
   <key>NSFaceIDUsageDescription</key>
   <string>HavenOS uses Face ID to unlock the operations console after it has been in the background.</string>
   ```

   `NSFaceIDUsageDescription` is **required** by the biometric app lock. Without
   it iOS kills the app the first time `verifyIdentity()` runs on a Face ID
   device — a crash reviewers will hit immediately, since backgrounding and
   reopening the app is the first thing they try.

4. **Privacy Nutrition Label** in App Store Connect — declare Photos, plus any
   account/contact data Supabase stores.
5. **Demo account** — reviewers cannot sign up for a B2B operator tool. Supply a
   working email/password in App Review notes or you will be rejected on
   Guideline 2.1.
6. `Product → Archive` → *Distribute App* → App Store Connect.
7. **Encryption**: the app uses only standard HTTPS, so set
   `ITSAppUsesNonExemptEncryption = false` in `Info.plist` to skip the export
   compliance questionnaire on every upload.

## Play Store (Android) submission

1. Generate an upload key and set it in `android/app/build.gradle`:

   ```bash
   keytool -genkey -v -keystore haven-upload.keystore -alias haven -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Build an **App Bundle** (`.aab`) — Play requires AAB, not APK:
   *Build → Generate Signed Bundle / APK → Android App Bundle*.
3. **Data safety form** — declare photo capture and any account data.
4. Target the current API level (Play enforces a rolling minimum; Capacitor 8
   defaults are current).
5. Upload to internal testing first, then promote to production.

---

## Alternative: Play Store without a native shell

Android (unlike iOS) accepts a **Trusted Web Activity** — your PWA wrapped
automatically, no Capacitor:

```bash
npx @bubblewrap/cli init --manifest https://app.havenos.co/manifest.webmanifest
```

This is a legitimate shortcut **for Play only**. iOS still needs the Capacitor
build, so the native path above remains the primary route.

---

## Mobile UX rules this codebase follows

Worth preserving as the app grows:

- **No hover-only affordances.** Hover flourishes are wrapped in
  `@media (hover: hover)`; touch gets `:active` states. The work-order actions
  were originally hover-reveal and were completely unreachable on a phone.
- **44×44pt minimum touch targets** (Apple HIG) via the `.touch-target`
  utility, which pads the hit area without inflating the visual mark.
- **Safe-area insets** on every fixed element — `--safe-top` / `--safe-bottom`,
  with `viewportFit: "cover"` in the layout viewport.
- **Never disable pinch-zoom.** `initialScale: 1` with no `maximumScale`.
- **Bottom navigation on mobile**, top nav on desktop — primary destinations
  belong in thumb reach.
- **Tooltips do not exist on touch.** Bed details open a bottom sheet instead of
  a `title` attribute.
- `prefers-reduced-motion` is honored globally and by the count-up animation.
- **Nothing gates the web build.** Native-only chrome (biometric lock, status
  bar, splash) is behind `isNative()`, so the Vercel bundle never ships it.
