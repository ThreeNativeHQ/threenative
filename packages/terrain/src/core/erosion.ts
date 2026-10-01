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

interface IHydraulicProbe {
  value: number;
  dx: number;
  dz: number;
  i: number;
  tx: number;
  tz: number;
}

/** Hydraulic erosion: seeded droplets carry sediment downhill, depositing where they slow. */
export function hydraulic(
  height: Float32Array,
  n: number,
  size: number,
  {
    droplets = 5000,
    maxSteps = 40,
    inertia = 0.2,
    capacity = 4,
    erosion = 0.25,
    deposition = 0.3,
    evaporation = 0.025,
    seed = 1,
  }: IHydraulicOptions = {},
): Float32Array {
  const h = Float64Array.from(height);
  const rnd = random(seed);
  const cell = size / (n - 1);
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
      i,
      tx,
      tz,
    };
  };
  const deposit = (probe: IHydraulicProbe, amount: number): void => {
    const { i, tx, tz } = probe;
    h[i] = (h[i] as number) + amount * (1 - tx) * (1 - tz);
    h[i + 1] = (h[i + 1] as number) + amount * tx * (1 - tz);
    h[i + n] = (h[i + n] as number) + amount * (1 - tx) * tz;
    h[i + n + 1] = (h[i + n + 1] as number) + amount * tx * tz;
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
        deposit(old, sediment);
        sediment = 0;
        break;
      }
      const next = get(nx, nz);
      const dh = next.value - old.value;
      const cap = Math.max(-dh, 0.005 * cell) * speed * water * capacity;
      if (dh > 0 || sediment > cap) {
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * deposition;
        deposit(old, amount);
        sediment -= amount;
      } else {
        const amount = Math.max(0, Math.min((cap - sediment) * erosion, -dh));
        deposit(old, -amount);
        sediment += amount;
      }
      speed = Math.sqrt(Math.max(0.01, speed * speed - dh * 3));
      water *= 1 - evaporation;
      x = nx;
      z = nz;
      if (water < 0.02) break;
    }
    if (sediment > 0) deposit(get(clamp(x, 0, n - 1.001), clamp(z, 0, n - 1.001)), sediment);
  }
  return Float32Array.from(h);
}
