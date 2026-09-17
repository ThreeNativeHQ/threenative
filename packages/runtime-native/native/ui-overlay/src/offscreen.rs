//! The Linux UI layer: a web view rendered offscreen, handed to the game as a texture.
//!
//! This replaces an X11 override-redirect top-level window blended by whatever compositing manager
//! happened to be running. Two defects came from that design and both are structural, not bugs:
//! nothing painted at all on a KDE Wayland session (the overlay window was mapped and empty), and
//! the web view was serviced only from the game loop, so it got about three turns in the thirty-eight
//! seconds a measured launch spent loading and its page finished mounting after the game had already
//! hidden its loading screen. See PRD-393.
//!
//! What is here instead:
//!
//! - **No window.** `GtkOffscreenWindow` plus a `WebKitWebView`, so nothing is mapped, nothing is
//!   blended by an external compositor, and the game's own swapchain carries every UI pixel.
//! - **Off the game loop.** GTK and WebKit are not thread-safe and must not run where JavaScript
//!   runs: that was measured, and pumping GTK between module evaluations broke rendering. So they
//!   own a thread, and the game loop never calls into either — it reads a mailbox.
//! - **A mailbox, not a queue.** At most one published frame is retained, latest wins, with a
//!   monotonic counter. The game either takes the newest frame or the one it already has.
//!
//! The frame the game gets is a cairo `ARGB32` surface read straight out of WebKit, which on a
//! little-endian host is `B,G,R,A` — premultiplied, because cairo's ARGB32 is. The composite side
//! uploads it as `BGRA8Unorm` and blends with `src = One`, which is what premultiplied means.
//!
//! **The web view must not use accelerated compositing.** A `GtkOffscreenWindow` has no `GdkWindow`
//! to host a GL surface, and WebKit does not fall back from that — it aborts the process with
//! "GDK is not able to create a GL context: The current backend does not support OpenGL" (measured;
//! `probe-gtk-offscreen` with `TN_GTK_COMPOSITING=1` exits 134). So `hardware_acceleration_policy`
//! is pinned to `Never` and the page rasterizes on the CPU inside the web process. That is the
//! measured cost this backend carries, and the reason the snapshot cadence below is demand-driven
//! rather than a fixed 60 Hz.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::cell::RefCell;
use std::time::{Duration, Instant};

use gtk::prelude::*;
use javascriptcore::ValueExt as _;
use webkit2gtk::{
    SettingsExt, SnapshotOptions, SnapshotRegion, URISchemeRequestExt, UserContentManagerExt,
    WebContextExt, WebView, WebViewExt,
};

/// The private script-message channel the page reports keyboard focus on.
///
/// Not part of the bridge contract: `@threenative/core/ui-bridge` knows nothing about it and must
/// not, because it is a fact about this host (there is no window, so nothing else can tell the host
/// where a key should go) rather than something the game or the page is asked to implement.
const KEY_FOCUS_CHANNEL: &str = "tnKeyFocus";

/// How long after a change to ask for the next snapshot.
///
/// The page's own rAF runs at 60 Hz, so anything shorter than this re-rasterizes the same pixels.
const BUSY_INTERVAL: Duration = Duration::from_millis(16);
/// Where the backoff stops once the page has stopped changing.
const IDLE_INTERVAL: Duration = Duration::from_millis(250);
/// How often the web thread looks for work from the game. This is the ceiling on pointer latency.
const SERVICE_INTERVAL: Duration = Duration::from_millis(8);
/// Attach waits this long for the web thread to say whether it came up.
const READY_TIMEOUT: Duration = Duration::from_secs(20);

/// One completed web-view frame, shared between the web thread and the game thread.
///
/// The pixels are behind an `Arc` so publishing never copies: the web thread compares the buffer it
/// just wrote against the one it published last, and hands the same allocation to the mailbox.
struct Frame {
    pixels: Arc<Vec<u8>>,
    width: u32,
    height: u32,
    stride: u32,
    counter: u64,
}

/// The newest frame, and the buffer the game is already looking at.
///
/// Latest wins: a game loop that stalls for two seconds finds one frame when it comes back, not a
/// hundred and twenty of them, and the counter says how many the web view actually produced.
#[derive(Default)]
struct MailboxState {
    pending: Option<Frame>,
    published: u64,
}

#[derive(Default)]
pub struct Mailbox {
    state: Mutex<MailboxState>,
    held: Mutex<Option<Frame>>,
    counter: AtomicU64,
}

/// What the game thread is told about the frame it is currently holding.
///
/// `pixels` stays valid until the next `acquire`, which is the whole contract: the game uses it
/// inside one frame and asks again next frame.
pub struct FrameView {
    pub pixels: *const u8,
    pub length: usize,
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub counter: u64,
}

impl Mailbox {
    fn publish(&self, pixels: Arc<Vec<u8>>, width: u32, height: u32, stride: u32) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.published += 1;
        state.pending = Some(Frame {
            pixels,
            width,
            height,
            stride,
            counter: state.published,
        });
        self.counter.store(state.published, Ordering::Release);
    }

    /// How many frames the web view has published. Monotonic for the life of the overlay.
    pub fn published(&self) -> u64 {
        self.counter.load(Ordering::Acquire)
    }

    /// Give the game the newest frame, keeping it when nothing newer has arrived.
    ///
    /// Returns `None` only before the page's first paint. Called once per frame by the game thread.
    pub fn acquire(&self) -> Option<FrameView> {
        let mut held = self.held.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(pending) = self
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .pending
            .take()
        {
            *held = Some(pending);
        }
        held.as_ref().map(|frame| FrameView {
            pixels: frame.pixels.as_ptr(),
            length: frame.pixels.len(),
            width: frame.width,
            height: frame.height,
            stride: frame.stride,
            counter: frame.counter,
        })
    }

    /// Drop the retained frame. Detach only; the game does not release between frames.
    pub fn release(&self) {
        *self.held.lock().unwrap_or_else(|error| error.into_inner()) = None;
    }
}

/// One request from the game thread to the web thread.
pub enum Command {
    /// Tear the web view down and leave the main loop. The game thread joins after sending it.
    Stop,
    /// The game window changed size, in pixels.
    Resize { width: u32, height: u32 },
    /// Deliver one JSON frame to the page.
    Post(String),
    /// Dispatch one synthetic DOM pointer event.
    Pointer {
        kind: String,
        nx: f32,
        ny: f32,
        buttons: i32,
        pointer_id: i32,
    },
    /// Dispatch one synthetic DOM keyboard event.
    Key {
        kind: String,
        key: String,
        code: String,
        text: String,
        ctrl: bool,
        alt: bool,
        shift: bool,
        meta: bool,
    },
}

/// Everything the two threads share.
#[derive(Default)]
pub struct Shared {
    pub frames: Mailbox,
    commands: Mutex<VecDeque<Command>>,
    inbound: Mutex<Vec<String>>,
    /// Set when the web thread could not start at all, so attach can report it rather than hang.
    pub failed: AtomicBool,
    /// Whether the page holds the keyboard: a focused input, textarea, select or the open list.
    /// Reported by the page on every focus change, read by the game loop before it forwards a key.
    keyboard_captured: AtomicBool,
}

impl Shared {
    pub fn push_command(&self, command: Command) {
        self.commands
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push_back(command);
    }

    fn take_command(&self) -> Option<Command> {
        self.commands
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .pop_front()
    }

    /// Called on the web thread with one frame the page sent.
    pub fn push_inbound(&self, frame: String) {
        self.inbound
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(frame);
    }

    /// Called on the web thread with the page's answer to "do you hold the keyboard".
    fn set_keyboard_captured(&self, captured: bool) {
        self.keyboard_captured.store(captured, Ordering::Release);
    }

    /// Whether the page holds the keyboard. Called on the game thread.
    pub fn keyboard_captured(&self) -> bool {
        self.keyboard_captured.load(Ordering::Acquire)
    }

    /// Pop the oldest frame the page sent. Called on the game thread.
    pub fn take_inbound(&self) -> Option<String> {
        let mut queue = self.inbound.lock().unwrap_or_else(|error| error.into_inner());
        if queue.is_empty() {
            return None;
        }
        Some(queue.remove(0))
    }
}

/// The attached overlay: the web thread, and what the game talks to.
pub struct Overlay {
    pub shared: Arc<Shared>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Overlay {
    pub fn detach(&mut self) {
        self.shared.push_command(Command::Stop);
        self.shared.frames.release();
        if let Some(thread) = self.thread.take() {
            // Bounded: the web thread sees `Stop` on its next service tick. Joining rather than
            // detaching because a wrecked web view outliving its window is worse than a bounded
            // wait at shutdown.
            let _ = thread.join();
        }
    }
}

impl Drop for Overlay {
    fn drop(&mut self) {
        self.detach();
    }
}

/// Start the web view on its own thread and wait until it is up.
pub fn spawn(ui_root: PathBuf, width: u32, height: u32) -> Result<Overlay, ()> {
    let shared = Arc::new(Shared::default());
    let (ready_tx, ready_rx) = channel::<bool>();
    let thread_shared = Arc::clone(&shared);
    let thread = std::thread::Builder::new()
        .name("tn-ui-web".to_string())
        .spawn(move || web_thread(ui_root, width, height, thread_shared, ready_tx))
        .map_err(|_| ())?;
    match ready_rx.recv_timeout(READY_TIMEOUT) {
        Ok(true) => Ok(Overlay {
            shared,
            thread: Some(thread),
        }),
        Ok(false) | Err(_) => {
            shared.failed.store(true, Ordering::Release);
            let _ = thread.join();
            Err(())
        }
    }
}

/// The web thread: GDK init, one web view, one main loop, and nothing else ever touches it.
fn web_thread(
    ui_root: PathBuf,
    width: u32,
    height: u32,
    shared: Arc<Shared>,
    ready: Sender<bool>,
) {
    if gtk::init().is_err() {
        shared.failed.store(true, Ordering::Release);
        let _ = ready.send(false);
        return;
    }

    let context = webkit2gtk::WebContext::new();
    // A custom protocol, not `file://` — the desktop counterpart of Android's
    // `WebViewAssetLoader`, and what gives the page a real origin so `fetch`, module imports and
    // same-origin rules behave as they do on the web build.
    let root = ui_root.clone();
    context.register_uri_scheme("threenative", move |request| {
        serve(&root, request);
    });

    let content_manager = webkit2gtk::UserContentManager::new();
    content_manager.register_script_message_handler("tnHost");
    let inbound = Arc::clone(&shared);
    content_manager.connect_script_message_received(Some("tnHost"), move |_, result| {
        // The page's outbound half is `window.webkit.messageHandlers.tnHost.postMessage(frame)`,
        // which `@threenative/core/ui-bridge` already discovers on its own. No shim is injected.
        if let Some(value) = result.js_value() {
            if value.is_string() {
                inbound.push_inbound(value.to_str().to_string());
            }
        }
    });

    // The page's answer to "do you hold the keyboard". Private to this host: the page reports it,
    // the game loop reads it, and nothing else sees it. It is what lets the host forward keys to a
    // focused control and leave every other key to the game.
    content_manager.register_script_message_handler(KEY_FOCUS_CHANNEL);
    let focus_shared = Arc::clone(&shared);
    content_manager.connect_script_message_received(Some(KEY_FOCUS_CHANNEL), move |_, result| {
        if let Some(value) = result.js_value() {
            if value.is_string() {
                focus_shared.set_keyboard_captured(value.to_str().as_str() == "1");
            }
        }
    });

    // See `NATIVE_SELECT_SCRIPT`: a `<select>`'s list, which this host cannot otherwise provide.
    content_manager.add_script(&webkit2gtk::UserScript::new(
        NATIVE_SELECT_SCRIPT,
        webkit2gtk::UserContentInjectedFrames::TopFrame,
        webkit2gtk::UserScriptInjectionTime::Start,
        &[],
        &[],
    ));

    let settings = webkit2gtk::Settings::new();
    // See the module comment: accelerated compositing aborts the process on an offscreen window.
    settings.set_hardware_acceleration_policy(webkit2gtk::HardwareAccelerationPolicy::Never);

    let view = webkit2gtk::WebView::builder()
        .web_context(&context)
        .user_content_manager(&content_manager)
        .settings(&settings)
        .build();
    // The page already forces `html, body` transparent; this is the same statement one layer down,
    // so nothing the page forgets to style arrives as an opaque plate over the world.
    view.set_background_color(&gtk::gdk::RGBA::new(0.0, 0.0, 0.0, 0.0));

    let window = gtk::OffscreenWindow::new();
    window.set_size_request(width as i32, height as i32);
    window.add(&view);
    window.show_all();

    let driver = Rc::new(RefCell::new(Driver::new(
        Arc::clone(&shared),
        view.clone(),
        window.clone(),
        width,
        height,
    )));

    let loaded = Rc::clone(&driver);
    view.connect_load_changed(move |_, event| {
        if event == webkit2gtk::LoadEvent::Finished {
            loaded.borrow_mut().loaded();
        }
    });

    // One timer, not two: it drains the game's requests and then decides whether a snapshot is due.
    // Two sources would let a `Post` and a snapshot land in an order neither of them chose.
    let serviced = Rc::clone(&driver);
    gtk::glib::timeout_add_local(SERVICE_INTERVAL, move || {
        Driver::service(&serviced);
        gtk::glib::ControlFlow::Continue
    });

    view.load_uri("threenative://localhost/index.html");

    let main_loop = gtk::glib::MainLoop::new(None, false);
    {
        let mut borrowed = driver.borrow_mut();
        borrowed.main_loop = Some(main_loop.clone());
    }
    let _ = ready.send(true);
    main_loop.run();
}

/// Answer one `threenative://` request out of the staged UI directory.
fn serve(root: &Path, request: &webkit2gtk::URISchemeRequest) {
    let path = request.path().map(|value| value.to_string()).unwrap_or_default();
    let relative = path.trim_start_matches('/');
    let relative = if relative.is_empty() {
        "index.html"
    } else {
        relative
    };
    // Refuse to leave the staged UI directory. The page is local, but it is still the least trusted
    // thing in the process.
    let target = root.join(relative);
    let inside = target
        .canonicalize()
        .ok()
        .zip(root.canonicalize().ok())
        .is_some_and(|(file, root)| file.starts_with(root));
    match (inside, std::fs::read(&target)) {
        (true, Ok(body)) => {
            let length = body.len() as i64;
            let stream =
                gtk::gio::MemoryInputStream::from_bytes(&gtk::glib::Bytes::from_owned(body));
            request.finish(&stream, length, Some(content_type(relative)));
        }
        _ => {
            let mut error = gtk::glib::Error::new(
                gtk::gio::IOErrorEnum::NotFound,
                &format!("threenative://{relative} is not in the staged UI"),
            );
            request.finish_error(&mut error);
        }
    }
}

/// The page script that gives a `<select>` its list, because this host cannot.
///
/// WebKit's `<select>` menu is a native popup, and there is no view for one to open into: the UI
/// is a web view rendered offscreen and composited into the game's own frame. A bare `<select>`
/// would therefore neither show its list nor be operable, which is a control the *previous* overlay
/// did serve — it was a real window with a real popup — so removing the window without replacing
/// this would have quietly broken every game that has a dropdown.
///
/// Injected at document start rather than left to each game, because it is plumbing every game
/// would otherwise repeat and none should write. It is also the only place that can see the
/// synthetic presses the host delivers: those are untrusted DOM events, and a browser never opens a
/// native popup for one.
///
/// It owns **no appearance**. The rows carry `data-tn-native-select-option` and the list carries
/// `data-tn-native-select`; colours, borders and type are the project's, exactly as `DebugOverlay`
/// leaves `[data-threenative-debug-overlay]` to the project. What is set here is geometry — where
/// the list sits, and that it scrolls — because an unpositioned list is not an unstyled control,
/// it is a broken one.
///
/// It reports whether the page holds the keyboard through the private `tnKeyFocus` channel, which
/// is what lets the host forward keys to a focused control and leave every other key to the game.
const NATIVE_SELECT_SCRIPT: &str = r#"
(function () {
  var host = window.tnHost
    || (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.tnHost);
  if (!host) return;                       // the web build keeps its own popup
  if (window.__tnNativeSelectInstalled) return;
  window.__tnNativeSelectInstalled = true;

  var list = null;
  var owner = null;
  var cursor = -1;

  function reportKeyFocus() {
    var active = document.activeElement;
    var holds = !!active && (active.isContentEditable
      || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'
      || active.tagName === 'SELECT' || active.hasAttribute('data-tn-native-select'));
    var handlers = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.tnKeyFocus;
    if (handlers) handlers.postMessage(holds ? '1' : '0');
  }

  function close() {
    if (list && list.parentNode) list.parentNode.removeChild(list);
    list = null;
    owner = null;
    cursor = -1;
    reportKeyFocus();
  }

  function rows() {
    return list ? Array.prototype.slice.call(list.children) : [];
  }

  function highlight(next) {
    var all = rows();
    if (all.length === 0) return;
    cursor = Math.max(0, Math.min(all.length - 1, next));
    for (var i = 0; i < all.length; i++) {
      all[i].setAttribute('aria-selected', String(i === cursor));
    }
    all[cursor].scrollIntoView({ block: 'nearest' });
  }

  function pick(index) {
    var select = owner;
    var options = select ? Array.prototype.slice.call(select.options) : [];
    var option = options[index];
    close();
    if (!option || option.disabled) return;
    select.value = option.value;
    // `input` then `change`, bubbling: a listener written for the browser's own popup must run
    // unchanged, and the value has to be readable from `select.value` when it does.
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function open(select) {
    close();
    var options = Array.prototype.slice.call(select.options);
    if (options.length === 0) return;
    var rect = select.getBoundingClientRect();
    list = document.createElement('div');
    list.setAttribute('data-tn-native-select', '');
    list.setAttribute('role', 'listbox');
    list.style.position = 'fixed';
    list.style.left = rect.left + 'px';
    list.style.top = (rect.bottom + 2) + 'px';
    list.style.minWidth = rect.width + 'px';
    list.style.maxHeight = Math.max(80, Math.min(320, window.innerHeight - rect.bottom - 16)) + 'px';
    list.style.overflowY = 'auto';
    list.style.zIndex = '2147483000';
    options.forEach(function (option, index) {
      var row = document.createElement('div');
      row.setAttribute('role', 'option');
      row.setAttribute('data-tn-native-select-option', '');
      // The host only routes a press to the page inside a published rectangle, and the page
      // publishes the rectangles it can see. A row that did not mark itself here could never be
      // clicked at all — the press would fall through to the game behind the HUD.
      row.setAttribute('data-tn-interactive', '');
      row.textContent = option.textContent;
      if (option.disabled) row.setAttribute('aria-disabled', 'true');
      if (index === select.selectedIndex) row.setAttribute('aria-selected', 'true');
      row.addEventListener('click', function () {
        if (!option.disabled) pick(index);
      });
      list.appendChild(row);
    });
    document.body.appendChild(list);
    owner = select;
    cursor = select.selectedIndex;
    // Focus the control the list belongs to, not the list: the page's own key handlers already
    // ignore keys while a form control has focus, and that is the state this is in.
    if (select.focus) select.focus({ preventScroll: true });
    reportKeyFocus();
  }

  function selectFor(target) {
    if (!target || !target.closest) return null;
    var found = target.closest('select');
    return found && !found.disabled ? found : null;
  }

  document.addEventListener('pointerdown', function (event) {
    var target = event.target;
    if (list && target && target.closest && target.closest('[data-tn-native-select]')) return;
    var select = selectFor(target);
    if (select) {
      // Swallowed in the capture phase so the control's own default handling cannot race the list.
      event.preventDefault();
      event.stopPropagation();
      if (owner === select) close(); else open(select);
      return;
    }
    close();
  }, true);

  document.addEventListener('keydown', function (event) {
    if (!list) return;
    var handled = true;
    if (event.key === 'ArrowDown') highlight(cursor + 1);
    else if (event.key === 'ArrowUp') highlight(cursor - 1);
    else if (event.key === 'Home') highlight(0);
    else if (event.key === 'End') highlight(rows().length - 1);
    else if (event.key === 'Enter' || event.key === ' ') pick(cursor);
    else if (event.key === 'Escape' || event.key === 'Tab') close();
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  document.addEventListener('focusin', reportKeyFocus, true);
  document.addEventListener('focusout', reportKeyFocus, true);
})();
"#;

/// Enough of a MIME table for a built UI bundle. A wrong type here is a stylesheet the page
/// silently ignores, so the common ones are named rather than defaulted.
fn content_type(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, ext)| ext) {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        _ => "application/octet-stream",
    }
}

/// The web thread's state machine: drain the game's requests, then take a snapshot if one is due.
struct Driver {
    shared: Arc<Shared>,
    view: WebView,
    window: gtk::OffscreenWindow,
    main_loop: Option<gtk::glib::MainLoop>,
    size: (u32, u32),
    loaded: bool,
    in_flight: bool,
    next_at: Instant,
    /// Consecutive snapshots that came back byte-identical, which is what the cadence backs off on.
    unchanged: u32,
    /// The bytes published last, kept so an unchanged frame is not published at all.
    previous: Option<Arc<Vec<u8>>>,
    /// Buffers to write the next snapshot into, so a static HUD is not an allocation per tick.
    pool: Vec<Vec<u8>>,
}

impl Driver {
    fn new(
        shared: Arc<Shared>,
        view: WebView,
        window: gtk::OffscreenWindow,
        width: u32,
        height: u32,
    ) -> Self {
        Self {
            shared,
            view,
            window,
            main_loop: None,
            size: (width, height),
            loaded: false,
            in_flight: false,
            next_at: Instant::now(),
            unchanged: 0,
            previous: None,
            pool: Vec::new(),
        }
    }

    fn loaded(&mut self) {
        self.loaded = true;
        // The first paint is worth asking for immediately: this is the frame that carries the
        // loading screen, and the game is still compiling modules behind it.
        self.next_at = Instant::now();
        self.unchanged = 0;
    }

    /// Drain the game's requests, then take a snapshot if one is due.
    ///
    /// Free-standing rather than a method because the snapshot's completion callback needs the same
    /// `Rc` this borrows from, and a `&mut self` method cannot hand that out.
    fn service(driver: &Rc<RefCell<Driver>>) {
        let mut this = driver.borrow_mut();
        while let Some(command) = this.shared.take_command() {
            match command {
                Command::Stop => {
                    if let Some(main_loop) = this.main_loop.take() {
                        main_loop.quit();
                    }
                    return;
                }
                Command::Resize { width, height } => this.resize(width, height),
                Command::Post(frame) => {
                    let script = format!(
                        "window.__tnUiReceive && window.__tnUiReceive({})",
                        serde_frame(&frame)
                    );
                    this.evaluate(&script);
                    this.wake();
                }
                Command::Pointer {
                    kind,
                    nx,
                    ny,
                    buttons,
                    pointer_id,
                } => {
                    let script =
                        crate::pointer_injection_script(&kind, nx, ny, buttons, pointer_id);
                    this.evaluate(&script);
                    this.wake();
                }
                Command::Key {
                    kind,
                    key,
                    code,
                    text,
                    ctrl,
                    alt,
                    shift,
                    meta,
                } => {
                    let script = crate::key_injection_script(
                        &kind, &key, &code, &text, ctrl, alt, shift, meta,
                    );
                    this.evaluate(&script);
                    this.wake();
                }
            }
        }
        if this.loaded && !this.in_flight && Instant::now() >= this.next_at {
            this.request(driver);
        }
    }

    /// A request arrived from the game: the page is about to change, so stop backing off.
    fn wake(&mut self) {
        self.unchanged = 0;
        self.next_at = Instant::now();
    }

    fn resize(&mut self, width: u32, height: u32) {
        if (width, height) == self.size || width == 0 || height == 0 {
            return;
        }
        self.size = (width, height);
        self.window.set_size_request(width as i32, height as i32);
        self.view.set_size_request(width as i32, height as i32);
        self.wake();
    }

    fn evaluate(&self, script: &str) {
        // The completion is unused on purpose: whether an injection landed is the playtest
        // bridge's own business, and an error here means the page has not installed its handler
        // yet, which is a race rather than a fault.
        self.view.evaluate_javascript(
            script,
            None,
            None,
            gtk::gio::Cancellable::NONE,
            |_| {},
        );
    }

    fn request(&mut self, driver: &Rc<RefCell<Driver>>) {
        self.in_flight = true;
        self.view.queue_draw();
        let driver = Rc::clone(driver);
        self.view.snapshot(
            SnapshotRegion::Visible,
            SnapshotOptions::NONE,
            gtk::gio::Cancellable::NONE,
            move |result| driver.borrow_mut().complete(result),
        );
    }

    fn complete(&mut self, result: Result<gtk::cairo::Surface, gtk::glib::Error>) {
        self.in_flight = false;
        let Some((width, height, stride, buffer)) = self.read(result) else {
            // A snapshot that failed or came back in a shape we cannot upload: try again, but not
            // in a tight loop, so a permanently broken web view cannot spin a core.
            self.unchanged = self.unchanged.saturating_add(1);
            self.next_at = Instant::now() + interval(self.unchanged);
            return;
        };
        let unchanged = self
            .previous
            .as_deref()
            .is_some_and(|previous| previous.as_slice() == buffer.as_slice());
        if unchanged {
            self.pool.push(buffer);
            self.unchanged = self.unchanged.saturating_add(1);
        } else {
            let published = Arc::new(buffer);
            self.shared
                .frames
                .publish(Arc::clone(&published), width, height, stride);
            if let Some(previous) = self.previous.replace(published) {
                // Only recyclable when nobody else is holding it: the mailbox keeps its own
                // reference to whatever it published, and the game holds one across a frame.
                if let Ok(recycled) = Arc::try_unwrap(previous) {
                    self.pool.push(recycled);
                }
            }
            self.unchanged = 0;
        }
        self.next_at = Instant::now() + interval(self.unchanged);
    }

    /// Read a completed snapshot into a pooled buffer, or `None` if it is not something we can use.
    fn read(
        &mut self,
        result: Result<gtk::cairo::Surface, gtk::glib::Error>,
    ) -> Option<(u32, u32, u32, Vec<u8>)> {
        let surface = result.ok()?;
        surface.flush();
        let mut image = gtk::cairo::ImageSurface::try_from(surface).ok()?;
        let width = image.width();
        let height = image.height();
        let stride = image.stride();
        if width <= 0 || height <= 0 || stride <= 0 {
            return None;
        }
        let length = (stride as usize) * (height as usize);
        let data = image.data().ok()?;
        if data.len() < length {
            return None;
        }
        let mut buffer = self.pool.pop().unwrap_or_default();
        buffer.clear();
        buffer.extend_from_slice(&data[..length]);
        Some((width as u32, height as u32, stride as u32, buffer))
    }
}

/// How long to wait before the next snapshot: the page's own frame time while it is changing,
/// backing off to a slow poll once it has stopped.
///
/// Deliberately not a constant. A HUD that has not changed costs one CPU raster and one comparison
/// per tick, and at 60 Hz that is a core spent re-drawing the same pixels; at 250 ms it is noise.
/// The page's rAF runs at 60 Hz, so 16 ms is already the fastest a snapshot can be worth taking.
fn interval(unchanged: u32) -> Duration {
    let scaled = BUSY_INTERVAL.saturating_mul(1u32 << unchanged.min(4));
    if scaled > IDLE_INTERVAL {
        IDLE_INTERVAL
    } else {
        scaled
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_interval_backs_off_from_the_page_frame_time_to_a_slow_poll() {
        assert_eq!(interval(0), Duration::from_millis(16));
        assert_eq!(interval(1), Duration::from_millis(32));
        assert_eq!(interval(4), Duration::from_millis(250));
        assert_eq!(
            interval(40),
            Duration::from_millis(250),
            "a page that never changes polls, it does not stop"
        );
    }

    #[test]
    fn the_mailbox_keeps_one_frame_and_counts_every_publication() {
        let mailbox = Mailbox::default();
        assert_eq!(mailbox.published(), 0);
        assert!(mailbox.acquire().is_none());
        mailbox.publish(Arc::new(vec![1, 2, 3, 4]), 1, 1, 4);
        mailbox.publish(Arc::new(vec![5, 6, 7, 8]), 1, 1, 4);
        assert_eq!(mailbox.published(), 2, "every published frame is counted");
        let first = mailbox.acquire().expect("a frame is retained");
        assert_eq!(first.counter, 2, "latest wins");
        unsafe {
            assert_eq!(*first.pixels, 5);
        }
        // Nothing newer: the game keeps the frame it has rather than drawing nothing.
        let again = mailbox.acquire().expect("the held frame survives");
        assert_eq!(again.counter, 2);
        mailbox.release();
        assert!(mailbox.acquire().is_none());
    }

    #[test]
    fn a_frame_carries_its_own_geometry_and_not_the_requested_size() {
        let mailbox = Mailbox::default();
        mailbox.publish(Arc::new(vec![0; 8 * 2 * 4]), 8, 2, 32);
        let frame = mailbox.acquire().expect("a frame is retained");
        assert_eq!((frame.width, frame.height, frame.stride), (8, 2, 32));
    }

    #[test]
    fn the_mailbox_advances_while_the_reader_is_blocked() {
        // What AC-4 asserts, at the mechanism: the web view's thread keeps publishing while the
        // game thread is not running, so a stalled game finds a newer frame than it left behind and
        // finds exactly one of them. The pre-change wiring fed this mailbox *from* the frame loop,
        // where the counter could only move when the loop did — the three turns in thirty-eight
        // seconds the PRD measured, which is why that feeding path is deleted rather than tuned.
        let mailbox = std::sync::Arc::new(Mailbox::default());
        let stop = std::sync::Arc::new(AtomicBool::new(false));
        let publisher = {
            let mailbox = std::sync::Arc::clone(&mailbox);
            let stop = std::sync::Arc::clone(&stop);
            std::thread::spawn(move || {
                let mut value = 0u8;
                while !stop.load(Ordering::Acquire) {
                    mailbox.publish(std::sync::Arc::new(vec![value; 4]), 1, 1, 4);
                    value = value.wrapping_add(1);
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
            })
        };

        // The game thread: blocked for two seconds, holding nothing.
        std::thread::sleep(std::time::Duration::from_millis(2_000));
        let after_stall = mailbox.acquire().expect("a frame is waiting after the stall");
        assert!(
            after_stall.counter >= 20,
            "the counter must have advanced across the stall, got {}",
            after_stall.counter
        );
        assert_eq!(
            after_stall.counter,
            mailbox.published(),
            "the reader takes the newest frame, not the oldest one still lying around"
        );

        // Nothing was queued behind it: the mailbox kept moving while the reader held one, and a
        // release-then-read lands on a newer frame rather than working through a backlog.
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(
            mailbox.published() > after_stall.counter,
            "the mailbox must keep moving while the reader holds a frame"
        );
        mailbox.release();
        let newest = mailbox.acquire().expect("a frame is retained");
        assert!(newest.counter > after_stall.counter);
        assert_eq!(newest.counter, mailbox.published());

        stop.store(true, Ordering::Release);
        publisher.join().expect("publisher");
    }

    #[test]
    fn commands_from_the_game_arrive_in_order() {
        let shared = Shared::default();
        shared.push_command(Command::Post("first".to_string()));
        shared.push_command(Command::Resize {
            width: 640,
            height: 480,
        });
        match shared.take_command() {
            Some(Command::Post(frame)) => assert_eq!(frame, "first"),
            _ => panic!("the oldest command is served first"),
        }
        match shared.take_command() {
            Some(Command::Resize { width, height }) => assert_eq!((width, height), (640, 480)),
            _ => panic!("the queue keeps its order"),
        }
        assert!(shared.take_command().is_none());
    }

    #[test]
    fn page_frames_are_served_oldest_first() {
        let shared = Shared::default();
        shared.push_inbound("a".to_string());
        shared.push_inbound("b".to_string());
        assert_eq!(shared.take_inbound().as_deref(), Some("a"));
        assert_eq!(shared.take_inbound().as_deref(), Some("b"));
        assert_eq!(shared.take_inbound(), None);
    }

    #[test]
    fn a_url_scheme_path_resolves_inside_the_staged_ui() {
        assert_eq!(content_type("assets/index.js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type("index.html"), "text/html; charset=utf-8");
        assert_eq!(content_type("thing.unknown"), "application/octet-stream");
    }

    #[test]
    fn a_frame_with_a_quote_or_newline_cannot_end_the_script_it_is_embedded_in() {
        assert_eq!(serde_frame("a\"b"), "\"a\\\"b\"");
        assert_eq!(serde_frame("a\nb"), "\"a\\nb\"");
        assert_eq!(serde_frame("plain"), "\"plain\"");
    }
}
