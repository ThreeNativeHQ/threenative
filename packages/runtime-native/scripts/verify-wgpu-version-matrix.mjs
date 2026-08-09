#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DEFAULT_WGPU_VERSION,
  WGPU_REGRESSION_VERSIONS,
  inspectWgpuInstallation,
  wgpuOverrideRoot,
} from './download-deps.mjs';

export const ROW_ID = '15-mesh-toon-material-gradientmap';
export const EXPECTED_OUTCOMES = Object.freeze({
  'v24.0.3.1': 'fail',
  [DEFAULT_WGPU_VERSION]: 'pass',
});

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const matrixRoot = join(runtimeRoot, '.runtime', 'wgpu-version-matrix');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseArgs(args) {
  const known = new Set(['--help', '--skip-download', '--skip-build', '--only-version', '--out']);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!known.has(arg)) throw new Error(`Unknown option: ${arg}`);
    if (['--only-version', '--out'].includes(arg)) index++;
  }
  const onlyVersion = valueAfter(args, '--only-version');
  if (onlyVersion && !WGPU_REGRESSION_VERSIONS.includes(onlyVersion)) {
    throw new Error(`--only-version must be one of: ${WGPU_REGRESSION_VERSIONS.join(', ')}`);
  }
  return {
    help: args.includes('--help'),
    skipDownload: args.includes('--skip-download'),
    skipBuild: args.includes('--skip-build'),
    onlyVersion,
    out: resolve(runtimeRoot, valueAfter(args, '--out') || 'artifacts/conformance/wgpu-version-matrix.json'),
  };
}

function usage() {
  return `Usage: node scripts/verify-wgpu-version-matrix.mjs [options]

Build and run conformance row ${ROW_ID} against isolated wgpu-native releases.

Options:
  --skip-download          Verify and reuse an existing isolated dependency root
  --skip-build             Verify and reuse an existing version-specific native build
  --only-version VERSION   Diagnostic single-version run; does not claim discrimination
  --out PATH               JSON evidence path
  --help                   Show this help
`;
}

function commandPath(command) {
  const probe = command === 'xvfb-run' ? '--help' : '--version';
  if (spawnSync(command, [probe], { stdio: 'ignore' }).status === 0) return command;
  const local = join(runtimeRoot, '.runtime', 'tools-venv', 'bin', command);
  return existsSync(local) && spawnSync(local, [probe], { stdio: 'ignore' }).status === 0
    ? local
    : null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || runtimeRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 20 * 60_000,
  });
  if (result.error) throw result.error;
  if (options.requireSuccess !== false && result.status !== 0) {
    throw new Error(
      `Command failed (${result.status ?? result.signal ?? 'unknown'}): ${command} ${args.join(' ')}\n${result.stderr || result.stdout || ''}`,
    );
  }
  return result;
}

function cacheValue(cache, key) {
  return cache.match(new RegExp(`^${key}:[^=]*=(.*)$`, 'm'))?.[1]?.trim() || null;
}

export function verifyLinkedWgpuEvidence({ manifest, cache, buildInputs, binary }) {
  if (!manifest || !WGPU_REGRESSION_VERSIONS.includes(manifest.version)) {
    throw new Error('wgpu manifest has no supported exact version');
  }
  if (!Array.isArray(manifest.tags) || manifest.tags.length === 0) {
    throw new Error(`${manifest.version}: wgpu manifest has no release tags`);
  }
  if (manifest.tags.some(({ value }) => value !== manifest.version)) {
    throw new Error(`${manifest.version}: wgpu manifest tag mismatch`);
  }
  if (!Array.isArray(manifest.libraries) || manifest.libraries.length === 0) {
    throw new Error(`${manifest.version}: wgpu manifest has no libraries`);
  }
  const configuredRoot = cacheValue(cache, 'THREENATIVE_WGPU_ROOT');
  if (!configuredRoot || resolve(configuredRoot) !== resolve(manifest.root)) {
    throw new Error(
      `${manifest.version}: CMake linked root mismatch: expected ${manifest.root}, found ${configuredRoot || 'unset'}`,
    );
  }
  if (cacheValue(cache, 'MYSTRAL_USE_WGPU') !== 'ON' || cacheValue(cache, 'MYSTRAL_USE_DAWN') !== 'OFF') {
    throw new Error(`${manifest.version}: build did not select wgpu-native exclusively`);
  }
  const linkedLibrary = manifest.libraries.find(({ path }) => {
    const absolute = resolve(manifest.root, path);
    return buildInputs.split(/\r?\n/).some((input) => resolve(input.trim()) === absolute);
  });
  if (!linkedLibrary) {
    throw new Error(`${manifest.version}: Ninja inputs do not contain a library from the verified wgpu root`);
  }
  const linkedPath = resolve(manifest.root, linkedLibrary.path);
  if (!existsSync(linkedPath) || sha256(linkedPath) !== linkedLibrary.sha256) {
    throw new Error(`${manifest.version}: linked wgpu library digest does not match its verified manifest`);
  }
  if (!existsSync(binary)) throw new Error(`${manifest.version}: native runtime binary is missing: ${binary}`);
  return {
    configuredRoot: resolve(configuredRoot),
    linkedLibrary: linkedPath,
    linkedLibrarySha256: linkedLibrary.sha256,
    runtimeBinary: resolve(binary),
    runtimeBinarySha256: sha256(binary),
  };
}

function nativeRegressionEvidence(row) {
  const output = `${row?.native?.stdout || ''}\n${row?.native?.stderr || ''}\n${row?.native?.error || ''}`;
  return row?.native != null && (
    (Array.isArray(row.gpuValidationErrors) && row.gpuValidationErrors.length > 0)
    || /validation|naga|textureLoad|signal|abort|device error/i.test(output)
  );
}

export function assertMatrixDiscrimination(results) {
  for (const version of WGPU_REGRESSION_VERSIONS) {
    const result = results.find((entry) => entry.version === version);
    if (!result) throw new Error(`Matrix is missing ${version}`);
    if (result.linked?.configuredRoot !== result.manifest?.root) {
      throw new Error(`${version}: result does not prove the configured root matches the verified manifest`);
    }
    const expected = EXPECTED_OUTCOMES[version];
    if (result.row?.status !== expected) {
      throw new Error(`${version}: row ${ROW_ID} must ${expected}, got ${result.row?.status || 'no result'}`);
    }
    if (expected === 'fail' && !nativeRegressionEvidence(result.row)) {
      throw new Error(`${version}: failure lacks native WebGPU regression evidence`);
    }
  }
  return true;
}

function buildRuntime(version, root, skipBuild, tools) {
  const buildDir = join(matrixRoot, 'build', version);
  const binary = join(buildDir, 'mystral');
  if (!skipBuild) {
    mkdirSync(buildDir, { recursive: true });
    run(tools.cmake, [
      '--preset', 'tn-linux',
      '-B', buildDir,
      '-DMYSTRAL_USE_WGPU=ON',
      '-DMYSTRAL_USE_DAWN=OFF',
      '-DTN_ENABLE_CANVAS2D=OFF',
      '-DTN_ENABLE_WEBTRANSPORT=OFF',
      `-DCMAKE_MAKE_PROGRAM=${tools.ninja}`,
      `-DTHREENATIVE_WGPU_ROOT=${root}`,
    ]);
    run(tools.cmake, ['--build', buildDir, '--target', 'mystral', '--parallel']);
  }
  const cachePath = join(buildDir, 'CMakeCache.txt');
  if (!existsSync(cachePath)) throw new Error(`${version}: missing CMake cache; remove --skip-build`);
  const inputs = run(tools.ninja, ['-C', buildDir, '-t', 'inputs', 'mystral']).stdout;
  return { binary, buildDir, cache: readFileSync(cachePath, 'utf8'), inputs };
}

function runRow(version, binary, reportPath, tools) {
  const runner = join(runtimeRoot, 'conformance', 'run-conformance.mjs');
  const versionRoot = resolve(dirname(reportPath), '..');
  const webRoot = join(versionRoot, 'web');
  const desktopRoot = join(versionRoot, 'desktop');
  const common = [
    '-a',
    '-s',
    '-screen 0 1600x900x24',
    process.execPath,
    runner,
  ];
  const web = run(
    tools.xvfb,
    [...common, '--target', 'web', '--only-tests', ROW_ID, '--out', webRoot],
    { requireSuccess: false },
  );
  const webReport = join(webRoot, 'report.json');
  if (!existsSync(webReport)) {
    throw new Error(`${version}: web reference produced no report\n${web.stderr || web.stdout || ''}`);
  }
  const webRow = JSON.parse(readFileSync(webReport, 'utf8')).results?.find(({ id }) => id === ROW_ID);
  if (webRow?.status !== 'pass') {
    throw new Error(`${version}: web reference did not pass row ${ROW_ID}: ${webRow?.status || 'missing'}`);
  }
  const result = run(
    tools.xvfb,
    [
      ...common,
      '--target',
      'desktop',
      '--only-tests',
      ROW_ID,
      '--reference',
      webRoot,
      '--out',
      desktopRoot,
    ],
    { env: { TN_RUNTIME: binary }, requireSuccess: false },
  );
  reportPath = join(desktopRoot, 'report.json');
  if (!existsSync(reportPath)) {
    throw new Error(`${version}: desktop conformance runner produced no report\n${result.stderr || result.stdout || ''}`);
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const row = report.results?.find(({ id }) => id === ROW_ID);
  if (!row) throw new Error(`${version}: conformance report omitted ${ROW_ID}`);
  return { exitCode: result.status, row, reportPath, stdout: result.stdout, stderr: result.stderr };
}

async function executeVersion(version, options, tools) {
  const root = wgpuOverrideRoot(version, 'wgpu');
  if (!options.skipDownload) {
    run(process.execPath, [
      join(runtimeRoot, 'scripts', 'download-deps.mjs'),
      '--only',
      'wgpu',
      '--wgpu-version',
      version,
    ]);
  }
  const manifest = inspectWgpuInstallation('wgpu', root, version);
  const built = buildRuntime(version, root, options.skipBuild, tools);
  const linked = verifyLinkedWgpuEvidence({
    manifest,
    cache: built.cache,
    buildInputs: built.inputs,
    binary: built.binary,
  });
  const reportPath = join(matrixRoot, 'reports', version, 'desktop', 'report.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  const runResult = runRow(version, built.binary, reportPath, tools);
  return {
    version,
    expected: EXPECTED_OUTCOMES[version],
    manifest,
    linked,
    conformanceExitCode: runResult.exitCode,
    row: runResult.row,
    report: relative(runtimeRoot, reportPath).replaceAll('\\', '/'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (process.platform !== 'linux') {
    throw new Error('Desktop wgpu-native version discrimination currently requires Linux');
  }
  const tools = {
    cmake: commandPath('cmake'),
    ninja: commandPath('ninja'),
    xvfb: commandPath('xvfb-run'),
  };
  for (const [name, path] of Object.entries(tools)) {
    if (!path) throw new Error(`Blocked: required command is missing: ${name}`);
  }
  const scene = join(runtimeRoot, 'conformance', 'scenes', 'shared', 'mesh-toon-material-gradientmap.js');
  if (!existsSync(scene)) throw new Error(`Blocked: row ${ROW_ID} scene is missing: ${scene}`);

  const versions = options.onlyVersion ? [options.onlyVersion] : WGPU_REGRESSION_VERSIONS;
  const results = [];
  for (const version of versions) {
    process.stdout.write(`wgpu-native ${version}: prepare -> build -> verify linkage -> run row ${ROW_ID}\n`);
    results.push(await executeVersion(version, options, tools));
  }
  if (!options.onlyVersion) assertMatrixDiscrimination(results);
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    row: ROW_ID,
    discriminated: options.onlyVersion ? null : true,
    defaultWgpuVersion: DEFAULT_WGPU_VERSION,
    results,
  };
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ wrote: options.out, discriminated: evidence.discriminated }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = /Blocked:/u.test(String(error)) ? 2 : 1;
  });
}
