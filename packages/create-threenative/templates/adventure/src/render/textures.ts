// Generated for you. This is ordinary Three.js — edit or delete it freely.
//
// Every surface in the forest is drawn here, from noise, into a `DataTexture`: no image files, no
// canvas, no DOM. A canvas is a browser object the native host does not have; a byte array is a
// byte array on every target, so the bark on a trunk is the same bark on a phone. Noise wraps at
// its lattice edge, so a tile repeated 40 times across the ground has no seams to find.
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

function hash(x: number, y: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** Value noise over `cells` lattice cells that wraps: `noise(u, v, c)` at u = 0 equals u = 1. */
export function noise(u: number, v: number, cells: number): number {
  const x = u * cells;
  const y = v * cells;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const at = (a: number, b: number): number => hash(((a % cells) + cells) % cells, ((b % cells) + cells) % cells);
  return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
}

/** A small seeded stream for the speckle: same texture every run. */
function stream(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(data: Uint8Array, size: number, repeat: boolean): DataTexture {
  const texture = new DataTexture(data, size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  if (repeat) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
  }
  texture.needsUpdate = true;
  return texture;
}

/** Fills a tiling texture from a per-pixel colour function of (u, v). */
function tile(size: number, pixel: (u: number, v: number, x: number, y: number) => readonly [number, number, number]): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
      data[i + 3] = 255;
    }
  return finish(data, size, true);
}

function fbm(u: number, v: number): number {
  return noise(u, v, 9) * 0.5 + noise(u, v, 27) * 0.28 + noise(u, v, 96) * 0.14 + hash((u * 4096) | 0, (v * 4096) | 0) * 0.08;
}

/** Furrowed bark: vertical grooves that wander, warm brown, a little moss on the shaded side. */
export function barkTexture(size = 512): DataTexture {
  return tile(size, (u, v) => {
    const groove = (0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 16 + noise(u, v, 8) * 13)) ** 5;
    const grain = noise(u, v, 128) * 0.4 + noise(u, v, 34) * 0.6;
    const r = 47 + grain * 52 + groove * 29 + fbm(u, v) * 12;
    const moss = noise(u, v, 14) > 0.63;
    return [moss ? r - 4 : r, (moss ? r * 0.82 + 8 : r * 0.82), r * 0.6];
  });
}

/** Weathered flagstone with veins and green lichen patches. */
export function stoneTexture(size = 512): DataTexture {
  const rand = stream(7);
  const cracks: number[] = [];
  for (let k = 0; k < 28; k += 1) {
    let x = rand();
    let y = rand();
    for (let s = 0; s < 7; s += 1) {
      const nx = x + (rand() - 0.3) * 0.06;
      const ny = y + (0.006 + rand() * 0.05);
      cracks.push(x, y, nx, ny);
      x = nx;
      y = ny;
    }
  }
  const texture = tile(size, (u, v) => {
    const f = fbm(u, v);
    let r = 91 + f * 88;
    let g = 91 + f * 83;
    let b = 80 + f * 71;
    if (noise(u, v, 8) > 0.62) {
      r *= 0.74;
      g *= 0.87;
      b *= 0.57;
    }
    return [r, g, b];
  });
  const data = texture.image.data as Uint8Array;
  for (let c = 0; c < cracks.length; c += 4) {
    const [x0, y0, x1, y1] = [cracks[c] ?? 0, cracks[c + 1] ?? 0, cracks[c + 2] ?? 0, cracks[c + 3] ?? 0];
    const steps = 24;
    for (let s = 0; s <= steps; s += 1) {
      const px = Math.floor((x0 + (x1 - x0) * (s / steps)) * size) % size;
      const py = Math.floor((y0 + (y1 - y0) * (s / steps)) * size) % size;
      const i = (py * size + px) * 4;
      data[i] = (data[i] ?? 0) * 0.6;
      data[i + 1] = (data[i + 1] ?? 0) * 0.6;
      data[i + 2] = (data[i + 2] ?? 0) * 0.62;
    }
  }
  texture.needsUpdate = true;
  return texture;
}

/** Forest floor: warm and cool speckle over soft noise. Vertex colours carry the actual green. */
export function groundTexture(size = 512): DataTexture {
  const rand = stream(11);
  const texture = tile(size, (u, v) => {
    const f = fbm(u, v);
    return [92 + f * 60, 104 + f * 64, 62 + f * 42];
  });
  const data = texture.image.data as Uint8Array;
  for (let k = 0; k < 2600; k += 1) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const light = rand() > 0.5;
    const i = (y * size + x) * 4;
    data[i] = (data[i] ?? 0) * (light ? 1.22 : 0.62);
    data[i + 1] = (data[i + 1] ?? 0) * (light ? 1.2 : 0.7);
    data[i + 2] = (data[i + 2] ?? 0) * (light ? 1.1 : 0.55);
  }
  texture.needsUpdate = true;
  return texture;
}

/** Cutout sprites are RGBA with an opaque body and zero alpha outside it (the material alpha-tests). */
function sprite(size: number): { data: Uint8Array; put: (x: number, y: number, r: number, g: number, b: number) => void } {
  const data = new Uint8Array(size * size * 4);
  // Canvas y grows down; a texture's v grows up. Flip once, here, so the shapes below read as drawn.
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    const px = Math.round(x);
    const py = size - 1 - Math.round(y);
    if (px < 0 || py < 0 || px >= size || py >= size) return;
    const i = (py * size + px) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
  return { data, put };
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

/** Stamps one pointed leaf: a lens from (cx, cy) along `angle`, dark at the rim, pale down the vein. */
function leaf(
  put: (x: number, y: number, r: number, g: number, b: number) => void,
  cx: number,
  cy: number,
  angle: number,
  length: number,
  half: number,
  hue: number,
  lightness = 0.37,
): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const reach = Math.ceil(length + half);
  for (let oy = -reach; oy <= reach; oy += 1)
    for (let ox = -reach; ox <= reach; ox += 1) {
      const u = (ox * dx + oy * dy) / length;
      const v = (-ox * dy + oy * dx) / half;
      if (u < 0 || u > 1) continue;
      const width = Math.sin(Math.PI * u ** 0.8);
      if (Math.abs(v) > width) continue;
      const vein = Math.abs(v) < 0.09 * width;
      const shade = lightness + (1 - Math.abs(v) / width) * 0.14 + (vein ? 0.1 : 0);
      const [r, g, b] = hsl(hue - u * 7, 0.38, Math.min(0.62, shade));
      put(cx + ox, cy + oy, r, g, b);
    }
}

/** A spray of broadleaf twigs on a transparent ground: the canopy's one billboard. */
export function leafTexture(size = 256): DataTexture {
  const rand = stream(23);
  const r = (a: number, b: number): number => a + (b - a) * rand();
  const { data, put } = sprite(size);
  for (let branch = 0; branch < 7; branch += 1) {
    const angle = -Math.PI / 2 + r(-1.15, 1.15);
    const ox = size / 2 + r(-50, 50);
    const oy = r(135, 225);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    for (let s = 0; s < 120; s += 1) put(ox + dx * s, oy + dy * s, 79, 87, 48);
    for (let j = 0; j < 6; j += 1)
      for (const side of [-1, 1]) {
        const at = 10 + j * 17;
        leaf(put, ox + dx * at, oy + dy * at, angle + side * r(0.7, 1.4), r(20, 32), r(8, 13), r(74, 105));
      }
    leaf(put, ox + dx * 104, oy + dy * 104, angle, 26, 9.5, 85);
  }
  return finish(data, size, false);
}

/** A fern frond: a curved rachis with 25 pairs of narrowing pinnae. */
export function fernTexture(size = 256): DataTexture {
  const { data, put } = sprite(size);
  for (let s = 0; s < 250; s += 1) {
    const t = s / 250;
    put(size / 2 + Math.sin(t * Math.PI) * 6, size - 6 - s, 134, 145, 85);
  }
  for (let i = 0; i < 25; i += 1) {
    const y = size - 12 - i * 9;
    const w = 48 * Math.sin(((i + 1) / 27) * Math.PI) * (0.8 + i * 0.007);
    for (const side of [-1, 1])
      leaf(put, size / 2 + Math.sin(((size - y) / size) * Math.PI) * 6, y, side > 0 ? -0.42 : Math.PI + 0.42, w * 1.05, 3.6, 88 + i * 0.65, 0.3 + i * 0.006);
  }
  return finish(data, size, false);
}

/** A soft white disc, for the fairy, lanterns, sigils and drifting motes. */
export function glowTexture(size = 128): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      const a = d >= 1 ? 0 : d < 0.1 ? 1 - d * 2 : d < 0.3 ? 0.8 - (d - 0.1) * 3 : 0.2 * (1 - (d - 0.3) / 0.7) ** 2;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  const texture = finish(data, size, false);
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  return texture;
}

/** A dark soft blob under anything that stands: cheaper than a shadow map for grass-height things. */
export function blobShadowTexture(size = 128): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      const a = d >= 1 ? 0 : d < 0.4 ? 0.6 - d * 0.8 : 0.28 * (1 - (d - 0.4) / 0.6);
      const i = (y * size + x) * 4;
      data[i] = 12;
      data[i + 1] = 22;
      data[i + 2] = 10;
      data[i + 3] = Math.round(a * 255);
    }
  const texture = finish(data, size, false);
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  return texture;
}

/** A speech bubble with three dots: the keeper has something to say. */
export function bubbleTexture(size = 128): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    const i = ((size - 1 - y) * size + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const inDisc = Math.hypot(x - 64, y - 60) < 44;
      // The tail: a triangle under the disc, pointing down-left.
      const inTail = y > 88 && y < 118 && x > 40 + (y - 88) * 0.25 && x < 72 - (y - 88) * 0.9;
      if (inDisc || inTail) put(x, y, 237, 233, 201);
      for (const dot of [44, 64, 84]) if (Math.hypot(x - dot, y - 59) < 4.5) put(x, y, 82, 91, 59);
    }
  const texture = finish(data, size, false);
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  return texture;
}
