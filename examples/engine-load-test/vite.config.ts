import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * PRD-464 R3's character, inlined as base64 so one bundle carries it.
 *
 * The Khronos Fox is pinned by `benchmark/engine-load-test/sources.lock.json` and kept in the
 * git-ignored artifact tree, so it is read at build time rather than vendored: the desktop arm
 * ships one import-free ESM file with no VFS to stage into, and the same bytes have to reach the
 * web arm. The hash is the lock's, recomputed here, and a wrong or missing file fails the build
 * instead of producing a bundle that would quietly benchmark a different fox.
 */
const FOX_SHA256 = "d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7";
const FOX_MODULE_ID = "virtual:fox-glb";
// Spelled out rather than imported from `src/ladder.ts`: this config is loaded by esbuild, which
// will not follow the source-tree module specifier. `FOX_SHA256`/`FOX_RELATIVE_PATH` there are the
// same two values, and the runner resolves the path for the Godot arm from that copy.
const DEFAULT_FOX = resolve(
  import.meta.dirname,
  "../../artifacts/engine-load-test/prd-449/bevy/src/assets/models/animated/Fox.glb",
);

function foxGlb(): Plugin {
  const file = process.env.TN_BENCH_FOX ?? DEFAULT_FOX;
  return {
    enforce: "pre",
    load(id) {
      if (id !== FOX_MODULE_ID) return;
      let bytes: Buffer;
      try {
        bytes = readFileSync(file);
      } catch (error) {
        throw new Error(
          `TN_BENCH_FOX_MISSING: ${file} could not be read (${error instanceof Error ? error.message : String(error)}).`,
        );
      }
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== FOX_SHA256)
        throw new Error(`TN_BENCH_FOX_HASH: ${file} is ${digest}, not the pinned ${FOX_SHA256}.`);
      return `export default ${JSON.stringify(bytes.toString("base64"))};\n`;
    },
    name: "tn-bench-fox-glb",
    resolveId(id) {
      return id === FOX_MODULE_ID ? FOX_MODULE_ID : undefined;
    },
  };
}

// The native arm is one import-free ESM file, the same contract `examples/native-smoke` asserts.
// The ladder is compiled in rather than read from a query string: a native host has no URL.
function integers(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.split(",").map((part) => {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0)
      throw new Error(`${name} must be a comma-separated list of non-negative integers.`);
    return value;
  });
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer, received '${raw}'.`);
  return value;
}

function modes(): string[] {
  const raw = process.env.TN_BENCH_MODES ?? "L1,L2,L3";
  return raw.split(",").map((part) => {
    // L4 is the per-cube-material rung and R1-R5 are PRD-464's realistic-scene ladder; both lists
    // are spelled out here because this config is loaded by esbuild, which will not follow a
    // `./src/workload.js` specifier.
    if (part !== "L1" && part !== "L2" && part !== "L3" && part !== "L4" && !/^R[1-5]$/u.test(part))
      throw new Error(`TN_BENCH_MODES holds an unknown mode '${part}'.`);
    return part;
  });
}

const native = process.env.TN_BENCH_TARGET === "native";

// Shipped as raw strings: the runtime resolves them through `parseAxesRecord`, the same parser the
// web entry uses, so an unset axis and a defaulted one cannot diverge between the runtimes.
function axesEnvironment(): Record<string, string | undefined> {
  return {
    geometry: process.env.TN_BENCH_GEOMETRY,
    hierarchyDepth: process.env.TN_BENCH_HIERARCHY_DEPTH,
    material: process.env.TN_BENCH_MATERIAL,
    mutationRate: process.env.TN_BENCH_MUTATION_RATE,
    passCount: process.env.TN_BENCH_PASSES,
    shadowCasterShare: process.env.TN_BENCH_SHADOW_CASTER_SHARE,
    visibleFraction: process.env.TN_BENCH_VISIBLE_FRACTION,
  };
}

export default defineConfig({
  // The plugin only reads the file when a graph actually imports it, so `plain.html` — which never
  // does — costs nothing and the control arm is not made to carry a character it will not draw.
  plugins: [foxGlb()],
  build: native
    ? {
        lib: {
          entry: resolve(import.meta.dirname, "src/native.ts"),
          // Per-target filename: the desktop and Android arms build from the same source, and a
          // shared name means one arm's rebuild silently replaces the bundle the other is running.
          fileName: () => `engine-load-test-${process.env.TN_BENCH_PLATFORM ?? "desktop"}.js`,
          formats: ["es"],
        },
        minify: false,
        rollupOptions: { output: { codeSplitting: false } },
        target: "es2022",
      }
    : {
        rollupOptions: {
          input: {
            loadTest: resolve(import.meta.dirname, "index.html"),
            // The plain-Three control is a second entry on the same build, so both arms are served
            // from one `dist` out of one `vite build` and differ only in their module graph.
            plain: resolve(import.meta.dirname, "plain.html"),
            projectionConformance: resolve(import.meta.dirname, "projection-conformance.html"),
          },
        },
      },
  define: {
    // The native host has no `navigator`, so the target is stamped at build time. `--arm` on the
    // collector never sets it: the arm a report claims comes from the binary that ran.
    __TN_PLATFORM__: JSON.stringify(process.env.TN_BENCH_PLATFORM ?? "desktop"),
    __TN_BENCH_CONFIG__: JSON.stringify({
      animate: process.env.TN_BENCH_ANIMATE !== "off",
      axes: axesEnvironment(),
      // Stated by the operator, because the host does not expose it. The Pixel 8 used for PRD-117
      // runs at 120 Hz; a desktop under xvfb is 60.
      refreshHz: integer("TN_BENCH_REFRESH_HZ", 60),
      // The host surface the run was given, recorded on the report as `display`. R1-R4 render
      // smaller than this inside it — R5 is R4 at 1920x1080 — and the per-rung `ladder.resolution`
      // is what says which was actually drawn.
      width: integer("TN_BENCH_WIDTH", 1280),
      height: integer("TN_BENCH_HEIGHT", 720),
      frames: integer("TN_BENCH_FRAMES", 600),
      ladder: integers("TN_BENCH_LADDER", [256, 1024, 4096, 16384]),
      modes: modes(),
      repeats: integer("TN_BENCH_REPEATS", 3),
      warmup: integer("TN_BENCH_WARMUP", 120),
    }),
  },
});
