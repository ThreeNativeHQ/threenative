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
  expect(workflow).toContain('scripts/workspace-packages.ts --archives');
  expect(workflow.indexOf('scripts/workspace-packages.ts --archives')).toBeLessThan(
    workflow.indexOf('pnpm --filter threenative-native-smoke build'),
  );
  expect(workflow).toContain('pnpm --filter "$package_name" --if-present run build');
  for (const source of [workflow, releaseWorkflow]) {
    expect(source).toContain('libcurl4-openssl-dev');
    expect(source).toContain('libfontconfig1-dev');
    expect(source).toContain('mesa-vulkan-drivers');
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
    expect(source).toContain('examples/native-smoke/src/physics.ts');
    expect(source).toContain('src/game.ts');
    expect(source).not.toMatch(/native-smoke\/src\/physics\.ts[^\n]*src\/main\.ts/u);
  }
  expect(releaseWorkflow).toMatch(/native-smoke\/src\/game\.ts[^\n]*src\/game\.ts/u);
  expect(releaseWorkflow).not.toMatch(/native-smoke\/src\/game\.ts[^\n]*src\/main\.ts/u);
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

test('iOS consumer launches the bundle identifier produced by its packager', () => {
  expect(workflow).toContain('bundle_id=$(node -e');
  expect(workflow).toContain('report="$app.json"');
  expect(workflow).toContain('--bundle-id "$bundle_id"');
  expect(workflow).not.toContain('--bundle-id dev.threenative.runtime');
});

test('iOS workflow dispatch can run without unrelated platform cancellation', () => {
  expect(workflow).toContain('ios_only:');
  expect(workflow.match(/inputs\.ios_only != true/gu)).toHaveLength(4);
});

test('Android release lane installs both Rust cross-compilation targets before Gradle', () => {
  const rustTargets = 'rustup target add aarch64-linux-android x86_64-linux-android';
  expect(releaseWorkflow).toContain(rustTargets);
  expect(releaseWorkflow.indexOf(rustTargets)).toBeLessThan(
    releaseWorkflow.indexOf('sh ./gradlew assembleRelease'),
  );
});

test('clean Android consumer exposes late-installed emulator SDK directories', () => {
  expect(releaseWorkflow).toContain(
    'ln -s "$source_sdk/$directory" "$clean_sdk/$directory"',
  );
  expect(releaseWorkflow).toContain('test -L "$clean_sdk/emulator"');
  expect(releaseWorkflow).toContain('test -L "$clean_sdk/system-images"');
  expect(releaseWorkflow).not.toContain(
    'if test -e "$source_sdk/$directory"; then ln -s',
  );
});

test('packed desktop smoke copies the Vite defines required by its authored entry', () => {
  const copy = 'examples/native-smoke/vite.config.ts';
  const build = 'pnpm --dir "$CONSUMER_TARGET" build --target desktop';
  expect(releaseWorkflow).toContain(copy);
  expect(releaseWorkflow.indexOf(copy)).toBeLessThan(releaseWorkflow.indexOf(build));
});

test('clean Android emulator script is compatible with line-by-line action execution', () => {
  const script = releaseWorkflow.match(
    /- name: Run packed Android physics and negative controls on an emulator[\s\S]*?script: \|\n([\s\S]*?)\n {6}- name:/u,
  )?.[1];
  expect(script).toBeDefined();
  expect(script).not.toContain('expect_android_failure');
  expect(script).not.toMatch(/\\\s*$/mu);
  expect(script).not.toMatch(/\n\s+(?:cli|scenario_root)=/u);
  expect(
    script.match(
      /set \+e; node .*status=\$\?; set -e; cat .*; test "\$status" -eq 1; grep -F/gu,
    ),
  ).toHaveLength(3);
});

test('clean consumers retain failure logs and use the measured device timeout', () => {
  expect(releaseWorkflow.match(/--timeout 30000/gu)).toHaveLength(8);
  expect(releaseWorkflow.match(/if: always\(\)/gu)).toHaveLength(2);
  expect(releaseWorkflow.match(/if-no-files-found: warn/gu)).toHaveLength(2);
  expect(releaseWorkflow).toContain('cat "$RUNNER_TEMP/ios-wrong-value.log"');
});

test('clean desktop consumer provisions software Vulkan and prints its log on failure', () => {
  const cleanConsumer = releaseWorkflow.match(
    / {2}clean-consumer:\n([\s\S]*?)\n {2}clean-consumer-ios:/u,
  )?.[1];
  expect(cleanConsumer).toBeDefined();
  expect(cleanConsumer).toContain('sudo apt-get install -y mesa-vulkan-drivers');

  const launch = cleanConsumer.match(
    /- name: Launch the packed desktop game for 300 frames\n {8}run: \|\n([\s\S]*?)\n {6}- name:/u,
  )?.[1];
  expect(launch).toBeDefined();
  expect(launch).toContain(`trap 'status=$?; trap - ERR; cat "$log"; exit "$status"' ERR`);
  expect(launch.indexOf('cat "$log"')).toBeLessThan(launch.indexOf('scripts/xvfb.sh'));
  expect(launch).toContain('trap - ERR');
});

test('worker idle wake gate ships in the native package suite without requiring CMake', () => {
  // PRD P2-1: the worker wake regression is a source-level gate so the default
  // repository lane executes it; native compilation stays opt-in.
  const vitestConfig = readFileSync(
    fileURLToPath(new URL('../vitest.config.ts', import.meta.url)),
    'utf8',
  );
  expect(vitestConfig).toContain('tests/**/*.test.{ts,mjs}');
  const workerGate = readFileSync(
    fileURLToPath(new URL('./worker-idle.test.mjs', import.meta.url)),
    'utf8',
  );
  expect(workerGate).toContain('RED observed: idle wake bound exceeded');
  expect(workerGate).toContain('RED observed: worker join timeout');
  expect(workerGate).toContain('TN_WORKER_WAKE_BIN');
  // The desktop lane that would carry the runtime measurement still builds the host.
  expect(workflow).toContain('pnpm --filter @threenative/runtime-native native:build');
});

test('the production worker contract is registered in the native lane', () => {
  // PRD-250 Phase 2: the clone, error and teardown semantics are proven against real worker
  // threads, not against the source. CMake must build and register that executable, and the
  // harness must require every contract by name so a silently dropped one cannot read as a pass.
  const cmake = readFileSync(
    fileURLToPath(new URL('../CMakeLists.txt', import.meta.url)),
    'utf8',
  );
  expect(cmake).toContain('tests/worker_production_test.cpp');
  expect(cmake).toContain('tn_register_contract_test(threenative-worker-production-test)');

  const gate = readFileSync(
    fileURLToPath(new URL('./native-worker-production.test.mjs', import.meta.url)),
    'utf8',
  );
  expect(gate).toContain('TN_NATIVE_WORKER_BIN');
  // Absent binary reports UNVERIFIED; it must never be spelled as a pass.
  expect(gate).toContain('TN_NATIVE_WORKER_CONTRACT:UNVERIFIED');
  for (const contract of [
    'fifoAcrossHandlerRegistration',
    'cloneMatrixRoundTrip',
    'cloneRefusalNamed',
    'workerSideCloneRefusalReachesError',
    'topLevelThrowReachesError',
    'handlerThrowReachesError',
    'finalMessageSurvivesSelfClose',
    'terminateStopsCallbacks',
    'shutdownJoinsEveryWorker',
    'registryReopensForASecondRuntime',
  ]) {
    expect(gate, `the native lane stopped requiring ${contract}`).toContain(contract);
  }
});

test('native physics controls assert the parity scene surface', () => {
  const normal = smokeScenario('physics.playtest.json');
  const desktop = smokeScenario('physics-desktop.playtest.json');
  const wrongHeight = smokeScenario('physics-wrong-height.playtest.json');
  const masked = smokeScenario('physics-mask.playtest.json');
  expect(normal.target).toBe('web');
  expect(desktop.target).toBe('desktop');
  expect(desktop.assert).toEqual(normal.assert);
  expect(normal.assert.resources.map(({ path }) => path)).toEqual([
    'parity.steps',
    'parity.grounded',
    'parity.spatialQuery.rayDistance',
    'parity.spatialQuery.rayNormal',
    'parity.spatialQuery.rayPosition',
    'parity.spatialQuery.shapeCount',
    'parity.spatialQuery.pointCount',
    'parity.spatialQuery.pointMissCount',
    'parity.spatialQuery.pointMaskedHitCount',
    'parity.spatialQuery.shapeMissCount',
    'parity.spatialQuery.shapeMaskedHitCount',
    'parity.spatialQuery.clearHitCount',
    'parity.spatialQuery.maskedHitCount',
  ]);
  expect(normal.assert.movement.entity).toBe('dynamicBox');
  expect(normal.assert.movement.minDistance).toBe(0.5);
  expect(
    normal.assert.resources.find(({ path }) => path === 'parity.grounded').allowTrivial,
  ).toBeTypeOf('string');
  expect(wrongHeight.assert.movement.entity).toBe('dynamicBox');
  expect(masked.assert.resources.map(({ path }) => path)).toEqual([
    'parity.collisionEventSet',
    'parity.control',
  ]);
});
