#pragma once

// The native side of the differential fixture runner (PRD-498). run-native.ts writes a fixture as
// line commands on stdin; this driver executes them against native engine classes and answers each
// observation on stdout. Doubles cross as IEEE-754 bit patterns, so a comparison is bit-exact.
//
//   fixture <name> | new <id> <Class> <arg>* | call <id> <method> <result|-> <arg>*
//   set <id> <path> <arg> | observe <index> <id> <path|-> <method|-> <kind> | end
//   arg: n:<16 hex> | s:<percent-encoded> | b:1 | b:0 | null | r:<id>
//   reply: obs <index> <kind> <value> | unsupported <index|-> <reason> | error <message>

#include <cstdint>
#include <functional>
#include <iosfwd>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace tn::fixture {

struct Value {
    enum class Kind : uint8_t { Null, Number, String, Bool, Ref, Numbers };
    Kind kind = Kind::Null;
    double number = 0;
    std::string text;            // String payload, or the object id for Ref
    bool flag = false;
    std::vector<double> numbers;  // a numeric array observation (`elements`, `toArray()`)

    static Value of(double n) { return Value{Kind::Number, n}; }
    static Value of(bool b) { return Value{Kind::Bool, 0, {}, b}; }
    static Value list(std::vector<double> values) { return Value{Kind::Numbers, 0, {}, false, std::move(values)}; }
};

/** An engine object as the driver holds it: its class name and shared ownership of the native value. */
struct Object {
    std::string cls;
    std::shared_ptr<void> ptr;
};

class Driver;

/** Thrown inside a binding when the fixture asks for something the native class does not support. */
struct Unsupported {
    std::string reason;
};

using Args = std::vector<Value>;
using Ctor = std::function<std::shared_ptr<void>(const Args&, Driver&)>;
/** Returns a value, or `self` to chain (the result id then aliases the same object). */
using Method = std::function<Value(void* self, const Args&, Driver&)>;
using Getter = std::function<Value(void* self)>;
using Setter = std::function<void(void* self, const Value&)>;

struct ClassBinding {
    Ctor ctor;
    std::map<std::string, Method> methods;
    std::map<std::string, Getter> getters;  // keyed by full path: "x", "position.x", "matrixWorld.elements"
    std::map<std::string, Setter> setters;
};

class Driver {
public:
    /** Every native class the fixtures can name. */
    std::map<std::string, ClassBinding> classes;

    /** Resolves an `r:<id>` argument to its native object, refusing a class mismatch. */
    template <typename T>
    T& ref(const Value& arg, const char* cls) {
        auto it = objects_.find(arg.text);
        if (arg.kind != Value::Kind::Ref || it == objects_.end() || it->second.cls != cls) {
            throw Unsupported{std::string("argument is not a ") + cls};
        }
        return *static_cast<T*>(it->second.ptr.get());
    }
    /** Returns a new native object to the fixture as a fresh id. */
    Value adopt(std::string cls, std::shared_ptr<void> ptr);

    /**
     * The numeric array a `toArray()` result was boxed into, which is how `fromArray(array)`
     * receives what the reference receives as a plain JS array. Empty for any other argument.
     */
    std::vector<double> numbers(const Value& arg);

    /** Runs one fixture script; returns the process exit status. */
    int run(std::istream& in, std::ostream& out);

private:
    std::map<std::string, Object> objects_;
    uint32_t nextTemp_ = 0;
};

/** The value a chaining method returns: the object it was called on. */
inline Value chain() { return Value{Value::Kind::Ref, 0, "\x01self"}; }

double number(const Value& v);

}  // namespace tn::fixture
