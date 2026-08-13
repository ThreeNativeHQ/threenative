export interface IStatModifier {
  readonly add?: number;
  readonly duration?: number;
  readonly multiply?: number;
  readonly source: string;
}

type ActiveModifier = IStatModifier & { readonly expiresAt?: number };

export class StatBlock {
  readonly base: number;
  #layers = new Map<string, ActiveModifier>();

  constructor(base: number) {
    if (!Number.isFinite(base)) throw new TypeError("StatBlock base must be finite.");
    this.base = base;
  }

  apply(modifier: IStatModifier, now = 0): void {
    if (modifier.source.length === 0) throw new Error("StatBlock modifiers need a source.");
    if (modifier.add !== undefined && !Number.isFinite(modifier.add))
      throw new TypeError("StatBlock additive modifiers must be finite.");
    if (modifier.multiply !== undefined && !Number.isFinite(modifier.multiply))
      throw new TypeError("StatBlock multiplicative modifiers must be finite.");
    const expiresAt =
      modifier.duration === undefined ? undefined : now + Math.max(0, modifier.duration);
    this.#layers.set(modifier.source, {
      ...modifier,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    });
  }

  remove(source: string): boolean {
    return this.#layers.delete(source);
  }

  expire(now: number): void {
    for (const [source, modifier] of this.#layers) {
      if (modifier.expiresAt !== undefined && modifier.expiresAt <= now)
        this.#layers.delete(source);
    }
  }

  value(now = 0): number {
    this.expire(now);
    let result = this.base;
    for (const modifier of this.#layers.values()) {
      result = (result + (modifier.add ?? 0)) * (modifier.multiply ?? 1);
    }
    return result;
  }

  has(source: string, now = 0): boolean {
    this.expire(now);
    return this.#layers.has(source);
  }
}
