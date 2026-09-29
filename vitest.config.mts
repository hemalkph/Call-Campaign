import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    include: ["**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    exclude: ["node_modules/**", "e2e/**"],
    hookTimeout: 120_000, // first run downloads the in-memory MongoDB binary
  },
});
