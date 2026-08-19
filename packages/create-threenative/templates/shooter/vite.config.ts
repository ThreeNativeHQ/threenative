import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createWebBrandPlugin } from "create-threenative";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [createWebBrandPlugin(), react(), tailwindcss()],
  server: {
    watch: {
      ignored: ["**/artifacts/**", "**/screenshots/**", "**/playtests/**"],
      usePolling: true,
    },
  },
});
