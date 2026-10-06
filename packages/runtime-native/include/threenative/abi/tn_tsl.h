#pragma once
#include "threenative/abi/tn_abi.h"
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
/* CPU compilation of the material's actual vertex/fragment graphs, optionally dumping WGSL. */
TN_EXPORT tn_status_t tn_tsl_compile(tn_handle_t material, const char *wgsl_path, tn_diagnostic_t *diagnostic);

#ifdef __cplusplus
}
#endif
