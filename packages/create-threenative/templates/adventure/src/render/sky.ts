// Generated for you. This is ordinary Three.js — edit or delete it freely.
//
// Under a canopy there is no sky to see, only mist, so the background is the mist's own colour and
// `assets/sky.jpg` (Poly Haven's "Kloofendal 48d Partly Cloudy (Pure Sky)", CC0) is used only as
// the environment: the soft fill that reaches faces the sun misses, and the sky a wet leaf
// reflects. `SUN_DIRECTION` sits ahead of the camera, low and a little right, which is what puts
// the hero's shadow toward the player and the shafts through the trunks in the reference.
import {
  Color,
  EquirectangularReflectionMapping,
  FogExp2,
  SRGBColorSpace,
  type Scene,
  type Texture,
  Vector3,
} from "three";
import { palette } from "./palette.js";

/** The JPEG is linear radiance × 0.4 sRGB-encoded, so white in the file is 2.5 in the sky. */
const SKY_RANGE = 2.5;
/** How much of that fill reaches the forest floor: the canopy takes most of it. */
const FILL = 0.55;

/** Unit vector toward the sun: 37° up, ahead (north, −z) and a little to the right. */
export const SUN_DIRECTION = new Vector3(0.3, 0.6, -0.74).normalize();

export function setupSky(scene: Scene, sky: Texture): void {
  sky.mapping = EquirectangularReflectionMapping;
  sky.colorSpace = SRGBColorSpace;
  scene.background = new Color(palette.mist);
  scene.environment = sky;
  scene.environmentIntensity = SKY_RANGE * FILL;
  // Exponential, not linear: the reference clears the mid-ground and then hazes hard, so the first
  // 15 m barely fog (1.8% per metre squared) and the far stair is nearly gone at 60 m.
  scene.fog = new FogExp2(palette.mist, 0.016);
}
