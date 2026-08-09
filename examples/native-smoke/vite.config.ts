import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const physicsScene =
  process.env.THREENATIVE_PHYSICS_SCENE === "enabled" ||
  process.env.THREENATIVE_PHYSICS_PROOF === "enabled";
const nativeBackend =
  process.env.THREENATIVE_NATIVE_BACKEND === "enabled" ||
  process.env.THREENATIVE_PHYSICS_PROOF === "enabled";
const fixture = readFileSync(
  resolve(
    import.meta.dirname,
    "../../packages/physics/__tests__/fixtures/physics-parity.scenario.json",
  ),
  "utf8",
);

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, physicsScene ? "src/physics.ts" : "src/main.ts"),
      fileName: () => "native-smoke.js",
      formats: ["es"],
    },
    minify: false,
    rollupOptions: { output: { codeSplitting: false } },
    target: "es2022",
  },
  define: {
    __TN_PHYSICS_CONTROL__: JSON.stringify(process.env.THREENATIVE_PHYSICS_CONTROL ?? "normal"),
    __TN_PHYSICS_SCENARIO_BYTES__: JSON.stringify(fixture),
    __TN_PHYSICS_SCENARIO_SHA256__: JSON.stringify(
      createHash("sha256").update(fixture).digest("hex"),
    ),
    __TN_PLAYTEST_ENABLED__: JSON.stringify(process.env.THREENATIVE_PLAYTEST_BRIDGE !== "disabled"),
    __TN_RUNTIME__: JSON.stringify(nativeBackend ? "native" : "web"),
  },
  plugins: [
    {
      name: "threenative-physics-scene",
      transformIndexHtml: (html) =>
        physicsScene ? html.replace("/src/main.ts", "/src/physics.ts") : html,
    },
  ],
  resolve: {
    conditions: nativeBackend ? ["threenative-native"] : [],
  },
});
