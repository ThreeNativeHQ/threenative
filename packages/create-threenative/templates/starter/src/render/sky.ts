// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The sky is a photograph: `assets/sky.jpg`, Poly Haven's "Kloofendal 48d Partly Cloudy (Pure Sky)"
// by Greg Zaal and Jarod Guest, CC0 (https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky).
// The same image is the background, the environment light every surface reflects and is filled by,
// and — through `SUN_DIRECTION` — the direction the sun's shadows fall. Swap the file for any
// equirectangular sky and re-aim `SUN_DIRECTION` at its sun.
import {
  Color,
  EquirectangularReflectionMapping,
  FogExp2,
  SRGBColorSpace,
  type Scene,
  type Texture,
  Vector3,
} from "three";
import {
  cameraPosition,
  densityFogFactor,
  dot,
  exp2,
  float,
  fog,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  saturate,
  select,
  uniform,
  vec3,
} from "three/tsl";
import { palette } from "./palette.js";

/**
 * How the JPEG was made from the 4k HDR: linear radiance × 0.4, clipped, sRGB-encoded — so white
 * in the file is 2.5 in the sky. Multiplying back restores the HDR brightness of the clouds; the sun
 * disk itself is clipped, which is why the sun is a light (`lighting.ts`) and not a texel.
 */
const SKY_RANGE = 2.5;

/** Unit vector toward the photographed sun: 47.9° up, measured from the source HDR. */
export const SUN_DIRECTION = new Vector3(0.555, 0.742, 0.38).normalize();

/**
 * Height fog, in metres, y up. Density falls off exponentially above `fogHeight`; the fog along the
 * ray from the camera to a fragment is the closed-form integral of that density, so low ground
 * reads hazier than a ridge at the same distance and a camera above the layer looks down through it.
 * Every control says which way to move it.
 */
export const HEIGHT_FOG = {
  /** Optical depth per metre at `fogHeight` (base 2). Up: thicker ground mist. */
  density: 0.0012,
  /** Per metre above `fogHeight`. Up: a thinner, lower layer. Down: mist climbs the hills. */
  heightFalloff: 0.08,
  /** World y where density equals `density`. Move it to the ground of your world. */
  fogHeight: 0,
  /** Floor on the height term's transparency, 0..1. Below 1 leaves a clear window in the mist. */
  maxOpacity: 1,
  /** Metres from the camera before the mist starts. Up: a clear foreground. */
  startDistance: 0,
  /** Sun lobe sharpness. Up: a tighter glow around the sun. */
  sunExponent: 4,
  /** Metres before sun glow starts, so nearby objects are not tinted. */
  sunStartDistance: 100,
  /** Metres past which the height term is off. 0 = never. Never set it inside a streaming ring. */
  cutoffDistance: 0,
} as const;
export type HeightFogParams = { -readonly [K in keyof typeof HEIGHT_FOG]: number };

/** The look this fog replaced: FogExp2 at 0.003, which read as 18% haze at 150 m from 2 m up. */
const EYE_LEVEL = { density: 0.003, distance: 150, cameraHeight: 2 };
const LN2 = Math.LN2;

// Camera density term, clamped so exp2 stays finite (Unreal clamps the exponent at -127).
const clampExponent = (x: number): number => Math.min(127, Math.max(-127, x));

/** `density` times the integral of 2^(-k t) over [a, b]; k is the ray's slope times `falloff`. */
function segment(density: number, k: number, a: number, b: number): number {
  if (b <= a) return 0;
  if (Math.abs(k * b) < 0.01) return density * (b - a - 0.5 * LN2 * k * (b * b - a * a));
  return (density * (2 ** (-k * a) - 2 ** (-k * b))) / (k * LN2);
}

function rayTerms(p: HeightFogParams, cameraY: number, fragmentY: number, length: number) {
  const camera = p.density * 2 ** clampExponent(-p.heightFalloff * (cameraY - p.fogHeight));
  const k = length > 0 ? (p.heightFalloff * (fragmentY - cameraY)) / length : 0;
  return { camera, k };
}

/** Base-2 optical depth (transmittance is 2^-depth) of the mist between the camera and a fragment. */
export function heightFogDepth(
  p: HeightFogParams,
  cameraY: number,
  fragmentY: number,
  length: number,
): number {
  if (p.cutoffDistance > 0 && length > p.cutoffDistance) return 0;
  const { camera, k } = rayTerms(p, cameraY, fragmentY, length);
  return segment(camera, k, p.startDistance, length);
}

/** Height-term transparency, 1 = clear, floored by `1 - maxOpacity`. */
export function heightFogTransmittance(
  p: HeightFogParams,
  cameraY: number,
  fragmentY: number,
  length: number,
): number {
  return Math.max(2 ** -heightFogDepth(p, cameraY, fragmentY, length), 1 - p.maxOpacity);
}

/** How much of the sun's colour the mist carries: the same density, only past `sunStartDistance`. */
export function heightFogInscatter(
  p: HeightFogParams,
  cameraY: number,
  fragmentY: number,
  length: number,
  sunDot: number,
): number {
  const { camera, k } = rayTerms(p, cameraY, fragmentY, length);
  const depth = segment(camera, k, Math.max(p.sunStartDistance, p.startDistance), length);
  const lobe = Math.max(0, Math.min(1, sunDot)) ** p.sunExponent;
  return lobe * (1 - 2 ** -depth) * p.maxOpacity;
}

/**
 * The distance term's density that, with the height term, keeps the old eye-level haze: at
 * `EYE_LEVEL.distance` along the horizon from `EYE_LEVEL.cameraHeight` the two together transmit what
 * FogExp2 at `EYE_LEVEL.density` did. The distance term is lowered, never removed, so the ground
 * still ends in fog at a kilometre.
 */
export function distanceDensity(p: HeightFogParams = HEIGHT_FOG): number {
  const { distance, density, cameraHeight } = EYE_LEVEL;
  const old = (density * distance) ** 2;
  const height = heightFogDepth(p, cameraHeight, cameraHeight, distance) * LN2;
  return Math.sqrt(Math.max(0, old - height)) / distance;
}

const SUN_COLOUR = new Color(0xfff1d6);

/**
 * `T_distance x T_height`: never more transparent than the distance term alone, so wherever that
 * reaches 0 the frame stays fully fogged. Assigned to `scene.fogNode`, which three applies to every
 * material where `scene.fog` would be.
 */
function heightFogNode(color: Color, p: HeightFogParams) {
  const density = uniform(distanceDensity(p));
  // Density at the camera, once per frame instead of once per fragment.
  const cameraDensity = uniform(0).onRenderUpdate(({ camera }) => {
    const y = camera?.matrixWorld.elements[13] ?? 0;
    cameraDensity.value = p.density * 2 ** clampExponent(-p.heightFalloff * (y - p.fogHeight));
  });
  const ray = positionWorld.sub(cameraPosition);
  const length = ray.length().max(1e-4);
  const k = float(p.heightFalloff).mul(positionWorld.y.sub(cameraPosition.y)).div(length);
  const integral = (start: ReturnType<typeof float>) => {
    const a = start;
    const b = max(length, a);
    const flat = b.sub(a);
    const curved = cameraDensity
      .mul(exp2(k.mul(a).negate()).sub(exp2(k.mul(b).negate())))
      .div(k.mul(LN2));
    return select(k.mul(b).abs().lessThan(0.01), cameraDensity.mul(flat), curved);
  };
  const cut = p.cutoffDistance > 0 ? select(length.greaterThan(p.cutoffDistance), 0, 1) : float(1);
  const depth = integral(float(p.startDistance)).mul(cut);
  const heightT = max(exp2(depth.negate()), 1 - p.maxOpacity);
  const distanceT = densityFogFactor(density).oneMinus();
  const opacity = distanceT.mul(heightT).oneMinus();
  const sun = normalize(vec3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z));
  const lobe = pow(saturate(dot(ray.div(length), sun)), p.sunExponent);
  const glow = float(1)
    .sub(exp2(integral(float(Math.max(p.sunStartDistance, p.startDistance))).negate()))
    .mul(lobe)
    .mul(p.maxOpacity);
  const colour = mix(
    vec3(color.r, color.g, color.b),
    vec3(SUN_COLOUR.r, SUN_COLOUR.g, SUN_COLOUR.b),
    glow,
  );
  return fog(colour, opacity);
}

export function setupSky(scene: Scene, sky: Texture, software = false): void {
  sky.mapping = EquirectangularReflectionMapping;
  sky.colorSpace = SRGBColorSpace;
  scene.background = sky;
  scene.backgroundIntensity = SKY_RANGE;
  // three prefilters an equirectangular `scene.environment` itself (PMREM), on WebGPU and WebGL.
  // It is what makes a standard material read as a material: sky-blue fill on faces the sun
  // misses, and a sky to reflect, sharper as roughness drops.
  //
  // Not on a software adapter. PMREM-filtering a 4096x2048 photo keeps a CPU rasteriser's GPU
  // process busy past its watchdog and the next pipeline compiles die with the device (measured on
  // four cores: a 28 s hitch and two failed pipelines with it on, 37 pipelines in 11 s with it
  // off). That lane is not render evidence, so it gives up the fill light.
  if (!software) {
    scene.environment = sky;
    scene.environmentIntensity = SKY_RANGE;
  }
  // Almost nothing inside the arena (1.4% at 30 m), and the ground gone into the horizon by a
  // kilometre — so the floor meets the sky instead of ending at a line. The colour is the
  // photograph's own horizon, sampled from the same HDR, so the fade lands where the sky is.
  // `scene.fog` stays the distance term for anything that reads it; `scene.fogNode` is what three
  // applies, and it adds the height term. One owner at a time: `STARTER_MIST` clears both.
  const params: HeightFogParams = { ...HEIGHT_FOG };
  scene.fog = new FogExp2(palette.skyLow, distanceDensity(params));
  scene.fogNode = heightFogNode(new Color(palette.skyLow), params);
}
