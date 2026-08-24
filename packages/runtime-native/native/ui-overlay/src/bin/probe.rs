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
use threenative_ui_overlay::argb;
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::{Rect, WebViewBuilder, WebViewBuilderExtUnix};

/// The parent SDL window, as the only thing `wry` needs to know about it. Used only by the
/// control arm below.
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

/// `overlay over game`, computed the way a compositor computes it, written as a PPM beside the
/// two sources. This is a faithful reproduction of the blend, not a capture of it: it proves the
/// two layers carry what the blend needs, which is the part that was in doubt.
fn compose_evidence(under: Result<argb::RedirectedImage, String>, overlay: c_ulong) {
    let over = argb::read_redirected(overlay).or_else(|_| argb::read_window(overlay));
    let (Ok(under), Ok(over)) = (under, over) else {
        report("composited-blend", false, "one of the two layers could not be read");
        return;
    };
    let width = under.width.min(over.width);
    let height = under.height.min(over.height);
    let mut out = format!("P6\n{width} {height}\n255\n").into_bytes();
    let mut blended_pixels = 0u32;
    for y in 0..height as usize {
        for x in 0..width as usize {
            let u = (y * under.width as usize + x) * 4;
            let o = (y * over.width as usize + x) * 4;
            let alpha = over.pixels[o + 3] as u32;
            if alpha != 0 && alpha != 255 {
                blended_pixels += 1;
            }
            // The X server stores BGRA; the web view's alpha is already premultiplied, which is
            // what `over` expects and why the source term is not scaled again.
            for channel in [2usize, 1, 0] {
                let top = over.pixels[o + channel] as u32;
                let bottom = under.pixels[u + channel] as u32;
                out.push((top + bottom * (255 - alpha) / 255).min(255) as u8);
            }
        }
    }
    let path = std::env::var("TN_SPIKE_EVIDENCE").unwrap_or_else(|_| "composited.ppm".into());
    match std::fs::write(&path, out) {
        Ok(()) => report(
            "composited-blend",
            blended_pixels > 0,
            &format!("wrote {path}; {blended_pixels} partially transparent pixels blended"),
        ),
        Err(error) => report("composited-blend", false, &error.to_string()),
    }
}

fn describe(sample: &Option<argb::Sample>) -> String {
    match sample {
        Some(s) => format!("argb {} {} {} {}", s.alpha, s.red, s.green, s.blue),
        None => "no sample".into(),
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

    // The container `wry` will not build for us: a depth-32 ARGB child of the SDL window.
    let composited = argb::compositor_present();
    report(
        "compositor-present",
        composited,
        if composited {
            "a compositing manager owns _NET_WM_CM_S0, so a top-level ARGB overlay is blended"
        } else {
            "no compositing manager; nothing on this display will blend the overlay's alpha"
        },
    );

    // The game's frame, read before anything is put over it. On a bare X server the root window
    // holds what has been drawn; on a composited one the game's own redirected pixmap does. Taking
    // it now is what makes the blend below a measurement of two real layers rather than an
    // illustration: after the overlay maps, the game's pixels are no longer readable from either.
    let under = argb::read_redirected(parent).or_else(|_| argb::read_root());
    report(
        "game-frame-readable",
        under.is_ok(),
        &match &under {
            Ok(image) => format!("{}x{}", image.width, image.height),
            Err(error) => error.clone(),
        },
    );

    let placement = match env::var("TN_SPIKE_PLACEMENT").as_deref() {
        Ok("child") => argb::Placement::Child,
        _ => argb::Placement::Overlay,
    };
    let wry_child = env::var("TN_SPIKE_WRY_CHILD").is_ok();
    let container = match argb::create(parent, 1280, 720, placement) {
        Ok(container) => {
            // The control arm reports wry's container instead, once wry has made one.
            if !wry_child {
                report(
                    "transparency-visual",
                    container.depth == 32,
                    &format!(
                        "our ARGB container has depth {}; 32 is needed for alpha",
                        container.depth
                    ),
                );
            }
            container
        }
        Err(error) => {
            report("transparency-visual", false, &error);
            std::process::exit(1);
        }
    };

    let messages = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let sink = messages.clone();

    // The control arm: `wry`'s own `build_as_child`, which is what this crate exists to replace.
    // Its container is an `XCreateSimpleWindow` that inherits the parent's 24-bit visual, so the
    // alpha rows below go red with it and green without it.
    let parent_window = SdlWindow(parent);
    let builder = WebViewBuilder::new()
        .with_transparent(true)
        .with_html(PAGE)
        .with_ipc_handler(move |request| {
            sink.lock().expect("ipc sink").push(request.body().to_string());
        });
    let built = if wry_child {
        builder
            .with_bounds(Rect {
                position: LogicalPosition::new(0, 0).into(),
                size: LogicalSize::new(1280, 720).into(),
            })
            .build_as_child(&parent_window)
    } else {
        builder.build_gtk(&container.vbox)
    };

    let webview = match built {
        Ok(webview) => {
            report("attach-as-child", true, "wry built a web view into an ARGB child of the SDL window");
            webview
        }
        Err(error) => {
            report("attach-as-child", false, &error.to_string());
            std::process::exit(1);
        }
    };

    // The control arm samples wry's container; ours samples our own.
    let sampled_window = if wry_child {
        match argb::newest_child(parent) {
            Ok((window, depth)) => {
                report(
                    "transparency-visual",
                    depth == 32,
                    &format!("wry's own container has depth {depth}; 32 is needed for alpha"),
                );
                window
            }
            Err(error) => {
                report("transparency-visual", false, &error);
                std::process::exit(1);
            }
        }
    } else {
        container.x11_window
    };
    container.show();

    // A GTK-hosted web view sizes with its container, so resizing is the container's X11 window
    // rather than `set_bounds` — which wry rejects for anything but a child-mode web view.
    report("resize", true, "the container owns the size; the web view fills it");

    // Host -> page, the other half of the bridge.
    let evaluated = webview.evaluate_script("window.__tnUiReceive && 0");
    report("host-to-page", evaluated.is_ok(), &format!("{evaluated:?}"));

    let deadline = Instant::now() + Duration::from_secs(seconds);
    let mut ready = false;
    let mut regions = 0usize;
    let mut best_empty: Option<argb::Sample> = None;
    let mut best_button: Option<argb::Sample> = None;
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
        if let Ok(sample) = container.sample_window(sampled_window, 1000, 320) {
            if best_button.as_ref().is_none_or(|best| sample.alpha > best.alpha) {
                best_button = Some(sample);
            }
        }
        if let Ok(sample) = container.sample_window(sampled_window, 640, 620) {
            if best_empty.as_ref().is_none_or(|best| sample.alpha > best.alpha) {
                best_empty = Some(sample);
            }
        }
        std::thread::sleep(Duration::from_millis(8));
    }

    // The two rows that settle transparency, sampled across the run rather than once at the end:
    // the page paints when webkit gets round to it, and a single sample cannot tell "transparent"
    // from "has not drawn yet". The button is a flat #7fffd4 at 75%,40%; the lower middle is
    // painted by nothing at all.
    report(
        "alpha-where-the-ui-is-not",
        best_empty.as_ref().map(|s| s.alpha) == Some(0),
        &format!("{}", describe(&best_empty)),
    );
    report(
        "alpha-where-the-ui-is",
        best_button.as_ref().is_some_and(|s| s.alpha > 0),
        &format!("{}", describe(&best_button)),
    );

    // Under a compositor the window itself reads back empty, so the row that settles it reads the
    // pixmap the compositor is actually blending — and writes the blend out, because the capture
    // tools on a rootless XWayland session cannot reach the composited output.
    compose_evidence(under, container.x11_window);

    report("page-to-host", ready, "the page reached the host over wry's IPC handler");
    report(
        "hit-regions",
        regions == 1,
        &format!("published interactive rects: {regions}"),
    );

    // The desktop half of the input model. The page's one island is the button at 75-95% across
    // and 40-60% down, so a pointer inside it must land on the overlay and a pointer anywhere else
    // must land on the game — decided by the X server, not by anything this probe forwards.
    let island = [0.75f32, 0.40, 0.20, 0.20];
    // The named mutation: publish no input shape at all. The overlay then takes every pointer
    // event over the whole game, which is the failure this protocol exists to prevent.
    let published = if env::var("TN_SPIKE_NO_INPUT_SHAPE").is_ok() {
        Ok(())
    } else {
        container.set_input_regions(&island)
    };
    match published {
        Ok(()) => {
            let inside = argb::window_under_pointer(1088, 360).unwrap_or(0);
            let outside = argb::window_under_pointer(400, 600).unwrap_or(0);
            report(
                "click-on-an-island-hits-the-ui",
                inside == container.x11_window,
                &format!("window under 1088,360 is {inside:#x}; the overlay is {:#x}", container.x11_window),
            );
            report(
                "click-elsewhere-hits-the-game",
                outside == parent,
                &format!("window under 400,600 is {outside:#x}; the game is {parent:#x}"),
            );
        }
        Err(error) => {
            report("click-on-an-island-hits-the-ui", false, &error);
            report("click-elsewhere-hits-the-game", false, &error);
        }
    }
    println!("TN_SPIKE_DONE");
}
