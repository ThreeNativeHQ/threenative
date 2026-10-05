#include "wgsl.h"

#include <bit>
#include <charconv>
#include <cmath>
#include <set>

namespace tn::engine::shader {

namespace {

struct BuiltinName {
    const char* ir;
    const char* wgsl;
};

constexpr BuiltinName kBuiltinNames[] = {
    {"vertexIndex", "vertex_index"},     {"instanceIndex", "instance_index"},
    {"position", "position"},            {"frontFacing", "front_facing"},
    {"globalInvocationId", "global_invocation_id"}, {"localInvocationIndex", "local_invocation_index"},
};

const char* wgslBuiltin(const std::string& ir) {
    for (const BuiltinName& b : kBuiltinNames) {
        if (ir == b.ir) return b.wgsl;
    }
    return nullptr;
}

const char* binaryOperator(Op op) {
    switch (op) {
        case Op::Add: return " + ";
        case Op::Sub: return " - ";
        case Op::Mul: return " * ";
        case Op::Div: return " / ";
        case Op::Less: return " < ";
        case Op::Equal: return " == ";
        default: return nullptr;
    }
}

}  // namespace

std::string WgslEmitter::type(const Type& t) const {
    const char* scalar = t.scalar == Type::Scalar::F32   ? "f32"
                         : t.scalar == Type::Scalar::I32 ? "i32"
                         : t.scalar == Type::Scalar::U32 ? "u32"
                         : t.scalar == Type::Scalar::Bool ? "bool"
                                                          : "void";
    if (t.isScalar()) return scalar;
    if (t.isVector()) return "vec" + std::to_string(t.rows) + "<" + scalar + ">";
    return "mat" + std::to_string(t.cols) + "x" + std::to_string(t.rows) + "<" + scalar + ">";
}

std::string WgslEmitter::expr(ExprId id) const {
    const Expr& e = p_.exprs_[id];
    switch (e.op) {
        case Op::Constant: {
            if (e.type == Type::boolean()) return e.immediate ? "true" : "false";
            if (e.type == Type::i32()) return std::to_string(static_cast<int32_t>(e.immediate)) + "i";
            if (e.type == Type::u32()) return std::to_string(static_cast<uint32_t>(e.immediate)) + "u";
            const float value = std::bit_cast<float>(static_cast<uint32_t>(e.immediate));
            if (!std::isfinite(value)) {
                errors_.push_back("TN_SHADER_PACKAGE_INVALID: constant e" + std::to_string(id) + " is not finite");
                return "0f";
            }
            char buffer[32];
            const auto end = std::to_chars(buffer, buffer + sizeof buffer, value).ptr;  // shortest round trip
            return std::string(buffer, end) + "f";
        }
        case Op::Uniform: return "u.f_" + p_.names_[e.immediate];
        case Op::Attribute: return "a_" + p_.names_[e.immediate];
        case Op::Builtin: return "b_" + p_.names_[e.immediate];
        case Op::LoadVar:
        case Op::LoadStorage:
        case Op::Sample: return "l" + std::to_string(id);
        case Op::Neg: return "(-" + expr(e.args[0]) + ")";
        case Op::Select:
            return "select(" + expr(e.args[2]) + ", " + expr(e.args[1]) + ", " + expr(e.args[0]) + ")";
        case Op::Swizzle: {
            std::string lanes;
            const unsigned n = static_cast<unsigned>(e.immediate >> 8);
            for (unsigned i = 0; i < n; ++i) lanes += "xyzw"[(e.immediate >> (i * 2)) & 3];
            return "(" + expr(e.args[0]) + ")." + lanes;
        }
        case Op::Construct:
        case Op::Call: {
            std::string out = e.op == Op::Call ? p_.names_[e.immediate] : type(e.type);
            out += "(";
            for (uint8_t i = 0; i < e.argc; ++i) {
                if (i) out += ", ";
                out += expr(e.args[i]);
            }
            return out + ")";
        }
        default: break;
    }
    if (const char* op = binaryOperator(e.op)) return "(" + expr(e.args[0]) + op + expr(e.args[1]) + ")";
    errors_.push_back("TN_SHADER_PACKAGE_INVALID: no WGSL for expression e" + std::to_string(id));
    return "0";
}

void WgslEmitter::block(uint32_t index, int depth, std::string& out) const {
    const std::string indent(static_cast<size_t>(depth) * 2, ' ');
    using Kind = Program::StmtKind;
    for (const Program::Stmt& s : p_.blocks_[index]) {
        switch (s.kind) {
            case Kind::Eval: {
                const Expr& e = p_.exprs_[s.b];
                if (e.op == Op::LoadVar) {
                    out += indent + "let l" + std::to_string(s.b) + " = v" + std::to_string(e.immediate) + ";\n";
                } else if (e.op == Op::LoadStorage) {
                    out += indent + "let l" + std::to_string(s.b) + " = s_" + p_.storage_[e.immediate].name + "[" +
                           expr(e.args[0]) + "];\n";
                }
                break;
            }
            case Kind::Assign:
                out += indent + "v" + std::to_string(s.a) + " = " + expr(s.b) + ";\n";
                break;
            case Kind::Store:
                out += indent + "s_" + p_.storage_[s.a].name + "[" + expr(s.b) + "] = " + expr(s.c) + ";\n";
                break;
            case Kind::Discard: out += indent + "discard;\n"; break;
            case Kind::Output: {
                const std::string& name = p_.names_[p_.outputs_[s.a].name];
                out += indent + "out." + (name == "position" || name == "color" ? name : "o_" + name) + " = " +
                       expr(s.b) + ";\n";
                break;
            }
            case Kind::If:
                out += indent + "if (" + expr(s.a) + ") {\n";
                block(s.body, depth + 1, out);
                if (s.otherwise) {
                    out += indent + "} else {\n";
                    block(s.otherwise, depth + 1, out);
                }
                out += indent + "}\n";
                break;
            case Kind::Loop: {
                const std::string v = "v" + std::to_string(s.b);
                out += indent + "for (var " + v + ": i32 = 0i; " + v + " < " + expr(s.a) + "; " + v + " = " + v +
                       " + 1i) {\n";
                block(s.body, depth + 1, out);
                out += indent + "}\n";
                break;
            }
        }
    }
}

WgslModule WgslEmitter::emit(const Program& program) {
    WgslEmitter e(program);
    WgslModule module;
    if (!program.ok()) {
        module.errors.push_back("TN_SHADER_PACKAGE_INVALID: the program has construction diagnostics");
        return module;
    }
    std::string& out = module.code;

    // Resources in first-use order: uniforms in one block at binding 0, then storage buffers.
    std::vector<ExprId> uniforms, attributes, builtins;
    for (ExprId id = 1; id < program.exprs_.size(); ++id) {
        const Op op = program.exprs_[id].op;
        if (op == Op::Uniform) uniforms.push_back(id);
        else if (op == Op::Attribute) attributes.push_back(id);
        else if (op == Op::Builtin) builtins.push_back(id);
    }
    uint32_t binding = 0;
    if (!uniforms.empty()) {
        out += "struct Uniforms {\n";
        for (ExprId id : uniforms) {
            out += "  f_" + program.names_[program.exprs_[id].immediate] + ": " + e.type(program.exprs_[id].type) + ",\n";
        }
        out += "}\n@group(0) @binding(" + std::to_string(binding++) + ") var<uniform> u: Uniforms;\n";
    }
    for (const auto& storage : program.storage_) {
        out += "@group(0) @binding(" + std::to_string(binding++) + ") var<storage, read_write> s_" + storage.name +
               ": array<" + e.type(storage.element) + ">;\n";
    }

    const Stage stage = program.stage_;
    const bool hasOutputs = stage != Stage::Compute;
    if (hasOutputs) {
        out += "struct Out {\n";
        uint32_t location = 0;
        for (const auto& slot : program.outputs_) {
            const std::string& name = program.names_[slot.name];
            if (name == "position") out += "  @builtin(position) position: vec4<f32>,\n";
            else if (name == "color") out += "  @location(0) color: vec4<f32>,\n";
            else out += "  @location(" + std::to_string(location++) + ") o_" + name + ": " + e.type(slot.type) + ",\n";
        }
        if (program.outputs_.empty()) {
            module.errors.push_back("TN_SHADER_PACKAGE_INVALID: a render stage writes no output");
        }
        out += "}\n";
    }

    out += stage == Stage::Compute ? "@compute @workgroup_size(64)\n" : stage == Stage::Vertex ? "@vertex\n" : "@fragment\n";
    out += "fn main(";
    bool first = true;
    uint32_t location = 0;
    for (ExprId id : attributes) {
        out += std::string(first ? "" : ", ") + "@location(" + std::to_string(location++) + ") a_" +
               program.names_[program.exprs_[id].immediate] + ": " + e.type(program.exprs_[id].type);
        first = false;
    }
    for (ExprId id : builtins) {
        const std::string& name = program.names_[program.exprs_[id].immediate];
        out += std::string(first ? "" : ", ") + "@builtin(" + wgslBuiltin(name) + ") b_" + name + ": " +
               e.type(program.exprs_[id].type);
        first = false;
    }
    out += hasOutputs ? ") -> Out {\n" : ") {\n";
    if (hasOutputs) out += "  var out: Out;\n";

    // Loop counters are declared by their for statement; every other variable at the top.
    std::set<uint32_t> loopVars;
    for (const auto& b : program.blocks_) {
        for (const auto& s : b) {
            if (s.kind == Program::StmtKind::Loop) loopVars.insert(s.b);
        }
    }
    for (uint32_t v = 0; v < program.vars_.size(); ++v) {
        if (!loopVars.count(v)) out += "  var v" + std::to_string(v) + ": " + e.type(program.vars_[v].type) + ";\n";
    }
    e.block(0, 1, out);
    if (hasOutputs) out += "  return out;\n";
    out += "}\n";
    module.errors.insert(module.errors.end(), e.errors_.begin(), e.errors_.end());
    return module;
}

}  // namespace tn::engine::shader
