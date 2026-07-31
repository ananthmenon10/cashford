import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Geist_Mono } from "next/font/google";
import { BugReportButton } from "@/components/BugReportButton";
import "./globals.css";

// Run functions in Mumbai, next to Supabase (ap-south-1) — kills cross-region DB latency.
export const preferredRegion = "bom1";

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-hanken",
});
const mono = Geist_Mono({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-geist",
});

export const metadata: Metadata = {
  title: "Cashford",
  description: "World Cup 2026 prediction & settle-up game",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Cashford", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#15A66A" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0F14" },
  ],
};

// Applied before first paint (and before hydration) so there's no flash of the wrong theme:
// honor a stored choice, else the device's prefers-color-scheme.
const THEME_INIT = `(function(){try{var s=localStorage.getItem('cf-theme');var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen">
        {children}
        <BugReportButton />
      </body>
    </html>
  );
}
