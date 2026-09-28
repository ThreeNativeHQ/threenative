// Generated for you: the car's livery and the circuit's surfaces. ThreeNative does not read this
// file, and nothing in `shapes.ts` names a colour — it only names these slots. Re-livery the car,
// or repaint the circuit, entirely from here.
//
// The circuit is the engine's **test-arena look**: a metre grid on two greys, so a surface reads as
// a measured plane and the eye has something to judge speed against, and one saturated colour for
// what you can interact with. The road is the exception and deliberately so: tarmac is the one
// surface a racing game cannot make a grid, because a grid is a *test* pattern and tarmac is a
// surface with a grain and a seam. `gridTexture` and `worldGridUVs` are copied from `minimal`, so
// one grid tile is one metre on every face of every prop on both kits.
import {
  type BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import { palette, toon } from "./palette.js";

/** The grid line, a shade under both grid bases. Derived here so `palette.ts` stays six roles. */
const GRID_LINE = 0x3a3a3c;

/**
 * One metre of grid: a heavy line on the metre, faint lines every 25 cm, a faint per-texel grain so
 * large areas do not band. Built from bytes rather than a canvas so it runs the same in the browser
 * and in the native host.
 */
function gridTexture(base: number, line: number, size = 256): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const minorEvery = size / 4;
  let seed = 7;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const major = x < 3 || y < 3;
      const minor = x % minorEvery < 1 || y % minorEvery < 1;
      const weight = major ? 0.92 : minor ? 0.22 : 0;
      seed = (seed * 16807) % 2147483647;
      const grain = 1 + (seed / 2147483647 - 0.5) * 0.04;
      const index = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const shift = 16 - channel * 8;
        const from = ((base >> shift) & 0xff) * grain;
        const to = (line >> shift) & 0xff;
        data[index + channel] = Math.min(255, Math.round(from * (1 - weight) + to * weight));
      }
      data[index + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  return texture;
}

const _normal = new Vector3();

/**
 * A faint cast-concrete grain as a tangent-space normal map: two octaves of smoothed value noise,
 * tiling every metre like the grid. It is what stops a large flat face reading as an untextured
 * blockout under a low sun — the light breaks up across it instead of sliding off in one tone.
 * Bytes, not a file, so it costs nothing to ship and runs on every target.
 */
function grainNormalTexture(size = 128): DataTexture {
  const cells = [8, 32];
  const lattice = cells.map((count) => {
    const values = new Float32Array(count * count);
    let seed = count * 7919;
    for (let index = 0; index < values.length; index += 1) {
      seed = (seed * 16807) % 2147483647;
      values[index] = seed / 2147483647;
    }
    return { count, values };
  });
  const height = (x: number, y: number): number => {
    let total = 0;
    for (const [octave, { count, values }] of lattice.entries()) {
      const u = (x / size) * count;
      const v = (y / size) * count;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = u - x0;
      const fy = v - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (i: number, j: number): number =>
        values[(((j % count) + count) % count) * count + (((i % count) + count) % count)] ?? 0;
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      total += (top + (bottom - top) * sy) * (octave === 0 ? 1 : 0.5);
    }
    return total;
  };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = height(x + 1, y) - height(x - 1, y);
      const dy = height(x, y + 1) - height(x, y - 1);
      _normal.set(-dx * 4, -dy * 4, 1).normalize();
      const index = (y * size + x) * 4;
      data[index] = Math.round((_normal.x * 0.5 + 0.5) * 255);
      data[index + 1] = Math.round((_normal.y * 0.5 + 0.5) * 255);
      data[index + 2] = Math.round((_normal.z * 0.5 + 0.5) * 255);
      data[index + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const grain = grainNormalTexture();

/**
 * Rewrites a geometry's UVs as world metres, projected along each face's dominant axis, so one grid
 * tile is one metre on every face of every prop regardless of its size. Call it after the geometry
 * is translated into place (merged geometry included), before it is given to a mesh.
 */
export function worldGridUVs<T extends BufferGeometry>(geometry: T): T {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    _normal.fromBufferAttribute(normal, index);
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const ax = Math.abs(_normal.x);
    const ay = Math.abs(_normal.y);
    const az = Math.abs(_normal.z);
    const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
    uv[index * 2] = u;
    uv[index * 2 + 1] = v;
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return geometry;
}

/**
 * Tarmac: mid grey with a blue cast, `palette.structure` a shade darker than the grid structures so
 * the road separates from the run-off without a line. Anything darker and the car's own shadow
 * disappears into it.
 */
export const roadMaterial = new MeshStandardMaterial({
  color: 0x565b63,
  normalMap: grain,
  normalScale: new Vector2(0.12, 0.12),
  roughness: 0.82,
  metalness: 0.04,
});

export function createMaterials() {
  return {
    /** Boost chevrons and the finish banner. */
    boost: toon(palette.accent, 0.4),
    /** The kerb's painted stripe. Real kerbing is 5-8 cm proud of the tarmac, and `KERB_HEIGHT` in
     * `Track.ts` collides at exactly that, so the wheels ride over it instead of stopping dead. */
    curb: toon(0xf2f0e6, 0.5),
    /** The kerb's red stripe. */
    kerbAlt: toon(0xd8453c, 0.5),
    /** Light grid: the run-off apron the driver can see the speed against. */
    field: new MeshStandardMaterial({
      map: gridTexture(palette.floor, GRID_LINE),
      normalMap: grain,
      normalScale: new Vector2(0.18, 0.18),
      roughness: 0.9,
      metalness: 0,
    }),
    /** Dark grid: grandstands, hoardings, tyre walls, the treeline. */
    structure: new MeshStandardMaterial({
      map: gridTexture(palette.structure, GRID_LINE),
      normalMap: grain,
      normalScale: new Vector2(0.18, 0.18),
      roughness: 0.7,
      metalness: 0,
    }),
    road: roadMaterial,
    shadow: new MeshStandardMaterial({ color: palette.structure, roughness: 1 }),
    tire: new MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.94 }),

    /** The car. `body` is the one a game is most likely to change. */
    body: new MeshStandardMaterial({ color: 0xd93a3a, metalness: 0.18, roughness: 0.3 }),
    /** Kept as an alias so a game that already referred to the old slot still compiles. */
    vehicle: new MeshStandardMaterial({ color: 0xd93a3a, metalness: 0.18, roughness: 0.3 }),
    rivalBody: new MeshStandardMaterial({ color: palette.accent, metalness: 0.18, roughness: 0.3 }),
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

    /** Trackside furniture that is instanced, so it takes a flat value rather than a mapped grid. */
    crowd: toon(palette.structure, 0.9),
    trunk: toon(0x5b4a3c, 0.9),
    canopy: toon(0x466b4a, 0.92),
    /** The hills past the treeline. */
    distant: toon(0x6d7a80, 0.98),
    hoardingBoard: toon(palette.accent, 0.6),
  };
}
