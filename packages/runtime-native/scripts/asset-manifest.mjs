/**
 * Which files in a compiled asset directory the packagers stage.
 *
 * `threenative build` compiles a project's assets into its output root (`public/`) beside a
 * manifest (`assets.manifest.json`) and a receipt (`bake.receipt.json`). Copying only what the
 * build named was the first attempt and it broke real games: measured on real sandbox builds,
 * `public/` holds hand-placed runtime files the manifest never names — wildwood's 536 files
 * including `audio/*.ogg`, fps-framework's 100 `.glb`/`.jpg`, lumen-hall's and menu-spike's
 * `basis/basis_transcoder.*`. Dropping those breaks KTX2 on native.
 *
 * So the rule is inverted: copy everything EXCEPT what is provably junk, and print every skip.
 *
 * 1. Editor and VCS leftovers anywhere in the tree, by basename — `*.orig`, `*.rej`, `*.bak`,
 *    `*.swp`, `*~`, `.DS_Store`, `Thumbs.db`, `.gitkeep`.
 * 2. Superseded digest outputs, only when a manifest is present: a `<stem>.<8 hex>.<ext>` whose
 *    manifest names a different-hash `<stem>.*.<ext>` in the same directory and not this one.
 *    A digest-shaped file whose stem the manifest never names is kept — it may be hand-placed.
 * 3. Everything else, including hand-placed files and the bookkeeping the runtime needs
 *    (the manifest and the bake receipt both ship, as they did before this rule).
 *
 * A file the manifest names but disk lacks fails closed with `TN_ASSETS_MANIFEST_MISSING`. With
 * no manifest, rule 1 still applies and rule 2 does not.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";

export const ASSET_MANIFEST_NAME = "assets.manifest.json";
const RECEIPT_NAME = "bake.receipt.json";

/** Basenames that are always an editor's or a VCS's dropping, never a shipped asset. */
const LEFTOVER_NAMES = new Set([".DS_Store", "Thumbs.db", ".gitkeep"]);
const LEFTOVER_SUFFIXES = [".orig", ".rej", ".bak", ".swp", "~"];
/** `<stem>.<8 lowercase hex>.<ext>` — the shape `threenative build` writes a compiled digest as. */
const DIGEST = /^(?<stem>.+)\.(?<hash>[0-9a-f]{8})\.(?<ext>[^.]+)$/u;

/**
 * Every file under `directory`, as `/`-separated paths relative to it, sorted.
 *
 * A symlink or any other non-file entry is refused rather than silently dropped: a package that
 * quietly omits an input is the failure this whole file exists to prevent.
 */
export function listFiles(directory, relative = "") {
  const files = [];
  for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
    const path = relative ? posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(directory, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported asset entry: ${join(directory, path)}`);
  }
  return files.sort();
}

/** The paths one manifest entry names beyond its own `output`: array fields carrying records. */
function entryOutputs(entry) {
  if (!entry || typeof entry !== "object") return [];
  const outputs = [];
  if (typeof entry.output === "string") outputs.push(entry.output);
  for (const field of Object.values(entry)) {
    if (!Array.isArray(field)) continue;
    for (const auxiliary of field) {
      if (
        auxiliary &&
        typeof auxiliary === "object" &&
        typeof auxiliary.output === "string"
      )
        outputs.push(auxiliary.output);
    }
  }
  return outputs;
}

/** The payloads the bake's receipt owns beyond the manifest, or none when it is absent or unreadable. */
function readReceiptOutputs(receiptPath) {
  if (!existsSync(receiptPath)) return [];
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    return Array.isArray(receipt?.outputs)
      ? receipt.outputs.flatMap((output) =>
          typeof output?.path === "string" ? [output.path] : [],
        )
      : [];
  } catch {
    // A corrupt receipt must not fail the package; the manifest still governs, and it is the file
    // the runtime reads. The receipt's own bytes still ship with the rest of the directory.
    return [];
  }
}

/** An editor's or VCS's dropping, keyed by basename anywhere in the tree. */
function isEditorLeftover(file) {
  const name = basename(file);
  return LEFTOVER_NAMES.has(name) || LEFTOVER_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** The `<stem>, <hash>, <ext>` a digest-shaped basename carries, or `null` when it is not one. */
function digestParts(file) {
  const match = DIGEST.exec(basename(file));
  return match === null
    ? null
    : { stem: match.groups.stem, hash: match.groups.hash, ext: match.groups.ext };
}

/**
 * The manifest-named path that supersedes `file`, or `null` when nothing does.
 *
 * Only a same-directory named file with the same `<stem>` and `<ext>` but a different hash
 * supersedes; a digest-shaped file whose stem the manifest never names is kept, because it may be
 * hand-placed rather than an older output.
 */
function supersededBy(file, named) {
  const digest = digestParts(file);
  if (digest === null) return null;
  const directory = dirname(file);
  for (const candidate of [...named].sort()) {
    if (candidate === file || dirname(candidate) !== directory) continue;
    const other = digestParts(candidate);
    if (other !== null && other.stem === digest.stem && other.ext === digest.ext) return candidate;
  }
  return null;
}

/**
 * The files to copy from a compiled asset directory: everything except provable junk.
 *
 * Editor leftovers are skipped everywhere, printed with `(editor leftover)`. With a manifest, a
 * digest output superseded by a differently-hashed sibling is skipped and printed with
 * `(superseded by <path>)`, and a file the manifest named but disk lacks fails closed with
 * `TN_ASSETS_MANIFEST_MISSING`. Without a manifest only the editor rule applies.
 */
export function selectManifestAssets(assets, { log = console.log } = {}) {
  const manifestPath = join(assets, ASSET_MANIFEST_NAME);
  const hasManifest = existsSync(manifestPath);
  const named = new Set();
  if (hasManifest) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(
        `TN_ASSETS_MANIFEST_INVALID: '${manifestPath}' is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (
      manifest?.version !== 1 ||
      typeof manifest.entries !== "object" ||
      manifest.entries === null ||
      Array.isArray(manifest.entries)
    ) {
      throw new Error(`TN_ASSETS_MANIFEST_INVALID: '${manifestPath}' must hold version 1 entries.`);
    }
    for (const entry of Object.values(manifest.entries))
      for (const output of entryOutputs(entry)) named.add(output);
    for (const output of readReceiptOutputs(join(assets, RECEIPT_NAME))) named.add(output);
  }

  const present = listFiles(assets);
  if (hasManifest) {
    for (const file of [...named].sort()) {
      if (!present.includes(file)) {
        throw new Error(
          `TN_ASSETS_MANIFEST_MISSING: '${file}' is named by '${ASSET_MANIFEST_NAME}' but was not found under ${assets}.`,
        );
      }
    }
  }

  const selected = [];
  for (const file of present) {
    if (hasManifest && named.has(file)) {
      selected.push(file);
      continue;
    }
    if (isEditorLeftover(file)) {
      log(`ThreeNative packaging: skipped ${file} (editor leftover)`);
      continue;
    }
    if (hasManifest) {
      const superseding = supersededBy(file, named);
      if (superseding !== null) {
        log(`ThreeNative packaging: skipped ${file} (superseded by ${superseding})`);
        continue;
      }
    }
    selected.push(file);
  }
  return selected;
}
