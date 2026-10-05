#pragma once

#include <cstdint>
#include <span>
#include <string>
#include <vector>

#include "engine/assets/sha256.h"

namespace tn::engine::assets {

/**
 * Cooked asset package, format version 1 (PRD-515 phase 2). Little-endian throughout:
 *
 *   offset  size  field
 *   0       4     magic "TNPK"
 *   4       4     format version (u32) = kPackageFormatVersion
 *   8       4     entry count (u32)
 *   12      4     reserved, 0
 *   16      8     entry table size in bytes (u64); the table starts at 24
 *   24      ...   entries, each:
 *                   u16 name length, name bytes (UTF-8, no terminator)
 *                   u16 kind, u32 decoder requirement mask
 *                   u64 offset (from the start of the package), u64 size, u64 GPU upload size
 *                   32 bytes SHA-256 of the entry's data
 *                   u32 dependency count, then that many u32 entry indices
 *   ...           entry data, anywhere after the table, at the offsets the entries name
 *
 * `packages/assets` writes this format; the engine reads it here. Every field is untrusted: each
 * range is checked with overflow-safe arithmetic before anything is read, and every hash is
 * verified before an entry is loaded.
 */
inline constexpr uint32_t kPackageFormatVersion = 1;
inline constexpr size_t kPackageHeaderSize = 24;

enum class EntryKind : uint16_t { Buffer = 1, Texture = 2, Mesh = 3, Material = 4, Animation = 5, Scene = 6 };

/** Decoder requirement bits; a package needing one the target lacks is refused before load. */
enum DecoderBits : uint32_t { kDecoderMeshopt = 1u << 0, kDecoderDraco = 1u << 1, kDecoderKtx2 = 1u << 2 };

struct PackageEntry {
    std::string name;
    uint16_t kind = 0;
    uint32_t decoders = 0;
    uint64_t offset = 0;
    uint64_t size = 0;
    uint64_t uploadSize = 0;
    Sha256Digest hash{};
    std::vector<uint32_t> dependencies;
};

struct PackageError {
    std::string code;  // TN_PACKAGE_TRUNCATED | _MAGIC | _VERSION | _RANGE | _DEPENDENCY | _HASH | _DECODER
    std::string detail;
};

/** A parsed package: entries plus a view of the bytes they point into (owned by the caller). */
struct Package {
    uint32_t version = 0;
    std::vector<PackageEntry> entries;
    std::span<const uint8_t> bytes;

    std::span<const uint8_t> data(const PackageEntry& entry) const {
        return bytes.subspan(static_cast<size_t>(entry.offset), static_cast<size_t>(entry.size));
    }
};

/** Parses and range-checks the header and table. Fills `error` and returns false on any defect. */
bool parsePackage(std::span<const uint8_t> bytes, Package& out, PackageError& error);

/**
 * The gate before load: every entry's hash matches its data and every decoder it needs is in
 * `availableDecoders`. Nothing is loaded from a package that fails it.
 */
bool verifyPackage(const Package& package, uint32_t availableDecoders, PackageError& error);

}  // namespace tn::engine::assets
