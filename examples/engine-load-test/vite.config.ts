import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

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
    if (part !== "L1" && part !== "L2" && part !== "L3")
      throw new Error(`TN_BENCH_MODES holds an unknown mode '${part}'.`);
    return part;
  });
}

// The Godot culling fixture is exported by the Godot arm and read here as bytes, so the counterpart
// arm hashes the same file the competitor rendered instead of a second implementation of Godot's RNG.
function fixtureJson(): string {
  const path = process.env.TN_CULL_FIXTURE;
  if (path === undefined || path.trim() === "")
    throw new Error("TN_CULL_FIXTURE must name the Godot-exported culling fixture.");
  return readFileSync(path, "utf8");
}

const native = process.env.TN_BENCH_TARGET === "native";
const nativeMesh = process.env.TN_BENCH_TARGET === "native-mesh";
const nativeCull = process.env.TN_BENCH_TARGET === "native-cull";

export default defineConfig({
  build:
    native || nativeMesh || nativeCull
      ? {
          lib: {
            entry: resolve(
              import.meta.dirname,
              nativeCull
                ? "src/cull-native.ts"
                : nativeMesh
                  ? "src/mesh-native.ts"
                  : "src/native.ts",
            ),
            // Per-target filename: the desktop and Android arms build from the same source, and a
            // shared name means one arm's rebuild silently replaces the bundle the other is running.
            fileName: () =>
              `engine-load-test-${nativeCull ? "cull-" : nativeMesh ? "mesh-" : ""}${process.env.TN_BENCH_PLATFORM ?? "desktop"}.js`,
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
              meshPlain: resolve(import.meta.dirname, "mesh-plain.html"),
              meshTn: resolve(import.meta.dirname, "mesh-tn.html"),
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
      // Stated by the operator, because the host does not expose it. The Pixel 8 used for PRD-117
      // runs at 120 Hz; a desktop under xvfb is 60.
      refreshHz: integer("TN_BENCH_REFRESH_HZ", 60),
      frames: integer("TN_BENCH_FRAMES", 600),
      ladder: integers("TN_BENCH_LADDER", [256, 1024, 4096, 16384]),
      modes: modes(),
      repeats: integer("TN_BENCH_REPEATS", 3),
      warmup: integer("TN_BENCH_WARMUP", 120),
    }),
    ...(nativeCull
      ? {
          __TN_CULL_CONFIG__: JSON.stringify({
            authoring: process.env.TN_CULL_AUTHORING ?? "scene-node-independent",
            fixtureJson: fixtureJson(),
            frames: integer("TN_CULL_FRAMES", 600),
            variant: process.env.TN_CULL_VARIANT ?? "basic_cull",
            warmup: integer("TN_CULL_WARMUP", 120),
          }),
        }
      : {}),
    __TN_MESH_CONFIG__: JSON.stringify({
      count: integer("TN_MESH_COUNT", 1000),
      frames: integer("TN_MESH_FRAMES", 600),
      variant: process.env.TN_MESH_VARIANT ?? "rotating",
      warmup: integer("TN_MESH_WARMUP", 120),
    }),
  },
});
