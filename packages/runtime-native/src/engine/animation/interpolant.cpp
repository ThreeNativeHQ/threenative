#include "engine/animation/interpolant.h"

#include <cmath>
#include <cstddef>
#include <limits>

#include "engine/foundation/math/ieee754.h"

namespace tn::engine::animation {

namespace {
constexpr double kUndefined = std::numeric_limits<double>::quiet_NaN();  // compares false, as undefined does
}

Interpolant::Interpolant(Interpolation kind, std::span<const float> times, std::span<const float> values,
                         std::size_t valueSize)
    : kind_(kind), times_(times), values_(values), valueSize_(valueSize), result_(valueSize, 0.0f) {}

// three's Interpolant.evaluate, label for label: `goto` stands for its labelled breaks. Invariant:
// t1 is pp[i1] and t0 is pp[i1 - 1], with an index outside the array reading as undefined.
std::span<const float> Interpolant::evaluate(double t) {
    const auto n = static_cast<std::ptrdiff_t>(times_.size());
    if (n == 0) return result_;  // a track refuses an empty time array before it creates an interpolant
    const auto pp = [&](std::ptrdiff_t i) { return i >= 0 && i < n ? static_cast<double>(times_[i]) : kUndefined; };
    const auto undefinedAt = [&](std::ptrdiff_t i) { return i < 0 || i >= n; };
    auto i1 = static_cast<std::ptrdiff_t>(cachedIndex_);
    double t1 = pp(i1), t0 = pp(i1 - 1);
    std::ptrdiff_t right = 0;

    if (!(t < t1)) {  // forward_scan
        for (const std::ptrdiff_t giveUpAt = i1 + 2;;) {
            if (undefinedAt(i1)) {
                if (t < t0) goto backward_scan;  // break forward_scan
                cachedIndex_ = static_cast<std::size_t>(n);
                return copySampleValue(static_cast<std::size_t>(n - 1));
            }
            if (i1 == giveUpAt) break;
            t0 = t1;
            t1 = pp(++i1);
            if (t < t1) goto seek_done;  // break seek
        }
        right = n;
        goto binary_search;  // break linear_scan
    }
backward_scan:
    if (!(t >= t0)) {
        const double t1global = pp(1);
        if (t < t1global) {
            i1 = 2;  // + 1, using the scan for the details
            t0 = t1global;
        }
        for (const std::ptrdiff_t giveUpAt = i1 - 2;;) {
            if (undefinedAt(i1 - 1)) {
                cachedIndex_ = 0;
                return copySampleValue(0);
            }
            if (i1 == giveUpAt) break;
            t1 = t0;
            t0 = pp(--i1 - 1);
            if (t >= t0) goto seek_done;  // break seek
        }
        right = i1;
        i1 = 0;
        goto binary_search;  // break linear_scan
    }
    goto interval_valid;  // break validate_interval

binary_search:
    while (i1 < right) {
        const std::ptrdiff_t mid = (i1 + right) >> 1;
        if (t < pp(mid)) right = mid;
        else i1 = mid + 1;
    }
    t1 = pp(i1);
    t0 = pp(i1 - 1);
    if (undefinedAt(i1 - 1)) {
        cachedIndex_ = 0;
        return copySampleValue(0);
    }
    if (undefinedAt(i1)) {
        cachedIndex_ = static_cast<std::size_t>(n);
        return copySampleValue(static_cast<std::size_t>(n - 1));
    }
seek_done:
    cachedIndex_ = static_cast<std::size_t>(i1);
    intervalChanged(static_cast<std::size_t>(i1), t0, t1);
interval_valid:
    return interpolate(static_cast<std::size_t>(i1), t0, t, t1);
}

std::span<const float> Interpolant::copySampleValue(std::size_t index) {
    const std::size_t offset = index * valueSize_;
    for (std::size_t i = 0; i != valueSize_; ++i) result_[i] = values_[offset + i];
    return result_;
}

// CubicInterpolant.intervalChanged_; the other interpolants keep no per-interval state.
void Interpolant::intervalChanged(std::size_t i1, double t0, double t1) {
    if (kind_ != Interpolation::Smooth) return;
    const auto n = static_cast<std::ptrdiff_t>(times_.size());
    const auto pp = [&](std::ptrdiff_t i) { return i >= 0 && i < n ? static_cast<double>(times_[i]) : kUndefined; };
    auto iPrev = static_cast<std::ptrdiff_t>(i1) - 2, iNext = static_cast<std::ptrdiff_t>(i1) + 1;
    double tPrev = pp(iPrev), tNext = pp(iNext);
    if (iPrev < 0) {
        switch (endingStart) {
            case Ending::ZeroSlope:
                iPrev = static_cast<std::ptrdiff_t>(i1);
                tPrev = 2 * t0 - t1;
                break;
            case Ending::WrapAround:
                iPrev = n - 2;
                tPrev = t0 + pp(iPrev) - pp(iPrev + 1);
                break;
            case Ending::ZeroCurvature:
                iPrev = static_cast<std::ptrdiff_t>(i1);
                tPrev = t1;
        }
    }
    if (iNext >= n) {
        switch (endingEnd) {
            case Ending::ZeroSlope:
                iNext = static_cast<std::ptrdiff_t>(i1);
                tNext = 2 * t1 - t0;
                break;
            case Ending::WrapAround:
                iNext = 1;
                tNext = t1 + pp(1) - pp(0);
                break;
            case Ending::ZeroCurvature:
                iNext = static_cast<std::ptrdiff_t>(i1) - 1;
                tNext = t0;
        }
    }
    const double halfDt = (t1 - t0) * 0.5;
    weightPrev_ = halfDt / (t0 - tPrev);
    weightNext_ = halfDt / (tNext - t1);
    offsetPrev_ = static_cast<std::size_t>(iPrev) * valueSize_;
    offsetNext_ = static_cast<std::size_t>(iNext) * valueSize_;
}

std::span<const float> Interpolant::interpolate(std::size_t i1, double t0, double t, double t1) {
    const std::size_t stride = valueSize_, o1 = i1 * stride, o0 = o1 - stride;
    const auto v = [&](std::size_t i) { return static_cast<double>(values_[i]); };
    switch (kind_) {
        case Interpolation::Discrete:
            return copySampleValue(i1 - 1);
        case Interpolation::Linear: {
            const double weight1 = (t - t0) / (t1 - t0), weight0 = 1 - weight1;
            for (std::size_t i = 0; i != stride; ++i)
                result_[i] = static_cast<float>(v(o0 + i) * weight0 + v(o1 + i) * weight1);
            return result_;
        }
        case Interpolation::Smooth: {
            const double wP = weightPrev_, wN = weightNext_;
            const double p = (t - t0) / (t1 - t0), pp = p * p, ppp = pp * p;
            const double sP = -wP * ppp + 2 * wP * pp - wP * p;
            const double s0 = (1 + wP) * ppp + (-1.5 - 2 * wP) * pp + (-0.5 + wP) * p + 1;
            const double s1 = (-1 - wN) * ppp + (1.5 + wN) * pp + 0.5 * p;
            const double sN = wN * ppp - wN * pp;
            for (std::size_t i = 0; i != stride; ++i)
                result_[i] = static_cast<float>(sP * v(offsetPrev_ + i) + s0 * v(o0 + i) + s1 * v(o1 + i) +
                                                sN * v(offsetNext_ + i));
            return result_;
        }
        case Interpolation::QuaternionLinear: {
            const double alpha = (t - t0) / (t1 - t0);
            for (std::size_t offset = o1, end = o1 + stride; offset != end; offset += 4) {
                // Quaternion.slerpFlat(result, 0, values, offset - stride, values, offset, alpha)
                double x0 = v(offset - stride), y0 = v(offset - stride + 1), z0 = v(offset - stride + 2),
                       w0 = v(offset - stride + 3);
                double x1 = v(offset), y1 = v(offset + 1), z1 = v(offset + 2), w1 = v(offset + 3);
                double s = 0, at = alpha;
                if (w0 != w1 || x0 != x1 || y0 != y1 || z0 != z1) {
                    double dot = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;
                    if (dot < 0) {
                        x1 = -x1;
                        y1 = -y1;
                        z1 = -z1;
                        w1 = -w1;
                        dot = -dot;
                    }
                    s = 1 - at;
                    if (dot < 0.9995) {
                        const double theta = ieee754::acos(dot);
                        const double sin = ieee754::sin(theta);
                        s = ieee754::sin(s * theta) / sin;
                        at = ieee754::sin(at * theta) / sin;
                        x0 = x0 * s + x1 * at;
                        y0 = y0 * s + y1 * at;
                        z0 = z0 * s + z1 * at;
                        w0 = w0 * s + w1 * at;
                    } else {
                        x0 = x0 * s + x1 * at;
                        y0 = y0 * s + y1 * at;
                        z0 = z0 * s + z1 * at;
                        w0 = w0 * s + w1 * at;
                        const double f = 1 / std::sqrt(x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0);
                        x0 *= f;
                        y0 *= f;
                        z0 *= f;
                        w0 *= f;
                    }
                }
                // three passes dstOffset 0 on every pass, as a quaternion track's value is one quaternion.
                result_[0] = static_cast<float>(x0);
                result_[1] = static_cast<float>(y0);
                result_[2] = static_cast<float>(z0);
                result_[3] = static_cast<float>(w0);
            }
            return result_;
        }
    }
    return result_;
}

}  // namespace tn::engine::animation
