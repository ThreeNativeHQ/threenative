#include "bindings.h"

namespace tn::fixture {

// Empty until the first engine classes land (math, PRD-501; scene graph, PRD-508). Until then the
// driver answers `unsupported` for every class, so each fixture reports blocked, never pass.
void registerBindings(Driver&) {}

}  // namespace tn::fixture
