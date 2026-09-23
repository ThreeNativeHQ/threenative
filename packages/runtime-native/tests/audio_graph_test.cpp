#include "mystral/audio/audio_context.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>

using mystral::audio::AudioContext;

namespace {

bool closeTo(float actual, float expected, float tolerance = 0.0001f) {
    return std::abs(actual - expected) <= tolerance;
}

std::shared_ptr<mystral::audio::AudioBuffer> constantBuffer(AudioContext& context) {
    auto buffer = context.createBuffer(1, 4, 44100.0f);
    std::fill_n(buffer->getChannelData(0), buffer->length(), 1.0f);
    return buffer;
}

}  // namespace

int main() {
#if defined(_WIN32)
    _putenv_s("SDL_AUDIO_DRIVER", "dummy");
#else
    setenv("SDL_AUDIO_DRIVER", "dummy", 1);
#endif

    AudioContext context;

    mystral::audio::AudioParam ramp(0.0f);
    ramp.setValueAtTime(0.0f, 0.0);
    ramp.linearRampToValueAtTime(1.0f, 1.0);
    if (!closeTo(ramp.valueAtTime(0.5), 0.5f)) {
        std::cerr << "gain automation failed: " << ramp.valueAtTime(0.5) << '\n';
        return 1;
    }

    auto gainSource = context.createBufferSource();
    auto gain = context.createGain();
    gain->gain().setValue(0.5f);
    gainSource->setBuffer(constantBuffer(context));
    gainSource->connect(gain.get());
    gain->connect(context.destination());
    gainSource->start();
    float gained[8] = {};
    gainSource->process(gained, 4, 2);
    if (!closeTo(gained[0], 0.5f) || !closeTo(gained[1], 0.5f)) {
        std::cerr << "gain graph failed: " << gained[0] << ", " << gained[1] << '\n';
        return 1;
    }

    auto rightSource = context.createBufferSource();
    auto panner = context.createPanner();
    rightSource->setBuffer(constantBuffer(context));
    panner->setPosition(10.0f, 0.0f, 0.0f);
    rightSource->connect(panner.get());
    panner->connect(context.destination());
    rightSource->start();
    float right[8] = {};
    rightSource->process(right, 4, 2);
    if (std::abs(right[0]) > 0.0001f || !closeTo(right[1], 0.1f)) {
        std::cerr << "right panner failed: " << right[0] << ", " << right[1] << '\n';
        return 1;
    }

    context.setListenerOrientation(0.0f, 0.0f, 1.0f, 0.0f, 1.0f, 0.0f);
    auto leftSource = context.createBufferSource();
    leftSource->setBuffer(constantBuffer(context));
    leftSource->connect(panner.get());
    leftSource->start();
    float left[8] = {};
    leftSource->process(left, 4, 2);
    if (!closeTo(left[0], 0.1f) || std::abs(left[1]) > 0.0001f) {
        std::cerr << "listener-relative panner failed: " << left[0] << ", " << left[1] << '\n';
        return 1;
    }

    auto endingSource = context.createBufferSource();
    endingSource->setBuffer(constantBuffer(context));
    endingSource->start();
    float ended[10] = {};
    endingSource->process(ended, 5, 2);
    if (endingSource->isPlaying() || !endingSource->takeEndedEvent() ||
        endingSource->takeEndedEvent()) {
        std::cerr << "source completion event was not edge-triggered\n";
        return 1;
    }

    std::cout << "audio graph ok: ramp-mid=0.5 gain=0.5 right=0.1 flipped-left=0.1 ended=1\n";
    return 0;
}
