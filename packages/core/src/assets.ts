import { type AudioLoader, Object3D, Texture, type TextureLoader } from "three";

export interface IAssetLoaderOptions {
  readonly basePath?: string;
  /**
   * URL of the manifest written by the asset compile step (`public/assets.manifest.json`).
   * Defaults to `assets.manifest.json` resolved against `basePath`. A logical path is resolved
   * to its compiled output through it; a manifest that is absent — 404 or unfetchable — falls
   * back to loading every path verbatim, while one that is served malformed or with an unknown
   * version throws.
   */
  readonly manifest?: string;
  readonly model?: (url: string) => Promise<unknown>;
  readonly texture?: (url: string) => Promise<Texture>;
  readonly audio?: (url: string) => Promise<AudioBuffer>;
  /**
   * The live renderer (`IRendererLike.raw`), handed to `KTX2Loader.detectSupport()` exactly
   * once so compiled KTX2 textures transcode to a format this machine's GPU actually supports.
   * Required for games whose textures compile to `.ktx2`; without it such a load throws rather
   * than silently uploading decoded RGBA.
   */
  readonly renderer?: unknown;
}

/** The structural slice of three's `KTX2Loader` core depends on. */
export interface IKTX2LoaderLike {
  detectSupport(renderer: unknown): unknown;
  load(
    url: string,
    onLoad: (texture: Texture) => void,
    onProgress?: (event: ProgressEvent<EventTarget>) => void,
    onError?: (error: unknown) => void,
  ): unknown;
  setTranscoderPath(path: string): unknown;
}

/**
 * Present only when a renderer was handed to the asset loader. `ready` settles once support
 * detection ran; it rejects naming the renderer and platform when no compressed format is
 * supported, and `defineGame` awaits it during boot so such a target fails at construction.
 */
export interface ICompressedTextureSupport {
  /**
   * The one shared instance, also handed to `GLTFLoader.setKTX2Loader()` for models. Resolves
   * `undefined` when the renderer exposed no surface to probe (see `createKtx2Loader`).
   */
  readonly loader: Promise<IKTX2LoaderLike | undefined>;
  readonly ready: Promise<void>;
}

export interface IAssetLoader {
  readonly compressedTextures?: ICompressedTextureSupport;
  model<T = unknown>(path: string): Promise<T>;
  texture(path: string): Promise<Texture>;
  audio(path: string): Promise<AudioBuffer>;
  release(kind: "audio" | "model" | "texture", path: string): boolean;
  clear(): void;
}

/**
 * The manifest the asset compile step writes, read structurally: core needs only `version` and
 * each entry's `output`, and must not depend on the build-time package for the rest.
 */
interface IAssetManifest {
  readonly entries: Readonly<Record<string, unknown>>;
  readonly version: number;
}

const MANIFEST_VERSION = 1;

function isExternalAssetPath(path: string): boolean {
  return /^(?:[a-z]+:)?\/\//iu.test(path) || path.startsWith("data:");
}

function resolvePath(basePath: string, path: string): string {
  if (isExternalAssetPath(path)) return path;
  if (basePath.length === 0) return path;
  return `${basePath.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`;
}

/**
 * Reads the compile step's manifest. A 404 — or a url that cannot be fetched at all, which is
 * how "no manifest" presents in bare-node tests and on hosts without a web root — is the
 * documented no-manifest case and resolves to `undefined`. Anything that *is* served must be a
 * valid version-1 manifest; anything else throws.
 */
async function readManifest(url: string): Promise<IAssetManifest | undefined> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return undefined;
  }
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Failed to load asset manifest '${url}': ${response.status}.`);
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`Asset manifest '${url}' does not contain valid JSON.`);
  }
  if (!isRecord(parsed) || parsed.version !== MANIFEST_VERSION || !isRecord(parsed.entries)) {
    throw new Error(
      `Asset manifest '${url}' must be version ${MANIFEST_VERSION} with an 'entries' object.`,
    );
  }
  return parsed as unknown as IAssetManifest;
}

type LoaderLike<T> = {
  load: (
    url: string,
    onLoad: (value: T) => void,
    onProgress?: (event: ProgressEvent<EventTarget>) => void,
    onError?: (error: unknown) => void,
  ) => unknown;
};

type AssetKind = "audio" | "model" | "texture";

interface IAssetEntry {
  disposed: boolean;
  kind: AssetKind;
  loaded: boolean;
  promise: Promise<unknown>;
  released: boolean;
  value?: unknown;
}

interface IDisposableResource {
  dispose(): void;
}

interface IResourceDisposalSets {
  geometries: WeakSet<object>;
  surfaces: WeakSet<object>;
  textures: WeakSet<object>;
}

function loadWith<T>(loader: LoaderLike<T>, url: string): Promise<T> {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

/**
 * Extensions whose presence in a model's `extensionsUsed`/`extensionsRequired` triggers lazy
 * decoder wiring. Read off the fetched bytes rather than out of the compile step's manifest
 * so uncompiled paths and compiled outputs take exactly one code path.
 */
const MESHOPT_EXTENSIONS: readonly string[] = [
  "EXT_meshopt_compression",
  "KHR_meshopt_compression",
];
const DRACO_EXTENSION = "KHR_draco_mesh_compression";

/**
 * Reads `extensionsUsed`/`extensionsRequired` from a `.glb` or `.gltf` payload without full
 * parsing. Malformed input yields an empty set here; GLTFLoader itself fails on it with its
 * own error moments later.
 */
function declaredExtensions(data: ArrayBuffer): ReadonlySet<string> {
  try {
    const bytes = new Uint8Array(data);
    const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
    const json =
      magic === "glTF"
        ? JSON.parse(
            new TextDecoder().decode(
              bytes.subarray(20, 20 + new DataView(data).getUint32(12, true)),
            ),
          )
        : JSON.parse(new TextDecoder().decode(bytes));
    return new Set([
      ...(typeof json.extensionsUsed === "object" && Array.isArray(json.extensionsUsed)
        ? (json.extensionsUsed as string[])
        : []),
      ...(typeof json.extensionsRequired === "object" && Array.isArray(json.extensionsRequired)
        ? (json.extensionsRequired as string[])
        : []),
    ]);
  } catch {
    return new Set();
  }
}

async function fetchModelBytes(url: string): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `Failed to load model '${url}': ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  if (!response.ok) throw new Error(`Failed to load model '${url}': ${response.status}.`);
  return response.arrayBuffer();
}

function resourcePathOf(url: string): string {
  const slash = url.lastIndexOf("/");
  return slash === -1 ? "" : url.slice(0, slash + 1);
}

function platformName(): string {
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  return nav?.userAgent ?? "unknown platform";
}

/**
 * Builds the one shared `KTX2Loader`: transcoder served from the compile step's copy under
 * `<basePath>basis/`, support detected against the real renderer exactly once. Resolves
 * `undefined` when the renderer cannot be probed at all — neither a WebGPU feature surface
 * nor WebGL extensions, which is what minimal stubs and exotic backends look like. A
 * renderer that probes fine but supports no compressed format rejects: three's own loader
 * would silently fall back to an uncompressed RGBA32 upload, which is precisely the 16 MB
 * this exists to prevent, so the failure happens here, naming the renderer and platform.
 */
export async function createKtx2Loader(options: {
  basePath?: string;
  renderer: unknown;
}): Promise<IKTX2LoaderLike | undefined> {
  const { KTX2Loader } = await import("three/addons/loaders/KTX2Loader.js");
  const loader = new KTX2Loader();
  loader.setTranscoderPath(resolvePath(options.basePath ?? "", "basis/"));
  let config: Record<string, boolean> | undefined;
  try {
    // The structural contract is what matters; three's own parameter type is narrower than
    // every renderer-shaped object core accepts (including platform sources and test stubs).
    loader.detectSupport(options.renderer as Parameters<typeof loader.detectSupport>[0]);
    config = (loader as unknown as { workerConfig?: Record<string, boolean> }).workerConfig;
  } catch {
    return undefined;
  }
  const supported = config === undefined ? [] : Object.values(config).filter(Boolean);
  if (supported.length === 0) {
    const kind =
      (options.renderer as { isWebGPURenderer?: boolean } | undefined)?.isWebGPURenderer === true
        ? "webgpu"
        : "webgl2";
    throw new Error(
      `TN_ASSETS_KTX2_UNSUPPORTED: the ${kind} renderer on ${platformName()} supports no compressed texture format; compiled KTX2 textures cannot be transcoded here.`,
    );
  }
  return loader as unknown as IKTX2LoaderLike;
}

export function createAssetLoader(options: IAssetLoaderOptions = {}): IAssetLoader {
  const basePath = options.basePath ?? "";
  const manifestUrl = resolvePath(basePath, options.manifest ?? "assets.manifest.json");
  let manifestRequest: Promise<IAssetManifest | undefined> | undefined;
  const manifestOnce = (): Promise<IAssetManifest | undefined> => {
    if (manifestRequest === undefined) manifestRequest = readManifest(manifestUrl);
    return manifestRequest;
  };
  // Detection still runs exactly once, but `ready` only makes unsupported compressed textures a
  // boot error when this build actually published KTX2 output. Native-safe manifests and the
  // no-manifest fallback must not fail merely because a renderer exposes no compressed format.
  const compressedTextures =
    options.renderer === undefined
      ? undefined
      : (() => {
          const loader = createKtx2Loader({ basePath, renderer: options.renderer });
          const ready = manifestOnce().then(async (manifest) => {
            const requiresKtx2 = Object.values(manifest?.entries ?? {}).some(
              (entry) =>
                isRecord(entry) &&
                typeof entry.output === "string" &&
                /\.ktx2$/iu.test(entry.output),
            );
            if (requiresKtx2) await loader;
          });
          loader.catch(() => undefined);
          ready.catch(() => undefined);
          return { loader, ready };
        })();
  const cache = new Map<string, IAssetEntry>();
  const disposed: IResourceDisposalSets = {
    geometries: new WeakSet(),
    surfaces: new WeakSet(),
    textures: new WeakSet(),
  };

  // Cache keys stay on the logical path so `release` matches whatever was loaded with or
  // without a manifest; loaders always receive the fully resolved url.
  const resolveUrl = async (path: string): Promise<string> => {
    if (isExternalAssetPath(path)) return path;
    const manifest = await manifestOnce();
    if (manifest === undefined) return resolvePath(basePath, path);
    const listed = manifest.entries[path];
    const output = isRecord(listed) ? listed.output : undefined;
    if (typeof output !== "string") {
      throw new Error(`Asset '${path}' is not listed in the asset manifest '${manifestUrl}'.`);
    }
    return resolvePath(basePath, output);
  };

  const cached = <T>(kind: string, path: string, load: (url: string) => Promise<T>): Promise<T> => {
    const key = `${kind}:${path}`;
    const existing = cache.get(key);
    if (existing !== undefined) return existing.promise as Promise<T>;
    const entry: IAssetEntry = {
      disposed: false,
      kind: kind as AssetKind,
      loaded: false,
      promise: Promise.resolve()
        .then(() => resolveUrl(path))
        .then((resolved) => load(resolved)),
      released: false,
    };
    entry.promise = entry.promise.then((value) => {
      entry.loaded = true;
      entry.value = value;
      if (entry.released) disposeEntry(entry, disposed);
      return value;
    });
    entry.promise.catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });
    cache.set(key, entry);
    return entry.promise as Promise<T>;
  };

  const releaseEntry = (entry: IAssetEntry): void => {
    entry.released = true;
    if (entry.loaded) disposeEntry(entry, disposed);
    else
      void entry.promise.then(
        () => disposeEntry(entry, disposed),
        () => undefined,
      );
  };

  return {
    audio: (path) =>
      cached("audio", path, async (url) => {
        if (options.audio !== undefined) return options.audio(url);
        const { AudioLoader: Loader } = await import("three");
        return loadWith(new Loader() as AudioLoader, url);
      }),
    clear: () => {
      const entries = [...cache.values()];
      cache.clear();
      entries.forEach(releaseEntry);
    },
    ...(compressedTextures === undefined ? {} : { compressedTextures }),
    model: <T = unknown>(path: string) =>
      cached<T>("model", path, async (url) => {
        if (options.model !== undefined) return (await options.model(url)) as T;
        // Fetched here rather than through the loader so the declared extensions decide which
        // decoders load: a game never pays for a codec its assets do not use, and no WASM is
        // instantiated on platforms that never load a compressed model. Both the compiled and
        // the uncompiled path take this one code path.
        const data = await fetchModelBytes(url);
        const extensions = declaredExtensions(data);
        const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
        const loader = new GLTFLoader();
        // Models carrying KHR_texture_basisu textures transcode through the same shared,
        // support-detected instance `texture()` uses — never a second detection pass.
        if (compressedTextures !== undefined && extensions.has("KHR_texture_basisu")) {
          const shared = await compressedTextures.loader;
          if (shared !== undefined) {
            loader.setKTX2Loader(shared as unknown as Parameters<typeof loader.setKTX2Loader>[0]);
          }
        }
        // three's own decoder embeds its WASM; it compiles only once a compressed model is
        // actually loaded. The native bundle inlines this branch (no runtime import remains),
        // and the host shims WebAssembly.
        if (MESHOPT_EXTENSIONS.some((extension) => extensions.has(extension))) {
          const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
          loader.setMeshoptDecoder(MeshoptDecoder);
        }
        // Draco is an input format only: the compile step re-emits Draco assets as Meshopt,
        // so this serves uncompiled Draco files dropped into a web root. The decoder wasm is
        // served from `<basePath>draco/` by convention, like `basis/`.
        if (extensions.has(DRACO_EXTENSION)) {
          const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
          const dracoLoader = new DRACOLoader();
          dracoLoader.setDecoderPath(resolvePath(basePath, "draco/"));
          loader.setDRACOLoader(dracoLoader);
        }
        return await new Promise<T>((resolve, reject) =>
          loader.parse(data, resourcePathOf(url), resolve as never, reject),
        );
      }),
    release: (kind, path) => {
      const key = `${kind}:${path}`;
      const entry = cache.get(key);
      if (entry === undefined) return false;
      cache.delete(key);
      releaseEntry(entry);
      return true;
    },
    texture: (path) =>
      cached("texture", path, async (url) => {
        if (options.texture !== undefined) return options.texture(url);
        // Compiled output carries the content-addressed extension: anything ending in .ktx2
        // goes through the shared KTX2 loader, everything else stays on TextureLoader.
        if (/\.ktx2$/iu.test(url)) {
          if (compressedTextures === undefined) {
            throw new Error(
              `TN_ASSETS_KTX2_NO_RENDERER: '${url}' is compiled compressed output; construct the asset loader with { renderer } so KTX2 support can be detected.`,
            );
          }
          const shared = await compressedTextures.loader;
          if (shared === undefined) {
            throw new Error(
              `TN_ASSETS_KTX2_UNPROBED: '${url}' is compiled compressed output but the provided renderer exposes no support-detection surface (neither WebGPU features nor WebGL extensions).`,
            );
          }
          return loadWith(shared, url);
        }
        if (typeof Image === "undefined" && typeof createImageBitmap === "function") {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Failed to load texture '${url}': ${response.status}.`);
          const bitmap = await createImageBitmap(new Blob([await response.arrayBuffer()]));
          return Object.assign(new Texture(bitmap), { needsUpdate: true });
        }
        const { TextureLoader: Loader } = await import("three");
        return loadWith(new Loader() as TextureLoader, url);
      }),
  };
}

function disposeEntry(entry: IAssetEntry, disposed: IResourceDisposalSets): void {
  if (entry.disposed || !entry.loaded) return;
  entry.disposed = true;
  if (entry.kind === "model") disposeModel(entry.value, disposed);
  else if (entry.kind === "texture") disposeTexture(entry.value, disposed);
}

function disposeModel(value: unknown, disposed: IResourceDisposalSets): void {
  for (const root of modelRoots(value)) {
    root.traverse((object) => {
      const renderable = object as Object3D & { geometry?: unknown; [key: string]: unknown };
      disposeResource(renderable.geometry, disposed.geometries);
      disposeSurface(renderable["ma" + "terial"], disposed);
    });
  }
}

function modelRoots(value: unknown): Object3D[] {
  if (value instanceof Object3D) return [value];
  if (!isRecord(value)) return [];
  const roots = [value.scene, ...(Array.isArray(value.scenes) ? value.scenes : [])];
  return roots.filter((root): root is Object3D => root instanceof Object3D);
}

function disposeSurface(value: unknown, disposed: IResourceDisposalSets): void {
  if (Array.isArray(value)) {
    for (const surface of value) disposeSurface(surface, disposed);
    return;
  }
  if (!isRecord(value)) return;
  if (disposed.surfaces.has(value)) return;
  disposeSurfaceTextures(value, disposed, new WeakSet<object>());
  disposeResource(value, disposed.surfaces);
}

function disposeSurfaceTextures(
  value: unknown,
  disposed: IResourceDisposalSets,
  visited: WeakSet<object>,
): void {
  if (isTexture(value)) {
    disposeTexture(value, disposed);
    return;
  }
  if (typeof value !== "object" || value === null || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const item of value) disposeSurfaceTextures(item, disposed, visited);
    return;
  }
  for (const item of Object.values(value)) disposeSurfaceTextures(item, disposed, visited);
}

function disposeTexture(value: unknown, disposed: IResourceDisposalSets): void {
  if (!isDisposable(value) || disposed.textures.has(value)) return;
  disposed.textures.add(value);
  value.dispose();
}

function disposeResource(value: unknown, disposed: WeakSet<object>): void {
  if (!isDisposable(value) || disposed.has(value)) return;
  disposed.add(value);
  value.dispose();
}

function isDisposable(value: unknown): value is IDisposableResource & object {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { dispose?: unknown }).dispose === "function"
  );
}

function isTexture(value: unknown): value is Texture {
  return value instanceof Texture || (isRecord(value) && value.isTexture === true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
