import type { IPlaytestAssertionResult } from "./assertion-report.js";
export interface ITrivialityGuardResult {
  pass: boolean;
  trivial: boolean;
  trivialityOptOut: boolean;
}
/** Apply the shared anti-vacuous guard to an assertion verdict. */
export function evaluateTrivialityGuard(
  comparisonPass: boolean,
  trivial: boolean,
  allowTrivial: unknown,
): ITrivialityGuardResult {
  const trivialityOptOut = trivial && typeof allowTrivial === "string";
  return {
    pass: comparisonPass && (!trivial || trivialityOptOut),
    trivial,
    trivialityOptOut,
  };
}
export const guardedAssertion = (guard: ITrivialityGuardResult, id: string, details: Record<string, unknown>): IPlaytestAssertionResult => ({
  details: { ...details, trivial: guard.trivial, ...(guard.trivialityOptOut ? { trivialityOptOut: true } : {}) },
  id,
  pass: guard.pass,
});
