import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Match Next's automatic JSX runtime so component .tsx files need no React import.
  esbuild: { jsx: "automatic" },
  test: {
    // Node by default; component/DOM tests opt in with `// @vitest-environment jsdom`.
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["{lib,app,components,test}/**/*.test.{ts,tsx}", "*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**", "app/**", "components/**", "middleware.ts"],
      exclude: ["**/*.test.{ts,tsx}", "test/**", "lib/version.ts", "**/*.d.ts"],
    },
  },
  resolve: {
    alias: {
      // `@/x` → project root, mirroring tsconfig "paths".
      "@": root.replace(/\/$/, ""),
      // `server-only` throws when imported outside an RSC; stub it for tests.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
});
