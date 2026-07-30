import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["@testing-library/jest-dom/vitest"],
    environmentMatchGlobs: [
      ["tests/phase3/entry-sheet.test.ts", "jsdom"],
      ["tests/phase3/entry-sheet.test.tsx", "jsdom"],
    ],
  },
});
