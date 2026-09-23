import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'vitest';

import { makeTempDirSync } from '../../../test-support/temp-dir.js';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function executable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

test.runIf(process.platform === 'linux')(
  'the Linux native build links the desktop UI overlay into the runtime',
  () => {
    const root = makeTempDirSync('threenative-native-build-plan-');
    roots.push(root);
    const scripts = join(root, 'scripts');
    const bin = join(root, 'bin');
    const log = join(root, 'commands.log');
    mkdirSync(scripts, { recursive: true });
    mkdirSync(bin, { recursive: true });
    copyFileSync(
      new URL('../scripts/native-build.mjs', import.meta.url),
      join(scripts, 'native-build.mjs'),
    );
    for (const name of ['build-native-physics.mjs', 'build-native-ui-overlay.mjs']) {
      writeFileSync(
        join(scripts, name),
        `import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.TN_TEST_LOG, ${JSON.stringify(name)} + '\\n');\n`,
      );
    }
    executable(
      join(bin, 'cmake'),
      '#!/bin/sh\nprintf "cmake %s\\n" "$*" >> "$TN_TEST_LOG"\n',
    );
    executable(join(bin, 'ninja'), '#!/bin/sh\nexit 0\n');
    executable(
      join(bin, 'rustc'),
      '#!/bin/sh\nprintf "host: x86_64-unknown-linux-gnu\\n"\n',
    );

    const result = spawnSync(process.execPath, [join(scripts, 'native-build.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        TN_TEST_LOG: log,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const commands = readFileSync(log, 'utf8');
    assert.match(commands, /build-native-ui-overlay\.mjs/u);
    assert.match(commands, /cmake --preset tn-linux .*?-DTN_ENABLE_UI_OVERLAY=ON/u);
    assert.match(
      commands,
      /-DTHREENATIVE_UI_OVERLAY_LIBRARY=.*libthreenative_ui_overlay\.a/u,
    );
  },
);
