import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Standalone test config. The app's vite.config.ts wires TanStack Start / Nitro,
// which must not be loaded under the test runner.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
  },
});
