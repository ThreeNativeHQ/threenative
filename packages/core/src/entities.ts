export type EntitySnapshot = Record<string, Record<string, unknown>>;

export interface Debuggable {
  debug(): Record<string, unknown>;
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

export class Registry {
  #named = new Map<string, object>();

  add<T extends object>(name: string, entity: T): T {
    if (this.#named.has(name)) throw new Error(`Entity "${name}" already registered.`);
    this.#named.set(name, entity);
    return entity;
  }

  get<T extends object = object>(name: string): T | undefined {
    return this.#named.get(name) as T | undefined;
  }

  remove(name: string): void {
    this.#named.delete(name);
  }

  clear(): void {
    this.#named.clear();
  }

  snapshot(): EntitySnapshot {
    const result: EntitySnapshot = {};
    for (const [name, entity] of this.#named) {
      const debug = (entity as Partial<Debuggable>).debug;
      result[name] = typeof debug === "function" ? debug.call(entity) : autoFields(entity);
    }
    return result;
  }
}
