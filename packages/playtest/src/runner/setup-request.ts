import type {
  IPlaytestObservationSnapshot,
  IPlaytestSampleRequest,
  IPlaytestScenario,
  IPlaytestSetupRequest,
  PlaytestVec3,
} from "../index.js";

import { aimAngles, yawPitchToQuaternion } from "../scenario/orientation.js";
import { entityPosition, setupRequest } from "./shared.js";

export interface IPlaytestSetupSampler {
  sample(request: IPlaytestSampleRequest): Promise<IPlaytestObservationSnapshot>;
}

function pointToTuple(point: { x: number; y: number; z: number }): PlaytestVec3 {
  return [point.x, point.y, point.z];
}

/** Compose the full bridge request: verbatim entities/resources plus spawn/aim/place. */
export async function composeScenarioSetupRequest(
  bridge: IPlaytestSetupSampler,
  scenario: IPlaytestScenario,
): Promise<IPlaytestSetupRequest> {
  const request = setupRequest(scenario);
  const setup = scenario.setup;
  if (setup === undefined || !hasPlacementOverrides(setup)) {
    return request;
  }
  const entities = [...(request.entities ?? [])];
  const subject = scenario.subject;
  if (setup.spawn !== undefined) entities.push(await composeSpawnEntity(bridge, setup.spawn, subject));
  if (setup.aim !== undefined) entities.push(composeAimEntity(setup.aim, subject));
  entities.push(...(setup.place ?? []).map(composePlaceEntity));
  return { ...request, entities };
}

type ScenarioSetup = NonNullable<IPlaytestScenario["setup"]>;

function hasPlacementOverrides(setup: ScenarioSetup): boolean {
  return setup.spawn !== undefined || setup.aim !== undefined || (setup.place?.length ?? 0) > 0;
}

async function composeSpawnEntity(
  bridge: IPlaytestSetupSampler,
  spawn: NonNullable<ScenarioSetup["spawn"]>,
  subject: string | undefined,
): Promise<NonNullable<IPlaytestSetupRequest["entities"]>[number]> {
  if (subject === undefined) throw new Error("Scenario setup.spawn requires a subject.");
  // Explicit presence semantics: an absent y preserves the game's own height (its eye
  // or ground line); it is never silently defaulted to zero.
  const y = spawn.y ?? (await sampleSubjectPosition(bridge, subject))[1];
  return {
    entity: subject,
    transform: { position: [spawn.x, y, spawn.z] },
  };
}

function composeAimEntity(
  aim: NonNullable<ScenarioSetup["aim"]>,
  subject: string | undefined,
): NonNullable<IPlaytestSetupRequest["entities"]>[number] {
  if (subject === undefined) throw new Error("Scenario setup.aim requires a subject.");
  return {
    entity: subject,
    transform: { rotation: yawPitchToQuaternion(aim.yaw, aim.pitch) },
  };
}

function composePlaceEntity(
  place: NonNullable<ScenarioSetup["place"]>[number],
): NonNullable<IPlaytestSetupRequest["entities"]>[number] {
  const rotation = place.lookAt === undefined
    ? place.facing === undefined
      ? undefined
      : yawPitchToQuaternion(place.facing.yaw, 0)
    : (() => {
        const angles = aimAngles(pointToTuple(place.at), pointToTuple(place.lookAt));
        return yawPitchToQuaternion(angles.yaw, angles.pitch);
      })();
  return {
    entity: place.entity,
    ...(place.frozen === undefined ? {} : { frozen: place.frozen }),
    transform: {
      position: pointToTuple(place.at),
      ...(rotation === undefined ? {} : { rotation }),
    },
  };
}

async function sampleSubjectPosition(
  bridge: IPlaytestSetupSampler,
  subject: string,
): Promise<PlaytestVec3> {
  const snapshot = await bridge.sample({ entities: [subject] });
  const position = entityPosition(snapshot, subject);
  if (position === undefined) {
    throw new Error(
      `Subject '${subject}' was not observed, so its current height cannot be preserved for setup.spawn; declare spawn.y explicitly or register the subject with the bridge.`,
    );
  }
  return position;
}
