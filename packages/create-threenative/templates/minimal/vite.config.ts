import { createWebBrandPlugin } from "create-threenative";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [createWebBrandPlugin()],
  server: {
    watch: {
      ignored: ["**/artifacts/**", "**/screenshots/**", "**/playtests/**"],
      usePolling: true,
    },
  },
});
