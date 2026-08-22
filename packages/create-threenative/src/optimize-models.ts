import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface IOptimizeModelsOptions {
  /** Directory holding the source-of-truth GLBs. Default: assets/models. */
  readonly source?: string;
  /** Directory the optimized copies are written to. Default: public/assets. */
  readonly out?: string;
  /**
   * Turn the whole pass off for this project, e.g. while debugging a model
   * pipeline change. TN_NO_OPTIMIZE_MODELS=1 does the same per invocation,
   * which is handy for one-off builds without editing files.
   */
  readonly disabled?: boolean;
}

/** Structural subset of a Vite plugin; keeps this package dependency-free of Vite. */
export interface IOptimizeModelsVitePlugin {
  readonly name: string;
  configResolved(config: { readonly root: string }): void;
  buildStart(): void;
}

// gltf-transform defaults are wrong for runtime assets twice over: meshopt
// compression needs a decoder wired into GLTFLoader (ctx.assets is
// framework-owned), and the default interleaved vertex layout crashes
// THREE.WebGPURenderer pipeline creation ("Failed to read the 'attributes'
// property from 'GPUVertexState'"). Quantization + WebP decode natively, and
// separate layout costs ~nothing. Graph-altering passes stay off because
// gameplay code resolves bones by name and raycasts against these meshes.
const GLTF_TRANSFORM_FLAGS = [
  "--compress",
  "quantize",
  "--simplify",
  "false",
  "--join",
  "false",
  "--flatten",
  "false",
  "--instance",
  "false",
  "--palette",
  "false",
  "--texture-compress",
  "webp",
  "--texture-size",
  "2048",
  "--vertex-layout",
  "separate",
] as const;

function projectBin(root: string, name: string): string {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return path.join(root, "node_modules", ".bin", `${name}${suffix}`);
}

function staleModels(root: string, sourceDir: string, outDir: string): Array<[string, string]> {
  const absoluteSource = path.resolve(root, sourceDir);
  if (!existsSync(absoluteSource)) return []; // no source models: nothing to do
  const stale: Array<[string, string]> = [];
  for (const entry of readdirSync(absoluteSource)) {
    if (!entry.toLowerCase().endsWith(".glb")) continue;
    const src = path.join(absoluteSource, entry);
    const dst = path.resolve(root, outDir, entry);
    if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs) {
      stale.push([src, dst]);
    }
  }
  return stale;
}

function optimizeStale(root: string, outDir: string, stale: Array<[string, string]>): void {
  const bin = projectBin(root, "gltf-transform");
  if (!existsSync(bin)) {
    console.warn(
      `[optimize-models] ${stale.length} model(s) need optimizing but @gltf-transform/cli is not installed. Run: pnpm add -D @gltf-transform/cli (or set TN_NO_OPTIMIZE_MODELS=1 to skip)`,
    );
    return;
  }
  mkdirSync(path.resolve(root, outDir), { recursive: true });
  for (const [src, dst] of stale) {
    console.log(`[optimize-models] ${path.basename(src)} is stale, re-optimizing`);
    try {
      execFileSync(bin, ["optimize", src, dst, ...GLTF_TRANSFORM_FLAGS], { stdio: "inherit" });
    } catch (error) {
      // Heavy but valid: ship the previous copy rather than fail the build.
      console.warn(`[optimize-models] ${path.basename(src)} failed, shipping previous copy`, error);
    }
  }
}

export function optimizeModels(options: IOptimizeModelsOptions = {}): IOptimizeModelsVitePlugin {
  const sourceDir = options.source ?? "assets/models";
  const outDir = options.out ?? "public/assets";
  let root = "";
  return {
    name: "threenative-optimize-models",
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      if (options.disabled || process.env.TN_NO_OPTIMIZE_MODELS === "1") return;
      const stale = staleModels(root, sourceDir, outDir);
      if (stale.length > 0) optimizeStale(root, outDir, stale);
    },
  };
}
