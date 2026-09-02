import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

function integerSetting(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer, received '${raw}'.`);
  return value;
}

function booleanSetting(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be 'true' or 'false', received '${raw}'.`);
}

function visibilitySetting(): number {
  const raw = process.env.THREENATIVE_JS_PROFILE_VISIBILITY ?? "1";
  const value = Number(raw);
  if (![0, 0.25, 0.5, 1].includes(value))
    throw new Error("THREENATIVE_JS_PROFILE_VISIBILITY must be 0, 0.25, 0.5, or 1.");
  return value;
}

function materialSetting(): "distinct" | "shared" {
  const value = process.env.THREENATIVE_JS_PROFILE_MATERIALS ?? "shared";
  if (value !== "distinct" && value !== "shared")
    throw new Error("THREENATIVE_JS_PROFILE_MATERIALS must be 'shared' or 'distinct'.");
  return value;
}

function frustumSetting(): "contain" | "default" {
  const value = process.env.THREENATIVE_JS_PROFILE_FRUSTUM ?? "default";
  if (value !== "contain" && value !== "default")
    throw new Error("THREENATIVE_JS_PROFILE_FRUSTUM must be 'contain' or 'default'.");
  return value;
}

const jsEngineProfile = {
  extraDrawControl: booleanSetting("THREENATIVE_JS_PROFILE_EXTRA_DRAW_CONTROL", false),
  frameWindow: integerSetting("THREENATIVE_JS_PROFILE_FRAME_WINDOW", 300),
  frustum: frustumSetting(),
  materials: materialSetting(),
  meshes: integerSetting("THREENATIVE_JS_PROFILE_MESHES", 0),
  pureJsIterations: integerSetting("THREENATIVE_JS_PROFILE_PURE_JS_ITERATIONS", 0),
  pureJsObjects: integerSetting("THREENATIVE_JS_PROFILE_PURE_JS_OBJECTS", 2358),
  visibility: visibilitySetting(),
  warmupFrames: integerSetting("THREENATIVE_JS_PROFILE_WARMUP_FRAMES", 60),
};

/**
 * The base `import.meta.url` is replaced with, for a bundle the host evaluates as a script.
 *
 * It is only ever used as the second argument to `new URL(...)` for an absolute `data:` URL, where
 * the base is ignored, so the value only has to be a well-formed absolute URL.
 */
const NATIVE_BUNDLE_URL = "file:///native-smoke.js";

const physicsScene =
  process.env.THREENATIVE_PHYSICS_SCENE === "enabled" ||
  process.env.THREENATIVE_PHYSICS_PROOF === "enabled" ||
  process.env.THREENATIVE_CONTINUOUS_COLLISION_PROOF === "enabled";
const continuousCollisionProof = process.env.THREENATIVE_CONTINUOUS_COLLISION_PROOF === "enabled";
const nativeBackend =
  process.env.THREENATIVE_NATIVE_BACKEND === "enabled" ||
  process.env.THREENATIVE_PHYSICS_PROOF === "enabled";
const loadingProof = process.env.THREENATIVE_LOADING_PROOF === "enabled";
const packedFixture = resolve(import.meta.dirname, "physics-parity.scenario.json");
const fixture = readFileSync(
  existsSync(packedFixture)
    ? packedFixture
    : resolve(
        import.meta.dirname,
        "../../packages/physics/__tests__/fixtures/physics-parity.scenario.json",
      ),
  "utf8",
);

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, physicsScene ? "src/physics-main.ts" : "src/main.ts"),
      fileName: () => "native-smoke.js",
      formats: ["es"],
    },
    minify: false,
    rollupOptions: { output: { codeSplitting: false } },
    target: "es2022",
  },
  define: {
    __TN_JS_ENGINE_PROFILE__: JSON.stringify(jsEngineProfile),
    __TN_PHYSICS_CONTROL__: JSON.stringify(process.env.THREENATIVE_PHYSICS_CONTROL ?? "normal"),
    __TN_PHYSICS_SCENARIO_BYTES__: JSON.stringify(fixture),
    __TN_PHYSICS_SCENARIO_SHA256__: JSON.stringify(
      createHash("sha256").update(fixture).digest("hex"),
    ),
    __TN_CONTINUOUS_COLLISION_PROOF__: JSON.stringify(continuousCollisionProof),
    __TN_LOADING_PROOF__: JSON.stringify(loadingProof),
    __TN_PLAYTEST_ENABLED__: JSON.stringify(process.env.THREENATIVE_PLAYTEST_BRIDGE !== "disabled"),
    __TN_RUNTIME__: JSON.stringify(nativeBackend ? "native" : "web"),
  },
  plugins: [
    {
      // `import.meta` is only valid inside a module, and the native host evaluates this bundle as
      // a script. JavaScriptCore on iOS refused the whole file for it —
      // "SyntaxError: import.meta is only valid inside modules" — so the app initialised its
      // renderer, its GPU device and its JS engine, then died before its first frame.
      //
      // Every occurrence comes from three's Draco/Basis/KTX2 loaders writing
      // `new URL("data:...", import.meta.url)`, and the base of an absolute URL is ignored. A
      // constant is therefore exactly as correct, and is valid in script scope as well as module
      // scope. `verify-bundle.mjs` fails the build if any survive.
      name: "threenative-script-safe-bundle",
      renderChunk(code: string) {
        if (!code.includes("import.meta")) return null;
        return {
          code: code.replaceAll("import.meta.url", JSON.stringify(NATIVE_BUNDLE_URL)),
          map: null,
        };
      },
    },
    {
      name: "threenative-physics-scene",
      transformIndexHtml: (html) =>
        physicsScene ? html.replace("/src/main.ts", "/src/physics-main.ts") : html,
    },
  ],
  resolve: {
    conditions: nativeBackend ? ["threenative-native"] : [],
  },
});
