import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PNG } from 'pngjs';
import { afterEach, expect, test } from 'vitest';
import {
  FIRST_FRAME_MARKER,
  READY_MARKER,
  analyzeDesktopLog,
  analyzePresentTicks,
  inspectOverlayBuffer,
  inspectScreenshot,
} from '../scripts/verify-desktop-core.mjs';

/** One tick per 60 frames, presents keeping pace, as a healthy 300-frame run emits. */
const HEALTHY_TICKS = [60, 120, 180, 240, 300]
  .map((frames) => `TN_PRESENTS_TICK:{"frames":${frames},"presents":${frames}}`)
  .join('\n');

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

test('desktop log requires both markers, exact frame completion, and clean errors', () => {
  const clean = `${READY_MARKER}\n${FIRST_FRAME_MARKER}\nRendered 300 frames in 9000ms\nTN_PRESENTS:300\n${HEALTHY_TICKS}`;
  expect(analyzeDesktopLog(clean)).toEqual([]);
  expect(analyzeDesktopLog(clean.replace('TN_PRESENTS:300\n', ''))).toContain(
    'missing TN_PRESENTS count',
  );
  // The defect itself: the overlay pass presenting a swapchain image of its own.
  expect(analyzeDesktopLog(clean.replace('TN_PRESENTS:300', 'TN_PRESENTS:600'))).toContain(
    'presented 600 times for 300 frames; expected exactly one present per frame',
  );
  expect(analyzeDesktopLog(clean.replace(FIRST_FRAME_MARKER, 'FIRST_FRAME'))).toContain(
    `missing ${FIRST_FRAME_MARKER}`,
  );
  expect(analyzeDesktopLog(clean.replace('300 frames', '299 frames'))).toContain(
    'missing exact 300-frame completion',
  );
  expect(analyzeDesktopLog(`${clean}\nWebGPU validation error`)).toContain(
    'WebGPU validation error',
  );
});

test('desktop screenshot rejects a single-color image and accepts visible pixels', () => {
  const root = makeTempDirSync('threenative-desktop-gate-');
  roots.push(root);
  const path = join(root, 'frame.png');
  const png = new PNG({ height: 1, width: 2 });
  png.data.set([0, 0, 0, 255, 0, 0, 0, 255]);
  writeFileSync(path, PNG.sync.write(png));
  expect(() => inspectScreenshot(path)).toThrow('blank');
  png.data.set([0, 0, 0, 255, 68, 170, 255, 255]);
  writeFileSync(path, PNG.sync.write(png));
  expect(inspectScreenshot(path)).toEqual({ height: 1, width: 2 });
});

test('desktop verifier preserves evidence and only forces X11 on Linux', () => {
  const source = readFileSync(
    new URL('../scripts/verify-desktop-core.mjs', import.meta.url),
    'utf8',
  );
  expect(source).toMatch(/desktop-\$\{process\.platform\}-report\.json/);
  expect(source).toMatch(/desktop-\$\{process\.platform\}\.log/);
  expect(source).toMatch(/sha256/);
  expect(source).toMatch(/if \(process\.platform === 'linux'\) runtimeEnv\.SDL_VIDEODRIVER = 'x11'/);
  expect(source).not.toMatch(/env: \{ \.\.\.process\.env, SDL_VIDEODRIVER: 'x11' \}/);
});

test('present ticks fail closed on a missing, malformed, or outrunning count', () => {
  expect(analyzePresentTicks(HEALTHY_TICKS).failures).toEqual([]);
  expect(analyzePresentTicks(HEALTHY_TICKS).ticks).toHaveLength(5);
  // An empty assertion set is a failure here, not a pass: a device log with no tick at all means
  // nothing measured the invariant.
  expect(analyzePresentTicks('nothing to see').failures).toContain(
    'expected at least 1 TN_PRESENTS_TICK line(s), found 0',
  );
  expect(analyzePresentTicks('TN_PRESENTS_TICK:{"frames":60}').failures).toContain(
    'TN_PRESENTS_TICK missing frames/presents: {"frames":60}',
  );
  // Two presents per frame is the shape of the defect: the world pass and the overlay pass each
  // acquiring and presenting a swapchain image of their own.
  const doubled = 'TN_PRESENTS_TICK:{"frames":60,"presents":120}';
  expect(analyzePresentTicks(doubled).failures[0]).toMatch(
    /presented 120 times in 60 frames; expected at most one present per frame/u,
  );
  // A frame that submitted nothing may leave presents one behind; that is not the defect.
  expect(analyzePresentTicks('TN_PRESENTS_TICK:{"frames":60,"presents":59}').failures).toEqual([]);
});

test('overlay assertion reads PNG bytes and names what is missing', () => {
  const png = new PNG({ height: 4, width: 4 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data.set([0x11, 0x22, 0x33, 255], index);
  }
  const blank = PNG.sync.write(png);
  expect(() => inspectOverlayBuffer(blank, { label: 'device.png', minPixels: 4 })).toThrow(
    /canvas-layer overlay missing from device\.png: found 0 pixels of #ff00ff/u,
  );
  for (let index = 0; index < 4 * 4; index += 4) png.data.set([0xff, 0x00, 0xff, 255], index);
  expect(inspectOverlayBuffer(PNG.sync.write(png), { minPixels: 4 })).toEqual({ overlayPixels: 4 });
});
