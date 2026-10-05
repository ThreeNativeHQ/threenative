#include "check.h"
#include "engine/foundation/math/ieee754.h"

#include <bit>
#include <cstdint>
#include <cstdio>

using namespace tn::engine::ieee754;

// Every expected word here is V8's own answer, read out of node 20.19.6 (V8 11.3.244), which is
// where three runs. The platform libm is one bit off on a few percent of arguments: glibc answers
// 0x3fefd712f9a817c1 for cos(0.1) where V8 answers 0x3fefd712f9a817c0, so this case fails against
// std:: functions and that failure is the reason the port exists.
namespace {

void checkV8(const char* what, double actual, std::uint64_t expected) {
    const std::uint64_t got = std::bit_cast<std::uint64_t>(actual);
    if (got != expected) {
        std::fprintf(stderr, "%s: got 0x%016llx, V8 has 0x%016llx\n", what,
                     static_cast<unsigned long long>(got),
                     static_cast<unsigned long long>(expected));
    }
    CHECK(got == expected);
}

void bits() {
    // |x| below pi/4 reaches the polynomial kernels; beyond it, argument reduction.
    checkV8("cos(0.1)", cos(0.1), 0x3fefd712f9a817c0ULL);
    checkV8("cos(-0.1)", cos(-0.1), 0x3fefd712f9a817c0ULL);
    checkV8("cos(pi/2)", cos(1.5707963267948966), 0x3c91a62633145c07ULL);
    checkV8("cos(100)", cos(100.0), 0x3feb981dbf665fdfULL);
    checkV8("cos(1e-30)", cos(1e-30), 0x3ff0000000000000ULL);
    checkV8("sin(0.1)", sin(0.1), 0x3fb98eaecb8bcb2cULL);
    checkV8("sin(-0.1)", sin(-0.1), 0xbfb98eaecb8bcb2cULL);
    checkV8("sin(pi/2)", sin(1.5707963267948966), 0x3ff0000000000000ULL);
    checkV8("sin(100)", sin(100.0), 0xbfe03425b78c4db8ULL);
    checkV8("sin(1e-30)", sin(1e-30), 0x39b4484bfeebc2a0ULL);
    checkV8("asin(0.5)", asin(0.5), 0x3fe0c152382d7366ULL);
    checkV8("asin(-0.5)", asin(-0.5), 0xbfe0c152382d7366ULL);
    checkV8("asin(+0)", asin(0.0), 0x0000000000000000ULL);
    checkV8("asin(1)", asin(1.0), 0x3ff921fb54442d18ULL);
    checkV8("asin(-1)", asin(-1.0), 0xbff921fb54442d18ULL);
    checkV8("acos(0.5)", acos(0.5), 0x3ff0c152382d7366ULL);
    checkV8("acos(-0.5)", acos(-0.5), 0x4000c152382d7366ULL);
    checkV8("acos(+0)", acos(0.0), 0x3ff921fb54442d18ULL);
    checkV8("acos(1)", acos(1.0), 0x0000000000000000ULL);
    checkV8("acos(-1)", acos(-1.0), 0x400921fb54442d18ULL);
    checkV8("atan2(1, 1)", atan2(1.0, 1.0), 0x3fe921fb54442d18ULL);
    checkV8("atan2(-1, 1)", atan2(-1.0, 1.0), 0xbfe921fb54442d18ULL);
    checkV8("atan2(1, -1)", atan2(1.0, -1.0), 0x4002d97c7f3321d2ULL);
    checkV8("atan2(-1, -1)", atan2(-1.0, -1.0), 0xc002d97c7f3321d2ULL);
    // The two Color exponents, the integer exactness pow promises, and the 1**-Infinity case.
    checkV8("pow(2.4, 0.41666)", pow(2.4, 0.41666), 0x3ff70b014761012aULL);
    checkV8("pow(0.41666, 2.4)", pow(0.41666, 2.4), 0x3fbf4ff9381f225fULL);
    checkV8("pow(2, 10)", pow(2.0, 10.0), 0x4090000000000000ULL);
    checkV8("pow(0.5, 3)", pow(0.5, 3.0), 0x3fc0000000000000ULL);
    checkV8("pow(1, -1)", pow(1.0, -1.0), 0x3ff0000000000000ULL);
    checkV8("pow(1.002, pi)", pow(1.002, 3.14159), 0x3ff019ca831a9931ULL);
}

}  // namespace

TN_TEST_MAIN({"bits", bits})