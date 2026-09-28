// PRD-465 Phase 2: the MetaHuman facial rig in C++, behind the runtime's own JS engine.
//
// One C ABI, one set of numbers. `packages/metahuman/cpp/tn_riglogic.cpp` is compiled here
// unchanged, exactly as the browser WASM build compiles it, so a value cannot mean two things
// on two backends. This file adds no rig logic: it validates arguments, calls the ABI, and
// copies outputs into JS-owned arrays.

#include "native_bindings.h"

#include "mystral/js/engine.h"
#include "tn_riglogic.h"

#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#ifndef THREENATIVE_OPENRIGLOGIC_COMMIT
// A build that compiled OpenRigLogic without the pin must say so rather than report a
// revision nobody can reproduce.
#define THREENATIVE_OPENRIGLOGIC_COMMIT "unpinned"
#endif

namespace mystral::metahuman {
namespace {

// The largest id a double represents exactly, so a JS number can never round onto a live
// handle. 0 is the ABI's invalid id and is never valid here.
constexpr uint32_t kMaxExactFloatId = 16'777'215;

constexpr int32_t kMaxKind = TN_RL_KIND_LOD;

const char kVersion[] = "tn_metahuman/1 OpenRigLogic " THREENATIVE_OPENRIGLOGIC_COMMIT;

js::JSValueHandle fail(js::Engine *engine, const std::string &message) {
  engine->throwException(message.c_str());
  return engine->newUndefined();
}

/** The ABI's own message, so a rejection names the reason it rejected rather than a guess. */
js::JSValueHandle failAbi(js::Engine *engine, const char *what) {
  const char *detail = tn_rl_last_error();
  return fail(engine, std::string("TN_NATIVE_METAHUMAN_ABI: ") + what + ": " +
                          ((detail != nullptr && detail[0] != '\0')
                               ? detail
                               : "the rig rejected the call"));
}

bool readId(js::Engine *engine, const std::vector<js::JSValueHandle> &args,
            uint32_t &id) {
  if (args.empty() || !engine->isNumber(args[0]))
    return false;
  const double value = engine->toNumber(args[0]);
  if (!std::isfinite(value) || value < 1 || value > kMaxExactFloatId ||
      std::floor(value) != value)
    return false;
  id = static_cast<uint32_t>(value);
  return true;
}

bool readSelector(js::Engine *engine, js::JSValueHandle value, int32_t &selector) {
  if (!engine->isNumber(value))
    return false;
  const double number = engine->toNumber(value);
  if (!std::isfinite(number) || number < 0 || number > kMaxKind ||
      std::floor(number) != number)
    return false;
  selector = static_cast<int32_t>(number);
  return true;
}

bool readIndex(js::Engine *engine, js::JSValueHandle value, uint32_t &index) {
  if (!engine->isNumber(value))
    return false;
  const double number = engine->toNumber(value);
  if (!std::isfinite(number) || number < 0 || number > kMaxExactFloatId ||
      std::floor(number) != number)
    return false;
  index = static_cast<uint32_t>(number);
  return true;
}

/**
 * Accept a value only when it is one of the named built-ins.
 *
 * The engine exposes no `isArrayBuffer`, and a `getArrayBufferData` on the wrong kind would
 * happily reinterpret bytes, so the constructor name is the type check.
 */
bool isBuiltinOf(js::Engine *engine, js::JSValueHandle value, const char *expected) {
  if (!engine->isObject(value))
    return false;
  const auto constructor = engine->getProperty(value, "constructor");
  if (!engine->isFunction(constructor))
    return false;
  const auto name = engine->getProperty(constructor, "name");
  return engine->isString(name) && engine->toString(name) == expected;
}

/** The `id` and a `kind` selector, which every counting and naming call shares. */
bool readIdAndKind(js::Engine *engine, const std::vector<js::JSValueHandle> &args,
                   uint32_t &id, int32_t &kind) {
  return args.size() >= 2 && readId(engine, args, id) &&
         readSelector(engine, args[1], kind);
}

} // namespace

bool initializeNativeMetaHumanBindings(js::Engine *engine) {
  if (engine == nullptr)
    return false;

  auto nativeHost = engine->getGlobalProperty("__THREENATIVE_NATIVE__");
  if (engine->isUndefined(nativeHost))
    nativeHost = engine->newObject();
  auto metahumanHost = engine->newObject();
  engine->setProperty(metahumanHost, "version", engine->newString(kVersion));

  engine->setProperty(
      metahumanHost, "create",
      engine->newFunction(
          "create",
          [engine](void *, const std::vector<js::JSValueHandle> &args) {
            if (args.empty() ||
                (!isBuiltinOf(engine, args[0], "ArrayBuffer") &&
                 !isBuiltinOf(engine, args[0], "Uint8Array")))
              return fail(engine, "TN_NATIVE_METAHUMAN_DNA_INVALID: create requires an "
                                  "ArrayBuffer or Uint8Array of DNA bytes");
            size_t bytes = 0;
            const auto *dna = static_cast<const uint8_t *>(
                engine->getArrayBufferData(args[0], &bytes));
            if (dna == nullptr || bytes == 0)
              return fail(engine, "TN_NATIVE_METAHUMAN_DNA_INVALID: the DNA buffer is empty "
                                  "or not backed by readable memory");
            // The ABI copies the bytes, so the JS buffer owns them for the whole call and
            // nothing outlives it here.
            const tn_rl_handle handle = tn_rl_create(dna, static_cast<uint32_t>(bytes));
            if (handle == 0)
              return failAbi(engine, "the rig could not be created from this DNA");
            return engine->newNumber(handle);
          }));

  engine->setProperty(
      metahumanHost, "count",
      engine->newFunction(
          "count",
          [engine](void *, const std::vector<js::JSValueHandle> &args) {
            uint32_t id = 0;
            int32_t kind = 0;
            if (!readIdAndKind(engine, args, id, kind))
              return fail(engine, "TN_NATIVE_METAHUMAN_ARGUMENT: count requires a rig id and "
                                  "a kind selector");
            const int32_t count = tn_rl_count(id, kind);
            if (count < 0)
              return failAbi(engine, "count");
            return engine->newNumber(count);
          }));

  engine->setProperty(
      metahumanHost, "name",
      engine->newFunction(
          "name",
          [engine](void *, const std::vector<js::JSValueHandle> &args) {
            uint32_t id = 0;
            int32_t kind = 0;
            uint32_t index = 0;
            if (!readIdAndKind(engine, args, id, kind) || args.size() < 3 ||
                !readIndex(engine, args[2], index))
              return fail(engine, "TN_NATIVE_METAHUMAN_ARGUMENT: name requires a rig id, a "
                                  "kind selector and an index");
            const char *name = tn_rl_name(id, kind, index);
            if (name == nullptr)
              return failAbi(engine, "name");
            return engine->newString(name);
          }));

  engine->setProperty(
      metahumanHost, "setLod",
      engine->newFunction(
          "setLod",
          [engine](void *, const std::vector<js::JSValueHandle> &args) {
            uint32_t id = 0;
            uint32_t lod = 0;
            if (args.size() < 2 || !readId(engine, args, id) ||
                !readIndex(engine, args[1], lod))
              return fail(engine, "TN_NATIVE_METAHUMAN_ARGUMENT: setLod requires a rig id "
                                  "and a LOD index");
            if (tn_rl_set_lod(id, lod) != TN_RL_OK)
              return failAbi(engine, "setLod");
            return engine->newUndefined();
          }));

  // `setGui` and `setRaw` differ only in which ABI setter they reach, and both must refuse a
  // wrong-width or non-finite buffer before the ABI reads a single element of it.
  const auto controlSetter = [engine](const char *name, bool gui) {
    return engine->newFunction(
        name, [engine, gui, name](void *,
                                  const std::vector<js::JSValueHandle> &args) {
          uint32_t id = 0;
          if (args.size() < 2 || !readId(engine, args, id))
            return fail(engine, std::string("TN_NATIVE_METAHUMAN_ARGUMENT: ") + name +
                                " requires a rig id and a Float32Array");
          if (!isBuiltinOf(engine, args[1], "Float32Array"))
            return fail(engine, std::string("TN_NATIVE_METAHUMAN_ARGUMENT: ") + name +
                                " requires a Float32Array");
          size_t bytes = 0;
          const auto *values = static_cast<const float *>(
              engine->getArrayBufferData(args[1], &bytes));
          if (values == nullptr || bytes % sizeof(float) != 0)
            return fail(engine, std::string("TN_NATIVE_METAHUMAN_ARGUMENT: ") + name +
                                " received a malformed control buffer");
          const uint32_t count = static_cast<uint32_t>(bytes / sizeof(float));
          const int32_t status = gui ? tn_rl_set_gui(id, values, count)
                                      : tn_rl_set_raw(id, values, count);
          if (status != TN_RL_OK)
            return failAbi(engine, name);
          return engine->newUndefined();
        });
  };
  engine->setProperty(metahumanHost, "setGui", controlSetter("setGui", true));
  engine->setProperty(metahumanHost, "setRaw", controlSetter("setRaw", false));

  engine->setProperty(
      metahumanHost, "evaluate",
      engine->newFunction(
          "evaluate",
          [engine](void *, const std::vector<js::JSValueHandle> &args) {
            uint32_t id = 0;
            if (args.size() < 2 || !readId(engine, args, id) ||
                !engine->isBoolean(args[1]))
              return fail(engine, "TN_NATIVE_METAHUMAN_ARGUMENT: evaluate requires a rig id "
                                  "and a boolean useGui");
            if (tn_rl_evaluate(id, engine->toBoolean(args[1]) ? 1 : 0) != TN_RL_OK)
              return failAbi(engine, "evaluate");
            return engine->newUndefined();
          }));

  // Every output crossing is a copy: the ABI's buffer is owned by the rig and is invalidated
  // by the next evaluate, setLod or destroy, so a view would silently read a different rig.
  const auto outputReader = [engine](const char *name,
                                     const float *(*read)(tn_rl_handle, uint32_t *)) {
    return engine->newFunction(
        name, [engine, read, name](void *,
                                   const std::vector<js::JSValueHandle> &args) {
          uint32_t id = 0;
          if (!readId(engine, args, id))
            return fail(engine, std::string("TN_NATIVE_METAHUMAN_ARGUMENT: ") + name +
                                " requires a rig id");
          uint32_t count = 0;
          const float *values = read(id, &count);
          if (values == nullptr)
            return failAbi(engine, name);
          return engine->createFloat32Array(values, count);
        });
  };
  engine->setProperty(metahumanHost, "jointOutputs",
                      outputReader("jointOutputs", &tn_rl_joint_outputs));
  engine->setProperty(metahumanHost, "blendShapeOutputs",
                      outputReader("blendShapeOutputs", &tn_rl_blendshape_outputs));
  engine->setProperty(metahumanHost, "animatedMapOutputs",
                      outputReader("animatedMapOutputs", &tn_rl_animated_map_outputs));
  engine->setProperty(metahumanHost, "neutralJoints",
                      outputReader("neutralJoints", &tn_rl_neutral_joints));

  engine->setProperty(
      metahumanHost, "destroy",
      engine->newFunction(
          "destroy",
          [engine](void *, const std::vector<js::JSValueHandle> &args) {
            uint32_t id = 0;
            if (args.size() < 1 || !readId(engine, args, id))
              return fail(engine, "TN_NATIVE_METAHUMAN_ARGUMENT: destroy requires a rig id");
            // The ABI retires the id forever, so a stale or already-destroyed id is a no-op
            // rather than a double free, and never resolves to a later rig.
            tn_rl_destroy(id);
            return engine->newUndefined();
          }));

  engine->setProperty(
      metahumanHost, "lastError",
      engine->newFunction(
          "lastError",
          [engine](void *, const std::vector<js::JSValueHandle> &) {
            const char *message = tn_rl_last_error();
            return engine->newString(message == nullptr ? "" : message);
          }));

  engine->setProperty(nativeHost, "metahuman", metahumanHost);
  return engine->setGlobalProperty("__THREENATIVE_NATIVE__", nativeHost);
}

} // namespace mystral::metahuman
