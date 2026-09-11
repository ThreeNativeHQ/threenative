// PRD-368 real-phone protocol. Imported by measure-cold-start; never manufactures readiness.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDeviceReady, MINIMUM_BATTERY_PERCENT, resolveAdbExecutable } from './device-preflight.mjs';
import { assessPipelineCachePairs, parsePipelineCacheRun } from './pipeline-cache-measurement.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const root = 'files/mystral/storage';
const switchPath = `${root}/pipeline-cache.disabled`;
const cachePath = `${root}/pipeline-cache-v1`;
const reject = (reason) => { const error = new Error(`TN_PIPELINE_CACHE_${reason}`); error.exitCode = 2; throw error; };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function validatePairOptions(options) {
  if (options.desktop || options.allowDeviceCondition || options.optimization !== '-O2') reject('QUALIFIED_ANDROID_REQUIRED');
  if (!Number.isInteger(options.pipelineCachePairs) || options.pipelineCachePairs < 3 || options.pipelineCachePairs > 100) reject('PAIR_COUNT');
  if (!options.report || !options.startupScenario) reject('REPORT_AND_SCENARIO_REQUIRED');
  if (typeof options.device !== 'string' || !/^(?:[A-Za-z0-9.-]+:[0-9]+|adb-[A-Za-z0-9._-]+)$/u.test(options.device)) reject('WIFI_ADB_REQUIRED');
}
export function installedApkPath(output) {
  const lines = output.trim().split(/\r?\n/u);
  if (lines.length !== 1 || !/^package:\/data\/app\/[A-Za-z0-9/_.=+~-]+\.apk$/u.test(lines[0])) reject('SINGLE_INSTALLED_APK_REQUIRED');
  return lines[0].slice('package:'.length);
}
export function playtestArguments({ scenario, device, appId, artifactDirectory }) {
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u.test(appId)) reject('APP_ID_INVALID');
  return [scenario, '--target', 'android', '--device', device, '--package', appId,
    '--activity', 'com.threenative.runtime.MystralActivity', '--timeout', '90000', '--artifacts', artifactDirectory];
}
export async function measurePipelineCachePairs(options, appId) {
  validatePairOptions(options);
  const scenario = resolve(options.startupScenario);
  const cli = join(workspace, 'packages/playtest/dist/runner/cli.js');
  for (const path of [scenario, cli]) if (!existsSync(path)) reject(`INPUT_MISSING:${path}`);
  playtestArguments({ scenario, device: options.device, appId, artifactDirectory: '.' });
  const reportPath = resolve(options.report);
  const output = `${reportPath}.artifacts`;
  if (existsSync(reportPath) || existsSync(output)) reject('OUTPUT_ALREADY_EXISTS');
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output);
  const commands = [];
  const save = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  const adb = resolveAdbExecutable();
  function execute(args) {
    const result = spawnSync(adb, ['-s', options.device, ...args], { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    commands.push({ args, status: result.status, stdout: result.stdout, stderr: result.stderr });
    save(join(output, 'commands.json'), commands);
    if (result.error || result.status !== 0) reject(`ADB_FAILED:${result.error?.message ?? result.stderr ?? result.status}`);
    return String(result.stdout ?? '');
  }
  const asApp = (command) => execute(['shell', 'run-as', appId, 'sh', '-c', `'${command}'`]);
  const stop = () => {
    execute(['shell', 'am', 'force-stop', appId]);
    // A missing pidof executable (127), disconnected adb, or a surviving PID is NOT process-cold.
    execute(['shell', 'sh', '-c', `'if pidof ${appId}; then exit 8; else test "$?" -eq 1; fi'`]);
  };
  const condition = () => assertDeviceReady(options.device, {
    allowOverride: false, allowEmulator: false, maxThermalStatus: 'NONE',
    minBatteryPercent: MINIMUM_BATTERY_PERCENT, requireDischarging: true,
  }, { adb: execute });
  const apkIdentity = () => {
    const apk = installedApkPath(execute(['shell', 'pm', 'path', appId]));
    const sha256 = execute(['shell', 'sha256sum', apk]).trim().split(/\s+/u)[0];
    if (!/^[a-f0-9]{64}$/u.test(sha256)) reject('APK_CHECKSUM_MISSING');
    return { apk, sha256 };
  };
  const cacheIdentity = () => asApp(`if test -d ${cachePath}; then find ${cachePath} -type f -name cache.bin -exec sha256sum {} \\; | sort; fi`).trim();
  const pairs = [];
  let ownsSwitch = false;
  let failure;
  let cleanupFailure;
  let result;
  try {
    const model = execute(['shell', 'getprop', 'ro.product.model']).trim();
    if (model !== 'Pixel 8' || execute(['shell', 'getprop', 'ro.kernel.qemu']).trim() === '1') reject('PHYSICAL_PIXEL_8_REQUIRED');
    const uid = execute(['shell', 'run-as', appId, 'id', '-u']).trim();
    if (!/^[0-9]+$/u.test(uid)) reject('APP_PRIVATE_STORAGE_UNAVAILABLE');
    if (asApp(`if test -e ${switchPath}; then printf present; else printf absent; fi`) !== 'absent') reject('EXISTING_OPERATOR_CONTROL');
    ownsSwitch = true;
    const installed = apkIdentity();
    save(join(output, 'identity.json'), { installed, model, serial: options.device, appId,
      scenario, scenarioSha256: hash(readFileSync(scenario)), optimization: options.optimization,
      optimizationSource: 'operator build declaration; installed APK independently SHA-256 checked',
      coldness: 'new-process; OS and driver caches deliberately retained' });
    for (let index = 0; index < options.pipelineCachePairs; ++index) {
      const pair = {};
      for (const [key, arm] of [['disabledBefore', 'disabled-before'], ['empty', 'empty'], ['populated', 'populated'], ['disabledAfter', 'disabled-after']]) {
        stop();
        const before = await condition();
        if (apkIdentity().sha256 !== installed.sha256) reject('APK_CHANGED');
        asApp(`mkdir -p ${root}`);
        if (arm.startsWith('disabled')) asApp(`touch ${switchPath}`);
        else asApp(`rm -f ${switchPath}`);
        if (arm === 'empty') asApp(`rm -rf ${cachePath}`);
        const cacheBefore = cacheIdentity();
        const dir = join(output, `${index + 1}-${arm}`); mkdirSync(dir);
        const args = playtestArguments({ scenario, device: options.device, appId, artifactDirectory: dir });
        const child = spawnSync(process.execPath, [cli, ...args], { cwd: workspace, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
        writeFileSync(join(dir, 'stdout.json'), child.stdout ?? '');
        writeFileSync(join(dir, 'stderr.log'), child.stderr ?? '');
        const log = execute(['logcat', '-d', '-v', 'threadtime']);
        writeFileSync(join(dir, 'logcat.txt'), log);
        const after = await condition();
        save(join(dir, 'conditions.json'), { before, after });
        if (child.error || child.status !== 0) reject(`PLAYTEST_FAILED:${child.error?.message ?? child.status}`);
        let receipt; try { receipt = JSON.parse(child.stdout); } catch { reject('PLAYTEST_RECEIPT_INVALID'); }
        stop();
        if (apkIdentity().sha256 !== installed.sha256) reject('APK_CHANGED');
        const cacheAfter = cacheIdentity();
        if (arm.startsWith('disabled') && cacheBefore !== cacheAfter) reject('DISABLED_MUTATED_CACHE');
        pair[key] = parsePipelineCacheRun({ arm, log, receipt, apkSha256: installed.sha256, before, after, processCold: true });
        save(join(dir, 'observation.json'), pair[key]);
      }
      pairs.push(pair);
      save(join(output, 'pairs.json'), pairs);
    }
    result = { ...assessPipelineCachePairs(pairs), artifacts: output, appId, optimization: options.optimization };
  } catch (error) {
    failure = error;
  } finally {
    if (ownsSwitch) {
      try { stop(); asApp(`rm -f ${switchPath}`); }
      catch (error) {
        cleanupFailure = error;
        if (!failure) failure = error;
      }
    }
  }
  // Finish cleanup before publishing a result. Throw outside finally so cleanup cannot
  // replace the primary failure or turn a failed protocol into a successful return.
  if (cleanupFailure) {
    save(join(output, 'cleanup-failure.json'), { message: cleanupFailure.message });
    save(reportPath, { pass: false, error: 'operator-control-cleanup-failed', artifacts: output });
  }
  if (failure) {
    save(join(output, 'failure.json'), { pass: false, message: failure.message, completedPairs: pairs.length });
    throw failure;
  }
  save(reportPath, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
  return result;
}
