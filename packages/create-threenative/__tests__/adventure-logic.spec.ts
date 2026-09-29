import { describe, expect, it } from "vitest";
import { Adventure, type IInput, NO_INPUT } from "../templates/adventure/src/logic/adventure.js";
import { ALTAR, CHEST, ENEMIES, KEEPER, POTS, SIGIL_SITES } from "../templates/adventure/src/logic/layout.js";
import { moveDirection, moveWithCollisions } from "../templates/adventure/src/logic/movement.js";
import {
  SIGILS,
  activateAltar,
  collectSigil,
  meetKeeper,
  newGame,
  restoreSave,
} from "../templates/adventure/src/logic/quest.js";
import { BRIDGE, bridgeDeck, floorHeight, groundHeight, pathDistance, terrainHeight } from "../templates/adventure/src/logic/terrain.js";

const DT = 1 / 60;
const press = (partial: Partial<IInput>): IInput => ({ ...NO_INPUT, ...partial });

function run(game: Adventure, seconds: number, input: Partial<IInput> = {}): void {
  for (let i = 0; i < Math.round(seconds / DT); i += 1) game.update(DT, press(input));
}

/** A hero standing next to something, with every enemy asleep far away and the keeper met. */
function standAt(x: number, z: number, angle = 0): Adventure {
  const game = new Adventure();
  for (const e of game.enemies) e.mode = "idle";
  game.teleport(x, z, angle);
  return game;
}

describe("adventure terrain", () => {
  it("climbs the stair one step at a time and levels off at the overlook", () => {
    const first = groundHeight(8, 2.7);
    const second = groundHeight(8, 2.7 - 0.65);
    expect(second - first).toBeCloseTo(0.225, 5);
    expect(groundHeight(8, -9.9)).toBeCloseTo(20 * 0.225 + 0.025, 5);
  });

  it("puts the hero on the deck when above it and under the bridge when below", () => {
    const x = -15;
    expect(floorHeight(x, BRIDGE.z, bridgeDeck(x) + 0.5)).toBeCloseTo(bridgeDeck(x), 5);
    expect(floorHeight(x, BRIDGE.z, -1)).toBeCloseTo(groundHeight(x, BRIDGE.z), 5);
    expect(terrainHeight(-20, 4)).toBeLessThan(0);
  });

  it("measures the distance to a footpath", () => {
    expect(pathDistance(0, 12)).toBeCloseTo(0, 5);
    expect(pathDistance(2, 12)).toBeCloseTo(2, 5);
  });
});

describe("adventure quest", () => {
  it("refuses a sigil until the keeper has asked, then walks meet → seek → altar → complete", () => {
    const save = newGame();
    expect(collectSigil(save, "brook")).toBe(false);
    expect(meetKeeper(save)).toBe(true);
    expect(meetKeeper(save)).toBe(false);
    expect(collectSigil(save, "brook")).toBe(true);
    expect(collectSigil(save, "brook")).toBe(false);
    expect(collectSigil(save, "nope")).toBe(false);
    expect(activateAltar(save)).toBe(false);
    collectSigil(save, "briar");
    collectSigil(save, "elder");
    expect(save.stage).toBe("altar");
    expect(activateAltar(save)).toBe(true);
    expect(save.stage).toBe("complete");
  });

  it("restores a save fail-closed and re-derives the stage from the sigils", () => {
    expect(restoreSave("not json")).toBeUndefined();
    expect(restoreSave(JSON.stringify({ version: 2, sigils: [] }))).toBeUndefined();
    expect(restoreSave(undefined)).toBeUndefined();
    const forged = restoreSave(JSON.stringify({ gems: 9999, hp: 99, sigils: ["brook", "brook", "x"], stage: "complete", version: 1 }));
    expect(forged).toMatchObject({ gems: 999, hp: 6, sigils: ["brook"], stage: "seek" });
    const done = restoreSave(JSON.stringify({ sigils: [...SIGILS], stage: "complete", version: 1 }));
    expect(done?.stage).toBe("complete");
  });
});

describe("adventure movement", () => {
  it("caps a diagonal at one and points forward away from the camera", () => {
    const d = moveDirection(1, 1, 0);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 5);
    expect(moveDirection(0, 1, 0)).toMatchObject({ x: 0, z: -1 });
  });

  it("slides along a trunk and cannot tunnel through it at roll speed", () => {
    const wall = [{ r: 1, x: 0, z: 0 }];
    const slid = moveWithCollisions({ x: -1.6, z: 0.9 }, 3.2, 0, wall);
    expect(Math.hypot(slid.x, slid.z)).toBeGreaterThanOrEqual(1.34 - 1e-6);
    const blocked = moveWithCollisions({ x: -2, z: 0 }, 6, 0, wall);
    expect(blocked.x).toBeLessThan(0);
  });
});

describe("adventure rules", () => {
  it("starts the quest when the keeper is spoken to and pages her dialogue", () => {
    const game = standAt(KEEPER.x - 1.5, KEEPER.z);
    game.update(DT, press({ interact: true }));
    expect(game.save.stage).toBe("seek");
    expect(game.dialog?.lines).toHaveLength(3);
    game.update(DT, press({ interact: true }));
    game.update(DT, press({ interact: true }));
    game.update(DT, press({ interact: true }));
    expect(game.dialog).toBeUndefined();
  });

  it("holds the world still while a line is on screen", () => {
    const game = standAt(KEEPER.x - 1.5, KEEPER.z);
    game.update(DT, press({ interact: true }));
    const before = game.player.x;
    run(game, 0.5, { forward: 1 });
    expect(game.player.x).toBe(before);
  });

  it("rolls with i-frames, spends 24 stamina, and refuses a roll with too little", () => {
    const game = standAt(0, 12);
    game.update(DT, press({ dodge: true }));
    expect(game.player.roll).toBeGreaterThan(0);
    expect(game.player.invuln).toBeGreaterThan(0.4);
    expect(game.player.stamina).toBeLessThanOrEqual(76 + 24 * DT + 1e-6);
    expect(game.hurt(1)).toBe(false);
    const tired = standAt(0, 12);
    tired.player.stamina = 10;
    tired.update(DT, press({ dodge: true }));
    expect(tired.player.roll).toBe(0);
    expect(tired.events.some((e) => e.kind === "toast" && e.text === "Catch your breath.")).toBe(true);
  });

  it("blocks a frontal hit for stamina and takes a rear one", () => {
    const game = standAt(0, 12, 0);
    const enemy = game.enemies[0];
    if (enemy === undefined) throw new Error("no enemy");
    Object.assign(enemy, { x: 0, z: 13 });
    game.player.invuln = 0;
    game.player.blocking = true;
    expect(game.hurt(2, enemy)).toBe(false);
    expect(game.save.hp).toBe(6);
    expect(game.player.stamina).toBe(85);
    expect(game.events.some((e) => e.kind === "block")).toBe(true);
    game.player.invuln = 0;
    game.player.blocking = true;
    Object.assign(enemy, { x: 0, z: 11 });
    expect(game.hurt(2, enemy)).toBe(true);
    expect(game.save.hp).toBe(4);
  });

  it("drives a briarling through chase, windup, strike and recover, then kills it for a gem", () => {
    const [x, z] = ENEMIES[0] ?? [0, 0];
    const game = standAt(x + 2.5, z, Math.PI / 2 + Math.PI);
    const enemy = game.enemies[0];
    if (enemy === undefined) throw new Error("no enemy");
    game.update(DT, NO_INPUT);
    expect(enemy.mode).toBe("chase");
    const seen = new Set<string>();
    for (let i = 0; i < 240 && game.save.hp === 6; i += 1) {
      game.update(DT, NO_INPUT);
      seen.add(enemy.mode);
    }
    expect([...seen]).toEqual(expect.arrayContaining(["chase", "windup"]));
    expect(game.save.hp).toBe(4);
    const kills = game.stats.kills;
    for (let n = 0; n < 6 && !enemy.dead; n += 1) {
      const dx = enemy.x - game.player.x;
      const dz = enemy.z - game.player.z;
      game.player.angle = Math.atan2(dx, dz);
      game.player.attackCooldown = 0;
      game.player.invuln = 5;
      game.update(DT, press({ attack: true }));
      run(game, 0.5);
    }
    expect(enemy.dead).toBe(true);
    expect(game.stats.kills).toBe(kills + 1);
    expect(game.gems.some((g) => g.value === 3)).toBe(true);
  });

  it("breaks a pot for two gems and collects gems by walking onto them", () => {
    const [px, pz] = POTS[0] ?? [0, 0];
    const game = standAt(px, pz + 1.2, Math.PI);
    game.update(DT, press({ attack: true }));
    run(game, 0.5);
    expect(game.pots[0]?.broken).toBe(true);
    const gem = game.gems.at(-1);
    if (gem === undefined) throw new Error("no gem");
    expect(gem.value).toBe(2);
    game.teleport(gem.x, gem.z);
    game.update(DT, NO_INPUT);
    expect(game.save.gems).toBeGreaterThanOrEqual(2);
  });

  it("opens the chest once for 20 gems and full hearts", () => {
    const game = standAt(CHEST.x + 1, CHEST.z);
    game.save.hp = 2;
    game.update(DT, press({ interact: true }));
    expect(game.save).toMatchObject({ gems: 20, hp: 6, openedChests: ["oak"] });
    game.update(DT, press({ interact: true }));
    expect(game.save.gems).toBe(20);
  });

  it("brings the hero home after the last heart, minus five gems", () => {
    const game = standAt(0, 12);
    game.save.gems = 12;
    game.player.invuln = 0;
    game.hurt(6);
    expect(game.player.dead).toBeGreaterThan(0);
    game.teleport(4, 4);
    run(game, 3);
    expect(game.save).toMatchObject({ gems: 7, hp: 6 });
    expect(game.player.z).toBeCloseTo(12, 5);
    expect(game.events.some((e) => e.kind === "respawn")).toBe(true);
  });

  it("plays the whole quest: keeper, three sigils, altar, victory", () => {
    const game = standAt(KEEPER.x - 1.5, KEEPER.z);
    game.update(DT, press({ interact: true }));
    for (let i = 0; i < 3; i += 1) game.update(DT, press({ interact: true }));
    for (const id of SIGILS) {
      const site = SIGIL_SITES[id];
      game.teleport(site.x, site.z + 1);
      game.update(DT, press({ interact: true }));
    }
    expect(game.save.sigils).toEqual([...SIGILS]);
    expect(game.save.stage).toBe("altar");
    game.teleport(ALTAR.x, ALTAR.z + 1.5);
    game.update(DT, press({ interact: true }));
    run(game, 1.5);
    expect(game.save.stage).toBe("complete");
    expect(game.victory).toBe(true);
  });

  it("replays a scripted minute to byte-identical state", () => {
    const script = (): string => {
      const game = new Adventure();
      for (let i = 0; i < 3600; i += 1) {
        game.update(
          DT,
          press({
            attack: i % 90 === 0,
            dodge: i % 250 === 0,
            forward: Math.sin(i / 200) > 0 ? 1 : 0,
            right: Math.cos(i / 130),
            sprint: i % 500 < 100,
            yaw: i / 900,
          }),
        );
        game.events.length = 0;
      }
      return JSON.stringify({ e: game.enemies, g: game.gems, p: game.player, s: game.save, t: game.stats });
    };
    expect(script()).toBe(script());
  });
});
