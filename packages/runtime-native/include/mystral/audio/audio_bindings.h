/**
 * Web Audio API JavaScript Bindings
 */

#pragma once

namespace mystral {
namespace js {
class Engine;
}

namespace audio {

/**
 * Initialize Web Audio API bindings (AudioContext, etc.)
 */
void initializeAudioBindings(js::Engine* engine);

/** Dispatch audio-thread completion events to JavaScript on the main thread. */
void processAudioEvents();

/**
 * Deliver finished off-thread decodes to JavaScript. Called by `processAudioEvents()`, and exposed
 * separately because a test that owns no audio device still has to be able to drain them.
 */
void drainAudioDecodes();

/**
 * Cleanup all audio resources (call before destroying JS engine)
 */
void cleanupAudioBindings();

}  // namespace audio
}  // namespace mystral
