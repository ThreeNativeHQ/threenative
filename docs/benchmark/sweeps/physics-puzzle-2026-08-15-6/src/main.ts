import { installThreePlaytestBridge } from "@threenative/playtest/three";
import type { JsonValue } from "@threenative/playtest";
import { Game } from "./game.js";
import { FIXED_STEP } from "./level.js";
import { initPhysics } from "./sim.js";

/** Ticks the render loop may catch up by in one frame before it gives up and drops time. */
const MAX_CATCHUP_TICKS = 5;
const DIAGNOSTICS_LIMIT = 32;
const FRAME_SAMPLE_LIMIT = 120;

async function boot(): Promise<void> {
  const host = document.querySelector<HTMLElement>("#app");
  if (host === null) throw new Error("#app host element is missing from index.html.");

  await initPhysics();
  const game = new Game(host);

  // Runtime faults are collected rather than swallowed: an empty diagnostics list has to mean
  // nothing went wrong, not that nobody was listening.
  const diagnostics: JsonValue[] = [];
  const recordFault = (message: string): void => {
    if (diagnostics.length < DIAGNOSTICS_LIMIT) diagnostics.push(message);
  };
  globalThis.addEventListener("error", (event) => recordFault(`error: ${event.message}`));
  globalThis.addEventListener("unhandledrejection", (event) =>
    recordFault(`unhandledrejection: ${String(event.reason)}`),
  );

  const frames: { drawCalls: number; frameMs: number; triangles: number }[] = [];

  installThreePlaytestBridge({
    camera: game.view.camera,
    diagnostics: () => [...diagnostics],
    entities: () => [
      { id: "player", object: game.view.character.root },
      { id: "goal", object: game.view.goal },
      ...game.view.ghosts.map((object, index) => ({ id: `ghost.${index}`, object })),
      ...game.view.crates.map((object, index) => ({ id: `crate.${index}`, object })),
    ],
    fixedStep: (ticks) => {
      for (let index = 0; index < ticks; index += 1) game.step();
      game.sync();
      game.publish();
    },
    gameplay: () => ({
      animation: { player: game.animationClip() },
      contacts: game.contacts.map((contact) => ({ ...contact })),
      states: { mission: game.missionState(), player: game.playerState() },
      tags: {
        crate: { count: game.state().crateCount },
        ghost: { count: game.state().ghostCount },
        settled: { count: game.state().settledCrates },
      },
      world: {
        runtime: {
          agent: "threenative-r8-vanilla",
          core: "three",
          randomState: game.randomState,
          rapier: "0.20.0",
          step: FIXED_STEP,
        },
        seed: game.seed,
      },
    }),
    gameplayChannels: () => ["runtime.contacts", "runtime.tags", "runtime.world"],
    physics: {
      bodies: () =>
        game.poses().map((pose) => ({
          id: pose.id,
          position: pose.position,
          sleeping: pose.sleeping,
        })),
    },
    renderer: game.view.renderer,
    resources: { read: () => ({ state: gameStateResource(game) }) },
    runtimeDiagnosticsSeries: () => frames.map((sample) => ({ ...sample })),
    scene: game.view.scene,
    tick: () => game.tick,
  });

  let previous = performance.now();
  let accumulator = 0;

  const frame = (now: number): void => {
    const frameStart = now;
    accumulator += Math.min((now - previous) / 1000, 0.25);
    previous = now;

    let ticks = 0;
    while (accumulator >= FIXED_STEP && ticks < MAX_CATCHUP_TICKS) {
      game.step();
      accumulator -= FIXED_STEP;
      ticks += 1;
    }

    game.sync();
    game.render();
    game.publish();

    const info = game.view.renderer.info.render;
    frames.push({
      drawCalls: info.calls,
      frameMs: performance.now() - frameStart,
      triangles: info.triangles,
    });
    if (frames.length > FRAME_SAMPLE_LIMIT) frames.shift();

    globalThis.requestAnimationFrame(frame);
  };

  globalThis.requestAnimationFrame(frame);
}

/** The resource the harness reads. Also mirrored one level down, since callers disagree on
 * whether the path into resource `state` is `replayPhase` or `state.replayPhase`. */
function gameStateResource(game: Game): JsonValue {
  const state = game.state() as unknown as Record<string, JsonValue>;
  return { ...state, state: { ...state } };
}

void boot();
