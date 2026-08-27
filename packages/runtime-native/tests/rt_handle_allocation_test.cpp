#include "raytracing/rt_common.h"

#include <cstdint>
#include <iostream>
#include <memory>
#include <unordered_map>

namespace {

struct TestResource {
    explicit TestResource(int markerValue) : marker(markerValue) {}

    int marker;
};

}  // namespace

int fail(const char* message) {
    std::cerr << "raytracing handle allocation contract failed: " << message << std::endl;
    return 1;
}

int main() {
    uint32_t nextId = 7;
    std::unordered_map<uint32_t, std::unique_ptr<TestResource>> resources;

    auto geometryResource = std::make_unique<TestResource>(41);
    auto blasResource = std::make_unique<TestResource>(42);
    auto tlasResource = std::make_unique<TestResource>(43);
    TestResource* geometryPointer = geometryResource.get();
    TestResource* blasPointer = blasResource.get();
    TestResource* tlasPointer = tlasResource.get();

    const mystral::rt::RTGeometryHandle geometry = mystral::rt::allocateRtHandle<
        mystral::rt::RTGeometryHandle>(nextId, resources, std::move(geometryResource));
    const mystral::rt::RTBLASHandle blas = mystral::rt::allocateRtHandle<
        mystral::rt::RTBLASHandle>(nextId, resources, std::move(blasResource));
    const mystral::rt::RTTLASHandle tlas = mystral::rt::allocateRtHandle<
        mystral::rt::RTTLASHandle>(nextId, resources, std::move(tlasResource));

    if (geometryResource) return fail("geometry input retained ownership after move");
    if (blasResource) return fail("BLAS input retained ownership after move");
    if (tlasResource) return fail("TLAS input retained ownership after move");
    if (geometry._id != 7) return fail("geometry handle did not receive the pre-increment id");
    if (blas._id != 8) return fail("BLAS handle did not receive the next sequential id");
    if (tlas._id != 9) return fail("TLAS handle did not receive the next sequential id");
    if (nextId != 10) return fail("counter did not advance exactly once per allocation");
    if (resources.size() != 3) return fail("resource table does not contain all allocations");
    if (geometry._handle != geometryPointer || geometry._handle != resources.at(geometry._id).get()) {
        return fail("geometry pointer identity changed during insertion");
    }
    if (blas._handle != blasPointer || blas._handle != resources.at(blas._id).get()) {
        return fail("BLAS pointer identity changed during insertion");
    }
    if (tlas._handle != tlasPointer || tlas._handle != resources.at(tlas._id).get()) {
        return fail("TLAS pointer identity changed during insertion");
    }
    if (geometryPointer->marker != 41 || blasPointer->marker != 42 || tlasPointer->marker != 43) {
        return fail("resource contents changed during insertion");
    }

    std::cout << "raytracing handle allocation contract passed" << std::endl;
    return 0;
}
