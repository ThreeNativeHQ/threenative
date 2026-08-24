#pragma once

#include <cstddef>
#include <cstdint>

namespace mystral {
namespace js {
class Engine;
}

namespace webgpu {

struct BindingsState;

BindingsState* createBindingsState();
void destroyBindingsState(BindingsState* state);

bool initBindings(
    BindingsState* state,
    js::Engine* engine,
    void* wgpuInstance,
    void* wgpuDevice,
    void* wgpuQueue,
    void* wgpuSurface,
    uint32_t surfaceFormat,
    uint32_t presentMode,
    uint32_t width,
    uint32_t height,
    bool debug,
    void* wgpuAdapter = nullptr);

void setOffscreenTexture(BindingsState* state, void* texture, void* textureView);
void beginDawnFrame(BindingsState* state);
void endDawnFrame(BindingsState* state);

void* getCurrentRenderedTexture(BindingsState* state);
uint32_t getCurrentTextureWidth(BindingsState* state);
uint32_t getCurrentTextureHeight(BindingsState* state);
void* getCurrentSurfaceTexture(BindingsState* state);
void* getScreenshotBuffer(BindingsState* state);
size_t getScreenshotBufferSize(BindingsState* state);
uint32_t getScreenshotBytesPerRow(BindingsState* state);
uint32_t getScreenshotFormat(BindingsState* state);
uint64_t presentCount(BindingsState* state);
bool isScreenshotReady(BindingsState* state);
void clearScreenshotReady(BindingsState* state);
void requestFrameScreenshot(BindingsState* state);

void compositeCanvas2DToWebGPU(BindingsState* state);

using VideoCaptureCallback = void (*)(void* texture, uint32_t width, uint32_t height, void* userData);
void setVideoCaptureCallback(BindingsState* state, VideoCaptureCallback callback, void* userData);
void clearVideoCaptureCallback(BindingsState* state);

}  // namespace webgpu
}  // namespace mystral
