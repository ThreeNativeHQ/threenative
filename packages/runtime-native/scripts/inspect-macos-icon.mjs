import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const INVALID = 'TN_NATIVE_STARTER_CONTAINER_MACOS_ICON_INVALID';
const MISMATCH = 'TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH';
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const GENERATED_NAMES = [16, 32, 128, 256, 512].flatMap((size) => [
  `icon_${size}x${size}.png`, `icon_${size}x${size}@2x.png`,
]);

function assertIcns(bytes) {
  if (bytes.length < 16 || bytes.toString('ascii', 0, 4) !== 'icns' ||
      bytes.readUInt32BE(4) !== bytes.length) {
    throw new Error(`${INVALID}: the packaged icon is not a complete, nonempty ICNS file.`);
  }
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error(`${INVALID}: truncated ICNS element.`);
    const size = bytes.readUInt32BE(offset + 4);
    if (size <= 8 || size > bytes.length - offset) {
      throw new Error(`${INVALID}: invalid ICNS element length.`);
    }
    offset += size;
  }
}

function iconTool(run, command, args) {
  const result = run(command, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${INVALID}: ${command} could not inspect the icon (${result.error?.message ?? result.status ?? 'no exit status'}). ` +
      'Run the brand verifier on macOS with iconutil and sips available; metadata alone is not icon proof.',
    );
  }
}

function pngImage(path, pixels) {
  const bytes = readFileSync(path);
  // Bound the decoder by the representation's dimensions, not by untrusted IHDR allocation sizes.
  if (bytes.length < 33 || bytes.length > 32 * 1024 * 1024 ||
      !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.readUInt32BE(8) !== 13 ||
      bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(16) !== pixels || bytes.readUInt32BE(20) !== pixels) {
    throw new Error(`${INVALID}: ${path} is not a ${pixels}x${pixels} PNG representation.`);
  }
  try {
    return PNG.sync.read(bytes);
  } catch (error) {
    throw new Error(`${INVALID}: cannot decode ${path}: ${error.message}`);
  }
}

/** Compare decoded RGBA, never PNG encoding, ancillary metadata, or a source-hash assertion. */
export function assertIconPixels(actual, expected, name) {
  for (const image of [actual, expected]) {
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
        image.width < 1 || image.width > 1024 || image.height < 1 || image.height > 1024 ||
        !Buffer.isBuffer(image.data) || image.data.length !== image.width * image.height * 4) {
      throw new Error(`${INVALID}: ${name} has no complete decoded RGBA image.`);
    }
  }
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(`${MISMATCH}: decoded macOS icon ${name} dimensions differ from app.icon.`);
  }
  // Converters may discard hidden RGB beneath zero alpha. Canonicalize only invisible pixels;
  // every visible channel, including partial transparency, must still match exactly.
  const canonical = Buffer.from(actual.data);
  for (let offset = 0; offset < canonical.length; offset += 4) {
    const alpha = actual.data[offset + 3];
    if (alpha !== expected.data[offset + 3] || (alpha !== 0 &&
        !actual.data.subarray(offset, offset + 3).equals(expected.data.subarray(offset, offset + 3)))) {
      throw new Error(`${MISMATCH}: decoded macOS icon ${name} differs from app.icon.`);
    }
    if (alpha === 0) canonical.fill(0, offset, offset + 3);
  }
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Read back every iconutil representation of the final .icns. The packager's PNG -> sips ->
 * iconutil path is compared at decoded RGBA, so compression/metadata differences cannot pass for
 * artwork or reject identical artwork. Authored .icns inputs must remain byte-identical and still
 * decode successfully. This proves artifact content, not Finder/Dock appearance or a GUI launch.
 * `run` is the same command-boundary seam used by desktop-distribution.mjs; production uses the OS.
 */
export function inspectMacosIcon(icon, source, { run = spawnSync } = {}) {
  const bytes = readFileSync(icon);
  assertIcns(bytes);
  const authoredIcns = source.endsWith('.icns'); // Match buildIcon's existing copy-vs-convert rule.
  if (authoredIcns && !bytes.equals(readFileSync(source))) {
    throw new Error(`${MISMATCH}: the packaged ICNS differs from the authored ICNS.`);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'threenative-icon-inspection-'));
  try {
    const decoded = join(scratch, 'actual.iconset');
    iconTool(run, 'iconutil', ['-c', 'iconset', '-o', decoded, icon]);
    if (!lstatSync(decoded).isDirectory() || lstatSync(decoded).isSymbolicLink()) {
      throw new Error(`${INVALID}: iconutil did not produce an iconset directory.`);
    }
    const entries = readdirSync(decoded, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length === 0 || entries.length > 32) {
      throw new Error(`${INVALID}: iconutil produced no bounded set of icon representations.`);
    }
    if (!authoredIcns && GENERATED_NAMES.some((name) => !entries.some((entry) => entry.name === name))) {
      throw new Error(`${INVALID}: the converted icon is missing a size or scale generated by the packager.`);
    }
    const representations = [];
    for (const entry of entries) {
      const match = /^icon_(\d+)x\1(@2x)?\.png$/u.exec(entry.name);
      const pixels = match ? Number(match[1]) * (match[2] ? 2 : 1) : 0;
      if (!entry.isFile() || !match || pixels < 1 || pixels > 1024) {
        throw new Error(`${INVALID}: unexpected iconutil output ${entry.name}.`);
      }
      const actual = pngImage(join(decoded, entry.name), pixels);
      let expected = actual;
      if (!authoredIcns) {
        const reference = join(scratch, 'expected.png');
        rmSync(reference, { force: true });
        iconTool(run, 'sips', ['-z', String(pixels), String(pixels), source, '--out', reference]);
        expected = pngImage(reference, pixels);
      }
      representations.push({
        name: entry.name,
        width: actual.width,
        height: actual.height,
        rgbaSha256: assertIconPixels(actual, expected, entry.name),
      });
    }
    return { method: 'iconutil-decoded-rgba', representations };
  } catch (error) {
    if (error.message?.startsWith('TN_')) throw error;
    throw new Error(`${INVALID}: could not read iconutil output: ${error.message}`);
  } finally {
    // Never modify the signed app or put scratch resources inside the distributed container.
    rmSync(scratch, { recursive: true, force: true });
  }
}
