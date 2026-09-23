import type { IStepCostFixture, IStepCostWorkload } from "../../../../scripts/lib/step-cost.js";
import { FlightModel, type IAircraftAirframe, type IFlightState } from "../../src/flight.js";
import { createRandom } from "../../src/random.js";

/** Synthetic test inputs, not a game airframe preset or Midway's battle population. */
const AIRFRAME: IAircraftAirframe = Object.freeze({
  chord: 2.4,
  dryMass: 3000,
  fuelMass: 500,
  pitchInertia: 9500,
  power: 750000,
  propEfficiency: 0.8,
  rollInertia: 14500,
  span: 12,
  staticThrust: 11000,
  wingArea: 30,
  yawInertia: 17500,
});

export const FLIGHT_COST_WORKLOAD: IStepCostWorkload = Object.freeze({
  dt: 1 / 60,
  measuredTicks: 600,
  population: 32,
  seed: 20260914,
  warmupTicks: 120,
});

export function createFlightCostFixture(
  workload: IStepCostWorkload,
): IStepCostFixture<readonly number[][]> {
  const random = createRandom(workload.seed);
  const aircraft = Array.from({ length: workload.population }, (_, index) => {
    const state: IFlightState = {
      aileron: 0,
      aoa: 0,
      assist: true,
      beta: 0,
      brakePos: 0,
      brakes: false,
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
      heading: random.range(-0.2, 0.2),
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
      speed: random.range(80, 100),
      stall: 0,
      throttle: 0.8,
      thrust: 0,
      trim: 0.04,
      vx: 0,
      vy: 0,
      vz: 0,
      x: index * 20,
      y: random.range(900, 1100),
      yawRate: 0,
      z: 0,
    };
    return {
      input: Object.freeze({ pitch: random.range(0.01, 0.03), turn: random.range(-0.05, 0.05) }),
      model: new FlightModel({ airframe: AIRFRAME, state, wind: { x: 1, y: 0, z: 3 } }),
    };
  });
  return {
    step: (_tick, dt) => {
      for (const { model, input } of aircraft) model.step(dt, input);
    },
    snapshot: () =>
      aircraft.map(({ model }) => {
        const s = model.state;
        const values = [
          s.x,
          s.y,
          s.z,
          s.vx,
          s.vy,
          s.vz,
          s.heading,
          s.pitch,
          s.roll,
          s.rollRate,
          s.pitchRate,
          s.yawRate,
          s.speed,
          s.fuel,
          s.thrust,
          s.lift,
          s.drag,
        ];
        if (values.some((value) => !Number.isFinite(value))) {
          throw new Error(
            "TN_FLIGHT_COST_STATE_INVALID: a measured aircraft produced non-finite state.",
          );
        }
        return values;
      }),
  };
}
