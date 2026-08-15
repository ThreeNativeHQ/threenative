import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      // A playtest writes its screenshots and console log into the project while
      // the page is live. Left watched, those writes trigger a reload, the React
      // tree unmounts, `GameCanvas` calls `game.stop()`, and the next fixed-step
      // advance fails with "Cannot advance a stopped loop" — a harness that
      // breaks the thing it is measuring.
      ignored: ["**/artifacts/**", "**/dist/**", "**/.playtest/**"],
      usePolling: true,
    },
  },
});
