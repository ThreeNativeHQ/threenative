#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { release as osRelease } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONSUMER_GAMEPLAY_SCENARIO = 'playtests/production-readiness.playtest.json';
export const CONSUMER_REQUIRED_TARGETS = ['desktop', 'android'];
const CONSUMER_ARTIFACT_HASH = /^[0-9a-f]{64}$/u;

function consumerError(code, detail) {
  return new Error(`TN_STARTER_CONSUMER_${code}: ${detail}`);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * A scenario's `assert` key -> the family token every result id for it begins with. The row used to
 * store only a COUNT, so `5 === 5` qualified a run that evaluated five assertions the scenario never
 * declared, and a run that silently dropped three of five declared families still qualified with
 * `assertions: 3` and nothing said so. Coverage is checked per declared family, not per id, because
 * one `resources` block yields one result per entry; extra families are allowed, missing ones are not.
 */
const CONSUMER_ASSERTION_FAMILIES = {
  diagnostics: 'diagnostics',
  movement: 'movement',
  resources: 'resource',
  visibility: 'visibility',
};

/** The family token of a result id: everything before the first dot. */
function consumerAssertionFamily(id) {
  const dot = id.indexOf('.');
  return dot === -1 ? id : id.slice(0, dot);
}

/** The families a scenario's assert block declares, as family tokens. Unknown keys are ignored. */
export function declaredConsumerAssertionFamilies(scenario) {
  const block = scenario?.assert;
  if (typeof block !== 'object' || block === null || Array.isArray(block)) return [];
  return Object.keys(block)
    .map((key) => CONSUMER_ASSERTION_FAMILIES[key])
    .filter((family) => family !== undefined);
}

/** The session the run executed in, named rather than assumed: a headless Linux host is not X11. */
export function describeConsumerSession(platform = process.platform, environment = process.env) {
  if (platform === 'android') return 'android';
  if (platform === 'win32') return 'windows-dwm';
  if (platform === 'darwin') return 'quartz';
  if (platform === 'linux') {
    if (environment.WAYLAND_DISPLAY) return 'wayland';
    if (environment.DISPLAY) return 'x11';
    return 'headless';
  }
  return platform;
}

/** Fail closed on a row that is structurally unreadable, before any value comparison. */
export function validateConsumerTargetRow(row) {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw consumerError('ROW_MALFORMED', 'a target row must be an object.');
  }
  for (const field of [
    'target',
    'os',
    'osVersion',
    'architecture',
    'session',
    'scenario',
    'applicationId',
    'artifactHash',
  ]) {
    if (!nonEmptyString(row[field])) {
      throw consumerError('ROW_MALFORMED', `target row field '${field}' is missing or empty.`);
    }
  }
  if (!CONSUMER_REQUIRED_TARGETS.includes(row.target)) {
    throw consumerError('TARGET_UNSUPPORTED', `unknown consumer target '${row.target}'.`);
  }
  if (row.scenarioHash !== undefined && !CONSUMER_ARTIFACT_HASH.test(row.scenarioHash)) {
    throw consumerError('ROW_MALFORMED', 'scenarioHash is not a sha256 hex digest.');
  }
  if (!CONSUMER_ARTIFACT_HASH.test(row.artifactHash)) {
    throw consumerError(
      'ROW_MALFORMED',
      `artifactHash '${row.artifactHash}' is not a sha256 hex digest.`,
    );
  }
  if (typeof row.pass !== 'boolean') {
    throw consumerError('ROW_MALFORMED', "target row field 'pass' is not a boolean.");
  }
  if (!Number.isSafeInteger(row.assertions) || row.assertions < 0) {
    throw consumerError(
      'ROW_MALFORMED',
      "target row field 'assertions' is not a non-negative integer.",
    );
  }
  if (!Array.isArray(row.failures) || row.failures.some((failure) => !nonEmptyString(failure))) {
    throw consumerError(
      'ROW_MALFORMED',
      "target row field 'failures' must contain non-empty strings.",
    );
  }
  // A row written before assertion ids existed is not malformed input, it is superseded evidence:
  // it stored only a count, which is exactly what could not be trusted. Name that so an operator
  // re-runs the target instead of hunting a corrupted file.
  if (row.assertionIds === undefined) {
    throw consumerError(
      'ROW_OUTDATED',
      `the '${row.target}' row records no assertionIds, so it was written by an older verifier that stored only a count; re-run --consumer for this target.`,
    );
  }
  if (!Array.isArray(row.assertionIds) || row.assertionIds.some((id) => !nonEmptyString(id))) {
    throw consumerError(
      'ROW_MALFORMED',
      "target row field 'assertionIds' must contain non-empty strings.",
    );
  }
  if (new Set(row.assertionIds).size !== row.assertionIds.length) {
    throw consumerError('ROW_MALFORMED', "target row field 'assertionIds' repeats an id.");
  }
  if (row.assertionIds.length !== row.assertions) {
    throw consumerError(
      'ROW_MALFORMED',
      `the '${row.target}' row counts ${row.assertions} assertions but names ${row.assertionIds.length}.`,
    );
  }
  return row;
}

function assertConsumerIdentity(row, expected) {
  if (
    !nonEmptyString(expected?.scenario) ||
    !nonEmptyString(expected?.applicationId) ||
    !CONSUMER_ARTIFACT_HASH.test(expected?.artifactHash ?? '')
  ) {
    throw consumerError('ROW_MALFORMED', 'the expected consumer identity is incomplete.');
  }
  if (row.scenario !== expected.scenario) {
    throw consumerError(
      'SCENARIO_MISMATCH',
      `the '${row.target}' row ran '${row.scenario}', not the built consumer's '${expected.scenario}'; a substituted native-smoke subject is not this consumer.`,
    );
  }
  if (row.artifactHash !== expected.artifactHash) {
    throw consumerError(
      'ARTIFACT_MISMATCH',
      `the '${row.target}' row's artifact ${row.artifactHash.slice(0, 12)} does not match the built consumer ${expected.artifactHash.slice(0, 12)}; a stale or substituted build is not this consumer.`,
    );
  }
  if (row.applicationId !== expected.applicationId) {
    throw consumerError(
      'APPLICATION_ID_MISMATCH',
      `the '${row.target}' row's applicationId '${row.applicationId}' does not match the built consumer '${expected.applicationId}'.`,
    );
  }
  if (
    expected.scenarioHash !== undefined &&
    (!CONSUMER_ARTIFACT_HASH.test(expected.scenarioHash) || row.scenarioHash !== expected.scenarioHash)
  ) {
    throw consumerError(
      'SCENARIO_MISMATCH',
      'the scenario bytes differ from the expected consumer scenario.',
    );
  }
}

export function qualifyConsumerTargetRow(row, expected) {
  validateConsumerTargetRow(row);
  assertConsumerIdentity(row, expected);
  if (row.assertions === 0) {
    throw consumerError(
      'NO_ASSERTIONS',
      `the '${row.target}' run evaluated zero assertions, so a pass would prove nothing.`,
    );
  }
  if (row.pass !== true || row.failures.length > 0) {
    throw consumerError(
      'ASSERTION_FAILED',
      `the '${row.target}' consumer run failed: ${row.failures.join('; ') || 'assertions did not pass'}.`,
    );
  }
  return row;
}

export function assertConsumerTargetRows(rows, options) {
  const targets = options?.targets ?? CONSUMER_REQUIRED_TARGETS;
  if (
    !Array.isArray(rows) ||
    !Array.isArray(targets) ||
    targets.length === 0 ||
    targets.some((target) => !CONSUMER_REQUIRED_TARGETS.includes(target)) ||
    new Set(targets).size !== targets.length
  ) {
    throw consumerError(
      'ROW_MALFORMED',
      'required targets must be a non-empty, unique supported target list.',
    );
  }
  const validated = rows.map(validateConsumerTargetRow);
  const seen = new Set();
  for (const row of validated) {
    if (seen.has(row.target)) {
      throw consumerError('ROW_DUPLICATE', `more than one consumer row claims '${row.target}'.`);
    }
    seen.add(row.target);
  }
  const qualified = targets.map((target) => {
    const row = validated.find((candidate) => candidate.target === target);
    if (row === undefined) {
      throw consumerError(
        'ROW_MISSING',
        `no consumer gameplay row was recorded for target '${target}'.`,
      );
    }
    const expected =
      options?.expectedByTarget === undefined ? options : options.expectedByTarget[target];
    return qualifyConsumerTargetRow(row, expected);
  });
  // "One game, two targets" is only true if both targets evaluated the SAME assertions. Equal
  // counts are not that: a target that dropped one family and gained an unrelated id still counts
  // the same. Compare the id sets, so a degraded target cannot hide behind its sibling's evidence.
  const [first, ...rest] = qualified;
  for (const row of rest) {
    const a = [...first.assertionIds].sort().join(',');
    const b = [...row.assertionIds].sort().join(',');
    if (a !== b) {
      throw consumerError(
        'ASSERTION_SET_MISMATCH',
        `'${row.target}' evaluated [${b}] but '${first.target}' evaluated [${a}]; the same scenario must prove the same assertions on every target.`,
      );
    }
  }
  return qualified;
}

export function parseConsumerPlaytestReport(stdout, target, declaredFamilies = []) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw consumerError(
      'ROW_MALFORMED',
      `the '${target}' playtest runner emitted no JSON report: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw consumerError('ROW_MALFORMED', `the '${target}' playtest report is not an object.`);
  }
  const rawDiagnostics = parsed.diagnostics === undefined ? [] : parsed.diagnostics;
  if (!Array.isArray(rawDiagnostics) || rawDiagnostics.some((item) => !nonEmptyString(item?.code))) {
    throw consumerError('ROW_MALFORMED', 'the playtest diagnostics are malformed.');
  }
  const diagnostics = rawDiagnostics.map((item) => item.code);
  if (diagnostics.some((code) => code.endsWith('UNSUPPORTED_ON_TARGET'))) {
    throw consumerError(
      'SCENARIO_NOT_CROSS_TARGET',
      `the '${target}' runner cannot evaluate this scenario; use the harness's target-aware diagnostics policy.`,
    );
  }
  if (parsed.target !== target) {
    throw consumerError('TARGET_MISMATCH', `the report names '${String(parsed.target)}', not '${target}'.`);
  }
  if (typeof parsed.pass !== 'boolean') {
    throw consumerError('ROW_MALFORMED', 'the playtest verdict must be a boolean.');
  }
  if (!Array.isArray(parsed.assertionResults) || parsed.assertionResults.length === 0) {
    throw consumerError('NO_ASSERTIONS', `the '${target}' run evaluated zero assertions.`);
  }
  const failures = [];
  for (const result of parsed.assertionResults) {
    if (
      typeof result !== 'object' ||
      result === null ||
      Array.isArray(result) ||
      !nonEmptyString(result.id) ||
      typeof result.pass !== 'boolean'
    ) {
      throw consumerError(
        'ROW_MALFORMED',
        'every assertion must name its id and boolean result.',
      );
    }
    if (result.details?.reason === 'not-evaluated') {
      throw consumerError('NO_ASSERTIONS', `assertion '${result.id}' was not evaluated.`);
    }
    if (!result.pass) failures.push(result.id);
  }
  if (parsed.assertionResults.every((result) => result.id === 'diagnostics')) {
    throw consumerError('NO_ASSERTIONS', 'diagnostics alone do not prove consumer gameplay.');
  }
  const assertionIds = [...new Set(parsed.assertionResults.map((result) => result.id))].sort();
  const evaluated = new Set(assertionIds.map(consumerAssertionFamily));
  for (const family of declaredFamilies) {
    if (!evaluated.has(family)) {
      throw consumerError(
        'ASSERTION_FAMILY_MISSING',
        `the '${target}' run evaluated [${assertionIds.join(', ')}] but the scenario declares '${family}'; a run cannot qualify on assertions the scenario never declared.`,
      );
    }
  }
  for (const diagnostic of rawDiagnostics) {
    if (!['error', 'warning', 'info'].includes(diagnostic.severity)) {
      throw consumerError(
        'ROW_MALFORMED',
        `diagnostic '${diagnostic.code}' has no valid severity.`,
      );
    }
    if (diagnostic.severity === 'error') failures.push(diagnostic.code);
  }
  return {
    assertionIds,
    assertions: assertionIds.length,
    diagnostics,
    failures,
    pass: parsed.pass && failures.length === 0,
  };
}

function readConsumerApplicationId(projectRoot) {
  const config = join(projectRoot, 'threenative.config.ts');
  if (!existsSync(config)) {
    throw consumerError(
      'APPLICATION_ID_MISSING',
      `${config} is absent, so the built consumer's application id cannot be read.`,
    );
  }
  const match = /id\s*:\s*["'`]([^"'`]+)["'`]/u.exec(readFileSync(config, 'utf8'));
  if (match === null || match[1].includes('__')) {
    throw consumerError('APPLICATION_ID_MISSING', `no concrete app.id was found in ${config}.`);
  }
  return match[1];
}

function consumerArtifactFiles(root, predicate) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw consumerError('ARTIFACT_UNREADABLE', `${directory}: ${error.message}`);
    }
    for (const entry of entries) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        stack.push(file);
      } else if (entry.isFile() && predicate(file)) {
        files.push(file);
      }
    }
  }
  return files.sort();
}

function discoverConsumerArtifact(projectRoot, target) {
  if (target === 'desktop') {
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    const name = basename(String(manifest.name ?? 'starter').replace(/^@[^/]+\//u, ''));
    return join(
      projectRoot,
      'dist-native',
      `${name}${process.platform === 'win32' ? '.exe' : ''}`,
    );
  }
  const apks = consumerArtifactFiles(join(projectRoot, 'dist-native'), (file) => file.endsWith('.apk'));
  if (apks.length === 0) {
    throw consumerError(
      'ARTIFACT_MISSING',
      `no .apk was found under ${join(projectRoot, 'dist-native')}; build the Android consumer first.`,
    );
  }
  if (apks.length !== 1) {
    throw consumerError(
      'ARTIFACT_AMBIGUOUS',
      'multiple APKs exist; select the built consumer with --artifact.',
    );
  }
  return apks[0];
}

function adbDeviceIdentity(run) {
  const probe = (property) => {
    const value = run(['shell', 'getprop', property]).trim();
    if (!value) {
      throw consumerError('DEVICE_IDENTITY_UNREADABLE', `adb returned no ${property}.`);
    }
    return value;
  };
  return {
    architecture: probe('ro.product.cpu.abi'),
    osVersion: `${probe('ro.build.version.release')} (API ${probe('ro.build.version.sdk')})`,
  };
}

function assertInstalledConsumerArtifact(run, applicationId, artifactHash) {
  if (!/^[A-Za-z0-9_.-]+$/u.test(applicationId)) {
    throw consumerError(
      'APPLICATION_ID_MISMATCH',
      'the Android application id is not a safe package name.',
    );
  }
  const installed = run(['shell', 'pm', 'path', applicationId]).trim();
  const match = /^package:(\/[A-Za-z0-9_./+=~-]+\.apk)$/u.exec(installed);
  if (match === null) {
    throw consumerError(
      'ARTIFACT_MISMATCH',
      `cannot identify one installed APK for '${applicationId}'.`,
    );
  }
  const actual = run(['shell', 'sha256sum', match[1]]).trim().split(/\s+/u)[0];
  if (actual !== artifactHash) {
    throw consumerError(
      'ARTIFACT_MISMATCH',
      `installed '${applicationId}' does not match the supplied APK.`,
    );
  }
}

function recordConsumerTargetRow(projectRoot, row, target = row?.target) {
  const directory = join(projectRoot, 'artifacts', 'native');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'consumer-targets.json');
  let rows = [];
  if (existsSync(file)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw consumerError(
        'ROW_MALFORMED',
        `${file} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw consumerError('ROW_MALFORMED', `${file} is not a row array; refusing to overwrite it.`);
    }
    rows = parsed.map(validateConsumerTargetRow);
    if (new Set(rows.map((candidate) => candidate.target)).size !== rows.length) {
      throw consumerError('ROW_DUPLICATE', `${file} contains duplicate target rows.`);
    }
  }
  rows = rows.filter((candidate) => candidate.target !== target);
  if (row !== undefined) rows.push(validateConsumerTargetRow(row));
  writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
  return file;
}

function defaultConsumerRunner(
  command,
  args,
  cwd,
  timeoutMs = Number(process.env.TN_STARTER_CONSUMER_TIMEOUT_MS ?? 900_000),
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw consumerError('RUNNER_FAILED', 'the consumer timeout must be a positive integer.');
  }
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return { ...result, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

export function verifyStarterConsumerGameplay(options = {}) {
  const target = options.target;
  if (!CONSUMER_REQUIRED_TARGETS.includes(target)) {
    throw consumerError(
      'TARGET_UNSUPPORTED',
      `unsupported distributed target '${String(target)}'.`,
    );
  }
  const projectRoot = resolve(options.project ?? process.cwd());
  recordConsumerTargetRow(projectRoot, undefined, target);
  const scenario = options.scenario ?? CONSUMER_GAMEPLAY_SCENARIO;
  if (scenario !== CONSUMER_GAMEPLAY_SCENARIO) {
    throw consumerError('SCENARIO_MISMATCH', `this gate requires '${CONSUMER_GAMEPLAY_SCENARIO}'.`);
  }
  const scenarioPath = join(projectRoot, scenario);
  if (!existsSync(scenarioPath)) {
    throw consumerError('SCENARIO_MISSING', `the required consumer scenario is absent: ${scenarioPath}`);
  }
  const applicationId = options.applicationId ?? readConsumerApplicationId(projectRoot);
  const artifact = resolve(
    projectRoot,
    options.artifact ?? discoverConsumerArtifact(projectRoot, target),
  );
  if (!existsSync(artifact)) {
    throw consumerError('ARTIFACT_MISSING', `${artifact} does not exist; build the consumer first.`);
  }
  const hashFile = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const artifactHash = hashFile(artifact);
  const scenarioHash = hashFile(scenarioPath);
  let declaredFamilies = [];
  try {
    declaredFamilies = declaredConsumerAssertionFamilies(JSON.parse(readFileSync(scenarioPath, 'utf8')));
  } catch (error) {
    throw consumerError(
      'SCENARIO_MALFORMED',
      `the consumer scenario ${scenarioPath} is not readable JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  if (declaredFamilies.length === 0) {
    throw consumerError(
      'NO_ASSERTIONS',
      `the consumer scenario ${scenarioPath} declares no recognised assertion family, so no run against it can prove gameplay.`,
    );
  }
  const cli = join(
    projectRoot,
    'node_modules',
    '@threenative',
    'playtest',
    'dist',
    'runner',
    'cli.js',
  );
  if (!existsSync(cli)) {
    throw consumerError('RUNNER_MISSING', `the installed consumer runner is absent: ${cli}`);
  }
  const expected = options.expected ?? { applicationId, artifactHash, scenario, scenarioHash };
  assertConsumerIdentity({ applicationId, artifactHash, scenario, scenarioHash }, expected);
  const android = target === 'android';
  const device = options.device ?? process.env.TN_ANDROID_SERIAL ?? 'emulator-5554';
  const adb = options.adb ?? process.env.ADB ?? 'adb';
  const deviceRunner =
    options.deviceRunner ??
    ((command, args, cwd) => defaultConsumerRunner(command, args, cwd, 120_000));
  const runAdb = (args, code = 'DEVICE_IDENTITY_UNREADABLE') => {
    const result = deviceRunner(adb, ['-s', device, ...args], projectRoot);
    if (result.error || result.signal || result.status !== 0) {
      throw consumerError(
        code,
        `${args.join(' ')}: ${result.error?.message ?? result.stderr ?? 'adb failed'}`,
      );
    }
    return result.stdout ?? '';
  };
  const deviceIdentity =
    android && (options.osVersion === undefined || options.architecture === undefined)
      ? adbDeviceIdentity(runAdb)
      : undefined;
  const row = {
    applicationId,
    architecture: options.architecture ?? deviceIdentity?.architecture ?? process.arch,
    artifactHash,
    assertionIds: [],
    assertions: 0,
    failures: ['consumer run has not completed'],
    os: options.os ?? (android ? 'android' : process.platform),
    osVersion: options.osVersion ?? deviceIdentity?.osVersion ?? osRelease(),
    pass: false,
    scenario,
    scenarioHash,
    session:
      options.session ??
      (android
        ? String(device).startsWith('emulator-')
          ? 'android-emulator'
          : 'android-device'
        : describeConsumerSession(process.platform)),
    target,
  };
  recordConsumerTargetRow(projectRoot, row);
  const args = [
    cli,
    scenario,
    '--target',
    target,
    '--project',
    projectRoot,
    '--artifacts',
    join(projectRoot, 'artifacts', 'native', `consumer-${target}`),
  ];
  if (android) {
    args.push(
      '--device',
      device,
      '--adb',
      adb,
      '--package',
      applicationId,
      '--activity',
      options.activity ?? 'com.threenative.runtime.MystralActivity',
    );
  } else {
    args.push('--executable', artifact, '--host-arg', '--windowed');
  }
  try {
    if (android) {
      runAdb(['install', '-r', '--no-streaming', artifact], 'INSTALL_FAILED');
      assertInstalledConsumerArtifact(runAdb, applicationId, artifactHash);
    }
    const result = (options.runner ?? defaultConsumerRunner)(process.execPath, args, projectRoot);
    const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    writeFileSync(join(projectRoot, 'artifacts', 'native', `consumer-${target}.log`), log);
    writeFileSync(
      join(projectRoot, 'artifacts', 'native', `consumer-${target}.stdout.json`),
      result.stdout ?? '',
    );
    if (result.error || result.signal || !Number.isInteger(result.status)) {
      throw consumerError(
        'RUNNER_FAILED',
        `the '${target}' process did not complete: ${result.error?.message ?? result.signal ?? result.status}.`,
      );
    }
    const report = parseConsumerPlaytestReport(result.stdout ?? '', target, declaredFamilies);
    Object.assign(row, {
      assertionIds: report.assertionIds,
      assertions: report.assertions,
      failures: report.failures,
      pass: report.pass,
      log: log.slice(-4000),
    });
    if (result.status !== 0 && report.pass) {
      throw consumerError(
        'RUNNER_FAILED',
        `the '${target}' runner reported pass but exited ${result.status}.`,
      );
    }
    if (hashFile(artifact) !== artifactHash) {
      throw consumerError('ARTIFACT_MISMATCH', 'the consumer artifact changed during the run.');
    }
    if (hashFile(scenarioPath) !== scenarioHash) {
      throw consumerError('SCENARIO_MISMATCH', 'the consumer scenario changed during the run.');
    }
    if (android) assertInstalledConsumerArtifact(runAdb, applicationId, artifactHash);
    qualifyConsumerTargetRow(row, expected);
    recordConsumerTargetRow(projectRoot, row);
    return { expected, row };
  } catch (error) {
    row.pass = false;
    row.failures = [error instanceof Error ? error.message : String(error)];
    recordConsumerTargetRow(projectRoot, row);
    throw error;
  }
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    if (process.argv.includes('--qualify-existing')) {
      const target = optionValue('--target', 'desktop');
      if (!CONSUMER_REQUIRED_TARGETS.includes(target)) {
        throw consumerError('TARGET_UNSUPPORTED', `unsupported distributed target '${target}'.`);
      }
      const project = resolve(optionValue('--project', process.cwd()));
      const applicationId = optionValue('--application-id', undefined) ?? readConsumerApplicationId(project);
      const artifact = resolve(
        project,
        optionValue('--artifact', undefined) ?? discoverConsumerArtifact(project, target),
      );
      const artifactHash = createHash('sha256').update(readFileSync(artifact)).digest('hex');
      const file = join(project, 'artifacts', 'native', 'consumer-targets.json');
      if (!existsSync(file)) {
        throw consumerError('ROW_MISSING', `${file} is absent; run --consumer first.`);
      }
      const rows = JSON.parse(readFileSync(file, 'utf8'));
      assertConsumerTargetRows(rows, {
        applicationId,
        artifactHash,
        scenario: CONSUMER_GAMEPLAY_SCENARIO,
        scenarioHash: createHash('sha256')
          .update(readFileSync(join(project, CONSUMER_GAMEPLAY_SCENARIO)))
          .digest('hex'),
        targets: [target],
      });
      console.log(
        `existing ${target} consumer row matches the built consumer ${artifactHash.slice(0, 12)}`,
      );
      process.exit(0);
    }
    const { row } = verifyStarterConsumerGameplay({
      adb: optionValue('--adb', undefined),
      activity: optionValue('--activity', undefined),
      applicationId: optionValue('--application-id', undefined),
      artifact: optionValue('--artifact', undefined),
      device: optionValue('--device', undefined),
      project: optionValue('--project', process.cwd()),
      scenario: optionValue('--scenario', CONSUMER_GAMEPLAY_SCENARIO),
      target: optionValue('--target', 'desktop'),
    });
    console.log(
      `consumer gameplay qualified on ${row.target}: ${row.assertions} assertions, artifact ${row.artifactHash.slice(0, 12)}, app ${row.applicationId}`,
    );
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
