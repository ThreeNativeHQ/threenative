import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

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

/**
 * The final-artifact census.
 *
 * An ELF check over the build directory proves nothing about what shipped: the packaged APK is a
 * different set of bytes, assembled by Gradle from prebuilts, AARs and transitive dependencies that
 * the runtime checkout never names. The library that broke 16 KB devices was always one nobody
 * listed. So the census enumerates what the archive actually contains and refuses to credit an
 * inspection that covered nothing.
 *
 * Two independent alignment facts live in an APK and both are required:
 *
 * 1. **ELF LOAD alignment** — each `lib/<abi>/*.so` must carry 2**14 segments, the check above.
 * 2. **ZIP alignment** — a library stored uncompressed (`extractNativeLibs="false"`, which is the
 *    default since AGP 4.2) is mapped straight out of the APK, so its *data offset inside the
 *    archive* must also be 16 KB aligned. A perfectly aligned ELF at a 4 KB archive offset still
 *    fails to load on a 16 KB device.
 */

const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_FILE_HEADER = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;

/** `lib/<abi>/<name>.so` — the only entries Android maps as native code. */
export const ANDROID_LIBRARY_ENTRY = /^lib\/([^/]+)\/([^/]+\.so)$/u;

/**
 * Read an archive's entries from its central directory.
 *
 * Deliberately not shelling out to `unzip -l`: the data offset of each entry is the number this
 * check exists to read, and no listing tool prints it.
 */
export function readZipEntries(archivePath) {
  const bytes = readFileSync(archivePath);
  let end = -1;
  // The EOCD is last, but a trailing comment can push it back up to 64 KB.
  for (let offset = bytes.length - 22; offset >= 0 && offset >= bytes.length - 22 - 0xffff; offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }
  if (end === -1) {
    throw new Error(`Android artifact ${archivePath} is not a ZIP archive: no end-of-central-directory record`);
  }
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== ZIP_CENTRAL_FILE_HEADER) {
      throw new Error(`Android artifact ${archivePath} has a corrupt central directory at entry ${index}`);
    }
    const compression = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (bytes.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER) {
      throw new Error(`Android artifact ${archivePath} has a corrupt local header for ${name}`);
    }
    // The local header repeats the name and carries its *own* extra field, which is what zipalign
    // pads. Read the length from there; the central directory's copy is a different value.
    const dataOffset =
      localHeaderOffset +
      30 +
      bytes.readUInt16LE(localHeaderOffset + 26) +
      bytes.readUInt16LE(localHeaderOffset + 28);
    entries.push({ name, compression, size, compressedSize, dataOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return { bytes, entries };
}

/**
 * Group the packaged libraries by ABI and refuse a census that proves nothing.
 *
 * An empty result is the failure this function exists for. Reporting "0 libraries inspected, all
 * aligned" is how an uninspected dependency gets credited as compatible.
 */
export function androidArtifactLibraryCensus(entries, { abis = ANDROID_16KB_ABIS, artifactPath = '<artifact>' } = {}) {
  const census = new Map(abis.map((abi) => [abi, []]));
  const unexpected = [];
  for (const entry of entries) {
    const match = ANDROID_LIBRARY_ENTRY.exec(entry.name);
    if (!match) continue;
    const [, abi] = match;
    if (census.has(abi)) census.get(abi).push(entry);
    else unexpected.push(entry.name);
  }
  if (unexpected.length > 0) {
    // A third ABI is not a harmless extra: it ships to devices and nothing above declared it.
    throw new Error(
      `Android 16 KB census found libraries for undeclared ABIs in ${artifactPath}: ${unexpected.join(', ')}`,
    );
  }
  const empty = [...census].filter(([, found]) => found.length === 0).map(([abi]) => abi);
  if (empty.length > 0) {
    throw new Error(
      `Android 16 KB census found no native libraries for ${empty.join(', ')} in ${artifactPath}; ` +
        'an artifact with an uninspected or omitted ABI cannot be credited as 16 KB compatible',
    );
  }
  return census;
}

/** Where to find the SDK's `zipalign`, the official archive-alignment tool. */
export function resolveZipalignCandidates(env = process.env) {
  const candidates = [];
  if (env.TN_ZIPALIGN) candidates.push(env.TN_ZIPALIGN);
  const sdkRoot = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (sdkRoot && existsSync(join(sdkRoot, 'build-tools'))) {
    try {
      for (const version of readdirSync(join(sdkRoot, 'build-tools')).sort().reverse())
        candidates.push(join(sdkRoot, 'build-tools', version, 'zipalign'));
    } catch {
      // An unreadable build-tools directory just means this candidate does not exist.
    }
  }
  candidates.push('zipalign');
  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
}

/**
 * Corroborate the archive offsets above with the SDK's own `zipalign -c -P 16`.
 *
 * The parser is authoritative — it always runs, and a check that can be skipped is not a gate. But
 * an independent implementation of the same rule is cheap where the SDK is installed, and a
 * disagreement between the two is worth failing on. Returns the tool that confirmed, or `null`
 * when no `zipalign` is installed.
 */
export function verifyArchiveAlignmentWithZipalign(artifactPath, options = {}) {
  const candidates = options.zipalign ? [options.zipalign] : resolveZipalignCandidates();
  const run =
    options.runZipalign ??
    ((tool) => execFileSync(tool, ['-c', '-P', '16', '-v', '4', artifactPath], { encoding: 'utf8' }));
  for (const candidate of candidates) {
    try {
      run(candidate);
      return candidate;
    } catch (error) {
      // A tool that ran and disagreed is a verdict; a tool that is not installed is not.
      if (typeof error?.status === 'number') {
        const detail = String(error.stdout ?? '')
          .split(/\r?\n/u)
          .filter((line) => /BAD|FAIL/iu.test(line))
          .slice(0, 8)
          .join('; ');
        const failure = new Error(
          `Android 16 KB alignment check failed for ${artifactPath}: ` +
            `${candidate} -c -P 16 exited ${error.status}${detail ? ` (${detail})` : ''}`,
        );
        failure.code = 'ANDROID_16KB_MISALIGNED';
        throw failure;
      }
    }
  }
  return null;
}

/**
 * Inspect a finished Android artifact: every packaged library, on every declared ABI, for both
 * ELF LOAD alignment and uncompressed archive alignment.
 *
 * `options` reaches both halves: `runObjdump`/`objdump` select the ELF reader, and `zipalign:
 * false` suppresses the SDK corroboration for callers that have no SDK.
 *
 * Returns the inspected libraries — so the caller can print what was actually covered — plus the
 * `zipalign` binary that corroborated the archive offsets, or `null` where none is installed.
 * Throws on the first misaligned library, on an omitted ABI, and on an archive it cannot read.
 */
export function assertAndroidArtifact16KbAlignment(artifactPath, options = {}) {
  if (!existsSync(artifactPath)) {
    throw new Error(`Android 16 KB artifact check cannot read ${artifactPath}`);
  }
  const { bytes, entries } = readZipEntries(artifactPath);
  const census = androidArtifactLibraryCensus(entries, { ...options, artifactPath });
  // Archive geometry first, then ELF contents. An uncompressed library is mapped straight out of
  // the APK, so its offset inside the archive is part of the contract; a deflated one is unpacked
  // to the filesystem at install and is not. Reading every offset before extracting anything also
  // keeps the reported failure independent of the order entries happen to sit in.
  for (const [, libraries] of census) {
    for (const entry of libraries) {
      if (entry.compression === ZIP_STORED && entry.dataOffset % ANDROID_16KB_ALIGNMENT !== 0) {
        const error = new Error(
          `Android 16 KB alignment check failed for ${artifactPath}!${entry.name}: ` +
            `uncompressed library stored at archive offset 0x${entry.dataOffset.toString(16)}, ` +
            'which is not a multiple of 0x4000',
        );
        error.code = 'ANDROID_16KB_MISALIGNED';
        throw error;
      }
    }
  }
  const scratch = mkdtempSync(join(tmpdir(), 'tn-16kb-artifact-'));
  try {
    const inspected = [];
    for (const [abi, libraries] of census) {
      for (const entry of libraries) {
        const extracted = join(scratch, `${abi}-${entry.name.split('/').pop()}`);
        const raw = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
        if (entry.compression === ZIP_STORED) writeFileSync(extracted, raw);
        else if (entry.compression === ZIP_DEFLATED) writeFileSync(extracted, inflateRawSync(raw));
        else {
          throw new Error(
            `Android 16 KB alignment check cannot read ${entry.name} in ${artifactPath}: ` +
              `unsupported ZIP compression method ${entry.compression}`,
          );
        }
        const [result] = assertAndroid16KbAlignment([extracted], options);
        inspected.push({
          abi,
          entry: entry.name,
          compression: entry.compression === ZIP_STORED ? 'stored' : 'deflated',
          dataOffset: entry.dataOffset,
          alignments: result.alignments,
        });
      }
    }
    const zipalign = options.zipalign === false ? null : verifyArchiveAlignmentWithZipalign(artifactPath, options);
    return { artifactPath, libraries: inspected, zipalign };
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}
