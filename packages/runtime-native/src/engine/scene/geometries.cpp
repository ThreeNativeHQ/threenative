// The built-in geometry generators, ported from three@0.185.1 src/geometries/*.js. Positions, normals
// and uvs are computed in binary64 and stored as float, exactly where three builds a plain array and
// hands it to a Float32Array.

#include "engine/scene/geometries.h"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <numbers>
#include <string>
#include <vector>

namespace tn::engine {

namespace {

constexpr double kTwoPi = std::numbers::pi * 2;
constexpr double kPi = std::numbers::pi;

std::string num(double value) { return std::isfinite(value) ? jsNumber(value) : "null"; }  // as JSON.stringify

std::string boolean(bool value) { return value ? "true" : "false"; }

struct Builder {
    std::vector<double> positions;
    std::vector<double> normals;
    std::vector<double> uvs;
    std::vector<uint32_t> indices;
};

void finish(BufferGeometry& geometry, const Builder& builder) {
    geometry.setIndexFromArray(builder.indices);
    geometry.setAttribute("position", BufferAttribute::fromFloats(builder.positions, 3));
    geometry.setAttribute("normal", BufferAttribute::fromFloats(builder.normals, 3));
    geometry.setAttribute("uv", BufferAttribute::fromFloats(builder.uvs, 2));
}

}  // namespace

// --------------------------------------------------------------------------- PlaneGeometry

std::shared_ptr<BufferGeometry> makePlaneGeometry(double width, double height, double widthSegments,
                                                  double heightSegments) {
    auto geometry = std::make_shared<BufferGeometry>();
    geometry->type = "PlaneGeometry";
    geometry->parameters["width"] = num(width);
    geometry->parameters["height"] = num(height);
    geometry->parameters["widthSegments"] = num(widthSegments);
    geometry->parameters["heightSegments"] = num(heightSegments);

    const double widthHalf = width / 2;
    const double heightHalf = height / 2;
    const int gridX = static_cast<int>(std::floor(widthSegments));
    const int gridY = static_cast<int>(std::floor(heightSegments));
    const int gridX1 = gridX + 1;
    const int gridY1 = gridY + 1;
    const double segmentWidth = width / gridX;
    const double segmentHeight = height / gridY;

    Builder builder;
    for (int iy = 0; iy < gridY1; ++iy) {
        const double y = iy * segmentHeight - heightHalf;
        for (int ix = 0; ix < gridX1; ++ix) {
            const double x = ix * segmentWidth - widthHalf;
            builder.positions.push_back(x);
            builder.positions.push_back(-y);
            builder.positions.push_back(0);
            builder.normals.push_back(0);
            builder.normals.push_back(0);
            builder.normals.push_back(1);
            builder.uvs.push_back(static_cast<double>(ix) / gridX);
            builder.uvs.push_back(1 - static_cast<double>(iy) / gridY);
        }
    }
    for (int iy = 0; iy < gridY; ++iy) {
        for (int ix = 0; ix < gridX; ++ix) {
            const uint32_t a = ix + gridX1 * iy;
            const uint32_t b = ix + gridX1 * (iy + 1);
            const uint32_t c = (ix + 1) + gridX1 * (iy + 1);
            const uint32_t d = (ix + 1) + gridX1 * iy;
            builder.indices.push_back(a);
            builder.indices.push_back(b);
            builder.indices.push_back(d);
            builder.indices.push_back(b);
            builder.indices.push_back(c);
            builder.indices.push_back(d);
        }
    }
    finish(*geometry, builder);
    return geometry;
}

// ----------------------------------------------------------------------------- BoxGeometry

std::shared_ptr<BufferGeometry> makeBoxGeometry(double width, double height, double depth,
                                                double widthSegments, double heightSegments,
                                                double depthSegments) {
    auto geometry = std::make_shared<BufferGeometry>();
    geometry->type = "BoxGeometry";
    geometry->parameters["width"] = num(width);
    geometry->parameters["height"] = num(height);
    geometry->parameters["depth"] = num(depth);
    geometry->parameters["widthSegments"] = num(widthSegments);
    geometry->parameters["heightSegments"] = num(heightSegments);
    geometry->parameters["depthSegments"] = num(depthSegments);

    widthSegments = std::floor(widthSegments);
    heightSegments = std::floor(heightSegments);
    depthSegments = std::floor(depthSegments);

    Builder builder;
    uint32_t numberOfVertices = 0;
    uint32_t groupStart = 0;

    const auto buildPlane = [&](int u, int v, int w, double udir, double vdir, double planeWidth,
                                double planeHeight, double planeDepth, double gridX, double gridY,
                                int materialIndex) {
        const double segmentWidth = planeWidth / gridX;
        const double segmentHeight = planeHeight / gridY;
        const double widthHalf = planeWidth / 2;
        const double heightHalf = planeHeight / 2;
        const double depthHalf = planeDepth / 2;
        const int gridX1 = static_cast<int>(gridX) + 1;
        const int gridY1 = static_cast<int>(gridY) + 1;
        uint32_t vertexCounter = 0;
        uint32_t groupCount = 0;

        double vector[3] = {0, 0, 0};
        for (int iy = 0; iy < gridY1; ++iy) {
            const double y = iy * segmentHeight - heightHalf;
            for (int ix = 0; ix < gridX1; ++ix) {
                const double x = ix * segmentWidth - widthHalf;
                vector[u] = x * udir;
                vector[v] = y * vdir;
                vector[w] = depthHalf;
                builder.positions.push_back(vector[0]);
                builder.positions.push_back(vector[1]);
                builder.positions.push_back(vector[2]);

                vector[u] = 0;
                vector[v] = 0;
                vector[w] = planeDepth > 0 ? 1 : -1;
                builder.normals.push_back(vector[0]);
                builder.normals.push_back(vector[1]);
                builder.normals.push_back(vector[2]);

                builder.uvs.push_back(static_cast<double>(ix) / gridX);
                builder.uvs.push_back(1 - static_cast<double>(iy) / gridY);
                vertexCounter += 1;
            }
        }
        for (int iy = 0; iy < gridY; ++iy) {
            for (int ix = 0; ix < gridX; ++ix) {
                const uint32_t a = numberOfVertices + ix + gridX1 * iy;
                const uint32_t b = numberOfVertices + ix + gridX1 * (iy + 1);
                const uint32_t c = numberOfVertices + (ix + 1) + gridX1 * (iy + 1);
                const uint32_t d = numberOfVertices + (ix + 1) + gridX1 * iy;
                builder.indices.push_back(a);
                builder.indices.push_back(b);
                builder.indices.push_back(d);
                builder.indices.push_back(b);
                builder.indices.push_back(c);
                builder.indices.push_back(d);
                groupCount += 6;
            }
        }
        geometry->addGroup(groupStart, groupCount, materialIndex);
        groupStart += groupCount;
        numberOfVertices += vertexCounter;
    };

    buildPlane(2, 1, 0, -1, -1, depth, height, width, depthSegments, heightSegments, 0);   // px
    buildPlane(2, 1, 0, 1, -1, depth, height, -width, depthSegments, heightSegments, 1);   // nx
    buildPlane(0, 2, 1, 1, 1, width, depth, height, widthSegments, depthSegments, 2);      // py
    buildPlane(0, 2, 1, 1, -1, width, depth, -height, widthSegments, depthSegments, 3);    // ny
    buildPlane(0, 1, 2, 1, -1, width, height, depth, widthSegments, heightSegments, 4);    // pz
    buildPlane(0, 1, 2, -1, -1, width, height, -depth, widthSegments, heightSegments, 5);  // nz

    finish(*geometry, builder);
    return geometry;
}

// -------------------------------------------------------------------------- SphereGeometry

std::shared_ptr<BufferGeometry> makeSphereGeometry(double radius, double widthSegments,
                                                   double heightSegments, double phiStart,
                                                   double phiLength, double thetaStart,
                                                   double thetaLength) {
    auto geometry = std::make_shared<BufferGeometry>();
    geometry->type = "SphereGeometry";
    geometry->parameters["radius"] = num(radius);
    geometry->parameters["widthSegments"] = num(widthSegments);
    geometry->parameters["heightSegments"] = num(heightSegments);
    geometry->parameters["phiStart"] = num(phiStart);
    geometry->parameters["phiLength"] = num(phiLength);
    geometry->parameters["thetaStart"] = num(thetaStart);
    geometry->parameters["thetaLength"] = num(thetaLength);

    const int width = std::max(3, static_cast<int>(std::floor(widthSegments)));
    const int height = std::max(2, static_cast<int>(std::floor(heightSegments)));
    const double thetaEnd = std::min(thetaStart + thetaLength, kPi);

    Builder builder;
    uint32_t index = 0;
    std::vector<std::vector<uint32_t>> grid;
    for (int iy = 0; iy <= height; ++iy) {
        std::vector<uint32_t> row;
        const double v = static_cast<double>(iy) / height;
        const double theta = thetaStart + v * thetaLength;
        const double y = radius * std::cos(theta);
        const double ringRadius = std::sqrt(radius * radius - y * y);
        double uOffset = 0;
        if (iy == 0 && thetaStart == 0) {
            uOffset = 0.5 / width;
        } else if (iy == height && thetaEnd == kPi) {
            uOffset = -0.5 / width;
        }
        for (int ix = 0; ix <= width; ++ix) {
            const double u = static_cast<double>(ix) / width;
            const double phi = phiStart + u * phiLength;
            const Vector3 vertex(-ringRadius * std::cos(phi), y, ringRadius * std::sin(phi));
            builder.positions.push_back(vertex.x);
            builder.positions.push_back(vertex.y);
            builder.positions.push_back(vertex.z);
            Vector3 normal = vertex;
            normal.normalize();
            builder.normals.push_back(normal.x);
            builder.normals.push_back(normal.y);
            builder.normals.push_back(normal.z);
            builder.uvs.push_back(u + uOffset);
            builder.uvs.push_back(1 - v);
            row.push_back(index++);
        }
        grid.push_back(std::move(row));
    }
    for (int iy = 0; iy < height; ++iy) {
        for (int ix = 0; ix < width; ++ix) {
            const uint32_t a = grid[iy][ix + 1];
            const uint32_t b = grid[iy][ix];
            const uint32_t c = grid[iy + 1][ix];
            const uint32_t d = grid[iy + 1][ix + 1];
            if (iy != 0 || thetaStart > 0) {
                builder.indices.push_back(a);
                builder.indices.push_back(b);
                builder.indices.push_back(d);
            }
            if (iy != height - 1 || thetaEnd < kPi) {
                builder.indices.push_back(b);
                builder.indices.push_back(c);
                builder.indices.push_back(d);
            }
        }
    }
    finish(*geometry, builder);
    return geometry;
}

// ------------------------------------------------------------------------ CylinderGeometry

std::shared_ptr<BufferGeometry> makeCylinderGeometry(double radiusTop, double radiusBottom,
                                                     double height, double radialSegments,
                                                     double heightSegments, bool openEnded,
                                                     double thetaStart, double thetaLength) {
    auto geometry = std::make_shared<BufferGeometry>();
    geometry->type = "CylinderGeometry";
    geometry->parameters["radiusTop"] = num(radiusTop);
    geometry->parameters["radiusBottom"] = num(radiusBottom);
    geometry->parameters["height"] = num(height);
    geometry->parameters["radialSegments"] = num(radialSegments);
    geometry->parameters["heightSegments"] = num(heightSegments);
    geometry->parameters["openEnded"] = boolean(openEnded);
    geometry->parameters["thetaStart"] = num(thetaStart);
    geometry->parameters["thetaLength"] = num(thetaLength);

    const int radial = static_cast<int>(std::floor(radialSegments));
    const int rows = static_cast<int>(std::floor(heightSegments));
    const double halfHeight = height / 2;
    Builder builder;
    uint32_t index = 0;
    uint32_t groupStart = 0;

    const auto generateTorso = [&]() {
        uint32_t groupCount = 0;
        const double slope = (radiusBottom - radiusTop) / height;
        std::vector<std::vector<uint32_t>> indexArray;
        for (int y = 0; y <= rows; ++y) {
            std::vector<uint32_t> indexRow;
            const double v = static_cast<double>(y) / rows;
            const double radius = v * (radiusBottom - radiusTop) + radiusTop;
            for (int x = 0; x <= radial; ++x) {
                const double u = static_cast<double>(x) / radial;
                const double theta = u * thetaLength + thetaStart;
                const double sinTheta = std::sin(theta);
                const double cosTheta = std::cos(theta);
                builder.positions.push_back(radius * sinTheta);
                builder.positions.push_back(-v * height + halfHeight);
                builder.positions.push_back(radius * cosTheta);
                Vector3 normal(sinTheta, slope, cosTheta);
                normal.normalize();
                builder.normals.push_back(normal.x);
                builder.normals.push_back(normal.y);
                builder.normals.push_back(normal.z);
                builder.uvs.push_back(u);
                builder.uvs.push_back(1 - v);
                indexRow.push_back(index++);
            }
            indexArray.push_back(std::move(indexRow));
        }
        for (int x = 0; x < radial; ++x) {
            for (int y = 0; y < rows; ++y) {
                const uint32_t a = indexArray[y][x];
                const uint32_t b = indexArray[y + 1][x];
                const uint32_t c = indexArray[y + 1][x + 1];
                const uint32_t d = indexArray[y][x + 1];
                if (radiusTop > 0 || y != 0) {
                    builder.indices.push_back(a);
                    builder.indices.push_back(b);
                    builder.indices.push_back(d);
                    groupCount += 3;
                }
                if (radiusBottom > 0 || y != rows - 1) {
                    builder.indices.push_back(b);
                    builder.indices.push_back(c);
                    builder.indices.push_back(d);
                    groupCount += 3;
                }
            }
        }
        geometry->addGroup(groupStart, groupCount, 0);
        groupStart += groupCount;
    };

    const auto generateCap = [&](bool top) {
        const uint32_t centerIndexStart = index;
        uint32_t groupCount = 0;
        const double radius = top ? radiusTop : radiusBottom;
        const double sign = top ? 1 : -1;
        for (int x = 1; x <= radial; ++x) {
            builder.positions.push_back(0);
            builder.positions.push_back(halfHeight * sign);
            builder.positions.push_back(0);
            builder.normals.push_back(0);
            builder.normals.push_back(sign);
            builder.normals.push_back(0);
            builder.uvs.push_back(0.5);
            builder.uvs.push_back(0.5);
            index++;
        }
        const uint32_t centerIndexEnd = index;
        for (int x = 0; x <= radial; ++x) {
            const double u = static_cast<double>(x) / radial;
            const double theta = u * thetaLength + thetaStart;
            const double cosTheta = std::cos(theta);
            const double sinTheta = std::sin(theta);
            builder.positions.push_back(radius * sinTheta);
            builder.positions.push_back(halfHeight * sign);
            builder.positions.push_back(radius * cosTheta);
            builder.normals.push_back(0);
            builder.normals.push_back(sign);
            builder.normals.push_back(0);
            builder.uvs.push_back((cosTheta * 0.5) + 0.5);
            builder.uvs.push_back((sinTheta * 0.5 * sign) + 0.5);
            index++;
        }
        for (int x = 0; x < radial; ++x) {
            const uint32_t c = centerIndexStart + static_cast<uint32_t>(x);
            const uint32_t i = centerIndexEnd + static_cast<uint32_t>(x);
            if (top) {
                builder.indices.push_back(i);
                builder.indices.push_back(i + 1);
                builder.indices.push_back(c);
            } else {
                builder.indices.push_back(i + 1);
                builder.indices.push_back(i);
                builder.indices.push_back(c);
            }
            groupCount += 3;
        }
        geometry->addGroup(groupStart, groupCount, top ? 1 : 2);
        groupStart += groupCount;
    };

    generateTorso();
    if (!openEnded) {
        if (radiusTop > 0) generateCap(true);
        if (radiusBottom > 0) generateCap(false);
    }
    finish(*geometry, builder);
    return geometry;
}

// ---------------------------------------------------------------------------- ConeGeometry

std::shared_ptr<BufferGeometry> makeConeGeometry(double radius, double height, double radialSegments,
                                                 double heightSegments, bool openEnded,
                                                 double thetaStart, double thetaLength) {
    auto geometry = makeCylinderGeometry(0, radius, height, radialSegments, heightSegments, openEnded,
                                         thetaStart, thetaLength);
    geometry->type = "ConeGeometry";
    geometry->parameters.clear();
    geometry->parameters["radius"] = num(radius);
    geometry->parameters["height"] = num(height);
    geometry->parameters["radialSegments"] = num(radialSegments);
    geometry->parameters["heightSegments"] = num(heightSegments);
    geometry->parameters["openEnded"] = boolean(openEnded);
    geometry->parameters["thetaStart"] = num(thetaStart);
    geometry->parameters["thetaLength"] = num(thetaLength);
    return geometry;
}

// -------------------------------------------------------------------------- CircleGeometry

std::shared_ptr<BufferGeometry> makeCircleGeometry(double radius, double segments, double thetaStart,
                                                   double thetaLength) {
    auto geometry = std::make_shared<BufferGeometry>();
    geometry->type = "CircleGeometry";
    geometry->parameters["radius"] = num(radius);
    geometry->parameters["segments"] = num(segments);
    geometry->parameters["thetaStart"] = num(thetaStart);
    geometry->parameters["thetaLength"] = num(thetaLength);

    segments = std::max(3.0, segments);
    Builder builder;
    builder.positions.push_back(0);
    builder.positions.push_back(0);
    builder.positions.push_back(0);
    builder.normals.push_back(0);
    builder.normals.push_back(0);
    builder.normals.push_back(1);
    builder.uvs.push_back(0.5);
    builder.uvs.push_back(0.5);

    Vector3 vertex;
    for (double s = 0; s <= segments; s += 1) {
        const double segment = thetaStart + s / segments * thetaLength;
        vertex.x = radius * std::cos(segment);
        vertex.y = radius * std::sin(segment);
        builder.positions.push_back(vertex.x);
        builder.positions.push_back(vertex.y);
        builder.positions.push_back(vertex.z);
        builder.normals.push_back(0);
        builder.normals.push_back(0);
        builder.normals.push_back(1);
        builder.uvs.push_back((vertex.x / radius + 1) / 2);
        builder.uvs.push_back((vertex.y / radius + 1) / 2);
    }
    for (double i = 1; i <= segments; i += 1) {
        builder.indices.push_back(static_cast<uint32_t>(i));
        builder.indices.push_back(static_cast<uint32_t>(i + 1));
        builder.indices.push_back(0);
    }
    finish(*geometry, builder);
    return geometry;
}

// ---------------------------------------------------------------------------- TorusGeometry

std::shared_ptr<BufferGeometry> makeTorusGeometry(double radius, double tube, double radialSegments,
                                                  double tubularSegments, double arc, double thetaStart,
                                                  double thetaLength) {
    auto geometry = std::make_shared<BufferGeometry>();
    geometry->type = "TorusGeometry";
    geometry->parameters["radius"] = num(radius);
    geometry->parameters["tube"] = num(tube);
    geometry->parameters["radialSegments"] = num(radialSegments);
    geometry->parameters["tubularSegments"] = num(tubularSegments);
    geometry->parameters["arc"] = num(arc);
    geometry->parameters["thetaStart"] = num(thetaStart);
    geometry->parameters["thetaLength"] = num(thetaLength);

    const int radial = static_cast<int>(std::floor(radialSegments));
    const int tubular = static_cast<int>(std::floor(tubularSegments));
    Builder builder;
    for (int j = 0; j <= radial; ++j) {
        const double v = thetaStart + (static_cast<double>(j) / radial) * thetaLength;
        for (int i = 0; i <= tubular; ++i) {
            const double u = static_cast<double>(i) / tubular * arc;
            const Vector3 vertex((radius + tube * std::cos(v)) * std::cos(u),
                                 (radius + tube * std::cos(v)) * std::sin(u), tube * std::sin(v));
            builder.positions.push_back(vertex.x);
            builder.positions.push_back(vertex.y);
            builder.positions.push_back(vertex.z);
            const Vector3 center(radius * std::cos(u), radius * std::sin(u), 0);
            Vector3 normal;
            normal.subVectors(vertex, center);
            normal.normalize();
            builder.normals.push_back(normal.x);
            builder.normals.push_back(normal.y);
            builder.normals.push_back(normal.z);
            builder.uvs.push_back(static_cast<double>(i) / tubular);
            builder.uvs.push_back(static_cast<double>(j) / radial);
        }
    }
    for (int j = 1; j <= radial; ++j) {
        for (int i = 1; i <= tubular; ++i) {
            const uint32_t a = (tubular + 1) * j + i - 1;
            const uint32_t b = (tubular + 1) * (j - 1) + i - 1;
            const uint32_t c = (tubular + 1) * (j - 1) + i;
            const uint32_t d = (tubular + 1) * j + i;
            builder.indices.push_back(a);
            builder.indices.push_back(b);
            builder.indices.push_back(d);
            builder.indices.push_back(b);
            builder.indices.push_back(c);
            builder.indices.push_back(d);
        }
    }
    finish(*geometry, builder);
    return geometry;
}

// ----------------------------------------------------------------------------- RingGeometry

std::shared_ptr<BufferGeometry> makeRingGeometry(double innerRadius, double outerRadius,
                                                 double thetaSegments, double phiSegments,
                                                 double thetaStart, double thetaLength) {
    auto geometry = std::make_shared<BufferGeometry>();
    geometry->type = "RingGeometry";
    geometry->parameters["innerRadius"] = num(innerRadius);
    geometry->parameters["outerRadius"] = num(outerRadius);
    geometry->parameters["thetaSegments"] = num(thetaSegments);
    geometry->parameters["phiSegments"] = num(phiSegments);
    geometry->parameters["thetaStart"] = num(thetaStart);
    geometry->parameters["thetaLength"] = num(thetaLength);

    thetaSegments = std::max(3.0, thetaSegments);
    phiSegments = std::max(1.0, phiSegments);
    Builder builder;
    double radius = innerRadius;
    const double radiusStep = (outerRadius - innerRadius) / phiSegments;
    Vector3 vertex;
    for (double j = 0; j <= phiSegments; j += 1) {
        for (double i = 0; i <= thetaSegments; i += 1) {
            const double segment = thetaStart + i / thetaSegments * thetaLength;
            vertex.x = radius * std::cos(segment);
            vertex.y = radius * std::sin(segment);
            builder.positions.push_back(vertex.x);
            builder.positions.push_back(vertex.y);
            builder.positions.push_back(vertex.z);
            builder.normals.push_back(0);
            builder.normals.push_back(0);
            builder.normals.push_back(1);
            builder.uvs.push_back((vertex.x / outerRadius + 1) / 2);
            builder.uvs.push_back((vertex.y / outerRadius + 1) / 2);
        }
        radius += radiusStep;
    }
    for (double j = 0; j < phiSegments; j += 1) {
        const uint32_t thetaSegmentLevel = static_cast<uint32_t>(j * (thetaSegments + 1));
        for (double i = 0; i < thetaSegments; i += 1) {
            const uint32_t segment = static_cast<uint32_t>(i) + thetaSegmentLevel;
            const uint32_t a = segment;
            const uint32_t b = segment + static_cast<uint32_t>(thetaSegments) + 1;
            const uint32_t c = segment + static_cast<uint32_t>(thetaSegments) + 2;
            const uint32_t d = segment + 1;
            builder.indices.push_back(a);
            builder.indices.push_back(b);
            builder.indices.push_back(d);
            builder.indices.push_back(b);
            builder.indices.push_back(c);
            builder.indices.push_back(d);
        }
    }
    finish(*geometry, builder);
    return geometry;
}


// ----------------------------------------------------------------------- RoundedBoxGeometry
// three/addons/geometries/RoundedBoxGeometry.js: a unit box of 2 * segments + 1 segments per side,
// made non-indexed, whose every vertex is pushed onto the rounded shell, with the addon's own uvs.

namespace {

double jsSign(double x) { return x > 0 ? 1 : x < 0 ? -1 : x; }  // Math.sign: keeps -0 and NaN

/** Vector3.normalize: divideScalar(length() || 1). */
void normalize3(double v[3]) {
    const double length = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    const double d = length == 0 || std::isnan(length) ? 1 : length;
    for (int i = 0; i < 3; ++i) v[i] /= d;
}

/** The addon's getUv: the arc and flat spans of one face axis mapped to [0, 1]. */
double roundedUv(const double faceDir[3], const double normal[3], int uvAxis, int projectionAxis, double radius,
                 double sideLength) {
    const double totArcLength = 2 * kPi * radius / 4;
    const double centerLength = std::max(sideLength - 2 * radius, 0.0);
    const double halfArc = kPi / 4;
    double projected[3] = {normal[0], normal[1], normal[2]};
    projected[projectionAxis] = 0;
    normalize3(projected);
    const double arcUvRatio = 0.5 * totArcLength / (totArcLength + centerLength);
    // Vector3.angleTo: acos of the clamped cosine, PI / 2 for a zero vector.
    const double denominator = std::sqrt((projected[0] * projected[0] + projected[1] * projected[1] +
                                          projected[2] * projected[2]) *
                                         (faceDir[0] * faceDir[0] + faceDir[1] * faceDir[1] + faceDir[2] * faceDir[2]));
    const double angle = denominator == 0 ? kPi / 2
        : std::acos(std::clamp((projected[0] * faceDir[0] + projected[1] * faceDir[1] + projected[2] * faceDir[2]) /
                                   denominator, -1.0, 1.0));
    const double arcAngleRatio = 1.0 - angle / halfArc;
    if (jsSign(projected[uvAxis]) == 1) return arcAngleRatio * arcUvRatio;
    const double lenUv = centerLength / (totArcLength + centerLength);
    return lenUv + arcUvRatio + arcUvRatio * (1.0 - arcAngleRatio);
}

}  // namespace

std::shared_ptr<BufferGeometry> makeRoundedBoxGeometry(double width, double height, double depth, double segments,
                                                       double radius) {
    const double totalSegments = segments * 2 + 1;
    radius = std::isnan(width) || std::isnan(height) || std::isnan(depth) || std::isnan(radius)
        ? std::nan("") : std::min({width / 2, height / 2, depth / 2, radius});
    auto geometry = makeBoxGeometry(1, 1, 1, totalSegments, totalSegments, totalSegments);
    geometry->type = "RoundedBoxGeometry";
    geometry->parameters.clear();
    geometry->parameters["width"] = num(width);
    geometry->parameters["height"] = num(height);
    geometry->parameters["depth"] = num(depth);
    geometry->parameters["segments"] = num(segments);
    geometry->parameters["radius"] = num(radius);
    if (totalSegments == 1) return geometry;

    const auto flat = geometry->toNonIndexed();
    geometry->index = nullptr;
    for (const char* name : {"position", "normal", "uv"}) geometry->attributes[name] = flat->attributes.at(name);
    BufferAttribute& positions = *geometry->attributes.at("position");
    BufferAttribute& normals = *geometry->attributes.at("normal");
    BufferAttribute& uvs = *geometry->attributes.at("uv");

    const double box[3] = {width / 2 - radius, height / 2 - radius, depth / 2 - radius};
    const double length = static_cast<double>(positions.count() * 3);
    const double faceTris = length / 6;
    const double halfSegmentSize = 0.5 / totalSegments;
    for (uint64_t vertex = 0; vertex < positions.count(); ++vertex) {
        const double position[3] = {positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)};
        double normal[3] = {position[0], position[1], position[2]};
        for (double& n : normal) n -= jsSign(n) * halfSegmentSize;
        normalize3(normal);
        positions.setXYZ(vertex, box[0] * jsSign(position[0]) + normal[0] * radius,
                         box[1] * jsSign(position[1]) + normal[1] * radius,
                         box[2] * jsSign(position[2]) + normal[2] * radius);
        normals.setXYZ(vertex, normal[0], normal[1], normal[2]);
        const int side = static_cast<int>(std::floor(static_cast<double>(vertex * 3) / faceTris));
        constexpr int x = 0, y = 1, z = 2;
        double u = 0, v = 0;
        switch (side) {
            case 0: { const double dir[3] = {1, 0, 0};
                u = roundedUv(dir, normal, z, y, radius, depth); v = 1.0 - roundedUv(dir, normal, y, z, radius, height); break; }
            case 1: { const double dir[3] = {-1, 0, 0};
                u = 1.0 - roundedUv(dir, normal, z, y, radius, depth); v = 1.0 - roundedUv(dir, normal, y, z, radius, height); break; }
            case 2: { const double dir[3] = {0, 1, 0};
                u = 1.0 - roundedUv(dir, normal, x, z, radius, width); v = roundedUv(dir, normal, z, x, radius, depth); break; }
            case 3: { const double dir[3] = {0, -1, 0};
                u = 1.0 - roundedUv(dir, normal, x, z, radius, width); v = 1.0 - roundedUv(dir, normal, z, x, radius, depth); break; }
            case 4: { const double dir[3] = {0, 0, 1};
                u = 1.0 - roundedUv(dir, normal, x, y, radius, width); v = 1.0 - roundedUv(dir, normal, y, x, radius, height); break; }
            case 5: { const double dir[3] = {0, 0, -1};
                u = roundedUv(dir, normal, x, y, radius, width); v = 1.0 - roundedUv(dir, normal, y, x, radius, height); break; }
            default: continue;  // three leaves a vertex past the sixth face untouched
        }
        uvs.setXY(vertex, u, v);
    }
    return geometry;
}

}  // namespace tn::engine
