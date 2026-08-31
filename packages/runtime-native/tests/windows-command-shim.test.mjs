import assert from 'node:assert/strict';
import { test } from 'vitest';

import { quoteForWindowsShell, retryAsWindowsShim } from '../scripts/native-test-lane.mjs';

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

// Running the shim requires `shell: true` — Node reports EINVAL for a `.cmd` spawned without one,
// which is where the Windows leg landed after the ENOENT was cleared. Under a shell the arguments
// become a single command line, so a path with a space in it splits in two unless it is quoted.
test('only arguments that need quoting are quoted', () => {
  assert.equal(quoteForWindowsShell('--filter'), '--filter');
  assert.equal(quoteForWindowsShell('threenative-native-smoke'), 'threenative-native-smoke');
  assert.equal(quoteForWindowsShell('D:\\a\\threenative'), 'D:\\a\\threenative');

  assert.equal(quoteForWindowsShell('C:\\Program Files\\x'), '"C:\\Program Files\\x"');
  assert.equal(quoteForWindowsShell('a&b'), '"a&b"');
  assert.equal(quoteForWindowsShell('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteForWindowsShell(''), '""');
});
