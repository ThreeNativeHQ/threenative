import { assertScreenSpaceTextProof, createHudText, SCREEN_SPACE_TEXT } from "./hud-geometry.js";
import { startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "screen-space-text", ({ scene, camera }) => {
    const hud = createHudText(camera);
    const proof = hud.update(SCREEN_SPACE_TEXT);
    assertScreenSpaceTextProof(proof);
    scene.add(camera);
    return {
      detail: { bounds: proof.bounds, brightGlyphs: proof.brightGlyphs, text: proof.text },
      hud,
    };
  });
}
