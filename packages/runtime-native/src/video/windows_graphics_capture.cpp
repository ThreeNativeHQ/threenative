/**
 * Windows.Graphics.Capture Video Recorder (Windows 10 1803+)
 *
 * Uses Windows.Graphics.Capture API for high-quality, low-overhead screen capture.
 * Captures the SDL window directly and encodes to H.264/MP4 using Media Foundation.
 *
 * Requirements:
 * - Windows 10 version 1803 (April 2018 Update) or later
 * - Graphics Capture capability
 *
 * Architecture:
 * - Uses pimpl pattern to isolate C++/WinRT from Windows.h
 * - WinRT implementation is in windows_graphics_capture_impl.cpp
 */

#include "mystral/video/video_recorder.h"

#ifdef _WIN32

#include <iostream>

namespace mystral {
namespace video {

// Forward declaration of the implementation class (defined in windows_graphics_capture_impl.cpp)
class WindowsGraphicsCaptureRecorderImpl;

// Check if Windows.Graphics.Capture is available (Windows 10 1803+)
extern bool checkWindowsGraphicsCaptureAvailable();

// Create/destroy the implementation
extern WindowsGraphicsCaptureRecorderImpl* createWindowsGraphicsCaptureImplRaw();
extern void destroyWindowsGraphicsCaptureImpl(WindowsGraphicsCaptureRecorderImpl* impl);

// Implementation interface functions
extern bool implStartRecording(WindowsGraphicsCaptureRecorderImpl* impl, void* hwnd,
                                const std::string& outputPath, int fps, int width, int height);
extern bool implStopRecording(WindowsGraphicsCaptureRecorderImpl* impl);
extern bool implIsRecording(WindowsGraphicsCaptureRecorderImpl* impl);
extern int implGetCapturedFrames(WindowsGraphicsCaptureRecorderImpl* impl);
extern int implGetDroppedFrames(WindowsGraphicsCaptureRecorderImpl* impl);

/**
 * Windows Graphics Capture Video Recorder
 */
class WindowsGraphicsCaptureRecorder : public VideoRecorder {
public:
    WindowsGraphicsCaptureRecorder() : impl_(createWindowsGraphicsCaptureImplRaw()) {}

    ~WindowsGraphicsCaptureRecorder() override {
        if (impl_) {
            destroyWindowsGraphicsCaptureImpl(impl_);
            impl_ = nullptr;
        }
    }

    bool startRecording(void* nativeWindowHandle,
                        const std::string& outputPath,
                        const VideoRecorderConfig& config) override {
        if (!impl_) {
            std::cerr << "[WindowsGraphicsCapture] Implementation not available" << std::endl;
            return false;
        }
        return implStartRecording(impl_, nativeWindowHandle, outputPath,
                                  config.fps, config.width, config.height);
    }

    bool stopRecording() override {
        if (!impl_) return false;
        return implStopRecording(impl_);
    }

    bool isRecording() const override {
        if (!impl_) return false;
        return implIsRecording(impl_);
    }

    VideoRecorderStats getStats() const override {
        VideoRecorderStats stats{};
        if (impl_) {
            stats.capturedFrames = implGetCapturedFrames(impl_);
            stats.droppedFrames = implGetDroppedFrames(impl_);
        }
        return stats;
    }

    const char* getTypeName() const override { return "WindowsGraphicsCaptureRecorder"; }

    void processFrame() override {
        // No-op - capture happens via WinRT callbacks
    }

    bool captureFrame(void* texture, uint32_t width, uint32_t height) override {
        (void)texture; (void)width; (void)height;
        return true; // No-op - capture happens via WinRT callbacks
    }

    bool hasImpl() const { return impl_ != nullptr; }

private:
    WindowsGraphicsCaptureRecorderImpl* impl_;
};

// Factory function
std::unique_ptr<VideoRecorder> createWindowsGraphicsCaptureRecorder() {
    if (!checkWindowsGraphicsCaptureAvailable()) {
        return nullptr;
    }
    auto recorder = std::make_unique<WindowsGraphicsCaptureRecorder>();
    if (!recorder->hasImpl()) {
        return nullptr;
    }
    return recorder;
}

bool isWindowsGraphicsCaptureAvailableCheck() {
    return checkWindowsGraphicsCaptureAvailable();
}

}  // namespace video
}  // namespace mystral

#else  // Not Windows

namespace mystral {
namespace video {

std::unique_ptr<VideoRecorder> createWindowsGraphicsCaptureRecorder() {
    return nullptr;
}

bool isWindowsGraphicsCaptureAvailableCheck() {
    return false;
}

}  // namespace video
}  // namespace mystral

#endif  // _WIN32
