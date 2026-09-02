import { Vector3 } from "three";
import { Fn, cos, float, normalize, positionLocal, sin, uniform, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

export type WaveDirection =
  | readonly [number, number]
  | { readonly x: number; readonly z?: number; readonly y?: number };

export interface IWaveFieldWave {
  readonly amplitude?: number;
  readonly direction: WaveDirection;
  readonly wavelength: number;
  readonly speed: number;
  readonly phase?: number;
  readonly steepness?: number;
  /**
   * Mark this wave as detail: the graph fades it out with the `fade` node passed to
   * `heightNode` / `normalNode`, and leaves it at full amplitude everywhere else.
   *
   * A wave shorter than the distance one screen pixel covers cannot be resolved, and what it
   * produces instead is a crawling moire that reads as a repeating pattern. Fading it is the fix.
   * `sample` on the CPU has no camera and therefore no fade, so CPU and GPU height differ by at
   * most the summed amplitude of the detail waves — keep them small, or float things on the
   * non-detail waves alone.
   */
  readonly detail?: boolean;
}

export interface IWaveFieldDomainWarp {
  readonly direction?: WaveDirection;
  readonly waveVector?: WaveDirection;
  readonly displacement?: WaveDirection;
  readonly amplitude?: number;
  readonly wavelength?: number;
  readonly speed: number;
  readonly phase?: number;
}

export interface IWaveFieldOptions {
  readonly waves: readonly IWaveFieldWave[];
  readonly domainWarp?: readonly IWaveFieldDomainWarp[];
}

/** Where, when, and how finely to evaluate the field in a graph. */
export interface IWaveFieldGraphOptions {
  /**
   * The horizontal point to evaluate at, in whatever space the caller wants the answer in.
   * Defaults to this vertex's local x and z.
   */
  readonly point?: Node<"vec2">;
  /** The clock. Defaults to the field's own `time` uniform. */
  readonly time?: Node<"float">;
  /** A 0..1 multiplier on every wave marked `detail`. Omitted, detail waves stay at full size. */
  readonly fade?: Node<"float">;
}

export interface IWaveFieldSample {
  readonly height: number;
  readonly normal: Vector3;
}

/** A `float().toVar()` — an accumulator the graph writes back into. */
type FloatVar = ReturnType<Node<"float">["toVar"]>;

const TWO_PI = Math.PI * 2;
const WAVE_STRIDE = 8;
const WARP_STRIDE = 8;

function finite(name: string, value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`WaveField.${name} must be finite.`);
  return value;
}

function positive(name: string, value: number): number {
  finite(name, value);
  if (value <= 0) throw new Error(`WaveField.${name} must be positive.`);
  return value;
}

function direction(value: WaveDirection, name: string): [number, number] {
  let x: number | undefined;
  let z: number | undefined;
  if ("x" in value) {
    x = value.x;
    z = value.z ?? value.y;
  } else {
    x = value[0];
    z = value[1];
  }
  if (x === undefined || z === undefined) throw new Error(`WaveField.${name} is incomplete.`);
  finite(`${name}.x`, x);
  finite(`${name}.z`, z);
  const length = Math.hypot(x, z);
  if (length <= Number.EPSILON) throw new Error(`WaveField.${name} must not be zero.`);
  return [x, z];
}

function displacement(
  value: WaveDirection | undefined,
  amplitude: number | undefined,
): [number, number] {
  if (value !== undefined) {
    let x: number | undefined;
    let z: number | undefined;
    if ("x" in value) {
      x = value.x;
      z = value.z ?? value.y;
    } else {
      x = value[0];
      z = value[1];
    }
    if (x === undefined || z === undefined)
      throw new Error("WaveField.domainWarp.displacement is incomplete.");
    return [finite("domainWarp.displacement.x", x), finite("domainWarp.displacement.z", z)];
  }
  const amount = amplitude === undefined ? 0 : finite("domainWarp.amplitude", amplitude);
  return [amount, amount];
}

function waveAmplitude(wave: IWaveFieldWave, waveNumber: number): number {
  const amplitude = wave.amplitude === undefined ? 0 : finite("waves.amplitude", wave.amplitude);
  const steepness = wave.steepness === undefined ? 0 : finite("waves.steepness", wave.steepness);
  if (wave.amplitude === undefined && wave.steepness === undefined)
    throw new Error("WaveField waves require amplitude or steepness.");
  // Steepness is dimensionless. Convert it to the same length unit as amplitude so a wave may
  // carry both authored values; steepness-only waves retain the original steepness / waveNumber
  // fallback. The base amplitude remains separately packed so both consumers read the slot.
  return amplitude + steepness / waveNumber;
}

function requireSampleValue(name: string, value: number): number {
  return finite(`sample.${name}`, value);
}

/**
 * An analytic wave field with one packed parameter source for CPU sampling and TSL displacement.
 * It owns no geometry or appearance; a game chooses how the returned displacement is drawn.
 */
export class WaveField {
  readonly waves: readonly IWaveFieldWave[];
  readonly domainWarp: readonly IWaveFieldDomainWarp[];
  readonly parameters: Readonly<Float32Array>;
  readonly time = uniform(0);
  readonly #waveCount: number;
  readonly #warpCount: number;

  constructor(options: IWaveFieldOptions) {
    if (!Array.isArray(options.waves)) throw new Error("WaveField.waves must be an array.");
    const waves = options.waves.map((wave, index) => {
      if (wave === undefined || typeof wave !== "object")
        throw new Error(`WaveField.waves[${index}] must be an object.`);
      const [rawX, rawZ] = direction(wave.direction, `waves[${index}].direction`);
      const length = Math.hypot(rawX, rawZ);
      const directionX = rawX / length;
      const directionZ = rawZ / length;
      const wavelength = positive(`waves[${index}].wavelength`, wave.wavelength);
      const speed = finite(`waves[${index}].speed`, wave.speed);
      const phase = wave.phase === undefined ? 0 : finite(`waves[${index}].phase`, wave.phase);
      const waveNumber = TWO_PI / wavelength;
      const amplitude = waveAmplitude(wave, waveNumber);
      const steepness =
        wave.steepness === undefined ? 0 : finite("waves.steepness", wave.steepness);
      return {
        amplitude,
        detail: wave.detail === true,
        direction: [directionX, directionZ] as const,
        wavelength,
        speed,
        phase,
        steepness,
      };
    });
    const domainWarp = (options.domainWarp ?? []).map((warp, index) => {
      if (warp === undefined || typeof warp !== "object")
        throw new Error(`WaveField.domainWarp[${index}] must be an object.`);
      const speed = finite(`domainWarp[${index}].speed`, warp.speed);
      const phase = warp.phase === undefined ? 0 : finite(`domainWarp[${index}].phase`, warp.phase);
      const displacementValue = displacement(warp.displacement, warp.amplitude);
      let waveVector: readonly [number, number];
      let wavelength: number | undefined;
      if (warp.waveVector !== undefined) {
        const [x, z] = direction(warp.waveVector, `domainWarp[${index}].waveVector`);
        waveVector = [x, z];
      } else {
        if (warp.direction === undefined)
          throw new Error(`WaveField.domainWarp[${index}] requires direction or waveVector.`);
        const [rawX, rawZ] = direction(warp.direction, `domainWarp[${index}].direction`);
        const length = Math.hypot(rawX, rawZ);
        waveVector = [rawX / length, rawZ / length];
        const rawWavelength = warp.wavelength;
        if (rawWavelength === undefined)
          throw new Error(`WaveField.domainWarp[${index}].wavelength is required.`);
        wavelength = positive(`domainWarp[${index}].wavelength`, rawWavelength);
      }
      return {
        direction: waveVector,
        displacement: displacementValue,
        speed,
        phase,
        wavelength,
      };
    });

    const parameters = new Float32Array(
      waves.length * WAVE_STRIDE + domainWarp.length * WARP_STRIDE,
    );
    for (const [index, wave] of waves.entries()) {
      const offset = index * WAVE_STRIDE;
      const waveNumber = TWO_PI / wave.wavelength;
      parameters[offset] = wave.direction[0];
      parameters[offset + 1] = wave.direction[1];
      parameters[offset + 2] = wave.amplitude - wave.steepness / waveNumber;
      parameters[offset + 3] = waveNumber;
      parameters[offset + 4] = wave.speed;
      parameters[offset + 5] = wave.phase;
      parameters[offset + 6] = wave.steepness;
      parameters[offset + 7] = wave.detail ? 1 : 0;
    }
    const warpOffset = waves.length * WAVE_STRIDE;
    for (const [index, warp] of domainWarp.entries()) {
      const offset = warpOffset + index * WARP_STRIDE;
      parameters[offset] =
        warp.direction[0] * (warp.wavelength === undefined ? 1 : TWO_PI / warp.wavelength);
      parameters[offset + 1] =
        warp.direction[1] * (warp.wavelength === undefined ? 1 : TWO_PI / warp.wavelength);
      parameters[offset + 2] = warp.displacement[0];
      parameters[offset + 3] = warp.displacement[1];
      parameters[offset + 4] = warp.speed;
      parameters[offset + 5] = warp.phase;
      parameters[offset + 6] = 0;
      parameters[offset + 7] = 0;
    }

    this.waves = waves;
    this.domainWarp = domainWarp;
    this.parameters = parameters;
    this.#waveCount = waves.length;
    this.#warpCount = domainWarp.length;
  }

  /** Update the default graph clock. Explicit sample times remain available for fixed-step code. */
  setTime(value: number): void {
    this.time.value = requireSampleValue("time", value);
  }

  sample(x: number, z: number, time: number): IWaveFieldSample {
    const sampleX = requireSampleValue("x", x);
    const sampleZ = requireSampleValue("z", z);
    const sampleTime = requireSampleValue("time", time);
    const warpOffset = this.#waveCount * WAVE_STRIDE;
    let warpedX = sampleX;
    let warpedZ = sampleZ;
    let warpedXX = 1;
    let warpedXZ = 0;
    let warpedZX = 0;
    let warpedZZ = 1;
    for (let index = 0; index < this.#warpCount; index += 1) {
      const offset = warpOffset + index * WARP_STRIDE;
      const kx = this.parameters[offset] as number;
      const kz = this.parameters[offset + 1] as number;
      const displacementX = this.parameters[offset + 2] as number;
      const displacementZ = this.parameters[offset + 3] as number;
      const phase =
        kx * warpedX +
        kz * warpedZ -
        sampleTime * (this.parameters[offset + 4] as number) +
        (this.parameters[offset + 5] as number);
      const sine = Math.sin(phase);
      const cosine = Math.cos(phase);
      warpedX += displacementX * sine;
      warpedZ += displacementZ * sine;
      const derivativeX = cosine * kx;
      const derivativeZ = cosine * kz;
      const nextXX =
        warpedXX + displacementX * derivativeX * warpedXX + displacementX * derivativeZ * warpedZX;
      const nextXZ =
        warpedXZ + displacementX * derivativeX * warpedXZ + displacementX * derivativeZ * warpedZZ;
      const nextZX =
        warpedZX + displacementZ * derivativeX * warpedXX + displacementZ * derivativeZ * warpedZX;
      const nextZZ =
        warpedZZ + displacementZ * derivativeX * warpedXZ + displacementZ * derivativeZ * warpedZZ;
      warpedXX = nextXX;
      warpedXZ = nextXZ;
      warpedZX = nextZX;
      warpedZZ = nextZZ;
    }

    let height = 0;
    let gradientX = 0;
    let gradientZ = 0;
    for (let index = 0; index < this.#waveCount; index += 1) {
      const offset = index * WAVE_STRIDE;
      const directionX = this.parameters[offset] as number;
      const directionZ = this.parameters[offset + 1] as number;
      const waveNumber = this.parameters[offset + 3] as number;
      const phase =
        waveNumber * (directionX * warpedX + directionZ * warpedZ) -
        sampleTime * (this.parameters[offset + 4] as number) +
        (this.parameters[offset + 5] as number);
      const amplitude =
        (this.parameters[offset + 2] as number) +
        (this.parameters[offset + 6] as number) / waveNumber;
      const sine = Math.sin(phase);
      const slope = amplitude * waveNumber * Math.cos(phase);
      height += amplitude * sine;
      gradientX += slope * directionX;
      gradientZ += slope * directionZ;
    }
    const worldGradientX = gradientX * warpedXX + gradientZ * warpedZX;
    const worldGradientZ = gradientX * warpedXZ + gradientZ * warpedZZ;
    const normal = new Vector3(
      worldGradientX === 0 ? 0 : -worldGradientX,
      1,
      worldGradientZ === 0 ? 0 : -worldGradientZ,
    ).normalize();
    return { height, normal };
  }

  /**
   * Walk the domain warp in a graph, moving `x` and `z` in place.
   *
   * Returns the warp's jacobian when a gradient is wanted, so the caller can rotate the wave
   * gradient back out of warped space; an identity matrix costs four registers a fragment and is
   * not allocated when nobody needs it.
   */
  #warpGraph(x: FloatVar, z: FloatVar, timeNode: Node<"float">, wantJacobian: boolean) {
    const parameters = this.parameters;
    const warpOffset = this.#waveCount * WAVE_STRIDE;
    const jacobian = wantJacobian
      ? { xx: float(1).toVar(), xz: float(0).toVar(), zx: float(0).toVar(), zz: float(1).toVar() }
      : undefined;
    for (let index = 0; index < this.#warpCount; index += 1) {
      const offset = warpOffset + index * WARP_STRIDE;
      const waveVectorX = float(parameters[offset] as number);
      const waveVectorZ = float(parameters[offset + 1] as number);
      const displacementX = float(parameters[offset + 2] as number);
      const displacementZ = float(parameters[offset + 3] as number);
      const phase = x
        .mul(waveVectorX)
        .add(z.mul(waveVectorZ))
        .sub(timeNode.mul(float(parameters[offset + 4] as number)))
        .add(float(parameters[offset + 5] as number));
      const sine = sin(phase).toVar();
      x.addAssign(sine.mul(displacementX));
      z.addAssign(sine.mul(displacementZ));
      if (jacobian === undefined) continue;
      const cosine = cos(phase).toVar();
      const derivativeX = cosine.mul(waveVectorX);
      const derivativeZ = cosine.mul(waveVectorZ);
      // Materialised before any assignment: each row reads the previous jacobian, and assigning
      // in place first would feed the next row a value from this iteration.
      const nextXX = jacobian.xx
        .add(displacementX.mul(derivativeX).mul(jacobian.xx))
        .add(displacementX.mul(derivativeZ).mul(jacobian.zx))
        .toVar();
      const nextXZ = jacobian.xz
        .add(displacementX.mul(derivativeX).mul(jacobian.xz))
        .add(displacementX.mul(derivativeZ).mul(jacobian.zz))
        .toVar();
      const nextZX = jacobian.zx
        .add(displacementZ.mul(derivativeX).mul(jacobian.xx))
        .add(displacementZ.mul(derivativeZ).mul(jacobian.zx))
        .toVar();
      const nextZZ = jacobian.zz
        .add(displacementZ.mul(derivativeX).mul(jacobian.xz))
        .add(displacementZ.mul(derivativeZ).mul(jacobian.zz))
        .toVar();
      jacobian.xx.assign(nextXX);
      jacobian.xz.assign(nextXZ);
      jacobian.zx.assign(nextZX);
      jacobian.zz.assign(nextZZ);
    }
    return jacobian;
  }

  /** Sum the waves at an already-warped point. The gradient is optional and costs a cosine. */
  #sumGraph(
    x: FloatVar,
    z: FloatVar,
    timeNode: Node<"float">,
    fade: Node<"float"> | undefined,
    wantGradient: boolean,
  ) {
    const parameters = this.parameters;
    const height = float(0).toVar();
    // A height-only caller never pays for the derivative: no cosine, no slope var.
    const gradientX = wantGradient ? float(0).toVar() : undefined;
    const gradientZ = wantGradient ? float(0).toVar() : undefined;
    for (let index = 0; index < this.#waveCount; index += 1) {
      const offset = index * WAVE_STRIDE;
      const directionX = parameters[offset] as number;
      const directionZ = parameters[offset + 1] as number;
      const waveNumber = parameters[offset + 3] as number;
      const phase = x
        .mul(float(directionX * waveNumber))
        .add(z.mul(float(directionZ * waveNumber)))
        .sub(timeNode.mul(float(parameters[offset + 4] as number)))
        .add(float(parameters[offset + 5] as number));
      const scalar =
        (parameters[offset + 2] as number) + (parameters[offset + 6] as number) / waveNumber;
      // `detail` is a build-time constant, so the fade costs one multiply on the waves that
      // asked for it and nothing at all on the rest.
      const amplitude =
        fade !== undefined && parameters[offset + 7] === 1
          ? fade.mul(float(scalar))
          : float(scalar);
      height.addAssign(sin(phase).mul(amplitude));
      if (gradientX === undefined || gradientZ === undefined) continue;
      const slope = cos(phase).mul(amplitude).mul(float(waveNumber)).toVar();
      gradientX.addAssign(slope.mul(float(directionX)));
      gradientZ.addAssign(slope.mul(float(directionZ)));
    }
    return { gradientX, gradientZ, height };
  }

  /**
   * Evaluate the field in a graph: the same packed values `sample` reads, as TSL.
   *
   * Returns the height and the two horizontal gradient components, all in the space `point` is
   * given in, so a caller that passes world XZ gets a world-space answer.
   */
  #evaluate(options: IWaveFieldGraphOptions, wantGradient: boolean) {
    const timeNode = options.time ?? this.time;
    const point = options.point ?? vec2(positionLocal.x, positionLocal.z);
    const x = point.x.toVar();
    const z = point.y.toVar();
    const jacobian = this.#warpGraph(x, z, timeNode, wantGradient && this.#warpCount > 0);
    const { gradientX, gradientZ, height } = this.#sumGraph(
      x,
      z,
      timeNode,
      options.fade,
      wantGradient,
    );
    if (jacobian === undefined || gradientX === undefined || gradientZ === undefined)
      return { gradientX, gradientZ, height };
    // The waves were summed in warped space; rotate their gradient back out through the warp's
    // jacobian, or the normal leans the wrong way exactly where the warp bends the field most.
    return {
      gradientX: gradientX.mul(jacobian.xx).add(gradientZ.mul(jacobian.zx)),
      gradientZ: gradientX.mul(jacobian.xz).add(gradientZ.mul(jacobian.zz)),
      height,
    };
  }

  /** Surface height at a point, as a graph. The scalar half of what `sample` returns. */
  heightNode(options: IWaveFieldGraphOptions = {}): Node<"float"> {
    return Fn(() => this.#evaluate(options, false).height)() as unknown as Node<"float">; // quality-allow: TSL result shape is set by construction; three 0.185 types swizzles and Fn loosely
  }

  /**
   * The analytic surface normal at a point, as a graph — the same value `sample` returns, and the
   * reason a water material needs no hand-written ripple pattern.
   *
   * Differencing the height, or stamping a normal map over the surface, is what puts visible
   * repeats in water: both quantise a field that has none. This differentiates the wave sum
   * itself, so the normal repeats only where the waves do, which for wavelengths with no common
   * multiple is nowhere.
   *
   * Evaluate it per fragment — pass `point` in world XZ — and the ripples survive at any distance
   * from the camera, at the cost of the wave sum running per pixel rather than per vertex.
   */
  normalNode(options: IWaveFieldGraphOptions = {}): Node<"vec3"> {
    return Fn(() => {
      const { gradientX, gradientZ } = this.#evaluate(options, true);
      if (gradientX === undefined || gradientZ === undefined)
        throw new Error("WaveField.normalNode lost its gradient.");
      return normalize(vec3(gradientX.negate(), 1, gradientZ.negate()));
    })() as unknown as Node<"vec3">; // quality-allow: TSL result shape is set by construction; three 0.185 types swizzles and Fn loosely
  }

  /** Return a TSL node that displaces local vertices using the same packed values as `sample`. */
  displacementNode(timeNode = this.time) {
    return Fn(() =>
      positionLocal.add(vec3(0, this.#evaluate({ time: timeNode }, false).height, 0)),
    )();
  }
}
