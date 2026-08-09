/**
 * Web Audio API JavaScript Bindings
 *
 * Exposes AudioContext, AudioBufferSourceNode, GainNode to JavaScript.
 */

#include "mystral/audio/audio_context.h"
#include "mystral/js/engine.h"
#include <iostream>
#include <unordered_map>

namespace mystral {
namespace audio {

// Global storage for audio objects
static std::unordered_map<void*, std::unique_ptr<AudioContext>> g_audioContexts;
static std::unordered_map<void*, std::shared_ptr<AudioBuffer>> g_audioBuffers;
static std::unordered_map<void*, std::unique_ptr<AudioBufferSourceNode>> g_sourceNodes;
static std::unordered_map<void*, js::JSValueHandle> g_sourceHandles;
static std::unordered_map<void*, std::unique_ptr<GainNode>> g_gainNodes;
static std::unordered_map<void*, std::unique_ptr<PannerNode>> g_pannerNodes;

static js::Engine* g_jsEngine = nullptr;

static void installAudioNodeBindings(js::Engine* engine, js::JSValueHandle jsNode,
                                     AudioNode* nodePtr) {
    engine->setPrivateData(jsNode, nodePtr);
    engine->setProperty(jsNode, "connect",
        engine->newFunction("connect", [nodePtr](void*, const std::vector<js::JSValueHandle>& args) {
            if (args.empty()) return g_jsEngine->newUndefined();
            auto* destination = static_cast<AudioNode*>(g_jsEngine->getPrivateData(args[0]));
            nodePtr->connect(destination);
            return args[0];
        })
    );
    engine->setProperty(jsNode, "disconnect",
        engine->newFunction("disconnect", [nodePtr](void*, const std::vector<js::JSValueHandle>& args) {
            if (args.empty()) nodePtr->disconnect();
            else {
                auto* destination = static_cast<AudioNode*>(g_jsEngine->getPrivateData(args[0]));
                nodePtr->disconnect(destination);
            }
            return g_jsEngine->newUndefined();
        })
    );
}

static js::JSValueHandle createPassiveAudioParamJS(js::Engine* engine, float initialValue) {
    auto param = engine->newObject();
    engine->setProperty(param, "value", engine->newNumber(initialValue));
    for (const char* name : {"setTargetAtTime", "setValueAtTime", "linearRampToValueAtTime"}) {
        engine->setProperty(param, name,
            engine->newFunction(name, [](void*, const std::vector<js::JSValueHandle>&) {
                return g_jsEngine->newUndefined();
            })
        );
    }
    return param;
}

// Track the current AudioContext being operated on (set via closure capture)
// This is a workaround for not having 'this' binding in callbacks

/**
 * Create AudioBuffer JS object
 */
js::JSValueHandle createAudioBufferJS(js::Engine* engine, std::shared_ptr<AudioBuffer> buffer) {
    auto jsBuffer = engine->newObject();

    // Store native pointer
    void* key = jsBuffer.ptr;
    g_audioBuffers[key] = buffer;

    // Store raw pointer as private data for lookup
    AudioBuffer* bufferPtr = buffer.get();
    engine->setPrivateData(jsBuffer, bufferPtr);

    // Properties
    engine->setProperty(jsBuffer, "sampleRate", engine->newNumber(buffer->sampleRate()));
    engine->setProperty(jsBuffer, "numberOfChannels", engine->newNumber(buffer->numberOfChannels()));
    engine->setProperty(jsBuffer, "length", engine->newNumber(static_cast<double>(buffer->length())));
    engine->setProperty(jsBuffer, "duration", engine->newNumber(buffer->duration()));

    // getChannelData(channel) - returns Float32Array view into native buffer
    engine->setProperty(jsBuffer, "getChannelData",
        engine->newFunction("getChannelData", [bufferPtr](void* ctx, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            if (args.empty()) return g_jsEngine->newUndefined();

            int channel = static_cast<int>(g_jsEngine->toNumber(args[0]));
            float* data = bufferPtr->getChannelData(channel);
            size_t length = bufferPtr->length();

            if (!data) return g_jsEngine->newUndefined();

            // Create Float32Array view into native buffer (no copy - JS writes directly to native memory)
            return g_jsEngine->createFloat32ArrayView(data, length);
        })
    );

    return jsBuffer;
}

/**
 * Create AudioBufferSourceNode JS object
 */
js::JSValueHandle createSourceNodeJS(js::Engine* engine, AudioBufferSourceNode* nodePtr, js::JSValueHandle contextJS) {
    auto jsNode = engine->newObject();
    installAudioNodeBindings(engine, jsNode, nodePtr);

    // Store context reference
    engine->setProperty(jsNode, "context", contextJS);

    // buffer property
    engine->setProperty(jsNode, "buffer", engine->newNull());
    engine->setProperty(jsNode, "_setBuffer",
        engine->newFunction("_setBuffer", [nodePtr](void* ctx, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            if (args.empty()) return g_jsEngine->newUndefined();

            // Get the native AudioBuffer pointer from the JS object's private data
            void* privateData = g_jsEngine->getPrivateData(args[0]);
            if (!privateData) {
                std::cerr << "[Audio] Warning: buffer has no private data" << std::endl;
                return g_jsEngine->newUndefined();
            }

            // Find the shared_ptr by matching the raw pointer
            AudioBuffer* rawBuffer = static_cast<AudioBuffer*>(privateData);
            for (auto& pair : g_audioBuffers) {
                if (pair.second.get() == rawBuffer) {
                    nodePtr->setBuffer(pair.second);
                    std::cout << "[Audio] Buffer set on source node (" << rawBuffer->length() << " frames)" << std::endl;
                    return g_jsEngine->newUndefined();
                }
            }

            std::cerr << "[Audio] Warning: buffer not found in registry" << std::endl;
            return g_jsEngine->newUndefined();
        })
    );

    // loop property
    engine->setProperty(jsNode, "loop", engine->newBoolean(false));
    engine->setProperty(jsNode, "_setLoop",
        engine->newFunction("_setLoop", [nodePtr](void* ctx, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            if (args.empty()) return g_jsEngine->newUndefined();
            nodePtr->setLoop(g_jsEngine->toBoolean(args[0]));
            return g_jsEngine->newUndefined();
        })
    );

    // loopStart, loopEnd
    engine->setProperty(jsNode, "loopStart", engine->newNumber(0));
    engine->setProperty(jsNode, "loopEnd", engine->newNumber(0));

    // start(when, offset, duration)
    engine->setProperty(jsNode, "start",
        engine->newFunction("start", [nodePtr](void* ctx, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            double when = args.size() > 0 ? g_jsEngine->toNumber(args[0]) : 0;
            double offset = args.size() > 1 ? g_jsEngine->toNumber(args[1]) : 0;
            double duration = args.size() > 2 ? g_jsEngine->toNumber(args[2]) : -1;

            std::cout << "[Audio] source.start() called - when=" << when << " offset=" << offset << std::endl;
            nodePtr->start(when, offset, duration);
            std::cout << "[Audio] source.start() - isPlaying=" << nodePtr->isPlaying() << std::endl;
            return g_jsEngine->newUndefined();
        })
    );

    // stop(when)
    engine->setProperty(jsNode, "stop",
        engine->newFunction("stop", [nodePtr](void* ctx, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            double when = args.size() > 0 ? g_jsEngine->toNumber(args[0]) : 0;
            nodePtr->stop(when);
            return g_jsEngine->newUndefined();
        })
    );

    // onended callback
    engine->setProperty(jsNode, "onended", engine->newNull());
    engine->setProperty(jsNode, "detune", createPassiveAudioParamJS(engine, 0.0f));
    engine->setProperty(jsNode, "playbackRate", createPassiveAudioParamJS(engine, 1.0f));

    engine->setGlobalProperty("__tnAudioSourceTemp", jsNode);
    engine->eval(R"(
        (function(source) {
            var buffer = null;
            var loop = false;
            Object.defineProperty(source, 'buffer', {
                get: function() { return buffer; },
                set: function(value) { buffer = value; source._setBuffer(value); }
            });
            Object.defineProperty(source, 'loop', {
                get: function() { return loop; },
                set: function(value) { loop = Boolean(value); source._setLoop(loop); }
            });
        })(__tnAudioSourceTemp);
    )", "audio-source-properties");

    return jsNode;
}

/**
 * Create GainNode JS object
 */
js::JSValueHandle createGainNodeJS(js::Engine* engine, GainNode* nodePtr, js::JSValueHandle contextJS) {
    auto jsNode = engine->newObject();
    installAudioNodeBindings(engine, jsNode, nodePtr);

    engine->setProperty(jsNode, "context", contextJS);

    // gain AudioParam
    auto gainParam = engine->newObject();
    engine->setProperty(gainParam, "_setValue",
        engine->newFunction("_setValue", [nodePtr](void* ctx, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            if (args.size() > 0) {
                nodePtr->gain().setValue(static_cast<float>(g_jsEngine->toNumber(args[0])));
            }
            return g_jsEngine->newUndefined();
        })
    );
    engine->setProperty(gainParam, "_setValueAtTime",
        engine->newFunction("_setValueAtTime", [nodePtr](void*, const std::vector<js::JSValueHandle>& args) {
            if (args.size() >= 2) {
                nodePtr->gain().setValueAtTime(
                    static_cast<float>(g_jsEngine->toNumber(args[0])),
                    g_jsEngine->toNumber(args[1])
                );
            }
            return g_jsEngine->newUndefined();
        })
    );
    engine->setProperty(gainParam, "_linearRampToValueAtTime",
        engine->newFunction("_linearRampToValueAtTime", [nodePtr](void*, const std::vector<js::JSValueHandle>& args) {
            if (args.size() >= 2) {
                nodePtr->gain().linearRampToValueAtTime(
                    static_cast<float>(g_jsEngine->toNumber(args[0])),
                    g_jsEngine->toNumber(args[1])
                );
            }
            return g_jsEngine->newUndefined();
        })
    );
    engine->setProperty(gainParam, "_setTargetAtTime",
        engine->newFunction("_setTargetAtTime", [nodePtr](void*, const std::vector<js::JSValueHandle>& args) {
            if (args.size() >= 3) {
                nodePtr->gain().setTargetAtTime(
                    static_cast<float>(g_jsEngine->toNumber(args[0])),
                    g_jsEngine->toNumber(args[1]),
                    g_jsEngine->toNumber(args[2])
                );
            }
            return g_jsEngine->newUndefined();
        })
    );
    engine->setGlobalProperty("__tnAudioGainParamTemp", gainParam);
    engine->eval(R"(
        (function(param) {
            var value = 1.0;
            Object.defineProperty(param, 'value', {
                get: function() { return value; },
                set: function(next) { value = Number(next); param._setValue(value); }
            });
            param.setTargetAtTime = function(next, time, constant) {
                value = Number(next); param._setTargetAtTime(value, time, constant); return param;
            };
            param.setValueAtTime = function(next, time) {
                value = Number(next); param._setValueAtTime(value, time); return param;
            };
            param.linearRampToValueAtTime = function(next, time) {
                value = Number(next); param._linearRampToValueAtTime(value, time); return param;
            };
        })(__tnAudioGainParamTemp);
    )", "audio-gain-param");
    engine->setProperty(jsNode, "gain", gainParam);

    return jsNode;
}

/**
 * Create the bounded PannerNode surface consumed by Three.js PositionalAudio.
 */
js::JSValueHandle createPannerNodeJS(js::Engine* engine, PannerNode* nodePtr,
                                     js::JSValueHandle contextJS) {
    auto jsNode = engine->newObject();
    installAudioNodeBindings(engine, jsNode, nodePtr);
    engine->setProperty(jsNode, "context", contextJS);
    engine->setProperty(jsNode, "setPosition",
        engine->newFunction("setPosition", [nodePtr](void*, const std::vector<js::JSValueHandle>& args) {
            if (args.size() >= 3) {
                nodePtr->setPosition(
                    static_cast<float>(g_jsEngine->toNumber(args[0])),
                    static_cast<float>(g_jsEngine->toNumber(args[1])),
                    static_cast<float>(g_jsEngine->toNumber(args[2]))
                );
            }
            return g_jsEngine->newUndefined();
        })
    );
    engine->setProperty(jsNode, "setOrientation",
        engine->newFunction("setOrientation", [](void*, const std::vector<js::JSValueHandle>&) {
            return g_jsEngine->newUndefined();
        })
    );
    engine->setProperty(jsNode, "_setRefDistance",
        engine->newFunction("_setRefDistance", [nodePtr](void*, const std::vector<js::JSValueHandle>& args) {
            if (!args.empty()) nodePtr->setRefDistance(static_cast<float>(g_jsEngine->toNumber(args[0])));
            return g_jsEngine->newUndefined();
        })
    );
    engine->setProperty(jsNode, "_setMaxDistance",
        engine->newFunction("_setMaxDistance", [nodePtr](void*, const std::vector<js::JSValueHandle>& args) {
            if (!args.empty()) nodePtr->setMaxDistance(static_cast<float>(g_jsEngine->toNumber(args[0])));
            return g_jsEngine->newUndefined();
        })
    );
    engine->setProperty(jsNode, "_setRolloffFactor",
        engine->newFunction("_setRolloffFactor", [nodePtr](void*, const std::vector<js::JSValueHandle>& args) {
            if (!args.empty()) nodePtr->setRolloffFactor(static_cast<float>(g_jsEngine->toNumber(args[0])));
            return g_jsEngine->newUndefined();
        })
    );
    engine->setProperty(jsNode, "_setDistanceModel",
        engine->newFunction("_setDistanceModel", [nodePtr](void*, const std::vector<js::JSValueHandle>& args) {
            if (!args.empty()) nodePtr->setDistanceModel(g_jsEngine->toString(args[0]));
            return g_jsEngine->newUndefined();
        })
    );
    engine->setGlobalProperty("__tnAudioPannerTemp", jsNode);
    engine->eval(R"(
        (function(panner) {
            function numberProperty(name, initial, setter) {
                var value = initial;
                Object.defineProperty(panner, name, {
                    get: function() { return value; },
                    set: function(next) { value = Number(next); panner[setter](value); }
                });
            }
            numberProperty('refDistance', 1.0, '_setRefDistance');
            numberProperty('maxDistance', 10000.0, '_setMaxDistance');
            numberProperty('rolloffFactor', 1.0, '_setRolloffFactor');
            var distanceModel = 'inverse';
            Object.defineProperty(panner, 'distanceModel', {
                get: function() { return distanceModel; },
                set: function(next) {
                    distanceModel = String(next);
                    panner._setDistanceModel(distanceModel);
                }
            });
            panner.panningModel = 'equalpower';
            panner.coneInnerAngle = 360;
            panner.coneOuterAngle = 360;
            panner.coneOuterGain = 0;
        })(__tnAudioPannerTemp);
    )", "audio-panner-properties");
    return jsNode;
}

/**
 * Create AudioContext JS object
 */
js::JSValueHandle createAudioContextJS(js::Engine* engine, AudioContext* ctxPtr) {
    g_jsEngine = engine;

    auto jsCtx = engine->newObject();

    // Properties
    engine->setProperty(jsCtx, "sampleRate", engine->newNumber(ctxPtr->sampleRate()));

    // currentTime getter - capture ctxPtr
    engine->setProperty(jsCtx, "_getCurrentTime",
        engine->newFunction("_getCurrentTime", [ctxPtr](void* c, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            return g_jsEngine->newNumber(ctxPtr->currentTime());
        })
    );

    // state property
    engine->setProperty(jsCtx, "state", engine->newString("suspended"));

    // destination
    auto destNode = engine->newObject();
    installAudioNodeBindings(engine, destNode, ctxPtr->destination());
    engine->setProperty(destNode, "maxChannelCount", engine->newNumber(2));
    engine->setProperty(jsCtx, "destination", destNode);

    // Three.js falls back to these legacy listener methods when AudioParam
    // coordinates are unavailable.
    auto listener = engine->newObject();
    engine->setProperty(listener, "setPosition",
        engine->newFunction("setPosition", [ctxPtr](void*, const std::vector<js::JSValueHandle>& args) {
            if (args.size() >= 3) {
                ctxPtr->setListenerPosition(
                    static_cast<float>(g_jsEngine->toNumber(args[0])),
                    static_cast<float>(g_jsEngine->toNumber(args[1])),
                    static_cast<float>(g_jsEngine->toNumber(args[2]))
                );
            }
            return g_jsEngine->newUndefined();
        })
    );
    engine->setProperty(listener, "setOrientation",
        engine->newFunction("setOrientation", [ctxPtr](void*, const std::vector<js::JSValueHandle>& args) {
            if (args.size() >= 6) {
                ctxPtr->setListenerOrientation(
                    static_cast<float>(g_jsEngine->toNumber(args[0])),
                    static_cast<float>(g_jsEngine->toNumber(args[1])),
                    static_cast<float>(g_jsEngine->toNumber(args[2])),
                    static_cast<float>(g_jsEngine->toNumber(args[3])),
                    static_cast<float>(g_jsEngine->toNumber(args[4])),
                    static_cast<float>(g_jsEngine->toNumber(args[5]))
                );
            }
            return g_jsEngine->newUndefined();
        })
    );
    engine->setProperty(jsCtx, "listener", listener);

    // createBuffer(numberOfChannels, length, sampleRate)
    engine->setProperty(jsCtx, "createBuffer",
        engine->newFunction("createBuffer", [ctxPtr](void* c, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            if (args.size() < 3) return g_jsEngine->newUndefined();

            int numChannels = static_cast<int>(g_jsEngine->toNumber(args[0]));
            size_t length = static_cast<size_t>(g_jsEngine->toNumber(args[1]));
            float sampleRate = static_cast<float>(g_jsEngine->toNumber(args[2]));

            auto buffer = ctxPtr->createBuffer(numChannels, length, sampleRate);
            return createAudioBufferJS(g_jsEngine, buffer);
        })
    );

    // createBufferSource() - capture ctxPtr only
    engine->setProperty(jsCtx, "createBufferSource",
        engine->newFunction("createBufferSource", [ctxPtr](void* c, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            auto node = ctxPtr->createBufferSource();
            auto* nodePtr = node.get();

            // Pass undefined for context (not needed for our implementation)
            auto jsNode = createSourceNodeJS(g_jsEngine, nodePtr, g_jsEngine->newUndefined());
            g_sourceNodes[jsNode.ptr] = std::move(node);
            g_jsEngine->protect(jsNode);
            g_sourceHandles[jsNode.ptr] = jsNode;

            return jsNode;
        })
    );

    // createGain()
    engine->setProperty(jsCtx, "createGain",
        engine->newFunction("createGain", [ctxPtr](void* c, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            auto node = ctxPtr->createGain();
            auto* nodePtr = node.get();

            // Pass undefined for context (not needed for our implementation)
            auto jsNode = createGainNodeJS(g_jsEngine, nodePtr, g_jsEngine->newUndefined());
            g_gainNodes[jsNode.ptr] = std::move(node);

            return jsNode;
        })
    );

    // createPanner()
    engine->setProperty(jsCtx, "createPanner",
        engine->newFunction("createPanner", [ctxPtr](void*, const std::vector<js::JSValueHandle>&) {
            auto node = ctxPtr->createPanner();
            auto* nodePtr = node.get();
            auto jsNode = createPannerNodeJS(g_jsEngine, nodePtr, g_jsEngine->newUndefined());
            g_pannerNodes[jsNode.ptr] = std::move(node);
            return jsNode;
        })
    );

    // decodeAudioData(arrayBuffer) -> Promise<AudioBuffer>
    engine->setProperty(jsCtx, "decodeAudioData",
        engine->newFunction("decodeAudioData", [ctxPtr](void* c, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            if (args.empty()) return g_jsEngine->newUndefined();

            // Get ArrayBuffer data
            size_t length = 0;
            void* data = g_jsEngine->getArrayBufferData(args[0], &length);

            if (!data || length == 0) {
                std::cerr << "[Audio] decodeAudioData: invalid ArrayBuffer" << std::endl;
                return g_jsEngine->newUndefined();
            }

            auto buffer = ctxPtr->decodeAudioDataSync(static_cast<const uint8_t*>(data), length);
            if (!buffer) {
                std::cerr << "[Audio] decodeAudioData: failed to decode" << std::endl;
                return g_jsEngine->newUndefined();
            }

            // For now, return the buffer directly (should be a Promise in full impl)
            return createAudioBufferJS(g_jsEngine, buffer);
        })
    );

    // resume() -> Promise - capture ctxPtr and jsCtxKey
    engine->setProperty(jsCtx, "resume",
        engine->newFunction("resume", [ctxPtr](void* c, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            ctxPtr->resume();
            // Skip state update for now - testing crash
            return g_jsEngine->newUndefined();
        })
    );

    // suspend() -> Promise
    engine->setProperty(jsCtx, "suspend",
        engine->newFunction("suspend", [ctxPtr](void* c, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            ctxPtr->suspend();
            // State update skipped - JS code should track state if needed
            return g_jsEngine->newUndefined();
        })
    );

    // close() -> Promise
    engine->setProperty(jsCtx, "close",
        engine->newFunction("close", [ctxPtr](void* c, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            ctxPtr->close();
            // State update skipped - JS code should track state if needed
            return g_jsEngine->newUndefined();
        })
    );

    return jsCtx;
}

/**
 * Initialize Web Audio API bindings
 */
void initializeAudioBindings(js::Engine* engine) {
    g_jsEngine = engine;

    // Create AudioContext constructor
    auto audioContextCtor = engine->newFunction("AudioContext",
        [](void* ctx, const std::vector<js::JSValueHandle>& args) -> js::JSValueHandle {
            auto context = std::make_unique<AudioContext>();
            auto* ctxPtr = context.get();

            auto jsCtx = createAudioContextJS(g_jsEngine, ctxPtr);
            g_audioContexts[jsCtx.ptr] = std::move(context);

            return jsCtx;
        }
    );

    // QuickJS native callbacks used directly with `new` keep their empty
    // constructor receiver. Copy the native context surface onto a JavaScript
    // receiver so Three.js gets the browser constructor contract on every engine.
    engine->setGlobalProperty("__tnCreateAudioContext", audioContextCtor);
    if (!engine->evalScript(
            "globalThis.AudioContext = function AudioContext() { "
            "var native = globalThis.__tnCreateAudioContext(); "
            "Object.defineProperties(this, Object.getOwnPropertyDescriptors(native)); "
            "Object.defineProperty(this, 'currentTime', { get: function() { "
            "return this._getCurrentTime(); } }); return this; }; "
            "globalThis.webkitAudioContext = globalThis.AudioContext;",
            "audio-context-constructor.js")) {
        std::cerr << "[Audio] Failed to install AudioContext constructor" << std::endl;
    }

    std::cout << "[Audio] Web Audio API bindings initialized" << std::endl;
}

void processAudioEvents() {
    if (!g_jsEngine) return;

    std::vector<void*> completed;
    for (const auto& [key, node] : g_sourceNodes) {
        if (!node->takeEndedEvent()) continue;

        auto handle = g_sourceHandles.find(key);
        if (handle == g_sourceHandles.end()) continue;
        auto callback = g_jsEngine->getProperty(handle->second, "onended");
        if (g_jsEngine->isFunction(callback)) {
            g_jsEngine->call(callback, handle->second, {});
            if (g_jsEngine->hasException()) {
                std::cerr << "[Audio] onended callback threw: "
                          << g_jsEngine->getException() << std::endl;
            }
        }
        g_jsEngine->unprotect(handle->second);
        completed.push_back(key);
    }
    for (void* key : completed) g_sourceHandles.erase(key);
}

void cleanupAudioBindings() {
    // Note: On macOS, SDL3's audio stream destruction can hang during shutdown
    // due to CoreAudio callbacks. For now, we leak the audio resources and let
    // the OS clean them up on process exit. This is safe since we're shutting down.
    //
    // TODO: Investigate SDL3/CoreAudio interaction on macOS
    // See: https://github.com/libsdl-org/SDL/issues

    // Stop callbacks from retaining source pointers before source storage is released.
    for (auto& pair : g_audioContexts) pair.second->detachSources();
    for (auto& pair : g_sourceHandles) g_jsEngine->unprotect(pair.second);
    g_sourceHandles.clear();

    // Release audio contexts without destroying them (which calls SDL_DestroyAudioStream)
    for (auto& pair : g_audioContexts) {
        pair.second.release();  // Leak intentionally - OS will clean up on exit
    }
    g_audioContexts.clear();

    // Source nodes and buffers don't have SDL resources, safe to destroy
    g_sourceNodes.clear();
    g_gainNodes.clear();
    g_pannerNodes.clear();
    g_audioBuffers.clear();
    g_jsEngine = nullptr;
}

}  // namespace audio
}  // namespace mystral
