import { execFileSync } from "node:child_process";

export interface IVerifyNativeReleaseCommitOptions {
  readonly candidateSha: string;
  readonly lookup?: NativeReleaseCommitLookup;
  readonly tag: string;
}

export type NativeReleaseCommitLookup = (tag: string) => string | undefined;

function remoteTagCommit(tag: string): string | undefined {
  for (const ref of [`refs/tags/${tag}^{}`, `refs/tags/${tag}`]) {
    let output: string;
    try {
      output = execFileSync("git", ["ls-remote", "origin", ref], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      throw new Error(
        `TN_NATIVE_RELEASE_TAG_LOOKUP_FAILED: could not query ${tag}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const commit = output.trim().split(/\s+/u)[0];
    if (commit !== undefined && commit.length > 0) return commit;
  }
  return undefined;
}

export function verifyNativeReleaseCommit(options: IVerifyNativeReleaseCommitOptions): string {
  if (options.tag.length === 0)
    throw new Error("TN_NATIVE_RELEASE_TAG_MISSING: the native release tag is empty.");
  if (options.candidateSha.length === 0)
    throw new Error("TN_NATIVE_RELEASE_CANDIDATE_MISSING: GITHUB_SHA is empty.");
  const commit = (options.lookup ?? remoteTagCommit)(options.tag);
  if (commit === undefined)
    throw new Error(
      `TN_NATIVE_RELEASE_TAG_MISSING: could not resolve native release tag ${options.tag}.`,
    );
  if (commit !== options.candidateSha)
    throw new Error(
      `TN_NATIVE_RELEASE_SHA_MISMATCH: native tag ${options.tag} resolves to ${commit}; expected the exact candidate SHA ${options.candidateSha}.`,
    );
  return commit;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tag = process.argv[2];
  try {
    verifyNativeReleaseCommit({
      candidateSha: process.env.GITHUB_SHA ?? "",
      tag: tag ?? "",
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
