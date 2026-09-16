import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'vitest';
import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import {
  assertConsumerTargetRows,
  parseConsumerPlaytestReport,
  qualifyConsumerTargetRow,
  verifyStarterConsumerGameplay,
} from '../scripts/verify-starter-desktop.mjs';

describe('PRD-366 consumer evidence regressions', () => {
  const scenario = 'playtests/production-readiness.playtest.json';
  const applicationId = 'com.threenative.consumer';
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const identity = { applicationId, artifactHash: hash('built consumer'), scenario };
  const row = (extra = {}) => ({
    ...identity, architecture: 'x64', assertionIds: ['movement', 'resources'], assertions: 2,
    failures: [], os: 'linux',
    osVersion: '6.8', pass: true, session: 'x11', target: 'desktop', ...extra,
  });
  const report = (extra = {}) => ({
    assertionResults: [{ id: 'movement', pass: true }, { id: 'resources', pass: true }],
    diagnostics: [], pass: true, target: 'desktop', ...extra,
  });
  const output = (extra = {}) => ({ status: 0, stderr: '', stdout: JSON.stringify(report(extra)) });
  function fixture() {
    const project = makeTempDirSync('consumer-evidence-regression-');
    const artifact = join(project, 'dist-native', process.platform === 'win32' ? 'consumer.exe' : 'consumer');
    const cli = join(project, 'node_modules', '@threenative', 'playtest', 'dist', 'runner', 'cli.js');
    mkdirSync(join(project, 'dist-native'), { recursive: true });
    mkdirSync(join(project, 'playtests'), { recursive: true });
    mkdirSync(join(cli, '..'), { recursive: true });
    writeFileSync(artifact, 'built consumer');
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'consumer' }));
    writeFileSync(join(project, 'threenative.config.ts'), `export default { app: { id: '${applicationId}' } };`);
    writeFileSync(join(project, scenario), JSON.stringify({
      name: 'starter-production-readiness', target: 'web', schemaVersion: 1,
      steps: [{ kind: 'input', press: 'ArrowUp', holdTicks: 10 }],
      assert: { movement: { entity: 'player', minDistance: 0.5 } },
    }));
    writeFileSync(cli, `process.stdout.write(${JSON.stringify(JSON.stringify(report()))});`);
    const options = { applicationId, artifact, project, target: 'desktop', runner: () => output() };
    const rowsFile = join(project, 'artifacts', 'native', 'consumer-targets.json');
    return { artifact, cli, options, project, rowsFile };
  }
  function androidFixture() {
    const f = fixture();
    const artifact = join(f.project, 'dist-native', 'consumer.apk');
    writeFileSync(artifact, 'built consumer');
    const calls = [];
    const properties = {
      'ro.product.cpu.abi': 'arm64-v8a', 'ro.build.version.release': '16',
      'ro.build.version.sdk': '36', 'ro.kernel.qemu': '1',
    };
    const deviceRunner = (command, args, cwd) => {
      calls.push({ command, args, cwd });
      let stdout;
      if (args.includes('getprop')) stdout = properties[args.at(-1)] ?? '';
      else if (args.includes('install')) stdout = 'Success\n';
      else if (args.includes('pm')) stdout = 'package:/data/app/consumer/base.apk\n';
      else if (args.includes('sha256sum')) stdout = `${hash('built consumer')}  /data/app/consumer/base.apk\n`;
      else throw new Error(`Unexpected adb command: ${args.join(' ')}`);
      return { status: 0, stderr: '', stdout };
    };
    return {
      ...f, artifact, calls,
      options: { ...f.options, artifact, target: 'android', device: 'emulator-5554',
        architecture: 'arm64-v8a', osVersion: '16 (API 36)', adb: '/sdk/adb', deviceRunner,
        runner: () => output({ target: 'android' }) },
    };
  }

  test('a passing flag cannot override a recorded failed assertion', () => {
    assert.throws(() => qualifyConsumerTargetRow(row({ failures: ['movement'] }), identity),
      /TN_STARTER_CONSUMER_ASSERTION_FAILED/u);
  });
  for (const failures of [[null], [{}], [false], ['']]) {
    test(`malformed failure list is refused: ${JSON.stringify(failures)}`, () => {
      assert.throws(() => qualifyConsumerTargetRow(row({ failures }), identity), /ROW_MALFORMED/u);
    });
  }
  for (const assertion of [null, {}, { id: 'movement', pass: 'true' }, { id: '', pass: true }]) {
    test(`malformed assertion is not counted: ${JSON.stringify(assertion)}`, () => {
      assert.throws(() => parseConsumerPlaytestReport(JSON.stringify(report({ assertionResults: [assertion] })), 'desktop'),
        /ROW_MALFORMED/u);
    });
  }
  test('the aggregate passing flag cannot override a failed result', () => {
    const parsed = parseConsumerPlaytestReport(JSON.stringify(report({
      assertionResults: [{ id: 'movement', pass: false }],
    })), 'desktop');
    assert.equal(parsed.pass, false);
    assert.deepEqual(parsed.failures, ['movement']);
  });
  test('unevaluated diagnostics cannot become gameplay evidence', () => {
    assert.throws(() => parseConsumerPlaytestReport(JSON.stringify(report({
      assertionResults: [{ id: 'diagnostics', pass: true, details: { reason: 'not-evaluated' } }],
    })), 'desktop'), /NO_ASSERTIONS/u);
  });
  test('a report from another target cannot qualify this target', () => {
    assert.throws(() => parseConsumerPlaytestReport(JSON.stringify(report({ target: 'browser' })), 'desktop'),
      /TARGET_MISMATCH/u);
  });
  test('missing report verdict is malformed rather than an observed failure', () => {
    const value = report(); delete value.pass;
    assert.throws(() => parseConsumerPlaytestReport(JSON.stringify(value), 'desktop'), /ROW_MALFORMED/u);
  });
  test('malformed diagnostics are not silently discarded', () => {
    for (const diagnostics of [{}, [null], [{}]]) {
      assert.throws(() => parseConsumerPlaytestReport(JSON.stringify(report({ diagnostics })), 'desktop'),
        /ROW_MALFORMED/u);
    }
  });
  test('error diagnostics veto an aggregate pass', () => {
    const parsed = parseConsumerPlaytestReport(JSON.stringify(report({
      diagnostics: [{ code: 'TN_PLAYTEST_DEVICE_FAILED', severity: 'error' }],
    })), 'desktop');
    assert.equal(parsed.pass, false);
  });
  test('distinct platform artifact identities qualify independently', () => {
    const android = { ...identity, artifactHash: hash('an Android APK') };
    const result = assertConsumerTargetRows([
      row(), row({ ...android, target: 'android', os: 'android', session: 'android-emulator' }),
    ], { targets: ['desktop', 'android'], expectedByTarget: { desktop: identity, android } });
    assert.equal(result.length, 2);
  });
  test('duplicate target rows cannot hide a later failure', () => {
    assert.throws(() => assertConsumerTargetRows([row(), row({ pass: false, failures: ['movement'] })], {
      ...identity, targets: ['desktop'],
    }), /ROW_DUPLICATE/u);
  });
  test('unknown target evidence is refused', () => {
    assert.throws(() => qualifyConsumerTargetRow(row({ target: 'ios' }), identity), /TARGET_UNSUPPORTED/u);
  });
  test('scenario byte identity is checked when supplied by the caller', () => {
    assert.throws(() => qualifyConsumerTargetRow(row({ scenarioHash: hash('old scenario') }), {
      ...identity, scenarioHash: hash('new scenario'),
    }), /SCENARIO_MISMATCH/u);
  });
  test('a normal desktop fixture still records a qualified row', () => {
    const f = fixture();
    const { row: result } = verifyStarterConsumerGameplay(f.options);
    assert.equal(result.pass, true);
    assert.equal(result.artifactHash, identity.artifactHash);
    assert.equal(JSON.parse(readFileSync(f.rowsFile, 'utf8'))[0].pass, true);
  });
  test('the default runner really executes the installed fixture CLI', () => {
    const f = fixture();
    const { row: result } = verifyStarterConsumerGameplay({ ...f.options, runner: undefined });
    assert.equal(result.assertions, 2);
  });
  for (const status of [null, undefined, 1]) {
    test(`non-successful process completion is refused: ${String(status)}`, () => {
      const f = fixture();
      assert.throws(() => verifyStarterConsumerGameplay({ ...f.options, runner: () => ({ ...output(), status }) }),
        /RUNNER_FAILED|ROW_MALFORMED/u);
    });
  }
  test('spawn errors cannot be hidden by JSON that says pass', () => {
    const f = fixture();
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options,
      runner: () => ({ ...output(), error: new Error('spawn failed') }),
    }), /RUNNER_FAILED/u);
  });
  test('termination signals cannot be hidden by JSON that says pass', () => {
    const f = fixture();
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options,
      runner: () => ({ ...output(), signal: 'SIGTERM' }),
    }), /RUNNER_FAILED/u);
  });
  test('a changed artifact cannot be hashed after the run and called verified', () => {
    const f = fixture();
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options,
      runner: () => { writeFileSync(f.artifact, 'substituted after launch'); return output(); },
    }), /ARTIFACT_MISMATCH/u);
  });
  test('an independently supplied wrong artifact is rejected before launching', () => {
    const f = fixture(); let launches = 0;
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options,
      expected: { ...identity, artifactHash: hash('other artifact') },
      runner: () => { launches += 1; return output(); },
    }), /ARTIFACT_MISMATCH/u);
    assert.equal(launches, 0);
  });
  test('a substituted smoke scenario cannot qualify itself', () => {
    const f = fixture();
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options, scenario: 'playtests/native-smoke.playtest.json' }),
      /SCENARIO_MISMATCH/u);
  });
  test('a missing scenario is refused even if the runner claims a pass', () => {
    const f = fixture(); rmSync(join(f.project, scenario));
    assert.throws(() => verifyStarterConsumerGameplay(f.options), /SCENARIO_MISSING/u);
  });
  test('an unreadable row entry is never overwritten by a fresh pass', () => {
    const f = fixture(); mkdirSync(join(f.rowsFile, '..'), { recursive: true });
    const original = JSON.stringify([{ target: 'desktop' }]); writeFileSync(f.rowsFile, original);
    assert.throws(() => verifyStarterConsumerGameplay(f.options), /ROW_MALFORMED/u);
    assert.equal(readFileSync(f.rowsFile, 'utf8'), original);
  });
  test('a failed rerun invalidates the previously passing row', () => {
    const f = fixture(); verifyStarterConsumerGameplay(f.options);
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options,
      runner: () => ({ status: 2, stdout: 'not a report', stderr: 'bridge crashed' }),
    }));
    const rows = JSON.parse(readFileSync(f.rowsFile, 'utf8'));
    assert.equal(rows[0].pass, false);
    assert.throws(() => assertConsumerTargetRows(rows, { ...identity, targets: ['desktop'] }),
      /NO_ASSERTIONS|ASSERTION_FAILED/u);
  });
  test('the full runner log survives a parse failure', () => {
    const f = fixture();
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options,
      runner: () => ({ status: 2, stdout: 'invalid-json', stderr: 'reason-for-failure' }),
    }));
    assert.match(readFileSync(join(f.project, 'artifacts', 'native', 'consumer-desktop.log'), 'utf8'), /reason-for-failure/u);
  });
  test('Android installs the exact supplied APK and targets the consumer package', () => {
    const f = androidFixture(); let args;
    verifyStarterConsumerGameplay({ ...f.options, runner: (_command, argv) => {
      args = argv; return output({ target: 'android' });
    } });
    assert.equal(args[args.indexOf('--package') + 1], applicationId);
    assert.equal(args[args.indexOf('--adb') + 1], '/sdk/adb');
    assert.ok(f.calls.some((call) => call.args.includes('install') && call.args.includes(f.artifact)));
    assert.ok(f.calls.some((call) => call.args.includes('sha256sum')));
  });
  test('Android refuses the installed APK when its hash differs', () => {
    const f = androidFixture(); const original = f.options.deviceRunner;
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options,
      deviceRunner: (command, args, cwd) => args.includes('sha256sum')
        ? { status: 0, stdout: `${hash('wrong installed APK')}  /data/app/consumer/base.apk\n`, stderr: '' }
        : original(command, args, cwd),
    }), /ARTIFACT_MISMATCH/u);
  });
  test('Android installation failure cannot reach the gameplay runner', () => {
    const f = androidFixture(); let launches = 0; const original = f.options.deviceRunner;
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options,
      deviceRunner: (command, args, cwd) => args.includes('install')
        ? { status: 1, stdout: '', stderr: 'INSTALL_FAILED_INVALID_APK' }
        : original(command, args, cwd),
      runner: () => { launches += 1; return output({ target: 'android' }); },
    }), /INSTALL_FAILED/u);
    assert.equal(launches, 0);
  });
  test('ambiguous Android artifacts require explicit selection', () => {
    const f = androidFixture(); writeFileSync(join(f.project, 'dist-native', 'stale.apk'), 'stale');
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options, artifact: undefined }), /ARTIFACT_AMBIGUOUS/u);
  });
  test('explicit null diagnostics are not treated as an absent field', () => {
    assert.throws(() => parseConsumerPlaytestReport(JSON.stringify(report({ diagnostics: null })), 'desktop'),
      /ROW_MALFORMED/u);
  });
  test('unsafe assertion counts cannot be persisted as evidence', () => {
    assert.throws(() => qualifyConsumerTargetRow(row({ assertions: Number.MAX_SAFE_INTEGER + 1 }), identity),
      /ROW_MALFORMED/u);
  });
  test('a diagnostics-only report cannot stand in for gameplay', () => {
    assert.throws(() => parseConsumerPlaytestReport(JSON.stringify(report({
      assertionResults: [{ id: 'diagnostics', pass: true }],
    })), 'desktop'), /NO_ASSERTIONS/u);
  });
  test('scenario changes during execution invalidate the run', () => {
    const f = fixture();
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options,
      runner: () => { writeFileSync(join(f.project, scenario), '{}'); return output(); },
    }), /SCENARIO_MISMATCH/u);
  });
  test('Android accepts a randomized installed APK directory without weakening path safety', () => {
    const f = androidFixture(); const original = f.options.deviceRunner;
    const { row: result } = verifyStarterConsumerGameplay({ ...f.options,
      deviceRunner: (command, args, cwd) => args.includes('pm')
        ? { status: 0, stdout: 'package:/data/app/~~a_b-c==/consumer-xY_Z==/base.apk\n', stderr: '' }
        : original(command, args, cwd),
    });
    assert.equal(result.pass, true);
  });
  // B4: the row stored only a COUNT, so `5 === 5` passed for any five ids. A run that evaluated
  // assertions the scenario never declared, or that silently dropped whole declared families,
  // qualified anyway. The row now carries the ids and they are checked against the scenario.
  test('a run cannot qualify on assertions the scenario never declared', () => {
    const f = fixture();
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options,
      runner: () => output({ assertionResults: [{ id: 'totally-made-up', pass: true }] }),
    }), /ASSERTION_FAMILY_MISSING/u);
  });
  test('a run that silently drops a declared assertion family cannot qualify', () => {
    const f = fixture();
    writeFileSync(join(f.project, scenario), JSON.stringify({
      name: 'starter-production-readiness', target: 'web', schemaVersion: 1,
      steps: [{ kind: 'input', press: 'ArrowUp', holdTicks: 10 }],
      assert: { movement: { entity: 'player', minDistance: 0.5 }, visibility: [{ entity: 'player' }] },
    }));
    assert.throws(() => verifyStarterConsumerGameplay({ ...f.options,
      runner: () => output({ assertionResults: [{ id: 'movement.axisDelta', pass: true }] }),
    }), /ASSERTION_FAMILY_MISSING/u);
  });
  test('the parsed report reports its assertion ids, sorted and deduplicated', () => {
    const parsed = parseConsumerPlaytestReport(JSON.stringify(report({
      assertionResults: [{ id: 'movement.axisDelta', pass: true }, { id: 'diagnostics', pass: true }],
    })), 'desktop');
    assert.deepEqual(parsed.assertionIds, ['diagnostics', 'movement.axisDelta']);
  });
  test('a row from an older verifier is named as superseded, not as corrupt input', () => {
    const bad = row(); delete bad.assertionIds;
    assert.throws(() => qualifyConsumerTargetRow(bad, identity), /ROW_OUTDATED/u);
  });
  test('a target row whose assertion ids are not strings is malformed', () => {
    assert.throws(() => qualifyConsumerTargetRow(row({ assertionIds: ['', 'x'] }), identity),
      /ROW_MALFORMED/u);
  });
  test('a target row whose assertion ids contradict its count is malformed', () => {
    assert.throws(() => qualifyConsumerTargetRow(row({ assertionIds: ['movement'] }), identity),
      /ROW_MALFORMED/u);
  });
  test('two targets that evaluated different assertion sets cannot both qualify', () => {
    const desktop = row({ assertionIds: ['movement', 'resources'] });
    const android = row({ target: 'android', assertionIds: ['movement', 'visibility.player'] });
    assert.throws(() => assertConsumerTargetRows([desktop, android], {
      ...identity, targets: ['desktop', 'android'],
    }), /ASSERTION_SET_MISMATCH/u);
  });
  test('two targets that evaluated the same assertion set qualify together', () => {
    const desktop = row({ assertionIds: ['movement', 'resources'] });
    const android = row({ target: 'android', assertionIds: ['resources', 'movement'] });
    assert.equal(assertConsumerTargetRows([desktop, android], {
      ...identity, targets: ['desktop', 'android'],
    }).length, 2);
  });
  // The cross-target check is only load-bearing if a caller actually passes two targets in one
  // call. `--qualify-existing --target desktop,android` is that caller; with a single target the
  // comparison never runs and identity would rest on a human reading two rows.
  test('--qualify-existing accepts several targets so the cross-target check can fire', () => {
    const f = fixture();
    const apk = join(f.project, 'dist-native', 'consumer.apk');
    writeFileSync(apk, 'built consumer');
    const scenarioHash = hash(readFileSync(join(f.project, scenario)));
    const rows = [
      row({ assertionIds: ['movement', 'resources'], scenarioHash }),
      row({ target: 'android', architecture: 'arm64-v8a', artifactHash: hash('built consumer'),
        assertionIds: ['resources', 'movement'], os: 'android', osVersion: '15 (API 35)',
        session: 'android-emulator', scenarioHash }),
    ];
    mkdirSync(join(f.project, 'artifacts', 'native'), { recursive: true });
    writeFileSync(f.rowsFile, JSON.stringify(rows));
    const cli = fileURLToPath(new URL('../scripts/verify-starter-desktop.mjs', import.meta.url));
    const args = ['--qualify-existing', '--target', 'desktop,android', '--project', f.project];
    const green = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(green.status, 0, `${green.stdout}${green.stderr}`);
    assert.match(green.stdout, /identical assertion sets/u);

    rows[1].assertionIds = ['movement', 'visibility.q'];
    writeFileSync(f.rowsFile, JSON.stringify(rows));
    const red = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.notEqual(red.status, 0);
    assert.match(`${red.stdout}${red.stderr}`, /ASSERTION_SET_MISMATCH/u);
  });
});
