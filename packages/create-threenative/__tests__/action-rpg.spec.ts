import { describe, expect, it } from "vitest";
import { ITEMS, Inventory } from "../templates/action-rpg/src/items/Inventory.js";
import { rollDrops } from "../templates/action-rpg/src/loot/drops.js";
import { StatBlock } from "../templates/action-rpg/src/stats/StatBlock.js";

describe("action-RPG inventory restore", () => {
  it("restores a full bag and separately equipped weapon without losing its attack bonus", () => {
    const serialized = Array.from({ length: 6 }, () => ({
      itemId: "potion" as const,
      quantity: 3,
    }));
    const inventory = new Inventory(serialized.length);

    inventory.restore(serialized, "ember-blade");

    expect(inventory.snapshot()).toEqual(serialized);
    expect(inventory.equipped).toEqual({ itemId: "ember-blade", quantity: 1 });

    const attackBonus =
      inventory.equipped?.itemId === ITEMS.emberBlade.id ? ITEMS.emberBlade.attackBonus : 0;
    const damage = new StatBlock(12);
    damage.apply({ add: attackBonus, source: "equipment" });
    expect(damage.value()).toBe(18);
  });
});

describe("action-RPG seeded drops", () => {
  it("uses the seed for exact and distinct LCG sequences", () => {
    const first = rollDrops(1);
    const second = rollDrops(0x12345678);

    expect(first).toEqual([
      { itemId: "potion", quantity: 1 },
      { itemId: "potion", quantity: 1 },
    ]);
    expect(second).toEqual([
      { itemId: "potion", quantity: 1 },
      { itemId: "ember-blade", quantity: 1 },
    ]);
    expect(second).not.toEqual(first);
  });
});
