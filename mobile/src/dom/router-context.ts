import { createContext, useContext } from "react";

export type NavigateMode = "push" | "replace" | "back" | "external";

export interface DomRouter {
  pathname: string;
  search: string;
  navigate: (href: string, mode: NavigateMode) => void;
}

export const DomRouterContext = createContext<DomRouter>({
  pathname: "/",
  search: "",
  navigate: () => undefined,
});

export const useDomRouter = () => useContext(DomRouterContext);

export function isExternalHref(href: string): boolean {
  return /^(https?:|tel:|mailto:|sms:)/i.test(href);
}
