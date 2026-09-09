import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import { expect, test } from 'vitest';

const workflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/native-platforms.yml', import.meta.url)),
  'utf8',
);
const runtimeCmake = readFileSync(
  fileURLToPath(new URL('../CMakeLists.txt', import.meta.url)),
  'utf8',
);
const ciWorkflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url)),
  'utf8',
);
const releaseWorkflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/native-release.yml', import.meta.url)),
  'utf8',
);
const candidateWorkflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/release-candidate.yml', import.meta.url)),
  'utf8',
);
const smokeScenario = (name) => JSON.parse(readFileSync(
  fileURLToPath(new URL(`../../../examples/native-smoke/playtests/${name}`, import.meta.url)),
  'utf8',
));

test('static SDL is position independent for native PIE consumers', () => {
  const sdl = runtimeCmake.slice(
    runtimeCmake.indexOf('# SDL3 - Build from source as static library'),
    runtimeCmake.indexOf('if(NOT SDL3_FOUND)'),
  );
  expect(sdl).toMatch(
    /add_subdirectory\(\$\{SDL3_SOURCE_DIR\}[\s\S]*?set_target_properties\(SDL3-static PROPERTIES\s+POSITION_INDEPENDENT_CODE ON\)/u,
  );
  expect(sdl).toMatch(
    /if\(TARGET SDL_uclibc\)[\s\S]*?set_target_properties\(SDL_uclibc PROPERTIES\s+POSITION_INDEPENDENT_CODE ON\)/u,
  );
});

test('green native platform lane is required by primary CI', () => {
  const nativeJob = ciWorkflow.match(
    /\n\x20{2}native-platforms:\n[\s\S]*?(?=\n\x20{2}[a-z0-9-]+:|\s*$)/u,
  )?.[0] ?? '';
  expect(nativeJob).toContain('needs: scope');
  expect(nativeJob).toContain('uses: ./.github/workflows/native-platforms.yml');
  expect(nativeJob).not.toMatch(/^\s+continue-on-error:/mu);
  expect(workflow).toContain('workflow_call:');
  expect(workflow).not.toMatch(/\n\x20{2}(?:push|pull_request|schedule):/u);
});

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

test('iOS consumer proof is a required gate after the simulator proof passes', () => {
  // Fail-closed since the simulator's worker proof passed in isolated run 33498394620.
  const iosJob = workflow.slice(workflow.indexOf('  ios-simulator:'));
  expect(iosJob).not.toContain('continue-on-error: true');
  expect(workflow).not.toContain('worker proof is unresolved');
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

test('release gate rejects stale or missing exact candidate CI evidence', () => {
  const gate = releaseWorkflow.match(
    /- name: Require a green CI run for this commit[\s\S]*?\n {8}run: \|\n([\s\S]*?)\n\n {2}build:/u,
  )?.[1]
    .split('\n')
    .map((line) => line.replace(/^ {10}/u, ''))
    .join('\n');
  expect(gate).toBeDefined();
  expect(releaseWorkflow).toContain('--json databaseId,status,conclusion,event,headBranch,headSha');

  const directory = makeTempDirSync('threenative-prd-078-gate-');
  const gh = join(directory, 'gh');
  writeFileSync(gh, '#!/bin/sh\nprintf \'%s\' "$MOCK_GH_RUNS"\n');
  chmodSync(gh, 0o755);
  const candidateSha = 'candidate-sha';
  const run = (runs) => spawnSync('bash', ['-euo', 'pipefail', '-c', gate], {
    env: {
      ...process.env,
      GITHUB_REPOSITORY: 'ThreeNativeHQ/threenative',
      GITHUB_SHA: candidateSha,
      MOCK_GH_RUNS: JSON.stringify(runs),
      PATH: `${directory}:${process.env.PATH}`,
    },
    encoding: 'utf8',
  });

  const candidateRun = {
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    headBranch: 'main',
    headSha: candidateSha,
  };
  expect(run([{ ...candidateRun, databaseId: 123 }]).status).toBe(0);
  const stale = run([{
    databaseId: 124,
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    headBranch: 'main',
    headSha: 'different-sha',
  }]);
  expect(stale.status).not.toBe(0);
  expect(stale.stderr).toContain(candidateSha);
  const missing = run([]);
  expect(missing.status).not.toBe(0);
  expect(missing.stderr).toContain(candidateSha);
  for (const databaseId of [null, '123', 0, -1, 1.5]) {
    const malformed = run([{ ...candidateRun, databaseId }]);
    expect(malformed.status).not.toBe(0);
    expect(malformed.stderr).toContain(candidateSha);
  }
  const missingDatabaseId = run([candidateRun]);
  expect(missingDatabaseId.status).not.toBe(0);
});

test('release side effects require the exact releaseCandidateV1 preflight', () => {
  const preflight = 'pnpm tsx scripts/release-candidate-gate.ts validate --candidate release/release-candidate.json';
  expect(releaseWorkflow).toContain(preflight);
  expect(releaseWorkflow).toMatch(
    /validate-tag:\n {4}outputs:\n {6}candidate_sha: \$\{\{ steps\.release-candidate\.outputs\.candidate_sha \}\}/u,
  );
  expect(releaseWorkflow).toContain('id: release-candidate');
  expect(releaseWorkflow).toContain('echo "candidate_sha=$GITHUB_SHA" >> "$GITHUB_OUTPUT"');

  const job = (name) => {
    const start = releaseWorkflow.indexOf(`  ${name}:`);
    const tail = releaseWorkflow.slice(start + name.length + 3);
    const next = tail.search(/\n {2}[a-z][a-z0-9-]*:/u);
    return releaseWorkflow.slice(start, next < 0 ? undefined : start + name.length + 3 + next);
  };
  for (const name of [
    'gates',
    'build',
    'build-android',
    'build-ios-simulator',
    'publish',
    'clean-consumer',
    'clean-consumer-ios',
    'finalize',
    'cleanup-failed-release',
  ]) {
    expect(job(name), `${name} must depend directly on validate-tag`).toMatch(/needs:[^\n]*validate-tag/u);
  }
  expect(releaseWorkflow.indexOf(preflight)).toBeLessThan(
    releaseWorkflow.indexOf('pnpm --filter @threenative/runtime-native native:build'),
  );
  expect(releaseWorkflow.indexOf(preflight)).toBeLessThan(
    releaseWorkflow.indexOf('gh release create'),
  );
});

test('release consumes one successful exact-SHA candidate artifact and verifies registry bytes', () => {
  expect(candidateWorkflow).toContain('workflow_dispatch:');
  expect(candidateWorkflow).toContain('candidate_request:');
  expect(candidateWorkflow).toContain('scripts/release-candidate-gate.ts resolve');
  expect(candidateWorkflow).toContain('actions/upload-artifact@v7');
  for (const token of [
    'secrets.NPM_TOKEN != \'\'',
    'secrets.WINDOWS_SIGNING_CERTIFICATE != \'\'',
    'inputs.windows_runner',
    'inputs.timestamp_service',
  ]) {
    expect(candidateWorkflow).toContain(token);
  }
  expect(releaseWorkflow).toContain('--workflow release-candidate.yml');
  expect(releaseWorkflow).toContain('gh run download "$candidate_run"');
  expect(releaseWorkflow).toContain('release-candidate-$GITHUB_SHA');
  expect(releaseWorkflow).toContain('--producer-run-id "$PRODUCER_RUN_ID"');
  expect(releaseWorkflow).toContain('--verify-registry');
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
