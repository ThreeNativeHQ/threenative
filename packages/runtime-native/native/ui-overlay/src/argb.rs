//! A transparent container for the desktop UI layer, on X11.
//!
//! `wry`'s `build_as_child` attaches by creating its container with
//! `XCreateSimpleWindow(display, parent, x, y, w, h, 0, 0, 0)`. That call inherits the parent's
//! visual and takes a background pixel of zero, so on a 24-bit SDL window the container is 24-bit
//! and opaque: `with_transparent(true)` reaches the page and stops at the window, and the web view
//! paints black over the game.
//!
//! This builds the container the design actually needs — a depth-32 child on a TrueColor ARGB
//! visual with its own colormap — and hands it to `wry` through `build_gtk`, which takes any GTK
//! container and leaves the window to the caller. Everything else about the attach is `wry`'s.
//!
//! X11 requires `border_pixel` and `colormap` to be set explicitly whenever a window's depth
//! differs from its parent's; omitting either is a `BadMatch` at creation rather than a wrong
//! colour later.

use std::ffi::c_ulong;

use gdkx11::X11Display;
use gtk::gdk;
use gtk::glib::translate::ToGlibPtr;
use gtk::prelude::*;
use x11_dl::xlib;

/// The last child of `parent`, which is whatever was attached most recently.
///
/// Used by the control arm to sample `wry`'s own container rather than ours, so the comparison is
/// between two real containers instead of between a container and nothing.
pub fn newest_child(parent: c_ulong) -> Result<(c_ulong, i32), String> {
    let xlib = xlib::Xlib::open().map_err(|error| format!("xlib: {error}"))?;
    unsafe {
        let display = (xlib.XOpenDisplay)(std::ptr::null());
        if display.is_null() {
            return Err("no X display".into());
        }
        let mut root = 0;
        let mut window_parent = 0;
        let mut children: *mut c_ulong = std::ptr::null_mut();
        let mut count = 0;
        let ok = (xlib.XQueryTree)(
            display,
            parent,
            &mut root,
            &mut window_parent,
            &mut children,
            &mut count,
        );
        if ok == 0 || count == 0 {
            (xlib.XCloseDisplay)(display);
            return Err("the parent window reported no children".into());
        }
        let child = *children.add((count - 1) as usize);
        let mut attributes: xlib::XWindowAttributes = std::mem::zeroed();
        (xlib.XGetWindowAttributes)(display, child, &mut attributes);
        let depth = attributes.depth;
        (xlib.XFree)(children as *mut _);
        (xlib.XCloseDisplay)(display);
        Ok((child, depth))
    }
}

/// Which top-level window the display server would send a click at `x, y` to.
///
/// The desktop half of the hit-region protocol, asked of the authority that decides it. With an
/// input shape set, a point outside every published rectangle must answer with the game's window
/// even though the overlay covers it — that is the whole property, and nothing short of asking the
/// X server proves it.
pub fn window_under_pointer(x: i32, y: i32) -> Result<c_ulong, String> {
    let xlib = xlib::Xlib::open().map_err(|error| format!("xlib: {error}"))?;
    unsafe {
        let display = (xlib.XOpenDisplay)(std::ptr::null());
        if display.is_null() {
            return Err("no X display".into());
        }
        let screen = (xlib.XDefaultScreen)(display);
        let root = (xlib.XRootWindow)(display, screen);
        (xlib.XWarpPointer)(display, 0, root, 0, 0, 0, 0, x, y);
        (xlib.XFlush)(display);
        let mut root_return = 0;
        let mut child = 0;
        let (mut root_x, mut root_y, mut win_x, mut win_y) = (0, 0, 0, 0);
        let mut mask = 0;
        (xlib.XQueryPointer)(
            display,
            root,
            &mut root_return,
            &mut child,
            &mut root_x,
            &mut root_y,
            &mut win_x,
            &mut win_y,
            &mut mask,
        );
        (xlib.XCloseDisplay)(display);
        Ok(child)
    }
}

/// Whether a compositing manager is running on this display.
///
/// The alpha this file produces is real — a depth-32 window holds it and the web view writes it —
/// but on X11 nothing *blends* it except a compositor, and compositors blend top-level windows.
/// So a desktop overlay without a compositor is a black rectangle over the game, and that has to
/// be a named refusal at attach rather than something the player discovers.
///
/// The test is the one the spec defines: ownership of the `_NET_WM_CM_S<screen>` selection. Every
/// current Linux desktop takes it — mutter, kwin, sway, Hyprland — so this is a check for the
/// exception, not a common path.
pub fn compositor_present() -> bool {
    let Ok(xlib) = xlib::Xlib::open() else {
        return false;
    };
    unsafe {
        let display = (xlib.XOpenDisplay)(std::ptr::null());
        if display.is_null() {
            return false;
        }
        let screen = (xlib.XDefaultScreen)(display);
        let name = std::ffi::CString::new(format!("_NET_WM_CM_S{screen}")).expect("selection name");
        let atom = (xlib.XInternAtom)(display, name.as_ptr(), 0);
        let owner = (xlib.XGetSelectionOwner)(display, atom);
        (xlib.XCloseDisplay)(display);
        owner != 0
    }
}

/// Tell the window manager what this window is, before it is mapped.
///
/// Five properties, each doing one job, and each one a thing this file previously tried to do by
/// hand and got wrong:
///
/// - `WM_TRANSIENT_FOR` ties the overlay to the game. A manager keeps a transient above its parent
///   and below other applications, and hides it when the parent is minimised.
/// - `_NET_WM_WINDOW_TYPE_UTILITY` says it is a tool window, not a document — no task-bar entry
///   and no place in the alt-tab list on managers that honour the type.
/// - `_NET_WM_STATE_SKIP_TASKBAR` and `_SKIP_PAGER` say the same thing to managers that read state
///   rather than type.
/// - `_MOTIF_WM_HINTS` with no decorations. A HUD with a title bar is not a HUD.
/// - `WM_HINTS` with `input = False` so the overlay never takes keyboard focus from the game. The
///   web view still receives pointer events; it simply never becomes the focused window.
unsafe fn declare_transient_utility(
    xlib: &xlib::Xlib,
    display: *mut xlib::Display,
    window: c_ulong,
    parent: c_ulong,
) {
    let atom = |name: &str| {
        let c = std::ffi::CString::new(name).expect("atom name");
        (xlib.XInternAtom)(display, c.as_ptr(), 0)
    };

    (xlib.XSetTransientForHint)(display, window, parent);

    let window_type = atom("_NET_WM_WINDOW_TYPE");
    let utility = atom("_NET_WM_WINDOW_TYPE_UTILITY");
    (xlib.XChangeProperty)(
        display,
        window,
        window_type,
        xlib::XA_ATOM,
        32,
        xlib::PropModeReplace,
        std::ptr::addr_of!(utility) as *const u8,
        1,
    );

    let state = atom("_NET_WM_STATE");
    let states = [atom("_NET_WM_STATE_SKIP_TASKBAR"), atom("_NET_WM_STATE_SKIP_PAGER")];
    (xlib.XChangeProperty)(
        display,
        window,
        state,
        xlib::XA_ATOM,
        32,
        xlib::PropModeReplace,
        states.as_ptr() as *const u8,
        states.len() as i32,
    );

    // Motif's hint block is five longs; only `decorations` is being said here, and saying it needs
    // the flag bit that marks that field as present.
    let motif = atom("_MOTIF_WM_HINTS");
    let hints: [c_ulong; 5] = [2 /* MWM_HINTS_DECORATIONS */, 0, 0 /* none */, 0, 0];
    (xlib.XChangeProperty)(
        display,
        window,
        motif,
        motif,
        32,
        xlib::PropModeReplace,
        hints.as_ptr() as *const u8,
        hints.len() as i32,
    );

    {
        let wm_hints = (xlib.XAllocWMHints)();
        if !wm_hints.is_null() {
            (*wm_hints).flags = xlib::InputHint;
            (*wm_hints).input = 0;
            (xlib.XSetWMHints)(display, window, wm_hints);
            (xlib.XFree)(wm_hints as *mut _);
        }
    }
}

/// The outermost ancestor of `window` below the root — the window manager's frame, or `window`
/// itself when nothing reparented it.
unsafe fn frame_window(xlib: &xlib::Xlib, display: *mut xlib::Display, window: c_ulong) -> c_ulong {
    let screen = (xlib.XDefaultScreen)(display);
    let root = (xlib.XRootWindow)(display, screen);
    let mut current = window;
    for _ in 0..8 {
        let mut returned_root = 0;
        let mut parent = 0;
        let mut children: *mut c_ulong = std::ptr::null_mut();
        let mut count = 0;
        if (xlib.XQueryTree)(
            display,
            current,
            &mut returned_root,
            &mut parent,
            &mut children,
            &mut count,
        ) == 0
        {
            return current;
        }
        if !children.is_null() {
            (xlib.XFree)(children as *mut _);
        }
        if parent == root || parent == 0 {
            return current;
        }
        current = parent;
    }
    current
}

/// Where `window` sits on the root, so an overlay can be created there rather than at 0,0.
unsafe fn absolute_origin(
    xlib: &xlib::Xlib,
    display: *mut xlib::Display,
    root: c_ulong,
    window: c_ulong,
) -> (i32, i32) {
    let mut x = 0;
    let mut y = 0;
    let mut child = 0;
    (xlib.XTranslateCoordinates)(display, window, root, 0, 0, &mut x, &mut y, &mut child);
    (x, y)
}

/// `XRectangle`, which `x11-dl` does not re-export for the Shape extension.
#[repr(C)]
struct XRectangle {
    x: i16,
    y: i16,
    width: u16,
    height: u16,
}

pub struct ArgbContainer {
    /// The GTK container `wry` renders into.
    pub vbox: gtk::Box,
    /// Kept alive for as long as the web view: dropping it destroys the container.
    pub window: gtk::Window,
    /// The X11 window the overlay lives in, for the input shape and for reporting its depth.
    pub x11_window: c_ulong,
    /// The game's window. The overlay tracks its geometry, its stacking and its visibility.
    pub parent: c_ulong,
    /// The window manager's frame around the game window, when there is one.
    ///
    /// A reparenting window manager puts the game inside a frame it owns, and moving that frame
    /// sends `ConfigureNotify` to the *frame*, not to the client inside it. Watching only the
    /// client meant a resize that the manager also repositioned left the overlay a title bar's
    /// width out of place — measured as 18 by 9 pixels on KWin.
    frame: c_ulong,
    /// The depth actually obtained. 32 is the point of this file; anything else is a failure.
    pub depth: i32,
    /// `libX11`, resolved once. It used to be `dlopen`ed inside every call.
    xlib: xlib::Xlib,
    /// GDK's connection, which is the one the overlay window was created on.
    ///
    /// Window operations have to go here: GTK owns this window and will draw into it. Not closed
    /// on drop — GDK owns the connection, and closing someone else's is how a process ends up
    /// with an `XIO: fatal IO error`.
    display: *mut xlib::Display,
    /// A second connection, used only to watch the game's window.
    ///
    /// Separate on purpose. Watching means `XNextEvent`, and pulling events off GDK's connection
    /// would take them out of GTK's own main loop — the web view would stop repainting and the
    /// cause would look like a rendering bug. Event masks are per-client, so selecting here also
    /// leaves SDL's own selection on that window untouched.
    observer: *mut xlib::Display,
    /// `libXext`, for the input shape. Also opened once, for the same reason.
    shape: libloading::Library,
    /// The last geometry pushed to the server, so an unchanged frame costs no request at all.
    bounds: std::cell::Cell<(i32, i32, u32, u32)>,
    /// Whether the overlay is currently mapped, tracked so a minimise does not fight a restore.
    mapped: std::cell::Cell<bool>,
    /// The last rectangles the page published, normalized to the viewport.
    ///
    /// Kept because the page has no reason to publish them again when the window resizes — they
    /// are normalized, so they do not change — while the input shape is in pixels and does. A
    /// game taken fullscreen therefore had its islands left at their windowed pixel positions,
    /// and every click landed on the wrong surface until something else moved.
    regions: std::cell::RefCell<Vec<f32>>,
    /// The window size the input shape was last built for.
    ///
    /// Tracked separately from `bounds` because the two can diverge: a window manager resizes a
    /// transient along with its parent, so the overlay changes size without this file ever
    /// issuing the move that would have noticed.
    shape_size: std::cell::Cell<(u32, u32)>,
}

impl Drop for ArgbContainer {
    fn drop(&mut self) {
        unsafe {
            if !self.display.is_null() {
                (self.xlib.XDestroyWindow)(self.display, self.x11_window);
                (self.xlib.XFlush)(self.display);
            }
            // Only the connection this file opened is this file's to close.
            if !self.observer.is_null() {
                (self.xlib.XCloseDisplay)(self.observer);
            }
        }
    }
}

/// One pixel of the container, as the X server holds it.
pub struct Sample {
    pub alpha: u8,
    pub red: u8,
    pub green: u8,
    pub blue: u8,
}

impl ArgbContainer {
    /// Read one pixel back out of the container window.
    ///
    /// This is the measurement that settles transparency without depending on a compositor being
    /// present or on anyone's reading of a screenshot: a depth-32 window holds a real alpha
    /// channel, so a point the UI does not paint must come back with alpha 0 and a point inside a
    /// plate must not. A compositor blends what it is given; the question is whether the web view
    /// gives it anything to blend.
    pub fn sample(&self, x: i32, y: i32) -> Result<Sample, String> {
        self.sample_window(self.x11_window, x, y)
    }

    /// Read one pixel out of any window on this connection. Used by the spike's control arm to
    /// sample `wry`'s own container rather than ours, so the comparison is between two real
    /// containers instead of between a container and nothing.
    pub fn sample_window(&self, window: c_ulong, x: i32, y: i32) -> Result<Sample, String> {
        unsafe {
            let image = (self.xlib.XGetImage)(
                self.display,
                window,
                x,
                y,
                1,
                1,
                u64::MAX,
                xlib::ZPixmap,
            );
            if image.is_null() {
                return Err(format!("XGetImage returned nothing at {x},{y}"));
            }
            let get_pixel = (*image).funcs.get_pixel.ok_or("XImage has no get_pixel")?;
            let pixel = get_pixel(image, 0, 0);
            (self.xlib.XDestroyImage)(image);
            Ok(Sample {
                alpha: ((pixel >> 24) & 0xff) as u8,
                red: ((pixel >> 16) & 0xff) as u8,
                green: ((pixel >> 8) & 0xff) as u8,
                blue: (pixel & 0xff) as u8,
            })
        }
    }

    /// Show the container and everything in it.
    ///
    /// Deliberately not done at creation: GTK only shows widgets that exist when `show_all` runs,
    /// and the web view is added afterwards. Showing early leaves a container that reports itself
    /// visible while painting nothing, which looks exactly like a transparency failure.
    pub fn show(&self) {
        self.window.show_all();
    }

    /// Move and resize the container so it keeps covering the game window.
    ///
    /// A no-op when nothing moved, which is almost every frame: an X request per frame for a
    /// window that did not move is pure waste on the same connection the compositor is using.
    pub fn set_bounds(&self, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
        let next = (x, y, width.max(1), height.max(1));
        let resized = {
            let previous = self.bounds.get();
            (previous.2, previous.3) != (next.2, next.3)
        };
        self.bounds.set(next);
        unsafe {
            (self.xlib.XMoveResizeWindow)(self.display, self.x11_window, next.0, next.1, next.2, next.3);
            (self.xlib.XFlush)(self.display);
        }
        self.window.resize(next.2 as i32, next.3 as i32);
        if resized {
            // GTK sizes a toplevel from the `ConfigureNotify` it gets for its own window, and it
            // never gets one here: the window is *foreign*, created by this file and handed to
            // GTK, so `resize()` alone leaves the allocation at whatever it was when the window
            // was realized. The web view then keeps laying the page out at the old viewport while
            // the input shape — cut from the real window size — has already moved, so a press
            // inside an island landed on empty page: consumed by the overlay, ignored by the page,
            // delivered to nobody. Allocating by hand is what re-lays-out the child.
            gtk::prelude::WidgetExt::size_allocate(
                &self.window,
                &gtk::Allocation::new(0, 0, next.2 as i32, next.3 as i32),
            );
        }
        Ok(())
    }

    /// Put the overlay exactly over the game's client area, if it is not there already.
    ///
    /// Reconciled against the server rather than against a remembered rectangle. The overlay is a
    /// managed window now, so the window manager has its own opinion about where it goes: asking
    /// for a position at creation and trusting it left the overlay a title bar's height out of
    /// place — 14 pixels on KWin — with no later event to correct it, because the *game* had not
    /// moved and only the game was being watched.
    ///
    /// Reading both geometries and moving only on a real difference also makes this converge:
    /// the move generates one more `ConfigureNotify` for our own window, which finds nothing left
    /// to do.
    pub fn sync_to_parent(&self) {
        let Some(target) = self.geometry_of(self.parent) else {
            return;
        };
        if let Some(current) = self.geometry_of(self.x11_window) {
            if current != target {
                let _ = self.set_bounds(target.0, target.1, target.2, target.3);
            }
        }
        // Checked on every sync, not only after a move this file made. The published rectangles
        // are normalized, so the page never republishes on a resize — and the shape is in pixels,
        // so a resize is exactly when it stops being right.
        self.reshape_if_resized(target.2, target.3);
    }

    /// Show the overlay only while the player is actually in the game.
    ///
    /// An override-redirect window is stacked above every application, so without this the HUD
    /// would hang over whatever the player switched to. The signal is the game window's own
    /// `FocusIn`/`FocusOut`, not `_NET_ACTIVE_WINDOW`: under XWayland that property names whatever
    /// the compositor last activated, which is not the game's X window id when the player switches
    /// to a Wayland-native application — measured as the overlay unmapping itself permanently and
    /// every click landing on nothing.
    ///
    /// Called once at attach for the initial state, then driven by events.
    pub fn follow_active_window(&self) {
        unsafe {
            let mut focused: c_ulong = 0;
            let mut revert = 0;
            (self.xlib.XGetInputFocus)(self.observer, &mut focused, &mut revert);
            self.set_mapped(should_show_overlay(focused, |window| {
                self.is_self_or_descendant(window, self.parent)
            }));
        }
    }

    /// Whether `window` is the game window or something inside it — SDL parents its own children,
    /// and focus can land on one of those rather than on the top level.
    fn is_self_or_descendant(&self, window: c_ulong, ancestor: c_ulong) -> bool {
        unsafe {
            let mut current = window;
            for _ in 0..8 {
                if current == ancestor {
                    return true;
                }
                if current == 0 {
                    return false;
                }
                let mut root = 0;
                let mut parent = 0;
                let mut children: *mut c_ulong = std::ptr::null_mut();
                let mut count = 0;
                if (self.xlib.XQueryTree)(
                    self.observer,
                    current,
                    &mut root,
                    &mut parent,
                    &mut children,
                    &mut count,
                ) == 0
                {
                    return false;
                }
                if !children.is_null() {
                    (self.xlib.XFree)(children as *mut _);
                }
                if parent == root {
                    return false;
                }
                current = parent;
            }
            false
        }
    }

    /// Re-apply the remembered rectangles when the window is no longer the size they were cut for.
    fn reshape_if_resized(&self, width: u32, height: u32) {
        if self.shape_size.get() == (width, height) {
            return;
        }
        let regions = self.regions.borrow().clone();
        if regions.is_empty() {
            return;
        }
        self.shape_size.set((width, height));
        let _ = self.apply_input_regions(&regions);
    }

    /// A window's position on the root and its size, as the server has it now.
    fn geometry_of(&self, window: c_ulong) -> Option<(i32, i32, u32, u32)> {
        unsafe {
            let mut attributes: xlib::XWindowAttributes = std::mem::zeroed();
            if (self.xlib.XGetWindowAttributes)(self.observer, window, &mut attributes) == 0 {
                return None;
            }
            let screen = (self.xlib.XDefaultScreen)(self.observer);
            let root = (self.xlib.XRootWindow)(self.observer, screen);
            let (x, y) = absolute_origin(&self.xlib, self.observer, root, window);
            Some((x, y, attributes.width.max(1) as u32, attributes.height.max(1) as u32))
        }
    }

    /// Show or hide the overlay with the game window.
    ///
    /// A minimised game must not leave its HUD on screen, and a restored one must get it back.
    /// Tracked rather than asked, because `XMapWindow` on an already-mapped window is a request
    /// the server still has to process.
    pub fn set_mapped(&self, mapped: bool) {
        if self.mapped.get() == mapped {
            return;
        }
        self.mapped.set(mapped);
        unsafe {
            if mapped {
                (self.xlib.XMapWindow)(self.display, self.x11_window);
            } else {
                (self.xlib.XUnmapWindow)(self.display, self.x11_window);
            }
            (self.xlib.XFlush)(self.display);
        }
    }

    /**
     * Follow the game window: geometry, stacking, and whether it is on screen at all.
     *
     * Driven by the server rather than polled. The overlay's own connection selects
     * `StructureNotify` on the game's window — event masks are per-client, so SDL's own selection
     * is untouched — and the host drains them once a frame. Polling SDL for a rectangle every
     * frame worked, and it also meant the overlay lagged a resize by a frame and knew nothing
     * about stacking or minimising at all.
     *
     * Returns false when the game window has gone away, which is the host's signal to detach.
     */
    pub fn follow_parent(&self) -> bool {
        unsafe {
            let mut alive = true;
            while (self.xlib.XPending)(self.observer) > 0 {
                let mut event: xlib::XEvent = std::mem::zeroed();
                (self.xlib.XNextEvent)(self.observer, &mut event);
                match event.get_type() {
                    xlib::ConfigureNotify => {
                        let window = event.configure.window;
                        if window != self.parent && window != self.frame && window != self.x11_window
                        {
                            continue;
                        }
                        // Never the event's own x and y: for a client inside a manager's frame
                        // they are relative to that frame, and for our own window they are what
                        // the manager decided rather than what was asked for.
                        self.sync_to_parent();
                    }
                    xlib::FocusIn => {
                        if event.focus_change.window == self.parent {
                            self.set_mapped(true);
                        }
                    }
                    xlib::FocusOut => {
                        if event.focus_change.window == self.parent {
                            self.set_mapped(false);
                        }
                    }
                    xlib::MapNotify => {
                        if event.map.window == self.parent {
                            self.set_mapped(true);
                        }
                    }
                    xlib::UnmapNotify => {
                        if event.unmap.window == self.parent {
                            self.set_mapped(false);
                        }
                    }
                    xlib::DestroyNotify => {
                        if event.destroy_window.window == self.parent {
                            alive = false;
                        }
                    }
                    _ => {}
                }
            }
            alive
        }
    }

    pub fn set_input_regions(&self, regions: &[f32]) -> Result<(), String> {
        self.regions.replace(regions.to_vec());
        self.apply_input_regions(regions)
    }

    /// Push the remembered rectangles at the window's current size.
    fn apply_input_regions(&self, regions: &[f32]) -> Result<(), String> {
        unsafe {
            let combine: libloading::Symbol<
                unsafe extern "C" fn(
                    *mut xlib::Display,
                    c_ulong,
                    i32,
                    i32,
                    i32,
                    *mut XRectangle,
                    i32,
                    i32,
                    i32,
                ),
            > = self
                .shape
                .get(b"XShapeCombineRectangles\0")
                .map_err(|error| format!("XShapeCombineRectangles: {error}"))?;

            // The overlay's real size, asked of the server: the published rectangles are
            // normalized to the viewport, and this is the only place they become pixels.
            let (_, _, pixel_width, pixel_height) = self
                .geometry_of(self.x11_window)
                .unwrap_or_else(|| self.bounds.get());
            self.shape_size.set((pixel_width, pixel_height));
            let (width, height) = (pixel_width as f32, pixel_height as f32);

            let mut rectangles: Vec<XRectangle> = Vec::with_capacity(regions.len() / 4);
            for region in regions.chunks_exact(4) {
                rectangles.push(XRectangle {
                    x: (region[0] * width).round() as i16,
                    y: (region[1] * height).round() as i16,
                    width: (region[2] * width).round().max(0.0) as u16,
                    height: (region[3] * height).round().max(0.0) as u16,
                });
            }
            if std::env::var("TN_UI_OVERLAY_TRACE").is_ok() {
                eprintln!(
                    "TN_UI_SHAPE:{{\"window\":{},\"size\":[{},{}],\"rects\":{:?}}}",
                    self.x11_window,
                    width as i32,
                    height as i32,
                    rectangles
                        .iter()
                        .map(|r| (r.x, r.y, r.width, r.height))
                        .collect::<Vec<_>>()
                );
            }
            // ShapeInput = 2, ShapeSet = 0, YXBanded = 1. An empty set is a window that takes no
            // pointer events at all, which is exactly right for a UI with no interactive islands.
            combine(
                self.display,
                self.x11_window,
                2,
                0,
                0,
                rectangles.as_mut_ptr(),
                rectangles.len() as i32,
                0,
                1,
            );
            (self.xlib.XFlush)(self.display);
        }
        Ok(())
    }
}

/// Where the container sits relative to the window SDL owns.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    /// An X11 child of the game window.
    ///
    /// Kept because it is what `wry`'s own `build_as_child` does and because it is the right
    /// answer on hosts whose window system composites within a window — every one except X11.
    /// On X11 it cannot be transparent whatever its depth: a child window's contents occlude the
    /// parent rather than blending with it, and only a compositor blends, and compositors
    /// redirect top-level windows.
    Child,
    /// A top-level window the window manager keeps tied to the game's.
    ///
    /// The compositor blends this one, so the game shows through the UI's transparent regions with
    /// real per-pixel alpha — which a child window does not get, because compositors redirect
    /// top-level windows and a child's contents merely occlude its parent.
    ///
    /// **Not override-redirect.** That was the first attempt and it is wrong here: an
    /// override-redirect window is what menus and tooltips use, so a compositing window manager
    /// stacks it above everything. Measured on KWin as the overlay sitting at index 17 of the
    /// root's 19 children while the game sat at index 1 — floating over every other application —
    /// and re-asserting `Above sibling` on each `ConfigureNotify` both failed to stick and lost
    /// button presses that arrived during the restack.
    ///
    /// A transient utility window instead. The manager already knows how to keep a transient above
    /// its parent and below other applications, hide it when the parent is minimised, and leave it
    /// out of the task bar and the alt-tab list — all of which this file was doing by hand, badly.
    Overlay,
}

/// Create a transparent container over `parent`, sized `width` x `height`.
pub fn create(
    parent: c_ulong,
    width: u32,
    height: u32,
    placement: Placement,
) -> Result<ArgbContainer, String> {
    let xlib = xlib::Xlib::open().map_err(|error| format!("xlib: {error}"))?;
    let gdk_display = gdk::Display::default().ok_or("no GDK display; is GDK_BACKEND=x11 set?")?;
    let x11_display: &X11Display = gdk_display
        .downcast_ref()
        .ok_or("the GDK display is not X11; wry's Linux backend needs XWayland here")?;
    let display = unsafe {
        gdkx11::ffi::gdk_x11_display_get_xdisplay(x11_display.to_glib_none().0) as *mut xlib::Display
    };

    unsafe {
        let screen = (xlib.XDefaultScreen)(display);
        let mut visual_info: xlib::XVisualInfo = std::mem::zeroed();
        // TrueColor at depth 32 is the ARGB visual every compositing-capable server exposes; a
        // server without one cannot host a transparent overlay at all, and says so here rather
        // than by drawing a black rectangle over the game.
        if (xlib.XMatchVisualInfo)(display, screen, 32, xlib::TrueColor, &mut visual_info) == 0 {
            return Err("this X server exposes no 32-bit TrueColor visual".into());
        }
        let root = (xlib.XRootWindow)(display, screen);
        let container_parent = if placement == Placement::Child { parent } else { root };
        let (origin_x, origin_y) = if placement == Placement::Child {
            (0, 0)
        } else {
            absolute_origin(&xlib, display, root, parent)
        };
        let colormap =
            (xlib.XCreateColormap)(display, container_parent, visual_info.visual, xlib::AllocNone);
        let mut attributes: xlib::XSetWindowAttributes = std::mem::zeroed();
        attributes.colormap = colormap;
        attributes.background_pixel = 0;
        attributes.border_pixel = 0;
        // Override-redirect, and the reason is input.
        //
        // A *managed* window was tried — transient for the game, utility type, undecorated — and
        // its stacking was perfect: the manager kept it directly above the game and below every
        // other application, through moves, resizes, fullscreen and minimise. It also never
        // delivered a single button press to the web view. Measured with and without the input
        // shape, with and without the `input = False` hint, and with the overlay explicitly given
        // focus: zero presses in every combination. Override-redirect delivers them reliably.
        //
        // What override-redirect costs is stacking: a compositing manager treats these as menus
        // and puts them above everything, so the overlay would hang over other applications when
        // the game is not in front. `follow_active_window` is the answer to that — the overlay is
        // unmapped whenever the game is not the active window, which is also what a player would
        // expect of a HUD belonging to a game they have switched away from.
        attributes.override_redirect = i32::from(placement == Placement::Overlay);
        // The events the web view needs to be interactive at all.
        //
        // `XCreateWindow` selects nothing by default, and GTK wrapping a *foreign* window does not
        // add its own mask the way it does for one it created. Without this the overlay draws
        // perfectly, the X server routes clicks to it correctly — and the page never sees a
        // pointer, so every button is dead for a reason no screenshot can show.
        attributes.event_mask = xlib::ExposureMask
            | xlib::StructureNotifyMask
            | xlib::ButtonPressMask
            | xlib::ButtonReleaseMask
            | xlib::PointerMotionMask
            | xlib::EnterWindowMask
            | xlib::LeaveWindowMask
            | xlib::KeyPressMask
            | xlib::KeyReleaseMask
            | xlib::FocusChangeMask;
        let x11_window = (xlib.XCreateWindow)(
            display,
            container_parent,
            origin_x,
            origin_y,
            width.max(1),
            height.max(1),
            0,
            32,
            xlib::InputOutput as u32,
            visual_info.visual,
            xlib::CWColormap
                | xlib::CWBackPixel
                | xlib::CWBorderPixel
                | xlib::CWOverrideRedirect
                | xlib::CWEventMask,
            &mut attributes,
        );
        if x11_window == 0 {
            return Err("XCreateWindow returned no window".into());
        }
        if placement == Placement::Overlay {
            // Still declared, even though an override-redirect window is unmanaged: a compositor
            // that reads these decides how to animate and group the surface, and saying "utility,
            // belongs to that game" costs nothing and reads correctly where it is honoured.
            declare_transient_utility(&xlib, display, x11_window, parent);
        }
        (xlib.XMapWindow)(display, x11_window);
        (xlib.XFlush)(display);

        // Mirror wry's own GTK wrapping, with one addition: the GTK window is given the screen's
        // RGBA visual and marked app-paintable before it is realized, so GTK does not paint an
        // opaque theme background over the alpha the web view is about to produce.
        let gdk_window = gdkx11::ffi::gdk_x11_window_foreign_new_for_display(
            x11_display.to_glib_none().0,
            x11_window,
        );
        let gdk_window: gdk::Window = gtk::glib::translate::from_glib_full(gdk_window);
        // GDK keeps its own event mask per window and filters incoming X events against it. A
        // *foreign* window arrives with that mask empty, so pointer events the X server dutifully
        // delivered were dropped before GTK ever saw them: the overlay rendered, sat in the right
        // place, and had dead buttons. Setting the X-level mask at creation is not enough — that
        // only decides what the server sends.
        gdk_window.set_events(
            gdk::EventMask::BUTTON_PRESS_MASK
                | gdk::EventMask::BUTTON_RELEASE_MASK
                | gdk::EventMask::POINTER_MOTION_MASK
                | gdk::EventMask::SCROLL_MASK
                | gdk::EventMask::SMOOTH_SCROLL_MASK
                | gdk::EventMask::ENTER_NOTIFY_MASK
                | gdk::EventMask::LEAVE_NOTIFY_MASK
                | gdk::EventMask::KEY_PRESS_MASK
                | gdk::EventMask::KEY_RELEASE_MASK
                | gdk::EventMask::FOCUS_CHANGE_MASK
                | gdk::EventMask::STRUCTURE_MASK
                | gdk::EventMask::EXPOSURE_MASK
                | gdk::EventMask::TOUCH_MASK,
        );
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_app_paintable(true);
        if let Some(rgba) = gtk::prelude::WidgetExt::screen(&window).and_then(|screen| screen.rgba_visual()) {
            window.set_visual(Some(&rgba));
        }
        window.connect_realize(gtk::glib::clone!(@weak gdk_window as wd => move |w| w.set_window(wd)));
        window.set_has_window(true);
        window.realize();

        let vbox = gtk::Box::new(gtk::Orientation::Vertical, 0);
        vbox.set_app_paintable(true);
        window.add(&vbox);

        let mut window_attributes: xlib::XWindowAttributes = std::mem::zeroed();
        (xlib.XGetWindowAttributes)(display, x11_window, &mut window_attributes);

        // The observer connection, and the one selection that makes the overlay follow the game.
        // `StructureNotify` on the game's window reports every move, resize, restack, map and
        // unmap it undergoes — which is the whole set of things that can leave an overlay in the
        // wrong place, behind the wrong window, or on screen after the game is minimised.
        let observer = (xlib.XOpenDisplay)(std::ptr::null());
        if observer.is_null() {
            (xlib.XDestroyWindow)(display, x11_window);
            return Err("could not open a second X connection to watch the game window".into());
        }
        // Structure for geometry and mapping, focus for whether the player is in the game at all.
        (xlib.XSelectInput)(observer, parent, xlib::StructureNotifyMask | xlib::FocusChangeMask);
        // Our own window too: the manager may place it somewhere other than where it was asked,
        // and that move arrives as a ConfigureNotify on us rather than on the game.
        (xlib.XSelectInput)(observer, x11_window, xlib::StructureNotifyMask);

        // And the manager's frame, if the game has one. Walking up to the child of the root finds
        // it whether the manager reparents once, twice, or not at all.
        let frame = frame_window(&xlib, observer, parent);
        if frame != parent {
            (xlib.XSelectInput)(observer, frame, xlib::StructureNotifyMask);
        }
        (xlib.XFlush)(observer);

        let shape = libloading::Library::new("libXext.so.6")
            .map_err(|error| format!("libXext: {error}"))?;

        let container = ArgbContainer {
            vbox,
            window,
            x11_window,
            parent,
            frame,
            depth: window_attributes.depth,
            xlib,
            display,
            observer,
            shape,
            bounds: std::cell::Cell::new((origin_x, origin_y, width.max(1), height.max(1))),
            mapped: std::cell::Cell::new(true),
            regions: std::cell::RefCell::new(Vec::new()),
            shape_size: std::cell::Cell::new((0, 0)),
        };
        if placement == Placement::Overlay {
            container.sync_to_parent();
            container.follow_active_window();
        }
        Ok(container)
    }
}

/// Read a redirected window's contents, which is the only way to see them under a compositor.
///
/// A compositing manager redirects every top-level window to an offscreen pixmap and draws that
/// pixmap itself. `XGetImage` on the window then returns nothing useful — measured here as
/// `argb 0 0 0 0` on a KWin session for a web view that reads back correctly on a bare X server.
/// So the measurement has to name the pixmap the compositor is actually blending.
///
/// `libXcomposite` is opened at run time rather than linked: this is diagnostic code, and a
/// display without the extension should report that rather than fail to start the game.
pub struct RedirectedImage {
    pub width: u32,
    pub height: u32,
    /// Row-major BGRA, as the X server stores it.
    pub pixels: Vec<u8>,
}

/// Read a window's contents directly, valid only when nothing has redirected it.
///
/// The plain path, and the one that works on a bare X server. Under a compositor this returns
/// nothing useful and `read_redirected` is the answer; on this machine's XWayland session neither
/// reaches WebKit's surface, which is a property of the session rather than of the overlay.
pub fn read_window(window: c_ulong) -> Result<RedirectedImage, String> {
    read_drawable(window, false)
}

pub fn read_redirected(window: c_ulong) -> Result<RedirectedImage, String> {
    read_drawable(window, true)
}

/// Read the root window — everything drawn on a bare X server, in one image.
///
/// The game presents through Vulkan, so `XGetImage` on the game window itself comes back empty;
/// the root holds what the X server actually has on screen, which is why the game is visible there
/// and nowhere else on this lane.
pub fn read_root() -> Result<RedirectedImage, String> {
    let xlib = xlib::Xlib::open().map_err(|error| format!("xlib: {error}"))?;
    unsafe {
        let display = (xlib.XOpenDisplay)(std::ptr::null());
        if display.is_null() {
            return Err("no X display".into());
        }
        let screen = (xlib.XDefaultScreen)(display);
        let root = (xlib.XRootWindow)(display, screen);
        (xlib.XCloseDisplay)(display);
        read_window(root)
    }
}

fn read_drawable(window: c_ulong, redirected: bool) -> Result<RedirectedImage, String> {
    let xlib = xlib::Xlib::open().map_err(|error| format!("xlib: {error}"))?;
    unsafe {
        let composite = if redirected {
            Some(
                libloading::Library::new("libXcomposite.so.1")
                    .map_err(|error| format!("libXcomposite: {error}"))?,
            )
        } else {
            None
        };
        let display = (xlib.XOpenDisplay)(std::ptr::null());
        if display.is_null() {
            return Err("no X display".into());
        }
        let mut attributes: xlib::XWindowAttributes = std::mem::zeroed();
        (xlib.XGetWindowAttributes)(display, window, &mut attributes);
        let (width, height) = (attributes.width.max(1), attributes.height.max(1));

        let pixmap = match composite.as_ref() {
            None => window,
            Some(library) => {
                let name_pixmap: libloading::Symbol<
                    unsafe extern "C" fn(*mut xlib::Display, c_ulong) -> c_ulong,
                > = library
                    .get(b"XCompositeNameWindowPixmap\0")
                    .map_err(|error| format!("XCompositeNameWindowPixmap: {error}"))?;
                let pixmap = name_pixmap(display, window);
                if pixmap == 0 {
                    (xlib.XCloseDisplay)(display);
                    return Err("the window is not redirected; there is no pixmap to read".into());
                }
                pixmap
            }
        };
        let image = (xlib.XGetImage)(
            display,
            pixmap,
            0,
            0,
            width as u32,
            height as u32,
            u64::MAX,
            xlib::ZPixmap,
        );
        if image.is_null() {
            if composite.is_some() {
                (xlib.XFreePixmap)(display, pixmap);
            }
            (xlib.XCloseDisplay)(display);
            return Err("XGetImage on the redirected pixmap returned nothing".into());
        }
        let stride = (*image).bytes_per_line as usize;
        let data = (*image).data as *const u8;
        let mut pixels = vec![0u8; (width as usize) * (height as usize) * 4];
        for row in 0..height as usize {
            let source = data.add(row * stride);
            let target = row * width as usize * 4;
            std::ptr::copy_nonoverlapping(source, pixels[target..].as_mut_ptr(), width as usize * 4);
        }
        (xlib.XDestroyImage)(image);
        if composite.is_some() {
            (xlib.XFreePixmap)(display, pixmap);
        }
        (xlib.XCloseDisplay)(display);
        Ok(RedirectedImage {
            width: width as u32,
            height: height as u32,
            pixels,
        })
    }
}



/// Whether the overlay belongs on screen, given whatever `XGetInputFocus` just reported.
///
/// Split out from the call so it can be tested: the two constants below are unreachable on a
/// display whose session takes focus explicitly, which is every display this repository can
/// drive, and they are exactly the values a session without a window manager reports forever.
///
/// `PointerRoot` (1) and `None` (0) are not window ids. The first means focus follows the
/// pointer, the second that nothing holds focus at all. Neither says "another application took
/// over", which is the only thing the overlay hides for — so treating them as "not the game"
/// left it permanently unmapped, with every press landing on the game underneath.
pub(crate) fn should_show_overlay(focused: c_ulong, belongs_to_game: impl Fn(c_ulong) -> bool) -> bool {
    match focused {
        0 | 1 => true,
        window => belongs_to_game(window),
    }
}

#[cfg(test)]
mod tests {
    use super::should_show_overlay;

    #[test]
    fn shows_the_overlay_while_the_game_holds_focus() {
        assert!(should_show_overlay(42, |window| window == 42));
    }

    #[test]
    fn hides_the_overlay_when_another_application_takes_focus() {
        assert!(!should_show_overlay(99, |window| window == 42));
    }

    #[test]
    fn shows_the_overlay_when_focus_follows_the_pointer() {
        // PointerRoot. A session with no window manager reports this forever, and reading it as
        // another application left the overlay unmapped for the whole run.
        assert!(should_show_overlay(1, |_| panic!("PointerRoot is not a window id to walk")));
    }

    #[test]
    fn shows_the_overlay_when_nothing_holds_focus() {
        assert!(should_show_overlay(0, |_| panic!("None is not a window id to walk")));
    }
}
