import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NativeShell } from "@/components/shell/native-shell";
import { BiometricLock } from "@/components/shell/biometric-lock";

export const metadata: Metadata = {
  title: "HavenOS — Sub-leasing & Co-living Operations",
  description:
    "Premium operations console for high-end sub-leasing and co-living portfolios. Property → Unit → Bed.",
  manifest: "/manifest.webmanifest",
  applicationName: "HavenOS",
  appleWebApp: {
    capable: true,
    title: "HavenOS",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays available (never disable it — it's an accessibility
  // requirement), but the viewport fills the display including the notch.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh antialiased">
        <NativeShell />
        <BiometricLock>{children}</BiometricLock>
      </body>
    </html>
  );
}
