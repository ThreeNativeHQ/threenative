import type { Object3D } from "three";

export interface IThreePlaytestEntity {
  id: string;
  object: Object3D;
  path?: string;
}

export class ThreePlaytestEntityRegistry {
  readonly #entries = new Map<string, Required<IThreePlaytestEntity>>();

  register(entry: IThreePlaytestEntity): void {
    const path = entry.path ?? objectPath(entry.object);
    const existing = this.#entries.get(entry.id);
    if (existing !== undefined) {
      throw new Error(
        `Duplicate playtest entity id '${entry.id}' conflicts between '${existing.path}' and '${path}'. `
        + "Register a unique stable id for each observed object.",
      );
    }
    this.#entries.set(entry.id, { ...entry, path });
  }

  get(id: string): Required<IThreePlaytestEntity> | undefined {
    return this.#entries.get(id);
  }

  select(ids?: readonly string[]): Required<IThreePlaytestEntity>[] {
    if (ids === undefined) return [...this.#entries.values()];
    return ids.flatMap((id) => {
      const entry = this.#entries.get(id);
      return entry === undefined ? [] : [entry];
    });
  }
}

export function objectPath(object: Object3D): string {
  const parts: string[] = [];
  let current: Object3D | null = object;
  while (current !== null) {
    parts.unshift(current.name || `${current.type}[${current.uuid.slice(0, 8)}]`);
    current = current.parent;
  }
  return parts.join("/");
}
