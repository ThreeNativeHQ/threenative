// The native Web Audio surface must hand back a real Promise from `decodeAudioData`.
//
// The binding used to return a hand-rolled thenable whose `then` returned `undefined`, so
// `decodeAudioData(buffer).then(use).catch(report)` threw on `undefined.catch` and
// `result instanceof Promise` was false. `await` and a single `.catch` happened to work,
// which is why it survived: Three.js `AudioLoader` only ever uses that one shape.
//
// This drives the installed JavaScript host the way a game does, so the Promise contract is
// observed at the same boundary. No window, no GPU — SDL runs on its dummy audio driver.

#include "mystral/audio/audio_bindings.h"
#include "mystral/js/engine.h"

#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

namespace {

constexpr const char *kScript = R"JS((() => {
  const failures = [];
  const textOf = (error) =>
    error === null || error === undefined
      ? String(error)
      : typeof error.message === "string"
        ? error.message
        : String(error);
  const record = (name, message) => failures.push(name + ": " + message);
  const check = (name, fn) => {
    try {
      const message = fn();
      if (message !== undefined) record(name, message);
    } catch (error) {
      record(name, "threw " + textOf(error));
    }
  };
  const describe = (value) => Object.prototype.toString.call(value);

  // A one-frame 16-bit mono WAV, built here so the proof needs no asset on disk.
  const wav = () => {
    const bytes = new Uint8Array(46);
    const view = new DataView(bytes.buffer);
    const ascii = (offset, text) => {
      for (let index = 0; index < text.length; index += 1)
        bytes[offset + index] = text.charCodeAt(index);
    };
    ascii(0, "RIFF");
    view.setUint32(4, 38, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 44100, true);
    view.setUint32(28, 88200, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, 2, true);
    view.setInt16(44, 16384, true);
    return bytes.buffer;
  };

  const context = new AudioContext();

  let callbackBuffer = undefined;
  const resolved = context.decodeAudioData(wav(), (buffer) => {
    callbackBuffer = buffer;
  });
  let callbackError = undefined;
  const rejected = context.decodeAudioData(new ArrayBuffer(0), undefined, (error) => {
    callbackError = error;
  });

  check("the legacy success callback still fires", () =>
    callbackBuffer !== undefined && typeof callbackBuffer.getChannelData === "function"
      ? undefined
      : "onSuccess received " + describe(callbackBuffer),
  );
  check("the legacy error callback still fires", () =>
    callbackError !== undefined ? undefined : "onError was not called",
  );

  check("a decoded buffer comes back as a Promise", () =>
    resolved instanceof Promise ? undefined : "got " + describe(resolved),
  );
  check("a decode failure comes back as a Promise", () =>
    rejected instanceof Promise ? undefined : "got " + describe(rejected),
  );
  check("then() on the success path returns a chainable Promise", () => {
    const next = resolved.then((value) => value);
    return next instanceof Promise && typeof next.catch === "function"
      ? undefined
      : "then() returned " + describe(next);
  });
  check("then() on the failure path returns a chainable Promise", () => {
    const next = rejected.then((value) => value);
    return next instanceof Promise && typeof next.catch === "function"
      ? undefined
      : "then() returned " + describe(next);
  });
  check("the Three.js shape still works", () => {
    const next = context.decodeAudioData(wav(), () => {}).catch(() => {});
    return next instanceof Promise ? undefined : "catch() returned " + describe(next);
  });

  // The settled values, once the microtask queue has run.
  Promise.resolve()
    .then(() => resolved.then((buffer) => buffer, (error) => ({ error })))
    .then((value) => {
      check("the success Promise settles with an AudioBuffer", () =>
        value !== null && typeof value === "object" && typeof value.getChannelData === "function"
          ? undefined
          : "resolved with " + describe(value),
      );
      return rejected.then(
        (value) => ({ resolvedInstead: value }),
        (error) => error,
      );
    })
    .then((reason) => {
      check("the failure Promise rejects with an Error", () =>
        reason instanceof Error ? undefined : "rejected with " + describe(reason),
      );
      __tnReport(failures.length === 0 ? "ok" : failures.join("\n"));
    });

  return undefined;
})())JS";

}  // namespace

int main() {
#if defined(_WIN32)
    _putenv_s("SDL_AUDIO_DRIVER", "dummy");
#else
    setenv("SDL_AUDIO_DRIVER", "dummy", 1);
#endif

    auto engine = mystral::js::createEngine();
    if (engine == nullptr) {
        std::cerr << "could not create a JavaScript engine\n";
        return 1;
    }
    std::cout << "engine: " << engine->getName() << '\n';

    auto *raw = engine.get();
    mystral::audio::initializeAudioBindings(raw);

    std::string report;
    raw->setGlobalProperty(
        "__tnReport",
        raw->newFunction("__tnReport",
                         [raw, &report](void *,
                                        const std::vector<mystral::js::JSValueHandle> &args) {
                           if (!args.empty() && raw->isString(args[0]))
                               report = raw->toString(args[0]);
                           return raw->newUndefined();
                         }));

    engine->evalWithResult(kScript, "audio_decode_promise_test.js");

    // Settling runs on the microtask queue. QuickJS drains pending jobs after each eval and V8
    // needs the explicit pump, so do both rather than assume which engine this build selected.
    for (int pass = 0; pass < 8 && report.empty(); pass += 1) {
        engine->processMicrotasks();
        engine->evalWithResult("undefined", "audio_decode_promise_drain.js");
    }

    if (report.empty()) {
        std::cerr << "the script did not reach its report";
        if (engine->hasException()) std::cerr << ": " << engine->getException();
        std::cerr << '\n';
        mystral::audio::cleanupAudioBindings();
        return 1;
    }
    if (report != "ok") {
        std::cerr << "native decodeAudioData Promise contract failed:\n" << report << '\n';
        mystral::audio::cleanupAudioBindings();
        return 1;
    }

    std::cout << "native decodeAudioData Promise contract passed\n";
    mystral::audio::cleanupAudioBindings();
    return 0;
}
