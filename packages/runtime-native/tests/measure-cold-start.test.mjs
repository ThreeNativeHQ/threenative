import { expect, test } from 'vitest';

import {
  ColdStartError,
  DESKTOP_REQUIRED_MARKERS,
  DESKTOP_SEGMENTS,
  REQUIRED_MARKERS,
  breakdown,
  desktopOptimization,
  parseArgs,
  parseMarkers,
  requiredMarkers,
  runDesktopLaunch,
  summarise,
} from '../scripts/measure-cold-start.mjs';

// PRD-328. The reader could not run on the engine that ships: the compile and execute markers
// existed only under QuickJS, so `--device` failed closed with
// `TN_COLD_START_MARKER_MISSING:compile_begin` on every real configuration, and there was no lane
// at all that could measure a launch without a phone. These cover the desktop lane that fixes that
// and every refusal it inherits.

/** One desktop launch's stdout, in the shape the host actually prints it. */
function desktopLog(overrides = {}) {
  const at = {
    process: 0,
    runtime_created: 348.838,
    game_eval_begin: 348.842,
    compile_begin: 360.36,
    compile_complete: 408.875,
    execute_begin: 408.886,
    execute_complete: 450.409,
    first_frame: 531.528,
    ...overrides,
  };
  // The bootstrap scripts the host evaluates before the game reach the same engine members, so a
  // real log carries their segments too. Keeping a set here proves the reader brackets on
  // `game_eval_begin` rather than taking whatever it saw first.
  const bootstrap = [
    'TN_COLD_START:{"segment":"compile_begin","atMs":12.100}',
    'TN_COLD_START:{"segment":"compile_complete","atMs":12.400}',
    'TN_COLD_START:{"segment":"execute_begin","atMs":12.500}',
    'TN_COLD_START:{"segment":"execute_complete","atMs":12.600}',
  ];
  const lines = ['[Window] SDL initialized'];
  for (const [segment, atMs] of Object.entries(at)) {
    if (atMs === null) continue;
    if (segment === 'game_eval_begin') lines.push(...bootstrap.map((line) => line));
    lines.push(`TN_COLD_START:{"segment":"${segment}","atMs":${atMs.toFixed(3)}}`);
  }
  return lines.join('\n');
}

test('the desktop segment list drops only the two markers an APK read brackets', () => {
  expect(requiredMarkers(DESKTOP_SEGMENTS)).toEqual(DESKTOP_REQUIRED_MARKERS);
  // `asset_begin`/`asset_complete` bracket reading the bundle out of the APK. A desktop host reads
  // its entry from the filesystem inside `loadScript`, so they are absent by construction.
  expect(REQUIRED_MARKERS.filter((name) => !DESKTOP_REQUIRED_MARKERS.includes(name))).toEqual([
    'asset_begin',
    'asset_complete',
  ]);
  expect(DESKTOP_REQUIRED_MARKERS.every((name) => REQUIRED_MARKERS.includes(name))).toBe(true);
});

test('a desktop launch log becomes the segment breakdown the record quotes', () => {
  const sample = breakdown(parseMarkers(desktopLog()), DESKTOP_SEGMENTS);
  expect(sample.totalMs).toBeCloseTo(531.528, 3);
  const byName = Object.fromEntries(sample.segments.map((segment) => [segment.name, segment.ms]));
  // The number this PRD exists to produce, and the one the code-cache decision is priced on.
  expect(byName['JavaScript parse and compile']).toBeCloseTo(48.515, 3);
  expect(byName['bundle top-level execution']).toBeCloseTo(41.523, 3);
  expect(byName['host bring-up']).toBeCloseTo(348.838, 3);
  expect(byName['first rendered frame']).toBeCloseTo(81.119, 3);

  const summary = summarise([sample, sample], DESKTOP_SEGMENTS);
  expect(summary.launches).toBe(2);
  expect(summary.totalMs.medianMs).toBeCloseTo(531.528, 3);
  expect(summary.segments.map((segment) => segment.name)).toEqual(
    DESKTOP_SEGMENTS.map((segment) => segment.name),
  );
});

test('a missing desktop segment names itself rather than reporting a partial total', () => {
  for (const segment of DESKTOP_REQUIRED_MARKERS) {
    const withoutSegment = desktopLog()
      .split('\n')
      .filter((line) => !line.includes(`"segment":"${segment}"`))
      .join('\n');
    expect(() => breakdown(parseMarkers(withoutSegment), DESKTOP_SEGMENTS)).toThrow(
      `TN_COLD_START_MARKER_MISSING:${segment}`,
    );
  }
  // The PRD's named negative control, exactly as written.
  const withoutExecuteBegin = desktopLog()
    .split('\n')
    .filter((line) => !line.includes('"segment":"execute_begin"'))
    .join('\n');
  expect(() => breakdown(parseMarkers(withoutExecuteBegin), DESKTOP_SEGMENTS)).toThrow(
    'TN_COLD_START_MARKER_MISSING:execute_begin',
  );
});

test('blended launches and malformed markers are refused, never averaged', () => {
  // Time running backwards means two launches landed in one buffer. That is not a slow segment.
  const backwards = desktopLog({ compile_complete: 100 });
  expect(() => breakdown(parseMarkers(backwards), DESKTOP_SEGMENTS)).toThrow(
    'TN_COLD_START_SEGMENT_NEGATIVE:compile_begin->compile_complete',
  );
  expect(() => parseMarkers('TN_COLD_START:{"segment":"process"')).toThrow(
    /^TN_COLD_START_MARKER_MALFORMED/u,
  );
  expect(() => parseMarkers('TN_COLD_START:{"segment":"process","atMs":"soon"}')).toThrow(
    /^TN_COLD_START_MARKER_MALFORMED/u,
  );
  expect(() => parseMarkers('TN_COLD_START:{"segment":"process","atMs":null}')).toThrow(
    /^TN_COLD_START_MARKER_MALFORMED/u,
  );
});

test('the desktop lane keeps every refusal the device lane has, and refuses to be both', () => {
  expect(parseArgs(['--desktop']).desktop).toBe(true);
  expect(parseArgs(['--desktop']).launches).toBe(5);

  // One launch is a story, not a distribution — the same bar the device lane sets.
  expect(() => parseArgs(['--desktop', '--launches', '1'])).toThrow(
    'TN_COLD_START_LAUNCHES_INVALID',
  );
  expect(() => parseArgs(['--desktop', '--launches', '1.5'])).toThrow(
    'TN_COLD_START_LAUNCHES_INVALID',
  );
  expect(() => parseArgs(['--desktop', '--frames', '0'])).toThrow('TN_COLD_START_FRAMES_INVALID');
  expect(() => parseArgs([])).toThrow('TN_COLD_START_DEVICE_REQUIRED');
  expect(() => parseArgs(['--desktop', '--unknown'])).toThrow('TN_COLD_START_ARG_UNKNOWN:--unknown');

  // A desktop total quoted as a phone number is the mistake the whole instrument exists to stop.
  expect(() => parseArgs(['--desktop', '--device', '37251FDJH0037Z'])).toThrow(
    'TN_COLD_START_LANE_AMBIGUOUS',
  );
});

test('the desktop lane names its build type and refuses one whose launch time means nothing', () => {
  expect(desktopOptimization('CMAKE_BUILD_TYPE:STRING=Release\n')).toEqual({
    buildType: 'Release',
    optimization: '-O2',
  });
  expect(desktopOptimization('CMAKE_BUILD_TYPE:STRING=RelWithDebInfo\n').optimization).toBe('-O2');
  // -O0 and -O2 differ by roughly 4x on this metric, which is more than any lever here could find.
  expect(() => desktopOptimization('CMAKE_BUILD_TYPE:STRING=Debug\n')).toThrow(
    'TN_COLD_START_OPTIMIZATION_INVALID:Debug',
  );
  expect(() => desktopOptimization('CMAKE_BUILD_TYPE:STRING=\n')).toThrow(
    'TN_COLD_START_BUILD_TYPE_UNKNOWN',
  );
  expect(() => desktopOptimization('')).toThrow('TN_COLD_START_BUILD_TYPE_UNKNOWN');
});

test('a desktop launch is bounded and fails closed rather than hanging', () => {
  const calls = [];
  const spawnSync = (command, args, options) => {
    calls.push({ args, command, options });
    return { status: 0, stdout: desktopLog(), stderr: '' };
  };
  const log = runDesktopLaunch(
    { binary: '/tmp/mystral', bundle: '/tmp/game/dist/game.js', frames: 60, screenshot: '/tmp/s.png' },
    { spawnSync },
  );
  expect(parseMarkers(log).get('first_frame')).toBeCloseTo(531.528, 3);
  const [call] = calls;
  // `--frames` bounds only screenshot mode; `runNormalMode` calls `runtime.run()` and never
  // returns, so a plain `run` here times out instead of reporting. This is the regression guard.
  expect(call.args).toContain('--screenshot');
  expect(call.args).toContain('--frames');
  expect(call.options.cwd).toBe('/tmp/game/dist');
  if (process.platform === 'linux') {
    expect(call.command).toBe('sh');
    // Never `xvfb-run`: its cleanup kill replaces the command's status, so a good run reports red.
    expect(call.args[0]).toMatch(/scripts\/xvfb\.sh$/u);
    expect(call.options.env.SDL_VIDEODRIVER).toBe('x11');
  }

  const failing = () => ({ status: 1, stdout: '', stderr: 'Error: Failed to create runtime!' });
  expect(() =>
    runDesktopLaunch(
      { binary: '/tmp/mystral', bundle: '/tmp/g.js', frames: 60, screenshot: '/tmp/s.png' },
      { spawnSync: failing },
    ),
  ).toThrow(ColdStartError);
});
