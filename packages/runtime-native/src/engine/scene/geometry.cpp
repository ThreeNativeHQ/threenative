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

}  // namespace

// ECMAScript Number::toString(10) over the shortest round-trip digits: `100000` and `1e-7`, where
// std::to_chars alone writes `1e+05` and `1e-07`.
std::string jsNumber(double value) {
    if (std::isnan(value)) return "NaN";
    if (value == 0) return "0";  // -0 too
    if (std::isinf(value)) return value < 0 ? "-Infinity" : "Infinity";
    if (value < 0) return "-" + jsNumber(-value);
    char buffer[40];
    const auto result = std::to_chars(buffer, buffer + sizeof buffer, value, std::chars_format::scientific);
    const std::string text(buffer, result.ptr);           // "d.ddde+XX" or "de-XX"
    const size_t e = text.find('e');
    std::string digits = text.substr(0, e);
    digits.erase(std::remove(digits.begin(), digits.end(), '.'), digits.end());
    const int k = static_cast<int>(digits.size());
    const int n = std::stoi(text.substr(e + 1)) + 1;     // value = 0.digits x 10^n
    if (k <= n && n <= 21) return digits + std::string(static_cast<size_t>(n - k), '0');
    if (0 < n && n <= 21) return digits.substr(0, static_cast<size_t>(n)) + "." + digits.substr(static_cast<size_t>(n));
    if (-6 < n && n <= 0) return "0." + std::string(static_cast<size_t>(-n), '0') + digits;
    const int exponent = n - 1;
    const std::string mantissa = k == 1 ? digits : digits.substr(0, 1) + "." + digits.substr(1);
    return mantissa + "e" + (exponent < 0 ? "-" : "+") + std::to_string(std::abs(exponent));
}

namespace {

/** JSON.stringify's number form: Number::toString, and null for NaN and the infinities. */
std::string jsonNumber(double value) {
    return std::isfinite(value) ? jsNumber(value) : "null";
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

namespace {

/** ECMAScript ToInt8/16/32 and ToUint8/16/32: truncate, wrap modulo 2^bits, then read as signed. */
int64_t jsToInteger(double value, int bits, bool isSigned) {
    if (!std::isfinite(value)) return 0;
    const double modulus = std::ldexp(1.0, bits);
    double wrapped = std::fmod(std::trunc(value), modulus);
    if (wrapped < 0) wrapped += modulus;
    if (isSigned && wrapped >= modulus / 2) wrapped -= modulus;
    return static_cast<int64_t>(wrapped);
}

template <typename T>
T load(const BufferStore& store, uint64_t element) {
    T value{};
    store.read(element * sizeof(T), &value, sizeof(T));
    return value;
}

template <typename T>
void storeValue(BufferStore& store, uint64_t element, T value) {
    store.write(element * sizeof(T), &value, sizeof(T));
}

}  // namespace

// A typed array read: NaN past the end (where JS reads `undefined`, which arithmetic turns to NaN),
// never uninitialised bytes.
double BufferAttribute::raw(uint64_t elementIndex) const {
    if (elementIndex >= store->count()) return std::numeric_limits<double>::quiet_NaN();
    switch (store->scalar()) {
        case Scalar::F32: return load<float>(*store, elementIndex);
        case Scalar::F64: return load<double>(*store, elementIndex);
        case Scalar::I8: return load<int8_t>(*store, elementIndex);
        case Scalar::U8: return load<uint8_t>(*store, elementIndex);
        case Scalar::I16: return load<int16_t>(*store, elementIndex);
        case Scalar::U16: return load<uint16_t>(*store, elementIndex);
        case Scalar::I32: return load<int32_t>(*store, elementIndex);
        case Scalar::U32: return load<uint32_t>(*store, elementIndex);
    }
    return std::numeric_limits<double>::quiet_NaN();
}

// A typed array write: Math.fround for Float32, ToIntN wrapping for the integer arrays, and a
// write past the end is ignored, as JS ignores it.
void BufferAttribute::setRaw(uint64_t elementIndex, double value) {
    if (elementIndex >= store->count()) return;
    switch (store->scalar()) {
        case Scalar::F32: return storeValue(*store, elementIndex, static_cast<float>(value));
        case Scalar::F64: return storeValue(*store, elementIndex, value);
        case Scalar::I8: return storeValue(*store, elementIndex, static_cast<int8_t>(jsToInteger(value, 8, true)));
        case Scalar::U8: return storeValue(*store, elementIndex, static_cast<uint8_t>(jsToInteger(value, 8, false)));
        case Scalar::I16: return storeValue(*store, elementIndex, static_cast<int16_t>(jsToInteger(value, 16, true)));
        case Scalar::U16: return storeValue(*store, elementIndex, static_cast<uint16_t>(jsToInteger(value, 16, false)));
        case Scalar::I32: return storeValue(*store, elementIndex, static_cast<int32_t>(jsToInteger(value, 32, true)));
        case Scalar::U32: return storeValue(*store, elementIndex, static_cast<uint32_t>(jsToInteger(value, 32, false)));
    }
}

// three's MathUtils.denormalize / normalize for each typed array a normalized attribute may use.
double BufferAttribute::denormalize(double value) const {
    if (!normalized) return value;
    switch (store->scalar()) {
        case Scalar::U32: return value / 4294967295.0;
        case Scalar::U16: return value / 65535.0;
        case Scalar::U8: return value / 255.0;
        case Scalar::I32: return std::max(value / 2147483647.0, -1.0);
        case Scalar::I16: return std::max(value / 32767.0, -1.0);
        case Scalar::I8: return std::max(value / 127.0, -1.0);
        default: return value;  // Float32Array; Float64Array is refused when an attribute is made
    }
}

double BufferAttribute::normalize(double value) const {
    if (!normalized) return value;
    switch (store->scalar()) {
        case Scalar::U32: return jsRound(value * 4294967295.0);
        case Scalar::U16: return jsRound(value * 65535.0);
        case Scalar::U8: return jsRound(value * 255.0);
        case Scalar::I32: return jsRound(value * 2147483647.0);
        case Scalar::I16: return jsRound(value * 32767.0);
        case Scalar::I8: return jsRound(value * 127.0);
        default: return value;
    }
}

// index * itemSize + component without wrapping: a caller-supplied index can be anything, and a
// product that wrapped would land back inside the array.
bool BufferAttribute::element(uint64_t index, int component, uint64_t& out) const {
    if (component < 0 || itemSize <= 0) return false;
    const uint64_t max = std::numeric_limits<uint64_t>::max();
    if (index > max / static_cast<uint64_t>(itemSize)) return false;
    const uint64_t scaled = index * static_cast<uint64_t>(itemSize);
    if (static_cast<uint64_t>(component) > max - scaled) return false;
    out = scaled + static_cast<uint64_t>(component);
    return out < store->count();
}

double BufferAttribute::getComponent(uint64_t index, int component) const {
    uint64_t at = 0;
    return element(index, component, at) ? denormalize(raw(at)) : std::numeric_limits<double>::quiet_NaN();
}

BufferAttribute& BufferAttribute::setComponent(uint64_t index, int component, double value) {
    uint64_t at = 0;
    if (element(index, component, at)) setRaw(at, normalize(value));
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

void BufferGeometry::addGroup(double start, double count, double materialIndex) {
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

Box3& Box3::setFromBufferAttribute(const BufferAttribute& attribute) {
    makeEmpty();
    Vector3 point;
    for (uint64_t i = 0; i < attribute.count(); ++i) expandByPoint(attribute.getXYZ(i, point));
    return *this;
}

void BufferGeometry::computeBoundingBox() {
    if (boundingBox == nullptr) boundingBox = std::make_shared<Box3>();
    boundingBox->makeEmpty();
    const std::shared_ptr<BufferAttribute> position = getAttribute("position");
    if (position == nullptr) return;
    boundingBox->setFromBufferAttribute(*position);
    Vector3 point;
    Box3 morphBox;
    for (const auto& morph : morphPositions) {
        morphBox.setFromBufferAttribute(*morph);
        if (morphTargetsRelative) {
            boundingBox->expandByPoint(point.addVectors(boundingBox->min, morphBox.min));
            boundingBox->expandByPoint(point.addVectors(boundingBox->max, morphBox.max));
        } else {
            boundingBox->expandByPoint(morphBox.min);
            boundingBox->expandByPoint(morphBox.max);
        }
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
        // Math.max propagates NaN; std::max would drop it and report a finite radius.
        const double d = center.distanceToSquared(point);
        maxRadiusSq = std::isnan(maxRadiusSq) || std::isnan(d) ? std::numeric_limits<double>::quiet_NaN() : std::max(maxRadiusSq, d);
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

std::shared_ptr<BufferAttribute> BufferAttribute::clone() const {
    auto copy = std::make_shared<BufferAttribute>(store->scalar(), store->count(), itemSize, normalized);
    copy->store->write(0, store->data(), store->byteLength());
    copy->name = name;
    copy->usage = usage;
    copy->gpuType = gpuType;
    copy->instanced = instanced;
    return copy;
}

uint32_t InstancedBufferGeometry::drawInstances() const {
    double held = std::numeric_limits<double>::infinity();
    for (const auto& [name, attribute] : attributes)
        if (attribute && attribute->instanced) held = std::min(held, double(attribute->count()));
    const double count = std::min(instanceCount, held);
    // ponytail: three passes an Infinity count with no instanced attribute straight to the backend;
    // here that draws once.
    if (!std::isfinite(count)) return 1;
    return count <= 0 ? 0u : static_cast<uint32_t>(std::min(count, 4294967295.0));
}

namespace {

std::shared_ptr<BufferAttribute> cloneAttribute(const BufferAttribute& source) { return source.clone(); }

}  // namespace

std::shared_ptr<BufferGeometry> BufferGeometry::clone() const {
    auto geometry = std::make_shared<BufferGeometry>();
    geometry->type = type;
    geometry->parameters = parameters;
    geometry->copy(*this);
    return geometry;
}

BufferGeometry& BufferGeometry::copy(const BufferGeometry& source) {
    index = source.index ? cloneAttribute(*source.index) : nullptr;
    attributes.clear();
    for (const auto& [name, attribute] : source.attributes) setAttribute(name, cloneAttribute(*attribute));
    morphPositions.clear();
    morphNormals.clear();
    for (const auto& target : source.morphPositions) morphPositions.push_back(cloneAttribute(*target));
    for (const auto& target : source.morphNormals) morphNormals.push_back(cloneAttribute(*target));
    morphTargetsRelative = source.morphTargetsRelative;
    groups = source.groups;
    boundingBox = source.boundingBox ? std::make_shared<Box3>(*source.boundingBox) : nullptr;
    boundingSphere = source.boundingSphere ? std::make_shared<Sphere>(*source.boundingSphere) : nullptr;
    drawRange = source.drawRange;
    name = source.name;
    bumpRevision();
    return *this;
}

void BufferGeometry::dispose() {
    if (index) index->store->releaseGpuCopy();
    for (const auto& [name, attribute] : attributes) attribute->store->releaseGpuCopy();
    for (const auto& target : morphPositions) target->store->releaseGpuCopy();
    for (const auto& target : morphNormals) target->store->releaseGpuCopy();
}

std::shared_ptr<BufferGeometry> BufferGeometry::toNonIndexed() const {
    if (index == nullptr) return nullptr;
    auto geometry = std::make_shared<BufferGeometry>();
    const std::vector<double> indices = index->toNumbers();
    for (const auto& [name, attribute] : attributes) {
        // Raw element copies, as three's convertBufferAttribute does (array2[i] = array[j]): reading
        // through getComponent would denormalize and fromDoubles would not re-normalize.
        const uint64_t size = static_cast<uint64_t>(attribute->itemSize);
        auto copy = std::make_shared<BufferAttribute>(attribute->store->scalar(), indices.size() * size,
                                                      attribute->itemSize, attribute->normalized);
        uint64_t out = 0;
        for (const double vertex : indices) {
            for (uint64_t j = 0; j < size; ++j) copy->setRaw(out++, attribute->raw(static_cast<uint64_t>(vertex) * size + j));
        }
        geometry->setAttribute(name, copy);
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
