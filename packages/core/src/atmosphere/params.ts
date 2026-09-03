import { Vector3 } from "three";

export type AtmosphereRgb = readonly [number, number, number];
export type AtmosphereVector =
  | AtmosphereRgb
  | Readonly<{ x: number; y: number; z: number }>
  | Vector3;

/** Physical inputs for the atmosphere model. Coefficients use 1/km and radii use km. */
export interface IAtmosphereParameters {
  readonly rayleigh: AtmosphereVector;
  readonly mie: AtmosphereVector;
  readonly ozone: AtmosphereVector;
  readonly planetRadius: number;
  readonly atmosphereRadius: number;
}

export interface IResolvedAtmosphereParameters {
  readonly rayleigh: Vector3;
  readonly mie: Vector3;
  readonly ozone: Vector3;
  readonly planetRadius: number;
  readonly atmosphereRadius: number;
}

export type IAtmosphereParameterPatch = Partial<IAtmosphereParameters>;

export interface ISolarPositionInput {
  readonly date?: Date | string;
  readonly dayOfYear?: number;
  readonly timeOfDay?: number;
  readonly latitude: number;
  readonly longitude: number;
  /** UTC offset in hours. Use zero when `date` is already UTC. */
  readonly utcOffset?: number;
}

export interface ISolarPosition {
  elevation: number;
  azimuth: number;
}

const RAYLEIGH_SCALE_HEIGHT_KM = 8;
const MIE_SCALE_HEIGHT_KM = 1.2;
const OZONE_START_KM = 10;
const OZONE_PEAK_KM = 25;
const OZONE_END_KM = 40;
const TAU = Math.PI * 2;

function missingParameter(options: unknown, field: keyof IAtmosphereParameters): never {
  if (options === null || typeof options !== "object")
    throw new Error("Atmosphere parameters are required.");
  if (!Object.hasOwn(options, field)) throw new Error(`Atmosphere.${field} is required.`);
  throw new Error(`Atmosphere.${field} must be valid.`);
}

function vectorValue(value: unknown, field: keyof IAtmosphereParameters): Vector3 {
  if (value instanceof Vector3) return value.clone();
  if (Array.isArray(value) && value.length === 3) {
    const [x, y, z] = value;
    if ([x, y, z].every((component) => typeof component === "number")) return new Vector3(x, y, z);
  }
  if (value !== null && typeof value === "object") {
    const vector = value as { x?: unknown; y?: unknown; z?: unknown };
    if ([vector.x, vector.y, vector.z].every((component) => typeof component === "number"))
      return new Vector3(vector.x as number, vector.y as number, vector.z as number);
  }
  throw new Error(`Atmosphere.${field} must be an RGB vector.`);
}

function finiteNonNegativeVector(value: Vector3, field: keyof IAtmosphereParameters): Vector3 {
  if (![value.x, value.y, value.z].every((component) => Number.isFinite(component)))
    throw new Error(`Atmosphere.${field} must contain finite numbers.`);
  if ([value.x, value.y, value.z].some((component) => component < 0))
    throw new Error(`Atmosphere.${field} must contain non-negative numbers.`);
  return value;
}

function finitePositive(value: unknown, field: keyof IAtmosphereParameters): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error(`Atmosphere.${field} must be a finite positive number.`);
  return value;
}

/** Validate and clone game-owned coefficients. There is intentionally no Earth fallback.
 * @situation validate atmosphere coefficients before a game creates its sky
 * @constraint provide all three coefficient vectors and both radii; omitted fields are errors
 * @example const parameters = resolveAtmosphereParameters({ rayleigh, mie, ozone, planetRadius, atmosphereRadius });
 */
export function resolveAtmosphereParameters(
  options: IAtmosphereParameters,
): IResolvedAtmosphereParameters {
  const input: Record<string, unknown> = { ...options };
  for (const field of ["rayleigh", "mie", "ozone", "planetRadius", "atmosphereRadius"] as const) {
    if (!Object.hasOwn(input, field)) missingParameter(options, field);
  }

  const rayleigh = finiteNonNegativeVector(vectorValue(input.rayleigh, "rayleigh"), "rayleigh");
  const mie = finiteNonNegativeVector(vectorValue(input.mie, "mie"), "mie");
  const ozone = finiteNonNegativeVector(vectorValue(input.ozone, "ozone"), "ozone");
  const planetRadius = finitePositive(input.planetRadius, "planetRadius");
  const atmosphereRadius = finitePositive(input.atmosphereRadius, "atmosphereRadius");
  if (atmosphereRadius <= planetRadius)
    throw new Error("Atmosphere.atmosphereRadius must be greater than planetRadius.");

  return { atmosphereRadius, mie, ozone, planetRadius, rayleigh };
}

/** Apply a partial game-owned atmosphere change while preserving validation.
 * @situation change scattering coefficients and rebake an atmosphere
 * @constraint patches cannot introduce omitted, negative, or non-finite physical values
 * @example atmosphere.setAtmosphere({ rayleigh: [0.008, 0.016, 0.04] });
 */
export function updateAtmosphereParameters(
  current: IResolvedAtmosphereParameters,
  patch: IAtmosphereParameterPatch,
): IResolvedAtmosphereParameters {
  return resolveAtmosphereParameters({
    atmosphereRadius:
      patch.atmosphereRadius === undefined ? current.atmosphereRadius : patch.atmosphereRadius,
    mie: patch.mie === undefined ? current.mie : patch.mie,
    ozone: patch.ozone === undefined ? current.ozone : patch.ozone,
    planetRadius: patch.planetRadius === undefined ? current.planetRadius : patch.planetRadius,
    rayleigh: patch.rayleigh === undefined ? current.rayleigh : patch.rayleigh,
  });
}

function exponentialColumn(scaleHeight: number, thickness: number): number {
  return scaleHeight * (1 - Math.exp(-thickness / scaleHeight));
}

function ozoneColumn(thickness: number): number {
  const lower = Math.max(0, Math.min(thickness, OZONE_END_KM) - OZONE_START_KM);
  if (lower <= 0) return 0;
  if (thickness <= OZONE_PEAK_KM) return (lower * lower) / (2 * (OZONE_PEAK_KM - OZONE_START_KM));
  const rising = (OZONE_PEAK_KM - OZONE_START_KM) / 2;
  const fallingWidth = Math.min(thickness, OZONE_END_KM) - OZONE_PEAK_KM;
  return (
    rising + fallingWidth - (fallingWidth * fallingWidth) / (2 * (OZONE_END_KM - OZONE_PEAK_KM))
  );
}

/**
 * Return the direct vertical transmittance of the supplied atmosphere.
 *
 * The coefficient fixture follows the Hillaire/Bruneton Earth model: an exponential Rayleigh
 * column, an exponential aerosol column, and the triangular ozone column. This CPU value is a
 * small validation oracle for the same coefficients that the GPU LUT kernels consume.
 * @situation check a supplied atmosphere's direct vertical transmittance
 * @constraint use the returned value as a validation oracle; the rendered path samples the LUT
 * @example const zenith = zenithTransmittance({ rayleigh, mie, ozone, planetRadius, atmosphereRadius });
 */
export function zenithTransmittance(
  parameters: IAtmosphereParameters | IResolvedAtmosphereParameters,
): AtmosphereRgb {
  const resolved = resolveAtmosphereParameters(parameters);
  const thickness = resolved.atmosphereRadius - resolved.planetRadius;
  const rayleighColumn = exponentialColumn(RAYLEIGH_SCALE_HEIGHT_KM, thickness);
  const mieColumn = exponentialColumn(MIE_SCALE_HEIGHT_KM, thickness);
  const ozoneColumnKm = ozoneColumn(thickness);
  return [
    Math.exp(
      -resolved.rayleigh.x * rayleighColumn -
        resolved.mie.x * mieColumn -
        resolved.ozone.x * ozoneColumnKm,
    ),
    Math.exp(
      -resolved.rayleigh.y * rayleighColumn -
        resolved.mie.y * mieColumn -
        resolved.ozone.y * ozoneColumnKm,
    ),
    Math.exp(
      -resolved.rayleigh.z * rayleighColumn -
        resolved.mie.z * mieColumn -
        resolved.ozone.z * ozoneColumnKm,
    ),
  ];
}

/** Approximate direct transmittance for a ray leaving the ground in a supplied direction.
 * @situation colour a game-owned sun from atmosphere extinction
 * @constraint pass a non-zero direction; coefficients and radii come from the game
 * @example const transmittance = directionalTransmittance(parameters, sunDirection);
 */
export function directionalTransmittance(
  parameters: IAtmosphereParameters | IResolvedAtmosphereParameters,
  direction: Vector3,
): Vector3 {
  const lengthSquared = direction.lengthSq();
  if (!Number.isFinite(lengthSquared) || lengthSquared === 0)
    throw new Error("Atmosphere direction must be finite and non-zero.");
  const normal = direction.clone().normalize();
  const cosine = Math.max(0.05, normal.y);
  const airMass = 1 / cosine;
  const zenith = zenithTransmittance(parameters);
  return new Vector3(zenith[0] ** airMass, zenith[1] ** airMass, zenith[2] ** airMass);
}

function checkedSolarInput(input: ISolarPositionInput): ISolarPositionInput {
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90)
    throw new Error("solarPosition.latitude must be between -90 and 90 degrees.");
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180)
    throw new Error("solarPosition.longitude must be between -180 and 180 degrees.");
  if (
    input.utcOffset !== undefined &&
    (!Number.isFinite(input.utcOffset) || Math.abs(input.utcOffset) > 24)
  )
    throw new Error("solarPosition.utcOffset must be finite and within 24 hours.");
  return input;
}

function calculateSolarPosition(
  input: ISolarPositionInput,
  target?: ISolarPosition,
): ISolarPosition {
  const checked = checkedSolarInput(input);
  let dayOfYear: number;
  let timeOfDay: number;
  let utcOffset: number;
  if (checked.date !== undefined) {
    const date =
      checked.date instanceof Date ? new Date(checked.date.getTime()) : new Date(checked.date);
    if (!Number.isFinite(date.getTime())) throw new Error("solarPosition.date must be valid.");
    const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0);
    dayOfYear = Math.floor((date.getTime() - yearStart) / 86_400_000);
    timeOfDay =
      date.getUTCHours() +
      date.getUTCMinutes() / 60 +
      date.getUTCSeconds() / 3600 +
      date.getUTCMilliseconds() / 3_600_000;
    utcOffset = checked.utcOffset ?? 0;
  } else {
    if (checked.dayOfYear === undefined || checked.timeOfDay === undefined)
      throw new Error("solarPosition requires date or dayOfYear and timeOfDay.");
    if (!Number.isFinite(checked.dayOfYear) || !Number.isFinite(checked.timeOfDay))
      throw new Error("solarPosition dayOfYear and timeOfDay must be finite.");
    dayOfYear = checked.dayOfYear;
    timeOfDay = checked.timeOfDay;
    utcOffset = checked.utcOffset ?? 0;
  }
  const gamma = (TAU / 365) * (dayOfYear - 1 + (timeOfDay - 12) / 24);
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  // The NOAA equation uses the conventional signed timezone directly (Vancouver is -8).
  const trueSolarMinutes = timeOfDay * 60 + equationOfTime + 4 * checked.longitude - 60 * utcOffset;
  const hourAngle = ((((trueSolarMinutes / 4 - 180) % 360) + 540) % 360) - 180;
  const latitude = (checked.latitude * Math.PI) / 180;
  const cosineZenith =
    Math.sin(latitude) * Math.sin(declination) +
    Math.cos(latitude) * Math.cos(declination) * Math.cos((hourAngle * Math.PI) / 180);
  const elevation = 90 - (Math.acos(Math.max(-1, Math.min(1, cosineZenith))) * 180) / Math.PI;
  const azimuth =
    (Math.atan2(
      Math.sin((hourAngle * Math.PI) / 180),
      Math.cos((hourAngle * Math.PI) / 180) * Math.sin(latitude) -
        Math.tan(declination) * Math.cos(latitude),
    ) *
      180) /
      Math.PI +
    180;
  const result = target ?? { azimuth: 0, elevation: 0 };
  result.azimuth = (azimuth + 360) % 360;
  result.elevation = elevation;
  return result;
}

/** Calculate solar elevation and azimuth from time, latitude, and longitude.
 * @situation move a sun across a real day at a game's latitude and longitude
 * @situation run a day and night cycle over the game's sky
 * @constraint dates are interpreted as UTC unless utcOffset is supplied; no fixed sun direction is assumed
 * @constraint pass a mutable { azimuth, elevation } target to reuse the result object in a steady frame loop
 * @example const sun = solarPosition({ date, latitude: 49.28, longitude: -123.12, utcOffset: -8 });
 */
export function solarPosition(input: ISolarPositionInput, target?: ISolarPosition): ISolarPosition;
export function solarPosition(
  date: Date | string,
  latitude: number,
  longitude: number,
  target?: ISolarPosition,
): ISolarPosition;
export function solarPosition(
  inputOrDate: ISolarPositionInput | Date | string,
  latitude?: number | ISolarPosition,
  longitude?: number,
  target?: ISolarPosition,
): ISolarPosition {
  if (inputOrDate instanceof Date || typeof inputOrDate === "string") {
    if (typeof latitude !== "number" || longitude === undefined)
      throw new Error("solarPosition positional form requires date, latitude, and longitude.");
    return calculateSolarPosition({ date: inputOrDate, latitude, longitude }, target);
  }
  return calculateSolarPosition(inputOrDate, typeof latitude === "object" ? latitude : target);
}

/** Convert solar elevation and azimuth degrees into a normalized Three.js direction.
 * @situation aim a template's sun from solarPosition output
 * @constraint elevation and azimuth must be finite degrees
 * @example const direction = directionFromSolarPosition(sun.elevation, sun.azimuth);
 */
export function directionFromSolarPosition(elevation: number, azimuth: number): Vector3 {
  if (![elevation, azimuth].every((value) => Number.isFinite(value)))
    throw new Error("solarPosition elevation and azimuth must be finite.");
  const elevationRadians = (elevation * Math.PI) / 180;
  const azimuthRadians = (azimuth * Math.PI) / 180;
  return new Vector3(
    Math.cos(elevationRadians) * Math.sin(azimuthRadians),
    Math.sin(elevationRadians),
    Math.cos(elevationRadians) * Math.cos(azimuthRadians),
  ).normalize();
}
