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
