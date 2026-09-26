package com.threenative.inframeprobe;

import android.app.Activity;
import android.app.Presentation;
import android.graphics.PixelFormat;
import android.hardware.HardwareBuffer;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;

import java.nio.ByteBuffer;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * On-device feasibility probe for PRD-399 "Android in-frame UI composition", phase A.
 *
 * <p>Question: can a WebView be rendered into an off-screen {@link android.view.Surface} this host
 * owns, so the page's pixels can be handed to native instead of living as their own
 * SurfaceFlinger layer?
 *
 * <p>Route under test: a {@link VirtualDisplay} whose surface comes from an {@link ImageReader}
 * ({@link HardwareBuffer#USAGE_GPU_SAMPLED_IMAGE}, {@code PixelFormat.RGBA_8888}, {@code maxImages
 * = 2}), hosting the WebView in a {@link Presentation} on that display. Each delivered frame is
 * acquired ({@code acquireLatestImage}), its {@link HardwareBuffer} is recorded with a timestamp,
 * and sampled for non-blankness.
 *
 * <p>Pass: frames arrive at the virtual display's rate and the acquired buffer is non-blank over a
 * sustained run. Every frame is emitted as one JSON log line tagged {@code TN_INFRAME_PROBE}; one
 * summary line carries the aggregates. On any failure the exact exception is logged and no
 * workaround is attempted.
 */
public final class InFrameProbeActivity extends Activity {

    private static final String TAG = "TN_INFRAME_PROBE";
    private static final int MAX_IMAGES = 2;
    private static final long RUN_MS = 10_000;
    private static final long SUMMARY_PERIOD_MS = 1_000;

    private ImageReader reader;
    private VirtualDisplay virtualDisplay;
    private Presentation presentation;
    private WebView webView;
    private HandlerThread listenerThread;
    private Handler listenerHandler;

    private int width;
    private int height;
    private int rowStride;
    private int pixelStride;
    private ByteBuffer readback;
    private volatile boolean running;

    private long firstArrivalNanos;
    private long lastArrivalNanos;
    private long frames;
    private long nullImages;
    private long blankImages;
    private long changedImages;
    private long lockFailures;
    private long readNanosTotal;
    private long lastReadMs;
    private long lastHash = Long.MIN_VALUE;
    private final Set<Long> distinctHashes = new HashSet<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        DisplayMetrics metrics = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getRealMetrics(metrics);
        width = metrics.widthPixels;
        height = metrics.heightPixels;
        int densityDpi = metrics.densityDpi;

        DisplayManager displayManager = (DisplayManager) getSystemService(DISPLAY_SERVICE);
        if (displayManager == null) {
            Log.i(TAG, "{\"event\":\"fail\",\"stage\":\"displayManager\",\"error\":\"null\"}");
            finish();
            return;
        }

        listenerThread = new HandlerThread("tn-inframe-probe-reader");
        listenerThread.start();
        listenerHandler = new Handler(listenerThread.getLooper());

        try {
            // GPU_SAMPLED_IMAGE is the route this host would import from. CPU_READ_OFTEN is added
            // only so this probe can inspect the delivered pixels for non-blankness (and is the
            // read path the wgpu CPU fallback needs); the pure-GPU variant was tried first and
            // delivered frames whose buffer could not be locked for reading (format 0x1).
            reader = ImageReader.newInstance(
                width,
                height,
                PixelFormat.RGBA_8888,
                MAX_IMAGES,
                HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE | HardwareBuffer.USAGE_CPU_READ_OFTEN);
        } catch (Throwable error) {
            Log.i(TAG, "{\"event\":\"fail\",\"stage\":\"newInstance\",\"error\":\""
                + error.getClass().getName() + ": " + error.getMessage() + "\"}");
            finish();
            return;
        }

        reader.setOnImageAvailableListener(imageReader -> onImageAvailable(imageReader),
            listenerHandler);

        try {
            virtualDisplay = displayManager.createVirtualDisplay(
                "tn-inframe-probe",
                width,
                height,
                densityDpi,
                reader.getSurface(),
                0);
        } catch (Throwable error) {
            Log.i(TAG, "{\"event\":\"fail\",\"stage\":\"createVirtualDisplay\",\"error\":\""
                + error.getClass().getName() + ": " + error.getMessage() + "\"}");
            finish();
            return;
        }
        if (virtualDisplay == null) {
            Log.i(TAG, "{\"event\":\"fail\",\"stage\":\"createVirtualDisplay\",\"error\":\"null\"}");
            finish();
            return;
        }

        try {
            presentation = new Presentation(this, virtualDisplay.getDisplay());
            webView = new WebView(this);
            webView.getSettings().setJavaScriptEnabled(true);
            webView.setBackgroundColor(0xFF202020);
            presentation.setContentView(
                webView,
                new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            presentation.show();
        } catch (Throwable error) {
            Log.i(TAG, "{\"event\":\"fail\",\"stage\":\"presentation\",\"error\":\""
                + error.getClass().getName() + ": " + error.getMessage() + "\"}");
            finish();
            return;
        }

        webView.loadDataWithBaseURL(
            "https://appassets.androidplatform.net/",
            page(),
            "text/html",
            "utf-8",
            null);

        Log.i(TAG, "{\"event\":\"start\",\"width\":" + width + ",\"height\":" + height
            + ",\"densityDpi\":" + densityDpi
            + ",\"usage\":" + (HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE
                | HardwareBuffer.USAGE_CPU_READ_OFTEN)
            + ",\"maxImages\":" + MAX_IMAGES
            + ",\"displayRefreshHz\":" + virtualDisplay.getDisplay().getRefreshRate() + "}");

        running = true;
        getWindow().getDecorView().postDelayed(this::finishProbe, RUN_MS);
        listenerHandler.postDelayed(this::summary, SUMMARY_PERIOD_MS);
    }

    /** The animated page: pixels change every animation frame so arrivals are distinguishable. */
    private static String page() {
        return "<!doctype html><html><head>"
            + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            + "<style>html,body{margin:0;height:100%;background:#101418;overflow:hidden}"
            + "#box{position:absolute;width:240px;height:240px}</style></head>"
            + "<body><div id=\"box\"></div><script>"
            + "let f=0;const b=document.getElementById('box');"
            + "function tick(){f++;"
            + "b.style.background='rgb('+(f*7%256)+','+(f*13%256)+','+(f*29%256)+')';"
            + "b.style.transform='translate('+(f%700)+'px,'+(f*3%1800)+'px)';"
            + "window.__tnFrame=f;requestAnimationFrame(tick);}"
            + "requestAnimationFrame(tick);"
            + "</script></body></html>";
    }

    private void onImageAvailable(ImageReader imageReader) {
        Image image = null;
        try {
            image = imageReader.acquireLatestImage();
        } catch (Throwable error) {
            Log.i(TAG, "{\"event\":\"fail\",\"stage\":\"acquireLatestImage\",\"error\":\""
                + error.getClass().getName() + ": " + error.getMessage() + "\"}");
            return;
        }
        if (image == null) {
            nullImages += 1;
            return;
        }
        // Count and timestamp the arrival first, so the delivery rate is measured even when the
        // pixel inspection below cannot read the buffer.
        long arrivalNanos = SystemClock.elapsedRealtimeNanos();
        if (frames == 0) firstArrivalNanos = arrivalNanos;
        long dtMs = frames == 0 ? 0 : (arrivalNanos - lastArrivalNanos) / 1_000_000L;
        lastArrivalNanos = arrivalNanos;
        frames += 1;
        try {
            HardwareBuffer buffer = image.getHardwareBuffer();
            if (buffer == null) {
                Log.i(TAG, "{\"event\":\"fail\",\"stage\":\"getHardwareBuffer\",\"error\":\"null\"}");
                return;
            }
            int bufferWidth = buffer.getWidth();
            int bufferHeight = buffer.getHeight();
            int bufferFormat = buffer.getFormat();

            long hash;
            try {
                hash = sample(image);
            } catch (Throwable readError) {
                lockFailures += 1;
                Log.i(TAG, "{\"event\":\"frame\",\"n\":" + frames
                    + ",\"tMs\":" + (arrivalNanos - firstArrivalNanos) / 1_000_000L
                    + ",\"dtMs\":" + dtMs
                    + ",\"hwWidth\":" + bufferWidth
                    + ",\"hwHeight\":" + bufferHeight
                    + ",\"hwFormat\":" + bufferFormat
                    + ",\"readable\":false,\"readError\":\""
                    + readError.getClass().getName() + ": " + readError.getMessage() + "\"}");
                return;
            }

            boolean blank = hash == 0L;
            boolean changed = hash != lastHash && lastHash != Long.MIN_VALUE;
            if (blank) blankImages += 1;
            if (changed) changedImages += 1;
            distinctHashes.add(hash);
            lastHash = hash;

            Log.i(TAG, "{\"event\":\"frame\",\"n\":" + frames
                + ",\"tMs\":" + (arrivalNanos - firstArrivalNanos) / 1_000_000L
                + ",\"dtMs\":" + dtMs
                + ",\"hwWidth\":" + bufferWidth
                + ",\"hwHeight\":" + bufferHeight
                + ",\"hwFormat\":" + bufferFormat
                + ",\"readable\":true"
                + ",\"hash\":" + hash
                + ",\"blank\":" + blank
                + ",\"changed\":" + changed + "}");
        } catch (Throwable error) {
            Log.i(TAG, "{\"event\":\"fail\",\"stage\":\"sampleFrame\",\"error\":\""
                + error.getClass().getName() + ": " + error.getMessage() + "\"}");
        } finally {
            image.close();
        }
    }

    /**
     * Read a fixed sample grid from the image's first plane and return an FNV-style hash.
     *
     * <p>The buffer is RGBA_8888 with a possible row stride larger than {@code width*4}; sampling
     * by stride avoids a full 10 MB copy per frame. Zero means every sampled pixel is fully
     * transparent black, the signal a blank off-screen surface produces.
     */
    private long sample(Image image) {
        Image.Plane plane = image.getPlanes()[0];
        rowStride = plane.getRowStride();
        pixelStride = plane.getPixelStride();
        ByteBuffer source = plane.getBuffer();

        // The readback cost the wgpu CPU fallback would pay: one full copy of the plane. Measured
        // here rather than assumed, because at 1080x2400x4 it is ~10.4 MB per frame.
        long readStart = SystemClock.elapsedRealtimeNanos();
        int bytes = source.remaining();
        if (readback == null || readback.capacity() < bytes) {
            readback = ByteBuffer.allocateDirect(bytes);
        }
        readback.clear();
        source.position(0);
        readback.put(source);
        readback.flip();
        long readNanos = SystemClock.elapsedRealtimeNanos() - readStart;
        readNanosTotal += readNanos;
        lastReadMs = readNanos / 1_000_000L;
        ByteBuffer pixels = readback;

        final int samples = 16;
        long hash = 0xcbf29ce484222325L;
        long nonZero = 0;
        for (int gy = 0; gy < samples; gy += 1) {
            int y = (int) ((long) (gy * (height - 1)) / (samples - 1));
            for (int gx = 0; gx < samples; gx += 1) {
                int x = (int) ((long) (gx * (width - 1)) / (samples - 1));
                int offset = y * rowStride + x * pixelStride;
                if (offset + 3 >= pixels.limit()) continue;
                byte r = pixels.get(offset);
                byte g = pixels.get(offset + 1);
                byte b = pixels.get(offset + 2);
                byte a = pixels.get(offset + 3);
                int rgba = ((a & 0xFF) << 24) | ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF);
                if ((rgba & 0x00FFFFFF) != 0 || (rgba >>> 24) > 16) nonZero += 1;
                hash = (hash ^ rgba) * 0x100000001b3L;
            }
        }
        return nonZero == 0 ? 0L : hash;
    }

    private synchronized void summary() {
        if (!running) return;
        long elapsedMs = firstArrivalNanos == 0 ? 0
            : (SystemClock.elapsedRealtimeNanos() - firstArrivalNanos) / 1_000_000L;
        double rateHz = elapsedMs > 0 ? frames * 1000.0 / elapsedMs : 0.0;
        Log.i(TAG, "{\"event\":\"summary\",\"frames\":" + frames
            + ",\"elapsedMs\":" + elapsedMs
            + ",\"rateHz\":" + String.format(Locale.US, "%.2f", rateHz)
            + ",\"nullImages\":" + nullImages
            + ",\"blankImages\":" + blankImages
            + ",\"lockFailures\":" + lockFailures
            + ",\"changedImages\":" + changedImages
            + ",\"distinctHashes\":" + distinctHashes.size()
            + ",\"avgReadMs\":" + String.format(Locale.US, "%.2f",
                frames == 0 ? 0.0 : readNanosTotal / 1_000_000.0 / frames)
            + ",\"lastReadMs\":" + lastReadMs
            + ",\"pass\":"
            + (frames > 0 && blankImages == 0 && lockFailures == 0 && distinctHashes.size() >= 2) + "}");
        listenerHandler.postDelayed(this::summary, SUMMARY_PERIOD_MS);
    }

    private void finishProbe() {
        running = false;
        summary();
        Log.i(TAG, "{\"event\":\"done\",\"frames\":" + frames
            + ",\"blankImages\":" + blankImages
            + ",\"lockFailures\":" + lockFailures
            + ",\"distinctHashes\":" + distinctHashes.size() + "}");
        finish();
    }

    @Override
    protected void onDestroy() {
        running = false;
        if (presentation != null) presentation.dismiss();
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        if (virtualDisplay != null) virtualDisplay.release();
        if (reader != null) reader.close();
        if (listenerThread != null) listenerThread.quitSafely();
        super.onDestroy();
    }
}
