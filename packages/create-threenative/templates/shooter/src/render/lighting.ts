// Ordinary Three.js. High midday sun over a Mediterranean coast: a hot, barely
// warm key, crisp shadows, and a sky that fills the shade blue.
//
// The totals here assume `sky.ts` has installed the equirect sky as
// `scene.environment` at intensity ~1.15. That image-based fill is doing the
// work the old hemisphere light did, so hemisphere and ambient are trimmed to
// almost nothing; leaving them at their previous strength on top of a real
// environment washes every upward face to paper.
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
} from "three";
import { palette } from "./palette.js";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  if (renderer?.shadowMap !== undefined) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
  }

  // The town is 84 m across, so the shadow frustum has to cover it whole: a
  // smaller box pops shadows in and out at the edges of the frame. Midday sun
  // sits high and slightly south-west, which is what throws the short hard
  // shadows the reference frames show down the lanes.
  const sun = new DirectionalLight(0xfff4e0, 2.7);
  sun.position.set(-30, 74, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  const camera = sun.shadow.camera;
  camera.left = -50;
  camera.right = 50;
  camera.top = 50;
  camera.bottom = -50;
  camera.near = 4;
  camera.far = 190;
  camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);
  sun.target.position.set(-2, 0, -2);

  // A trim on top of the environment: sky blue down, warm stone bounce up, so
  // north-facing plaster keeps a little colour instead of crushing to grey.
  // With TN_NO_IBL the hemisphere IS the fill (see sky.ts), so it carries the
  // environment's own intensity instead of being a trim on top of it.
  const iblFill = globalThis.localStorage?.getItem("TN_NO_IBL") !== "1";
  scene.add(new HemisphereLight(palette.skyHigh, palette.sand, iblFill ? 0.34 : 2.2));
  scene.add(new AmbientLight(0xffffff, iblFill ? 0.05 : 0.22));
  return sun;
}
