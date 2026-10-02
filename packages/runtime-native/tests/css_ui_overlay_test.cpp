// The `native-css` UI backend, end to end through the host's own seam.
//
// `ui.renderer: "native-css"` is the backend with no browser in it: the game's `src/ui/` is laid
// out by blitz-dom, rasterised on the CPU and handed to the compositor as premultiplied RGBA8.
// This proves the two facts that a screenshot cannot: that the frames arriving through
// `uiOverlayFrame()` really came from the CPU rasteriser (premultiplied RGBA, a counter that moves
// only on a repaint), and that a click inside a published element becomes exactly one message in
// the game's own queue — the same queue `__tnUiGameReceive` drains.
//
// It drives the public functions only, needs no window and no display, and asserts nothing about
// how the document looks: this is a bridge contract, not a pixel baseline.
//
// A build without `TN_ENABLE_CSS_UI` is asserted too, and the assertion is not "it did nothing":
// `attachDesktopCssUi` must refuse, say why, and leave the host reporting no overlay — which is the
// difference between an absent backend and a silently broken HUD.

#include "mystral/platform/ui_overlay.h"

#include <cstdio>
#include <cstdlib>
#include <string>

namespace {

int failures = 0;

void check(bool condition, const char* what) {
    if (condition) return;
    std::fprintf(stderr, "FAIL: %s\n", what);
    failures += 1;
}

/**
 * A fixed HUD: one section in the bottom-left corner holding one button, with a click listener.
 *
 * `position: fixed` plus explicit offsets because a hit test needs a box whose position is known
 * without measuring pixels — the points below are derived from the frame the host reports back, so
 * this holds at whatever size the document was attached at.
 */
constexpr const char* kHudBatch = R"({"ops":[
  {"op":"sheet","key":"hud","css":"section{position:fixed;left:24px;bottom:24px;width:80px;height:40px;background:#2563eb}button{display:block;width:80px;height:40px;background:#27272a}"},
  {"op":"create","id":1,"tag":"section"},
  {"op":"create","id":2,"tag":"button"},
  {"op":"append","parent":0,"child":1},
  {"op":"append","parent":1,"child":2},
  {"op":"listen","id":2,"event":"click"}
]})";

#if TN_ENABLE_CSS_UI

/** The centre of the fixture's button, normalized to the viewport the host reported. */
void buttonPoint(const mystral::platform::UiOverlayFrame& frame, float& nx, float& ny) {
    nx = 64.0f / static_cast<float>(frame.width);
    ny = static_cast<float>(frame.height - 44) / static_cast<float>(frame.height);
}

int runCssBackend() {
    check(mystral::platform::attachDesktopCssUi("/nonexistent-css-ui-root"),
          "attachDesktopCssUi returns false only when the document could not be created");
    check(mystral::platform::uiOverlayAttached(), "the CSS backend reports itself attached");

    check(mystral::platform::postUiMessage(kHudBatch), "a mutation batch reaches the document");
    // Fail closed: a batch naming an op that does not exist must be refused rather than half-applied.
    check(!mystral::platform::postUiMessage(R"({"ops":[{"op":"teleport","id":1}]})"),
          "a malformed batch is refused");

    mystral::platform::UiOverlayFrame frame = {};
    check(mystral::platform::uiOverlayFrame(frame), "the document paints without a web view");
    check(frame.pixels != nullptr && frame.length > 0, "the painted frame carries pixels");
    check(frame.width > 0 && frame.height > 0 && frame.stride > 0, "the frame is sized");
    check(frame.stride == frame.width * 4, "the rasteriser's own stride is four bytes a pixel");
    check(frame.length >= static_cast<size_t>(frame.stride) * frame.height,
          "the frame holds every row it claims");
    check(frame.isRgba, "vello_cpu hands back premultiplied RGBA, so the upload format must say so");
    const uint64_t firstCounter = frame.counter;
    check(firstCounter > 0, "the first paint counts as a published frame");
    check(mystral::platform::uiOverlayFramesPublished() >= 1,
          "the published-frame count moves on the first paint");

    // An unchanged document repaints nothing, which is what lets the composite skip the upload.
    mystral::platform::UiOverlayFrame unchanged = {};
    check(mystral::platform::uiOverlayFrame(unchanged), "an unchanged document still has a frame");
    check(unchanged.counter == firstCounter, "an unchanged document does not advance the counter");

    // The resize seam: the window's size is the document's viewport.
    mystral::platform::uiOverlaySetSize(480, 320);
    mystral::platform::UiOverlayFrame resized = {};
    check(mystral::platform::uiOverlayFrame(resized), "a resized document repaints");
    check(resized.width == 480 && resized.height == 320, "the document followed the surface");
    check(resized.counter > firstCounter, "a resize is a new frame");

    float buttonX = 0.0f;
    float buttonY = 0.0f;
    buttonPoint(resized, buttonX, buttonY);
    const float emptyX = 400.0f / 480.0f;
    const float emptyY = 20.0f / 320.0f;
    check(mystral::platform::uiOverlayHitTest(buttonX, buttonY),
          "a listener inside the HUD claims the pointer");
    check(!mystral::platform::uiOverlayHitTest(emptyX, emptyY),
          "the empty background belongs to the game");
    check(!mystral::platform::uiOverlayKeyboardCaptured(),
          "the CSS backend has no text editing, so it never claims a key");

    // Hover, press and release over the button, then the one message they owe the game.
    check(mystral::platform::uiOverlayRoutePointer("pointermove", buttonX, buttonY, 0, 1),
          "hovering the button is the UI's");
    check(mystral::platform::uiOverlayRoutePointer("pointerdown", buttonX, buttonY, 1, 1),
          "the press belongs to the UI");
    check(mystral::platform::uiOverlayRoutePointer("pointerup", buttonX, buttonY, 0, 1),
          "the release belongs to the UI");
    mystral::platform::pumpUiOverlay();
    std::string event;
    check(mystral::platform::takeUiMessage(event), "the click reached the game's message queue");
    check(event == R"({"type":"click","id":2})",
          "exactly one click, naming the button that was pressed");

    // A press on the empty background is the game's, and the latch that a drag relies on resets.
    check(!mystral::platform::uiOverlayRoutePointer("pointerdown", emptyX, emptyY, 1, 1),
          "a press outside the HUD is the game's");
    check(!mystral::platform::uiOverlayRoutePointer("pointerup", emptyX, emptyY, 0, 1),
          "and so is its release");
    check(!mystral::platform::takeUiMessage(event), "and it produced no UI message");

    mystral::platform::detachDesktopUiOverlay();
    check(!mystral::platform::uiOverlayAttached(), "detach reports the overlay gone");
    check(!mystral::platform::postUiMessage(kHudBatch),
          "a detached backend posts to nothing rather than to a dead document");

    return failures;
}

#else  // TN_ENABLE_CSS_UI

int runCssBackend() {
    // The option is off. The contract here is the refusal: a game that asked for this renderer must
    // be told, and the host must not start reporting an overlay it does not have.
    check(!mystral::platform::attachDesktopCssUi("ui"),
          "a build without the backend refuses the renderer");
    check(!mystral::platform::uiOverlayAttached(), "and reports no overlay afterwards");
    check(!mystral::platform::postUiMessage("{\"ops\":[]}"), "and posts to nothing");
    mystral::platform::UiOverlayFrame frame = {};
    check(!mystral::platform::uiOverlayFrame(frame), "and has no frame to composite");
    check(!mystral::platform::uiOverlayHitTest(0.5f, 0.5f), "and never claims a pointer");
    return failures;
}

#endif

}  // namespace

int main() {
    failures = runCssBackend();
    if (failures != 0) {
        std::fprintf(stderr, "native-css overlay contract: %d assertion(s) failed\n", failures);
        return 1;
    }
    std::printf("native-css overlay contract passed: TN_ENABLE_CSS_UI=%d\n",
#if TN_ENABLE_CSS_UI
                1
#else
                0
#endif
    );
    return 0;
}