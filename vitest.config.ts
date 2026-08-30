import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "scripts/**/*.spec.ts",
      "packages/**/__tests__/**/*.spec.ts",
      "packages/**/__tests__/**/*.spec.tsx",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "examples/**"],
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "./artifacts/coverage",
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts"],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
    },
    // Several specs drive real headless Chromium plus dev servers (generated-shooter-input,
    // e2e-runner, golden-path). Uncapped worker pools on large machines starve their input
    // timing and fail them nondeterministically; a fixed ceiling keeps those runs honest
    // without pinning the suite to one core.
    maxWorkers: 8,
  },
});
