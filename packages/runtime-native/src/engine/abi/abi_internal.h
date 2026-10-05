#pragma once

// Engine-internal access behind the C ABI, for in-process callers that own both sides (a host that
// hands a game's scene to the renderer). Not part of the C ABI: nothing outside this repository's
// own executables may include it.

#include "engine/abi/binding.h"
#include "threenative/abi/tn_abi.h"

namespace tn::abi {

/** The native object a live handle names (class name and shared ownership), or null. */
tn::binding::Object* objectOf(tn_handle_t handle);

/** Calls that crossed the C ABI (construct, invoke, get, set) since the process started. */
uint64_t crossings();

}  // namespace tn::abi
