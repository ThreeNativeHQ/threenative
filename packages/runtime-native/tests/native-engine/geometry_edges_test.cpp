// PRD-508 phase 3: the edges a JS caller can reach that the reference fixtures do not state. Every
// expected value is what node prints for the same JS (String(n), typed-array writes, Math.round).

#include "check.h"
#include "engine/scene/geometry.h"

#include <cmath>
#include <cstdint>
#include <string>

using namespace tn::engine;

namespace {

void jsNumbers() {
    const std::pair<double, const char*> cases[] = {
        {100000, "100000"},       {1e-7, "1e-7"},       {1e21, "1e+21"},  {123.456, "123.456"},
        {0.000001, "0.000001"},   {-0.0, "0"},          {1.5e-7, "1.5e-7"}, {9007199254740992.0, "9007199254740992"},
        {1e20, "100000000000000000000"}, {0.1, "0.1"}, {5e-324, "5e-324"},
        {1.7976931348623157e308, "1.7976931348623157e+308"}, {-1234.5, "-1234.5"}};
    for (const auto& [value, expected] : cases) {
        const std::string got = jsNumber(value);
        if (got != expected) std::fprintf(stderr, "jsNumber(%.17g) = %s, want %s\n", value, got.c_str(), expected);
        CHECK(got == expected);
    }
}

// Typed-array writes wrap as ToUintN/ToIntN do; Float32 rounds as Math.fround.
void typedWrites() {
    auto u16 = std::make_shared<BufferAttribute>(Scalar::U16, 4, 1);
    u16->setRaw(0, -1);
    u16->setRaw(1, 65536);
    u16->setRaw(2, std::nan(""));
    CHECK(u16->raw(0) == 65535 && u16->raw(1) == 0 && u16->raw(2) == 0);
    BufferAttribute i8(Scalar::I8, 2, 1), i16(Scalar::I16, 1, 1), u32(Scalar::U32, 1, 1), i32(Scalar::I32, 1, 1), u8(Scalar::U8, 1, 1);
    i8.setRaw(0, 200);
    i8.setRaw(1, -3.9);
    i16.setRaw(0, -32769);
    u32.setRaw(0, -1);
    i32.setRaw(0, 2147483648.0);
    u8.setRaw(0, 3.9);
    CHECK(i8.raw(0) == -56 && i8.raw(1) == -3 && i16.raw(0) == 32767 && u32.raw(0) == 4294967295.0);
    CHECK(i32.raw(0) == -2147483648.0 && u8.raw(0) == 3);
    BufferAttribute f32(Scalar::F32, 1, 1);
    f32.setRaw(0, 0.1);
    CHECK(f32.raw(0) == 0.10000000149011612);
}

// A normalized attribute stores round(v * max) and reads it back divided, and toNonIndexed copies the
// stored integers, not the denormalized reals.
void normalized() {
    auto position = std::make_shared<BufferAttribute>(Scalar::U16, 3, 3, true);
    position->setX(0, 0.5);
    CHECK(position->raw(0) == 32768);
    CHECK(position->getX(0) == 32768.0 / 65535.0);
    BufferGeometry geometry;
    geometry.setAttribute("position", position);
    geometry.setIndexFromArray({0, 0});
    const auto flat = geometry.toNonIndexed();
    const auto copied = flat->getAttribute("position");
    CHECK(copied->normalized && copied->raw(0) == 32768 && copied->raw(3) == 32768);
}

// Past the end reads NaN (undefined in JS) and writes nothing; an index whose element would wrap
// past 2^64 is out of range, not a wrapped-around element.
void outOfRange() {
    auto a = std::make_shared<BufferAttribute>(Scalar::F32, 6, 3);
    CHECK(std::isnan(a->getX(1000000000)));
    a->setX(1000000000, 1);
    uint64_t at = 0;
    CHECK(!a->element(UINT64_MAX / 3 + 1, 0, at));
    CHECK(std::isnan(a->getComponent(UINT64_MAX / 3 + 1, 0)));
    CHECK(!a->element(1, 3, at) && a->element(1, 2, at) && at == 5);
}

// Math.max propagates NaN: a NaN position gives a NaN radius, not a finite one.
void nanBounds() {
    BufferGeometry geometry;
    geometry.setAttribute("position", BufferAttribute::fromFloats({0, 0, 0, std::nan(""), 0, 0, 1, 0, 0}, 3));
    geometry.computeBoundingSphere();
    CHECK(std::isnan(geometry.boundingSphere->radius));
}

// fromDoubles is the bulk path of every `new BufferAttribute(array, n)`: it must store exactly what
// the element-wise typed-array write (setRaw) stores, edges included.
void fromDoublesMatchesSetRaw() {
    const std::vector<double> values = {0,      -0.0,    1,        -1,     0.5,     -0.5,    127,   127.9,  128,
                                        -128,   -128.5,  -129,     255,    255.9,   256,     -0.99, 32767, 32768,
                                        65535,  65536,   -32768,   -32769, 2147483647.0, 2147483648.0, -2147483648.0,
                                        4294967295.0, 4294967296.0, 1e20,  -1e20,   std::nan(""), INFINITY, -INFINITY,
                                        3.4e38, 1e-46,  0.1,      -3.9};
    for (const Scalar scalar : {Scalar::F32, Scalar::F64, Scalar::I8, Scalar::U8, Scalar::I16, Scalar::U16,
                                Scalar::I32, Scalar::U32}) {
        const auto bulk = BufferAttribute::fromDoubles(scalar, values, 1, false);
        BufferAttribute each(scalar, values.size(), 1);
        for (std::size_t i = 0; i < values.size(); ++i) each.setRaw(i, values[i]);
        CHECK(bulk->store->count() == values.size());
        for (std::size_t i = 0; i < values.size(); ++i) {
            const double a = bulk->raw(i), b = each.raw(i);
            const bool same = (std::isnan(a) && std::isnan(b)) || (a == b && std::signbit(a) == std::signbit(b));
            if (!same) std::fprintf(stderr, "scalar %d element %zu (%.17g): bulk %.17g, setRaw %.17g\n", int(scalar), i, values[i], a, b);
            CHECK(same);
        }
    }
}

}  // namespace

TN_TEST_MAIN({"from_doubles_matches_set_raw", fromDoublesMatchesSetRaw}, {"js_numbers", jsNumbers}, {"typed_writes", typedWrites}, {"normalized", normalized},
             {"out_of_range", outOfRange}, {"nan_bounds", nanBounds})
