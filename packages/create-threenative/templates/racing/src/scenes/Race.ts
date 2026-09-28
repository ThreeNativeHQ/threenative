import {
  type ICtx,
  Scene,
  type SceneFrame,
  afterPhysics,
  isMobile,
  isTouchscreenAvailable,
} from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { type PerspectiveCamera, type Texture, Vector3 } from "three";
import { type CarCtx, FEEL, RIDE } from "../entities/CarBody.js";
import { RacingCar } from "../entities/RacingCar.js";
import { Rival } from "../entities/Rival.js";
import { emitPlaytestEvent } from "../playtest-events.js";
import { cameraBank, chaseCamera, setupCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { flag } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import { TouchControls } from "../render/touch-controls.js";
import { type GameState, type RaceStatus, resolveRaceStatus } from "../state.js";
import { Lap } from "../track/Lap.js";
import { type IRankedRacer, type IRankedRacerScratch, rankRacers } from "../track/Ranking.js";
import { GRID, TOTAL_LAPS, buildTrack, intersectRay, roadRayProbe } from "../track/Track.js";
import { TrackSector } from "../track/TrackSector.js";

export type GameCtx = CarCtx;

/** The player starts on the second grid slot, one ride height above the tarmac. */
const SPAWN = new Vector3(GRID.player.x, RIDE, GRID.player.z);
const TIME_LIMIT = 90;

function playerRanking(ranked: readonly IRankedRacer[]): IRankedRacer | undefined {
  for (let index = 0; index < ranked.length; index += 1) {
    const racer = ranked[index];
    if (racer?.id === "player") return racer;
  }
  return undefined;
}

function quantize(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}

export class Race extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    paused: false,
    uiReady: false,
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

  #sky: Texture | undefined;

  /** The sky photograph, loaded before the scene is entered so the first frame is already lit. */
  override async load(ctx: GameCtx): Promise<void> {
    this.#sky = await ctx.assets.texture("sky.jpg");
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    if (this.#sky === undefined)
      throw new Error("Race.enter ran before load() loaded the sky photograph.");
    const sky = this.#sky;
    setupSky(ctx.scene, sky);
    const lighting = setupLighting(
      ctx.scene,
      ctx.renderer.raw as Parameters<typeof setupLighting>[1],
      isMobile(),
    );
    // isMobile() arrives as an argument because src/render/ imports no framework package: the
    // platform decision is made here, in portable game code, exactly like createRandom.
    setupPost(ctx.renderer, ctx.scene, ctx.camera, {
      godraysLight: lighting.key,
      mobile: isMobile(),
    });
    const loading = createLoadingScreen(ctx);
    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    ctx.add(camera);
    const showTouchControls = isMobile() && isTouchscreenAvailable();
    const touchControls = showTouchControls
      ? ctx.entities.add("touch-controls", new TouchControls(camera))
      : undefined;
    const track = buildTrack(ctx);
    const car = new RacingCar(ctx, SPAWN);
    // The rival's grid slot, projected onto the route it drives: its own slot, four metres up the
    // road, facing the same way. It used to be placed one whole lap ahead and then copied onto the
    // player's position, so the two cars were the same point in space and the player drove through
    // a rival that had no body.
    const rivalSlot = new Vector3(GRID.rival.x, RIDE, GRID.rival.z);
    const rival = new Rival(ctx, track.route, track.route.project(rivalSlot).distanceFromStart);
    ctx.entities.add("player", car);
    ctx.entities.add("rival", rival);
    const flagMaterial = createMaterials().boost;
    for (const point of [new Vector3(14, 0, -18), new Vector3(-14, 0, 18)]) {
      const marker = flag(flagMaterial);
      marker.position.copy(point);
      ctx.add(marker);
    }

    // `travelDirection` is the car's **measured** velocity, not the heading it was asked for: a
    // car that is sliding through a corner is travelling somewhere other than where it points, and
    // a lap counted on the intent is a lap counted on a wish.
    const lap = new Lap(
      { body: car.body.body, forward: car.travelDirection },
      track.gates,
      TOTAL_LAPS,
      (completed) => emitPlaytestEvent({ entity: "player", lap: completed, name: "lap-completed" }),
    );
    const playerRankingInput = {
      id: "player",
      lap: lap.completed,
      position: car.body.position,
    };
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
      if (body === car.body.body) {
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
    const boostSettled = false;
    let sameDistanceRanking = initialRanked[0]?.id === "rival" ? "lap-ahead" : "lap-behind";
    let place = initialPlayer.place;
    let positionLabel = `P${place}`;
    const lastOnRoad: [number, number, number] = [SPAWN.x, SPAWN.y, SPAWN.z];
    const observedPosition = SPAWN.clone();
    sector.update(SPAWN, car.forward, 0);
    chaseCamera(camera, car.body.position, car.forward, 1, undefined);

    const advanceRace = (frameCtx: GameCtx, dt: number): void => {
      if (status !== "RACING") return;
      lap.observe(observedPosition, car.body.position);
      observedPosition.copy(car.body.position);
      car.update(
        frameCtx,
        dt,
        touchControls?.update(frameCtx.input.raw.pointers, frameCtx.viewport.size),
      );
      rival.update(dt);
      sector.update(car.body.position, car.forward, dt);
      if (sector.rescue(car)) {
        rescues += 1;
        rescuePositionError = quantize(
          car.body.position.distanceTo(sector.lastOnRoadPosition),
          10_000,
        );
        rescueHeadingError = quantize(car.forward.angleTo(sector.lastOnRoadHeading), 10_000);
        emitPlaytestEvent({ entity: "player", name: "rescued" });
      }
      if (elapsed >= TIME_LIMIT || rescues >= 4) status = "DNF";
    };

    const statePatch: Partial<GameState> = {};

    // The suspension and the camera both read the **solved** chassis, so they run in the
    // afterPhysics phase rather than in the scene frame: a wheel's spin angle and a car's velocity
    // are last step's numbers until the step after this one.
    afterPhysics(ctx, (dt) => {
      car.body.settleVisuals();
      rival.car.settleVisuals();
      const solved = car.body.body.linearVelocity;
      chaseCamera(camera, car.body.position, car.travelDirection, dt, solved);
      camera.rotateZ(cameraBank(car.lateralLoad, FEEL.lateral));
    });

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
      const boostPeakSpeed = Math.max(previous.boostPeakSpeed, car.boosting ? car.speed : 0);
      lastOnRoad[0] = sector.lastOnRoadPosition.x;
      lastOnRoad[1] = sector.lastOnRoadPosition.y;
      lastOnRoad[2] = sector.lastOnRoadPosition.z;
      statePatch.boostActive = car.boosting;
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
      statePatch.speedAfterBoost = car.speedAfterBoost();
      statePatch.sameDistanceRanking = sameDistanceRanking;
      statePatch.topSpeed = Math.max(previous.topSpeed, car.topSpeed);
      statePatch.trackProgress = player.routeProgress;
      statePatch.reverseRejects = lap.reverseRejects;
      frameCtx.state.set(statePatch);
    };
  }
}
