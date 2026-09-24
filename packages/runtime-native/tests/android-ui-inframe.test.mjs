import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

const read = (relative) =>
  readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const activity = read('android/app/src/main/java/com/mystral/engine/MystralActivity.java');
const overlay = read('android/app/src/main/java/com/mystral/engine/TnUiOverlay.java');
const platform = read('src/platform/ui_overlay.cpp');
const composite = read('src/webgpu/bindings_ui_composite.cpp');
const seam = read('include/mystral/platform/ui_overlay.h');

test("TN_UI_INFRAME defaults off and keeps today's child-window path", () => {
  assert.match(activity, /inFrameRequested\(Bundle metadata\)/u);
  assert.match(activity, /getBooleanExtra\("TN_UI_INFRAME", false\)/u);
  assert.match(activity, /metadata\.getBoolean\("TN_UI_INFRAME", false\)/u);
  // The default is the child-window factory, and it reports its path by name.
  assert.match(overlay, /nativeUiCompositePath\("child-window"\)/u);
  assert.match(overlay, /nativeUiCompositePath\("in-frame-cpu"\)/u);
});

test('the Java producer delivers the latest produced frame to native', () => {
  assert.match(overlay, /static TnUiOverlay attachInFrame\(Activity activity\)/u);
  assert.match(overlay, /ImageReader\.newInstance\(/u);
  assert.match(overlay, /createVirtualDisplay\(/u);
  assert.match(overlay, /new Presentation\(activity, frameDisplay\.getDisplay\(\)\)/u);
  assert.match(overlay, /acquireLatestImage\(\)/u);
  assert.match(overlay, /private static native void nativeUiFrame\(/u);
  assert.match(overlay, /private static native void nativeUiCompositePath\(/u);
  // Input stays on the real WebView: the activity forwards the gesture to the same hit test.
  assert.match(activity, /overlay\.isInFrame\(\) && overlay\.dispatchTouchEvent\(event\)/u);
});

test('native turns the published frame into the UiOverlayFrame seam on Android', () => {
  assert.match(seam, /bool isRgba = false;/u);
  assert.match(
    platform,
    /Java_com_threenative_runtime_TnUiOverlay_nativeUiFrame\(\s*JNIEnv\* environment, jclass, jobject pixels/u,
  );
  assert.match(platform, /GetDirectBufferAddress\(pixels\)/u);
  assert.match(
    platform,
    /Java_com_threenative_runtime_TnUiOverlay_nativeUiCompositePath\(/u,
  );
  // The mailbox reader is defined outside `TN_ENABLE_UI_OVERLAY` (off on Android) and reports the
  // source channel order; Android routes to it from `uiOverlayFrame`.
  assert.match(platform, /bool takeAndroidUiOverlayFrame\(UiOverlayFrame& frame\)/u);
  assert.match(platform, /frame\.isRgba = g_androidFrameRgba\.load/u);
  assert.match(platform, /#elif defined\(__ANDROID__\)\n    return takeAndroidUiOverlayFrame\(frame\);/u);
});

test('the composite picks the texture format from the source channel order', () => {
  assert.match(composite, /frame\.isRgba \? WGPUTextureFormat_RGBA8Unorm : WGPUTextureFormat_BGRA8Unorm/u);
  assert.match(composite, /state->ui\.textureFormat == format/u);
});
