import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The module every `three`, `three/webgpu` and `three/tsl` import becomes under `engine: "native"`. */
export const WEB_ENGINE_ID = "\0threenative:web-engine";
const UPSTREAM = ["three", "three/webgpu", "three/tsl"] as const;
/** The product Wasm entry inside the installed `@threenative/runtime-native` (PRD-540 phase 2). */
export const WASM_ENGINE_ENTRY = "wasm/tn-native-engine-web.mjs";

export interface IWebEnginePlugin {
  readonly name: string;
  readonly enforce: "pre";
  resolveId(source: string): string | null;
  load(id: string): Promise<string | null>;
}

/** The binding runtime: bundled beside this module in `dist`, or the workspace source. */
function runtimeModule(): string {
  const built = fileURLToPath(new URL("./web-engine-runtime.js", import.meta.url));
  if (existsSync(built)) return built;
  const source = fileURLToPath(new URL("../../three-native/src/browser-entry.ts", import.meta.url));
  if (existsSync(source)) return source;
  throw new Error(`TN_WEB_ENGINE_RUNTIME_MISSING: neither ${built} nor ${source} exists.`);
}

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

/**
 * Routes a web build's upstream three imports to the Wasm engine (PRD-540). Deep imports into
 * three's own source would bundle the upstream engine beside it, so they fail the build.
 */
export function createWebEnginePlugin(root: string): IWebEnginePlugin {
  return {
    name: "threenative-web-engine",
    enforce: "pre",
    resolveId(source) {
      if ((UPSTREAM as readonly string[]).includes(source)) return WEB_ENGINE_ID;
      if (/^three\/(?:src|build)\//u.test(source))
        throw new Error(
          `TN_NATIVE_UPSTREAM_IMPORT: ${source} would bundle upstream three under engine "native"; import from three, three/webgpu or three/tsl.`,
        );
      return null;
    },
    async load(id) {
      if (id !== WEB_ENGINE_ID) return null;
      const names = await upstreamNames(root);
      return [
        `import { bindWebEngine } from ${JSON.stringify(runtimeModule())};`,
        `import createModule from ${JSON.stringify(wasmModule(root))};`,
        `const engine = await bindWebEngine(createModule, ${JSON.stringify(names)});`,
        `export const { ${names.join(", ")} } = engine;`,
        "",
      ].join("\n");
    },
  };
}
