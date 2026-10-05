#pragma once

// The engine's one binding model (PRD-500 / PRD-531): each native class registers a constructor,
// methods, getters and setters once, and every caller drives the same registry — the differential
// fixture driver by string ids, the C ABI (and the VMs above it: V8, browser JS over Wasm) by
// handles. A caller implements Store; a binding never knows which caller it serves.

#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace tn::binding {

struct Value {
    enum class Kind : uint8_t { Null, Number, String, Bool, Ref, Numbers };
    Kind kind = Kind::Null;
    double number = 0;
    std::string text;             // String payload, or the caller's object id for Ref
    bool flag = false;
    std::vector<double> numbers;  // a numeric array (`elements`, `toArray()`)

    static Value of(double n) { return Value{Kind::Number, n}; }
    static Value of(bool b) { return Value{Kind::Bool, 0, {}, b}; }
    static Value list(std::vector<double> values) { return Value{Kind::Numbers, 0, {}, false, std::move(values)}; }
};

/** A native object as a caller holds it: its class name and shared ownership of the value. */
struct Object {
    std::string cls;
    std::shared_ptr<void> ptr;
};

/**
 * Thrown inside a binding when a call asks for something the native class does not support. It is
 * caught at the caller's boundary and becomes `unsupported` (driver) or TN_ERROR_UNSUPPORTED (ABI);
 * it never crosses the C ABI.
 */
struct Unsupported {
    std::string reason;
};

class Store;
using Args = std::vector<Value>;
using Ctor = std::function<std::shared_ptr<void>(const Args&, Store&)>;
/** Returns a value, or chain() to return the object it was called on. */
using Method = std::function<Value(void* self, const Args&, Store&)>;
using Getter = std::function<Value(void* self)>;
using Setter = std::function<void(void* self, const Value&)>;

struct ClassBinding {
    Ctor ctor;
    std::map<std::string, Method> methods;
    std::map<std::string, Getter> getters;  // keyed by full path: "x", "position.x", "matrixWorld.elements"
    std::map<std::string, Setter> setters;
    // Member objects (`position`, `matrixWorld`): read as properties, answered with the one alias Ref
    // of that member (memberAlias), so they need the Store a plain getter does not get.
    std::map<std::string, Method> members;
};

using Registry = std::map<std::string, ClassBinding>;

/** What a binding needs from its caller: resolve an argument to an object, and adopt a new one. */
class Store {
public:
    virtual ~Store() = default;
    /** The object a Ref argument names, or null. */
    virtual Object* find(const Value& arg) = 0;
    /** Hands a new native object back to the caller as a Ref value. */
    virtual Value adopt(std::string cls, std::shared_ptr<void> ptr) = 0;
    /**
     * Hands back a member object (`object.position`) as the Ref value naming *that* member: the same
     * Ref on every call, because the member is not copied and does not move. `owner` is the pointer
     * the binding was called on, which the caller holds the shared ownership of; the returned Ref
     * keeps that owner alive, so an alias carries no lifetime of its own.
     */
    virtual Value adoptAlias(std::string cls, void* member, void* owner) = 0;
    /** The numeric array a Ref names when it holds one (a boxed toArray() result); empty otherwise. */
    virtual std::vector<double> numbers(const Value& arg) = 0;

    /** Resolves a Ref argument, refusing a class mismatch. */
    template <typename T>
    T& ref(const Value& arg, const char* cls) {
        Object* object = find(arg);
        if (!object || object->cls != cls) throw Unsupported{std::string("argument is not a ") + cls};
        return *static_cast<T*>(object->ptr.get());
    }
};

/** The value a chaining method returns: the object it was called on. */
inline Value chain() { return Value{Value::Kind::Ref, 0, "\x01self"}; }

/** The Ref for a member object of the object a binding was called on; registered in `members`. */
template <typename T>
Value memberAlias(Store& store, void* self, T& member, const char* cls) {
    return store.adoptAlias(cls, &member, self);
}

inline double number(const Value& v) {
    if (v.kind != Value::Kind::Number) throw Unsupported{"expected a number"};
    return v.number;
}

}  // namespace tn::binding
