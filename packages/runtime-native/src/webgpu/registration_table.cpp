#include "mystral/webgpu/registration_table.h"

#include <string>
#include <string_view>
#include <utility>

#include "bindings_state.h"

namespace mystral::webgpu {

namespace {

js::JSValueHandle fail(js::Engine* engine, const char* message) {
    engine->throwException(message);
    return engine->newUndefined();
}

bool requireArguments(
    js::Engine* engine,
    const BindingRegistration& registration,
    const std::vector<js::JSValueHandle>& args) {
    if (args.size() >= registration.minimumArity) return true;
    const std::string fallback = std::string(registration.surface) + " requires at least " +
                                 std::to_string(registration.minimumArity) + " argument(s)";
    fail(engine, registration.arityError != nullptr ? registration.arityError : fallback.c_str());
    return false;
}

js::JSValueHandle dispatch(
    js::Engine* engine,
    BindingsState* state,
    const BindingRegistration& registration,
    const std::vector<js::JSValueHandle>& args) {
    if (!requireArguments(engine, registration, args)) return engine->newUndefined();
    return registration.handler(state, args);
}

}  // namespace

BindingTable bindingTable(
    js::JSValueHandle owner,
    std::initializer_list<BindingRegistration> registrations) {
    BindingTable table;
    table.registrations.reserve(registrations.size());
    const char* expectedSurface =
        registrations.size() == 0 ? nullptr : registrations.begin()->surface;
    for (auto registration : registrations) {
        if (expectedSurface == nullptr || registration.surface == nullptr ||
            std::string_view(registration.surface) != expectedSurface) {
            registration.owner = {};
        } else {
            registration.owner = [owner](BindingsState*) { return owner; };
        }
        table.registrations.push_back(std::move(registration));
    }
    return table;
}

void installBindingTable(
    js::Engine* engine,
    BindingsState* state,
    const BindingTable& table) {
    for (const auto& registration : table.registrations) {
        if (!registration.owner) {
            fail(engine, "WebGPU binding row has no destination");
            continue;
        }
        const auto owner = registration.owner(state);
        if (engine->isNull(owner) || engine->isUndefined(owner)) {
            fail(engine, "WebGPU binding row resolved an invalid destination");
            continue;
        }
        engine->setProperty(
            owner,
            registration.name,
            engine->newFunction(
                registration.name,
                [engine, state, registration](
                    void*,
                    const std::vector<js::JSValueHandle>& args) {
                    return dispatch(engine, state, registration, args);
                }));
    }
}

}  // namespace mystral::webgpu
