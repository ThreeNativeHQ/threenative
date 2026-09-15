/**
 * A disturbance that propagates. `WaveField` in this same package evaluates a fixed analytic
 * swell: it is the sea a game always has, and nothing a game does changes it. This is the other
 * half — a square patch of surface that is flat until something hits it, carries the rings
 * outward at a real celerity, and forgets them again.
 *
 * The solve is the 2-D wave equation on a regular grid, plus an advected foam density. It owns no
 * Three.js object, no material and no colour: it reports height, foam and horizontal flow, and the
 * game decides what those look like. Add its height to an analytic swell; do not replace one.
 *
 * There is deliberately no obstacle or hull mask. A mask is only correct for a body that does not
 * move, and a game whose hulls move is better served drawing the displacement those hulls make
 * than re-rasterising a mask every time one of them advances a metre.
 */

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

const finite = (value: number, label: string): number => {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
};

export interface IRippleFieldFlow {
  x: number;
  z: number;
}

export interface IRippleFieldOptions {
  /** Cells per side. Cost is quadratic in this; 128 over a 400 m patch is ~3 m per cell. */
  readonly resolution: number;
  /** Width of the patch in metres. */
  readonly size: number;
  /** Wave celerity in metres per second. Sets both ring speed and the stable step. */
  readonly speed?: number;
  /** Bulk damping. Higher forgets a disturbance sooner. */
  readonly damping?: number;
  /** Seconds for undisturbed foam to halve. */
  readonly foamHalfLife?: number;
  /** Steady surface drift in metres per second, added to the solved flow. */
  readonly current?: IRippleFieldFlow;
  /**
   * Integration step in seconds. Defaults to 1/60 s, or the CFL limit for this cell size and
   * celerity where that is smaller.
   */
  readonly step?: number;
  /** Substeps one `advance` will run before it drops the rest of the frame's time. */
  readonly maxSteps?: number;
}

export class RippleField {
  readonly resolution: number;
  readonly size: number;
  readonly dx: number;
  readonly speed: number;
  readonly damping: number;
  readonly step: number;
  readonly maxSteps: number;
  foamHalfLife: number;
  current: IRippleFieldFlow;

  /** Surface height per cell, row-major from the patch's -x/-z corner. Read-only to the game. */
  height: Float32Array;
  /** Foam density per cell in 0..1. */
  foam: Float32Array;
  /** Horizontal flow per cell, metres per second, excluding `current`. */
  readonly flowX: Float32Array;
  readonly flowZ: Float32Array;

  /** Patch centre in world metres, always snapped to a whole cell. */
  centerX = 0;
  centerZ = 0;
  /** Simulated seconds elapsed. */
  time = 0;
  /** Bumped whenever a cell changes, so a texture upload can skip an unchanged frame. */
  version = 0;

  #velocity: Float32Array;
  #scratch: Float32Array;
  #foamScratch: Float32Array;
  #loss: Float32Array;
  #remainder = 0;
  #foamClock = 0;
  /**
   * Exactly, provably flat: every cell of every array is zero. Not "small", not "quiet", not "no
   * recent events" — an epsilon or an energy threshold would delete a real wave that had simply got
   * far from the camera, and an event clock would delete a foam trail that is still drifting. This
   * is only ever true because the field was constructed, reset, or cleared whole; the first
   * accepted impulse or foam deposit ends it immediately.
   */
  #empty = true;

  constructor(options: IRippleFieldOptions) {
    const { resolution, size } = options;
    if (!Number.isInteger(resolution) || resolution < 16 || resolution > 1024)
      throw new RangeError("resolution must be an integer in 16..1024");
    if (!Number.isFinite(size) || size <= 0) throw new RangeError("size must be a positive length");
    this.resolution = resolution;
    this.size = size;
    this.dx = size / (resolution - 1);
    this.speed = finite(options.speed ?? 22, "speed");
    this.damping = finite(options.damping ?? 0.27, "damping");
    if (this.speed <= 0 || this.damping < 0)
      throw new RangeError("speed must be positive and damping non-negative");
    this.foamHalfLife = finite(options.foamHalfLife ?? 7, "foamHalfLife");
    this.current = { x: options.current?.x ?? 0, z: options.current?.z ?? 0 };
    // The 2-D CFL limit is c·dt/dx <= 1/sqrt(2); above it the solve explodes. On a coarse patch
    // that limit is a long way above 1/60 s, and taking it makes the field correct and visibly
    // steppy — a ring that expands five times a second under a screen refreshing sixty. The
    // default is therefore the smaller of a display-rate step and what stability allows.
    const limit = this.dx / (this.speed * Math.SQRT2);
    this.step = options.step ?? Math.min(limit * 0.9, 1 / 60);
    if (!(this.step > 0) || this.step > limit)
      throw new RangeError(`step must be positive and at most the CFL limit ${limit.toFixed(5)}s`);
    this.maxSteps = options.maxSteps ?? 8;
    if (!Number.isInteger(this.maxSteps) || this.maxSteps < 1)
      throw new RangeError("maxSteps must be a positive integer");

    const count = resolution * resolution;
    this.height = new Float32Array(count);
    this.foam = new Float32Array(count);
    this.flowX = new Float32Array(count);
    this.flowZ = new Float32Array(count);
    this.#velocity = new Float32Array(count);
    this.#scratch = new Float32Array(count);
    this.#foamScratch = new Float32Array(count);
    // A sponge band at the rim absorbs what reaches it, so a ring leaves the patch instead of
    // bouncing off a wall the player cannot see.
    this.#loss = new Float32Array(count);
    for (let j = 0; j < resolution; j++)
      for (let i = 0; i < resolution; i++) {
        const edge = Math.min(i, j, resolution - 1 - i, resolution - 1 - j);
        const sponge = 1 - clamp(edge / 12, 0, 1);
        this.#loss[j * resolution + i] = this.damping + 6 * sponge * sponge;
      }
  }

  /** True while the point is inside the patch, `margin` metres in from its rim. */
  contains(x: number, z: number, margin = 0): boolean {
    const half = this.size / 2 - margin;
    return Math.abs(x - this.centerX) < half && Math.abs(z - this.centerZ) < half;
  }

  /**
   * Move the patch so it covers the action. The grid shifts by whole cells and the newly exposed
   * band arrives flat, which is what the sponge rim had already damped it to.
   */
  recenter(x: number, z: number): void {
    finite(x, "x");
    finite(z, "z");
    const di = Math.round((x - this.centerX) / this.dx);
    const dj = Math.round((z - this.centerZ) / this.dx);
    if (di === 0 && dj === 0) return;
    this.centerX += di * this.dx;
    this.centerZ += dj * this.dx;
    // Shifting zeros produces zeros. An empty patch moving with the camera therefore touches no
    // array and its texture data does not change; the centre uniform is what tells a material the
    // patch moved, and that is updated by the game either way.
    if (this.#empty) return;
    if (Math.abs(di) >= this.resolution || Math.abs(dj) >= this.resolution) {
      this.height.fill(0);
      this.#velocity.fill(0);
      this.foam.fill(0);
      this.flowX.fill(0);
      this.flowZ.fill(0);
      // Cleared whole, from a patch that was not flat: exactly empty again, and the version must
      // still move once so the previous image is cleared off the GPU.
      this.#empty = true;
    } else {
      for (const data of [this.height, this.#velocity, this.foam, this.flowX, this.flowZ])
        this.#shift(data, di, dj);
    }
    this.version++;
  }

  #shift(data: Float32Array, di: number, dj: number): void {
    const n = this.resolution;
    const scratch = this.#scratch;
    scratch.fill(0);
    const i0 = Math.max(0, -di);
    const i1 = Math.min(n, n - di);
    const j0 = Math.max(0, -dj);
    const j1 = Math.min(n, n - dj);
    for (let j = j0; j < j1; j++) {
      const source = (j + dj) * n + i0 + di;
      scratch.set(data.subarray(source, source + (i1 - i0)), j * n + i0);
    }
    data.set(scratch);
  }

  /**
   * Push the surface at a point: a Gaussian of the given radius, with the kernel corrected so the
   * disturbance injects no net volume. Without that correction every splash slowly raises the sea.
   * Returns false when the point is outside the patch.
   */
  impulse(x: number, z: number, radius: number, amplitude: number, foam = 0): boolean {
    finite(x, "x");
    finite(z, "z");
    finite(amplitude, "amplitude");
    finite(foam, "foam");
    if (!(radius > 0)) throw new RangeError("radius must be positive");
    if (!this.contains(x, z)) return false;
    // A push of nothing, carrying no foam, is in bounds and accepted — and changes no cell. It must
    // not announce a new texture image, and it must not end an exactly empty patch: a game that
    // scales its impulse by a frame delta hands this exact call in on every paused frame.
    if (amplitude === 0 && foam === 0) return true;
    const n = this.resolution;
    const ix = ((x - this.centerX) / this.size + 0.5) * (n - 1);
    const iz = ((z - this.centerZ) / this.size + 0.5) * (n - 1);
    const r = Math.max(0.75, radius / this.dx);
    const loX = Math.max(1, Math.floor(ix - 3 * r));
    const hiX = Math.min(n - 2, Math.ceil(ix + 3 * r));
    const loZ = Math.max(1, Math.floor(iz - 3 * r));
    const hiZ = Math.min(n - 2, Math.ceil(iz + 3 * r));
    let kernelSum = 0;
    let weightSum = 0;
    for (let j = loZ; j <= hiZ; j++)
      for (let i = loX; i <= hiX; i++) {
        const q = ((i - ix) ** 2 + (j - iz) ** 2) / (r * r);
        const g = Math.exp(-q);
        kernelSum += (1 - q) * g;
        weightSum += g;
      }
    const correction = weightSum > 0 ? kernelSum / weightSum : 0;
    for (let j = loZ; j <= hiZ; j++)
      for (let i = loX; i <= hiX; i++) {
        const k = j * n + i;
        const q = ((i - ix) ** 2 + (j - iz) ** 2) / (r * r);
        const g = Math.exp(-q);
        this.#velocity[k] = (this.#velocity[k] as number) + amplitude * (1 - q - correction) * g;
        if (foam !== 0) this.foam[k] = clamp((this.foam[k] as number) + g * foam, 0, 1);
      }
    this.#empty = false;
    this.version++;
    return true;
  }

  /** Lay down entrained air without claiming a pressure impulse happened. */
  depositFoam(x: number, z: number, radius: number, amount: number): boolean {
    finite(x, "x");
    finite(z, "z");
    if (!(radius > 0) || !(amount >= 0))
      throw new RangeError("radius must be positive and amount non-negative");
    if (!this.contains(x, z)) return false;
    // Laying down no foam is the same non-event: accepted, in bounds, and not a change.
    if (amount === 0) return true;
    const n = this.resolution;
    const ix = ((x - this.centerX) / this.size + 0.5) * (n - 1);
    const iz = ((z - this.centerZ) / this.size + 0.5) * (n - 1);
    const r = Math.max(0.65, radius / this.dx);
    for (
      let j = Math.max(1, Math.floor(iz - 2 * r));
      j <= Math.min(n - 2, Math.ceil(iz + 2 * r));
      j++
    )
      for (
        let i = Math.max(1, Math.floor(ix - 2 * r));
        i <= Math.min(n - 2, Math.ceil(ix + 2 * r));
        i++
      ) {
        const k = j * n + i;
        const g = Math.exp(-(((i - ix) ** 2 + (j - iz) ** 2) / (r * r)));
        this.foam[k] = clamp((this.foam[k] as number) + g * amount, 0, 1);
      }
    this.#empty = false;
    this.version++;
    return true;
  }

  /** Run whole fixed steps to consume `dt`, and report how many ran. */
  advance(dt: number): number {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("dt must be finite and non-negative");
    this.#remainder += Math.min(dt, this.step * this.maxSteps);
    let steps = 0;
    while (this.#remainder + 1e-10 >= this.step && steps < this.maxSteps) {
      this.#remainder -= this.step;
      this.time += this.step;
      this.#integrate(this.step);
      steps++;
    }
    this.#remainder = Math.max(0, this.#remainder);
    // Time passing over a flat patch changes no cell, so it is not a new texture image.
    if (steps > 0 && !this.#empty) this.version++;
    return steps;
  }

  #integrate(dt: number): void {
    if (this.#empty) {
      // The wave equation on a patch of zeros returns zeros: the laplacian is zero, the velocity
      // stays zero, no crest can break, and semi-Lagrangian transport of no foam moves no foam.
      // The step still happened — `time` and the foam cadence advance above and here — so the
      // first impulse after a long calm lands on exactly the phase it would have landed on.
      this.#foamClock += dt;
      if (this.#foamClock >= 1 / 30 - 1e-8) this.#foamClock = 0;
      return;
    }
    const n = this.resolution;
    const h = this.height;
    const v = this.#velocity;
    const next = this.#scratch;
    const { foam, flowX, flowZ, dx } = this;
    const loss = this.#loss;
    const c = (this.speed * this.speed) / (dx * dx);
    for (let j = 1; j < n - 1; j++)
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        const a = h[k - 1] as number;
        const b = h[k + 1] as number;
        const d = h[k - n] as number;
        const e = h[k + n] as number;
        const lap = a + b + d + e - 4 * (h[k] as number);
        v[k] = ((v[k] as number) + c * lap * dt) / (1 + (loss[k] as number) * dt);
        next[k] = (h[k] as number) + (v[k] as number) * dt;
        // Horizontal flow is the surface gradient relaxing under gravity — enough to drift foam
        // down the face of a wave, and far short of a three-dimensional solve.
        const gx = (b - a) / (2 * dx);
        const gz = (e - d) / (2 * dx);
        flowX[k] = clamp(((flowX[k] as number) - 9.81 * gx * dt) / (1 + 0.65 * dt), -9, 9);
        flowZ[k] = clamp(((flowZ[k] as number) - 9.81 * gz * dt) / (1 + 0.65 * dt), -9, 9);
        // A crest that is both steep and collapsing is a crest that is breaking, and a breaking
        // crest is white. Calm swell never satisfies both and so never invents foam.
        const breaking =
          lap < 0
            ? Math.max(0, Math.hypot(gx, gz) - 0.3) * Math.min(3, Math.abs(v[k] as number))
            : 0;
        if (breaking > 0) foam[k] = clamp((foam[k] as number) + breaking * dt * 0.55, 0, 1);
      }
    this.height = next;
    this.#scratch = h;
    this.#foamClock += dt;
    if (this.#foamClock >= 1 / 30 - 1e-8) {
      this.#transportFoam(this.#foamClock);
      this.#foamClock = 0;
    }
  }

  /** Semi-Lagrangian transport at 30 Hz. Foam drifts and spreads; it does not sit where it fell. */
  #transportFoam(dt: number): void {
    const n = this.resolution;
    const { foam, flowX, flowZ, dx, current } = this;
    const next = this.#foamScratch;
    const decay = Math.exp((-Math.LN2 * dt) / this.foamHalfLife);
    next.fill(0);
    for (let j = 1; j < n - 1; j++)
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        const x = clamp(i - ((current.x + (flowX[k] as number)) * dt) / dx, 0, n - 1.001);
        const z = clamp(j - ((current.z + (flowZ[k] as number)) * dt) / dx, 0, n - 1.001);
        const a = Math.floor(x);
        const b = Math.floor(z);
        const q = b * n + a;
        const u = x - a;
        const w = z - b;
        const back =
          ((foam[q] as number) * (1 - u) + (foam[q + 1] as number) * u) * (1 - w) +
          ((foam[q + n] as number) * (1 - u) + (foam[q + n + 1] as number) * u) * w;
        const lap =
          (foam[k - 1] as number) +
          (foam[k + 1] as number) +
          (foam[k - n] as number) +
          (foam[k + n] as number) -
          4 * (foam[k] as number);
        next[k] = clamp((back + lap * 0.06 * dt) * decay, 0, 1);
      }
    this.foam = next;
    this.#foamScratch = foam;
  }

  #sample(x: number, z: number, data: Float32Array): number {
    const n = this.resolution;
    const fx = ((x - this.centerX) / this.size + 0.5) * (n - 1);
    const fz = ((z - this.centerZ) / this.size + 0.5) * (n - 1);
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return 0;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const a = fx - ix;
    const b = fz - iz;
    const k = iz * n + ix;
    return (
      ((data[k] as number) * (1 - a) + (data[k + 1] as number) * a) * (1 - b) +
      ((data[k + n] as number) * (1 - a) + (data[k + n + 1] as number) * a) * b
    );
  }

  /** Disturbance height in metres at a world point, zero outside the patch. */
  heightAt(x: number, z: number): number {
    return this.#sample(x, z, this.height);
  }

  /** Foam density in 0..1 at a world point. */
  foamAt(x: number, z: number): number {
    return this.#sample(x, z, this.foam);
  }

  /** Surface flow in metres per second at a world point, including `current`. */
  flowAt(x: number, z: number, out: IRippleFieldFlow = { x: 0, z: 0 }): IRippleFieldFlow {
    out.x = this.current.x + this.#sample(x, z, this.flowX);
    out.z = this.current.z + this.#sample(x, z, this.flowZ);
    return out;
  }

  /** Total disturbance energy. Zero on an undisturbed patch; useful as a test oracle. */
  energy(): number {
    let total = 0;
    for (let i = 0; i < this.height.length; i++)
      total +=
        (this.height[i] as number) ** 2 +
        (this.#velocity[i] as number) ** 2 / (this.speed * this.speed);
    return total;
  }

  /** Flatten the patch and forget every disturbance. Position, options and time survive. */
  reset(): void {
    this.height.fill(0);
    this.foam.fill(0);
    this.flowX.fill(0);
    this.flowZ.fill(0);
    this.#velocity.fill(0);
    this.#scratch.fill(0);
    this.#foamScratch.fill(0);
    this.#remainder = 0;
    this.#foamClock = 0;
    this.#empty = true;
    this.version++;
  }
}
