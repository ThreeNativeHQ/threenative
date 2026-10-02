import type { IAdmissionBudget } from "./world-tiles.js";

/** Existing streaming allowance, shared with measured shadow work at render cadence. */
export class AdmissionBudget implements IAdmissionBudget {
  #limitMs: number;
  readonly #now: () => number;
  #spentMs = 0;

  constructor(limitMs: number, now: () => number) {
    this.#limitMs = limitMs;
    this.#now = now;
  }

  get spentMs(): number {
    return this.#spentMs;
  }

  reset(limitMs: number): void {
    this.#limitMs = limitMs;
    this.#spentMs = 0;
  }

  charge(ms: number): void {
    this.#spentMs += ms;
  }

  limit(limitMs: number): void {
    this.#limitMs = limitMs;
  }

  admit(work: () => void, limitMs = this.#limitMs): boolean {
    if (this.#spentMs >= limitMs) return false;
    const startedAt = this.#now();
    try {
      work();
    } finally {
      this.#spentMs += this.#now() - startedAt;
    }
    return true;
  }
}

interface IFrameWork {
  readonly budget: AdmissionBudget;
  startedAt: number;
  periodMs: number;
  shadowMs: number;
  shadowAllowanceMs: number;
}

const frames = new WeakMap<object, IFrameWork>();
const now = (): number => performance.now();

function key(renderer: unknown): object | undefined {
  if (typeof renderer !== "object" || renderer === null) return undefined;
  const raw = "raw" in renderer ? (renderer as { raw: unknown }).raw : renderer;
  return typeof raw === "object" && raw !== null ? raw : undefined;
}

/** One frame, opened by the existing render-cadence registry before the draw. No work queue. */
export function beginFrameWork(renderer: unknown): void {
  const raw = key(renderer);
  if (raw === undefined) return;
  const startedAt = now();
  let frame = frames.get(raw);
  if (frame === undefined) {
    frame = {
      budget: new AdmissionBudget(Number.POSITIVE_INFINITY, now),
      startedAt,
      periodMs: Number.POSITIVE_INFINITY,
      shadowMs: 0,
      shadowAllowanceMs: Number.POSITIVE_INFINITY,
    };
    frames.set(raw, frame);
  } else {
    const period = startedAt - frame.startedAt;
    if (period > 0) frame.periodMs = Math.min(frame.periodMs, period);
    frame.startedAt = startedAt;
  }
  frame.shadowMs = 0;
  frame.budget.reset(Math.min(frame.periodMs, frame.shadowAllowanceMs));
}

export function frameWorkBudget(renderer: unknown): AdmissionBudget | undefined {
  const raw = key(renderer);
  return raw === undefined ? undefined : frames.get(raw)?.budget;
}

/** A measured shadow frame sets the auto allowance to that frame's actual shadow work. */
export function chargeShadowWork(renderer: unknown, ms: number): void {
  const raw = key(renderer);
  const frame = raw === undefined ? undefined : frames.get(raw);
  if (frame === undefined) return;
  frame.shadowMs += ms;
  frame.budget.charge(ms);
  if (frame.shadowMs > 0) {
    frame.shadowAllowanceMs = frame.shadowMs;
    frame.budget.limit(Math.min(frame.periodMs, frame.shadowMs));
  }
}
