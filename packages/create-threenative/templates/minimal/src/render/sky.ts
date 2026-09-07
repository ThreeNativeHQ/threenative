// Generated for you. This is ordinary Three.js — edit or delete it freely.
// The atmosphere object is mechanism; this file owns the mesh, material, and exposure.
import { BackSide, Color, Mesh, type Scene, SphereGeometry } from "three";
import { cameraPosition, normalize, positionWorld } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { Node } from "three/webgpu";
import { palette } from "./palette.js";

type AtmosphereLike = {
  radiance(direction: unknown): unknown;
};

export function setupSky(scene: Scene, atmosphere?: AtmosphereLike): void {
  const top = new Color(palette.skyHigh);
  if (atmosphere === undefined) {
    scene.background = top;
    scene.fog = null;
    return;
  }

  // Outside the deliberately kilometre-scale atmosphere probe in Play.ts, and **inside** the
  // camera's far plane. The view-space depth remains metres, so the package can apply its
  // supplied 1/km coefficients.
  //
  // The radius was 20 000 against `camera.far = 20_000`, which leaves the `BackSide` hemisphere
  // sitting exactly on the far plane. Pulled in to 16 000 it has room; measured, this was not
  // what was making the sky black — see the multiplier below — but a dome flush with the far
  // plane is one renderer tolerance away from being clipped, so it stays pulled in.
  const geometry = new SphereGeometry(16_000, 24, 12);
  const material = new MeshBasicNodeMaterial({
    fog: false,
    side: BackSide,
    toneMapped: false,
  });
  const viewDirection = normalize(positionWorld.sub(cameraPosition));
  // Exposure for the dome alone.
  //
  // 24 was authored when this template had no post chain, so the dome's radiance landed straight
  // in the frame; the chain now exposes the pass at 1.15 and tone-maps it with ACES. A previous
  // pass measured 203 of 255 at 24 and 25 at 1.5, and chose 1.5 because it matched "this
  // template's last good baseline" of 22. That baseline was the problem: **22 of 255 is not a
  // sky**, it is a black rectangle above the horizon, and it is what the smallest template showed
  // a new project on its first frame with a sun fifty degrees up and a correctly-scattering
  // atmosphere behind it.
  //
  // 8 lands the daytime sky around a hundred, which is a sky. Raising it further starts to blow
  // the horizon out under ACES. This multiplier scales the dome and nothing else — the
  // in-scattering `aerialPerspective` receives in postprocessing.ts comes from its own call and
  // is unaffected, so this cannot double-count the way the old note feared.
  material.colorNode = (atmosphere.radiance(viewDirection) as Node<"vec3">).mul(8);
  const dome = new Mesh(geometry, material);
  // The dome is authored at the origin and never moves; freeze only this known-static render
  // object, leaving gameplay transforms under user control.
  dome.updateMatrix();
  dome.matrixAutoUpdate = false;
  dome.frustumCulled = false;
  scene.background = null;
  scene.fog = null;
  scene.add(dome);
}
