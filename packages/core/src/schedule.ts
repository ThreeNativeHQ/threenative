export type ScheduleHandle = (() => void) & {
  cancel(): void;
  readonly active: boolean;
};

type TweenProperties<T extends object> = { [K in keyof T]?: number };

interface ScheduleEntry {
  active: boolean;
  cancel(): void;
  tick(dt: number): void;
}

function createHandle(cancel: () => void, active: () => boolean): ScheduleHandle {
  const handle = (() => cancel()) as ScheduleHandle;
  handle.cancel = handle;
  Object.defineProperty(handle, "active", { get: active });
  return handle;
}

export class Scheduler {
  readonly #entries = new Set<ScheduleEntry>();

  get size(): number {
    return this.#entries.size;
  }

  after(delay: number, callback: () => void): ScheduleHandle {
    assertDelay(delay, "delay");
    let elapsed = 0;
    const entry = this.#add((dt) => {
      elapsed += dt;
      if (elapsed + Number.EPSILON < delay) return;
      entry.cancel();
      callback();
    });
    return entry.handle;
  }

  every(callback: (dt: number) => void): ScheduleHandle {
    const entry = this.#add(callback);
    return entry.handle;
  }

  tween<T extends object>(
    target: T,
    properties: TweenProperties<T>,
    duration: number,
  ): Promise<void> {
    assertDelay(duration, "duration");
    const values = Object.entries(properties).map(([key, end]) => {
      if (typeof end !== "number" || !Number.isFinite(end)) {
        throw new TypeError(`Tween property '${key}' must be a finite number.`);
      }
      const start = (target as Record<string, unknown>)[key];
      if (typeof start !== "number" || !Number.isFinite(start)) {
        throw new TypeError(`Tween property '${key}' must start as a finite number.`);
      }
      return { end, key, start };
    });

    if (duration === 0) {
      for (const { end, key } of values) (target as Record<string, unknown>)[key] = end;
      return Promise.resolve();
    }

    let elapsed = 0;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    let resolve!: () => void;
    const promise = new Promise<void>((finish) => {
      resolve = finish;
    });
    const entry = this.#add((dt) => {
      elapsed = Math.min(duration, elapsed + dt);
      const progress = elapsed / duration;
      for (const { end, key, start } of values) {
        (target as Record<string, unknown>)[key] = start + (end - start) * progress;
      }
      if (progress >= 1) {
        entry.cancel();
        settle();
      }
    }, settle);
    return promise;
  }

  tick(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0)
      throw new TypeError("Tick duration must be finite and non-negative.");
    for (const entry of [...this.#entries]) {
      if (entry.active) entry.tick(dt);
    }
  }

  clear(): void {
    for (const entry of [...this.#entries]) entry.cancel();
  }

  #add(
    tick: (dt: number) => void,
    onCancel?: () => void,
  ): ScheduleEntry & { handle: ScheduleHandle } {
    const entry: ScheduleEntry & { handle: ScheduleHandle } = {
      active: true,
      cancel: () => {
        if (!entry.active) return;
        entry.active = false;
        this.#entries.delete(entry);
        onCancel?.();
      },
      handle: undefined as never,
      tick,
    };
    entry.handle = createHandle(entry.cancel, () => entry.active);
    this.#entries.add(entry);
    return entry;
  }
}

function assertDelay(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be finite and non-negative.`);
  }
}
