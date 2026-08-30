import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type IRealismEffectsPlatformResult,
  REALISM_EFFECTS_COVERAGE,
  validateRealismEffectsPlatformMatrix,
} from "./realism-effects-coverage.js";

const TEMPORAL_EFFECTS = new Set(["TRAAEffect", "TemporalReprojectPass", "TAAPass"]);
const SOFTWARE_ADAPTER = /cpu|fallback|llvmpipe|software|swiftshader/iu;
const BASELINE_SCHEMA = "0.1.0";

export interface IRealismEffectsTemporalObservation {
  readonly frameZeroHash?: string;
  readonly nextHash?: string;
  readonly restoredFrameRendered?: boolean;
  readonly restoredToFrameZero?: boolean;
  readonly settledHash?: string;
}

export interface IRealismEffectsBrowserObservation {
  readonly adapter?: string;
  readonly completed?: boolean;
}

export interface IRealismEffectsDeviceObservation {
  readonly notThermallyConfounded?: boolean;
  readonly platform?: string;
}

/** Validate the checked-in registry from a repository root, for the hard repository gate. */
export function checkRealismEffectsConformance(root: string): string[] {
  const registryPath = resolve(root, "packages/runtime-native/conformance/registry.json");
  if (!existsSync(registryPath)) return [`conformance registry is missing: ${registryPath}`];
  try {
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as unknown;
    return validateRealismEffectsConformance({ registry, root });
  } catch (error) {
    return [
      `conformance registry is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}

export function validateRealismEffectsConformance(input: {
  registry: unknown;
  root: string;
}): string[] {
  const errors: string[] = [];
  const registry = asRecord(input.registry);
  const tests = Array.isArray(registry?.tests) ? registry.tests.filter(isRecord) : [];
  if (registry === undefined || !Array.isArray(registry.tests)) {
    return ["realism-effects conformance requires a registry.tests array"];
  }
  const covered = REALISM_EFFECTS_COVERAGE.filter((row) => row.kind !== "not-covered");
  const coveredNames = new Set(covered.map((row) => row.exportName));
  for (const row of covered) {
    const registrations = tests.filter((test) => test.realismEffect === row.exportName);
    if (registrations.length !== 1) {
      errors.push(`${row.exportName}: exactly one conformance registration is required`);
      continue;
    }
    const registration = registrations[0];
    if (registration === undefined) continue;
    validateRegistration(registration, row.exportName, input.root, errors);
  }
  for (const test of tests) {
    if (typeof test.realismEffect === "string" && !coveredNames.has(test.realismEffect)) {
      errors.push(`${test.realismEffect}: conformance registration has no covered export`);
    }
  }
  return errors;
}

export function validateRealismEffectsPlatformResults(
  results: readonly IRealismEffectsPlatformResult[],
): string[] {
  return validateRealismEffectsPlatformMatrix(results);
}

export function validateRealismEffectsTemporalObservation(
  observation: IRealismEffectsTemporalObservation,
): string | undefined {
  if (observation.restoredFrameRendered !== true || observation.restoredToFrameZero !== true) {
    return "temporal conformance did not restore the scene to frame zero before next-frame capture";
  }
  const frameZero = nonEmpty(observation.frameZeroHash);
  const settled = nonEmpty(observation.settledHash);
  const next = nonEmpty(observation.nextHash);
  if (frameZero === undefined || settled === undefined || next === undefined) {
    return "temporal conformance requires frame-zero, settled, and next-frame hashes";
  }
  if (settled === frameZero || next === frameZero) return "frozen temporal history detected";
  return undefined;
}

export function validateRealismEffectsBrowserObservation(
  observation: IRealismEffectsBrowserObservation,
): string | undefined {
  if (observation.completed !== true) return "browser conformance did not complete";
  const adapter = nonEmpty(observation.adapter);
  if (adapter === undefined || SOFTWARE_ADAPTER.test(adapter)) {
    return "browser conformance requires a hardware adapter, not software rendering";
  }
  return undefined;
}

export function validateRealismEffectsDeviceObservation(
  observation: IRealismEffectsDeviceObservation,
): string | undefined {
  if (observation.platform !== "android") return undefined;
  if (observation.notThermallyConfounded !== true) {
    return "Android conformance is thermally confounded or missing its thermal observation";
  }
  return undefined;
}

function validateRegistration(
  registration: Record<string, unknown>,
  exportName: string,
  root: string,
  errors: string[],
): void {
  validateScene(registration.scene, exportName, root, errors);
  validateBaseline(registration.baseline, exportName, root, errors);
  validateLaneRegistrations(registration.laneRegistrations, exportName, errors);
  validateRegistrationPolicy(registration, exportName, errors);
}

function validateScene(value: unknown, exportName: string, root: string, errors: string[]): void {
  if (typeof value !== "string" || !existsSync(resolve(root, "packages/runtime-native", value))) {
    errors.push(`${exportName}: conformance scene is missing`);
  }
}

function validateBaseline(
  value: unknown,
  exportName: string,
  root: string,
  errors: string[],
): void {
  if (typeof value !== "string") {
    errors.push(`${exportName}: baseline registration is missing`);
    return;
  }
  const baselinePath = resolve(root, "packages/runtime-native", value);
  if (!existsSync(baselinePath)) {
    errors.push(`${exportName}: baseline '${value}' does not resolve`);
    return;
  }
  try {
    const baseline = asRecord(JSON.parse(readFileSync(baselinePath, "utf8")));
    if (baseline?.schemaVersion !== BASELINE_SCHEMA)
      errors.push(`${exportName}: baseline schema is not ${BASELINE_SCHEMA}`);
    const names = new Set(
      (Array.isArray(baseline?.rows) ? baseline.rows : [])
        .filter(isRecord)
        .filter((row) => typeof row.exportName === "string")
        .map((row) => row.exportName as string),
    );
    if (!names.has(exportName)) errors.push(`${exportName}: baseline does not name the export`);
  } catch (error) {
    errors.push(
      `${exportName}: baseline is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

function validateRegistrationPolicy(
  registration: Record<string, unknown>,
  exportName: string,
  errors: string[],
): void {
  if (registration.browserRecipe !== "webgpu")
    errors.push(`${exportName}: browser lane must require the webgpu recipe`);
  if (registration.requiresHardwareAdapter !== true)
    errors.push(`${exportName}: browser lane must require a hardware adapter`);
  const deviceMetrics = asRecord(registration.deviceMetrics);
  if (deviceMetrics?.notThermallyConfounded !== true)
    errors.push(`${exportName}: Android lane must require notThermallyConfounded`);
  if (TEMPORAL_EFFECTS.has(exportName))
    validateTemporalRegistration(registration.temporal, exportName, errors);
}

function validateLaneRegistrations(value: unknown, exportName: string, errors: string[]): void {
  const registrations = asRecord(value);
  if (registrations === undefined) {
    errors.push(`${exportName}: lane registrations are missing`);
    return;
  }
  const expectedLanes: Record<
    string,
    {
      readonly target: string;
      readonly assertsAdapter?: boolean;
      readonly assertsThermal?: boolean;
    }
  > = {
    android: { target: "android", assertsThermal: true },
    browser: { target: "web", assertsAdapter: true },
    desktop: { target: "desktop" },
    ios: { target: "ios" },
  } as const;
  for (const [lane, expected] of Object.entries(expectedLanes)) {
    const registration = asRecord(registrations[lane]);
    if (registration?.registered !== true) {
      errors.push(`${exportName}: ${lane} lane registration is missing`);
      continue;
    }
    if (registration.target !== expected.target) {
      errors.push(`${exportName}: ${lane} lane target must be '${expected.target}'`);
    }
    if (expected.assertsAdapter === true && registration.assertsAdapter !== true) {
      errors.push(`${exportName}: browser lane must assert its adapter`);
    }
    if (expected.assertsThermal === true && registration.assertsThermal !== true) {
      errors.push(`${exportName}: Android lane must assert thermal state`);
    }
  }
}

function validateTemporalRegistration(value: unknown, exportName: string, errors: string[]): void {
  const temporal = asRecord(value);
  const settledFrame =
    typeof temporal?.settledFrame === "number" ? temporal.settledFrame : undefined;
  const nextFrame = typeof temporal?.nextFrame === "number" ? temporal.nextFrame : undefined;
  if (settledFrame === undefined || !Number.isInteger(settledFrame) || settledFrame < 1) {
    errors.push(`${exportName}: temporal settledFrame is missing`);
  }
  if (
    settledFrame === undefined ||
    nextFrame === undefined ||
    !Number.isInteger(nextFrame) ||
    nextFrame <= settledFrame
  ) {
    errors.push(`${exportName}: temporal nextFrame must follow settledFrame`);
  }
  if (temporal?.assertsDifferenceFromFrameZero !== true)
    errors.push(`${exportName}: temporal frame-difference assertion is missing`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(dirname(scriptPath), "..");
  const errors = checkRealismEffectsConformance(root);
  if (errors.length > 0)
    throw new Error(`TN_REALISM_EFFECTS_CONFORMANCE_FAILED:\n${errors.join("\n")}`);
  const coveredCount = REALISM_EFFECTS_COVERAGE.filter((row) => row.kind !== "not-covered").length;
  console.info(`realism-effects conformance registry: ${coveredCount} covered exports registered`);
}
