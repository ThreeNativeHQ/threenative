import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

function assertOrdered(source, ...tokens) {
  let offset = 0;
  for (const token of tokens) {
    const index = source.indexOf(token, offset);
    assert.notEqual(index, -1, `missing ordered token: ${token}`);
    offset = index + token.length;
  }
}

test('native canvas listener removal is executable and preserves callback identity and capture', () => {
  const runtime = read('src/runtime.cpp');
  const bindings = read('src/webgpu/bindings.cpp');
  const scene = read('conformance/scenes/shared/runtime-events.js');
  const engine = read('include/mystral/js/engine.h');

  for (const implementation of ['src/js/quickjs_engine.cpp', 'src/js/v8_engine.cpp', 'src/js/jsc_engine.mm']) {
    assert.match(read(implementation), /bool isSameValue\(JSValueHandle left, JSValueHandle right\) override/u);
  }
  assert.match(runtime, /removeEventListenerFromTarget\("canvas", args\)/u);
  assert.match(runtime, /bool eventListenerCaptureFromArgs\(const std::vector<js::JSValueHandle>& args\)/u);
  assert.match(runtime, /if \(jsEngine_->isBoolean\(options\)\) return jsEngine_->toBoolean\(options\);/u);
  assert.match(runtime, /return jsEngine_->toBoolean\(jsEngine_->getProperty\(options, "capture"\)\);/u);
  assert.equal(
    runtime.match(/const bool useCapture = eventListenerCaptureFromArgs\(args\);/gu)?.length,
    2,
    'canvas add and remove must share capture extraction',
  );
  assert.match(runtime, /listener\.useCapture == useCapture[\s\S]*?jsEngine_->isSameValue\(listener\.callback, callback\)/u);
  assert.match(runtime, /it->useCapture != useCapture[\s\S]*?jsEngine_->isSameValue\(it->callback, callback\)/u);
  assert.match(runtime, /jsEngine_->freeHandle\(it->callback\);\s*listeners\.erase\(it\);/u);
  assert.match(bindings, /const auto remove = state->engine->getProperty\(mainCanvas, "removeEventListener"\);/u);
  assert.match(bindings, /return state->engine->call\(remove, mainCanvas, args\);/u);
  assert.match(engine, /virtual bool isSameValue\(JSValueHandle left, JSValueHandle right\) = 0;/u);

  assertOrdered(
    scene,
    'canvas.addEventListener(\'pointerdown\', directRemoved, false);',
    'canvas.removeEventListener(\'pointerdown\', directRemoved, false);',
    'canvas.dispatchEvent(new PointerEvent(\'pointerdown\', { pointerId: 2',
    "if (directRemovedCalls !== 0)",
  );
  assertOrdered(
    scene,
    "canvas.addEventListener('pointerdown', directRetained, { capture: false });",
    "canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 4",
    "if (directRetainedCalls !== 1)",
    "canvas.removeEventListener('pointerdown', directRetained, false);",
    "canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 5",
    "if (directRetainedCalls !== 1)",
  );
  assertOrdered(
    scene,
    "rendererCanvas.addEventListener('pointerdown', forwardedRemoved, true);",
    "rendererCanvas.removeEventListener('pointerdown', forwardedRemoved, true);",
    "rendererCanvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3",
    'if (forwardedRemovedCalls !== 0)',
  );
  assertOrdered(
    scene,
    "rendererCanvas.addEventListener('pointerdown', forwardedRetained, { capture: false });",
    "rendererCanvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 6",
    "if (forwardedRetainedCalls !== 1)",
    "rendererCanvas.removeEventListener('pointerdown', forwardedRetained, { capture: false });",
    "rendererCanvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7",
    "if (forwardedRetainedCalls !== 1)",
  );
  assertOrdered(
    scene,
    "canvas.addEventListener('pointerup', captureListener, true);",
    "canvas.addEventListener('pointerup', captureListener, { capture: false });",
    "canvas.removeEventListener('pointerup', captureListener, { capture: false });",
    "canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8",
    'if (captureCalls !== 1)',
  );
  assertOrdered(
    scene,
    "rendererCanvas.addEventListener('pointerup', forwardedCaptureListener, true);",
    "rendererCanvas.addEventListener('pointerup', forwardedCaptureListener, { capture: false });",
    "rendererCanvas.removeEventListener('pointerup', forwardedCaptureListener, { capture: false });",
    "rendererCanvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 10",
    'if (forwardedCaptureCalls !== 1)',
  );
});
