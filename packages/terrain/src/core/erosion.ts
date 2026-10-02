import { clamp, lerp, random } from "./math.js";

export interface IThermalOptions {
  iterations?: number;
  /** Maximum stable slope in degrees. */
  talus?: number;
  rate?: number;
}

export interface IHydraulicOptions {
  droplets?: number;
  maxSteps?: number;
  inertia?: number;
  capacity?: number;
  erosion?: number;
  deposition?: number;
  evaporation?: number;
  seed?: number;
  /** Brush radius in cells: every gram moved lands spread over this disc, never on one cell. */
  brushRadius?: number;
}

/** Thermal erosion: material above the talus angle slides to its lowest neighbour. */
export function thermal(
  height: Float32Array,
  n: number,
  size: number,
  { iterations = 20, talus = 32, rate = 0.22 }: IThermalOptions = {},
): Float32Array {
  const h = height.slice();
  const delta = new Float64Array(h.length);
  const limit = Math.tan((talus * Math.PI) / 180) * (size / (n - 1));
  for (let k = 0; k < iterations; k += 1) {
    delta.fill(0);
    for (let z = 0; z < n; z += 1) {
      for (let x = 0; x < n; x += 1) {
        const i = z * n + x;
        let best = -1;
        let diff = limit;
        for (const j of [
          x > 0 ? i - 1 : -1,
          x < n - 1 ? i + 1 : -1,
          z > 0 ? i - n : -1,
          z < n - 1 ? i + n : -1,
        ]) {
          if (j >= 0 && (h[i] as number) - (h[j] as number) > diff) {
            diff = (h[i] as number) - (h[j] as number);
            best = j;
          }
        }
        if (best >= 0) {
          const transfer = (diff - limit) * rate;
          delta[i] = (delta[i] as number) - transfer;
          delta[best] = (delta[best] as number) + transfer;
        }
      }
    }
    for (let i = 0; i < h.length; i += 1) h[i] = (h[i] as number) + (delta[i] as number);
  }
  return h;
}

interface IBrushCell {
  dx: number;
  dz: number;
  weight: number;
}

const brushes = new Map<number, IBrushCell[]>();

/** Erosion brush: normalised weights over a disc, so a droplet digs a dimple and not a single-cell pit. */
function brush(radius: number): IBrushCell[] {
  let cells = brushes.get(radius);
  if (!cells) {
    cells = [];
    let total = 0;
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const d = Math.hypot(dx, dz);
        if (d > radius) continue;
        const weight = 1 - d / (radius + 1);
        cells.push({ dx, dz, weight });
        total += weight;
      }
    }
    for (const c of cells) c.weight /= total;
    brushes.set(radius, cells);
  }
  return cells;
}

interface IHydraulicProbe {
  value: number;
  dx: number;
  dz: number;
  ix: number;
  iz: number;
}

/** Hydraulic erosion: seeded droplets carry sediment downhill, depositing where they slow. */
export function hydraulic(
  height: Float32Array,
  n: number,
  size: number,
  {
    droplets = Math.round(1.5 * n * n),
    // A droplet has to be able to cross the world, so its step budget scales with the grid: a
    // fixed 40 barely leaves a 257 world while a 65 world would walk off it in a few steps.
    maxSteps = Math.round(Math.min(64, Math.max(24, n / 4))),
    inertia = 0.2,
    capacity = 4,
    erosion = 0.25,
    deposition = 0.3,
    evaporation = 0.025,
    seed = 1,
    brushRadius = 3,
  }: IHydraulicOptions = {},
): Float32Array {
  const h = Float64Array.from(height);
  const rnd = random(seed);
  const cell = size / (n - 1);
  const cells = brush(brushRadius);
  /** Adds `amount` over the brush around one cell, renormalised where the field ends. */
  const spread = (x: number, z: number, amount: number): void => {
    let total = 0;
    for (const c of cells) {
      const ix = x + c.dx;
      const iz = z + c.dz;
      if (ix >= 0 && ix < n && iz >= 0 && iz < n) total += c.weight;
    }
    if (total <= 0) return;
    for (const c of cells) {
      const ix = x + c.dx;
      const iz = z + c.dz;
      if (ix < 0 || ix >= n || iz < 0 || iz >= n) continue;
      const i = iz * n + ix;
      h[i] = (h[i] as number) + (amount * c.weight) / total;
    }
  };
  const get = (x: number, z: number): IHydraulicProbe => {
    const ix = Math.min(n - 2, Math.floor(x));
    const iz = Math.min(n - 2, Math.floor(z));
    const tx = x - ix;
    const tz = z - iz;
    const i = iz * n + ix;
    return {
      value: lerp(
        lerp(h[i] as number, h[i + 1] as number, tx),
        lerp(h[i + n] as number, h[i + n + 1] as number, tx),
        tz,
      ),
      dx:
        lerp(
          (h[i + 1] as number) - (h[i] as number),
          (h[i + n + 1] as number) - (h[i + n] as number),
          tz,
        ) / cell,
      dz:
        lerp(
          (h[i + n] as number) - (h[i] as number),
          (h[i + n + 1] as number) - (h[i + 1] as number),
          tx,
        ) / cell,
      ix,
      iz,
    };
  };
  for (let k = 0; k < droplets; k += 1) {
    let x = rnd() * (n - 1 - 0.001);
    let z = rnd() * (n - 1 - 0.001);
    let dx = 0;
    let dz = 0;
    let water = 1;
    let speed = 1;
    let sediment = 0;
    for (let step = 0; step < maxSteps; step += 1) {
      const old = get(x, z);
      dx = dx * inertia - old.dx * (1 - inertia);
      dz = dz * inertia - old.dz * (1 - inertia);
      let length = Math.hypot(dx, dz);
      if (length < 1e-9) {
        const angle = rnd() * Math.PI * 2;
        dx = Math.cos(angle);
        dz = Math.sin(angle);
        length = 1;
      }
      dx /= length;
      dz /= length;
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nx >= n - 1 || nz < 0 || nz >= n - 1) {
        sediment = 0;
        break;
      }
      const next = get(nx, nz);
      const dh = next.value - old.value;
      const cap = Math.max(-dh, 0.005 * cell) * speed * water * capacity;
      if (dh > 0 || sediment > cap) {
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * deposition;
        spread(old.ix, old.iz, amount);
        sediment -= amount;
      } else {
        const amount = Math.max(0, Math.min((cap - sediment) * erosion, -dh));
        spread(old.ix, old.iz, -amount);
        sediment += amount;
      }
      speed = Math.sqrt(Math.max(0.01, speed * speed - dh * 3));
      water *= 1 - evaporation;
      x = nx;
      z = nz;
      if (water < 0.02) break;
    }
    if (sediment > 0) {
      const end = get(clamp(x, 0, n - 1.001), clamp(z, 0, n - 1.001));
      spread(end.ix, end.iz, sediment);
    }
  }
  return Float32Array.from(h);
}
