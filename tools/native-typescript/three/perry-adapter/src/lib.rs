//! The Perry adapter over the ThreeNative engine C ABI (decision 11).
//!
//! One boundary: compiled game code reaches the engine only through the versioned C ABI, and this
//! adapter owns everything on the Perry side of it — Perry's value representation, GC roots for
//! retained callbacks, and completion routing. The engine knows nothing of Perry; swapping the
//! compiler later is a new adapter, not an engine change.
//!
//! A game-code handle is the C shim's slot for one engine object, boxed by Perry's runtime as an
//! opaque native handle (`handle<TnObject>` in the manifest). Its finalizer is what releases the
//! engine object, and Perry's collector runs finalizers — so no lifetime depends on
//! `FinalizationRegistry`, `WeakRef` or `WeakMap`, whose targets Perry retains rather than collects.
//! Object identity lives in a per-slot wrapper table the root scanner marks only while the object
//! is attached, so a detached mesh, its closure and the wrapper the closure captured are one cycle
//! the collector reclaims at the safe point.

use std::ffi::{c_char, c_int, CStr};
use std::sync::{Mutex, Once};

use perry_ffi::{
    alloc_string, gc_register_mutable_root_scanner_named, read_string, GcRootVisitor, JsClosure, JsString,
    RawClosureHeader,
};

/// One engine object, as game code names it: the C shim's slot, an ordinary small integer.
///
/// Not a Perry native handle. Decision 11 asks for explicit lifetimes, and a handle would buy only
/// a finalizer the corpus cannot rely on here: Perry 0.5.1520 pins any object handed to a
/// native-library function as a `jsvalue` argument, so nothing a game holds through the boundary is
/// ever reclaimed that way. A number crosses cleanly, and the facade releases the engine object by
/// name when the program lets it go.
pub type TnObject = i64;
const NO_OBJECT: TnObject = 0;


// --- the C shim (three/tn_three_shim.c), which owns the engine's handle table --------------------

// The C shim calls `tnx_adapter_dispatch` when the engine runs a callback; this crate provides it.
#[no_mangle]
pub unsafe extern "C" fn tnx_adapter_dispatch(
    object: c_int,
    scene: c_int,
    camera: c_int,
    geometry: c_int,
    material: c_int,
    error: *mut c_char,
    capacity: c_int,
) -> c_int {
    js_tn_dispatch(
        object as TnObject,
        scene as f64,
        camera as f64,
        geometry as f64,
        material as f64,
        error,
        capacity,
    )
}

extern "C" {
    fn tnx_init() -> c_int;
    fn tnx_live() -> c_int;
    fn tnx_resident_kb() -> c_int;
    fn tnx_attached(object: TnObject) -> c_int;
    fn tnx_construct(class_name: *const c_char) -> TnObject;
    fn tnx_invoke(self_: TnObject, method: *const c_char) -> c_int;
    fn tnx_get(self_: TnObject, path: *const c_char) -> c_int;
    fn tnx_set_number(self_: TnObject, path: *const c_char, value: f64) -> c_int;
    fn tnx_set_callback(self_: TnObject, name: *const c_char, on: c_int) -> c_int;
    fn tnx_arg_number(value: f64);
    fn tnx_arg_object(object: TnObject);
    fn tnx_result_number() -> f64;
    fn tnx_result_object() -> TnObject;
    fn tnx_result_string() -> *const c_char;
    fn tnx_release_slot(object: TnObject);
    /// three/tn_three_hooks.cpp: the engine's own RenderCallback, run as a renderer runs it.
    fn tnx_fire_before_render(object: c_int) -> *const c_char;
}

/// Reads a string parameter and hands the C ABI a NUL-terminated copy of it.
fn with_c_string<R>(text: JsString, refusal: R, body: impl FnOnce(*const c_char) -> R) -> R {
    match read_string(text).and_then(|value| std::ffi::CString::new(value).ok()) {
        Some(bytes) => body(bytes.as_ptr()),
        None => refusal,
    }
}

// --- per-object adapter state ----------------------------------------------------------------------

/// What one engine object owns: the closure its engine callback runs, and whether the adapter holds
/// it. The closure is a NaN-boxed Perry value in a slot the scanner below visits, so the collector
/// marks it and rewrites it across an evacuation.
///
/// A handle's identity lives in the facade's own table, never here: an object handed to a Perry
/// native-library function as a `jsvalue` argument is pinned by the call and never collected, so the
/// adapter is given handles and never wrappers.
#[derive(Default, Clone, Copy)]
struct Slot {
    closure: f64,
    held: bool,
    has_callback: bool,
    /// Set once the engine object is released, so a second box of the same slot finalizes to
    /// nothing and the engine sees exactly one release.
    released: bool,
}

#[derive(Default)]
struct State {
    slots: Vec<Slot>,
}

/// The table is heap-allocated, not a `static`: a static would sit in the data segment, which
/// Perry's conservative scan reads for root-looking words, and every stored wrapper would then
/// look permanently live.
static STATE: Mutex<Option<Box<State>>> = Mutex::new(None);

fn with_state<R>(body: impl FnOnce(&mut State) -> R) -> R {
    // A poisoned lock means a panic while holding it; the state is plain slots, so carry on.
    let mut guard = STATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let state = guard.get_or_insert_with(|| Box::new(State { slots: Vec::new() }));
    body(state)
}

fn slot_of(state: &State, object: TnObject) -> Slot {
    if object <= NO_OBJECT {
        return Slot::default();
    }
    state.slots.get(object as usize).copied().unwrap_or_default()
}

fn set_slot(state: &mut State, object: TnObject, entry: Slot) {
    if state.slots.len() <= object as usize {
        state.slots.resize(object as usize + 1, Slot::default());
    }
    state.slots[object as usize] = entry;
}

/// Load-bearing: without it a collection between `onBeforeRender = fn` and the engine's call would
/// sweep the closure and the next call would enter freed memory. Only a held slot is marked, so a
/// detached object's closure is collectable again and the mesh <-> closure cycle goes with it.
fn scan_roots(visitor: &mut GcRootVisitor<'_>) {
    with_state(|state| {
        for slot in state.slots.iter_mut() {
            // A wrapper this program still holds is reachable from the program, not from here: the
            // collector finds it through its own references. Only a slot the safe point holds —
            // a callback the engine may still run — is marked, so a detached one is collectable.
            if !slot.held {
                continue;
            }
            if slot.closure.to_bits() != 0 {
                visitor.visit_nanbox_f64_slot(&mut slot.closure);
            }
        }
    });
}

fn ensure_scanner() {
    static REGISTERED: Once = Once::new();
    REGISTERED.call_once(|| gc_register_mutable_root_scanner_named("tn-three-adapter", scan_roots));
}

/// A closure crosses the FFI boundary as a NaN-boxed value: `POINTER_TAG` over its address. The
/// typed call wants the address, so the tag comes off here.
const POINTER_MASK: u64 = 0x0000_FFFF_FFFF_FFFF;

/// The closure a NaN-boxed value names, or null when it names none.
fn closure_of(value: f64) -> Option<JsClosure> {
    if value.to_bits() == 0 {
        return None;
    }
    Some(unsafe { JsClosure::from_raw((value.to_bits() & POINTER_MASK) as *const RawClosureHeader) })
}

/// The facade's collection point. The engine objects nothing holds are already released, so the
/// only work left is Perry's, and Perry's automatic generational collector does it: this hook
/// deliberately does not call `gc()`, whose non-moving full mark-sweep reclaims dead blocks but
/// never compacts, so every call leaves resident memory higher.
#[no_mangle]
pub extern "C" fn js_tn_collect() {
    // A collection is the runtime's own work; the facade has already released what it let go of.
}







/// The message the facade reported for the throw it caught, so the engine's diagnostic carries it.
fn thrown_slot() -> &'static Mutex<Option<String>> {
    static THROWN: Mutex<Option<String>> = Mutex::new(None);
    &THROWN
}

// --- the facade's surface -------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn js_tn_init() -> i32 {
    ensure_scanner();
    unsafe { tnx_init() }
}




/// Stages one argument, as the C ABI's argument array expects: a number or an engine object.
/// Releases an engine object now, rather than waiting for the collector to reclaim the object that
/// holds it. The facade calls this when it drops the wrapper, so its engine object goes with it.
#[no_mangle]
pub extern "C" fn js_tn_release(object: TnObject) {
    if object <= NO_OBJECT {
        return;
    }
    let owned = with_state(|state| {
        let entry = slot_of(state, object);
        if entry.released {
            return false;
        }
        set_slot(state, object, Slot { released: true, ..entry });
        true
    });
    if !owned {
        return;
    }
    if with_state(|state| slot_of(state, object).has_callback) {
        unsafe { tnx_set_callback(object, b"onBeforeRender\0".as_ptr() as *const c_char, 0) };
        with_state(|state| {
            let mut entry = slot_of(state, object);
            entry.has_callback = false;
            entry.closure = 0.0;
            set_slot(state, object, entry);
        });
    }
    unsafe { tnx_release_slot(object) };
}

#[no_mangle]
pub extern "C" fn js_tn_arg_number(value: f64) {
    unsafe { tnx_arg_number(value) }
}

#[no_mangle]
pub extern "C" fn js_tn_arg_object(object: TnObject) {
    if object > NO_OBJECT {
        unsafe { tnx_arg_object(object) }
    }
}

#[no_mangle]
pub extern "C" fn js_tn_construct(class_name: JsString) -> TnObject {
    with_c_string(class_name, -1, |name| unsafe {
        let object = tnx_construct(name);
        if object < 0 {
            return NO_OBJECT;
        }
        with_state(|state| set_slot(state, object, Slot::default()));
        object as TnObject
    })
}

#[no_mangle]
pub extern "C" fn js_tn_invoke(object: TnObject, method: JsString) -> i32 {
    if object <= NO_OBJECT {
        return -1;
    }
    with_c_string(method, -1, |name| unsafe { tnx_invoke(object, name) })
}

#[no_mangle]
pub extern "C" fn js_tn_get(object: TnObject, path: JsString) -> i32 {
    if object <= NO_OBJECT {
        return -1;
    }
    with_c_string(path, -1, |name| unsafe { tnx_get(object, name) })
}

#[no_mangle]
pub extern "C" fn js_tn_set_number(object: TnObject, path: JsString, value: f64) -> i32 {
    if object <= NO_OBJECT {
        return -1;
    }
    with_c_string(path, -1, |name| unsafe { tnx_set_number(object, name, value) })
}

#[no_mangle]
pub extern "C" fn js_tn_result_number() -> f64 {
    unsafe { tnx_result_number() }
}

/// The engine object the last call returned, or no object. The same engine object always answers
/// with the same slot, so `===` in game code holds.
#[no_mangle]
pub extern "C" fn js_tn_result_object() -> TnObject {
    let object = unsafe { tnx_result_object() };
    if object <= NO_OBJECT {
        NO_OBJECT
    } else {
        object
    }
}

#[no_mangle]
pub extern "C" fn js_tn_result_string() -> *mut perry_ffi::StringHeader {
    let text = unsafe {
        let raw = tnx_result_string();
        if raw.is_null() {
            String::new()
        } else {
            CStr::from_ptr(raw).to_string_lossy().into_owned()
        }
    };
    alloc_string(&text).as_raw()
}

/// The engine half of `onBeforeRender`: attaches the facade closure to the object. The safe point
/// then decides how long it stays alive.
#[no_mangle]
pub extern "C" fn js_tn_set_callback(object: TnObject, name: JsString, closure: f64) -> i32 {
    if object <= NO_OBJECT {
        return -1;
    }
    with_c_string(name, -1, |callback_name| {
        let on = closure.to_bits() != 0;
        let status = unsafe { tnx_set_callback(object, callback_name, i32::from(on)) };
        if status < 0 {
            return status;
        }
        with_state(|state| {
            let mut entry = slot_of(state, object);
            entry.has_callback = on;
            entry.closure = if on { closure } else { f64::from_bits(0) };
            // The engine can run this callback at any point until the safe point lets it go.
            entry.held = on;
            set_slot(state, object, entry);
        });
        0
    })
}

/// The safe point a host runs between frames: hold the wrappers of objects the engine can still
/// reach, let the rest go. A detached object, its closure and the wrapper the closure captured are
/// then one cycle the collector reclaims, and the engine's callback pair goes with the hold, so it
/// stops calling an object the program can no longer reach.
#[no_mangle]
pub extern "C" fn js_tn_safe_point() {
    ensure_scanner();
    let mut detached: Vec<TnObject> = Vec::new();
    with_state(|state| {
        for (index, slot) in state.slots.iter_mut().enumerate() {
            if !slot.has_callback {
                continue;
            }
            let object = index as TnObject;
            let attached = unsafe { tnx_attached(object) != 0 };
            if !attached && slot.held {
                detached.push(object);
            }
            slot.held = attached;
        }
    });
    for object in detached {
        if with_state(|state| slot_of(state, object).has_callback) {
            unsafe { tnx_set_callback(object, b"onBeforeRender\0".as_ptr() as *const c_char, 0) };
            with_state(|state| {
                let mut entry = slot_of(state, object);
                entry.has_callback = false;
                entry.closure = f64::from_bits(0);
                set_slot(state, object, entry);
            });
        }
    }
}

/// Whether the safe point currently holds this object's wrapper: a callback-bearing object the
/// engine can still reach. The facade reads this to keep the wrappers the program can reach through
/// an attached object and release the rest.
#[no_mangle]
pub extern "C" fn js_tn_held(object: TnObject) -> i32 {
    with_state(|state| i32::from(slot_of(state, object).held))
}

#[no_mangle]
pub extern "C" fn js_tn_live() -> i32 {
    unsafe { tnx_live() }
}

#[no_mangle]
pub extern "C" fn js_tn_resident_kb() -> i32 {
    unsafe { tnx_resident_kb() }
}

/// Runs an object's callback through the engine, as its renderer does before a draw. The engine half
/// lives in three/tn_three_hooks.cpp, which needs the engine's own headers.
#[no_mangle]
pub extern "C" fn js_tn_fire_before_render(object: TnObject) -> *mut perry_ffi::StringHeader {
    let text = unsafe {
        let raw = tnx_fire_before_render(object as c_int);
        if raw.is_null() {
            String::new()
        } else {
            CStr::from_ptr(raw).to_string_lossy().into_owned()
        }
    };
    alloc_string(&text).as_raw()
}




/// Called by the facade's dispatch when it catches, so a throwing callback is a status and never a
/// crash: the message becomes the engine's render diagnostic and the draw goes on.
#[no_mangle]
pub extern "C" fn js_tn_callback_error(message: JsString) {
    let text = read_string(message).unwrap_or("the callback threw").to_owned();
    *thrown_slot().lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(text);
}


/// Runs the closure the engine's callback carries. The engine hands the other objects over as its
/// own handles, and the facade resolves each to the object it already has for that handle.
#[no_mangle]
pub unsafe extern "C" fn js_tn_dispatch(
    object: TnObject,
    scene: f64,
    camera: f64,
    geometry: f64,
    material: f64,
    error: *mut c_char,
    capacity: c_int,
) -> c_int {
    let Some(call) = closure_of(with_state(|state| slot_of(state, object).closure)) else {
        return 0;
    };
    *thrown_slot().lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    // The closure is the facade's own dispatch, which catches its throw and reports it here, so no
    // Perry exception crosses this frame. Its result is an ordinary JavaScript number, so it is read
    // as one: 0 ran, 1 threw.
    // The facade's own objects arrive as handles, which are NaN-boxed values the runtime keeps.
    let ran = call.call4(
        scene as f64,
        camera as f64,
        geometry as f64,
        material as f64,
    );
    if ran == 0.0 {
        return 0;
    }
    let text = thrown_slot()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
        .unwrap_or_else(|| String::from("the callback threw"));
    let bytes = std::ffi::CString::new(text).unwrap_or_default();
    let length = bytes.as_bytes().len().min(capacity.max(0) as usize);
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), error, length);
    *error.add(length) = 0;
    1
}

extern "C" {
    fn tnx_tsl_build(op: *const c_char, a: i64, b: i64, c: i64, value: f64) -> i64;
    fn tnx_tsl_error() -> *const c_char;
    fn tnx_tsl_set(material: i64, node: i64) -> c_int;
    fn tnx_tsl_compile(material: i64) -> c_int;
    fn tnx_tsl_release(node: i64);
    fn tnx_render(scene: i64, camera: i64) -> *const c_char;
}
#[no_mangle]
pub extern "C" fn js_tn_tsl_build(op: JsString, a: i64, b: i64, c: i64, value: f64) -> i64 {
    with_c_string(op, 0, |op| unsafe { tnx_tsl_build(op, a, b, c, value) })
}
#[no_mangle]
pub extern "C" fn js_tn_tsl_error() -> *mut perry_ffi::StringHeader {
    unsafe { alloc_string(CStr::from_ptr(tnx_tsl_error()).to_str().unwrap_or("TN_TSL_ERROR_UTF8")).as_raw() }
}
#[no_mangle]
pub extern "C" fn js_tn_tsl_set(material: i64, node: i64) -> c_int { unsafe { tnx_tsl_set(material, node) } }
#[no_mangle]
pub extern "C" fn js_tn_tsl_compile(material: i64) -> c_int { unsafe { tnx_tsl_compile(material) } }
#[no_mangle]
pub extern "C" fn js_tn_tsl_release(node: i64) { unsafe { tnx_tsl_release(node) } }
#[no_mangle]
pub extern "C" fn js_tn_render(scene: i64, camera: i64) -> *mut perry_ffi::StringHeader {
    unsafe { alloc_string(CStr::from_ptr(tnx_render(scene, camera)).to_str().unwrap_or("TN_RENDER_ERROR_UTF8")).as_raw() }
}
