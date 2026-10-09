// The TSL name table both language back ends call (PRD-540). Moved from the V8 adapter's
// Tsl::call unchanged: each case builds the graph node the upstream TSL call means.
#include "engine/abi/tsl_call.h"
#include "engine/renderer/reflector.h"
#include "engine/scene/texture.h"

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

/** A TSL operand: a node (a variable reads its value), a number as a float constant, or a three
 * Color or VectorN as its vector constant, as TSL's nodeObject makes of it. */
g::Node input(const TslArg& value) {
    if (value.kind == TslArg::Kind::Number) return g::float_(number(value));
    if (value.kind == TslArg::Kind::Rgb || value.kind == TslArg::Kind::Vector) {
        std::vector<g::Node> lanes;
        for (uint8_t i = 0; i < value.lanes; ++i) {
            if (!std::isfinite(value.numbers[i])) throw std::runtime_error("expected a finite number");
            lanes.push_back(g::float_(value.numbers[i]));
        }
        if (lanes.size() == 2) return g::vec2({lanes[0], lanes[1]});
        if (lanes.size() == 3) return g::vec3({lanes[0], lanes[1], lanes[2]});
        if (lanes.size() == 4) return g::vec4({lanes[0], lanes[1], lanes[2], lanes[3]});
        throw std::runtime_error("a vector has 2, 3 or 4 lanes");
    }
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

    // PRD-540 (Wasm wrappers): the calls a back end without native wrappers makes by name.
    if (!method && name.rfind("constant:", 0) == 0) {
        arity(0);
        for (auto& [label, node] : tslConstants())
            if (label == name.substr(9)) return node;
        return {};
    }
    if (!method && name == "storage:element") {  // instancedArray(n, type).setName(name).element(index)
        arity(3);
        if (text(args[0]).empty()) throw std::runtime_error("storage buffer needs setName");
        return g::storage(text(args[0]), type(text(args[1]))).element(arg(2));
    }
    if (method && name == "setName") {  // a uniform under the name a material binds; the data stays
        arity(1);
        const auto& self = receiver->node;
        if (text(args[0]).empty()) throw std::runtime_error("empty name");
        if (!self || self->kind != g::Kind::Uniform) throw std::runtime_error("setName requires a uniform or storage buffer");
        return g::uniform(text(args[0]), self->type, self->values);
    }
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
            else if (args[0].kind == TslArg::Kind::Rgb) value.setRGB(args[0].numbers[0], args[0].numbers[1], args[0].numbers[2]);
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
    // Screen-space derivatives (r185's dFdx/dFdy, WGSL dpdx/dpdy) keep their operand's type.
    if (name == "dFdx" || name == "dFdy") {
        arity(method ? 0 : 1);
        auto node = std::make_shared<g::NodeData>();
        node->kind = g::Kind::Math; node->name = name; node->args = {lhs()};
        node->type = node->args[0]->type;
        return node;
    }
    // lengthSq(v) is dot(v, v).
    if (name == "lengthSq") {
        arity(method ? 0 : 1);
        const auto value = lhs();
        return g::dot(value, value);
    }
    if (name == "reflect") {
        arity(method ? 1 : 2);
        auto node = std::make_shared<g::NodeData>();
        node->kind = g::Kind::Math; node->name = "reflect"; node->args = {lhs(), rhs()};
        node->type = node->args[0]->type;
        return node;
    }
    // reflector(target, camera, resolutionScale, bounces, generateMipmaps, depth, samples): the
    // texture node of three's ReflectorNode, sampled at screenUV.flipX(). The language back ends
    // build target (an Object3D) and the virtual camera (a PerspectiveCamera) and pass them in.
    // ponytail: bounces is accepted and not modelled; a reflection pass hides every reflecting
    // surface, where three draws other mirrors into it. Model it if a scene needs mirrors in mirrors.
    if (!method && name == "reflector") {
        arity(7);
        const auto object = [&](size_t i, const char* cls) {
            if (args[i].kind != TslArg::Kind::Object || args[i].cls != cls || !args[i].object)
                throw std::runtime_error(std::string("reflector needs an engine ") + cls + " as argument " + std::to_string(i));
            return args[i].object;
        };
        auto state = std::make_shared<engine::Reflector>();
        state->target = std::static_pointer_cast<engine::Object3D>(object(0, "Object3D"));
        state->camera = std::static_pointer_cast<engine::PerspectiveCamera>(object(1, "PerspectiveCamera"));
        state->resolutionScale = number(args[2]);
        if (!(state->resolutionScale > 0)) throw std::runtime_error("reflector resolutionScale must be positive");
        (void)number(args[3]);
        if (number(args[4]) != 0)
            throw std::runtime_error("TN_NATIVE_REFLECTOR_UNSUPPORTED: generateMipmaps");
        if (number(args[5]) != 0)
            throw std::runtime_error("TN_NATIVE_REFLECTOR_UNSUPPORTED: depth");
        if (number(args[6]) != 0)
            throw std::runtime_error("TN_NATIVE_REFLECTOR_UNSUPPORTED: samples");
        const auto screen = g::screenUV();
        return g::reflectorTexture(state, g::vec2({g::sub(g::float_(1), g::swizzle(screen, "x")), g::swizzle(screen, "y")}));
    }
    // FlipNode: node.flipX() is the node with x replaced by 1 - x (likewise y, z, w).
    if (method && name.size() == 5 && name.rfind("flip", 0) == 0) {
        arity(0);
        const auto source = lhs();
        const auto flipped = std::string("XYZW").find(name[4]);
        const uint32_t size = source->type.isVector() ? source->type.rows : 0;
        if (flipped == std::string::npos || flipped >= size || size < 2 || size > 4)
            throw std::runtime_error(name + " needs a vector with that component");
        std::vector<g::Node> lanes;
        for (uint32_t i = 0; i < size; ++i) {
            const auto lane = g::swizzle(source, std::string(1, "xyzw"[i]));
            lanes.push_back(i == flipped ? g::sub(g::float_(1), lane) : lane);
        }
        if (size == 2) return g::vec2({lanes[0], lanes[1]});
        if (size == 3) return g::vec3({lanes[0], lanes[1], lanes[2]});
        return g::vec4({lanes[0], lanes[1], lanes[2], lanes[3]});
    }
    if (!method && name == "screenUV") {
        arity(0);
        return g::screenUV();
    }
    // pmremTexture(texture, direction, level): three's PMREMNode over an equirectangular texture.
    // Outside an environment there is no context to supply the direction or the level, so both are
    // required (three reads builder.context.getUV / getTextureLevel, which a material lacks).
    if (!method && name == "pmremTexture") {
        arity(3);
        if (args[0].kind != TslArg::Kind::Object || (args[0].cls != "Texture" && args[0].cls != "DataTexture") || !args[0].object)
            throw std::runtime_error("pmremTexture needs an engine Texture");
        return g::pmremTexture(args[0].object, arg(1), arg(2));
    }
    // MaterialX noise (three's MaterialXNodes.js over mx_noise.js; the WGSL is materialx_noise.h).
    // mx_noise_float(texcoord = uv(), amplitude = 1, pivot = 0) is perlin * amplitude + pivot, and
    // mx_worley_noise_vec2(texcoord = uv(), jitter = 1) uses metric 1, as three's wrapper does.
    if (!method && (name == "mx_noise_float" || name == "mx_worley_noise_vec2")) {
        const bool worley = name == "mx_worley_noise_vec2";
        if (args.size() > (worley ? 2u : 3u)) throw std::runtime_error("too many arguments");
        auto node = std::make_shared<g::NodeData>();
        node->kind = g::Kind::Math;
        node->name = worley ? "mx_worley_noise_vec2" : "mx_perlin_noise_float";
        node->args = {args.empty() ? g::uv() : arg(0)};
        node->type = worley ? Type::vec(2) : Type::f32();
        if (worley) {
            node->args.push_back(args.size() > 1 ? g::float_(arg(1)) : g::float_(1));
            node->args.push_back(g::int_(1));
            return node;
        }
        return g::add(g::mul(node, args.size() > 1 ? arg(1) : g::float_(1)), args.size() > 2 ? arg(2) : g::float_(0));
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
        // texture(textureObject, uv): the game's own Texture, bound by its identity (three's TextureNode).
        if (args[0].kind == TslArg::Kind::Object) {
            if (!args[0].object || (args[0].cls != "Texture" && args[0].cls != "DataTexture"))
                throw std::runtime_error("texture needs an engine Texture");
            const auto* texture = static_cast<const engine::Texture*>(args[0].object.get());
            return g::textureObject(args[0].object, "tslTex" + std::to_string(texture->ident.value()), arg(1));
        }
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
    // TextureNode.level(n): the same texture read at an explicit mip level.
    if (method && name == "level") {
        arity(1);
        const auto source = lhs();
        if (source->kind != g::Kind::Texture || source->args.size() != 1)
            throw std::runtime_error("level needs a texture node");
        auto node = std::make_shared<g::NodeData>(*source);
        node->args = {source->args[0], arg(0)};
        return node;
    }
    // r185's camera accessors (accessors/Camera.js) for a single camera: render-group uniforms by
    // their upstream names, which the renderer fills per draw (kSlotNames).
    // r185's viewport textures: the frame's colour and depth as drawn before this draw, read at uv
    // (screenUV when omitted). The renderer copies them at the first draw that reads one.
    if (!method && (name == "viewportSharedTexture" || name == "viewportDepthTexture")) {
        if (args.size() > 1) throw std::runtime_error(name + " takes at most a uv");
        const auto uv = args.empty() ? g::screenUV() : arg(0);
        return name == "viewportDepthTexture" ? g::viewportDepth(uv) : g::texture("viewportColor", uv);
    }
    // linearDepth(depth): ViewportDepthNode.LINEAR_DEPTH for a perspective camera,
    // viewZToOrthographicDepth(perspectiveDepthToViewZ(depth, near, far), near, far).
    // ponytail: perspective cameras only; an orthographic camera's depth is already linear.
    // linearDepth() with no depth is this fragment's own: viewZToOrthographicDepth(positionView.z, ...).
    if (!method && name == "linearDepth") {
        if (args.size() > 1) throw std::runtime_error("linearDepth takes at most a depth");
        const auto near = g::uniform("cameraNear", Type::f32()), far = g::uniform("cameraFar", Type::f32());
        const auto viewZ = args.empty() ? g::swizzle(g::varying("positionView", Type::vec(3)), "z")
                                        : g::div(g::mul(near, far), g::sub(g::mul(g::sub(far, near), arg(0)), far));
        return g::div(g::add(viewZ, near), g::sub(near, far));
    }
    if (name == "cameraNear" || name == "cameraFar") {
        arity(0);
        return g::uniform(name, Type::f32());
    }
    if (name == "cameraPosition" || name == "cameraProjectionMatrix" || name == "cameraWorldMatrix") {
        arity(0);
        return g::uniform(name, name == "cameraPosition" ? Type::vec(3) : Type::mat(4, 4));
    }
    // positionGeometry = attribute('position', 'vec3'): the geometry's position before positionNode.
    if (name == "positionGeometry") {
        arity(0);
        return g::attribute("position", Type::vec(3));
    }
    // normalWorld = normalView.transformNormalByInverseViewMatrix(cameraViewMatrix):
    // normalize((vec4(normalView, 0) * viewMatrix).xyz), normalView the interpolated geometry normal.
    // ponytail: the geometry normal only; a normalNode, normal map or back-face flip is not applied.
    if (name == "normalWorld") {
        arity(0);
        const auto normalView = g::normalize(g::varying("normalView", Type::vec(3)));
        return g::normalize(g::swizzle(g::mul(g::vec4({normalView, g::float_(0)}),
                                              g::uniform("viewMatrix", Type::mat(4, 4))), "xyz"));
    }
    // varying(node, name?): `node` computed in the vertex stage and interpolated to the fragment.
    if (name == "varying") {
        if (args.empty() || args.size() > 2) throw std::runtime_error("expected a node and an optional name");
        return g::varying(arg(0), args.size() == 2 ? text(args[1]) : "nodeVarying" + std::to_string(++serial));
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
        if (source->kind != g::Kind::Texture && source->kind != g::Kind::RenderTexture && source->kind != g::Kind::Reflector)
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
    // r185's clamp(value, low = 0, high = 1): the bounds a call leaves out default to 0 and 1.
    if (name == "clamp" && args.size() < (method ? 2u : 3u)) {
        if (!method && args.empty()) throw std::runtime_error("clamp needs a value");
        const size_t first = method ? 0 : 1, given = args.size() - first;
        return g::clamp(lhs(), given > 0 ? arg(first) : g::float_(0), given > 1 ? arg(first + 1) : g::float_(1));
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

std::vector<std::pair<std::string, g::Node>> tslConstants() {
    std::vector<std::pair<std::string, g::Node>> constants{{"positionLocal", g::positionLocal()},
            {"positionWorld", g::varying("positionWorld", Type::vec(3))},
            {"normalViewGeometry", g::varying("normalViewGeometry", Type::vec(3))},
            {"cameraViewMatrix", g::uniform("viewMatrix", Type::mat(4, 4))},
            {"instanceIndex", g::instanceIndex()},
            {"screenUV", g::screenUV()},
            {"materialColor", g::uniform("diffuse", Type::vec(4))},
            {"materialEmissive", g::uniform("emissive", Type::vec(3))},
            {"materialMetalness", g::uniform("metalness", Type::f32())},
            {"materialRoughness", g::uniform("roughness", Type::f32())}};
    // The node constants tslCall also answers by name; neither takes a serial.
    uint64_t serial = 0;
    for (const char* name : {"cameraPosition", "cameraProjectionMatrix", "cameraWorldMatrix", "cameraNear", "cameraFar",
                             "positionGeometry", "normalWorld"})
        constants.emplace_back(name, tslCall(name, nullptr, {}, serial));
    // viewportLinearDepth = linearDepth(viewportDepthTexture()).
    constants.emplace_back("viewportLinearDepth",
                           tslCall("linearDepth", nullptr, {TslArg::of(g::viewportDepth(g::screenUV()))}, serial));
    return constants;
}

void tslSetUniform(const g::Node& uniform, const double* values, size_t count) {
    std::vector<float> lanes;
    for (size_t i = 0; i < count; ++i) {
        if (!std::isfinite(values[i])) throw std::runtime_error("TN_TSL_UNIFORM_VALUE: values must be finite");
        lanes.push_back(static_cast<float>(values[i]));
    }
    g::setUniformValues(uniform, std::move(lanes));
}

std::vector<TslScopes::Body>& TslScopes::open() {
    if (open_.empty()) throw std::runtime_error("statement outside Fn");
    return open_;
}

bool TslScopes::call(const std::string& name, const TslArg* receiver, const std::vector<TslArg>& args, g::Node& out) {
    const auto arity = [&](size_t n) {
        if (args.size() != n) throw std::runtime_error("expected " + std::to_string(n) + " arguments");
    };
    const auto self = [&] {
        if (!receiver || receiver->kind != TslArg::Kind::Node || !receiver->node)
            throw std::runtime_error("invalid TSL receiver");
        return receiver->node;
    };
    const auto body = [&](size_t i, const char* form) {
        const auto& value = args.at(i);
        if (value.kind != TslArg::Kind::Node || !value.node || value.node->kind != g::Kind::Body)
            throw std::runtime_error(std::string(form) + " callback must contain statements");
        return value.node->body;
    };
    out = {};
    if (name == "scope:open") {
        arity(0);
        open_.push_back({++nextBody_, {}});
        return true;
    }
    if (name == "scope:close") {
        if (args.size() > 1) throw std::runtime_error("expected at most 1 argument");
        Body closed = std::move(open().back());
        open_.pop_back();
        for (auto it = ifs_.begin(); it != ifs_.end();) it = it->second.first == closed.id ? ifs_.erase(it) : std::next(it);
        if (closed.statements.empty() && !args.empty()) {
            out = input(args[0]);
            return true;
        }
        auto node = std::make_shared<g::NodeData>();
        node->kind = g::Kind::Body;
        node->body = std::move(closed.statements);
        // A callback that runs statements and returns a value (Fn(() => { a.addAssign(b); return a; }))
        // keeps the value: the Body lowers its statements, then yields args[0].
        if (!args.empty()) node->args = {input(args[0])};
        out = node;
        return true;
    }
    if (name == "toVar") {
        arity(0);
        auto& statements = open().back().statements;
        g::Block block;
        out = block.var(input(*receiver)).declaration;
        statements.push_back(out);
        return true;
    }
    // assign, and r185's compound forms: a.addAssign(b) is a.assign(a.add(b)) (likewise sub, mul, div).
    if (name == "assign" || name == "addAssign" || name == "subAssign" || name == "mulAssign" || name == "divAssign") {
        arity(1);
        auto& statements = open().back().statements;
        const auto target = self();
        if (target->kind != g::Kind::Var && target->kind != g::Kind::StorageElement)
            throw std::runtime_error(name + " requires a variable or storage element");
        g::Node value = input(args[0]);
        if (name != "assign") {
            const g::Node current = input(*receiver);
            value = name == "addAssign" ? g::add(current, value)
                    : name == "subAssign" ? g::sub(current, value)
                    : name == "mulAssign" ? g::mul(current, value) : g::div(current, value);
        }
        g::Block block;
        block.assign(target, value);
        statements.push_back(block.node()->body[0]);
        out = target;
        return true;
    }
    if (name == "If") {
        arity(2);
        auto& current = open().back();
        auto node = std::make_shared<g::NodeData>();
        node->kind = g::Kind::If;
        node->args = {input(args[0])};
        node->body = body(1, "If");
        ifs_[node.get()] = {current.id, current.statements.size()};
        current.statements.push_back(node);
        out = node;
        return true;
    }
    if (name == "Else") {
        arity(1);
        auto& current = open().back();
        const auto branch = self();
        const auto at = ifs_.find(branch.get());
        if (branch->kind != g::Kind::If || at == ifs_.end() || at->second.first != current.id ||
            at->second.second >= current.statements.size() || current.statements[at->second.second] != branch ||
            !branch->otherwise.empty())
            throw std::runtime_error("Else requires an If in this stack");
        auto node = std::make_shared<g::NodeData>(*branch);
        node->otherwise = body(0, "Else");
        current.statements[at->second.second] = node;
        ifs_.erase(at);
        out = node;
        return true;
    }
    if (name == "Loop:index") {
        arity(0);
        g::Block block;
        block.Loop(0, {});
        out = block.node()->body[0]->args[1];
        return true;
    }
    if (name == "Loop") {
        arity(3);
        auto& statements = open().back().statements;
        const double n = args[0].kind == TslArg::Kind::Number ? args[0].number : -1;
        if (n < 0 || n > std::numeric_limits<int32_t>::max() || n != std::floor(n))
            throw std::runtime_error("expected a nonnegative i32 count");
        if (args[1].kind != TslArg::Kind::Node || !args[1].node || args[1].node->kind != g::Kind::LoopIndex)
            throw std::runtime_error("Loop needs the index Loop:index made");
        auto node = std::make_shared<g::NodeData>();
        node->kind = g::Kind::Loop;
        node->args = {g::int_(static_cast<int32_t>(n)), args[1].node};
        node->body = body(2, "Loop");
        statements.push_back(node);
        out = node;
        return true;
    }
    return false;
}

}  // namespace tn::abi
