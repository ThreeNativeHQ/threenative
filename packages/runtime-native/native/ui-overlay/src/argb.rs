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

pub struct ArgbContainer {
    /// The GTK container `wry` renders into.
    pub vbox: gtk::Box,
    /// Kept alive for as long as the web view: dropping it destroys the container.
    pub window: gtk::Window,
    /// The X11 child window, for the input-shape protocol and for reporting its depth.
    pub x11_window: c_ulong,
    /// The depth actually obtained. 32 is the point of this file; anything else is a failure.
    pub depth: i32,
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
        let xlib = xlib::Xlib::open().map_err(|error| format!("xlib: {error}"))?;
        unsafe {
            let display = (xlib.XOpenDisplay)(std::ptr::null());
            if display.is_null() {
                return Err("no X display".into());
            }
            let image = (xlib.XGetImage)(
                display,
                self.x11_window,
                x,
                y,
                1,
                1,
                u64::MAX,
                xlib::ZPixmap,
            );
            if image.is_null() {
                (xlib.XCloseDisplay)(display);
                return Err(format!("XGetImage returned nothing at {x},{y}"));
            }
            let get_pixel = (*image).funcs.get_pixel.ok_or("XImage has no get_pixel")?;
            let pixel = get_pixel(image, 0, 0);
            (xlib.XDestroyImage)(image);
            (xlib.XCloseDisplay)(display);
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
    /// A top-level, override-redirect window held over the game window.
    ///
    /// The compositor blends this one, so the game shows through the UI's transparent regions with
    /// real per-pixel alpha. The cost is that it is a window: it has to follow the game window's
    /// position and size, and it has to let input through everywhere the UI is not — which is the
    /// hit-region protocol, applied through the X server as an input shape.
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
        // Override-redirect keeps the window manager from decorating, tiling or focusing the
        // overlay: it is a layer of the game's window, not a window of its own as far as the
        // player is concerned.
        attributes.override_redirect = i32::from(placement == Placement::Overlay);
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
            xlib::CWColormap | xlib::CWBackPixel | xlib::CWBorderPixel | xlib::CWOverrideRedirect,
            &mut attributes,
        );
        if x11_window == 0 {
            return Err("XCreateWindow returned no window".into());
        }
        (xlib.XMapWindow)(display, x11_window);
        if placement == Placement::Overlay {
            (xlib.XRaiseWindow)(display, x11_window);
        }
        (xlib.XFlush)(display);

        // Mirror wry's own GTK wrapping, with one addition: the GTK window is given the screen's
        // RGBA visual and marked app-paintable before it is realized, so GTK does not paint an
        // opaque theme background over the alpha the web view is about to produce.
        let gdk_window = gdkx11::ffi::gdk_x11_window_foreign_new_for_display(
            x11_display.to_glib_none().0,
            x11_window,
        );
        let gdk_window: gdk::Window = gtk::glib::translate::from_glib_full(gdk_window);
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

        Ok(ArgbContainer {
            vbox,
            window,
            x11_window,
            depth: window_attributes.depth,
        })
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
