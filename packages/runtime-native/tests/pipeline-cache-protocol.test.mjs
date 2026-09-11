import assert from 'node:assert/strict';
import test from 'node:test';
import { installedApkPath, playtestArguments, validatePairOptions } from '../scripts/measure-pipeline-cache.mjs';
const options = { device: '192.168.1.2:44555', pipelineCachePairs: 3, report: 'out.json', startupScenario: 'real.json', optimization: '-O2' };
test('qualifies a Wi-Fi physical protocol without provisional timing overrides', () => assert.doesNotThrow(() => validatePairOptions(options)));
for (const update of [{ device: 'emulator-5554' }, { device: 'USB1234' }, { pipelineCachePairs: 2 }, { pipelineCachePairs: 3.5 }, { pipelineCachePairs: 101 }, { desktop: true }, { optimization: '-O0' }, { allowDeviceCondition: true }, { report: '' }, { startupScenario: '' }]) {
  test(`reject protocol ${JSON.stringify(update)}`, () => assert.throws(() => validatePairOptions({ ...options, ...update }), /TN_PIPELINE_CACHE_/));
}
test('hashes the installed monolithic APK, refusing splits or shell text', () => {
  assert.equal(installedApkPath('package:/data/app/~~foo/a-b==/base.apk\n'), '/data/app/~~foo/a-b==/base.apk');
  for (const value of ['', 'package:/sdcard/other.apk', 'package:/data/app/a;echo-pwn.apk', 'package:/data/app/base.apk\npackage:/data/app/split.apk']) assert.throws(() => installedApkPath(value));
});
test('runs the owned Android playtest with the selected unchanged APK identity', () => {
  const args = playtestArguments({ scenario: '/game/proof.json', device: options.device, appId: 'com.example.bayview', artifactDirectory: '/proof/run1' });
  assert.deepEqual(args, ['/game/proof.json', '--target', 'android', '--device', options.device, '--package', 'com.example.bayview', '--activity', 'com.threenative.runtime.MystralActivity', '--timeout', '90000', '--artifacts', '/proof/run1']);
  assert.throws(() => playtestArguments({ appId: 'com.game;rm' }), /APP_ID_INVALID/);
});
test('owned cold-start CLI accepts paired measurement and rejects ambiguous flags', async () => {
  const { parseArgs } = await import('../scripts/measure-cold-start.mjs');
  assert.equal(parseArgs(['--device', options.device, '--pipeline-cache-pairs', '3', '--startup-scenario', 'proof.json', '--report', 'out.json']).pipelineCachePairs, 3);
  assert.throws(() => parseArgs(['--device', options.device, '--startup-scenario', 'proof.json']), /PAIRS_REQUIRED/);
  assert.throws(() => parseArgs(['--device', options.device, '--pipeline-cache-pairs', '2', '--startup-scenario', 'proof.json', '--report', 'out.json']), /PAIR_COUNT/);
});
