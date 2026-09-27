//! The C ABI the C++ host calls.
//!
//! Deliberately small and string-shaped: everything that crosses is one JSON frame, exactly as it
//! is on Android, so the desktop host and the Android host implement the same contract in
//! `@threenative/core/ui-layer` rather than two dialects of it.
//!
//! Threading, on Linux: **every function here runs on the game thread and none of them touches GTK
//! or WebKit.** Those live on a thread of their own inside [`crate::offscreen`], which is what
//! removes the starvation the frame-loop pump had, and what makes it safe to call this from a
//! frame. The one exception is [`tn_ui_overlay_attach`], which waits for that thread to come up so
//! a game that asked for this renderer and did not get it can say so instead of showing nothing.

use std::cell::RefCell;
use std::ffi::{c_char, c_int, c_ulong, CStr, CString};

use crate::offscreen::{Command, FrameView, Overlay};

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
}

/// One completed web-view frame, as the renderer needs it.
///
/// `pixels` is valid until the next `tn_ui_overlay_frame`, which is the whole contract: the
/// compositor uploads it and asks again next frame. `stride` is bytes per row and is not
/// necessarily `width * 4`. The bytes are premultiplied `B,G,R,A` — cairo's `ARGB32` on a
/// little-endian host.
#[repr(C)]
pub struct TnUiFrame {
    pub pixels: *const u8,
    pub length: usize,
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub counter: u64,
}

/// Attach the offscreen web view, serving the built UI from `ui_root`.
///
/// `parent` is accepted and unused on Linux: there is no window to attach to any more, and the
/// signature is shared with the Windows and macOS hosts, which do attach to one.
///
/// Returns 0 on success and a negative code otherwise, each one a distinct reason so the host can
/// say which: -1 no display or GTK could not start, -3 the web view could not be built, -4 the web
/// engine did not come up, -5 a bad argument. Failing loudly matters here — a game that asked for
/// this renderer and silently got no UI is the worst outcome.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_attach(
    parent: c_ulong,
    ui_root: *const c_char,
    width: u32,
    height: u32,
) -> c_int {
    let _ = parent;
    if ui_root.is_null() || width == 0 || height == 0 {
        return -5;
    }
    let Ok(ui_root) = (unsafe { CStr::from_ptr(ui_root) }).to_str() else {
        return -5;
    };
    crate::HIT_REGIONS.with(|regions| regions.borrow_mut().clear());
    OVERLAY.with(|slot| {
        if slot.borrow().is_some() {
            return -1;
        }
        match crate::offscreen::spawn(std::path::PathBuf::from(ui_root), width, height) {
            Ok(overlay) => {
                *slot.borrow_mut() = Some(overlay);
                0
            }
            // Distinguish "GDK could not start" from "the web engine failed afterwards" only as far
            // as the host can act on it, which is not at all: both are a named refusal.
            Err(()) => -4,
        }
    })
}

/// Send one JSON frame to the page. Returns 0 when queued.
///
/// Queued rather than delivered: the web thread picks it up on its next service tick. Delivering it
/// synchronously would put an evaluate call on the game thread's critical path for a message the
/// page cannot act on until it runs anyway.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_post(frame: *const c_char) -> c_int {
    if frame.is_null() {
        return -5;
    }
    let Ok(frame) = (unsafe { CStr::from_ptr(frame) }).to_str() else {
        return -5;
    };
    OVERLAY.with(|slot| match slot.borrow().as_ref() {
        Some(overlay) => {
            overlay.shared.push_command(Command::Post(frame.to_string()));
            0
        }
        None => -1,
    })
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
        match overlay.shared.take_inbound() {
            Some(frame) => CString::new(frame).map_or(std::ptr::null_mut(), CString::into_raw),
            None => std::ptr::null_mut(),
        }
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

/// The newest completed web-view frame, written into `out`.
///
/// Returns 1 when a frame is available — including the one the caller already had, so a page that
/// has not changed keeps being drawn — and 0 only before the first paint. `counter` advances once
/// per frame the web view actually produced, which is how the renderer knows whether the pixels it
/// is holding are the ones on screen without comparing them.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_frame(out: *mut TnUiFrame) -> c_int {
    if out.is_null() {
        return -5;
    }
    OVERLAY.with(|slot| {
        let borrowed = slot.borrow();
        let Some(overlay) = borrowed.as_ref() else {
            return -1;
        };
        match overlay.shared.frames.acquire() {
            Some(FrameView {
                pixels,
                length,
                width,
                height,
                stride,
                counter,
            }) => {
                unsafe {
                    *out = TnUiFrame {
                        pixels,
                        length,
                        width,
                        height,
                        stride,
                        counter,
                    };
                }
                1
            }
            None => 0,
        }
    })
}

/// How many frames the web view has published. Monotonic; 0 before the first paint.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_frames_published() -> u64 {
    OVERLAY.with(|slot| match slot.borrow().as_ref() {
        Some(overlay) => overlay.shared.frames.published(),
        None => 0,
    })
}

/// The game window changed size, in pixels. Returns 0 when queued.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_set_bounds(_x: i32, _y: i32, width: u32, height: u32) -> c_int {
    if width == 0 || height == 0 {
        return -5;
    }
    OVERLAY.with(|slot| match slot.borrow().as_ref() {
        Some(overlay) => {
            overlay.shared.push_command(Command::Resize { width, height });
            0
        }
        None => -1,
    })
}

/// Publish the interactive rectangles, normalized to the viewport.
///
/// `count` is the number of rectangles; `regions` holds `count * 4` floats as x, y, width, height.
/// Nothing is applied to the window system any more — there is no window — so this is purely the
/// list the host routes pointer events with, which is what it always was on Windows and macOS.
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
    crate::HIT_REGIONS.with(|store| *store.borrow_mut() = published.to_vec());
    OVERLAY.with(|slot| if slot.borrow().is_some() { 0 } else { -1 })
}

/// Whether a normalized point is inside a published interactive rectangle.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_hit_test(nx: f32, ny: f32) -> c_int {
    if crate::hit_test(nx, ny) {
        1
    } else {
        0
    }
}

/// Forward a pointer event to WebKit's native input route on its worker thread.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_inject_pointer(
    kind: *const c_char,
    nx: f32,
    ny: f32,
    buttons: i32,
    pointer_id: i32,
) -> c_int {
    if kind.is_null() {
        return -5;
    }
    let Ok(kind) = (unsafe { CStr::from_ptr(kind) }).to_str() else {
        return -5;
    };
    OVERLAY.with(|slot| match slot.borrow().as_ref() {
        Some(overlay) => {
            if kind == "pointercancel" {
                // The host already gave focus back to gameplay; do not steal a key while the
                // worker is still catching up with the corresponding DOM blur.
                overlay.shared.set_keyboard_captured(false);
            }
            overlay.shared.push_command(Command::Pointer {
                kind: kind.to_string(),
                nx,
                ny,
                buttons,
                pointer_id,
            });
            0
        }
        None => -1,
    })
}

/// Forward an X11 key through the web thread's native GDK input route.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_inject_key(
    keycode: u32, modifiers: u32, group: u32, time: u32, down: c_int,
) -> c_int {
    if keycode > u16::MAX as u32 || group > 3 || !(0..=1).contains(&down) { return -5; }
    OVERLAY.with(|slot| match slot.borrow().as_ref() {
        Some(overlay) => {
            overlay.shared.push_command(Command::Key { keycode, modifiers, group, time, down: down != 0 });
            0
        }
        None => -1,
    })
}

/// Whether the page holds the keyboard, so the host knows where a key belongs.
///
/// True while a focused input, textarea, select or open list is in the page. The game loop asks
/// this before forwarding a key: a rectangle says where a press landed and says nothing about who
/// should receive `ArrowUp`, so the only honest authority is the page's own focus.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_keyboard_captured() -> c_int {
    OVERLAY.with(|slot| match slot.borrow().as_ref() {
        Some(overlay) if overlay.shared.keyboard_captured() => 1,
        _ => 0,
    })
}

/// Detach and destroy the overlay. Safe to call when nothing is attached.
#[no_mangle]
pub extern "C" fn tn_ui_overlay_detach() {
    crate::HIT_REGIONS.with(|regions| regions.borrow_mut().clear());
    OVERLAY.with(|slot| {
        // `Overlay::drop` stops the web thread and joins it, so by the time this returns nothing
        // is left that could touch the page.
        slot.borrow_mut().take();
    });
}
