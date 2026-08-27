"use client";

/**
 * Capacitor capability layer.
 *
 * Every export is safe to call on the web: plugins are imported lazily and
 * only when running inside the native shell, so the Vercel bundle never pulls
 * native code and nothing throws in a browser.
 *
 * These are the capabilities that make the store build a real app rather than
 * a wrapped website (App Store Guideline 4.2) — see docs/mobile-deployment.md.
 */

// Type-only — erased at compile time, so the lazy runtime imports below stay
// the sole reason a native plugin ever enters a bundle.
import type { BiometryType as Biometry } from "@capgo/capacitor-native-biometric";

type Platform = "ios" | "android" | "web";

let cachedPlatform: Platform | null = null;

export function getPlatform(): Platform {
  if (cachedPlatform) return cachedPlatform;
  if (typeof window === "undefined") return "web";
  const cap = (window as unknown as { Capacitor?: { getPlatform(): Platform } }).Capacitor;
  cachedPlatform = cap?.getPlatform() ?? "web";
  return cachedPlatform;
}

export const isNative = () => getPlatform() !== "web";

/** Coarse-pointer check — drives touch-first affordances on mobile web too. */
export function isTouchPrimary(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

// ── Haptics ────────────────────────────────────────────────────────────────
// Confirmation feedback for state changes (advancing a work order, etc.).

export async function tap(style: "light" | "medium" | "heavy" = "light") {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    await Haptics.impact({ style: map[style] });
  } catch {
    /* plugin unavailable — silent */
  }
}

export async function notifyHaptic(type: "success" | "warning" | "error" = "success") {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    const map = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    };
    await Haptics.notification({ type: map[type] });
  } catch {
    /* noop */
  }
}

// ── Camera ─────────────────────────────────────────────────────────────────
// Photo evidence on work orders. Falls back to an <input type=file capture>
// on the web so the same call site works everywhere.

export interface CapturedPhoto {
  dataUrl: string;
  source: "camera" | "file";
}

export async function capturePhoto(): Promise<CapturedPhoto | null> {
  if (isNative()) {
    try {
      const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
      const photo = await Camera.getPhoto({
        quality: 72,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt,
        width: 1600,
        correctOrientation: true,
      });
      return photo.dataUrl ? { dataUrl: photo.dataUrl, source: "camera" } : null;
    } catch {
      return null; // user cancelled or denied
    }
  }

  // Web fallback: on mobile browsers `capture` opens the camera directly.
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: String(reader.result), source: "file" });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// ── Push notifications ─────────────────────────────────────────────────────
// Critical work orders page the on-call operator.

export async function registerPush(
  onToken: (token: string) => void,
): Promise<"granted" | "denied" | "unavailable"> {
  if (!isNative()) return "unavailable";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt") perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return "denied";

    await PushNotifications.addListener("registration", (t) => onToken(t.value));
    await PushNotifications.register();
    return "granted";
  } catch {
    return "unavailable";
  }
}

// ── Offline cache ──────────────────────────────────────────────────────────
// Last-known portfolio state, so opening the app on a basement site visit
// shows data instead of a spinner.

export async function cacheSet(key: string, value: unknown) {
  const payload = JSON.stringify({ at: Date.now(), value });
  if (isNative()) {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key, value: payload });
      return;
    } catch {
      /* fall through to localStorage */
    }
  }
  try {
    localStorage.setItem(key, payload);
  } catch {
    /* private mode / quota */
  }
}

export async function cacheGet<T>(key: string): Promise<{ at: number; value: T } | null> {
  let raw: string | null = null;
  if (isNative()) {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      raw = (await Preferences.get({ key })).value;
    } catch {
      /* fall through */
    }
  }
  if (raw === null) {
    try {
      raw = localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Shell chrome ───────────────────────────────────────────────────────────

export async function initNativeShell() {
  if (!isNative()) return;
  try {
    const [{ StatusBar, Style }, { SplashScreen }] = await Promise.all([
      import("@capacitor/status-bar"),
      import("@capacitor/splash-screen"),
    ]);
    await StatusBar.setStyle({ style: Style.Dark });
    if (getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: "#09090b" });
    }
    await SplashScreen.hide({ fadeOutDuration: 260 });
  } catch {
    /* noop */
  }
}

/** Subscribe to connectivity changes; returns an unsubscribe fn. */
export async function watchNetwork(cb: (online: boolean) => void): Promise<() => void> {
  if (isNative()) {
    try {
      const { Network } = await import("@capacitor/network");
      const status = await Network.getStatus();
      cb(status.connected);
      const handle = await Network.addListener("networkStatusChange", (s) => cb(s.connected));
      return () => void handle.remove();
    } catch {
      /* fall through */
    }
  }
  const on = () => cb(true);
  const off = () => cb(false);
  cb(typeof navigator === "undefined" ? true : navigator.onLine);
  window.addEventListener("online", on);
  window.addEventListener("offline", off);
  return () => {
    window.removeEventListener("online", on);
    window.removeEventListener("offline", off);
  };
}

// ── App lifecycle ──────────────────────────────────────────────────────────
// Foreground/background transitions — drives the biometric re-lock below.

/** Subscribe to foreground/background transitions; returns an unsubscribe fn. */
export async function watchAppState(cb: (active: boolean) => void): Promise<() => void> {
  if (isNative()) {
    try {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appStateChange", ({ isActive }) => cb(isActive));
      return () => void handle.remove();
    } catch {
      /* fall through */
    }
  }
  const onVis = () => cb(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", onVis);
  return () => document.removeEventListener("visibilitychange", onVis);
}

// ── Biometric app lock ─────────────────────────────────────────────────────
// Face ID / Touch ID / fingerprint in front of the operations console. The
// real security boundary is still Supabase auth + RLS; this is a second
// factor over an already-authenticated session, so a device that cannot
// prompt must fall open rather than strand the operator.

/**
 * `BiometricAuthError` codes meaning the device can never show a prompt —
 * no hardware, nothing enrolled, no passcode. Anything else (cancel, failed
 * match, lockout) is a dismissal the operator can retry.
 */
const UNPROMPTABLE = new Set([
  1, // BIOMETRICS_UNAVAILABLE
  3, // BIOMETRICS_NOT_ENROLLED
  14, // PASSCODE_NOT_SET
]);

export interface BiometricStatus {
  available: boolean;
  /** Display label for buttons and copy — "Face ID", "fingerprint", … */
  label: string;
}

const NO_BIOMETRICS: BiometricStatus = { available: false, label: "Biometrics" };

/**
 * Can this device actually gate the app? Returns `available: false` on web,
 * on hardware without a sensor, and when nothing is enrolled.
 */
export async function checkBiometrics(): Promise<BiometricStatus> {
  if (!isNative()) return NO_BIOMETRICS;
  try {
    const { NativeBiometric, BiometryType } = await import("@capgo/capacitor-native-biometric");
    // `useFallback` counts a device passcode as an unlock method, so an
    // operator who has not enrolled Face ID still gets a lock, not a bypass.
    const res = await NativeBiometric.isAvailable({ useFallback: true });
    if (!res.isAvailable) return NO_BIOMETRICS;

    const labels: Partial<Record<Biometry, string>> = {
      [BiometryType.TOUCH_ID]: "Touch ID",
      [BiometryType.FACE_ID]: "Face ID",
      [BiometryType.FINGERPRINT]: "your fingerprint",
      [BiometryType.FACE_AUTHENTICATION]: "face unlock",
      [BiometryType.IRIS_AUTHENTICATION]: "iris unlock",
      [BiometryType.MULTIPLE]: "biometrics",
      [BiometryType.DEVICE_CREDENTIAL]: "your device passcode",
    };
    return { available: true, label: labels[res.biometryType] ?? "biometrics" };
  } catch {
    return NO_BIOMETRICS;
  }
}

/**
 * Outcome of an unlock attempt:
 * - `unlocked`    — verified, let them through
 * - `unavailable` — web, or the device cannot prompt at all; do not gate
 * - `dismissed`   — cancelled, failed, or locked out; offer a retry
 */
export type UnlockResult = "unlocked" | "unavailable" | "dismissed";

/** Prompt for biometric identity. Never throws. */
export async function requireBiometricUnlock(
  reason = "Unlock HavenOS to view operator data",
): Promise<UnlockResult> {
  if (!isNative()) return "unavailable";
  try {
    const { NativeBiometric } = await import("@capgo/capacitor-native-biometric");
    const status = await NativeBiometric.isAvailable({ useFallback: true });
    if (!status.isAvailable) return "unavailable";

    await NativeBiometric.verifyIdentity({
      reason,
      title: "HavenOS",
      subtitle: "Operator verification",
      description: reason,
      // iOS: let the system offer the device passcode after a failed match.
      // (Android ignores this — BiometricPrompt cannot show both a device
      // credential authenticator and a cancel button.)
      useFallback: true,
      fallbackTitle: "Use Passcode",
      negativeButtonText: "Cancel",
      maxAttempts: 3, // Android
    });
    return "unlocked";
  } catch (err) {
    const code = Number((err as { code?: unknown })?.code);
    // Enrollment can disappear between the availability check and the prompt
    // (Android honours `useFallback` in isAvailable but not in verifyIdentity).
    // Falling open here is what keeps the operator from being bricked out.
    return UNPROMPTABLE.has(code) ? "unavailable" : "dismissed";
  }
}
