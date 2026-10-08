// The fork ledger: every local change ThreeNative applies to the pinned toolchain, and the corpus
// cases that prove each one is needed.
//
// Zero patches is a valid, expected state — the pinned release passes the corpus as it ships — and
// the ledger states that instead of leaving the question open. `run-corpus.mjs --without-patches`
// provisions the toolchain with no patch applied and requires the red set to equal the declared set
// exactly: a declared case that stays green is a patch nothing needs, a red case the ledger does not
// declare is a fork change nobody owns.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LEDGER_NAME = "patches.json";
export const LEDGER_CODE = "TN_NATIVE_TS_LEDGER";
/** A cache key for a tree no patch touched: the plain upstream cache, so today nothing moves. */
export const UPSTREAM_KEY = "upstream";

function named(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

/** Reads the ledger, or fails closed: a ledger nobody can read must never read as "no patches". */
export function loadLedger(file = path.join(HERE, LEDGER_NAME)) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw named(LEDGER_CODE, `cannot read ${file}: ${error.message}`);
  }
  let ledger;
  try {
    ledger = JSON.parse(text);
  } catch (error) {
    throw named(LEDGER_CODE, `${file} is not JSON: ${error.message}`);
  }
  if (ledger === null || typeof ledger !== "object" || Array.isArray(ledger)) {
    throw named(LEDGER_CODE, `${file} must hold an object`);
  }
  if (ledger.schema !== 1) {
    throw named(
      LEDGER_CODE,
      `${file} has schema ${JSON.stringify(ledger.schema)}, this runner reads 1`,
    );
  }
  if (!Array.isArray(ledger.patches)) {
    throw named(LEDGER_CODE, `${file} has no patches array`);
  }
  const patches = ledger.patches.map((entry, index) => patchEntry(entry, index, file));
  const seen = new Set();
  for (const patch of patches) {
    if (seen.has(patch.id)) throw named(LEDGER_CODE, `${file} declares patch id ${patch.id} twice`);
    seen.add(patch.id);
  }
  return {
    note: typeof ledger.note === "string" ? ledger.note : "",
    patches,
    declaredCases: [...new Set(patches.flatMap((patch) => patch.cases))].sort(),
  };
}

function patchEntry(entry, index, file) {
  const at = `${file} patches[${index}]`;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw named(LEDGER_CODE, `${at} is not an object`);
  }
  for (const key of ["id", "file"]) {
    if (typeof entry[key] !== "string" || entry[key].length === 0) {
      throw named(LEDGER_CODE, `${at} has no ${key}`);
    }
  }
  const { cases } = entry;
  if (
    !Array.isArray(cases) ||
    cases.length === 0 ||
    cases.some((name) => typeof name !== "string" || name.length === 0)
  ) {
    throw named(LEDGER_CODE, `${at} (${entry.id}) declares no minimized corpus case`);
  }
  return { id: entry.id, file: entry.file, cases: [...cases].sort() };
}

/**
 * The cache key for a patch set: `upstream` for none, else a digest of the ids and patch files, so
 * a patched tree can never be served for an unpatched run or the other way round.
 */
export function patchKey(patches = []) {
  if (patches.length === 0) return UPSTREAM_KEY;
  const digest = createHash("sha256");
  for (const patch of [...patches].sort((a, b) => a.id.localeCompare(b.id))) {
    digest.update(`${patch.id} ${patch.file}\n`);
  }
  return `patched-${digest.digest("hex").slice(0, 16)}`;
}

/** Applies every ledger patch inside the extracted toolchain; a patch that does not take is fatal. */
export function applyPatches(toolchainDir, patches = []) {
  for (const patch of patches) {
    const file = path.resolve(HERE, patch.file);
    if (!fs.existsSync(file)) {
      throw named(LEDGER_CODE, `patch ${patch.id} names a missing file ${patch.file}`);
    }
    const applied = spawnSync("patch", ["-p1", "-i", file], {
      cwd: toolchainDir,
      encoding: "utf8",
    });
    if (applied.status !== 0) {
      const first = `${applied.stderr ?? ""}${applied.stdout ?? ""}`.trim().split("\n")[0];
      throw named(
        "TN_NATIVE_TS_PATCH",
        `patch ${patch.id} did not apply in ${toolchainDir}: ${first ?? `patch exited ${applied.status}`}`,
      );
    }
  }
  return patches.length;
}

/**
 * The declared set against the red set a `--without-patches` run observed. `missing` is a declared
 * case that stayed green, so the patch it exists for proves nothing; `extra` is a red case the
 * ledger does not declare. Either one is a difference, and a difference fails the run.
 */
export function compareRedToDeclared(declared, red) {
  const declaredSet = new Set(declared);
  const redSet = new Set(red);
  const sorted = (values) => [...values].sort();
  return {
    ok: declaredSet.size === redSet.size && [...declaredSet].every((name) => redSet.has(name)),
    missing: sorted([...declaredSet].filter((name) => !redSet.has(name))),
    extra: sorted([...redSet].filter((name) => !declaredSet.has(name))),
  };
}
