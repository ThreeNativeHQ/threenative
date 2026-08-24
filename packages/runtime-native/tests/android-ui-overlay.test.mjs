import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

const source = readFileSync(
  new URL('../android/app/src/main/java/com/mystral/engine/TnUiOverlay.java', import.meta.url),
  'utf8',
);

test('Android reports the UI peer only after the page bridge is ready', () => {
  const proxyAssignment = source.indexOf('replyProxy = proxy;');
  const attachedSignal = source.indexOf('nativeUiOverlayAttached(true);');
  assert.ok(proxyAssignment >= 0, 'the page callback must store its reply proxy');
  assert.ok(attachedSignal > proxyAssignment, 'the host must not advertise readiness before the proxy');
  assert.match(source, /pendingFrame = frame/u);
  assert.match(source, /if \(pending != null\) proxy\.postMessage\(pending\);/u);
});
