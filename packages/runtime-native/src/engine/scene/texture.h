#pragma once

// The native texture path (PRD-531 textures slice): a material's `map` as the renderer reads it.
// A Texture owns decoded RGBA bytes (RGBA8 or RGBA32Float), the sampler state three declares on it
// and the uv transform (repeat/offset/rotation/center) three applies before it samples. DataTexture
// is the fixture-built one; Texture is the empty base a loader fills. Header-only: the class carries
// no engine algorithm a binding cannot inline.

#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "engine/foundation/math/Vector.h"

namespace tn::engine {

/** three's wrapping constants (three/src/constants.js), the values a fixture passes. */
enum class TextureWrap : uint16_t { Repeat = 1000, ClampToEdge = 1001, MirroredRepeat = 1002 };
/** three's filter constants (three/src/constants.js); only the two a non-mipmapped sample needs. */
enum class TextureFilter : uint16_t { Nearest = 1003, Linear = 1006 };
inline constexpr uint16_t kTextureUnsignedByteType = 1009;  // three's UnsignedByteType
inline constexpr uint16_t kTextureFloatType = 1015;         // three's FloatType
inline constexpr uint16_t kTextureRGBAFormat = 1023;        // three's RGBAFormat

/** three's ColorSpace: NoColorSpace (empty string) or an sRGB-encoded texture. */
enum class TextureColorSpace : uint8_t { None, SRGB };

class Texture {
public:
    virtual ~Texture() = default;

    std::string name;
    int source = -1;  // the glTF image index a loaded texture records before its bytes are decoded
    // three's Texture defaults (DataTexture overrides magFilter/minFilter to Nearest).
    uint16_t mapping = 300;  // UVMapping; equirectangular reflection is 303
    uint16_t wrapS = static_cast<uint16_t>(TextureWrap::ClampToEdge);
    uint16_t wrapT = static_cast<uint16_t>(TextureWrap::ClampToEdge);
    uint16_t magFilter = static_cast<uint16_t>(TextureFilter::Linear);
    uint16_t minFilter = static_cast<uint16_t>(TextureFilter::Linear);
    uint16_t format = kTextureRGBAFormat;
    uint16_t type = kTextureUnsignedByteType;
    TextureColorSpace colorSpace = TextureColorSpace::None;
    Vector2 repeat{1, 1};
    Vector2 offset{0, 0};
    double rotation = 0;
    Vector2 center{0, 0};

    // RGBA bytes, width-major: 4 bytes/texel for UnsignedByteType, 16 for FloatType. Empty until a
    // loader or DataTexture fills it.
    std::vector<uint8_t> data;
    uint32_t width = 0, height = 0;

    /** three.js `texture.needsUpdate`: a GPU record rebuilds when its counter moves. */
    void needsUpdate() { ++version_; }
    [[nodiscard]] uint32_t version() const { return version_; }

    [[nodiscard]] bool isFloat() const { return type == kTextureFloatType; }
    [[nodiscard]] bool isSRGB() const { return colorSpace == TextureColorSpace::SRGB; }
    [[nodiscard]] bool hasImage() const { return width > 0 && height > 0 && !data.empty(); }

private:
    uint32_t version_ = 0;
};

/**
 * DataTexture(data, width, height, format, type): the bytes a fixture passed as a typed array. The
 * values arrive as JS doubles; UnsignedByteType stores a byte per channel, FloatType a float32.
 */
class DataTexture final : public Texture {
public:
    DataTexture() {
        // DataTexture's own defaults (three/src/textures/DataTexture.js).
        magFilter = minFilter = static_cast<uint16_t>(TextureFilter::Nearest);
        format = kTextureRGBAFormat;
        type = kTextureUnsignedByteType;
    }

    void setImage(const std::vector<double>& values, const std::string& arrayType, uint32_t w, uint32_t h,
                  uint16_t fmt, uint16_t dataType) {
        width = w;
        height = h;
        format = fmt;
        type = dataType;
        const bool asFloat = dataType == kTextureFloatType || arrayType == "Float32Array";
        data.clear();
        if (asFloat) {
            data.resize(values.size() * sizeof(float));
            for (std::size_t i = 0; i < values.size(); ++i) {
                const float v = static_cast<float>(values[i]);
                std::memcpy(data.data() + i * sizeof(float), &v, sizeof(float));
            }
        } else {
            data.resize(values.size());
            for (std::size_t i = 0; i < values.size(); ++i)
                data[i] = static_cast<uint8_t>(values[i] < 0 ? 0 : (values[i] > 255 ? 255 : values[i]));
        }
        needsUpdate();
    }
};

}  // namespace tn::engine
