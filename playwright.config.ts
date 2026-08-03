import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./examples/abyss-vanilla/__tests__",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--disable-gpu",
        "--disable-gpu-sandbox",
        "--use-angle=swiftshader",
      ],
    },
  },
  webServer: {
    command: "pnpm --filter abyss-vanilla dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
