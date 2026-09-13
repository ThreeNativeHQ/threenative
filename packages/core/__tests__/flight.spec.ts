import { describe, expect, it } from "vitest";
import {
  aerodynamicCoefficients,
  FlightModel,
  type IAircraftAirframe,
  type IFlightState,
} from "../src/index.js";

const SBD: IAircraftAirframe = {
  chord: 2.38,
  dryMass: 3050,
  fuelMass: 520,
  pitchInertia: 9400,
  power: 745700,
  propEfficiency: 0.8,
  rollInertia: 14500,
  span: 12.66,
  staticThrust: 11200,
  wingArea: 30.19,
  yawInertia: 17500,
};

function state(): IFlightState {
  return {
    aileron: 0,
    aoa: 0,
    assist: true,
    beta: 0,
    brakes: false,
    brakePos: 0,
    controlAileron: 0,
    drag: 0,
    elevator: 0,
    engineCut: false,
    flapPos: 0,
    flaps: 0,
    flightTime: 0,
    fuel: 100,
    gear: false,
    gearPos: 0,
    gforce: 1,
    groundSpeed: 0,
    heading: 0,
    hp: 100,
    ias: 0,
    lift: 0,
    mass: 0,
    payloadDrag: 0,
    payloadMass: 0,
    pitch: 0,
    pitchRate: 0,
    roll: 0,
    rollRate: 0,
    rpm: 0,
    rudder: 0,
    speed: 0,
    stall: 0,
    throttle: 0,
    thrust: 0,
    trim: 0.04,
    vx: 0,
    vy: 0,
    vz: 0,
    x: 0,
    y: 1000,
    yawRate: 0,
    z: 0,
  };
}

function modelAt(speed: number): { model: FlightModel; state: IFlightState } {
  const s = state();
  s.speed = speed;
  s.throttle = 0.8;
  const model = new FlightModel({ airframe: SBD, state: s });
  model.reset();
  model.setAttitude(0, 0, 0);
  return { model, state: s };
}

describe("FlightModel", () => {
  it("trims to roughly level flight instead of holding a commanded vector", () => {
    const { model, state: s } = modelAt(100);
    for (let i = 0; i < 900; i += 1) model.step(1 / 60, { pitch: 0.02 });
    expect(Math.abs(s.roll)).toBeLessThan(0.05);
    expect(Math.abs(s.pitch)).toBeLessThan(0.12);
  });

  it("produces more lift at higher airspeed", () => {
    const slow = modelAt(60);
    const fast = modelAt(120);
    expect(fast.model.forces().lift).toBeGreaterThan(slow.model.forces().lift);
  });

  it("stalls past the critical angle of attack", () => {
    expect(aerodynamicCoefficients(0.06).stall).toBeLessThan(0.1);
    expect(aerodynamicCoefficients(0.6).stall).toBeGreaterThan(0.5);
  });

  it("kills thrust when the power multiplier is zero", () => {
    const { model } = modelAt(100);
    const neutral = model.forces();
    const damaged = model.forces({ controls: 1, drag: 0, lift: 1, power: 0, roll: 0 });
    expect(neutral.thrust).toBeGreaterThan(1000);
    expect(damaged.thrust).toBe(0);
  });

  it("lifts off the deck once the wing carries the weight", () => {
    const s = state();
    s.y = 20;
    s.throttle = 1;
    s.chocks = true;
    s.gear = true;
    const model = new FlightModel({
      airframe: SBD,
      state: s,
      wind: { x: 1.2, y: 0, z: 11 },
    });
    const deck = { heading: 0, length: 250, speed: 8, width: 35, x: 0, z: 0 };
    let result: ReturnType<FlightModel["stepDeck"]> = null;
    for (let i = 0; i < 3000 && result === null; i += 1) result = model.stepDeck(deck, 1 / 60, {});
    expect(result).toBe("liftoff");
    expect(s.deckSpeed).toBeGreaterThan(18);
    expect(s.y).toBeGreaterThan(20);
  });
});
