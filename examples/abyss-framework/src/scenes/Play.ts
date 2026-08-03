import { type Ctx, Scene } from "@threenative/core";
import { BoxGeometry, Mesh, MeshNormalMaterial } from "three";

export class Play extends Scene<{ score: number }> {
  #cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshNormalMaterial());
  #elapsed = 0;

  enter(ctx: Ctx<{ score: number }>): void {
    ctx.camera.position.set(0, 0, 4);
    ctx.camera.lookAt(0, 0, 0);
    ctx.add(this.#cube);
  }

  update(ctx: Ctx<{ score: number }>, dt: number): void {
    const move = ctx.input.vector("move");
    this.#cube.position.x += move.x * dt * 3;
    this.#cube.rotation.y += dt;
    this.#elapsed += dt;
    ctx.state.set({ score: Math.floor(this.#elapsed) });
  }
}
