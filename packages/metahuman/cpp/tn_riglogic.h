// Flat extern "C" ABI over OpenRigLogic (rl4), shared by the browser WASM module and
// the Linux native host. Both are compiled from this exact file so a value can never
// mean two things on two backends.
//
// Contract, fixed and not configurable:
//
//   CalculationType      Scalar          (no SIMD, no pthreads, portable)
//   FloatingPointType    Float
//   RotationType         Quaternions
//   TranslationType      Vector (3)
//   ScaleType            Vector (3)
//   Behaviour modules    joints, blend shapes, animated maps, ML, RBF, twist/swing
//
// Joint stride is therefore 10 floats per joint:
//
//   [0..2]  translation delta (x, y, z)
//   [3..6]  rotation    delta quaternion (x, y, z, w)
//   [7..9]  scale       delta (x, y, z)
//
// Everything RigLogic reports through the joint outputs is a DELTA from the neutral
// pose, not an absolute transform. tn_rl_neutral_joints() returns the matching
// neutral values in the same 10-float layout (scale slots default to 1.0). The
// consumer composes them; this ABI never does. The joint hierarchy from
// tn_rl_name(handle, TN_RL_KIND_JOINT, i) is the only parent information, so a
// consumer walking the chain owns the composition.
//
// A handle is an ID, never a pointer. IDs come from a monotonic counter and are never
// reused, so an id whose rig was destroyed can never resolve to the next rig even when
// the allocator hands back the same address. 0 is invalid. A stale or unknown id is
// rejected on every entry point with the last error set to "stale handle": a status
// returning call reports TN_RL_ERR_INVALID_HANDLE (tn_rl_count keeps its documented -1,
// which no real count is), a pointer returning call returns NULL, and tn_rl_destroy is a
// no-op.
//
// Not thread safe: one handle must be used from one thread at a time, and handle
// creation/destruction must be serialised by the caller (the browser module is
// single threaded; the native host evaluates on its own thread).

#ifndef TN_RIGLOGIC_H
#define TN_RIGLOGIC_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Opaque owned rig ID. One RigLogic plus one RigInstance per ID. 0 is always invalid. */
typedef uint32_t tn_rl_handle;

/** Selectors for tn_rl_count() and tn_rl_name(). */
enum {
    TN_RL_KIND_GUI = 0,
    TN_RL_KIND_RAW = 1,
    TN_RL_KIND_JOINT = 2,
    TN_RL_KIND_BLENDSHAPE = 3,
    TN_RL_KIND_ANIMATED_MAP = 4,
    TN_RL_KIND_LOD = 5
};

/** Status codes. TN_RL_OK (0) is the only success. */
enum {
    TN_RL_OK = 0,
    TN_RL_ERR_INVALID_ARGUMENT = -1,
    TN_RL_ERR_INVALID_HANDLE = -2,
    TN_RL_ERR_DNA_READ = -3,
    TN_RL_ERR_RIG_CREATE = -4,
    TN_RL_ERR_OUT_OF_RANGE = -5,
    TN_RL_ERR_COUNT_MISMATCH = -6,
    TN_RL_ERR_NON_FINITE = -7
};

/** Floats per joint in every joint buffer. */
#define TN_RL_JOINT_STRIDE 10

/**
 * Parse a DNA blob and create a rig.
 *
 * Returns the new non-zero handle, or 0 with the last error set. The bytes are copied, so
 * the caller keeps ownership of @p dna and may free it on return.
 */
tn_rl_handle tn_rl_create(const uint8_t* dna, uint32_t length);

/** Destroy a handle, retiring its ID forever. Passing 0 is a no-op. Safe to call once per successful create. */
void tn_rl_destroy(tn_rl_handle handle);

/**
 * Item count for a @p kind selector, or -1 with the last error set when the kind or
 * the handle is invalid. TN_RL_KIND_LOD reports the number of available LODs.
 */
int32_t tn_rl_count(tn_rl_handle handle, int32_t kind);

/**
 * Name at @p index for a @p kind selector, or NULL with the last error set on a bad
 * index, unknown kind or stale handle. The pointer is owned by the handle and stays
 * valid until tn_rl_destroy(). TN_RL_KIND_LOD has no names.
 */
const char* tn_rl_name(tn_rl_handle handle, int32_t kind, uint32_t index);

/** Select the LOD to evaluate. Rejects an index at or above tn_rl_count(LOD). */
int32_t tn_rl_set_lod(tn_rl_handle handle, uint32_t lod);

/**
 * Overwrite all GUI controls. @p count must equal tn_rl_count(TN_RL_KIND_GUI) and
 * every value must be finite.
 */
int32_t tn_rl_set_gui(tn_rl_handle handle, const float* values, uint32_t count);

/**
 * Overwrite all raw controls, bypassing the GUI to raw mapping. @p count must equal
 * tn_rl_count(TN_RL_KIND_RAW) and every value must be finite.
 */
int32_t tn_rl_set_raw(tn_rl_handle handle, const float* values, uint32_t count);

/**
 * Evaluate. With @p useGui non-zero the rig maps GUI controls to raw controls itself
 * (upstream mapGUIToRawControls) before calculating; otherwise the raw control buffer
 * is used exactly as set. Outputs are read back with the getters below.
 */
int32_t tn_rl_evaluate(tn_rl_handle handle, int32_t useGui);

/**
 * Last evaluated joint deltas, 10 floats per joint for the current LOD. @p countOut
 * receives the float count. The pointer is owned by the handle and is invalidated by
 * the next evaluate/set_lod/destroy.
 */
const float* tn_rl_joint_outputs(tn_rl_handle handle, uint32_t* countOut);

/** Last evaluated blend shape channel weights. Same ownership rules. */
const float* tn_rl_blendshape_outputs(tn_rl_handle handle, uint32_t* countOut);

/** Last evaluated animated map weights, clamped by RigLogic to [0, 1]. */
const float* tn_rl_animated_map_outputs(tn_rl_handle handle, uint32_t* countOut);

/** Neutral joint values, same 10-float stride, all LODs. Stable for the handle's life. */
const float* tn_rl_neutral_joints(tn_rl_handle handle, uint32_t* countOut);

/** Last error message, never NULL, empty after a success. Process wide, not per handle. */
const char* tn_rl_last_error(void);

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // TN_RIGLOGIC_H
