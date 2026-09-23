/**
 * A bundle that cannot compile must stop the launch loudly, not open a window and spin.
 *
 * This is a real failure that shipped in a working session: a game bundle carried a bare
 * `import.meta` (a build-time replacement that missed because the expression was indirected), V8
 * refused to compile it as a script, the compile failure returned `undefined` — which every caller
 * reads as success — and the host started its main loop anyway. The developer saw a blue window
 * that never changed, the loop ran at 145,000 frames a second, `presents` stayed at 0, and the only
 * trace was one line of stderr nobody was reading.
 *
 * The assertion that matters is not the message: it is that the process **exits non-zero without
 * starting the main loop**. A launch that survives a bundle which never evaluated is the failure.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { afterEach, test } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const hostBinary = join(repoRoot, 'packages/runtime-native/build/tn-linux/mystral');

const created = [];

afterEach(() => {
  while (created.length > 0) rmSync(created.pop(), { recursive: true, force: true });
});

/** Run the built host on `bundle`, returning its exit code and combined output. */
function runHost(bundle) {
  try {
    const stdout = execFileSync(hostBinary, ['run', bundle, '--no-sdl'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return {
      code: typeof error.status === 'number' ? error.status : -1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

test.skipIf(!existsSync(hostBinary))(
  'a bundle that cannot compile exits non-zero, names itself, and never starts the loop',
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'tn-fatal-'));
    created.push(dir);
    const bundle = join(dir, 'cannot-compile.js');
    // Exactly the shape that shipped: a bare `import.meta` in a script that is not a module.
    writeFileSync(bundle, 'const meta = import.meta;\nconsole.log("unreachable", meta);\n');

    const { code, output } = runHost(bundle);

    assert.notEqual(code, 0, `the host must not report success for a bundle that never loaded: ${output}`);
    assert.match(output, /\[TN_FATAL\]/u, `the failure must be greppable: ${output}`);
    assert.ok(output.includes(bundle), `the failure must name the bundle: ${output}`);
    assert.ok(
      !output.includes('Starting main loop'),
      `the main loop must not start after a failed load: ${output}`,
    );
    assert.ok(
      !output.includes('unreachable'),
      `no part of a bundle that failed to compile may run: ${output}`,
    );
  },
);
