import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts", "tests/e2e/**"],
    testTimeout: 15_000,
  },
});
