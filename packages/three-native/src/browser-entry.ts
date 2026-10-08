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
import { type IAudioEngine, defineAudioClasses } from "./audio.js";
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
import { defineReflector } from "./reflector.js";
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

/**
 * three's `shape.holes` is the plain array a game pushes paths into, and the engine's getter answers
 * a copy: each change to the view writes the whole array through the native setter, as the V8
 * facade does, so the geometry built from the shape sees it.
 */
function liveHoles(Shape: { prototype: object } | undefined): void {
  if (Shape === undefined) return;
  const native = Object.getOwnPropertyDescriptor(Shape.prototype, "holes");
  if (native?.get === undefined || native.set === undefined)
    throw new TypeError("TN_BROWSER_UNBOUND: Shape.holes needs the engine's getter and setter");
  const { get, set } = native;
  const views = new WeakMap<object, unknown[]>();
  Object.defineProperty(Shape.prototype, "holes", {
    configurable: true,
    get(this: object) {
      let view = views.get(this);
      if (view === undefined) {
        const shape = this;
        view = new Proxy(get.call(this) as unknown[], {
          set(target, key, value) {
            Reflect.set(target, key, value);
            set.call(shape, [...target]);
            return true;
          },
        });
        views.set(this, view);
      }
      return view;
    },
    set(this: object, value: readonly unknown[]) {
      set.call(this, [...value]);
      views.delete(this);
    },
  });
}

// three's `geometry.attributes` map and `groups` array over the engine's, as the V8 facade gives them:
// one live view per geometry, reading through getAttribute and writing through setAttribute and
// deleteAttribute. ponytail: names are three's standard ones plus those set from JS; a custom name
// only a native loader added is readable by name but not enumerated.
const STANDARD_ATTRIBUTES = [
  "position",
  "normal",
  "uv",
  "uv1",
  "uv2",
  "uv3",
  "color",
  "tangent",
  "skinIndex",
  "skinWeight",
];

interface IGeometryLike {
  hasAttribute(name: string): boolean;
  getAttribute(name: string): unknown;
  setAttribute(name: string, attribute: unknown): unknown;
  deleteAttribute(name: string): unknown;
}

function attributeViews(classes: Readonly<Record<string, { prototype: object }>>): void {
  const base = classes.BufferGeometry?.prototype;
  if (base === undefined) return;
  const authored = new WeakMap<object, Set<string>>();
  const views = new WeakMap<object, object>();
  for (const { prototype } of Object.values(classes)) {
    const own = prototype as Partial<IGeometryLike>;
    if (
      !Object.hasOwn(prototype, "setAttribute") ||
      own.setAttribute === undefined ||
      own.deleteAttribute === undefined
    )
      continue;
    const { setAttribute, deleteAttribute } = own as IGeometryLike;
    // The registry answers `groups` as canonical JSON text (the fixtures' protocol); three's is an
    // array of { start, count, materialIndex }. ponytail: a fresh array per read, as on V8.
    const groups = Object.getOwnPropertyDescriptor(prototype, "groups")?.get;
    if (groups !== undefined)
      Object.defineProperty(prototype, "groups", {
        configurable: true,
        get(this: object) {
          const parsed = JSON.parse(groups.call(this) as string) as {
            start: number;
            count: number;
            materialIndex: number;
          }[];
          return parsed.map(({ start, count, materialIndex }) => ({ start, count, materialIndex }));
        },
      });
    Object.defineProperties(prototype, {
      setAttribute: {
        configurable: true,
        writable: true,
        value(this: IGeometryLike, name: string, attribute: unknown) {
          const names = authored.get(this) ?? new Set<string>();
          authored.set(this, names.add(String(name)));
          return setAttribute.call(this, name, attribute);
        },
      },
      deleteAttribute: {
        configurable: true,
        writable: true,
        value(this: IGeometryLike, name: string) {
          authored.get(this)?.delete(String(name));
          return deleteAttribute.call(this, name);
        },
      },
    });
  }
  Object.defineProperty(base, "attributes", {
    configurable: true,
    get(this: IGeometryLike) {
      const cached = views.get(this);
      if (cached !== undefined) return cached;
      const names = () =>
        [...new Set([...STANDARD_ATTRIBUTES, ...(authored.get(this) ?? [])])].filter((name) =>
          this.hasAttribute(name),
        );
      const view = new Proxy(
        {},
        {
          get: (_, name) =>
            typeof name === "string" && this.hasAttribute(name)
              ? this.getAttribute(name)
              : undefined,
          has: (_, name) => typeof name === "string" && this.hasAttribute(name),
          set: (_, name, attribute) => {
            this.setAttribute(String(name), attribute);
            return true;
          },
          deleteProperty: (_, name) => {
            this.deleteAttribute(String(name));
            return true;
          },
          ownKeys: () => names(),
          getOwnPropertyDescriptor: (_, name) =>
            typeof name === "string" && this.hasAttribute(name)
              ? {
                  value: this.getAttribute(name),
                  writable: true,
                  enumerable: true,
                  configurable: true,
                }
              : undefined,
        },
      );
      views.set(this, view);
      return view;
    },
  });
}

/** Boots the Wasm module and returns every upstream export name bound over it. */
export async function bindWebEngine(
  createModule: () => Promise<TnAbiModule>,
  names: readonly string[],
): Promise<Record<string, unknown>> {
  const module = await createModule();
  const runtime = createWasmRuntime(module);
  const { classes } = defineBrowserClasses(
    registry as IRegistryDump,
    runtime,
    catalogJson as unknown as ICatalog,
  );
  liveHoles(classes.Shape);
  attributeViews(classes);
  // TSL through the engine's shared name table (tn_tsl_call), when the module carries it.
  const tsl = runtime.tsl ? defineTsl(runtime.tsl) : undefined;
  const bound: Record<string, unknown> = {
    ...withTextureSources(classes, runtime),
    ...tsl?.exports,
  };
  // three's audio classes over the engine Object3D and the page's WebAudio; the renderer pushes
  // world poses to WebAudio each frame, where three's own render calls updateMatrixWorld.
  const audio = defineAudioClasses({
    ...(classes as unknown as Omit<IAudioEngine, "read">),
    read: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`TN_AUDIO_FETCH: ${String(response.status)} ${url}`);
      return response.arrayBuffer();
    },
  });
  const { AudioContext, AudioListener, Audio, PositionalAudio, AudioLoader } = audio;
  Object.assign(bound, { AudioContext, AudioListener, Audio, PositionalAudio, AudioLoader });
  // The product host draws; a module without it (the ABI-only test module) keeps the refusal.
  // Before each frame: edited Color/VectorN uniform values reach the engine, world poses WebAudio.
  if (isWebHostModule(module))
    bound.WebGPURenderer = defineWebRenderer(module, classes.Color as never, () => {
      tsl?.sync();
      audio.updateAudio();
    });
  if (tsl !== undefined && runtime.tsl !== undefined) {
    const native = tsl.exports.reflector as (...args: unknown[]) => object;
    bound.reflector = defineReflector(native, classes as never);
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
