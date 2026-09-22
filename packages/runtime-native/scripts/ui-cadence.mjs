const requireObservation = (condition, code, message) => {
  if (!condition) throw new Error(`TN_UI_CADENCE_${code}: ${message}`);
};
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

/** Decode the fixture's exact state ID; complementary rows reject partial/shifted captures. */
export function decodeUiSequence(frame, { tolerance = 0 } = {}) {
  requireObservation(frame.length === 160 * 24 * 3, 'PIXELS', 'expected a 160x24 RGB24 capture');
  requireObservation(Number.isInteger(tolerance) && tolerance >= 0 && tolerance <= 32, 'PIXELS', 'color tolerance must be within 0–32');
  const pixel = (x, y) => frame.readUIntBE((y * 160 + x) * 3, 3);
  const near = (actual, expected) => [0, 8, 16].every((shift) => Math.abs(((actual >> shift) & 255) - ((expected >> shift) & 255)) <= tolerance);
  let sequence = 0;
  let valid = near(pixel(136, 6), 0x00ffff) && near(pixel(152, 6), 0xff00ff);
  for (let bit = 0; bit < 16; bit += 1) {
    const top = pixel(bit * 8 + 4, 6);
    const bottom = pixel(bit * 8 + 4, 18);
    const on = near(top, 0xffffff) && near(bottom, 0);
    valid &&= on || (near(top, 0) && near(bottom, 0xffffff));
    if (on) sequence += 1 << bit;
  }
  return { sequence, valid };
}

/** Android screenrecord's Winscope v2 data track, checked against each decoded frame's PTS. */
export function decodeAndroidUiTimestamps(buffer, framePts) {
  const magic = Buffer.from('#VV1NSC0PET1ME2#');
  const header = magic.length + 16;
  requireObservation(Buffer.isBuffer(buffer) && buffer.length >= header &&
    buffer.subarray(0, magic.length).equals(magic) && buffer.readUInt32LE(magic.length) === 2,
  'TIMESTAMPS', 'missing or unsupported Winscope v2 metadata');
  const offset = buffer.readBigInt64LE(magic.length + 4);
  const count = buffer.readUInt32LE(magic.length + 12);
  requireObservation(count > 0 && buffer.length === header + count * 8 &&
    Array.isArray(framePts) && framePts.length === count && framePts.every(Number.isFinite),
  'TIMESTAMPS', 'decoded frames and metadata must have matching nonempty counts');
  const times = Array.from({ length: count }, (_, index) => Number(offset + buffer.readBigUInt64LE(header + index * 8)) / 1e6);
  let alignmentMaxErrorMs = 0;
  for (let i = 0; i < count; i += 1) {
    requireObservation(times[i] > 0 && times[i] < Number.MAX_SAFE_INTEGER &&
      (i === 0 || (times[i] > times[i - 1] && framePts[i] > framePts[i - 1])),
    'TIMESTAMPS', 'frame timestamps must increase');
    alignmentMaxErrorMs = Math.max(alignmentMaxErrorMs, Math.abs((framePts[i] - framePts[0]) * 1000 - (times[i] - times[0])));
  }
  requireObservation(alignmentMaxErrorMs <= 1, 'TIMESTAMPS', 'decoded frame PTS differ from metadata by more than 1 ms');
  return { times, alignmentMaxErrorMs };
}

/** Fixed qualification bounds for the 60 FPS fixture, including its two-second idle periods. */
export function analyzeUiCadence({ states, captures }, { sampling = 'x11' } = {}) {
  requireObservation(sampling === 'x11' || sampling === 'android', 'SAMPLING', 'unknown capture backend');
  requireObservation(Array.isArray(states) && states.length > 600 && Array.isArray(captures) && captures.length > 1000,
    'OBSERVATION', 'not enough game-state and screen observations');
  const published = new Map();
  const segments = [];
  let segment = [];
  let previous;
  for (const state of states) {
    requireObservation(Number.isSafeInteger(state.sequence) && state.sequence > 0 && state.sequence < 65_536 &&
      Number.isFinite(state.at) && (!previous || (state.sequence === previous.sequence + 1 && state.at > previous.at)),
    'STATE', 'publication IDs must be consecutive with increasing timestamps');
    if (previous && state.at - previous.at > 1000) {
      requireObservation(state.at - previous.at >= 1800 && state.at - previous.at <= 2300,
        'IDLE', 'fixture idle duration differs from two seconds');
      segments.push(segment); segment = [];
    }
    segment.push(state); published.set(state.sequence, state.at); previous = state;
  }
  segments.push(segment);
  const firstVisible = new Map();
  const captureIntervals = [];
  previous = undefined;
  for (const capture of captures) {
    requireObservation(capture.valid === true && Number.isFinite(capture.at) && published.has(capture.sequence),
      'CAPTURE', 'invalid pixels or a visible ID without a publication');
    requireObservation(!previous || (capture.at >= previous.at && capture.sequence >= previous.sequence),
      'STALE', 'visible state or capture time moved backwards');
    if (previous) captureIntervals.push(capture.at - previous.at);
    if (!firstVisible.has(capture.sequence)) firstVisible.set(capture.sequence, capture.at);
    previous = capture;
  }
  const durationMs = captures.at(-1).at - captures[0].at;
  const captureHz = (captures.length - 1) * 1000 / durationMs;
  const android = sampling === 'android';
  requireObservation(durationMs >= 24_000 && captureHz >= (android ? 55 : 180) && captureHz <= (android ? 65 : 300) &&
    percentile(captureIntervals, 0.95) <= (android ? 20 : 10) && Math.max(...captureIntervals) <= 100,
  'SAMPLING', `need at least 24 seconds of continuous ${android ? '55–65' : '180–300'} Hz capture`);
  const start = captures[0].at + 1000;
  const end = captures.at(-1).at - 100;
  const latencies = [];
  for (const [sequence, visibleAt] of firstVisible) {
    const postedAt = published.get(sequence);
    requireObservation(visibleAt >= postedAt, 'CLOCK', 'pixels appeared before their state was published');
    if (postedAt >= start && postedAt <= end) latencies.push(visibleAt - postedAt);
  }
  requireObservation(latencies.length >= 600, 'OBSERVATION', 'fewer than 600 settled visible IDs');
  const p95Ms = percentile(latencies, 0.95);
  requireObservation(p95Ms <= 50, 'LATENCY', `state-to-visible p95 ${p95Ms} ms exceeds 50 ms`);
  const windows = [];
  const idleResumes = [];
  for (const active of segments) {
    const lower = Math.max(start, active[0].at);
    const upper = Math.min(end, active.at(-1).at);
    for (let at = Math.ceil(lower / 1000) * 1000; at + 1000 <= upper; at += 1000) {
      const samples = active.filter((state) => state.at >= at && state.at < at + 1000);
      const visible = samples.filter((state) => firstVisible.has(state.sequence)).length;
      requireObservation(samples.length >= 55 && samples.length <= 65, 'SOURCE_RATE',
        `source rendered ${samples.length} updates/s; this check requires a stable 60 FPS workload`);
      requireObservation(visible >= 50 && visible / samples.length >= 0.8, 'VISIBLE_RATE',
        `${visible}/${samples.length} updates became visible in the second starting ${at}`);
      windows.push({ at, published: samples.length, visible, unobserved: samples.length - visible,
        dropped: android ? null : samples.length - visible });
    }
    if (active !== segments[0] && active[0].at >= start && active[0].at <= end) {
      const resumed = active.find((state) => firstVisible.has(state.sequence));
      const delayMs = resumed ? firstVisible.get(resumed.sequence) - active[0].at : null;
      requireObservation(delayMs !== null && delayMs >= 0 && delayMs <= 67, 'RESUME', `idle wake-up took ${delayMs} ms`);
      idleResumes.push({ published: active[0].sequence, visible: resumed.sequence, delayMs });
    }
  }
  requireObservation(windows.length >= 16 && idleResumes.length >= 2, 'OBSERVATION', 'need 16 active seconds and two idle wake-ups');
  const total = (key) => windows.reduce((sum, window) => sum + window[key], 0);
  return { p50Ms: percentile(latencies, 0.5), p95Ms, maxMs: Math.max(...latencies),
    captureHz, durationMs, sourceHz: total('published') / windows.length, visibleHz: total('visible') / windows.length,
    dropped: android ? null : total('unobserved'), droppedRatio: android ? null : total('unobserved') / total('published'),
    unobserved: total('unobserved'),
    matched: latencies.length, invalid: 0, stale: 0, idleResumes, windows };
}
