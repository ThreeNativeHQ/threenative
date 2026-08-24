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

export function disposeEntity(entity: object): void {
  const dispose = (entity as Partial<IDisposable>).dispose;
  if (typeof dispose === "function") dispose.call(entity);
}

export function assertNotIterating(iterating: boolean, operation: string): void {
  if (iterating) throw new TypeError(`Registry.${operation}() cannot mutate during snapshot.`);
}

export function snapshotEntities(named: ReadonlyMap<string, object>): EntitySnapshot {
  const result: EntitySnapshot = {};
  for (const [name, entity] of named) {
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
  return result;
}
