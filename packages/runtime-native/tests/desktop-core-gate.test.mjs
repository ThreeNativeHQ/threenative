import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { afterEach, expect, test } from 'vitest';
import {
  FIRST_FRAME_MARKER,
  READY_MARKER,
  analyzeDesktopLog,
  inspectScreenshot,
} from '../scripts/verify-desktop-core.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

test('desktop log requires both markers, exact frame completion, and clean errors', () => {
  const clean = `${READY_MARKER}\n${FIRST_FRAME_MARKER}\nRendered 300 frames in 9000ms`;
  expect(analyzeDesktopLog(clean)).toEqual([]);
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
  const root = mkdtempSync(join(tmpdir(), 'threenative-desktop-gate-'));
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
