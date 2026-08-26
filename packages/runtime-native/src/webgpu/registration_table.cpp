#include "mystral/webgpu/registration_table.h"

#include <cstring>
#include <functional>
#include <string>
#include <utility>

#include "bindings_state.h"

namespace mystral::webgpu {

namespace {

struct PropertySnapshot {
    BindingDestination destination;
    std::string name;
    js::JSPropertyInfo property;
};

struct ExpectedInstalledProperty {
    bool writable;
    bool enumerable;
    bool configurable;
    js::JSValueHandle value;
};

bool propertyStateMatches(
    js::Engine* engine,
    const js::JSPropertyInfo& actual,
    const js::JSPropertyInfo& expected) {
    if (actual.kind != expected.kind) return false;
    if (actual.kind == js::JSPropertyKind::Missing) return true;
    if (actual.own != expected.own) return false;
    const bool attributesMatch =
        actual.enumerable == expected.enumerable &&
        actual.configurable == expected.configurable;
    if (!attributesMatch) {
        return false;
    }
    if (actual.kind == js::JSPropertyKind::Accessor) return true;
    return actual.writable == expected.writable &&
           engine->isSameValue(actual.value, expected.value);
}

ExpectedInstalledProperty expectedInstalledProperty(
    const js::JSPropertyInfo& snapshot,
    js::JSValueHandle value) {
    ExpectedInstalledProperty expected;
    expected.value = value;
    if (snapshot.kind == js::JSPropertyKind::Data && snapshot.own) {
        expected.writable = snapshot.writable;
        expected.enumerable = snapshot.enumerable;
        expected.configurable = snapshot.configurable;
    } else {
        expected.writable = true;
        expected.enumerable = true;
        expected.configurable = true;
    }
    return expected;
}

bool installedPropertyMatches(
    js::Engine* engine,
    const js::JSPropertyInfo& actual,
    const ExpectedInstalledProperty& expected) {
    return actual.kind == js::JSPropertyKind::Data && actual.own &&
           actual.writable == expected.writable &&
           actual.enumerable == expected.enumerable &&
           actual.configurable == expected.configurable &&
           engine->isSameValue(actual.value, expected.value);
}

void appendRollbackFailure(
    std::string& failures,
    const PropertySnapshot& snapshot,
    const std::string& reason) {
    if (!failures.empty()) failures += "; ";
    failures += snapshot.name + ": " + reason;
}

using PropertyMatcher = std::function<bool(size_t, const js::JSPropertyInfo&)>;

bool verifyWholeTablePass(
    js::Engine* engine,
    const std::vector<PropertySnapshot>& snapshots,
    bool reverse,
    const char* stateName,
    const PropertyMatcher& matches,
    std::string& failures) {
    for (size_t offset = 0; offset < snapshots.size(); ++offset) {
        const size_t index = reverse ? snapshots.size() - offset - 1 : offset;
        const auto& snapshot = snapshots[index];
        js::JSPropertyInfo actual;
        const bool inspected = engine->getPropertyInfo(
            snapshot.destination, snapshot.name.c_str(), actual);
        const std::string inspectionException = engine->hasException()
            ? engine->getException()
            : "";
        const bool stateMatches = inspected && inspectionException.empty() &&
            matches(index, actual);
        engine->releasePropertyInfo(actual);

        if (!inspected) {
            appendRollbackFailure(
                failures,
                snapshot,
                inspectionException.empty()
                    ? std::string(stateName) + " inspection failed"
                    : std::string(stateName) + " inspection threw: " +
                          inspectionException);
        } else if (!inspectionException.empty()) {
            appendRollbackFailure(
                failures,
                snapshot,
                std::string(stateName) + " inspection left an exception: " +
                    inspectionException);
        } else if (!stateMatches) {
            appendRollbackFailure(
                failures, snapshot, std::string(stateName) + " did not match");
        }
    }
    return failures.empty();
}

bool verifyStableWholeTable(
    js::Engine* engine,
    const std::vector<PropertySnapshot>& snapshots,
    const char* stateName,
    const PropertyMatcher& matches,
    std::string& failures) {
    // Binding destinations are side-effect-free, but keep the complete forward/reverse check as
    // rollback defense in depth. A mismatch in either pass leaves the transaction failed closed.
    return verifyWholeTablePass(
               engine, snapshots, false, stateName, matches, failures) &&
           verifyWholeTablePass(
               engine, snapshots, true, stateName, matches, failures);
}

bool verifyInstalledTable(
    js::Engine* engine,
    const std::vector<PropertySnapshot>& snapshots,
    const std::vector<ExpectedInstalledProperty>& expectedInstalled,
    std::string& failures) {
    if (expectedInstalled.size() != snapshots.size()) {
        failures = "installed descriptor set was incomplete";
        return false;
    }
    return verifyStableWholeTable(
        engine,
        snapshots,
        "installed state",
        [&](size_t index, const js::JSPropertyInfo& actual) {
            return installedPropertyMatches(
                engine, actual, expectedInstalled[index]);
        },
        failures);
}

bool verifySnapshotTable(
    js::Engine* engine,
    const std::vector<PropertySnapshot>& snapshots,
    std::string& failures) {
    return verifyStableWholeTable(
        engine,
        snapshots,
        "rollback final snapshot",
        [&](size_t index, const js::JSPropertyInfo& actual) {
            return propertyStateMatches(engine, actual, snapshots[index].property);
        },
        failures);
}

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
    // The exception latch is caller-visible state. A descriptor getter or another native
    // operation may have failed immediately before this install, and consuming that latch here
    // would turn a failed JavaScript call into a successful wrapper install. Callers that have
    // intentionally handled a previous failure must consume it before starting a new transaction.
    if (engine->hasException()) return false;

    const char* error = nullptr;
    if (!validateTable(table, &error)) {
        fail(engine, error);
        return false;
    }

    std::vector<BindingDestination> destinations;
    destinations.reserve(table.registrations.size());
    for (const auto& registration : table.registrations) {
        const auto destination = registration.destination;
        if (!engine->isBindingDestination(destination)) {
            fail(
                engine,
                "WebGPU binding destination must be an engine-owned ordinary object");
            return false;
        }
        destinations.push_back(destination);
    }

    std::vector<PropertySnapshot> snapshots;
    snapshots.reserve(table.registrations.size());
    auto releaseSnapshots = [&]() {
        for (auto& snapshot : snapshots) {
            engine->releasePropertyInfo(snapshot.property);
        }
        snapshots.clear();
    };
    for (size_t index = 0; index < table.registrations.size(); ++index) {
        const auto& registration = table.registrations[index];
        PropertySnapshot snapshot;
        snapshot.destination = destinations[index];
        snapshot.name = registration.name;
        js::JSPropertyInfo property;
        if (!engine->getPropertyInfo(snapshot.destination, snapshot.name.c_str(), property)) {
            engine->releasePropertyInfo(property);
            releaseSnapshots();
            if (!engine->hasException()) fail(engine, "WebGPU binding property inspection failed");
            return false;
        }
        if (property.kind == js::JSPropertyKind::Accessor) {
            engine->releasePropertyInfo(property);
            releaseSnapshots();
            fail(engine, "WebGPU binding table does not support accessor properties");
            return false;
        }
        if (property.kind == js::JSPropertyKind::Data && !property.writable) {
            engine->releasePropertyInfo(property);
            releaseSnapshots();
            fail(engine, "WebGPU binding table cannot replace a non-writable property");
            return false;
        }
        snapshot.property = property;
        snapshots.push_back(std::move(snapshot));
    }

    std::vector<js::JSValueHandle> protectedExpectedValues;
    protectedExpectedValues.reserve(table.registrations.size());
    auto releaseExpectedValues = [&]() {
        for (auto it = protectedExpectedValues.rbegin();
             it != protectedExpectedValues.rend(); ++it) {
            engine->freeHandle(*it);
        }
        protectedExpectedValues.clear();
    };

    auto rollback = [&]() {
        std::string failures;
        for (size_t remaining = snapshots.size(); remaining > 0; --remaining) {
            const auto& snapshot = snapshots[remaining - 1];
            bool operationSucceeded = false;
            if (snapshot.property.kind == js::JSPropertyKind::Data &&
                snapshot.property.own) {
                operationSucceeded = engine->setProperty(
                    snapshot.destination,
                    snapshot.name.c_str(),
                    snapshot.property.value);
            } else {
                operationSucceeded = engine->deleteProperty(
                    snapshot.destination, snapshot.name.c_str());
            }
            const std::string operationException = engine->hasException()
                ? engine->getException()
                : "";

            if (!operationSucceeded) {
                appendRollbackFailure(failures, snapshot, "rollback operation returned false");
            }
            if (!operationException.empty()) {
                appendRollbackFailure(
                    failures, snapshot, "rollback operation threw: " + operationException);
            }
        }
        return failures;
    };

    auto rollbackAndFail = [&](std::string exception) {
        const std::string rollbackFailures = rollback();
        std::string finalSnapshotFailures;
        verifySnapshotTable(engine, snapshots, finalSnapshotFailures);
        releaseSnapshots();
        releaseExpectedValues();
        if (!rollbackFailures.empty()) {
            exception += "; binding-table rollback operations failed: " + rollbackFailures;
        }
        if (!finalSnapshotFailures.empty()) {
            exception += "; binding-table rollback was incomplete: " +
                         finalSnapshotFailures;
        }
        if (exception.empty()) exception = "WebGPU binding property installation failed";
        engine->throwException(exception.c_str());
        return false;
    };

    std::vector<ExpectedInstalledProperty> expectedInstalled;
    expectedInstalled.reserve(table.registrations.size());
    for (size_t index = 0; index < table.registrations.size(); ++index) {
        const auto& registration = table.registrations[index];
        const auto destination = destinations[index];
        js::JSValueHandle function;
        if (registration.prebuiltFunction && registration.prebuiltFunction->ptr) {
            // Pre-built receiver-aware method function: skip creation, keep every other
            // guarantee below identical.
            function = *registration.prebuiltFunction;
        } else {
            function = engine->newFunction(
                registration.name,
                [engine, state, registration, destination](
                    void*,
                    const std::vector<js::JSValueHandle>& args) {
                    return dispatch(engine, state, registration, destination, args);
                });
        }
        const bool functionCreated = function.ptr != nullptr;
        const bool pendingException = engine->hasException();
        if (functionCreated) {
            engine->freezeHandle(function);
            protectedExpectedValues.push_back(function);
        }
        if (!functionCreated || pendingException) {
            std::string exception = engine->hasException()
                ? engine->getException()
                : "WebGPU binding function creation failed";
            return rollbackAndFail(std::move(exception));
        }

        expectedInstalled.push_back(expectedInstalledProperty(
            snapshots[index].property, function));
        const bool propertyWritten = engine->setProperty(
            destination, registration.name, function);
        if (!propertyWritten || engine->hasException()) {
            std::string exception = engine->hasException()
                ? engine->getException()
                : "WebGPU binding property installation failed";
            return rollbackAndFail(std::move(exception));
        }
    }

    std::string installedFailures;
    if (!verifyInstalledTable(
            engine, snapshots, expectedInstalled, installedFailures)) {
        return rollbackAndFail(
            "WebGPU binding whole-table verification failed: " + installedFailures);
    }
    releaseSnapshots();
    releaseExpectedValues();
    return true;
}

}  // namespace mystral::webgpu
