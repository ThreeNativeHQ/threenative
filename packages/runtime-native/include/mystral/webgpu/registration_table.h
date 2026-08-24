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
