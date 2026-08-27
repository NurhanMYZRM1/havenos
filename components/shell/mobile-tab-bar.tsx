"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { tap } from "@/lib/native";

/** Thin-stroke icons — no icon font, no external requests. */
const ICONS = {
  portfolio: (
    <>
      <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),
  work: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="1.5" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M3 12.5h18" />
    </>
  ),
  onboarding: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
};

const TABS = [
  { href: "/dashboard", label: "Portfolio", icon: ICONS.portfolio, exact: true },
  { href: "/dashboard/work-orders", label: "Work", icon: ICONS.work, badge: true },
  { href: "/onboarding", label: "Onboard", icon: ICONS.onboarding },
];

export function MobileTabBar({ badgeCount = 0 }: { badgeCount?: number }) {
  const pathname = usePathname();

  return (
    <nav
      className="hairline-t fixed inset-x-0 bottom-0 z-50 bg-bg/95 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: "var(--safe-bottom)" }}
      aria-label="Primary"
    >
      <ul className="flex" style={{ height: "var(--tabbar-h)" }}>
        {TABS.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                onClick={() => void tap("light")}
                aria-current={active ? "page" : undefined}
                className="relative flex h-full flex-col items-center justify-center gap-1 active:opacity-60"
              >
                {active && (
                  <motion.span
                    layoutId="tab-indicator"
                    className="absolute top-0 h-[2px] w-9 rounded-full bg-brass"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <span className="relative">
                  <svg
                    width="21"
                    height="21"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={active ? "text-ink" : "text-ink-3"}
                    aria-hidden
                  >
                    {t.icon}
                  </svg>
                  {t.badge && badgeCount > 0 && (
                    <span
                      className="tnum absolute -right-2 -top-1.5 grid min-w-[16px] place-items-center rounded-full bg-critical px-1 text-[9px] font-bold leading-[15px] text-white"
                      aria-label={`${badgeCount} open`}
                    >
                      {badgeCount > 9 ? "9+" : badgeCount}
                    </span>
                  )}
                </span>
                <span
                  className={`text-[10px] font-medium tracking-wide ${
                    active ? "text-ink" : "text-ink-3"
                  }`}
                >
                  {t.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
