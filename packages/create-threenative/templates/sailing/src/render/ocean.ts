// Generated for you. The sea's tuning and its entire look live in this file, and ThreeNative does
// not read it. `SpectralOcean` runs the simulation and draws nothing: the mesh, the material, the
// colours, the reflection, the foam line and the tessellation are all decisions this game makes
// here.
//
// This replaces a two-wave `WaveField` under a `MeshBasicNodeMaterial`. Both halves of that were
// the problem. Two analytic waves plus one domain warp is a corrugated sheet — it repeats visibly
// within a boat length, and no amount of colour work hides a surface with two frequencies in it.
// And a *basic* material takes no lights at all, so the sea could not respond to the sun the rest
// of the scene is lit by: its brightness had to be hand-computed with a `pow(dot(n, sun), 30)`
// term standing in for a specular highlight. Water is one of the few surfaces where the specular
// *is* the material, so that read as plastic.
//
// A spectral ocean is cascaded wave spectra inverse-transformed on the GPU every frame, which is
// what real water is, and a standard node material puts it back under the scene's own lights.
import { type ISpectralOceanOptions, SpectralOcean } from "@threenative/core";
import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  type Object3D,
  RepeatWrapping,
  Vector2,
} from "three";
import {
  Fn,
  If,
  abs,
  cameraPosition,
  color,
  dot,
  float,
  max,
  mix,
  oneMinus,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  saturate,
  smoothstep,
  texture,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { palette } from "./palette.js";

/**
 * The sea state. Every number is this game's.
 *
 * `windSpeed` and `amplitude` are the two to reach for: wind sets which wavelengths carry energy,
 * amplitude scales the whole spectrum. `choppiness` above zero displaces horizontally as well as
 * vertically, which is what sharpens a crest into something a hull can be thrown by.
 */
export const SEA = {
  // Sea state, and the number that decides whether this reads as a passage or as a survival
  // storm. At 0.0082 the field measured 3.2 m from trough to crest — two thirds of the ship's
  // whole length, and five times its draught — so the caravel spent the run being thrown about by
  // seas that would have ended the voyage. A working swell for a 4.6 m hull is nearer 1.5 m, and
  // wave height goes as the square root of spectrum scale, so a quarter of the energy halves it.
  amplitude: 0.0034,
  // Largest patch first, and the bands do not overlap. One cascade is a toy — the join between
  // bands is where a spectral ocean visibly fails, so there is nothing to look at until there are
  // two.
  cascades: [{ patchSize: 190 }, { patchSize: 37 }],
  choppiness: 1.2,
  directionality: 2.6,
  gravity: 9.81,
  // The ship reads this field on the CPU for its buoyancy and its attitude, so the copy has to
  // land often enough — and be fine enough — to steer by.
  //
  // 32 samples across the largest patch is one height every six metres, which is coarser than the
  // waves themselves: the hull then sat at a smoothed mean sea level while the drawn surface moved
  // three metres either side of it, so the ship hung in the air over its own troughs and pitched
  // on differences between samples that were nowhere near it. 64 halves that spacing, and the
  // calmer sea state below closes the rest of the gap. This is the cost of a spectral ocean over
  // an analytic one, and it is worth paying — but it has to be paid.
  readbackEveryFrames: 3,
  // 64, and the paragraph above is the reason: at 32 the copy carried one height every six metres
  // across the broad cascade, which is coarser than the ship is long, so both hull probes landed
  // in the same cell and the ship barely answered the sea it was in.
  readbackResolution: 64,
  resolution: 128,
  seed: 20_260_906,
  smallWaveCutoff: 0.32,
  windDirection: 0.55,
  windSpeed: 10.5,
} satisfies ISpectralOceanOptions;

/**
 * How fast the sea's dominant waves travel, and which way they run.
 *
 * A spectral ocean has no closed-form height, so the CPU copy a hull floats on is always some
 * frames behind the field the GPU is drawing — the API says so, and reports the age. This is what
 * a reader needs to *use* that age: deep-water waves travel, so the field at time `t + d` is very
 * nearly the field at time `t` shifted downwind by `speed * d`. Sampling that far **upwind** of a
 * point therefore reads what the water there is about to be doing.
 *
 * The peak angular frequency is the Pierson-Moskowitz one, `0.855 g / U`, and a deep-water wave's
 * phase speed is `g / w`. Both come straight out of `SEA` above, so retuning the wind retunes
 * this with it.
 */
const PEAK_ANGULAR_FREQUENCY = (0.855 * SEA.gravity) / SEA.windSpeed;
export const SWELL = {
  /** Metres per second. */
  speed: SEA.gravity / PEAK_ANGULAR_FREQUENCY,
  x: Math.cos(SEA.windDirection),
  z: Math.sin(SEA.windDirection),
} as const;

/**
 * The most wave-time any reader will extrapolate over, in seconds. See `surfaceHeight`.
 *
 * The lag being corrected for is a few frames in a real session and an order of magnitude worse
 * inside a playtest, where the fixed step runs far faster than wall-clock and a copy in flight
 * covers a hundred ticks. Correcting the first is what a floating thing needs; chasing the second
 * would sample twenty metres upwind, where a spectral field has already decorrelated and the
 * "prediction" is just a different wave.
 */
const MAX_LEAD_SECONDS = 0.25;

/**
 * The sea's height at a world point, corrected for the age of the copy it came from.
 *
 * This is the call anything that floats should use, rather than `sampleHeight` raw: a hull, a
 * buoy or a bit of flotsam put straight onto the returned number rides water the renderer stopped
 * drawing several frames ago, and the tell is a hull that cuts down through a crest and then hangs
 * over the following trough.
 *
 * `undefined` before the first copy lands, exactly as `sampleHeight` is, so a caller still has to
 * decide what an unknown sea level means for it.
 */
export function surfaceHeight(
  ocean: SpectralOcean,
  x: number,
  z: number,
  deltaTime: number,
): number | undefined {
  const probe = ocean.sampleHeight(x, z);
  if (probe === undefined) return undefined;
  const lead = Math.min(MAX_LEAD_SECONDS, Math.max(0, probe.staleFrames) * deltaTime);
  const run = SWELL.speed * lead;
  return ocean.sampleHeight(x - SWELL.x * run, z - SWELL.z * run)?.height ?? probe.height;
}

/**
 * The drawn surface, as a logarithmic disc: rings of quads whose spacing grows with the radius.
 *
 * A square patch cannot do this job at any size. A 300 m square nailed to the ship puts its far
 * edge a hundred and fifty metres out, which is inside the haze, so the player sails to a visible
 * rectangular hem where the sea stops and the photograph starts; and a square big enough to reach
 * the horizon needs 300 m quads near the ship, which is coarser than the waves and throws away
 * everything the cascade buffers are carrying. Rings solve both at once: the innermost quad is a
 * third of a metre beside the hull and the outermost is half a kilometre at the horizon, for
 * *fewer* triangles than the 128×128 grid this replaced.
 */
export const SURFACE = {
  /** Quads around the circle. */
  segments: 160,
  /** Rings from the ship to the horizon. */
  rings: 96,
  /** Radius of the first ring, in metres. */
  inner: 1.5,
  /** Radius of the last ring. Past the eye's own horizon at this height, and fully hazed. */
  reach: 6_000,
} as const;

/**
 * The step the surface normal is differenced over, in metres.
 *
 * Deliberately finer than the mesh's own quad, which is a third of a metre here. Differencing at
 * the quad size throws away every wave shorter than about four metres *before it can shade
 * anything*, and a sea with no short waves in its normals has no glitter: the sun arrives as one
 * smooth mirror lobe a third of the frame wide, blooms, and blows out. Shading detail below the
 * geometric resolution is the whole point of a normal, and the fine cascade already carries it at
 * 0.29 m per texel. This sits between the two: fine enough to break the highlight into a glitter
 * path, coarse enough not to alias into sparkle noise as the camera moves.
 */
const NORMAL_STEP = 0.7;

/** Crest foam. Near-white, and not a seventh palette role: the sea's look is owned here. */
const FOAM = 0xe9f4f6;

/**
 * How much of the mirror the sea shows.
 *
 * The mirrored pass draws the world *and* the sky behind it, so its texture already holds the
 * photograph reflected about the water — which is why there is no second sky lookup here to blend
 * against it. Two would count the same cloud twice, and at a grazing angle that is most of a low
 * chase camera's frame: the middle distance came back a milky sheet with the horizon burned to
 * white. Below one because a render target is written linear, where the screen is tone-mapped, so
 * what arrives is the raw 2.5-range photograph and the water would mirror it at full stops.
 */
const MIRROR_GAIN = 0.85;

/**
 * The layer the water's mirror draws. An object on it is **also** on layer 0, so the main camera
 * is unaffected and only the mirrored pass narrows.
 *
 * It is the hull, the marks and the headland — the silhouettes a player actually reads in the
 * water. The sea itself is not on it, which is what stops the mirror from redrawing the mirror,
 * and the sky is not on it because the sky arrives through `reflectedSky` instead: the mirrored
 * pass is a second draw of the world, and putting a 4096-wide photograph in it would buy a
 * lower-resolution copy of a lookup this material can already do for free.
 */
export const REFLECTED_LAYER = 1;
/**
 * How the sea's mirror is built. The *decision* lives here; the construction is the scene's,
 * because `src/render/` reaches the engine only for the wave simulation it draws.
 *
 * Half is the honest resolution for a reflection seen through moving water — the surface itself is
 * the blur, and a sharp half-res copy of a hull in a swell reads no better than a soft full-res
 * one. The layer mask is what keeps the pass affordable: it is a second draw of the world, so
 * `markReflected` is what names the handful of objects worth paying for.
 */
export const SEA_MIRROR = {
  level: 0,
  // Never read: this sea is deep everywhere and has no bed to see. The option is required, and
  // this is the depth of water a fully hazed fragment stands behind.
  maxThickness: 24,
  reflection: { resolutionScale: 0.5, layers: 1 << REFLECTED_LAYER },
} as const;

/** The one thing this material asks of the mirror. Structural, so the type is not an import. */
interface ISeaMirror {
  reflectionAt(offset?: Node<"vec2">): Node<"vec3">;
  dispose(): void;
}

/**
 * Put an object in the mirror, and every child of it. Layers are not inherited in three, so a
 * merged hull of seven meshes needs the walk.
 */
export function markReflected(object: Object3D): void {
  object.traverse((part) => part.layers.enable(REFLECTED_LAYER));
}

export function createOcean(): SpectralOcean {
  return new SpectralOcean(SEA);
}

/**
 * Read one cascade's displacement at a world position, **bilinearly**.
 *
 * Nearest-texel sampling is the obvious way to write this and it is visibly wrong here. The mesh
 * carries one vertex per 0.3 m while the fine cascade's texel is 0.29 m, so every vertex grabbed a
 * different texel of a field it was far too coarse to resolve — and the normal, being a difference
 * of two of those, came out piecewise-constant. The frame showed the sun's reflection broken into
 * hard axis-aligned white rectangles, which is a sampling artefact and reads as a bug in the water.
 *
 * The two `mod`s are not redundant: the first is still negative for a vertex left of the origin,
 * and a negative index reads whatever happens to sit behind the buffer.
 */
function cascadeAt(
  ocean: SpectralOcean,
  index: number,
  x: Node<"float">,
  z: Node<"float">,
): Node<"vec4"> {
  const grid = float(ocean.resolution);
  const patch = float(ocean.cascadePatchSize(index));
  const buffer = ocean.cascadeDisplacement(index);
  const u = x.div(patch).mul(grid);
  const v = z.div(patch).mul(grid);
  const u0 = u.floor();
  const v0 = v.floor();
  const wrap = (value: Node<"float">): Node<"float"> => value.mod(grid).add(grid).mod(grid);
  const read = (cx: Node<"float">, cz: Node<"float">): Node<"vec4"> =>
    buffer.element(wrap(cz).mul(grid).add(wrap(cx)).toUint()) as Node<"vec4">;
  const near = mix(read(u0, v0), read(u0.add(1), v0), u.sub(u0));
  const far = mix(read(u0, v0.add(1)), read(u0.add(1), v0.add(1)), u.sub(u0));
  return mix(near, far, v.sub(v0)) as Node<"vec4">;
}

/** Summed displacement of both cascades at a world position. */
function displacementAt(ocean: SpectralOcean, x: Node<"float">, z: Node<"float">): Node<"vec3"> {
  const broad = cascadeAt(ocean, 0, x, z);
  const fine = cascadeAt(ocean, 1, x, z);
  return vec3(broad.x.add(fine.x), broad.y.add(fine.y), broad.z.add(fine.z));
}

/** A sea surface, and the handle that keeps it under the ship. */
export interface IWaterSurface {
  readonly mesh: Mesh;
  /** Move the drawn sea to follow a position, keeping the wave field anchored to the world. */
  follow(x: number, z: number): void;
  /** The sea's own clock, for the ripple normals. The wave field has the game's `advance`. */
  advance(elapsed: number): void;
  /**
   * Where the ship is, which way it is pointing, and how hard it is pushing water aside.
   *
   * `strength` is 0..1 and is the speed made good over the hull's own maximum: a ship lying to
   * with no way on leaves no wake, which is the point.
   */
  wake(x: number, z: number, forwardX: number, forwardZ: number, strength: number): void;
  /** Releases the mirror's render target. The scene calls this on `exit`. */
  dispose(): void;
}

/**
 * The wake's shape: how far astern it reaches in metres, how fast the wedge opens, and how wide it
 * is at the transom.
 *
 * The half-angle of a real Kelvin wedge is about nineteen degrees whatever the hull is doing,
 * which is a `spread` near 0.34 — and at that width, over thirty-four metres, the wake covers so
 * much of a low-camera frame that it stops reading as a wake and becomes a pale smear across the
 * bottom third. Narrower and shorter is the lie worth telling.
 */
const WAKE = { length: 26, spread: 0.21, waist: 0.5 } as const;

/**
 * The ripples, as a 256² normal map made of periodic value noise — no file, no fetch, no bytes.
 *
 * The FFT carries energy down to 0.29 m and the geometry can only be tessellated so far, so the
 * last two octaves of a real sea — the chop between the wave crests — have to come from somewhere
 * that is not the mesh. Two scrolling octaves of this are what break the sun's highlight into a
 * glitter path instead of one blown lobe, and they are the reason a wave crest has a skin on it.
 */
function rippleNormals(): DataTexture {
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  // Periodic value noise on a `k`-cell grid, so the texture tiles without a visible seam.
  const hash = (x: number, z: number): number => {
    const a = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return a - Math.floor(a);
  };
  const noise = (u: number, v: number, k: number): number => {
    const x = u * k;
    const z = v * k;
    const i = Math.floor(x);
    const j = Math.floor(z);
    let a = x - i;
    let b = z - j;
    a = a * a * a * (a * (a * 6 - 15) + 10);
    b = b * b * b * (b * (b * 6 - 15) + 10);
    const h = (hx: number, hz: number): number => hash(((hx % k) + k) % k, ((hz % k) + k) % k);
    return (
      (h(i, j) * (1 - a) + h(i + 1, j) * a) * (1 - b) +
      (h(i, j + 1) * (1 - a) + h(i + 1, j + 1) * a) * b
    );
  };
  const height = (u: number, v: number): number =>
    noise(u, v, 8) * 0.58 +
    noise(u, v, 16) * 0.28 +
    noise(u, v, 32) * 0.11 +
    noise(u, v, 64) * 0.03;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const u = i / n;
      const v = j / n;
      const e = 1 / n;
      const nx = (height(u + e, v) - height(u - e, v)) * 6;
      const nz = (height(u, v + e) - height(u, v - e)) * 6;
      const at = (j * n + i) * 4;
      data[at] = Math.max(0, Math.min(255, (nx * 0.5 + 0.5) * 255));
      data[at + 1] = Math.max(0, Math.min(255, (nz * 0.5 + 0.5) * 255));
      data[at + 2] = 240;
      data[at + 3] = height(u, v) * 255;
    }
  }
  const map = new DataTexture(data, n, n);
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

/** The logarithmic disc, in the sea patch's own space: one vertex at the centre, then the rings. */
function seaDisc(): BufferGeometry {
  const { inner, reach, rings, segments } = SURFACE;
  const growth = Math.log(1 + reach / inner) / rings;
  const positions: number[] = [0, 0, 0];
  const indices: number[] = [];
  for (let ring = 0; ring < rings; ring += 1) {
    const radius = inner * (Math.exp((ring + 1) * growth) - 1);
    for (let step = 0; step < segments; step += 1) {
      const angle = (step / segments) * Math.PI * 2;
      positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    }
  }
  for (let step = 0; step < segments; step += 1) {
    indices.push(0, 1 + ((step + 1) % segments), 1 + step);
  }
  for (let ring = 1; ring < rings; ring += 1) {
    for (let step = 0; step < segments; step += 1) {
      const near = 1 + (ring - 1) * segments + step;
      const nearNext = 1 + (ring - 1) * segments + ((step + 1) % segments);
      const far = 1 + ring * segments + step;
      const farNext = 1 + ring * segments + ((step + 1) % segments);
      indices.push(near, farNext, far, near, nearNext, farNext);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The slope of the swell at a world position, by central difference.
 *
 * Without this the surface is lit by the flat plane's normals — every vertex pointing straight up
 * — and a perfectly simulated ocean shades like a sheet of paper. The step is `NORMAL_STEP`, not
 * the mesh's quad; see the note on that constant.
 */
function surfaceSlope(ocean: SpectralOcean, x: Node<"float">, z: Node<"float">): Node<"vec2"> {
  const step = float(NORMAL_STEP);
  const east = displacementAt(ocean, x.add(step), z);
  const west = displacementAt(ocean, x.sub(step), z);
  const north = displacementAt(ocean, x, z.add(step));
  const south = displacementAt(ocean, x, z.sub(step));
  const twice = step.mul(2);
  return vec2(west.y.sub(east.y).div(twice), south.y.sub(north.y).div(twice));
}

/**
 * Two scrolling octaves of the ripple map, as a slope in the same units as `surfaceSlope`.
 *
 * Only ever called inside an `Fn`, because `If` needs a shader stage to build against — and it is
 * called from two of them, one per stage, which is why it returns a graph rather than a value.
 */
function rippleSlope(ripples: DataTexture, time: Node<"float">, fade: Node<"float">): Node<"vec2"> {
  const slope = vec2(0, 0).toVar();
  If(fade.greaterThan(0.02), () => {
    const micro = texture(
      ripples,
      vec2(positionWorld.x, positionWorld.z)
        .mul(vec2(0.022, 0.045))
        .add(time.mul(vec2(0.006, 0.003))),
    );
    const finer = texture(
      ripples,
      vec2(positionWorld.x, positionWorld.z)
        .mul(vec2(0.1, 0.075))
        .add(time.mul(vec2(-0.014, 0.009))),
    );
    slope.assign(micro.rg.mul(2).sub(1).add(finer.rg.mul(2).sub(1).mul(0.32)));
  });
  return slope;
}

export function createWaterMesh(ocean: SpectralOcean, mirror: ISeaMirror): IWaterSurface {
  const geometry = seaDisc();
  const ripples = rippleNormals();

  // Where the drawn patch sits in the world.
  //
  // The disc is nailed to the ship rather than to the origin, and the field it reads does **not**
  // travel with it — the cascade lookup adds this offset back, so a wave stays where it is in the
  // world while the mesh slides underneath it. Without that the whole ocean would be dragged along
  // by the ship and the sea would appear to stand still.
  const seaOrigin = uniform(new Vector2());
  const seaTime = uniform(0);
  const shipOrigin = uniform(new Vector2());
  const shipForward = uniform(new Vector2(0, -1));
  const wakeStrength = uniform(0);

  // Standard, not basic. This is the whole reason the sea has a sun on it rather than a
  // hand-rolled `pow()` blob: a lit material gets the scene's key light and its specular response
  // for free, and gets them consistent with the hull floating on it.
  const material = new MeshStandardNodeMaterial({
    metalness: 0.02,
    // The sun's own highlight is the one term this material does **not** need help with, and it is
    // the term that ruins the frame when it is too sharp. A GGX lobe at 0.16 peaks thousands of
    // times brighter than its own average, and a low chase camera sees most of the sea at a
    // grazing angle — so the peak lands across a third of the water at once and ACES turns the
    // whole middle distance into a white sheet. 0.3 spreads the same energy over several times
    // the area: the glitter path is still a glitter path, and the sea around it is still sea.
    roughness: 0.36,
  });
  // The mirror is added below instead, and the environment's own specular is turned off so the
  // photograph is counted once: `reflectedSky` reads the same image, in the reflected direction,
  // which is what an environment map does for free everywhere else in the scene.
  material.envMapIntensity = 0;

  const worldX = positionLocal.x.add(seaOrigin.x);
  const worldZ = positionLocal.z.add(seaOrigin.y);
  const offset = displacementAt(ocean, worldX, worldZ);
  material.positionNode = positionLocal.add(offset);

  const eye = cameraPosition.sub(positionWorld);
  const distance = eye.length();
  // How far off the ship a ripple can still be told apart, from range alone. A vertex shader cannot
  // ask how big its own fragment is, so this is the vertex stage's half of the answer and
  // `subpixel` below is the fragment stage's.
  const far = float(1).div(distance.mul(0.003).add(1));

  // How much of a wave a pixel can still resolve, as a 0..1 fraction. Past a ~4 m footprint the
  // swell is sub-pixel and the ripples mip to flat, which is what turned every sea beyond ~130 m
  // into a mirror. The slope that is lost does not vanish physically, it becomes roughness — so it
  // is spent as roughness below, on both the mirror and the sun.
  const footprint = positionWorld.dFdx().length().max(positionWorld.dFdy().length());
  const subpixel = smoothstep(0.4, 4, footprint);
  const detail = far.mul(oneMinus(subpixel));

  const normalAt = (fade: Node<"float">): Node<"vec3"> => {
    const slope = surfaceSlope(ocean, worldX, worldZ).add(
      rippleSlope(ripples, seaTime, fade).mul(0.47).mul(fade),
    );
    return vec3(slope.x.negate(), 1, slope.y.negate()).normalize();
  };
  // `transformNormalToView`, not the raw vector. `normalNode` overrides `normalView`, so a
  // material handed a world-space normal lights the surface in the camera's frame instead of the
  // world's: the sun's reflection stopped being a place on the sea and became a column of glare
  // pointing at the camera, sliding across the water as the ship turned.
  material.normalNode = Fn(() => transformNormalToView(normalAt(far)))();

  // Colour by height: deep in the troughs, lit water on the shoulders, foam on the crests. The
  // band is narrower than the wave amplitude on purpose, so the tops read as foam-lit rather than
  // as a gentle gradient.
  // These four numbers are in metres of wave height, so they move with `SEA.amplitude` and are
  // wrong the moment it changes.
  // Deliberately high on the range, not centred on it. The readback carries this spectrum from
  // about -1.4 m to +1.4 m, so a band centred on zero is above its own threshold across half the
  // sea and the water comes back one even mid teal from bow to horizon — flat, and pale, because
  // `accent` is the *crest* colour. Put the band where the crests are and the sea is deep water
  // everywhere except its tops, which is the only way a height ramp reads as a swell.
  const shade = smoothstep(float(-0.4), float(1.8), positionWorld.y);
  const water = mix(color(palette.floor), color(palette.accent), shade);
  // Foam on the tops, not on the faces. The band has to sit near the **highest** water the field
  // reaches, not near its mean: a threshold clearing across whole wave faces at once reads as snow
  // rather than as sea.
  // Foam only above the height this sea state ever reaches.
  //
  // A 1.5 m working swell does not break, so nothing in it is white. Threshold it below the
  // spectrum's own maximum and the broad cascade's shoulders — a 200 m wavelength, so a smooth
  // region hundreds of metres across — clear the band together, and the middle distance comes back
  // as one white sheet with a wave-shaped edge, which is worse than no foam at all: it reads as
  // fog lying on the water. Raise `SEA.amplitude` into a gale and this band starts earning itself.
  const crest = smoothstep(float(1.6), float(2.2), positionWorld.y);

  // The wake, computed rather than drawn.
  //
  // A hull moving through water at six knots that leaves the surface exactly as it found it is the
  // single clearest tell that a sea is a backdrop rather than something the ship is in — and it
  // was, because nothing in this material knew the ship existed. This costs no geometry, no
  // particles and no second pass: the surface already knows its own world position, so it can be
  // told where the ship is and work out whether it is standing in its wake.
  //
  // Everything is in the ship's frame. `astern` is metres behind it and `across` is metres off its
  // centreline, so the wedge is a comparison rather than a rotation.
  const toShip = vec2(positionWorld.x.sub(shipOrigin.x), positionWorld.z.sub(shipOrigin.y));
  const starboardAxis = vec2(shipForward.y.negate(), shipForward.x);
  const astern = dot(toShip, shipForward).negate();
  const across = abs(dot(toShip, starboardAxis));
  // A Kelvin wedge, and it needs both of its parts.
  //
  // Filling the wedge evenly gives a soft triangle that reads as haze on the water. What a wake
  // actually looks like from astern is a churned band directly behind the transom with two bright
  // arms running out from it at the edges of the wedge, and the arms are the half of it the eye
  // recognises: they are the only straight lines in a scene made entirely of swell.
  const halfWidth = astern.mul(WAKE.spread).add(WAKE.waist);
  const churn = smoothstep(halfWidth.mul(0.62), halfWidth.mul(0.12), across).mul(0.6);
  const arms = smoothstep(halfWidth.mul(0.5), float(0), abs(across.sub(halfWidth)));
  const reach = smoothstep(float(WAKE.length), float(0), astern);
  const begins = smoothstep(float(-1.4), float(1.6), astern);
  // Never quite to full foam. At 1.0 the arms are the brightest thing in the frame and read as two
  // searchlights laid on the sea rather than as broken water.
  const wake = max(churn, arms).mul(reach).mul(begins).mul(wakeStrength).mul(0.78);
  material.colorNode = mix(mix(water, color(FOAM), crest), color(FOAM), wake);

  // What the sea shows of the world above and around it.
  //
  // Fresnel is the term that decides whether a surface reads as water at all: looked straight down
  // into, water is nearly transparent and shows its own depth; looked along, it is a mirror of
  // whatever stands over it. Without it the sea is one flat teal from the bow to the horizon
  // whatever the waves underneath it are doing, because a diffuse albedo that ignores the view
  // direction cannot be sea.
  //
  // One source, and it is the whole answer: the half-res mirrored pass draws the sky, the headland,
  // the marks and the hull into one texture, and a water surface reflects all of them with the
  // same Fresnel weight. Sampling the photograph a second time in the reflected direction — which
  // is what a scene without a planar mirror has to do — would count the same cloud bank twice over,
  // and at the grazing angles a chase camera spends most of its frame in, twice is a white sheet.
  material.emissiveNode = Fn(() => {
    const normal = normalAt(detail);
    const facing = saturate(dot(normal, eye.normalize()));
    // Exponent five is water's own Schlick curve, and the 0.97963/0.02037 pair is its reflectance
    // at the horizon and at normal incidence.
    const fresnel = pow(oneMinus(facing), float(5)).mul(0.97963).add(0.02037);
    // The normal's own slope is the offset: it is the same slope that is bending the light, so the
    // mirror wobbles with the wave it is standing on.
    const reflected = mirror.reflectionAt(normal.xz.mul(0.02)).mul(MIRROR_GAIN);
    // Rough water does not mirror at grazing angles the way a flat facet does: the microfacets that
    // survive are not aligned with the view, so reflectance falls off with roughness.
    const rough = max(crest, wake);
    return reflected.mul(fresnel).mul(oneMinus(max(subpixel, rough).mul(0.75)));
  })();
  // Roughness is spent, not lost: the slope a distant pixel can no longer resolve reappears here,
  // which is what stops every sea beyond a hundred and thirty metres from becoming a mirror. Foam
  // is not a mirror either, and roughening the crests is what stops them reading as chrome.
  material.roughnessNode = max(float(0.36).add(subpixel.mul(0.22)), max(crest, wake).mul(0.9));

  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = "sea-surface";

  // Snapped, because following continuously would slide every vertex through the wave field by a
  // fraction of its size every frame and the surface would visibly crawl. A whole-metre step is
  // coarse enough to stop the crawl and fine enough that the snap itself cannot be seen.
  return {
    mesh,
    advance(elapsed: number): void {
      seaTime.value = elapsed;
    },
    wake(x: number, z: number, forwardX: number, forwardZ: number, strength: number): void {
      shipOrigin.value.set(x, z);
      shipForward.value.set(forwardX, forwardZ);
      wakeStrength.value = Math.max(0, Math.min(1, strength));
    },
    follow(x: number, z: number): void {
      const snappedX = Math.round(x);
      const snappedZ = Math.round(z);
      mesh.position.set(snappedX, 0, snappedZ);
      seaOrigin.value.set(snappedX, snappedZ);
    },
    dispose(): void {
      mirror.dispose();
      ripples.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
