import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPipelineCachePairs, parsePipelineCacheRun } from '../scripts/pipeline-cache-measurement.mjs';

// Synthetic fixtures exercise refusal/arithmetic only; these are not GPU or Pixel measurements.
const digest = 'a'.repeat(64);
const condition = { provisional: [], charging: false, thermalStatusCode: 0, batteryPercent: 90, screenOn: true };
function fixture(arm = 'populated', service = 20, readyMs = 7000) {
  const disabled = arm.startsWith('disabled');
  const cache = { version: 1, phase: 'device', mode: disabled ? 'disabled' : 'attached', identity: digest,
    load: disabled ? 'disabled' : arm === 'empty' ? 'missing' : 'accepted', loadedBytes: arm === 'populated' ? 100 : 0,
    emptyBytes: 32, serializedBytes: 100, renderAttached: 0, computeAttached: 0, store: 'not-attempted' };
  const lines = [
    ['TN_COLD_START:', { segment: 'process', atMs: 0 }],
    ['TN_COLD_START:', { segment: 'first_playable', atMs: readyMs }],
    ['TN_PIPELINE_CAPTURE:', { version: 1, adapter: { identity: 'native:vulkan/physical-test-fixture' }, build: { identity: 'fixture-build' } }],
    ['TN_PIPELINE_CACHE:', cache],
    ['TN_PIPELINE_EVENT:', { version: 1, eventId: 1, status: 'created', mode: 'async', kind: 'render', pass: 'main', programIdentity: 'fixture-program', pipelineIdentity: 'fixture-pipeline', startedMs: 10, settledMs: 10 + service, serviceMs: service, wallMs: service, cache: cache.mode }],
    ['TN_PIPELINE_CHECKPOINT:', { version: 1, requested: 1, emitted: 1, outstanding: 0, present: 10 }],
  ];
  if (!disabled) lines.push(['TN_PIPELINE_CACHE:', { ...cache, phase: 'store', store: 'stored', storedBytes: 100, renderAttached: 1 }]);
  const log = lines.map(([marker, value]) => `09-10 12:00:00.000 1234 1235 I MystralStdio: ${marker}${JSON.stringify(value)}`).join('\n');
  const receipt = { pass: true, runtime: 'native', startup: { phase: 'ready', compileSettled: true, rule: 'sustained-frames', timeline: { readyMs } },
    assertionResults: [ { id: 'startup.readyMs', pass: true }, { id: 'diagnostics', pass: true }, { id: 'movement.distance', pass: true, details: { observed: true, distance: 1 } } ] };
  return { arm, log, receipt, apkSha256: digest, before: condition, after: condition, processCold: true };
}
function pair() {
  return { empty: parsePipelineCacheRun(fixture('empty', 100)), populated: parsePipelineCacheRun(fixture()),
    disabledBefore: parsePipelineCacheRun(fixture('disabled-before', 90)), disabledAfter: parsePipelineCacheRun(fixture('disabled-after', 80)) };
}
test('three independent pairs and both disabled controls qualify only the measured arithmetic', () => {
  const report = assessPipelineCachePairs([pair(), pair(), pair()]);
  assert.equal(report.pass, true);
  assert.equal(report.compileRatio, 0.2);
  assert.equal(report.populatedReadyMedianMs, 7000);
});
test('a loaded blob is not a speedup and the 25% bound is enforced', () => {
  const pairs = [pair(), pair(), pair()];
  for (const p of pairs) p.populated.serviceMs = 26;
  assert.equal(assessPipelineCachePairs(pairs).pass, false);
});
test('driver-warm disabled controls cannot be presented as application-cache benefit', () => {
  const pairs = [pair(), pair(), pair()];
  for (const p of pairs) p.disabledAfter.serviceMs = 10;
  assert.equal(assessPipelineCachePairs(pairs).pass, false);
});
test('first playable, not first frame, must meet the 8000 ms median', () => {
  const pairs = [pair(), pair(), pair()];
  for (const p of pairs) p.populated.readyMs = 8001;
  assert.equal(assessPipelineCachePairs(pairs).pass, false);
});
for (const count of [0, 1, 2]) test(`refuses ${count} pairs rather than averaging incomplete evidence`, () => {
  assert.throws(() => assessPipelineCachePairs(Array.from({ length: count }, pair)), /PAIR_COUNT/);
});
for (const [name, mutate, reason] of [
  ['missing markers', (v) => { v.log = ''; }, /CACHE_OBSERVATION/],
  ['malformed marker', (v) => { v.log += '\nTN_PIPELINE_CACHE:{'; }, /MARKER/],
  ['missing ready', (v) => { delete v.receipt.startup.timeline.readyMs; }, /FIRST_PLAYABLE/],
  ['timeout readiness', (v) => { v.receipt.startup.rule = 'timeout'; }, /FIRST_PLAYABLE/],
  ['failed gameplay', (v) => { v.receipt.assertionResults[2].pass = false; }, /GAMEPLAY/],
  ['missing gameplay', (v) => { v.receipt.assertionResults.pop(); }, /GAMEPLAY/],
  ['missing APK', (v) => { v.apkSha256 = null; }, /APK/],
  ['charging', (v) => { v.before = { ...condition, charging: true }; }, /CONDITION/],
  ['thermal change', (v) => { v.after = { ...condition, thermalStatusCode: 1 }; }, /CONDITION/],
  ['not process cold', (v) => { v.processCold = false; }, /PROCESS_COLD/],
  ['wrong cache arm', (v) => { v.arm = 'empty'; }, /CACHE_LOAD/],
  ['incomplete compile capture', (v) => { v.log = v.log.replace('"outstanding":0', '"outstanding":1'); }, /CHECKPOINT/],
  ['failed compile', (v) => { v.log = v.log.replace('"status":"created"', '"status":"failed"'); }, /PIPELINE_EVENT/],
  ['missing service time', (v) => { v.log = v.log.replace('"serviceMs":20,', ''); }, /PIPELINE_EVENT/],
  ['no durable save', (v) => { v.log = v.log.replace('"store":"stored"', '"store":"unavailable"'); }, /CACHE_STORE/],
]) test(`fails closed: ${name}`, () => {
  const v = fixture(); mutate(v); assert.throws(() => parsePipelineCacheRun(v), reason);
});
test('duplicated Android log forwarding is one observation, not two pipelines', () => {
  const v = fixture(); v.log += `\n${v.log}`;
  assert.equal(parsePipelineCacheRun(v).pipelineCount, 1);
});
test('changed installed APK and changed program populations invalidate comparison', () => {
  for (const field of ['apkSha256', 'identity', 'programs']) {
    const pairs = [pair(), pair(), pair()]; pairs[1].populated[field] = 'changed';
    assert.throws(() => assessPipelineCachePairs(pairs), /IDENTITY/);
  }
});
test('the shared minimum battery policy is enforced, not a weaker private threshold', () => {
  const v = fixture(); v.before = { ...condition, batteryPercent: 49 };
  assert.throws(() => parsePipelineCacheRun(v), /DEVICE_CONDITION/);
});
test('the real native requested/emitted checkpoint fields detect missing events', () => {
  const v = fixture(); v.log = v.log.replace('"requested":1', '"requested":2');
  assert.throws(() => parsePipelineCacheRun(v), /CHECKPOINT_INCOMPLETE/);
});

test('first playable uses the native process clock, not the later-created JavaScript clock', () => {
  const v = fixture(); v.receipt.startup.timeline.readyMs = 5000;
  const observation = parsePipelineCacheRun(v);
  assert.equal(observation.readyMs, 7000);
  assert.equal(observation.javascriptReadyMs, 5000);
});
test('missing or reversed native first-playable boundaries fail closed', () => {
  for (const atMs of [null, -1]) {
    const v = fixture();
    v.log = v.log.replace('"segment":"first_playable","atMs":7000', `"segment":"first_playable","atMs":${atMs}`);
    assert.throws(() => parsePipelineCacheRun(v), /FIRST_PLAYABLE_NATIVE_CLOCK/);
  }
  const v = fixture(); v.log = v.log.split('\n').filter((line) => !line.includes('first_playable')).join('\n');
  assert.throws(() => parsePipelineCacheRun(v), /FIRST_PLAYABLE_NATIVE_CLOCK/);
});
