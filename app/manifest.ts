import type { MetadataRoute } from "next";

// Web app manifest — Android Chrome uses this for "Add to Home Screen".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cashford",
    short_name: "Cashford",
    description: "World Cup 2026 prediction & settle-up",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F8FA",
    theme_color: "#15A66A",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
