#pragma once

#include "engine/shader/ir.h"

#include <cstdint>
#include <functional>
#include <initializer_list>
#include <memory>
#include <map>
#include <unordered_map>
#include <string>
#include <string_view>
#include <vector>

/**
 * A native lazy shader graph (PRD-531 slice 1): one node per upstream TSL node kind, built with no
 * program in scope, then lowered into the IR through the native TSL builder when a program exists.
 * A node is an immutable ref-counted value, so a shared node lowers once — as upstream builds one
 * node per stage — and statement nodes keep their program order.
 */
namespace tn::engine::shader::graph {

struct NodeData;
struct PostEffect;

/** A graph node: an immutable, ref-counted value of one upstream TSL kind. */
using Node = std::shared_ptr<const NodeData>;

enum class Kind : uint8_t {
    Constant, Uniform, Attribute, Builtin, Varying, PositionLocal,
    Unary, Binary, Math, Swizzle, Join, Convert, Select, Texture,
    StorageElement, VarRead, LoopIndex,
    Body, Var, Assign, If, Loop, RenderTexture, TextureSize, TextureLoad, Call, Return, Break, Continue, Discard, PostEffect,
    Pmrem, ScreenUv, Reflector,
};

enum class UnOp : uint8_t { Negate };
enum class BinOp : uint8_t { Add, Sub, Mul, Div, Less, Greater, Equal };

struct NodeData {
    Kind kind = Kind::Constant;
    std::shared_ptr<const PostEffect> post;
    std::shared_ptr<const void> object; // Pmrem: the source texture the renderer prefilters; Reflector: its engine::Reflector
    Type type;
    std::string name;
    std::string lanes;
    uint64_t bits = 0;
    std::vector<float> values; // uniform initial value; data, not part of the program key
    UnOp unary = UnOp::Negate;
    BinOp binary = BinOp::Add;
    std::vector<Node> args;
    std::vector<Node> body;
    std::vector<Node> otherwise;
    double scale = 1;
    uint32_t width = 0, height = 0; // RTT: zero means drawing-buffer size
};

Node float_(double value);
/** TSL's `float(node)`: a conversion. */
Node float_(Node value);
Node int_(int32_t value);
Node uint_(uint32_t value);
/** TSL's `uint(node)`: a conversion. */
Node uint_(Node value);

Node uniform(std::string_view name, Type type, std::vector<float> values = {});
Node attribute(std::string_view name, Type type);
Node varying(std::string_view name, Type type);
Node builtin(std::string_view name);
Node positionLocal();
Node uv();
/** TSL's screenUV: the fragment's position over the target size; a post pass maps it to its quad's uv. */
Node screenUV();
Node instanceIndex();

Node vec2(std::initializer_list<Node> parts);
Node vec3(std::initializer_list<Node> parts);
Node vec4(std::initializer_list<Node> parts);

Node add(Node a, Node b);
Node sub(Node a, Node b);
Node mul(Node a, Node b);
Node div(Node a, Node b);
Node negate(Node a);
Node lessThan(Node a, Node b);
Node greaterThan(Node a, Node b);
Node equal(Node a, Node b);
Node select(Node condition, Node whenTrue, Node whenFalse);
Node swizzle(Node value, std::string_view lanes);
Node texture(std::string_view map, Node uvs);
/**
 * TSL's `pmremTexture(texture, direction, level)`: the texture's PMREM (prefiltered radiance, cubeUV
 * layout) sampled along `direction` at roughness `level`. `texture` is the engine Texture the
 * renderer prefilters; the program samples it as "pmrem".
 */
Node pmremTexture(std::shared_ptr<const void> texture, Node direction, Node level);
/**
 * TSL's `reflector()` texture node: the mirrored pass the renderer draws for `reflector` (an
 * engine::Reflector), sampled at `uvs` (three's default is screenUV.flipX()) as "reflector".
 */
Node reflectorTexture(std::shared_ptr<const void> reflector, Node uvs);

#define TN_GRAPH_UNARY(name) Node name(Node a);
#define TN_GRAPH_BINARY(name) Node name(Node a, Node b);
#define TN_GRAPH_TERNARY(name) Node name(Node a, Node b, Node c);
TN_GRAPH_UNARY(abs)
TN_GRAPH_UNARY(sin)
TN_GRAPH_UNARY(cos)
TN_GRAPH_UNARY(floor)
TN_GRAPH_UNARY(fract)
TN_GRAPH_UNARY(sqrt)
TN_GRAPH_UNARY(exp)
TN_GRAPH_UNARY(exp2)
TN_GRAPH_UNARY(log2)
TN_GRAPH_UNARY(normalize)
TN_GRAPH_UNARY(length)
TN_GRAPH_BINARY(min)
TN_GRAPH_BINARY(max)
TN_GRAPH_BINARY(pow)
TN_GRAPH_BINARY(step)
TN_GRAPH_BINARY(dot)
TN_GRAPH_BINARY(distance)
TN_GRAPH_BINARY(cross)
TN_GRAPH_TERNARY(mix)
TN_GRAPH_TERNARY(clamp)
TN_GRAPH_TERNARY(smoothstep)
#undef TN_GRAPH_UNARY
#undef TN_GRAPH_BINARY
#undef TN_GRAPH_TERNARY

/** `node.toVar()`: a variable declaration; every read is an ordered load. */
struct Var {
    Node declaration;
    Type type;

    Node read() const;
    operator Node() const { return declaration; }  // NOLINT(google-explicit-constructor): a TSL var is a node
};

/** `instancedArray(count, type)` / `storage(...)`: a storage buffer, named as `setName` names it. */
struct Storage {
    std::string name;
    Type elementType;

    Node element(Node index) const;
};
inline Storage storage(std::string_view name, Type element) { return Storage{std::string(name), element}; }

/** Builds a function body: the statement nodes in program order, nested by If and Loop. */
class Block {
public:
    Var var(Node initial);
    void assign(Node target, Node value);
    void If(Node condition, const std::function<void()>& then);
    void IfElse(Node condition, const std::function<void()>& then, const std::function<void()>& otherwise);
    /** TSL's `Loop(count, ({ i }) => ...)` with a number count: an i32 loop from 0. */
    void Loop(int32_t count, const std::function<void(Node)>& body);
    /** The function body node. */
    Node node() const;

private:
    void append(Node statement);
    std::vector<std::shared_ptr<std::vector<Node>>> blocks_{std::make_shared<std::vector<Node>>()};
};

/** A graph is a function body or a single expression. */
using Graph = Node;

/** Walks the graph and emits IR into `program`; a Build scope must be active, as tsl.h requires. */
ExprId lower(const Graph& graph, Program& program,
             const std::unordered_map<std::string, ExprId>& inputs = {});
/** Canonical DAG serialization, independent of addresses; includes sharing and every operation. */
std::string key(const Graph& graph);
/** Named uniform data reachable from the graph. Conflicting values fail rather than pick one. */
std::map<std::string, std::vector<float>> uniforms(const Graph& graph);

}  // namespace tn::engine::shader::graph
