/**
 * What a web game's `three`, `three/webgpu` and `three/tsl` imports become under
 * `engine: "native"` (PRD-540): every upstream export name, bound to the Wasm engine or refused.
 *
 * Registry classes come from the browser-JS back end and catalog constants keep their values. Every
 * other name is a stub that throws its catalog diagnostic the moment it is called, constructed or
 * read through, so a game bundles and an unbound symbol fails loudly. Nothing here imports upstream
 * three, so no name can fall back to it.
 */
import catalogJson from "../api/catalog.json" with { type: "json" };
import registry from "../api/native-registry.json" with { type: "json" };
import {
  type IRegistryDump,
  type TnAbiModule,
  createWasmRuntime,
  defineBrowserClasses,
} from "./browser-backend.js";
import { defineWebRenderer, isWebHostModule } from "./browser-renderer.js";
import type { CatalogEntry, ICatalog } from "./catalog.js";

const UPSTREAM_SOURCES = new Set(["three", "three/webgpu", "three/tsl"]);

/** A value that throws `diagnostic` on any call, construction or property access. */
function refused(name: string, diagnostic: string): unknown {
  const fail = (): never => {
    throw new Error(`${diagnostic}: ${name} is not available on the Wasm engine.`);
  };
  return new Proxy(function refusedExport() {}, {
    apply: fail,
    construct: fail,
    get: fail,
    set: fail,
    has: fail,
    ownKeys: fail,
    getPrototypeOf: fail,
    defineProperty: fail,
    deleteProperty: fail,
    getOwnPropertyDescriptor: fail,
  });
}

function constantValue(entry: CatalogEntry): unknown {
  if (entry.kind !== "constant" || entry.status.kind === "unsupported") return undefined;
  return typeof entry.value === "string" ? JSON.parse(entry.value) : entry.value;
}

/** Binds each upstream export name to an engine class, a catalog constant, or a refusal. */
export function bindUpstreamExports(
  names: readonly string[],
  catalog: Pick<ICatalog, "entries">,
  classes: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const entries = new Map(
    catalog.entries
      .filter((entry) => UPSTREAM_SOURCES.has(entry.source))
      .map((entry) => [entry.name, entry]),
  );
  const bound: Record<string, unknown> = {};
  for (const name of names) {
    const entry = entries.get(name);
    if (Object.hasOwn(classes, name)) bound[name] = classes[name];
    else if (entry !== undefined && constantValue(entry) !== undefined)
      bound[name] = constantValue(entry);
    else
      bound[name] = refused(
        name,
        entry?.status.kind === "unsupported"
          ? entry.status.diagnostic
          : `TN_NATIVE_${entry === undefined ? "UNCATALOGUED" : "UNBOUND"}_${name.toUpperCase()}`,
      );
  }
  return bound;
}

/** Boots the Wasm module and returns every upstream export name bound over it. */
export async function bindWebEngine(
  createModule: () => Promise<TnAbiModule>,
  names: readonly string[],
): Promise<Record<string, unknown>> {
  const module = await createModule();
  const { classes } = defineBrowserClasses(
    registry as IRegistryDump,
    createWasmRuntime(module),
    catalogJson as unknown as ICatalog,
  );
  // The product host draws; a module without it (the ABI-only test module) keeps the refusal.
  const bound: Record<string, unknown> = { ...classes };
  if (isWebHostModule(module))
    bound.WebGPURenderer = defineWebRenderer(module, classes.Color as never);
  return bindUpstreamExports(names, catalogJson as unknown as ICatalog, bound);
}
