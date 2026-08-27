import type { NextConfig } from "next";

// Two build targets from one codebase:
//   `next build`                → Vercel (SSR, middleware, tenant custom domains)
//   `MOBILE_BUILD=1 next build` → static bundle in ./out for the Capacitor shell
//
// The native app talks to Supabase directly from the client under RLS, so it
// needs no server runtime. Routes suffixed `.web.tsx` are registered only in
// the web build — that is how the dynamic tenant route stays out of the
// static export without forcing `dynamicParams: false` onto the web build.
const isMobile = process.env.MOBILE_BUILD === "1";

const nextConfig: NextConfig = {
  pageExtensions: isMobile ? ["tsx", "ts"] : ["web.tsx", "tsx", "ts"],

  ...(isMobile
    ? {
        output: "export" as const,
        // Capacitor serves from file:// — no image optimization server exists.
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {
        images: {
          remotePatterns: [
            { protocol: "https", hostname: "**.higgsfield.ai" },
            { protocol: "https", hostname: "**.cloudfront.net" },
            { protocol: "https", hostname: "**.r2.dev" },
          ],
        },
        async headers() {
          return [
            {
              // Cloudflare fronts every custom domain; let it cache immutable media hard.
              source: "/media/:path*",
              headers: [
                { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
