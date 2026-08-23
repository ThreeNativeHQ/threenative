import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * PRD-097 differential gate: proves the web build and the native package consume
 * byte-identical compiled asset artifacts. Both sides are the content-addressed outputs
 * recorded in an `assets.manifest.json`; the gate hashes every listed file on each side,
 * prints the two resolved paths and their hashes, and fails loudly on any drift.
 *
 * Exit 0 identical · exit 1 drift or unreadable artifact · exit 2 nothing compared.
 */

export interface IParityEntry {
  readonly digest: string;
  readonly path: string;
}

export interface IParitySide {
  readonly dir: string;
  readonly entries: Map<string, IParityEntry>;
}

export function parityExitCode(sides: readonly IParitySide[]): number {
  if (sides.some((side) => side.entries.size === 0)) return 2;
  return 0;
}

export async function readParitySide(dir: string): Promise<IParitySide> {
  const manifestPath = path.join(dir, "assets.manifest.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `TN_ASSET_PARITY_MANIFEST_UNREADABLE: '${manifestPath}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const record =
    typeof manifest === "object" && manifest !== null && !Array.isArray(manifest)
      ? (manifest as { entries?: unknown })
      : undefined;
  const entriesRaw =
    typeof record?.entries === "object" && record.entries !== null ? record.entries : {};
  const entries = new Map<string, IParityEntry>();
  for (const [logical, value] of Object.entries(entriesRaw)) {
    const output =
      typeof value === "object" &&
      value !== null &&
      typeof (value as { output?: unknown }).output === "string"
        ? (value as { output: string }).output
        : undefined;
    if (output === undefined) continue;
    const filePath = path.join(dir, output);
    try {
      const bytes = await readFile(filePath);
      entries.set(logical, {
        digest: createHash("sha256").update(bytes).digest("hex"),
        path: filePath,
      });
    } catch {
      throw new Error(`TN_ASSET_PARITY_ARTIFACT_MISSING: '${filePath}' is listed but not present.`);
    }
  }
  return { dir, entries };
}

export interface IParityResult {
  readonly compared: number;
  readonly mismatches: string[];
}

export async function compareSides(left: IParitySide, right: IParitySide): Promise<IParityResult> {
  const mismatches: string[] = [];
  const names = new Set([...left.entries.keys(), ...right.entries.keys()]);
  for (const name of [...names].sort()) {
    const leftEntry = left.entries.get(name);
    const rightEntry = right.entries.get(name);
    if (leftEntry === undefined) {
      mismatches.push(`${name}: missing on web side`);
      continue;
    }
    if (rightEntry === undefined) {
      mismatches.push(`${name}: missing on native side`);
      continue;
    }
    console.log(
      `parity ${name}\n  web    ${leftEntry.path}\n          ${leftEntry.digest}\n  native ${rightEntry.path}\n          ${rightEntry.digest}`,
    );
    if (leftEntry.digest !== rightEntry.digest) mismatches.push(`${name}: hashes differ`);
  }
  return { compared: names.size, mismatches };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : undefined;
  };
  const webDir = flag("--web");
  const nativeDir = flag("--native");
  if (webDir === undefined || nativeDir === undefined) {
    console.error(
      "Usage: tsx scripts/asset-parity.ts --web <dir> --native <dir> [--print-resolved]",
    );
    process.exit(2);
  }
  const [web, native] = await Promise.all([readParitySide(webDir), readParitySide(nativeDir)]);
  const exitCode = parityExitCode([web, native]);
  if (exitCode === 2) {
    console.error("TN_ASSET_PARITY_NOTHING_COMPARED: a side listed no manifest entries.");
    process.exit(2);
  }
  const result = await compareSides(web, native);
  if (result.mismatches.length > 0) {
    console.error(`TN_ASSET_PARITY_FAILED:\n${result.mismatches.join("\n")}`);
    process.exit(1);
  }
  console.log(`asset parity: ${result.compared} artifact(s) byte-identical across web and native.`);
}

if (process.argv[1]?.endsWith("asset-parity.ts")) void main();
