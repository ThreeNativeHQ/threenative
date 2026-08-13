export interface ItemDefinition {
  readonly attackBonus?: number;
  readonly id: string;
  readonly label: string;
  readonly maxStack: number;
  readonly kind: "consumable" | "weapon";
}

export const ITEMS = {
  emberBlade: {
    attackBonus: 6,
    id: "ember-blade",
    label: "Ember Blade",
    maxStack: 1,
    kind: "weapon",
  },
  potion: {
    id: "potion",
    label: "Red Potion",
    maxStack: 3,
    kind: "consumable",
  },
  rustedBlade: {
    attackBonus: 0,
    id: "rusted-blade",
    label: "Rusted Blade",
    maxStack: 1,
    kind: "weapon",
  },
} as const satisfies Record<string, ItemDefinition>;

export type ItemId = (typeof ITEMS)[keyof typeof ITEMS]["id"];

export type ItemStack = {
  readonly itemId: ItemId;
  readonly quantity: number;
};

function item(itemId: ItemId): ItemDefinition {
  const found = Object.values(ITEMS).find((candidate) => candidate.id === itemId);
  if (found === undefined) throw new Error(`Unknown item: ${itemId}`);
  return found;
}

export class Inventory {
  readonly capacity: number;
  #slots: Array<ItemStack | undefined>;
  #equipped: ItemStack | undefined;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new RangeError("Invalid inventory capacity.");
    this.capacity = capacity;
    this.#slots = Array.from({ length: capacity });
  }

  add(itemId: ItemId, quantity = 1): number {
    if (!Number.isInteger(quantity) || quantity < 1)
      throw new RangeError("Item quantity must be positive.");
    let remaining = quantity;
    const definition = item(itemId);
    for (let index = 0; index < this.#slots.length && remaining > 0; index += 1) {
      const stack = this.#slots[index];
      if (stack?.itemId !== itemId || stack.quantity >= definition.maxStack) continue;
      const amount = Math.min(remaining, definition.maxStack - stack.quantity);
      this.#slots[index] = { itemId, quantity: stack.quantity + amount };
      remaining -= amount;
    }
    for (let index = 0; index < this.#slots.length && remaining > 0; index += 1) {
      if (this.#slots[index] !== undefined) continue;
      const amount = Math.min(remaining, definition.maxStack);
      this.#slots[index] = { itemId, quantity: amount };
      remaining -= amount;
    }
    return remaining;
  }

  swapFirst(stack: ItemStack): ItemStack | undefined {
    const definition = item(stack.itemId);
    if (
      !Number.isInteger(stack.quantity) ||
      stack.quantity < 1 ||
      stack.quantity > definition.maxStack ||
      this.#slots.some((slot) => slot === undefined)
    )
      return undefined;
    const index = this.#slots.findIndex((slot) => slot !== undefined);
    const displaced = this.#slots[index];
    if (displaced === undefined) return undefined;
    this.#slots[index] = { ...stack };
    return displaced;
  }

  equip(itemId: ItemId): boolean {
    const index = this.#slots.findIndex((stack) => stack?.itemId === itemId);
    if (index < 0 || item(itemId).kind !== "weapon") return false;
    const previous = this.#equipped;
    if (previous !== undefined && this.add(previous.itemId, previous.quantity) > 0) return false;
    const stack = this.#slots[index];
    if (stack === undefined) return false;
    this.#slots[index] =
      stack.quantity === 1 ? undefined : { ...stack, quantity: stack.quantity - 1 };
    this.#equipped = { itemId, quantity: 1 };
    return true;
  }

  unequip(): boolean {
    if (this.#equipped === undefined) return false;
    const equipped = this.#equipped;
    if (this.add(equipped.itemId, equipped.quantity) > 0) return false;
    this.#equipped = undefined;
    return true;
  }

  fill(itemId: ItemId): void {
    for (let index = 0; index < this.capacity * 3; index += 1) {
      if (this.add(itemId, 1) > 0 || this.#slots.every((slot) => slot !== undefined)) break;
    }
  }

  restore(slots: readonly ItemStack[], equippedItem?: ItemId): void {
    if (slots.length > this.capacity)
      throw new RangeError("Serialized inventory exceeds its capacity.");
    const restoredSlots: Array<ItemStack | undefined> = Array.from({ length: this.capacity });
    for (const [index, stack] of slots.entries()) {
      const definition = item(stack.itemId);
      if (
        !Number.isInteger(stack.quantity) ||
        stack.quantity < 1 ||
        stack.quantity > definition.maxStack
      )
        throw new RangeError(`Invalid quantity for serialized item: ${stack.itemId}.`);
      restoredSlots[index] = { ...stack };
    }
    let restoredEquipped: ItemStack | undefined;
    if (equippedItem !== undefined) {
      if (item(equippedItem).kind !== "weapon")
        throw new TypeError("Only weapons can be serialized as equipped items.");
      restoredEquipped = { itemId: equippedItem, quantity: 1 };
    }
    this.#slots = restoredSlots;
    this.#equipped = restoredEquipped;
  }

  get equipped(): ItemStack | undefined {
    return this.#equipped;
  }

  get slots(): readonly (ItemStack | undefined)[] {
    return this.#slots;
  }

  labels(): string[] {
    return this.#slots.flatMap((stack) => {
      if (stack === undefined) return [];
      return [`${item(stack.itemId).label} x${stack.quantity}`];
    });
  }

  snapshot(): ItemStack[] {
    return this.#slots.flatMap((stack) => (stack === undefined ? [] : [{ ...stack }]));
  }
}
