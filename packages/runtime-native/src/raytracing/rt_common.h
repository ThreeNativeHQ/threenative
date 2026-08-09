/**
 * MystralNative Ray Tracing Common Types & Abstract Interface
 *
 * Defines the abstract IRTBackend interface for hardware ray tracing.
 * Platform-specific implementations (DXR, Vulkan RT, Metal RT) will
 * derive from this interface.
 *
 * Reference: Khronos VK_KHR_ray_tracing_pipeline extension
 * Reference: Microsoft DXR (DirectX Raytracing) specification
 */

#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>

namespace mystral {
namespace rt {

// ============================================================================
// Geometry Description
// ============================================================================

/**
 * Geometry input for acceleration structure building.
 * Matches RTGeometry interface in src/raytracing/types.ts
 */
struct RTGeometryDesc {
    const float* vertices;      // Pointer to vertex position data
    size_t vertexCount;         // Number of vertices
    size_t vertexStride;        // Bytes between vertices (default: 12 for vec3)
    size_t vertexOffset;        // Offset to position in vertex (default: 0)
    const uint32_t* indices;    // Optional index data (nullptr for non-indexed)
    size_t indexCount;          // Number of indices (0 if non-indexed)
};

// ============================================================================
// Acceleration Structure Handles
// ============================================================================

/**
 * Opaque handle to a geometry resource.
 * Represents processed geometry data ready for BLAS construction.
 */
struct RTGeometryHandle {
    void* _handle = nullptr;
    uint32_t _id = 0;
};

/**
 * Opaque handle to a Bottom-Level Acceleration Structure (BLAS).
 * Contains one or more geometries in object space.
 */
struct RTBLASHandle {
    void* _handle = nullptr;
    uint32_t _id = 0;
};

/**
 * Instance of a BLAS within the Top-Level Acceleration Structure.
 * Defines position, orientation, and instance ID for a BLAS instance.
 */
struct RTTLASInstance {
    RTBLASHandle blas;          // BLAS to instance
    float transform[16];        // 4x4 transformation matrix (column-major)
    uint32_t instanceId;        // User-defined instance ID for shaders
    uint32_t mask;              // Visibility mask (default: 0xFF)
    uint32_t flags;             // Instance flags (e.g., cull disable)
};

/**
 * Opaque handle to a Top-Level Acceleration Structure (TLAS).
 * Contains instances of BLASes with their transforms.
 */
struct RTTLASHandle {
    void* _handle = nullptr;
    uint32_t _id = 0;
};

// ============================================================================
// Ray Tracing Options
// ============================================================================

/**
 * Options for tracing rays.
 */
struct TraceRaysOptions {
    RTTLASHandle tlas;          // Top-level acceleration structure
    uint32_t width;             // Output texture width
    uint32_t height;            // Output texture height
    void* outputTexture;        // WebGPU texture to write results to
    void* uniforms;             // Optional uniform buffer
    size_t uniformsSize;        // Size of uniform buffer in bytes
};

// ============================================================================
// Abstract Backend Interface
// ============================================================================

/**
 * Backend type enumeration.
 * Matches RTBackend type in src/raytracing/types.ts
 */
enum class RTBackendType {
    None,       // No hardware RT available (stub)
    DXR,        // DirectX Raytracing (Windows)
    Vulkan,     // Vulkan Ray Tracing (cross-platform)
    Metal       // Metal Performance Shaders (Apple)
};

/**
 * Get backend name as string.
 */
inline const char* getBackendName(RTBackendType type) {
    switch (type) {
        case RTBackendType::DXR:    return "dxr";
        case RTBackendType::Vulkan: return "vulkan";
        case RTBackendType::Metal:  return "metal";
        default:                    return "none";
    }
}

/**
 * Abstract ray tracing backend interface.
 *
 * Platform-specific implementations (DXR, Vulkan RT, Metal RT)
 * derive from this interface. The factory function createRTBackend()
 * selects the appropriate implementation based on platform capabilities.
 */
class IRTBackend {
public:
    virtual ~IRTBackend() = default;

    // ========================================================================
    // Capability Queries
    // ========================================================================

    /**
     * Check if hardware ray tracing is supported.
     * @return true if hardware RT is available and can be used
     */
    virtual bool isSupported() = 0;

    /**
     * Get the backend type.
     * @return Backend type enum
     */
    virtual RTBackendType getBackendType() = 0;

    /**
     * Get the backend name as string.
     * @return "dxr", "vulkan", "metal", or "none"
     */
    virtual const char* getBackend() = 0;

    // ========================================================================
    // Geometry Management
    // ========================================================================

    /**
     * Create geometry from vertex/index data.
     * Prepares geometry for acceleration structure building.
     *
     * @param desc Geometry description with vertex/index data
     * @return Geometry handle (check _handle != nullptr for success)
     */
    virtual RTGeometryHandle createGeometry(const RTGeometryDesc& desc) = 0;

    /**
     * Destroy a geometry handle and free its resources.
     */
    virtual void destroyGeometry(RTGeometryHandle geometry) = 0;

    // ========================================================================
    // Acceleration Structure Management
    // ========================================================================

    /**
     * Build a Bottom-Level Acceleration Structure from geometries.
     * BLASes contain geometry in object space and can be instanced in a TLAS.
     *
     * @param geometries Array of geometry handles
     * @param count Number of geometries
     * @return BLAS handle (check _handle != nullptr for success)
     */
    virtual RTBLASHandle createBLAS(RTGeometryHandle* geometries, size_t count) = 0;

    /**
     * Destroy a BLAS and free its resources.
     */
    virtual void destroyBLAS(RTBLASHandle blas) = 0;

    /**
     * Build a Top-Level Acceleration Structure from BLAS instances.
     * TLASes contain positioned instances of BLASes.
     *
     * @param instances Array of instance descriptions
     * @param count Number of instances
     * @return TLAS handle (check _handle != nullptr for success)
     */
    virtual RTTLASHandle createTLAS(const RTTLASInstance* instances, size_t count) = 0;

    /**
     * Update TLAS instance transforms without full rebuild.
     * More efficient than rebuilding when only transforms change.
     *
     * @param tlas TLAS to update
     * @param instances Updated instance descriptions
     * @param count Number of instances (must match original)
     */
    virtual void updateTLAS(RTTLASHandle tlas, const RTTLASInstance* instances, size_t count) = 0;

    /**
     * Destroy a TLAS and free its resources.
     */
    virtual void destroyTLAS(RTTLASHandle tlas) = 0;

    // ========================================================================
    // Ray Tracing Execution
    // ========================================================================

    /**
     * Trace rays and write results to output texture.
     *
     * @param options Trace options including TLAS, dimensions, output texture
     */
    virtual void traceRays(const TraceRaysOptions& options) = 0;
};

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create the appropriate RT backend for the current platform.
 * Returns a stub backend if no hardware RT is available.
 *
 * @return Unique pointer to the backend (never null)
 */
std::unique_ptr<IRTBackend> createRTBackend();

}  // namespace rt
}  // namespace mystral
