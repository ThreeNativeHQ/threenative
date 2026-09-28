// Locate, fetch and verify the pinned OpenRigLogic source. No dependencies.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Upstream repository. */
export const OPENRIGLOGIC_REPO = "https://github.com/EpicGames/OpenRigLogic";

/**
 * The immutable commit this package is built against. RigLogic 13.2.8 / UE 5.8.2,
 * the stable 5.8 line. Never build against a moving branch.
 */
export const OPENRIGLOGIC_COMMIT = "7b9e7a88898f51f29aa308acb4877276f27e1507";

/** Override the whole cache root (source, builds, tools). */
export function openRigLogicRoot() {
  const override = process.env.THREENATIVE_OPENRIGLOGIC_DIR;
  return override && override.length > 0 ? override : join(homedir(), ".cache", "openriglogic");
}

export function openRigLogicSourceDir() {
  return join(openRigLogicRoot(), "src");
}

export function openRigLogicBuildDir(target) {
  return join(openRigLogicRoot(), `build-${target}`);
}

export function openRigLogicToolsDir() {
  return join(openRigLogicRoot(), "tools");
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function openRigLogicRevision(sourceDir = openRigLogicSourceDir()) {
  return git(["rev-parse", "HEAD"], sourceDir);
}

/**
 * Fail closed unless the checked out source is exactly the pinned commit. A drifted
 * checkout would silently change every reference vector, so this is never a warning.
 */
export function verifyPinnedOpenRigLogic(sourceDir = openRigLogicSourceDir()) {
  if (!existsSync(sourceDir)) {
    throw new Error(`OpenRigLogic source is missing at ${sourceDir}. Run ensureOpenRigLogic() first.`);
  }
  const revision = openRigLogicRevision(sourceDir);
  if (revision !== OPENRIGLOGIC_COMMIT) {
    throw new Error(
      `OpenRigLogic revision mismatch in ${sourceDir}: expected ${OPENRIGLOGIC_COMMIT}, found ${revision}.`,
    );
  }
  return revision;
}

/** Clone on first use, otherwise fetch the pinned commit. Verifies the result. */
export function ensureOpenRigLogic() {
  const sourceDir = openRigLogicSourceDir();
  mkdirSync(openRigLogicRoot(), { recursive: true });
  if (!existsSync(join(sourceDir, ".git"))) {
    execFileSync("git", ["clone", "--filter=blob:none", OPENRIGLOGIC_REPO, sourceDir], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  } else {
    git(["fetch", "--filter=blob:none", "origin", OPENRIGLOGIC_COMMIT], sourceDir);
  }
  git(["checkout", "--detach", OPENRIGLOGIC_COMMIT], sourceDir);
  return verifyPinnedOpenRigLogic(sourceDir);
}
