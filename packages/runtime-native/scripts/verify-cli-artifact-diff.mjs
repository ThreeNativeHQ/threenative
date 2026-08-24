#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error('usage: node scripts/verify-cli-artifact-diff.mjs --before <old-cli> --after <new-cli>');
  }
  return resolve(process.argv[index + 1]);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const beforeCli = argument('--before');
const afterCli = argument('--after');
const workDir = mkdtempSync(join(tmpdir(), 'threenative-cli-artifact-diff-'));
const fixtureDir = join(workDir, 'fixture');
const assetsDir = join(fixtureDir, 'assets');
const entryPath = join(fixtureDir, 'entry.js');
const beforeBundle = join(workDir, 'before.bundle');
const afterBundle = join(workDir, 'after.bundle');

mkdirSync(assetsDir, { recursive: true });
writeFileSync(entryPath, "import './dep.js';\nconsole.log('entry');\n");
writeFileSync(join(fixtureDir, 'dep.js'), "export const answer = 42;\n");
writeFileSync(join(assetsDir, 'data.bin'), Buffer.from([0, 1, 2, 3, 255]));
writeFileSync(join(assetsDir, 'notes.txt'), 'artifact diff fixture\n');

function compile(cli, output) {
  execFileSync(cli, [
    'compile', entryPath,
    '--root', fixtureDir,
    '--out', output,
    '--bundle-only',
    '--quiet',
  ], { cwd: fixtureDir, stdio: 'pipe' });
}

compile(beforeCli, beforeBundle);
compile(afterCli, afterBundle);
const before = readFileSync(beforeBundle);
const after = readFileSync(afterBundle);
const result = {
  beforeBytes: before.length,
  afterBytes: after.length,
  beforeSha256: sha256(before),
  afterSha256: sha256(after),
  byteIdentical: before.equals(after),
};
console.log(JSON.stringify(result, null, 2));
if (!result.byteIdentical) {
  throw new Error('CLI artifacts differ after bundler extraction');
}
