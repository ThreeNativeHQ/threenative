// Generated for you: flora input validation for this game. Fail-closed
// named errors — malformed envelopes, budgets, bounds, and seeds throw
// before any geometry is grown.
import type { IFloraBounds, IFloraBudgets, IFloraEnvelope } from "./floraSample.js";

function finiteFlora(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`TN_FLORA_ENVELOPE_INVALID: ${field} not finite.`);
  return value;
}

export function validateEnvelope(envelope: IFloraEnvelope): void {
  const light = finiteFlora(envelope.light, "light");
  const sunAngle = finiteFlora(envelope.sunAngle, "sunAngle");
  const wind = finiteFlora(envelope.wind, "wind");
  const aridity = finiteFlora(envelope.aridity, "aridity");
  const gravity = finiteFlora(envelope.gravity, "gravity");
  if (light < 0 || light > 1) throw new Error("TN_FLORA_ENVELOPE_INVALID: light not in [0,1].");
  if (sunAngle < 0 || sunAngle > 1) throw new Error("TN_FLORA_ENVELOPE_INVALID: sunAngle bad.");
  if (wind < 0 || wind > 1) throw new Error("TN_FLORA_ENVELOPE_INVALID: wind not in [0,1].");
  if (aridity < 0 || aridity > 1) throw new Error("TN_FLORA_ENVELOPE_INVALID: aridity bad.");
  if (gravity < 0.1 || gravity > 3) throw new Error("TN_FLORA_ENVELOPE_INVALID: gravity bad.");
}

export function validateBudgets(budgets: IFloraBudgets): void {
  for (const [field, value] of [
    ["maxPlants", budgets.maxPlants],
    ["maxSegments", budgets.maxSegments],
    ["maxLeaves", budgets.maxLeaves],
  ] as const) {
    if (!Number.isInteger(value) || (value as number) <= 0)
      throw new Error(`TN_FLORA_BUDGET_INVALID: ${field} must be a positive integer.`);
  }
}

export function validateBounds(bounds: IFloraBounds): void {
  for (const [field, value] of [
    ["minX", bounds.minX],
    ["maxX", bounds.maxX],
    ["minZ", bounds.minZ],
    ["maxZ", bounds.maxZ],
  ] as const)
    finiteFlora(value, field);
  if (bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ)
    throw new Error("TN_FLORA_BOUNDS_INVALID: bounds are empty.");
}

export function validateSeed(seed: number): void {
  if (!Number.isInteger(seed)) throw new Error("TN_FLORA_SEED_INVALID: seed must be an integer.");
}
