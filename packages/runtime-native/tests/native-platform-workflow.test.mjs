import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const workflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/native-platforms.yml', import.meta.url)),
  'utf8',
);
const releaseWorkflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/native-release.yml', import.meta.url)),
  'utf8',
);
const smokeScenario = (name) => JSON.parse(readFileSync(
  fileURLToPath(new URL(`../../../examples/native-smoke/playtests/${name}`, import.meta.url)),
  'utf8',
));

test('desktop platform lanes build and retain executable evidence', () => {
  for (const token of [
    'runner: macos-15',
    'runner: windows-2025',
    'native:build',
    'native:verify:desktop',
    'curl:x64-windows-static',
    'packages/runtime-native/artifacts/',
    'if-no-files-found: error',
  ]) {
    expect(workflow).toContain(token);
  }
  expect(workflow.indexOf('pnpm --filter @threenative/playtest build')).toBeLessThan(
    workflow.indexOf('pnpm --filter @threenative/core build'),
  );
  for (const source of [workflow, releaseWorkflow]) {
    expect(source).toContain('libcurl4-openssl-dev');
    expect(source).toContain('libfontconfig1-dev');
    expect(source).toContain('zlib1g-dev');
    expect(source).toContain('libx11-dev');
    expect(source).toContain('vswhere.exe');
    expect(source).toContain('set "CC=cl"');
    expect(source).toContain('set "CXX=cl"');
    expect(source).toContain('set "VCPKG_ROOT=%VCPKG_INSTALLATION_ROOT%"');
    expect(source).toContain('where cl');
    expect(source).toContain('shell: cmd');
    expect(source).toContain("if: runner.os != 'Windows'");
  }
});

test('iOS lane executes simulator proof and negative-control tests on an Apple runner', () => {
  expect(workflow).toMatch(/ios-simulator:[\s\S]*runs-on: macos-15/);
  expect(workflow).toContain('rustup target add aarch64-apple-ios-sim');
  expect(workflow).toContain('verify-ios-simulator.mjs');
  expect(workflow).toContain('ios-driver.spec.ts');
  expect(workflow).toContain('ios-device-playtest.spec.ts');
  expect(workflow).toContain('native-ios-simulator');
  for (const source of [workflow, releaseWorkflow]) {
    expect(source).toContain('physics-parity.scenario.json');
  }
  for (const token of [
    'threenative-ios-simulator-arm64.zip',
    'pnpm --dir "$IOS_CONSUMER_TARGET" build --target ios',
    'ios-toolchain-invocations.log',
    '--target ios --app "$app"',
    'physics-wrong-height.playtest.json',
    'physics-mask.playtest.json',
    'THREENATIVE_PHYSICS_CONTROL=masked',
    'THREENATIVE_PHYSICS_CONTROL=wrong-gravity',
  ]) {
    expect(workflow).toContain(token);
  }
});

test('native physics controls assert the parity scene surface', () => {
  const normal = smokeScenario('physics.playtest.json');
  const wrongHeight = smokeScenario('physics-wrong-height.playtest.json');
  const masked = smokeScenario('physics-mask.playtest.json');
  expect(normal.assert.resources.map(({ path }) => path)).toEqual([
    'parity.steps',
    'parity.grounded',
  ]);
  expect(normal.assert.movement.entity).toBe('dynamicBox');
  expect(normal.assert.movement.minDistance).toBe(0.5);
  expect(normal.assert.resources.find(({ path }) => path === 'parity.grounded').allowTrivial).toBe(true);
  expect(wrongHeight.assert.movement.entity).toBe('dynamicBox');
  expect(masked.assert.resources.map(({ path }) => path)).toEqual([
    'parity.collisionEventSet',
    'parity.control',
  ]);
});
