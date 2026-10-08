import { type ICtx, Scene, type SceneFrame, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
} from "three";
import config from "../threenative.config.js";

export interface IBootState extends Record<string, unknown> {
  frames: number;
}

/** One lit box and nothing else: no TSL, no post, no physics (PRD-540 phase 2). */
class Boot extends Scene<IBootState> {
  static override readonly initialState: IBootState = { frames: 0 };
  #box: Mesh | undefined;

  override enter(ctx: ICtx<IBootState>): SceneFrame<IBootState> {
    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(0, 1.5, 4);
    camera.lookAt(0, 0, 0);
    this.#box = new Mesh(
      new BoxGeometry(1.6, 1.6, 1.6),
      new MeshStandardMaterial({ color: 0xff8030 }),
    );
    const sun = new DirectionalLight(0xffffff, 3);
    sun.position.set(3, 5, 4);
    ctx.scene.add(this.#box, sun, new AmbientLight(0xffffff, 0.4));
    return (frameCtx, dt) => {
      if (this.#box !== undefined) this.#box.rotation.y += dt;
      frameCtx.state.frames += 1;
    };
  }
}

const game = defineGame<IBootState>({
  plugins: [playtest()],
  display: config.display,
  render: config.renderer,
  scenes: { boot: Boot },
  start: "boot",
});

export default game;
