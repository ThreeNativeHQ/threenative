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
};
type Model = { scene: Group; animations: AnimationClip[] };
const names = ["meshopt", "draco"] as const;

export class AssetScene extends Scene<State> {
  static override readonly initialState: State = {
    loadedModels: 0,
    texturedMeshes: 0,
    vertices: 0,
    frames: 0,
    maxPoseDelta: 0,
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
    ctx.state.set({ loadedModels: this.#models.length, texturedMeshes, vertices });
    let frames = 0;
    let maxPoseDelta = 0;
    return (_ctx: ICtx<State>, dt: number) => {
      for (const player of this.#players) player.update(dt);
      for (const [index, node] of animated.entries())
        maxPoseDelta = Math.max(
          maxPoseDelta,
          node.quaternion.angleTo(rotations[index] ?? new Quaternion()),
        );
      ctx.state.set({ frames: ++frames, maxPoseDelta });
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

export default defineGame<State>({
  scenes: { assets: AssetScene },
  start: "assets",
  plugins: [playtest()],
  display: config.display,
  render: config.renderer,
});
