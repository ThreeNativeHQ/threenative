// The shipped sky is an equirectangular outdoor-cloudy photograph. Use it as the
// background directly; a vertex-coloured dome cannot produce the high cirrus the
// reference frame shows across the top third.
import { EquirectangularReflectionMapping, type Scene, type Texture } from "three";
import { palette } from "./palette.js";

export function setupSky(scene: Scene, environment?: Texture): void {
  if (environment !== undefined) {
    environment.mapping = EquirectangularReflectionMapping;
    scene.background = environment;
    scene.environment = environment;
    scene.environmentIntensity = 0.3;
    scene.backgroundIntensity = 0.3;
    return;
  }
  scene.background = null;
  scene.backgroundIntensity = 1;
  scene.fog = null;
  void palette;
}
