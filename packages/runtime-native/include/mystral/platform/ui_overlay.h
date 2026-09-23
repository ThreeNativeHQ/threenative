/**
 * The UI overlay seam — the native half of the message bridge in `@threenative/core/ui-layer`.
 *
 * The UI runs in the platform's own browser-class renderer, composited over the game surface;
 * the game runs in this runtime beside it. Two realms, usually two processes, so everything
 * that crosses is one JSON string.
 *
 * Threading is the whole reason this file exists. The host delivers a page message on the
 * platform's UI thread (Android's main thread, not SDL's), while JavaScript may only be
 * touched from the thread that owns the engine. So inbound frames are queued here and drained
 * once per frame by the runtime, exactly like the lifecycle markers beside them.
 */
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace mystral {
namespace platform {

/**
 * Queue one frame the UI layer sent. Thread-safe; called from the platform's UI thread.
 *
 * The queue is bounded: a UI that posts faster than the game drains must lose its oldest
 * frames rather than grow without limit, and the drop is counted so a run can report it
 * instead of presenting as mysterious latency.
 */
void queueUiMessage(std::string frame);

/** Pop the oldest queued frame. Returns false when the queue is empty. */
bool takeUiMessage(std::string& frame);

/** How many inbound frames have been dropped for queue pressure across this run. */
uint64_t droppedUiMessages();

/**
 * Send one frame to the UI layer. Returns false when no overlay is attached, which is the
 * normal state for a game whose UI renderer is `native` and on any platform with no overlay
 * implementation yet.
 */
bool postUiMessage(const std::string& frame);

/** Whether an overlay attached itself on this run. Reported, never assumed. */
bool uiOverlayAttached();

/** Called by the platform host once its overlay is up, or has failed to come up. */
void setUiOverlayAttached(bool attached);

/**
 * Bring up the desktop overlay over the game window, serving the built UI from `uiRoot`.
 *
 * The page is served over a custom protocol rather than `file://`, which is the desktop
 * counterpart of Android's `WebViewAssetLoader`: a real origin, so `fetch`, module imports and
 * same-origin rules behave as they do on the web build.
 *
 * Android and iOS attach from their own hosts, in Java and Swift, before the runtime starts; only
 * desktop attaches from here, because only here does the runtime own the window. Returns false and
 * logs a named reason when it cannot — no compositor, no GTK, no container — rather than leaving a
 * game that asked for the web renderer with an opaque rectangle over its scene.
 */
bool attachDesktopUiOverlay(const std::string& uiRoot);

/** Give the desktop overlay its slice of the frame. A no-op where nothing is attached. */
void pumpUiOverlay();

/**
 * One completed UI frame, as the renderer needs it.
 *
 * `pixels` is valid until the next call to `uiOverlayFrame`, and it is the web view's own buffer —
 * nothing is copied on this side. `stride` is bytes per row and is not necessarily `width * 4`.
 * The bytes are premultiplied `B,G,R,A`, which is cairo's `ARGB32` on a little-endian host.
 */
struct UiOverlayFrame {
    const uint8_t* pixels = nullptr;
    size_t length = 0;
    uint32_t width = 0;
    uint32_t height = 0;
    uint32_t stride = 0;
    /// Advances only when the page's pixels changed, so an unchanged frame needs no upload.
    uint64_t counter = 0;
};

/**
 * The newest completed UI frame. Returns false until the page has painted once, and false on
 * Windows and macOS, whose web views draw themselves and never pass through here.
 *
 * Call once per frame, before drawing the UI quad: the pointer it hands back belongs to the frame
 * it was asked about.
 */
bool uiOverlayFrame(UiOverlayFrame& frame);

/** How many frames the web view has published. Monotonic; reported in the composite marker. */
uint64_t uiOverlayFramesPublished();

/**
 * Tell the offscreen UI how many pixels the game window has now, so the page re-lays out.
 *
 * The web view has no window of its own to follow, so without this it keeps the viewport it was
 * attached at and the composite stretches that layout across the swapchain. A no-op where nothing is
 * attached and on every platform whose web view is a real window the OS resizes for it.
 */
void uiOverlaySetSize(int width, int height);

/** Publish the interactive rectangles, normalized to the viewport, as x, y, width, height. */
void setUiHitRegions(const std::vector<float>& regions);

/**
 * Whether a normalized point is inside a published interactive rectangle.
 *
 * The playtest input bridge asks this before dispatching a synthetic pointer, and so does the
 * runtime before it forwards a real OS press, so both routes are decided by one list. False when
 * nothing is attached.
 */
bool uiOverlayHitTest(float nx, float ny);

/** How many interactive rectangles the page last published, for the OS press verdict line. */
size_t uiOverlayHitRegionCount();

/**
 * Dispatch one synthetic pointer event into the page, at a point normalized to the viewport.
 *
 * `type` is a DOM pointer event type (`pointerdown`, `pointermove`, `pointerup`). Returns false
 * when nothing is attached. Used by the playtest input bridge and, on Linux, by the runtime's own
 * forwarding of OS pointer input: with no overlay window there is nothing for the OS to route a
 * press into, so every press the player makes arrives here or goes to the game.
 */
bool uiOverlayInjectPointer(const char* type, float nx, float ny, int buttons, int pointerId);

/**
 * Dispatch one synthetic keyboard event into the page. Linux only; a no-op elsewhere.
 *
 * `type` is a DOM keyboard event type (`keydown`, `keyup`), `key` and `code` follow the DOM's own
 * naming, and `text` is the character the key would insert (empty for every key that types
 * nothing). Forwarded only while the page owns the keyboard — see `uiOverlayKeyboardCaptured`.
 */
bool uiOverlayInjectKey(const char* type, const char* key, const char* code, const char* text,
                        bool ctrl, bool alt, bool shift, bool meta);

/**
 * Whether the page holds the keyboard, so the host knows where a key belongs.
 *
 * True while the page has a focused input, textarea, select or open list. A published rectangle
 * says where a press landed and says nothing about who should receive `ArrowUp`, so the page's own
 * focus is the only honest authority; without this the host could only guess, and guessing wrong
 * either swallows a game's keys or leaves a focused control deaf. False when nothing is attached
 * and on every platform whose web view is a real window and gets keys from the OS itself.
 */
bool uiOverlayKeyboardCaptured();

/**
 * Decide which side a pointer event belongs to, and remember that answer for the rest of the
 * gesture. Returns true when the page owns the event and the game must not see it.
 *
 * One authority for both callers, because they must not be able to disagree: a real pointer event
 * arrives from the OS on Linux, and a synthetic one arrives from the playtest bridge, and both are
 * routed by the same published rectangles.
 *
 * `type` is a DOM pointer event type. `nx`/`ny` are normalized to the viewport; on a release they
 * are ignored, because a gesture is completed by the control that received its press and not by
 * wherever the pointer happened to be when it let go — a real system delivers the release to the
 * same target, and a synthetic release that carries no position at all must not be dropped for
 * failing a hit test it was never meant to face.
 *
 * The gesture latch is what makes a drag behave. A press inside a UI island keeps going to the page
 * even when the pointer leaves the island, or a drag out of a button becomes a game input halfway
 * through; a press on the game keeps going to the game, or a camera drag that crosses a HUD button
 * is stolen mid-move — the single most common way an overlay like this feels broken.
 */
bool uiOverlayRoutePointer(const char* type, float nx, float ny, int buttons, int pointerId);

/** Tear the desktop overlay down. Safe when nothing is attached. */
void detachDesktopUiOverlay();

#if defined(__APPLE__)
/**
 * The iOS overlay, in `ios/ui_overlay_ios.mm`.
 *
 * **UNPROVEN.** Never compiled, launched or touched — this repository has no macOS host. PRD-217's
 * acceptance criterion 6 asks for iOS to be proven or stated unproven, and this is the statement.
 */
bool attachIosUiOverlay(const std::string& uiRoot);
void detachIosUiOverlay();
bool postIosUiMessage(const std::string& frame);
#endif

}  // namespace platform
}  // namespace mystral
