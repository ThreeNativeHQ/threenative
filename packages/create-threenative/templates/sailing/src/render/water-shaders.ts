// Adapted from VictorZakharov/beautiful-water (MIT); the source attribution is in README.md.
import { color, float, mix, normalize, smoothstep, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { palette } from "./palette.js";

/**
 * The sun this water is lit by.
 *
 * Hand-copied from the key light in `lighting.ts` rather than read from the scene, because a
 * `MeshBasicNodeMaterial` takes no lights: the sea is shaded here or it is not shaded at all.
 * Move the key and move this with it.
 */
const SUN = normalize(vec3(0.48, 0.8, 0.32));

/**
 * The colour of the sea at one point, from the height and the slope there.
 *
 * Both arguments matter, and the height one especially. This function was previously called with
 * a constant `0`, which made every one of the two hundred thousand fragments the same colour: the
 * waves displaced the surface and nothing about the picture changed, so the sea photographed as a
 * flat pale sheet with a boat sitting on it. `WaveField` hands out `heightNode()` and
 * `normalNode()` for exactly this.
 */
export function waterColourNode(height: Node<"float">, normal: Node<"vec3">): Node<"vec3"> {
  // Deep water in the troughs, bright water at the crests. The band is narrower than the wave
  // amplitude on purpose, so the tops read as foam-lit rather than as a gentle gradient.
  // The crest tone is the accent held back to three quarters. At full strength every crest
  // saturates to white under the bloom and the sea goes back to being one flat value, which is
  // the failure this function exists to avoid.
  const crest = color(palette.accent).mul(0.74);
  const base = mix(color(palette.floor), crest, smoothstep(-0.14, 0.2, height));
  const facing = normal.dot(SUN).clamp(0, 1);
  // A tight highlight on the faces turned into the sun. This is what turns a moving surface into
  // something the eye can read as moving.
  const glint = facing.pow(26).mul(0.55);
  return base
    .mul(mix(float(0.52), float(1), facing))
    .add(color(palette.player).mul(glint)) as Node<"vec3">;
}
