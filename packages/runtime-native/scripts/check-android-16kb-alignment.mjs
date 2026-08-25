import { execFileSync } from 'node:child_process';

export const ANDROID_16KB_ABIS = Object.freeze(['arm64-v8a', 'x86_64']);
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

  const objdump = options.objdump ?? 'llvm-objdump';
  const runObjdump = options.runObjdump ?? ((libraryPath) =>
    execFileSync(objdump, ['-p', libraryPath], { encoding: 'utf8' }));

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
      throw new Error(
        `Android 16 KB alignment check failed for ${libraryPath}: ` +
          `LOAD alignments ${observed}; expected every segment >= 0x4000 (2**14)`,
      );
    }
    return { libraryPath, alignments };
  });
}
