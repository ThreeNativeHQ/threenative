import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  ANDROID_16KB_ALIGNMENT,
  assertAndroid16KbAlignment,
  parseLoadSegmentAlignments,
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
