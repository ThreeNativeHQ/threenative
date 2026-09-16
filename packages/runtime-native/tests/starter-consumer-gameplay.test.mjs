import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'vitest';

import {
  assertConsumerTargetRows,
  parseConsumerPlaytestReport,
  qualifyConsumerTargetRow,
  verifyStarterConsumerGameplay,
} from '../scripts/verify-starter-consumer.mjs';

// PRD-366 phase 2. Phase 1 proved the installed starter plays in a browser; these fixtures prove
// the qualification of the *same* consumer scenario on a distributed target fails closed for the
// exact cause — a foreign subject, a stale artifact, an absent gameplay row, a run that evaluated
// nothing — rather than accepting a hardcoded pass.
describe('PRD-366 phase 2 — distributed consumer gameplay qualification', () => {
  const scenario = 'playtests/production-readiness.playtest.json';
  const builtHash = 'a'.repeat(64);
  const builtApplicationId = 'com.threenative.my-game';
  const builtConsumer = {
    applicationId: builtApplicationId,
    artifactHash: builtHash,
    scenario,
    targets: ['desktop', 'android'],
  };

  function consumerRow(overrides = {}) {
    return {
      applicationId: builtApplicationId,
      architecture: 'x64',
      artifactHash: builtHash,
      assertions: 5,
      failures: [],
      os: 'linux',
      osVersion: '6.8.0',
      pass: true,
      scenario,
      session: 'x11',
      target: 'desktop',
      ...overrides,
    };
  }

  test('should reject target qualification when the artifact hash / application ID differs from the built consumer', () => {
    assert.throws(
      () => qualifyConsumerTargetRow(consumerRow({ artifactHash: 'b'.repeat(64) }), builtConsumer),
      /TN_STARTER_CONSUMER_ARTIFACT_MISMATCH/u,
    );
    assert.throws(
      () =>
        qualifyConsumerTargetRow(consumerRow({ applicationId: 'com.other.game' }), builtConsumer),
      /TN_STARTER_CONSUMER_APPLICATION_ID_MISMATCH/u,
    );
  });

  test('should reject a missing required gameplay row', () => {
    assert.throws(
      () => assertConsumerTargetRows([consumerRow({ target: 'desktop' })], builtConsumer),
      /TN_STARTER_CONSUMER_ROW_MISSING.*'android'/u,
    );
    assert.throws(
      () => assertConsumerTargetRows([], builtConsumer),
      /TN_STARTER_CONSUMER_ROW_MISSING.*'desktop'/u,
    );
  });

  test('accepts a matching row for every required target', () => {
    const qualified = assertConsumerTargetRows(
      [
        consumerRow(),
        consumerRow({
          architecture: 'arm64',
          os: 'android',
          osVersion: 'android',
          session: 'android-emulator',
          target: 'android',
        }),
      ],
      builtConsumer,
    );
    assert.deepEqual(
      qualified.map((row) => row.target),
      ['desktop', 'android'],
    );
  });

  test('rejects a substituted native-smoke artifact for its own scenario cause', () => {
    assert.throws(
      () =>
        qualifyConsumerTargetRow(
          consumerRow({ scenario: 'playtests/native-smoke.playtest.json' }),
          builtConsumer,
        ),
      /TN_STARTER_CONSUMER_SCENARIO_MISMATCH/u,
    );
  });

  test('rejects a stale starter build by its artifact hash, not a generic failure', () => {
    assert.throws(
      () =>
        qualifyConsumerTargetRow(consumerRow({ artifactHash: 'c'.repeat(64) }), builtConsumer),
      /TN_STARTER_CONSUMER_ARTIFACT_MISMATCH/u,
    );
  });

  test('names a scenario the target cannot evaluate instead of a generic gameplay failure', () => {
    assert.throws(
      () =>
        parseConsumerPlaytestReport(
          JSON.stringify({
            assertionResults: [{ id: 'diagnostics', pass: false }],
            diagnostics: [
              { code: 'TN_PLAYTEST_UNSUPPORTED_ON_TARGET', detail: 'network assertions' },
            ],
            pass: false,
            target: 'desktop',
          }),
          'desktop',
        ),
      /TN_STARTER_CONSUMER_SCENARIO_NOT_CROSS_TARGET/u,
    );
  });

  test('rejects a persisted row recorded against a different built consumer', () => {
    assert.throws(
      () =>
        assertConsumerTargetRows([consumerRow({ artifactHash: 'd'.repeat(64) })], {
          ...builtConsumer,
          targets: ['desktop'],
        }),
      /TN_STARTER_CONSUMER_ARTIFACT_MISMATCH/u,
    );
  });

  test('rejects a run that reached the app but evaluated no assertions (deleted asset/UI folder)', () => {
    assert.throws(
      () =>
        qualifyConsumerTargetRow(
          consumerRow({ assertions: 0, failures: [], pass: false }),
          builtConsumer,
        ),
      /TN_STARTER_CONSUMER_NO_ASSERTIONS/u,
    );
  });

  test('rejects an injected false state assertion as an assertion failure', () => {
    assert.throws(
      () =>
        qualifyConsumerTargetRow(
          consumerRow({ failures: ['resource state.score expected 1, observed 0'], pass: false }),
          builtConsumer,
        ),
      /TN_STARTER_CONSUMER_ASSERTION_FAILED/u,
    );
  });

  test('rejects a malformed row rather than reading it as a pass', () => {
    assert.throws(
      () => qualifyConsumerTargetRow({ target: 'desktop' }, builtConsumer),
      /TN_STARTER_CONSUMER_ROW_MALFORMED/u,
    );
  });

  test('parses the installed runner report and names an empty assertion set', () => {
    const report = parseConsumerPlaytestReport(
      JSON.stringify({
        assertionResults: [
          { id: 'movement', pass: true },
          { id: 'resources', pass: true },
        ],
        diagnostics: [],
        pass: true,
        target: 'desktop',
      }),
      'desktop',
    );
    assert.equal(report.assertions, 2);
    assert.equal(report.pass, true);
    assert.throws(
      () =>
        parseConsumerPlaytestReport(
          JSON.stringify({ assertionResults: [], diagnostics: [], pass: true, target: 'desktop' }),
          'desktop',
        ),
      /TN_STARTER_CONSUMER_NO_ASSERTIONS/u,
    );
    assert.throws(
      () => parseConsumerPlaytestReport('not json', 'desktop'),
      /TN_STARTER_CONSUMER_ROW_MALFORMED/u,
    );
  });

  test('records a desktop consumer row through the injected runner without a display', () => {
    const project = makeTempDirSync('starter-consumer-gameplay-');
    const executableName = process.platform === 'win32' ? 'my-game.exe' : 'my-game';
    mkdirSync(join(project, 'dist-native'), { recursive: true });
    const artifact = join(project, 'dist-native', executableName);
    writeFileSync(artifact, 'built consumer');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'my-game' }));
    writeFileSync(
      join(project, 'threenative.config.ts'),
      'export default { app: { id: "com.threenative.my-game" } };\n',
    );
    mkdirSync(join(project, 'playtests'), { recursive: true });
    writeFileSync(
      join(project, scenario),
      JSON.stringify({ assert: { movement: { entity: 'player' } }, steps: [] }),
    );
    const runner = join(
      project,
      'node_modules',
      '@threenative',
      'playtest',
      'dist',
      'runner',
      'cli.js',
    );
    mkdirSync(join(runner, '..'), { recursive: true });
    writeFileSync(runner, '// installed consumer runner');

    const calls = [];
    const { expected, row } = verifyStarterConsumerGameplay({
      applicationId: builtApplicationId,
      project,
      runner: (command, args) => {
        calls.push([command, ...args]);
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify({
            assertionResults: [
              { id: 'movement', pass: true },
              { id: 'resources', pass: true },
            ],
            diagnostics: [],
            pass: true,
            target: 'desktop',
          }),
        };
      },
      target: 'desktop',
    });

    assert.equal(row.target, 'desktop');
    assert.equal(row.assertions, 2);
    assert.equal(row.session.length > 0, true);
    assert.equal(row.os, process.platform);
    assert.equal(expected.artifactHash, row.artifactHash);
    assert.match(calls[0].join(' '), /--target desktop/u);
    assert.match(calls[0].join(' '), /--executable/u);
    const recorded = JSON.parse(
      readFileSync(join(project, 'artifacts', 'native', 'consumer-targets.json'), 'utf8'),
    );
    assert.equal(recorded[0].applicationId, builtApplicationId);
    assert.equal(recorded[0].artifactHash, row.artifactHash);

    assert.throws(
      () =>
        verifyStarterConsumerGameplay({
          applicationId: builtApplicationId,
          expected: {
            applicationId: builtApplicationId,
            artifactHash: 'e'.repeat(64),
            scenario,
          },
          project,
          runner: () => ({
            status: 0,
            stderr: '',
            stdout: JSON.stringify({
              assertionResults: [{ id: 'movement', pass: true }],
              diagnostics: [],
              pass: true,
              target: 'desktop',
            }),
          }),
          target: 'desktop',
        }),
      /TN_STARTER_CONSUMER_ARTIFACT_MISMATCH/u,
    );
  });
});
