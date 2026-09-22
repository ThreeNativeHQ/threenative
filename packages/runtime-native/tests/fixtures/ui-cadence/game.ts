import { type ICtx, Scene, defineGame } from "@threenative/core";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";

class Probe extends Scene {
  static initialState = { sequence: 0, at: 0 };
  sequence = 0;
  startedAt = 0;

  enter(ctx: ICtx) {
    ctx.camera.position.set(0, 0, 4);
    const cube = ctx.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ color: 0x44aaff })));
    return (_ctx: ICtx, dt: number) => {
      cube.rotation.y += dt;
    };
  }

  render(ctx: ICtx) {
    const at = Date.now();
    this.startedAt ||= at;
    if ((at - this.startedAt) % 12_000 >= 10_000) return;
    const sample = { sequence: ++this.sequence, at };
    ctx.state.set(sample);
    console.info(`TN_UI_SAMPLE:${JSON.stringify(sample)}`);
  }
}

// No explicit game.ui access: the ordinary startup path must connect and publish by default.
export default defineGame({ display: { maxFps: 60 }, scenes: { probe: Probe }, start: "probe" });
