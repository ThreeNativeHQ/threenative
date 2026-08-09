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
  },
});
