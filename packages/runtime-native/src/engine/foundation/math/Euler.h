#pragma once

// Euler, ported from three@0.185.1 src/math/Euler.js. An order is an enum here rather than a
// string, so an unknown order is a compile error instead of a console warning at run time; the six
// orders and their branches are otherwise the reference's, including the `Math.abs(m13) < 0.9999999`
// gimbal-lock margin that decides which atan2 pair runs.
//
// Not ported: `fromArray`'s string order (the enum carries it), `toJSON`, and the `Symbol.iterator`.
//
// Deviation: three keeps `_x` private and fires `_onChangeCallback` from the public `x`/`y`/`z`/
// `order` setters, so writing `euler.x` in JS notifies whoever registered a callback. Here the
// components are plain public doubles (the fixture protocol reads them by path), so the callback
// fires from the methods below and a direct component write is not observed. Object3D registers
// its callbacks and the scene fixtures drive rotation through methods, so both sides agree.

#include <array>

namespace tn::engine {

class Matrix4;
class Quaternion;
class Vector3;

/** three's six Euler orders. `XYZ` is three's default order. */
enum class EulerOrder { XYZ, YXZ, ZXY, ZYX, YZX, XZY };

class Euler {
public:
    /** three's `_onChangeCallback`: one function and its context, so an Euler costs no allocation. */
    using OnChange = void (*)(void* context);

    double x = 0;
    double y = 0;
    double z = 0;
    EulerOrder order = EulerOrder::XYZ;

    Euler() = default;
    Euler(double x, double y, double z, EulerOrder order = EulerOrder::XYZ)
        : x(x), y(y), z(z), order(order) {}

    Euler& set(double x, double y, double z, EulerOrder order = EulerOrder::XYZ);
    [[nodiscard]] Euler clone() const { return *this; }
    Euler& copy(const Euler& euler);
    /** `matrix` is read through its upper 3x3 only, and must be a pure rotation matrix. */
    Euler& setFromRotationMatrix(const Matrix4& m, EulerOrder order = EulerOrder::XYZ, bool update = true);
    /** `update` defaults false, because the reference's own `update` is undefined on this path. */
    Euler& setFromQuaternion(const Quaternion& q, EulerOrder order = EulerOrder::XYZ, bool update = false);
    Euler& setFromVector3(const Vector3& v, EulerOrder order = EulerOrder::XYZ);
    Euler& reorder(EulerOrder newOrder);
    /** Registers the change notification three's `_onChange` takes; a null callback clears it. */
    void onChange(OnChange callback, void* context) {
        onChange_ = callback;
        onChangeContext_ = context;
    }
    [[nodiscard]] bool equals(const Euler& euler) const;
    Euler& fromArray(const double* xyz);
    /** The three angles. three's fourth slot holds the order string, not a number. */
    [[nodiscard]] std::array<double, 3> toArray() const { return {x, y, z}; }

private:
    void notify() const {
        if (onChange_ != nullptr) onChange_(onChangeContext_);
    }

    OnChange onChange_ = nullptr;
    void* onChangeContext_ = nullptr;
};

}  // namespace tn::engine
