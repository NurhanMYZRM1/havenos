"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Monogram } from "@/components/brand/monogram";

/**
 * Entry route. This is a CLIENT redirect on purpose: Capacitor boots the app
 * at `index.html`, and a server `redirect()` cannot be statically exported —
 * it emits an error page, so the native app would launch to a blank screen.
 *
 * The monogram doubles as the launch state, so the hop reads as intentional
 * rather than as a flash of empty page.
 */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);

  return (
    <main className="grid min-h-dvh place-items-center">
      <Monogram size={48} />
      <span className="sr-only">Opening HavenOS…</span>
    </main>
  );
}
