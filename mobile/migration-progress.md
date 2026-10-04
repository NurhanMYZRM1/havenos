# HavenOS mobile — migration worklist

Strangler-fig migration of the desktop UI (`../app`, `../components`) to a
native Expo app. Every screen runs on day one as a DOM component; screens are
redesigned natively by value. Data never leaves the device: the desktop core
(`../desktop/core`) runs on the phone's JS thread on expo-sqlite.

## Architecture decisions

- **Backend:** none. `../desktop/core` (schema, migrations, validation,
  services, Airbnb iCal sync) runs unchanged on the phone through shims in
  `src/core/shims` (`node:sqlite` → expo-sqlite sync API, `node:fs` →
  expo-file-system sync API, `node:crypto` → expo-crypto + @noble/hashes).
  `src/core/host.ts` wires `createHandlers()` exactly as Electron's main does.
- **Bridge:** DOM screens get `window.havenos` (the Electron preload contract)
  from native action props (`src/dom/host.tsx`), so shared screens are unchanged.
- **Data on the phone is separate from the desktop's.** There is no sync between
  devices yet (the desktop has none either). Cloud backup is off on mobile.
- **Photos:** picked with expo-image-picker (camera or library, HEIC converted),
  resized to 2000 px JPEG + 400 px thumbnail before reaching the core.
- **Copy:** `src/i18n/en.ts` overlays the desktop catalogue ("this computer" →
  "this device").
- **Payments:** none in-app (cloud backup billing stays on desktop/web — no IAP question yet).

## Routes

| Web route | Native route | Bucket | State |
|---|---|---|---|
| `/dashboard` | `(tabs)/dashboard` | nativize-now | ✅ done — native |
| `/maintenance` | `(tabs)/maintenance` | nativize-now | ✅ done — native |
| More (new) | `(tabs)/more` | native | ✅ done — SwiftUI Form |
| `/rent` | `(tabs)/rent` | nativize-now | ✅ done — native |
| `/stays` | `(tabs)/stays` | nativize-now | ✅ done — native Today/Turnovers; Calendar + Performance are embedded DOM (hybrid) |
| `/tenants` | `tenants/index` | nativize-now | ✅ done — native |
| `/properties` | `properties/index` | nativize-now | ✅ done — native |
| `/maintenance/view` | `maintenance/view` | nativize-later | DOM shell |
| `/properties/view` | `properties/view` | nativize-later | DOM shell |
| `/tenants/view` | `tenants/view` | nativize-later | DOM shell |
| `/tenancies/view` | `tenancies/view` | nativize-later | DOM shell |
| `/stays/reservation` | `stays/reservation` | nativize-later | DOM shell |
| `/stays/turnover` | `stays/turnover` | nativize-later | DOM shell |
| `/settings` | `settings/index` | nativize-later | DOM shell |
| `/settings/channels` | `settings/channels` | port-as-is | DOM shell |
| `/onboarding` | `onboarding` (modal) | port-as-is | DOM shell |
| `/tenancies/new` | `tenancies/new` (modal) | port-as-is | DOM shell |
| `/receipt` | `receipt` (modal) | hybrid | DOM + native PDF/share (expo-print) |
| Record payment dialog | `rent/record` (modal) | hybrid | DOM dialog in native sheet |
| New maintenance dialog | `maintenance/new` (modal) | hybrid | DOM dialog in native sheet |
| Add tenant dialog | `tenants/new` (modal) | hybrid | DOM dialog in native sheet |
| `/t/[domain]` (web only) | — | stays web | not ported |

## nativize-now (goal loop works top-down)

- [x] Dashboard — done
- [x] Maintenance list — done
- [x] Rent month — done
- [x] Stays — done (Today and Turnovers native; Calendar and Performance embedded DOM)
- [x] Tenants — done
- [x] Properties list — done

Shared fix: `components/ui/dialog.tsx` now portals dialogs to `<body>`, so a
confirm opened inside another dialog's form is no longer a nested `<form>`.

## Blocked / needs work outside a screen

- File backup & restore — the desktop writes a tar.gz with Node streams
  (`../desktop/core/backup`). Needs a mobile archive writer (or zip via a
  native module) before "Back up now" works; the button currently does nothing
  on mobile. Export of a single CSV works (share sheet).
- "Export everything to a folder" — no folders on iOS; needs a zip.
- Cloud backup — disabled on mobile (config: null) until the desktop service ships.
- Android — not built locally (no Android SDK on this Mac); use `eas build -p android`.

## Verified (2026-10-04, iPhone 17 Pro simulator, iOS 26.5)

- Every route visited with the sample workspace: data shown, no Metro ERROR/WARN.
- Write path: Record payment from a tenancy → saved (R-00005), the tenancy and
  the native Rent tab both refreshed.
- `npm run typecheck`, `expo export --platform ios` (native + all DOM bundles).
- Root repo unaffected: typecheck, lint (0 errors), 174/174 desktop tests.

`npm run ios` (Expo Go, SDK 57) · sample data: More → Use sample workspace.
