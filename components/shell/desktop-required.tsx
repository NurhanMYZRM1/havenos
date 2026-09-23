"use client";

import { Monogram } from "@/components/brand/monogram";
import { SkylineIllustration } from "@/components/illustrations";
import { t } from "@/lib/i18n";

/**
 * Shown when the UI is opened in an ordinary browser (for example the web
 * build). Records only exist inside the desktop app, so nothing is faked here.
 */
export function DesktopRequired() {
  return (
    <main className="flex min-h-dvh flex-col">
      <div className="relative h-[42vh] min-h-[260px] overflow-hidden">
        <SkylineIllustration className="absolute inset-0 size-full" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, #0b0b0d 2%, rgba(11,11,13,0.2) 70%)" }} />
      </div>
      <div className="mx-auto -mt-16 w-full max-w-2xl px-6 pb-16">
        <Monogram size={44} />
        <h1 className="mt-5 font-display text-[30px] font-light leading-tight">{t("desktopRequired.title")}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{t("desktopRequired.body")}</p>
        <p className="mt-5 text-[14px] text-ink-2">{t("desktopRequired.howTo")}</p>
        <pre className="card mt-3 overflow-x-auto px-4 py-3 text-[13px] text-brass-bright">{t("desktopRequired.devCommand")}</pre>
      </div>
    </main>
  );
}
