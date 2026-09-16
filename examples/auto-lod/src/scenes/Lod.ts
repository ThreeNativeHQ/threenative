import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { AmbientLight, DirectionalLight, type Group, Mesh, type PerspectiveCamera } from "three";

/** Close enough that the model's own error projects past a one-pixel budget. */
const NEAR = 4;
/** Far enough that the coarsest baked level projects under it. */
const FAR = 140;

/**
 * One static model, a camera route with two ends, and nothing else. `assets.lod` cooks a
 * `TN_discrete_lod` chain into `hull.glb`; the engine selects the level; the scenarios read the
 * submitted triangle count at each end of the route.
 *
 * The count is published as scene state rather than only read from the renderer, because the
 * native playtest target carries the state channel and not the browser performance sampler. The
 * engine swaps `mesh.geometry` before the render, so a frame after a settle reads the selected level.
 */
export class Lod extends Scene {
  static override readonly initialState = { camera: "far", triangles: 0 };

  #loaded = false;
  readonly #meshes: Mesh[] = [];

  override async load(ctx: ICtx): Promise<void> {
    const model = await ctx.assets.model<{ scene: Group }>("hull.glb");
    model.scene.name = "hull";
    model.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.name = "hull-mesh";
      this.#meshes.push(object);
    });
    ctx.scene.add(model.scene);
    this.#loaded = true;
  }

  override enter(ctx: ICtx): SceneFrame {
    if (!this.#loaded) throw new Error("hull.glb did not load");
    const camera = ctx.camera as PerspectiveCamera;
    camera.fov = 60;
    camera.near = 0.1;
    camera.far = 1000;
    camera.position.set(0, 0, FAR);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    ctx.add(camera);
    ctx.scene.add(new AmbientLight(0xffffff, 1.5));
    const key = new DirectionalLight(0xffffff, 2.5);
    key.position.set(4, 6, 5);
    ctx.scene.add(key);

    return (frameCtx) => {
      let triangles = 0;
      for (const mesh of this.#meshes) {
        const drawn = mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position")?.count;
        triangles += Math.floor((drawn ?? 0) / 3);
      }
      frameCtx.state.set({ triangles });
      if (!frameCtx.input.justPressed("toggleNear")) return;
      // Toggle, so a scenario can drive the value and prove the selection follows the camera
      // rather than reporting a number that never changed.
      const wasNear = camera.position.z === NEAR;
      camera.position.set(0, 0, wasNear ? FAR : NEAR);
      camera.lookAt(0, 0, 0);
    };
  }
}
