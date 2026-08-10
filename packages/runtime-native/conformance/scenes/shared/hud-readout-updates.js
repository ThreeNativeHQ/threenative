import { assertHudReadoutChanged, createHudText } from "./hud-geometry.js";
import { assertCondition, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "hud-readout-updates", ({ scene, camera }) => {
    const state = { score: 1_200 };
    const hud = createHudText(camera);
    const before = hud.update(`SCORE ${state.score}`);
    state.score = 8_888;
    const after = hud.update(`SCORE ${state.score}`);
    assertCondition(after.text === "SCORE 8888", "HUD did not render the changed counter value");
    assertHudReadoutChanged(before, after);
    scene.add(camera);
    return {
      detail: {
        afterCount: after.count,
        beforeCount: before.count,
        matrixChanged: true,
        text: after.text,
      },
      hud,
    };
  });
}
