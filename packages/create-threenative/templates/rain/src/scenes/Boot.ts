// Generated for you. The one scene: a coast you can walk, and an atmosphere you can reshape.
import { type ICtx, Scene, type SceneFrame, alwaysRender, isMobile } from "@threenative/core";
import { type PerspectiveCamera, Vector3 } from "three";
import { STORM_AUDIO_ENTITY, createStormAudio } from "../audio/storm.js";
import { createCameraRig, setupCamera } from "../render/camera.js";
import { createLoadingScreen } from "../render/loading.js";
import { type IStormPost, setupPost } from "../render/postprocessing.js";
import { type IStormRain, createStormRain } from "../render/rain.js";
import { createWeatherWorld } from "../render/world.js";
import {
  AUTO_STRIKE_CLOUD,
  type GameState,
  MAX_STEP,
  QUALITY_RAIN_BUDGET,
  type SimStatus,
  WEATHER_KEYS,
  type Weather,
  easeWeather,
  flashAt,
  thunderDelay,
} from "../state.js";

export type WeatherCtx = ICtx<GameState>;

/** Seconds of weather the clock starts on, so the first frame is not the start of the storm. */
const START_TIME = 28;
/** The storm, this far in, is not waiting for the first automatic strike. */
const FIRST_STRIKE_DELAY = 9;
const STRIKE_MIN_GAP = 8;
const STRIKE_SPREAD = 16;
/** Below this gap the atmosphere is where it was aimed, and the status can say so. */
const SETTLED = 0.004;
/** Where a strike lands, in the game's own coordinates: out to sea, ahead of the coast. */
const STRIKE_SITE = { maxX: 49, minX: -45, nearZ: -250, spread: 220 } as const;

const STORM: Weather = {
  cloud: 0.76,
  exposure: 1.12,
  fog: 0.4,
  rain: 0.76,
  wet: 1,
  wind: 0.55,
};

export class Coast extends Scene<GameState> {
  // Kept on the instance because `enter` builds them and `exit` is the only hook that runs when the
  // scene goes away: a dropped handle is a shader chain and a geometry that never come back.
  #rain: IStormRain | undefined;
  #post: IStormPost | undefined;

  static override readonly initialState: GameState = {
    audioEnabled: false,
    autoLightning: true,
    cameraReset: false,
    cinematic: false,
    droplets: true,
    dropCount: 0,
    elapsed: START_TIME,
    flash: 0,
    fps: 0,
    frame: 0,
    heading: 0,
    helpOpen: false,
    muted: false,
    paused: false,
    pendingThunderAt: -1,
    preset: "storm",
    quality: "balanced",
    safe: false,
    status: "steady",
    strikeRequested: false,
    target: { ...STORM },
    uiHidden: false,
    uiReady: false,
    weather: { ...STORM },
  };

  override enter(ctx: WeatherCtx): SceneFrame<GameState> {
    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    const rig = createCameraRig(camera);
    const loading = createLoadingScreen(ctx);
    // The storm's noise volume is the same 64³ every run whatever the player does: it is seeded
    // inside the render layer, because the sequence that fills it is the storm's appearance.
    const world = createWeatherWorld(ctx.scene, camera);
    // The world is one screen-sized quad at the origin, so the camera's own frustum would cull it
    // the moment it looked along the coast. Marking it is how a game says "this is always drawn".
    alwaysRender(world.quad);
    // The rain is one instanced draw whose drops are projected by its own vertex stage, so its
    // bounds say nothing about where they land and the same marker keeps it drawn at any heading.
    const rain = createStormRain(ctx.scene, camera);
    alwaysRender(rain.mesh);
    // Retained, not called and dropped: `update` is where the post pass learns this frame's time,
    // exposure, rain and droplet toggle, and `uRes` is zero until it has run once.
    const post = setupPost(ctx.renderer, ctx.scene, camera, { mobile: isMobile() });
    this.#rain = rain;
    this.#post = post;
    // Registered, so the engine's registry disposes it with the game and `game.ts` can reach it by
    // name for the two holds that arrive outside a frame (the pause intent and tab visibility).
    const audio = ctx.entities.add(STORM_AUDIO_ENTITY, createStormAudio(ctx));

    let weather: Weather = { ...STORM };
    let elapsed = START_TIME;
    let frame = 0;
    let nextStrikeAt = START_TIME + FIRST_STRIKE_DELAY;
    let strikeAt = -100;
    let pendingThunderAt = -1;
    let cinematic = false;
    let safe = false;
    // Out at sea, so a flash that lands before the first strike still lights open water.
    const site = new Vector3(0, 0, -400);

    /**
     * A strike is queued on the same clock as everything else, so the flash, the thunder and the
     * distance it crossed cannot disagree with each other. Gated on the photosensitivity switch
     * at the one door every path comes through, manual key and automatic alike.
     */
    const strike = (): void => {
      if (safe) return;
      strikeAt = elapsed - 0.025;
      site.set(
        STRIKE_SITE.minX + ctx.random() * (STRIKE_SITE.maxX - STRIKE_SITE.minX),
        0,
        STRIKE_SITE.nearZ - ctx.random() * STRIKE_SITE.spread,
      );
      pendingThunderAt = elapsed + thunderDelay(rig.position.distanceTo(site));
      nextStrikeAt = elapsed + STRIKE_MIN_GAP + ctx.random() * STRIKE_SPREAD;
      // The thunder is queued on the same clock the flash is drawn against, by the same distance
      // the delay came from, so what is heard cannot disagree with what was seen.
      audio.queueStrike({ at: pendingThunderAt, metres: rig.position.distanceTo(site) });
    };

    /** Read the intent the UI sent between frames, before anything is derived from it. */
    const readIntent = (frameCtx: WeatherCtx): GameState => {
      const ui = frameCtx.state.getState();
      // Both resets come through the same door, and each one is a fresh request: the flag is
      // consumed and cleared below, never latched, so a second reset still lands.
      const reset = ui.cameraReset || frameCtx.input.justPressed("resetCamera");
      if (reset) {
        rig.reset();
        cinematic = false;
      } else {
        // Any real input hands the camera back: the orbit is a mode, not a cage.
        cinematic = ui.cinematic && !rig.manual;
      }
      safe = ui.safe;
      if (ui.strikeRequested || frameCtx.input.justPressed("strike")) strike();
      return ui;
    };

    const advance = (ui: GameState, step: number): void => {
      // No pause check here on purpose: `game.pause()` stops the whole loop, so the renderer, the
      // shaders and this clock all stop together instead of the weather freezing while time runs.
      elapsed += step;
      weather = easeWeather(weather, ui.target, step);
      if (!ui.autoLightning || elapsed <= nextStrikeAt) return;
      if (weather.cloud > AUTO_STRIKE_CLOUD) strike();
      else nextStrikeAt = elapsed + STRIKE_MIN_GAP;
    };

    return (frameCtx, dt) => {
      const step = Math.min(dt, MAX_STEP);
      const ui = readIntent(frameCtx);
      advance(ui, step);

      const flash = safe ? 0 : flashAt(elapsed - strikeAt);
      if (pendingThunderAt >= 0 && elapsed >= pendingThunderAt) pendingThunderAt = -1;

      rig.update(step, elapsed, frameCtx.input, cinematic);
      // The rig only learns it is being driven once it has run, so the published flag is settled
      // after it: a hand on the camera ends the orbit on the same frame it happened.
      if (rig.manual) cinematic = false;
      // Both passes read the weather this frame has just eased towards, not the target the UI
      // asked for, so a drop and a lens bead are lit by the same air the coast is drawn with.
      rain.update({ elapsed, flash, weather, quality: ui.quality });
      post.update({
        elapsed,
        exposure: weather.exposure,
        rain: weather.rain,
        droplets: ui.droplets,
      });
      world.update({
        elapsed,
        flash,
        quality: ui.quality,
        rainBudget: QUALITY_RAIN_BUDGET[ui.quality],
        strike: site,
        weather,
      });
      loading.update();
      frame += 1;

      // Both request flags are consumed here, so the next request is a new one.
      frameCtx.state.set({
        cameraReset: false,
        cinematic,
        dropCount: rain.instanceCount,
        elapsed,
        flash,
        fps: frameCtx.fps,
        frame,
        heading: rig.heading,
        pendingThunderAt,
        safe,
        strikeRequested: false,
        status: statusOf(ui.paused, flash, weather, ui.target),
        weather,
      });
      frameCtx.state.flush();
      // Last, so the mix is written from the frame that just ran rather than the one before it:
      // `getState` already carries the patch above, and a paused frame never reaches this line
      // because the loop itself stopped — which is why the pause hold is an intent, not a frame.
      audio.update(frameCtx.state.getState());
    };
  }

  /** The scene is leaving: both passes were built here, so both are released here. */
  override exit(): void {
    this.#rain?.dispose();
    this.#post?.dispose();
    this.#rain = undefined;
    this.#post = undefined;
  }
}

/** Derived from the frame that just ran, so the label cannot describe a frame that is over. */
function statusOf(paused: boolean, flash: number, weather: Weather, target: Weather): SimStatus {
  if (paused) return "paused";
  if (flash > 0.003) return "flashing";
  return settled(weather, target) ? "steady" : "settling";
}

function settled(current: Weather, target: Weather): boolean {
  return WEATHER_KEYS.every((key) => Math.abs(current[key] - target[key]) < SETTLED);
}
