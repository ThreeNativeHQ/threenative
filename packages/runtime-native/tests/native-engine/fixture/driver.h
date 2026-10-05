#pragma once

// The native side of the differential fixture runner (PRD-498). run-native.ts writes a fixture as
// line commands on stdin; this driver executes them against native engine classes and answers each
// observation on stdout. Doubles cross as IEEE-754 bit patterns, so a comparison is bit-exact.
//
//   fixture <name> | new <id> <Class> <arg>* | call <id> <method> <result|-> <arg>*
//   set <id> <path> <arg> | observe <index> <id> <path|-> <method|-> <kind> | end
//   arg: n:<16 hex> | s:<percent-encoded> | b:1 | b:0 | null | r:<id>
//   reply: obs <index> <kind> <value> | unsupported <index|-> <reason> | error <message>

#include "engine/abi/binding.h"

#include <cstdint>
#include <functional>
#include <iosfwd>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace tn::fixture {

using namespace tn::binding;

/** The differential fixture driver: a binding Store keyed by the fixture's own string ids. */
class Driver : public Store {
public:
    /** Every native class the fixtures can name. */
    Registry classes;

    Object* find(const Value& arg) override;
    Value adopt(std::string cls, std::shared_ptr<void> ptr) override;
    /**
     * The numeric array a `toArray()` result was boxed into, which is how `fromArray(array)`
     * receives what the reference receives as a plain JS array. Empty for any other argument.
     */
    std::vector<double> numbers(const Value& arg) override;

    /** Runs one fixture script; returns the process exit status. */
    int run(std::istream& in, std::ostream& out);

private:
    std::map<std::string, Object> objects_;
    uint32_t nextTemp_ = 0;
};

}  // namespace tn::fixture
