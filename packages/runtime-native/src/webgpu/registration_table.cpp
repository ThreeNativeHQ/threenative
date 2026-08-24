#include "mystral/webgpu/registration_table.h"

#include <cstring>
#include <string>
#include <utility>

#include "bindings_state.h"

namespace mystral::webgpu {

namespace {

struct PropertySnapshot {
    BindingDestination destination;
    std::string name;
    bool hadOwnDataProperty = false;
    js::JSValueHandle value;
};

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
    // A JavaScript caller may catch an exception raised by an earlier native binding. Clear the
    // engine's host-side exception latch before starting a new installation; failures below set a
    // fresh exception and keep it pending for the caller.
    if (engine->hasException()) engine->getException();

    const char* error = nullptr;
    if (!validateTable(table, &error)) {
        fail(engine, error);
        return false;
    }

    std::vector<BindingDestination> destinations;
    destinations.reserve(table.registrations.size());
    for (const auto& registration : table.registrations) {
        const auto destination = registration.destination;
        if (engine->isNull(destination) || engine->isUndefined(destination) ||
            !engine->isObject(destination)) {
            fail(engine, "WebGPU binding row resolved an invalid destination");
            return false;
        }
        destinations.push_back(destination);
    }

    std::vector<PropertySnapshot> snapshots;
    snapshots.reserve(table.registrations.size());
    for (size_t index = 0; index < table.registrations.size(); ++index) {
        const auto& registration = table.registrations[index];
        PropertySnapshot snapshot;
        snapshot.destination = destinations[index];
        snapshot.name = registration.name;
        js::JSPropertyInfo property;
        if (!engine->getPropertyInfo(snapshot.destination, snapshot.name.c_str(), property)) {
            if (!engine->hasException()) fail(engine, "WebGPU binding property inspection failed");
            return false;
        }
        if (property.kind == js::JSPropertyKind::Accessor) {
            fail(engine, "WebGPU binding table does not support accessor properties");
            return false;
        }
        if (property.kind == js::JSPropertyKind::Data && !property.writable) {
            fail(engine, "WebGPU binding table cannot replace a non-writable property");
            return false;
        }
        if (property.kind == js::JSPropertyKind::Data) {
            snapshot.hadOwnDataProperty = property.own;
            snapshot.value = property.value;
        }
        snapshots.push_back(std::move(snapshot));
    }

    auto rollback = [&](size_t count) {
        bool rollbackSucceeded = true;
        for (auto it = snapshots.rbegin() + (snapshots.size() - count);
             it != snapshots.rend();
             ++it) {
            bool restored = false;
            if (it->hadOwnDataProperty) {
                restored = engine->setProperty(it->destination, it->name.c_str(), it->value);
            } else {
                restored = engine->deleteProperty(it->destination, it->name.c_str());
            }
            if (engine->hasException()) engine->getException();
            rollbackSucceeded = rollbackSucceeded && restored;
        }
        return rollbackSucceeded;
    };

    for (size_t index = 0; index < table.registrations.size(); ++index) {
        const auto& registration = table.registrations[index];
        const auto destination = destinations[index];
        const auto function = engine->newFunction(
            registration.name,
            [engine, state, registration, destination](
                void*,
                const std::vector<js::JSValueHandle>& args) {
                return dispatch(engine, state, registration, destination, args);
            });
        const bool functionCreated = function.ptr != nullptr;
        const bool pendingException = engine->hasException();
        bool propertyWriteAttempted = false;
        bool propertyWritten = false;
        if (functionCreated && !pendingException) {
            propertyWriteAttempted = true;
            propertyWritten = engine->setProperty(destination, registration.name, function);
            if (propertyWritten) {
                // The engine operation must leave an own data binding. A proxy setter can return
                // true without creating one, and inherited lookup must not make that look like a
                // successful installation. Descriptor inspection does not invoke a getter/setter.
                js::JSPropertyInfo installed;
                propertyWritten = engine->getPropertyInfo(
                    destination, registration.name, installed) &&
                    installed.kind == js::JSPropertyKind::Data && installed.own &&
                    engine->isSameValue(installed.value, function);
                if (!propertyWritten && !engine->hasException()) {
                    fail(engine, "WebGPU binding property installation did not create an own binding");
                }
            }
        }
        if (!functionCreated || pendingException || !propertyWritten) {
            std::string exception = engine->hasException()
                ? engine->getException()
                : "WebGPU binding property installation failed";
            const size_t rollbackCount = index + (propertyWriteAttempted ? 1 : 0);
            const bool rollbackSucceeded = rollback(rollbackCount);
            if (!rollbackSucceeded) {
                exception += "; binding-table rollback was incomplete";
            }
            if (exception.empty()) exception = "WebGPU binding property installation failed";
            engine->throwException(exception.c_str());
            return false;
        }
    }
    return true;
}

}  // namespace mystral::webgpu
