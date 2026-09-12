#!/usr/bin/env tsx
/**
 * `pnpm release:native` — publish the locally built runtime payload as its GitHub release.
 *
 * The payload is assembled by `release-native-local.mjs` and refused before GitHub is touched when a
 * declared key has no staged asset. Uploading is the only side effect, and it happens only with
 * `--yes`: the lock is staged and uploaded last, so a partial upload leaves an unusable directory
 * rather than a lock advertising bytes that are not there. A re-run is idempotent — `gh release
 * create` only runs when the tag is absent, and every upload clobbers.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const LOCK_NAME = "prebuilt-lock.json";
const RELEASE_TITLE_PREFIX = "ThreeNative runtime";

export interface INativeStaged {
  readonly directory: string;
  readonly keys: readonly string[];
  readonly manifestPath: string;
  readonly repository: string;
  readonly tag: string;
}

export type NativeExec = (
  file: string,
  args: readonly string[],
  options?: Readonly<Record<string, unknown>>,
) => string;

export interface INativeUploadOptions {
  readonly directory: string;
  readonly exec?: NativeExec;
  readonly repository: string;
  readonly tag: string;
}

export interface INativeUploadResult {
  readonly created: boolean;
  readonly tag: string;
  readonly uploaded: readonly string[];
}

/** The GitHub release tag the runtime package's version publishes under. */
export function nativeReleaseTag(repo = REPO): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repo, "packages", "runtime-native", "package.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof manifest.version !== "string" || manifest.version.length === 0)
    throw new Error(
      "TN_RELEASE_NATIVE_VERSION: packages/runtime-native/package.json has no version.",
    );
  return `runtime-native-v${manifest.version}`;
}

/**
 * Whether the tag already exists on GitHub. Only a clean "not found" is `false`; an unauthenticated
 * or unreachable `gh` throws, so an unanswerable check can never be mistaken for "safe to clobber".
 */
export function nativeReleaseExists(
  repository: string,
  tag: string,
  exec: NativeExec = execFileSync as unknown as NativeExec,
): boolean {
  try {
    exec("gh", ["release", "view", tag, "--repo", repository], { stdio: "pipe" });
    return true;
  } catch (error) {
    const text = `${(error as { stderr?: unknown }).stderr ?? ""}${
      error instanceof Error ? error.message : String(error)
    }`;
    if (/release not found|not found|HTTP 404/iu.test(text)) return false;
    throw new Error(
      `TN_RELEASE_NATIVE_VIEW_FAILED: could not determine whether ${tag} exists: ${text.trim()}`,
    );
  }
}

/**
 * Stage the host payload for the current version, or only the named keys.
 *
 * `skipIfReleased` returns `undefined` when the tag already exists, so a CI release lane that
 * publishes npm against a native release it (or the native lane) already produced never re-stages:
 * the official full-cohort lock must not be clobbered by a scoped host-only one. The assembler is
 * plain `.mjs` (it ships to disk untranspiled), so it is imported through a URL.
 */
export async function stageNativeRelease(
  options: {
    readonly directory?: string;
    readonly exec?: NativeExec;
    readonly keys?: readonly string[];
    readonly repo?: string;
    readonly skipIfReleased?: boolean;
    readonly sourceSha?: string;
  } = {},
): Promise<INativeStaged | undefined> {
  const module = (await import(new URL("./release-native-local.mjs", import.meta.url).href)) as {
    RELEASE_REPOSITORY: string;
    stageLocalPayload: (input: Readonly<Record<string, unknown>>) => INativeStaged;
  };
  if (options.skipIfReleased === true) {
    const tag = nativeReleaseTag(options.repo ?? REPO);
    if (nativeReleaseExists(module.RELEASE_REPOSITORY, tag, options.exec)) return undefined;
  }
  return module.stageLocalPayload({ repo: options.repo ?? REPO, ...options });
}

/**
 * Upload every staged asset, and the lock last, refusing if a declared key has no staged file.
 *
 * The refusal is repeated here rather than trusted to staging: a directory can be edited between
 * assembly and upload, and a release that advertises a key whose bytes are absent is exactly the
 * 404 this PRD exists to remove.
 */
export function uploadNativeRelease(options: INativeUploadOptions): INativeUploadResult {
  const exec = options.exec ?? (execFileSync as unknown as NativeExec);
  const entries = fs
    .readdirSync(options.directory)
    .filter((name) => fs.statSync(path.join(options.directory, name)).isFile());
  if (!entries.includes(LOCK_NAME))
    throw new Error(
      `TN_RELEASE_NATIVE_LOCK_MISSING: ${options.directory} carries no ${LOCK_NAME}. Nothing was published.`,
    );
  const manifest = JSON.parse(fs.readFileSync(path.join(options.directory, LOCK_NAME), "utf8")) as {
    artifacts?: Record<string, { url?: unknown } | undefined>;
    requiredKeys?: unknown;
  };
  const artifacts = manifest.artifacts ?? {};
  const declared: readonly string[] = Array.isArray(manifest.requiredKeys)
    ? (manifest.requiredKeys as readonly string[])
    : Object.keys(artifacts);
  const missing = declared.filter((key) => {
    // The lock records the canonical filename in the artifact URL that `generateReleaseManifest`
    // wrote from `PREBUILT_ASSET_NAMES`, so this never re-spells an asset name.
    const url = artifacts[key]?.url;
    const name = typeof url === "string" ? new URL(url).pathname.split("/").pop() : undefined;
    return name === undefined || !entries.includes(name);
  });
  if (missing.length > 0)
    throw new Error(
      `TN_RELEASE_NATIVE_ASSET_MISSING: '${missing.join("', '")}' is declared in the lock but not staged. Nothing was published.`,
    );
  const assets = entries.filter((name) => name !== LOCK_NAME).sort();
  const created = !nativeReleaseExists(options.repository, options.tag, exec);
  if (created)
    exec(
      "gh",
      [
        "release",
        "create",
        options.tag,
        "--repo",
        options.repository,
        "--prerelease",
        "--latest=false",
        "--title",
        `${RELEASE_TITLE_PREFIX} ${options.tag}`,
      ],
      { stdio: "inherit" },
    );
  const uploaded: string[] = [];
  for (const name of [...assets, LOCK_NAME]) {
    exec(
      "gh",
      [
        "release",
        "upload",
        options.tag,
        path.join(options.directory, name),
        "--repo",
        options.repository,
        "--clobber",
      ],
      { stdio: "inherit" },
    );
    uploaded.push(name);
  }
  return { created, tag: options.tag, uploaded };
}

function parseArgs(argv: readonly string[]): { upload: boolean } {
  const upload = argv.includes("--yes");
  const unknown = argv.filter((argument) => !["--yes", "--dry-run"].includes(argument));
  if (unknown.length > 0) throw new Error(`TN_RELEASE_NATIVE_UNKNOWN_FLAG: ${unknown.join(", ")}`);
  return { upload };
}

async function main(argv: readonly string[]): Promise<void> {
  const { upload } = parseArgs(argv);
  const staged = await stageNativeRelease({ repo: REPO });
  if (staged === undefined) {
    process.stdout.write("The native release already exists; nothing to stage.\n");
    return;
  }
  process.stdout.write(
    `Staged ${staged.keys.length} native asset(s) for ${staged.tag} in ${staged.directory}:\n` +
      `${staged.keys.map((key) => `  - ${key}`).join("\n")}\n`,
  );
  if (!upload) {
    process.stdout.write(
      "\nDry run: the payload and its scoped lock are staged, and nothing was uploaded. Re-run with --yes to publish the GitHub release.\n",
    );
    return;
  }
  const result = uploadNativeRelease({
    directory: staged.directory,
    repository: staged.repository,
    tag: staged.tag,
  });
  process.stdout.write(
    `\n${result.created ? "Created" : "Updated"} ${result.tag} with ${result.uploaded.length} asset(s).\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
