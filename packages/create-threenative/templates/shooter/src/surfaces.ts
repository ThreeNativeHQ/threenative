import type { Material, Mesh, Object3D } from "three";

/**
 * One impact-surface vocabulary for every consumer of a bullet hit: the audio
 * team picks its impact voice with it, the VFX team styles its burst with it,
 * and decals will read it later. The values are game content and live only
 * here.
 *
 * The flow is one tag, resolved once: the world builder stamps every hittable
 * mesh with `userData.surface` at construction (`tagSurfaces`), and any
 * consumer calls `resolveSurface(hit.object)` instead of re-deriving
 * name tables of its own. Nothing downstream walks mesh names any more.
 */
export type ImpactSurface = "plaster" | "wood" | "steel" | "stone";

/** Every legal value, so a stale or foreign tag is checked before trusted. */
const SURFACES: readonly ImpactSurface[] = ["plaster", "wood", "steel", "stone"];

/**
 * What an untagged mesh answers: whitewash plaster — the dominant wall in the
 * town and the honest default. The plaster/brick building shells are
 * world-projected per-mesh materials, so they cannot be tabled by identity;
 * they land here rather than in a table row.
 */
export const DEFAULT_SURFACE: ImpactSurface = "plaster";

/**
 * Mesh-name rules. Fallback ONLY, for meshes nobody tagged at construction —
 * dynamic props or proxies dropped into a scene by code that never heard of
 * surfaces. Every mesh the world builder makes is tagged before play starts
 * and never consults these.
 */
const NAME_RULES: readonly (readonly [RegExp, ImpactSurface])[] = [
  [/crate|deck|pier|rail|stair/, "wood"],
  [/barrel|bollard|post|mast|tank|roller|shutter/, "steel"],
  [/quay|plaza|ground/, "stone"],
];

/**
 * Town-material member → what a bullet hears when it lands there. Used once,
 * at construction, to stamp the tag onto every mesh wearing the material —
 * shared palette materials mean one row covers hundreds of meshes. Members
 * left out (water, shallows, fronds) have no honest cue of their own and fall
 * through to the default.
 */
const PALETTE_SURFACES: Readonly<Record<string, ImpactSurface>> = {
  ground: "stone",
  dadoBand: "plaster",
  plasterTrim: "plaster",
  brickTrim: "plaster",
  doorBlue: "wood",
  shutter: "wood",
  rollerSteel: "steel",
  awningCanvas: "plaster",
  awningStripe: "plaster",
  crate: "wood",
  deckWood: "wood",
  barrel: "steel",
  palmTrunk: "wood",
  siteMark: "stone",
  plateFace: "steel",
  plateHit: "steel",
  plateFrame: "steel",
  steel: "steel",
  steelPost: "steel",
  steelMast: "steel",
  tankDark: "steel",
  quay: "stone",
  plazaWarm: "stone",
  plazaCool: "stone",
  plazaPale: "stone",
};

/** The name-rule half of the derivation, shared by both paths below. */
const surfaceFromName = (name: string): ImpactSurface | undefined => {
  for (const [pattern, surface] of NAME_RULES) {
    if (pattern.test(name)) return surface;
  }
  return undefined;
};

/**
 * What a struck object answers as: its construction-time tag if it has one,
 * else the name rules, else the default. The only surface lookup consumers
 * should ever perform.
 */
export const resolveSurface = (object: Object3D): ImpactSurface => {
  const tagged: unknown = object.userData?.surface;
  if (SURFACES.includes(tagged as ImpactSurface)) return tagged as ImpactSurface;
  return surfaceFromName(object.name) ?? DEFAULT_SURFACE;
};

/** Stamp the tag one mesh will answer bullets as. Builders call this. */
export const tagSurface = (object: Object3D, surface: ImpactSurface): void => {
  object.userData.surface = surface;
};

/**
 * Tag every hittable mesh with the surface it answers as. Called once by the
 * world builder after the last merge, when every mesh exists carrying its
 * final material — the merged facade batches included.
 *
 * Per mesh the priority is the one the old per-shot resolver used, so tags
 * match what hits resolved to before tagging existed: a name rule first (a
 * mesh called "crate" is wood whatever it wears), then palette identity off
 * the mesh's first material, then the default.
 */
export const tagSurfaces = (meshes: readonly Mesh[], palette: object): void => {
  const byMaterial = new Map<Material, ImpactSurface>();
  const members = palette as Record<string, unknown>;
  for (const [key, surface] of Object.entries(PALETTE_SURFACES)) {
    const value = members[key];
    if (
      typeof value === "object" &&
      value !== null &&
      (value as { isMaterial?: boolean }).isMaterial === true
    ) {
      byMaterial.set(value as Material, surface);
    }
  }
  for (const mesh of meshes) {
    // Only meshes carry a material; every hittable here is one.
    const meshMaterial = mesh.material;
    const first = Array.isArray(meshMaterial) ? meshMaterial[0] : meshMaterial;
    const surface =
      surfaceFromName(mesh.name) ??
      (first === undefined ? undefined : byMaterial.get(first)) ??
      DEFAULT_SURFACE;
    tagSurface(mesh, surface);
  }
};
