// Generated for you. These are this game's shallow-water appearance and cost choices.
export type WaterRgb = readonly [number, number, number];
export interface IClearwaterOptions {
  /** Width and length of the finite, horizontal surface, in metres. */
  readonly size?: number;
  readonly level?: number;
  /** Representative receiver depth for the planar caustic solve, in metres. */
  readonly depth?: number;
  readonly center?: readonly [number, number];
  /** FFT samples per cascade. 32, 64, 128 or 256. */
  readonly resolution?: number;
  readonly segments?: number;
  readonly waveAmplitude?: number;
  readonly windSpeed?: number;
  readonly seed?: number;
  readonly rippleResolution?: number;
  readonly rippleSize?: number;
  readonly ior?: number;
  /** RGB coefficients in inverse metres, not sRGB colours. */
  readonly absorption?: WaterRgb;
  readonly scattering?: WaterRgb;
  /** Direction from the water toward the sun. It must be above the horizon. */
  readonly sunDirection?: WaterRgb;
  /** Linear HDR radiance, not hexadecimal/sRGB colour. */
  readonly sunColor?: WaterRgb;
  readonly distortion?: number;
  readonly reflection?: boolean;
  readonly reflectionScale?: number;
  readonly reflectionLayers?: number;
  readonly reflectionRefreshInterval?: number;
  readonly caustics?: boolean;
  readonly causticsResolution?: number;
  readonly causticsSegments?: number;
  readonly causticsStrength?: number;
}

export interface IResolvedClearwaterOptions
  extends Required<Omit<IClearwaterOptions, "reflectionLayers">> {
  readonly reflectionLayers?: number;
}

export function finiteWaterNumber(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`Clearwater.${name} must be finite.`);
  return value;
}

function range(name: string, value: number, min: number, max: number): number {
  finiteWaterNumber(name, value);
  if (value < min || value > max)
    throw new RangeError(`Clearwater.${name} must be in ${min}..${max}.`);
  return value;
}

function integer(name: string, value: number, min: number, max: number): number {
  range(name, value, min, max);
  if (!Number.isInteger(value)) throw new RangeError(`Clearwater.${name} must be an integer.`);
  return value;
}

function powerOfTwo(name: string, value: number, min: number, max: number): number {
  integer(name, value, min, max);
  if ((value & (value - 1)) !== 0)
    throw new RangeError(`Clearwater.${name} must be a power of two.`);
  return value;
}

function rgb(name: string, value: WaterRgb): WaterRgb {
  if (!Array.isArray(value) || value.length !== 3)
    throw new TypeError(`Clearwater.${name} needs three components.`);
  return [
    range(name, value[0], 0, 100),
    range(name, value[1], 0, 100),
    range(name, value[2], 0, 100),
  ];
}

function booleanOption(
  name: "reflection" | "caustics",
  value: boolean | undefined,
  fallback: boolean,
): boolean {
  if (value !== undefined && typeof value !== "boolean")
    throw new TypeError(`Clearwater.${name} must be a boolean.`);
  return value ?? fallback;
}

function optionalInteger(
  name: string,
  value: number | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value !== undefined) integer(name, value, min, max);
  return value;
}

export function waterSunDirection(value: WaterRgb): WaterRgb {
  if (!Array.isArray(value) || value.length !== 3)
    throw new TypeError("Clearwater.sunDirection needs three components.");
  for (const v of value) finiteWaterNumber("sunDirection", v);
  const length = Math.hypot(...value);
  if (length === 0 || value[1] / length < 0.05)
    throw new RangeError(
      "Clearwater sun must be at least 0.05 above the horizon after normalization.",
    );
  return [value[0] / length, value[1] / length, value[2] / length];
}

function resolveSpatialOptions(
  input: IClearwaterOptions,
  center: readonly [number, number],
) {
  return {
    size: range("size", input.size ?? 16, 0.1, 4096),
    level: finiteWaterNumber("level", input.level ?? 0),
    depth: range("depth", input.depth ?? 2, 0.01, 100),
    center: [
      finiteWaterNumber("center.x", center[0]),
      finiteWaterNumber("center.z", center[1]),
    ] as const,
    resolution: powerOfTwo("resolution", input.resolution ?? 64, 32, 256),
    segments: integer("segments", input.segments ?? 128, 8, 512),
    waveAmplitude: range("waveAmplitude", input.waveAmplitude ?? 0.00012, 0, 0.01),
    windSpeed: range("windSpeed", input.windSpeed ?? 1.8, 0.01, 30),
    seed: integer("seed", input.seed ?? 20260924, 0, 0xffffffff),
    rippleResolution: powerOfTwo("rippleResolution", input.rippleResolution ?? 64, 16, 256),
    rippleSize: range("rippleSize", input.rippleSize ?? 7, 0.1, 512),
  };
}

function resolveOpticalOptions(input: IClearwaterOptions) {
  return {
    ior: range("ior", input.ior ?? 1.3335, 1.0001, 2),
    absorption: rgb("absorption", input.absorption ?? [0.4, 0.074, 0.088]),
    scattering: rgb("scattering", input.scattering ?? [0.028, 0.052, 0.068]),
    sunDirection: waterSunDirection(input.sunDirection ?? [0.45, 0.82, 0.3]),
    sunColor: rgb("sunColor", input.sunColor ?? [6, 5.4, 4.44]),
    distortion: range("distortion", input.distortion ?? 0.018, 0, 0.1),
  };
}

function resolveReflectionOptions(input: IClearwaterOptions) {
  return {
    reflection: booleanOption("reflection", input.reflection, true),
    reflectionScale: range("reflectionScale", input.reflectionScale ?? 0.5, 0.0625, 1),
    reflectionLayers: optionalInteger(
      "reflectionLayers",
      input.reflectionLayers,
      0,
      0xffffffff,
    ),
    reflectionRefreshInterval: integer(
      "reflectionRefreshInterval",
      input.reflectionRefreshInterval ?? 1,
      1,
      60,
    ),
  };
}

function resolveCausticsOptions(input: IClearwaterOptions) {
  return {
    caustics: booleanOption("caustics", input.caustics, true),
    causticsResolution: powerOfTwo(
      "causticsResolution",
      input.causticsResolution ?? 512,
      64,
      1024,
    ),
    causticsSegments: integer("causticsSegments", input.causticsSegments ?? 128, 8, 256),
    causticsStrength: range("causticsStrength", input.causticsStrength ?? 0.65, 0, 1),
  };
}

/** Validate before allocating any GPU resource. Returned arrays never alias caller/default arrays. */
export function resolveClearwaterOptions(
  input: IClearwaterOptions = {},
): IResolvedClearwaterOptions {
  if (input === null || typeof input !== "object")
    throw new TypeError("Clearwater options must be an object.");
  const center = input.center ?? [0, 0];
  if (!Array.isArray(center) || center.length !== 2)
    throw new TypeError("Clearwater.center needs x and z.");
  return {
    ...resolveSpatialOptions(input, center),
    ...resolveOpticalOptions(input),
    ...resolveReflectionOptions(input),
    ...resolveCausticsOptions(input),
  };
}
