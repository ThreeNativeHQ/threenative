// PRD-368: fail-closed arithmetic over retained observations. Fixtures are never device evidence.
import { MINIMUM_BATTERY_PERCENT } from './device-preflight.mjs';
const fail = (code) => { throw new Error(`TN_PIPELINE_CACHE_${code}`); };
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function markers(log, marker) {
  const values = [];
  const seen = new Set();
  for (const line of log.split('\n')) {
    const at = line.indexOf(marker);
    if (at < 0) continue;
    let value;
    try { value = JSON.parse(line.slice(at + marker.length)); } catch { fail('MARKER_MALFORMED'); }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('MARKER_MALFORMED');
    const key = JSON.stringify(value);
    // Exact mirrored logcat payloads are one observation. Conflicting payloads are retained.
    if (!seen.has(key)) { seen.add(key); values.push(value); }
  }
  return values;
}
function condition(value) {
  if (!value || !Array.isArray(value.provisional) || value.provisional.length !== 0 ||
      value.charging !== false || value.thermalStatusCode !== 0 || value.screenOn !== true ||
      !finite(value.batteryPercent) || value.batteryPercent < MINIMUM_BATTERY_PERCENT) fail('DEVICE_CONDITION');
}
function readiness(receipt) {
  const startup = receipt?.startup;
  if (startup?.phase !== 'ready' || startup.compileSettled !== true || startup.rule !== 'sustained-frames' ||
      !finite(startup.timeline?.readyMs) || startup.timeline.readyMs === 0) fail('FIRST_PLAYABLE_UNOBSERVED');
  if (receipt.pass !== true || !Array.isArray(receipt.assertionResults)) fail('GAMEPLAY_UNPROVED');
  for (const result of receipt.assertionResults) if (result?.pass !== true) fail('GAMEPLAY_FAILED');
  for (const id of ['startup.readyMs', 'diagnostics', 'movement.distance']) {
    if (!receipt.assertionResults.some((result) => result.id === id)) fail('GAMEPLAY_UNPROVED');
  }
  const movement = receipt.assertionResults.find((result) => result.id === 'movement.distance');
  if (movement.details?.observed !== true || !finite(movement.details.distance) || movement.details.distance <= 0)
    fail('GAMEPLAY_UNPROVED');
  return startup.timeline.readyMs;
}
function compilePopulation(log, expectedMode) {
  const events = markers(log, 'TN_PIPELINE_EVENT:');
  if (events.length === 0) fail('PIPELINE_EVENTS_MISSING');
  const sequences = new Set();
  for (const event of events) {
    if (event.version !== 1 || event.status !== 'created' || !['sync', 'async'].includes(event.mode) ||
        !['compute', 'render'].includes(event.kind) || !Number.isInteger(event.eventId) || event.eventId < 1 ||
        typeof event.programIdentity !== 'string' || event.programIdentity.length === 0 ||
        !finite(event.serviceMs) || !finite(event.startedMs) || !finite(event.settledMs) ||
        event.settledMs < event.startedMs || !finite(event.wallMs) || event.cache !== expectedMode ||
        sequences.has(event.eventId)) fail('PIPELINE_EVENT_INVALID');
    sequences.add(event.eventId);
  }
  const checkpoint = markers(log, 'TN_PIPELINE_CHECKPOINT:').at(-1);
  if (checkpoint?.version !== 1 || checkpoint.emitted !== events.length || checkpoint.requested !== events.length || checkpoint.outstanding !== 0)
    fail('CHECKPOINT_INCOMPLETE');
  const start = events.reduce((min, event) => Math.min(min, event.startedMs), Infinity);
  const end = events.reduce((max, event) => Math.max(max, event.settledMs), 0);
  return {
    pipelineCount: events.length,
    programs: JSON.stringify(events.map((event) => [event.programIdentity, event.kind, event.pass, event.mode]).sort()),
    serviceMs: events.reduce((sum, event) => sum + event.serviceMs, 0),
    wallMs: events.reduce((sum, event) => sum + event.wallMs, 0),
    elapsedMs: end - start,
  };
}
export function parsePipelineCacheRun({ arm, log, receipt, apkSha256, before, after, processCold }) {
  if (!['empty', 'populated', 'disabled-before', 'disabled-after'].includes(arm)) fail('ARM_INVALID');
  if (!sha(apkSha256)) fail('APK_IDENTITY_MISSING');
  if (processCold !== true) fail('PROCESS_COLD_UNPROVED');
  condition(before); condition(after);
  const caches = markers(log, 'TN_PIPELINE_CACHE:');
  const devices = caches.filter((value) => value.phase === 'device');
  if (devices.length !== 1 || devices[0].version !== 1 || !sha(devices[0].identity)) fail('CACHE_OBSERVATION_UNQUALIFIED');
  const device = devices[0];
  const disabled = arm.startsWith('disabled');
  const load = disabled ? 'disabled' : arm === 'empty' ? 'missing' : 'accepted';
  const mode = disabled ? 'disabled' : 'attached';
  if (device.load !== load || device.mode !== mode) fail('CACHE_LOAD_WRONG_ARM');
  for (const cache of caches) if (cache.identity !== device.identity) fail('CACHE_OBSERVATION_CONFLICT');
  if (disabled) {
    if (device.loadedBytes !== 0 || caches.some((value) => value.phase === 'store' || value.store === 'stored')) fail('CACHE_LOAD_DISABLED_IO');
  } else {
    if (!finite(device.emptyBytes) || (arm === 'populated' && !(device.loadedBytes > device.emptyBytes))) fail('CACHE_LOAD_EMPTY_DATA');
    if (!caches.some((value) => value.phase === 'store' && value.store === 'stored' && value.storedBytes > device.emptyBytes)) fail('CACHE_STORE_UNPROVED');
  }
  const capture = markers(log, 'TN_PIPELINE_CAPTURE:');
  if (capture.length !== 1 || capture[0].version !== 1 || !capture[0].build?.identity ||
      typeof capture[0].adapter?.identity !== 'string' || !capture[0].adapter.identity.startsWith('native:vulkan/') || /llvmpipe|lavapipe|swiftshader|software/iu.test(capture[0].adapter.identity)) fail('CACHE_OBSERVATION_ADAPTER');
  const coldStart = markers(log, 'TN_COLD_START:');
  const processMarkers = coldStart.filter((value) => value.segment === 'process');
  if (processMarkers.length !== 1 || !finite(processMarkers[0].atMs)) fail('PROCESS_COLD_UNPROVED');
  const playableMarkers = coldStart.filter((value) => value.segment === 'first_playable');
  if (playableMarkers.length !== 1 || !finite(playableMarkers[0].atMs) ||
      playableMarkers[0].atMs <= processMarkers[0].atMs) fail('FIRST_PLAYABLE_NATIVE_CLOCK');
  const readyMs = playableMarkers[0].atMs - processMarkers[0].atMs;
  return { arm, apkSha256, identity: device.identity, readyMs, javascriptReadyMs: readiness(receipt),
    ...compilePopulation(log, mode), cache: caches, before, after };
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export function assessPipelineCachePairs(pairs) {
  if (!Array.isArray(pairs) || pairs.length < 3) fail('PAIR_COUNT');
  const reference = pairs[0]?.empty;
  for (const pair of pairs) {
    for (const [key, arm] of [['empty', 'empty'], ['populated', 'populated'], ['disabledBefore', 'disabled-before'], ['disabledAfter', 'disabled-after']]) {
      const sample = pair?.[key];
      if (sample?.arm !== arm || !finite(sample.serviceMs) || !finite(sample.readyMs)) fail('PAIR_INCOMPLETE');
      for (const field of ['apkSha256', 'identity', 'programs', 'pipelineCount'])
        if (sample[field] !== reference[field]) fail('PAIR_IDENTITY_MISMATCH');
    }
  }
  const emptyMedianMs = median(pairs.map((pair) => pair.empty.serviceMs));
  if (!(emptyMedianMs > 0)) fail('EMPTY_COMPILE_UNOBSERVED');
  const populatedMedianMs = median(pairs.map((pair) => pair.populated.serviceMs));
  const disabledBeforeMedianMs = median(pairs.map((pair) => pair.disabledBefore.serviceMs));
  const disabledAfterMedianMs = median(pairs.map((pair) => pair.disabledAfter.serviceMs));
  const populatedReadyMedianMs = median(pairs.map((pair) => pair.populated.readyMs));
  const compileRatio = populatedMedianMs / emptyMedianMs;
  const criteria = { compileReduction: compileRatio <= 0.25, firstPlayable: populatedReadyMedianMs <= 8000,
    beatsDisabledBefore: populatedMedianMs < disabledBeforeMedianMs, beatsDisabledAfter: populatedMedianMs < disabledAfterMedianMs };
  return { schemaVersion: 1, pass: Object.values(criteria).every(Boolean), pairs: pairs.length, criteria,
    emptyMedianMs, populatedMedianMs, disabledBeforeMedianMs, disabledAfterMedianMs, compileRatio,
    populatedReadyMedianMs, perPipelineHitClaim: false };
}
