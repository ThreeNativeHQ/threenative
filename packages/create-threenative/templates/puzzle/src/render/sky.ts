import { Color, Fog, type Scene } from "three";
import { palette } from "./palette.js";

/**
 * There is no sky. This is an interior.
 *
 * The kit shipped with a gradient sky dome inherited from an outdoor template, and above the
 * walls it read as a hard-edged blue triangle — a hole in the room rather than a ceiling. What an
 * interior wants instead is a dark ground colour and fog that swallows the far corners, so the
 * eye stays on the lit floor where the puzzle is. Replace this with a dome, an HDR environment,
 * or an actual ceiling; it is your file.
 */
export function setupSky(scene: Scene): void {
  scene.background = new Color(palette.shadow);
  scene.fog = new Fog(palette.shadow, 38, 96);
}
