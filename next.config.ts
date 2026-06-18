import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Team crest / flag images come from API-Football's media CDN.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "media.api-sports.io" },
    ],
  },
};

export default nextConfig;
