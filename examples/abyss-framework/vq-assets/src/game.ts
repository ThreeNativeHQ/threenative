import { AnimationPlayer, type ICtx, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import {
  type AnimationClip,
  type Group,
  Mesh,
  type MeshStandardMaterial,
  type PerspectiveCamera,
  Quaternion,
  type Texture,
} from "three";
import config from "../threenative.config.js";
import { stage } from "./render/stage.js";

type State = {
  loadedModels: number;
  texturedMeshes: number;
  vertices: number;
  frames: number;
  maxPoseDelta: number;
  entries: number;
  settled: number;
  ownedGeometries?: number;
  ownedTextures?: number;
  geometryGrowth?: number;
  textureGrowth?: number;
};
type Model = { scene: Group; animations: AnimationClip[] };
type Owned = { geometries: number; textures: number };
const names = ["meshopt", "draco"] as const;
/** Frames an enter is given to upload its geometry and textures before it is measured or left. */
const SETTLE_FRAMES = 30;
/** One first load plus three leave/re-enter cycles. */
const ENTERS = 4;

// The lifetime ledger, at module scope because only a value that outlives the scene can count its
// own re-entries: `ctx.goto()` keeps the published state, and every field below is re-derived on
// each enter from the renderer's live tally.
let enters = 0;
let settled = 0;
let baseline: Owned | undefined;
const growth: Owned = { geometries: 0, textures: 0 };

/** The renderer's own GPU tally, or undefined when this backend keeps none — never a fake zero. */
function ownedResources(ctx: ICtx<State>): Owned | undefined {
  try {
    const memory = (ctx.renderer.info as { memory?: Partial<Owned> }).memory;
    const { geometries, textures } = memory ?? {};
    return typeof geometries === "number" && typeof textures === "number"
      ? { geometries, textures }
      : undefined;
  } catch {
    return undefined;
  }
}

export class AssetScene extends Scene<State> {
  static override readonly initialState: State = {
    loadedModels: 0,
    texturedMeshes: 0,
    vertices: 0,
    frames: 0,
    maxPoseDelta: 0,
    entries: 0,
    settled: 0,
  };
  #models: Model[] = [];
  #png: Texture | undefined;
  #players: AnimationPlayer[] = [];
  #owned: Mesh[] = [];

  override async load(ctx: ICtx<State>): Promise<void> {
    this.#models = await Promise.all(names.map((name) => ctx.assets.model<Model>(`${name}.glb`)));
    // Options return an owned sRGB clone; the cached source remains loader-owned.
    this.#png = await ctx.assets.texture("checker.png", {});
  }

  override enter(ctx: ICtx<State>) {
    if (!this.#png) throw new Error("PNG did not load");
    enters += 1;
    const entry = enters;
    this.#owned = stage(ctx.scene, ctx.camera as PerspectiveCamera, this.#png);
    let texturedMeshes = 0;
    let vertices = 0;
    const rotations: Quaternion[] = [];
    const animated = this.#models.map((model, index) => {
      model.scene.position.set(index === 0 ? -2.4 : 0, 1.35, 0);
      ctx.add(model.scene);
      model.scene.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        vertices += node.geometry.getAttribute("position").count;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        if (materials.some((material) => (material as MeshStandardMaterial).map?.image))
          texturedMeshes++;
      });
      const player = new AnimationPlayer({
        root: model.scene,
        clips: model.animations,
        requiredClips: ["turn"],
        strideSync: false,
      });
      player.play("turn");
      this.#players.push(player);
      const node = model.scene.getObjectByName(`${names[index]}-animated`);
      if (!node) throw new Error(`Missing animated node: ${names[index]}`);
      rotations.push(node.quaternion.clone());
      return node;
    });
    ctx.state.set({ loadedModels: this.#models.length, texturedMeshes, vertices, entries: entry });
    let frames = 0;
    let maxPoseDelta = 0;
    let left = false;
    return (_ctx: ICtx<State>, dt: number) => {
      for (const player of this.#players) player.update(dt);
      for (const [index, node] of animated.entries())
        maxPoseDelta = Math.max(
          maxPoseDelta,
          node.quaternion.angleTo(rotations[index] ?? new Quaternion()),
        );
      frames += 1;
      const owned = frames < SETTLE_FRAMES ? undefined : ownedResources(ctx);
      if (owned !== undefined) {
        baseline ??= owned;
        growth.geometries = Math.max(growth.geometries, owned.geometries - baseline.geometries);
        growth.textures = Math.max(growth.textures, owned.textures - baseline.textures);
        settled = Math.max(settled, entry);
      }
      ctx.state.set({
        frames,
        maxPoseDelta,
        entries: entry,
        settled,
        ...(owned === undefined
          ? {}
          : {
              ownedGeometries: owned.geometries,
              ownedTextures: owned.textures,
              geometryGrowth: growth.geometries,
              textureGrowth: growth.textures,
            }),
      });
      // Leave once this enter has settled, so the next observation is a re-entry's, not this one's.
      if (frames >= SETTLE_FRAMES && !left && entry < ENTERS) {
        left = true;
        void ctx.goto("void");
      }
    };
  }

  override exit(ctx: ICtx<State>): void {
    for (const player of this.#players) player.dispose();
    this.#players.length = 0;
    for (const mesh of this.#owned) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        material.dispose();
    }
    this.#owned.length = 0;
    this.#png?.dispose();
    this.#png = undefined;
    this.#models.length = 0;
    for (const name of names) ctx.assets.release("model", `${name}.glb`);
    ctx.assets.release("texture", "checker.png");
  }
}

/** The empty scene the asset scene leaves for: no objects, no assets, one frame of nothing. */
class VoidScene extends Scene<State> {
  static override readonly initialState: State = AssetScene.initialState;
  #returned = false;

  override enter(ctx: ICtx<State>): void {
    ctx.state.set({ entries: enters, settled });
  }

  override update(ctx: ICtx<State>): void {
    if (this.#returned) return;
    this.#returned = true;
    void ctx.goto("assets");
  }
}

export default defineGame<State>({
  scenes: { assets: AssetScene, void: VoidScene },
  start: "assets",
  plugins: [playtest()],
  display: config.display,
  render: config.renderer,
});
