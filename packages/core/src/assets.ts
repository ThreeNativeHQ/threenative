import { type AudioLoader, Texture, type TextureLoader } from "three";

export interface AssetLoaderOptions {
  readonly basePath?: string;
  readonly model?: (url: string) => Promise<unknown>;
  readonly texture?: (url: string) => Promise<Texture>;
  readonly audio?: (url: string) => Promise<AudioBuffer>;
}

export interface AssetLoader {
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

function loadWith<T>(loader: LoaderLike<T>, url: string): Promise<T> {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}
export function createAssetLoader(options: AssetLoaderOptions = {}): AssetLoader {
  const basePath = options.basePath ?? "";
  const cache = new Map<string, Promise<unknown>>();

  const cached = <T>(kind: string, path: string, load: (url: string) => Promise<T>): Promise<T> => {
    const url = resolvePath(basePath, path);
    const key = `${kind}:${url}`;
    const existing = cache.get(key);
    if (existing !== undefined) return existing as Promise<T>;
    const promise = load(url) as Promise<T>;
    cache.set(key, promise);
    return promise;
  };

  return {
    audio: (path) =>
      cached("audio", path, async (url) => {
        if (options.audio !== undefined) return options.audio(url);
        const { AudioLoader: Loader } = await import("three");
        return loadWith(new Loader() as AudioLoader, url);
      }),
    clear: () => cache.clear(),
    model: <T = unknown>(path: string) =>
      cached<T>("model", path, async (url) => {
        if (options.model !== undefined) return (await options.model(url)) as T;
        const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
        return (await loadWith(new GLTFLoader(), url)) as T;
      }),
    release: (kind, path) => cache.delete(`${kind}:${resolvePath(basePath, path)}`),
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
