import { defineConfig } from "@playwright/test";
import { WEBGPU_BROWSER_ARGS } from "./packages/playtest/src/runner/browser.js";

export default defineConfig({
  testDir: "./examples/abyss-framework/tests",
  testMatch: "**/*.playtest.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4174",
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: {
      args: [...WEBGPU_BROWSER_ARGS],
    },
  },
  webServer: {
    command: "pnpm --filter abyss-framework dev --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
