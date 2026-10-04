// Everything a shared desktop screen needs from the native side when it runs
// in a DOM component: data calls, navigation, PDF sharing and change events.
import { File, Paths } from "expo-file-system";
import * as Linking from "expo-linking";
import * as Print from "expo-print";
import { useLocalSearchParams, useNavigation, usePathname, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useMemo } from "react";
import { Platform } from "react-native";
import { useDataVersion, useLastCoreEvent } from "~/core/events";
import { invokeCore } from "~/core/host";
import { toPath } from "~/core/platform";
import type { DomHostProps } from "~/dom/host";
import type { NavigateMode } from "~/dom/router-context";
import { decode, encode } from "~/shared/wire";

/** Web paths used by the shared screens → native routes. */
export function toNativeHref(href: string): string {
  const [rawPath, query] = href.split("?");
  let path = rawPath.replace(/\/+$/, "") || "/dashboard";
  if (path === "/dashboard/work-orders") path = "/maintenance";
  return query ? `${path}?${query}` : path;
}

const invoke = async (method: string, payload: string) => encode(await invokeCore(method, decode(payload)));

async function printHtml(html: string, fileName: string): Promise<string | null> {
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const target = new File(Paths.cache, fileName.replace(/[/\\]/g, "_"));
  if (target.exists) target.delete();
  new File(uri).moveSync(target);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(target.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
  return toPath(target.uri);
}

/** Tab roots keep their short native titles; other screens show the page's heading. */
const TAB_ROOTS = new Set(["/dashboard", "/rent", "/stays", "/maintenance"]);

export function useDomProps(): DomHostProps {
  const router = useRouter();
  const navigation = useNavigation();
  const pathname = usePathname();
  const params = useLocalSearchParams();
  const dataVersion = useDataVersion();
  const event = useLastCoreEvent();

  const search = useMemo(() => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      for (const one of Array.isArray(v) ? v : [v]) if (one != null) q.append(k, String(one));
    }
    return q.toString();
  }, [params]);

  const navigate = useCallback(
    async (href: string, mode: NavigateMode) => {
      if (mode === "back") return router.canGoBack() ? router.back() : router.replace("/dashboard");
      if (mode === "external") return void Linking.openURL(href);
      const target = toNativeHref(href) as Parameters<typeof router.push>[0];
      if (mode === "replace") router.replace(target);
      else router.push(target);
    },
    [router],
  );

  const setTitle = useCallback(async (title: string) => navigation.setOptions({ title }), [navigation]);

  return {
    invoke,
    navigate,
    printHtml,
    setTitle,
    syncTitle: !TAB_ROOTS.has(pathname),
    pathname,
    search,
    dataVersion,
    event,
    platform: Platform.OS,
    dom: { style: { flex: 1 } },
  };
}
