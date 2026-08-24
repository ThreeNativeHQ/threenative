#include "mystral/webgpu/registration_table.h"

#include <cstring>
#include <string>

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
    BindingDestination destination,
    const std::vector<js::JSValueHandle>& args) {
    if (!requireArguments(engine, registration, args)) return engine->newUndefined();
    return registration.handler(state, destination, args);
}

bool validateTable(
    const BindingTable& table,
    const char** error) {
    if (!table.valid) {
        *error = table.error != nullptr ? table.error : "WebGPU binding table is invalid";
        return false;
    }
    if (table.registrations.empty()) {
        *error = "WebGPU binding table must contain at least one row";
        return false;
    }
    const char* expectedSurface = table.registrations.front().surface;
    for (const auto& registration : table.registrations) {
        if (registration.surface == nullptr || registration.name == nullptr ||
            registration.handler == nullptr || registration.destination.ptr == nullptr) {
            *error = "WebGPU binding table contains an invalid row";
            return false;
        }
        if (std::strcmp(registration.surface, expectedSurface) != 0) {
            *error = "WebGPU binding table mixes binding surfaces";
            return false;
        }
    }
    return true;
}

}  // namespace

BindingTable bindingTable(std::initializer_list<BindingRegistration> registrations) {
    BindingTable table;
    table.registrations.reserve(registrations.size());
    const char* expectedSurface = registrations.size() == 0 ? nullptr : registrations.begin()->surface;
    for (const auto& registration : registrations) {
        if (table.valid &&
            (registration.surface == nullptr || registration.name == nullptr ||
             registration.handler == nullptr || registration.destination.ptr == nullptr)) {
            table.valid = false;
            table.error = "WebGPU binding table contains an invalid row";
        }
        if (table.valid && std::strcmp(registration.surface, expectedSurface) != 0) {
            table.valid = false;
            table.error = "WebGPU binding table mixes binding surfaces";
        }
        table.registrations.push_back(registration);
    }
    return table;
}

bool installBindingTable(
    js::Engine* engine,
    BindingsState* state,
    const BindingTable& table) {
    const char* error = nullptr;
    if (!validateTable(table, &error)) {
        fail(engine, error);
        return false;
    }

    std::vector<BindingDestination> destinations;
    destinations.reserve(table.registrations.size());
    for (const auto& registration : table.registrations) {
        const auto destination = registration.destination;
        if (engine->isNull(destination) || engine->isUndefined(destination)) {
            fail(engine, "WebGPU binding row resolved an invalid destination");
            return false;
        }
        destinations.push_back(destination);
    }

    for (size_t index = 0; index < table.registrations.size(); ++index) {
        const auto& registration = table.registrations[index];
        const auto destination = destinations[index];
        engine->setProperty(
            destination,
            registration.name,
            engine->newFunction(
                registration.name,
                [engine, state, registration, destination](
                    void*,
                    const std::vector<js::JSValueHandle>& args) {
                    return dispatch(engine, state, registration, destination, args);
                }));
    }
    return true;
}

}  // namespace mystral::webgpu
