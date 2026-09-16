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
  readonly kind?: ICapabilityManifestEntry["kind"];
  readonly signature?: string;
  readonly summary: string;
  readonly situations: readonly string[];
  readonly constraints: readonly string[];
}): ICapabilityManifestEntry {
  return {
    symbol: entry.symbol,
    package: "three",
    importPath: entry.importPath,
    kind: entry.kind ?? "class",
    signature: entry.signature ?? `class ${entry.symbol}`,
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
    symbol: "godrays",
    importPath: "three/addons/tsl/display/GodraysNode.js",
    kind: "function",
    signature: "godrays(textureNode, light, shadowMap, params)",
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
    symbol: "ao",
    importPath: "three/addons/tsl/display/GTAONode.js",
    kind: "function",
    signature: "ao(scene, camera, resolution, radius, intensity)",
    summary:
      "Ground-truth ambient occlusion. Already wired as the `ambientOcclusion` stage; turn it on with `gtaoEnabled`.",
    situations: [
      "darken the contact where an object meets the floor",
      "stop props looking like they float",
      "ambient occlusion, contact shadows, crevice darkening",
    ],
    constraints: ["Radius is in metres; a radius sized for a room reads as a smudge on a prop."],
  }),
  stage({
    symbol: "bloom",
    importPath: "three/addons/tsl/display/BloomNode.js",
    kind: "function",
    signature: "bloom(node, strength, radius, threshold)",
    summary: "Glow around bright pixels. Already wired as the `bloom` stage.",
    situations: ["make a bright opening or a lamp glow", "bloom, glare, light spill"],
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
  // Not a render stage: the engine's scene-draw optimizer, which a game can decline. It lives
  // here because it is framework render-path behaviour with no package export for an agent to
  // search — the same reason the stages above are hand-entered. A game that measured the
  // projection as a loss (paid reconcile without a frame-time win) opts out with `false`.
  {
    symbol: "renderer.projection",
    package: "@threenative/core",
    importPath: "src/game.ts",
    kind: "function",
    signature: "renderer.projection?: boolean",
    summary:
      "The engine's scene-render projection — an internal mirror that collapses repeated draws — on by default. Set `renderer.projection: false` to decline it.",
    situations: [
      "the game got slower after the projection engaged",
      "turn off the render projection, batching, or the instanced mirror",
      "draw count fell but frame time did not",
      "a multi-second freeze when the mirror first engages",
      "opt out of an engine render optimizer",
    ],
    example: "renderer: { projection: false } // in threenative.config.ts",
    constraints: [
      "Unset is the shipping behaviour: the projection runs. Only an explicit `false` declines it.",
      "An opted-out game builds no mirror and runs no eligibility scan; the authored scene is what renders, so declining costs nothing rather than being re-judged each frame.",
      "TN_RENDER_PROJECTION still reports the verdict, with reasonCode `disabled` rather than one of the measured declines.",
    ],
    overrides: [],
    supersedes: [],
  },
  // Also not a render stage: the projected-size cull, which is engine render-path behaviour with no
  // package export of its own. It lives here for the same reason the projection above does — an
  // agent searching "my frame is slow with many distant objects" has nowhere else to find it.
  {
    symbol: "renderer.minimumProjectedPixels",
    package: "@threenative/core",
    importPath: "src/game.ts",
    kind: "function",
    signature: "renderer.minimumProjectedPixels?: number | false",
    summary:
      "Do not submit what the render camera cannot resolve. On by default at a conservative 0.5 projected pixel; an object below it is skipped per render camera. Raise the number to cull more, set `false` to leave every object drawn — the count of what was skipped still reports in `TN_PROJECTION`.",
    situations: [
      "my frame is slow with many distant objects",
      "draw count is high but the screen is mostly empty",
      "far away models, aircraft, boats or props cost draw calls but are specks",
      "a large roster or fleet drops the frame rate while barely visible",
      "stop submitting objects smaller than a pixel to the camera",
      "cull by how big something looks to the camera rather than how far it is from the player",
      "tune how aggressively distant objects are skipped",
      "a small object I need disappeared at range",
    ],
    example: "renderer: { minimumProjectedPixels: 2 } // in threenative.config.ts",
    constraints: [
      "Unset is the shipping behaviour: the gate runs at 0.5 px. A game that wants the cut a shipped title tuned names 2; `false` leaves every object drawn.",
      "The decision reads the render camera's projection and viewport, not the player's distance — a camera far from the player still culls its own specks.",
      "It writes only `object.visible`, which the projection's batch key ignores; `castShadow`, `layers` and `frustumCulled` are never flipped, because that churns batch grouping.",
      "Shadow casters and objects attached to the render camera are never dropped on the main view alone. Exempt any other object with `alwaysRender`.",
      "Turning the gate off with `false` does not turn its measurement off: `TN_PROJECTION` still reports considered and skipped counts as `cull`.",
    ],
    overrides: [
      "alwaysRender(object) keeps one object drawn whatever the render camera resolves",
      "renderer.minimumProjectedPixels: false leaves the scene drawn and keeps the measurement on",
    ],
    supersedes: [],
  },
];
