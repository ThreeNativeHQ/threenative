#pragma once

// three's DataUtils.toHalfFloat / fromHalfFloat (three@0.185.1 src/extras/DataUtils.js): the same
// lookup tables, so a value converts to the same 16 bits (three truncates the mantissa, it does not
// round) and back to the same float.

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <limits>

namespace tn::engine {

namespace detail {

struct HalfFloatTables {
    std::array<uint32_t, 512> baseTable{};
    std::array<uint32_t, 512> shiftTable{};
    std::array<uint32_t, 2048> mantissaTable{};
    std::array<uint32_t, 64> exponentTable{};
    std::array<uint32_t, 64> offsetTable{};

    HalfFloatTables() {
        for (int i = 0; i < 256; ++i) {
            const int e = i - 127;
            if (e < -27) {
                baseTable[i] = 0x0000;
                baseTable[i | 0x100] = 0x8000;
                shiftTable[i] = shiftTable[i | 0x100] = 24;
            } else if (e < -14) {
                baseTable[i] = 0x0400u >> (-e - 14);
                baseTable[i | 0x100] = (0x0400u >> (-e - 14)) | 0x8000;
                shiftTable[i] = shiftTable[i | 0x100] = static_cast<uint32_t>(-e - 1);
            } else if (e <= 15) {
                baseTable[i] = static_cast<uint32_t>(e + 15) << 10;
                baseTable[i | 0x100] = (static_cast<uint32_t>(e + 15) << 10) | 0x8000;
                shiftTable[i] = shiftTable[i | 0x100] = 13;
            } else if (e < 128) {
                baseTable[i] = 0x7c00;
                baseTable[i | 0x100] = 0xfc00;
                shiftTable[i] = shiftTable[i | 0x100] = 24;
            } else {
                baseTable[i] = 0x7c00;
                baseTable[i | 0x100] = 0xfc00;
                shiftTable[i] = shiftTable[i | 0x100] = 13;
            }
        }
        for (uint32_t i = 1; i < 1024; ++i) {
            uint32_t m = i << 13;
            uint32_t e = 0;
            while ((m & 0x00800000u) == 0) {
                m <<= 1;
                e -= 0x00800000u;
            }
            m &= ~0x00800000u;
            e += 0x38800000u;
            mantissaTable[i] = m | e;
        }
        for (uint32_t i = 1024; i < 2048; ++i) mantissaTable[i] = 0x38000000u + ((i - 1024) << 13);
        for (uint32_t i = 1; i < 31; ++i) exponentTable[i] = i << 23;
        exponentTable[31] = 0x47800000u;
        exponentTable[32] = 0x80000000u;
        for (uint32_t i = 33; i < 63; ++i) exponentTable[i] = 0x80000000u + ((i - 32) << 23);
        exponentTable[63] = 0xc7800000u;
        for (uint32_t i = 1; i < 64; ++i)
            if (i != 32) offsetTable[i] = 1024;
    }
};

inline const HalfFloatTables& halfFloatTables() {
    static const HalfFloatTables tables;
    return tables;
}

}  // namespace detail

/** Half-float bits of `val`, clamped to +/-65504 as three clamps it. */
inline double toHalfFloat(double val) {
    const auto& t = detail::halfFloatTables();
    // three clamps with Math.max/Math.min, which answer NaN for NaN with the sign bit set in V8 on
    // x64 (the reference), so a NaN becomes 0xFE00 there.
    const float single = val == val ? static_cast<float>(std::clamp(val, -65504.0, 65504.0))
                                    : -std::numeric_limits<float>::quiet_NaN();
    uint32_t f = 0;
    std::memcpy(&f, &single, sizeof f);
    const uint32_t e = (f >> 23) & 0x1ff;
    return static_cast<double>(t.baseTable[e] + ((f & 0x007fffffu) >> t.shiftTable[e]));
}

/** The float that 16 half-float bits name; `bits` must be an integer in [0, 65535]. */
inline double fromHalfFloat(uint32_t bits) {
    const auto& t = detail::halfFloatTables();
    const uint32_t m = bits >> 10;
    const uint32_t f = t.mantissaTable[t.offsetTable[m] + (bits & 0x3ff)] + t.exponentTable[m];
    float single = 0;
    std::memcpy(&single, &f, sizeof single);
    return single;
}

}  // namespace tn::engine
