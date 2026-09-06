// Generated for you. The sea's tuning and its entire look live in this file, and ThreeNative does
// not read it. `SpectralOcean` runs the simulation and draws nothing: the mesh, the material, the
// colours, the foam line and the tessellation are all decisions this game makes here.
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
import { Mesh, PlaneGeometry } from "three";
import {
  color,
  float,
  mix,
  positionLocal,
  positionWorld,
  smoothstep,
  transformNormalToView,
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
  amplitude: 0.0082,
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
  readbackResolution: 32,
  resolution: 128,
  seed: 20_260_906,
  smallWaveCutoff: 0.32,
  windDirection: 0.55,
  windSpeed: 10.5,
} satisfies ISpectralOceanOptions;

/** The drawn surface's edge length in metres, and how finely it is tessellated. */
export const SURFACE = { segments: 160, size: 300 } as const;

/** Crest foam. Near-white, and not a seventh palette role: the sea's look is owned here. */
const FOAM = 0xe9f4f6;

export function createOcean(): SpectralOcean {
  return new SpectralOcean(SEA);
}

/**
 * Read one cascade's displacement at a world position, **bilinearly**.
 *
 * Nearest-texel sampling is the obvious way to write this and it is visibly wrong here. The mesh
 * carries one vertex per 1.6 m while the fine cascade's texel is 0.29 m, so every vertex grabbed a
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

/**
 * The sea surface: displaced by the simulation, and lit by the scene.
 *
 * The vertex stage reads the cascade buffers directly, so what is drawn is the same field the
 * height query is copied from. If the two disagreed the ship would ride water nothing renders and
 * every assertion in this template would still be green.
 */
export function createWaterMesh(ocean: SpectralOcean): Mesh {
  const geometry = new PlaneGeometry(
    SURFACE.size,
    SURFACE.size,
    SURFACE.segments,
    SURFACE.segments,
  );
  geometry.rotateX(-Math.PI / 2);

  // Standard, not basic. This is the whole reason the sea now has a sun on it rather than a
  // hand-rolled `pow()` blob: a lit material gets the scene's key light, its hemisphere fill and
  // its specular response for free, and gets them consistent with the hull floating on it.
  const material = new MeshStandardNodeMaterial({
    metalness: 0.02,
    // Not glass. At 0.08 the key light landed as one blown white disc on the swell in front of the
    // camera; water this side of a dead calm scatters enough to spread that into a glitter path.
    roughness: 0.29,
  });

  const offset = displacementAt(ocean, positionLocal.x, positionLocal.z);
  material.positionNode = positionLocal.add(offset);

  // Normals by central difference. Without this the surface is lit by the flat plane's normals —
  // every vertex pointing straight up — and a perfectly simulated ocean shades like a sheet of
  // paper.
  //
  // The step is the mesh's own quad size, not a texel. Differencing finer than the mesh can
  // represent measures detail that is never drawn and turns the highlight into noise.
  const step = float(SURFACE.size / SURFACE.segments);
  const east = displacementAt(ocean, positionLocal.x.add(step), positionLocal.z);
  const west = displacementAt(ocean, positionLocal.x.sub(step), positionLocal.z);
  const north = displacementAt(ocean, positionLocal.x, positionLocal.z.add(step));
  const south = displacementAt(ocean, positionLocal.x, positionLocal.z.sub(step));
  const twice = step.mul(2);
  // `transformNormalToView`, not the raw vector. `normalNode` overrides `normalView`, so a
  // material handed a world-space normal lights the surface in the camera's frame instead of the
  // world's: the sun's reflection stopped being a place on the sea and became a column of glare
  // pointing at the camera, sliding across the water as the ship turned.
  material.normalNode = transformNormalToView(
    vec3(west.y.sub(east.y).div(twice), float(1), south.y.sub(north.y).div(twice)).normalize(),
  );

  // Colour by height: deep in the troughs, lit water on the shoulders, foam on the crests. The
  // band is narrower than the wave amplitude on purpose, so the tops read as foam-lit rather than
  // as a gentle gradient.
  const shade = smoothstep(float(-2.4), float(1.8), positionWorld.y);
  const water = mix(color(palette.floor), color(palette.accent), shade);
  const crest = smoothstep(float(1.6), float(3), positionWorld.y);
  material.colorNode = mix(water, color(FOAM), crest);
  // Foam is not a mirror. Roughening the crests is what stops them reading as chrome.
  material.roughnessNode = mix(float(0.29), float(0.82), crest);

  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = "sea-surface";
  return mesh;
}
