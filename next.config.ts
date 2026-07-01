import type { NextConfig } from "next";

// Next's dev HMR/webpack runtime uses eval(); production does not. Allow it only in dev
// so the strict prod CSP stays eval-free.
const cspScript = process.env.NODE_ENV === "production" ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const nextConfig: NextConfig = {
  // Team crest / flag images come from API-Football's media CDN + ESPN (knockout flags).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "media.api-sports.io" },
      { protocol: "https", hostname: "a.espncdn.com" },
    ],
  },
  // Harden the public share pages (highest-exposure new surface). Scoped to /b/* so the
  // rest of the app is untouched. img-src allows ESPN flags (rendered as SVG <image>);
  // 'self'/'unsafe-inline' scripts+styles are what Next's client runtime needs.
  async headers() {
    return [
      {
        source: "/b/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; img-src 'self' data: https://a.espncdn.com; style-src 'self' 'unsafe-inline'; ${cspScript}; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
