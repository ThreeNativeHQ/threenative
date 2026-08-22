import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createWebBrandPlugin, optimizeModels } from "create-threenative";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [optimizeModels(), createWebBrandPlugin(), react(), tailwindcss()],
  server: {
    watch: {
      ignored: ["**/artifacts/**", "**/screenshots/**", "**/playtests/**"],
      usePolling: true,
    },
  },
});
