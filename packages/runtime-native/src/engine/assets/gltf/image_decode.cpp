#include "engine/assets/gltf/image_decode.h"

#include <algorithm>
#include <cstdlib>

#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_STATIC
#define STBI_NO_STDIO
#define STBI_ONLY_PNG
#define STBI_ONLY_JPEG
#include "stb_image.h"

namespace tn::engine::gltf {

ImageFormat imageFormat(const uint8_t* bytes, std::size_t size) {
    static const uint8_t png[] = {0x89, 'P', 'N', 'G'};
    if (size >= 4 && std::equal(png, png + 4, bytes)) return ImageFormat::Png;
    if (size >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF) return ImageFormat::Jpeg;
    return ImageFormat::Unknown;
}

bool decodeImage(const uint8_t* bytes, std::size_t size, uint32_t& width, uint32_t& height,
                 std::vector<uint8_t>& rgba) {
    // 8192 x 8192 is the largest texture a WebGPU device guarantees; refuse before allocating more.
    constexpr int kMaxPixels = 1 << 26;
    int w = 0, h = 0, channels = 0;
    if (size > 0x7fffffff || !stbi_info_from_memory(bytes, int(size), &w, &h, &channels)) return false;
    if (w < 1 || h < 1 || int64_t(w) * h > kMaxPixels) return false;
    uint8_t* pixels = stbi_load_from_memory(bytes, int(size), &w, &h, &channels, 4);
    if (!pixels) return false;
    width = uint32_t(w);
    height = uint32_t(h);
    rgba.assign(pixels, pixels + std::size_t(w) * h * 4);
    stbi_image_free(pixels);
    return true;
}

} // namespace tn::engine::gltf
