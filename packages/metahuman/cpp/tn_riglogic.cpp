#include "tn_riglogic.h"

#include <riglogic/RigLogic.h>

#include <cmath>
#include <cstddef>
#include <cstring>
#include <string>
#include <vector>

namespace {

constexpr std::size_t kErrorCapacity = 512;

char g_lastError[kErrorCapacity] = {0};

void setError(const char* message) {
    std::snprintf(g_lastError, kErrorCapacity, "%s", message);
}

void setError(const std::string& message) {
    std::snprintf(g_lastError, kErrorCapacity, "%s", message.c_str());
}

void clearError() {
    g_lastError[0] = '\0';
}

std::string statusMessage(const char* prefix) {
    const auto status = rl4::Status::get();
    return prefix + std::string(status.message != nullptr ? status.message : "unknown RigLogic error");
}

rl4::Configuration fixedConfiguration() {
    rl4::Configuration config;
    config.calculationType = rl4::CalculationType::Scalar;
    config.floatingPointType = rl4::FloatingPointType::Float;
    config.loadJoints = true;
    config.loadBlendShapes = true;
    config.loadAnimatedMaps = true;
    config.loadMachineLearnedBehavior = true;
    config.loadRBFBehavior = true;
    config.loadTwistSwingBehavior = true;
    config.translationType = rl4::TranslationType::Vector;
    config.rotationType = rl4::RotationType::Quaternions;
    config.scaleType = rl4::ScaleType::Vector;
    return config;
}

struct Handle {
    rl4::MemoryStream* stream = nullptr;
    rl4::BinaryStreamReader* reader = nullptr;
    rl4::RigLogic* logic = nullptr;
    rl4::RigInstance* instance = nullptr;
};

// Every live handle, keyed by its never-reused ID. A retired ID is erased, so a stale
// caller can never resolve to a newer rig even when the allocator hands back the same
// address for the next create.
struct Slot {
    tn_rl_handle id = 0;
    Handle* handle = nullptr;
};

std::vector<Slot>& liveHandles() {
    static std::vector<Slot> handles;
    return handles;
}

// Monotonic, never reused, and 0 is reserved for "invalid", so the first ID is 1.
tn_rl_handle& nextHandleId() {
    static tn_rl_handle next = 1;
    return next;
}

Handle* resolve(tn_rl_handle handle) {
    if (handle == 0) {
        setError("null handle");
        return nullptr;
    }
    for (const auto& slot : liveHandles()) {
        if (slot.id == handle) {
            return slot.handle;
        }
    }
    setError("stale handle");
    return nullptr;
}

int32_t fail(int32_t code, const char* message) {
    setError(message);
    return code;
}

const dna::Reader* readerOf(const Handle* handle) {
    return handle->reader;
}

}  // namespace

extern "C" {

tn_rl_handle tn_rl_create(const uint8_t* dna, uint32_t length) {
    clearError();
    if (dna == nullptr || length == 0u) {
        setError("dna must be a non-empty buffer");
        return 0;
    }

    auto* handle = new Handle();
    // Exact capacity, filled with the caller's bytes, so the reader sees precisely
    // length bytes and nothing else. The caller keeps ownership of dna.
    handle->stream = rl4::MemoryStream::create(length, nullptr);
    if (handle->stream == nullptr) {
        setError("out of memory creating the DNA stream");
        delete handle;
        return 0;
    }
    handle->stream->open();
    if (handle->stream->write(reinterpret_cast<const char*>(dna), length) != length) {
        setError("could not buffer the DNA bytes");
        rl4::MemoryStream::destroy(handle->stream);
        delete handle;
        return 0;
    }

    handle->reader = rl4::BinaryStreamReader::create(handle->stream);
    if (handle->reader == nullptr) {
        rl4::MemoryStream::destroy(handle->stream);
        delete handle;
        return 0;
    }
    handle->reader->read();
    if (!rl4::Status::isOk()) {
        setError(statusMessage("could not read the DNA: "));
        rl4::BinaryStreamReader::destroy(handle->reader);
        rl4::MemoryStream::destroy(handle->stream);
        delete handle;
        return 0;
    }

    handle->logic = rl4::RigLogic::create(handle->reader, fixedConfiguration());
    if (handle->logic == nullptr) {
        setError(statusMessage("could not create the rig: "));
        rl4::BinaryStreamReader::destroy(handle->reader);
        rl4::MemoryStream::destroy(handle->stream);
        delete handle;
        return 0;
    }
    handle->instance = rl4::RigInstance::create(handle->logic);
    if (handle->instance == nullptr) {
        setError(statusMessage("could not create the rig instance: "));
        rl4::RigLogic::destroy(handle->logic);
        rl4::BinaryStreamReader::destroy(handle->reader);
        rl4::MemoryStream::destroy(handle->stream);
        delete handle;
        return 0;
    }

    const tn_rl_handle id = nextHandleId()++;
    liveHandles().push_back({id, handle});
    return id;
}

void tn_rl_destroy(tn_rl_handle handle) {
    if (handle == 0) {
        return;
    }
    auto& handles = liveHandles();
    for (auto it = handles.begin(); it != handles.end(); ++it) {
        if (it->id != handle) {
            continue;
        }
        Handle* owned = it->handle;
        handles.erase(it);
        rl4::RigInstance::destroy(owned->instance);
        rl4::RigLogic::destroy(owned->logic);
        rl4::BinaryStreamReader::destroy(owned->reader);
        rl4::MemoryStream::destroy(owned->stream);
        delete owned;
        return;
    }
}

int32_t tn_rl_count(tn_rl_handle handle, int32_t kind) {
    clearError();
    auto* resolved = resolve(handle);
    if (resolved == nullptr) {
        return -1;
    }
    const auto* reader = readerOf(resolved);
    switch (kind) {
    case TN_RL_KIND_GUI:
        return static_cast<int32_t>(reader->getGUIControlCount());
    case TN_RL_KIND_RAW:
        return static_cast<int32_t>(reader->getRawControlCount());
    case TN_RL_KIND_JOINT:
        return static_cast<int32_t>(reader->getJointCount());
    case TN_RL_KIND_BLENDSHAPE:
        return static_cast<int32_t>(reader->getBlendShapeChannelCount());
    case TN_RL_KIND_ANIMATED_MAP:
        return static_cast<int32_t>(reader->getAnimatedMapCount());
    case TN_RL_KIND_LOD:
        return static_cast<int32_t>(resolved->logic->getLODCount());
    default:
        return fail(TN_RL_ERR_OUT_OF_RANGE, "unknown kind selector");
    }
}

const char* tn_rl_name(tn_rl_handle handle, int32_t kind, uint32_t index) {
    clearError();
    auto* resolved = resolve(handle);
    if (resolved == nullptr) {
        return nullptr;
    }
    const auto* reader = readerOf(resolved);
    if (index > 0xFFFFu) {
        setError("name index out of range");
        return nullptr;
    }
    const auto narrowed = static_cast<std::uint16_t>(index);
    switch (kind) {
    case TN_RL_KIND_GUI:
        if (narrowed < reader->getGUIControlCount()) {
            return reader->getGUIControlName(narrowed).c_str();
        }
        break;
    case TN_RL_KIND_RAW:
        if (narrowed < reader->getRawControlCount()) {
            return reader->getRawControlName(narrowed).c_str();
        }
        break;
    case TN_RL_KIND_JOINT:
        if (narrowed < reader->getJointCount()) {
            return reader->getJointName(narrowed).c_str();
        }
        break;
    case TN_RL_KIND_BLENDSHAPE:
        if (narrowed < reader->getBlendShapeChannelCount()) {
            return reader->getBlendShapeChannelName(narrowed).c_str();
        }
        break;
    case TN_RL_KIND_ANIMATED_MAP:
        if (narrowed < reader->getAnimatedMapCount()) {
            return reader->getAnimatedMapName(narrowed).c_str();
        }
        break;
    default:
        setError("unknown kind selector");
        return nullptr;
    }
    setError("name index out of range");
    return nullptr;
}

int32_t tn_rl_set_lod(tn_rl_handle handle, uint32_t lod) {
    clearError();
    auto* resolved = resolve(handle);
    if (resolved == nullptr) {
        return TN_RL_ERR_INVALID_HANDLE;
    }
    if (lod >= static_cast<uint32_t>(resolved->logic->getLODCount())) {
        return fail(TN_RL_ERR_OUT_OF_RANGE, "lod out of range");
    }
    resolved->instance->setLOD(static_cast<std::uint16_t>(lod));
    return TN_RL_OK;
}

int32_t tn_rl_set_gui(tn_rl_handle handle, const float* values, uint32_t count) {
    clearError();
    auto* resolved = resolve(handle);
    if (resolved == nullptr) {
        return TN_RL_ERR_INVALID_HANDLE;
    }
    if (values == nullptr) {
        return fail(TN_RL_ERR_INVALID_ARGUMENT, "null control values");
    }
    if (count != static_cast<uint32_t>(resolved->instance->getGUIControlCount())) {
        return fail(TN_RL_ERR_COUNT_MISMATCH, "gui control count mismatch");
    }
    for (uint32_t i = 0; i < count; ++i) {
        if (!std::isfinite(values[i])) {
            return fail(TN_RL_ERR_NON_FINITE, "non finite gui control value");
        }
    }
    auto guiValues = resolved->instance->getGUIControlValues();
    for (uint32_t i = 0; i < count; ++i) {
        guiValues[i] = values[i];
    }
    return TN_RL_OK;
}

int32_t tn_rl_set_raw(tn_rl_handle handle, const float* values, uint32_t count) {
    clearError();
    auto* resolved = resolve(handle);
    if (resolved == nullptr) {
        return TN_RL_ERR_INVALID_HANDLE;
    }
    if (values == nullptr) {
        return fail(TN_RL_ERR_INVALID_ARGUMENT, "null control values");
    }
    if (count != static_cast<uint32_t>(resolved->instance->getRawControlCount())) {
        return fail(TN_RL_ERR_COUNT_MISMATCH, "raw control count mismatch");
    }
    for (uint32_t i = 0; i < count; ++i) {
        if (!std::isfinite(values[i])) {
            return fail(TN_RL_ERR_NON_FINITE, "non finite raw control value");
        }
    }
    auto rawValues = resolved->instance->getRawControlValues();
    for (uint32_t i = 0; i < count; ++i) {
        rawValues[i] = values[i];
    }
    return TN_RL_OK;
}

int32_t tn_rl_evaluate(tn_rl_handle handle, int32_t useGui) {
    clearError();
    auto* resolved = resolve(handle);
    if (resolved == nullptr) {
        return TN_RL_ERR_INVALID_HANDLE;
    }
    if (useGui != 0) {
        resolved->logic->mapGUIToRawControls(resolved->instance);
    }
    resolved->logic->calculate(resolved->instance);
    return TN_RL_OK;
}

const float* tn_rl_joint_outputs(tn_rl_handle handle, uint32_t* countOut) {
    clearError();
    auto* resolved = resolve(handle);
    if (resolved == nullptr) {
        return nullptr;
    }
    if (countOut != nullptr) {
        *countOut = static_cast<uint32_t>(resolved->instance->getJointOutputs().size());
    }
    return resolved->instance->getJointOutputs().data();
}

const float* tn_rl_blendshape_outputs(tn_rl_handle handle, uint32_t* countOut) {
    clearError();
    auto* resolved = resolve(handle);
    if (resolved == nullptr) {
        return nullptr;
    }
    if (countOut != nullptr) {
        *countOut = static_cast<uint32_t>(resolved->instance->getBlendShapeOutputs().size());
    }
    return resolved->instance->getBlendShapeOutputs().data();
}

const float* tn_rl_animated_map_outputs(tn_rl_handle handle, uint32_t* countOut) {
    clearError();
    auto* resolved = resolve(handle);
    if (resolved == nullptr) {
        return nullptr;
    }
    if (countOut != nullptr) {
        *countOut = static_cast<uint32_t>(resolved->instance->getAnimatedMapOutputs().size());
    }
    return resolved->instance->getAnimatedMapOutputs().data();
}

const float* tn_rl_neutral_joints(tn_rl_handle handle, uint32_t* countOut) {
    clearError();
    auto* resolved = resolve(handle);
    if (resolved == nullptr) {
        return nullptr;
    }
    const auto neutrals = resolved->logic->getNeutralJointValues();
    if (countOut != nullptr) {
        *countOut = static_cast<uint32_t>(neutrals.size());
    }
    return neutrals.data();
}

const char* tn_rl_last_error(void) {
    return g_lastError;
}

int32_t tn_rl_live_count(void) {
    return static_cast<int32_t>(liveHandles().size());
}

}  // extern "C"
