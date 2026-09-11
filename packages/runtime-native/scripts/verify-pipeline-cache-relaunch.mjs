#!/usr/bin/env node
// Real independent host processes, including exit without destructors. Never a timing benchmark.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [executableArg, outputArg, scopeArg] = process.argv.slice(2);
const lifecycleOnly = scopeArg === "--envelope-lifecycle-only";
if (scopeArg && !lifecycleOnly) throw new Error("unknown relaunch scope");
if (!executableArg) throw new Error('usage: verify-pipeline-cache-relaunch.mjs <host-contract-executable> [output-directory]');
const executable = resolve(executableArg);
const output = resolve(outputArg ?? 'artifacts/pipeline-cache-relaunch');
mkdirSync(output, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'tn-pipeline-relaunch-'));
const digest = (data) => createHash('sha256').update(data).digest('hex');
let file;
let sequence = 0;
function run(arm, disabled = false) {
  const name = `${String(++sequence).padStart(2, '0')}-${arm}`;
  const child = spawnSync(executable, [arm], {
    env: { ...process.env, XDG_DATA_HOME: root, TN_PIPELINE_CACHE: disabled ? '0' : '1', MESA_SHADER_CACHE_DISABLE: 'true' },
    encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  });
  const log = `${child.stdout ?? ''}\n${child.stderr ?? ''}`;
  writeFileSync(join(output, `${name}.log`), log);
  assert.ifError(child.error);
  assert.equal(child.status, 0, `${arm} exited ${child.status} (${child.signal}):\n${log.slice(-5000)}`);
  assert.match(log, /persistent cache (?:relaunch|shutdown) contract passed/);
  if (arm.startsWith('disabled')) assert.match(log, /host cache mode=disabled renderAttached=0 computeAttached=0/, 'disabled controls must actually compile through the host');
  assert.equal(log.includes('TN_PIPELINE_TEST_SCOPE:envelope-lifecycle-only; compiled-data-proof=false'), lifecycleOnly, 'requested scope must match the actual executable');
  const records = log.split('\n').filter((line) => line.startsWith('TN_PIPELINE_CACHE:'))
    .map((line) => JSON.parse(line.slice('TN_PIPELINE_CACHE:'.length)));
  assert.ok(records.length > 0, 'missing real cache observations');
  writeFileSync(join(output, `${name}.json`), `${JSON.stringify(records, null, 2)}\n`);
  console.log(`PASS independent-process cache ${arm}`);
}
try {
  run('missing');
  const cacheRoot = join(root, 'mystral/storage/pipeline-cache-v1');
  const apps = readdirSync(cacheRoot);
  assert.equal(apps.length, 1);
  file = join(cacheRoot, apps[0], 'cache.bin');
  assert.ok(existsSync(file));
  run('accepted');
  const beforeDisabled = digest(readFileSync(file));
  const disableFile = join(root, 'mystral/storage/pipeline-cache.disabled');
  writeFileSync(disableFile, '');
  run('disabled-file');
  rmSync(disableFile);
  assert.equal(digest(readFileSync(file)), beforeDisabled, 'app-private control altered cache data');
  run('disabled', true);
  assert.equal(digest(readFileSync(file)), beforeDisabled, 'disabled process altered compiler data');
  const corrupt = readFileSync(file);
  corrupt[corrupt.length - 1] ^= 0xff;
  writeFileSync(file, corrupt);
  run('rejected');
  // Keep a correct envelope around invalid backend bytes. Proves the strict import refusal,
  // not just the SHA-256 prefilter; ordinary compilation and a later store must still succeed.
  const backendCorrupt = readFileSync(file);
  backendCorrupt[80] ^= 0xff;
  createHash('sha256').update(backendCorrupt.subarray(80)).digest().copy(backendCorrupt, 48);
  writeFileSync(file, backendCorrupt);
  run('backend-rejected');
  run('changed-source');
  run('rejected'); // restore original bundled-source identity
  run('concurrent');
  run('shutdown');
  run('device-lost');
  chmodSync(dirname(file), 0o555);
  run('read-only');
  chmodSync(dirname(file), 0o700);
  assert.ok(readdirSync(dirname(file)).length <= 3, 'unbounded per-generation files');
  writeFileSync(join(output, 'result.json'), `${JSON.stringify({ status: 'passed', scope: lifecycleOnly ? 'envelope-lifecycle-only' : 'compiled-data-relaunch', compiledDataProof: !lifecycleOnly, processArms: 12, firstPlayableClaim: false, physicalDeviceClaim: false }, null, 2)}\n`);
} finally {
  if (file && existsSync(dirname(file))) chmodSync(dirname(file), 0o700);
  rmSync(root, { recursive: true, force: true });
}
