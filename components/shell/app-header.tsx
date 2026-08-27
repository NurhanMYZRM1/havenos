"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Monogram } from "@/components/brand/monogram";

const TABS = [
  { href: "/dashboard", label: "Portfolio" },
  { href: "/dashboard/work-orders", label: "Work Orders" },
  { href: "/onboarding", label: "Onboarding" },
];

/**
 * Desktop: full nav. Mobile: brand + contextual title only — primary
 * navigation moves to MobileTabBar, within thumb reach.
 */
export function AppHeader({ title }: { title?: string }) {
  const pathname = usePathname();

  return (
    <header
      className="hairline-b sticky top-0 z-40 bg-bg/85 backdrop-blur-md"
      style={{ paddingTop: "var(--safe-top)" }}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-5 md:h-16 md:gap-8 md:px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5 md:gap-3">
          <Monogram />
          <div className="leading-none">
            <div className="font-display text-[15px] tracking-wide md:text-[17px]">
              Haven Collective
            </div>
            <div className="microlabel mt-1 hidden sm:block">Operations</div>
          </div>
        </Link>

        {/* Mobile: the current section, right-aligned */}
        {title && (
          <span className="microlabel ml-auto md:hidden">{title}</span>
        )}

        {/* Desktop nav */}
        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {TABS.map((tab) => {
            const active =
              tab.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`relative px-4 py-2 text-[13px] font-medium transition-colors ${
                  active ? "text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {tab.label}
                {active && (
                  <motion.span
                    layoutId="nav-underline"
                    className="absolute inset-x-3 -bottom-[1px] h-px bg-brass"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
