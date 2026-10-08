#pragma once

#include "engine/shader/graph/graph.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace tn::abi {

/** One argument of a TSL authoring call, as a language back end hands it over. */
struct TslArg {
    enum class Kind : uint8_t { Node, Number, String, Named, Rgb, Other, Object };  // Other: no TSL meaning
    Kind kind = Kind::Number;
    engine::shader::graph::Node node;
    double number = 0;
    std::string text;           // a String, or the name of a Named object (a texture)
    double rgb[3] = {0, 0, 0};  // an object with r, g and b, as a three Color is
    std::string cls;               // an Object: the engine object's class
    std::shared_ptr<void> object;  // an Object: the engine object itself (pmremTexture's texture)

    static TslArg of(engine::shader::graph::Node value) { TslArg a; a.kind = Kind::Node; a.node = std::move(value); return a; }
    static TslArg of(double value) { TslArg a; a.kind = Kind::Number; a.number = value; return a; }
    static TslArg of(std::string value) { TslArg a; a.kind = Kind::String; a.text = std::move(value); return a; }
    static TslArg named(std::string value) { TslArg a; a.kind = Kind::Named; a.text = std::move(value); return a; }
    static TslArg other() { TslArg a; a.kind = Kind::Other; return a; }
    static TslArg objectOf(std::string cls, std::shared_ptr<void> value) {
        TslArg a; a.kind = Kind::Object; a.cls = std::move(cls); a.object = std::move(value); return a;
    }
    static TslArg rgbOf(double r, double g, double b) { TslArg a; a.kind = Kind::Rgb; a.rgb[0] = r; a.rgb[1] = g; a.rgb[2] = b; return a; }
};

/**
 * TSL's authoring functions and node methods by name over the native lazy graph: the one table the
 * V8 and the Wasm back ends share (PRD-540). `receiver` is the node a method is called on, or null
 * for a module function. The statement and closure forms (Fn, If, Loop, Else, toVar, assign) and the
 * calls that change a wrapper (setName, element, setResolutionScale, instancedArray) stay with each
 * back end, which owns those scopes and wrappers.
 *
 * Returns null when `name` is not in the table. A bad call throws std::runtime_error with the reason.
 * `serial` numbers the uniforms and render textures the table names.
 */
engine::shader::graph::Node tslCall(const std::string& name, const TslArg* receiver, const std::vector<TslArg>& args,
                                    uint64_t& serial);

}  // namespace tn::abi
