import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "scripts/**/*.spec.ts",
      "hosting/**/*.spec.ts",
      "packages/playtest/src/runner/**/*.test.ts",
      "packages/**/__tests__/**/*.spec.ts",
      "packages/**/__tests__/**/*.spec.tsx",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "examples/**"],
    reporters: ["default"],
  },
});
