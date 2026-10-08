// The TSL name table both language back ends call (PRD-540). Moved from the V8 adapter's
// Tsl::call unchanged: each case builds the graph node the upstream TSL call means.
#include "engine/abi/tsl_call.h"

#include "engine/foundation/math/Color.h"
#include "engine/shader/graph/post_effects.h"

#include <bit>
#include <cmath>
#include <functional>
#include <limits>
#include <stdexcept>

namespace tn::abi {
namespace g = engine::shader::graph;
using engine::shader::Type;

namespace {
double number(const TslArg& value) {
    if (value.kind != TslArg::Kind::Number || !std::isfinite(value.number))
        throw std::runtime_error("expected a finite number");
    return value.number;
}

const std::string& text(const TslArg& value) {
    if (value.kind != TslArg::Kind::String) throw std::runtime_error("expected a string");
    return value.text;
}

Type type(const std::string& name) {
    if (name == "float") return Type::f32();
    if (name == "int") return Type::i32();
    if (name == "uint") return Type::u32();
    if (name == "vec2") return Type::vec(2);
    if (name == "vec3") return Type::vec(3);
    if (name == "vec4") return Type::vec(4);
    throw std::runtime_error("unsupported TSL type: " + name);
}

/** A TSL operand: a node (a variable reads its value) or a number as a float constant. */
g::Node input(const TslArg& value) {
    if (value.kind == TslArg::Kind::Number) return g::float_(number(value));
    if (value.kind != TslArg::Kind::Node || !value.node) throw std::runtime_error("expected a TSL node or number");
    return value.node->kind == g::Kind::Var ? g::Var{value.node, value.node->type}.read() : value.node;
}
}  // namespace

g::Node tslCall(const std::string& name, const TslArg* receiver, const std::vector<TslArg>& args, uint64_t& serial) {
    const bool method = receiver != nullptr;
    const auto arity = [&](size_t n) {
        if (args.size() != n) throw std::runtime_error("expected " + std::to_string(n) + " arguments");
    };
    const auto arg = [&](size_t i) { return input(args.at(i)); };
    const auto lhs = [&] { return method ? input(*receiver) : arg(0); };
    const auto rhs = [&] { return arg(method ? 0 : 1); };

    if (name == "nodeObject") {
        arity(1);
        return arg(0);
    }
    // three r185's post addons, built live as the engine's effects (PRD-531 slice 4): ao(depth, normal,
    // camera), denoise(input, depth, normal, camera), smaa(input), bloom(input, strength, radius,
    // threshold). The camera three takes is the render camera here: a pass reads its matrices each
    // frame. A missing normal (null) derives normals from depth, as three does.
    if (name == "ao" || name == "denoise") {
        const bool denoise = name == "denoise";
        if (args.size() < (denoise ? 3u : 2u)) throw std::runtime_error("expected the effect's texture inputs");
        const auto optional = [&](size_t i) { return args[i].kind == TslArg::Kind::Node ? arg(i) : g::Node{}; };
        const auto effect = denoise ? g::denoiseEffect(arg(0), arg(1), optional(2), static_cast<uint32_t>(++serial))
                                    : g::gtaoEffect(arg(0), optional(1));
        return g::effectNode(effect);
    }
    if (name == "smaa") {
        arity(1);
        return g::effectNode(g::smaaEffect(arg(0)));
    }
    if (name == "bloom") {
        if (args.empty() || args.size() > 4) throw std::runtime_error("expected input, strength, radius, threshold");
        const auto scalar = [&](size_t i, double fallback) {
            return args.size() <= i || args[i].kind == TslArg::Kind::Other ? fallback : number(args[i]);
        };
        return g::bloom(arg(0), scalar(1, 1), scalar(2, 0), scalar(3, 0));
    }
    if (name == "oneMinus") {
        arity(method ? 0 : 1);
        return g::sub(g::float_(1), lhs());
    }
    // A graph node is a value: `dispose()` releases nothing (the renderer owns what it builds from one).
    if (name == "dispose" && method) {
        arity(0);
        return lhs();
    }
    if (name == "color") {
        engine::Color value;
        if (args.size() == 3) value.setRGB(number(args[0]), number(args[1]), number(args[2]));
        else if (args.size() == 1) {
            if (args[0].kind == TslArg::Kind::Node) {
                auto node = std::make_shared<g::NodeData>();
                node->kind = g::Kind::Convert; node->type = Type::vec(3); node->args = {arg(0)};
                return node;
            }
            if (args[0].kind == TslArg::Kind::Number) value.setHex(number(args[0]));
            else if (args[0].kind == TslArg::Kind::String) value.setStyle(args[0].text.c_str());
            else if (args[0].kind == TslArg::Kind::Rgb) value.setRGB(args[0].rgb[0], args[0].rgb[1], args[0].rgb[2]);
            else throw std::runtime_error("color needs a Color, CSS string, hex or RGB components");
        } else if (!args.empty()) throw std::runtime_error("invalid color argument count");
        return g::vec3({g::float_(value.r), g::float_(value.g), g::float_(value.b)});
    }
    if (name == "ivec2") {
        if (args.size() > 2) throw std::runtime_error("invalid ivec2 argument count");
        auto node = std::make_shared<g::NodeData>();
        node->kind = g::Kind::Convert; node->type = Type::vec(2, Type::Scalar::I32);
        node->args = {args.size() == 2 ? g::vec2({arg(0), arg(1)})
            : g::vec2({args.size() == 1 ? arg(0) : g::float_(0)})};
        return node;
    }
    if (name == "reflect") {
        arity(method ? 1 : 2);
        auto node = std::make_shared<g::NodeData>();
        node->kind = g::Kind::Math; node->name = "reflect"; node->args = {lhs(), rhs()};
        node->type = node->args[0]->type;
        return node;
    }
    if (name == "textureLoad") {
        if (args.size() < 2 || args.size() > 3) throw std::runtime_error("expected texture, coordinates and optional level");
        std::string label;
        if (args[0].kind == TslArg::Kind::Node && args[0].node) {
            const auto& texture = args[0].node;
            if (texture->kind != g::Kind::Texture && texture->kind != g::Kind::RenderTexture)
                throw std::runtime_error("textureLoad needs a texture node");
            label = texture->name;
        } else if (args[0].kind == TslArg::Kind::Named) {
            label = args[0].text;
        }
        if (label.empty()) throw std::runtime_error("textureLoad needs a named texture");
        auto node = std::make_shared<g::NodeData>();
        node->kind = g::Kind::TextureLoad; node->name = label; node->type = Type::vec(4);
        node->args = {arg(1)};
        if (args.size() == 3) node->args.push_back(arg(2));
        return node;
    }
    if (name == "uniform") {
        arity(1);
        const auto value = arg(0);
        if (value->type == Type{})
            throw std::runtime_error("uniform value needs a concrete type");
        std::vector<float> values;
        const std::function<void(g::Node)> constant = [&](g::Node n) {
            if (n->kind == g::Kind::Constant && n->type == Type::f32()) {
                values.push_back(std::bit_cast<float>(static_cast<uint32_t>(n->bits)));
            } else if (n->kind == g::Kind::Join) {
                const size_t start = values.size();
                for (const auto& part : n->args) constant(part);
                if (values.size() - start == 1) values.resize(start + n->type.rows, values.back());
            } else throw std::runtime_error("uniform needs a constant float or vector value");
        };
        constant(value);
        return g::uniform("nodeUniform" + std::to_string(++serial), value->type, std::move(values));
    }
    if (name == "attribute") {
        arity(2);
        return g::attribute(text(args[0]), type(text(args[1])));
    }
    if (name == "texture") {
        arity(2);
        if (args[0].kind != TslArg::Kind::Named)
            throw std::runtime_error("expected a texture with a name");
        if (args[0].text.empty())
            throw std::runtime_error("texture needs a name");
        return g::texture(args[0].text, arg(1));
    }
    if (name == "uv") {
        arity(0);
        return g::uv();
    }
    if (name == "convertToTexture") {
        arity(1);
        const auto source = arg(0);
        if (source->kind == g::Kind::Texture || source->kind == g::Kind::RenderTexture)
            return source;
        auto target = std::make_shared<g::NodeData>();
        target->kind = g::Kind::RenderTexture;
        target->name = "native_rtt_" + std::to_string(++serial);
        target->type = Type::vec(4);
        target->args = {source, g::uv()};
        return target;
    }
    if (name == "sample") {
        arity(1);
        const auto source = lhs();
        if (source->kind != g::Kind::Texture && source->kind != g::Kind::RenderTexture)
            throw std::runtime_error("sample requires a texture node");
        auto sampled = std::make_shared<g::NodeData>(*source);
        if (source->kind == g::Kind::RenderTexture) sampled->args[1] = arg(0);
        else sampled->args[0] = arg(0);
        return sampled;
    }
    if (name == "float" || name == "int" || name == "uint") {
        arity(1);
        if (args[0].kind == TslArg::Kind::Number) {
            const double n = number(args[0]);
            if (name == "float")
                return g::float_(n);
            const double minimum = name == "uint" ? 0 : std::numeric_limits<int32_t>::min();
            const double maximum =
                name == "uint" ? std::numeric_limits<uint32_t>::max() : std::numeric_limits<int32_t>::max();
            if (n < minimum || n > maximum || n != std::floor(n))
                throw std::runtime_error("integer out of range");
            return name == "int" ? g::int_(static_cast<int32_t>(n)) : g::uint_(static_cast<uint32_t>(n));
        }
        if (name == "float")
            return g::float_(arg(0));
        if (name == "uint")
            return g::uint_(arg(0));
        auto node = std::make_shared<g::NodeData>();
        node->kind = g::Kind::Convert;
        node->type = Type::i32();
        node->args = {arg(0)};
        return node;
    }
    if (name == "vec2" || name == "vec3" || name == "vec4") {
        const size_t lanes = static_cast<size_t>(name.back() - '0');
        if (args.empty() || args.size() > lanes)
            throw std::runtime_error("invalid vector argument count");
        std::vector<g::Node> parts;
        for (size_t i = 0; i < args.size(); ++i)
            parts.push_back(arg(i));
        // graph.h's fixed initializer-list API: the vector's lane count is still checked by lower().
        const auto join = [&](std::initializer_list<g::Node> list) {
            return lanes == 2 ? g::vec2(list) : lanes == 3 ? g::vec3(list) : g::vec4(list);
        };
        if (parts.size() == 1)
            return join({parts[0]});
        if (parts.size() == 2)
            return join({parts[0], parts[1]});
        if (parts.size() == 3)
            return join({parts[0], parts[1], parts[2]});
        return join({parts[0], parts[1], parts[2], parts[3]});
    }
    if (name.rfind("swizzle:", 0) == 0) {
        arity(0);
        return g::swizzle(lhs(), name.substr(8));
    }
    // r185's fluent step places the receiver last (MathNode.stepElement).
    if (method && name == "step") {
        arity(1);
        return g::step(arg(0), lhs());
    }
#define BINARY(symbol)                                                                                                 \
    if (name == #symbol) {                                                                                             \
        arity(method ? 1 : 2);                                                                                         \
        return g::symbol(lhs(), rhs());                                                                                \
    }
    BINARY(add)
    BINARY(sub)
    BINARY(mul) BINARY(div) BINARY(lessThan) BINARY(greaterThan) BINARY(equal) BINARY(min) BINARY(max) BINARY(pow)
        BINARY(step) BINARY(dot) BINARY(distance) BINARY(cross)
#undef BINARY
#define UNARY(symbol)                                                                                                  \
    if (name == #symbol) {                                                                                             \
        arity(method ? 0 : 1);                                                                                         \
        return g::symbol(lhs());                                                                                       \
    }
            UNARY(negate) UNARY(abs) UNARY(sin) UNARY(cos) UNARY(floor) UNARY(fract) UNARY(sqrt) UNARY(exp) UNARY(exp2)
                UNARY(log2) UNARY(normalize) UNARY(length)
#undef UNARY
    // r185's fluent mix/smoothstep also place the receiver last.
    if (method && (name == "mix" || name == "smoothstep")) {
        arity(2);
        return name == "mix" ? g::mix(arg(0), arg(1), lhs()) : g::smoothstep(arg(0), arg(1), lhs());
    }
#define TERNARY(symbol)                                                                                                \
    if (name == #symbol) {                                                                                             \
        arity(method ? 2 : 3);                                                                                         \
        return g::symbol(lhs(), arg(method ? 0 : 1), arg(method ? 1 : 2));                                             \
    }
                    TERNARY(select) TERNARY(mix) TERNARY(clamp) TERNARY(smoothstep)
#undef TERNARY
                        return {};
}

double tslEffectParameter(const g::Node& node, const std::string& name, const double* value) {
    if (!node || node->kind != g::Kind::PostEffect || !node->post) throw std::runtime_error("not a live post effect");
    auto& effect = const_cast<g::PostEffect&>(*node->post);  // ponytail: live effects are built mutable
    if (name == "resolutionScale") {
        if (value) {
            if (!(*value > 0 && *value <= 8)) throw std::runtime_error("resolutionScale must be in (0, 8]");
            effect.resolutionScale = static_cast<float>(*value);
        }
        return effect.resolutionScale;
    }
    const auto found = effect.parameters.find(name);
    if (found == effect.parameters.end() || found->second.size() != 1 || name.front() == '_')
        throw std::runtime_error(effect.kind + " has no scalar uniform " + name);
    if (value) {
        if (!std::isfinite(*value)) throw std::runtime_error("expected a finite number");
        found->second[0] = static_cast<float>(*value);
    }
    return found->second[0];
}

}  // namespace tn::abi
