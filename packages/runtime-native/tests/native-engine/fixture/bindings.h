#pragma once

#include "driver.h"

namespace tn::fixture {

/** Every engine class the differential fixtures can reach; each work package adds its own. */
void registerBindings(Driver& driver);

}  // namespace tn::fixture
