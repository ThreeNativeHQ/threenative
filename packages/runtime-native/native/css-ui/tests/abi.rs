//! The C ABI is the product surface — the host never sees [`CssUi`]. So it gets its own pass:
//! every exported name, every error code, and the claim that no WebView is involved.

use std::ffi::{c_char, c_int, CStr, CString};

use threenative_css_ui::abi::*;

fn c(text: &str) -> CString {
    CString::new(text).expect("no interior nul")
}

fn last_error() -> String {
    // Safety: the buffer is nul-terminated and valid until the next call into the library.
    unsafe { CStr::from_ptr(tn_css_ui_last_error()) }
        .to_string_lossy()
        .into_owned()
}

/// A panel with a click listener on the button, so the frame and the event path both have work.
fn fixture() -> String {
    let sheet = serde_json::to_string(
        "section{position:fixed;left:24px;bottom:24px;width:80px;height:40px;background:#2563eb}\
         button{display:block;width:80px;height:40px;background:#27272a}",
    )
    .expect("css encodes");
    format!(
        r#"{{"ops":[
            {{"op":"sheet","key":"hud","css":{sheet}}},
            {{"op":"create","id":1,"tag":"section"}},
            {{"op":"create","id":2,"tag":"button"}},
            {{"op":"append","parent":0,"child":1}},
            {{"op":"append","parent":1,"child":2}},
            {{"op":"listen","id":2,"event":"click"}}
        ]}}"#
    )
}

#[test]
fn backend_names_the_engine_and_not_a_webview() {
    // Safety: a static nul-terminated string owned by the library.
    let backend = unsafe { CStr::from_ptr(tn_css_ui_backend()) };
    let backend = backend.to_str().expect("ascii");
    assert!(backend.contains("blitz-dom 0.3.0-beta.2"), "{backend}");
    assert!(backend.contains("anyrender_vello_cpu 0.17.0"), "{backend}");
    assert!(backend.contains("parley 0.11.1"), "{backend}");
    assert!(backend.contains("no WebView"), "{backend}");
    assert!(!backend.contains("webkit"), "{backend}");
    assert!(!backend.contains("chromium"), "{backend}");
}

#[test]
fn refuses_work_before_attach() {
    assert_eq!(tn_css_ui_post(c("{}").as_ptr()), -1);
    let mut frame = TnCssFrame {
        pixels: std::ptr::null(),
        length: 0,
        width: 0,
        height: 0,
        stride: 0,
        counter: 0,
    };
    assert_eq!(tn_css_ui_frame(&mut frame), -1);
    assert_eq!(tn_css_ui_hit_test(0.5, 0.5), -1);
    assert_eq!(tn_css_ui_set_size(10, 10), -1);
    assert_eq!(tn_css_ui_pointer(c("move").as_ptr(), 0.5, 0.5, 0), -1);
    assert!(tn_css_ui_take().is_null());
}

#[test]
fn the_documented_error_codes() {
    assert_eq!(tn_css_ui_attach(std::ptr::null(), 480, 320), -5, "null ui_root");
    assert!(last_error().contains("ui_root"), "{}", last_error());
    assert_eq!(tn_css_ui_frame(std::ptr::null_mut()), -5, "null out");
    assert!(last_error().contains("out is null"), "{}", last_error());

    // A missing stylesheet directory is allowed: a game may ship its CSS inside its bundle.
    assert_eq!(
        tn_css_ui_attach(c("/nonexistent/css-ui-sheets").as_ptr(), 480, 320),
        0
    );
    assert_eq!(tn_css_ui_attach(c("/tmp").as_ptr(), 480, 320), -1, "already attached");
    assert_eq!(tn_css_ui_post(std::ptr::null()), -5, "null batch");

    assert_eq!(tn_css_ui_post(c("not json").as_ptr()), -6);
    assert!(last_error().contains("batch"), "{}", last_error());
    assert_eq!(
        tn_css_ui_post(c(r#"{"ops":[{"op":"create","id":1,"tag":"marquee"}]}"#).as_ptr()),
        -6
    );
    assert!(last_error().contains("marquee"), "{}", last_error());

    assert_eq!(tn_css_ui_detach(), 0);
}

#[test]
fn frames_paint_once_and_carry_the_counter() {
    assert_eq!(tn_css_ui_attach(c("/nonexistent").as_ptr(), 480, 320), 0);
    assert_eq!(tn_css_ui_post(c(&fixture()).as_ptr()), 0);

    let mut frame = TnCssFrame {
        pixels: std::ptr::null(),
        length: 0,
        width: 0,
        height: 0,
        stride: 0,
        counter: 0,
    };
    assert_eq!(tn_css_ui_frame(&mut frame), 1, "a frame exists");
    assert_eq!((frame.width, frame.height, frame.stride), (480, 320, 480 * 4));
    assert_eq!(frame.length, 480 * 320 * 4);
    assert_eq!(frame.counter, 1);
    assert!(!frame.pixels.is_null());

    let again = frame.counter;
    assert_eq!(tn_css_ui_frame(&mut frame), 1, "still a frame, just not a new one");
    assert_eq!(frame.counter, again, "no mutation means no repaint");

    // The blue button, premultiplied: opaque means the channels are already straight.
    // Safety: the buffer is valid until the next render, resize or detach.
    let pixel = unsafe { std::slice::from_raw_parts(frame.pixels, 4) };
    let at = |x: u32, y: u32| unsafe {
        let offset = ((y * frame.width + x) * 4) as usize;
        std::slice::from_raw_parts(frame.pixels.add(offset), 4)
    };
    assert_eq!(pixel, at(0, 0), "the buffer is stable until the next frame");
    assert_eq!(at(40, 100), &[0, 0, 0, 0], "the section is not there");
    assert_eq!(at(40, 276), &[39, 39, 42, 255], "the button is painted");

    assert_eq!(tn_css_ui_set_size(800, 600), 0);
    assert_eq!(tn_css_ui_frame(&mut frame), 1);
    assert_eq!((frame.width, frame.height), (800, 600));
    assert_eq!(frame.counter, again + 1, "a resize is a new frame");

    assert_eq!(tn_css_ui_detach(), 0);
}

#[test]
fn events_travel_out_and_free_cleanly() {
    assert_eq!(tn_css_ui_attach(c("/nonexistent").as_ptr(), 480, 320), 0);
    assert_eq!(tn_css_ui_post(c(&fixture()).as_ptr()), 0);
    let mut frame = TnCssFrame {
        pixels: std::ptr::null(),
        length: 0,
        width: 0,
        height: 0,
        stride: 0,
        counter: 0,
    };
    assert_eq!(tn_css_ui_frame(&mut frame), 1, "lay the UI out before hit testing");

    // The section covers x 24..104, y 256..296; the button is all of it.
    let inside = (64.0 / 480.0, 276.0 / 320.0);
    let outside = (400.0 / 480.0, 20.0 / 320.0);
    assert_eq!(tn_css_ui_hit_test(inside.0, inside.1), 1);
    assert_eq!(tn_css_ui_hit_test(outside.0, outside.1), 0);

    assert_eq!(tn_css_ui_pointer(c("move").as_ptr(), inside.0, inside.1, 0), 1);
    assert_eq!(tn_css_ui_pointer(c("down").as_ptr(), inside.0, inside.1, 1), 1);
    assert_eq!(tn_css_ui_pointer(c("up").as_ptr(), inside.0, inside.1, 0), 1);
    assert_eq!(tn_css_ui_pointer(c("nope").as_ptr(), inside.0, inside.1, 0), -5);

    let raw = tn_css_ui_take();
    assert!(!raw.is_null(), "a click was queued");
    // Safety: `take` hands over a CString the host releases with `tn_css_ui_free`.
    let events = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
    assert_eq!(events, r#"{"type":"click","id":2}"#);
    unsafe { tn_css_ui_free(raw) };
    assert!(tn_css_ui_take().is_null(), "the queue is empty again");

    assert_eq!(tn_css_ui_detach(), 0);
    unsafe { tn_css_ui_free(std::ptr::null_mut()) };
}

#[test]
fn a_sheet_directory_loads_sorted_by_file_name() {
    let dir = std::env::temp_dir().join("threenative-css-ui-sheets");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    std::fs::write(dir.join("b.css"), "section{height:41px}").expect("write");
    std::fs::write(dir.join("a.css"), "section{background:#0f0}").expect("write");
    std::fs::write(dir.join("ignored.txt"), "not css").expect("write");

    assert_eq!(tn_css_ui_attach(c(dir.to_str().unwrap()).as_ptr(), 480, 320), 0);
    let mut frame = TnCssFrame {
        pixels: std::ptr::null(),
        length: 0,
        width: 0,
        height: 0,
        stride: 0,
        counter: 0,
    };
    assert_eq!(
        tn_css_ui_post(
            c(
                r#"{"ops":[
                    {"op":"create","id":1,"tag":"section"},
                    {"op":"append","parent":0,"child":1}
                ]}"#
            )
            .as_ptr()
        ),
        0
    );
    assert_eq!(tn_css_ui_frame(&mut frame), 1);
    // b.css (41px) and a.css (#0f0) both applied, so the 40x40 section area is green and the row
    // below it is still painted by the 41px box.
    let at = |x: u32, y: u32| unsafe {
        let offset = ((y * frame.width + x) * 4) as usize;
        std::slice::from_raw_parts(frame.pixels.add(offset), 4)
    };
    assert_eq!(at(10, 10), &[0, 255, 0, 255], "a.css applied");
    assert_eq!(at(10, 300), &[0, 0, 0, 0], "nothing below 41px");

    assert_eq!(tn_css_ui_detach(), 0);
    let _ = std::fs::remove_dir_all(&dir);
}

/// A `@font-face` naming a file the `ui/` dir does not hold is a named failure, never a quiet
/// fall back to whatever the machine has: an unstyled HUD and a HUD whose font never shipped look
/// identical on screen, so the second one has to be told apart instead of being guessed at.
#[test]
fn a_font_face_that_names_a_missing_file_is_a_named_failure() {
    let dir = temp_dir("threenative-css-ui-missing-font");
    std::fs::write(
        dir.join("hud.css"),
        "@font-face{font-family:Bundled;src:url(Missing-Regular.ttf)}\nspan{font-family:Bundled}",
    )
    .expect("write");

    assert_eq!(
        tn_css_ui_attach(c(dir.to_str().unwrap()).as_ptr(), 480, 320),
        -5,
        "{}",
        last_error()
    );
    assert!(last_error().contains("Missing-Regular.ttf"), "{}", last_error());
    // Nothing was attached, so the UI is not half-installed.
    assert_eq!(tn_css_ui_post(c("{}").as_ptr()), -1);
    assert!(last_error().contains("not attached"), "{}", last_error());

    assert_eq!(tn_css_ui_detach(), 0);
    let _ = std::fs::remove_dir_all(&dir);
}

/// An `<img src>` naming a file the `ui/` dir does not hold is refused by name, and the batch that
/// carried it applies nothing.
#[test]
fn an_image_that_names_a_missing_file_is_refused_before_anything_applies() {
    let dir = temp_dir("threenative-css-ui-missing-image");
    std::fs::write(dir.join("hud.css"), "img{width:8px;height:8px}").expect("write");

    assert_eq!(
        tn_css_ui_attach(c(dir.to_str().unwrap()).as_ptr(), 480, 320),
        0,
        "{}",
        last_error()
    );
    assert_eq!(
        tn_css_ui_post(
            c(
                r#"{"ops":[{"op":"create","id":1,"tag":"img"},
                    {"op":"attr","id":1,"name":"src","value":"missing.png"},
                    {"op":"append","parent":0,"child":1}]}"#
            )
            .as_ptr()
        ),
        -6,
        "{}",
        last_error()
    );
    assert!(last_error().contains("missing.png"), "{}", last_error());
    // Id 1 was never created, so the same id is still free.
    assert_eq!(
        tn_css_ui_post(
            c(r#"{"ops":[{"op":"create","id":1,"tag":"img"},{"op":"append","parent":0,"child":1}]}"#)
                .as_ptr()
        ),
        0,
        "{}",
        last_error()
    );

    assert_eq!(tn_css_ui_detach(), 0);
    let _ = std::fs::remove_dir_all(&dir);
}

/// Keeps the unused-import warning away for the raw pointer types the ABI signatures mention.
const _SIGNATURES: (Option<*const c_char>, c_int) = (None, 0);

/// A directory under the system temp dir, wiped first, named after the test that owns it.
fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

#[test]
fn a_stylesheet_with_an_uppercase_extension_loads() {
    // A bundle written on a case-insensitive filesystem keeps whatever case the author typed, and
    // a stylesheet that was visible to them must not vanish here.
    let dir = temp_dir("threenative-css-ui-uppercase-sheets");
    std::fs::write(dir.join("Hud.CSS"), "section{width:30px;height:30px;background:#0f0}")
        .expect("write");

    assert_eq!(
        tn_css_ui_attach(c(dir.to_str().unwrap()).as_ptr(), 480, 320),
        0,
        "a `.CSS` file is a stylesheet: {}",
        last_error()
    );
    assert_eq!(
        tn_css_ui_post(
            c(r#"{"ops":[{"op":"create","id":1,"tag":"section"},{"op":"append","parent":0,"child":1}]}"#)
                .as_ptr()
        ),
        0
    );
    let mut frame = TnCssFrame {
        pixels: std::ptr::null(),
        length: 0,
        width: 0,
        height: 0,
        stride: 0,
        counter: 0,
    };
    assert_eq!(tn_css_ui_frame(&mut frame), 1);
    // Safety: the buffer is valid until the next render, resize or detach.
    let at = |x: u32, y: u32| unsafe {
        let offset = ((y * frame.width + x) * 4) as usize;
        std::slice::from_raw_parts(frame.pixels.add(offset), 4)
    };
    assert_eq!(at(5, 5), &[0, 255, 0, 255], "Hud.CSS was applied");

    assert_eq!(tn_css_ui_detach(), 0);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_existing_ui_root_with_no_stylesheet_is_its_own_code() {
    // An unstyled HUD and a HUD whose CSS never shipped are the same pixels, so the second has to
    // be told apart at attach time instead of leaving a blank screen to be guessed at.
    let empty = temp_dir("threenative-css-ui-empty-sheets");
    assert_eq!(
        tn_css_ui_attach(c(empty.to_str().unwrap()).as_ptr(), 480, 320),
        -7,
        "{}",
        last_error()
    );
    assert!(last_error().contains(".css"), "{}", last_error());
    // The failed attach left nothing attached, so the next one is not "already attached".
    assert_eq!(
        tn_css_ui_attach(c("/nonexistent/css-ui-sheets").as_ptr(), 480, 320),
        0,
        "a missing directory still loads nothing and attaches"
    );

    assert_eq!(tn_css_ui_detach(), 0);
    let _ = std::fs::remove_dir_all(&empty);
}