// Object3D, Layers and EventDispatcher: three@0.185.1 src/core/Object3D.js, Layers.js and
// EventDispatcher.js, method for method. The file-scope temporaries below are three's `_v1`, `_m1`,
// `_q1`, `_target`, `_position`, `_scale` and `_quaternion`; three keeps them module-level because
// its methods never re-enter. The one place this port could re-enter is a change callback, and the
// two callbacks below use their own locals, so no temporary is shared across a re-entry.

#include "engine/scene/object3d.h"

#include <algorithm>
#include <cstring>

namespace tn::engine {

namespace {

// three's `_object3DId`, and the first Object3D this process builds takes 0 as three's does.
uint64_t nextObjectId = 0;

// three's module-level scratch values.
Vector3 scratchV1;
Quaternion scratchQ1;
Matrix4 scratchM1;
Vector3 scratchTarget;
Vector3 scratchPosition;
Vector3 scratchScale;
Quaternion scratchQuaternion;
const Vector3 axisX{1, 0, 0};
const Vector3 axisY{0, 1, 0};
const Vector3 axisZ{0, 0, 1};

// three shares one event object per type. The target is stamped per dispatch, and `child` is set
// and cleared around the parent dispatch, exactly as three does it.
Event addedEvent{"added", nullptr, nullptr};
Event removedEvent{"removed", nullptr, nullptr};
Event childAddedEvent{"childadded", nullptr, nullptr};
Event childRemovedEvent{"childremoved", nullptr, nullptr};

}  // namespace

Vector3 Object3D::defaultUp{0, 1, 0};
bool Object3D::defaultMatrixAutoUpdate = true;
bool Object3D::defaultMatrixWorldAutoUpdate = true;

// ------------------------------------------------------------------------------ EventDispatcher

void EventDispatcher::addEventListener(std::string_view type, Listener listener, void* context) {
    std::vector<Entry>& entries = listeners_[std::string(type)];
    for (const Entry& entry : entries) {
        if (entry.listener == listener && entry.context == context) return;
    }
    entries.push_back(Entry{listener, context});
}

bool EventDispatcher::hasEventListener(std::string_view type, Listener listener, void* context) const {
    const auto found = listeners_.find(type);
    if (found == listeners_.end()) return false;
    for (const Entry& entry : found->second) {
        if (entry.listener == listener && entry.context == context) return true;
    }
    return false;
}

void EventDispatcher::removeEventListener(std::string_view type, Listener listener, void* context) {
    const auto found = listeners_.find(type);
    if (found == listeners_.end()) return;
    std::vector<Entry>& entries = found->second;
    for (auto it = entries.begin(); it != entries.end(); ++it) {
        if (it->listener == listener && it->context == context) {
            entries.erase(it);
            return;
        }
    }
}

void EventDispatcher::dispatchEvent(Event& event) {
    const auto found = listeners_.find(event.type);
    if (found == listeners_.end()) return;
    // EventDispatcher is only ever Object3D's base, so this downcast is total; see the header.
    event.target = static_cast<Object3D*>(this);
    // A copy, so a listener that removes itself while the event is delivered does not shift the list.
    const std::vector<Entry> array = found->second;
    for (const Entry& entry : array) entry.listener(event, entry.context);
    event.target = nullptr;
}

// ------------------------------------------------------------------------------ Object3D

Object3D::Object3D() : id_(nextObjectId++) {
    up = defaultUp;
    matrixAutoUpdate = defaultMatrixAutoUpdate;
    matrixWorldAutoUpdate = defaultMatrixWorldAutoUpdate;
    rotation.onChange(&Object3D::onRotationChange, this);
    quaternion.onChange(&Object3D::onQuaternionChange, this);
}

void Object3D::onRotationChange(void* context) {
    // three's `onRotationChange`: the Euler is authoritative, so it writes the quaternion without
    // notifying back, which is what `update = false` is for.
    auto& object = *static_cast<Object3D*>(context);
    object.quaternion.setFromEuler(object.rotation, false);
}

void Object3D::onQuaternionChange(void* context) {
    auto& object = *static_cast<Object3D*>(context);
    object.rotation.setFromQuaternion(object.quaternion, object.rotation.order, false);
}

void Object3D::setVisible(bool value) {
    visible_ = value;
    bump();
}

void Object3D::setCastShadow(bool value) {
    castShadow_ = value;
    bump();
}

void Object3D::setReceiveShadow(bool value) {
    receiveShadow_ = value;
    bump();
}

void Object3D::setRenderOrder(int value) {
    renderOrder_ = value;
    bump();
}

void Object3D::setLayerMask(uint32_t mask) {
    layers_.mask = mask;
    bump();
}

void Object3D::setLayer(int layer) {
    layers_.set(layer);
    bump();
}

void Object3D::enableLayer(int layer) {
    layers_.enable(layer);
    bump();
}

void Object3D::enableAllLayers() {
    layers_.enableAll();
    bump();
}

void Object3D::toggleLayer(int layer) {
    layers_.toggle(layer);
    bump();
}

void Object3D::disableLayer(int layer) {
    layers_.disable(layer);
    bump();
}

void Object3D::disableAllLayers() {
    layers_.disableAll();
    bump();
}

// ------------------------------------------------------------------------------ transforms

void Object3D::applyMatrix4(const Matrix4& m) {
    if (matrixAutoUpdate) updateMatrix();
    matrix.premultiply(m);
    matrix.decompose(position, quaternion, scale);
    bump();
}

Object3D& Object3D::applyQuaternion(const Quaternion& q) {
    quaternion.premultiply(q);
    bump();
    return *this;
}

void Object3D::setRotationFromAxisAngle(const Vector3& axis, double angle) {
    quaternion.setFromAxisAngle(axis, angle);  // assumes the axis is normalized
    bump();
}

void Object3D::setRotationFromEuler(const Euler& euler) {
    quaternion.setFromEuler(euler, true);
    bump();
}

void Object3D::setRotationFromMatrix(const Matrix4& m) {
    quaternion.setFromRotationMatrix(m);  // assumes the upper 3x3 is a pure rotation
    bump();
}

void Object3D::setRotationFromQuaternion(const Quaternion& q) {
    quaternion.copy(q);  // assumes q is normalized
    bump();
}

Object3D& Object3D::rotateOnAxis(const Vector3& axis, double angle) {
    scratchQ1.setFromAxisAngle(axis, angle);
    quaternion.multiply(scratchQ1);
    bump();
    return *this;
}

Object3D& Object3D::rotateOnWorldAxis(const Vector3& axis, double angle) {
    scratchQ1.setFromAxisAngle(axis, angle);
    quaternion.premultiply(scratchQ1);
    bump();
    return *this;
}

Object3D& Object3D::rotateX(double angle) { return rotateOnAxis(axisX, angle); }

Object3D& Object3D::rotateY(double angle) { return rotateOnAxis(axisY, angle); }

Object3D& Object3D::rotateZ(double angle) { return rotateOnAxis(axisZ, angle); }

Object3D& Object3D::translateOnAxis(const Vector3& axis, double distance) {
    scratchV1.copy(axis).applyQuaternion(quaternion);
    position.add(scratchV1.multiplyScalar(distance));
    bump();
    return *this;
}

Object3D& Object3D::translateX(double distance) { return translateOnAxis(axisX, distance); }

Object3D& Object3D::translateY(double distance) { return translateOnAxis(axisY, distance); }

Object3D& Object3D::translateZ(double distance) { return translateOnAxis(axisZ, distance); }

Vector3& Object3D::localToWorld(Vector3& vector) {
    updateWorldMatrix(true, false);
    return vector.applyMatrix4(matrixWorld);
}

Vector3& Object3D::worldToLocal(Vector3& vector) {
    updateWorldMatrix(true, false);
    return vector.applyMatrix4(scratchM1.copy(matrixWorld).invert());
}

void Object3D::lookAt(const Vector3& target) {
    // This method does not support objects having non-uniformly-scaled parent(s).
    scratchTarget.copy(target);  // three copies too, so a target that aliases a member survives
    Object3D* const parent_ = parent;
    updateWorldMatrix(true, false);
    scratchPosition.setFromMatrixPosition(matrixWorld);

    if (isCamera() || isLight()) {
        scratchM1.lookAt(scratchPosition, scratchTarget, up);
    } else {
        scratchM1.lookAt(scratchTarget, scratchPosition, up);
    }

    quaternion.setFromRotationMatrix(scratchM1);

    if (parent_ != nullptr) {
        scratchM1.extractRotation(parent_->matrixWorld);
        scratchQ1.setFromRotationMatrix(scratchM1);
        quaternion.premultiply(scratchQ1.invert());
    }
    bump();
}

void Object3D::lookAt(double x, double y, double z) {
    scratchTarget.set(x, y, z);
    lookAt(scratchTarget);
}

// ------------------------------------------------------------------------------ hierarchy

Object3D::~Object3D() {
    for (Object3D* child : children) child->parent = nullptr;  // owned children die after this body
    if (parent != nullptr) {
        auto& siblings = parent->children;
        siblings.erase(std::remove(siblings.begin(), siblings.end(), this), siblings.end());
    }
}

void Object3D::own(Object3D& child) {
    if (std::shared_ptr<Object3D> shared = child.weak_from_this().lock()) owned_.push_back(std::move(shared));
}

void Object3D::disown(Object3D& child) {
    const auto found = std::find_if(owned_.begin(), owned_.end(), [&](const auto& o) { return o.get() == &child; });
    if (found != owned_.end()) owned_.erase(found);
}

Object3D& Object3D::add(Object3D& object) {
    if (&object == this) return *this;  // three logs an error and returns; no exception crosses here
    // Re-parenting drops the old parent's hold: keep the object alive across it.
    const std::shared_ptr<Object3D> keep = object.weak_from_this().lock();
    object.removeFromParent();
    object.parent = this;
    children.push_back(&object);
    own(object);
    object.dispatchEvent(addedEvent);
    childAddedEvent.child = &object;
    dispatchEvent(childAddedEvent);
    childAddedEvent.child = nullptr;
    bump();
    return *this;
}

Object3D& Object3D::add(const std::vector<Object3D*>& objects) {
    for (Object3D* object : objects) add(*object);
    return *this;
}

Object3D& Object3D::remove(Object3D& object) {
    const auto found = std::find(children.begin(), children.end(), &object);
    if (found == children.end()) return *this;
    const std::shared_ptr<Object3D> keep = object.weak_from_this().lock();  // alive until this returns
    children.erase(found);
    disown(object);
    object.parent = nullptr;
    object.dispatchEvent(removedEvent);
    childRemovedEvent.child = &object;
    dispatchEvent(childRemovedEvent);
    childRemovedEvent.child = nullptr;
    bump();
    return *this;
}

Object3D& Object3D::remove(const std::vector<Object3D*>& objects) {
    for (Object3D* object : objects) remove(*object);
    return *this;
}

Object3D& Object3D::removeFromParent() {
    if (parent != nullptr) parent->remove(*this);
    return *this;
}

Object3D& Object3D::clear() {
    // three splices the live array out of the spread; copying first is the same order, and the copy
    // matters: remove() erases from `children` while the loop walks it.
    return remove(std::vector<Object3D*>(children));
}

Object3D& Object3D::attach(Object3D& object) {
    // Adds object as a child of this, while maintaining the object's world transform.
    updateWorldMatrix(true, false);
    scratchM1.copy(matrixWorld).invert();

    if (object.parent != nullptr) {
        object.parent->updateWorldMatrix(true, false);
        scratchM1.multiply(object.parent->matrixWorld);
    }

    object.applyMatrix4(scratchM1);
    const std::shared_ptr<Object3D> keep = object.weak_from_this().lock();
    object.removeFromParent();
    object.parent = this;
    children.push_back(&object);
    own(object);

    object.updateWorldMatrix(false, true);

    object.dispatchEvent(addedEvent);
    childAddedEvent.child = &object;
    dispatchEvent(childAddedEvent);
    childAddedEvent.child = nullptr;
    bump();
    return *this;
}

Object3D* Object3D::getObjectById(uint64_t id) {
    if (id_ == id) return this;
    for (Object3D* child : children) {
        if (Object3D* found = child->getObjectById(id)) return found;
    }
    return nullptr;
}

Object3D* Object3D::getObjectByName(std::string_view name) { return getObjectByProperty("name", name); }

Object3D* Object3D::getObjectByProperty(std::string_view property, std::string_view value) {
    // three compares `this[property] === value`, so a property Object3D does not have matches nothing.
    if (property == "name" && name == value) return this;
    if (property == "type" && type() == value) return this;
    for (Object3D* child : children) {
        if (Object3D* found = child->getObjectByProperty(property, value)) return found;
    }
    return nullptr;
}

// ------------------------------------------------------------------------------ world queries

Vector3& Object3D::getWorldPosition(Vector3& target) {
    updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(matrixWorld);
}

Quaternion& Object3D::getWorldQuaternion(Quaternion& target) {
    updateWorldMatrix(true, false);
    matrixWorld.decompose(scratchPosition, target, scratchScale);
    return target;
}

Vector3& Object3D::getWorldScale(Vector3& target) {
    updateWorldMatrix(true, false);
    matrixWorld.decompose(scratchPosition, scratchQuaternion, target);
    return target;
}

Vector3& Object3D::getWorldDirection(Vector3& target) {
    updateWorldMatrix(true, false);
    const double* e = matrixWorld.elements.data();
    return target.set(e[8], e[9], e[10]).normalize();
}

// ------------------------------------------------------------------------------ traversal

void Object3D::traverse(Visitor visitor, void* context) {
    visitor(*this, context);
    for (Object3D* child : children) child->traverse(visitor, context);
}

void Object3D::traverseVisible(Visitor visitor, void* context) {
    if (!visible_) return;
    visitor(*this, context);
    for (Object3D* child : children) child->traverseVisible(visitor, context);
}

void Object3D::traverseAncestors(Visitor visitor, void* context) {
    if (parent == nullptr) return;
    visitor(*parent, context);
    parent->traverseAncestors(visitor, context);
}

// ------------------------------------------------------------------------------ matrices

void Object3D::updateMatrix() {
    const Matrix4 before = matrix;
    matrix.compose(position, quaternion, scale);

    if (pivot.has_value()) {
        const double px = pivot->x, py = pivot->y, pz = pivot->z;
        double* te = matrix.elements.data();
        te[12] += px - te[0] * px - te[4] * py - te[8] * pz;
        te[13] += py - te[1] * px - te[5] * py - te[9] * pz;
        te[14] += pz - te[2] * px - te[6] * py - te[10] * pz;
    }

    matrixWorldNeedsUpdate = true;
    // three recomposes every frame for every auto-update object; only a changed matrix is a change.
    if (std::memcmp(before.elements.data(), matrix.elements.data(), sizeof(double) * 16) != 0) bump();
}

void Object3D::updateMatrixWorld(bool force) {
    if (matrixAutoUpdate) updateMatrix();

    if (matrixWorldNeedsUpdate || force) {
        if (matrixWorldAutoUpdate) {
            const Matrix4 before = matrixWorld;
            if (parent == nullptr) {
                matrixWorld.copy(matrix);
            } else {
                matrixWorld.multiplyMatrices(parent->matrixWorld, matrix);
            }
            // A parent's move reaches the renderer through the child's world matrix.
            if (std::memcmp(before.elements.data(), matrixWorld.elements.data(), sizeof(double) * 16) != 0) bump();
        }
        matrixWorldNeedsUpdate = false;
        force = true;
    }

    for (Object3D* child : children) child->updateMatrixWorld(force);
}

void Object3D::updateWorldMatrix(bool updateParents, bool updateChildren, bool force) {
    Object3D* const parent_ = parent;

    if (updateParents && parent_ != nullptr) parent_->updateWorldMatrix(true, false);

    if (matrixAutoUpdate) updateMatrix();

    if (matrixWorldNeedsUpdate || force) {
        if (matrixWorldAutoUpdate) {
            const Matrix4 before = matrixWorld;
            if (parent_ == nullptr) {
                matrixWorld.copy(matrix);
            } else {
                matrixWorld.multiplyMatrices(parent_->matrixWorld, matrix);
            }
            if (std::memcmp(before.elements.data(), matrixWorld.elements.data(), sizeof(double) * 16) != 0) bump();
        }
        matrixWorldNeedsUpdate = false;
        force = true;
    }

    if (updateChildren) {
        for (Object3D* child : children) child->updateWorldMatrix(false, true, force);
    }
}

Object3D& Object3D::copy(const Object3D& source) {
    name = source.name;
    up.copy(source.up);
    position.copy(source.position);
    rotation.order = source.rotation.order;
    quaternion.copy(source.quaternion);
    scale.copy(source.scale);
    pivot = source.pivot;
    matrix.copy(source.matrix);
    matrixWorld.copy(source.matrixWorld);
    matrixAutoUpdate = source.matrixAutoUpdate;
    matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
    matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate;
    layers_.mask = source.layers_.mask;
    visible_ = source.visible_;
    castShadow_ = source.castShadow_;
    receiveShadow_ = source.receiveShadow_;
    frustumCulled = source.frustumCulled;
    renderOrder_ = source.renderOrder_;
    bump();
    return *this;
}

}  // namespace tn::engine