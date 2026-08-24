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

#include <string>

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

}  // namespace platform
}  // namespace mystral
