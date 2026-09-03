import { type ICtx, Scene, defineGame } from "@threenative/core";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";

class Play extends Scene {
  override enter(ctx: ICtx) {
    const material = new MeshStandardMaterial();
    const cube = ctx.add(new Mesh(new BoxGeometry(), material));
    return (_frame: ICtx, dt: number) => {
      cube.rotation.y += dt;
    };
  }
}

export default defineGame({ scenes: { play: Play }, start: "play" });
