import type { NextConfig } from "next";

// Build targets from one codebase:
//   `next build`                  → web (Vercel): SSR, middleware, tenant custom domains.
//                                   Records live in the desktop app, so the web
//                                   build shows a "desktop app required" screen.
//   `DESKTOP_BUILD=1 next build`  → static bundle in ./out, served inside the
//                                   Electron app from app://havenos (no server).
//   `MOBILE_BUILD=1 next build`   → static bundle in ./out for the Capacitor shell.
//
// Files suffixed `.web.tsx` / `.web.ts` are registered only in the web build:
// that keeps the dynamic tenant route and the custom-domain middleware
// (`middleware.web.ts`) out of the static desktop/mobile exports.
const isStatic = process.env.MOBILE_BUILD === "1" || process.env.DESKTOP_BUILD === "1";

const nextConfig: NextConfig = {
  // Pin the project root (the build always runs from here) so a parent
  // folder's lockfile — e.g. when working in a git worktree — isn't mistaken for it.
  outputFileTracingRoot: process.cwd(),
  pageExtensions: isStatic ? ["tsx", "ts"] : ["web.tsx", "web.ts", "tsx", "ts"],

  ...(isStatic
    ? {
        output: "export" as const,
        // No image optimisation server exists inside the desktop/mobile shells.
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {
        async redirects() {
          // Work Orders became Maintenance; keep old links working.
          return [{ source: "/dashboard/work-orders", destination: "/maintenance", permanent: true }];
        },
      }),
};

export default nextConfig;
