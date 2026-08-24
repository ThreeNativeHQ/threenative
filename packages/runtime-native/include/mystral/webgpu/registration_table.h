#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <vector>

#include "mystral/js/engine.h"

namespace mystral::webgpu {

struct BindingsState;

using BindingHandler = std::function<js::JSValueHandle(
    BindingsState* state,
    const std::vector<js::JSValueHandle>& args)>;

struct BindingRegistration {
    const char* surface;
    const char* name;
    uint8_t minimumArity;
    const char* arityError;
    BindingHandler handler;
};

void installBindingTable(
    js::Engine* engine,
    BindingsState* state,
    js::JSValueHandle owner,
    const BindingRegistration* registrations,
    size_t count);

void installBinding(
    BindingsState* state,
    js::JSValueHandle owner,
    const char* surface,
    const char* name,
    BindingHandler handler,
    uint8_t minimumArity = 0,
    const char* arityError = nullptr);

void installGlobalBinding(
    BindingsState* state,
    const char* surface,
    const char* name,
    BindingHandler handler,
    uint8_t minimumArity = 0,
    const char* arityError = nullptr);

}  // namespace mystral::webgpu
