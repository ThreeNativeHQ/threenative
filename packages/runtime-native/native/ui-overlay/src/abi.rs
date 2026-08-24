//! The C ABI the C++ host calls.
//!
//! Deliberately small and string-shaped: everything that crosses is one JSON frame, exactly as it
//! is on Android, so the desktop host and the Android host implement the same contract in
//! `@threenative/core/ui-layer` rather than two dialects of it.
//!
//! Threading: every one of these must be called from the thread that owns the game loop. GTK and
//! WebKitGTK are not thread-safe, and `pump` is what gives them their turn — the runtime already
//! has a per-frame drain for exactly this shape of work.

use std::cell::RefCell;
use std::ffi::{c_char, c_int, c_ulong, CStr, CString};
use std::sync::{Arc, Mutex};

use wry::{WebView, WebViewBuilder, WebViewBuilderExtUnix};

use crate::argb::{self, ArgbContainer, Placement};

struct Overlay {
    webview: WebView,
    container: ArgbContainer,
    inbound: Arc<Mutex<Vec<String>>>,
}

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
}

/// Attach a transparent web view over `parent`, loading `url`.
///
/// Returns 0 on success and a negative code otherwise, each one a distinct reason so the host can
/// say which: -1 no display or no GTK, -2 no compositor to blend the alpha, -3 the container could
/// not be created, -4 `wry` refused, -5 a bad argument. Failing loudly matters here — a game that
/// asked for this renderer and silently got a black rectangle over its scene is the worst outcome.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_attach(
    parent: c_ulong,
    url: *const c_char,
    width: u32,
    height: u32,
) -> c_int {
    if url.is_null() {
        return -5;
    }
    let Ok(url) = (unsafe { CStr::from_ptr(url) }).to_str() else {
        return -5;
    };
    if gtk::init().is_err() {
        return -1;
    }
    // On X11 a child window occludes its parent rather than blending with it, so the overlay is a
    // top-level ARGB window and only a compositor blends it. Refusing here is the honest failure.
    if !argb::compositor_present() {
        return -2;
    }
    let Ok(container) = argb::create(parent, width, height, Placement::Overlay) else {
        return -3;
    };
    let inbound = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = inbound.clone();
    let built = WebViewBuilder::new()
        .with_transparent(true)
        .with_url(url)
        .with_ipc_handler(move |request| {
            if let Ok(mut queue) = sink.lock() {
                queue.push(request.body().to_string());
            }
        })
        .build_gtk(&container.vbox);
    let Ok(webview) = built else {
        return -4;
    };
    container.show();
    OVERLAY.with(|slot| {
        *slot.borrow_mut() = Some(Overlay {
            webview,
            container,
            inbound,
        });
    });
    0
}

/// Give GTK and WebKit their slice of the frame. Called once per frame by the host.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_pump() {
    OVERLAY.with(|slot| {
        if slot.borrow().is_none() {
            return;
        }
        while gtk::events_pending() {
            gtk::main_iteration_do(false);
        }
    });
}

/// Send one JSON frame to the page. Returns 0 when delivered.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_post(frame: *const c_char) -> c_int {
    if frame.is_null() {
        return -5;
    }
    let Ok(frame) = (unsafe { CStr::from_ptr(frame) }).to_str() else {
        return -5;
    };
    OVERLAY.with(|slot| {
        let borrowed = slot.borrow();
        let Some(overlay) = borrowed.as_ref() else {
            return -1;
        };
        // The page installs `__tnUiReceive`; the same global Android's host calls through
        // `JavaScriptReplyProxy`. One inbound path per end, on every host.
        let script = format!(
            "window.__tnUiReceive && window.__tnUiReceive({})",
            serde_frame(frame)
        );
        if overlay.webview.evaluate_script(&script).is_ok() {
            0
        } else {
            -4
        }
    })
}

/// A JSON string literal holding `frame`, so a quote or a newline in the payload cannot end it.
fn serde_frame(frame: &str) -> String {
    let mut out = String::with_capacity(frame.len() + 2);
    out.push('"');
    for character in frame.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Take the oldest frame the page sent, as a heap `CString` the caller frees with
/// `tn_ui_overlay_free`. Returns null when the queue is empty.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_take() -> *mut c_char {
    OVERLAY.with(|slot| {
        let borrowed = slot.borrow();
        let Some(overlay) = borrowed.as_ref() else {
            return std::ptr::null_mut();
        };
        let Ok(mut queue) = overlay.inbound.lock() else {
            return std::ptr::null_mut();
        };
        if queue.is_empty() {
            return std::ptr::null_mut();
        }
        let frame = queue.remove(0);
        CString::new(frame).map_or(std::ptr::null_mut(), CString::into_raw)
    })
}

/// Free a frame `tn_ui_overlay_take` returned.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_free(frame: *mut c_char) {
    if frame.is_null() {
        return;
    }
    drop(unsafe { CString::from_raw(frame) });
}

/// Move and resize the overlay to follow the game window.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_set_bounds(x: i32, y: i32, width: u32, height: u32) -> c_int {
    OVERLAY.with(|slot| {
        let borrowed = slot.borrow();
        let Some(overlay) = borrowed.as_ref() else {
            return -1;
        };
        overlay.container.set_bounds(x, y, width, height).map_or(-3, |()| 0)
    })
}

/// Publish the interactive rectangles, normalized to the viewport, as the overlay's input shape.
///
/// This is the hit-region protocol, implemented where X11 puts it: outside these rectangles the
/// overlay is not part of the window as far as pointer events are concerned, so a touch or click
/// reaches the game underneath without the host forwarding anything. `count` is the number of
/// rectangles; `regions` holds `count * 4` floats as x, y, width, height.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_set_hit_regions(regions: *const f32, count: u32) -> c_int {
    if count > 0 && regions.is_null() {
        return -5;
    }
    let published = if count == 0 {
        &[][..]
    } else {
        unsafe { std::slice::from_raw_parts(regions, count as usize * 4) }
    };
    OVERLAY.with(|slot| {
        let borrowed = slot.borrow();
        let Some(overlay) = borrowed.as_ref() else {
            return -1;
        };
        overlay.container.set_input_regions(published).map_or(-3, |()| 0)
    })
}

/// Detach and destroy the overlay. Safe to call when nothing is attached.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_detach() {
    OVERLAY.with(|slot| {
        slot.borrow_mut().take();
    });
}
