/**
 * Force-integrated fixed-wing flight dynamics for a game-owned aircraft.
 *
 * The model integrates lift, drag, thrust and aerodynamic moments in SI units, `+Y` up, with the
 * nose down local `-Z`. Attitude is a quaternion, so there are no Euler clamps and no commanded
 * velocity vectors: the game writes controls, the model writes forces, and the aircraft keeps its
 * own momentum. Every number that decides how the aircraft looks or performs — mass, wing area,
 * engine power, inertia, control authority, wind, damage multipliers and payload — arrives from
 * the game. This module owns only the mechanism that turns those inputs into motion.
 */

export interface IFlightVector3 {
  x: number;
  y: number;
  z: number;
}

export interface IFlightQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface IFlightAxes {
  readonly r: IFlightVector3;
  readonly u: IFlightVector3;
  readonly f: IFlightVector3;
}

/** Per-aircraft constants. The game supplies these; the model ships no airframe of its own. */
export interface IAircraftAirframe {
  /** Empty mass, kg. */
  readonly dryMass: number;
  /** Mass of a full fuel load, kg. */
  readonly fuelMass: number;
  /** Reference wing area, m². */
  readonly wingArea: number;
  /** Wingspan, m. */
  readonly span: number;
  /** Mean aerodynamic chord, m. */
  readonly chord: number;
  /** Shaft power at full throttle, W. */
  readonly power: number;
  /** Propeller efficiency, 0–1. */
  readonly propEfficiency: number;
  /** Maximum static thrust, N. */
  readonly staticThrust: number;
  /** Pitch moment of inertia, kg·m². */
  readonly pitchInertia: number;
  /** Roll moment of inertia, kg·m². */
  readonly rollInertia: number;
  /** Yaw moment of inertia, kg·m². */
  readonly yawInertia: number;
}

/** Multipliers a game applies for damage, load or upgrades. 1 / 0 is the undamaged case. */
export interface IFlightModifiers {
  readonly power: number;
  readonly lift: number;
  readonly drag: number;
  readonly roll: number;
  readonly controls: number;
}

export const NEUTRAL_FLIGHT_MODIFIERS: IFlightModifiers = Object.freeze({
  controls: 1,
  drag: 0,
  lift: 1,
  power: 1,
  roll: 0,
});

/** One fixed step of pilot input. Every field is a dimensionless command in `[-1, 1]`. */
export interface IFlightControls {
  readonly turn?: number;
  readonly pitch?: number;
  readonly rudder?: number;
  readonly wheelBrake?: boolean;
  /** When true, stability assist is bypassed and the game commands the attitude directly. */
  readonly autopilot?: boolean;
}

/** The moving deck an aircraft launches from. */
export interface IFlightDeck {
  readonly x: number;
  readonly y?: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly length: number;
  readonly width: number;
}

export interface IFlightState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  attitude?: IFlightQuaternion;
  heading: number;
  pitch: number;
  roll: number;
  rollRate: number;
  pitchRate: number;
  yawRate: number;
  speed: number;
  ias: number;
  groundSpeed: number;
  throttle: number;
  rpm: number;
  fuel: number;
  hp: number;
  engineCut: boolean;
  gear: boolean;
  brakes: boolean;
  gearPos: number;
  brakePos: number;
  flapPos: number;
  flaps: number;
  aileron: number;
  elevator: number;
  rudder: number;
  controlAileron: number;
  assist: boolean;
  trim: number;
  gforce: number;
  aoa: number;
  beta: number;
  stall: number;
  /** Mass of everything under the wings, kg. The game writes it as stores are released. */
  payloadMass: number;
  /** Extra flat-plate drag coefficient from external stores. */
  payloadDrag: number;
  flightTime: number;
  lift: number;
  drag: number;
  thrust: number;
  mass: number;
  deckSpeed?: number;
  deckLateral?: number;
  deckOffset?: number;
  chocks?: boolean;
}

export interface IFlightEnvironment {
  readonly airframe: IAircraftAirframe;
  readonly wind?: IFlightVector3;
  readonly modifiers?: IFlightModifiers;
  readonly gravity?: number;
  /** Height of the carrier deck surface above the water, m. */
  readonly deckHeight?: number;
}

export interface IFlightForces {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly normalLoad: number;
  readonly lift: number;
  readonly drag: number;
  readonly thrust: number;
  readonly alpha: number;
  readonly beta: number;
  readonly airspeed: number;
  readonly density: number;
  readonly mass: number;
  readonly qs: number;
  readonly axes: IFlightAxes;
  readonly cl: number;
  readonly cd: number;
  readonly stall: number;
  readonly critical: number;
}

const TAU = Math.PI * 2;
const SEA_WIND: IFlightVector3 = Object.freeze({ x: 0, y: 0, z: 0 });
const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const wrap = (angle: number): number => ((angle % TAU) + TAU) % TAU;
const dot = (a: IFlightVector3, b: IFlightVector3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (a: IFlightVector3): IFlightVector3 => {
  const length = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / length, y: a.y / length, z: a.z / length };
};
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const move = (a: number, b: number, maxStep: number): number => a + clamp(b - a, -maxStep, maxStep);

/** ISA air density at altitude `y` metres, kg/m³. */
export function airDensity(y: number): number {
  return 1.225 * Math.max(0.19, 1 - 2.25577e-5 * Math.max(0, y)) ** 4.25588;
}

/** Current mass of the aircraft from its empty mass, fuel load and game-written payload. */
export function aircraftMass(state: IFlightState, airframe: IAircraftAirframe): number {
  return (
    airframe.dryMass +
    airframe.fuelMass * clamp((state.fuel ?? 100) / 100, 0, 1) +
    (state.payloadMass ?? 0)
  );
}

/** Lift and drag coefficients for an angle of attack and the deployed high-lift devices. */
export function aerodynamicCoefficients(
  alpha: number,
  flaps = 0,
  gear = 0,
  brakes = 0,
): { cl: number; cd: number; stall: number; critical: number } {
  const critical = 0.265 + flaps * 0.035;
  const stall = smooth(critical - 0.015, critical + 0.15, Math.abs(alpha));
  const attached = clamp(0.22 + flaps * 0.48 + 4.8 * alpha, -1.48, 1.58 + flaps * 0.35);
  const separated = 1.1 * Math.sin(2 * alpha);
  const cl = lerp(attached, separated, stall);
  const cd =
    0.027 +
    0.075 * cl * cl +
    0.9 * Math.sin(alpha) ** 2 * stall +
    gear * 0.029 +
    brakes * 0.135 +
    flaps * flaps * 0.047;
  return { cd, cl, critical, stall };
}

/** Write a heading/pitch/roll pose into the body quaternion. Nose down local `-Z`. */
export function setAttitude(
  state: IFlightState,
  heading = 0,
  pitch = 0,
  roll = 0,
): IFlightQuaternion {
  const a = pitch / 2;
  const b = -heading / 2;
  const c = roll / 2;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cc = Math.cos(c);
  const sc = Math.sin(c);
  const attitude = {
    w: ca * cb * cc + sa * sb * sc,
    x: sa * cb * cc + ca * sb * sc,
    y: ca * sb * cc - sa * cb * sc,
    z: ca * cb * sc - sa * sb * cc,
  };
  state.attitude = attitude;
  state.heading = wrap(heading);
  state.pitch = pitch;
  state.roll = roll;
  return attitude;
}

/** Right, up and forward unit vectors of the body frame. */
export function attitudeAxes(state: IFlightState): IFlightAxes {
  const q = state.attitude ?? { x: 0, y: 0, z: 0, w: 1 };
  const { x, y, z, w } = q;
  return {
    f: { x: -2 * (x * z + y * w), y: -2 * (y * z - x * w), z: -(1 - 2 * (x * x + y * y)) },
    r: { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + z * w), z: 2 * (x * z - y * w) },
    u: { x: 2 * (x * y - z * w), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + x * w) },
  };
}

/** Height of the gear contact point below the body origin at the current pitch. */
export function gearClearance(state: IFlightState): number {
  return 1.82 * Math.cos(state.pitch) - 0.65 * Math.sin(state.pitch);
}

/** Initialise velocities from a pose and clear the integrated rates. */
export function initFlight(state: IFlightState, environment: IFlightEnvironment): void {
  const wind = environment.wind ?? SEA_WIND;
  setAttitude(state, state.heading ?? 0, state.pitch ?? 0, state.roll ?? 0);
  const f = attitudeAxes(state).f;
  const speed = state.speed ?? 0;
  state.vx = f.x * speed + wind.x;
  state.vy = f.y * speed + wind.y;
  state.vz = f.z * speed + wind.z;
  state.rollRate = 0;
  state.pitchRate = 0;
  state.yawRate = 0;
  state.gearPos = state.gear ? 1 : 0;
  state.brakePos = state.brakes ? 1 : 0;
  state.flaps = state.flaps ?? 0;
  state.flapPos = state.flaps;
  state.rpm = state.throttle || 0;
  state.assist = state.assist ?? true;
  state.trim = state.trim ?? 0.04;
  state.aileron = 0;
  state.elevator = 0;
  state.rudder = 0;
  state.controlAileron = 0;
  state.gforce = 1;
  state.aoa = 0;
  state.beta = 0;
  state.stall = 0;
  state.ias = speed;
  state.groundSpeed = speed;
  state.flightTime = 0;
}

/** Aerodynamic and propulsive force on the body for the current state, no integration. */
export function flightForces(state: IFlightState, environment: IFlightEnvironment): IFlightForces {
  const { airframe } = environment;
  const wind = environment.wind ?? SEA_WIND;
  const gravity = environment.gravity ?? 9.80665;
  const modifiers = environment.modifiers ?? NEUTRAL_FLIGHT_MODIFIERS;
  const axes = attitudeAxes(state);
  const va = { x: state.vx - wind.x, y: state.vy - wind.y, z: state.vz - wind.z };
  const airspeed = Math.hypot(va.x, va.y, va.z);
  const direction = unit(va);
  const vf = dot(va, axes.f);
  const vu = dot(va, axes.u);
  const vr = dot(va, axes.r);
  const alpha = Math.atan2(-vu, Math.max(0.001, vf));
  const beta = Math.atan2(vr, Math.hypot(vf, vu) || 0.001);
  const density = airDensity(state.y);
  const q = 0.5 * density * airspeed * airspeed;
  const qs = q * airframe.wingArea;
  const coeff = aerodynamicCoefficients(
    alpha,
    state.flapPos || 0,
    state.gearPos || 0,
    state.brakePos || 0,
  );
  const health = 0.72 + 0.28 * clamp((state.hp ?? 100) / 100, 0, 1);
  const mass = aircraftMass(state, airframe);
  const lift = qs * coeff.cl * health * modifiers.lift;
  const drag = qs * (coeff.cd + modifiers.drag + (state.payloadDrag ?? 0));
  const liftDir = unit({
    x: axes.u.x - direction.x * dot(axes.u, direction),
    y: axes.u.y - direction.y * dot(axes.u, direction),
    z: axes.u.z - direction.z * dot(axes.u, direction),
  });
  const sideDir = unit({
    x: axes.r.x - direction.x * dot(axes.r, direction),
    y: axes.r.y - direction.y * dot(axes.r, direction),
    z: axes.r.z - direction.z * dot(axes.r, direction),
  });
  const side = -qs * 0.48 * Math.sin(beta);
  const rpm = state.rpm ?? state.throttle ?? 0;
  const thrust =
    (state.fuel > 0 ? 1 : 0) *
    Math.min(
      airframe.staticThrust,
      (airframe.power * airframe.propEfficiency) / Math.max(20, airspeed),
    ) *
    rpm *
    health *
    modifiers.power;
  const fx = liftDir.x * lift - direction.x * drag + sideDir.x * side + axes.f.x * thrust;
  const fy = liftDir.y * lift - direction.y * drag + sideDir.y * side + axes.f.y * thrust;
  const fz = liftDir.z * lift - direction.z * drag + sideDir.z * side + axes.f.z * thrust;
  // Written out field by field, never `{ ...coeff, ... }`: a spread sends V8 through
  // `CopyDataProperties` instead of the boilerplate a fixed literal gets, and this runs twice per
  // aircraft per fixed step. Measured on `scripts/check-flight-cost.ts` (32 aircraft): mean step
  // 0.82 ms spread versus 0.09 ms written out, with a bit-identical `finalStateSha256`.
  return {
    x: fx,
    y: fy - mass * gravity,
    z: fz,
    normalLoad: (fx * axes.u.x + fy * axes.u.y + fz * axes.u.z) / (mass * gravity),
    lift,
    drag,
    thrust,
    alpha,
    beta,
    airspeed,
    density,
    mass,
    qs,
    axes,
    cl: coeff.cl,
    cd: coeff.cd,
    stall: coeff.stall,
    critical: coeff.critical,
  };
}

/** Smoothly drive the control surfaces and engine toward the commanded values. */
export function updateActuators(
  state: IFlightState,
  dt: number,
  controls: IFlightControls = {},
): void {
  state.flightTime = (state.flightTime || 0) + dt;
  state.rpm = lerp(
    state.rpm ?? state.throttle,
    state.fuel <= 0 || state.engineCut ? 0 : state.throttle,
    1 - Math.exp(-dt / 1.3),
  );
  state.gearPos = move(state.gearPos ?? (state.gear ? 1 : 0), state.gear ? 1 : 0, dt * 0.36);
  state.brakePos = move(state.brakePos ?? (state.brakes ? 1 : 0), state.brakes ? 1 : 0, dt * 0.85);
  state.flapPos = move(state.flapPos ?? 0, state.flaps ?? 0, dt * 0.23);
  state.aileron = lerp(state.aileron || 0, clamp(controls.turn || 0, -1, 1), 1 - Math.exp(-dt * 7));
  state.elevator = lerp(
    state.elevator || 0,
    clamp(controls.pitch || 0, -1, 1),
    1 - Math.exp(-dt * 6),
  );
  state.rudder = lerp(state.rudder || 0, clamp(controls.rudder || 0, -1, 1), 1 - Math.exp(-dt * 7));
}

function advanceQuaternion(state: IFlightState, dt: number): void {
  const q = state.attitude;
  if (q === undefined) return;
  const ox = state.pitchRate;
  const oy = -state.yawRate;
  const oz = -state.rollRate;
  const len = Math.hypot(ox, oy, oz);
  const half = (len * dt) / 2;
  const s = len > 1e-9 ? Math.sin(half) / len : dt / 2;
  const dx = ox * s;
  const dy = oy * s;
  const dz = oz * s;
  const dw = Math.cos(half);
  const x = q.x * dw + q.w * dx + q.y * dz - q.z * dy;
  const y = q.y * dw + q.w * dy + q.z * dx - q.x * dz;
  const z = q.z * dw + q.w * dz + q.x * dy - q.y * dx;
  const w = q.w * dw - q.x * dx - q.y * dy - q.z * dz;
  const n = Math.hypot(x, y, z, w) || 1;
  q.x = x / n;
  q.y = y / n;
  q.z = z / n;
  q.w = w / n;
  const axes = attitudeAxes(state);
  state.heading = wrap(Math.atan2(axes.f.x, -axes.f.z));
  state.pitch = Math.asin(clamp(axes.f.y, -1, 1));
  state.roll = Math.atan2(axes.r.y, axes.u.y);
}

/** Integrate one fixed step of free flight. Sub-steps internally at 120 Hz. */
export function stepFlight(
  state: IFlightState,
  dt: number,
  controls: IFlightControls,
  environment: IFlightEnvironment,
): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  if (dt > 1 / 120 + 1e-8) {
    const n = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < n; i += 1) stepFlight(state, dt / n, controls, environment);
    return;
  }
  const { airframe } = environment;
  const gravity = environment.gravity ?? 9.80665;
  const wind = environment.wind ?? SEA_WIND;
  const modifiers = environment.modifiers ?? NEUTRAL_FLIGHT_MODIFIERS;
  if (!state.attitude) initFlight(state, environment);
  updateActuators(state, dt, controls);
  const f = flightForces(state, environment);
  const speed = Math.max(12, f.airspeed);
  const neutralWeight = Math.exp(-Math.abs(state.elevator) * 12);
  const upright = f.axes.u.y > 0.35;
  const assistLoad =
    state.assist && !controls.autopilot && upright
      ? neutralWeight *
        (clamp(1 / Math.max(0.55, Math.cos(state.roll)), 1, 1.8) -
          1 +
          clamp(-state.vy * 0.05, -0.45, 0.45))
      : 0;
  const desiredLoad = 1 + assistLoad + (state.elevator >= 0 ? 4.5 : 2.5) * state.elevator;
  const trimAlpha =
    state.assist || controls.autopilot
      ? clamp(
          ((desiredLoad * f.mass * gravity) / Math.max(f.qs, 4000) - 0.22 - state.flapPos * 0.48) /
            4.8,
          -0.34,
          0.43,
        )
      : state.trim + state.elevator * 0.34;
  const dampingSpeed = Math.max(25, speed);
  const controlPower = clamp(f.qs, 0, 400000);
  const pitchMoment =
    controlPower *
    airframe.chord *
    (0.64 * modifiers.controls * (trimAlpha - f.alpha) -
      (10 * state.pitchRate * airframe.chord) / (2 * dampingSpeed) -
      0.045 * f.stall);
  const bankDemand = clamp((state.roll + state.aileron * 1.1) * 1.7 - state.rollRate * 0.65, -1, 1);
  const rollInput = state.assist && !controls.autopilot ? bankDemand : state.aileron;
  state.controlAileron = rollInput;
  const rollMoment =
    controlPower *
    airframe.span *
    (0.023 * rollInput * (0.35 + 0.65 * modifiers.lift) +
      modifiers.roll -
      (0.48 * state.rollRate * airframe.span) / (2 * dampingSpeed) -
      0.012 * f.beta);
  const yawAssist = state.assist || controls.autopilot ? clamp(f.beta * 1.3, -0.6, 0.6) : 0;
  const yawMoment =
    controlPower *
    airframe.span *
    (0.1 * f.beta +
      0.024 * modifiers.controls * (state.rudder + yawAssist) -
      (0.29 * state.yawRate * airframe.span) / (2 * dampingSpeed) -
      0.0017 * state.aileron);
  state.pitchRate += (pitchMoment / airframe.pitchInertia) * dt;
  state.rollRate += (rollMoment / airframe.rollInertia) * dt;
  state.yawRate += (yawMoment / airframe.yawInertia) * dt;
  advanceQuaternion(state, dt);
  state.vx += (f.x / f.mass) * dt;
  state.vy += (f.y / f.mass) * dt;
  state.vz += (f.z / f.mass) * dt;
  state.x += state.vx * dt;
  state.y += state.vy * dt;
  state.z += state.vz * dt;
  state.speed = Math.hypot(state.vx - wind.x, state.vy - wind.y, state.vz - wind.z);
  state.ias = state.speed * Math.sqrt(f.density / 1.225);
  state.groundSpeed = Math.hypot(state.vx, state.vz);
  state.gforce = lerp(state.gforce ?? 1, f.normalLoad, 1 - Math.exp(-dt * 8));
  state.aoa = f.alpha;
  state.beta = f.beta;
  state.stall = f.stall;
  state.lift = f.lift;
  state.drag = f.drag;
  state.thrust = f.thrust;
  state.mass = f.mass;
}

/** Run one step of a deck launch. Returns `liftoff`, `overrun` or `null` while still rolling. */
export function stepDeck(
  state: IFlightState,
  deck: IFlightDeck,
  dt: number,
  controls: IFlightControls,
  environment: IFlightEnvironment,
): "liftoff" | "overrun" | null {
  const gravity = environment.gravity ?? 9.80665;
  const deckHeight = environment.deckHeight ?? 20;
  const wind = environment.wind ?? SEA_WIND;
  if (!state.attitude) initFlight(state, environment);
  updateActuators(state, dt, controls);
  state.deckSpeed = state.deckSpeed ?? 0;
  state.deckLateral = state.deckLateral ?? -2.5;
  state.deckOffset = state.deckOffset ?? -105;
  const sin = Math.sin(deck.heading);
  const cos = Math.cos(deck.heading);
  const overDeck = deck.speed + wind.z * cos - wind.x * sin;
  const speed = state.deckSpeed + overDeck;
  const tailRise = smooth(22, 38, speed);
  const rotation = smooth(42, 51, speed);
  const neutralPitch = lerp(0.22, 0.025, tailRise) + (state.assist ? 0.145 * rotation : 0);
  const desiredPitch = clamp(neutralPitch + (controls.pitch || 0) * 0.13, -0.025, 0.26);
  state.pitch = lerp(state.pitch, desiredPitch, 1 - Math.exp(-dt * 2.8));
  state.heading = wrap(
    state.heading +
      (controls.rudder || controls.turn || 0) * dt * 0.22 * clamp(state.deckSpeed / 12, 0, 1),
  );
  setAttitude(state, state.heading, state.pitch, 0);
  const yaw = Math.atan2(
    Math.sin(state.heading - deck.heading),
    Math.cos(state.heading - deck.heading),
  );
  state.vx = Math.sin(state.heading) * state.deckSpeed + sin * deck.speed;
  state.vy = 0;
  state.vz = -Math.cos(state.heading) * state.deckSpeed - cos * deck.speed;
  const f = flightForces(state, environment);
  const normal = Math.max(0, f.mass * gravity - f.lift * Math.cos(state.pitch));
  if (state.chocks !== false && state.throttle < 0.55) {
    state.deckSpeed = 0;
  } else {
    state.chocks = false;
    const acceleration =
      (f.thrust - f.drag - normal * (controls.wheelBrake ? 0.55 : 0.019)) / f.mass;
    state.deckSpeed = Math.max(0, state.deckSpeed + acceleration * dt);
  }
  state.deckOffset += Math.cos(yaw) * state.deckSpeed * dt;
  state.deckLateral += Math.sin(yaw) * state.deckSpeed * dt;
  state.x = deck.x + sin * state.deckOffset + cos * state.deckLateral;
  state.z = deck.z - cos * state.deckOffset + sin * state.deckLateral;
  state.y = deckHeight + gearClearance(state);
  state.vx = Math.sin(state.heading) * state.deckSpeed + sin * deck.speed;
  state.vz = -Math.cos(state.heading) * state.deckSpeed - cos * deck.speed;
  state.speed = Math.hypot(state.vx - wind.x, state.vz - wind.z);
  state.ias = state.speed * Math.sqrt(airDensity(state.y) / 1.225);
  state.groundSpeed = state.deckSpeed + deck.speed;
  state.lift = f.lift;
  state.drag = f.drag;
  state.thrust = f.thrust;
  state.aoa = f.alpha;
  state.stall = f.stall;
  state.gforce = 1;
  const lifted = f.lift * Math.cos(state.pitch) > f.mass * gravity * 1.015 && state.deckSpeed > 18;
  const leftDeck =
    state.deckOffset > deck.length / 2 - 1 || Math.abs(state.deckLateral) > deck.width / 2 - 1;
  if (lifted || leftDeck) {
    state.rollRate = 0;
    state.pitchRate = 0;
    state.yawRate = 0;
    return lifted ? "liftoff" : "overrun";
  }
  return null;
}

export interface IFlightModelOptions<TState extends IFlightState = IFlightState>
  extends IFlightEnvironment {
  /** The game's own aircraft object, extended with whatever else the game needs on it. */
  readonly state: TState;
}

/** `IFlightEnvironment` with a writable `modifiers`, for the one record each model steps with. */
interface IFlightStepEnvironment extends Omit<IFlightEnvironment, "modifiers"> {
  modifiers?: IFlightModifiers;
}

/**
 * One aircraft's dynamics: a thin owner of a game-authored state object plus its environment.
 *
 * The step record copies the options' own fields once, at construction — so `airframe`, `wind`,
 * `gravity` and `deckHeight` are read from the objects those fields reference, which stay live,
 * but replacing a field on the options object afterwards is not observed. Change a model's airframe
 * or deck by building it again, as a game that binds aircraft to carriers already does.
 *
 * @example
 * const model = new FlightModel({ airframe: sbd, state: aircraft, wind: seaWind });
 * model.setAttitude(0, 0.2, 0);
 * model.step(1 / 60, { turn: -1, pitch: 0.4 });
 */
export class FlightModel<TState extends IFlightState = IFlightState> {
  readonly state: TState;
  readonly environment: IFlightEnvironment;
  /**
   * `environment` plus the modifiers of the step in flight: one record per model, written per call
   * rather than spread per call. Spreading allocated a whole environment on every aircraft every
   * fixed step, which was the single hottest line of Midway's step; the caller's own environment is
   * never touched.
   */
  readonly #stepEnvironment: IFlightStepEnvironment;

  constructor(options: IFlightModelOptions<TState>) {
    this.state = options.state;
    this.environment = options;
    this.#stepEnvironment = { ...options };
    initFlight(this.state, this.environment);
  }

  setAttitude(heading = 0, pitch = 0, roll = 0): void {
    setAttitude(this.state, heading, pitch, roll);
  }

  reset(): void {
    initFlight(this.state, this.environment);
  }

  axes(): IFlightAxes {
    return attitudeAxes(this.state);
  }

  gearClearance(): number {
    return gearClearance(this.state);
  }

  forces(modifiers: IFlightModifiers = NEUTRAL_FLIGHT_MODIFIERS): IFlightForces {
    this.#stepEnvironment.modifiers = modifiers;
    return flightForces(this.state, this.#stepEnvironment);
  }

  step(
    dt: number,
    controls: IFlightControls,
    modifiers: IFlightModifiers = NEUTRAL_FLIGHT_MODIFIERS,
  ): void {
    this.#stepEnvironment.modifiers = modifiers;
    stepFlight(this.state, dt, controls, this.#stepEnvironment);
  }

  stepDeck(
    deck: IFlightDeck,
    dt: number,
    controls: IFlightControls,
    modifiers: IFlightModifiers = NEUTRAL_FLIGHT_MODIFIERS,
  ): "liftoff" | "overrun" | null {
    this.#stepEnvironment.modifiers = modifiers;
    return stepDeck(this.state, deck, dt, controls, this.#stepEnvironment);
  }
}
