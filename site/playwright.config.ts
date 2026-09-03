import { defineConfig } from "@playwright/test";

const PORT = 4179;

/**
 * The e2e lane drives the built artefact, not the dev server: what these tests interact with is
 * exactly what Cloudflare would serve. Every assertion here is an interaction *result* — a drawer
 * that opened, a clipboard that filled, a panel whose text changed — never the presence of markup
 * the prerender already emitted, which would pass on a page that never hydrated.
 */
export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  reporter: "line",
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: `vite preview --outDir dist/client --host 127.0.0.1 --port ${PORT} --strictPort`,
    reuseExistingServer: false,
    timeout: 120_000,
    url: `http://127.0.0.1:${PORT}`,
  },
});
