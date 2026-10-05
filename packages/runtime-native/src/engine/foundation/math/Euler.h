#pragma once

// Euler, ported from three@0.185.1 src/math/Euler.js. An order is an enum here rather than a
// string, so an unknown order is a compile error instead of a console warning at run time; the six
// orders and their branches are otherwise the reference's, including the `Math.abs(m13) < 0.9999999`
// gimbal-lock margin that decides which atan2 pair runs.
//
// Not ported: `_onChange` and its callback (only Object3D observes it, PRD-508), `fromArray`'s
// string order (the enum carries it), `toJSON`, and the `Symbol.iterator`.

#include <array>

namespace tn::engine {

class Matrix4;
class Quaternion;
class Vector3;

/** three's six Euler orders. `XYZ` is three's default order. */
enum class EulerOrder { XYZ, YXZ, ZXY, ZYX, YZX, XZY };

class Euler {
public:
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
    Euler& setFromRotationMatrix(const Matrix4& m, EulerOrder order = EulerOrder::XYZ);
    Euler& setFromQuaternion(const Quaternion& q, EulerOrder order = EulerOrder::XYZ);
    Euler& setFromVector3(const Vector3& v, EulerOrder order = EulerOrder::XYZ);
    Euler& reorder(EulerOrder newOrder);
    [[nodiscard]] bool equals(const Euler& euler) const;
    Euler& fromArray(const double* xyz);
    /** The three angles. three's fourth slot holds the order string, not a number. */
    [[nodiscard]] std::array<double, 3> toArray() const { return {x, y, z}; }
};

}  // namespace tn::engine
