import {
  GPUParticles3D,
  InstancedBatch,
  type ICtx,
  Scene,
  type SceneFrame,
  isMobile,
  isTouchscreenAvailable,
  mergeByMaterial,
} from "@threenative/core";
import { MathUtils, type Object3D, type PerspectiveCamera, Vector3 } from "three";
import { Adventure, type IEvent, type IInput } from "../logic/adventure.js";
import { KEEPER, SIGIL_SITES } from "../logic/layout.js";
import type { SigilId } from "../logic/quest.js";
import { onSceneIntent } from "../orders.js";
import { DEFAULT_ORBIT, ORBIT_LIMITS, createCameraRig, type IOrbit } from "../render/camera.js";
import { createCharacter } from "../render/character.js";
import { createFairy } from "../render/fairy.js";
import { createForest } from "../render/forest.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { clock, createForestMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { createProps } from "../render/props.js";
import { setupSky } from "../render/sky.js";
import type { IRenderTools } from "../render/tools.js";
import { TouchControls } from "../render/touch-controls.js";
import {
  createAttackArc,
  createFallingLeaves,
  createGemGlint,
  createHitBurst,
  createMotes,
  createPotBurst,
  createSigilBurst,
} from "../render/vfx.js";
import { clearSave, loadSave, writeSave } from "../save.js";
import { type GameState, INITIAL_STATE } from "../state.js";

export type GameCtx = ICtx<GameState, undefined>;

/** Radians of orbit per pixel of mouse or finger travel. */
const LOOK = { pitch: 0.0035, yaw: 0.0045 } as const;
/** Metres of camera boom per unit of zoom intent. */
const ZOOM = 0.9;
const SAVE_EVERY = 4;

const angleLerp = (a: number, b: number, t: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const round = (value: number, scale = 100): number => Math.round(value * scale) / scale;

export class Play extends Scene<GameState, undefined> {
  static override readonly initialState: GameState = INITIAL_STATE;

  #sky: Parameters<typeof setupSky>[1] | undefined;
  #dispose: (() => void) | undefined;

  override async load(ctx: GameCtx): Promise<void> {
    this.#sky = await ctx.assets.texture("sky.jpg");
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, undefined> {
    if (this.#sky === undefined) throw new Error("Play.enter ran before load() loaded sky.jpg.");
    const camera = ctx.camera as PerspectiveCamera;
    const mobile = isMobile();
    // Two engine helpers, handed to src/render/ because that folder imports no framework package.
    const tools: IRenderTools = {
      batch: (geometry, material) => new InstancedBatch({ geometry, material }),
      merge: (root: Object3D, label: string) => mergeByMaterial(root, { label }),
    };

    const sim = new Adventure({ save: loadSave() });
    setupSky(ctx.scene, this.#sky);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1], mobile);
    // The godrays stage raymarches the sun's shadow map, which exists only once the world has been
    // drawn: `beforeRender` fires per real world draw (a loader-only hold has none), so the chain is
    // built on the third one.
    let drawn = 0;
    const stop = ctx.beforeRender(() => {
      drawn += 1;
      if (drawn < 3) return;
      stop();
      setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: sun.key, mobile });
    });
    const loading = createLoadingScreen(ctx);

    const materials = createForestMaterials();
    const forest = createForest(tools, materials, sim.layout, { mobile });
    const props = createProps(tools, materials);
    const hero = createCharacter(tools, "hero");
    const fairy = createFairy();
    ctx.add(forest.root);
    ctx.add(props.root);
    ctx.add(hero.group);
    ctx.add(fairy.group);

    // Effects: one pooled emitter per look, re-fired from the real event that caused it.
    const burst = (make: ConstructorParameters<typeof GPUParticles3D>[0], seconds: number) => {
      const emitter = ctx.add(new GPUParticles3D(make));
      emitter.visible = false;
      let token = 0;
      return (x: number, y: number, z: number): void => {
        emitter.position.set(x, y, z);
        emitter.visible = true;
        emitter.restart();
        token += 1;
        const mine = token;
        ctx.after(seconds, () => {
          if (mine === token) emitter.visible = false;
        });
      };
    };
    const fx = {
      arc: burst(createAttackArc(), 0.3),
      gem: burst(createGemGlint(), 0.7),
      hit: burst(createHitBurst(), 0.7),
      pot: burst(createPotBurst(), 1),
      sigil: burst(createSigilBurst(), 1.8),
    };
    ctx.add(new GPUParticles3D(createMotes())).position.set(0, 4.5, -8);
    ctx.add(new GPUParticles3D(createFallingLeaves())).position.set(0, 13, -8);

    const touch = mobile && isTouchscreenAvailable() ? ctx.entities.add("touch-controls", new TouchControls(camera)) : undefined;
    const rig = createCameraRig(camera, sim.layout.trees);
    const orbit: IOrbit = { ...DEFAULT_ORBIT };
    rig.follow(sim.player, orbit, 0.1, 0, true);

    ctx.entities.add("player", hero.group);
    ctx.entities.add("keeper", props.keeper.group);
    ctx.entities.add("altar", props.altar.group);
    ctx.entities.add("chest", props.chest.group);
    props.briarlings.forEach((view, i) => ctx.entities.add(`briarling-${i}`, view.group));

    this.#dispose = () => {
      props.dispose();
      hero.dispose();
      fairy.dispose();
      materials.dispose();
    };

    let time = 0;
    let paused = false;
    let saveTimer = 0;
    let saveDirty = false;
    let saves = 0;
    let toastId = 0;
    let toast = "";
    let hurtId = 0;
    let cinematic = false;
    let lastStage = sim.save.stage;
    let lastSigils = -1;
    let mapMarks: number[] = [];
    const tint = new Vector3();
    const patch: Partial<GameState> = {};

    onSceneIntent((intent) => {
      if (intent === "pause") paused = true;
      else if (intent === "resume") paused = false;
      else if (intent === "continue") sim.advanceDialog();
      else if (intent === "stay") {
        sim.victory = false;
        sim.toast("Take the long way home.", 3);
      } else if (intent === "newGame") {
        clearSave();
        sim.reset();
        Object.assign(orbit, DEFAULT_ORBIT);
        rig.follow(sim.player, orbit, 0.1, time, true);
        paused = false;
        lastSigils = -1;
        saveDirty = true;
      }
    });

    const react = (event: IEvent): void => {
      switch (event.kind) {
        case "attack": {
          const p = sim.player;
          fx.arc(p.x + Math.sin(p.angle) * 0.9, p.y + 0.85, p.z + Math.cos(p.angle) * 0.9);
          break;
        }
        case "enemyHit":
          fx.hit(event.x, event.y, event.z);
          rig.shake(0.035);
          break;
        case "enemyDown":
          fx.sigil(event.x, event.y, event.z);
          break;
        case "block":
          fx.hit(event.x, event.y, event.z);
          break;
        case "hurt":
          fx.hit(event.x, event.y, event.z);
          rig.shake(0.14);
          hurtId += 1;
          saveDirty = true;
          break;
        case "potBreak":
          fx.pot(event.x, event.y, event.z);
          break;
        case "gem":
          fx.gem(event.x, event.y, event.z);
          saveDirty = true;
          break;
        case "sigil":
        case "chest":
        case "altar":
          fx.sigil(event.x, event.y, event.z);
          saveDirty = true;
          break;
        case "toast":
          toast = event.text;
          toastId += 1;
          break;
        case "dead":
        case "respawn":
          saveDirty = true;
          break;
        default:
          break;
      }
    };

    const input: IInput = { attack: false, block: false, dodge: false, forward: 0, interact: false, lock: false, right: 0, sprint: false, yaw: 0 };
    const readInput = (frameCtx: GameCtx): void => {
      const move = frameCtx.input.vector("move");
      const t = touch?.update(frameCtx.input.raw.pointers, frameCtx.viewport.size);
      const look = frameCtx.input.vector("look");
      if (frameCtx.input.justPressed("pause")) paused = !paused;
      if (frameCtx.input.justPressed("hideUi")) cinematic = !cinematic;
      if (frameCtx.input.justPressed("recenter")) {
        orbit.yaw = sim.player.angle - Math.PI;
        orbit.pitch = DEFAULT_ORBIT.pitch;
        orbit.distance = DEFAULT_ORBIT.distance;
      }
      let dx = look.x;
      let dy = look.y;
      if (t !== undefined) {
        dx += t.look.x;
        dy += t.look.y;
        move.x += t.move.x;
        move.y += t.move.y;
        move.clampLength(0, 1);
      }
      if (dx !== 0 || dy !== 0) {
        orbit.yaw -= dx * LOOK.yaw;
        orbit.pitch = MathUtils.clamp(orbit.pitch + dy * LOOK.pitch, ORBIT_LIMITS.pitch[0], ORBIT_LIMITS.pitch[1]);
        sim.lock = undefined;
      }
      orbit.distance = MathUtils.clamp(orbit.distance - frameCtx.input.axis("zoom") * ZOOM, ORBIT_LIMITS.distance[0], ORBIT_LIMITS.distance[1]);
      input.right = move.x;
      input.forward = move.y;
      input.yaw = orbit.yaw;
      input.sprint = frameCtx.input.pressed("sprint");
      input.block = frameCtx.input.pressed("block");
      input.attack = frameCtx.input.justPressed("attack") || t?.attackPressed === true;
      input.dodge = frameCtx.input.justPressed("dodge") || t?.rollPressed === true;
      input.interact = frameCtx.input.justPressed("interact") || t?.interactPressed === true;
      input.lock = frameCtx.input.justPressed("lockOn");
    };

    return (frameCtx, dt) => {
      loading.update();
      readInput(frameCtx);
      time += dt;
      clock.value = time;
      if (!paused) {
        sim.update(dt, input);
        for (const event of sim.events) react(event);
        sim.events.length = 0;
      }
      const p = sim.player;
      const lock = sim.lock;
      if (lock !== undefined && !lock.dead && !paused) orbit.yaw = angleLerp(orbit.yaw, p.angle - Math.PI, 1 - Math.exp(-dt * 3));

      // --- pose everything from the rules ---------------------------------------------------------------------
      hero.group.position.set(p.x, p.y, p.z);
      hero.group.rotation.y = p.angle;
      hero.group.visible = p.invuln <= 0 || Math.floor(time * 15) % 2 === 0 || p.roll > 0 || p.dead > 0;
      hero.update(p, time, dt);
      fairy.update(time, dt, p.x, p.y, p.z, orbit.yaw);
      forest.update(time);
      props.gems.sync(sim.gems, time);
      sim.pots.forEach((pot, i) => {
        const view = props.pots[i];
        if (view !== undefined) view.visible = !pot.broken;
      });
      for (const view of props.sigils) {
        const taken = sim.save.sigils.includes(view.id);
        view.group.visible = !taken;
        const i = props.sigils.indexOf(view);
        view.core.position.y = 1.05 + Math.sin(time * 1.6 + i) * 0.09;
        view.core.rotation.y = time * 0.65;
        view.ring.rotation.y = -time * 0.43;
      }
      const complete = sim.save.stage === "complete";
      props.altar.material.emissiveIntensity = complete ? 2.1 + Math.sin(time * 1.5) * 0.5 : sim.victory ? 2.8 : 0.3;
      (props.altar.beam.material as { opacity: number }).opacity = complete || sim.victory ? 0.45 + Math.sin(time) * 0.07 : 0;
      props.chest.lid.rotation.x = MathUtils.lerp(props.chest.lid.rotation.x, sim.chestOpened ? -1.5 : 0, 1 - Math.exp(-dt * 4));
      const near = Math.hypot(p.x - KEEPER.x, p.z - KEEPER.z) < 6;
      props.keeper.group.rotation.y = angleLerp(props.keeper.group.rotation.y, near ? Math.atan2(p.x - KEEPER.x, p.z - KEEPER.z) : -0.7, 1 - Math.exp(-dt * 3));
      props.keeper.update(p, time, dt);
      props.speech.visible = sim.save.stage === "meet";
      props.speech.position.y = 2.05 + Math.sin(time * 2) * 0.045;
      sim.enemies.forEach((e, i) => {
        const view = props.briarlings[i];
        if (view === undefined) return;
        view.group.visible = !e.dead;
        if (e.dead) return;
        const moving = e.mode === "chase" || e.mode === "return";
        view.group.position.set(e.x, e.y + (moving ? Math.abs(Math.sin(time * 8)) * 0.08 : Math.sin(time * 2 + e.homeX) * 0.015), e.z);
        const d = Math.hypot(p.x - e.x, p.z - e.z);
        if (d < 8 && e.mode !== "idle") view.group.rotation.y = angleLerp(view.group.rotation.y, Math.atan2(p.x - e.x, p.z - e.z), 1 - Math.exp(-dt * 8));
        view.group.rotation.z = moving ? Math.sin(time * 8) * 0.07 : 0;
        view.crown.scale.y = e.mode === "windup" ? 0.28 + Math.sin(time * 24) * 0.05 : 0.28;
        (view.crown.material as unknown as { emissive: { setHex: (hex: number) => void } }).emissive.setHex(e.mode === "windup" ? 0xa5512b : e.hit > 0 ? 0x8b6940 : 0);
        (view.trunk.material as unknown as { color: { setHex: (hex: number) => void } }).color.setHex(e.hit > 0 ? 0xe5cc9f : 0xa99f87);
      });
      sun.follow(p.x, p.z);
      rig.follow(p, orbit, dt, time);

      // --- save, then publish ------------------------------------------------------------------------------------------
      saveTimer += dt;
      if (saveDirty && saveTimer > SAVE_EVERY) {
        saveDirty = false;
        saveTimer = 0;
        if (writeSave(sim.save)) saves += 1;
      }
      if (sim.save.sigils.length !== lastSigils || sim.save.stage !== lastStage) {
        lastSigils = sim.save.sigils.length;
        lastStage = sim.save.stage;
        mapMarks = [];
        for (const id of Object.keys(SIGIL_SITES) as SigilId[])
          if (!sim.save.sigils.includes(id)) mapMarks.push(Math.round(SIGIL_SITES[id].x * 10), Math.round(SIGIL_SITES[id].z * 10), SIGIL_SITES[id].color);
        patch.mapMarks = mapMarks;
        patch.sigils = [...sim.save.sigils];
        patch.stage = sim.save.stage;
        saveDirty = true;
      }
      const talking = sim.dialog;
      const target = paused || talking !== undefined || sim.victory ? undefined : sim.interaction();
      if (lock !== undefined && !lock.dead) {
        tint.set(lock.x, lock.y + 1.2, lock.z).project(camera);
        patch.lockX = tint.z < 1 ? round(tint.x * 0.5 + 0.5, 1000) : -1;
        patch.lockY = tint.z < 1 ? round(-tint.y * 0.5 + 0.5, 1000) : -1;
        patch.lockHp = lock.hp;
      } else {
        patch.lockHp = 0;
        patch.lockX = -1;
        patch.lockY = -1;
      }
      patch.hp = sim.save.hp;
      patch.gems = sim.save.gems;
      patch.stamina = Math.round(p.stamina);
      patch.dialog = talking?.lines[talking.index] ?? "";
      patch.dialogMore = talking !== undefined && talking.index < talking.lines.length - 1;
      patch.prompt = target?.label ?? "";
      patch.toast = toast;
      patch.toastId = toastId;
      patch.victory = sim.victory;
      patch.dead = p.dead > 0;
      patch.hurtId = hurtId;
      patch.paused = paused;
      patch.cinematic = cinematic;
      patch.playerX = round(p.x);
      patch.playerY = round(p.y);
      patch.playerZ = round(p.z);
      patch.playerAngle = round(p.angle);
      patch.kills = sim.stats.kills;
      patch.attacks = sim.stats.attacks;
      patch.rolls = sim.stats.rolls;
      patch.damageTaken = sim.stats.damageTaken;
      patch.enemies = sim.enemies.reduce((n, e) => n + (e.dead ? 0 : 1), 0);
      patch.clock = Math.floor(time);
      patch.saves = saves;
      frameCtx.state.set(patch);
    };
  }

  override exit(ctx: GameCtx): void {
    onSceneIntent(() => undefined);
    this.#dispose?.();
    this.#dispose = undefined;
    super.exit(ctx);
  }
}
