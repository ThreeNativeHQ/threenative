import {
  GPUParticles3D,
  type ICtx,
  Scene,
  type SceneFrame,
  isMobile,
  isTouchscreenAvailable,
} from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { type Object3D, type PerspectiveCamera, Vector3 } from "three";
import { Ability } from "../abilities/Ability.js";
import { Enemy } from "../entities/Enemy.js";
import { HOSTILE_LAYER, PLAYER_LAYER, Player, WORLD_LAYER } from "../entities/Player.js";
import { ITEMS, Inventory, type ItemId, type ItemStack } from "../items/Inventory.js";
import { describeDrops, rollDrops } from "../loot/drops.js";
import { directSpaceState } from "../physics.js";
import { emitPlaytestEvent } from "../playtest-events.js";
import { loadProgress, saveProgress } from "../progress.js";
import { createDungeonCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { createDungeon, createLootVisual } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import { TouchControls } from "../render/touch-controls.js";
import { createArcaneSurge, createAttackArc, createHitBurst } from "../render/vfx.js";
import type { GameState } from "../state.js";
import { StatBlock } from "../stats/StatBlock.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const SPAWN = new Vector3(-8, 0.78, 0);
const ATTACK_SHAPE = CollisionShape3D.sphere(2.2);
const DROP_SEED = 93_093;

function roomFor(x: number): number {
  return Math.min(3, Math.max(1, Math.floor((x + 12) / 12) + 1));
}

function itemId(value: string): value is ItemId {
  return Object.values(ITEMS).some((item) => item.id === value);
}

function quantize(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    paused: false,
    uiReady: false,
    abilityCooldown: 0,
    abilityUses: 0,
    baseDamage: 12,
    damage: 12,
    damageHits: 0,
    deaths: 0,
    dropProof: 0,
    dropSequence: "",
    enemiesDefeated: 0,
    equippedItem: "",
    gameOver: 0,
    gameWon: 0,
    health: 100,
    inventory: [],
    inventoryFullRefused: 0,
    inventorySlots: [],
    lastDamage: 0,
    lastDrop: "",
    lineOfSightBlocked: 0,
    modifierActive: 0,
    pendingLoot: "",
    pendingLootItem: "",
    pendingLootQuantity: 0,
    phase: "playing",
    playerX: SPAWN.x,
    playerY: SPAWN.y,
    playerZ: SPAWN.z,
    room: 1,
    saveCount: 0,
    visibleEnemyAggro: 0,
    wallEnemyAggro: 0,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const restored = loadProgress(Play.initialState);
    ctx.state.set(restored);
    ctx.state.flush();

    const camera = ctx.camera as PerspectiveCamera;
    const materials = createMaterials();
    setupSky(ctx.scene);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    // isMobile() arrives as an argument because src/render/ imports no framework package: the
    // platform decision is made here, in portable game code, exactly like createRandom.
    setupPost(ctx.renderer, ctx.scene, camera, { godraysLight: sun, mobile: isMobile() });
    const loading = createLoadingScreen(ctx);
    ctx.add(camera);
    const cameraRig = createDungeonCamera(camera);
    ctx.viewport.resize();
    const showTouchControls = isMobile() && isTouchscreenAvailable();
    const touchControls = showTouchControls
      ? ctx.entities.add("touch-controls", new TouchControls(camera))
      : undefined;

    const dungeon = createDungeon(materials);
    ctx.add(dungeon.group);
    const fixed = (object: Object3D, shape: CollisionShape3D) =>
      new RigidBody3D({
        collisionLayer: WORLD_LAYER,
        collisionMask: PLAYER_LAYER | HOSTILE_LAYER,
        object,
        physics: ctx.physics,
        shape,
        type: "fixed",
      });
    fixed(dungeon.floor, CollisionShape3D.box(36, 0.3, 12));
    for (const [index, wall] of dungeon.walls.entries()) {
      fixed(
        wall,
        index < 2 ? CollisionShape3D.box(36, 2.8, 0.35) : CollisionShape3D.box(0.35, 2.8, 12),
      );
    }
    for (const pillar of dungeon.roomPillars) fixed(pillar, CollisionShape3D.box(0.7, 3.6, 1.2));
    fixed(dungeon.lineOfSightWall, CollisionShape3D.box(2.4, 2.1, 0.5));

    const inventory = new Inventory(6);
    const savedSlots = restored.inventorySlots.filter(
      (slot): slot is ItemStack =>
        itemId(slot.itemId) && Number.isInteger(slot.quantity) && slot.quantity > 0,
    );
    const savedEquipped = itemId(restored.equippedItem) ? restored.equippedItem : undefined;
    if (savedSlots.length > 0 || savedEquipped !== undefined) {
      inventory.restore(savedSlots, savedEquipped);
    } else {
      inventory.add("rusted-blade", 1);
      inventory.add("ember-blade", 1);
      inventory.add("potion", 2);
    }

    const playerRef: { value?: Player } = {};
    const player = new Player(
      ctx,
      materials,
      new Vector3(restored.playerX, restored.playerY, restored.playerZ),
      restored.health,
      (amount) => {
        const current = playerRef.value;
        ctx.state.set({ health: current?.health ?? 0, lastDamage: amount });
        emitPlaytestEvent({ amount, entity: "player", name: "damaged" });
      },
      () => {
        const state = ctx.state.getState();
        ctx.state.set({
          deaths: state.deaths + 1,
          gameOver: 1,
          health: 0,
          phase: "lost",
        });
        emitPlaytestEvent({ entity: "player", name: "died" });
      },
    );
    playerRef.value = player;
    player.equippedItem = inventory.equipped?.itemId ?? "";
    ctx.entities.add("player", player);

    const attackVfx = ctx.add(new GPUParticles3D(createAttackArc()));
    const hitVfx = ctx.add(new GPUParticles3D(createHitBurst()));
    const surgeVfx = ctx.add(new GPUParticles3D(createArcaneSurge()));
    attackVfx.visible = false;
    hitVfx.visible = false;
    surgeVfx.visible = false;
    const burst = (
      particles: GPUParticles3D,
      position: { readonly x: number; readonly y: number; readonly z: number },
      name: string,
    ): void => {
      particles.position.copy(position);
      particles.visible = true;
      particles.restart();
      ctx.after(0.45, () => {
        particles.visible = false;
      });
      emitPlaytestEvent({ entity: "player", name });
    };

    const enemies = new Map<number, Enemy>();
    const enemyIds = new Map<number, string>();
    const damageStats = new StatBlock(Play.initialState.baseDamage);
    let elapsed = 0;
    let saveRequested = false;
    let enemyIndex = 0;
    let currentRoom = roomFor(player.mesh.position.x);
    const pendingStacks: ItemStack[] = [];
    const pendingVisuals: Array<ReturnType<typeof createLootVisual>> = [];
    let lastDropSeed: number | undefined;

    const syncInventory = (): void => {
      const equipped = inventory.equipped?.itemId ?? "";
      ctx.state.set({
        equippedItem: equipped,
        inventory: inventory.labels(),
        inventorySlots: inventory.snapshot(),
      });
      player.equippedItem = equipped;
    };

    const syncPendingLoot = (): void => {
      const first = pendingStacks[0];
      ctx.state.set({
        pendingLoot: describeDrops(pendingStacks),
        pendingLootItem: first?.itemId ?? "",
        pendingLootQuantity: pendingStacks.reduce((total, stack) => total + stack.quantity, 0),
      });
    };

    const retainLoot = (stack: ItemStack): void => {
      const visual = createLootVisual(materials);
      visual.name = `pending-loot-${stack.itemId}`;
      visual.position
        .copy(player.mesh.position)
        .add(new Vector3(pendingVisuals.length * 0.8, 0, 1.2));
      ctx.add(visual);
      pendingStacks.push(stack);
      pendingVisuals.push(visual);
      syncPendingLoot();
    };

    const retainOrSwapPendingLoot = (
      index: number,
      stack: ItemStack,
      remainder: number,
    ): boolean => {
      const displaced = inventory.swapFirst({ itemId: stack.itemId, quantity: remainder });
      if (displaced === undefined) {
        pendingStacks[index] = { ...stack, quantity: remainder };
        return remainder !== stack.quantity;
      }
      pendingStacks[index] = displaced;
      const visual = pendingVisuals[index];
      if (visual !== undefined) visual.name = `pending-loot-${displaced.itemId}`;
      return true;
    };

    const collectPendingLoot = (): boolean => {
      let changed = false;
      for (let index = 0; index < pendingStacks.length; ) {
        const stack = pendingStacks[index];
        if (stack === undefined) break;
        const remainder = inventory.add(stack.itemId, stack.quantity);
        if (remainder > 0) {
          changed = retainOrSwapPendingLoot(index, stack, remainder) || changed;
          index += 1;
          continue;
        }
        pendingStacks.splice(index, 1);
        pendingVisuals[index]?.removeFromParent();
        pendingVisuals.splice(index, 1);
        changed = true;
      }
      if (changed) {
        syncInventory();
        syncPendingLoot();
      }
      return changed;
    };

    syncPendingLoot();

    const syncEquipmentStat = (): void => {
      damageStats.remove("equipment");
      const equipped = inventory.equipped?.itemId;
      const equippedDefinition =
        equipped === undefined
          ? undefined
          : Object.values(ITEMS).find((item) => item.id === equipped);
      const bonus =
        equippedDefinition !== undefined && "attackBonus" in equippedDefinition
          ? (equippedDefinition.attackBonus ?? 0)
          : 0;
      if (bonus !== 0) damageStats.apply({ add: bonus, source: "equipment" }, elapsed);
      syncInventory();
    };
    syncEquipmentStat();

    const onEnemyDeath = (enemy: Enemy): void => {
      const id = enemyIds.get(enemy.body.body.id);
      enemies.delete(enemy.body.body.id);
      enemyIds.delete(enemy.body.body.id);
      if (id !== undefined && ctx.entities.get(id) !== undefined) ctx.entities.remove(id);
      const seed = DROP_SEED + enemyIndex++;
      lastDropSeed = seed;
      const drops = rollDrops(seed);
      let refused = false;
      for (const drop of drops) {
        const remainder = inventory.add(drop.itemId, drop.quantity);
        if (remainder > 0) {
          refused = true;
          retainLoot({ itemId: drop.itemId, quantity: remainder });
        }
      }
      const state = ctx.state.getState();
      ctx.state.set({
        enemiesDefeated: state.enemiesDefeated + 1,
        inventoryFullRefused: refused ? 1 : state.inventoryFullRefused,
        lastDrop: describeDrops(drops),
      });
      syncInventory();
      emitPlaytestEvent({ entity: "enemy", name: "defeated" });
      if (enemy.boss) {
        ctx.state.set({ gameWon: 1, phase: "won" });
        saveRequested = true;
        emitPlaytestEvent({ entity: "boss", name: "defeated" });
      }
    };

    const addEnemy = (
      id: string,
      position: Vector3,
      options: { readonly boss?: boolean; readonly health?: number } = {},
    ): Enemy => {
      const enemy = new Enemy(ctx, materials, position, player.body.body, {
        ...options,
        onAttack: (amount) => player.takeDamage(amount),
        onDeath: onEnemyDeath,
      });
      enemies.set(enemy.body.body.id, enemy);
      enemyIds.set(enemy.body.body.id, id);
      ctx.entities.add(id, enemy);
      return enemy;
    };

    const visibleEnemy = addEnemy("enemy.visible", new Vector3(-6.3, 0.78, 0.8), { health: 60 });
    const wallEnemy = addEnemy("enemy.behind-wall", new Vector3(-8, 0.78, -3), { health: 30 });
    addEnemy("enemy.room-two", new Vector3(3, 0.78, 0), { health: 24 });
    addEnemy("enemy.room-three", new Vector3(11.5, 0.78, 0), { health: 30 });
    const boss = addEnemy("boss", new Vector3(16, 0.78, 0), { boss: true, health: 64 });

    const strike = (amount: number): void => {
      burst(attackVfx, player.attackOrigin(), "vfx-attack");
      const hits = directSpaceState(ctx.physics).intersectShape({
        collisionMask: HOSTILE_LAYER,
        maxResults: 16,
        position: player.attackOrigin(),
        shape: ATTACK_SHAPE,
      });
      let hitCount = 0;
      for (const hit of hits) {
        const enemy = enemies.get(hit.body.id);
        if (enemy === undefined) continue;
        enemy.takeDamage(amount);
        if (hit.position !== undefined) burst(hitVfx, hit.position, "vfx-hit");
        hitCount += 1;
      }
      const state = ctx.state.getState();
      ctx.state.set({
        damageHits: state.damageHits + hitCount,
        lastDamage: Math.round(amount),
      });
      emitPlaytestEvent({ amount: Math.round(amount), entity: "player", name: "attack" });
    };

    const ability = new Ability({
      cooldown: 3,
      duration: 1,
      onExpire: () => {
        damageStats.expire(elapsed);
        ctx.state.set({ modifierActive: 0 });
        emitPlaytestEvent({ entity: "player", name: "ability-expired" });
      },
      onStart: () => {
        burst(surgeVfx, player.mesh.position, "vfx-surge");
        damageStats.apply({ add: 6, duration: 1, source: "arcane-surge" }, elapsed);
        ctx.state.set({ abilityUses: ctx.state.getState().abilityUses + 1, modifierActive: 1 });
        strike(20);
        emitPlaytestEvent({ entity: "player", name: "ability" });
      },
    });

    const fillInventory = (): void => {
      inventory.fill("potion");
      syncInventory();
      ctx.state.set({ inventoryFullRefused: pendingStacks.length > 0 ? 1 : 0 });
    };
    const tryFullLoot = (): void => {
      if (pendingStacks.length > 0) {
        const collected = collectPendingLoot();
        ctx.state.set({ inventoryFullRefused: pendingStacks.length > 0 ? 1 : 0 });
        emitPlaytestEvent({
          entity: "loot",
          name: collected ? "loot-collected" : "loot-refused",
        });
        return;
      }
      const remainder = inventory.add("ember-blade", 1);
      const state = ctx.state.getState();
      if (remainder > 0) retainLoot({ itemId: "ember-blade", quantity: remainder });
      ctx.state.set({
        inventoryFullRefused: remainder > 0 ? 1 : state.inventoryFullRefused,
      });
      syncInventory();
      emitPlaytestEvent({
        entity: "player",
        name: remainder > 0 ? "loot-refused" : "loot-added",
      });
    };
    const proveDrops = (): void => {
      const expected = describeDrops(rollDrops(DROP_SEED));
      const before = ctx.state.getState().enemiesDefeated;
      if (visibleEnemy.alive) visibleEnemy.takeDamage(visibleEnemy.health);
      const actual = ctx.state.getState();
      ctx.state.set({
        dropProof:
          actual.enemiesDefeated > before &&
          lastDropSeed === DROP_SEED &&
          actual.lastDrop === expected
            ? 1
            : 0,
        dropSequence: actual.lastDrop,
      });
      emitPlaytestEvent({ entity: "loot", name: "seeded" });
    };

    cameraRig.snap(player.mesh.position);
    let lastSavedRoom = currentRoom;
    const frameState: Partial<GameState> = {};
    return (frameCtx, dt) => {
      loading.update();
      elapsed += dt;
      if (frameCtx.input.justPressed("restart")) {
        void frameCtx.goto("play");
        return;
      }
      if (frameCtx.input.justPressed("lethal")) player.takeDamage(player.health + 1);
      if (frameCtx.input.justPressed("damage")) player.takeDamage(18);
      const touch = touchControls?.update(frameCtx.input.raw.pointers, frameCtx.viewport.size);
      if (frameCtx.input.justPressed("attack") || touch?.attackPressed === true)
        strike(Math.round(damageStats.value(elapsed)));
      if (frameCtx.input.justPressed("ability") || touch?.abilityPressed === true) ability.cast();
      if (frameCtx.input.justPressed("equip")) {
        if (inventory.equip("ember-blade")) {
          syncEquipmentStat();
          saveRequested = true;
          emitPlaytestEvent({ entity: "player", name: "equipped" });
        }
      }
      if (frameCtx.input.justPressed("unequip")) {
        if (inventory.unequip()) {
          syncEquipmentStat();
          saveRequested = true;
          emitPlaytestEvent({ entity: "player", name: "unequipped" });
        }
      }
      if (frameCtx.input.justPressed("fill")) fillInventory();
      if (frameCtx.input.justPressed("loot")) tryFullLoot();
      if (frameCtx.input.justPressed("dropProbe")) proveDrops();
      if (frameCtx.input.justPressed("save")) saveRequested = true;

      player.update(frameCtx, dt, touch);
      ability.update(dt);
      // Enemies act only once first-use compilation has settled. They damage the player, and the
      // combat scenario asserts an exact health at a labelled step — so stepping them during the
      // launch makes that number a function of how long the launch took. Measured as 90 on a
      // software rasteriser against 95 on a real GPU from the same build, which is the comment
      // core carries in playtest.ts for the same reason.
      if (frameCtx.startup.compileSettled) {
        for (const enemy of enemies.values()) enemy.update(frameCtx, dt, player.mesh.position);
      }

      currentRoom = roomFor(player.mesh.position.x);
      const previous = frameCtx.state.getState();
      frameState.abilityCooldown = quantize(ability.cooldownRemaining, 1000);
      frameState.baseDamage = damageStats.base;
      frameState.damage = Math.round(damageStats.value(elapsed));
      frameState.health = player.health;
      frameState.lineOfSightBlocked = wallEnemy.lineOfSightBlocked ? 1 : 0;
      frameState.modifierActive = ability.active ? 1 : 0;
      frameState.playerX = quantize(player.mesh.position.x, 1000);
      frameState.playerY = quantize(player.mesh.position.y, 1000);
      frameState.playerZ = quantize(player.mesh.position.z, 1000);
      frameState.room = currentRoom;
      frameState.visibleEnemyAggro =
        visibleEnemy.state === "aggro" || visibleEnemy.state === "attack" ? 1 : 0;
      frameState.wallEnemyAggro =
        wallEnemy.state === "aggro" || wallEnemy.state === "attack" ? 1 : 0;
      const changed =
        frameState.abilityCooldown !== previous.abilityCooldown ||
        frameState.baseDamage !== previous.baseDamage ||
        frameState.damage !== previous.damage ||
        frameState.health !== previous.health ||
        frameState.lineOfSightBlocked !== previous.lineOfSightBlocked ||
        frameState.modifierActive !== previous.modifierActive ||
        frameState.playerX !== previous.playerX ||
        frameState.playerY !== previous.playerY ||
        frameState.playerZ !== previous.playerZ ||
        frameState.room !== previous.room ||
        frameState.visibleEnemyAggro !== previous.visibleEnemyAggro ||
        frameState.wallEnemyAggro !== previous.wallEnemyAggro;
      if (changed) frameCtx.state.set(frameState);
      if (currentRoom !== lastSavedRoom) {
        lastSavedRoom = currentRoom;
        saveRequested = true;
      }
      if (saveRequested) {
        const next = frameCtx.state.getState().saveCount + 1;
        frameCtx.state.set({ saveCount: next });
        frameCtx.state.flush();
        saveProgress(frameCtx.state);
        saveRequested = false;
      }
      cameraRig.follow(player.mesh.position, dt);
      if (boss.alive === false) frameCtx.state.set({ gameWon: 1, phase: "won" });
      if (player.dead) frameCtx.state.set({ gameOver: 1, phase: "lost" });
    };
  }
}
