/* PRD-393 Phase 1 probe: webkit2gtk (already installed) offscreen, CPU-readable RGBA frame
 * of a known page, with a completion signal, on a display with no compositing manager.
 *
 * GtkOffscreenWindow + WebKitWebView + webkit_web_view_get_snapshot (async completion) ->
 * cairo ARGB32 surface read back on the CPU.
 *
 * usage: probe-gtk-offscreen <seconds>
 *
 *   gcc -O2 -o probe-gtk-offscreen probe-gtk-offscreen.c \
 *     $(pkg-config --cflags --libs webkit2gtk-4.1 gtk+-3.0)
 *   sh scripts/xvfb.sh env LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 \
 *     ./probe-gtk-offscreen 6
 *
 * Runs under a private Xvfb with no compositing manager. WEBKIT_DISABLE_COMPOSITING_MODE=1
 * is required because GDK cannot create a GL context on a bare Xvfb ("The current backend
 * does not support OpenGL"), so this measures WebKit's software/cairo offscreen path.
 */
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static const char *PAGE =
    "<!doctype html><html><head><meta charset=\"utf-8\"><style>"
    "html,body{margin:0;width:1280px;height:720px;overflow:hidden}"
    ".tl{position:absolute;left:0;top:0;width:640px;height:360px;background:#ff0000}"
    ".tr{position:absolute;left:640px;top:0;width:640px;height:360px;background:#00ff00}"
    ".bl{position:absolute;left:0;top:360px;width:640px;height:360px;background:#0000ff}"
    ".br{position:absolute;left:640px;top:360px;width:640px;height:360px;background:#ffff00}"
    "#tick{position:absolute;left:4px;top:4px;width:60px;height:20px;background:#fff;color:#000;font:12px monospace}"
    "</style></head><body>"
    "<div class=\"tl\"></div><div class=\"tr\"></div><div class=\"bl\"></div><div class=\"br\"></div>"
    "<div id=\"tick\" style=\"position:absolute;left:4px;top:4px;width:60px;height:20px;background:#fff;color:#000;font:12px monospace\">0</div><div id=\"anim\" style=\"position:absolute;left:300px;top:300px;width:40px;height:40px;background:#010000\"></div><script>let n=0;function f(){{document.getElementById('tick').textContent=String(++n);const c=n%256;document.getElementById('anim').style.background='rgb('+c+',0,0)'};requestAnimationFrame(f)}requestAnimationFrame(f)</script>"
    "</body></html>";

static WebKitWebView *g_view;
static guint64 g_frames = 0;
static guint64 g_first_us = 0, g_last_us = 0;
static int g_got = 0;
static int g_w = 0, g_h = 0, g_stride = 0;
static guint8 *g_copy = NULL;
static gsize g_copy_size = 0;
static guint8 g_last_anim = 255; static int g_distinct = 0;
static guint64 g_deadline_us = 0;
static int g_seconds = 5;
static GMainLoop *g_loop;

static gboolean check_deadline(gpointer user_data) {
    (void)user_data;
    if (g_deadline_us && g_get_monotonic_time() >= g_deadline_us) {
        g_main_loop_quit(g_loop);
        return G_SOURCE_REMOVE;
    }
    return G_SOURCE_CONTINUE;
}

static void snapshot_next(void);

static void snapshot_done(GObject *source, GAsyncResult *result, gpointer user_data) {
    (void)user_data;
    GError *error = NULL;
    cairo_surface_t *surface = webkit_web_view_get_snapshot_finish(WEBKIT_WEB_VIEW(source), result, &error);
    if (!surface) {
        fprintf(stderr, "snapshot failed: %s\n", error ? error->message : "?");
        if (error) g_error_free(error);
        return;
    }
    int w = cairo_image_surface_get_width(surface);
    int h = cairo_image_surface_get_height(surface);
    int stride = cairo_image_surface_get_stride(surface);
    cairo_surface_flush(surface);
    const guint8 *data = cairo_image_surface_get_data(surface);
    if (data) {
        if (!g_got) {
            g_w = w; g_h = h; g_stride = stride;
            g_copy_size = (gsize)stride * h;
            g_copy = malloc(g_copy_size);
            if (g_copy) memcpy(g_copy, data, g_copy_size);
            g_got = 1;
        }
        {
            const guint8 *q = data + (gsize)320 * stride + 320 * 4;
            if (q[2] != g_last_anim) { g_last_anim = q[2]; g_distinct++; }
        }
        if (!g_frames) g_first_us = g_get_monotonic_time();
        g_last_us = g_get_monotonic_time();
        g_frames++;
    }
    cairo_surface_destroy(surface);
    if (g_get_monotonic_time() < g_deadline_us)
        snapshot_next();
}

static void snapshot_next(void) {
    gtk_widget_queue_draw(GTK_WIDGET(g_view));
    webkit_web_view_get_snapshot(g_view, WEBKIT_SNAPSHOT_REGION_VISIBLE,
                             WEBKIT_SNAPSHOT_OPTIONS_NONE, NULL, snapshot_done, NULL);
}

static void load_changed(WebKitWebView *view, WebKitLoadEvent event, gpointer user_data) {
    (void)user_data;
    printf("TN_GTK:{\"load_changed\":%d}\n", (int)event);
    if (event == WEBKIT_LOAD_FINISHED) {
        g_deadline_us = g_get_monotonic_time() + (guint64)g_seconds * 1000000ULL;
        snapshot_next();
    }
    (void)view;
}

int main(int argc, char **argv) {
    g_seconds = argc > 1 ? atoi(argv[1]) : 5;
    gtk_init(&argc, &argv);

    GtkWidget *offscreen = gtk_offscreen_window_new();
    gtk_widget_set_size_request(offscreen, 1280, 720);
    g_view = WEBKIT_WEB_VIEW(webkit_web_view_new());
    gtk_widget_set_size_request(GTK_WIDGET(g_view), 1280, 720);
    gtk_container_add(GTK_CONTAINER(offscreen), GTK_WIDGET(g_view));
    gtk_widget_show_all(offscreen);

    printf("TN_GTK:{\"webkit\":\"%u.%u.%u\"}\n", webkit_get_major_version(),
           webkit_get_minor_version(), webkit_get_micro_version());

    g_signal_connect(g_view, "load-changed", G_CALLBACK(load_changed), NULL);
    webkit_web_view_load_html(g_view, PAGE, "file:///");

    g_loop = g_main_loop_new(NULL, FALSE);
    g_timeout_add(50, check_deadline, NULL);
    g_main_loop_run(g_loop);

    if (!g_got) {
        printf("TN_GTK:{\"frame\":false}\n");
        return 1;
    }
    /* CAIRO_FORMAT_ARGB32 little-endian: B,G,R,A. */
    fprintf(stderr, "distinct_anim_frames=%d\n", g_distinct);
    const guint8 *p = g_copy;
    const guint8 *pa = p + (gsize)180 * g_stride + 320 * 4;
    const guint8 *pb = p + (gsize)180 * g_stride + 960 * 4;
    const guint8 *pc = p + (gsize)540 * g_stride + 320 * 4;
    const guint8 *pd = p + (gsize)540 * g_stride + 960 * 4;
    printf("TN_GTK:{\"frame\":true,\"size\":\"%dx%d\",\"stride\":%d,\"bytes_per_frame\":%d}\n",
           g_w, g_h, g_stride, g_stride * g_h);
    printf("TN_GTK:{\"tl\":[%u,%u,%u,%u],\"tr\":[%u,%u,%u,%u],\"bl\":[%u,%u,%u,%u],\"br\":[%u,%u,%u,%u]}\n",
           pa[2], pa[1], pa[0], pa[3], pb[2], pb[1], pb[0], pb[3],
           pc[2], pc[1], pc[0], pc[3], pd[2], pd[1], pd[0], pd[3]);
    int ok = pa[2] == 255 && pa[1] == 0 && pa[0] == 0 &&
             pb[2] == 0 && pb[1] == 255 && pb[0] == 0 &&
             pc[2] == 0 && pc[1] == 0 && pc[0] == 255 &&
             pd[2] == 255 && pd[1] == 255 && pd[0] == 0;
    double span = (double)(g_last_us - g_first_us) / 1e6;
    printf("TN_GTK:{\"rects_ok\":%s,\"frames\":%llu,\"span_s\":%.2f,\"fps\":%.1f}\n",
           ok ? "true" : "false", (unsigned long long)g_frames, span,
           span > 0 ? (double)g_frames / span : 0.0);
    return 0;
}
