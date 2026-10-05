/// <reference types="vite/client" />
import { type ICtx, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import {
  AmbientLight,
  type AnimationClip,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Plane,
  PlaneGeometry,
  Vector3,
} from "three";
import { ClippingGroup } from "three/webgpu";
import { createLocomotionTrace } from "./vq-locomotion-trace.js";

const eye = new Vector3();

/** Two CC0 mannequin rigs under one scripted speed trace, seen from the first rig's own head. */
class VqLocomotion extends Scene {
  #model: { scene: Object3D; animations: AnimationClip[] } | undefined;

  override async load(ctx: ICtx): Promise<void> {
    this.#model = await ctx.assets.model("mannequin.glb");
  }

  override enter(ctx: ICtx) {
    if (this.#model === undefined) throw new Error("Mannequin did not load.");
    ctx.scene.background = new Color(0x263346);
    ctx.add(new AmbientLight(0xd5e3ff, 2));
    const key = new DirectionalLight(0xffe4c4, 3);
    key.position.set(3, 5, 4);
    ctx.add(key);
    const floor = new Mesh(
      new PlaneGeometry(9, 9),
      new MeshStandardMaterial({ color: 0x526474, roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    ctx.add(floor);
    const trace = createLocomotionTrace(this.#model);
    // Neither rig translates: this fixture animates, and the first-person one stands under the
    // camera whose eye height it measures. The third-person one stands across the floor in front,
    // turned to face back. Both face the camera's forward direction, so neither is seen from behind.
    trace.third.group.position.set(0, 0, -3.4);
    trace.third.group.rotation.y = Math.PI;
    trace.first.group.rotation.y = Math.PI;
    ctx.add(trace.third.group);
    // A first-person body never draws its own head and torso, and a clipping group is the seam the
    // renderer's projection already walks: one world plane at the head bone's own height stops the
    // skull being submitted, so no material is edited, no second mesh exists and the rig still
    // plays the clips the driver asked for. Measured, not authored: the rig decides where its head
    // is.
    trace.first.head.updateWorldMatrix(true, false);
    ctx.camera.position.copy(trace.first.head.getWorldPosition(eye));
    const viewBody = new ClippingGroup();
    viewBody.clippingPlanes = [new Plane(new Vector3(0, -1, 0), eye.y)];
    viewBody.add(trace.first.group);
    ctx.add(viewBody);
    // Pitched down far enough that the body's own arms and legs are in frame under the horizon.
    ctx.camera.lookAt(eye.x, eye.y - 2.4, eye.z - 6);
    ctx.entities.add("third-person-locomotion", {
      debug: trace.third.report,
      mesh: trace.third.group,
    });
    ctx.entities.add("first-person-locomotion", {
      debug: trace.first.report,
      mesh: trace.first.group,
    });
    let started = false;
    let reported = false;
    return (frameCtx: ICtx) => {
      if (frameCtx.input.justPressed("start")) started = true;
      if (!started || trace.observation.complete) return;
      trace.step();
      frameCtx.state.set(trace.observation);
      if (trace.observation.complete && !reported) {
        reported = true;
        frameCtx.state.flush();
        console.log(`TN_VQ_LOCOMOTION:${JSON.stringify(trace.observation)}`);
      }
    };
  }
}

export default defineGame({
  initialState: {},
  camera: { projection: "perspective", fov: 70, near: 0.05, far: 50 },
  input: { start: { keys: ["Space"] } },
  plugins: [playtest()],
  render: { preferWebGPU: true },
  scenes: { locomotion: VqLocomotion },
  start: "locomotion",
});
