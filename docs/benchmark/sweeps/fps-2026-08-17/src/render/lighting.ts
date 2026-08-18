// Ordinary Three.js. High sun, bright cloudy bounce, long soft shadows —
// the reference is an outdoor range at midday with no visible dusk warmth.
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
} from "three";

type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

export function setupLighting(scene: Scene, renderer: ShadowRenderer): DirectionalLight {
  if (renderer?.shadowMap !== undefined) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
  }

  const sun = new DirectionalLight(0xfff6e8, 1.65);
  sun.position.set(-16, 30, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  const camera = sun.shadow.camera;
  camera.left = -26;
  camera.right = 26;
  camera.top = 26;
  camera.bottom = -26;
  camera.near = 1;
  camera.far = 90;
  camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);
  sun.target.position.set(0, 0, -4);

  // Cloudy days fill the shadows: a strong sky/ground hemisphere keeps the
  // near-black blocks from crushing to pure black on their shaded faces.
  scene.add(new HemisphereLight(0xcfe0f0, 0xa9adaf, 1.15));
  scene.add(new AmbientLight(0xffffff, 0.3));
  return sun;
}
