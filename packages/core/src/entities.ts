import { assertNotIterating, disposeEntity, snapshotEntities } from "./entity-snapshot.js";
export { autoFields } from "./entity-snapshot.js";
export type { EntitySnapshot, IDebuggable } from "./entity-snapshot.js";
import type { EntitySnapshot } from "./entity-snapshot.js";
export class Registry {
  #named = new Map<string, object>();
  #pendingFree = new Set<string>();
  #iterating = false;
  readonly #namesOf = new WeakMap<object, string[]>();

  add<T extends object>(name: string, entity: T): T {
    if (this.#named.has(name)) throw new Error(`Entity "${name}" already registered.`);
    this.#named.set(name, entity);
    const names = this.#namesOf.get(entity);
    if (names === undefined) this.#namesOf.set(entity, [name]);
    else names.push(name);
    return entity;
  }

  get<T extends object = object>(name: string): T | undefined {
    return this.#named.get(name) as T | undefined;
  }

  remove(name: string): void {
    assertNotIterating(this.#iterating, "remove");
    this.#pendingFree.delete(name);
    const entity = this.#named.get(name);
    this.#named.delete(name);
    if (entity !== undefined) {
      const names = this.#namesOf.get(entity);
      if (names !== undefined) {
        const at = names.indexOf(name);
        if (at >= 0) names.splice(at, 1);
      }
      disposeEntity(entity);
    }
  }

  queueFree(target: string | object): void {
    const name = typeof target === "string" ? target : this.#nameOf(target);
    if (name === undefined || !this.#named.has(name))
      throw new Error("Cannot queue an entity that is not registered.");
    this.#pendingFree.add(name);
  }

  sweep(): void {
    assertNotIterating(this.#iterating, "sweep");
    if (this.#pendingFree.size === 0) return;
    const pending = [...this.#pendingFree];
    this.#pendingFree.clear();
    for (const name of pending) {
      const entity = this.#named.get(name);
      if (entity === undefined) continue;
      this.#named.delete(name);
      disposeEntity(entity);
    }
  }

  clear(): void {
    assertNotIterating(this.#iterating, "clear");
    this.#pendingFree.clear();
    const entities = [...new Set(this.#named.values())];
    this.#named.clear();
    for (const entity of entities) disposeEntity(entity);
  }

  snapshot(): EntitySnapshot {
    this.#iterating = true;
    try {
      return snapshotEntities(this.#named);
    } finally {
      this.#iterating = false;
    }
  }

  #nameOf(entity: object): string | undefined {
    return this.#namesOf.get(entity)?.[0];
  }
}
