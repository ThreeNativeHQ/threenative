/* PRD-393 Phase 1 probe: can WPE WebKit hand an embedder a CPU-readable RGBA frame
 * of a known page, with a completion signal, with no compositor and no X server?
 *
 * Headless WPE Platform display -> WebKitWebView -> WPEView "buffer-rendered" signal
 * -> wpe_buffer_import_to_pixels() (SHM, CPU readable).
 *
 * usage: probe-wpe <seconds>
 *
 * WPE is not installed on this Arch host, so it was provisioned unprivileged from the
 * distribution packages (wpewebkit 2.52.6, libwpe 1.16.3, wpebackend-fdo 1.16.1) extracted
 * into a throwaway prefix. Two things are needed for a prefix build:
 *   - pkg-config --define-prefix so the .pc files resolve against the extraction root;
 *   - the lib hardcodes /usr/lib/wpe-webkit-2.0 for WPEWebProcess. That path is not
 *     writable unprivileged, so the string is patched to a short symlinked prefix path
 *     (the Arch binaries are otherwise used unchanged) and WEBKIT_INJECTED_BUNDLE_PATH
 *     points at the extracted injected bundle.
 *
 *   PREFIX=/tmp/wpe-probe/prefix && ln -sfn "$PREFIX/usr/lib/wpe-webkit-2.0" /tmp/wpe
 *   gcc -O2 -o probe-wpe probe-wpe.c \
 *     $(PKG_CONFIG_PATH=$PREFIX/usr/lib/pkgconfig pkg-config --define-prefix \
 *       --cflags --libs wpe-webkit-2.0 wpe-platform-headless-2.0)
 *   LD_LIBRARY_PATH=$PREFIX/usr/lib \
 *   WEBKIT_INJECTED_BUNDLE_PATH=$PREFIX/usr/lib/wpe-webkit-2.0/injected-bundle \
 *   LIBGL_ALWAYS_SOFTWARE=1 ./probe-wpe 5
 *
 * LIBGL_ALWAYS_SOFTWARE=1 is deliberate: WPEPlatform returns a null DRM device under that
 * flag, which makes the headless display fall back to surfaceless EGL and WebKit emit
 * CPU-mappable WPEBufferSHM frames. Without it the headless display emits DMA-BUF buffers
 * whose CPU readback fails on this host's NVIDIA proprietary driver (gbm_bo_map failed).
 */
#include <wpe/webkit.h>
#include <wpe/headless/wpe-headless.h>

#include <cairo.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Four solid quadrants so a wrong format, blank buffer or wrong page fails loudly. */
static const char *PAGE =
    "<!doctype html><html><head><meta charset=\"utf-8\"><style>"
    "html,body{margin:0;width:1280px;height:720px;overflow:hidden}"
    ".tl{position:absolute;left:0;top:0;width:640px;height:360px;background:#ff0000}"
    ".tr{position:absolute;left:640px;top:0;width:640px;height:360px;background:#00ff00}"
    ".bl{position:absolute;left:0;top:360px;width:640px;height:360px;background:#0000ff}"
    ".br{position:absolute;left:640px;top:360px;width:640px;height:360px;background:#ffff00}"
    "#tick{position:absolute;left:4px;top:4px;width:60px;height:20px;background:#ffffff;color:#000;font:12px monospace}"
    "</style></head><body>"
    "<div class=\"tl\"></div><div class=\"tr\"></div><div class=\"bl\"></div><div class=\"br\"></div>"
    "<div id=\"tick\">0</div><script>let n=0;function f(){document.getElementById('tick').textContent=String(++n);requestAnimationFrame(f)}requestAnimationFrame(f)</script>"
    "</body></html>";

static guint64 frame_count = 0;
static guint64 first_us = 0;
static guint64 last_us = 0;
static int got_frame = 0;
static int buf_w = 0, buf_h = 0, buf_stride = 0, buf_format = -1, buf_is_shm = 0;
static guint8 *copy_pixels = NULL;
static gsize copy_size = 0;

static void on_load_changed(WebKitWebView *wv, WebKitLoadEvent event, gpointer user_data) {
    (void)user_data;
    printf("TN_WPE:{\"load_changed\":%d}\n", (int)event);
    (void)wv;
}

static void on_buffers_changed(WPEView *view, WPEBuffer **buffers, guint n_buffers, gpointer user_data) {
    (void)view; (void)buffers; (void)user_data;
    printf("TN_WPE:{\"buffers_changed\":%u}\n", n_buffers);
}

static void on_buffer_rendered(WPEView *view, WPEBuffer *buffer, gpointer user_data) {
    (void)view;
    (void)user_data;
    GError *error = NULL;
    GBytes *bytes = wpe_buffer_import_to_pixels(buffer, &error);
    if (!bytes) {
        fprintf(stderr, "import_to_pixels failed: %s\n", error ? error->message : "?");
        if (error) g_error_free(error);
        return;
    }
    gsize size = 0;
    const guint8 *data = g_bytes_get_data(bytes, &size);
    int w = wpe_buffer_get_width(buffer);
    int h = wpe_buffer_get_height(buffer);
    int stride = w * 4;
    if (WPE_IS_BUFFER_SHM(buffer)) {
        stride = wpe_buffer_shm_get_stride(WPE_BUFFER_SHM(buffer));
        buf_format = (int)wpe_buffer_shm_get_format(WPE_BUFFER_SHM(buffer));
        buf_is_shm = 1;
    }
    if (!got_frame) {
        buf_w = w; buf_h = h; buf_stride = stride;
        copy_size = (gsize)stride * h;
        copy_pixels = malloc(copy_size);
        if (copy_pixels) memcpy(copy_pixels, data, copy_size < size ? copy_size : size);
        got_frame = 1;
    }
    if (!frame_count) first_us = g_get_monotonic_time();
    last_us = g_get_monotonic_time();
    frame_count++;
    g_bytes_unref(bytes);
    wpe_view_buffer_released(view, buffer);
}

int main(int argc, char **argv) {
    int seconds = argc > 1 ? atoi(argv[1]) : 5;

    fprintf(stderr, "display: creating headless\n");
    WPEDisplay *default_display = wpe_display_get_default();
    printf("TN_WPE:{\"default_display_before\":\"%s\"}\n",
           default_display ? G_OBJECT_TYPE_NAME(default_display) : "null");
    WPEDisplay *display = wpe_display_headless_new();
    if (!display) { fprintf(stderr, "no headless display\n"); return 2; }
    wpe_display_set_primary(display);

    GError *error = NULL;
    if (!wpe_display_connect(display, &error)) {
        fprintf(stderr, "display connect failed: %s\n", error ? error->message : "?");
        return 2;
    }
    /* Which buffer class we are about to be handed, and why. A non-null DRM device means the
     * display will emit DMA-BUF, whose CPU readback is the thing that has to work or not. */
    printf("TN_WPE:{\"libgl_always_software\":%s}\n",
           getenv("LIBGL_ALWAYS_SOFTWARE") ? "true" : "false");

    WebKitWebView *web_view = WEBKIT_WEB_VIEW(g_object_new(WEBKIT_TYPE_WEB_VIEW,
        "display", display, "settings", webkit_settings_new(), NULL));
    if (!web_view) { fprintf(stderr, "no web view\n"); return 2; }
    WPEView *view = webkit_web_view_get_wpe_view(web_view);
    if (!view) { fprintf(stderr, "no wpe view\n"); return 2; }
    WPEDisplay *view_display = wpe_view_get_display(view);
    printf("TN_WPE:{\"view_display\":\"%s\",\"is_same\":%s,\"default_same\":%s,\"primary_same\":%s}\n",
           view_display ? G_OBJECT_TYPE_NAME(view_display) : "null",
           view_display == display ? "true" : "false",
           wpe_display_get_default() == display ? "true" : "false",
           wpe_display_get_primary() == display ? "true" : "false");
    if (view_display != display)
        fprintf(stderr, "note: web view display differs from headless display\n");

    GSignalQuery query;
    guint sig = g_signal_lookup("buffer-rendered", WPE_TYPE_VIEW);
    if (sig) {
        g_signal_query(sig, &query);
        printf("TN_WPE:{\"signal\":\"buffer-rendered\",\"n_params\":%u}\n", query.n_params);
    } else {
        printf("TN_WPE:{\"signal\":\"buffer-rendered\",\"n_params\":-1}\n");
    }
    g_signal_connect(view, "buffer-rendered", G_CALLBACK(on_buffer_rendered), NULL);
    g_signal_connect(view, "buffers-changed", G_CALLBACK(on_buffers_changed), NULL);
    g_signal_connect(web_view, "load-changed", G_CALLBACK(on_load_changed), NULL);

    wpe_view_set_visible(view, TRUE);
    wpe_view_map(view);

    WPEToplevel *toplevel = wpe_view_get_toplevel(view);
    if (toplevel) {
        int tw = 0, th = 0;
        wpe_toplevel_get_size(toplevel, &tw, &th);
        printf("TN_WPE:{\"toplevel_before\":\"%dx%d\"}\n", tw, th);
        gboolean ok = wpe_toplevel_resize(toplevel, 1280, 720);
        wpe_toplevel_get_size(toplevel, &tw, &th);
        printf("TN_WPE:{\"toplevel_resize\":%s,\"toplevel_after\":\"%dx%d\"}\n",
               ok ? "true" : "false", tw, th);
    } else {
        printf("TN_WPE:{\"toplevel_resize\":false,\"detail\":\"no toplevel\"}\n");
    }

    webkit_web_view_load_html(web_view, PAGE, "file:///");

    guint64 deadline = g_get_monotonic_time() + (guint64)seconds * 1000000ULL;
    guint64 diag = g_get_monotonic_time() + 1500000ULL;
    while (g_get_monotonic_time() < deadline) {
        g_main_context_iteration(NULL, FALSE);
        if (g_get_monotonic_time() > diag) {
            printf("TN_WPE:{\"diag\":{\"view_size\":\"%dx%d\",\"mapped\":%s,\"visible\":%s,\"loading\":%s,\"frames\":%llu}}\n",
                   wpe_view_get_width(view), wpe_view_get_height(view),
                   wpe_view_get_mapped(view) ? "true" : "false",
                   wpe_view_get_visible(view) ? "true" : "false",
                   webkit_web_view_is_loading(web_view) ? "true" : "false",
                   (unsigned long long)frame_count);
            diag += 1500000ULL;
        }
        g_usleep(1000);
    }

    if (!got_frame) {
        printf("TN_WPE:{\"frame\":false}\n");
        return 1;
    }

    const guint8 *p = copy_pixels;
    /* ARGB8888 little-endian in memory is B,G,R,A. */
    int xa = 320, ya = 180, xb = 960, yb = 180, xc = 320, yc = 540, xd = 960, yd = 540;
    const guint8 *pa = p + (gsize)ya * buf_stride + xa * 4;
    const guint8 *pb = p + (gsize)yb * buf_stride + xb * 4;
    const guint8 *pc = p + (gsize)yc * buf_stride + xc * 4;
    const guint8 *pd = p + (gsize)yd * buf_stride + xd * 4;
    printf("TN_WPE:{\"frame\":true,\"size\":\"%dx%d\",\"stride\":%d,\"format\":%d,\"shm\":%s,\"bytes_per_frame\":%d}\n",
           buf_w, buf_h, buf_stride, buf_format, buf_is_shm ? "true" : "false", buf_stride * buf_h);
    printf("TN_WPE:{\"tl\":[%u,%u,%u,%u],\"tr\":[%u,%u,%u,%u],\"bl\":[%u,%u,%u,%u],\"br\":[%u,%u,%u,%u]}\n",
           pa[2], pa[1], pa[0], pa[3], pb[2], pb[1], pb[0], pb[3],
           pc[2], pc[1], pc[0], pc[3], pd[2], pd[1], pd[0], pd[3]);
    int tl_ok = pa[2] == 255 && pa[1] == 0 && pa[0] == 0 && pa[3] == 255;
    int tr_ok = pb[2] == 0 && pb[1] == 255 && pb[0] == 0 && pb[3] == 255;
    int bl_ok = pc[2] == 0 && pc[1] == 0 && pc[0] == 255 && pc[3] == 255;
    int br_ok = pd[2] == 255 && pd[1] == 255 && pd[0] == 0 && pd[3] == 255;
    double span = (double)(last_us - first_us) / 1e6;
    printf("TN_WPE:{\"rects_ok\":%s,\"frames\":%llu,\"span_s\":%.2f,\"fps\":%.1f}\n",
           (tl_ok && tr_ok && bl_ok && br_ok) ? "true" : "false",
           (unsigned long long)frame_count, span, span > 0 ? (double)frame_count / span : 0.0);

    /* One PNG of the captured frame for the report. */
    const char *out = getenv("TN_WPE_PNG");
    if (out) {
        /* WPEBufferSHM is ARGB8888 little-endian — B,G,R,A in memory — which is exactly
         * CAIRO_FORMAT_ARGB32 on a little-endian host, so the buffer maps onto a cairo surface
         * without a swizzle and cairo writes the PNG. */
        cairo_surface_t *surface = cairo_image_surface_create_for_data(
            copy_pixels, CAIRO_FORMAT_ARGB32, buf_w, buf_h, buf_stride);
        cairo_status_t status = cairo_surface_status(surface);
        cairo_status_t written = status == CAIRO_STATUS_SUCCESS
                                     ? cairo_surface_write_to_png(surface, out)
                                     : status;
        printf("TN_WPE:{\"png\":\"%s\",\"written\":%s}\n", out,
               written == CAIRO_STATUS_SUCCESS ? "true" : "false");
        cairo_surface_destroy(surface);
    }
    return 0;
}
