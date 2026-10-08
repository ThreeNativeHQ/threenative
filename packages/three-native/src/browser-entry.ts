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
import { DataUtils } from "./addons/data-utils.js";
import {
  type IBrowserRuntime,
  type IRegistryDump,
  TSL_NODE,
  type TnAbiModule,
  createWasmRuntime,
  defineBrowserClasses,
} from "./browser-backend.js";
import { RENDER_AGAIN, defineWebRenderer, isWebHostModule } from "./browser-renderer.js";
import { type ITslRuntime, defineTsl, isTslNode } from "./browser-tsl.js";
import type { CatalogEntry, ICatalog } from "./catalog.js";
import { Material, defineObjectSurface } from "./object-surface.js";
import { defineTextureSources } from "./texture-sources.js";

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
  const runtime = createWasmRuntime(module);
  const { classes, wrap } = defineBrowserClasses(
    registry as IRegistryDump,
    runtime,
    catalogJson as unknown as ICatalog,
  );
  // attributes/groups, shape.holes and the abstract Material, as on the V8 player (object-surface.ts).
  const entries = (catalogJson as unknown as ICatalog).entries;
  const extending = (base: string) =>
    entries
      .filter(
        (entry) =>
          entry.kind === "class" && entry.extends === base && classes[entry.name] !== undefined,
      )
      .map((entry) => classes[entry.name] as new (...args: never[]) => object);
  if (classes.BufferGeometry !== undefined)
    defineObjectSurface({
      bufferGeometry: classes.BufferGeometry,
      geometries: extending("BufferGeometry"),
      ...(classes.Shape === undefined ? {} : { shape: classes.Shape }),
      materials: extending("Material"),
    });
  // TSL through the engine's shared name table (tn_tsl_call), when the module carries it.
  const tsl = runtime.tsl ? defineTsl(runtime.tsl) : undefined;
  const bound: Record<string, unknown> = {
    ...withTextureSources(classes, runtime),
    ...tsl?.exports,
  };
  bound.Material = Material;
  // The product host draws; a module without it (the ABI-only test module) keeps the refusal.
  // Edited Color/VectorN uniform values reach the engine before each frame.
  if (isWebHostModule(module))
    bound.WebGPURenderer = defineWebRenderer(module, classes.Color as never, tsl?.sync);
  // A GLB through the engine's own glTF loader, for the web GLTFLoader (addons/gltf-loader-web.ts).
  const { loadGltf } = runtime;
  if (loadGltf !== undefined)
    bound.__tnLoadGltf = (bytes: Uint8Array) => {
      const loaded = loadGltf.call(runtime, bytes);
      return { scene: wrap(loaded.scene), animations: loaded.animations.map(wrap) };
    };
  if (tsl !== undefined && runtime.tsl !== undefined) {
    // The engine's TSL functions three does not export by name (ao, bloom, ...), for the shared post
    // effects (addons/post-effects-web.ts), and three's RenderPipeline over the web host.
    bound.__tnTsl = tsl.exports;
    bound.RenderPipeline = defineRenderPipeline(runtime.tsl);
  }
  return bindUpstreamExports(names, catalogJson as unknown as ICatalog, bound);
}

/**
 * The engine classes plus what plain JS adds over them: three's texture sources (typed array,
 * canvas, image, ImageBitmapLoader) and `DataUtils`, which touches no engine object at all.
 */
export function withTextureSources(
  classes: Readonly<Record<string, unknown>>,
  runtime: IBrowserRuntime,
): Record<string, unknown> {
  return { ...classes, ...defineTextureSources(classes, runtime), DataUtils };
}

/**
 * three's RenderPipeline on the Wasm engine, as on the V8 player: render() hands the output graph to
 * the web host, which draws it between the scene and the output, then draws the renderer's last
 * scene. ponytail: the scene comes from the renderer's last render() until `pass(scene, camera)` is
 * in the shared table (lane-531); then it comes from the graph.
 */
function defineRenderPipeline(tsl: ITslRuntime) {
  return class RenderPipeline {
    outputNode: unknown;
    readonly renderer: { [RENDER_AGAIN]?: () => void };

    constructor(renderer: { [RENDER_AGAIN]?: () => void }, outputNode?: unknown) {
      this.renderer = renderer;
      this.outputNode = outputNode;
    }

    render(): void {
      if (!isTslNode(this.outputNode))
        throw new TypeError("TN_WASM_POST: RenderPipeline.outputNode is not a TSL node");
      tsl.setPost(this.outputNode[TSL_NODE]);
      this.renderer[RENDER_AGAIN]?.();
    }

    dispose(): void {
      tsl.setPost(null);
    }
  };
}
