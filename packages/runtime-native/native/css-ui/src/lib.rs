//! CSS UI for the native host, with no WebView and no second engine.
//!
//! **What this is.** A CSS + HTML UI layer the game writes once and runs unchanged on the
//! browser and on a native host: `src/ui/` is still Tailwind markup, and the host still gets an
//! RGBA buffer it can hand to the renderer it already owns. Layout, cascade and hit testing come
//! from [`blitz_dom`] (Stylo + Taffy); painting comes from `vello_cpu`, which is CPU-only — so
//! this crate runs headless, in a unit test, with no window and no GPU.
//!
//! **What this is not.** There is no WebView, no Chromium, no JavaScript engine and no scene IR.
//! The 3D scene never enters here and this crate never learns what is in it: the host passes in
//! pixels-sized CSS and reads back pixels plus `{"type":…,"id":…}` events. Nothing here is
//! exposed to game code — game code never links this, calls it, or names it. The engine's
//! contract with the host is the C ABI in [`abi`]; [`CssUi`] is the same implementation behind a
//! Rust signature so it can be tested without a process boundary.
//!
//! **Scope of this slice.** Static document construction from JSON mutation batches, hover and
//! pointer state, and `click`. No keyboard traversal, no scrolling. Text is laid out with Parley,
//! from the device's system fonts and from any `@font-face` font or `<img>` the `ui/` directory
//! ships — see [`Assets`].

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use blitz_dom::{
    local_name, ns, BaseDocument, Document, DocumentConfig, EventDriver, EventHandler, LocalName,
    NodeId, QualName,
};
use blitz_traits::events::{
    BlitzPointerEvent, BlitzPointerId, DomEvent, EventState, MouseEventButton, MouseEventButtons,
    PointerCoords, PointerDetails, UiEvent,
};
use blitz_traits::net::{Bytes, NetHandler, NetProvider, Request, Url};
use blitz_traits::shell::{ColorScheme, ShellProvider, Viewport};
use serde_json::Value;

pub mod abi;

/// Pinned dependency versions, reported by `tn_css_ui_backend` so a playtest can prove which
/// engine produced a frame.
pub const BLITZ_DOM_VERSION: &str = "0.3.0-beta.2";
pub const BLITZ_PAINT_VERSION: &str = "0.3.0-beta.2";
pub const BLITZ_TRAITS_VERSION: &str = "0.3.0-beta.2";
pub const ANYRENDER_VERSION: &str = "0.13.0";
pub const ANYRENDER_VELLO_CPU_VERSION: &str = "0.17.0";
pub const PARLEY_VERSION: &str = "0.11.1";

/// The caller-chosen id of the `<body>` container. Every other node gets an id from the host.
pub const BODY_ID: u32 = 0;

/// Outbound event queue bound. A UI that outruns the host's event drain loses the oldest events
/// rather than growing without limit; [`CssUi::dropped_events`] reports how many.
pub const EVENT_QUEUE_CAP: usize = 256;

/// Largest frame dimension `vello_cpu` accepts (its painter takes `u16`).
const MAX_DIMENSION: u32 = 65_535;

/// The element tags a `create` op may name. Deliberately a closed list: this is a HUD, not a
/// browser, and every tag here is one a game UI can build a panel out of.
const TAGS: &[&str] = &[
    "div", "section", "aside", "header", "footer", "main", "nav", "article", "h1", "h2", "h3",
    "h4", "h5", "h6", "p", "span", "button", "img", "ul", "ol", "li", "a", "label", "strong",
    "em", "b", "i", "small",
];

/// The attribute names an `attr` op may set, besides any `data-*` or `aria-*`. Everything else
/// is rejected: an arbitrary attribute name is a selector surface this slice does not model.
const ATTRS: &[&str] = &[
    "class", "id", "style", "role", "disabled", "type", "src", "alt", "tabindex", "title",
];

/// The events a `listen` op may name.
const EVENTS: &[&str] = &[
    "click",
    "pointerdown",
    "pointerup",
    "pointerenter",
    "pointerleave",
    "focus",
    "blur",
];

/// The scheme every relative `url()` in a `ui/` document resolves against. Blitz has no base URL
/// of its own worth using — the default is a `data:` document, and resolving anything relative
/// against one panics — and a real one would invite a `file://` fetch. This scheme cannot be
/// fetched by anything but [`Assets`], which only knows the directory the game packaged.
const ASSET_SCHEME: &str = "tncss";
/// The base [`ASSET_SCHEME`] URL: `url(x.png)` becomes `tncss://ui/x.png`, whose one path segment
/// is the file name.
const BASE_URL: &str = "tncss://ui/";

/// What a `ui/` directory ships beside its stylesheets: fonts and images, by extension. These are
/// the two things a CSS `url()` (or an `<img src>`) can name, and the only two this crate serves.
const ASSET_EXTENSIONS: &[&str] = &[
    "ttf", "otf", "woff", "woff2", "png", "jpg", "jpeg", "webp", "gif",
];

/// The packaged `ui/` directory, as the one source of bytes a `url()` can reach.
///
/// Blitz resolves every reference against [`BASE_URL`] before asking, so a reference is either one
/// name in `files` or nothing: our own scheme, exactly one path segment, no `..`, no `http(s)`,
/// nothing outside the directory. A reference that is none of those is recorded by name in
/// `failures`, because the one failure a screenshot cannot show is a `@font-face` that silently
/// fell back to a system face and a HUD that shipped the wrong words at the right size.
#[derive(Default)]
struct Assets {
    inner: Mutex<AssetsDir>,
}

#[derive(Default)]
struct AssetsDir {
    /// File name -> path in the packaged directory.
    files: HashMap<String, PathBuf>,
    /// Named reasons a reference resolved to nothing, in the order they were asked for.
    failures: Vec<String>,
}

impl Assets {
    /// Index every file of `names` in `root` as servable.
    fn register(&self, root: &Path, names: &[String]) {
        let mut inner = self.inner.lock().expect("assets lock");
        inner.files = names
            .iter()
            .map(|name| (name.clone(), root.join(name)))
            .collect();
        inner.failures.clear();
    }

    /// The file `url` names, or the named reason it names none.
    fn lookup(&self, url: &Url) -> Result<PathBuf, String> {
        if url.scheme() != ASSET_SCHEME {
            return Err(format!("asset {url} is not a file in the ui directory"));
        }
        // One segment and nothing else: `tncss://ui/x.png` resolves, and so does nothing that
        // climbed out of it (`../` lands on the host, a deeper path has more segments).
        let Some(mut segments) = url.path_segments() else {
            return Err(format!("asset {url} is not a file in the ui directory"));
        };
        let Some(name) = segments.next_back().filter(|name| !name.is_empty()) else {
            return Err(format!("asset {url} names no file"));
        };
        if segments.next().is_some() {
            return Err(format!("asset {url} leaves the ui directory"));
        }
        self.inner
            .lock()
            .expect("assets lock")
            .files
            .get(name)
            .cloned()
            .ok_or_else(|| format!("asset {url} is not a file in the ui directory"))
    }

    /// Reject a reference the `ui/` directory cannot answer, before a batch applies anything. `data:`
    /// carries its own bytes and `#fragment` names none, so neither needs a file.
    fn require(&self, reference: &str) -> Result<(), String> {
        if reference.starts_with("data:") || reference.starts_with('#') {
            return Ok(());
        }
        // Resolved the way blitz will, so one rule covers `x.png`, `./x.png` and `../x.png`.
        let Ok(url) = Url::parse(BASE_URL).and_then(|base| base.join(reference)) else {
            return Err(format!("src \"{reference}\" is not a file in the ui directory"));
        };
        self.lookup(&url)
            .map(|_| ())
            .map_err(|_| format!("src \"{reference}\" is not a file in the ui directory"))
    }

    fn fail(&self, message: String) {
        self.inner.lock().expect("assets lock").failures.push(message);
    }

    /// Take the named failures since the last call, so one is reported once.
    fn take_failures(&self) -> Vec<String> {
        std::mem::take(&mut self.inner.lock().expect("assets lock").failures)
    }
}

impl NetProvider for Assets {
    fn fetch(&self, _doc_id: usize, request: Request, handler: Box<dyn NetHandler>) {
        let url = request.url;
        // A `data:` URI carries its own bytes and a `#fragment` names none: blitz 0.3 decodes
        // neither, so there was never a file here and there is nothing to report as missing.
        if url.scheme() == "data" || url.fragment().is_some() {
            return;
        }
        let resolved = url.as_str().to_string();
        let file = match self.lookup(&url) {
            Ok(file) => file,
            Err(reason) => return self.fail(reason),
        };
        match std::fs::read(&file) {
            Ok(bytes) => handler.bytes(resolved, Bytes::from(bytes)),
            Err(e) => self.fail(format!("asset {}: {e}", file.display())),
        }
    }
}

/// Blitz asks for a repaint through the shell seam whenever anything it considers visual changed
/// — a mutation, a hover change, an active-state change. This turns that into the one flag
/// `render` needs, instead of guessing which internal state moved.
#[derive(Default)]
struct Redraw {
    requested: AtomicBool,
}

impl ShellProvider for Redraw {
    fn request_redraw(&self) {
        self.requested.store(true, Ordering::Relaxed);
    }
}

// ---------------------------------------------------------------------------------------------
// Mutation batches
// ---------------------------------------------------------------------------------------------

#[derive(Debug)]
struct Batch {
    ops: Vec<Op>,
}

/// One mutation batch, parsed by hand: `serde_json` is the reader, and `serde` as a derive
/// dependency would be a second crate for ten struct shapes. An unknown op name fails here, and
/// an unknown tag, attribute, event or id fails in [`CssUi::validate`] — both before anything is
/// applied, so a bad batch can never half-apply.
#[derive(Debug)]
enum Op {
    Create { id: u32, tag: String },
    Text { id: u32, text: String },
    SetText { id: u32, text: String },
    Append { parent: u32, child: u32 },
    InsertBefore { parent: u32, child: u32, before: u32 },
    Remove { id: u32 },
    Attr { id: u32, name: String, value: Option<String> },
    Sheet { key: String, css: String },
    Listen { id: u32, event: String },
    Viewport { width: u32, height: u32, scale: f32 },
}

impl Op {
    /// Names the op in every error message, so a rejected batch says which op it was.
    fn name(&self) -> &'static str {
        match self {
            Op::Create { .. } => "create",
            Op::Text { .. } => "text",
            Op::SetText { .. } => "setText",
            Op::Append { .. } => "append",
            Op::InsertBefore { .. } => "insertBefore",
            Op::Remove { .. } => "remove",
            Op::Attr { .. } => "attr",
            Op::Sheet { .. } => "sheet",
            Op::Listen { .. } => "listen",
            Op::Viewport { .. } => "viewport",
        }
    }
}

/// The frame type this engine owns. The UI bridge is one channel shared with the game's own state
/// frames, so a frame that names another type is not a malformed batch — it is not for this engine.
const CSS_FRAME_TYPE: &str = "tn:css";

fn parse_batch(json: &str) -> Result<Option<Batch>, String> {
    let value: Value = serde_json::from_str(json).map_err(|e| format!("batch: {e}"))?;
    if value
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| kind != CSS_FRAME_TYPE)
    {
        return Ok(None);
    }
    let ops = value
        .get("ops")
        .and_then(Value::as_array)
        .ok_or_else(|| "batch: missing \"ops\" array".to_string())?;
    Ok(Some(Batch {
        ops: ops.iter().map(parse_op).collect::<Result<_, _>>()?,
    }))
}

fn parse_op(value: &Value) -> Result<Op, String> {
    let name = value
        .get("op")
        .and_then(Value::as_str)
        .ok_or_else(|| "batch: op without a name".to_string())?;
    let bad = |what: &str| format!("{name}: {what}");
    let num = |key: &str| -> Result<u32, String> {
        value
            .get(key)
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
            .ok_or_else(|| bad(&format!("{key} is not a node id")))
    };
    let text = |key: &str| -> Result<String, String> {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| bad(&format!("{key} is not a string")))
    };
    // `attr` is the one op whose `value` may legitimately be absent: that means "remove it".
    let maybe_text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_owned);
    Ok(match name {
        "create" => Op::Create {
            id: num("id")?,
            tag: text("tag")?,
        },
        "text" => Op::Text {
            id: num("id")?,
            text: text("text")?,
        },
        "setText" => Op::SetText {
            id: num("id")?,
            text: text("text")?,
        },
        "append" => Op::Append {
            parent: num("parent")?,
            child: num("child")?,
        },
        "insertBefore" => Op::InsertBefore {
            parent: num("parent")?,
            child: num("child")?,
            before: num("before")?,
        },
        "remove" => Op::Remove { id: num("id")? },
        "attr" => Op::Attr {
            id: num("id")?,
            name: text("name")?,
            value: maybe_text("value"),
        },
        "sheet" => Op::Sheet {
            key: text("key")?,
            css: text("css")?,
        },
        "listen" => Op::Listen {
            id: num("id")?,
            event: text("event")?,
        },
        "viewport" => Op::Viewport {
            width: num("width")?,
            height: num("height")?,
            scale: value
                .get("scale")
                .and_then(Value::as_f64)
                .ok_or_else(|| bad("scale is not a number"))? as f32,
        },
        other => return Err(format!("batch: unknown op \"{other}\"")),
    })
}

// ---------------------------------------------------------------------------------------------
// CssUi
// ---------------------------------------------------------------------------------------------

/// A document plus everything the host needs to drive it. No globals, no threads: one instance
/// is owned by the caller and used from the game thread.
pub struct CssUi {
    doc: BaseDocument,
    head: NodeId,
    /// Caller id -> blitz node id, both directions, kept in step by `bind` and the drop callback
    /// blitz hands back for every node a `remove` frees.
    ids: HashMap<u32, NodeId>,
    callers: HashMap<NodeId, u32>,
    /// Stylesheet key -> its `<style>` node, in first-insertion order. That order is the cascade
    /// order, so replacing a sheet keeps its place.
    sheets: Vec<(String, NodeId)>,
    /// Blitz node id -> the events a caller asked to be told about.
    listeners: HashMap<NodeId, HashSet<&'static str>>,
    width: u32,
    height: u32,
    scale: f32,
    ua_css: String,
    redraw: Arc<Redraw>,
    assets: Arc<Assets>,
    dirty: bool,
    counter: u64,
    pixels: Vec<u8>,
    frame: (u32, u32),
    out: VecDeque<String>,
    dropped: u64,
}

impl CssUi {
    /// An empty document — `html > head + body`, where the body is [`BODY_ID`]. `width` and
    /// `height` are CSS pixels; `scale` is device pixels per CSS pixel.
    pub fn new(width: u32, height: u32, scale: f32) -> Result<Self, String> {
        let scale = if scale > 0.0 { scale } else { 1.0 };
        check_frame_size(width, height, scale)?;

        let redraw = Arc::new(Redraw::default());
        // The packaged `ui/` directory is the document's only source of bytes: the system font
        // context still backs every family the game did not ship, but a `@font-face` url and an
        // `<img src>` resolve here or nowhere.
        let assets = Arc::new(Assets::default());
        let mut doc = BaseDocument::new(DocumentConfig {
            viewport: Some(Viewport::new(
                (width as f32 * scale) as u32,
                (height as f32 * scale) as u32,
                scale,
                ColorScheme::Light,
            )),
            base_url: Some(BASE_URL.to_string()),
            font_ctx: Some(parley::FontContext::new()),
            shell_provider: Some(redraw.clone()),
            net_provider: Some(assets.clone()),
            ..Default::default()
        });

        let (head, body) = {
            let mut m = doc.mutate();
            let root = m.doc.root_node().id;
            let html = m.create_element(qual("html"), vec![]);
            let head = m.create_element(qual("head"), vec![]);
            let body = m.create_element(qual("body"), vec![]);
            m.append_children(root, &[html]);
            m.append_children(html, &[head, body]);
            (head, body)
        };

        let mut ui = Self {
            doc,
            head,
            ids: HashMap::new(),
            callers: HashMap::new(),
            sheets: Vec::new(),
            listeners: HashMap::new(),
            width,
            height,
            scale,
            ua_css: String::new(),
            redraw,
            assets,
            dirty: true,
            counter: 0,
            pixels: Vec::new(),
            frame: (0, 0),
            out: VecDeque::new(),
            dropped: 0,
        };
        ui.bind(BODY_ID, body);
        ui.resize(width, height, scale);
        ui.sync_dirty();
        Ok(ui)
    }

    /// Load every `*.css` in `root`, sorted by file name, as one stylesheet each, and register
    /// every font and image beside them so a `url()` naming one resolves without a network. A
    /// missing directory is not an error: a game may ship its styles inside its bundle instead.
    /// The count is how many stylesheets loaded, so a caller can tell an empty directory from a
    /// missing one — a game whose stylesheets never shipped paints an unstyled HUD either way.
    ///
    /// A `url()` naming a file that is not in `root` fails here by name, rather than leaving the
    /// document to fall back to a system font: attach is the one moment the host can still be told
    /// the difference between the HUD it shipped and the one it wanted.
    pub fn load_sheet_dir(&mut self, root: &Path) -> Result<usize, String> {
        let entries = match std::fs::read_dir(root) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(format!("sheet dir {}: {e}", root.display())),
        };
        let mut sheets: Vec<String> = Vec::new();
        let mut assets: Vec<String> = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| format!("sheet dir {}: {e}", root.display()))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            // Case-insensitive: a bundle written on a case-insensitive filesystem can carry
            // `Theme.CSS`, and a file visible on the author's machine must not vanish here. The
            // sort below is on the name as written, so the cascade does not depend on the
            // directory's own order.
            match name.rsplit_once('.').map(|(_, ext)| ext) {
                Some(ext) if ext.eq_ignore_ascii_case("css") => sheets.push(name),
                Some(ext)
                    if ASSET_EXTENSIONS
                        .iter()
                        .any(|known| ext.eq_ignore_ascii_case(known)) =>
                {
                    assets.push(name)
                }
                _ => {}
            }
        }
        sheets.sort();
        assets.sort();
        // Registered before the sheets, because reading a stylesheet is what asks for its fonts.
        self.assets.register(root, &assets);
        let count = sheets.len();
        for key in sheets {
            let css = std::fs::read_to_string(root.join(&key))
                .map_err(|e| format!("sheet {key}: {e}"))?;
            self.set_sheet(&key, &css);
        }
        let failures = self.assets.take_failures();
        if !failures.is_empty() {
            return Err(failures.join("; "));
        }
        self.sync_dirty();
        Ok(count)
    }

    /// Add or atomically replace one stylesheet, keeping its position in the cascade.
    pub fn set_sheet(&mut self, key: &str, css: &str) {
        if let Some((_, node)) = self.sheets.iter().find(|(k, _)| k == key) {
            let node = *node;
            let mut m = self.doc.mutate();
            m.set_node_text(node, css);
            return;
        }
        let node = self.style_node(css);
        self.sheets.push((key.to_string(), node));
    }

    /// A `<style>` in `<head>` holding `css`. Blitz re-reads a style element whenever its text
    /// changes, which is how a replacement stays atomic.
    fn style_node(&mut self, css: &str) -> NodeId {
        let mut m = self.doc.mutate();
        let style = m.create_element(qual("style"), vec![]);
        let text = m.create_text_node(css);
        m.append_children(style, &[text]);
        m.append_children(self.head, &[style]);
        style
    }

    /// Apply one mutation batch. Either every op in it applies or none does.
    pub fn post(&mut self, batch: &str) -> Result<(), String> {
        let Some(batch) = parse_batch(batch)? else {
            return Ok(());
        };
        self.validate(&batch.ops)?;

        // Sheets and the viewport are independent of the tree, so they go first and keep `post`
        // to a single mutator scope.
        for op in &batch.ops {
            match op {
                Op::Sheet { key, css } => self.set_sheet(key, css),
                Op::Viewport {
                    width,
                    height,
                    scale,
                } => self.resize(*width, *height, *scale),
                _ => {}
            }
        }

        let mut freed: HashSet<NodeId> = HashSet::new();
        {
            let Self {
                doc,
                ids,
                callers,
                listeners,
                ..
            } = self;
            let mut m = doc.mutate();
            for op in &batch.ops {
                match op {
                    Op::Create { id, tag } => {
                        let node = m.create_element(qual(tag), vec![]);
                        ids.insert(*id, node);
                        callers.insert(node, *id);
                    }
                    Op::Text { id, text } => {
                        let node = m.create_text_node(text);
                        ids.insert(*id, node);
                        callers.insert(node, *id);
                    }
                    Op::SetText { id, text } => m.set_node_text(ids[id], text),
                    Op::Append { parent, child } => m.append_children(ids[parent], &[ids[child]]),
                    Op::InsertBefore { child, before, .. } => {
                        m.insert_nodes_before(ids[before], &[ids[child]])
                    }
                    Op::Remove { id } => {
                        let node = ids.remove(id).expect("validated");
                        m.remove_and_drop_node_with(node, &mut |dropped| {
                            ids.retain(|_, v| *v != dropped);
                            callers.remove(&dropped);
                            freed.insert(dropped);
                        });
                    }
                    Op::Attr { id, name, value } => {
                        let node = ids[id];
                        let name = qual_attr(name);
                        match value {
                            Some(value) => m.set_attribute(node, name, value),
                            None => m.clear_attribute(node, name),
                        }
                    }
                    // Handled above, before the mutator exists.
                    Op::Sheet { .. } | Op::Viewport { .. } => {}
                    Op::Listen { id, event } => {
                        let node = ids[id];
                        listeners
                            .entry(node)
                            .or_default()
                            .insert(event_name(event).expect("validated"));
                    }
                }
            }
        }
        // A removed subtree can take listeners with it; keeping them would grow the map for
        // every HUD the game rebuilds.
        self.listeners.retain(|node, _| !freed.contains(node));
        self.sync_dirty();
        Ok(())
    }

    /// Reject the whole batch before touching the document. Runs a shadow copy of the tree
    /// because ids created earlier in the same batch are legal operands of later ops, and a
    /// `remove` frees a whole subtree, so liveness cannot be checked against the live document.
    fn validate(&self, ops: &[Op]) -> Result<(), String> {
        let mut tree = self.shadow();
        for op in ops {
            let need = |id: u32| -> Result<(), String> {
                if tree.live.contains(&id) {
                    Ok(())
                } else {
                    Err(format!("{}: unknown id {id}", op.name()))
                }
            };
            let fresh = |id: u32| -> Result<(), String> {
                if id == BODY_ID {
                    Err(format!("{}: id {id} is the body", op.name()))
                } else if tree.live.contains(&id) {
                    Err(format!("{}: id {id} already exists", op.name()))
                } else {
                    Ok(())
                }
            };
            match op {
                Op::Create { id, tag } => {
                    if !TAGS.contains(&tag.as_str()) {
                        return Err(format!("{}: unsupported tag \"{tag}\"", op.name()));
                    }
                    fresh(*id)?;
                    tree.create(*id);
                }
                Op::Text { id, .. } => {
                    fresh(*id)?;
                    tree.create(*id);
                }
                Op::SetText { id, .. } => need(*id)?,
                Op::Append { parent, child } => {
                    need(*parent)?;
                    need(*child)?;
                    if parent == child {
                        return Err(format!("append: id {child} is its own parent"));
                    }
                    tree.attach(*parent, *child);
                }
                Op::InsertBefore {
                    parent,
                    child,
                    before,
                } => {
                    need(*parent)?;
                    need(*child)?;
                    need(*before)?;
                    if parent == child {
                        return Err(format!("insertBefore: id {child} is its own parent"));
                    }
                    if !tree.is_child(*parent, *before) {
                        return Err(format!(
                            "insertBefore: id {before} is not a child of id {parent}"
                        ));
                    }
                    tree.attach(*parent, *child);
                }
                Op::Remove { id } => {
                    if *id == BODY_ID {
                        return Err("remove: the body cannot be removed".to_string());
                    }
                    need(*id)?;
                    tree.detach(*id);
                }
                Op::Attr { id, name, value } => {
                    need(*id)?;
                    if !is_allowed_attr(name) {
                        return Err(format!("attr: unsupported attribute \"{name}\""));
                    }
                    // An `<img src>` is resolved as the batch applies, so the only moment to name a
                    // file that is not there is here, where nothing has been touched yet.
                    if name == "src" {
                        if let Some(value) = value {
                            self.assets.require(value)?;
                        }
                    }
                }
                Op::Sheet { key, .. } => {
                    if key.is_empty() {
                        return Err("sheet: empty key".to_string());
                    }
                }
                Op::Listen { id, event } => {
                    need(*id)?;
                    if event_name(event).is_none() {
                        return Err(format!("listen: unsupported event \"{event}\""));
                    }
                }
                Op::Viewport {
                    width,
                    height,
                    scale,
                } => check_frame_size(*width, *height, *scale)?,
            }
        }
        Ok(())
    }

    /// Resize in CSS pixels, keeping the device scale. Equivalent to a `viewport` op.
    pub fn set_size(&mut self, width: u32, height: u32) -> Result<(), String> {
        let scale = self.scale;
        check_frame_size(width, height, scale)?;
        self.resize(width, height, scale);
        self.sync_dirty();
        Ok(())
    }

    /// Set the viewport and re-apply the root-box sheet `position: fixed` depends on.
    fn resize(&mut self, width: u32, height: u32, scale: f32) {
        if (width, height, scale) == (self.width, self.height, self.scale) && !self.ua_css.is_empty()
        {
            return;
        }
        self.width = width;
        self.height = height;
        self.scale = scale;
        // Blitz resolves `position: fixed` against the body's box rather than the viewport (it
        // has no viewport-level containing block). A HUD is almost entirely `position: fixed`
        // panels, so that is fatal rather than cosmetic: the workaround is to make the root
        // boxes exactly the viewport, in CSS pixels, and re-apply this sheet on every resize.
        let css = root_box_css(width, height);
        if !self.ua_css.is_empty() {
            self.doc.remove_user_agent_stylesheet(&self.ua_css);
        }
        self.doc.add_user_agent_stylesheet(&css);
        self.ua_css = css;
        self.doc.set_viewport(Viewport::new(
            (width as f32 * scale) as u32,
            (height as f32 * scale) as u32,
            scale,
            ColorScheme::Light,
        ));
        self.dirty = true;
    }

    /// Repaint if anything changed. Returns whether a new frame was produced; the frame counter
    /// advances only when it was.
    pub fn render(&mut self) -> bool {
        self.sync_dirty();
        if !self.dirty {
            return false;
        }
        let (width, height, scale) = (self.width, self.height, self.scale);
        let (pw, ph) = (device_px(width, scale), device_px(height, scale));
        self.doc.resolve(0.0);
        let mut scene = anyrender_vello_cpu::VelloCpuScenePainter::new(pw as u16, ph as u16);
        blitz_paint::paint_scene(
            &mut scene,
            &mut self.doc,
            scale as f64,
            pw,
            ph,
            0,
            0,
        );
        // vello_cpu's pixmap is already premultiplied RGBA8, which is what the host's existing
        // texture upload wants. Nothing to convert.
        self.pixels = scene
            .finish()
            .data()
            .iter()
            .flat_map(|px| [px.r, px.g, px.b, px.a])
            .collect();
        self.frame = (pw, ph);
        self.dirty = false;
        self.counter += 1;
        true
    }

    /// Deliver a pointer event at normalised viewport coordinates. Returns whether the UI
    /// consumed the pointer — that is, whether the hit node or one of its ancestors has a
    /// listener, which is what tells the host not to also treat this as a game click. `kind` is
    /// `move`, `down`, `up` or `leave`.
    pub fn pointer(
        &mut self,
        kind: &str,
        nx: f32,
        ny: f32,
        buttons: i32,
    ) -> Result<bool, String> {
        let x = nx * self.width as f32;
        let y = ny * self.height as f32;
        if !matches!(kind, "move" | "down" | "up" | "leave") {
            return Err(format!("pointer: unsupported event \"{kind}\""));
        }
        // Hit testing reads layout, so it has to be current even when the host has not asked for
        // a frame since the last batch.
        self.doc.resolve(0.0);
        let consumed = self.hit_test_at(x, y);
        if kind == "leave" {
            if self.doc.clear_hover() {
                self.dirty = true;
            }
            return Ok(false);
        }

        let data = BlitzPointerEvent {
            id: BlitzPointerId::Mouse,
            is_primary: true,
            coords: PointerCoords {
                page_x: x,
                page_y: y,
                screen_x: x,
                screen_y: y,
                client_x: x,
                client_y: y,
            },
            button: MouseEventButton::Main,
            buttons: if buttons != 0 {
                MouseEventButtons::Primary
            } else {
                MouseEventButtons::None
            },
            mods: Default::default(),
            details: PointerDetails {
                pressure: if buttons != 0 { 0.5 } else { 0.0 },
                ..Default::default()
            },
            element: Default::default(),
            active_pointers: Default::default(),
        };
        let ui_event = match kind {
            "move" => UiEvent::PointerMove(data),
            "down" => UiEvent::PointerDown(data),
            _ => UiEvent::PointerUp(data),
        };

        {
            let Self {
                doc,
                callers,
                listeners,
                out,
                dropped,
                ..
            } = self;
            let mut driver = EventDriver::new(
                doc,
                Recorder {
                    callers,
                    listeners,
                    out,
                    dropped,
                },
            );
            driver.handle_ui_event(ui_event);
        }
        self.sync_dirty();
        Ok(consumed)
    }

    /// Whether the UI consumes the pointer at `nx`/`ny`. The same predicate [`CssUi::pointer`]
    /// returns, without delivering an event.
    pub fn hit_test(&mut self, nx: f32, ny: f32) -> bool {
        self.doc.resolve(0.0);
        self.hit_test_at(nx * self.width as f32, ny * self.height as f32)
    }

    /// The box of a node the host created, in CSS pixels: `[x, y, width, height]`. An inline node
    /// reports the line box its text laid out to, so this is where a font's own advances are read
    /// back. Layout is resolved first, so it answers even before the first `render`.
    pub fn node_box(&mut self, id: u32) -> Option<[f64; 4]> {
        self.doc.resolve(0.0);
        let node = *self.ids.get(&id)?;
        // A text node has no layout of its own to ask: blitz panics rather than answering.
        if !self.doc.get_node(node)?.is_element() {
            return None;
        }
        let rect = self.doc.get_client_bounding_rect(node)?;
        Some([rect.x, rect.y, rect.width, rect.height])
    }

    fn hit_test_at(&self, x: f32, y: f32) -> bool {
        let Some(mut node) = self.doc.element_from_point(x, y) else {
            return false;
        };
        // A disabled control is not a hit target: it emits nothing, and it does not claim the
        // pointer from the game behind it.
        if is_disabled(&self.doc, node) {
            return false;
        }
        loop {
            if self
                .listeners
                .get(&node)
                .is_some_and(|events| !events.is_empty())
            {
                return true;
            }
            match self.doc.get_node(node).and_then(|n| n.parent) {
                Some(parent) => node = parent,
                None => return false,
            }
        }
    }

    /// Take the outbound events queued since the last call, one JSON object per line. Empty
    /// means the host does not need to run the UI's event drain this frame.
    pub fn take_events(&mut self) -> Vec<String> {
        self.out.drain(..).collect()
    }

    /// How many events were dropped because the queue was full.
    pub fn dropped_events(&self) -> u64 {
        self.dropped
    }

    /// The latest frame: premultiplied RGBA8, `frame_width()` bytes per row.
    pub fn pixels(&self) -> &[u8] {
        &self.pixels
    }

    pub fn frame_width(&self) -> u32 {
        self.frame.0
    }

    pub fn frame_height(&self) -> u32 {
        self.frame.1
    }

    /// Frames produced so far. Advances only when `render` produced one.
    pub fn counter(&self) -> u64 {
        self.counter
    }

    /// `(css width, css height, device scale)`.
    pub fn viewport(&self) -> (u32, u32, f32) {
        (self.width, self.height, self.scale)
    }

    fn bind(&mut self, id: u32, node: NodeId) {
        self.ids.insert(id, node);
        self.callers.insert(node, id);
    }

    /// A read-only copy of the current tree, so a batch can be checked against the ids it is
    /// about to change (including the ones it creates itself) without touching the document.
    fn shadow(&self) -> Shadow {
        let mut tree = Shadow {
            live: self.ids.keys().copied().collect(),
            parent: HashMap::new(),
            children: HashMap::new(),
        };
        let mut stack: Vec<(u32, NodeId)> =
            self.ids.iter().map(|(&id, &node)| (id, node)).collect();
        while let Some((parent_id, node)) = stack.pop() {
            let Some(dom) = self.doc.get_node(node) else {
                continue;
            };
            for child in dom.children.iter() {
                if let Some(&child_id) = self.callers.get(child) {
                    tree.attach(parent_id, child_id);
                    stack.push((child_id, *child));
                }
            }
        }
        tree
    }

    /// Blitz's own "something changed" seam, folded into our one dirty flag.
    fn sync_dirty(&mut self) {
        if self.redraw.requested.swap(false, Ordering::Relaxed) {
            self.dirty = true;
        }
    }
}

/// The parent/child shape of a batch, kept alongside the live ids so validation can answer
/// "is `before` a child of `parent`" and "what does this `remove` free" without a document.
#[derive(Default)]
struct Shadow {
    live: HashSet<u32>,
    parent: HashMap<u32, u32>,
    children: HashMap<u32, Vec<u32>>,
}

impl Shadow {
    fn create(&mut self, id: u32) {
        self.live.insert(id);
    }

    fn attach(&mut self, parent: u32, child: u32) {
        if let Some(old) = self.parent.insert(child, parent) {
            if let Some(siblings) = self.children.get_mut(&old) {
                siblings.retain(|s| *s != child);
            }
        }
        self.children.entry(parent).or_default().push(child);
    }

    fn is_child(&self, parent: u32, child: u32) -> bool {
        self.children
            .get(&parent)
            .is_some_and(|kids| kids.contains(&child))
    }

    /// Drop `id` and everything under it.
    fn detach(&mut self, id: u32) {
        let mut stack = vec![id];
        while let Some(node) = stack.pop() {
            self.live.remove(&node);
            self.parent.remove(&node);
            if let Some(kids) = self.children.remove(&node) {
                stack.extend(kids);
            }
        }
        for siblings in self.children.values_mut() {
            siblings.retain(|c| *c != id);
        }
    }
}

fn is_disabled(doc: &BaseDocument, node: NodeId) -> bool {
    doc.get_node(node)
        .is_some_and(|n| n.attr(local_name!("disabled")).is_some())
}

fn is_allowed_attr(name: &str) -> bool {
    ATTRS.contains(&name) || name.starts_with("data-") || name.starts_with("aria-")
}

fn device_px(css_px: u32, scale: f32) -> u32 {
    (css_px as f32 * scale).round() as u32
}

fn check_frame_size(width: u32, height: u32, scale: f32) -> Result<(), String> {
    if !scale.is_finite() || scale <= 0.0 {
        return Err(format!("viewport: scale {scale} is not positive"));
    }
    let w = device_px(width, scale) as f64;
    let h = device_px(height, scale) as f64;
    if w < 1.0 || h < 1.0 {
        return Err(format!("viewport: {width}x{height} at scale {scale} is empty"));
    }
    if w > MAX_DIMENSION as f64 || h > MAX_DIMENSION as f64 {
        return Err(format!(
            "viewport: {width}x{height} at scale {scale} exceeds {MAX_DIMENSION}px"
        ));
    }
    Ok(())
}

/// The root-box sheet `position: fixed` needs, in CSS pixels of the current viewport.
fn root_box_css(width: u32, height: u32) -> String {
    format!(
        "html, body {{ width: {width}px; height: {height}px; margin: 0; overflow: hidden; background: transparent; }}"
    )
}

fn qual(tag: &str) -> QualName {
    QualName::new(None, ns!(html), LocalName::from(tag))
}

/// Attributes are un-namespaced, unlike the elements they sit on.
fn qual_attr(name: &str) -> QualName {
    QualName::new(None, ns!(), LocalName::from(name))
}

fn event_name(name: &str) -> Option<&'static str> {
    EVENTS.iter().copied().find(|e| *e == name)
}

/// Collects the DOM events a caller registered interest in. Blitz hands us the bubble chain
/// (target first, then ancestors), so "the hit node or an ancestor" is exactly this walk.
struct Recorder<'a> {
    callers: &'a HashMap<NodeId, u32>,
    listeners: &'a HashMap<NodeId, HashSet<&'static str>>,
    out: &'a mut VecDeque<String>,
    dropped: &'a mut u64,
}

impl EventHandler for Recorder<'_> {
    fn handle_event(
        &mut self,
        chain: &[NodeId],
        event: &mut DomEvent,
        doc: &mut dyn Document,
        _state: &mut EventState,
    ) {
        let name = event.name();
        for node in chain {
            let Some(events) = self.listeners.get(node) else {
                continue;
            };
            if !events.contains(name) || is_disabled(&doc.inner(), *node) {
                continue;
            }
            let Some(id) = self.callers.get(node) else {
                continue;
            };
            if self.out.len() == EVENT_QUEUE_CAP {
                self.out.pop_front();
                *self.dropped += 1;
            }
            self.out
                .push_back(format!(r#"{{"type":"{name}","id":{id}}}"#));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ui() -> CssUi {
        CssUi::new(480, 320, 1.0).expect("document")
    }

    fn make(id: u32, tag: &str) -> String {
        format!(r#"{{"op":"create","id":{id},"tag":"{tag}"}}"#)
    }

    #[test]
    fn frames_of_another_type_are_not_for_this_engine() {
        let mut ui = ui();
        assert!(ui.render(), "first paint");
        let painted = ui.counter();
        // The game publishes `tn:state` over the same bridge; it is ignored, never an error.
        ui.post(r#"{"type":"tn:state","state":{"frames":3}}"#)
            .expect("foreign frame is ignored");
        assert!(!ui.render(), "an ignored frame repaints nothing");
        assert_eq!(ui.counter(), painted);
        // A frame that claims to be ours but has no ops is still a malformed batch.
        let err = ui.post(r#"{"type":"tn:css"}"#).expect_err("css frame without ops");
        assert!(err.contains("ops"), "{err}");
    }

    #[test]
    fn rejects_unknown_op_naming_it() {
        let err = ui()
            .post(r#"{"ops":[{"op":"teleport","id":1}]}"#)
            .expect_err("unknown op");
        assert!(err.contains("teleport"), "{err}");
    }

    #[test]
    fn rejects_unknown_tag_and_leaves_document_empty() {
        let mut ui = ui();
        assert!(ui.render(), "first paint");
        let err = ui
            .post(&format!(
                r#"{{"ops":[{},{}]}}"#,
                make(1, "div"),
                make(2, "marquee")
            ))
            .expect_err("unknown tag");
        assert!(err.contains("create"), "{err}");
        assert!(err.contains("marquee"), "{err}");
        assert!(
            !ui.render(),
            "a rejected batch must not dirty the document"
        );
        assert!(ui
            .post(&format!(r#"{{"ops":[{}]}}"#, make(1, "div")))
            .is_ok());
    }

    #[test]
    fn rejects_unknown_id_without_applying_earlier_ops() {
        let mut ui = ui();
        assert!(ui
            .post(&format!(
                r#"{{"ops":[{},{{"op":"append","parent":0,"child":99}}]}}"#,
                make(1, "div")
            ))
            .is_err());
        // Id 1 was only created in the rejected batch, so it is still free.
        ui.post(&format!(r#"{{"ops":[{}]}}"#, make(1, "div")))
            .expect("id 1 was never really created");
    }

    #[test]
    fn rejects_unknown_attribute_and_event() {
        let mut ui = ui();
        assert!(ui
            .post(&format!(
                r#"{{"ops":[{},{{"op":"attr","id":1,"name":"onclick","value":"x"}}]}}"#,
                make(1, "div")
            ))
            .is_err());
        assert!(ui
            .post(&format!(
                r#"{{"ops":[{},{{"op":"listen","id":1,"event":"wheel"}}]}}"#,
                make(1, "div")
            ))
            .is_err());
        ui.post(&format!(
            r#"{{"ops":[{},{{"op":"attr","id":1,"name":"data-slot","value":"a"}},{{"op":"listen","id":1,"event":"click"}}]}}"#,
            make(1, "div")
        ))
        .expect("data-* and known events are allowed");
    }

    #[test]
    fn accepts_the_attributes_the_js_host_passes() {
        // Every one of these crosses from `@threenative/core`'s React bridge, so rejecting one
        // blanks the whole HUD rather than dropping an attribute.
        let mut ui = ui();
        ui.post(&format!(
            r#"{{"ops":[{},{}]}}"#,
            make(1, "button"),
            r#"{"op":"attr","id":1,"name":"title","value":"Inventory"}"#
        ))
        .expect("title is an attribute the host passes");
    }

    #[test]
    fn insert_before_needs_a_real_sibling() {
        let mut ui = ui();
        let batch = format!(
            r#"{{"ops":[{},{},{},{{"op":"append","parent":0,"child":1}},{{"op":"append","parent":0,"child":2}},{{"op":"insertBefore","parent":0,"child":3,"before":2}}]}}"#,
            make(1, "div"),
            make(2, "div"),
            make(3, "span")
        );
        ui.post(&batch).expect("3 goes before 2 under the body");
        // 3 is a child of the body now, so it is a legal anchor; 2 is not a child of 1.
        assert!(ui
            .post(&format!(
                r#"{{"ops":[{},{{"op":"insertBefore","parent":1,"child":3,"before":2}}]}}"#,
                make(4, "span")
            ))
            .is_err());
    }

    #[test]
    fn render_is_idempotent_until_something_changes() {
        let mut ui = ui();
        assert!(ui.render());
        let first = ui.counter();
        assert!(!ui.render());
        assert_eq!(ui.counter(), first);
        ui.set_size(481, 320).expect("resize");
        assert!(ui.render());
        assert_eq!(ui.counter(), first + 1);
    }

    #[test]
    fn remove_frees_the_whole_subtree() {
        let mut ui = ui();
        let batch = format!(
            r#"{{"ops":[{},{},{{"op":"append","parent":0,"child":1}},{{"op":"append","parent":1,"child":2}},{{"op":"remove","id":1}}]}}"#,
            make(1, "div"),
            make(2, "span"),
        );
        ui.post(&batch).expect("batch");
        ui.post(&format!(r#"{{"ops":[{}]}}"#, make(1, "div")))
            .expect("id 1 is free again");
        // Id 2 went with its parent, so it is free too.
        ui.post(&format!(r#"{{"ops":[{}]}}"#, make(2, "span")))
            .expect("id 2 was freed with its subtree");
    }

    #[test]
    fn frame_is_premultiplied_transparent_by_default() {
        let mut ui = ui();
        assert!(ui.render());
        assert_eq!(
            ui.pixels().len(),
            (ui.frame_width() * ui.frame_height() * 4) as usize
        );
        assert_eq!(&ui.pixels()[0..4], &[0, 0, 0, 0], "empty document");
    }
}
