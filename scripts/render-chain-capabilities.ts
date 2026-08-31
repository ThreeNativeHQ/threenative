import type { ICapabilityManifestEntry } from "./build-capability-manifest.js";

/**
 * The lighting stages a generated game already has, described in the words someone would use
 * before they know the name.
 *
 * These are not package exports, so nothing puts them in the manifest automatically: they are TSL
 * nodes composed by `src/render/postprocessing.ts`, which is generated source the game owns. The
 * result was that `engine_search_capabilities("light shaft through a window")` returned nothing
 * while the stage had been shipping, tuned, and documented for months — and the cost of that gap
 * is measured in this repo's own history: a scene was built with hand-authored cone geometry for
 * beams the render chain was already drawing.
 *
 * The manifest is the thing an agent searches first, so a stage absent from it does not exist.
 * Each entry therefore carries the situations in plain words, and the constraint that actually
 * bites — for godrays, that the beams and the haze are separated by `godraysFloor`, not by
 * `godraysIntensity`.
 */
function stage(entry: {
  readonly symbol: string;
  readonly importPath: string;
  readonly summary: string;
  readonly situations: readonly string[];
  readonly constraints: readonly string[];
}): ICapabilityManifestEntry {
  return {
    symbol: entry.symbol,
    package: "three",
    importPath: entry.importPath,
    kind: "class",
    signature: `class ${entry.symbol}`,
    summary: entry.summary,
    situations: entry.situations,
    // Every one of these is already wired; the example is the dial, not the constructor.
    example: "src/render/postprocessing.ts — edit the preset it passes to WorldEnvironment",
    constraints: entry.constraints,
    overrides: [],
    supersedes: [],
  };
}

export const RENDER_CHAIN_MANIFEST_ENTRIES: readonly ICapabilityManifestEntry[] = [
  stage({
    symbol: "GodraysNode",
    importPath: "three/addons/tsl/display/GodraysNode.js",
    summary:
      "Raymarched shafts of light. Already wired as the `godRays` stage of the render chain; turn it on with `godraysEnabled` in src/render/postprocessing.ts.",
    situations: [
      "draw a visible shaft of light through a window or a hole in a roof",
      "god rays, sun shafts, light beams, crepuscular rays",
      "make sunlight visible in dusty or misty air indoors",
      "light a cave or a hall through an opening above",
      "volumetric lighting without adding cone geometry",
    ],
    constraints: [
      "Needs a shadow-casting DirectionalLight passed as `godraysLight`, and `renderer.shadowMap.enabled = true` — without the shadow map the stage refuses and the whole chain reports it dropped.",
      "`godraysFloor` is what separates beams from fog: it subtracts out-of-beam scatter before `godraysIntensity` multiplies. Raising intensity with a floor near zero brightens the haze over the whole room instead of the beams.",
      "Do not author cone geometry for beams. A hand-built additive cone draws its own silhouette and reads as a plastic tube; this stage is the supported route.",
      "Measured band on an interior scene: density 0.7, floor 0.08, intensity 3.0, maxDensity 0.6. Above ~0.8 density the haze stops being confined to the beams and the room fogs.",
    ],
  }),
  stage({
    symbol: "GTAONode",
    importPath: "three/addons/tsl/display/GTAONode.js",
    summary:
      "Ground-truth ambient occlusion. Already wired as the `ambientOcclusion` stage; turn it on with `gtaoEnabled`.",
    situations: [
      "darken the contact where an object meets the floor",
      "stop props looking like they float",
      "ambient occlusion, contact shadows, crevice darkening",
    ],
    constraints: [
      "Radius is in metres; a radius sized for a room reads as a smudge on a prop.",
    ],
  }),
  stage({
    symbol: "BloomNode",
    importPath: "three/addons/tsl/display/BloomNode.js",
    summary: "Glow around bright pixels. Already wired as the `bloom` stage.",
    situations: [
      "make a bright opening or a lamp glow",
      "bloom, glare, light spill",
    ],
    constraints: [
      "Strength above ~0.3 on an interior washes the mid-tones; the reference-matching band is lower than it looks.",
    ],
  }),
  stage({
    symbol: "WorldEnvironment",
    importPath: "src/render/worldEnvironment.ts",
    summary:
      "The generated file that composes every lighting stage and prints TN_RENDER_CHAIN naming each one as applied or refused with a reason. It is the game's source, not the framework's — edit it.",
    situations: [
      "turn a lighting or post-processing effect on or off",
      "find out why an effect you enabled is not visible",
      "change how the scene is lit, graded, or tonemapped",
      "match a reference image's lighting",
    ],
    constraints: [
      "Read the TN_RENDER_CHAIN line before assuming a stage ran: it names every stage as applied or dropped, with the reason it was dropped.",
      "A stage reported `applied` can still be invisible if its own inputs are wrong — the chain reports whether it built, not whether you can see it.",
      "Appearance belongs here, in generated game source. Nothing in packages/ decides how the scene looks.",
    ],
  }),
];
