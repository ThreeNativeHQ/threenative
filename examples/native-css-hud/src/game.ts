import { type ICtx, Scene, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { BoxGeometry, Mesh, MeshStandardMaterial, PointLight } from "three";

/**
 * Everything the playtest and the HUD agree on.
 *
 * `closeClicks` is the only field the HUD writes: the button's `onClick` is a real intent reaching
 * the game's own store, so a click that never arrived cannot read as a click that did.
 */
export type GameState = {
  frames: number;
  closeClicks: number;
  uiReady: boolean;
};

const canvas = (document.getElementById("canvas") ?? undefined) as HTMLCanvasElement | undefined;

class Cube extends Scene<GameState> {
  static override readonly initialState: GameState = {
    frames: 0,
    closeClicks: 0,
    uiReady: false,
  };

  override enter(ctx: ICtx<GameState>) {
    ctx.camera.position.set(2, 2, 3);
    ctx.camera.lookAt(0, 0, 0);
    const light = ctx.add(new PointLight(0xffffff, 40));
    light.position.set(4, 6, 8);
    const cube = ctx.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
    return (frameCtx: ICtx<GameState>, dt: number) => {
      cube.rotation.x += dt * 0.6;
      cube.rotation.y += dt;
      frameCtx.state.set({ frames: frameCtx.state.getState().frames + 1 });
    };
  }
}

const game: ReturnType<typeof defineGame<GameState>> = defineGame<GameState>({
  canvas,
  inputTarget: canvas,
  plugins: [playtest()],
  scenes: { cube: Cube },
  start: "cube",
});

/**
 * The HUD's one intent, wired in the game rather than in a package: the UI presents, the game decides.
 *
 * `uiReady` becomes true only after a click travelled from the React button into this store, which
 * is why a scenario can assert it as proof the native host dispatched activation at all.
 */
export function closeInventory(): void {
  game.state.set({ closeClicks: game.state.getState().closeClicks + 1, uiReady: true });
  game.state.flush();
}

export default game;
