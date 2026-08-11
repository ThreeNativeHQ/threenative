import { type AudioLoader, Object3D, Texture, type TextureLoader } from "three";

export interface IAssetLoaderOptions {
  readonly basePath?: string;
  readonly model?: (url: string) => Promise<unknown>;
  readonly texture?: (url: string) => Promise<Texture>;
  readonly audio?: (url: string) => Promise<AudioBuffer>;
}

export interface IAssetLoader {
  model<T = unknown>(path: string): Promise<T>;
  texture(path: string): Promise<Texture>;
  audio(path: string): Promise<AudioBuffer>;
  release(kind: "audio" | "model" | "texture", path: string): boolean;
  clear(): void;
}

function resolvePath(basePath: string, path: string): string {
  if (/^(?:[a-z]+:)?\/\//iu.test(path) || path.startsWith("data:")) return path;
  if (basePath.length === 0) return path;
  return `${basePath.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`;
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
export function createAssetLoader(options: IAssetLoaderOptions = {}): IAssetLoader {
  const basePath = options.basePath ?? "";
  const cache = new Map<string, IAssetEntry>();
  const disposed: IResourceDisposalSets = {
    geometries: new WeakSet(),
    surfaces: new WeakSet(),
    textures: new WeakSet(),
  };

  const cached = <T>(kind: string, path: string, load: (url: string) => Promise<T>): Promise<T> => {
    const url = resolvePath(basePath, path);
    const key = `${kind}:${url}`;
    const existing = cache.get(key);
    if (existing !== undefined) return existing.promise as Promise<T>;
    const entry: IAssetEntry = {
      disposed: false,
      kind: kind as AssetKind,
      loaded: false,
      promise: Promise.resolve().then(() => load(url)),
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
    model: <T = unknown>(path: string) =>
      cached<T>("model", path, async (url) => {
        if (options.model !== undefined) return (await options.model(url)) as T;
        const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
        return (await loadWith(new GLTFLoader(), url)) as T;
      }),
    release: (kind, path) => {
      const key = `${kind}:${resolvePath(basePath, path)}`;
      const entry = cache.get(key);
      if (entry === undefined) return false;
      cache.delete(key);
      releaseEntry(entry);
      return true;
    },
    texture: (path) =>
      cached("texture", path, async (url) => {
        if (options.texture !== undefined) return options.texture(url);
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
