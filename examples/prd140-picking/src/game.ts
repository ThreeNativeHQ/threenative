import { type ICtx, Scene, type SceneFrame, defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";

const MESH_COUNT = 250;

interface IPickingState extends Record<string, unknown> {
  meshCount: number;
  pickedTarget: number;
}

class PickingScene extends Scene<IPickingState> {
  static override readonly initialState: IPickingState = {
    meshCount: 0,
    pickedTarget: 0,
  };

  override enter(ctx: ICtx<IPickingState>): SceneFrame<IPickingState> {
    ctx.camera.position.set(0, 0, 10);
    ctx.camera.lookAt(0, 0, 0);
    for (let index = 0; index < MESH_COUNT; index += 1) {
      const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0x00aaff }));
      if (index === 0) {
        mesh.userData.target = 1;
      } else {
        mesh.position.set(20 + (index % 20) * 2, 2 * Math.floor(index / 20), 0);
      }
      ctx.add(mesh);
    }

    let sampled = false;
    return (frameCtx) => {
      const pointer = ctx.input.raw.pointer.position;
      if (sampled || ctx.startup.phase !== "ready" || (pointer.x === 0 && pointer.y === 0)) return;
      const hit = ctx.raycast({ screen: pointer });
      frameCtx.state.set({
        meshCount: MESH_COUNT,
        pickedTarget: hit?.object.userData.target === 1 ? 1 : 0,
      });
      frameCtx.state.flush();
      sampled = true;
    };
  }
}

const game = defineGame<IPickingState>({
  camera: { projection: "perspective", fov: 60 },
  plugins: [playtest()],
  render: { preferWebGPU: true },
  scenes: { picking: PickingScene },
  start: "picking",
});

export default game;
