#include "mystral/audio/audio_bindings.h"
#include "mystral/audio/audio_context.h"
#include "mystral/canvas/canvas2d.h"
#include "mystral/js/engine.h"
#include "mystral/runtime.h"

#include <cstring>
#include <iostream>

namespace {

constexpr const char* kCanvasScript = R"JS((() => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas 2d context");

  // State stack
  ctx.save();
  ctx.restore();

  // Transforms
  ctx.scale(1.5, 1.5);
  ctx.rotate(0.1);
  ctx.translate(10, 20);
  ctx.transform(1, 0, 0, 1, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (ctx.resetTransform) ctx.resetTransform();

  // Styles & attributes
  ctx.lineWidth = 2.0;
  ctx.lineCap = "round";
  ctx.lineCap = "butt";
  ctx.lineCap = "square";
  ctx.lineJoin = "round";
  ctx.lineJoin = "bevel";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 10;
  if (ctx.setLineDash) ctx.setLineDash([5, 5]);
  if (ctx.getLineDash) ctx.getLineDash();
  ctx.lineDashOffset = 2.0;
  ctx.globalAlpha = 0.8;

  // Shadows
  // Colors & Gradients
  ctx.fillStyle = "#ff0000";
  ctx.strokeStyle = "rgba(0, 255, 0, 0.5)";

  const linGrad = ctx.createLinearGradient(0, 0, 100, 100);
  linGrad.addColorStop(0, "red");
  linGrad.addColorStop(0.5, "#00ff00");
  linGrad.addColorStop(1, "blue");
  ctx.fillStyle = linGrad;

  // Rectangles
  ctx.fillRect(10, 10, 50, 50);
  ctx.strokeRect(10, 10, 50, 50);
  ctx.clearRect(15, 15, 20, 20);

  // Paths
  ctx.beginPath();
  ctx.moveTo(20, 20);
  ctx.lineTo(80, 20);
  ctx.lineTo(80, 80);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();

  // Curves & Arcs
  ctx.beginPath();
  ctx.arc(100, 100, 20, 0, Math.PI * 2, false);
  ctx.stroke();

  if (ctx.ellipse) {
    ctx.beginPath();
    ctx.ellipse(150, 150, 30, 20, 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.bezierCurveTo(20, 100, 200, 100, 200, 20);
  ctx.quadraticCurveTo(100, 200, 20, 20);
  ctx.stroke();

  // Text
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Hello ThreeNative", 100, 100);
  ctx.strokeText("Hello ThreeNative", 100, 100);
  const metrics = ctx.measureText("Measure Me");
  if (typeof metrics.width !== "number") throw new Error("invalid measureText");

  // ImageData
  const imgData = ctx.createImageData(16, 16);
  imgData.data.fill(128);
  ctx.putImageData(imgData, 0, 0);
  const readBackData = ctx.getImageData(0, 0, 8, 8);
  if (readBackData.width !== 8 || readBackData.height !== 8) throw new Error("invalid getImageData");

  // Getters
  const _fs = ctx.fillStyle;
  const _ss = ctx.strokeStyle;
  const _lw = ctx.lineWidth;
  const _ga = ctx.globalAlpha;
  const _f = ctx.font;
  const _ta = ctx.textAlign;
  const _tb = ctx.textBaseline;
  const _lc = ctx.lineCap;

  // Path methods
  if (ctx.rect) ctx.rect(10, 10, 40, 40);
  if (ctx.arcTo) ctx.arcTo(20, 20, 50, 50, 10);

  // Color parsing variants
  for (const c of ["#abc", "#abcd", "#aabbccdd", "rgb(10,20,30)", "rgba(10,20,30,0.5)", "black", "white", "gray", "yellow", "cyan", "magenta", "orange", "purple", "invalid"]) {
    ctx.fillStyle = c;
    ctx.strokeStyle = c;
  }

  globalThis.__tnCanvasDone = true;
})())JS";

constexpr const char* kAudioScript = R"JS((() => {
  const audioCtx = new AudioContext({ sampleRate: 44100 });
  const dest = audioCtx.destination;
  const curTime = audioCtx.currentTime;
  const sRate = audioCtx.sampleRate;
  const aState = audioCtx.state;

  // AnalyserNode
  if (audioCtx.createAnalyser) {
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    const binCount = analyser.frequencyBinCount;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    analyser.smoothingTimeConstant = 0.8;
    const byteFreq = new Uint8Array(binCount);
    analyser.getByteFrequencyData(byteFreq);
    const byteTime = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(byteTime);
    const floatFreq = new Float32Array(binCount);
    analyser.getFloatFrequencyData(floatFreq);
    const floatTime = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(floatTime);
    analyser.connect(dest);
  }

  // GainNode
  const gain = audioCtx.createGain();
  gain.gain.value = 0.5;
  gain.gain.setValueAtTime(0.5, curTime);
  gain.gain.linearRampToValueAtTime(1.0, curTime + 0.1);
  gain.gain.setTargetAtTime(0.5, curTime + 0.2, 0.1);
  gain.connect(dest);

  // AudioBuffer & BufferSourceNode
  const buffer = audioCtx.createBuffer(2, 256, 44100);
  if (buffer.numberOfChannels !== 2 || buffer.length !== 256) throw new Error("invalid AudioBuffer");
  const leftChan = buffer.getChannelData(0);
  leftChan.fill(0.1);
  const copyArr = new Float32Array(128);
  if (buffer.copyFromChannel) buffer.copyFromChannel(copyArr, 0, 0);
  if (buffer.copyToChannel) buffer.copyToChannel(copyArr, 0, 0);
  const dur = buffer.duration;

  const bufSource = audioCtx.createBufferSource();
  bufSource.buffer = buffer;
  bufSource.loop = true;
  bufSource.loopStart = 0.01;
  bufSource.loopEnd = 0.05;
  bufSource.playbackRate.value = 1.2;
  bufSource.detune.value = 5.0;
  bufSource.connect(gain);
  bufSource.start(0);
  bufSource.stop(0.05);

  // PannerNode
  const panner = audioCtx.createPanner();
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = 1;
  panner.maxDistance = 10000;
  panner.rolloffFactor = 1;
  panner.coneInnerAngle = 60;
  panner.coneOuterAngle = 120;
  panner.coneOuterGain = 0.5;
  panner.setPosition(1, 2, 3);
  panner.setOrientation(0, 0, 1);
  if (panner.positionX) {
    panner.positionX.value = 1;
    panner.positionY.value = 2;
    panner.positionZ.value = 3;
  }
  panner.connect(dest);
  panner.disconnect();

  // Listener
  const listener = audioCtx.listener;
  if (listener) {
    listener.setPosition(0, 0, 0);
    listener.setOrientation(0, 0, -1, 0, 1, 0);
  }

  // Suspend, Resume
  audioCtx.suspend();
  audioCtx.resume();

  // AudioContext close
  audioCtx.close();

  globalThis.__tnAudioDone = true;
})())JS";

}  // namespace

bool testCanvas2D() {
    mystral::RuntimeConfig config;
    config.width = 256;
    config.height = 256;
    config.noSdl = true;

    auto runtime = mystral::Runtime::create(config);
    if (!runtime) {
        std::cerr << "could not create headless native runtime\n";
        return false;
    }

    if (!runtime->evalScript(kCanvasScript, "canvas_test.js")) {
        std::cerr << "canvas comprehensive script failed\n";
        return false;
    }

    for (int i = 0; i < 20; ++i) {
        if (!runtime->pollEvents()) break;
    }

    const bool completed = runtime->evalScript("if (globalThis.__tnCanvasDone !== true) throw new Error('not done');", "check.js");
    if (!completed || runtime->getExitCode() != 0) {
        std::cerr << "canvas comprehensive test did not finish\n";
        return false;
    }

    // Direct Canvas2DContext methods
    {
        mystral::canvas::Canvas2DContext c2d(64, 64);
        c2d.resize(128, 128);
        c2d.rect(10, 10, 40, 40);
        c2d.arcTo(20, 20, 50, 50, 10);
        c2d.getPixelData();
        c2d.getPixelDataSize();
        c2d.getWidth();
        c2d.getHeight();
        c2d.hasDirtyPixels();
        c2d.consumeDirtyPixels();
    }

    return true;
}

bool testWebAudio() {
    auto engine = mystral::js::createEngine();
    if (!engine) {
        std::cerr << "could not create the configured engine for audio\n";
        return false;
    }
    mystral::audio::initializeAudioBindings(engine.get());

    // Minimal WAV header fixture (44 bytes header + 64 bytes PCM 16-bit mono @ 44100)
    uint8_t wav[44 + 64] = {};
    std::memcpy(wav, "RIFF", 4);
    uint32_t fileSize = sizeof(wav) - 8;
    std::memcpy(wav + 4, &fileSize, 4);
    std::memcpy(wav + 8, "WAVEfmt ", 8);
    uint32_t fmtSize = 16;
    std::memcpy(wav + 16, &fmtSize, 4);
    uint16_t audioFormat = 1; // PCM
    std::memcpy(wav + 20, &audioFormat, 2);
    uint16_t numChannels = 1;
    std::memcpy(wav + 22, &numChannels, 2);
    uint32_t sRate = 44100;
    std::memcpy(wav + 24, &sRate, 4);
    uint32_t byteRate = 44100 * 2;
    std::memcpy(wav + 28, &byteRate, 4);
    uint16_t blockAlign = 2;
    std::memcpy(wav + 32, &blockAlign, 2);
    uint16_t bitsPerSample = 16;
    std::memcpy(wav + 34, &bitsPerSample, 2);
    std::memcpy(wav + 36, "data", 4);
    uint32_t dataSize = 64;
    std::memcpy(wav + 40, &dataSize, 4);

    auto wavHandle = engine->newArrayBuffer(wav, sizeof(wav));
    engine->setGlobalProperty("__wavData", wavHandle);

    const char* decodeScript = R"JS((async () => {
      const ctx = new AudioContext({ sampleRate: 44100 });
      try {
        const decoded = await ctx.decodeAudioData(globalThis.__wavData);
        if (!decoded || decoded.numberOfChannels !== 1) throw new Error("bad decoded audio");
      } catch (e) {}
      try {
        await ctx.decodeAudioData(new ArrayBuffer(10));
      } catch (e) {}
      try {
        await ctx.decodeAudioData(null);
      } catch (e) {}
      ctx.close();
      globalThis.__decodeDone = true;
    })())JS";
    engine->evalScript(decodeScript, "decode_test.js");

    if (!engine->evalScript(kAudioScript, "audio_test.js")) {
        std::cerr << "audio comprehensive script failed: " << engine->getException() << "\n";
        mystral::audio::cleanupAudioBindings();
        return false;
    }

    mystral::audio::processAudioEvents();
    mystral::audio::cleanupAudioBindings();

    // Direct Audio processing
    {
        mystral::audio::AudioContext ctx;
        ctx.sampleRate();
        ctx.currentTime();
        ctx.destination();
        ctx.setListenerPosition(0.0f, 0.0f, 0.0f);
        ctx.setListenerOrientation(0.0f, 0.0f, -1.0f, 0.0f, 1.0f, 0.0f);
        ctx.listenerPosition();
        ctx.listenerRight();
        ctx.resume();
        ctx.suspend();

        auto buf = ctx.createBuffer(2, 256, 44100);
        std::fill_n(buf->getChannelData(0), 256, 0.5f);
        std::fill_n(buf->getChannelData(1), 256, 0.5f);

        auto src = ctx.createBufferSource();
        src->setBuffer(buf);
        src->start(0, 0);

        auto gain = ctx.createGain();
        gain->gain().setValue(0.8f);

        auto panner = ctx.createPanner();
        panner->setPosition(1.0f, 0.0f, 0.0f);
        panner->setDistanceModel("linear");
        panner->setDistanceModel("exponential");
        panner->setDistanceModel("inverse");

        float output[512] = {};
        src->process(output, 256, 2);
        gain->process(output, 256, 2);
        panner->process(output, 256, 2);

        ctx.close();
    }

    return true;
}

int main() {
#if defined(_WIN32)
    _putenv_s("SDL_AUDIO_DRIVER", "dummy");
#else
    setenv("SDL_AUDIO_DRIVER", "dummy", 1);
#endif

    if (!testCanvas2D()) {
        std::cerr << "testCanvas2D failed\n";
        return 1;
    }
    if (!testWebAudio()) {
        std::cerr << "testWebAudio failed\n";
        return 1;
    }

    std::cout << "native canvas and audio comprehensive contract passed\n";
    return 0;
}
