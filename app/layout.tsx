import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cashford",
  description: "World Cup 2026 prediction & settle-up game",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Mobile-first; friends play on phones.
  maximumScale: 1,
  themeColor: "#15a66a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
