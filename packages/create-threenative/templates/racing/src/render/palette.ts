// Generated for you: every colour the race uses, in one place. ThreeNative does not read this file.
//
// These are afternoon-daylight values on purpose. The first version of this palette used a
// near-black road (`0x202936`) lit by a strongly yellow key light, and the blind score of the first
// frame called it a black strip in a swamp: the tarmac never came up off the shadow floor and the
// grass went olive. Tarmac is a *mid* grey — brighter than intuition says — and grass only reads as
// grass when the sun on it is close to white.
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";

export const palette = {
  /** Zenith. Deep enough to give the dome a gradient worth having. */
  skyHigh: 0x2c6cae,
  /** Horizon haze, and the fog colour, so distance dissolves into the sky instead of into grey. */
  skyLow: 0xbcd6e4,
  /** Tarmac. Mid grey with a blue cast; anything darker eats the car's own shadow. */
  road: 0x51565f,
  /** Freshly cut infield. */
  field: 0x5c8f45,
  /** Kerbing, race numbers, boost chevrons. */
  accent: 0xffc233,
  /** Ambient fill and the underside of everything. Not black — black flattens. */
  shadow: 0x35414f,
} as const;

// The circuit's other surfaces are shades of the six roles above rather than roles of their own:
// the palette stays six named colours, and anything derived belongs beside the material that uses
// it. `materials.ts` owns them.

const materials = new Map<string, MeshStandardMaterial>();

export function toon(color: number, roughness = 0.72): MeshStandardMaterial {
  const key = `${color}:${roughness}`;
  const cached = materials.get(key);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({ color, roughness, metalness: 0.05 });
  materials.set(key, material);
  return material;
}

export function curbBlock(width: number, height: number, depth: number, color: number): Group {
  const group = new Group();
  const mesh = new Mesh(new BoxGeometry(width, height, depth), toon(color, 0.55));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
