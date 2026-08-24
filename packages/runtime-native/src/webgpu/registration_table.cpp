#include "mystral/webgpu/registration_table.h"

#include <string>
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

void installBindingTable(
    js::Engine* engine,
    BindingsState* state,
    js::JSValueHandle owner,
    const BindingRegistration* registrations,
    size_t count) {
    for (size_t index = 0; index < count; ++index) {
        const auto& registration = registrations[index];
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

void installBinding(
    BindingsState* state,
    js::JSValueHandle owner,
    const char* surface,
    const char* name,
    BindingHandler handler,
    uint8_t minimumArity,
    const char* arityError) {
    const BindingRegistration registration{
        surface,
        name,
        minimumArity,
        arityError,
        std::move(handler),
    };
    installBindingTable(state->engine, state, owner, &registration, 1);
}

void installGlobalBinding(
    BindingsState* state,
    const char* surface,
    const char* name,
    BindingHandler handler,
    uint8_t minimumArity,
    const char* arityError) {
    installBinding(
        state,
        state->engine->getGlobal(),
        surface,
        name,
        std::move(handler),
        minimumArity,
        arityError);
}

}  // namespace mystral::webgpu
