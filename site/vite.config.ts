import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * One config drives three outputs: the dev server, the client bundle that ships to Cloudflare,
 * and the SSR bundle that `scripts/prerender.ts` imports to turn `src/routes.ts` into static
 * HTML. The site imports nothing from `packages/` at runtime — the code samples are read as text.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // A marketing page has no excuse for a slow first paint; keep the shipped graph small enough
    // that a regression is visible in the build log rather than in a Lighthouse run.
    chunkSizeWarningLimit: 300,
    emptyOutDir: true,
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.spec.ts"],
    reporters: ["default"],
  },
  server: {
    host: "127.0.0.1",
    port: 5178,
    strictPort: true,
  },
});
