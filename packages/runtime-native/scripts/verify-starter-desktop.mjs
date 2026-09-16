#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export * from './verify-starter-desktop-base.mjs';
export * from './verify-starter-consumer.mjs';

// PRD-365 owns the installed desktop-container verifier and PRD-375 its brand inspection; PRD-366
// adds consumer-gameplay qualification without forking or replacing either. Imports see every
// contract through the re-exports above -- including `verifyContainerBrand`, so `--brand-only` and
// its callers keep resolving through this path. The CLI keeps the historical desktop behavior
// unless the consumer route is explicitly requested, so `--brand-only` and `--config` reach the
// base file's hardened flag parser rather than being re-implemented here.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const directory = dirname(fileURLToPath(import.meta.url));
  const consumer = process.argv.includes('--consumer') || process.argv.includes('--qualify-existing');
  const target = join(
    directory,
    consumer ? 'verify-starter-consumer.mjs' : 'verify-starter-desktop-base.mjs',
  );
  const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(Number.isInteger(result.status) ? result.status : 1);
}
