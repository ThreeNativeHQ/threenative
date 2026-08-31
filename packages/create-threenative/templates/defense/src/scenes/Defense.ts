import { type ICtx, Scene, type SceneFrame, isMobile } from "@threenative/core";
import { type Object3D, type PerspectiveCamera, Vector3 } from "three";
import { Attacker } from "../attackers/Attacker.js";
import { ROUTE_TEST_SLOT, RouteBoard, SAFE_BUILD_SLOTS } from "../board/Route.js";
import { Economy, TOWER_COST } from "../economy.js";
import { Player } from "../entities/Player.js";
import { type DefensePhysics, directSpaceState } from "../physics.js";
import { Buildable, type PlacementReason } from "../placement/Buildable.js";
import { setupCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { setupPost } from "../render/postprocessing.js";
import { buildTiles, setTileHighlighted } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import { type GameState, INITIAL_STATE, MAX_LEAKS, registerLeak } from "../state.js";
import { Tower } from "../towers/Tower.js";
import { WaveSchedule } from "../waves.js";

export type GameCtx = ICtx<GameState, DefensePhysics>;

const SAFE_BUILD_HEIGHT = 0;
const EMPTY_POSITION = new Vector3();

export class Defense extends Scene<GameState, DefensePhysics> {
  static override readonly initialState = INITIAL_STATE;

  override enter(ctx: GameCtx): SceneFrame<GameState, DefensePhysics> {
    setupSky(ctx.scene);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    // isMobile() arrives as an argument because src/render/ imports no framework package: the
    // platform decision is made here, in portable game code, exactly like createRandom.
    setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: sun, mobile: isMobile() });
    setupCamera(ctx.camera as PerspectiveCamera);
    const loading = createLoadingScreen(ctx);
    ctx.add(ctx.camera);
    const board = new RouteBoard(ctx);
    const buildSurface = buildTiles();
    ctx.add(buildSurface);
    const player = new Player(ctx);
    ctx.entities.add("player", player);
    const query = directSpaceState(ctx.physics);
    const buildable = new Buildable(query);
    const economy = new Economy();
    const attackers = new Map<string, Attacker>();
    const attackerPool: Attacker[] = [];
    const towers = new Map<string, Tower>();
    const removeAttackers = new Set<string>();
    let safeSlot = 0;
    let lastPlaced: Vector3 | undefined;
    let defeated = 0;
    let leaks = 0;
    let status = INITIAL_STATE.status;
    let routeRejects = 0;
    let overlapRejects = 0;
    let scanWindowFrames = 0;
    let scanWindowScans = 0;
    let scanWindowValid = false;
    let hoveredTile: Object3D | undefined;
    let placedTile: string | undefined;
    const setHoveredTile = (tile: Object3D | undefined): void => {
      if (hoveredTile === tile) return;
      if (hoveredTile !== undefined) setTileHighlighted(hoveredTile, false);
      hoveredTile = tile;
      if (hoveredTile !== undefined) setTileHighlighted(hoveredTile, true);
    };
    ctx.pointer?.on(buildSurface, "pointerEntered", (event) => setHoveredTile(event.object));
    ctx.pointer?.on(buildSurface, "pointerExited", (event) => {
      if (event.object === hoveredTile) setHoveredTile(undefined);
    });
    const place = (position: Vector3): void => {
      const result = buildable.validate(position);
      if (!result.accepted) {
        recordRejected(result.reason);
        return;
      }
      if (!economy.spend(TOWER_COST)) return;
      buildable.commit(position);
      const id = String(towers.size);
      const tower = new Tower({
        id,
        physics: ctx.physics,
        position,
        query,
        random: ctx.random,
        targets: attackers,
      });
      towers.set(id, tower);
      ctx.entities.add(`tower.${id}`, tower);
      lastPlaced = position.clone();
    };
    ctx.pointer?.on(buildSurface, "tapped", (event) => {
      const towerCount = towers.size;
      place(event.point.clone().setY(SAFE_BUILD_HEIGHT));
      if (towers.size > towerCount) placedTile = event.object.name;
    });
    ctx.entities.add("build-preview", {
      debug: () => ({
        hovered: hoveredTile !== undefined,
        placedTile: placedTile ?? "",
        position: hoveredTile?.position.toArray() ?? [],
        tile: hoveredTile?.name ?? "",
      }),
    });
    const spawn = (wave: number, member: number): void => {
      const id = `attacker.${wave}.${member}`;
      let attacker: Attacker | undefined;
      for (const candidate of attackerPool) {
        if (!candidate.dead && !candidate.escaped) continue;
        attacker = candidate;
        break;
      }
      if (attacker === undefined) {
        const entityId = `attacker.pool.${attackerPool.length}`;
        const created = new Attacker({
          id: entityId,
          lateralOffset: member === 0 ? -0.17 : 0.17,
          onDefeated: () => {
            defeated += 1;
            removeAttackers.add(entityId);
          },
          onLeak: () => {
            leaks = registerLeak(leaks).leaks;
            removeAttackers.add(entityId);
            if (leaks >= MAX_LEAKS) status = "LOST";
          },
          pathPoints: board.points,
          physics: ctx.physics,
        });
        attacker = created;
        attackerPool.push(attacker);
        ctx.entities.add(entityId, attacker);
      }
      attacker.reset(id, member === 0 ? -0.17 : 0.17);
      attackers.set(attacker.entityId, attacker);
    };
    const waves = new WaveSchedule({
      onSpawn: spawn,
      onWin: () => {
        if (leaks < MAX_LEAKS) status = "WON";
      },
    });
    const recordRejected = (reason: PlacementReason): void => {
      if (reason === "route") routeRejects += 1;
      if (reason === "overlap") overlapRejects += 1;
    };
    const state: GameState = { ...INITIAL_STATE };
    return (frameCtx, dt) => {
      loading.update();
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(INITIAL_STATE);
        frameCtx.state.flush();
        void frameCtx.goto("defense");
        return;
      }
      if (status === "PLAYING") {
        player.update(frameCtx, dt);
        economy.update(dt);
        if (frameCtx.input.justPressed("safeBuild")) {
          const slot = SAFE_BUILD_SLOTS[safeSlot % SAFE_BUILD_SLOTS.length];
          safeSlot += 1;
          if (slot !== undefined) place(slot);
        }
        if (frameCtx.input.justPressed("routeTest")) place(ROUTE_TEST_SLOT);
        if (frameCtx.input.justPressed("overlapTest"))
          place(lastPlaced ?? SAFE_BUILD_SLOTS[0] ?? EMPTY_POSITION);
        for (const attacker of attackers.values()) attacker.update(dt);
        for (const tower of towers.values()) tower.update(dt);
        for (const id of removeAttackers) {
          attackers.delete(id);
        }
        removeAttackers.clear();
        waves.update(dt, attackers.size);
      }
      let scanCount = 0;
      let shots = 0;
      for (const tower of towers.values()) {
        scanCount += tower.scanCount;
        shots += tower.shots;
      }
      if (scanWindowFrames < 300) {
        scanWindowFrames += 1;
        if (scanWindowFrames === 300) {
          scanWindowScans = scanCount;
          scanWindowValid = towers.size > 0 && scanCount >= 10 && scanCount <= 40 * towers.size;
        }
      }
      const previous = frameCtx.state.getState();
      state.balance = economy.balance;
      state.defeated = defeated;
      state.income = economy.income;
      state.leaks = leaks;
      state.overlapRejects = overlapRejects;
      state.placementRejects = routeRejects + overlapRejects;
      state.routeRejects = routeRejects;
      state.scanCount = scanCount;
      state.scanWindowFrames = scanWindowFrames;
      state.scanWindowScans = scanWindowScans;
      state.scanWindowValid = scanWindowValid;
      state.shots = shots;
      state.spent = economy.spent;
      state.status = status;
      state.towers = towers.size;
      state.wave = waves.spawned;
      const changed =
        state.balance !== previous.balance ||
        state.defeated !== previous.defeated ||
        state.income !== previous.income ||
        state.leaks !== previous.leaks ||
        state.overlapRejects !== previous.overlapRejects ||
        state.placementRejects !== previous.placementRejects ||
        state.routeRejects !== previous.routeRejects ||
        state.scanCount !== previous.scanCount ||
        state.scanWindowFrames !== previous.scanWindowFrames ||
        state.scanWindowScans !== previous.scanWindowScans ||
        state.scanWindowValid !== previous.scanWindowValid ||
        state.shots !== previous.shots ||
        state.spent !== previous.spent ||
        state.status !== previous.status ||
        state.towers !== previous.towers ||
        state.wave !== previous.wave;
      if (changed) frameCtx.state.set(state);
    };
  }
}
