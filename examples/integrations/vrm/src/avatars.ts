import { VRM, VRMUtils } from "@pixiv/three-vrm";
import type { AnimationClip, Object3D } from "three";
import type {
  GLTF,
  GLTFLoader,
  GLTFLoaderPlugin,
  GLTFParser,
} from "three/addons/loaders/GLTFLoader.js";
import { inspectAvatarDocument } from "./document.js";
import { vrmWebGpuPlugin } from "./render/vrm-materials.js";
export interface IVrmReaderOptions {
  readonly readBytes?: (url: string) => Promise<Uint8Array>;
  readonly plugin?: (parser: GLTFParser) => GLTFLoaderPlugin;
  /** Override when a loader plugin borrows textures or geometry from a shared owner. */
  readonly release?: (scene: Object3D) => void;
}
export interface IVrmAsset {
  readonly kind: "vrm1";
  /** Parse immutable bytes again: cloning a scene does not clone VRM spring/expression state. */
  instantiate(signal?: AbortSignal): Promise<VrmAvatar>;
  /** Stops future instances, but does not destroy already-created avatars. */
  dispose(): void;
}
export interface IVrmModelReader {
  readonly model: (url: string) => Promise<GLTF | IVrmAsset>;
  dispose(): void;
}
const attachedLoaders = new WeakSet<GLTFLoader>();
function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("VRM instantiation was aborted.");
    error.name = "AbortError";
    throw error;
  }
}
/** Mutable per-instance animation state; callers retain the existing fixed-step loop. */
export class VrmAvatar {
  readonly vrm: VRM;
  readonly clips: readonly AnimationClip[];
  readonly #release: (scene: Object3D) => void;
  #disposed = false;
  constructor(vrm: VRM, clips: readonly AnimationClip[], release: (scene: Object3D) => void) {
    this.vrm = vrm;
    this.clips = clips;
    this.#release = release;
  }
  get scene(): Object3D {
    return this.vrm.scene;
  }
  update(dt: number): void {
    if (this.#disposed) throw new Error("VRM avatar is disposed.");
    if (!Number.isFinite(dt) || dt < 0) throw new Error("VRM dt must be finite and nonnegative.");
    this.vrm.update(dt);
  }
  setExpression(name: string, weight: number): void {
    if (this.#disposed) throw new Error("VRM avatar is disposed.");
    const manager = this.vrm.expressionManager;
    if (!manager?.getExpression(name)) throw new Error(`VRM expression '${name}' does not exist.`);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1)
      throw new Error("VRM expression weight must be in [0,1].");
    manager.setValue(name, weight);
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.scene.removeFromParent();
    this.#release(this.scene);
  }
}
/** Supply model to createAssetLoader; core continues to own logical-path resolution and caching. */
export function createVrmModelReader(
  loader: GLTFLoader,
  options: IVrmReaderOptions = {},
): IVrmModelReader {
  if (attachedLoaders.has(loader))
    throw new Error("VRM reader is already registered on this loader.");
  const plugin = options.plugin ?? vrmWebGpuPlugin;
  const release = options.release ?? ((scene) => VRMUtils.deepDispose(scene));
  const readBytes =
    options.readBytes ??
    (async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`VRM asset '${url}' failed with HTTP ${response.status}.`);
      return new Uint8Array(await response.arrayBuffer());
    });
  attachedLoaders.add(loader);
  loader.register(plugin);
  let disposed = false;
  const live = (): void => {
    if (disposed) throw new Error("VRM model reader is disposed.");
  };
  return {
    async model(url) {
      live();
      // Normalize Uint8Array subclasses (including Node Buffer) into an owned, exact-size copy.
      const bytes = Uint8Array.from(await readBytes(url));
      live();
      const document = inspectAvatarDocument(bytes);
      const clean = url.split(/[?#]/u)[0];
      const resourcePath = clean.slice(0, clean.lastIndexOf("/") + 1);
      const parse = async (): Promise<GLTF> => {
        live();
        const gltf = await loader.parseAsync(bytes.slice().buffer, resourcePath);
        if (disposed) {
          release(gltf.scene);
          live();
        }
        return gltf;
      };
      if (document.kind === "gltf") return parse();
      let assetDisposed = false;
      return {
        kind: "vrm1" as const,
        async instantiate(signal) {
          live();
          aborted(signal);
          if (assetDisposed) throw new Error("VRM asset is disposed.");
          const gltf = await parse();
          try {
            aborted(signal);
            if (assetDisposed) throw new Error("VRM asset was disposed during instantiation.");
            const vrm: unknown = gltf.userData.vrm;
            if (!(vrm instanceof VRM))
              throw new Error(
                `VRM '${url}' did not produce a valid humanoid; check retained extensions and resources.`,
              );
            return new VrmAvatar(vrm, gltf.animations, release);
          } catch (error) {
            release(gltf.scene);
            throw error;
          }
        },
        dispose() {
          assetDisposed = true;
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loader.unregister(plugin);
      attachedLoaders.delete(loader);
    },
  };
}
