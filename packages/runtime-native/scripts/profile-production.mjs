#!/usr/bin/env node

import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import { readAndroidConfig } from './package-android.mjs';

import {
  PRODUCTION_EVIDENCE_VERSION,
  ProductionEvidenceError,
  meanFps,
  nearestRank,
  sha256,
  writeProductionEvidence,
} from './production-evidence.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../..');
const inRepositoryCheckout = existsSync(join(repositoryRoot, 'pnpm-workspace.yaml'));
const commandRoot = inRepositoryCheckout ? repositoryRoot : process.cwd();
const packageRequire = createRequire(import.meta.url);
const platformerScenario = 'playtests/performance.playtest.json';
const nativeTargets = new Set(['android', 'android-physical', 'desktop', 'ios', 'ios-physical']);
const physicalTargets = new Set(['android-physical', 'ios-physical']);
const supportedTargets = new Set(['android', 'android-physical', 'desktop', 'desktop-pair', 'fixture', 'ios', 'ios-physical', 'web']);
const supportedControls = new Set([
  'claimed-audio-missing-evidence',
  'dirty-checkout',
  'disallowed-identifiers',
  'early-exit',
  'memory-growth',
  'missing-marker',
  'slow-native',
  'slow-path',
  'slow-startup',
  'stale-source-sha',
  'substitute-emulator-provenance',
]);
const SLOW_FRAME_DELAY_MS = 50;
const SLOW_FRAME_COUNT = 60;
const SLOW_STARTUP_DELAY_MS = 5_100;
const FRAME_SAMPLE_BATCH_SIZE = 30;
const DESKTOP_SCREENSHOT_TIMEOUT_MS = 5_000;

function installedPackageFile(packageName, file) {
  try {
    return join(dirname(packageRequire.resolve(`${packageName}/package.json`)), file);
  } catch {
    return undefined;
  }
}

export function resolveProductionTools() {
  const localScaffold = join(repositoryRoot, 'packages/create-threenative/dist/index.js');
  const localPlaytest = join(repositoryRoot, 'packages/playtest/dist/runner/cli.js');
  const localRunner = join(repositoryRoot, 'packages/playtest/dist/runner/index.js');
  return {
    playtestCli: inRepositoryCheckout && existsSync(localPlaytest)
      ? localPlaytest
      : installedPackageFile('@threenative/playtest', 'dist/runner/cli.js'),
    playtestRunner: inRepositoryCheckout && existsSync(localRunner)
      ? localRunner
      : installedPackageFile('@threenative/playtest', 'dist/runner/index.js'),
    scaffoldCli: inRepositoryCheckout && existsSync(localScaffold)
      ? localScaffold
      : installedPackageFile('create-threenative', 'dist/index.js'),
  };
}

export function parseProductionArgs(argv = process.argv.slice(2)) {
  const options = {
    audioEvidence: undefined,
    coldStarts: 1,
    config: undefined,
    control: undefined,
    device: undefined,
    duration: 60,
    out: '.runtime/prd064/production',
    physicalEvidence: undefined,
    renderSize: { height: 1080, width: 1920 },
    repetitions: 3,
    sourceSha: undefined,
    target: undefined,
    warmup: 60,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--') continue;
    if (flag === '--audio-evidence') options.audioEvidence = nextValue(argv, ++index, flag);
    else if (flag === '--cold-starts') options.coldStarts = positiveInteger(nextValue(argv, ++index, flag), flag);
    else if (flag === '--config') options.config = nextValue(argv, ++index, flag);
    else if (flag === '--control') options.control = nextValue(argv, ++index, flag);
    else if (flag === '--device') options.device = nextValue(argv, ++index, flag);
    else if (flag === '--duration') options.duration = positiveNumber(nextValue(argv, ++index, flag), flag);
    else if (flag === '--out') options.out = nextValue(argv, ++index, flag);
    else if (flag === '--physical-evidence') options.physicalEvidence = nextValue(argv, ++index, flag);
    else if (flag === '--render-size') options.renderSize = parseRenderSize(nextValue(argv, ++index, flag));
    else if (flag === '--repetitions') options.repetitions = positiveInteger(nextValue(argv, ++index, flag), flag);
    else if (flag === '--source-sha') options.sourceSha = nextValue(argv, ++index, flag);
    else if (flag === '--target') options.target = nextValue(argv, ++index, flag);
    else if (flag === '--warmup') options.warmup = positiveNumber(nextValue(argv, ++index, flag), flag);
    else if (flag === '--help') return { ...options, help: true };
    else throw new ProductionEvidenceError('TN_PROD_CLI_USAGE', `Unknown production profile option '${flag}'.`);
  }
  if (options.target === undefined) throw new ProductionEvidenceError('TN_PROD_CLI_USAGE', 'Production profile requires --target.');
  return validateProductionOptions(options);
}

export function validateProductionOptions(input) {
  const options = normalizeOptions(input);
  if (options.help) return options;
  if (!supportedTargets.has(options.target)) {
    throw new ProductionEvidenceError('TN_PROD_TARGET_UNSUPPORTED', `Production target '${options.target}' is not supported.`);
  }
  if (options.control !== undefined && !supportedControls.has(options.control)) {
    throw new ProductionEvidenceError('TN_PROD_CONTROL_UNSUPPORTED', `Production control '${options.control}' is not supported.`);
  }
  if (options.target === 'fixture' && options.control === undefined) {
    throw new ProductionEvidenceError('TN_PROD_FIXTURE_CONTROL_REQUIRED', 'The fixture target is available only as an explicit negative control.');
  }
  if (options.device !== undefined && !nativeTargets.has(options.target)) {
    throw new ProductionEvidenceError('TN_PROD_DEVICE_UNSUPPORTED', `--device is not valid for target '${options.target}'.`);
  }
  if ((options.target === 'android' || options.target === 'android-physical') && options.device === undefined) {
    throw new ProductionEvidenceError('TN_PROD_DEVICE_REQUIRED', `Target '${options.target}' requires --device so the selected device is recorded and driven.`);
  }
  if (physicalTargets.has(options.target) && options.device === undefined) {
    throw new ProductionEvidenceError('TN_PROD_DEVICE_REQUIRED', `Target '${options.target}' requires --device.`);
  }
  if (options.target === 'desktop-pair' && options.control === 'slow-native') return options;
  if (options.control === 'slow-native' && options.target !== 'desktop-pair') {
    throw new ProductionEvidenceError('TN_PROD_CONTROL_UNSUPPORTED', "The 'slow-native' control requires --target desktop-pair.");
  }
  if (options.target === 'fixture' && options.device !== undefined) {
    throw new ProductionEvidenceError('TN_PROD_DEVICE_UNSUPPORTED', 'Fixture controls cannot accept --device.');
  }
  if (nativeTargets.has(options.target) && options.target !== 'desktop' && options.target !== 'desktop-pair'
    && (options.renderSize.width !== 1920 || options.renderSize.height !== 1080)) {
    throw new ProductionEvidenceError('TN_PROD_RENDER_SIZE_UNSUPPORTED', `--render-size is not controllable for target '${options.target}'.`);
  }
  return options;
}

export async function runProductionProfile(input, dependencies = {}) {
  const options = validateProductionOptions(input);
  if (options.help) return { help: true, status: 'PASS', exitCode: 0 };
  const sourceState = await currentSourceState();
  const requiredSourceSha = sourceState.sha;
  const sourceSha = options.sourceSha ?? requiredSourceSha;
  const runId = `${options.target}-${Date.now()}`;
  const physicalEvidence = await readPhysicalEvidence(options.physicalEvidence);
  const audioEvidence = await readOptionalArtifact(options.audioEvidence);
  const context = { audioEvidence, physicalEvidence, requiredSourceSha, sourceSha, sourceState };
  const collected = options.target === 'fixture'
    ? await createFixtureControlEvidence(options, context, runId)
    : await (dependencies.collectProduction ?? collectProduction)(options, context, runId);
  const evidence = applyNegativeControl(collected, options.control);
  const result = await writeProductionEvidence(evidence, options.out, { requiredSourceSha });
  return { ...result.manifest, manifestPath: result.manifestPath };
}

export async function collectProduction(options, context, runId) {
  const tools = resolveProductionTools();
  if (tools.scaffoldCli === undefined || !await fileExists(tools.scaffoldCli)) {
    throw new ProductionEvidenceError(
      'TN_PROD_SCAFFOLDER_UNAVAILABLE',
      "The installed 'create-threenative' package does not expose its built scaffolder; install it or run the repository build first.",
    );
  }
  if (tools.playtestCli === undefined || !await fileExists(tools.playtestCli)) {
    throw new ProductionEvidenceError(
      'TN_PROD_PLAYTEST_UNAVAILABLE',
      "The installed '@threenative/playtest' package does not expose its built runner; install it or run the repository build first.",
    );
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'threenative-production-'));
  const project = join(temporaryRoot, 'platformer');
  const startedAt = new Date().toISOString();
  try {
    await scaffoldPlatformer(project, tools);
    const scenarios = await writeRunScenarios(project, options);
    const artifactsRoot = join(project, 'artifacts', 'production');
    await mkdir(artifactsRoot, { recursive: true });
    const web = options.target === 'web' || options.target === 'desktop-pair'
      ? await collectWeb(project, scenarios, artifactsRoot, options, tools)
      : undefined;
    const native = nativeTargets.has(options.target) || options.target === 'desktop-pair'
      ? await collectNative(project, scenarios, artifactsRoot, options, tools)
      : undefined;
    return assembleEvidence({
      context,
      native,
      options,
      performanceBounds: scenarios.performanceBounds,
      project,
      runId,
      startedAt,
      web,
    });
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

function normalizeOptions(input = {}) {
  const renderSize = typeof input.renderSize === 'string' ? parseRenderSize(input.renderSize) : input.renderSize;
  const target = input.target === 'desktop-web' ? 'web' : input.target;
  return {
    audioEvidence: input.audioEvidence,
    coldStarts: input.coldStarts ?? 1,
    control: input.control,
    device: input.device,
    duration: input.duration ?? 60,
    help: input.help,
    out: input.out ?? '.runtime/prd064/production',
    physicalEvidence: input.physicalEvidence,
    renderSize: renderSize ?? { height: 1080, width: 1920 },
    repetitions: input.repetitions ?? 3,
    sourceSha: input.sourceSha,
    target,
    warmup: input.warmup ?? 60,
  };
}

function warmupFramesFor(options) {
  return Math.max(0, Math.ceil((options.warmup ?? 0) * 60));
}

async function scaffoldPlatformer(project, tools) {
  const packageArchiveRoot = join(project, '..', 'package-archives');
  await mkdir(packageArchiveRoot, { recursive: true });
  const packageSource = async (name, directory) => [name, await packLocalPackage(directory, packageArchiveRoot)];
  const localSources = [];
  if (inRepositoryCheckout) {
    localSources.push(await packageSource('@threenative/core', join(repositoryRoot, 'packages/core')));
    localSources.push(await packageSource('@threenative/physics', join(repositoryRoot, 'packages/physics')));
    localSources.push(await packageSource('@threenative/playtest', join(repositoryRoot, 'packages/playtest')));
    localSources.push(await packageSource('@threenative/runtime-native', join(repositoryRoot, 'packages/runtime-native')));
    localSources.push(await packageSource('@threenative/ui', join(repositoryRoot, 'packages/ui')));
    localSources.push(await packageSource('create-threenative', join(repositoryRoot, 'packages/create-threenative')));
  }
  const args = [
    tools.scaffoldCli,
    project,
    '--template', 'platformer',
    ...localSources.flatMap(([name, source]) => [packageSourceFlag(name), source]),
  ];
  const result = await runCommand(process.execPath, args, commandRoot);
  if (result.status !== 0) {
    throw new ProductionEvidenceError('TN_PROD_SCAFFOLD_FAILED', 'Scaffolding the production platformer failed.');
  }
}

async function packLocalPackage(directory, destination) {
  const before = new Set(await readdir(destination));
  const result = await runCommand('pnpm', ['pack', '--pack-destination', destination], directory);
  if (result.status !== 0) throw new ProductionEvidenceError('TN_PROD_PACKAGE_ARCHIVE_FAILED', `Packing local package '${basename(directory)}' failed.`);
  const archive = (await readdir(destination)).find((entry) => entry.endsWith('.tgz') && !before.has(entry));
  if (archive === undefined) throw new ProductionEvidenceError('TN_PROD_PACKAGE_ARCHIVE_FAILED', `Packing local package '${basename(directory)}' produced no archive.`);
  return join(destination, archive);
}

function packageSourceFlag(name) {
  return name === '@threenative/core'
    ? '--core-package'
    : name === '@threenative/physics'
      ? '--physics-package'
      : name === '@threenative/playtest'
        ? '--playtest-package'
        : name === '@threenative/runtime-native'
          ? '--runtime-native-package'
          : name === '@threenative/ui'
            ? '--ui-package'
            : '--cli-package';
}

export async function writeRunScenarios(project, options) {
  const source = JSON.parse(await readFile(join(project, platformerScenario), 'utf8'));
  const sourceAssertions = source.assert && typeof source.assert === 'object' && !Array.isArray(source.assert)
    ? source.assert
    : {};
  const { performance: performanceBounds, ...playtestAssertions } = sourceAssertions;
  const workloadAssertions = Object.keys(playtestAssertions).length === 0
    ? { diagnostics: { noConsoleErrors: true, runtimeReady: true } }
    : playtestAssertions;
  const { assert: _sourceAssertions, ...scenarioSource } = source;
  const workloadFrames = Math.max(1, Math.ceil(options.duration * 60));
  const warmupFrames = Math.max(0, Math.ceil(options.warmup * 60));
  const workload = {
    ...scenarioSource,
    assert: workloadAssertions,
    artifacts: { screenshots: 'after' },
    steps: [
      { holdFrames: Math.min(60, workloadFrames), kind: 'input', press: 'ArrowRight', release: true },
      { kind: 'wait', release: true, waitFrames: workloadFrames },
    ],
    viewport: options.renderSize,
    warmupFrames,
  };
  const startup = {
    ...scenarioSource,
    assert: { diagnostics: { noConsoleErrors: true, runtimeReady: true } },
    artifacts: { screenshots: 'after' },
    steps: [{ kind: 'wait', release: true, waitFrames: 1 }],
    viewport: options.renderSize,
    warmupFrames: 0,
  };
  const nativeTarget = options.target === 'desktop' || options.target === 'desktop-pair' ? 'desktop' : 'device';
  const nativeWorkload = { ...workload, artifacts: { screenshots: nativeTarget === 'desktop' ? 'after' : false } };
  const nativeStartup = { ...startup, artifacts: { screenshots: 'after' } };
  const workloadPath = join(project, 'playtests/production-performance.run.playtest.json');
  const startupPath = join(project, 'playtests/production-startup.run.playtest.json');
  const nativeWorkloadPath = join(project, 'playtests/production-performance.native.playtest.json');
  const nativeStartupPath = join(project, 'playtests/production-startup.native.playtest.json');
  await writeFile(workloadPath, `${JSON.stringify(workload, null, 2)}\n`);
  await writeFile(startupPath, `${JSON.stringify(startup, null, 2)}\n`);
  await writeFile(nativeWorkloadPath, `${JSON.stringify(nativeWorkload, null, 2)}\n`);
  await writeFile(nativeStartupPath, `${JSON.stringify(nativeStartup, null, 2)}\n`);
  return {
    ...(performanceBounds === undefined ? {} : { performanceBounds }),
    nativeStartupPath,
    nativeWorkloadPath,
    startupPath,
    workloadPath,
  };
}

async function collectWeb(project, scenarios, artifactsRoot, options, tools) {
  const markerServer = await createFrameMarkerServer();
  try {
    await installWebProfileEntry(project, markerServer.url, options.control, warmupFramesFor(options));
    const build = await runCommand('pnpm', ['run', 'build:web'], project);
    if (build.status !== 0) throw new ProductionEvidenceError('TN_PROD_WEB_BUILD_FAILED', 'The scaffolded platformer web build failed.');
    const artifactSha = await hashPath(join(project, 'dist'));
    const runs = [];
    const startups = [];
    for (let coldStart = 0; coldStart < options.coldStarts; coldStart += 1) {
      const startup = await runWebScenario(project, scenarios.startupPath, join(artifactsRoot, `web-startup-${coldStart + 1}`), markerServer, tools.playtestCli);
      startups.push(startup);
      for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
        runs.push(await runWebScenario(
          project,
          scenarios.workloadPath,
          join(artifactsRoot, `web-${coldStart + 1}-${repetition + 1}`),
          markerServer,
          tools.playtestCli,
        ));
      }
    }
    return {
      artifactSha,
      applicationClass: 'platformer-web-build',
      driverClass: 'playwright-chromium-webgpu',
      kind: 'web',
      runs,
      startups,
    };
  } finally {
    await markerServer.close();
  }
}

async function runWebScenario(project, scenarioPath, artifactDirectory, markerServer, playtestCli) {
  await mkdir(artifactDirectory, { recursive: true });
  const port = await availablePort();
  const relativeArtifact = relative(project, artifactDirectory);
  const args = [
    playtestCli,
    relative(project, scenarioPath),
    '--artifacts', relativeArtifact,
    '--browser-recipe', 'webgpu',
    '--project', project,
    '--server-command', `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    '--timeout', '30000',
    '--url', `http://127.0.0.1:${port}`,
  ];
  const command = await browserCommand(args);
  const markerIndex = markerServer.length;
  const startedAt = performance.now();
  const result = await runCommand(command.command, command.args, commandRoot, undefined, 180_000);
  const markers = await markerServer.waitFor(markerIndex, 1_000);
  const report = parsePlaytestReport(result.stdout);
  return normalizeRun(
    result,
    artifactDirectory,
    'web',
    report,
    markers?.firstFrame === undefined ? undefined : markers.firstFrame.receivedAt - startedAt,
    markers?.samples ?? [],
  );
}

async function collectNative(project, scenarios, artifactsRoot, options, tools) {
  const target = options.target === 'desktop-pair' || options.target === 'desktop' ? 'desktop' : options.target.startsWith('ios') ? 'ios' : 'android';
  await installNativeProfileEntry(project, target, options);
  const build = await runCommand('pnpm', ['run', `build:${target}`], project);
  if (build.status !== 0) throw new ProductionEvidenceError(`TN_PROD_${target.toUpperCase()}_BUILD_FAILED`, `The scaffolded platformer ${target} build failed.`);
  const artifactPath = await nativeArtifactPath(project, target);
  const artifactSha = await hashPath(artifactPath);
  const runs = [];
  const startups = [];
  for (let coldStart = 0; coldStart < options.coldStarts; coldStart += 1) {
    const startup = await runNativeScenario(project, target, scenarios.nativeStartupPath, join(artifactsRoot, `native-startup-${coldStart + 1}`), options, artifactPath, tools);
    startups.push(startup);
    for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
      runs.push(await runNativeScenario(
        project,
        target,
        scenarios.nativeWorkloadPath,
        join(artifactsRoot, `native-${coldStart + 1}-${repetition + 1}`),
        options,
        artifactPath,
        tools,
      ));
    }
  }
  return {
    artifactSha,
    applicationClass: `platformer-${target}-build`,
    driverClass: `threenative-${target}-runtime`,
    kind: target,
    runs,
    startups,
  };
}

async function runNativeScenario(project, target, scenarioPath, artifactDirectory, options, artifactPath, tools) {
  await mkdir(artifactDirectory, { recursive: true });
  if (target === 'desktop') {
    return await runDesktopBridgeScenario(project, scenarioPath, artifactDirectory, options, artifactPath, tools);
  }
  const modulePath = await playtestRunnerPath(project, tools);
  if (modulePath === undefined) {
    return { elapsedMs: undefined, report: undefined, screenshot: undefined, series: undefined, status: 2 };
  }
  if (target === 'android') await installAndroidArtifact(artifactPath, options.device);
  // The game declares its identity in `threenative.config.ts` and packaging resolves it; profiling
  // launches whatever packaging shipped, so it reads the id from there instead of restating one.
  const appId = readAndroidConfig(options.config).app.id;
  const config = {
    android: { activity: 'com.threenative.runtime.MystralActivity', packageName: appId },
    artifactDirectory,
    device: options.device,
    headless: true,
    ios: {
      appPath: target === 'ios' ? artifactPath : undefined,
      bundleId: appId,
      transport: options.target === 'ios-physical' ? 'device' : 'simulator',
    },
    projectPath: project,
    scenarioPath: relative(project, scenarioPath),
    target,
    timeoutMs: 30_000,
    trace: false,
    url: 'http://127.0.0.1:41777',
  };
  const runner = await import(pathToFileURL(modulePath).href);
  const started = performance.now();
  const startedAt = Date.now();
  try {
    const report = target === 'android'
      ? await runner.runAndroidPlaytest(config)
      : await runner.runIosPlaytest(config);
    return normalizeRun(
      { durationMs: performance.now() - started, status: report.pass ? 0 : 1 },
      artifactDirectory,
      target,
      report,
      firstFrameMsFromReport(report, startedAt),
      frameSeriesFromReport(report),
    );
  } catch {
    return { elapsedMs: performance.now() - started, report: undefined, screenshot: undefined, series: undefined, status: 2 };
  }
}

async function runDesktopBridgeScenario(project, scenarioPath, artifactDirectory, options, artifactPath, tools) {
  const modulePath = await playtestRunnerPath(project, tools);
  if (modulePath === undefined) {
    return { elapsedMs: undefined, report: undefined, screenshot: undefined, series: undefined, status: 2 };
  }
  const mailboxRoot = join(project, '.runtime-mailbox');
  await mkdir(mailboxRoot, { recursive: true });
  await removeMailbox(mailboxRoot);
  const requestPath = join(mailboxRoot, 'tn-playtest-request.json');
  const responsePath = join(mailboxRoot, 'tn-playtest-response.json');
  const screenshotRequestPath = join(mailboxRoot, 'tn-production-screenshot-request.json');
  const runner = await import(pathToFileURL(modulePath).href);
  const mailbox = {
    read: async (path) => readFile(path, 'utf8').catch((error) => error?.code === 'ENOENT' ? undefined : Promise.reject(error)),
    remove: async (path) => rm(path, { force: true }).catch(() => undefined),
    write: async (path, contents) => writeFile(path, contents, 'utf8'),
  };
  const innerTransport = new runner.DeviceMailboxTransport(mailbox, { request: requestPath, response: responsePath });
  const driver = createDesktopDriver(artifactPath, project, options, screenshotRequestPath);
  const transport = {
    capabilities: innerTransport.capabilities,
    call: innerTransport.call.bind(innerTransport),
    close: innerTransport.close.bind(innerTransport),
    start: async () => {
      await innerTransport.start();
      await driver.launch();
    },
    waitForBridge: innerTransport.waitForBridge.bind(innerTransport),
  };
  const config = {
    artifactDirectory,
    headless: true,
    projectPath: project,
    scenarioPath: relative(project, scenarioPath),
    target: 'android',
    timeoutMs: 30_000,
    trace: false,
    url: 'http://127.0.0.1:41777',
  };
  const started = performance.now();
  const startedAt = Date.now();
  try {
    const report = await runner.runDevicePlaytest(config, {
      driver,
      mailboxPaths: { request: requestPath, response: responsePath },
      name: 'desktop',
      processName: 'threenative-platformer-desktop',
      transport,
    });
    return normalizeRun(
      { durationMs: performance.now() - started, status: report.pass ? 0 : 1 },
      artifactDirectory,
      'desktop',
      report,
      firstFrameMsFromReport(report, startedAt),
      frameSeriesFromReport(report),
    );
  } catch {
    await driver.stop();
    return { elapsedMs: performance.now() - started, report: undefined, screenshot: undefined, series: undefined, status: 2 };
  }
}

function createDesktopDriver(artifactPath, project, options, screenshotRequestPath) {
  let child;
  let output = '';
  return {
    captureConsole: async () => output.split(/\r?\n/u).filter(Boolean).map((text) => ({ text, type: /\b(?:Error|FAILED|FATAL)\b/u.test(text) ? 'error' : 'log' })),
    isAlive: async () => child !== undefined && child.exitCode === null,
    launch: async () => {
      child = spawnNative(artifactPath, project, options);
      child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    },
    prepare: async () => undefined,
    readFile: async (path) => readFile(path, 'utf8').catch((error) => error?.code === 'ENOENT' ? undefined : Promise.reject(error)),
    removeFile: async (path) => rm(path, { force: true }).catch(() => undefined),
    screenshot: async (path) => {
      const temporary = `${screenshotRequestPath}.tmp`;
      await writeFile(temporary, JSON.stringify({ path }), 'utf8');
      await rename(temporary, screenshotRequestPath);
      const deadline = Date.now() + DESKTOP_SCREENSHOT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await nonBlankPng(path)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('TN_PROD_NATIVE_SCREENSHOT_UNAVAILABLE');
    },
    stop: async () => {
      if (child === undefined || child.exitCode !== null) return;
      if (process.platform === 'win32') child.kill();
      else process.kill(-child.pid, 'SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    },
    writeFile: async (path, contents) => writeFile(path, contents, 'utf8'),
  };
}

function spawnNative(artifactPath, project, options) {
  const bundle = join(project, '.threenative/build/game.js');
  const nativeArgs = [
    'run',
    bundle,
    '--width', String(options.renderSize.width),
    '--height', String(options.renderSize.height),
    '--headless',
  ];
  const command = process.platform === 'linux' && process.env.DISPLAY === undefined ? 'xvfb-run' : artifactPath;
  const args = command === 'xvfb-run' ? ['-a', '-s', '-screen 0 1600x900x24', artifactPath, ...nativeArgs] : nativeArgs;
  return spawn(command, args, {
    cwd: project,
    detached: process.platform !== 'win32',
    env: { ...process.env, SDL_VIDEODRIVER: process.platform === 'linux' ? 'x11' : process.env.SDL_VIDEODRIVER },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function installNativeProfileEntry(project, target, options) {
  const entryPath = join(project, 'src/profile-native-entry.ts');
  const mailboxRoot = join(project, '.runtime-mailbox');
  const mailbox = target === 'desktop'
    ? `globalThis.TN_PLAYTEST_MAILBOX = { request: ${JSON.stringify(join(mailboxRoot, 'tn-playtest-request.json'))}, response: ${JSON.stringify(join(mailboxRoot, 'tn-playtest-response.json'))};\n`
    : '';
  const screenshotRequestPath = target === 'desktop' ? join(mailboxRoot, 'tn-production-screenshot-request.json') : undefined;
  const source = `import game from "./game.js";\n${nativeFrameInstrumentation(options.control, warmupFramesFor(options), screenshotRequestPath)}\n${mailbox}export default game;\n`;
  await writeFile(entryPath, source);
  const packagePath = join(project, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  packageJson.threenative = { ...packageJson.threenative, nativeEntry: 'src/profile-native-entry.ts' };
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function productionPerformanceReader() {
  return `
const tnProductionReadPerformance = () => {
  const bridge = globalThis.__THREENATIVE_PLAYTEST_BRIDGE__;
  if (typeof bridge?.sample !== "function") return {};
  try {
    const snapshot = bridge.sample({});
    if (snapshot === null || typeof snapshot !== "object" || typeof snapshot.then === "function") return {};
    const performance = snapshot.performance;
    return {
      ...(Number.isFinite(performance?.drawCalls) ? { drawCalls: performance.drawCalls } : {}),
      ...(Number.isFinite(performance?.triangles) ? { triangles: performance.triangles } : {}),
    };
  } catch {
    return {};
  }
};
`;
}

export function nativeFrameInstrumentation(control, warmupFrames = 0, screenshotRequestPath = undefined) {
  return `
const tnProductionControl = ${JSON.stringify(control ?? '')};
const tnProductionWarmupFrames = ${Math.max(0, Math.floor(warmupFrames))};
const tnProductionScreenshotRequestPath = ${JSON.stringify(screenshotRequestPath)};
const tnProductionRequestAnimationFrame = globalThis.requestAnimationFrame;
if (typeof tnProductionRequestAnimationFrame !== "function") {
  throw new Error("TN_PROD_NATIVE_RAF_UNAVAILABLE: native host did not provide requestAnimationFrame.");
}
let tnProductionFirstFrame = true;
let tnProductionFrameIndex = 0;
let tnProductionPreviousFrame;
let tnProductionSamples = [];
let tnProductionSlowFramesRemaining = ${SLOW_FRAME_COUNT};
const tnProductionBusyWait = (milliseconds) => {
  const deadline = performance.now() + milliseconds;
  while (performance.now() < deadline) {}
};
${productionPerformanceReader()}
globalThis.requestAnimationFrame = (callback) => tnProductionRequestAnimationFrame((timestamp) => {
  const frameIndex = tnProductionFrameIndex++;
  const inWarmup = frameIndex < tnProductionWarmupFrames;
  if (frameIndex === tnProductionWarmupFrames) {
    tnProductionPreviousFrame = undefined;
    tnProductionSamples = [];
  }
  if (tnProductionFirstFrame && tnProductionControl === "slow-startup") tnProductionBusyWait(${SLOW_STARTUP_DELAY_MS});
  const now = performance.now();
  const frameMs = inWarmup || tnProductionPreviousFrame === undefined ? undefined : now - tnProductionPreviousFrame;
  tnProductionPreviousFrame = now;
  callback(timestamp);
  if (tnProductionFirstFrame) {
    tnProductionFirstFrame = false;
    console.log("TN_PROD_FIRST_NONBLANK_FRAME:" + Date.now());
  }
  if (!inWarmup && frameMs !== undefined) {
    tnProductionSamples.push({ ...tnProductionReadPerformance(), frameIndex, frameMs });
    if (tnProductionSamples.length >= ${FRAME_SAMPLE_BATCH_SIZE}) {
      console.log("TN_PROD_FRAME_SAMPLES:" + JSON.stringify(tnProductionSamples));
      tnProductionSamples = [];
    }
  }
  if (tnProductionScreenshotRequestPath !== undefined) {
    const nativeHost = globalThis.__THREENATIVE_NATIVE__;
    const receive = nativeHost?.playtest?.receive;
    const capture = nativeHost?.captureScreenshot;
    if (typeof receive === "function" && typeof capture === "function") {
      const request = receive(tnProductionScreenshotRequestPath);
      if (typeof request === "string") {
        try {
          const payload = JSON.parse(request);
          if (typeof payload.path === "string") capture(payload.path);
        } catch {}
      }
    }
  }
  if (!inWarmup && tnProductionControl === "slow-native" && tnProductionSlowFramesRemaining > 0) {
    tnProductionBusyWait(${SLOW_FRAME_DELAY_MS});
    tnProductionSlowFramesRemaining -= 1;
  }
});
`;
}

export function webFrameInstrumentation(markerUrl, control, warmupFrames = 0) {
  return `
const tnProductionControl = ${JSON.stringify(control ?? '')};
const tnProductionWarmupFrames = ${Math.max(0, Math.floor(warmupFrames))};
const tnProductionMarkerUrl = ${JSON.stringify(markerUrl)};
const tnProductionRequestAnimationFrame = globalThis.requestAnimationFrame;
if (typeof tnProductionRequestAnimationFrame !== "function") {
  throw new Error("TN_PROD_WEB_RAF_UNAVAILABLE: browser host did not provide requestAnimationFrame.");
}
let tnProductionFirstFrame = true;
let tnProductionFrameIndex = 0;
let tnProductionPreviousFrame;
let tnProductionSamples = [];
let tnProductionSlowFramesRemaining = ${SLOW_FRAME_COUNT};
const tnProductionBusyWait = (milliseconds) => {
  const deadline = performance.now() + milliseconds;
  while (performance.now() < deadline) {}
};
const tnProductionPost = (payload) => {
  void fetch(tnProductionMarkerUrl, {
    body: JSON.stringify(payload),
    keepalive: true,
    method: "POST",
    mode: "no-cors",
  }).catch(() => undefined);
};
${productionPerformanceReader()}
globalThis.requestAnimationFrame = (callback) => tnProductionRequestAnimationFrame((timestamp) => {
  const frameIndex = tnProductionFrameIndex++;
  const inWarmup = frameIndex < tnProductionWarmupFrames;
  if (frameIndex === tnProductionWarmupFrames) {
    tnProductionPreviousFrame = undefined;
    tnProductionSamples = [];
  }
  if (tnProductionFirstFrame && tnProductionControl === "slow-startup") tnProductionBusyWait(${SLOW_STARTUP_DELAY_MS});
  const now = performance.now();
  const frameMs = inWarmup || tnProductionPreviousFrame === undefined ? undefined : now - tnProductionPreviousFrame;
  tnProductionPreviousFrame = now;
  callback(timestamp);
  if (tnProductionFirstFrame) {
    tnProductionFirstFrame = false;
    tnProductionPost({ kind: "first-frame" });
  }
  if (!inWarmup && frameMs !== undefined) {
    tnProductionSamples.push({ ...tnProductionReadPerformance(), frameIndex, frameMs });
    if (tnProductionSamples.length >= ${FRAME_SAMPLE_BATCH_SIZE}) {
      tnProductionPost({ kind: "samples", samples: tnProductionSamples });
      tnProductionSamples = [];
    }
  }
  if (!inWarmup && tnProductionControl === "slow-path" && tnProductionSlowFramesRemaining > 0) {
    tnProductionBusyWait(${SLOW_FRAME_DELAY_MS});
    tnProductionSlowFramesRemaining -= 1;
  }
});
`;
}

async function installWebProfileEntry(project, markerUrl, control, warmupFrames = 0) {
  const markerPath = join(project, 'src/profile-production-marker.ts');
  const mainPath = join(project, 'src/main.ts');
  const markerImport = 'import "./profile-production-marker.js";';
  const main = await readFile(mainPath, 'utf8');
  const source = webFrameInstrumentation(markerUrl, control, warmupFrames);
  await writeFile(markerPath, source);
  if (!main.includes(markerImport)) await writeFile(mainPath, `${markerImport}\n${main}`);
}

async function createFrameMarkerServer() {
  const events = [];
  const waiters = [];
  const server = createServer((request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        // The request is still a first-frame signal even if the optional batch is malformed.
      }
      const event = { ...payload, receivedAt: performance.now() };
      events.push(event);
      for (const waiter of waiters.splice(0)) waiter();
      response.setHeader('access-control-allow-origin', '*');
      response.writeHead(204).end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new ProductionEvidenceError('TN_PROD_MARKER_SERVER_FAILED', 'The first-frame marker server did not expose a TCP port.');
  return {
    close: () => new Promise((resolve) => server.close(() => resolve())),
    get length() { return events.length; },
    url: `http://127.0.0.1:${address.port}/first-frame`,
    waitFor: async (from, timeoutMs) => {
      if (events.length > from) return markerEvents(events.slice(from));
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        const waiter = () => {
          clearTimeout(timer);
          resolve();
        };
        waiters.push(waiter);
      });
      return markerEvents(events.slice(from));
    },
  };
}

function markerEvents(events) {
  const firstFrame = events.find(({ kind }) => kind === 'first-frame');
  const samples = events.flatMap(({ kind, samples: batch }) => kind === 'samples' && Array.isArray(batch) ? batch : []);
  return { firstFrame, samples };
}

async function normalizeRun(
  result,
  artifactDirectory,
  kind,
  report = undefined,
  firstFrameMs = undefined,
  collectedSeries = [],
) {
  const reportSeries = report?.observations?.visual?.runtimeDiagnosticsSeries;
  const performanceSeries = report?.observations?.performanceSeries;
  const consoleSeries = frameSeriesFromReport(report);
  const series = [collectedSeries, reportSeries, performanceSeries, consoleSeries]
    .find((candidate) => Array.isArray(candidate) && candidate.length > 0);
  const screenshotPath = join(artifactDirectory, 'after.png');
  const screenshot = await nonBlankPng(screenshotPath) ? await readFile(screenshotPath) : undefined;
  return {
    elapsedMs: result.durationMs,
    ...(Number.isFinite(firstFrameMs) ? { firstFrameMs } : {}),
    kind,
    report: report === undefined ? undefined : safeReport(report),
    screenshot,
    series: Array.isArray(series) ? series : undefined,
    status: result.status,
  };
}

function safeReport(report) {
  return {
    assertionResults: report.assertionResults,
    diagnostics: report.diagnostics,
    observations: report.observations,
    pass: report.pass,
    scenario: report.scenario,
    target: report.target,
  };
}

function parsePlaytestReport(stdout) {
  const text = typeof stdout === 'string' ? stdout.trim() : '';
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    for (const line of text.split(/\r?\n/u).reverse()) {
      if (!line.trim().startsWith('{')) continue;
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function reportConsoleLines(report) {
  return (report?.observations?.console ?? [])
    .map((entry) => typeof entry?.text === 'string' ? entry.text : '')
    .filter(Boolean);
}

function firstFrameMsFromReport(report, startedAt) {
  const line = reportConsoleLines(report).find((entry) => entry.includes('TN_PROD_FIRST_NONBLANK_FRAME:'));
  const timestamp = line === undefined ? undefined : Number(line.split('TN_PROD_FIRST_NONBLANK_FRAME:').at(-1));
  if (!Number.isFinite(timestamp)) return undefined;
  const elapsed = timestamp - startedAt;
  return elapsed >= 0 ? elapsed : undefined;
}

function frameSeriesFromReport(report) {
  const series = [];
  for (const line of reportConsoleLines(report)) {
    const prefix = 'TN_PROD_FRAME_SAMPLES:';
    const offset = line.indexOf(prefix);
    if (offset === -1) continue;
    try {
      const batch = JSON.parse(line.slice(offset + prefix.length));
      if (Array.isArray(batch)) series.push(...batch);
    } catch {
      continue;
    }
  }
  return series.length === 0 ? undefined : series;
}

export function assembleEvidence({ context, native, options, performanceBounds, project, runId, startedAt, web }) {
  const arms = [web, native].filter((arm) => arm !== undefined);
  const expectedRuns = options.coldStarts * options.repetitions;
  const codes = [];
  const rawArtifacts = [];
  for (const arm of arms) {
    if (arm.runs.some(({ series }) => !Array.isArray(series) || series.length === 0)) codes.push('TN_PROD_RENDER_SAMPLES_INCOMPLETE');
    if (arm.startups.length !== options.coldStarts || arm.startups.some((sample) => !isSuccessfulStartupSample(sample))) {
      codes.push('TN_PROD_STARTUP_SAMPLES_INCOMPLETE');
    }
    if (arm.runs.length !== expectedRuns || arm.runs.some(({ report, status }) => status !== 0 || report?.pass !== true)) {
      codes.push('TN_PROD_PLAYTEST_FAILED');
    }
    for (const [index, run] of arm.runs.entries()) {
      if (run.screenshot !== undefined) rawArtifacts.push({ content: run.screenshot, label: `production-render-${arm.kind}-${index + 1}` });
      if (run.report !== undefined) rawArtifacts.push({ content: JSON.stringify(run.report), label: `production-playtest-${arm.kind}-${index + 1}` });
    }
    for (const [index, startup] of arm.startups.entries()) {
      if (startup.screenshot !== undefined) rawArtifacts.push({ content: startup.screenshot, label: `production-first-frame-${arm.kind}-${index + 1}` });
      if (startup.report !== undefined) rawArtifacts.push({ content: JSON.stringify(startup.report), label: `production-startup-${arm.kind}-${index + 1}` });
    }
  }
  const metricsByArm = new Map(arms.map((arm) => [arm.kind, aggregateMetrics(arm.runs, arm.startups, warmupFramesFor(options))]));
  const webMetrics = metricsByArm.get('web');
  const nativeMetrics = metricsByArm.get('desktop') ?? metricsByArm.get('android') ?? metricsByArm.get('ios');
  const metrics = {
    ...(webMetrics ?? nativeMetrics ?? emptyMetrics()),
    ...(webMetrics === undefined ? {} : { web: pairMetrics(webMetrics) }),
    ...(nativeMetrics === undefined ? {} : { native: pairMetrics(nativeMetrics) }),
  };
  const artifactHashes = arms.map(({ artifactSha }) => artifactSha);
  const target = options.target;
  const identity = identityFor(options, web, native, artifactHashes);
  const evidence = {
    artifact: {
      applicationClass: target === 'desktop-pair' ? 'platformer-desktop-pair' : arms[0]?.applicationClass ?? 'platformer-production',
      sha256: sha256(Buffer.from(artifactHashes.join(':'))),
      signed: context.physicalEvidence.physicalEvidenceClass === 'physical-hardware',
    },
    artifacts: [],
    budget: {
      maxP99FrameMs: 33,
      maxStartupMs: target.includes('physical') ? 8_000 : 5_000,
      minMeanFps: target.includes('physical') ? 59.4 : 60,
      ...productionPerformanceBudget(performanceBounds),
    },
    command: profileCommand(options),
    codes: [...new Set(codes)],
    evidenceClasses: ['production'],
    execution: {
      coldStarts: options.coldStarts,
      ...(options.control === undefined ? {} : { control: options.control }),
      deviceSelected: options.device !== undefined,
      renderSize: `${options.renderSize.width}x${options.renderSize.height}`,
      repetitions: options.repetitions,
      warmupSeconds: options.warmup,
    },
    identity,
    markers: markersFor(arms, codes),
    metrics,
    physical: physicalEvidenceFor(options, context),
    rawArtifacts,
    runId,
    source: {
      dirty: context.sourceState.dirty,
      ...(context.sourceState.diffSha === undefined ? {} : { diffSha: context.sourceState.diffSha }),
      sha: context.sourceSha,
    },
    target,
    timestamps: { endedAt: new Date().toISOString(), startedAt },
    version: PRODUCTION_EVIDENCE_VERSION,
  };
  if (options.audioEvidence !== undefined) {
    evidence.audioClaim = 'claimed';
    if (context.audioEvidence.audioEvidenceHash !== undefined) evidence.audioEvidenceSha256 = context.audioEvidence.audioEvidenceHash;
  } else {
    evidence.audioClaim = 'excluded-by-target-support-matrix';
  }
  if (target.includes('physical')) evidence.evidenceClasses = ['production', context.physicalEvidence.physicalEvidenceClass ?? 'missing-physical-evidence'];
  return evidence;
}

function productionPerformanceBudget(bounds) {
  if (bounds === undefined) return {};
  if (typeof bounds !== 'object' || bounds === null || Array.isArray(bounds)) {
    throw new ProductionEvidenceError('TN_PROD_PERFORMANCE_BUDGET_INVALID', 'The source performance bounds must be an object.');
  }
  const keys = ['maxDrawCalls', 'maxFrameMsP95', 'maxTriangles'];
  const unknown = Object.keys(bounds).filter((key) => !keys.includes(key));
  if (unknown.length > 0) {
    throw new ProductionEvidenceError('TN_PROD_PERFORMANCE_BUDGET_INVALID', `The source performance bounds contain unsupported keys: ${unknown.join(', ')}.`);
  }
  return Object.fromEntries(keys.flatMap((key) => {
    const value = bounds[key];
    if (value === undefined) return [];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new ProductionEvidenceError('TN_PROD_PERFORMANCE_BUDGET_INVALID', `The source performance bound '${key}' must be a finite non-negative number.`);
    }
    return [[key, value]];
  }));
}

export function isSuccessfulStartupSample(sample) {
  return sample?.status === 0
    && sample?.report?.pass === true
    && isNonBlankFrame(sample.screenshot)
    && Number.isFinite(sample.firstFrameMs)
    && sample.firstFrameMs >= 0;
}

export function postWarmupFrameSamples(samples, warmupFrames = 0) {
  if (!Array.isArray(samples)) return [];
  const boundary = Math.max(0, Math.floor(warmupFrames));
  if (boundary === 0) return samples;
  if (!samples.some((sample) => Number.isFinite(sample?.frameIndex))) return samples.slice(boundary);
  return samples.filter((sample) => Number.isFinite(sample?.frameIndex) && sample.frameIndex > boundary);
}

export function aggregateMetrics(runs, startups, warmupFrames = 0) {
  const intervals = [];
  const frameIntervalsMs = [];
  const startupSamplesMs = startups
    .filter(isSuccessfulStartupSample)
    .map(({ firstFrameMs }) => firstFrameMs);
  let timestampMs = 0;
  let sequence = 1;
  for (const run of runs) {
    for (const sample of postWarmupFrameSamples(run.series ?? [], warmupFrames)) {
      if (typeof sample?.frameMs !== 'number') {
        frameIntervalsMs.push(sample?.frameMs);
        continue;
      }
      frameIntervalsMs.push(sample.frameMs);
      intervals.push({
        ...(typeof sample.drawCalls === 'number' ? { drawCalls: sample.drawCalls } : {}),
        frameMs: sample.frameMs,
        sequence: sequence++,
        timestampMs,
        ...(typeof sample.triangles === 'number' ? { triangles: sample.triangles } : {}),
      });
      timestampMs += sample.frameMs;
    }
  }
  return {
    ...(frameIntervalsMs.length === 0 ? {} : { frameIntervalsMs }),
    ...(intervals.length === 0 ? {} : { intervals }),
    ...(startupSamplesMs.length === 0 ? {} : { startupSamplesMs, startupMs: startupSamplesMs[0] }),
    ...(timestampMs === 0 ? {} : { durationSeconds: timestampMs / 1_000 }),
    ...(startupSamplesMs.length === 0 ? {} : { startupP95Ms: nearestRank(startupSamplesMs, 0.95) }),
    ...(frameIntervalsMs.length === 0 ? {} : { meanFps: meanFps(frameIntervalsMs), p99FrameMs: nearestRank(frameIntervalsMs, 0.99) }),
    ...(intervals.some(({ drawCalls }) => drawCalls !== undefined) ? { drawCalls: Math.max(...intervals.flatMap(({ drawCalls }) => drawCalls === undefined ? [] : [drawCalls])) } : {}),
    ...(intervals.some(({ triangles }) => triangles !== undefined) ? { triangles: Math.max(...intervals.flatMap(({ triangles }) => triangles === undefined ? [] : [triangles])) } : {}),
  };
}

function emptyMetrics() {
  return { frameIntervalsMs: [], intervals: [], startupSamplesMs: [] };
}

function pairMetrics(metrics) {
  return {
    meanFps: metrics.meanFps,
    p50FrameMs: nearestRank(metrics.frameIntervalsMs, 0.5),
    p95FrameMs: nearestRank(metrics.frameIntervalsMs, 0.95),
    p99FrameMs: metrics.p99FrameMs ?? nearestRank(metrics.frameIntervalsMs, 0.99),
  };
}

function identityFor(options, web, native, artifactHashes) {
  const common = {
    deviceClass: options.device === undefined ? 'default-target' : 'selected-target',
    hostClass: `${process.platform}-${process.arch}`,
    osClass: process.platform,
    refreshHz: 60,
    renderHeight: options.renderSize.height,
    renderWidth: options.renderSize.width,
  };
  if (options.target === 'desktop-pair') {
    return {
      ...common,
      nativeArtifactSha256: native?.artifactSha,
      nativeProcess: native?.driverClass,
      webArtifactSha256: web?.artifactSha,
      webProcess: web?.driverClass,
    };
  }
  return { ...common, artifactSha256: artifactHashes[0], executableClass: web?.driverClass ?? native?.driverClass };
}

function markersFor(arms, codes) {
  const allRuns = arms.flatMap(({ runs }) => runs);
  const allStartups = arms.flatMap(({ startups }) => startups);
  const workloadSamplesComplete = allRuns.length > 0 && allRuns.every(({ series }) => Array.isArray(series) && series.length > 0);
  const startupSamplesComplete = allStartups.length > 0 && allStartups.every(isSuccessfulStartupSample);
  const clean = allRuns.length > 0 && allRuns.every(({ status, report }) => status === 0 && report?.pass === true);
  return [
    'run-start',
    ...(workloadSamplesComplete && !codes.includes('TN_PROD_RENDER_SAMPLES_INCOMPLETE') ? ['first-workload-frame'] : []),
    ...(startupSamplesComplete && clean ? ['clean-end'] : []),
  ];
}

function physicalEvidenceFor(options, context) {
  if (!options.target.includes('physical')) return undefined;
  return {
    evidenceSha256: context.physicalEvidence.physicalEvidenceHash,
    modelClass: context.physicalEvidence.physicalEvidenceClass ?? 'missing-physical-evidence',
    provenance: context.physicalEvidence.physicalEvidenceClass ?? 'missing',
  };
}

function profileCommand(options) {
  return [
    'pnpm profile:production --',
    `--target ${options.target}`,
    `--render-size ${options.renderSize.width}x${options.renderSize.height}`,
    `--cold-starts ${options.coldStarts}`,
    `--warmup ${options.warmup}`,
    `--repetitions ${options.repetitions}`,
    ...(options.device === undefined ? [] : ['--device <selected>']),
  ].join(' ');
}

async function createFixtureControlEvidence(options, context, runId) {
  const intervals = await collectFixtureFrameSeries(options.control);
  const startups = [];
  for (let index = 0; index < options.coldStarts; index += 1) startups.push(await collectFixtureStartup(options.control));
  const run = { report: { pass: true }, screenshot: fixtureFrame(), series: intervals, status: 0 };
  const metrics = {
    ...aggregateMetrics([run], startups),
    durationSeconds: options.duration,
    memory: { complete: true, growthBytes: 0, highWaterBytes: 1, first15MedianBytes: 1, last15MedianBytes: 1, slopeBytesPerMinute: 0 },
    thermal: { complete: true, samples: 1 },
  };
  return {
    artifact: { applicationClass: 'fixture-negative-control', sha256: sha256(Buffer.from('fixture-negative-control')), signed: false },
    artifacts: [],
    budget: { maxP99FrameMs: 33, maxStartupMs: 5_000, minMeanFps: 60 },
    command: profileCommand(options),
    evidenceClasses: ['negative-control'],
    execution: {
      coldStarts: options.coldStarts,
      deviceSelected: false,
      fixtureControl: true,
      renderSize: `${options.renderSize.width}x${options.renderSize.height}`,
      repetitions: options.repetitions,
      warmupSeconds: options.warmup,
    },
    identity: { driverClass: 'fixture-control', hostClass: 'fixture-control', osClass: 'fixture-control' },
    markers: markersFor([{ runs: [run], startups }], []),
    metrics,
    rawArtifacts: [
      { content: fixtureFrame(), label: 'fixture-first-frame' },
      { content: JSON.stringify({ control: options.control, metrics }), label: 'explicit-negative-control' },
    ],
    runId,
    source: { dirty: context.sourceState.dirty, ...(context.sourceState.diffSha === undefined ? {} : { diffSha: context.sourceState.diffSha }), sha: context.sourceSha },
    target: 'fixture',
    timestamps: { endedAt: new Date().toISOString(), startedAt: new Date().toISOString() },
    version: PRODUCTION_EVIDENCE_VERSION,
  };
}

async function collectFixtureFrameSeries(control) {
  const intervals = Array.from({ length: 120 }, (_, index) => ({
    frameMs: 16.5,
    sequence: index + 1,
    timestampMs: index * 16.5,
  }));
  if (control !== 'slow-path') return intervals;
  for (const index of [intervals.length - 2, intervals.length - 1]) {
    const startedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, SLOW_FRAME_DELAY_MS));
    intervals[index].frameMs = Math.max(SLOW_FRAME_DELAY_MS, performance.now() - startedAt);
    intervals[index].timestampMs = intervals[index - 1].timestampMs + intervals[index - 1].frameMs;
  }
  return intervals;
}

async function collectFixtureStartup(control) {
  const delayMs = control === 'slow-startup' ? SLOW_STARTUP_DELAY_MS : 120;
  const marker = 'TN_PROD_FIRST_NONBLANK_FRAME';
  const startedAt = performance.now();
  let firstFrameAt;
  let output = '';
  const child = spawn(process.execPath, ['-e', `setTimeout(() => process.stdout.write(${JSON.stringify(`${marker}\n`)}), ${delayMs})`], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  child.stdout?.on('data', (chunk) => {
    output += chunk.toString();
    if (firstFrameAt === undefined && output.includes(marker)) firstFrameAt = performance.now();
  });
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(2);
    }, delayMs + 2_000);
    child.once('error', () => {
      clearTimeout(timer);
      resolve(2);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 2);
    });
  });
  const firstFrameMs = firstFrameAt === undefined ? undefined : firstFrameAt - startedAt;
  const report = status === 0 && output.includes(marker) ? { pass: true } : undefined;
  return {
    firstFrameMs,
    report,
    screenshot: report === undefined ? undefined : fixtureFrame(),
    status,
  };
}

function fixtureFrame() {
  const png = new PNG({ height: 2, width: 2 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = index === 0 ? 255 : 32;
    png.data[index + 1] = index === 0 ? 255 : 64;
    png.data[index + 2] = index === 0 ? 255 : 96;
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
}

function applyNegativeControl(input, control) {
  if (control === undefined) return input;
  const evidence = {
    ...input,
    codes: [...(input.codes ?? [])],
    evidenceClasses: [...new Set([...(input.evidenceClasses ?? []), 'negative-control'])],
    execution: { ...input.execution, control },
    control,
  };
  if (control === 'missing-marker') evidence.markers = evidence.markers.filter((marker) => marker !== 'first-workload-frame');
  if (control === 'early-exit') evidence.markers = evidence.markers.filter((marker) => marker !== 'clean-end');
  if (control === 'stale-source-sha') evidence.source = { ...evidence.source, sha: 'e38439c' };
  if (control === 'dirty-checkout') {
    evidence.source = { ...evidence.source, dirty: true };
    delete evidence.source.diffSha;
  }
  if (control === 'memory-growth') {
    evidence.metrics = {
      ...evidence.metrics,
      memory: { first15MedianBytes: 100, last15MedianBytes: 200, growthBytes: 128, slopeBytesPerMinute: 512 * 1024 },
    };
  }
  if (control === 'substitute-emulator-provenance') {
    evidence.physical = { ...(evidence.physical ?? {}), provenance: 'android-emulator' };
  }
  if (control === 'claimed-audio-missing-evidence') {
    evidence.audioClaim = 'claimed';
    delete evidence.audioEvidenceSha256;
  }
  if (control === 'disallowed-identifiers') evidence.identity = { ...evidence.identity, serial: 'negative-control' };
  return evidence;
}

async function currentSourceState() {
  try {
    const [{ stdout: sha }, { stdout: status }, { stdout: diff }] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: commandRoot }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: commandRoot }),
      execFileAsync('git', ['diff', 'HEAD'], { cwd: commandRoot }),
    ]);
    const dirty = status.trim().length > 0;
    return { dirty, ...(dirty ? { diffSha: sha256(Buffer.from(diff)) } : {}), sha: sha.trim() };
  } catch {
    return { dirty: true, diffSha: sha256(Buffer.from('source-state-unavailable')), sha: '0000000' };
  }
}

async function readPhysicalEvidence(path) {
  if (path === undefined) return {};
  try {
    const content = await readFile(path);
    const text = content.toString('utf8').toLowerCase();
    return {
      physicalEvidenceClass: /emulator|simulator/u.test(text) ? 'android-emulator' : 'physical-hardware',
      physicalEvidenceHash: sha256(content),
    };
  } catch {
    return { physicalEvidenceClass: 'missing', physicalEvidenceHash: undefined };
  }
}

async function readOptionalArtifact(path) {
  if (path === undefined) return {};
  try {
    return { audioEvidenceHash: sha256(await readFile(path)) };
  } catch {
    return {};
  }
}

async function nativeArtifactPath(project, target) {
  const directory = join(project, 'dist-native');
  const entries = await readdir(directory);
  const candidate = entries.find((entry) => target === 'ios' ? entry.endsWith('.app') : target === 'android' ? entry.endsWith('.apk') : true);
  if (candidate === undefined) throw new ProductionEvidenceError('TN_PROD_NATIVE_ARTIFACT_MISSING', `The scaffolded ${target} build produced no native artifact.`);
  return join(directory, candidate);
}

async function playtestRunnerPath(project, tools) {
  const candidates = [
    tools.playtestRunner,
    join(project, 'node_modules/@threenative/playtest/dist/runner/index.js'),
  ].filter(Boolean);
  for (const candidate of candidates) if (await fileExists(candidate)) return candidate;
  return undefined;
}

async function installAndroidArtifact(apk, device) {
  const args = [...(device === undefined ? [] : ['-s', device]), 'install', '-r', apk];
  const result = await runCommand('adb', args, commandRoot);
  if (result.status !== 0) throw new ProductionEvidenceError('TN_PROD_ANDROID_INSTALL_FAILED', 'Installing the scaffolded Android platformer failed.');
}

async function hashPath(path) {
  const details = await stat(path).catch(() => undefined);
  if (details === undefined) throw new ProductionEvidenceError('TN_PROD_ARTIFACT_MISSING', `Production artifact '${basename(path)}' is missing.`);
  if (details.isFile()) return sha256(await readFile(path));
  const files = await listFiles(path);
  const hashInput = [];
  for (const file of files) hashInput.push(`${relative(path, file)}\0${sha256(await readFile(file))}`);
  return sha256(Buffer.from(hashInput.join('\n')));
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

async function nonBlankPng(path) {
  try {
    return isNonBlankFrame(await readFile(path));
  } catch {
    return false;
  }
}

function isNonBlankFrame(value) {
  if (!Buffer.isBuffer(value)) return false;
  try {
    const png = PNG.sync.read(value);
    const colors = new Set();
    let opaque = 0;
    for (let index = 0; index < png.data.length; index += 4) {
      if (png.data[index + 3] !== 0) opaque += 1;
      colors.add(`${png.data[index]},${png.data[index + 1]},${png.data[index + 2]},${png.data[index + 3]}`);
    }
    return opaque > 0 && colors.size > 1;
  } catch {
    return false;
  }
}

async function browserCommand(args) {
  if (process.platform !== 'linux' || process.env.DISPLAY !== undefined) return { args, command: process.execPath };
  const result = await runCommand('which', ['xvfb-run'], commandRoot);
  if (result.status !== 0) return { args, command: process.execPath };
  return { args: ['-a', '-s', '-screen 0 1600x900x24', process.execPath, ...args], command: 'xvfb-run' };
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (address === null || typeof address === 'string') throw new ProductionEvidenceError('TN_PROD_PORT_UNAVAILABLE', 'Could not allocate a local playtest port.');
  return address.port;
}

async function runCommand(command, args, cwd, env = undefined, timeout = 120_000) {
  const started = performance.now();
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      encoding: 'utf8',
      env: env ?? process.env,
      maxBuffer: 32 * 1024 * 1024,
      timeout,
    });
    return { durationMs: performance.now() - started, status: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    return {
      durationMs: performance.now() - started,
      status: typeof error?.code === 'number' ? error.code : 2,
      stderr: error?.stderr ?? '',
      stdout: error?.stdout ?? '',
    };
  }
}

async function removeMailbox(root) {
  await Promise.all([
    rm(join(root, 'tn-playtest-request.json'), { force: true }),
    rm(join(root, 'tn-playtest-response.json'), { force: true }),
    rm(join(root, 'tn-production-screenshot-request.json'), { force: true }),
  ]);
}

async function fileExists(path) {
  return await stat(path).then(() => true).catch(() => false);
}

function parseRenderSize(value) {
  const match = /^(\d+)x(\d+)$/u.exec(value);
  if (match === null) throw new ProductionEvidenceError('TN_PROD_RENDER_SIZE_INVALID', `--render-size must use WIDTHxHEIGHT, received '${value}'.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new ProductionEvidenceError('TN_PROD_RENDER_SIZE_INVALID', `--render-size must contain positive dimensions, received '${value}'.`);
  }
  return { height, width };
}

function nextValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) throw new ProductionEvidenceError('TN_PROD_CLI_USAGE', `${flag} requires a value.`);
  return value;
}

function positiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new ProductionEvidenceError('TN_PROD_CLI_USAGE', `${flag} requires a positive number.`);
  return parsed;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ProductionEvidenceError('TN_PROD_CLI_USAGE', `${flag} requires a positive integer.`);
  return parsed;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  try {
    const result = await runProductionProfile(parseProductionArgs());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.exitCode ?? 0;
  } catch (error) {
    const code = error instanceof ProductionEvidenceError ? error.code : 'TN_PROD_EVIDENCE_INVALID';
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ codes: [code], message, status: 'BLOCKED', exitCode: 2 }, null, 2)}\n`);
    process.exitCode = 2;
  }
}
