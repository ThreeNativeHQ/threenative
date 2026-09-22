const requireObservation = (condition, code, message) => {
  if (!condition) throw new Error(`TN_UI_CADENCE_${code}: ${message}`);
};
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

/** Decode the fixture's exact state ID; complementary rows reject partial/shifted captures. */
export function decodeUiSequence(frame) {
  requireObservation(frame.length === 160 * 24 * 3, 'PIXELS', 'expected a 160x24 RGB24 capture');
  const pixel = (x, y) => frame.readUIntBE((y * 160 + x) * 3, 3);
  let sequence = 0;
  let valid = pixel(136, 6) === 0x00ffff && pixel(152, 6) === 0xff00ff;
  for (let bit = 0; bit < 16; bit += 1) {
    const top = pixel(bit * 8 + 4, 6);
    const bottom = pixel(bit * 8 + 4, 18);
    valid &&= (top === 0xffffff && bottom === 0) || (top === 0 && bottom === 0xffffff);
    if (top === 0xffffff) sequence += 1 << bit;
  }
  return { sequence, valid };
}

/** Fixed qualification bounds for the 60 FPS fixture, including its two-second idle periods. */
export function analyzeUiCadence({ states, captures }) {
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
  requireObservation(durationMs >= 24_000 && captureHz >= 180 && captureHz <= 300 &&
    percentile(captureIntervals, 0.95) <= 10 && Math.max(...captureIntervals) <= 100,
  'SAMPLING', 'need at least 24 seconds of continuous 180–300 Hz capture');
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
      windows.push({ at, published: samples.length, visible, dropped: samples.length - visible });
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
    dropped: total('dropped'), droppedRatio: total('dropped') / total('published'),
    matched: latencies.length, invalid: 0, stale: 0, idleResumes, windows };
}
