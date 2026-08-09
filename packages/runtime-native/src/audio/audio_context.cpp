/**
 * Web Audio API Implementation using SDL3
 */

#include "mystral/audio/audio_context.h"
#include <SDL3/SDL.h>
#include <iostream>
#include <cstring>
#include <cmath>
#include <algorithm>

namespace mystral {
namespace audio {

// ============================================================================
// AudioBuffer
// ============================================================================

AudioBuffer::AudioBuffer(float sampleRate, int numberOfChannels, size_t length)
    : sampleRate_(sampleRate)
    , numberOfChannels_(numberOfChannels)
    , length_(length) {
    channelData_.resize(numberOfChannels);
    for (int i = 0; i < numberOfChannels; i++) {
        channelData_[i].resize(length, 0.0f);
    }
}

AudioBuffer::~AudioBuffer() = default;

float* AudioBuffer::getChannelData(int channel) {
    if (channel < 0 || channel >= numberOfChannels_) return nullptr;
    return channelData_[channel].data();
}

const float* AudioBuffer::getChannelData(int channel) const {
    if (channel < 0 || channel >= numberOfChannels_) return nullptr;
    return channelData_[channel].data();
}

void AudioBuffer::setFromInterleaved(const float* data, size_t numSamples, int numChannels) {
    size_t frames = numSamples / numChannels;
    length_ = frames;
    numberOfChannels_ = numChannels;
    channelData_.resize(numChannels);

    for (int ch = 0; ch < numChannels; ch++) {
        channelData_[ch].resize(frames);
        for (size_t i = 0; i < frames; i++) {
            channelData_[ch][i] = data[i * numChannels + ch];
        }
    }
}

// ============================================================================
// AudioParam
// ============================================================================

AudioParam::AudioParam(float defaultValue)
    : startValue_(defaultValue)
    , targetValue_(defaultValue) {}

void AudioParam::setValue(float value) {
    startValue_.store(value, std::memory_order_relaxed);
    targetValue_.store(value, std::memory_order_relaxed);
    automation_.store(Automation::Immediate, std::memory_order_release);
}

void AudioParam::setValueAtTime(float value, double time) {
    startValue_.store(valueAtTime(time), std::memory_order_relaxed);
    targetValue_.store(value, std::memory_order_relaxed);
    startTime_.store(time, std::memory_order_relaxed);
    endOrConstant_.store(time, std::memory_order_relaxed);
    automation_.store(Automation::Scheduled, std::memory_order_release);
}

void AudioParam::linearRampToValueAtTime(float value, double endTime) {
    const double startTime = endOrConstant_.load(std::memory_order_relaxed);
    startValue_.store(valueAtTime(startTime), std::memory_order_relaxed);
    targetValue_.store(value, std::memory_order_relaxed);
    startTime_.store(startTime, std::memory_order_relaxed);
    endOrConstant_.store(std::max(endTime, startTime), std::memory_order_relaxed);
    automation_.store(Automation::Linear, std::memory_order_release);
}

void AudioParam::setTargetAtTime(float value, double startTime, double timeConstant) {
    startValue_.store(valueAtTime(startTime), std::memory_order_relaxed);
    targetValue_.store(value, std::memory_order_relaxed);
    startTime_.store(startTime, std::memory_order_relaxed);
    endOrConstant_.store(std::max(timeConstant, 0.0001), std::memory_order_relaxed);
    automation_.store(Automation::Target, std::memory_order_release);
}

float AudioParam::valueAtTime(double time) const {
    const float start = startValue_.load(std::memory_order_relaxed);
    const float target = targetValue_.load(std::memory_order_relaxed);
    const double startTime = startTime_.load(std::memory_order_relaxed);
    const double endOrConstant = endOrConstant_.load(std::memory_order_relaxed);
    switch (automation_.load(std::memory_order_acquire)) {
    case Automation::Scheduled:
        return time < startTime ? start : target;
    case Automation::Linear:
        if (time <= startTime) return start;
        if (time >= endOrConstant) return target;
        return start + (target - start) * static_cast<float>(
            (time - startTime) / std::max(endOrConstant - startTime, 0.0001)
        );
    case Automation::Target:
        if (time <= startTime) return start;
        return target + (start - target) * static_cast<float>(
            std::exp(-(time - startTime) / endOrConstant)
        );
    case Automation::Immediate:
        return target;
    }
    return target;
}

// ============================================================================
// AudioNode
// ============================================================================

AudioNode::AudioNode(AudioContext* context)
    : context_(context) {}

void AudioNode::connect(AudioNode* destination) {
    if (!destination) return;
    if (std::find(outputs_.begin(), outputs_.end(), destination) == outputs_.end()) {
        outputs_.push_back(destination);
    }
}

void AudioNode::disconnect() {
    outputs_.clear();
}

void AudioNode::disconnect(AudioNode* destination) {
    outputs_.erase(std::remove(outputs_.begin(), outputs_.end(), destination), outputs_.end());
}

void AudioNode::process(float* output, size_t numFrames, int numChannels) {
    for (auto* destination : outputs_) {
        if (destination) destination->process(output, numFrames, numChannels);
    }
}

// ============================================================================
// AudioDestinationNode
// ============================================================================

AudioDestinationNode::AudioDestinationNode(AudioContext* context)
    : AudioNode(context) {}

// ============================================================================
// GainNode
// ============================================================================

GainNode::GainNode(AudioContext* context)
    : AudioNode(context)
    , gain_(1.0f) {}

void GainNode::process(float* output, size_t numFrames, int numChannels) {
    const double startTime = context_->currentTime();
    const double secondsPerFrame = 1.0 / context_->sampleRate();
    for (size_t frame = 0; frame < numFrames; frame++) {
        const float gainValue = gain_.valueAtTime(startTime + frame * secondsPerFrame);
        for (int channel = 0; channel < numChannels; channel++) {
            output[frame * numChannels + channel] *= gainValue;
        }
    }
    AudioNode::process(output, numFrames, numChannels);
}

// ============================================================================
// PannerNode
// ============================================================================

PannerNode::PannerNode(AudioContext* context)
    : AudioNode(context) {}

void PannerNode::setPosition(float x, float y, float z) {
    x_.store(x, std::memory_order_relaxed);
    y_.store(y, std::memory_order_relaxed);
    z_.store(z, std::memory_order_relaxed);
}

void PannerNode::setRefDistance(float value) {
    refDistance_.store(std::max(value, 0.0001f), std::memory_order_relaxed);
}

void PannerNode::setMaxDistance(float value) {
    maxDistance_.store(std::max(value, 0.0001f), std::memory_order_relaxed);
}

void PannerNode::setRolloffFactor(float value) {
    rolloffFactor_.store(std::max(value, 0.0f), std::memory_order_relaxed);
}

bool PannerNode::setDistanceModel(const std::string& value) {
    if (value == "inverse") distanceModel_.store(DistanceModel::Inverse, std::memory_order_relaxed);
    else if (value == "linear") distanceModel_.store(DistanceModel::Linear, std::memory_order_relaxed);
    else if (value == "exponential") {
        distanceModel_.store(DistanceModel::Exponential, std::memory_order_relaxed);
    } else {
        return false;
    }
    return true;
}

void PannerNode::process(float* output, size_t numFrames, int numChannels) {
    const AudioVector3 listener = context_->listenerPosition();
    const AudioVector3 right = context_->listenerRight();
    const float dx = x_.load(std::memory_order_relaxed) - listener.x;
    const float dy = y_.load(std::memory_order_relaxed) - listener.y;
    const float dz = z_.load(std::memory_order_relaxed) - listener.z;
    const float distance = std::sqrt(dx * dx + dy * dy + dz * dz);
    const float refDistance = refDistance_.load(std::memory_order_relaxed);
    const float maxDistance = std::max(maxDistance_.load(std::memory_order_relaxed), refDistance);
    const float rolloff = rolloffFactor_.load(std::memory_order_relaxed);
    float attenuation = 1.0f;
    if (distance > refDistance) {
        switch (distanceModel_.load(std::memory_order_relaxed)) {
        case DistanceModel::Linear:
            attenuation = 1.0f - rolloff * (distance - refDistance) /
                std::max(maxDistance - refDistance, 0.0001f);
            break;
        case DistanceModel::Exponential:
            attenuation = std::pow(distance / refDistance, -rolloff);
            break;
        case DistanceModel::Inverse:
            attenuation = refDistance / (refDistance + rolloff * (distance - refDistance));
            break;
        }
    }
    attenuation = std::clamp(attenuation, 0.0f, 1.0f);
    const float inverseDistance = distance > 0.0001f ? 1.0f / distance : 0.0f;
    const float pan = std::clamp(
        (dx * right.x + dy * right.y + dz * right.z) * inverseDistance,
        -1.0f,
        1.0f
    );
    const float angle = (pan + 1.0f) * 3.14159265358979323846f * 0.25f;
    const float leftGain = std::cos(angle) * attenuation;
    const float rightGain = std::sin(angle) * attenuation;
    for (size_t frame = 0; frame < numFrames; frame++) {
        const size_t base = frame * numChannels;
        if (numChannels > 0) output[base] *= leftGain;
        if (numChannels > 1) output[base + 1] *= rightGain;
    }
    AudioNode::process(output, numFrames, numChannels);
}

// ============================================================================
// AudioBufferSourceNode
// ============================================================================

AudioBufferSourceNode::AudioBufferSourceNode(AudioContext* context)
    : AudioNode(context) {}

AudioBufferSourceNode::~AudioBufferSourceNode() {
    if (isPlaying()) {
        context_->unregisterSource(this);
    }
}

void AudioBufferSourceNode::setBuffer(std::shared_ptr<AudioBuffer> buffer) {
    buffer_ = buffer;
}

void AudioBufferSourceNode::start(double when, double offset, double duration) {
    if (isPlaying() || !buffer_) return;

    startTime_ = context_->currentTime() + when;
    offsetTime_ = offset;
    durationTime_ = duration;
    playbackPosition_ = static_cast<size_t>(offset * buffer_->sampleRate());
    stopTime_.store(-1, std::memory_order_release);
    endedPending_.store(false, std::memory_order_release);
    isPlaying_.store(true, std::memory_order_release);

    context_->registerSource(this);
}

void AudioBufferSourceNode::stop(double when) {
    if (!isPlaying()) return;
    stopTime_.store(context_->currentTime() + when, std::memory_order_release);
}

void AudioBufferSourceNode::process(float* output, size_t numFrames, int numChannels) {
    if (!isPlaying() || !buffer_) return;

    double currentTime = context_->currentTime();

    // Check if we should stop
    const double stopTime = stopTime_.load(std::memory_order_acquire);
    if (stopTime >= 0 && currentTime >= stopTime) {
        isPlaying_.store(false, std::memory_order_release);
        endedPending_.store(true, std::memory_order_release);
        return;
    }

    // Check if we should start yet
    if (currentTime < startTime_) {
        return;
    }

    int bufferChannels = buffer_->numberOfChannels();
    size_t bufferLength = buffer_->length();

    for (size_t frame = 0; frame < numFrames; frame++) {
        if (playbackPosition_ >= bufferLength) {
            if (loop_) {
                size_t loopStartSample = static_cast<size_t>(loopStart_ * buffer_->sampleRate());
                size_t loopEndSample = loopEnd_ > 0
                    ? static_cast<size_t>(loopEnd_ * buffer_->sampleRate())
                    : bufferLength;
                playbackPosition_ = loopStartSample;
            } else {
                // End of buffer
                isPlaying_.store(false, std::memory_order_release);
                endedPending_.store(true, std::memory_order_release);
                break;
            }
        }

        // Check duration limit
        if (durationTime_ > 0) {
            double playedTime = static_cast<double>(playbackPosition_) / buffer_->sampleRate() - offsetTime_;
            if (playedTime >= durationTime_) {
                isPlaying_.store(false, std::memory_order_release);
                endedPending_.store(true, std::memory_order_release);
                break;
            }
        }

        // Mix audio into output
        for (int ch = 0; ch < numChannels; ch++) {
            int srcChannel = ch % bufferChannels;
            const float* channelData = buffer_->getChannelData(srcChannel);
            if (channelData) {
                output[frame * numChannels + ch] += channelData[playbackPosition_];
            }
        }

        playbackPosition_++;
    }
    AudioNode::process(output, numFrames, numChannels);
}

// ============================================================================
// AudioContext
// ============================================================================

AudioContext::AudioContext() {
    destination_ = std::make_unique<AudioDestinationNode>(this);

    // Initialize SDL audio
    if (!SDL_WasInit(SDL_INIT_AUDIO)) {
        if (!SDL_InitSubSystem(SDL_INIT_AUDIO)) {
            std::cerr << "[Audio] Failed to init SDL audio: " << SDL_GetError() << std::endl;
            return;
        }
    }

    // Create audio stream
    SDL_AudioSpec spec;
    spec.freq = static_cast<int>(sampleRate_);
    spec.format = SDL_AUDIO_F32;
    spec.channels = 2;

    audioStream_ = SDL_OpenAudioDeviceStream(
        SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK,
        &spec,
        sdlAudioCallback,
        this
    );

    if (!audioStream_) {
        std::cerr << "[Audio] Failed to open audio device: " << SDL_GetError() << std::endl;
        return;
    }

    std::cout << "[Audio] AudioContext created (sample rate: " << sampleRate_ << " Hz)" << std::endl;
}

AudioContext::~AudioContext() {
    close();
}

double AudioContext::currentTime() const {
    return static_cast<double>(sampleCount_.load(std::memory_order_acquire)) / sampleRate_;
}

std::shared_ptr<AudioBuffer> AudioContext::createBuffer(int numberOfChannels, size_t length, float sampleRate) {
    return std::make_shared<AudioBuffer>(sampleRate, numberOfChannels, length);
}

std::unique_ptr<AudioBufferSourceNode> AudioContext::createBufferSource() {
    return std::make_unique<AudioBufferSourceNode>(this);
}

std::unique_ptr<GainNode> AudioContext::createGain() {
    return std::make_unique<GainNode>(this);
}

std::unique_ptr<PannerNode> AudioContext::createPanner() {
    return std::make_unique<PannerNode>(this);
}

void AudioContext::setListenerPosition(float x, float y, float z) {
    listenerX_.store(x, std::memory_order_relaxed);
    listenerY_.store(y, std::memory_order_relaxed);
    listenerZ_.store(z, std::memory_order_relaxed);
}

void AudioContext::setListenerOrientation(float forwardX, float forwardY, float forwardZ,
                                          float upX, float upY, float upZ) {
    listenerForwardX_.store(forwardX, std::memory_order_relaxed);
    listenerForwardY_.store(forwardY, std::memory_order_relaxed);
    listenerForwardZ_.store(forwardZ, std::memory_order_relaxed);
    listenerUpX_.store(upX, std::memory_order_relaxed);
    listenerUpY_.store(upY, std::memory_order_relaxed);
    listenerUpZ_.store(upZ, std::memory_order_relaxed);
}

AudioVector3 AudioContext::listenerPosition() const {
    return {
        listenerX_.load(std::memory_order_relaxed),
        listenerY_.load(std::memory_order_relaxed),
        listenerZ_.load(std::memory_order_relaxed),
    };
}

AudioVector3 AudioContext::listenerRight() const {
    const float fx = listenerForwardX_.load(std::memory_order_relaxed);
    const float fy = listenerForwardY_.load(std::memory_order_relaxed);
    const float fz = listenerForwardZ_.load(std::memory_order_relaxed);
    const float ux = listenerUpX_.load(std::memory_order_relaxed);
    const float uy = listenerUpY_.load(std::memory_order_relaxed);
    const float uz = listenerUpZ_.load(std::memory_order_relaxed);
    float x = fy * uz - fz * uy;
    float y = fz * ux - fx * uz;
    float z = fx * uy - fy * ux;
    const float length = std::sqrt(x * x + y * y + z * z);
    if (length <= 0.0001f) return {1.0f, 0.0f, 0.0f};
    x /= length;
    y /= length;
    z /= length;
    return {x, y, z};
}

std::shared_ptr<AudioBuffer> AudioContext::decodeAudioDataSync(const uint8_t* data, size_t length) {
    return decodeAudioFile(data, length, sampleRate_);
}

void AudioContext::resume() {
    if (state_ == State::Closed) return;
    if (audioStream_) {
        SDL_ResumeAudioStreamDevice(audioStream_);
    }
    state_ = State::Running;
    std::cout << "[Audio] AudioContext resumed" << std::endl;
}

void AudioContext::suspend() {
    if (state_ == State::Closed) return;
    if (audioStream_) {
        SDL_PauseAudioStreamDevice(audioStream_);
    }
    state_ = State::Suspended;
}

void AudioContext::close() {
    if (state_ == State::Closed) return;

    // Signal callback to stop processing first
    shuttingDown_.store(true, std::memory_order_release);

    if (audioStream_) {
        // Destroy the audio stream - SDL will wait for callbacks to finish
        SDL_DestroyAudioStream(audioStream_);
        audioStream_ = nullptr;
    }

    state_ = State::Closed;
}

void AudioContext::registerSource(AudioBufferSourceNode* source) {
    std::lock_guard<std::mutex> lock(sourcesMutex_);
    activeSources_.push_back(source);
    std::cout << "[Audio] Source registered, active sources: " << activeSources_.size() << std::endl;
}

void AudioContext::unregisterSource(AudioBufferSourceNode* source) {
    std::lock_guard<std::mutex> lock(sourcesMutex_);
    activeSources_.erase(
        std::remove(activeSources_.begin(), activeSources_.end(), source),
        activeSources_.end()
    );
}

void AudioContext::detachSources() {
    std::lock_guard<std::mutex> lock(sourcesMutex_);
    activeSources_.clear();
}

void AudioContext::audioCallback(float* output, int numFrames) {
    // Clear output buffer
    std::memset(output, 0, numFrames * 2 * sizeof(float));

    // Mix all active sources
    {
        std::lock_guard<std::mutex> lock(sourcesMutex_);
        const size_t sampleCount = static_cast<size_t>(numFrames) * 2;
        for (auto* source : activeSources_) {
            std::fill_n(sourceBuffer_.data(), sampleCount, 0.0f);
            source->process(sourceBuffer_.data(), numFrames, 2);
            for (size_t sample = 0; sample < sampleCount; sample++) {
                output[sample] += sourceBuffer_[sample];
            }
        }
        activeSources_.erase(
            std::remove_if(activeSources_.begin(), activeSources_.end(),
                           [](AudioBufferSourceNode* source) { return !source->isPlaying(); }),
            activeSources_.end()
        );
    }

    // Clamp output to [-1, 1]
    for (int i = 0; i < numFrames * 2; i++) {
        output[i] = std::clamp(output[i], -1.0f, 1.0f);
    }

    sampleCount_.fetch_add(static_cast<uint64_t>(numFrames), std::memory_order_release);
}

void AudioContext::sdlAudioCallback(void* userdata, SDL_AudioStream* stream, int additionalAmount, int totalAmount) {
    // Safety check: validate userdata pointer first
    if (!userdata || !stream) {
        return;
    }

    // SDL3 callback: we need to provide audio data to the stream
    // additionalAmount is the minimum bytes needed
    if (additionalAmount <= 0) return;

    auto* ctx = static_cast<AudioContext*>(userdata);

    // Check if we're shutting down - return silence immediately
    // Note: Don't do any I/O (cout) in callbacks - can cause hangs
    if (ctx->shuttingDown_.load(std::memory_order_relaxed)) {
        const int bytes = std::min(additionalAmount, static_cast<int>(ctx->callbackBuffer_.size() * sizeof(float)));
        std::memset(ctx->callbackBuffer_.data(), 0, bytes);
        SDL_PutAudioStreamData(stream, ctx->callbackBuffer_.data(), bytes);
        return;
    }

    int numFrames = additionalAmount / (2 * sizeof(float));  // Stereo float

    // Safety: limit numFrames to static buffer size
    if (numFrames <= 0 || numFrames > 4096) {
        numFrames = std::min(numFrames, 4096);
        if (numFrames <= 0) return;
    }

    // Use context-owned fixed storage to avoid allocation and cross-context races.
    ctx->audioCallback(ctx->callbackBuffer_.data(), numFrames);

    // Put audio data into the stream
    SDL_PutAudioStreamData(stream, ctx->callbackBuffer_.data(), numFrames * 2 * sizeof(float));
}

// ============================================================================
// Audio Decoding
// ============================================================================

std::shared_ptr<AudioBuffer> decodeAudioFile(const uint8_t* data, size_t length, float targetSampleRate) {
    // Use SDL to load audio data
    SDL_IOStream* io = SDL_IOFromConstMem(data, length);
    if (!io) {
        std::cerr << "[Audio] Failed to create IO stream" << std::endl;
        return nullptr;
    }

    SDL_AudioSpec spec;
    uint8_t* audioData = nullptr;
    uint32_t audioLen = 0;

    if (!SDL_LoadWAV_IO(io, true, &spec, &audioData, &audioLen)) {
        std::cerr << "[Audio] Failed to load audio: " << SDL_GetError() << std::endl;
        return nullptr;
    }

    // Convert to float if necessary
    std::vector<float> floatData;
    int numChannels = spec.channels;
    size_t numSamples = 0;

    if (spec.format == SDL_AUDIO_F32) {
        numSamples = audioLen / sizeof(float);
        floatData.resize(numSamples);
        std::memcpy(floatData.data(), audioData, audioLen);
    } else if (spec.format == SDL_AUDIO_S16) {
        numSamples = audioLen / sizeof(int16_t);
        floatData.resize(numSamples);
        const int16_t* src = reinterpret_cast<const int16_t*>(audioData);
        for (size_t i = 0; i < numSamples; i++) {
            floatData[i] = src[i] / 32768.0f;
        }
    } else if (spec.format == SDL_AUDIO_U8) {
        numSamples = audioLen;
        floatData.resize(numSamples);
        for (size_t i = 0; i < numSamples; i++) {
            floatData[i] = (audioData[i] - 128) / 128.0f;
        }
    } else {
        std::cerr << "[Audio] Unsupported audio format: " << spec.format << std::endl;
        SDL_free(audioData);
        return nullptr;
    }

    SDL_free(audioData);

    // Create AudioBuffer
    size_t numFrames = numSamples / numChannels;
    auto buffer = std::make_shared<AudioBuffer>(static_cast<float>(spec.freq), numChannels, numFrames);
    buffer->setFromInterleaved(floatData.data(), numSamples, numChannels);

    std::cout << "[Audio] Decoded audio: " << numFrames << " frames, "
              << numChannels << " channels, " << spec.freq << " Hz" << std::endl;

    return buffer;
}

}  // namespace audio
}  // namespace mystral
