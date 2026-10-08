#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "engine/shader/ir.h"

namespace tn::engine::shader {

/** Emitted WGSL, or the reason a program cannot be emitted. */
struct WgslModule {
    std::string code;
    /**
     * Names `code`: emit() gives every text it produces a fresh non-zero id, and copies share it.
     * Whoever edits `code` afterwards sets this to 0, which means unnamed (keyed by its text).
     */
    uint64_t id = 0;
    std::string entryPoint = "main";
    std::vector<std::string> errors;
    bool ok() const { return errors.empty(); }
};

/**
 * IR → WGSL (PRD-511). Deterministic: names come from IR ids and fixed prefixes (u.f_ uniform
 * fields, a_ attributes, s_ storage, b_ builtins, v vars, l lets), so one program always emits
 * the same text and the text can key a pipeline cache. Pure expressions are emitted inline; ordered
 * reads become `let` at their statement, which is what keeps effects in program order.
 */
class WgslEmitter {
public:
    /** `group` is the bind group this stage's resources live in, so two stages never alias one. */
    static WgslModule emit(const Program& program, uint32_t group = 0);

private:
    explicit WgslEmitter(const Program& program) : p_(program) {}
    std::string type(const Type& t) const;
    std::string expr(ExprId id) const;
    void block(uint32_t index, int depth, std::string& out) const;

    const Program& p_;
    mutable std::vector<std::string> errors_;
};

}  // namespace tn::engine::shader
