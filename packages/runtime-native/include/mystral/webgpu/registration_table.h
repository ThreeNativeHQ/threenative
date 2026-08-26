#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <initializer_list>
#include <vector>

#include "mystral/js/engine.h"

namespace mystral::webgpu {

struct BindingsState;

using BindingDestination = js::JSValueHandle;

using BindingHandler = std::function<js::JSValueHandle(
    BindingsState* state,
    BindingDestination destination,
    const std::vector<js::JSValueHandle>& args)>;

struct BindingRegistration {
    const char* surface;
    const char* name;
    uint8_t minimumArity;
    const char* arityError;
    BindingHandler handler;
    BindingDestination destination;
    // When set, installBindingTable() installs this already-created function instead of
    // manufacturing a plain NativeFunction around `handler`. Used by per-class tables whose
    // rows are receiver-aware Engine::newMethod functions. The handle follows the same
    // transactional lifecycle as a created function: installed once, released with the
    // expected-value bookkeeping either on success or rollback. `handler` must still be
    // non-null for validation, but an installed row never dispatches through it.
    const js::JSValueHandle* prebuiltFunction = nullptr;
};

struct BindingTable {
    std::vector<BindingRegistration> registrations;
    bool valid = true;
    const char* error = nullptr;
};

BindingTable bindingTable(std::initializer_list<BindingRegistration> registrations);
bool installBindingTable(
    js::Engine* engine, BindingsState* state,
    const BindingTable& table);

}  // namespace mystral::webgpu
