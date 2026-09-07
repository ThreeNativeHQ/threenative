// Generated for you: the car's livery and the circuit's surfaces. ThreeNative does not read this
// file, and nothing in `shapes.ts` names a colour — it only names these slots. Re-livery the car,
// or repaint the circuit, entirely from here.
import { MeshStandardMaterial } from "three";
import { palette, toon } from "./palette.js";

export function createMaterials() {
  return {
    /** Boost chevrons and the kerb's yellow stripe. */
    boost: toon(palette.accent, 0.4),
    curb: toon(0xf3f0dc, 0.55),
    /** The kerb's red stripe, and the paint on the pit wall. */
    kerbAlt: toon(0xe8443a, 0.55),
    field: toon(palette.field, 0.95),
    /** Dry grass on the run-off, so the two greens read as two surfaces. */
    runoff: toon(0x8a9b52, 0.98),
    road: toon(palette.road, 0.86),
    shadow: new MeshStandardMaterial({ color: palette.shadow, roughness: 1 }),
    tire: new MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.94 }),

    /** The car. `body` is the one a game is most likely to change. */
    body: new MeshStandardMaterial({ color: 0xd93a3a, metalness: 0.18, roughness: 0.3 }),
    /** Kept as an alias so a game that already referred to the old slot still compiles. */
    vehicle: new MeshStandardMaterial({ color: 0xd93a3a, metalness: 0.18, roughness: 0.3 }),
    rivalBody: new MeshStandardMaterial({ color: 0x2f6fd0, metalness: 0.18, roughness: 0.3 }),
    glass: new MeshStandardMaterial({
      color: 0x3f5a70,
      metalness: 0.55,
      roughness: 0.1,
    }),
    // Not black. At 0x23262b every aero part on the car went to the same void and the tail read as a
    // hole; a lit dark grey still says "carbon" and keeps its own form.
    carbon: new MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.24, roughness: 0.46 }),
    wing: new MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.3, roughness: 0.4 }),
    alloy: new MeshStandardMaterial({ color: 0xb9c0c8, metalness: 0.86, roughness: 0.26 }),
    livery: new MeshStandardMaterial({ color: 0xf6f3ea, metalness: 0.05, roughness: 0.42 }),
    /** A shade darker than the body, so the arch lip is a line and not more bodywork. */
    archLip: new MeshStandardMaterial({ color: 0x7d2323, metalness: 0.3, roughness: 0.4 }),
    /** Spoke gaps: what the eye reads as the hole between spokes. */
    hubDark: new MeshStandardMaterial({ color: 0x30343a, metalness: 0.5, roughness: 0.4 }),
    headlamp: new MeshStandardMaterial({
      color: 0xfff6de,
      emissive: 0xfff0c8,
      emissiveIntensity: 0.9,
      roughness: 0.3,
    }),
    // Dim on purpose. At 2.2 the bar plus the bloom stage flared over the whole tail and the car's
    // rear became one orange smear — the emissive was brighter than the sun.
    taillamp: new MeshStandardMaterial({
      color: 0xd93a34,
      emissive: 0xff2a1c,
      emissiveIntensity: 0.75,
      roughness: 0.34,
    }),

    /** Trackside furniture. */
    structure: toon(0xd8dbe0, 0.7),
    crowd: toon(0x3d4a63, 0.9),
    trunk: toon(0x6b4a33, 0.9),
    canopy: toon(0x3f7a44, 0.92),
    /** The hills past the treeline. */
    distant: toon(0x4a6f57, 0.98),
    hoardingBoard: toon(0x2f6fd0, 0.6),
  };
}
