import {
  playtestDiagnostic,
  type IPlaytestScenario,
  type IPlaytestSetupApplication,
  type IPlaytestSetupRequest,
  type PlaytestVec3,
} from "../index.js";

import { aimAngles, yawPitchToQuaternion } from "../scenario/orientation.js";
import { PlaytestBridgeError, type IPlaytestBridgeClient } from "./bridgeClient.js";
import { entityPosition, requestedSetupRecords, setupRequest } from "./shared.js";

function pointToTuple(point: { x: number; y: number; z: number }): PlaytestVec3 {
  return [point.x, point.y, point.z];
}

/** Compose the full bridge request: verbatim entities/resources plus spawn/aim/place. */
async function composeSetupRequest(
  bridge: Pick<IPlaytestBridgeClient, "sample">,
  scenario: IPlaytestScenario,
): Promise<IPlaytestSetupRequest> {
  const request = setupRequest(scenario);
  const setup = scenario.setup;
  if (setup === undefined || (setup.spawn === undefined && setup.aim === undefined && (setup.place?.length ?? 0) === 0)) {
    return request;
  }
  const entities = [...(request.entities ?? [])];
  const subject = scenario.subject;
  let sampledSubjectPosition: PlaytestVec3 | undefined;
  const sampleSubject = async (): Promise<PlaytestVec3> => {
    if (sampledSubjectPosition !== undefined) return sampledSubjectPosition;
    const snapshot = await bridge.sample({ entities: [subject ?? ""] });
    const position = entityPosition(snapshot, subject ?? "");
    if (position === undefined) {
      throw new Error(
        `Subject '${subject}' was not observed, so its current height cannot be preserved for setup.spawn; declare spawn.y explicitly or register the subject with the bridge.`,
      );
    }
    sampledSubjectPosition = position;
    return position;
  };
  if (setup.spawn !== undefined) {
    if (subject === undefined) throw new Error("Scenario setup.spawn requires a subject.");
    // Explicit presence semantics: an absent y preserves the game's own height (its eye
    // or ground line); it is never silently defaulted to zero.
    const y = setup.spawn.y ?? (await sampleSubject())[1];
    entities.push({
      entity: subject,
      transform: { position: [setup.spawn.x, y, setup.spawn.z] },
    });
  }
  if (setup.aim !== undefined) {
    if (subject === undefined) throw new Error("Scenario setup.aim requires a subject.");
    entities.push({
      entity: subject,
      transform: { rotation: yawPitchToQuaternion(setup.aim.yaw, setup.aim.pitch) },
    });
  }
  for (const place of setup.place ?? []) {
    let rotation: [number, number, number, number] | undefined;
    if (place.lookAt !== undefined) {
      const angles = aimAngles(pointToTuple(place.at), pointToTuple(place.lookAt));
      rotation = yawPitchToQuaternion(angles.yaw, angles.pitch);
    } else if (place.facing !== undefined) {
      rotation = yawPitchToQuaternion(place.facing.yaw, 0);
    }
    entities.push({
      entity: place.entity,
      ...(place.frozen === undefined ? {} : { frozen: place.frozen }),
      transform: {
        position: pointToTuple(place.at),
        ...(rotation === undefined ? {} : { rotation }),
      },
    });
  }
  return { ...request, entities };
}

/**
 * Apply every declared placement through the bridge's setup channel and report what
 * applied. Any entry that cannot apply fails the run with the reason named — a partial
 * or skipped placement is never reported green.
 */
export async function applyScenarioSetup(
  bridge: Pick<IPlaytestBridgeClient, "applySetup" | "sample">,
  scenario: IPlaytestScenario,
): Promise<IPlaytestSetupApplication> {
  const requested = requestedSetupRecords(scenario);
  try {
    await bridge.applySetup(await composeSetupRequest(bridge, scenario));
    return { applied: requested, requested };
  } catch (error) {
    if ((error as object) instanceof PlaytestBridgeError) throw error;
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_SETUP_UNAPPLIED",
      `Scenario setup could not apply: ${error instanceof Error ? error.message : String(error)}`,
      "Register every placed entity with the playtest bridge before the run, or correct the placement.",
    ));
  }
}
