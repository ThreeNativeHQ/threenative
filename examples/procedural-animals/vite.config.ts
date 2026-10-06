import { defineConfig } from "vite";
export default defineConfig({
  build: { rolldownOptions: { input: ["index.html", "crowd.html", "high.html", "baseline.html"] } },
});
