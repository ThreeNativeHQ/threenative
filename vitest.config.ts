import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.spec.ts", "packages/**/__tests__/**/*.spec.ts"],
    exclude: ["node_modules/**", "**/dist/**", "examples/**"],
    reporters: ["default"],
  },
});
