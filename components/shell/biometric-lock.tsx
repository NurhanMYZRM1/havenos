"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Monogram } from "@/components/brand/monogram";
import {
  checkBiometrics,
  isNative,
  notifyHaptic,
  requireBiometricUnlock,
  watchAppState,
} from "@/lib/native";

/**
 * Re-lock only after a real trip to the background. Without a grace window,
 * every camera capture — and on iOS the Face ID sheet itself, which resigns
 * the app's active state — would bounce the operator straight back here.
 */
const RELOCK_AFTER_MS = 30_000;

type Phase = "boot" | "locked" | "open";

/**
 * Biometric app lock for the native builds.
 *
 * Gates its children behind Face ID / Touch ID / fingerprint on cold launch
 * and again whenever the app returns from more than {@link RELOCK_AFTER_MS}
 * in the background. The web build renders `children` untouched — `isNative()`
 * is false there, so the curtain never arms.
 *
 * This sits *over* an already-authenticated Supabase session; RLS remains the
 * real security boundary. That is why every failure mode here falls open
 * rather than trapping the operator: a device with no enrolled biometrics
 * never locks, and a dismissed prompt still offers a way through.
 */
export function BiometricLock({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [label, setLabel] = useState("biometrics");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const reduceMotion = useReducedMotion();

  /** Device can prompt — false on web and on hardware with nothing enrolled. */
  const armed = useRef(false);
  /** A prompt is on screen; ignore the lifecycle churn it causes. */
  const prompting = useRef(false);
  const leftAt = useRef<number | null>(null);

  const attemptUnlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setBusy(true);

    const result = await requireBiometricUnlock("Unlock HavenOS to view operator data");

    prompting.current = false;
    setBusy(false);
    leftAt.current = null;

    if (result === "unlocked") {
      setDismissed(false);
      setPhase("open");
      void notifyHaptic("success");
      return;
    }
    if (result === "unavailable") {
      // Enrollment vanished between the check and the prompt — stop gating
      // entirely rather than presenting a lock nothing can open.
      armed.current = false;
      setDismissed(false);
      setPhase("open");
      return;
    }
    // Cancelled, failed, or locked out: hold the curtain, offer a retry.
    setDismissed(true);
  }, []);

  // Cold launch: drop the curtain immediately on native so no operator data
  // is painted before we know whether this device locks, then resolve it.
  useEffect(() => {
    if (!isNative()) return; // web is never gated
    setPhase("locked");

    let cancelled = false;
    void (async () => {
      const status = await checkBiometrics();
      if (cancelled) return;
      if (!status.available) {
        armed.current = false;
        setPhase("open");
        return;
      }
      armed.current = true;
      setLabel(status.label);
      void attemptUnlock();
    })();

    return () => {
      cancelled = true;
    };
  }, [attemptUnlock]);

  // Returning from background re-locks past the grace window.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void watchAppState((active) => {
      if (!armed.current || prompting.current) return;

      if (!active) {
        leftAt.current = Date.now();
        return;
      }
      const away = leftAt.current === null ? 0 : Date.now() - leftAt.current;
      leftAt.current = null;
      if (away < RELOCK_AFTER_MS) return;

      setDismissed(false);
      setPhase("locked");
      void attemptUnlock();
    }).then((fn) => {
      dispose = fn;
    });
    return () => dispose?.();
  }, [attemptUnlock]);

  // Nothing behind the curtain should scroll.
  useEffect(() => {
    if (phase !== "locked") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [phase]);

  const locked = phase === "locked";

  return (
    <>
      {/* `display: contents` keeps the wrapper out of layout; `inert` keeps
          the covered app off the focus order and away from screen readers. */}
      <div style={{ display: "contents" }} inert={locked}>
        {children}
      </div>

      {/*
       * Deliberately un-animated, and mounted/unmounted outright rather than
       * through AnimatePresence. This curtain is the only thing hiding
       * operator data, and the moment it matters most — the first frames after
       * a resume — is exactly when the compositor is most likely to drop them.
       * An opacity fade would leave the charcoal transparent until it lands,
       * and an exit animation that never lands would strand the curtain up.
       * Nothing required is gated on an animation running.
       */}
      {locked && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="HavenOS is locked"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-bg px-8 text-center"
          style={{
            paddingTop: "calc(var(--safe-top) + 28px)",
            paddingBottom: "calc(var(--safe-bottom) + 28px)",
            paddingLeft: "calc(var(--safe-left) + 32px)",
            paddingRight: "calc(var(--safe-right) + 32px)",
          }}
        >
          {/* Rise only — no fade. If this never runs the screen is still
              fully legible and operable, just without the flourish. */}
          <motion.div
            initial={{ y: reduceMotion ? 0 : 12 }}
            animate={{ y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center"
          >
            <Monogram size={56} />

            <h1 className="mt-7 font-display text-[24px] font-light tracking-tight">
              Haven Collective
            </h1>
            <p className="microlabel mt-2.5">Locked</p>

            <span
              className="mt-7 h-px w-14"
              style={{
                background:
                  "linear-gradient(to right, transparent, var(--color-brass), transparent)",
              }}
              aria-hidden
            />

            <p
              className="mt-7 max-w-[17rem] text-[13px] leading-relaxed text-ink-2"
              aria-live="polite"
            >
              {dismissed
                ? `Verification was dismissed. Operator data stays hidden until you unlock.`
                : `Confirm with ${label} to return to the operations console.`}
            </p>

            <motion.button
              type="button"
              autoFocus
              whileTap={{ scale: 0.98 }}
              disabled={busy}
              onClick={() => void attemptUnlock()}
              className="mt-8 min-h-11 rounded-lg bg-ink px-6 text-[14px] font-semibold text-bg transition-opacity active:opacity-80 disabled:opacity-60 md:hover:bg-brass-bright"
            >
              {busy ? "Waiting for verification…" : `Unlock with ${label}`}
            </motion.button>

            {/*
             * Escape hatch. A failed sensor, a wet thumb, or a lockout must
             * not strand an operator mid-callout — the session behind this
             * curtain is still protected by Supabase auth and RLS.
             */}
            {dismissed && (
              <button
                type="button"
                onClick={() => setPhase("open")}
                className="touch-target mt-4 px-3 py-2 text-[12px] font-medium text-ink-2 underline decoration-ink-3 underline-offset-4 active:text-ink md:hover:text-ink"
              >
                Continue without unlocking
              </button>
            )}
          </motion.div>
        </div>
      )}
    </>
  );
}
