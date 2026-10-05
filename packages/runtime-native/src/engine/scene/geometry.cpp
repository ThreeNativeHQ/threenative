// BufferAttribute and BufferGeometry, ported from three@0.185.1 src/core/BufferAttribute.js and
// src/core/BufferGeometry.js. Every mutation keeps three's operation order; the array data lives in
// a BufferStore (PRD-504) so `needsUpdate` and `version` are the store's and the renderer uploads
// from it directly.

#include "engine/scene/geometry.h"

#include <algorithm>
#include <bit>
#include <charconv>
#include <cmath>
#include <cstring>
#include <limits>

namespace tn::engine {

namespace {

uint64_t nextAttributeId() {
    static uint64_t id = 0;
    return id++;
}

/** three's `arrayNeedsUint32`: the index buffer is Uint32 only when a value reaches 65535. */
bool arrayNeedsUint32(const std::vector<uint32_t>& values) {
    for (uint32_t value : values) {
        if (value >= 65535) return true;
    }
    return false;
}

/** JSON.stringify's number form for the values `parameters` and `groups` ever carry. */
std::string jsonNumber(double value) {
    if (std::isnan(value) || std::isinf(value)) return "null";
    char buffer[40];
    const auto result = std::to_chars(buffer, buffer + sizeof buffer, value);
    return std::string(buffer, result.ptr);
}

}  // namespace

// ------------------------------------------------------------------- BufferAttribute

BufferAttribute::BufferAttribute(Scalar scalar, uint64_t count, int itemSize, bool normalized)
    : store(std::make_shared<BufferStore>(scalar, count)),
      itemSize(itemSize),
      normalized(normalized),
      id(nextAttributeId()) {}

std::shared_ptr<BufferAttribute> BufferAttribute::fromDoubles(Scalar scalar,
                                                              const std::vector<double>& values,
                                                              int itemSize, bool normalized) {
    auto attribute = std::make_shared<BufferAttribute>(scalar, values.size(), itemSize, normalized);
    for (size_t i = 0; i < values.size(); ++i) attribute->setRaw(i, values[i]);
    return attribute;
}

std::shared_ptr<BufferAttribute> BufferAttribute::fromFloats(const std::vector<double>& values,
                                                             int itemSize, bool normalized) {
    return fromDoubles(Scalar::F32, values, itemSize, normalized);
}

std::shared_ptr<BufferAttribute> BufferAttribute::fromIndices(const std::vector<uint32_t>& values) {
    const Scalar scalar = arrayNeedsUint32(values) ? Scalar::U32 : Scalar::U16;
    auto attribute = std::make_shared<BufferAttribute>(scalar, values.size(), 1);
    for (size_t i = 0; i < values.size(); ++i) attribute->setRaw(i, static_cast<double>(values[i]));
    return attribute;
}

double BufferAttribute::raw(uint64_t elementIndex) const {
    const Scalar scalar = store->scalar();
    const uint64_t size = scalarSize(scalar);
    std::byte bytes[8];
    store->read(elementIndex * size, bytes, size);
    switch (scalar) {
        case Scalar::F32: {
            float value = 0;
            std::memcpy(&value, bytes, sizeof value);
            return static_cast<double>(value);
        }
        case Scalar::U16: {
            uint16_t value = 0;
            std::memcpy(&value, bytes, sizeof value);
            return static_cast<double>(value);
        }
        case Scalar::U32: {
            uint32_t value = 0;
            std::memcpy(&value, bytes, sizeof value);
            return static_cast<double>(value);
        }
        default: return 0;
    }
}

void BufferAttribute::setRaw(uint64_t elementIndex, double value) {
    const Scalar scalar = store->scalar();
    const uint64_t size = scalarSize(scalar);
    switch (scalar) {
        case Scalar::F32: {
            const float narrowed = static_cast<float>(value);
            store->write(elementIndex * size, &narrowed, size);
            return;
        }
        case Scalar::U16: {
            const uint16_t narrowed = static_cast<uint16_t>(value);
            store->write(elementIndex * size, &narrowed, size);
            return;
        }
        case Scalar::U32: {
            const uint32_t narrowed = static_cast<uint32_t>(value);
            store->write(elementIndex * size, &narrowed, size);
            return;
        }
        default: return;
    }
}

double BufferAttribute::denormalize(double value) const {
    if (!normalized) return value;
    switch (store->scalar()) {
        case Scalar::U16: return value / 65535.0;
        case Scalar::U32: return value / 4294967295.0;
        default: return value;  // Float32Array: three returns the value unchanged
    }
}

double BufferAttribute::normalize(double value) const {
    if (!normalized) return value;
    switch (store->scalar()) {
        case Scalar::U16: return jsRound(value * 65535.0);
        case Scalar::U32: return jsRound(value * 4294967295.0);
        default: return value;
    }
}

double BufferAttribute::getComponent(uint64_t index, int component) const {
    return denormalize(raw(index * static_cast<uint64_t>(itemSize) + static_cast<uint64_t>(component)));
}

BufferAttribute& BufferAttribute::setComponent(uint64_t index, int component, double value) {
    setRaw(index * static_cast<uint64_t>(itemSize) + static_cast<uint64_t>(component), normalize(value));
    return *this;
}

double BufferAttribute::getX(uint64_t index) const { return getComponent(index, 0); }
double BufferAttribute::getY(uint64_t index) const { return getComponent(index, 1); }
double BufferAttribute::getZ(uint64_t index) const { return getComponent(index, 2); }
double BufferAttribute::getW(uint64_t index) const { return getComponent(index, 3); }

BufferAttribute& BufferAttribute::setX(uint64_t index, double x) { return setComponent(index, 0, x); }
BufferAttribute& BufferAttribute::setY(uint64_t index, double y) { return setComponent(index, 1, y); }
BufferAttribute& BufferAttribute::setZ(uint64_t index, double z) { return setComponent(index, 2, z); }
BufferAttribute& BufferAttribute::setW(uint64_t index, double w) { return setComponent(index, 3, w); }

BufferAttribute& BufferAttribute::setXY(uint64_t index, double x, double y) {
    index *= static_cast<uint64_t>(itemSize);
    setRaw(index + 0, normalize(x));
    setRaw(index + 1, normalize(y));
    return *this;
}

BufferAttribute& BufferAttribute::setXYZ(uint64_t index, double x, double y, double z) {
    index *= static_cast<uint64_t>(itemSize);
    setRaw(index + 0, normalize(x));
    setRaw(index + 1, normalize(y));
    setRaw(index + 2, normalize(z));
    return *this;
}

BufferAttribute& BufferAttribute::setXYZW(uint64_t index, double x, double y, double z, double w) {
    index *= static_cast<uint64_t>(itemSize);
    setRaw(index + 0, normalize(x));
    setRaw(index + 1, normalize(y));
    setRaw(index + 2, normalize(z));
    setRaw(index + 3, normalize(w));
    return *this;
}

Vector3& BufferAttribute::getXYZ(uint64_t index, Vector3& target) const {
    target.x = getX(index);
    target.y = getY(index);
    target.z = getZ(index);
    return target;
}

BufferAttribute& BufferAttribute::copyAt(uint64_t index1, const BufferAttribute& attribute,
                                         uint64_t index2) {
    index1 *= static_cast<uint64_t>(itemSize);
    index2 *= static_cast<uint64_t>(attribute.itemSize);
    for (int i = 0; i < itemSize; ++i) setRaw(index1 + static_cast<uint64_t>(i), attribute.raw(index2 + i));
    return *this;
}

BufferAttribute& BufferAttribute::applyMatrix3(const Matrix3& m) {
    Vector3 vector;
    if (itemSize == 2) {
        for (uint64_t i = 0; i < count(); ++i) {
            Vector2 v2(getX(i), getY(i));
            v2.applyMatrix3(m);
            setXY(i, v2.x, v2.y);
        }
    } else if (itemSize == 3) {
        for (uint64_t i = 0; i < count(); ++i) {
            getXYZ(i, vector).applyMatrix3(m);
            setXYZ(i, vector.x, vector.y, vector.z);
        }
    }
    return *this;
}

BufferAttribute& BufferAttribute::applyMatrix4(const Matrix4& m) {
    Vector3 vector;
    for (uint64_t i = 0; i < count(); ++i) {
        getXYZ(i, vector).applyMatrix4(m);
        setXYZ(i, vector.x, vector.y, vector.z);
    }
    return *this;
}

BufferAttribute& BufferAttribute::applyNormalMatrix(const Matrix3& m) {
    Vector3 vector;
    for (uint64_t i = 0; i < count(); ++i) {
        getXYZ(i, vector).applyNormalMatrix(m);
        setXYZ(i, vector.x, vector.y, vector.z);
    }
    return *this;
}

BufferAttribute& BufferAttribute::transformDirection(const Matrix4& m) {
    Vector3 vector;
    for (uint64_t i = 0; i < count(); ++i) {
        getXYZ(i, vector).transformDirection(m);
        setXYZ(i, vector.x, vector.y, vector.z);
    }
    return *this;
}

std::vector<double> BufferAttribute::toNumbers() const {
    std::vector<double> values;
    values.reserve(store->count());
    for (uint64_t i = 0; i < store->count(); ++i) values.push_back(raw(i));
    return values;
}

// -------------------------------------------------------------------- BufferGeometry

uint64_t BufferGeometry::nextId() {
    static uint64_t id = 0;
    return id++;
}

void BufferGeometry::setIndex(const std::shared_ptr<BufferAttribute>& attribute) {
    index = attribute;
    bumpRevision();
}

void BufferGeometry::setIndexFromArray(const std::vector<uint32_t>& values) {
    setIndex(BufferAttribute::fromIndices(values));
}

void BufferGeometry::setAttribute(const std::string& name, std::shared_ptr<BufferAttribute> attribute) {
    attributes[name] = std::move(attribute);
    bumpRevision();
}

std::shared_ptr<BufferAttribute> BufferGeometry::getAttribute(const std::string& name) const {
    const auto it = attributes.find(name);
    return it == attributes.end() ? nullptr : it->second;
}

bool BufferGeometry::deleteAttribute(const std::string& name) {
    const bool erased = attributes.erase(name) > 0;
    if (erased) bumpRevision();
    return erased;
}

bool BufferGeometry::hasAttribute(const std::string& name) const {
    return attributes.find(name) != attributes.end();
}

void BufferGeometry::addGroup(uint32_t start, uint32_t count, int materialIndex) {
    groups.push_back(GeometryGroup{start, count, materialIndex});
    bumpRevision();
}

void BufferGeometry::clearGroups() {
    groups.clear();
    bumpRevision();
}

void BufferGeometry::setDrawRange(double start, double count) {
    drawRange.start = start;
    drawRange.count = count;
    bumpRevision();
}

void BufferGeometry::computeBoundingBox() {
    if (boundingBox == nullptr) boundingBox = std::make_shared<Box3>();
    boundingBox->makeEmpty();
    const std::shared_ptr<BufferAttribute> position = getAttribute("position");
    if (position == nullptr) return;
    Vector3 point;
    for (uint64_t i = 0; i < position->count(); ++i) {
        boundingBox->expandByPoint(position->getXYZ(i, point));
    }
}

void BufferGeometry::computeBoundingSphere() {
    if (boundingSphere == nullptr) boundingSphere = std::make_shared<Sphere>();
    const std::shared_ptr<BufferAttribute> position = getAttribute("position");
    if (position == nullptr) return;
    Vector3& center = boundingSphere->center;
    Box3 box;
    box.makeEmpty();
    Vector3 point;
    for (uint64_t i = 0; i < position->count(); ++i) box.expandByPoint(position->getXYZ(i, point));
    box.getCenter(center);
    double maxRadiusSq = 0;
    for (uint64_t i = 0; i < position->count(); ++i) {
        position->getXYZ(i, point);
        maxRadiusSq = std::max(maxRadiusSq, center.distanceToSquared(point));
    }
    boundingSphere->radius = std::sqrt(maxRadiusSq);
}

void BufferGeometry::computeVertexNormals() {
    const std::shared_ptr<BufferAttribute> position = getAttribute("position");
    if (position == nullptr) return;
    std::shared_ptr<BufferAttribute> normal = getAttribute("normal");
    if (normal == nullptr || normal->count() != position->count()) {
        normal = BufferAttribute::fromFloats(std::vector<double>(position->count() * 3, 0.0), 3);
        setAttribute("normal", normal);
    } else {
        for (uint64_t i = 0; i < normal->count(); ++i) normal->setXYZ(i, 0, 0, 0);
    }

    Vector3 pA, pB, pC, nA, nB, nC, cb, ab;
    if (index != nullptr) {
        for (uint64_t i = 0; i < index->count(); i += 3) {
            const uint64_t vA = static_cast<uint64_t>(index->getX(i + 0));
            const uint64_t vB = static_cast<uint64_t>(index->getX(i + 1));
            const uint64_t vC = static_cast<uint64_t>(index->getX(i + 2));
            position->getXYZ(vA, pA);
            position->getXYZ(vB, pB);
            position->getXYZ(vC, pC);
            cb.subVectors(pC, pB);
            ab.subVectors(pA, pB);
            cb.cross(ab);
            normal->getXYZ(vA, nA);
            normal->getXYZ(vB, nB);
            normal->getXYZ(vC, nC);
            nA.add(cb);
            nB.add(cb);
            nC.add(cb);
            normal->setXYZ(vA, nA.x, nA.y, nA.z);
            normal->setXYZ(vB, nB.x, nB.y, nB.z);
            normal->setXYZ(vC, nC.x, nC.y, nC.z);
        }
    } else {
        for (uint64_t i = 0; i < position->count(); i += 3) {
            position->getXYZ(i + 0, pA);
            position->getXYZ(i + 1, pB);
            position->getXYZ(i + 2, pC);
            cb.subVectors(pC, pB);
            ab.subVectors(pA, pB);
            cb.cross(ab);
            normal->setXYZ(i + 0, cb.x, cb.y, cb.z);
            normal->setXYZ(i + 1, cb.x, cb.y, cb.z);
            normal->setXYZ(i + 2, cb.x, cb.y, cb.z);
        }
    }
    normalizeNormals();
    normal->setNeedsUpdate();
}

void BufferGeometry::normalizeNormals() {
    std::shared_ptr<BufferAttribute> normals = getAttribute("normal");
    if (normals == nullptr) return;
    Vector3 vector;
    for (uint64_t i = 0; i < normals->count(); ++i) {
        normals->getXYZ(i, vector).normalize();
        normals->setXYZ(i, vector.x, vector.y, vector.z);
    }
}

std::shared_ptr<BufferGeometry> BufferGeometry::toNonIndexed() const {
    if (index == nullptr) return nullptr;
    auto geometry = std::make_shared<BufferGeometry>();
    const std::vector<double> indices = index->toNumbers();
    for (const auto& [name, attribute] : attributes) {
        std::vector<double> values(indices.size() * static_cast<size_t>(attribute->itemSize), 0.0);
        size_t out = 0;
        for (const double rawIndex : indices) {
            const uint64_t vertex = static_cast<uint64_t>(rawIndex);
            for (int j = 0; j < attribute->itemSize; ++j) values[out++] = attribute->getComponent(vertex, j);
        }
        geometry->setAttribute(name,
                               BufferAttribute::fromDoubles(attribute->store->scalar(), values,
                                                            attribute->itemSize, attribute->normalized));
    }
    for (const GeometryGroup& group : groups) {
        geometry->addGroup(group.start, group.count, group.materialIndex);
    }
    return geometry;
}

BufferGeometry& BufferGeometry::applyMatrix4(const Matrix4& matrix) {
    const std::shared_ptr<BufferAttribute> position = getAttribute("position");
    if (position != nullptr) {
        position->applyMatrix4(matrix);
        position->setNeedsUpdate();
    }
    const std::shared_ptr<BufferAttribute> normal = getAttribute("normal");
    if (normal != nullptr) {
        Matrix3 normalMatrix;
        normalMatrix.getNormalMatrix(matrix);
        normal->applyNormalMatrix(normalMatrix);
        normal->setNeedsUpdate();
    }
    const std::shared_ptr<BufferAttribute> tangent = getAttribute("tangent");
    if (tangent != nullptr) {
        tangent->transformDirection(matrix);
        tangent->setNeedsUpdate();
    }
    if (boundingBox != nullptr) computeBoundingBox();
    if (boundingSphere != nullptr) computeBoundingSphere();
    transformed = true;
    bumpRevision();
    return *this;
}

BufferGeometry& BufferGeometry::translate(double x, double y, double z) {
    Matrix4 matrix;
    matrix.makeTranslation(x, y, z);
    return applyMatrix4(matrix);
}

BufferGeometry& BufferGeometry::rotateX(double angle) {
    Matrix4 matrix;
    matrix.makeRotationX(angle);
    return applyMatrix4(matrix);
}

BufferGeometry& BufferGeometry::rotateY(double angle) {
    Matrix4 matrix;
    matrix.makeRotationY(angle);
    return applyMatrix4(matrix);
}

BufferGeometry& BufferGeometry::rotateZ(double angle) {
    Matrix4 matrix;
    matrix.makeRotationZ(angle);
    return applyMatrix4(matrix);
}

BufferGeometry& BufferGeometry::scale(double x, double y, double z) {
    Matrix4 matrix;
    matrix.makeScale(x, y, z);
    return applyMatrix4(matrix);
}

BufferGeometry& BufferGeometry::center() {
    computeBoundingBox();
    Vector3 offset;
    boundingBox->getCenter(offset);
    offset.negate();
    return translate(offset.x, offset.y, offset.z);
}

std::string BufferGeometry::parametersJson() const {
    if (parameters.empty()) return {};
    std::string json = "{";
    bool first = true;
    for (const auto& [name, value] : parameters) {
        if (!first) json += ",";
        first = false;
        json += "\"" + name + "\":" + value;
    }
    json += "}";
    return json;
}

std::string BufferGeometry::groupsJson() const {
    std::string json = "[";
    for (size_t i = 0; i < groups.size(); ++i) {
        if (i) json += ",";
        json += "{\"count\":" + jsonNumber(groups[i].count) +
                ",\"materialIndex\":" + jsonNumber(groups[i].materialIndex) +
                ",\"start\":" + jsonNumber(groups[i].start) + "}";
    }
    json += "]";
    return json;
}

}  // namespace tn::engine
