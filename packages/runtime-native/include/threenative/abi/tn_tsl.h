#pragma once
#include "threenative/abi/tn_abi.h"
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Runtime TSL graph construction. Node IDs belong to the context, are never reused, and are
 * released explicitly (or with the context). Unknown operations fail at build time with
 * TN_TSL_DYNAMIC_UNSUPPORTED; no script callback or source is evaluated. */
TN_EXPORT tn_status_t tn_tsl_build(tn_context_t *context, const char *operation,
                                   uint64_t a, uint64_t b, uint64_t c, double value,
                                   uint64_t *out_node, tn_diagnostic_t *diagnostic);
TN_EXPORT tn_status_t tn_tsl_release(tn_context_t *context, uint64_t node, tn_diagnostic_t *diagnostic);
TN_EXPORT tn_status_t tn_tsl_set(tn_context_t *context, tn_handle_t material, const char *path,
                                 uint64_t node, tn_diagnostic_t *diagnostic);
/* PRD-540: TSL authoring by name, over the table the V8 back end calls too (engine/abi/tsl_call.cpp).
 * One argument of a call: a node of this context, a number, a string, a named texture (`text` is its
 * name) or RGB components. Strings are NUL-terminated and borrowed for the call. */
#define TN_TSL_ARG_NODE 0u
#define TN_TSL_ARG_NUMBER 1u
#define TN_TSL_ARG_STRING 2u
#define TN_TSL_ARG_NAMED 3u
#define TN_TSL_ARG_RGB 4u
#define TN_TSL_ARG_VECTOR 5u /* `reserved` holds the lane count, 2 to 4 */
typedef struct tn_tsl_arg {
  uint32_t kind;
  uint32_t reserved;
  uint64_t node;
  double number;
  const char *text;
  double numbers[4]; /* RGB: r, g, b; VECTOR: the lanes */
} tn_tsl_arg_t;
/* Same offsets on wasm32 and 64-bit hosts: the pointer sits in an 8-byte slot. */
TN_STATIC_ASSERT(offsetof(tn_tsl_arg_t, node) == 8 && offsetof(tn_tsl_arg_t, number) == 16 &&
                     offsetof(tn_tsl_arg_t, text) == 24 && offsetof(tn_tsl_arg_t, numbers) == 32 &&
                     sizeof(tn_tsl_arg_t) == 64,
                 "tn_tsl_arg_t layout");
/* `name` as TSL names it (`uniform`, `mul`, `swizzle:xy`); `receiver` points at the node a method
 * is called on, or is null for a module function. The new node's id lands in `out_node`. A name the
 * table lacks fails with TN_TSL_DYNAMIC_UNSUPPORTED. */
TN_EXPORT tn_status_t tn_tsl_call(tn_context_t *context, const char *name, const uint64_t *receiver,
                                  const tn_tsl_arg_t *args, uint32_t arg_count, uint64_t *out_node,
                                  tn_diagnostic_t *diagnostic);
/* TSL's statement forms for a caller that runs the callbacks itself (Fn, If, Else, Loop, toVar,
 * assign). `tn_tsl_scope_begin` opens a callback's frame; `tn_tsl_scope_end` closes it, giving its
 * body, or `result` (nullable) when the callback added no statement. `tn_tsl_statement` takes
 * "toVar" (receiver), "assign" (receiver, value), "If" (condition, body), "Else" (receiver If,
 * body), "Loop.begin" (count), "Loop.index" (receiver loop) and "Loop.end" (receiver loop, body). */
TN_EXPORT tn_status_t tn_tsl_scope_begin(tn_context_t *context);
TN_EXPORT tn_status_t tn_tsl_scope_end(tn_context_t *context, const tn_tsl_arg_t *result, uint64_t *out_node,
                                       tn_diagnostic_t *diagnostic);
TN_EXPORT tn_status_t tn_tsl_statement(tn_context_t *context, const char *name, const uint64_t *receiver,
                                       const tn_tsl_arg_t *args, uint32_t arg_count, uint64_t *out_node,
                                       tn_diagnostic_t *diagnostic);
/* three's `uniform.value = x`: one finite value per lane of the uniform node's type. Every draw reads
 * the value afresh, so no program changes. */
TN_EXPORT tn_status_t tn_tsl_set_uniform(tn_context_t *context, const uint64_t *node, const double *values,
                                         uint32_t count, tn_diagnostic_t *diagnostic);
/* CPU compilation of the material's actual vertex/fragment graphs, optionally dumping WGSL. */
TN_EXPORT tn_status_t tn_tsl_compile(tn_handle_t material, const char *wgsl_path, tn_diagnostic_t *diagnostic);

#ifdef __cplusplus
}
#endif
