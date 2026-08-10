import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

test('standalone Android multi-touch proof is rootless, fail-closed, and parity-ready', () => {
  const source = readFileSync(join(root, 'scripts/verify-android-multitouch.mjs'), 'utf8');
  assert.match(source, /adb-emu-event-protocol-b/);
  assert.match(source, /setPointers\(\[\]\).*catch/u, 'pointer slots must release in finally');
  assert.match(source, /One-pointer negative control must reach assertions and fail/u);
  assert.match(source, /maxPointers/);
  assert.match(source, /movedWithTwoPointers/);
  assert.match(source, /leftGroundWithTwoPointers/);
  assert.match(source, /currentPointers/);
  assert.doesNotMatch(source, /su\s+-c|adb[^\n]*root/u, 'proof must not require root');
});

test('runtime package exposes one standalone multi-touch command without owning parity orchestration', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(
    manifest.scripts['native:verify:android:multitouch'],
    'pnpm --dir ../playtest build && node scripts/verify-android-multitouch.mjs',
  );
});
