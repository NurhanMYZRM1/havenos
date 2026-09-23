import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { BiometricLock } from "@/components/shell/biometric-lock";
import { NativeShell } from "@/components/shell/native-shell";
import { ToastProvider } from "@/components/ui/toast";

// Fonts are downloaded at build time and bundled with the app, so the
// desktop build never fetches anything from the internet.
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"], display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "HavenOS",
  description: "Property management for Malaysian landlords — properties, tenancies, rent and maintenance, stored on your own computer.",
  manifest: "/manifest.webmanifest",
  applicationName: "HavenOS",
};

export const viewport: Viewport = {
  themeColor: "#0b0b0d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-MY" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="min-h-dvh antialiased">
        <NativeShell />
        <ToastProvider>
          <BiometricLock>{children}</BiometricLock>
        </ToastProvider>
      </body>
    </html>
  );
}
