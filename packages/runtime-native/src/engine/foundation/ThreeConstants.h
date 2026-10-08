#pragma once

// The scalar constants the minimal template imports from `three` (PRD-531), with three r185's exact
// values (three@0.185.1 src/constants.js). The JS-facing numbers and colour-space strings travel to
// a game unchanged, so an off-by-one here is a tone curve or a shadow filter that silently differs.

namespace tn::engine {

/** three's `ToneMapping` constants. `NoToneMapping` and `LinearToneMapping` are 0 and 1. */
inline constexpr int ACESFilmicToneMapping = 4;
inline constexpr int AgXToneMapping = 6;
inline constexpr int NeutralToneMapping = 7;

/** three's `ShadowMapType::PCFSoftShadowMap`; `PCFShadowMap` is 1, `VSMShadowMap` is 3. */
inline constexpr int PCFSoftShadowMap = 2;

/** three's colour spaces are strings: `NoColorSpace` is empty, `LinearSRGBColorSpace` is linear. */
inline constexpr const char* NoColorSpace = "";
inline constexpr const char* LinearSRGBColorSpace = "srgb-linear";

}  // namespace tn::engine
