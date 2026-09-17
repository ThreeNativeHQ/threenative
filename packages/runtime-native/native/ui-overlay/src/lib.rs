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
pub mod offscreen;

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

/// A JSON string literal holding `value`, so no payload can end the script it is embedded in.
///
/// Hand-rolled rather than pulled from a serialiser because the only thing being escaped is a
/// string, and a wrong escape here is script injection: `{:?}` looks like it does this and does
/// not — Rust's debug formatter writes `\u{e9}` for a non-ASCII character where JSON wants `\u00e9`.
pub(crate) fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for character in value.chars() {
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
    let kind = json_string(kind);
    format!(
        "(function(){{var x={nx}*window.innerWidth;var y={ny}*window.innerHeight;\
         var t=document.elementFromPoint(x,y)||document.body||document.documentElement;\
         if(!t)return false;\
         t.dispatchEvent(new PointerEvent({kind},{{bubbles:true,cancelable:true,composed:true,\
         clientX:x,clientY:y,buttons:{buttons},pointerId:{pointer_id},pointerType:'touch',\
         isPrimary:true,width:1,height:1,pressure:{pressure}}}));\
         if({kind}==='pointerdown')window.__tnUiInjectedButtons={buttons};\
         if({kind}==='pointerup'){{\
         if(window.__tnUiInjectedButtons===1)t.dispatchEvent(new MouseEvent('click',{{bubbles:true,\
         cancelable:true,composed:true,clientX:x,clientY:y,button:0,buttons:0}}));\
         window.__tnUiInjectedButtons=undefined;}}\
         return true;}})()",
        nx = nx,
        ny = ny,
        kind = kind,
        buttons = buttons,
        pointer_id = pointer_id,
        pressure = if buttons == 0 { 0.0_f32 } else { 0.5_f32 },
    )
}

/// The JavaScript a host evaluates to deliver one synthetic keyboard event into the page.
///
/// The event goes to whatever holds focus, which is the page's own model and not the host's: a
/// control the player clicked owns the keys, and a page that has focused nothing falls back to the
/// document. `text` is inserted through `insertText` so a key that types a character really types
/// it — a synthesised `keydown` alone never inserts anything, and a text field in a HUD would
/// otherwise take focus and silently ignore every press.
///
/// The keys are embedded as JSON string literals rather than interpolated, so a key name from a
/// platform key table cannot end the script it is going into.
pub(crate) fn key_injection_script(
    kind: &str,
    key: &str,
    code: &str,
    text: &str,
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
) -> String {
    let kind = json_string(kind);
    let key = json_string(key);
    let code = json_string(code);
    let text = json_string(text);
    format!(
        "(function(){{var t=document.activeElement||document.body||document.documentElement;\
         if(!t)return false;\
         t.dispatchEvent(new KeyboardEvent({kind},{{key:{key},code:{code},\
         ctrlKey:{ctrl},altKey:{alt},shiftKey:{shift},metaKey:{meta},bubbles:true,\
         cancelable:true,composed:true}}));\
         if({text}.length>0&&{kind}==='keydown'&&(t.isContentEditable||\
         t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement)){{\
         document.execCommand('insertText',false,{text});}}\
         return true;}})()",
        kind = kind,
        key = key,
        code = code,
        text = text,
        ctrl = ctrl,
        alt = alt,
        shift = shift,
        meta = meta,
    )
}

#[cfg(test)]
mod tests {
    use super::{json_string, key_injection_script, point_in_regions, pointer_injection_script};

    #[test]
    fn a_non_ascii_character_survives_a_json_string_literal() {
        assert_eq!(json_string("é"), "\"é\"");
        assert_eq!(json_string("a\"b"), "\"a\\\"b\"");
        assert_eq!(json_string("a\nb"), "\"a\\nb\"");
        assert_eq!(json_string("a\u{1}b"), "\"a\\u0001b\"");
    }

    #[test]
    fn a_key_name_cannot_end_the_script_it_is_embedded_in() {
        let script = key_injection_script(
            "keydown",
            "'; alert(1); //",
            "KeyQ",
            "",
            false,
            false,
            false,
            false,
        );
        assert!(
            script.contains(r#"key:"'; alert(1); //""#),
            "the key is a JSON string literal, not a quote that closes the call: {script}"
        );
        assert!(!script.contains("key:'; "), "the key was interpolated raw: {script}");
    }

    #[test]
    fn a_pointer_kind_cannot_end_the_script_it_is_embedded_in() {
        let script = pointer_injection_script("pointerdown'); alert(1); //", 0.5, 0.5, 1, 1);
        assert!(
            script.contains(r#"new PointerEvent("pointerdown'); alert(1); //","#),
            "the kind is a JSON string literal: {script}"
        );
    }

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
