// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// There is no sky in this game. The vault is a closed room, so what a camera sees past its 1.9 m
// walls is the dark the room sits in, and the only light in the frame is light a named source put
// there. `scene.background` is therefore a colour, not a photograph: swapping in a sky dome or an
// equirectangular capture is a two-line change here, and everything downstream — fog, the tone
// curve, bloom's threshold — is already reading the same palette role.
import { Color, FogExp2, type Scene } from "three";
import { palette } from "./palette.js";

/**
 * Thin enough to be felt and not seen: under 1.5% across the room's 12 m diagonal, so the far
 * corners fall away a little without the crate the player is pushing going hazy.
 */
const FOG_DENSITY = 0.005;

export function setupSky(scene: Scene): void {
  scene.background = new Color(palette.void);
  scene.backgroundIntensity = 1;
  // The room is the horizon, so the fog is the colour beyond it rather than a lit distance: a
  // grey fog in a room this dark would be the brightest thing in the frame.
  scene.fog = new FogExp2(palette.void, FOG_DENSITY);
}
