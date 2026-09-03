#!/usr/bin/env node
// Give the native sources the mtime of the commit that last touched them.
//
// `actions/checkout` writes every file with the time it ran, so a build directory restored from
// cache is always older than its own inputs and ninja rebuilds all of it. Content-wise the tree is
// identical to the commit; only the timestamps are new. Rewriting them to the commit time makes
// them deterministic across checkouts, so an unchanged source really is unchanged and the restored
// objects are used — while a source that did move gets a newer commit time and is rebuilt, which
// is the property that keeps this from being a way to ship stale objects.
//
// Scoped to the native tree on purpose. It is the only build here that keeps compiled output
// across runs, and touching 8,700 files to help one of them would be its own kind of silly.
import { execFileSync } from "node:child_process";
import { statSync, utimesSync } from "node:fs";
import path from "node:path";

const runtimeRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(runtimeRoot, "../..");
const scopes = ["src", "include", "tests", "cmake", "CMakeLists.txt", "CMakePresets.json"];

/** `git log` walks newest-first, so the first time a path appears is the commit that last set it. */
function lastCommitTimes() {
  const output = execFileSync(
    "git",
    ["log", "--format=%n%at", "--name-only", "--no-renames", "--", ...scopes],
    { cwd: runtimeRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const times = new Map();
  let stamp;
  for (const line of output.split("\n")) {
    if (line === "") continue;
    if (/^\d+$/u.test(line)) {
      stamp = Number(line);
      continue;
    }
    if (stamp !== undefined && !times.has(line)) times.set(line, stamp);
  }
  return times;
}

/**
 * Files whose working tree differs from HEAD.
 *
 * Stamping one of those with its last *commit* time would date an edit that is newer than any
 * commit, and ninja would skip rebuilding it — the one way this script could hand someone a stale
 * object. CI always checks out a commit and has none, so in the lane this is empty; on a developer
 * machine it is exactly the files being worked on.
 */
function locallyModified() {
  const output = execFileSync("git", ["status", "--porcelain", "--", ...scopes], {
    cwd: runtimeRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const dirty = new Set();
  for (const line of output.split("\n")) {
    const file = line.slice(3).trim();
    if (file !== "") dirty.add(file);
  }
  return dirty;
}

const dirty = locallyModified();
const times = lastCommitTimes();
if (times.size === 0) {
  throw new Error("TN_MTIME_NO_HISTORY: git log reported no files under the native source scopes.");
}

let restored = 0;
let skipped = 0;
for (const [relative, stamp] of times) {
  if (dirty.has(relative)) {
    skipped += 1;
    continue;
  }
  const file = path.join(repoRoot, relative);
  let current;
  try {
    current = statSync(file);
  } catch {
    continue; // deleted since that commit; nothing to stamp.
  }
  if (Math.floor(current.mtimeMs / 1000) === stamp) continue;
  utimesSync(file, stamp, stamp);
  restored += 1;
}
process.stdout.write(
  `native sources restored to commit time: ${restored} of ${times.size} files` +
    (skipped > 0 ? `; ${skipped} left alone because they differ from HEAD` : "") +
    "\n",
);
