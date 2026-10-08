#pragma once

// three's Curve and CatmullRomCurve3, ported from three@0.185.1 src/extras/core/Curve.js and
// src/extras/curves/CatmullRomCurve3.js. Only the 3D curve exists: Curve here answers Vector3s.
// ponytail: no 2D curves (Path, Shape, CubicBezierCurve) yet; add them with ShapeGeometry.

#include "engine/foundation/math/Vector.h"

#include <memory>
#include <string>
#include <vector>

namespace tn::engine {

struct FrenetFrames {
    std::vector<Vector3> tangents;
    std::vector<Vector3> normals;
    std::vector<Vector3> binormals;
};

class Curve {
public:
    virtual ~Curve() = default;
    [[nodiscard]] virtual Vector3 getPoint(double t) const = 0;
    [[nodiscard]] Vector3 getPointAt(double u) const;
    [[nodiscard]] std::vector<Vector3> getPoints(double divisions = 5) const;
    [[nodiscard]] std::vector<Vector3> getSpacedPoints(double divisions = 5) const;
    [[nodiscard]] double getLength() const;
    /** The cumulative arc lengths, cached as three caches them (same divisions, no needsUpdate). */
    [[nodiscard]] const std::vector<double>& getLengths(double divisions) const;
    [[nodiscard]] const std::vector<double>& getLengths() const { return getLengths(arcLengthDivisions); }
    void updateArcLengths();
    /** `distance` is three's optional target arc length; 0 (falsy in three) maps `u` instead. */
    [[nodiscard]] double getUtoTmapping(double u, double distance = 0) const;
    [[nodiscard]] Vector3 getTangent(double t) const;
    [[nodiscard]] Vector3 getTangentAt(double u) const;
    [[nodiscard]] FrenetFrames computeFrenetFrames(double segments, bool closed = false) const;

    std::string type = "Curve";
    double arcLengthDivisions = 200;
    mutable bool needsUpdate = false;

private:
    mutable std::vector<double> cacheArcLengths_;
};

class CatmullRomCurve3 final : public Curve {
public:
    /** The points are the caller's own Vector3s, shared as three keeps the array it is handed. */
    CatmullRomCurve3(std::vector<std::shared_ptr<Vector3>> points, bool closed, std::string curveType,
                     double tension);
    [[nodiscard]] Vector3 getPoint(double t) const override;

    std::vector<std::shared_ptr<Vector3>> points;
    bool closed = false;
    std::string curveType = "centripetal";
    double tension = 0.5;
};

}  // namespace tn::engine
