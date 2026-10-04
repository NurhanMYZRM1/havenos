// next/navigation for the shared screens inside DOM components. The native
// route passes its pathname and query string in; navigation goes back out.
import { useMemo } from "react";
import { isExternalHref, useDomRouter } from "../router-context";

export function useRouter() {
  const { navigate } = useDomRouter();
  return useMemo(
    () => ({
      push: (href: string, _opts?: { scroll?: boolean }) => navigate(href, isExternalHref(href) ? "external" : "push"),
      replace: (href: string, _opts?: { scroll?: boolean }) => navigate(href, "replace"),
      back: () => navigate("", "back"),
      forward: () => undefined,
      refresh: () => window.dispatchEvent(new Event("havenos:changed")),
      prefetch: () => undefined,
    }),
    [navigate],
  );
}

export function usePathname(): string {
  return useDomRouter().pathname;
}

export function useSearchParams(): URLSearchParams {
  const { search } = useDomRouter();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams(): Record<string, string> {
  return {};
}

export function redirect(href: string): never {
  throw new Error(`redirect(${href}) is not supported in DOM components`);
}

export function notFound(): never {
  throw new Error("notFound() is not supported in DOM components");
}
