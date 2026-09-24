import { NextResponse, type NextRequest } from "next/server";
import { isAppHost } from "@/lib/tenancy";

// Host-based tenant routing for Cloudflare custom domains.
// haven-os.vercel.app / app.* → operator console as-is.
// Any other host (an org's vanity domain, CNAME'd via Cloudflare) → /t/<host>/*
export function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const { pathname } = request.nextUrl;

  if (isAppHost(host) || pathname.startsWith("/t/")) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/t/${host}${pathname}`;
  const response = NextResponse.rewrite(url);
  response.headers.set("x-tenant-domain", host);
  return response;
}

export const config = {
  // Skip static assets and Next internals.
  matcher: ["/((?!_next/|media/|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
