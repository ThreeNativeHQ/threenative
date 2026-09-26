package com.threenative.runtime;

import android.app.Activity;
import android.app.Presentation;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.hardware.HardwareBuffer;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The UI layer — a transparent WebView composited over the game surface, rendering only the UI.
 *
 * The game keeps its native GPU surface and its native loop. Nothing of the scene, the
 * simulation or the render path lives here; this view draws `src/ui/` and nothing else, which
 * is why the system composites it as a hardware overlay and it costs no measurable frame time.
 *
 * <h3>Why the hit test is here and not in CSS</h3>
 *
 * A WebView is a native view with a <em>rectangular</em> hit-test region owned by the platform.
 * CSS hit-testing runs inside that surface, after the native view has already claimed the
 * gesture, so {@code pointer-events: none} never hands a touch back to the game beneath it. It
 * is a useful property inside the page; it is not the pass-through mechanism, and a run that
 * "proves" pass-through by toggling it proves nothing.
 *
 * The mechanism is the interactive-rect registry in {@code @threenative/core/ui-layer}: the page
 * publishes where its interactive islands are, normalized to the viewport, and this view decides
 * ownership on the way in.
 *
 * <h3>The three rules</h3>
 *
 * <ul>
 *   <li>Ownership is decided on <b>pointer-down only</b> and held until pointer-up, so a drag
 *       that starts on the game is not stolen by a button it passes over.</li>
 *   <li>The registry is <b>published</b>, never queried per event — an async round trip inside
 *       the input path buys latency and races the frame that moved the button.</li>
 *   <li>A <b>moving</b> island republishes per frame while its transition is live, so a button
 *       is hit where it is drawn rather than where it was.</li>
 * </ul>
 *
 * <h3>Known limitation, stated rather than discovered</h3>
 *
 * Android hands a whole gesture to whichever view claimed its first pointer-down. So while a
 * finger is held on a HUD control, a second finger anywhere on screen also goes to this view;
 * and while a finger is held on the game, a second finger on a HUD control goes to the game.
 * The first finger decides the window. Splitting a gesture per pointer needs the host to
 * synthesize two event streams, which is a larger change than the four rules this ships.
 */
public final class TnUiOverlay extends WebView {

    /** The origin {@link WebViewAssetLoader} serves the UI bundle from. Never {@code file://}. */
    private static final String ASSET_ORIGIN = "https://appassets.androidplatform.net";
    /** The path inside the APK's assets that holds the built UI. */
    private static final String ASSET_PATH = "/ui/";
    /** The name the page sees. Must match {@code UI_BRIDGE_GLOBALS.uiHost}. */
    private static final String HOST_OBJECT = "tnHost";
    /** Must match {@code HIT_REGIONS_MESSAGE} in @threenative/core/ui-layer. */
    private static final String HIT_REGIONS_MESSAGE = "tn:hit-regions";

    private static native void nativeUiMessage(String frame);

    private static native void nativeUiOverlayAttached(boolean attached);

    /**
     * Publish one produced page frame to the native composite.
     *
     * `pixels` is the producer's direct `ImageReader` plane buffer; native copies it before this
     * call returns, so the image can be closed immediately. `stride` is the row stride in bytes.
     */
    private static native void nativeUiFrame(java.nio.ByteBuffer pixels, int width, int height,
        int stride);

    /** Name the composite path this run took: `in-frame-cpu` or `child-window`. */
    private static native void nativeUiCompositePath(String path);

    /**
     * The published islands, flat as x, y, width, height per region, normalized to the viewport.
     * Written by the message listener and read by touch dispatch, both on the UI thread; the
     * reference is swapped whole so a half-written set can never be hit-tested.
     */
    private volatile float[] regions = new float[0];

    private final Object bridgeLock = new Object();
    private JavaScriptReplyProxy replyProxy;
    private String pendingFrame;
    private boolean ownsGesture;

    /**
     * True when this overlay produces its pixels off-screen for the native composite instead of
     * being a transparent sibling SurfaceFlinger layer. Selected by {@code TN_UI_INFRAME}.
     */
    private boolean inFrame;

    private ImageReader frameReader;
    private VirtualDisplay frameDisplay;
    private Presentation framePresentation;
    private HandlerThread frameThread;
    private Handler frameHandler;
    private long frameCounter;

    private TnUiOverlay(Activity activity) {
        super(activity);
    }

    /**
     * Build the overlay and attach it over the activity's content.
     *
     * Fails closed and by name. A game that asked for the web UI renderer and cannot have it
     * must hear so at launch: degrading to no UI at all looks, from a screenshot, exactly like a
     * game whose HUD code is broken.
     */
    public static TnUiOverlay attach(Activity activity) {
        requireMessageListener();
        TnUiOverlay overlay = new TnUiOverlay(activity);
        nativeUiOverlayAttached(false);
        overlay.configure(activity);
        activity.addContentView(
            overlay,
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        nativeUiCompositePath("child-window");
        return overlay;
    }

    /**
     * Build the overlay as an off-screen producer for the in-frame composite (`TN_UI_INFRAME`).
     *
     * The same WebView and the same bridge, but its pixels are produced into an `ImageReader`
     * surface through a {@code VirtualDisplay}/{@code Presentation} instead of being composited as
     * its own SurfaceFlinger layer, and each produced frame is handed to native. This is the
     * Android counterpart of Linux's off-screen web view, and it is opt-in: the child-window path
     * above is exactly what it was.
     */
    public static TnUiOverlay attachInFrame(Activity activity) {
        requireMessageListener();
        TnUiOverlay overlay = new TnUiOverlay(activity);
        overlay.inFrame = true;
        nativeUiOverlayAttached(false);
        overlay.configure(activity);
        overlay.startProducer(activity);
        return overlay;
    }

    private static void requireMessageListener() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            nativeUiOverlayAttached(false);
            throw new IllegalStateException(
                "TN_UI_OVERLAY_UNSUPPORTED: this device's WebView has no WEB_MESSAGE_LISTENER, so the"
                    + " UI layer has no bridge. Update Android System WebView, or build with"
                    + " ui.renderer = \"native\".");
        }
    }

    /**
     * Put the page on a display whose surface this host owns, and pump its frames to native.
     *
     * Fails closed and by name: an in-frame run that cannot build its surface must not leave the
     * game with a silent black HUD. The reader uses {@code RGBA_8888} with
     * {@code USAGE_GPU_SAMPLED_IMAGE} — the usage the GPU import will need once wgpu-native can
     * import an {@code AHardwareBuffer}; the CPU readback now is the same buffer read back.
     */
    private void startProducer(Activity activity) {
        // The usage-parameter ImageReader and HardwareBuffer import are API 29; on anything older
        // this fails closed and by name rather than silently dropping to the child-window path.
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
            throw new IllegalStateException(
                "TN_UI_INFRAME_UNSUPPORTED: in-frame composition needs API 29 (this device is "
                    + android.os.Build.VERSION.SDK_INT + ").");
        }
        DisplayManager displayManager = (DisplayManager) activity.getSystemService(
            Activity.DISPLAY_SERVICE);
        if (displayManager == null) {
            throw new IllegalStateException("TN_UI_INFRAME_UNSUPPORTED: no DisplayManager.");
        }
        DisplayMetrics metrics = new DisplayMetrics();
        activity.getWindowManager().getDefaultDisplay().getRealMetrics(metrics);
        final int width = metrics.widthPixels;
        final int height = metrics.heightPixels;
        frameThread = new HandlerThread("tn-ui-frame");
        frameThread.start();
        frameHandler = new Handler(frameThread.getLooper());
        frameReader = ImageReader.newInstance(
            width,
            height,
            PixelFormat.RGBA_8888,
            2,
            HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE | HardwareBuffer.USAGE_CPU_READ_OFTEN);
        frameReader.setOnImageAvailableListener(this::onFrameAvailable, frameHandler);
        frameDisplay = displayManager.createVirtualDisplay(
            "tn-ui-inframe", width, height, metrics.densityDpi, frameReader.getSurface(), 0);
        if (frameDisplay == null) {
            throw new IllegalStateException("TN_UI_INFRAME_UNSUPPORTED: no virtual display.");
        }
        framePresentation = new Presentation(activity, frameDisplay.getDisplay());
        framePresentation.setContentView(
            this,
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        framePresentation.show();
        // wgpu-native, the default Android lane, has no external-texture import, so the produced
        // buffer is read back to CPU and uploaded by the existing composite. Report the path by
        // name rather than letting a reader infer it. Cost measured at ~1.1 ms/frame on the Pixel 8.
        nativeUiCompositePath("in-frame-cpu");
    }

    /** Hand each produced frame to native, synchronously; the image can close on return. */
    private void onFrameAvailable(ImageReader reader) {
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) return;
            Image.Plane plane = image.getPlanes()[0];
            java.nio.ByteBuffer pixels = plane.getBuffer();
            pixels.position(0);
            frameCounter += 1;
            if (frameCounter == 1) {
                android.util.Log.i("Mystral", "TN_UI_INFRAME_FIRST_FRAME:{\"width\":" + image.getWidth()
                    + ",\"height\":" + image.getHeight() + ",\"stride\":" + plane.getRowStride() + "}");
            }
            nativeUiFrame(pixels, image.getWidth(), image.getHeight(), plane.getRowStride());
        } catch (Throwable error) {
            android.util.Log.w("Mystral",
                "TN_UI_INFRAME_FRAME:{\"error\":\"" + error.getClass().getSimpleName() + "\"}");
        } finally {
            if (image != null) image.close();
        }
    }

    /** Whether this overlay composites in-frame. The activity routes touches on when it does. */
    public boolean isInFrame() {
        return inFrame;
    }

    /** Release the off-screen producer. Safe on the child-window path and when nothing started. */
    public void releaseProducer() {
        if (!inFrame) return;
        if (framePresentation != null) {
            framePresentation.dismiss();
            framePresentation = null;
        }
        if (frameDisplay != null) {
            frameDisplay.release();
            frameDisplay = null;
        }
        if (frameReader != null) {
            frameReader.close();
            frameReader = null;
        }
        if (frameThread != null) {
            frameThread.quitSafely();
            frameThread = null;
        }
    }

    private void configure(Activity activity) {
        setBackgroundColor(Color.TRANSPARENT);
        // A hardware layer is what lets SurfaceFlinger promote this view to an overlay plane
        // instead of compositing it on the GPU the game is already saturating. In-frame the view
        // is not a layer at all; it draws into the producer's surface, so the layer is left alone.
        if (!inFrame) setLayerType(View.LAYER_TYPE_HARDWARE, null);
        getSettings().setJavaScriptEnabled(true);
        getSettings().setDomStorageEnabled(true);
        // The UI is a local bundle; nothing in it should be able to reach the network.
        getSettings().setAllowFileAccess(false);
        getSettings().setAllowContentAccess(false);
        setHorizontalScrollBarEnabled(false);
        setVerticalScrollBarEnabled(false);

        // `WebViewAssetLoader` serves the APK's assets from an HTTPS-like origin rather than
        // `file://`, so `fetch`, module imports and same-origin rules behave exactly as they do
        // on the web build. That equivalence is the point of the whole PRD.
        // `AssetsPathHandler` strips the prefix it was registered under, so registering "/ui/"
        // alone would serve `assets/index.html` rather than `assets/ui/index.html`. Putting the
        // prefix back keeps everything outside `assets/ui/` — the game bundle, the V8 snapshot,
        // the game's own assets — unreachable from the page.
        final WebViewAssetLoader.AssetsPathHandler assets =
            new WebViewAssetLoader.AssetsPathHandler(activity);
        final WebViewAssetLoader loader =
            new WebViewAssetLoader.Builder()
                .addPathHandler(ASSET_PATH, path -> assets.handle("ui/" + path))
                .build();
        setWebViewClient(
            new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                    return loader.shouldInterceptRequest(request.getUrl());
                }
            });

        Set<String> origins = Collections.singleton(ASSET_ORIGIN);
        WebViewCompat.addWebMessageListener(
            this,
            HOST_OBJECT,
            origins,
            (view, message, sourceOrigin, isMainFrame, proxy) -> {
                String pending;
                synchronized (bridgeLock) {
                    replyProxy = proxy;
                    pending = pendingFrame;
                    pendingFrame = null;
                }
                nativeUiOverlayAttached(true);
                onPageMessage(message);
                if (pending != null) proxy.postMessage(pending);
            });
        loadUrl(ASSET_ORIGIN + ASSET_PATH + "index.html");
    }

    /**
     * Route one frame from the page.
     *
     * Hit regions stop here: the host owns the hit test, and sending them on to the game would
     * add a process hop to the input path for no reader. Everything else is the game's.
     */
    private void onPageMessage(WebMessageCompat message) {
        if (message.getType() != WebMessageCompat.TYPE_STRING) return;
        String frame = message.getData();
        if (frame == null) return;
        if (applyHitRegions(frame)) return;
        nativeUiMessage(frame);
    }

    /** @return true when the frame was a hit-region publication and has been applied. */
    private boolean applyHitRegions(String frame) {
        try {
            JSONObject parsed = new JSONObject(frame);
            if (!HIT_REGIONS_MESSAGE.equals(parsed.optString("type"))) return false;
            JSONArray published = parsed.getJSONArray("regions");
            float[] next = new float[published.length() * 4];
            for (int index = 0; index < published.length(); index += 1) {
                JSONObject region = published.getJSONObject(index);
                next[index * 4] = (float) region.getDouble("x");
                next[index * 4 + 1] = (float) region.getDouble("y");
                next[index * 4 + 2] = (float) region.getDouble("width");
                next[index * 4 + 3] = (float) region.getDouble("height");
            }
            regions = next;
            return true;
        } catch (JSONException error) {
            // Fail closed and loudly. A malformed publication that was quietly ignored would
            // leave the previous snapshot in place, and every later touch would be decided
            // against rectangles that no longer exist.
            throw new IllegalStateException(
                "TN_UI_HIT_REGIONS_MALFORMED: the UI layer published a frame this host cannot read: "
                    + frame,
                error);
        }
    }

    /** Deliver one frame to the page. Called from the runtime through the activity. */
    public void postToPage(String frame) {
        JavaScriptReplyProxy proxy;
        synchronized (bridgeLock) {
            proxy = replyProxy;
            if (proxy == null) {
                // Keep only the newest state while the page is loading. The UI readiness frame
                // causes the game to replay it after the proxy is live.
                pendingFrame = frame;
                return;
            }
        }
        proxy.postMessage(frame);
    }

    /**
     * The hit test, and the only place ownership is decided.
     *
     * Returning false for a pointer-down outside every published rect makes the parent
     * {@link ViewGroup} offer the gesture to the next view down — SDL's surface — and Android
     * then delivers the rest of that gesture there without consulting this view again.
     */
    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
            ownsGesture = hits(event.getX(), event.getY());
            android.util.Log.i("Mystral", "TN_UI_HITTEST:{\"x\":" + event.getX() + ",\"y\":" + event.getY()
                + ",\"w\":" + getWidth() + ",\"h\":" + getHeight() + ",\"regions\":" + (regions.length / 4)
                + ",\"owns\":" + ownsGesture + "}");
            if (!ownsGesture) return false;
        }
        return ownsGesture && super.dispatchTouchEvent(event);
    }

    private boolean hits(float x, float y) {
        int width = getWidth();
        int height = getHeight();
        if (width <= 0 || height <= 0) return false;
        float normalizedX = x / width;
        float normalizedY = y / height;
        float[] snapshot = regions;
        for (int index = 0; index + 3 < snapshot.length; index += 4) {
            if (normalizedX < snapshot[index] || normalizedY < snapshot[index + 1]) continue;
            if (normalizedX > snapshot[index] + snapshot[index + 2]) continue;
            if (normalizedY > snapshot[index + 1] + snapshot[index + 3]) continue;
            return true;
        }
        return false;
    }
}
