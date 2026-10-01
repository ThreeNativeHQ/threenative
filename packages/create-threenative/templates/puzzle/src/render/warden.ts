// Ordinary Three.js — ThreeNative does not read this file.
//
// The figure, modelled standing on y = 0 and facing -Z. Deliberately featureless: the reference
// puts a plain cream mannequin in a room of saturated crates, and every face detail added here
// would compete with the crates for the eye. The one exception is the feet, in the darker tint
// beside the material in `materials.ts`, so the figure has a base instead of a floating bottom.
import { Group } from "three";
import { wardenFootMaterial, wardenMaterial } from "./materials.js";
import { ball, block, tube } from "./shapes.js";

export function wardenFigure(): Group {
  const figure = new Group();
  figure.name = "warden-figure";
  // A shade over life size: at this camera distance the warden is about a hundred pixels tall,
  // which is what the reference gives it, and any smaller it stops being a character.
  figure.scale.setScalar(1.12);

  const hips = block(0.32, 0.16, 0.24, wardenMaterial, { radius: 0.07 });
  hips.position.y = 0.5;
  const torso = block(0.36, 0.4, 0.26, wardenMaterial, { radius: 0.11 });
  torso.position.y = 0.76;
  const head = ball(0.165, wardenMaterial, { segments: 18 });
  head.position.set(0, 1.06, 0.01);

  for (const side of [-1, 1]) {
    const thigh = tube(0.075, 0.068, 0.34, wardenMaterial, { segments: 10 });
    thigh.position.set(side * 0.1, 0.32, side * 0.06);
    thigh.rotation.x = side * 0.34;
    const shin = tube(0.066, 0.056, 0.3, wardenMaterial, { segments: 10 });
    shin.position.set(side * 0.1, 0.1, side * 0.16);
    shin.rotation.x = -side * 0.16;
    const foot = block(0.13, 0.07, 0.22, wardenFootMaterial, { radius: 0.03 });
    foot.position.set(side * 0.1, 0.035, side * 0.22 - 0.03);

    const arm = tube(0.06, 0.052, 0.4, wardenMaterial, { segments: 10 });
    arm.position.set(side * 0.23, 0.83, -0.13);
    arm.rotation.set(-1.15, 0, side * 0.16);
    const hand = ball(0.062, wardenMaterial, { segments: 10 });
    hand.position.set(side * 0.235, 0.86, -0.32);

    figure.add(thigh, shin, foot, arm, hand);
  }

  figure.add(hips, torso, head);
  return figure;
}
