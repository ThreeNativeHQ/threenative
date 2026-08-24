// The native runtime must decode Ogg Vorbis, because Ogg Vorbis is what ships.
//
// `decodeAudioFile` was one call to `SDL_LoadWAV_IO`, so the only container any native target
// could read was RIFF/WAVE. Every other lane emits Ogg: `create-threenative`'s asset workflow
// produces it, the templates carried `pickup.ogg`, and the browser half of the same source
// decodes it without comment. An APK built from a repository's own `public/` therefore died at
// startup with `TN_NATIVE_START_FAILED: decodeAudioData could not decode the supplied audio` —
// a black screen with the failure only in logcat. Desktop never noticed because its own proof
// fed a WAV built inline.
//
// This drives the installed JavaScript host the way a game does, on a genuine Ogg Vorbis file
// from this repository rather than on bytes assembled here: an Ogg header a test writes by hand
// proves nothing about a decoder. No window and no GPU — SDL runs on its dummy audio driver.
//
// Three things are proved together, because two of them are how the first one goes wrong:
//   1. a real Ogg Vorbis file decodes to audible PCM;
//   2. a truncated or corrupt Ogg fails in the same loud class SDL_LoadWAV_IO failures did,
//      rather than handing the game a buffer of silence;
//   3. the decoded rate is the context's rate, which `decodeAudioFile` was handed and ignored.
//      `AudioBufferSourceNode::process` advances one buffer frame per output frame, so a buffer
//      left at its own rate plays at the wrong pitch — a 22 050 Hz asset an octave high.

#include "mystral/audio/audio_bindings.h"
#include "mystral/js/engine.h"

#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

#ifndef THREENATIVE_OGG_FIXTURE
#error "THREENATIVE_OGG_FIXTURE must name a genuine Ogg Vorbis file on disk"
#endif

namespace {

std::vector<uint8_t> readFixture(const std::string &path) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) return {};
    return std::vector<uint8_t>((std::istreambuf_iterator<char>(stream)),
                                std::istreambuf_iterator<char>());
}

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
  const isBuffer = (value) =>
    value !== null && typeof value === "object" && typeof value.getChannelData === "function";

  // A PCM WAV at whatever rate the caller asks for, so the resampling claim is testable without
  // an asset. One second of a 100 Hz sine, 16-bit mono.
  const wav = (rate) => {
    const frames = rate;
    const bytes = new Uint8Array(44 + frames * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (offset, text) => {
      for (let index = 0; index < text.length; index += 1)
        bytes[offset + index] = text.charCodeAt(index);
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + frames * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, frames * 2, true);
    for (let frame = 0; frame < frames; frame += 1)
      view.setInt16(44 + frame * 2, Math.round(Math.sin((frame / rate) * 100 * Math.PI * 2) * 16384), true);
    return bytes.buffer;
  };

  const slice = (buffer, length) => buffer.slice(0, length);
  const corrupt = (buffer) => {
    const bytes = new Uint8Array(buffer.slice(0));
    // Keep "OggS" and destroy everything after it: the container still announces itself, so a
    // magic-number sniff alone would wave this through.
    for (let index = 4; index < bytes.length; index += 1) bytes[index] = (index * 37) & 0xff;
    return bytes.buffer;
  };

  const context = new AudioContext();
  const rate = context.sampleRate;
  const ogg = __tnFixture("ogg");

  check("the fixture is a genuine Ogg Vorbis file", () => {
    const head = new Uint8Array(ogg.slice(0, 33));
    const magic = String.fromCharCode(head[0], head[1], head[2], head[3]);
    const vorbis = String.fromCharCode(head[29], head[30], head[31], head[32]);
    return magic === "OggS" && vorbis === "vorb"
      ? undefined
      : "fixture starts " + magic + " / " + vorbis;
  });

  const decoded = context.decodeAudioData(ogg);
  const truncated = context.decodeAudioData(slice(ogg, 200));
  const garbled = context.decodeAudioData(corrupt(ogg));
  const resampled = context.decodeAudioData(wav(Math.round(rate / 2)));
  const native = context.decodeAudioData(wav(rate));

  check("decoding a real Ogg still hands back a Promise", () =>
    decoded instanceof Promise ? undefined : "got " + describe(decoded));

  Promise.resolve()
    .then(() => decoded.then((buffer) => buffer, (error) => ({ error })))
    .then((value) => {
      check("a genuine Ogg Vorbis file decodes", () =>
        isBuffer(value) ? undefined : "decodeAudioData settled with " + textOf(value.error ?? value));
      check("the decoded Ogg keeps its duration", () => {
        if (!isBuffer(value)) return "no buffer to measure";
        // The fixture is 8820 frames at 44 100 Hz: 0.2 s, whatever rate it is resampled to.
        return Math.abs(value.duration - 0.2) < 0.01
          ? undefined
          : "duration " + value.duration + " s, expected 0.2 s";
      });
      check("the decoded Ogg carries audio rather than silence", () => {
        if (!isBuffer(value)) return "no buffer to measure";
        const samples = value.getChannelData(0);
        let peak = 0;
        for (let index = 0; index < samples.length; index += 1)
          peak = Math.max(peak, Math.abs(samples[index]));
        return peak > 0.01 ? undefined : "peak amplitude " + peak;
      });
      check("the decoded Ogg is resampled to the context rate", () => {
        if (!isBuffer(value)) return "no buffer to measure";
        return value.sampleRate === rate
          ? undefined
          : "buffer rate " + value.sampleRate + ", context rate " + rate;
      });
      return truncated.then((value) => ({ resolvedInstead: value }), (error) => error);
    })
    .then((reason) => {
      check("a truncated Ogg fails loudly instead of decoding to silence", () =>
        reason instanceof Error ? undefined : "settled with " + describe(reason));
      return garbled.then((value) => ({ resolvedInstead: value }), (error) => error);
    })
    .then((reason) => {
      check("an Ogg header over corrupt data fails loudly", () =>
        reason instanceof Error ? undefined : "settled with " + describe(reason));
      return Promise.all([
        resampled.then((buffer) => buffer, (error) => ({ error })),
        native.then((buffer) => buffer, (error) => ({ error })),
      ]);
    })
    .then(([half, full]) => {
      check("WAV still decodes", () =>
        isBuffer(full) ? undefined : "settled with " + textOf(full.error ?? full));
      check("a half-rate asset is resampled rather than left to play sharp", () => {
        if (!isBuffer(half)) return "settled with " + textOf(half.error ?? half);
        if (half.sampleRate !== rate) return "buffer rate " + half.sampleRate + ", context rate " + rate;
        // One second in, one second out: the frame count follows the rate it was resampled to.
        return Math.abs(half.duration - 1) < 0.02 ? undefined : "duration " + half.duration + " s";
      });
      __tnReport(failures.length === 0 ? "ok" : failures.join("\n"));
    });

  return undefined;
})())JS";

struct EngineCase {
    mystral::js::EngineType type;
    const char *label;
};

// Every engine this build compiles in. The decode itself is C++, but the bytes reach it through
// each engine's own ArrayBuffer, and QuickJS (the Android rollback) and JSC (iOS) are different
// implementations of that.
constexpr EngineCase kEngines[] = {
    {mystral::js::EngineType::V8, "V8"},
    {mystral::js::EngineType::QuickJS, "QuickJS"},
    {mystral::js::EngineType::JavaScriptCore, "JavaScriptCore"},
};

bool runContract(const EngineCase &engineCase, const std::vector<uint8_t> &fixture, bool &ran) {
    ran = false;
    auto engine = mystral::js::createEngine(engineCase.type);
    if (engine == nullptr) {
        std::cout << "SKIP " << engineCase.label << ": not compiled into this build\n";
        return true;
    }
    ran = true;
    std::cout << "engine: " << engine->getName() << '\n';

    auto *raw = engine.get();
    mystral::audio::initializeAudioBindings(raw);

    raw->setGlobalProperty(
        "__tnFixture",
        raw->newFunction("__tnFixture",
                         [raw, &fixture](void *, const std::vector<mystral::js::JSValueHandle> &) {
                           return raw->newArrayBuffer(fixture.data(), fixture.size());
                         }));

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

    engine->evalWithResult(kScript, "audio_decode_ogg_test.js");

    for (int pass = 0; pass < 16 && report.empty(); pass += 1) {
        engine->processMicrotasks();
        engine->evalWithResult("undefined", "audio_decode_ogg_drain.js");
    }

    bool ok = true;
    if (report.empty()) {
        std::cerr << engineCase.label << ": the script did not reach its report";
        if (engine->hasException()) std::cerr << ": " << engine->getException();
        std::cerr << '\n';
        ok = false;
    } else if (report != "ok") {
        std::cerr << "native Ogg Vorbis decode contract failed on " << engineCase.label << ":\n"
                  << report << '\n';
        ok = false;
    } else {
        std::cout << "PASS " << engineCase.label << '\n';
    }

    mystral::audio::cleanupAudioBindings();
    return ok;
}

}  // namespace

int main() {
#if defined(_WIN32)
    _putenv_s("SDL_AUDIO_DRIVER", "dummy");
#else
    setenv("SDL_AUDIO_DRIVER", "dummy", 1);
#endif

    const std::string fixturePath = THREENATIVE_OGG_FIXTURE;
    const std::vector<uint8_t> fixture = readFixture(fixturePath);
    // Fail closed: a missing fixture is a failure, never a pass on zero bytes.
    if (fixture.size() < 64) {
        std::cerr << "the Ogg fixture is missing or too small to be one: " << fixturePath << '\n';
        return 1;
    }

    bool allPassed = true;
    int executed = 0;
    std::string proven;
    for (const EngineCase &engineCase : kEngines) {
        bool ran = false;
        if (!runContract(engineCase, fixture, ran)) allPassed = false;
        if (!ran) continue;
        executed += 1;
        if (!proven.empty()) proven += ", ";
        proven += engineCase.label;
    }

    // An empty run is a failure, not a pass: a build carrying no engine proves nothing.
    if (executed == 0) {
        std::cerr << "no JavaScript engine was compiled into this build\n";
        return 1;
    }
    if (!allPassed) return 1;

    std::cout << "native Ogg Vorbis decode contract passed on " << proven << '\n';
    return 0;
}
