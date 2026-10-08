// The built-in geometry generators, ported from three@0.185.1 src/geometries/*.js. Positions, normals
// and uvs are computed in binary64 and stored as float, exactly where three builds a plain array and
// hands it to a Float32Array.

#include "engine/scene/geometries.h"

#include "engine/foundation/math/ieee754.h"
#include "engine/scene/shape_utils.h"

#include <array>
#include <cfloat>
#include <optional>

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

// ---------------------------------------------------------------------------- LatheGeometry

std::shared_ptr<BufferGeometry> makeLatheGeometry(const std::vector<Vector2>& points, double segments,
                                                  double phiStart, double phiLength) {
    auto geometry = std::make_shared<BufferGeometry>();
    geometry->type = "LatheGeometry";
    std::string profile = "[";
    for (size_t j = 0; j < points.size(); ++j)
        profile += (j == 0 ? "{\"x\":" : ",{\"x\":") + num(points[j].x) + ",\"y\":" + num(points[j].y) + "}";
    geometry->parameters["points"] = profile + "]";
    geometry->parameters["segments"] = num(segments);
    geometry->parameters["phiStart"] = num(phiStart);
    geometry->parameters["phiLength"] = num(phiLength);

    segments = std::floor(segments);
    phiLength = std::clamp(phiLength, 0.0, kTwoPi);
    const double inverseSegments = 1.0 / segments;
    const size_t last = points.size() - 1;
    // Pre-compute the normals of the initial meridian.
    std::vector<double> initNormals;
    Vector3 normal;
    Vector3 curNormal;
    Vector3 prevNormal;
    for (size_t j = 0; j <= last; ++j) {
        if (j == last) {
            initNormals.insert(initNormals.end(), {prevNormal.x, prevNormal.y, prevNormal.z});
            continue;
        }
        const double dx = points[j + 1].x - points[j].x;
        const double dy = points[j + 1].y - points[j].y;
        normal.x = dy * 1.0;
        normal.y = -dx;
        normal.z = dy * 0.0;
        if (j == 0) {
            prevNormal = normal;
        } else {
            curNormal = normal;
            normal.x += prevNormal.x;
            normal.y += prevNormal.y;
            normal.z += prevNormal.z;
            prevNormal = curNormal;
        }
        normal.normalize();
        initNormals.insert(initNormals.end(), {normal.x, normal.y, normal.z});
    }
    Builder builder;
    for (double i = 0; i <= segments; i += 1) {
        const double phi = phiStart + i * inverseSegments * phiLength;
        const double sin = ieee754::sin(phi);
        const double cos = ieee754::cos(phi);
        for (size_t j = 0; j <= last; ++j) {
            builder.positions.insert(builder.positions.end(), {points[j].x * sin, points[j].y, points[j].x * cos});
            builder.uvs.insert(builder.uvs.end(), {i / segments, static_cast<double>(j) / static_cast<double>(last)});
            builder.normals.insert(builder.normals.end(),
                                   {initNormals[3 * j] * sin, initNormals[3 * j + 1], initNormals[3 * j] * cos});
        }
    }
    const auto count = static_cast<uint32_t>(points.size());
    for (uint32_t i = 0; i < segments; ++i) {
        for (uint32_t j = 0; j < last; ++j) {
            const uint32_t base = j + i * count;
            const uint32_t a = base;
            const uint32_t b = base + count;
            const uint32_t c = base + count + 1;
            const uint32_t d = base + 1;
            builder.indices.insert(builder.indices.end(), {a, b, d, c, d, b});
        }
    }
    finish(*geometry, builder);
    return geometry;
}

// ---------------------------------------------------------------------------- TubeGeometry

std::shared_ptr<BufferGeometry> makeTubeGeometry(const Curve& path, double tubularSegments, double radius,
                                                 double radialSegments, bool closed) {
    auto geometry = std::make_shared<BufferGeometry>();
    geometry->type = "TubeGeometry";
    // three's parameters hold the path object itself; with no JSON for it, `parameters` is refused
    // rather than answered without the path.
    const FrenetFrames frames = computeFrenetFrames(path, tubularSegments, closed);
    Builder builder;
    Vector3 normal;
    const auto segment = [&](double i) {
        const Vector3 P = path.getPointAt(i / tubularSegments);
        const Vector3& N = frames.normals[static_cast<size_t>(i)];
        const Vector3& B = frames.binormals[static_cast<size_t>(i)];
        for (double j = 0; j <= radialSegments; j += 1) {
            const double v = j / radialSegments * kPi * 2;
            const double sin = ieee754::sin(v);
            const double cos = -ieee754::cos(v);
            normal.x = cos * N.x + sin * B.x;
            normal.y = cos * N.y + sin * B.y;
            normal.z = cos * N.z + sin * B.z;
            normal.normalize();
            builder.normals.insert(builder.normals.end(), {normal.x, normal.y, normal.z});
            builder.positions.insert(builder.positions.end(),
                                     {P.x + radius * normal.x, P.y + radius * normal.y, P.z + radius * normal.z});
        }
    };
    for (double i = 0; i < tubularSegments; i += 1) segment(i);
    segment(closed ? 0 : tubularSegments);
    for (double i = 0; i <= tubularSegments; i += 1) {
        for (double j = 0; j <= radialSegments; j += 1) {
            builder.uvs.push_back(i / tubularSegments);
            builder.uvs.push_back(j / radialSegments);
        }
    }
    const auto ring = static_cast<uint32_t>(radialSegments) + 1;
    for (uint32_t j = 1; j <= tubularSegments; ++j) {
        for (uint32_t i = 1; i <= radialSegments; ++i) {
            const uint32_t a = ring * (j - 1) + (i - 1);
            const uint32_t b = ring * j + (i - 1);
            const uint32_t c = ring * j + i;
            const uint32_t d = ring * (j - 1) + i;
            builder.indices.insert(builder.indices.end(), {a, b, d, b, c, d});
        }
    }
    finish(*geometry, builder);
    return geometry;
}

// ---------------------------------------------------------------------------- ShapeGeometry

std::shared_ptr<BufferGeometry> makeShapeGeometry(const std::vector<std::shared_ptr<Shape>>& shapes, bool asArray,
                                                  double curveSegments) {
    auto geometry = std::make_shared<BufferGeometry>();
    geometry->type = "ShapeGeometry";
    // three's parameters hold the shape objects themselves, so `parameters` is refused.
    Builder builder;
    double groupStart = 0;
    double groupCount = 0;
    const auto addShape = [&](const Shape& shape) {
        const auto indexOffset = static_cast<uint32_t>(builder.positions.size() / 3);
        std::vector<Vector2> shapeVertices = shape.extractShape(curveSegments);
        std::vector<std::vector<Vector2>> shapeHoles = shape.extractHoles(curveSegments);
        if (!ShapeUtils::isClockWise(shapeVertices)) std::reverse(shapeVertices.begin(), shapeVertices.end());
        for (auto& hole : shapeHoles)
            if (ShapeUtils::isClockWise(hole)) std::reverse(hole.begin(), hole.end());
        const auto faces = ShapeUtils::triangulateShape(shapeVertices, shapeHoles);
        for (const auto& hole : shapeHoles) shapeVertices.insert(shapeVertices.end(), hole.begin(), hole.end());
        for (const Vector2& vertex : shapeVertices) {
            builder.positions.insert(builder.positions.end(), {vertex.x, vertex.y, 0});
            builder.normals.insert(builder.normals.end(), {0, 0, 1});
            builder.uvs.insert(builder.uvs.end(), {vertex.x, vertex.y});
        }
        for (const auto& face : faces) {
            builder.indices.insert(builder.indices.end(), {face[0] + indexOffset, face[1] + indexOffset, face[2] + indexOffset});
            groupCount += 3;
        }
    };
    if (!asArray) {
        addShape(*shapes.at(0));
    } else {
        for (size_t i = 0; i < shapes.size(); ++i) {
            addShape(*shapes[i]);
            geometry->addGroup(groupStart, groupCount, static_cast<double>(i));
            groupStart += groupCount;
            groupCount = 0;
        }
    }
    finish(*geometry, builder);
    return geometry;
}

// -------------------------------------------------------------------------- ExtrudeGeometry

namespace {

/** three's ExtrudeGeometry mergeOverlappingPoints: drops points within a scaled 1e-10 of the last. */
void mergeOverlappingPoints(std::vector<Vector2>& points) {
    constexpr double THRESHOLD = 1e-10;
    constexpr double THRESHOLD_SQ = THRESHOLD * THRESHOLD;
    if (points.empty()) return;
    Vector2 prevPos = points[0];
    for (size_t i = 1; i <= points.size(); ++i) {
        const size_t currentIndex = i % points.size();
        const Vector2 currentPos = points[currentIndex];
        const double dx = currentPos.x - prevPos.x;
        const double dy = currentPos.y - prevPos.y;
        const double distSq = dx * dx + dy * dy;
        const double scalingFactorSqrt = std::max({std::abs(currentPos.x), std::abs(currentPos.y), std::abs(prevPos.x),
                                                   std::abs(prevPos.y)});
        const double thresholdSqScaled = THRESHOLD_SQ * scalingFactorSqrt * scalingFactorSqrt;
        if (distSq <= thresholdSqScaled) {
            points.erase(points.begin() + static_cast<std::ptrdiff_t>(currentIndex));
            --i;
            if (points.empty()) return;
            continue;
        }
        prevPos = currentPos;
    }
}

double jsSign(double v) { return std::isnan(v) ? v : v > 0 ? 1 : v < 0 ? -1 : v; }

Vector2 getBevelVec(const Vector2& inPt, const Vector2& inPrev, const Vector2& inNext) {
    double v_trans_x, v_trans_y, shrink_by;
    const double v_prev_x = inPt.x - inPrev.x, v_prev_y = inPt.y - inPrev.y;
    const double v_next_x = inNext.x - inPt.x, v_next_y = inNext.y - inPt.y;
    const double v_prev_lensq = v_prev_x * v_prev_x + v_prev_y * v_prev_y;
    const double collinear0 = v_prev_x * v_next_y - v_prev_y * v_next_x;
    if (std::abs(collinear0) > DBL_EPSILON) {
        const double v_prev_len = std::sqrt(v_prev_lensq);
        const double v_next_len = std::sqrt(v_next_x * v_next_x + v_next_y * v_next_y);
        const double ptPrevShift_x = inPrev.x - v_prev_y / v_prev_len;
        const double ptPrevShift_y = inPrev.y + v_prev_x / v_prev_len;
        const double ptNextShift_x = inNext.x - v_next_y / v_next_len;
        const double ptNextShift_y = inNext.y + v_next_x / v_next_len;
        const double sf = ((ptNextShift_x - ptPrevShift_x) * v_next_y - (ptNextShift_y - ptPrevShift_y) * v_next_x) /
                          (v_prev_x * v_next_y - v_prev_y * v_next_x);
        v_trans_x = ptPrevShift_x + v_prev_x * sf - inPt.x;
        v_trans_y = ptPrevShift_y + v_prev_y * sf - inPt.y;
        const double v_trans_lensq = v_trans_x * v_trans_x + v_trans_y * v_trans_y;
        if (v_trans_lensq <= 2) return {v_trans_x, v_trans_y};
        shrink_by = std::sqrt(v_trans_lensq / 2);
    } else {
        bool direction_eq = false;
        if (v_prev_x > DBL_EPSILON) {
            if (v_next_x > DBL_EPSILON) direction_eq = true;
        } else if (v_prev_x < -DBL_EPSILON) {
            if (v_next_x < -DBL_EPSILON) direction_eq = true;
        } else if (jsSign(v_prev_y) == jsSign(v_next_y)) {
            direction_eq = true;
        }
        if (direction_eq) {
            v_trans_x = -v_prev_y;
            v_trans_y = v_prev_x;
            shrink_by = std::sqrt(v_prev_lensq);
        } else {
            v_trans_x = v_prev_x;
            v_trans_y = v_prev_y;
            shrink_by = std::sqrt(v_prev_lensq / 2);
        }
    }
    return {v_trans_x / shrink_by, v_trans_y / shrink_by};
}

Vector2 scalePt2(const Vector2& pt, const Vector2& vec, double size) {
    Vector2 out = pt;
    out.addScaledVector(vec, size);
    return out;
}

std::vector<Vector2> bevelMovements(const std::vector<Vector2>& contour) {
    std::vector<Vector2> movements(contour.size());
    for (size_t i = 0, il = contour.size(), j = il - 1, k = i + 1; i < il; ++i, ++j, ++k) {
        if (j == il) j = 0;
        if (k == il) k = 0;
        movements[i] = getBevelVec(contour[i], contour[j], contour[k]);
    }
    return movements;
}

}  // namespace

std::shared_ptr<BufferGeometry> makeExtrudeGeometry(const std::vector<std::shared_ptr<Shape>>& shapes,
                                                    const ExtrudeOptions& options) {
    auto geometry = std::make_shared<BufferGeometry>();
    geometry->type = "ExtrudeGeometry";
    // three's parameters hold the shape objects and the options object, so `parameters` is refused.
    std::vector<double> verticesArray;
    std::vector<double> uvArray;
    const auto addShape = [&](const Shape& shape) {
        std::vector<double> placeholder;
        const double curveSegments = options.curveSegments.value_or(12);
        const double steps = options.steps.value_or(1);
        const double depth = options.depth.value_or(1);
        const bool bevelEnabled = options.bevelEnabled.value_or(true);
        double bevelThickness = options.bevelThickness.value_or(0.2);
        double bevelSize = options.bevelSize.value_or(bevelThickness - 0.1);
        double bevelOffset = options.bevelOffset.value_or(0);
        double bevelSegments = options.bevelSegments.value_or(3);
        if (!bevelEnabled) {
            bevelSegments = 0;
            bevelThickness = 0;
            bevelSize = 0;
            bevelOffset = 0;
        }
        std::vector<Vector2> vertices = shape.extractShape(curveSegments);
        std::vector<std::vector<Vector2>> holes = shape.extractHoles(curveSegments);
        if (!ShapeUtils::isClockWise(vertices)) {
            std::reverse(vertices.begin(), vertices.end());
            for (auto& hole : holes)
                if (ShapeUtils::isClockWise(hole)) std::reverse(hole.begin(), hole.end());
        }
        mergeOverlappingPoints(vertices);
        for (auto& hole : holes) mergeOverlappingPoints(hole);
        // `contour` is the outline itself; `vertices` becomes a copy with the holes appended.
        std::vector<Vector2> contour = vertices;
        for (const auto& hole : holes) vertices.insert(vertices.end(), hole.begin(), hole.end());
        const size_t vlen = vertices.size();
        const auto v = [&](double x, double y, double z) { placeholder.insert(placeholder.end(), {x, y, z}); };

        const std::vector<Vector2> contourMovements = bevelMovements(contour);
        std::vector<std::vector<Vector2>> holesMovements;
        std::vector<Vector2> verticesMovements = contourMovements;
        for (const auto& hole : holes) {
            holesMovements.push_back(bevelMovements(hole));
            verticesMovements.insert(verticesMovements.end(), holesMovements.back().begin(), holesMovements.back().end());
        }
        std::vector<std::array<uint32_t, 3>> faces;
        if (bevelSegments == 0) {
            faces = ShapeUtils::triangulateShape(contour, holes);
        } else {
            std::vector<Vector2> contractedContourVertices;
            std::vector<std::vector<Vector2>> expandedHoleVertices;
            for (double b = 0; b < bevelSegments; b += 1) {
                const double t = b / bevelSegments;
                const double z = bevelThickness * ieee754::cos(t * kPi / 2);
                const double bs = bevelSize * ieee754::sin(t * kPi / 2) + bevelOffset;
                for (size_t i = 0; i < contour.size(); ++i) {
                    const Vector2 vert = scalePt2(contour[i], contourMovements[i], bs);
                    v(vert.x, vert.y, -z);
                    if (t == 0) contractedContourVertices.push_back(vert);
                }
                for (size_t h = 0; h < holes.size(); ++h) {
                    std::vector<Vector2> oneHoleVertices;
                    for (size_t i = 0; i < holes[h].size(); ++i) {
                        const Vector2 vert = scalePt2(holes[h][i], holesMovements[h][i], bs);
                        v(vert.x, vert.y, -z);
                        if (t == 0) oneHoleVertices.push_back(vert);
                    }
                    if (t == 0) expandedHoleVertices.push_back(std::move(oneHoleVertices));
                }
            }
            faces = ShapeUtils::triangulateShape(contractedContourVertices, expandedHoleVertices);
        }
        const double bs = bevelSize + bevelOffset;
        for (size_t i = 0; i < vlen; ++i) {
            const Vector2 vert = bevelEnabled ? scalePt2(vertices[i], verticesMovements[i], bs) : vertices[i];
            v(vert.x, vert.y, 0);
        }
        for (double s = 1; s <= steps; s += 1) {
            for (size_t i = 0; i < vlen; ++i) {
                const Vector2 vert = bevelEnabled ? scalePt2(vertices[i], verticesMovements[i], bs) : vertices[i];
                v(vert.x, vert.y, depth / steps * s);
            }
        }
        for (double b = bevelSegments - 1; b >= 0; b -= 1) {
            const double t = b / bevelSegments;
            const double z = bevelThickness * ieee754::cos(t * kPi / 2);
            const double bs2 = bevelSize * ieee754::sin(t * kPi / 2) + bevelOffset;
            for (size_t i = 0; i < contour.size(); ++i) {
                const Vector2 vert = scalePt2(contour[i], contourMovements[i], bs2);
                v(vert.x, vert.y, depth + z);
            }
            for (size_t h = 0; h < holes.size(); ++h)
                for (size_t i = 0; i < holes[h].size(); ++i) {
                    const Vector2 vert = scalePt2(holes[h][i], holesMovements[h][i], bs2);
                    v(vert.x, vert.y, depth + z);
                }
        }

        const auto addVertex = [&](double index) {
            const auto at = static_cast<size_t>(index) * 3;
            verticesArray.insert(verticesArray.end(), {placeholder[at], placeholder[at + 1], placeholder[at + 2]});
        };
        const auto f3 = [&](double a, double b, double c) {
            addVertex(a);
            addVertex(b);
            addVertex(c);
            // WorldUVGenerator.generateTopUV: each vertex's x and y.
            const size_t next = verticesArray.size() / 3;
            for (size_t k = next - 3; k < next; ++k) uvArray.insert(uvArray.end(), {verticesArray[k * 3], verticesArray[k * 3 + 1]});
        };
        const auto f4 = [&](double a, double b, double c, double d) {
            addVertex(a);
            addVertex(b);
            addVertex(d);
            addVertex(b);
            addVertex(c);
            addVertex(d);
            // WorldUVGenerator.generateSideWallUV over the indexes three hands it: A, B, C, D.
            const size_t next = verticesArray.size() / 3;
            const size_t index[4] = {next - 6, next - 3, next - 2, next - 1};
            const auto at = [&](size_t i, int c) { return verticesArray[index[i] * 3 + c]; };
            const bool alongX = std::abs(at(0, 1) - at(1, 1)) < std::abs(at(0, 0) - at(1, 0));
            const auto uv = [&](size_t i) { return Vector2(alongX ? at(i, 0) : at(i, 1), 1 - at(i, 2)); };
            for (size_t i : {0, 1, 3, 1, 2, 3}) {
                const Vector2 p = uv(i);
                uvArray.insert(uvArray.end(), {p.x, p.y});
            }
        };
        const auto fv = static_cast<double>(vlen);
        // buildLidFaces
        double start = static_cast<double>(verticesArray.size() / 3);
        if (bevelEnabled) {
            double offset = 0;
            for (const auto& face : faces) f3(face[2] + offset, face[1] + offset, face[0] + offset);
            offset = fv * (steps + bevelSegments * 2);
            for (const auto& face : faces) f3(face[0] + offset, face[1] + offset, face[2] + offset);
        } else {
            for (const auto& face : faces) f3(face[2], face[1], face[0]);
            for (const auto& face : faces) f3(face[0] + fv * steps, face[1] + fv * steps, face[2] + fv * steps);
        }
        geometry->addGroup(start, static_cast<double>(verticesArray.size() / 3) - start, 0);
        // buildSideFaces
        start = static_cast<double>(verticesArray.size() / 3);
        const auto sidewalls = [&](const std::vector<Vector2>& ring, double layeroffset) {
            const auto n = static_cast<long long>(ring.size());
            for (long long i = n - 1; i >= 0; --i) {
                const double j = static_cast<double>(i);
                const double k = static_cast<double>(i - 1 < 0 ? n - 1 : i - 1);
                for (double s = 0, sl = steps + bevelSegments * 2; s < sl; s += 1) {
                    const double slen1 = fv * s;
                    const double slen2 = fv * (s + 1);
                    f4(layeroffset + j + slen1, layeroffset + k + slen1, layeroffset + k + slen2, layeroffset + j + slen2);
                }
            }
        };
        double layeroffset = 0;
        sidewalls(contour, layeroffset);
        layeroffset += static_cast<double>(contour.size());
        for (const auto& hole : holes) {
            sidewalls(hole, layeroffset);
            layeroffset += static_cast<double>(hole.size());
        }
        geometry->addGroup(start, static_cast<double>(verticesArray.size() / 3) - start, 1);
    };
    for (const auto& shape : shapes) addShape(*shape);
    geometry->setAttribute("position", BufferAttribute::fromFloats(verticesArray, 3));
    geometry->setAttribute("uv", BufferAttribute::fromFloats(uvArray, 2));
    geometry->computeVertexNormals();
    return geometry;
}

}  // namespace tn::engine
