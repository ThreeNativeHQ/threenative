import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const workflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/native-platforms.yml', import.meta.url)),
  'utf8',
);

test('desktop platform lanes build and retain executable evidence', () => {
  for (const token of [
    'runner: macos-15',
    'runner: windows-2025',
    'native:build',
    'native:verify:desktop',
    'packages/runtime-native/artifacts/',
    'if-no-files-found: error',
  ]) {
    expect(workflow).toContain(token);
  }
  expect(workflow.indexOf('pnpm --filter @threenative/playtest build')).toBeLessThan(
    workflow.indexOf('pnpm --filter @threenative/core build'),
  );
});

test('iOS lane executes simulator proof and negative-control tests on an Apple runner', () => {
  expect(workflow).toMatch(/ios-simulator:[\s\S]*runs-on: macos-15/);
  expect(workflow).toContain('rustup target add aarch64-apple-ios-sim');
  expect(workflow).toContain('verify-ios-simulator.mjs');
  expect(workflow).toContain('ios-driver.spec.ts');
  expect(workflow).toContain('ios-device-playtest.spec.ts');
  expect(workflow).toContain('native-ios-simulator');
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
