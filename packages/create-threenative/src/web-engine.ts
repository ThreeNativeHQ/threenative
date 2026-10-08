import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The module every `three`, `three/webgpu` and `three/tsl` import becomes under `engine: "native"`. */
export const WEB_ENGINE_ID = "\0threenative:web-engine";
const UPSTREAM = ["three", "three/webgpu", "three/tsl"] as const;
/** The product Wasm entry inside the installed `@threenative/runtime-native` (PRD-540 phase 2). */
export const WASM_ENGINE_ENTRY = "build/web/tn-native-engine-web.mjs";

export interface IWebEnginePlugin {
  readonly name: string;
  readonly enforce: "pre";
  configResolved(config: { readonly root: string }): void;
  resolveId(source: string): string | null;
  load(id: string): Promise<string | null>;
}

/** A browser module: bundled beside this one in `dist`, or the three-native workspace source. */
function browserModule(built: string, source: string): string {
  const bundled = fileURLToPath(new URL(`./${built}`, import.meta.url));
  if (existsSync(bundled)) return bundled;
  const workspace = fileURLToPath(new URL(`../../three-native/src/${source}`, import.meta.url));
  if (existsSync(workspace)) return workspace;
  throw new Error(`TN_WEB_ENGINE_RUNTIME_MISSING: neither ${bundled} nor ${workspace} exists.`);
}

/** The binding runtime every upstream three import resolves through. */
const runtimeModule = () => browserModule("web-engine-runtime.js", "browser-entry.ts");

function wasmModule(root: string): string {
  let entry: string;
  try {
    const require = createRequire(path.join(root, "package.json"));
    entry = path.join(
      path.dirname(require.resolve("@threenative/runtime-native/package.json")),
      WASM_ENGINE_ENTRY,
    );
  } catch {
    throw new Error(
      `TN_WASM_ENGINE_MISSING: engine "native" needs @threenative/runtime-native installed in ${root}.`,
    );
  }
  if (!existsSync(entry))
    throw new Error(
      `TN_WASM_ENGINE_MISSING: engine "native" needs the Wasm engine at ${entry}; build it with \`cmake --preset wasm-browser\` in packages/runtime-native.`,
    );
  return entry;
}

/** Every export name of the project's own upstream three, which the game was written against. */
async function upstreamNames(root: string): Promise<string[]> {
  const require = createRequire(path.join(root, "package.json"));
  const modules = await Promise.all(
    UPSTREAM.map((id) => import(pathToFileURL(require.resolve(id)).href) as Promise<object>),
  );
  return [...new Set(modules.flatMap((module) => Object.keys(module)))]
    .filter((name) => name !== "default")
    .sort();
}

export interface IWebEngineOptions {
  /** The project root; Vite's own root when omitted. */
  readonly root?: string;
  /** `threenative.config.ts`'s `engine`: anything but `"native"` leaves upstream three alone. */
  readonly engine?: "legacy" | "native";
}

/**
 * Routes a web build's upstream three imports to the Wasm engine (PRD-540) when `engine` is
 * `"native"`. Deep imports into three's own source would bundle the upstream engine beside it, so
 * they fail the build. Every template's Vite config lists it, so `pnpm dev` follows the setting.
 */
export function createWebEnginePlugin(options: IWebEngineOptions = {}): IWebEnginePlugin {
  let root = options.root;
  const native = options.engine === "native";
  const projectRoot = (): string => {
    if (root === undefined)
      throw new Error("TN_WEB_ENGINE_ROOT: Vite has not resolved its config yet.");
    return root;
  };
  return {
    name: "threenative-web-engine",
    enforce: "pre",
    configResolved(config) {
      root ??= config.root;
    },
    resolveId(source) {
      if (!native) return null;
      if ((UPSTREAM as readonly string[]).includes(source)) return WEB_ENGINE_ID;
      // The engine's MeshBVH answers picking with its own raycast; the upstream package extends
      // three's math classes and cannot load over the engine.
      if (source === "three-mesh-bvh")
        return browserModule("web-engine-mesh-bvh.js", "addons/mesh-bvh.ts");
      // Upstream's HDRLoader extends DataTextureLoader, which the engine does not bind; this one
      // decodes with the same RGBE parser into an engine DataTexture.
      if (source === "three/addons/loaders/HDRLoader.js")
        return browserModule("web-engine-hdr-loader.js", "addons/hdr-loader.ts");
      if (/^three\/(?:src|build)\//u.test(source))
        throw new Error(
          `TN_NATIVE_UPSTREAM_IMPORT: ${source} would bundle upstream three under engine "native"; import from three, three/webgpu or three/tsl.`,
        );
      return null;
    },
    async load(id) {
      if (!native || id !== WEB_ENGINE_ID) return null;
      const names = await upstreamNames(projectRoot());
      return [
        `import { bindWebEngine } from ${JSON.stringify(runtimeModule())};`,
        `import createModule from ${JSON.stringify(wasmModule(projectRoot()))};`,
        `const engine = await bindWebEngine(createModule, ${JSON.stringify(names)});`,
        `export const { ${names.join(", ")} } = engine;`,
        "",
      ].join("\n");
    },
  };
}
