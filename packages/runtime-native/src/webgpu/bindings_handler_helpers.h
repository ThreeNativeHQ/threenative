#pragma once

#include "bindings_state.h"
#include "mystral/webgpu/registration_table.h"

namespace mystral::webgpu {

#if defined(MYSTRAL_WEBGPU_WGPU) || defined(MYSTRAL_WEBGPU_DAWN)

template <typename T>
static BindingHandler makeCapturedHandler(
    T captured,
    js::JSValueHandle (*handler)(BindingsState*, T, const std::vector<js::JSValueHandle>&)) {
    return [captured, handler](BindingsState* state, BindingDestination,
                               const std::vector<js::JSValueHandle>& args) {
        return handler(state, captured, args);
    };
}

template <typename T, typename U>
static BindingHandler makeCapturedPairHandler(
    T first,
    U second,
    js::JSValueHandle (*handler)(
        BindingsState*, T, U, const std::vector<js::JSValueHandle>&)) {
    return [first, second, handler](BindingsState* state, BindingDestination,
                                    const std::vector<js::JSValueHandle>& args) {
        return handler(state, first, second, args);
    };
}

#endif

}  // namespace mystral::webgpu
