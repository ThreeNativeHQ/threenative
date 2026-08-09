/**
 * Canvas Shim
 *
 * Provides a browser-like canvas object that wraps the WebGPU surface.
 * This allows existing WebGPU code (Three.js, etc.) to work unchanged.
 *
 * Exposed to JS:
 * - canvas.width
 * - canvas.height
 * - canvas.getContext("webgpu") -> GPUCanvasContext
 * - canvas.addEventListener(type, handler)
 * - canvas.removeEventListener(type, handler)
 */

#include <iostream>

namespace mystral {
namespace canvas {

/**
 * Canvas state
 */
struct Canvas {
    int width = 800;
    int height = 600;
    void* gpuContext = nullptr;  // WGPUCanvasContext equivalent
};

/**
 * Create canvas bindings in JS
 */
bool initCanvasBindings(void* jsContext, int width, int height) {
    std::cout << "[Canvas] Initializing canvas shim (" << width << "x" << height << ")..." << std::endl;

    // TODO: Create canvas object in JS
    // TODO: Bind getContext method
    // TODO: Set up width/height properties

    return true;
}

/**
 * Update canvas size (called on window resize)
 */
void updateSize(void* jsContext, int width, int height) {
    std::cout << "[Canvas] Resize to " << width << "x" << height << std::endl;

    // TODO: Update JS canvas.width and canvas.height
    // TODO: Dispatch resize event
}

/**
 * Get the WebGPU context from canvas.getContext("webgpu")
 */
void* getWebGPUContext(void* surface) {
    std::cout << "[Canvas] getContext('webgpu') called" << std::endl;

    // TODO: Return GPUCanvasContext wrapper

    return nullptr;
}

}  // namespace canvas
}  // namespace mystral
