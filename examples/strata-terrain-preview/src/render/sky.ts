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
// The cloud deck is not a rig feature and not a texture: it is a shader on a dome that rides inside
// the rig's sky box, one noise field sampled twice and lit by one dot product. Cumulus read as
// volume because of three things in that field — vertical squash, so the cells are wider than they
// are tall and every puff has a flat base; a second, coarser field, so the deck is banks with clear
// sky between them rather than an even wash; and coverage that thickens inward, so a puff is thin
// and bright at its fringe and dense and blue-grey at its core.
import { Daylight, VirtualShadowNode } from "@threenative/core";
import {
  BackSide,
  Color,
  DirectionalLight,
  Mesh,
  type Object3D,
  SphereGeometry,
  Vector3,
} from "three";
import {
  color,
  dot,
  float,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalize,
  positionLocal,
  pow,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { setCanopySun } from "./propMaterials.js";

/**
 * The sun, in the same units the `L` key swings it: a position, not a direction, so the toggle and
 * the playtest's `sunX` read the same number they always have.
 */
export const SUN = {
  colour: new Color(0xffeed0),
  /** Towards the sun. A 48 degree afternoon sun: high enough to light the meadow, low enough that
   *  every spruce throws a shadow long enough to see the ground between the trees. */
  direction: new Vector3(-180, 185, 120),
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
  sky: { turbidity: 2.4, rayleigh: 2.2, mieCoefficient: 0.003, mieDirectionalG: 0.82 },
  /**
   * Sky fill from above, bounce from below. This is the only thing standing between a spruce's
   * shadow and a hole in the meadow, and at 0.9 the shadows on the hillside read as ink: a real
   * shadow in open ground is lit by the whole dome above it, and the ground half is the meadow's
   * own green, so the shaded side of a rock is lit by the grass it stands in.
   */
  fill: { sky: new Color(0xa8c8e8), ground: new Color(0x464937), intensity: 0.48 },
  /**
   * Haze in the horizon colour, and the density is the aerial perspective. A quarter of a
   * kilometre of exponential-squared haze puts a third of the sky into the far ridge and three
   * quarters into the next one, which is the difference between a landscape with distance in it and
   * a green plane that stops.
   */
  haze: { color: new Color(0x8ca8ba), density: 0.00065 },
  /** Linear exposure for the AgX curve, as 2^EV. AgX already rolls its highlights off, so this sits
   *  below one: a temperate noon here is a bright sky and green that still has detail in it. */
  exposure: 2 ** -0.38,
  /** Edge of the sky box in metres. The camera's far plane is 5000, and the box's corners are half a
   *  diagonal inside that, so this is as large as the world can carry. */
  skySize: 5000,
  /**
   * Shadow windows, finest first. Two, not three, and the gap between them is the point: each
   * window costs two of the sixteen samplers a WebGPU fragment stage has, and the ground material
   * spends ten of them on its own layers. Twelve metres is a spruce's contact shadow at six
   * centimetres a texel; a hundred and twenty is the whole visible hillside at the same six. The
   * window in between would be a third of the picture for a third of the budget the ground has left.
   */
  shadowExtents: [24, 320],
} as const;

/** The colour everything fades into: the sky's own horizon, and the deck's floor. */
const HAZE = RIG.haze.color;

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
  bank: [-0.1, 0.12],
  coverage: [0.16, 0.34],
  /** The band of sky the deck occupies: its base just above the horizon, thinning towards the zenith. */
  band: [0.02, 0.1, 0.99, 0.5],
  /** Peak opacity of a fully covered patch of sky. */
  opacity: 0.95,
  /** Sunlit crown, shaded underside, and the silver a thin fringe takes when it faces the sun. */
  tint: { lit: 0xf7f8f9, shade: 0xc8d3de, silver: 0xfff2d4 },
  /** How much a dense core is darkened relative to a thin fringe. */
  core: 0.78,
  /**
   * The deck's brightness against the physical sky behind it. The sky is in radiance units several
   * times above one, so a cloud written as plain white came out darker than the blue around it —
   * grey blobs — once the rig stopped fogging its own dome.
   */
  radiance: 3.2,
  /**
   * How far below the horizon the deck's own haze reaches, and how far it has faded by then.
   *
   * A landscape seen from a hillside has a bottom to it: past the last ridge there is nothing but
   * more air, and it is the *haze* colour, not the sky's. Without this the world's own edge is a
   * hard diagonal against a blue box, which is the one thing that gives away that this is a
   * five-hundred-metre square.
   */
  floor: [0.02, -0.05, 0],
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
function cloudDome(sun: Node<"vec3">): MeshBasicNodeMaterial {
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
  const puff = mx_fractal_noise_float(field, 4, 2, 0.5);
  const bank = mx_fractal_noise_float(field.mul(0.3), 2, 2, 0.5);
  // Which way a texel faces inside its own puff: the coarse field sampled a little above it, minus
  // the field here. Rising field is the top of a cloud. Two noise calls buy a cumulus its lit crown
  // and its flat grey base on the side of the sky the sun is not on, which is the whole difference
  // between a cumulus and a grey blob.
  const coarse = field.mul(0.3);
  const crown = smoothstep(
    float(-0.25),
    float(0.3),
    mx_noise_float(coarse.add(vec3(0, 2.5, 0))).sub(mx_noise_float(coarse)),
  );
  const coverage = smoothstep(float(CLOUDS.coverage[0]), float(CLOUDS.coverage[1]), puff);
  const deck = smoothstep(float(CLOUDS.band[0]), float(CLOUDS.band[1]), direction.y).mul(
    smoothstep(float(CLOUDS.band[2]), float(CLOUDS.band[3]), direction.y),
  );
  // Everything below the horizon is haze, at the density the ground fades into at the same rate:
  // a second horizon for the eye to stop at, and the world's edge dissolved into it.
  const floor = smoothstep(float(CLOUDS.floor[0]), float(CLOUDS.floor[1]), direction.y).mul(
    CLOUDS.floor[2],
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
  material.colorNode = mix(
    lit
      .add(fringe)
      .mul(mix(float(1), float(CLOUDS.core), coverage))
      .mul(CLOUDS.radiance),
    color(HAZE),
    floor,
  );
  // Feathering the last of the edge keeps a puff from ending on a hard noise contour.
  const density = coverage
    .mul(smoothstep(float(CLOUDS.bank[0]), float(CLOUDS.bank[1]), bank))
    .mul(deck)
    .mul(smoothstep(float(0), float(0.3), coverage))
    .max(floor);
  material.opacityNode = density.mul(CLOUDS.opacity);
  return material;
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
export function createOutdoorSky(camera: Object3D): IOutdoorSky {
  const sun = new DirectionalLight(SUN.colour, SUN.intensity);
  sun.name = "temperate-sun";
  sun.castShadow = true;
  sun.shadow.normalBias = 0.035;
  sun.shadow.shadowNode = new VirtualShadowNode(sun, {
    clipExtents: [...RIG.shadowExtents],
    mapSize: 2048,
  });
  // The target stays out of the scene on purpose: its world matrix is the identity, so the light's
  // direction is the position below and nothing in the world can swing it by accident.
  sun.position.copy(SUN.direction);

  const daylight = new Daylight({
    exposure: RIG.exposure,
    fill: RIG.fill,
    follow: camera,
    haze: RIG.haze,
    shadowExtents: [...RIG.shadowExtents],
    sky: RIG.sky,
    skySize: RIG.skySize,
    sunColor: SUN.colour,
    sunDirection: SUN.direction,
    sunIntensity: 0,
  });
  daylight.sun.visible = false;
  daylight.add(sun.target);

  const sunDirection = SUN_VECTOR;
  // The deck rides inside the rig's own sky box, so it needs no follow of its own: the box is put
  // back on the eye every frame and the dome is its child. 32 by 16 is enough, because the pattern
  // is per fragment and nothing here is shaded from the dome's own normals.
  const deck = new Mesh(new SphereGeometry(1, 32, 16), cloudDome(sunDirection));
  deck.name = "cumulus-deck";
  deck.scale.setScalar(0.9);
  deck.frustumCulled = false;
  daylight.sky.add(deck);

  function setSunX(x: number): void {
    sun.position.set(x, SUN.direction.y, SUN.direction.z);
    // The sky's sun disc, its brightest quadrant and the cloud deck's lighting all follow the light.
    daylight.sky.sunPosition.value.copy(sun.position).normalize();
    (sunDirection as unknown as { value: Vector3 }).value.copy(sun.position).normalize();
    // And so does the light coming through the needles, which reads the same vector.
    setCanopySun(sun.position);
  }
  setSunX(SUN.direction.x);
  return {
    daylight,
    get sunX() {
      return sun.position.x;
    },
    setSunX,
    sun,
  };
}
