#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <initializer_list>
#include <vector>

#include "mystral/js/engine.h"

namespace mystral::webgpu {

struct BindingsState;

using BindingHandler = std::function<js::JSValueHandle(
    BindingsState* state,
    const std::vector<js::JSValueHandle>& args)>;

using BindingOwnerResolver = std::function<js::JSValueHandle(BindingsState* state)>;

struct BindingRegistration {
    const char* surface;
    const char* name;
    uint8_t minimumArity;
    const char* arityError;
    BindingHandler handler;
    BindingOwnerResolver owner;
};

struct BindingTable {
    std::vector<BindingRegistration> registrations;
};

BindingTable bindingTable(
    js::JSValueHandle owner, std::initializer_list<BindingRegistration> registrations);
void installBindingTable(
    js::Engine* engine, BindingsState* state,
    const BindingTable& table);

}  // namespace mystral::webgpu
