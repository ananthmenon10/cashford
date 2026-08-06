import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/shims/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["@testing-library/jest-dom/vitest"],
    environmentMatchGlobs: [
      ["tests/phase3/entry-sheet.test.ts", "jsdom"],
      ["tests/phase3/entry-sheet.test.tsx", "jsdom"],
      ["tests/phase3/state-header-copy.test.tsx", "jsdom"],
      ["tests/phase4/matches-page.test.tsx", "jsdom"],
      ["tests/phase5/wc-archive-components.test.tsx", "jsdom"],
      ["tests/phase6/analytics-feed-components.test.tsx", "jsdom"],
    ],
  },
});
