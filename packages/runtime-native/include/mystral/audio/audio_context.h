/**
 * Web Audio API Implementation
 *
 * Provides AudioContext, AudioBufferSourceNode, GainNode using SDL3 audio.
 * Implements a subset of the W3C Web Audio API specification.
 */

#pragma once

#include <array>
#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>
#include <mutex>

struct SDL_AudioStream;

namespace mystral {
namespace audio {

// Forward declarations
class AudioContext;
class AudioNode;
class AudioBuffer;
class AudioBufferSourceNode;
class GainNode;
class PannerNode;
class AudioDestinationNode;

struct AudioVector3 {
    float x;
    float y;
    float z;
};

/**
 * AudioBuffer - holds decoded audio data
 */
class AudioBuffer {
public:
    AudioBuffer(float sampleRate, int numberOfChannels, size_t length);
    ~AudioBuffer();

    float sampleRate() const { return sampleRate_; }
    int numberOfChannels() const { return numberOfChannels_; }
    size_t length() const { return length_; }
    double duration() const { return static_cast<double>(length_) / sampleRate_; }

    // Get channel data (returns pointer to float samples)
    float* getChannelData(int channel);
    const float* getChannelData(int channel) const;

    // Set data from interleaved samples
    void setFromInterleaved(const float* data, size_t numSamples, int numChannels);

private:
    float sampleRate_;
    int numberOfChannels_;
    size_t length_;  // Number of sample frames
    std::vector<std::vector<float>> channelData_;
};

/**
 * AudioParam - represents an audio parameter that can be automated
 */
class AudioParam {
public:
    AudioParam(float defaultValue = 1.0f);

    float value() const { return targetValue_.load(std::memory_order_relaxed); }
    void setValue(float value);
    void setValueAtTime(float value, double time);
    void linearRampToValueAtTime(float value, double endTime);
    void setTargetAtTime(float value, double startTime, double timeConstant);
    float valueAtTime(double time) const;

private:
    enum class Automation { Immediate, Scheduled, Linear, Target };

    std::atomic<float> startValue_;
    std::atomic<float> targetValue_;
    std::atomic<double> startTime_{0.0};
    std::atomic<double> endOrConstant_{0.0};
    std::atomic<Automation> automation_{Automation::Immediate};
};

/**
 * AudioNode - base class for all audio nodes
 */
class AudioNode {
public:
    AudioNode(AudioContext* context);
    virtual ~AudioNode() = default;

    AudioContext* context() const { return context_; }

    virtual void connect(AudioNode* destination);
    virtual void disconnect();
    virtual void disconnect(AudioNode* destination);

    // For audio processing
    virtual void process(float* output, size_t numFrames, int numChannels);

protected:
    AudioContext* context_;
    std::vector<AudioNode*> outputs_;
};

/**
 * AudioDestinationNode - represents the final audio output
 */
class AudioDestinationNode : public AudioNode {
public:
    AudioDestinationNode(AudioContext* context);

    int maxChannelCount() const { return 2; }  // Stereo output
};

/**
 * GainNode - adjusts audio volume
 */
class GainNode : public AudioNode {
public:
    GainNode(AudioContext* context);

    AudioParam& gain() { return gain_; }
    const AudioParam& gain() const { return gain_; }

    void process(float* output, size_t numFrames, int numChannels) override;

private:
    AudioParam gain_;
};

/**
 * PannerNode - bounded positional audio for Three.js PositionalAudio.
 *
 * The native host implements listener-relative stereo pan plus Web Audio's
 * inverse, linear, and exponential distance models. HRTF convolution and
 * directional cones remain outside this bounded mixer.
 */
class PannerNode : public AudioNode {
public:
    explicit PannerNode(AudioContext* context);

    void setPosition(float x, float y, float z);
    void setRefDistance(float value);
    void setMaxDistance(float value);
    void setRolloffFactor(float value);
    bool setDistanceModel(const std::string& value);

    void process(float* output, size_t numFrames, int numChannels) override;

private:
    enum class DistanceModel { Inverse, Linear, Exponential };

    std::atomic<float> x_{0.0f};
    std::atomic<float> y_{0.0f};
    std::atomic<float> z_{0.0f};
    std::atomic<float> refDistance_{1.0f};
    std::atomic<float> maxDistance_{10000.0f};
    std::atomic<float> rolloffFactor_{1.0f};
    std::atomic<DistanceModel> distanceModel_{DistanceModel::Inverse};
};

/**
 * AudioBufferSourceNode - plays an AudioBuffer
 */
class AudioBufferSourceNode : public AudioNode {
public:
    AudioBufferSourceNode(AudioContext* context);
    ~AudioBufferSourceNode();

    void setBuffer(std::shared_ptr<AudioBuffer> buffer);
    std::shared_ptr<AudioBuffer> buffer() const { return buffer_; }

    bool loop() const { return loop_; }
    void setLoop(bool loop) { loop_ = loop; }

    double loopStart() const { return loopStart_; }
    void setLoopStart(double time) { loopStart_ = time; }

    double loopEnd() const { return loopEnd_; }
    void setLoopEnd(double time) { loopEnd_ = time; }

    // Playback control
    void start(double when = 0, double offset = 0, double duration = -1);
    void stop(double when = 0);

    bool isPlaying() const { return isPlaying_.load(std::memory_order_acquire); }
    bool takeEndedEvent() { return endedPending_.exchange(false, std::memory_order_acq_rel); }

    void process(float* output, size_t numFrames, int numChannels) override;

private:
    std::shared_ptr<AudioBuffer> buffer_;
    bool loop_ = false;
    double loopStart_ = 0;
    double loopEnd_ = 0;
    std::atomic<bool> isPlaying_{false};
    std::atomic<bool> endedPending_{false};
    size_t playbackPosition_ = 0;
    double startTime_ = 0;
    std::atomic<double> stopTime_{-1};
    double offsetTime_ = 0;
    double durationTime_ = -1;
};

/**
 * AudioContext - main interface for Web Audio API
 */
class AudioContext {
public:
    AudioContext();
    ~AudioContext();

    // State
    enum class State { Suspended, Running, Closed };
    State state() const { return state_; }

    // Properties
    float sampleRate() const { return sampleRate_; }
    double currentTime() const;
    AudioDestinationNode* destination() { return destination_.get(); }

    // Factory methods
    std::shared_ptr<AudioBuffer> createBuffer(int numberOfChannels, size_t length, float sampleRate);
    std::unique_ptr<AudioBufferSourceNode> createBufferSource();
    std::unique_ptr<GainNode> createGain();
    std::unique_ptr<PannerNode> createPanner();

    void setListenerPosition(float x, float y, float z);
    void setListenerOrientation(float forwardX, float forwardY, float forwardZ,
                                float upX, float upY, float upZ);
    AudioVector3 listenerPosition() const;
    AudioVector3 listenerRight() const;

    // Decode audio data (async in browser, sync here for simplicity)
    std::shared_ptr<AudioBuffer> decodeAudioDataSync(const uint8_t* data, size_t length);

    // Lifecycle
    void resume();
    void suspend();
    void close();

    // Internal: register/unregister active source nodes
    void registerSource(AudioBufferSourceNode* source);
    void unregisterSource(AudioBufferSourceNode* source);
    void detachSources();

private:
    void audioCallback(float* output, int numFrames);
    static void sdlAudioCallback(void* userdata, SDL_AudioStream* stream, int additionalAmount, int totalAmount);

    State state_ = State::Suspended;
    float sampleRate_ = 44100.0f;
    uint64_t startTime_ = 0;
    std::atomic<uint64_t> sampleCount_{0};

    std::unique_ptr<AudioDestinationNode> destination_;
    std::vector<AudioBufferSourceNode*> activeSources_;
    std::mutex sourcesMutex_;
    std::array<float, 8192> sourceBuffer_{};
    std::array<float, 8192> callbackBuffer_{};

    std::atomic<float> listenerX_{0.0f};
    std::atomic<float> listenerY_{0.0f};
    std::atomic<float> listenerZ_{0.0f};
    std::atomic<float> listenerForwardX_{0.0f};
    std::atomic<float> listenerForwardY_{0.0f};
    std::atomic<float> listenerForwardZ_{-1.0f};
    std::atomic<float> listenerUpX_{0.0f};
    std::atomic<float> listenerUpY_{1.0f};
    std::atomic<float> listenerUpZ_{0.0f};

    // SDL audio
    uint32_t audioDevice_ = 0;
    SDL_AudioStream* audioStream_ = nullptr;
    std::atomic<bool> shuttingDown_{false};
};

/**
 * Decode audio file data (WAV, MP3, OGG, etc.)
 * Returns nullptr on failure.
 */
std::shared_ptr<AudioBuffer> decodeAudioFile(const uint8_t* data, size_t length, float targetSampleRate);

}  // namespace audio
}  // namespace mystral
