import { readPath } from "../assertion-report.js";
import { pathValuePass } from "../evaluators/measures.js";
import { playtestDiagnostic } from "../diagnostics.js";
import type { IPlaytestObservationSnapshot, IPlaytestPathAssertion } from "../index.js";
import { PlaytestBridgeError } from "./bridgeClient.js";

export interface IWaitForResourcePredicate {
  equals?: unknown;
  gte?: number;
  lte?: number;
}

export interface IWaitForResourceOptions {
  advance?: () => Promise<void>;
  id: string;
  now?: () => number;
  path: string;
  predicate: IWaitForResourcePredicate;
  sample: () => Promise<IPlaytestObservationSnapshot>;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs: number;
}

const POLL_INTERVAL_MS = 16;

/** Wait on a bridge-observed resource without substituting fixed ticks for elapsed time. */
export async function waitForResource(options: IWaitForResourceOptions): Promise<IPlaytestObservationSnapshot> {
  const now = options.now ?? (() => globalThis.performance.now());
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const startedAt = now();
  const deadline = startedAt + options.timeoutMs;
  const assertion: IPlaytestPathAssertion = {
    id: options.id,
    path: options.path,
    ...options.predicate,
  };

  for (;;) {
    if (options.signal?.aborted) {
      throw waitFailure(
        `Resource wait for '${options.id}.${options.path}' was aborted.`,
        "The target stopped before the resource predicate was observed.",
        `resources.${options.id}`,
      );
    }
    const snapshot = await options.sample();
    const resources = snapshot.resources;
    if (resources === undefined || !Object.hasOwn(resources, options.id)) {
      throw waitFailure(
        `Resource observer did not report '${options.id}' while waiting for '${options.id}.${options.path}'.`,
        `Expose resource '${options.id}' through the existing playtest resource observer before waiting on it.`,
        `resources.${options.id}.${options.path}`,
      );
    }
    const resource = resources[options.id];
    const value = readPath(resource, options.path);
    if (value === undefined) {
      throw waitFailure(
        `Resource '${options.id}.${options.path}' was not observed; the last resource value was ${json(value)}.`,
        `Register a JSON-safe value at '${options.id}.${options.path}' before waiting on it.`,
        `resources.${options.id}.${options.path}`,
      );
    }
    // Elapsed time is read before the predicate is accepted. Returning on a passing value
    // first meant an observation that arrived after the budget still passed, so a step
    // asking for a transition "within 32 ms" was satisfied by one that took 100 — a wait
    // that cannot fail late is not a bounded wait.
    const elapsedMs = now() - startedAt;
    const remainingMs = options.timeoutMs - elapsedMs;
    if (pathValuePass(assertion, value)) {
      if (remainingMs >= 0) return snapshot;
      throw waitFailure(
        `Resource wait for '${options.id}.${options.path}' timed out after ${Math.max(0, Math.round(elapsedMs))} ms; predicate ${json(options.predicate)} was satisfied only after the ${options.timeoutMs} ms budget, so the transition is slower than this step allows.`,
        "Increase timeoutMs only when the transition is expected to take longer; otherwise fix the producer or resource path.",
        options.id,
      );
    }
    if (remainingMs <= 0) {
      throw waitFailure(
        `Resource wait for '${options.id}.${options.path}' timed out after ${Math.max(0, Math.round(elapsedMs))} ms; predicate ${json(options.predicate)}, last observation ${json(value)}.`,
        "Increase timeoutMs only when the transition is expected to take longer; otherwise fix the producer or resource path.",
        options.id,
      );
    }
    await sleep(Math.min(POLL_INTERVAL_MS, remainingMs));
    if (options.advance !== undefined && now() < deadline) await options.advance();
  }
}

function waitFailure(message: string, instruction: string, path: string): PlaytestBridgeError {
  return new PlaytestBridgeError(playtestDiagnostic(
    "TN_PLAYTEST_OBSERVATION_UNAVAILABLE",
    message,
    instruction,
    { path },
  ));
}

function json(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}
