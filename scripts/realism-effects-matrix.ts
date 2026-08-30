import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type IRealismEffectsPlatformResult,
  validateRealismEffectsPlatformMatrix,
} from "./realism-effects-coverage.js";

const MATRIX_SCHEMA_VERSION = "0.1.0";
export const REALISM_EFFECTS_MATRIX_RELATIVE_PATH =
  "docs/verification/realism-effects-matrix-2026-08-30.json";

/** Validate the checked-in platform evidence for every covered realism-effects export. */
export function checkRealismEffectsPlatformMatrix(root: string): string[] {
  const path = resolve(root, REALISM_EFFECTS_MATRIX_RELATIVE_PATH);
  if (!existsSync(path)) return [`realism-effects platform matrix is missing: ${path}`];
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const record = asRecord(value);
    if (record?.schemaVersion !== MATRIX_SCHEMA_VERSION) {
      return [`realism-effects platform matrix schema must be ${MATRIX_SCHEMA_VERSION}`];
    }
    if (!Array.isArray(record.results)) {
      return ["realism-effects platform matrix requires a results array"];
    }
    const results = record.results.map(toPlatformResult);
    return validateRealismEffectsPlatformMatrix(results).map(
      (error) => `realism-effects platform matrix: ${error}`,
    );
  } catch (error) {
    return [
      `realism-effects platform matrix is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}

function toPlatformResult(value: unknown, index: number): IRealismEffectsPlatformResult {
  const record = asRecord(value);
  return {
    exportName: typeof record?.exportName === "string" ? record.exportName : `<row ${index}>`,
    platform: typeof record?.platform === "string" ? record.platform : "<missing>",
    ...(typeof record?.reason === "string" ? { reason: record.reason } : {}),
    result:
      typeof record?.result === "string"
        ? (record.result as IRealismEffectsPlatformResult["result"])
        : ("invalid" as IRealismEffectsPlatformResult["result"]),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(dirname(scriptPath), "..");
  const errors = checkRealismEffectsPlatformMatrix(root);
  if (errors.length > 0) throw new Error(`TN_REALISM_EFFECTS_MATRIX_FAILED:\n${errors.join("\n")}`);
  console.info(
    `realism-effects platform matrix: ${REALISM_EFFECTS_MATRIX_RELATIVE_PATH} is complete`,
  );
}
