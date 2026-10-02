// The sky, the sun and the weather over the Temperate starter.
//
// Every number here is appearance and all of it is this game's: the sun's angle and colour, the
// Preetham parameters that decide how blue the zenith is, the haze the far ridges fade into, the
// exposure, and the cumulus over the top. `Daylight` is the mechanism underneath it — it owns the
// physical sky, the hemisphere fill, the haze plumbing and the AgX curve, and it creates no mesh,
// material or light of its own choosing — so this file is the whole of the look, handed over as
// options. The one thing the rig cannot do is be swung: it puts its own sun back on the eye every
// frame, so the `L` key's sun lives in this file and the rig's copy is switched off. Everything
// else about that sun is the rig's job — the clipmap shadow windows that follow the eye, the fill,
// the tone curve — and the capabilities call the sky's own uniforms live precisely so a game can
// move the sun under them.
//
// The existing cloud dome samples a soft density field and its sunward neighbourhood for shading.
import { Daylight, type ICtx, VirtualShadowNode } from "@threenative/core";
import {
  BackSide,
  Color,
  DirectionalLight,
  Mesh,
  type Object3D,
  SphereGeometry,
  Vector3,
} from "three";
import { denoise } from "three/addons/tsl/display/DenoiseNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import {
  cameraPosition,
  color,
  densityFogFactor,
  dot,
  exponentialHeightFogFactor,
  float,
  fog,
  max,
  mix,
  mrt,
  mx_fractal_noise_float,
  mx_noise_float,
  normalView,
  normalize,
  output,
  pass,
  positionLocal,
  positionWorld,
  pow,
  saturation,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { BIOMES, type IBiome } from "./biomes.js";
import { setCanopySun } from "./propMaterials.js";

const omitted = new Set(
  new URLSearchParams(globalThis.location?.search ?? "").get("off")?.split(",") ?? [],
);

/**
 * The sun, in the same units the `L` key swings it: a position, not a direction, so the toggle and
 * the playtest's `sunX` read the same number they always have.
 */
export const SUN = {
  colour: new Color(0xffeed0),
  /** Towards the sun. A 35 degree afternoon sun: high enough to light the meadow, low enough that
   *  every spruce throws a shadow long enough to see the ground between the trees. */
  direction: new Vector3(-180, 150, -120),
  /** Irradiance in three's physical units — the same number a Blender sun strength carries. */
  intensity: 4.6,
} as const;

/**
 * The physical sky, the fill and the haze.
 *
 * The `sky` numbers are Preetham's, as three's `SkyMesh` takes them: low turbidity for clean air,
 * rayleigh near 2.4 for a deep blue zenith, and a small mie coefficient so the sun's halo stays a
 * halo. `haze` is the horizon colour the sky itself fades to and the density the ground fades to it
 * at: a 300 metre ridge is a third hazed, which is the aerial perspective the alpine reference is
 * built on, and the sea's far edge is gone before it reaches its own boundary.
 */
/**
 * The sun's direction as a shader node, for anything in the scene that has to agree with the light:
 * the water's glint and its caustics read this rather than normalising `SUN.direction` a second time,
 * so `L` moves them with the rig.
 */
export const SUN_VECTOR = uniform(SUN.direction.clone().normalize()) as unknown as Node<"vec3">;

const RIG = {
  sky: { turbidity: 2.0, rayleigh: 3.0, mieCoefficient: 0.003, mieDirectionalG: 0.82 },
  /** Blue sky fill preserves detail in shade without cancelling the directional sun. */
  fill: { sky: new Color(0xa8c8e8), ground: new Color(0x464937), intensity: 0.62 },
  /** Near terrain stays clear; kilometre-scale ridges fade gradually into blue air. */
  haze: { color: new Color(0x8ca8ba), density: 0.0008 },
  /** Linear exposure for the AgX curve, as 2^EV. AgX already rolls its highlights off, so this sits
   *  below one: a temperate noon here is a bright sky and green that still has detail in it. */
  exposure: 2 ** -0.38,
  /** Edge of the sky box in metres. The camera's far plane is 5000, and the box's corners are half a
   *  diagonal inside that, so this is as large as the world can carry. */
  skySize: 5000,
  /** Two 2048-pixel clip levels cover contacts and the elevated overview, at four bindings. */
  shadowExtents: [24, 320],
} as const;

/** The cumulus deck. Every number is this game's weather. */
const CLOUDS = {
  /** Noise cells across the whole sky. Fewer is a bigger, calmer deck. */
  scale: 5.5,
  /**
   * Vertical stretch of the field, and it is a stretch and not a squash for the reason it looks like
   * one: the field is sampled in view *direction*, so multiplying y up by three makes each cell
   * three times wider than it is tall, which is what a cumulus deck seen from underneath is —
   * puffs with flat bases. Squash it and every cell becomes a column, and the sky fills with smoke.
   */
  stretch: 1.8,
  /**
   * Where the bank field runs from bare sky to solid deck, and where the puff field runs from
   * nothing to solid on top of it. Both ramps are narrow on purpose: a wide one is a smear, and a
   * smear across the whole sky is a fog bank, not a cumulus.
   */
  bank: [-0.2, 0.22],
  coverage: [-0.03, 0.4],
  /** The band of sky the deck occupies: its base just above the horizon, thinning towards the zenith. */
  band: [0.02, 0.1, 0.99, 0.5],
  /** Peak opacity of a fully covered patch of sky. */
  opacity: 0.76,
  /** Sunlit crown, shaded underside, and the silver a thin fringe takes when it faces the sun. */
  tint: { lit: 0xf7f8f9, shade: 0xc8d3de, silver: 0xfff2d4 },
  /** How much a dense core is darkened relative to a thin fringe. */
  core: 0.68,
  /**
   * The deck's brightness against the physical sky behind it. The sky is in radiance units several
   * times above one, so a cloud written as plain white came out darker than the blue around it —
   * grey blobs — once the rig stopped fogging its own dome.
   */
  radiance: 2.25,
} as const;

/**
 * The cloud deck: a dome inside the rig's sky box, alpha-blended over the physical sky.
 *
 * Lit by one dot product against the sun rather than by a volume integral, because a volume is a
 * compute pass per frame and this is a fragment shader over the sky's own pixels. What sells it is
 * the shading, not the integration: sun side white, away side blue-grey, a silver lining where the
 * coverage is thin and the sun is behind, and every core darkened — which is the same read a
 * volumetric integral gives at this size, for one noise field and one `dot`.
 */
function cloudDome(sun: Node<"vec3">, opacity: number = CLOUDS.opacity): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    // Seen from the inside, and never written to depth: the deck is behind everything else in the
    // world and must not occlude a single blade of grass in front of it.
    depthWrite: false,
    fog: false,
    side: BackSide,
    transparent: true,
  });
  // The only coordinate a sky has is the direction to the fragment.
  const direction = normalize(positionLocal);
  const field = vec3(direction.x, direction.y.mul(CLOUDS.stretch), direction.z).mul(CLOUDS.scale);
  const puff = mx_fractal_noise_float(field, 5, 2, 0.5);
  const bank = mx_fractal_noise_float(field.mul(0.3), 2, 2, 0.5);
  // Density sampled towards the live sun approximates self-shadow inside each soft puff.
  const lightDepth = mx_fractal_noise_float(field.add(sun.mul(0.55)), 3, 2, 0.5).add(
    mx_fractal_noise_float(field.add(sun.mul(1.1)), 2, 2, 0.5).mul(0.5),
  );
  const crown = smoothstep(-0.12, 0.24, puff.sub(lightDepth.mul(0.65)));
  const coverage = smoothstep(float(CLOUDS.coverage[0]), float(CLOUDS.coverage[1]), puff);
  const deck = smoothstep(float(CLOUDS.band[0]), float(CLOUDS.band[1]), direction.y).mul(
    smoothstep(float(CLOUDS.band[2]), float(CLOUDS.band[3]), direction.y),
  );
  const toSun = max(dot(direction, sun), 0);
  const lit = mix(
    color(CLOUDS.tint.shade),
    color(CLOUDS.tint.lit),
    smoothstep(float(0), float(0.55), toSun).max(crown.mul(0.85)),
  );
  // The lining: thin coverage facing the sun, and only there.
  const fringe = color(CLOUDS.tint.silver)
    .mul(pow(toSun, float(8)))
    .mul(float(1).sub(coverage))
    .mul(float(0.55));
  material.colorNode = lit
    .add(fringe)
    .mul(mix(float(1), float(CLOUDS.core), coverage))
    .mul(CLOUDS.radiance);
  // Optical thickness leaves translucent wisps instead of a hard clipped noise contour.
  const density = coverage
    .mul(smoothstep(float(CLOUDS.bank[0]), float(CLOUDS.bank[1]), bank))
    .mul(deck);
  material.opacityNode = float(1).sub(density.mul(-2.4).exp()).mul(opacity);
  return material;
}

/** One air colour at both sides of the horizon avoids a sky/ocean seam. */
function atmosphericTint(direction: Node<"vec3">, look: IBiome): Node<"vec3"> {
  const towardSun = dot(direction, SUN_VECTOR).max(0).pow(6);
  return mix(
    color(new Color(look.haze.color)),
    color(new Color(look.sun.color)).mul(1.4),
    omitted.has("scatter") ? float(0) : towardSun.mul(look.haze.sunScatter),
  );
}

/** The rig, the sun that can be swung, and the one call that moves both. */
export interface IOutdoorSky {
  /** The installed rig: physical sky, fill, haze and the AgX curve. Add it to the scene. */
  readonly daylight: Daylight;
  /** This game's sun, with the rig's clipmap shadows on it. Add it to the scene. */
  readonly sun: DirectionalLight;
  /** The sun's x in the sun's own metres: what the `L` key swings and the playtest reads. */
  readonly sunX: number;
  setSunX(x: number): void;
}

/**
 * Build the Temperate starter's whole outdoor light rig: sky, sun, shadows, haze and clouds.
 *
 * The rig's own sun is created and then switched off, because it is this file's sun that the `L` key
 * moves and a rig that puts its sun back on the eye every frame cannot be moved. That is the whole
 * of the substitution; the sky, the fill, the haze and the tone curve are the rig's, and they are
 * what a flat `Color` background and a hand-set `FogExp2` were standing in for.
 */
export function createOutdoorSky(camera: Object3D, biome?: IBiome): IOutdoorSky {
  const direction = biome ? new Vector3(...biome.sun.direction) : SUN.direction;
  const sunColor = biome ? new Color(biome.sun.color) : SUN.colour;
  const rig = biome
    ? {
        ...RIG,
        sky: biome.sky,
        fill: {
          sky: new Color(biome.fill.sky),
          ground: new Color(biome.fill.ground),
          intensity: biome.fill.intensity,
        },
        haze: { color: new Color(biome.haze.color), density: biome.haze.density },
        exposure: biome.exposure,
      }
    : RIG;
  const sun = new DirectionalLight(sunColor, biome?.sun.intensity ?? SUN.intensity);
  sun.name = "temperate-sun";
  sun.castShadow = true;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = biome?.sun.shadowRadius ?? BIOMES.forest.sun.shadowRadius;
  if (omitted.has("sun")) sun.intensity = 0;
  sun.shadow.shadowNode = new VirtualShadowNode(sun, {
    clipExtents: [...rig.shadowExtents],
    mapSize: 2048,
  });
  // A fixed world-origin target keeps the L-key direction independent of the following sky.
  sun.position.copy(direction);

  const daylight = new Daylight({
    exposure: rig.exposure,
    fill: rig.fill,
    follow: camera,
    haze: rig.haze,
    shadowExtents: [...rig.shadowExtents],
    sky: rig.sky,
    skySize: RIG.skySize,
    sunColor,
    sunDirection: direction,
    sunIntensity: 0,
  });
  // The physical sky's radiance is calibrated separately from ground irradiance.
  daylight.sky.cloudCoverage.value = 0; // This game owns one cloud deck.
  const skyMaterial = daylight.sky.material;
  if (skyMaterial.colorNode) {
    const skyDirection = normalize(positionLocal);
    const horizon = skyDirection.y.add(mx_noise_float(skyDirection.mul(14)).mul(0.012));
    skyMaterial.colorNode = mix(
      (skyMaterial.colorNode as Node<"vec3">).mul(biome?.skyRadiance ?? BIOMES.forest.skyRadiance),
      atmosphericTint(skyDirection, biome ?? BIOMES.forest),
      omitted.has("haze") ? float(0) : smoothstep(0.065, 0, horizon),
    );
  }
  daylight.sun.visible = false;
  daylight.add(sun.target);

  const sunDirection = SUN_VECTOR;
  // The deck rides inside the rig's own sky box, so it needs no follow of its own: the box is put
  // back on the eye every frame and the dome is its child. 64 by 32 is enough, because the pattern
  // is per fragment and nothing here is shaded from the dome's own normals.
  const deck = new Mesh(new SphereGeometry(1, 64, 32), cloudDome(sunDirection, biome?.clouds));
  deck.name = "cumulus-deck";
  deck.scale.setScalar(0.9);
  deck.frustumCulled = false;
  daylight.sky.add(deck);

  function setSunX(x: number): void {
    sun.position.set(x, direction.y, direction.z);
    // The sky's sun disc, its brightest quadrant and the cloud deck's lighting all follow the light.
    daylight.sky.sunPosition.value.copy(sun.position).normalize();
    (sunDirection as unknown as { value: Vector3 }).value.copy(sun.position).normalize();
    // And so does the light coming through the needles, which reads the same vector.
    setCanopySun(sun.position);
  }
  setSunX(direction.x);
  return {
    daylight,
    get sunX() {
      return sun.position.x;
    },
    setSunX,
    sun,
  };
}

/** Contact-scale occlusion through the installed chain; daylight still owns exposure and tone. */
export function installOutdoorOcclusion(
  ctx: Pick<ICtx, "renderer" | "scene" | "camera">,
  biome?: IBiome,
): () => void {
  const { renderer, scene, camera } = ctx;
  if (renderer.kind !== "webgpu" || renderer.createRenderChain === undefined) return () => {};
  const look = biome ?? BIOMES.forest;
  const previousFog = scene.fogNode;
  const distanceHaze = densityFogFactor(float(look.haze.density));
  const valleyHaze = exponentialHeightFogFactor(
    float(look.haze.valleyDensity),
    float(look.haze.height),
  ) as Node<"float">;
  // The installed height fog keeps peaks clear. Its sunward tint follows the L key.
  const hazeColor = atmosphericTint(normalize(positionWorld.sub(cameraPosition)), look);
  const heightFog = fog(
    hazeColor,
    omitted.has("haze")
      ? float(0)
      : float(1).sub(distanceHaze.oneMinus().mul(valleyHaze.oneMinus())),
  );
  scene.fogNode = heightFog;
  // AO darkens RGB only; multiplying alpha leaked the backdrop through dark alpine crags.
  const world = pass(scene, camera);
  world.setMRT(mrt({ output, normal: normalView }));
  const depth = world.getTextureNode("depth");
  const normals = world.getTextureNode("normal");
  const contact = ao(depth, normals, camera);
  contact.radius.value = 0.85;
  contact.scale.value = 0.8;
  contact.samples.value = 8;
  contact.resolutionScale = 0.5;
  const filtered = denoise(contact.getTextureNode(), depth, normals, camera);
  const occlusion = filtered as unknown as Node<"vec4">;
  const chain = renderer.createRenderChain({
    input: world.getTextureNode("output"),
    worldPass: world,
    request: {
      stages: ["ambientOcclusion", "grade"].filter((name) => !omitted.has(name)),
      tier: "auto",
    },
    targetFps: 30,
    stages: [
      {
        name: "ambientOcclusion",
        minimumTier: "medium",
        build: (input) =>
          (input as Node<"vec4">).mul(
            vec4(
              vec3(
                mix(
                  1,
                  occlusion.r,
                  float(0.72).mul(float(1).sub(smoothstep(40, 180, world.getViewZNode().negate()))),
                ),
              ),
              1,
            ),
          ),
      },
      {
        name: "grade",
        after: "ambientOcclusion",
        minimumTier: "low",
        build: (input) =>
          vec4(
            saturation(
              (input as Node<"vec4">).rgb,
              mix(
                look.saturation,
                look.skySaturation,
                smoothstep(400, 1500, world.getViewZNode().negate()),
              ),
            ),
            (input as Node<"vec4">).a,
          ),
      },
    ],
  });
  return () => {
    if (scene.fogNode === heightFog) scene.fogNode = previousFog;
    chain.dispose();
    world.dispose();
    contact.dispose();
    filtered.dispose();
  };
}
