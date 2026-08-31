import { execFileSync } from "node:child_process";
// Packs each arm into a self-contained desktop executable.
//
// Two steps, both of them load-bearing. The native bundler takes one module's default export, so
// each arm is a separate entry — there is no URL on a native host to read a selector out of. And
// `mystral compile` resolves bundled asset paths against its root, so the entry and the assets are
// staged side by side first: the game asks for `assets/quarry-floor.glb` and must find it under
// that name on both targets, or the two lanes are running different code paths to the same file.
//
//   pnpm --filter quarry pack:native
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QUARRY_ARMS, type QuarryArm } from "../src/quarry/arm.js";

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, "..");
const repositoryRoot = resolve(project, "../..");
/**
 * The packed host. `TN_QUARRY_NATIVE_HOST` points at one built elsewhere — a worktree that shares a
 * checkout's runtime-native source does not need its own two-gigabyte build to pack an executable,
 * and a run that borrows one says which build it borrowed.
 */
const host =
  process.env.TN_QUARRY_NATIVE_HOST ??
  resolve(repositoryRoot, "packages/runtime-native/build/tn-linux/mystral");

/** Every arm has a native entry: a feature that works on web only is unfinished. */
const PACKED_ARMS: readonly QuarryArm[] = QUARRY_ARMS;

function main(): void {
  if (!existsSync(host))
    throw new Error(`TN_QUARRY_NO_NATIVE_HOST: ${host} — run \`pnpm native:build\` first.`);
  const assets = resolve(project, "public/assets");
  if (!existsSync(assets))
    throw new Error("TN_QUARRY_NO_ASSETS: run `pnpm --filter quarry bake` first.");

  const output = resolve(project, "dist-native");
  rmSync(output, { force: true, recursive: true });
  const stage = resolve(output, "stage");
  mkdirSync(stage, { recursive: true });
  cpSync(assets, resolve(stage, "assets"), { recursive: true });

  for (const arm of PACKED_ARMS) {
    const bundle = resolve(project, `dist/quarry-${arm}-native.js`);
    if (!existsSync(bundle))
      throw new Error(
        `TN_QUARRY_NO_BUNDLE: ${bundle} — run \`pnpm --filter quarry build:desktop\`.`,
      );
    cpSync(bundle, resolve(stage, `quarry-${arm}-native.js`));
    execFileSync(
      host,
      ["compile", `quarry-${arm}-native.js`, "--include", "assets", "-o", `../quarry-${arm}`],
      { cwd: stage, stdio: "inherit" },
    );
  }
  rmSync(stage, { force: true, recursive: true });
  console.log(`packed ${PACKED_ARMS.join(", ")} into ${output}`);
}

main();
