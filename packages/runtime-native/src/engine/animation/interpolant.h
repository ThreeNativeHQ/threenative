#pragma once

#include <cstddef>
#include <span>
#include <vector>

namespace tn::engine::animation {

/** three's interpolation modes a keyframe track creates its interpolant from. */
enum class Interpolation { Discrete, Linear, Smooth, QuaternionLinear };

/** three's cubic endings: ZeroCurvatureEnding, ZeroSlopeEnding, WrapAroundEnding. */
enum class Ending { ZeroCurvature, ZeroSlope, WrapAround };

/**
 * three's Interpolant with its four subclasses (PRD-516): the same interval search with its cached
 * index, the same double arithmetic and V8's own acos and sin, and a float32 result buffer like the
 * Float32Array a keyframe track's interpolant writes. Times and values are the track's float32
 * arrays, read as doubles; they must outlive the interpolant.
 */
class Interpolant {
public:
    Interpolant(Interpolation kind, std::span<const float> times, std::span<const float> values, std::size_t valueSize);

    /** The value at `t`, in the result buffer (three's `evaluate`). */
    std::span<const float> evaluate(double t);

    /** The cubic endings (three's `settings`); the defaults are three's DefaultSettings_. */
    Ending endingStart = Ending::ZeroCurvature;
    Ending endingEnd = Ending::ZeroCurvature;

private:
    std::span<const float> copySampleValue(std::size_t index);
    void intervalChanged(std::size_t i1, double t0, double t1);
    std::span<const float> interpolate(std::size_t i1, double t0, double t, double t1);

    Interpolation kind_;
    std::span<const float> times_;
    std::span<const float> values_;
    std::size_t valueSize_;
    std::vector<float> result_;
    std::size_t cachedIndex_ = 0;
    // CubicInterpolant's per-interval state, -0 until the first interval like three's.
    double weightPrev_ = -0.0, weightNext_ = -0.0;
    std::size_t offsetPrev_ = 0, offsetNext_ = 0;
};

}  // namespace tn::engine::animation
