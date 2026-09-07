#include "mystral/audio/audio_bindings.h"
#include "mystral/js/engine.h"
#include "mystral/runtime.h"

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

  globalThis.__tnCanvasDone = true;
})())JS";

constexpr const char* kAudioScript = R"JS((() => {
  const audioCtx = new AudioContext({ sampleRate: 44100 });
  const dest = audioCtx.destination;
  const curTime = audioCtx.currentTime;
  const sRate = audioCtx.sampleRate;
  const aState = audioCtx.state;

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
    return true;
}

bool testWebAudio() {
    auto engine = mystral::js::createEngine();
    if (!engine) {
        std::cerr << "could not create the configured engine for audio\n";
        return false;
    }
    mystral::audio::initializeAudioBindings(engine.get());

    if (!engine->evalScript(kAudioScript, "audio_test.js")) {
        std::cerr << "audio comprehensive script failed: " << engine->getException() << "\n";
        mystral::audio::cleanupAudioBindings();
        return false;
    }

    mystral::audio::processAudioEvents();
    mystral::audio::cleanupAudioBindings();
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
