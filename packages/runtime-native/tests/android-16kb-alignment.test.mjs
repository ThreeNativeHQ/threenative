import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  ANDROID_16KB_ALIGNMENT,
  assertAndroid16KbAlignment,
  parseLoadSegmentAlignments,
  resolveObjdumpCandidates,
} from '../scripts/check-android-16kb-alignment.mjs';

const aligned = [
  '    LOAD off 0x0 vaddr 0x0 paddr 0x0 align 2**14',
  '    LOAD off 0x4000 vaddr 0x4000 paddr 0x4000 align 2**14',
].join('\n');

const fourKb = [
  '    LOAD off 0x0 vaddr 0x0 paddr 0x0 align 2**12',
  '    LOAD off 0x1000 vaddr 0x1000 paddr 0x1000 align 2**12',
].join('\n');

test('accepts 16 KB-aligned LOAD segments', () => {
  assert.deepEqual(parseLoadSegmentAlignments(aligned, 'libv8android.so'), [ANDROID_16KB_ALIGNMENT, ANDROID_16KB_ALIGNMENT]);
  assert.deepEqual(
    assertAndroid16KbAlignment(['libv8android.so'], { runObjdump: () => aligned }),
    [{ libraryPath: 'libv8android.so', alignments: [ANDROID_16KB_ALIGNMENT, ANDROID_16KB_ALIGNMENT] }],
  );
});

test('rejects a 4 KB library and names the offending file', () => {
  assert.throws(
    () => assertAndroid16KbAlignment(['lib/arm64-v8a/libv8android.so'], { runObjdump: () => fourKb }),
    /Android 16 KB alignment check failed for lib\/arm64-v8a\/libv8android\.so:.*0x1000/u,
  );
});

test('fails closed when objdump has no LOAD alignment output', () => {
  assert.throws(
    () => assertAndroid16KbAlignment(['libv8android.so'], { runObjdump: () => 'file format elf64-littleaarch64' }),
    /found no LOAD segments in libv8android\.so/u,
  );
});

// `llvm-objdump` is not on a GitHub Ubuntu runner's PATH. The check therefore never ran, and the
// Android lane reported the missing tool as `Failed to download v8-android` — a broken instrument
// read as a broken dependency.
test('an NDK toolchain is preferred over PATH, and an explicit override over both', () => {
  const withoutNdk = resolveObjdumpCandidates({});
  assert.deepEqual(withoutNdk, ['llvm-objdump', 'objdump']);

  const overridden = resolveObjdumpCandidates({ TN_LLVM_OBJDUMP: '/opt/llvm/bin/llvm-objdump' });
  assert.equal(overridden[0], '/opt/llvm/bin/llvm-objdump');
  // PATH stays in the list: an override that does not exist must not remove the fallbacks.
  assert.ok(overridden.includes('llvm-objdump'));
});

test('every candidate tried is named when none of them works', () => {
  const attempted = [];
  assert.throws(
    () =>
      assertAndroid16KbAlignment(['/tmp/libv8android.so'], {
        runObjdump: (libraryPath) => {
          attempted.push(libraryPath);
          throw new Error('spawnSync llvm-objdump ENOENT');
        },
      }),
    /could not inspect \/tmp\/libv8android\.so: spawnSync llvm-objdump ENOENT/u,
  );
  assert.deepEqual(attempted, ['/tmp/libv8android.so']);
});

// The two failures must stay distinguishable. A misaligned library is a fact about a dependency
// and has an owner (PRD-221); a check that cannot run is a broken instrument and has none. Reading
// them as the same event is what let `llvm-objdump` go missing while the lane blamed the download.
test('a misaligned library is coded, and an unrunnable check is not', () => {
  const misaligned = [
    '    LOAD off 0x0 vaddr 0x0 paddr 0x0 align 2**12',
    '    LOAD off 0x1000 vaddr 0x1000 paddr 0x1000 align 2**12',
  ].join('\n');
  try {
    assertAndroid16KbAlignment(['/tmp/libv8android.so'], { runObjdump: () => misaligned });
    assert.fail('a 4 KB-aligned library must not pass');
  } catch (error) {
    assert.equal(error.code, 'ANDROID_16KB_MISALIGNED');
    assert.match(error.message, /LOAD alignments 0x1000 \(2\*\*12\)/u);
  }

  try {
    assertAndroid16KbAlignment(['/tmp/libv8android.so'], {
      runObjdump: () => {
        throw new Error('spawnSync llvm-objdump ENOENT');
      },
    });
    assert.fail('an unrunnable check must not pass');
  } catch (error) {
    assert.notEqual(error.code, 'ANDROID_16KB_MISALIGNED');
    assert.match(error.message, /could not inspect/u);
  }
});
