//! PRD-217 Phase 3A — does a `wry` child web view survive contact with the real SDL/WebGPU window?
//!
//! Run against a window SDL already owns:
//!
//! ```sh
//! cargo run --release --bin tn-ui-overlay-probe -- <x11-window-id> [seconds]
//! ```
//!
//! It answers open question 1 one row at a time and prints each answer as a `TN_SPIKE:` line, so
//! a failure names which property failed instead of "it did not work".

use std::env;
use std::ffi::c_ulong;
use std::time::{Duration, Instant};

use raw_window_handle::{
    HandleError, HasWindowHandle, RawWindowHandle, WindowHandle, XlibWindowHandle,
};
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::{Rect, WebViewBuilder};

/// The parent SDL window, as the only thing `wry` needs to know about it.
struct SdlWindow(c_ulong);

impl HasWindowHandle for SdlWindow {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let mut handle = XlibWindowHandle::new(self.0);
        handle.visual_id = 0;
        // Safety: the window id came from the running SDL process on this display and outlives
        // the probe, which is exactly the lifetime a host would guarantee.
        Ok(unsafe { WindowHandle::borrow_raw(RawWindowHandle::Xlib(handle)) })
    }
}

/// A HUD-shaped page: absolute positioning, a translucent rounded plate, a proportional font, an
/// SVG stroke, and one control marked the way `@threenative/core/ui-layer` asks games to mark
/// theirs. Everything here is something the quad renderer cannot draw.
const PAGE: &str = r##"<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;font:16px/1.3 system-ui,sans-serif;color:#e8eef7;overflow:hidden}
.plate{position:absolute;left:4%;top:6%;width:34%;padding:12px 14px;border-radius:12px;background:rgba(12,20,34,.55)}
.plate b{font-size:28px;font-variant-numeric:tabular-nums}
button{position:absolute;left:75%;top:40%;width:20%;height:20%;border:0;border-radius:14px;background:#7fffd4;color:#06202b;font:inherit;font-weight:700}
</style></head><body>
<div class="plate"><div>UI LAYER</div><b id="n">0</b>
<svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="none" stroke="#7fffd4" stroke-width="3"/></svg></div>
<button id="tap" data-tn-interactive type="button">TAP</button>
<script>
let n=0;setInterval(()=>{document.getElementById('n').textContent=String(++n)},100);
document.getElementById('tap').addEventListener('click',()=>window.ipc.postMessage('{"type":"tn:intent","intent":"tap"}'));
const rects=[...document.querySelectorAll('[data-tn-interactive]')].map(e=>{const r=e.getBoundingClientRect();
  return {x:r.left/innerWidth,y:r.top/innerHeight,width:r.width/innerWidth,height:r.height/innerHeight}});
window.ipc.postMessage(JSON.stringify({type:'tn:hit-regions',regions:rects}));
window.ipc.postMessage(JSON.stringify({type:'tn:ready'}));
</script></body></html>"##;

fn report(row: &str, ok: bool, detail: &str) {
    println!(
        "TN_SPIKE:{{\"row\":\"{row}\",\"ok\":{ok},\"detail\":\"{}\"}}",
        detail.replace('"', "'")
    );
}

/**
 * The row that decides Linux, and the one a screenshot alone leaves arguable.
 *
 * `wry`'s webkitgtk backend attaches by creating an X11 child of the parent with
 * `XCreateSimpleWindow(display, parent, x, y, w, h, 0, 0, 0)` — no ARGB visual, background pixel
 * zero. A 24-bit child has no alpha channel to be transparent with, so `with_transparent(true)`
 * reaches the page (the document background is transparent) and stops at the window: the child
 * paints opaque black over the game surface. Reading the depth back says so without asking anyone
 * to interpret a capture.
 */
fn report_child_visual(parent: c_ulong) {
    use x11_dl::xlib;
    let Ok(lib) = xlib::Xlib::open() else {
        report("transparency-visual", false, "could not open xlib to inspect the child window");
        return;
    };
    unsafe {
        let display = (lib.XOpenDisplay)(std::ptr::null());
        if display.is_null() {
            report("transparency-visual", false, "no X display");
            return;
        }
        let mut root = 0;
        let mut child_parent = 0;
        let mut children: *mut c_ulong = std::ptr::null_mut();
        let mut count = 0;
        if (lib.XQueryTree)(display, parent, &mut root, &mut child_parent, &mut children, &mut count) == 0
            || count == 0
        {
            report("transparency-visual", false, "the parent window reported no children");
            (lib.XCloseDisplay)(display);
            return;
        }
        let child = *children.add((count - 1) as usize);
        let mut attributes: xlib::XWindowAttributes = std::mem::zeroed();
        (lib.XGetWindowAttributes)(display, child, &mut attributes);
        let depth = attributes.depth;
        report(
            "transparency-visual",
            depth == 32,
            &format!("the web view's X11 child window has depth {depth}; 32 is needed for alpha"),
        );
        (lib.XFree)(children as *mut _);
        (lib.XCloseDisplay)(display);
    }
}

fn main() {
    let mut args = env::args().skip(1);
    let Some(parent) = args.next().and_then(|value| value.parse::<c_ulong>().ok()) else {
        eprintln!("usage: tn-ui-overlay-probe <x11-window-id> [seconds]");
        std::process::exit(2);
    };
    let seconds: u64 = args.next().and_then(|v| v.parse().ok()).unwrap_or(10);

    if let Err(error) = gtk::init() {
        report("gtk-init", false, &error.to_string());
        std::process::exit(1);
    }
    report("gtk-init", true, "webkitgtk needs a GTK main context on this thread");

    let window = SdlWindow(parent);
    let messages = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let sink = messages.clone();

    let built = WebViewBuilder::new()
        .with_transparent(true)
        .with_bounds(Rect {
            position: LogicalPosition::new(0, 0).into(),
            size: LogicalSize::new(1280, 720).into(),
        })
        .with_html(PAGE)
        .with_ipc_handler(move |request| {
            sink.lock().expect("ipc sink").push(request.body().to_string());
        })
        .build_as_child(&window);

    let webview = match built {
        Ok(webview) => {
            report("attach-as-child", true, "wry built a child web view on the SDL window");
            webview
        }
        Err(error) => {
            // The expected failure on Wayland: wry's Linux backend accepts an Xlib handle only.
            report("attach-as-child", false, &error.to_string());
            std::process::exit(1);
        }
    };

    // Resize once, the way a host would on an SDL resize event.
    let resized = webview.set_bounds(Rect {
        position: LogicalPosition::new(0, 0).into(),
        size: LogicalSize::new(1280, 700).into(),
    });
    report("resize", resized.is_ok(), &format!("{resized:?}"));

    // Host -> page, the other half of the bridge.
    let evaluated = webview.evaluate_script("window.__tnUiReceive && 0");
    report("host-to-page", evaluated.is_ok(), &format!("{evaluated:?}"));

    report_child_visual(parent);

    let deadline = Instant::now() + Duration::from_secs(seconds);
    let mut ready = false;
    let mut regions = 0usize;
    while Instant::now() < deadline {
        while gtk::events_pending() {
            gtk::main_iteration_do(false);
        }
        {
            let mut queue = messages.lock().expect("ipc sink");
            for frame in queue.drain(..) {
                if frame.contains("tn:ready") {
                    ready = true;
                }
                if frame.contains("tn:hit-regions") {
                    regions = frame.matches("\"x\":").count();
                }
            }
        }
        std::thread::sleep(Duration::from_millis(8));
    }

    report("page-to-host", ready, "the page reached the host over wry's IPC handler");
    report(
        "hit-regions",
        regions == 1,
        &format!("published interactive rects: {regions}"),
    );
    println!("TN_SPIKE_DONE");
}
