#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CONTAINER_MANIFEST, resolveContainer } from './desktop-distribution.mjs';
import { verifyWindowsUninstall } from './windows-installer.mjs';

// Exercise the exact final setup: no rebuilding or substitution of its executable.
const { values } = parseArgs({ options: {
  installer: { type: 'string' }, project: { type: 'string' },
  scenario: { type: 'string' }, artifacts: { type: 'string' },
  'require-signed': { type: 'boolean', default: false },
} });
if (process.platform !== 'win32') throw new Error('TN_INSTALLER_VERIFY_HOST: run this command on Windows.');
for (const key of ['installer', 'project', 'scenario']) {
  if (!values[key]) throw new Error(`TN_INSTALLER_VERIFY_ARGUMENT: --${key} is required.`);
}
const installer = resolve(values.installer);
const project = resolve(values.project);
const scenario = resolve(values.scenario);
const artifacts = resolve(values.artifacts ?? join(project, 'artifacts/windows-installer'));
const cli = join(project, 'node_modules/@threenative/playtest/dist/runner/cli.js');
for (const path of [installer, scenario, cli]) assert.ok(existsSync(path), `Missing verification input: ${path}`);
const temporary = mkdtempSync(join(tmpdir(), 'tn-installer-proof-'));
const directory = join(temporary, 'Installed Game');
const container = join(directory, 'game');
function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 180_000, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed with status ${result.status}`);
}
try {
  // NSIS consumes the unquoted final /D= path, even when it contains spaces.
  run(installer, ['/S', `/D=${directory}`], { windowsVerbatimArguments: true, argv0: `"${installer}"` });
  const manifest = resolveContainer(container);
  if (values['require-signed']) assert.equal(manifest.signed, true, 'Signed installer qualification requires a signed release');
  assert.equal(manifest.platform, 'win32-x64');
  const executable = join(container, manifest.executable);
  const uninstaller = join(directory, 'Uninstall.exe');
  assert.ok(existsSync(uninstaller), 'Installer did not provide an uninstaller');
  if (manifest.signed) {
    for (const target of [installer, executable, uninstaller]) run('signtool', ['verify', '/pa', target]);
  }
  run(process.execPath, [cli, scenario, '--target', 'desktop', '--executable', executable,
    '--project', project, '--artifacts', artifacts, '--host-arg', '--windowed']);
  run(uninstaller, ['/S', `_?=${directory}`], { windowsVerbatimArguments: true, argv0: `"${uninstaller}"` });
  const remaining = verifyWindowsUninstall(directory, [...Object.keys(manifest.resources), CONTAINER_MANIFEST]);
  // _?= makes uninstall synchronous; Windows keeps the running uninstaller until it exits.
  rmSync(uninstaller, { force: true });
  if (remaining.length) {
    console.log(`TN_WINDOWS_INSTALLER_UNOWNED_RETAINED:${JSON.stringify({ directory, entries: remaining })}`);
  } else {
    if (existsSync(directory)) rmdirSync(directory);
    rmdirSync(temporary);
  }
  console.log(`TN_WINDOWS_INSTALLER_PASS: ${installer}; installed gameplay and uninstall passed`);
} catch (error) {
  console.error(`TN_WINDOWS_INSTALLER_PROOF_RETAINED: ${temporary}`);
  throw error;
}
