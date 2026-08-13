export type EntitySnapshot = Record<string, Record<string, unknown> & { tags?: string[] }>;

export interface IDebuggable {
  debug(): Record<string, unknown>;
}

interface IDisposable {
  dispose(): void;
}

interface ITaggedEntity {
  tags?: unknown;
}

export function autoFields(entity: object): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(entity)) {
    if (Object.keys(fields).length >= 24) break;
    const value = (entity as Record<string, unknown>)[key];
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      fields[key] = value;
    } else if (value !== null && typeof value === "object" && "toArray" in value) {
      const toArray = (value as { toArray?: unknown }).toArray;
      if (typeof toArray === "function") fields[key] = toArray.call(value);
    }
  }
  return fields;
}

function disposeEntity(entity: object): void {
  const dispose = (entity as Partial<IDisposable>).dispose;
  if (typeof dispose === "function") dispose.call(entity);
}

export class Registry {
  #named = new Map<string, object>();
  #pendingFree = new Set<string>();
  #iterating = false;

  add<T extends object>(name: string, entity: T): T {
    if (this.#named.has(name)) throw new Error(`Entity "${name}" already registered.`);
    this.#named.set(name, entity);
    return entity;
  }

  get<T extends object = object>(name: string): T | undefined {
    return this.#named.get(name) as T | undefined;
  }

  remove(name: string): void {
    this.#assertNotIterating("remove");
    this.#pendingFree.delete(name);
    const entity = this.#named.get(name);
    this.#named.delete(name);
    if (entity !== undefined) disposeEntity(entity);
  }

  queueFree(target: string | object): void {
    const name = typeof target === "string" ? target : this.#nameOf(target);
    if (name === undefined || !this.#named.has(name))
      throw new Error("Cannot queue an entity that is not registered.");
    this.#pendingFree.add(name);
  }

  sweep(): void {
    this.#assertNotIterating("sweep");
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
    this.#assertNotIterating("clear");
    this.#pendingFree.clear();
    const entities = [...new Set(this.#named.values())];
    this.#named.clear();
    for (const entity of entities) disposeEntity(entity);
  }

  snapshot(): EntitySnapshot {
    const result: EntitySnapshot = {};
    this.#iterating = true;
    try {
      for (const [name, entity] of this.#named) {
        const debug = (entity as Partial<IDebuggable>).debug;
        const fields = typeof debug === "function" ? debug.call(entity) : autoFields(entity);
        const tags = (entity as ITaggedEntity).tags;
        result[name] = {
          ...fields,
          ...(Array.isArray(tags) && tags.every((tag) => typeof tag === "string")
            ? { tags: [...tags] }
            : {}),
        };
      }
    } finally {
      this.#iterating = false;
    }
    return result;
  }

  #nameOf(entity: object): string | undefined {
    for (const [name, registered] of this.#named) {
      if (registered === entity) return name;
    }
    return undefined;
  }

  #assertNotIterating(operation: string): void {
    if (this.#iterating)
      throw new TypeError(`Registry.${operation}() cannot mutate during snapshot.`);
  }
}
