// three's Curve and CatmullRomCurve3, ported from three@0.185.1. Transcendentals go through the
// engine's V8 fdlibm port, so every point matches the browser bit for bit.

#include "engine/scene/curves.h"

#include "engine/foundation/math/Matrix.h"
#include "engine/foundation/math/ieee754.h"

#include <algorithm>
#include <cfloat>
#include <cmath>
#include <utility>

namespace tn::engine {

Vector3 Curve::getPointAt(double u) const { return getPoint(getUtoTmapping(u)); }

std::vector<Vector3> Curve::getPoints(double divisions) const {
    std::vector<Vector3> points;
    for (double d = 0; d <= divisions; d += 1) points.push_back(getPoint(d / divisions));
    return points;
}

std::vector<Vector3> Curve::getSpacedPoints(double divisions) const {
    std::vector<Vector3> points;
    for (double d = 0; d <= divisions; d += 1) points.push_back(getPointAt(d / divisions));
    return points;
}

double Curve::getLength() const { return getLengths().back(); }

const std::vector<double>& Curve::getLengths(double divisions) const {
    if (!cacheArcLengths_.empty() && static_cast<double>(cacheArcLengths_.size()) == divisions + 1 && !needsUpdate)
        return cacheArcLengths_;
    needsUpdate = false;
    std::vector<double> cache{0};
    Vector3 last = getPoint(0);
    double sum = 0;
    for (double p = 1; p <= divisions; p += 1) {
        const Vector3 current = getPoint(p / divisions);
        sum += current.distanceTo(last);
        cache.push_back(sum);
        last = current;
    }
    cacheArcLengths_ = std::move(cache);
    return cacheArcLengths_;
}

void Curve::updateArcLengths() {
    needsUpdate = true;
    (void)getLengths();
}

double Curve::getUtoTmapping(double u, double distance) const {
    const std::vector<double>& arcLengths = getLengths();
    const auto il = static_cast<long long>(arcLengths.size());
    const double targetArcLength = distance != 0 && !std::isnan(distance) ? distance : u * arcLengths[il - 1];
    long long low = 0;
    long long high = il - 1;
    while (low <= high) {
        const long long i = low + (high - low) / 2;
        const double comparison = arcLengths[i] - targetArcLength;
        if (comparison < 0) {
            low = i + 1;
        } else if (comparison > 0) {
            high = i - 1;
        } else {
            high = i;
            break;
        }
    }
    const long long i = high;
    if (arcLengths[i] == targetArcLength) return static_cast<double>(i) / static_cast<double>(il - 1);
    const double lengthBefore = arcLengths[i];
    const double lengthAfter = arcLengths[i + 1];
    const double segmentFraction = (targetArcLength - lengthBefore) / (lengthAfter - lengthBefore);
    return (static_cast<double>(i) + segmentFraction) / static_cast<double>(il - 1);
}

Vector3 Curve::getTangent(double t) const {
    constexpr double delta = 0.0001;
    const double t1 = std::max(t - delta, 0.0);
    const double t2 = std::min(t + delta, 1.0);
    Vector3 tangent = getPoint(t2);
    tangent.sub(getPoint(t1)).normalize();
    return tangent;
}

Vector3 Curve::getTangentAt(double u) const { return getTangent(getUtoTmapping(u)); }

FrenetFrames Curve::computeFrenetFrames(double segments, bool closed) const {
    FrenetFrames frames;
    std::vector<Vector3>& tangents = frames.tangents;
    std::vector<Vector3>& normals = frames.normals;
    std::vector<Vector3>& binormals = frames.binormals;
    for (double i = 0; i <= segments; i += 1) tangents.push_back(getTangentAt(i / segments));
    normals.emplace_back();
    binormals.emplace_back();
    Vector3 normal;
    Vector3 vec;
    Matrix4 mat;
    double min = DBL_MAX;
    const double tx = std::abs(tangents[0].x);
    const double ty = std::abs(tangents[0].y);
    const double tz = std::abs(tangents[0].z);
    if (tx <= min) {
        min = tx;
        normal.set(1, 0, 0);
    }
    if (ty <= min) {
        min = ty;
        normal.set(0, 1, 0);
    }
    if (tz <= min) normal.set(0, 0, 1);
    vec.crossVectors(tangents[0], normal).normalize();
    normals[0].crossVectors(tangents[0], vec);
    binormals[0].crossVectors(tangents[0], normals[0]);
    for (size_t i = 1; i < tangents.size(); ++i) {
        normals.push_back(normals[i - 1]);
        binormals.push_back(binormals[i - 1]);
        vec.crossVectors(tangents[i - 1], tangents[i]);
        if (vec.length() > DBL_EPSILON) {
            vec.normalize();
            const double theta = ieee754::acos(std::clamp(tangents[i - 1].dot(tangents[i]), -1.0, 1.0));
            normals[i].applyMatrix4(mat.makeRotationAxis(vec, theta));
        }
        binormals[i].crossVectors(tangents[i], normals[i]);
    }
    if (closed) {
        const size_t last = tangents.size() - 1;
        double theta = ieee754::acos(std::clamp(normals[0].dot(normals[last]), -1.0, 1.0));
        theta /= segments;
        if (tangents[0].dot(vec.crossVectors(normals[0], normals[last])) > 0) theta = -theta;
        for (size_t i = 1; i <= last; ++i) {
            normals[i].applyMatrix4(mat.makeRotationAxis(tangents[i], theta * static_cast<double>(i)));
            binormals[i].crossVectors(tangents[i], normals[i]);
        }
    }
    return frames;
}

CatmullRomCurve3::CatmullRomCurve3(std::vector<std::shared_ptr<Vector3>> points, bool closed,
                                   std::string curveType, double tension)
    : points(std::move(points)), closed(closed), curveType(std::move(curveType)), tension(tension) {
    type = "CatmullRomCurve3";
}

namespace {

/** three's CubicPoly: c0 + c1 t + c2 t^2 + c3 t^3. */
struct CubicPoly {
    double c0 = 0, c1 = 0, c2 = 0, c3 = 0;
    void init(double x0, double x1, double t0, double t1) {
        c0 = x0;
        c1 = t0;
        c2 = -3 * x0 + 3 * x1 - 2 * t0 - t1;
        c3 = 2 * x0 - 2 * x1 + t0 + t1;
    }
    void initCatmullRom(double x0, double x1, double x2, double x3, double tension) {
        init(x1, x2, tension * (x2 - x0), tension * (x3 - x1));
    }
    void initNonuniformCatmullRom(double x0, double x1, double x2, double x3, double dt0, double dt1,
                                  double dt2) {
        double t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
        double t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
        t1 *= dt1;
        t2 *= dt1;
        init(x1, x2, t1, t2);
    }
    [[nodiscard]] double calc(double t) const {
        const double t2 = t * t;
        const double t3 = t2 * t;
        return c0 + c1 * t + c2 * t2 + c3 * t3;
    }
};

}  // namespace

Vector3 CatmullRomCurve3::getPoint(double t) const {
    const auto l = static_cast<double>(points.size());
    const double p = (l - (closed ? 0 : 1)) * t;
    double intPoint = std::floor(p);
    double weight = p - intPoint;
    if (closed) {
        intPoint += intPoint > 0 ? 0 : (std::floor(std::abs(intPoint) / l) + 1) * l;
    } else if (weight == 0 && intPoint == l - 1) {
        intPoint = l - 2;
        weight = 1;
    }
    const auto at = [&](double index) -> const Vector3& {
        return *points[static_cast<size_t>(std::fmod(index, l))];
    };
    Vector3 p0;
    Vector3 p3;
    if (closed || intPoint > 0) {
        p0 = at(intPoint - 1);
    } else {
        p0.subVectors(*points[0], *points[1]).add(*points[0]);
    }
    const Vector3& p1 = at(intPoint);
    const Vector3& p2 = at(intPoint + 1);
    if (closed || intPoint + 2 < l) {
        p3 = at(intPoint + 2);
    } else {
        p3.subVectors(*points[points.size() - 1], *points[points.size() - 2]).add(*points[points.size() - 1]);
    }
    CubicPoly px, py, pz;
    if (curveType == "centripetal" || curveType == "chordal") {
        const double pow = curveType == "chordal" ? 0.5 : 0.25;
        double dt0 = ieee754::pow(p0.distanceToSquared(p1), pow);
        double dt1 = ieee754::pow(p1.distanceToSquared(p2), pow);
        double dt2 = ieee754::pow(p2.distanceToSquared(p3), pow);
        if (dt1 < 1e-4) dt1 = 1.0;
        if (dt0 < 1e-4) dt0 = dt1;
        if (dt2 < 1e-4) dt2 = dt1;
        px.initNonuniformCatmullRom(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2);
        py.initNonuniformCatmullRom(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2);
        pz.initNonuniformCatmullRom(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2);
    } else if (curveType == "catmullrom") {
        px.initCatmullRom(p0.x, p1.x, p2.x, p3.x, tension);
        py.initCatmullRom(p0.y, p1.y, p2.y, p3.y, tension);
        pz.initCatmullRom(p0.z, p1.z, p2.z, p3.z, tension);
    }
    return {px.calc(weight), py.calc(weight), pz.calc(weight)};
}

}  // namespace tn::engine
