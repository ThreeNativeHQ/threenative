import assert from 'node:assert/strict';
import { test } from 'vitest';

import { retryAsWindowsShim } from '../scripts/native-test-lane.mjs';

// Windows installs npm-published CLIs as `.cmd` shims, and `spawnSync` does not apply PATHEXT the
// way a shell does. The Windows desktop leg died on `spawnSync pnpm ENOENT` inside
// `verify-desktop-physics.mjs` — after the audio fix let it get that far for the first time.
test('only a bare command name is retried as a Windows shim', () => {
  assert.equal(retryAsWindowsShim('pnpm', 'win32'), 'pnpm.cmd');
  assert.equal(retryAsWindowsShim('npx', 'win32'), 'npx.cmd');

  // Real executables must not be rewritten: `node.cmd` and `cmake.cmd` do not exist, so a blanket
  // rewrite would break every command that already resolves.
  assert.equal(retryAsWindowsShim('mystral.exe', 'win32'), undefined);
  assert.equal(retryAsWindowsShim('pnpm.cmd', 'win32'), undefined);

  // An explicit path is already resolved; retrying it as a shim would look somewhere else.
  assert.equal(retryAsWindowsShim('C:\\tools\\pnpm', 'win32'), undefined);
  assert.equal(retryAsWindowsShim('./scripts/pnpm', 'win32'), undefined);

  // Nothing changes anywhere else.
  assert.equal(retryAsWindowsShim('pnpm', 'linux'), undefined);
  assert.equal(retryAsWindowsShim('pnpm', 'darwin'), undefined);
});
