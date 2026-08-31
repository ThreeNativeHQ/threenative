import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const ANDROID_16KB_ABIS = Object.freeze(['arm64-v8a', 'x86_64']);

/**
 * Where to find an objdump that can read an arm64 shared object.
 *
 * `llvm-objdump` is not on a GitHub Ubuntu runner's PATH, so the check failed to *start* and the
 * Android lane reported it as "Failed to download v8-android" — a tool that was missing, read as
 * a dependency that was broken. The NDK ships one, and any job that reaches this check is
 * building for Android, so it has an NDK. Look there before PATH.
 *
 * Ubuntu's GNU `objdump` prints the same `align 2**N` field this module parses, but its BFD is
 * usually configured for the host target only and refuses an arm64 object, so it is the last
 * resort rather than the first.
 */
export function resolveObjdumpCandidates(env = process.env) {
  const candidates = [];
  if (env.TN_LLVM_OBJDUMP) candidates.push(env.TN_LLVM_OBJDUMP);

  const ndkRoots = [env.ANDROID_NDK_HOME, env.ANDROID_NDK_ROOT, env.ANDROID_NDK].filter(Boolean);
  const sdkRoot = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (sdkRoot && existsSync(join(sdkRoot, 'ndk'))) {
    try {
      // Newest NDK first: the directory names are versions, and a newer llvm-objdump reads
      // everything an older one does.
      for (const version of readdirSync(join(sdkRoot, 'ndk')).sort().reverse())
        ndkRoots.push(join(sdkRoot, 'ndk', version));
    } catch {
      // An unreadable SDK directory is not this check's problem; fall through to PATH.
    }
  }
  for (const ndk of ndkRoots) {
    const prebuilt = join(ndk, 'toolchains', 'llvm', 'prebuilt');
    if (!existsSync(prebuilt)) continue;
    try {
      for (const host of readdirSync(prebuilt))
        candidates.push(join(prebuilt, host, 'bin', 'llvm-objdump'));
    } catch {
      // Same: an unreadable toolchain directory just means this candidate does not exist.
    }
  }

  candidates.push('llvm-objdump', 'objdump');
  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
}
export const ANDROID_16KB_ALIGNMENT = 2 ** 14;

function alignmentDescription(alignment) {
  return `0x${alignment.toString(16)} (2**${Math.log2(alignment)})`;
}

export function parseLoadSegmentAlignments(output, libraryPath = '<library>') {
  const alignments = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!/^\s*LOAD\b/u.test(line)) continue;
    const match = /\balign\s+(?:2\*\*(\d+)|0x([0-9a-f]+))\b/iu.exec(line);
    if (!match) {
      throw new Error(`Android 16 KB alignment check could not read LOAD alignment for ${libraryPath}`);
    }
    const alignment = match[1] ? 2 ** Number(match[1]) : Number.parseInt(match[2], 16);
    if (!Number.isSafeInteger(alignment) || alignment <= 0) {
      throw new Error(`Android 16 KB alignment check read an invalid LOAD alignment for ${libraryPath}`);
    }
    alignments.push(alignment);
  }
  if (alignments.length === 0) {
    throw new Error(`Android 16 KB alignment check found no LOAD segments in ${libraryPath}`);
  }
  return alignments;
}

export function assertAndroid16KbAlignment(libraries, options = {}) {
  if (!Array.isArray(libraries) || libraries.length === 0) {
    throw new Error('Android 16 KB alignment check requires at least one shared library');
  }

  const candidates = options.objdump ? [options.objdump] : resolveObjdumpCandidates();
  const runObjdump = options.runObjdump ?? ((libraryPath) => {
    const failures = [];
    for (const candidate of candidates) {
      try {
        return execFileSync(candidate, ['-p', libraryPath], { encoding: 'utf8' });
      } catch (error) {
        failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Name every candidate that was tried. "llvm-objdump ENOENT" alone did not say that three
    // other places had been looked at, which is the first thing the reader needs.
    throw new Error(`no usable objdump (tried ${failures.join('; ')})`);
  });

  return libraries.map((libraryPath) => {
    let output;
    try {
      output = runObjdump(libraryPath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Android 16 KB alignment check could not inspect ${libraryPath}: ${reason}`, {
        cause: error,
      });
    }

    const alignments = parseLoadSegmentAlignments(output, libraryPath);
    const invalid = alignments.filter((alignment) => alignment < ANDROID_16KB_ALIGNMENT);
    if (invalid.length > 0) {
      const observed = alignments.map(alignmentDescription).join(', ');
      const error = new Error(
        `Android 16 KB alignment check failed for ${libraryPath}: ` +
          `LOAD alignments ${observed}; expected every segment >= 0x4000 (2**14)`,
      );
      // Distinguish "this library is misaligned" from "the check could not run". They are
      // different events with different owners, and only the caller knows whether a given
      // library is one this repository builds or one it pins.
      error.code = 'ANDROID_16KB_MISALIGNED';
      error.alignments = alignments;
      throw error;
    }
    return { libraryPath, alignments };
  });
}
