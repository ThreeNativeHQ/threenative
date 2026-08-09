#pragma once

#include <string>
#include <vector>
#include <memory>
#include <cstdint>

namespace mystral {
namespace gltf {

/**
 * Vertex attribute data
 */
struct AttributeData {
    std::vector<float> data;
    int componentCount = 0;  // 2 for vec2, 3 for vec3, 4 for vec4
    size_t count = 0;        // Number of vertices
};

/**
 * Mesh primitive data
 */
struct PrimitiveData {
    AttributeData positions;
    AttributeData normals;
    AttributeData texcoords;
    AttributeData tangents;
    std::vector<uint32_t> indices;
    int materialIndex = -1;
};

/**
 * Mesh data containing multiple primitives
 */
struct MeshData {
    std::string name;
    std::vector<PrimitiveData> primitives;
};

/**
 * Texture info
 */
struct TextureInfo {
    int imageIndex = -1;
    int samplerIndex = -1;
};

/**
 * Material data
 */
struct MaterialData {
    std::string name;

    // PBR metallic-roughness
    float baseColorFactor[4] = {1, 1, 1, 1};
    float metallicFactor = 1.0f;
    float roughnessFactor = 1.0f;
    TextureInfo baseColorTexture;
    TextureInfo metallicRoughnessTexture;

    // Normal map
    TextureInfo normalTexture;
    float normalScale = 1.0f;

    // Occlusion
    TextureInfo occlusionTexture;
    float occlusionStrength = 1.0f;

    // Emissive
    float emissiveFactor[3] = {0, 0, 0};
    TextureInfo emissiveTexture;

    // Alpha mode
    enum class AlphaMode { Opaque, Mask, Blend };
    AlphaMode alphaMode = AlphaMode::Opaque;
    float alphaCutoff = 0.5f;
    bool doubleSided = false;
};

/**
 * Image data
 */
struct ImageData {
    std::string name;
    std::string uri;
    std::string mimeType;
    std::vector<uint8_t> data;  // Embedded or loaded data
    int bufferView = -1;
};

/**
 * Node transform
 */
struct NodeData {
    std::string name;
    int meshIndex = -1;

    // Transform (either matrix or TRS)
    bool hasMatrix = false;
    float matrix[16] = {1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1};
    float translation[3] = {0, 0, 0};
    float rotation[4] = {0, 0, 0, 1};  // quaternion
    float scale[3] = {1, 1, 1};

    std::vector<int> children;
};

/**
 * Scene data
 */
struct SceneData {
    std::string name;
    std::vector<int> nodes;
};

/**
 * Complete GLTF data
 */
struct GLTFData {
    std::vector<MeshData> meshes;
    std::vector<MaterialData> materials;
    std::vector<ImageData> images;
    std::vector<NodeData> nodes;
    std::vector<SceneData> scenes;
    int defaultScene = -1;
};

/**
 * Load GLTF/GLB from file
 */
std::unique_ptr<GLTFData> loadGLTF(const std::string& path);

/**
 * Load GLTF/GLB from memory
 */
std::unique_ptr<GLTFData> loadGLTFFromMemory(const uint8_t* data, size_t size, const std::string& basePath = "");

} // namespace gltf
} // namespace mystral
