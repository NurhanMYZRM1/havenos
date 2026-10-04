// next/link for the shared screens inside DOM components: navigation goes to
// the native Expo Router stack instead of the webview's own history.
import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { isExternalHref, useDomRouter } from "../router-context";

type Href = string | { pathname?: string; query?: Record<string, string | number | undefined> };

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: Href;
  replace?: boolean;
  prefetch?: boolean | null;
  scroll?: boolean;
}

export function hrefToString(href: Href): string {
  if (typeof href === "string") return href;
  const query = Object.entries(href.query ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${href.pathname ?? ""}${query ? `?${query}` : ""}`;
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, replace, prefetch: _prefetch, scroll: _scroll, onClick, children, ...rest }, ref) {
  const router = useDomRouter();
  const url = hrefToString(href);
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0) return;
    e.preventDefault();
    router.navigate(url, isExternalHref(url) ? "external" : replace ? "replace" : "push");
  };
  return (
    <a ref={ref} href={url} onClick={handle} {...rest}>
      {children}
    </a>
  );
});

export default Link;
