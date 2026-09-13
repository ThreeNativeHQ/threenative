//! The desktop half of PRD-217's UI layer.
//!
//! `wry` attaches a web view to a window someone else owns. What each host has to add on top of
//! that differs by window system:
//!
//! - Linux/X11 has no compositing of a child window, so `argb` builds the transparent container
//!   `wry` will not and `abi` drives it; the hit-region protocol is an X11 input shape.
//! - Windows and macOS composite a child web view themselves, so `desktop` attaches one straight
//!   to the game window and implements the hit-region protocol where each OS puts it — a GDI
//!   window region on Windows, an `NSView` hit test on macOS.
//!
//! Both implement the one C ABI in `include/mystral/platform/ui_overlay.h`, so the C++ host and
//! the page see the same contract on every platform.

#[cfg(target_os = "linux")]
pub mod abi;

#[cfg(target_os = "linux")]
pub mod argb;

#[cfg(not(target_os = "linux"))]
pub mod desktop;

use std::cell::RefCell;

thread_local! {
    /// The interactive rectangles the page last published, normalized to the viewport. One list
    /// for both backends: the desktop module cuts its OS region and answers `hitTest:` from it,
    /// the Linux ABI applies it as the X11 input shape, and a synthetic playtest pointer is
    /// routed through the same list so it cannot disagree with the OS.
    pub(crate) static HIT_REGIONS: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
}

/// Whether a normalized point falls inside any published interactive rectangle.
///
/// A point exactly on an edge counts as inside, matching how the OS region and `hitTest:` treat
/// the boundary. An empty list is a UI with no islands, so nothing is inside it.
pub(crate) fn point_in_regions(regions: &[f32], nx: f32, ny: f32) -> bool {
    regions.chunks_exact(4).any(|region| {
        nx >= region[0]
            && ny >= region[1]
            && nx <= region[0] + region[2]
            && ny <= region[1] + region[3]
    })
}

/// The published-region hit test shared by the ABI's `tn_ui_overlay_hit_test` on every backend.
pub(crate) fn hit_test(nx: f32, ny: f32) -> bool {
    HIT_REGIONS.with(|regions| point_in_regions(&regions.borrow(), nx, ny))
}

/// The JavaScript a host evaluates to deliver one synthetic pointer event into the page.
///
/// Built once so both desktop backends dispatch identically: the normalized point becomes a pixel
/// position in the page's own viewport, and the event is dispatched on whatever element is there,
/// so a control's own handlers run exactly as they would for an OS-routed press. Playtest input
/// only; a real OS pointer needs no help.
pub(crate) fn pointer_injection_script(
    kind: &str,
    nx: f32,
    ny: f32,
    buttons: i32,
    pointer_id: i32,
) -> String {
    format!(
        "(function(){{var x={nx}*window.innerWidth;var y={ny}*window.innerHeight;\
         var t=document.elementFromPoint(x,y)||document.body||document.documentElement;\
         if(!t)return false;\
         t.dispatchEvent(new PointerEvent({kind:?},{{bubbles:true,cancelable:true,composed:true,\
         clientX:x,clientY:y,buttons:{buttons},pointerId:{pointer_id},pointerType:'touch',\
         isPrimary:true,width:1,height:1,pressure:{pressure}}}));\
         if({kind:?}==='pointerup'){{t.dispatchEvent(new MouseEvent('click',{{bubbles:true,\
         cancelable:true,composed:true,clientX:x,clientY:y,button:0,buttons:0}}));}}\
         return true;}})()",
        nx = nx,
        ny = ny,
        kind = kind,
        buttons = buttons,
        pointer_id = pointer_id,
        pressure = if buttons == 0 { 0.0_f32 } else { 0.5_f32 },
    )
}

#[cfg(test)]
mod tests {
    use super::point_in_regions;

    #[test]
    fn a_point_inside_a_rectangle_is_inside() {
        let regions = [0.25, 0.75, 0.2, 0.2];
        assert!(point_in_regions(&regions, 0.30, 0.80));
        assert!(point_in_regions(&regions, 0.25, 0.75));
        assert!(point_in_regions(&regions, 0.45, 0.95));
    }

    #[test]
    fn a_point_outside_every_rectangle_is_outside() {
        let regions = [0.25, 0.75, 0.2, 0.2, 0.7, 0.4, 0.1, 0.1];
        assert!(!point_in_regions(&regions, 0.5, 0.5));
        assert!(!point_in_regions(&regions, 0.5, 0.9));
        assert!(!point_in_regions(&regions, 0.9, 0.45));
    }

    #[test]
    fn an_empty_list_has_no_inside() {
        assert!(!point_in_regions(&[], 0.5, 0.5));
    }
}
