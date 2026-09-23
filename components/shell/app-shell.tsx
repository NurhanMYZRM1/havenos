"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Monogram } from "@/components/brand/monogram";
import { NewMaintenanceDialog } from "@/components/maintenance/maintenance-form";
import { RecordPaymentDialog } from "@/components/rent/record-payment-dialog";
import { Button, LinkButton } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage, getBridge, notifyChanged, onEvent } from "@/lib/api/client";
import { useApi } from "@/lib/api/hooks";
import { t, type MessageKey } from "@/lib/i18n";
import { DesktopRequired } from "./desktop-required";
import { SearchPalette } from "./search-palette";

interface Actions {
  recordPayment: (tenancyId?: string | null) => void;
  newMaintenance: (defaults?: { propertyId?: string; spaceId?: string | null; tenantId?: string | null }) => void;
  openSearch: () => void;
}

const ActionsContext = createContext<Actions>({ recordPayment: () => undefined, newMaintenance: () => undefined, openSearch: () => undefined });

/** Open the app-wide dialogs (record payment, new maintenance request, search). */
export function useActions() {
  return useContext(ActionsContext);
}

const NAV: { href: string; label: MessageKey; icon: IconName }[] = [
  { href: "/dashboard", label: "nav.dashboard", icon: "dashboard" },
  { href: "/properties", label: "nav.properties", icon: "building" },
  { href: "/tenants", label: "nav.tenants", icon: "people" },
  { href: "/rent", label: "nav.rent", icon: "wallet" },
  { href: "/maintenance", label: "nav.maintenance", icon: "wrench" },
];

function isActive(pathname: string, href: string) {
  const p = pathname.replace(/\/$/, "");
  if (href === "/properties") return p.startsWith("/properties") || p.startsWith("/onboarding");
  if (href === "/tenants") return p.startsWith("/tenants") || p.startsWith("/tenancies");
  return p === href || p.startsWith(`${href}/`);
}

function NavLink({ href, label, icon, active, onNavigate }: { href: string; label: string; icon: IconName; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-colors ${active ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface hover:text-ink"}`}
    >
      {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brass" />}
      <Icon name={icon} size={18} className={active ? "text-brass-bright" : ""} />
      {label}
    </Link>
  );
}

function NewMenu({ onPayment, onMaintenance }: { onPayment: () => void; onMaintenance: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const items: { label: MessageKey; icon: IconName; run: () => void }[] = [
    { label: "dashboard.actionAddProperty", icon: "building", run: () => router.push("/onboarding") },
    { label: "dashboard.actionAddTenancy", icon: "key", run: () => router.push("/tenancies/new") },
    { label: "dashboard.actionRecordPayment", icon: "wallet", run: onPayment },
    { label: "dashboard.actionLogMaintenance", icon: "wrench", run: onMaintenance },
  ];
  return (
    <div ref={ref} className="relative">
      <Button variant="primary" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} icon={<Icon name="plus" size={15} />}>
        {t("common.add")}
      </Button>
      {open && (
        <div role="menu" className="card absolute right-0 top-11 z-50 w-60 p-1.5 shadow-2xl">
          {items.map((item, i) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              autoFocus={i === 0}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13.5px] hover:bg-surface-2 focus-visible:bg-surface-2"
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              <Icon name={item.icon} className="text-ink-2" />
              {t(item.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SampleBanner() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const leave = async () => {
    setBusy(true);
    try {
      await api("workspace.switch", { workspace: "main" });
      notifyChanged();
    } catch (err) {
      toast({ tone: "error", message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="no-print flex flex-wrap items-center gap-3 border-b border-info/40 bg-info/10 px-5 py-2.5 text-[13.5px]" role="status">
      <Icon name="sparkle" className="text-info" />
      <p className="min-w-0 flex-1">{t("sample.banner")}</p>
      <Button size="sm" onClick={() => void leave()} loading={busy}>
        {t("sample.leave")}
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [hasBridge, setHasBridge] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paymentFor, setPaymentFor] = useState<{ tenancyId: string | null } | null>(null);
  const [maintenanceDefaults, setMaintenanceDefaults] = useState<Parameters<Actions["newMaintenance"]>[0] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const bridge = getBridge();
    setHasBridge(!!bridge);
    if (bridge?.platform === "darwin") document.documentElement.classList.add("platform-darwin");
  }, []);

  const info = useApi("app.info", undefined, { enabled: !!hasBridge });
  const cloud = useApi("cloud.status", { refresh: false }, { enabled: !!hasBridge });

  const actions: Actions = {
    recordPayment: useCallback((tenancyId?: string | null) => setPaymentFor({ tenancyId: tenancyId ?? null }), []),
    newMaintenance: useCallback((defaults) => setMaintenanceDefaults(defaults ?? {}), []),
    openSearch: useCallback(() => setSearchOpen(true), []),
  };

  // Keyboard: Ctrl/⌘+K opens search anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Commands from the native application menu.
  useEffect(
    () =>
      onEvent("menu-command", ({ command }) => {
        if (command === "new-property") router.push("/onboarding");
        if (command === "new-maintenance") setMaintenanceDefaults({});
        if (command === "record-payment") setPaymentFor({ tenancyId: null });
        if (command === "search") setSearchOpen(true);
        if (command === "settings") router.push("/settings");
        if (command === "backup" || command === "restore") router.push(`/settings?tab=storage&do=${command}`);
      }),
    [router],
  );

  useEffect(() => setMenuOpen(false), [pathname]);

  if (hasBridge === null) return <div className="min-h-dvh bg-bg" />;
  if (!hasBridge) return <DesktopRequired />;

  const sample = info.data?.workspace === "sample";
  const cloudOn = !!cloud.data?.optedIn;

  const sidebar = (
    <nav aria-label={t("nav.primary")} className="flex h-full flex-col gap-1 px-3 pb-4">
      <div className="drag-region flex items-center gap-3 px-2 pb-5 pt-2 [.platform-darwin_&]:pt-9">
        <Monogram size={32} />
        <div className="leading-tight">
          <div className="font-display text-[18px] tracking-wide">{t("app.name")}</div>
          <div className="text-[11.5px] text-ink-3">{sample ? t("nav.sampleWorkspace") : t("nav.myRecords")}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="mb-3 flex items-center gap-2.5 rounded-lg border border-[var(--hairline-strong)] bg-surface px-3 py-2 text-left text-[13px] text-ink-3 hover:border-brass/40 hover:text-ink-2"
      >
        <Icon name="search" size={15} />
        <span className="flex-1">{t("nav.search")}</span>
        <kbd className="rounded border border-[var(--hairline-strong)] px-1.5 text-[11px]">{getBridge()?.platform === "darwin" ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {NAV.map((item) => (
        <NavLink key={item.href} href={item.href} label={t(item.label)} icon={item.icon} active={isActive(pathname, item.href)} onNavigate={() => setMenuOpen(false)} />
      ))}
      <div className="mt-auto space-y-1">
        <Link href="/settings?tab=storage" className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[12.5px] leading-snug text-ink-3 hover:bg-surface hover:text-ink-2">
          <Icon name={cloudOn ? "cloud" : "hardDrive"} size={16} className="mt-px text-good" />
          <span>{cloudOn ? t("nav.storageCloudOn") : t("nav.storageLocal")}</span>
        </Link>
        <NavLink href="/settings" label={t("nav.settings")} icon="settings" active={isActive(pathname, "/settings")} />
      </div>
    </nav>
  );

  return (
    <ActionsContext.Provider value={actions}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-bg">
        {t("nav.skipToContent")}
      </a>
      <div className="flex min-h-dvh">
        <aside className="no-print sticky top-0 hidden h-dvh w-[var(--sidebar-w)] shrink-0 border-r border-[var(--hairline)] bg-[#0e0e11] lg:block">{sidebar}</aside>
        {menuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
            <button type="button" className="absolute inset-0 bg-black/60" aria-label={t("common.close")} onClick={() => setMenuOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-[var(--sidebar-w)] border-r border-[var(--hairline)] bg-[#0e0e11]">{sidebar}</aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {sample && <SampleBanner />}
          <div className="no-print drag-region sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-[var(--hairline)] bg-bg/90 px-4 backdrop-blur md:px-8">
            <button type="button" className="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 lg:hidden [.platform-darwin_&]:ml-16" onClick={() => setMenuOpen(true)} aria-label={t("nav.menu")}>
              <Icon name="menu" size={18} />
            </button>
            <div className="flex-1" />
            <LinkButton href="/onboarding" size="sm" variant="ghost" className="hidden sm:inline-flex" icon={<Icon name="building" size={15} />}>
              {t("nav.addProperty")}
            </LinkButton>
            <NewMenu onPayment={() => setPaymentFor({ tenancyId: null })} onMaintenance={() => setMaintenanceDefaults({})} />
          </div>
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-16 pt-6 outline-none md:px-8 md:pt-8">
            {children}
          </main>
        </div>
      </div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <RecordPaymentDialog open={!!paymentFor} tenancyId={paymentFor?.tenancyId ?? null} onClose={() => setPaymentFor(null)} />
      <NewMaintenanceDialog open={!!maintenanceDefaults} defaults={maintenanceDefaults ?? {}} onClose={() => setMaintenanceDefaults(null)} />
    </ActionsContext.Provider>
  );
}
