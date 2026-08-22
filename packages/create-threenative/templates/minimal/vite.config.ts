import { createWebBrandPlugin, optimizeModels } from "create-threenative";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [optimizeModels(), createWebBrandPlugin()],
  server: {
    watch: {
      ignored: ["**/artifacts/**", "**/screenshots/**", "**/playtests/**"],
      usePolling: true,
    },
  },
});
