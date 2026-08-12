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

constexpr uint32_t kMaxExactFloatId = 16'777'215;

struct SimulationOwner {
  TnPhysicsSimulation *simulation = nullptr;
  uint32_t nextId = 0;

  ~SimulationOwner() { dispose(); }

  void dispose() {
    if (simulation != nullptr) {
      tn_physics_destroy(simulation);
      simulation = nullptr;
    }
  }
};

js::JSValueHandle fail(js::Engine *engine, const char *message) {
  engine->throwException(message);
  return engine->newUndefined();
}

bool readFiniteNumber(js::Engine *engine, js::JSValueHandle object,
                      const char *name, float &output) {
  const auto value = engine->getProperty(object, name);
  if (!engine->isNumber(value))
    return false;
  const double number = engine->toNumber(value);
  if (!std::isfinite(number) || number < -std::numeric_limits<float>::max() ||
      number > std::numeric_limits<float>::max()) {
    return false;
  }
  output = static_cast<float>(number);
  return true;
}

bool readOptionalFiniteNumber(js::Engine *engine, js::JSValueHandle object,
                              const char *name, float &output) {
  const auto value = engine->getProperty(object, name);
  if (engine->isUndefined(value))
    return true;
  return readFiniteNumber(engine, object, name, output);
}

bool readGroup(js::Engine *engine, js::JSValueHandle object, const char *name,
               uint32_t &output) {
  const auto value = engine->getProperty(object, name);
  if (engine->isUndefined(value))
    return true;
  if (!engine->isNumber(value))
    return false;
  const double number = engine->toNumber(value);
  if (!std::isfinite(number) || number < 0 ||
      number > std::numeric_limits<uint32_t>::max() ||
      std::floor(number) != number) {
    return false;
  }
  output = static_cast<uint32_t>(number);
  return true;
}

bool readVector(js::Engine *engine, js::JSValueHandle parent,
                const char *name, float &x, float &y, float &z) {
  const auto value = engine->getProperty(parent, name);
  return engine->isObject(value) && readFiniteNumber(engine, value, "x", x) &&
         readFiniteNumber(engine, value, "y", y) &&
         readFiniteNumber(engine, value, "z", z);
}

bool readQuaternion(js::Engine *engine, js::JSValueHandle parent,
                    const char *name, float &x, float &y, float &z, float &w) {
  const auto value = engine->getProperty(parent, name);
  return engine->isObject(value) && readFiniteNumber(engine, value, "x", x) &&
         readFiniteNumber(engine, value, "y", y) &&
         readFiniteNumber(engine, value, "z", z) &&
         readFiniteNumber(engine, value, "w", w);
}

bool readGravity(js::Engine *engine, js::JSValueHandle options, float &x,
                 float &y, float &z) {
  const auto gravity = engine->getProperty(options, "gravity");
  if (engine->isUndefined(gravity))
    return true;
  if (engine->isNumber(gravity)) {
    const double value = engine->toNumber(gravity);
    if (!std::isfinite(value))
      return false;
    y = static_cast<float>(value);
    return true;
  }
  if (!engine->isObject(gravity))
    return false;
  if (engine->isArray(gravity)) {
    const auto xValue = engine->getPropertyIndex(gravity, 0);
    const auto yValue = engine->getPropertyIndex(gravity, 1);
    const auto zValue = engine->getPropertyIndex(gravity, 2);
    if (!engine->isNumber(xValue) || !engine->isNumber(yValue) ||
        !engine->isNumber(zValue)) {
      return false;
    }
    x = static_cast<float>(engine->toNumber(xValue));
    y = static_cast<float>(engine->toNumber(yValue));
    z = static_cast<float>(engine->toNumber(zValue));
    return std::isfinite(x) && std::isfinite(y) && std::isfinite(z);
  }
  return readFiniteNumber(engine, gravity, "x", x) &&
         readFiniteNumber(engine, gravity, "y", y) &&
         readFiniteNumber(engine, gravity, "z", z);
}

bool isTypedArray(js::Engine *engine, js::JSValueHandle value,
                  const char *expectedName) {
  if (!engine->isObject(value))
    return false;
  const auto constructor = engine->getProperty(value, "constructor");
  if (!engine->isFunction(constructor))
    return false;
  const auto name = engine->getProperty(constructor, "name");
  return engine->isString(name) && engine->toString(name) == expectedName;
}

bool parseBodyOptions(js::Engine *engine, js::JSValueHandle value, uint32_t id,
                      TnPhysicsBodyOptions &options) {
  if (!engine->isObject(value))
    return false;
  options = {id, 0, 0, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f,
             0.0f, 0.0f, 0.0f, 0.0f, 1,    0xffff, false};
  const auto type = engine->getProperty(value, "type");
  if (!engine->isString(type))
    return false;
  const std::string typeName = engine->toString(type);
  if (typeName == "dynamic")
    options.body_type = 0;
  else if (typeName == "fixed")
    options.body_type = 1;
  else if (typeName == "kinematic")
    options.body_type = 2;
  else if (typeName == "character")
    options.body_type = 3;
  else
    return false;

  const auto shape = engine->getProperty(value, "shape");
  if (!engine->isObject(shape))
    return false;
  const auto kind = engine->getProperty(shape, "kind");
  if (!engine->isString(kind))
    return false;
  const std::string shapeName = engine->toString(kind);
  if (shapeName == "box")
    options.shape_type = 0;
  else if (shapeName == "sphere")
    options.shape_type = 1;
  else if (shapeName == "capsule")
    options.shape_type = 2;
  else
    return false;

  const auto sensor = engine->getProperty(value, "sensor");
  if (!engine->isUndefined(sensor)) {
    if (!engine->isBoolean(sensor))
      return false;
    options.sensor = engine->toBoolean(sensor);
  }
  return readVector(engine, value, "position", options.position_x,
                    options.position_y, options.position_z) &&
         readQuaternion(engine, value, "rotation", options.rotation_x,
                        options.rotation_y, options.rotation_z,
                        options.rotation_w) &&
         readFiniteNumber(engine, shape, "x", options.shape_x) &&
         readOptionalFiniteNumber(engine, shape, "y", options.shape_y) &&
         readOptionalFiniteNumber(engine, shape, "z", options.shape_z) &&
         readOptionalFiniteNumber(engine, value, "mass", options.mass) &&
         readGroup(engine, value, "collisionLayer", options.collision_layer) &&
         readGroup(engine, value, "collisionMask", options.collision_mask);
}

bool parseCharacterOptions(js::Engine *engine, js::JSValueHandle value,
                           uint32_t id,
                           TnPhysicsCharacterOptions &options) {
  if (!engine->isObject(value))
    return false;
  options = {id, 0.01f, 0.78539816339f, false, 0.0f,
             0.0f, false, false, 0.0f, 0};
  if (!readFiniteNumber(engine, value, "offset", options.offset) ||
      !readFiniteNumber(engine, value, "maxSlopeClimbAngle",
                        options.max_slope_climb_angle) ||
      !readGroup(engine, value, "oneWayLayers", options.one_way_layers)) {
    return false;
  }
  const auto autostep = engine->getProperty(value, "autostep");
  if (!engine->isUndefined(autostep)) {
    if (!engine->isObject(autostep) ||
        !readFiniteNumber(engine, autostep, "maxHeight",
                          options.autostep_max_height) ||
        !readFiniteNumber(engine, autostep, "minWidth",
                          options.autostep_min_width)) {
      return false;
    }
    const auto includeDynamic =
        engine->getProperty(autostep, "includeDynamicBodies");
    if (!engine->isBoolean(includeDynamic))
      return false;
    options.autostep_enabled = true;
    options.autostep_include_dynamic_bodies =
        engine->toBoolean(includeDynamic);
  }
  const auto snap = engine->getProperty(value, "snapToGround");
  if (!engine->isUndefined(snap)) {
    if (!engine->isNumber(snap) ||
        !std::isfinite(engine->toNumber(snap))) {
      return false;
    }
    options.snap_to_ground_enabled = true;
    options.snap_to_ground = static_cast<float>(engine->toNumber(snap));
  }
  return true;
}

js::JSValueHandle makeSimulationObject(
    js::Engine *engine, const std::shared_ptr<SimulationOwner> &owner) {
  auto simulation = engine->newObject();
  engine->setProperty(
      simulation, "createBody",
      engine->newFunction(
          "createBody",
          [engine, owner](void *, const std::vector<js::JSValueHandle> &args) {
            if (owner->simulation == nullptr)
              return fail(engine, "physics simulation is disposed");
            if (args.empty() || owner->nextId > kMaxExactFloatId)
              return fail(engine, "createBody requires options and an available id");
            TnPhysicsBodyOptions options{};
            if (!parseBodyOptions(engine, args[0], owner->nextId, options) ||
                !tn_physics_add_body(owner->simulation, &options)) {
              return fail(engine, "physics body options are invalid");
            }
            const uint32_t id = owner->nextId++;
            return engine->newNumber(id);
          }));
  engine->setProperty(
      simulation, "removeBody",
      engine->newFunction(
          "removeBody",
          [engine, owner](void *, const std::vector<js::JSValueHandle> &args) {
            if (owner->simulation == nullptr)
              return fail(engine, "physics simulation is disposed");
            if (args.empty() || !engine->isNumber(args[0]))
              return fail(engine, "removeBody requires a numeric id");
            const double id = engine->toNumber(args[0]);
            if (!std::isfinite(id) || id < 0 || id > kMaxExactFloatId ||
                std::floor(id) != id)
              return fail(engine, "removeBody received an invalid id");
            tn_physics_remove_body(owner->simulation,
                                   static_cast<uint32_t>(id));
            return engine->newUndefined();
          }));
  engine->setProperty(
      simulation, "configureCharacter",
      engine->newFunction(
          "configureCharacter",
          [engine, owner](void *, const std::vector<js::JSValueHandle> &args) {
            if (owner->simulation == nullptr)
              return fail(engine, "physics simulation is disposed");
            if (args.size() < 2 || !engine->isNumber(args[0]))
              return fail(engine, "configureCharacter requires an id and options");
            const double id = engine->toNumber(args[0]);
            if (!std::isfinite(id) || id < 0 || id > kMaxExactFloatId ||
                std::floor(id) != id)
              return fail(engine, "configureCharacter received an invalid id");
            TnPhysicsCharacterOptions options{};
            if (!parseCharacterOptions(engine, args[1],
                                       static_cast<uint32_t>(id), options) ||
                !tn_physics_configure_character(owner->simulation, &options)) {
              return fail(engine, "character controller options are invalid");
            }
            return engine->newUndefined();
          }));
  engine->setProperty(
      simulation, "setBodyTransform",
      engine->newFunction(
          "setBodyTransform",
          [engine, owner](void *, const std::vector<js::JSValueHandle> &args) {
            if (owner->simulation == nullptr)
              return fail(engine, "physics simulation is disposed");
            if (args.size() < 2 || !engine->isNumber(args[0]) ||
                !std::isfinite(engine->toNumber(args[0])))
              return fail(engine, "setBodyTransform requires an id and position");
            const double id = engine->toNumber(args[0]);
            if (id < 0 || id > kMaxExactFloatId || std::floor(id) != id)
              return fail(engine, "setBodyTransform received an invalid id");
            float x = 0.0f;
            float y = 0.0f;
            float z = 0.0f;
            if (!engine->isObject(args[1]) ||
                !readFiniteNumber(engine, args[1], "x", x) ||
                !readFiniteNumber(engine, args[1], "y", y) ||
                !readFiniteNumber(engine, args[1], "z", z))
              return fail(engine, "setBodyTransform received an invalid position");
            if (!tn_physics_set_body_transform(owner->simulation,
                                               static_cast<uint32_t>(id), x, y, z))
              return fail(engine, "setBodyTransform received an unknown id");
            return engine->newUndefined();
          }));
  engine->setProperty(
      simulation, "step",
      engine->newFunction(
          "step", [engine, owner](
                      void *, const std::vector<js::JSValueHandle> &args) {
            if (owner->simulation == nullptr)
              return fail(engine, "physics simulation is disposed");
            if (args.empty() || !engine->isNumber(args[0]))
              return fail(engine, "step requires a numeric deltaTime");
            const double deltaTime = engine->toNumber(args[0]);
            const float *input = nullptr;
            size_t count = 0;
            if (args.size() > 1 && !engine->isUndefined(args[1])) {
              if (!engine->isObject(args[1]))
                return fail(engine, "physics input snapshot must be an object");
              const auto countValue =
                  engine->getProperty(args[1], "kinematicCount");
              const auto transforms =
                  engine->getProperty(args[1], "kinematicTransforms");
              if (!engine->isNumber(countValue) ||
                  !isTypedArray(engine, transforms, "Float32Array")) {
                return fail(engine, "physics input snapshot is malformed");
              }
              const double countNumber = engine->toNumber(countValue);
              size_t bytes = 0;
              input = static_cast<const float *>(
                  engine->getArrayBufferData(transforms, &bytes));
              if (!std::isfinite(countNumber) || countNumber < 0 ||
                  std::floor(countNumber) != countNumber ||
                  countNumber > bytes / (8 * sizeof(float))) {
                return fail(engine, "physics input snapshot has an invalid count");
              }
              count = static_cast<size_t>(countNumber);
            }
            if (!std::isfinite(deltaTime) || deltaTime <= 0 ||
                !tn_physics_step(owner->simulation,
                                 static_cast<float>(deltaTime), input, count)) {
              return fail(engine, "physics step rejected its deltaTime or input");
            }
            return engine->newUndefined();
          }));
  engine->setProperty(
      simulation, "readVisibleTransforms",
      engine->newFunction(
          "readVisibleTransforms",
          [engine, owner](void *,
                          const std::vector<js::JSValueHandle> &args) {
            if (owner->simulation == nullptr)
              return fail(engine, "physics simulation is disposed");
            if (args.empty() ||
                !isTypedArray(engine, args[0], "Float32Array")) {
              return fail(engine,
                          "readVisibleTransforms requires a Float32Array");
            }
            size_t bytes = 0;
            auto *data = static_cast<float *>(
                engine->getArrayBufferData(args[0], &bytes));
            if (bytes % sizeof(float) != 0)
              return fail(engine, "transform buffer is malformed");
            const int32_t count = tn_physics_read_visible_transforms(
                owner->simulation, data, bytes / sizeof(float));
            if (count < 0)
              return fail(engine, "transform buffer is too small");
            return engine->newNumber(count);
          }));
  engine->setProperty(
      simulation, "readCharacterStates",
      engine->newFunction(
          "readCharacterStates",
          [engine, owner](void *,
                          const std::vector<js::JSValueHandle> &args) {
            if (owner->simulation == nullptr)
              return fail(engine, "physics simulation is disposed");
            if (args.empty() ||
                !isTypedArray(engine, args[0], "Float32Array")) {
              return fail(engine,
                          "readCharacterStates requires a Float32Array");
            }
            size_t bytes = 0;
            auto *data = static_cast<float *>(
                engine->getArrayBufferData(args[0], &bytes));
            if (bytes % sizeof(float) != 0)
              return fail(engine, "character state buffer is malformed");
            const int32_t count = tn_physics_read_character_states(
                owner->simulation, data, bytes / sizeof(float));
            if (count < 0)
              return fail(engine, "character state buffer is too small");
            return engine->newNumber(count);
          }));
  engine->setProperty(
      simulation, "readBodySleepStates",
      engine->newFunction(
          "readBodySleepStates",
          [engine, owner](void *,
                          const std::vector<js::JSValueHandle> &args) {
            if (owner->simulation == nullptr)
              return fail(engine, "physics simulation is disposed");
            if (args.empty() ||
                !isTypedArray(engine, args[0], "Float32Array")) {
              return fail(engine,
                          "readBodySleepStates requires a Float32Array");
            }
            size_t bytes = 0;
            auto *data = static_cast<float *>(
                engine->getArrayBufferData(args[0], &bytes));
            if (bytes % sizeof(float) != 0)
              return fail(engine, "sleep state buffer is malformed");
            const int32_t count = tn_physics_read_body_sleep_states(
                owner->simulation, data, bytes / sizeof(float));
            if (count < 0)
              return fail(engine, "sleep state buffer is too small");
            return engine->newNumber(count);
          }));
  engine->setProperty(
      simulation, "readAreaIntersections",
      engine->newFunction(
          "readAreaIntersections",
          [engine, owner](void *,
                          const std::vector<js::JSValueHandle> &args) {
            if (owner->simulation == nullptr)
              return fail(engine, "physics simulation is disposed");
            if (args.empty() ||
                !isTypedArray(engine, args[0], "Uint32Array")) {
              return fail(engine,
                          "readAreaIntersections requires a Uint32Array");
            }
            size_t bytes = 0;
            auto *data = static_cast<uint32_t *>(
                engine->getArrayBufferData(args[0], &bytes));
            if (bytes % sizeof(uint32_t) != 0)
              return fail(engine, "area intersection buffer is malformed");
            const int32_t count = tn_physics_read_area_intersections(
                owner->simulation, data, bytes / sizeof(uint32_t));
            if (count < 0)
              return fail(engine, "area intersection buffer is too small");
            return engine->newNumber(count);
          }));
  engine->setProperty(
      simulation, "drainCollisionEvents",
      engine->newFunction(
          "drainCollisionEvents",
          [engine, owner](void *,
                          const std::vector<js::JSValueHandle> &args) {
            if (owner->simulation == nullptr)
              return fail(engine, "physics simulation is disposed");
            if (args.empty() ||
                !isTypedArray(engine, args[0], "Uint32Array")) {
              return fail(engine,
                          "drainCollisionEvents requires a Uint32Array");
            }
            size_t bytes = 0;
            auto *data = static_cast<uint32_t *>(
                engine->getArrayBufferData(args[0], &bytes));
            if (bytes % sizeof(uint32_t) != 0)
              return fail(engine, "collision event buffer is malformed");
            const int32_t count = tn_physics_drain_collision_events(
                owner->simulation, data, bytes / sizeof(uint32_t));
            if (count < 0)
              return fail(engine, "collision event buffer is too small");
            return engine->newNumber(count);
          }));
  engine->setProperty(
      simulation, "dispose",
      engine->newFunction(
          "dispose", [engine, owner](
                         void *, const std::vector<js::JSValueHandle> &) {
            owner->dispose();
            return engine->newUndefined();
          }));
  return simulation;
}

} // namespace

bool initializeNativePhysicsBindings(js::Engine *engine) {
  if (engine == nullptr)
    return false;

  auto nativeHost = engine->getGlobalProperty("__THREENATIVE_NATIVE__");
  if (engine->isUndefined(nativeHost))
    nativeHost = engine->newObject();
  auto physicsHost = engine->newObject();
  engine->setProperty(physicsHost, "version",
                      engine->newString(tn_physics_version()));
  engine->setProperty(
      physicsHost, "createSimulation",
      engine->newFunction(
          "createSimulation",
          [engine](void *, const std::vector<js::JSValueHandle> &args) {
            TnPhysicsWorldOptions options{0.0f, -9.81f, 0.0f};
            if (!args.empty() && !engine->isUndefined(args[0])) {
              if (!engine->isObject(args[0]) ||
                  !readGravity(engine, args[0], options.gravity_x,
                               options.gravity_y, options.gravity_z)) {
                return fail(engine, "physics options contain invalid gravity");
              }
            }
            auto owner = std::make_shared<SimulationOwner>();
            owner->simulation = tn_physics_create(&options);
            if (owner->simulation == nullptr)
              return fail(engine, "Rapier simulation creation failed");
            return makeSimulationObject(engine, owner);
          }));
  engine->setProperty(nativeHost, "physics", physicsHost);
  return engine->setGlobalProperty("__THREENATIVE_NATIVE__", nativeHost);
}

} // namespace mystral::physics
