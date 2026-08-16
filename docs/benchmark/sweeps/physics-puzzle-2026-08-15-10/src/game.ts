import { installHud, type IHud } from "./hud.js";
import { installInput, type IInputSource } from "./input.js";
import { CRATE_COUNT, PLAYER, WORLD_SEED } from "./level.js";
import { runDeterminismCheck, type ReplayPhase } from "./replay.js";
import { Simulation, type IBodyPose, type IContactRecord } from "./sim.js";
import type { IGameState, MissionState, PlayerState } from "./state.js";
import { buildView, type IView } from "./render/scene.js";

/** How much recorded input the determinism check will replay. */
const INPUT_LOG_LIMIT = 3600;
/** Feet-to-capsule-centre offset, so the rig stands in its collider rather than in the floor. */
const FOOT_OFFSET = PLAYER.halfHeight + PLAYER.radius;

export class Game {
  readonly seed = WORLD_SEED;
  readonly view: IView;

  #animationFrames = 0;
  #hud: IHud;
  #input: IInputSource;
  #inputLog: number[] = [];
  #replayHashA: number | null = null;
  #replayHashB: number | null = null;
  #replayMatch = false;
  #replayPhase: ReplayPhase = "idle";
  #replayTicks = 0;
  #simulation: Simulation;
  #stateNode: HTMLElement;
  #walkPhase = 0;

  constructor(host: HTMLElement) {
    this.#simulation = new Simulation(this.seed);
    this.view = buildView(host, this.#simulation.layout);
    this.#hud = installHud(host);
    this.#input = installInput(globalThis);
    this.#stateNode = document.createElement("script");
    this.#stateNode.id = "game-state";
    this.#stateNode.setAttribute("type", "application/json");
    host.appendChild(this.#stateNode);
    this.sync();
  }

  get contacts(): readonly IContactRecord[] {
    return this.#simulation.contacts;
  }

  get randomState(): number {
    return this.#simulation.randomState;
  }

  get tick(): number {
    return this.#simulation.tick;
  }

  /** Advances exactly one fixed step. Every path into the simulation goes through here. */
  step(): void {
    if (this.#input.consumeReplayRequest()) this.#runReplayCheck();

    const mask = this.#input.mask;
    if (this.#inputLog.length < INPUT_LOG_LIMIT) this.#inputLog.push(mask);
    this.#simulation.step(mask);

    const snapshot = this.#simulation.snapshot();
    if (snapshot.walking) {
      this.#walkPhase += 0.28;
      this.#animationFrames += 1;
    }
  }

  /** Pushes the simulated poses onto the scene graph and draws. */
  sync(): void {
    const poses = this.#simulation.poses();
    const player = poses[0];
    if (player !== undefined) {
      const root = this.view.character.root;
      root.position.set(player.position[0], player.position[1] - FOOT_OFFSET, player.position[2]);
      root.quaternion.fromArray(player.quaternion);
    }
    for (let index = 0; index < this.view.crates.length; index += 1) {
      const pose = poses[index + 1];
      const mesh = this.view.crates[index];
      if (pose === undefined || mesh === undefined) continue;
      mesh.position.fromArray(pose.position);
      mesh.quaternion.fromArray(pose.quaternion);
    }

    const snapshot = this.#simulation.snapshot();
    const { leftArm, leftLeg, rightArm, rightLeg } = this.view.character;
    const swing = snapshot.walking ? Math.sin(this.#walkPhase) * 0.75 : 0;
    leftLeg.rotation.x = swing;
    rightLeg.rotation.x = -swing;
    leftArm.rotation.x = snapshot.pushing ? -1.15 : -swing * 0.8;
    rightArm.rotation.x = snapshot.pushing ? -1.15 : swing * 0.8;
    this.view.character.torso.rotation.x = snapshot.pushing ? 0.24 : snapshot.walking ? 0.14 : 0;

    this.view.setWon(snapshot.won);
  }

  render(): void {
    this.view.renderer.render(this.view.scene, this.view.camera);
  }

  /** HUD and the DOM state mirror. Cheap enough to run every frame, not every tick. */
  publish(): void {
    const state = this.state();
    this.#hud.update(state);
    this.#stateNode.textContent = JSON.stringify(state);
  }

  poses(): readonly IBodyPose[] {
    return this.#simulation.poses();
  }

  animationClip(): { advancedFrames: number; clip: string } {
    return {
      advancedFrames: this.#animationFrames,
      clip: this.#simulation.snapshot().walking ? "walk" : "idle",
    };
  }

  playerState(): PlayerState {
    const snapshot = this.#simulation.snapshot();
    if (snapshot.pushing) return "pushing";
    return snapshot.walking ? "walking" : "idle";
  }

  missionState(): MissionState {
    return this.#simulation.won ? "won" : "playing";
  }

  state(): IGameState {
    const snapshot = this.#simulation.snapshot();
    return {
      awakeCrates: snapshot.awakeCrates,
      crateCollisions: snapshot.crateCollisions,
      crateCount: CRATE_COUNT,
      crateGoalHits: snapshot.crateGoalHits,
      ghostCount: this.#simulation.layout.ghosts.length,
      ghostPasses: snapshot.ghostPasses,
      mission: this.missionState(),
      playerGoalHits: snapshot.playerGoalHits,
      playerState: this.playerState(),
      playerX: round(snapshot.playerPose.position[0]),
      playerY: round(snapshot.playerPose.position[1]),
      playerZ: round(snapshot.playerPose.position[2]),
      pushEvents: snapshot.pushEvents,
      replayHashA: this.#replayHashA,
      replayHashB: this.#replayHashB,
      replayMatch: this.#replayMatch,
      replayPhase: this.#replayPhase,
      replayTicks: this.#replayTicks,
      seed: this.seed,
      settledCrates: snapshot.settledCrates,
      tick: snapshot.tick,
      won: snapshot.won,
    };
  }

  /**
   * Replays the recorded input twice against two fresh worlds and reports whether they agreed.
   * Synchronous on purpose: one keypress, one answer, no window where the reported phase lies.
   */
  #runReplayCheck(): void {
    this.#replayPhase = "running";
    this.publish();
    const result = runDeterminismCheck(this.seed, this.#inputLog);
    this.#replayHashA = result.hashA;
    this.#replayHashB = result.hashB;
    this.#replayMatch = result.match;
    this.#replayTicks = result.ticks;
    this.#replayPhase = "complete";
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
