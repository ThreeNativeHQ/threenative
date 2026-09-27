import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BuildTarget } from "./build.js";
import type { IResolvedThreeNativeConfig } from "./config.js";

/** The name a build publishes its report under, beside the artifact it describes. */
export const BUILD_REPORT_SUFFIX = ".build-report.json";

type PerformanceBudget = NonNullable<
  IResolvedThreeNativeConfig["buildProfile"]
>["performanceBudget"];

/** The closed report shape. `schemaVersion` is what a reader branches on, never the filename. */
export interface IBuildReport {
  readonly artifact: {
    readonly kind: "directory" | "file";
    /** The basename only: a report that carried a full path would embed the build machine in it. */
    readonly name: string;
    readonly sha256: string;
  };
  readonly measured: {
    readonly artifactBytes: number;
    readonly packagedAssetBytes: number;
  };
  readonly manifestSha256: string | null;
  readonly performanceBudget: PerformanceBudget | null;
  readonly profile: string | null;
  readonly schemaVersion: 1;
  readonly target: BuildTarget;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Every file under `target`, as `/`-joined relative paths in a stable order. */
async function listFiles(target: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(target, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : 1))) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory())
      files.push(...(await listFiles(path.join(target, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

/**
 * Identify an artifact by content, so a playtest can prove it measured the bytes it is running.
 *
 * A file hashes its own bytes. A directory hashes the sorted `relative path → file hash` list, so a
 * renamed file, a byte changed in one of them, and a file added or removed all change the digest,
 * while a different build directory, a different mtime and a different filesystem do not.
 *
 * `threenative-playtest --build-report` reimplements this byte for byte — the two packages share no
 * dependency by design — and `__tests__/build-report.spec.ts` pins the same fixture to the same
 * digest in both, which is what makes the pair one algorithm rather than two similar ones.
 */
export async function hashArtifact(
  target: string,
): Promise<{ kind: "directory" | "file"; name: string; sha256: string }> {
  const name = path.basename(target);
  if (!(await stat(target)).isDirectory()) {
    return { kind: "file", name, sha256: sha256(await readFile(target)) };
  }
  const lines: string[] = [];
  for (const file of await listFiles(target)) {
    lines.push(`${file} ${sha256(await readFile(path.join(target, file)))}`);
  }
  return { kind: "directory", name, sha256: sha256(Buffer.from(lines.join("\n"), "utf8")) };
}

/** The recursive byte sum, which is what `artifactBytes` is measured against. */
export async function measureTreeBytes(target: string): Promise<number> {
  const info = await stat(target);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of await readdir(target))
    total += await measureTreeBytes(path.join(target, entry));
  return total;
}

/**
 * Write `<artifact>.build-report.json` beside the staged artifact, before it is published.
 *
 * The staging directory is what `publishStagedArtifact` renames into place, so a report written
 * here lands atomically with the artifact it describes — and a build that fails after this point
 * publishes neither, which is why a report that exists beside an artifact is a build that finished.
 */
export async function writeBuildReport(options: {
  /** The staged artifact path; the report is written into its own directory. */
  readonly artifact: string;
  /** The asset root the cook wrote, for the manifest digest. */
  readonly assets: string;
  readonly config: IResolvedThreeNativeConfig;
  /** What survived the packaging selector, as `artifactBudget.packagedAssetBytes` measures it. */
  readonly packagedAssetBytes: number;
  readonly target: BuildTarget;
}): Promise<string> {
  const { artifact, assets, config, target } = options;
  const report: IBuildReport = {
    artifact: await hashArtifact(artifact),
    measured: {
      artifactBytes: await measureTreeBytes(artifact),
      packagedAssetBytes: options.packagedAssetBytes,
    },
    manifestSha256: await fileSha(path.join(assets, "assets.manifest.json")),
    performanceBudget: config.buildProfile?.performanceBudget ?? null,
    profile: config.buildProfile?.name ?? null,
    schemaVersion: 1,
    target,
  };
  const destination = path.join(
    path.dirname(artifact),
    `${path.basename(artifact)}${BUILD_REPORT_SUFFIX}`,
  );
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
  return destination;
}

async function fileSha(target: string): Promise<string | null> {
  try {
    return sha256(await readFile(target));
  } catch {
    return null;
  }
}
