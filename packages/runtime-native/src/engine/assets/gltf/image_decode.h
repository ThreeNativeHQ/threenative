#pragma once
// PNG and JPEG bytes to straight RGBA8, row 0 first (glTF images are not flipped). stb_image is
// compiled static in image_decode.cpp so it cannot collide with the host runtime's own copy.

#include <cstddef>
#include <cstdint>
#include <vector>

namespace tn::engine::gltf {

enum class ImageFormat { Unknown, Png, Jpeg };

/** The format the bytes' magic announces; Unknown means this loader does not decode it. */
ImageFormat imageFormat(const uint8_t* bytes, std::size_t size);

/** Decodes a PNG or JPEG into `rgba` (width * height * 4 bytes); false for a damaged or oversized image. */
bool decodeImage(const uint8_t* bytes, std::size_t size, uint32_t& width, uint32_t& height,
                 std::vector<uint8_t>& rgba);

} // namespace tn::engine::gltf
