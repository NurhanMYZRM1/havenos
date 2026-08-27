"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { Monogram } from "@/components/brand/monogram";
import { MobileTabBar } from "@/components/shell/mobile-tab-bar";
import manifest from "@/public/media/manifest.json";

const STEPS = [
  { n: "01", title: "Property", copy: "Address, timezone, amenities, brand." },
  { n: "02", title: "Units", copy: "Floors, layouts, base rents." },
  { n: "03", title: "Beds", copy: "The co-living primitive — priced per bed." },
  { n: "04", title: "Publish", copy: "Tour assets live on your custom domain." },
];

export default function OnboardingPage() {
  const hero = manifest.assets.onboarding_hero;
  const tour = manifest.assets.virtual_tour_suite;
  const reduceMotion = useReducedMotion();

  return (
    <>
      <main className="min-h-dvh pb-tabbar md:pb-0">
        {/* ── Cinematic hero ───────────────────────────────────────────── */}
        <section className="relative flex min-h-[62dvh] items-end overflow-hidden md:min-h-[72dvh]">
          {/*
           * `preload="metadata"` keeps the first paint cheap on cellular, and
           * reduced-motion users get a still frame instead of a looping video.
           */}
          <video
            className="absolute inset-0 size-full object-cover"
            src={hero.url}
            autoPlay={!reduceMotion}
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, #09090b 4%, rgba(9,9,11,0.62) 45%, rgba(9,9,11,0.3) 100%)",
            }}
          />
          <motion.div
            className="relative mx-auto w-full max-w-6xl px-5 pb-12 md:px-6 md:pb-16"
            style={{ paddingTop: "var(--safe-top)" }}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          >
            <Monogram size={40} />
            <h1 className="mt-5 max-w-2xl font-display text-[32px] font-light leading-[1.1] tracking-tight sm:text-[38px] md:mt-6 md:text-[44px] md:leading-[1.08]">
              Bring a property onto Haven.
            </h1>
            <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-ink-2">
              Four steps from address to a bookable, bed-level inventory — with a
              cinematic tour your residents see before they ever visit.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 md:mt-7">
              <motion.button
                whileTap={{ scale: 0.98 }}
                className="min-h-11 rounded-lg bg-ink px-5 text-[14px] font-semibold text-bg transition-colors active:opacity-80 md:rounded-md md:text-[13px] md:hover:bg-brass-bright"
              >
                Start onboarding
              </motion.button>
              <Link
                href="/dashboard"
                className="grid min-h-11 place-items-center px-3 text-[14px] font-medium text-ink-2 active:text-ink md:text-[13px] md:hover:text-ink"
              >
                Back to portfolio
              </Link>
            </div>
          </motion.div>
        </section>

        {/* ── Steps + tour preview ─────────────────────────────────────── */}
        <section className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:gap-10 md:px-6 md:py-16 lg:grid-cols-[1fr_1.2fr]">
          {/* Tour first on mobile — it is the thing worth seeing on a phone. */}
          <motion.figure
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="card order-first p-2 lg:order-last"
          >
            <video
              className="aspect-video w-full rounded-md object-cover"
              src={tour.url}
              autoPlay={!reduceMotion}
              muted
              loop
              playsInline
              preload="metadata"
            />
            <figcaption className="flex items-center justify-between gap-3 px-2.5 py-2.5">
              <span className="text-[12px] text-ink-2">Virtual tour — private suite</span>
              <span className="microlabel shrink-0">Cinema Studio · 12s</span>
            </figcaption>
          </motion.figure>

          <div>
            <div className="microlabel mb-4 md:mb-5">The flow</div>
            <ol>
              {STEPS.map((step, i) => (
                <motion.li
                  key={step.n}
                  initial={{ opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="hairline-b group flex items-baseline gap-4 py-4 md:gap-5"
                >
                  <span className="tnum font-display text-[15px] text-brass">{step.n}</span>
                  <div>
                    <div className="text-[15px] font-medium md:transition-colors md:group-hover:text-brass-bright">
                      {step.title}
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-3">{step.copy}</div>
                  </div>
                </motion.li>
              ))}
            </ol>
          </div>
        </section>
      </main>
      <MobileTabBar />
    </>
  );
}
