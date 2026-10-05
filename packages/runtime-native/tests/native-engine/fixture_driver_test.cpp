#include "check.h"
#include "fixture/driver.h"

#include <bit>
#include <cinttypes>
#include <cstdio>
#include <memory>
#include <sstream>

using namespace tn::fixture;

namespace {

struct Pair {
    double x = 0;
    double y = 0;
};

std::string hex(double v) {
    char b[24];
    std::snprintf(b, sizeof b, "n:%016" PRIx64, std::bit_cast<uint64_t>(v));
    return b;
}

void protocol() {
    Driver driver;
    ClassBinding pair;
    pair.ctor = [](const Args& a, Store&) {
        auto p = std::make_shared<Pair>();
        if (a.size() == 2) *p = Pair{number(a[0]), number(a[1])};
        return std::static_pointer_cast<void>(p);
    };
    pair.methods["add"] = [](void* self, const Args& a, Store& d) {
        auto& p = *static_cast<Pair*>(self);
        const Pair& o = d.ref<Pair>(a.at(0), "Pair");
        p.x += o.x;
        p.y += o.y;
        return chain();
    };
    pair.methods["length"] = [](void* self, const Args&, Store&) {
        auto& p = *static_cast<Pair*>(self);
        return Value::of(p.x * p.x + p.y * p.y);
    };
    pair.getters["x"] = [](void* self) { return Value::of(static_cast<Pair*>(self)->x); };
    pair.getters["xy"] = [](void* self) { auto& p = *static_cast<Pair*>(self); return Value::list({p.x, p.y}); };
    pair.setters["y"] = [](void* self, const Value& v) { static_cast<Pair*>(self)->y = number(v); };
    driver.classes["Pair"] = pair;

    std::istringstream in(
        "fixture probe\n"
        "new a Pair " + hex(1.5) + " " + hex(-0.0) + "\n"
        "new b Pair " + hex(2) + " " + hex(3) + "\n"
        "call a add c r:b\n"
        "set b y " + hex(10) + "\n"
        "observe 0 c xy - numbers\n"
        "observe 1 a - length number\n"
        "observe 2 b x - number\n"
        "observe 3 b z - number\n"
        "new d Matrix4\n"
        "call a add - r:missing\n"
        "end\n");
    std::ostringstream out;
    CHECK(driver.run(in, out) == 0);
    const std::string want =
        "obs 0 numbers " + hex(3.5) + "," + hex(3) + "\n"
        "obs 1 number " + hex(3.5 * 3.5 + 9) + "\n"
        "obs 2 number " + hex(2) + "\n"
        "unsupported 3 Pair.z\n"
        "unsupported - class%20Matrix4\n"
        "unsupported - argument%20is%20not%20a%20Pair\n";
    CHECK(out.str() == want);
    if (out.str() != want) std::fprintf(stderr, "--- got ---\n%s--- want ---\n%s", out.str().c_str(), want.c_str());
}

}  // namespace

TN_TEST_MAIN({"protocol", protocol})
