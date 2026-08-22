/**
 * Immutable evidence manifests for sweep archives — P2-5 phase 1.
 *
 * A sweep archive is only evidence if its bytes can be proven unchanged since the archiver
 * wrote them. This module gives every NEW archive an `evidence-manifest.json` that inventories
 * every retained file with its SHA-256, size, role and retention class, plus the provenance a
 * reader needs to trust it: the sweep identity, the source commit the archiver ran from, and
 * the generator version that produced the manifest.
 *
 * Phase 1 deliberately does three things and no more:
 * - It classifies every file as Git-retained proof or a bulk candidate WITHOUT moving or
 *   removing either. The provider that would receive bulk candidates is phase 2 and has no
 *   owner checkpoint yet, so nothing leaves this repository.
 * - It fails closed on tampering: a changed or deleted file, an unlisted file, a path that
 *   escapes the archive, a duplicate identity, a missing required proof, or a malformed
 *   manifest all reject verification.
 * - It leaves every archive that predates manifests exactly as it is. They verify as "legacy"
 *   via `verifySweepStore` — never rewritten, never deleted.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SweepManifest } from "./make-sandbox.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The manifest file an archive carries beside its `sweep.json`. Reserved: never inventoried. */
export const EVIDENCE_MANIFEST_FILE = "evidence-manifest.json";
/** Bumped when the schema changes shape; the verifier rejects versions it does not know. */
export const EVIDENCE_MANIFEST_VERSION = 1;
export const EVIDENCE_GENERATOR = "sweep-evidence";
export const EVIDENCE_GENERATOR_VERSION = "1.0.0";

/** Paths without which an archive is not admissible evidence at all. */
const REQUIRED_PROOF_PATHS = ["sweep.json", "proof.json"] as const;

export const EVIDENCE_ROLES = [
  "sweep-manifest",
  "proof",
  "source",
  "playtest",
  "baseline",
  "config",
  "media",
  "capture",
  "transcript",
  "vendor",
] as const;

export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];
export type EvidenceRetention = "git" | "bulk-candidate";

const GIT_ROLES: readonly EvidenceRole[] = [
  "sweep-manifest",
  "proof",
  "source",
  "playtest",
  "baseline",
  "config",
];

export function retentionForRole(role: EvidenceRole): EvidenceRetention {
  return GIT_ROLES.includes(role) ? "git" : "bulk-candidate";
}

/**
 * Retention classification, in precedence order. The sealed inputs (`brief.md`,
 * `reference.png`), the sealed result (`proof.json`, `proof-artifacts/`), the run identity
 * (`sweep.json`), the source and its playtests are the minimal reproducibility proof and stay
 * in Git. Screenshots, capture media, agent transcripts, media files and vendored tarballs are
 * the bulk candidates a phase-2 provider may one day carry — classified here, moved nowhere.
 * Proof outranks file extension: a PNG under `proof-artifacts/` is proof, not bulk.
 */
function classifyEvidenceRole(relativePath: string): EvidenceRole {
  const segments = relativePath.split("/");
  const top = segments[0] as string;
  const base = segments[segments.length - 1] as string;
  if (relativePath === "sweep.json") return "sweep-manifest";
  if (
    relativePath === "proof.json" ||
    relativePath === "brief.md" ||
    relativePath === "reference.png" ||
    top === "proof-artifacts"
  )
    return "proof";
  if (top === "playtests") return "playtest";
  if (top === "starter-baseline" || top === "framework-types") return "baseline";
  if (top === "src") return "source";
  if (top === "screenshots" || top === "captures") return "capture";
  if (top === "vendor") return "vendor";
  if (/\.jsonl\.gz$|\.log$/u.test(base)) return "transcript";
  if (/\.(?:png|jpe?g|webp|gif|avif|glb|gltf|ogg|mp3|wav|webm|mp4|tgz|zip|ktx2|bin)$/u.test(base))
    return "media";
  return "config";
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const GIT_COMMIT_HEX = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

export interface IEvidenceFileEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly role: EvidenceRole;
  readonly retention: EvidenceRetention;
}

export interface IEvidenceTotals {
  readonly files: number;
  readonly gitFiles: number;
  readonly bulkFiles: number;
  readonly gitBytes: number;
  readonly bulkBytes: number;
}

export interface IEvidenceManifest {
  readonly manifestVersion: number;
  readonly generator: string;
  readonly generatorVersion: string;
  readonly createdAt: string;
  /** Full sha of the commit the archiver ran from; null only when no checkout was available. */
  readonly sourceCommit: string | null;
  readonly sweep: SweepManifest;
  readonly sweepIdentity: string;
  readonly files: readonly IEvidenceFileEntry[];
  readonly totals: IEvidenceTotals;
}

export interface IEvidenceVerifyResult {
  readonly archive: string;
  readonly status: "verified";
  readonly sweepIdentity: string;
  readonly totals: IEvidenceTotals;
}

export interface IStoreEntryReport {
  readonly archive: string;
  readonly status: "verified" | "legacy" | "failed";
  readonly sweepIdentity?: string;
  readonly error?: string;
}

export interface IStoreVerifyReport {
  readonly store: string;
  readonly verified: number;
  readonly legacy: number;
  readonly failed: number;
  readonly entries: readonly IStoreEntryReport[];
}

export interface IEvidenceRenderOptions {
  /** Checkout the source commit is read from; defaults to this repository. */
  readonly repo?: string;
  /** Overrides git detection (unit fixtures, dry runs). Must be a full sha or null. */
  readonly sourceCommit?: string | null;
  /** Overrides the creation timestamp (deterministic tests). */
  readonly now?: () => Date;
}

/**
 * A stable identity for the run an archive evidences, recomputed by the verifier from the
 * embedded sweep record so a tampered identity cannot survive verification.
 */
export function sweepIdentity(sweep: SweepManifest): string {
  return [
    sweep.arm,
    sweep.genre,
    sweep.date,
    sweep.briefHash.slice(0, 12),
    sweep.proofHash.slice(0, 12),
  ].join(":");
}

/**
 * A manifest entry path must name a file inside the archive and nothing else. Absolute paths,
 * backslash separators, NUL bytes, empty/dot/dot-dot segments and the reserved manifest name
 * are all rejected before anything is read from disk.
 */
export function assertSafeArchivePath(candidate: string): void {
  if (typeof candidate !== "string" || candidate.length === 0)
    throw new Error(`Evidence path must be a non-empty string, got: ${String(candidate)}`);
  if (candidate.includes("\\"))
    throw new Error(`Evidence path traversal rejected (backslash separator): '${candidate}'`);
  if (candidate.includes("\0"))
    throw new Error(`Evidence path traversal rejected (NUL byte): '${candidate}'`);
  if (candidate.startsWith("/") || path.isAbsolute(candidate))
    throw new Error(`Evidence path traversal rejected (absolute path): '${candidate}'`);
  const badSegment = candidate
    .split("/")
    .find((segment) => segment === "" || segment === "." || segment === "..");
  if (badSegment !== undefined)
    throw new Error(`Evidence path traversal rejected ('${badSegment}' segment): '${candidate}'`);
  if (path.posix.normalize(candidate) !== candidate)
    throw new Error(`Evidence path traversal rejected (not normalized): '${candidate}'`);
  if (candidate === EVIDENCE_MANIFEST_FILE)
    throw new Error(`'${EVIDENCE_MANIFEST_FILE}' is reserved and cannot be an inventory entry.`);
}

/** Mirrors `readManifest` in make-sandbox.ts; local because that helper only reads files. */
function assertValidSweep(value: unknown, file: string): asserts value is SweepManifest {
  const sweep = value as Partial<SweepManifest> | null;
  if (typeof sweep !== "object" || sweep === null || Array.isArray(sweep))
    throw new Error(`Malformed evidence manifest '${file}': sweep must be an object.`);
  for (const key of [
    "arm",
    "genre",
    "briefHash",
    "proofHash",
    "template",
    "date",
    "frameworkVersion",
    "sourceLines",
  ] as const) {
    if (sweep[key] === undefined)
      throw new Error(`Malformed evidence manifest '${file}': sweep is missing ${key}.`);
  }
  for (const key of ["briefHash", "proofHash"] as const) {
    if (typeof sweep[key] !== "string" || !SHA256_HEX.test(sweep[key]))
      throw new Error(
        `Malformed evidence manifest '${file}': sweep.${key} must be a 64-char lowercase sha256.`,
      );
  }
  for (const key of ["template", "frameworkVersion"] as const) {
    if (typeof sweep[key] !== "string" || sweep[key].trim() === "")
      throw new Error(
        `Malformed evidence manifest '${file}': sweep.${key} must be a non-empty string.`,
      );
  }
  assertSweepScalars(sweep, file);
}

function assertSweepScalars(
  sweep: Partial<SweepManifest>,
  file: string,
): asserts sweep is SweepManifest {
  if (sweep.arm !== "framework" && sweep.arm !== "vanilla")
    throw new Error(
      `Malformed evidence manifest '${file}': sweep.arm must be framework or vanilla.`,
    );
  if (typeof sweep.genre !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(sweep.genre))
    throw new Error(`Malformed evidence manifest '${file}': sweep.genre must be a lowercase slug.`);
  if (typeof sweep.date !== "string" || !ISO_TIMESTAMP.test(sweep.date))
    throw new Error(`Malformed evidence manifest '${file}': sweep.date must be an ISO timestamp.`);
  if (
    typeof sweep.sourceLines !== "number" ||
    !Number.isInteger(sweep.sourceLines) ||
    sweep.sourceLines < 0
  )
    throw new Error(
      `Malformed evidence manifest '${file}': sweep.sourceLines must be a non-negative integer.`,
    );
}

function assertValidEntry(
  value: unknown,
  file: string,
  index: number,
): asserts value is IEvidenceFileEntry {
  const entry = value as Partial<IEvidenceFileEntry> | null;
  const where = `evidence manifest '${file}' file entry #${index}`;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry))
    throw new Error(`Malformed ${where}: entry must be an object.`);
  if (typeof entry.path !== "string") throw new Error(`Malformed ${where}: path must be a string.`);
  assertSafeArchivePath(entry.path);
  if (typeof entry.sha256 !== "string" || !SHA256_HEX.test(entry.sha256))
    throw new Error(
      `Malformed ${where} ('${entry.path}'): sha256 must be a 64-char lowercase hex digest.`,
    );
  if (typeof entry.bytes !== "number" || !Number.isInteger(entry.bytes) || entry.bytes < 0)
    throw new Error(`Malformed ${where} ('${entry.path}'): bytes must be a non-negative integer.`);
  if (typeof entry.role !== "string" || !EVIDENCE_ROLES.includes(entry.role as EvidenceRole))
    throw new Error(`Malformed ${where} ('${entry.path}'): unknown role '${String(entry.role)}'.`);
  if (entry.retention !== "git" && entry.retention !== "bulk-candidate")
    throw new Error(
      `Malformed ${where} ('${entry.path}'): retention must be 'git' or 'bulk-candidate'.`,
    );
  if (entry.retention !== retentionForRole(entry.role as EvidenceRole))
    throw new Error(
      `Malformed ${where} ('${entry.path}'): retention '${entry.retention}' contradicts role '${entry.role}'.`,
    );
}

export function computeTotals(files: readonly IEvidenceFileEntry[]): IEvidenceTotals {
  let gitFiles = 0;
  let bulkFiles = 0;
  let gitBytes = 0;
  let bulkBytes = 0;
  for (const entry of files) {
    if (entry.retention === "git") {
      gitFiles += 1;
      gitBytes += entry.bytes;
    } else {
      bulkFiles += 1;
      bulkBytes += entry.bytes;
    }
  }
  return { files: files.length, gitFiles, bulkFiles, gitBytes, bulkBytes };
}

function assertManifestProvenance(manifest: Partial<IEvidenceManifest>, file: string): void {
  if (manifest.manifestVersion !== EVIDENCE_MANIFEST_VERSION)
    throw new Error(
      `Malformed evidence manifest '${file}': unsupported manifestVersion ${String(manifest.manifestVersion)}; this generator writes ${EVIDENCE_MANIFEST_VERSION}.`,
    );
  if (manifest.generator !== EVIDENCE_GENERATOR)
    throw new Error(
      `Malformed evidence manifest '${file}': unknown generator '${String(manifest.generator)}'.`,
    );
  if (typeof manifest.generatorVersion !== "string" || manifest.generatorVersion.trim() === "")
    throw new Error(
      `Malformed evidence manifest '${file}': generatorVersion must be a non-empty string.`,
    );
  if (typeof manifest.createdAt !== "string" || !ISO_TIMESTAMP.test(manifest.createdAt))
    throw new Error(`Malformed evidence manifest '${file}': createdAt must be an ISO timestamp.`);
  if (
    manifest.sourceCommit !== null &&
    (typeof manifest.sourceCommit !== "string" || !GIT_COMMIT_HEX.test(manifest.sourceCommit))
  )
    throw new Error(
      `Malformed evidence manifest '${file}': sourceCommit must be null or a full git sha.`,
    );
}

function assertValidInventory(value: unknown, file: string): readonly IEvidenceFileEntry[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`Malformed evidence manifest '${file}': files must be a non-empty array.`);
  const files = value.map((entry, index) => {
    assertValidEntry(entry, file, index);
    return entry as IEvidenceFileEntry;
  });
  const seen = new Set<string>();
  for (const entry of files) {
    if (seen.has(entry.path))
      throw new Error(
        `Malformed evidence manifest '${file}': duplicate file identity '${entry.path}'.`,
      );
    seen.add(entry.path);
  }
  for (const required of REQUIRED_PROOF_PATHS) {
    if (!seen.has(required))
      throw new Error(
        `Evidence manifest '${file}' is missing its required proof: '${required}' is not inventoried.`,
      );
  }
  return files;
}

function assertValidTotals(
  value: unknown,
  files: readonly IEvidenceFileEntry[],
  file: string,
): IEvidenceTotals {
  const totals = value as Partial<IEvidenceTotals> | null;
  if (typeof totals !== "object" || totals === null || Array.isArray(totals))
    throw new Error(`Malformed evidence manifest '${file}': totals must be an object.`);
  const expectedTotals = computeTotals(files);
  for (const key of ["files", "gitFiles", "bulkFiles", "gitBytes", "bulkBytes"] as const) {
    if (totals[key] !== expectedTotals[key])
      throw new Error(
        `Malformed evidence manifest '${file}': totals.${key} is ${String(totals[key])}; the inventoried files sum to ${expectedTotals[key]}.`,
      );
  }
  return expectedTotals;
}

/**
 * Parse and structurally validate a manifest from disk. No archive bytes are checked here —
 * that is `verifyEvidenceManifest`.
 */
export function readEvidenceManifest(archiveRoot: string): IEvidenceManifest {
  const archive = path.resolve(archiveRoot);
  const file = path.join(archive, EVIDENCE_MANIFEST_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Malformed evidence manifest '${file}': not valid JSON (${reason}).`);
  }
  const manifest = parsed as Partial<IEvidenceManifest> | null;
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest))
    throw new Error(`Malformed evidence manifest '${file}': top level must be an object.`);
  assertManifestProvenance(manifest, file);
  assertValidSweep(manifest.sweep, file);
  const expectedIdentity = sweepIdentity(manifest.sweep);
  if (manifest.sweepIdentity !== expectedIdentity)
    throw new Error(
      `Malformed evidence manifest '${file}': sweepIdentity '${String(manifest.sweepIdentity)}' does not match the recorded sweep (expected '${expectedIdentity}').`,
    );
  const files = assertValidInventory(manifest.files, file);
  const totals = assertValidTotals(manifest.totals, files, file);
  return { ...manifest, files, totals } as IEvidenceManifest;
}

function collectEvidenceFiles(directory: string, prefix = ""): string[] {
  const found: string[] = [];
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink())
      throw new Error(`Refusing to inventory symlinked evidence: '${relative}'.`);
    if (entry.isDirectory()) {
      found.push(...collectEvidenceFiles(path.join(directory, entry.name), relative));
      continue;
    }
    if (!entry.isFile())
      throw new Error(`Refusing to inventory non-regular evidence entry: '${relative}'.`);
    // The manifest never inventories itself: re-rendering over an existing manifest stays honest.
    if (relative === EVIDENCE_MANIFEST_FILE) continue;
    found.push(relative);
  }
  return found;
}

function hashEvidenceFile(
  archive: string,
  relativePath: string,
): { sha256: string; bytes: number } {
  const contents = fs.readFileSync(path.join(archive, ...relativePath.split("/")));
  return {
    sha256: createHash("sha256").update(contents).digest("hex"),
    bytes: contents.byteLength,
  };
}

function detectSourceCommit(repo: string): string | null {
  try {
    // Only trust a commit whose repository toplevel is exactly the checkout we were handed:
    // a fixture living beneath someone else's repository must not inherit its provenance.
    const toplevel = execFileSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    if (path.resolve(toplevel) !== path.resolve(repo)) return null;
    const commit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    return GIT_COMMIT_HEX.test(commit) ? commit : null;
  } catch {
    // Not a git checkout (unit fixtures, dry runs): record the absence honestly instead of a lie.
    return null;
  }
}

function readSweepFromArchive(archive: string): SweepManifest {
  const sweepFile = path.join(archive, "sweep.json");
  if (!fs.existsSync(sweepFile))
    throw new Error(`Cannot render an evidence manifest for '${archive}': missing sweep.json.`);
  let sweep: unknown;
  try {
    sweep = JSON.parse(fs.readFileSync(sweepFile, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot render an evidence manifest for '${archive}': sweep.json is not valid JSON (${reason}).`,
    );
  }
  assertValidSweep(sweep, sweepFile);
  return sweep;
}

function resolveSourceCommit(options: IEvidenceRenderOptions): string | null {
  if (options.sourceCommit !== undefined) {
    if (options.sourceCommit !== null && !GIT_COMMIT_HEX.test(options.sourceCommit))
      throw new Error(
        `sourceCommit override must be null or a full git sha, got '${String(options.sourceCommit)}'.`,
      );
    return options.sourceCommit;
  }
  return detectSourceCommit(options.repo ?? REPO);
}

export function renderEvidenceManifest(
  archiveRoot: string,
  options: IEvidenceRenderOptions = {},
): IEvidenceManifest {
  const archive = path.resolve(archiveRoot);
  if (!fs.existsSync(archive) || !fs.statSync(archive).isDirectory())
    throw new Error(`Evidence archive does not exist or is not a directory: ${archive}`);
  const sweep = readSweepFromArchive(archive);
  for (const required of REQUIRED_PROOF_PATHS) {
    if (!fs.existsSync(path.join(archive, ...required.split("/"))))
      throw new Error(
        `Archive '${archive}' is missing its required proof '${required}'; refusing to certify it.`,
      );
  }
  const sourceCommit = resolveSourceCommit(options);
  const files: IEvidenceFileEntry[] = collectEvidenceFiles(archive).map((relativePath) => {
    const { sha256, bytes } = hashEvidenceFile(archive, relativePath);
    const role = classifyEvidenceRole(relativePath);
    return { path: relativePath, sha256, bytes, role, retention: retentionForRole(role) };
  });
  files.sort((left, right) => left.path.localeCompare(right.path));
  const now = options.now ?? (() => new Date());
  return {
    manifestVersion: EVIDENCE_MANIFEST_VERSION,
    generator: EVIDENCE_GENERATOR,
    generatorVersion: EVIDENCE_GENERATOR_VERSION,
    createdAt: now().toISOString(),
    sourceCommit,
    sweep,
    sweepIdentity: sweepIdentity(sweep),
    files,
    totals: computeTotals(files),
  };
}

export function writeEvidenceManifest(
  archiveRoot: string,
  options: IEvidenceRenderOptions = {},
): IEvidenceManifest {
  const manifest = renderEvidenceManifest(archiveRoot, options);
  fs.writeFileSync(
    path.join(path.resolve(archiveRoot), EVIDENCE_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

/**
 * Re-hash every inventoried file against the manifest and demand the inventory cover the tree.
 * Fails closed on: a changed file (hash mismatch), a deleted file, an unlisted file, a missing
 * manifest, or any malformed manifest.
 */
export function verifyEvidenceManifest(archiveRoot: string): IEvidenceVerifyResult {
  const archive = path.resolve(archiveRoot);
  if (!fs.existsSync(path.join(archive, EVIDENCE_MANIFEST_FILE)))
    throw new Error(
      `No evidence manifest in '${archive}': '${EVIDENCE_MANIFEST_FILE}' is missing, so the archive carries no verifiable identity.`,
    );
  const manifest = readEvidenceManifest(archive);
  for (const entry of manifest.files) {
    const file = path.join(archive, ...entry.path.split("/"));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile())
      throw new Error(
        `evidence file missing from archive: '${entry.path}' (manifest records ${entry.bytes} bytes).`,
      );
    const actual = hashEvidenceFile(archive, entry.path);
    if (actual.sha256 !== entry.sha256)
      throw new Error(
        `evidence hash mismatch: '${entry.path}' manifest sha256 ${entry.sha256} != archive sha256 ${actual.sha256}.`,
      );
  }
  const listed = new Set(manifest.files.map((entry) => entry.path));
  for (const relativePath of collectEvidenceFiles(archive)) {
    if (!listed.has(relativePath))
      throw new Error(
        `Unlisted evidence file in archive: '${relativePath}' is not covered by the manifest inventory.`,
      );
  }
  return {
    archive,
    status: "verified",
    sweepIdentity: manifest.sweepIdentity,
    totals: manifest.totals,
  };
}

/**
 * Walk a sweeps store. Archives predating manifests report "legacy" and are left byte-for-byte
 * untouched — phase 1 never rewrites or deletes existing evidence. Only archives claiming a
 * manifest can fail, and a failure is collected, never swallowed.
 */
function classifyStoreChild(store: string, name: string): IStoreEntryReport | undefined {
  const archive = path.join(store, name);
  if (fs.existsSync(path.join(archive, EVIDENCE_MANIFEST_FILE))) {
    try {
      const result = verifyEvidenceManifest(archive);
      return { archive, status: "verified", sweepIdentity: result.sweepIdentity };
    } catch (error) {
      return {
        archive,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (fs.existsSync(path.join(archive, "sweep.json"))) return { archive, status: "legacy" };
  return undefined;
}

export function verifySweepStore(storeRoot: string): IStoreVerifyReport {
  const store = path.resolve(storeRoot);
  if (!fs.existsSync(store) || !fs.statSync(store).isDirectory())
    throw new Error(`Evidence store does not exist or is not a directory: ${store}`);
  const children = fs
    .readdirSync(store, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const entries = children
    .flatMap((child) => (child.isDirectory() ? [classifyStoreChild(store, child.name)] : []))
    .filter((entry): entry is IStoreEntryReport => entry !== undefined);
  return {
    store,
    verified: entries.filter((entry) => entry.status === "verified").length,
    legacy: entries.filter((entry) => entry.status === "legacy").length,
    failed: entries.filter((entry) => entry.status === "failed").length,
    entries,
  };
}

function printTotals(totals: IEvidenceTotals): void {
  process.stdout.write(
    `  files: ${totals.files} (git-retained: ${totals.gitFiles} / ${totals.gitBytes} bytes, bulk-candidate: ${totals.bulkFiles} / ${totals.bulkBytes} bytes)\n`,
  );
}

function main(): void {
  const [command, target] = process.argv.slice(2);
  if (
    (command !== "render" && command !== "verify" && command !== "verify-store") ||
    target === undefined
  ) {
    process.stderr.write(
      "usage: pnpm tsx scripts/sweep-evidence.ts <render|verify|verify-store> <archive-or-store>\n",
    );
    process.exitCode = 1;
    return;
  }
  try {
    if (command === "render") {
      const manifest = writeEvidenceManifest(target);
      process.stdout.write(
        `evidence manifest written: ${path.join(path.resolve(target), EVIDENCE_MANIFEST_FILE)}\n`,
      );
      process.stdout.write(`  sweep identity: ${manifest.sweepIdentity}\n`);
      printTotals(manifest.totals);
      return;
    }
    if (command === "verify") {
      const result = verifyEvidenceManifest(target);
      process.stdout.write(`evidence verified: ${result.archive}\n`);
      process.stdout.write(`  sweep identity: ${result.sweepIdentity}\n`);
      printTotals(result.totals);
      return;
    }
    const report = verifySweepStore(target);
    for (const entry of report.entries)
      process.stdout.write(
        `  ${entry.status.padEnd(8)} ${path.basename(entry.archive)}${entry.error ? ` — ${entry.error}` : ""}\n`,
      );
    process.stdout.write(
      `evidence store: ${report.verified} verified, ${report.legacy} legacy (untouched), ${report.failed} failed\n`,
    );
    if (report.failed > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
