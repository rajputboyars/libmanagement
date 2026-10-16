import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./maintenance-discovery.css";
import "@fontsource-variable/plus-jakarta-sans";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa";
const siteUrl = process.env.APP_URL || "http://127.0.0.1:3000";
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "StudyQuest — A little focus. A bigger future.", template: "%s · StudyQuest" },
  description:
    "Your space to focus, build momentum, and grow. Smart library management meets a rewarding study journey.",
  manifest: "/manifest.webmanifest",
  applicationName: "StudyQuest",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "StudyQuest", statusBarStyle: "default" },
  openGraph: { type: "website", siteName: "StudyQuest", title: "StudyQuest — A little focus. A bigger future.", description: "Library management and a rewarding study journey.", url: "/" },
  twitter: { card: "summary", title: "StudyQuest", description: "Library management and a rewarding study journey." },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#167660",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
