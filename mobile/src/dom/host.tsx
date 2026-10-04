// Runs one of the desktop app's screens inside a DOM component. It recreates
// what Electron's preload gives the page — `window.havenos` — on top of
// native actions passed in as props, so the screen's code is unchanged.
import "./polyfills";
import { useCallback, useEffect, useMemo, useRef, useState, type ContextType, type ReactNode } from "react";
import { NewMaintenanceDialog } from "@/components/maintenance/maintenance-form";
import { RecordPaymentDialog } from "@/components/rent/record-payment-dialog";
import { ActionsContext } from "@/components/shell/app-shell";
import { SearchPalette } from "@/components/shell/search-palette";
import { ToastProvider } from "@/components/ui/toast";
import type { ApiResponse, DesktopBridge } from "@/lib/api/contract";
import type { CoreEvent } from "~/core/events";
import type { CoreResponse } from "~/core/host";
import { decode, encode } from "~/shared/wire";
import { DomRouterContext, type NavigateMode } from "./router-context";

export interface DomHostProps {
  invoke: (method: string, payload: string) => Promise<string>;
  navigate: (href: string, mode: NavigateMode) => Promise<void>;
  /** Render HTML to a PDF and open the share sheet; resolves to the file path. */
  printHtml?: (html: string, fileName: string) => Promise<string | null>;
  /** The page's own heading, shown in the native navigation bar instead (when `syncTitle`). */
  setTitle?: (title: string) => Promise<void>;
  /** Function props are always proxied in the webview, so presence is signalled separately. */
  syncTitle?: boolean;
  pathname: string;
  search: string;
  dataVersion: number;
  event: CoreEvent | null;
  platform: string;
  dom?: import("expo/dom").DOMProps;
}

type LocalHandler = (params: unknown) => Promise<unknown>;

type Actions = ContextType<typeof ActionsContext>;

const listeners = new Map<string, Set<(payload: unknown) => void>>();
let seenVersion = 0;

function installBridge(platform: string, live: { current: DomHostProps }, local: { current: Record<string, LocalHandler> }) {
  if (window.havenos) return;
  const bridge: DesktopBridge = {
    bridgeVersion: 1,
    platform,
    async invoke(method, params): Promise<ApiResponse<unknown>> {
      const handler = local.current[method];
      if (handler) {
        try {
          return { ok: true, data: await handler(params) };
        } catch (err) {
          return { ok: false, error: { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) } };
        }
      }
      const r = decode<CoreResponse>(await live.current.invoke(method, encode(params)));
      seenVersion = Math.max(seenVersion, r.version);
      return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
  window.havenos = bridge;
}

/** Inline every stylesheet so a printed copy looks like the screen. */
function snapshotHtml(root: Element): string {
  const css: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) css.push(rule.cssText);
    } catch {
      /* cross-origin sheet */
    }
  }
  const htmlClass = document.documentElement.className;
  return `<!doctype html><html class="${htmlClass}"><head><meta charset="utf-8"><style>${css.join("\n")}</style></head><body style="background:#fff">${root.outerHTML}</body></html>`;
}

export function DomHost({
  children,
  padded = true,
  sheet = false,
  local = {},
  ...props
}: DomHostProps & { children: ReactNode; padded?: boolean; sheet?: boolean; local?: Record<string, LocalHandler> }) {
  const live = useRef(props);
  live.current = props;
  const localRef = useRef(local);
  localRef.current = local;
  if (typeof window !== "undefined") {
    if (seenVersion === 0) seenVersion = props.dataVersion;
    installBridge(props.platform, live, localRef);
    document.documentElement.classList.toggle("sheet", sheet);
  }

  useEffect(() => {
    if (props.dataVersion > seenVersion) {
      seenVersion = props.dataVersion;
      window.dispatchEvent(new Event("havenos:changed"));
    }
  }, [props.dataVersion]);

  const eventSeq = props.event?.seq;
  useEffect(() => {
    const e = live.current.event;
    if (e) listeners.get(e.name)?.forEach((l) => l(e.payload));
  }, [eventSeq]);

  const syncTitle = !!props.syncTitle;
  useEffect(() => {
    if (!syncTitle) return;
    let last = "";
    const sync = () => {
      const h1 = document.querySelector(".mobile-page > header:first-child h1");
      // The heading's first text, without status pills rendered beside it.
      let text = "";
      if (h1) {
        const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n && !text; n = walker.nextNode()) text = n.textContent?.trim() ?? "";
      }
      if (text && text !== last) {
        last = text;
        void live.current.setTitle?.(text);
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    sync();
    return () => observer.disconnect();
  }, [syncTitle]);

  const navigate = useCallback((href: string, mode: NavigateMode) => void live.current.navigate(href, mode), []);
  const router = useMemo(() => ({ pathname: props.pathname, search: props.search, navigate }), [props.pathname, props.search, navigate]);

  const [paymentFor, setPaymentFor] = useState<{ tenancyId: string | null } | null>(null);
  const [maintenanceDefaults, setMaintenanceDefaults] = useState<Parameters<Actions["newMaintenance"]>[0] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const actions = useMemo<Actions>(
    () => ({
      recordPayment: (tenancyId) => setPaymentFor({ tenancyId: tenancyId ?? null }),
      newMaintenance: (defaults) => setMaintenanceDefaults(defaults ?? {}),
      openSearch: () => setSearchOpen(true),
    }),
    [],
  );

  return (
    <DomRouterContext.Provider value={router}>
      <ToastProvider>
        <ActionsContext.Provider value={actions}>
          {padded ? <main className="mobile-page mx-auto w-full px-4 pb-12 pt-3">{children}</main> : children}
          <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
          <RecordPaymentDialog open={!!paymentFor} tenancyId={paymentFor?.tenancyId ?? null} onClose={() => setPaymentFor(null)} />
          <NewMaintenanceDialog open={!!maintenanceDefaults} defaults={maintenanceDefaults ?? {}} onClose={() => setMaintenanceDefaults(null)} />
        </ActionsContext.Provider>
      </ToastProvider>
    </DomRouterContext.Provider>
  );
}

export { snapshotHtml };
