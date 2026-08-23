import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { type PerspectiveCamera, Vector3 } from "three";
import { RACING_FEEL, RacingCar } from "../entities/RacingCar.js";
import { Rival } from "../entities/Rival.js";
import { emitPlaytestEvent } from "../playtest-events.js";
import { cameraRoll, chaseCamera, setupCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { flag } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import { type GameState, type RaceStatus, resolveRaceStatus } from "../state.js";
import { Lap } from "../track/Lap.js";
import { type IRankedRacer, type IRankedRacerScratch, rankRacers } from "../track/Ranking.js";
import { TOTAL_LAPS, buildTrack, intersectRay, roadRayProbe } from "../track/Track.js";
import { TrackSector } from "../track/TrackSector.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const SPAWN = new Vector3(2, 0.55, -18);
const TIME_LIMIT = 90;

function playerRanking(ranked: readonly IRankedRacer[]): IRankedRacer | undefined {
  for (const racer of ranked) if (racer.id === "player") return racer;
  return undefined;
}

function quantize(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}

export class Race extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    boostActive: false,
    boostPeakSpeed: 0,
    boostUses: 0,
    completedLaps: 0,
    elapsed: 0,
    lastOnRoad: [SPAWN.x, SPAWN.y, SPAWN.z],
    place: 1,
    position: "P1",
    raceStatus: "RACING",
    rescueHeading: 0,
    rescueHeadingError: -1,
    rescuePositionError: -1,
    rescues: 0,
    shortcutRejects: 0,
    speed: 0,
    speedAfterBoost: 0,
    sameDistanceRanking: "",
    topSpeed: 0,
    totalLaps: TOTAL_LAPS,
    trackProgress: 0,
    reverseRejects: 0,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);
    const loading = createLoadingScreen(ctx);
    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    ctx.add(camera);
    const track = buildTrack(ctx);
    const car = new RacingCar(ctx, SPAWN);
    const spawnDistance = track.route.project(SPAWN).distanceFromStart % track.route.totalLength;
    const rival = new Rival(track.route, spawnDistance + track.route.totalLength);
    rival.update(0);
    rival.mesh.position.copy(car.mesh.position);
    ctx.add(rival.mesh);
    ctx.entities.add("player", car);
    ctx.entities.add("rival", rival);
    const flagMaterial = createMaterials().boost;
    for (const point of [new Vector3(14, 0, -18), new Vector3(-14, 0, 18)]) {
      const marker = flag(flagMaterial);
      marker.position.copy(point);
      ctx.add(marker);
    }

    const lap = new Lap(
      { body: car.body, forward: car.travelDirection },
      track.gates,
      TOTAL_LAPS,
      (completed) => emitPlaytestEvent({ entity: "player", lap: completed, name: "lap-completed" }),
    );
    const playerRankingInput = { id: "player", lap: lap.completed, position: car.mesh.position };
    const rivalRankingInput = { id: "rival", lap: rival.lap, position: rival.mesh.position };
    const rankingInputs = [playerRankingInput, rivalRankingInput];
    const rankingBuffer: IRankedRacerScratch[] = [];
    const rankRace = () => {
      playerRankingInput.lap = lap.completed;
      rivalRankingInput.lap = rival.lap;
      return rankRacers(track.route, rankingInputs, undefined, rankingBuffer);
    };
    const initialRanked = rankRace();
    const initialPlayer = playerRanking(initialRanked);
    if (initialPlayer === undefined) throw new Error("Race ranking lost the player at spawn.");
    const fallbackProbe = roadRayProbe(track.roadMeshes);
    const sector = new TrackSector({
      route: track.route,
      intersectRay: intersectRay(ctx.physics, fallbackProbe),
    });
    track.boostArea.on("bodyEntered", (body) => {
      if (body === car.body) {
        car.boost.activate();
        emitPlaytestEvent({ entity: "player", name: "boost-applied" });
      }
    });
    car.boost.update(0);
    let elapsed = 0;
    let status: RaceStatus = "RACING";
    let rescues = 0;
    let rescueHeadingError = -1;
    let rescuePositionError = -1;
    let speedAfterBoost = 0;
    let boostSettled = false;
    let sameDistanceRanking = initialRanked[0]?.id === "rival" ? "lap-ahead" : "lap-behind";
    let place = initialPlayer.place;
    let positionLabel = `P${place}`;
    const lastOnRoad: [number, number, number] = [SPAWN.x, SPAWN.y, SPAWN.z];
    const observedPosition = SPAWN.clone();
    sector.update(SPAWN, car.forward, 0);
    chaseCamera(camera, car.mesh.position, car.forward, 1);

    const advanceRace = (frameCtx: GameCtx, dt: number): void => {
      if (status !== "RACING") return;
      lap.observe(observedPosition, car.mesh.position);
      observedPosition.copy(car.mesh.position);
      car.update(frameCtx, dt);
      rival.update(dt);
      sector.update(car.mesh.position, car.forward, dt);
      if (sector.rescue(car)) {
        rescues += 1;
        rescuePositionError = quantize(
          car.mesh.position.distanceTo(sector.lastOnRoadPosition),
          10_000,
        );
        rescueHeadingError = quantize(car.forward.angleTo(sector.lastOnRoadHeading), 10_000);
        emitPlaytestEvent({ entity: "player", name: "rescued" });
      }
      if (elapsed >= TIME_LIMIT || rescues >= 4) status = "DNF";
    };

    const statePatch: Partial<GameState> = {};

    return (frameCtx, dt) => {
      loading.update();
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Race.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("race");
        return;
      }
      elapsed += dt;
      advanceRace(frameCtx, dt);
      if (!car.boost.active && car.boost.uses > 0 && !boostSettled) {
        const settledSpeed = car.speedAfterBoost();
        if (Math.abs(settledSpeed - RACING_FEEL.maxSpeed) < 0.001) {
          speedAfterBoost = settledSpeed;
          boostSettled = true;
        }
      }
      const ranked = rankRace();
      const player = playerRanking(ranked);
      if (player === undefined) throw new Error("Race ranking lost the player.");
      sameDistanceRanking = ranked[0]?.id === "rival" ? "lap-ahead" : "lap-behind";
      status = resolveRaceStatus(status, lap.completed, TOTAL_LAPS, player.place);
      if (player.place !== place) {
        place = player.place;
        positionLabel = `P${place}`;
      }
      const previous = frameCtx.state.getState();
      const boostPeakSpeed = Math.max(previous.boostPeakSpeed, car.boost.active ? car.speed : 0);
      lastOnRoad[0] = sector.lastOnRoadPosition.x;
      lastOnRoad[1] = sector.lastOnRoadPosition.y;
      lastOnRoad[2] = sector.lastOnRoadPosition.z;
      statePatch.boostActive = car.boost.active;
      statePatch.boostPeakSpeed = boostPeakSpeed;
      statePatch.boostUses = car.boost.uses;
      statePatch.completedLaps = lap.completed;
      statePatch.elapsed = elapsed;
      statePatch.lastOnRoad = lastOnRoad;
      statePatch.place = player.place;
      statePatch.position = positionLabel;
      statePatch.raceStatus = status;
      statePatch.rescueHeading = Math.atan2(sector.lastOnRoadHeading.z, sector.lastOnRoadHeading.x);
      statePatch.rescueHeadingError = rescueHeadingError;
      statePatch.rescuePositionError = rescuePositionError;
      statePatch.rescues = rescues;
      statePatch.shortcutRejects = lap.shortcutRejects;
      statePatch.speed = car.speed;
      statePatch.speedAfterBoost = speedAfterBoost;
      statePatch.sameDistanceRanking = sameDistanceRanking;
      statePatch.topSpeed = Math.max(previous.topSpeed, car.topSpeed);
      statePatch.trackProgress = player.routeProgress;
      statePatch.reverseRejects = lap.reverseRejects;
      frameCtx.state.set(statePatch);
      chaseCamera(camera, car.mesh.position, car.forward, dt);
      cameraRoll(camera, car.forward);
    };
  }
}
