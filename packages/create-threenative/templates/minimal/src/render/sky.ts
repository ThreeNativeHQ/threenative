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

  // Keep the dome outside the deliberately kilometre-scale atmosphere probe in Play.ts. The
  // view-space depth remains metres, so the package can apply its supplied 1/km coefficients.
  const geometry = new SphereGeometry(20_000, 24, 12);
  const material = new MeshBasicNodeMaterial({
    fog: false,
    side: BackSide,
    toneMapped: false,
  });
  const viewDirection = normalize(positionWorld.sub(cameraPosition));
  material.colorNode = (atmosphere.radiance(viewDirection) as Node<"vec3">).mul(24);
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
