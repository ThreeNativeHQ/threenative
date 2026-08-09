import { type Ctx, Scene } from "@threenative/core";
import {
  AmbientLight,
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
} from "three";
import { Abyss, type AbyssState } from "./Abyss.js";

type ProbeCtx = Ctx<AbyssState>;

export class ViewportProbe extends Scene<AbyssState> {
  static override readonly initialState = Abyss.initialState;

  #player: Mesh | undefined;
  #stopResize: (() => void) | undefined;

  override enter(ctx: ProbeCtx): void {
    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(0, 2, 6_000);
    camera.lookAt(0, 0, 0);
    ctx.viewport.resize();
    ctx.add(new AmbientLight(0xffffff, 2));
    const player = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: 0x6fe8ff, emissive: 0x123344 }),
    );
    ctx.add(player);
    ctx.entities.add("player", {
      debug: () => ({ position: player.position.toArray() }),
      mesh: player,
    });
    this.#player = player;
    this.#stopResize = ctx.viewport.onResize(() => camera.lookAt(player.position));
    ctx.state.set({ elapsed: 0, playerX: 0, status: "play" });
  }

  override update(ctx: ProbeCtx, dt: number): void {
    const player = this.#player;
    if (player === undefined) return;
    const move = ctx.input.vector("move");
    player.position.x += move.x * dt;
    player.position.y += move.y * dt;
    ctx.camera.lookAt(player.position);
    const state = ctx.state.getState();
    ctx.state.set({ elapsed: state.elapsed + dt, playerX: player.position.x });
  }

  override exit(ctx: ProbeCtx): void {
    this.#stopResize?.();
    ctx.entities.remove("player");
    this.#player?.removeFromParent();
    this.#stopResize = undefined;
    this.#player = undefined;
  }
}
