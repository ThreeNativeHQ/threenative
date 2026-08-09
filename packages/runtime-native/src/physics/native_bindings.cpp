#include "mystral/physics/native_bindings.h"

#include "mystral/js/engine.h"
#include "threenative/physics_native.h"

#include <cmath>
#include <cstdint>
#include <limits>
#include <memory>
#include <string>
#include <vector>

namespace mystral::physics {
namespace {

struct SimulationOwner {
    TnPhysicsProofSimulation* simulation = nullptr;

    ~SimulationOwner() {
        dispose();
    }

    void dispose() {
        if (simulation != nullptr) {
            tn_physics_proof_destroy(simulation);
            simulation = nullptr;
        }
    }
};

js::JSValueHandle fail(js::Engine* engine, const char* message) {
    engine->throwException(message);
    return engine->newUndefined();
}

bool readFiniteNumber(js::Engine* engine, js::JSValueHandle object, const char* name, float& output) {
    const auto value = engine->getProperty(object, name);
    if (engine->isUndefined(value)) return false;
    const double number = engine->toNumber(value);
    if (!std::isfinite(number) || number < -std::numeric_limits<float>::max() ||
        number > std::numeric_limits<float>::max()) {
        return false;
    }
    output = static_cast<float>(number);
    return true;
}

bool readGroup(js::Engine* engine, js::JSValueHandle object, const char* name, uint32_t& output) {
    const auto value = engine->getProperty(object, name);
    if (engine->isUndefined(value)) return true;
    const double number = engine->toNumber(value);
    if (!std::isfinite(number) || number < 0 || number > std::numeric_limits<uint32_t>::max() ||
        std::floor(number) != number) {
        return false;
    }
    output = static_cast<uint32_t>(number);
    return true;
}

bool readGravity(js::Engine* engine, js::JSValueHandle options, TnPhysicsProofOptions& native) {
    const auto gravity = engine->getProperty(options, "gravity");
    if (engine->isUndefined(gravity)) return true;
    if (engine->isNumber(gravity)) {
        const double y = engine->toNumber(gravity);
        if (!std::isfinite(y)) return false;
        native.gravity_y = static_cast<float>(y);
        return true;
    }
    if (!engine->isObject(gravity)) return false;
    if (engine->isArray(gravity)) {
        const double x = engine->toNumber(engine->getPropertyIndex(gravity, 0));
        const double y = engine->toNumber(engine->getPropertyIndex(gravity, 1));
        const double z = engine->toNumber(engine->getPropertyIndex(gravity, 2));
        if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) return false;
        native.gravity_x = static_cast<float>(x);
        native.gravity_y = static_cast<float>(y);
        native.gravity_z = static_cast<float>(z);
        return true;
    }
    return readFiniteNumber(engine, gravity, "x", native.gravity_x) &&
           readFiniteNumber(engine, gravity, "y", native.gravity_y) &&
           readFiniteNumber(engine, gravity, "z", native.gravity_z);
}

bool readCollisionGroups(
    js::Engine* engine,
    js::JSValueHandle options,
    const char* bodyName,
    uint32_t& layer,
    uint32_t& mask
) {
    const auto body = engine->getProperty(options, bodyName);
    if (engine->isUndefined(body)) return true;
    return engine->isObject(body) && readGroup(engine, body, "collisionLayer", layer) &&
           readGroup(engine, body, "collisionMask", mask);
}

}  // namespace

bool initializeNativePhysicsBindings(js::Engine* engine) {
    if (engine == nullptr) return false;

    auto nativeHost = engine->getGlobalProperty("__THREENATIVE_NATIVE__");
    if (engine->isUndefined(nativeHost)) nativeHost = engine->newObject();
    auto physicsHost = engine->newObject();
    engine->setProperty(physicsHost, "version", engine->newString(tn_physics_version()));
    engine->setProperty(
        physicsHost,
        "createProofSimulation",
        engine->newFunction(
            "createProofSimulation",
            [engine](void*, const std::vector<js::JSValueHandle>& args) {
                TnPhysicsProofOptions native{
                    0.0f,
                    -9.81f,
                    0.0f,
                    1,
                    0xffff,
                    1,
                    0xffff,
                };
                if (!args.empty() && !engine->isUndefined(args[0])) {
                    if (!engine->isObject(args[0])) {
                        return fail(engine, "physics options must be an object");
                    }
                    if (!readGravity(engine, args[0], native) ||
                        !readCollisionGroups(
                            engine,
                            args[0],
                            "floor",
                            native.floor_collision_layer,
                            native.floor_collision_mask
                        ) ||
                        !readCollisionGroups(
                            engine,
                            args[0],
                            "cube",
                            native.cube_collision_layer,
                            native.cube_collision_mask
                        )) {
                        return fail(engine, "physics options contain an invalid gravity or collision group");
                    }
                }

                auto owner = std::make_shared<SimulationOwner>();
                owner->simulation = tn_physics_proof_create(&native);
                if (owner->simulation == nullptr) {
                    return fail(engine, "Rapier proof simulation creation failed");
                }

                auto simulation = engine->newObject();
                engine->setProperty(
                    simulation,
                    "step",
                    engine->newFunction(
                        "step",
                        [engine, owner](void*, const std::vector<js::JSValueHandle>& stepArgs) {
                            if (owner->simulation == nullptr) {
                                return fail(engine, "physics simulation is disposed");
                            }
                            if (stepArgs.empty()) return fail(engine, "step requires deltaTime");
                            const double deltaTime = engine->toNumber(stepArgs[0]);
                            if (!std::isfinite(deltaTime) || deltaTime <= 0 ||
                                !tn_physics_proof_step(owner->simulation, static_cast<float>(deltaTime))) {
                                return fail(engine, "deltaTime must be a positive finite number");
                            }
                            return engine->newUndefined();
                        }
                    )
                );
                engine->setProperty(
                    simulation,
                    "readVisibleTransforms",
                    engine->newFunction(
                        "readVisibleTransforms",
                        [engine, owner](void*, const std::vector<js::JSValueHandle>& readArgs) {
                            if (owner->simulation == nullptr) {
                                return fail(engine, "physics simulation is disposed");
                            }
                            if (readArgs.empty()) return fail(engine, "readVisibleTransforms requires a Float32Array");
                            size_t bytes = 0;
                            auto* data = static_cast<float*>(engine->getArrayBufferData(readArgs[0], &bytes));
                            if (data == nullptr || bytes % sizeof(float) != 0 || bytes < 16 * sizeof(float)) {
                                return fail(engine, "transform buffer must hold two 8-float records");
                            }
                            const int32_t count = tn_physics_proof_read_visible_transforms(
                                owner->simulation,
                                data,
                                bytes / sizeof(float)
                            );
                            if (count < 0) return fail(engine, "native transform read failed");
                            return engine->newNumber(count);
                        }
                    )
                );
                engine->setProperty(
                    simulation,
                    "drainCollisionEvents",
                    engine->newFunction(
                        "drainCollisionEvents",
                        [engine, owner](void*, const std::vector<js::JSValueHandle>& eventArgs) {
                            if (owner->simulation == nullptr) {
                                return fail(engine, "physics simulation is disposed");
                            }
                            if (eventArgs.empty()) return fail(engine, "drainCollisionEvents requires a Uint32Array");
                            size_t bytes = 0;
                            auto* data = static_cast<uint32_t*>(engine->getArrayBufferData(eventArgs[0], &bytes));
                            if (data == nullptr || bytes % sizeof(uint32_t) != 0) {
                                return fail(engine, "collision event buffer must contain 4-u32 records");
                            }
                            const int32_t count = tn_physics_proof_drain_collision_events(
                                owner->simulation,
                                data,
                                bytes / sizeof(uint32_t)
                            );
                            if (count < 0) return fail(engine, "collision event buffer is too small");
                            return engine->newNumber(count);
                        }
                    )
                );
                engine->setProperty(
                    simulation,
                    "dispose",
                    engine->newFunction(
                        "dispose",
                        [engine, owner](void*, const std::vector<js::JSValueHandle>&) {
                            owner->dispose();
                            return engine->newUndefined();
                        }
                    )
                );
                return simulation;
            }
        )
    );
    engine->setProperty(nativeHost, "physics", physicsHost);
    return engine->setGlobalProperty("__THREENATIVE_NATIVE__", nativeHost);
}

}  // namespace mystral::physics
