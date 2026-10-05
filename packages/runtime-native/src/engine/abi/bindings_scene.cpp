// The scene classes in the engine's one binding registry (PRD-508). The differential fixture driver
// and the C ABI drive the same registry, so a fixture and a `tn_invoke` call reach the same method.
//
// Members are read two ways, because the protocol asks for both. A dotted path (`position.x`,
// `matrixWorld.elements`) is a getter or setter on the owning object. A whole member (`position`) is
// a *method* that answers a Ref to the member itself — not a copy — because the getter signature
// carries no Store and a Store is what turns a native pointer into a caller-visible object. So
// `object.position` is one vector, the same Ref on every call, and writing through it writes the
// object's own vector.
//
// `rotation.x`/`y`/`z` write the component and then call Euler::notify(), as three's Euler setters
// fire _onChangeCallback, so the quaternion follows; a JS `mesh.rotation.x = v` reaches the same
// notify through the Euler member's own setters.

#include "engine/abi/bindings.h"

#include <cmath>

#include "engine/foundation/math/Euler.h"
#include "engine/foundation/math/Matrix.h"
#include "engine/foundation/math/Quaternion.h"
#include "engine/foundation/math/Vector.h"
#include "engine/scene/camera.h"
#include "engine/scene/geometry.h"
#include "engine/scene/material.h"
#include "engine/scene/nodes.h"
#include "engine/scene/object3d.h"

#include <array>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace tn::binding {

using namespace tn::engine;

namespace {

double optional(const Args& a, size_t i, double fallback) {
    return i < a.size() ? number(a.at(i)) : fallback;
}

bool flag(const Value& v) { return v.kind == Value::Kind::Bool ? v.flag : number(v) != 0; }

bool boolean(const Args& a, size_t i, bool fallback) { return i < a.size() ? flag(a.at(i)) : fallback; }

template <typename T>
T* as(void* self) {
    return static_cast<T*>(self);
}

Value numbers(const double* values, size_t count) {
    return Value::list(std::vector<double>(values, values + count));
}

double component3(const Vector3& v, int i) { return i == 0 ? v.x : (i == 1 ? v.y : v.z); }

void setComponent3(Vector3& v, int i, double value) {
    (i == 0 ? v.x : (i == 1 ? v.y : v.z)) = value;
}

double component4(const Quaternion& q, int i) {
    const std::array<double, 4> a = q.toArray();
    return a[i];
}

void setComponent4(Quaternion& q, int i, double value) {
    const std::array<double, 4> a = q.toArray();
    q.set(i == 0 ? value : a[0], i == 1 ? value : a[1], i == 2 ? value : a[2],
          i == 3 ? value : a[3]);
}

/** Registers `<prefix>.x`/`y`/`z` for a Vector3 field, read and written. */
template <typename T>
void nestedVector(ClassBinding& b, const char* prefix, Vector3 T::*field) {
    for (int i = 0; i < 3; ++i) {
        const std::string path = std::string(prefix) + "." + "xyz"[i];
        b.getters[path] = [field, i](void* self) { return Value::of(component3(as<T>(self)->*field, i)); };
        b.setters[path] = [field, i](void* self, const Value& v) {
            setComponent3(as<T>(self)->*field, i, number(v));
        };
    }
}

/** Registers `<prefix>.x`/`y`/`z`/`w` for a Quaternion field, read and written. */
template <typename T>
void nestedQuaternion(ClassBinding& b, const char* prefix, Quaternion T::*field) {
    const char* const names[4] = {"x", "y", "z", "w"};
    for (int i = 0; i < 4; ++i) {
        const std::string path = std::string(prefix) + "." + names[i];
        b.getters[path] = [field, i](void* self) { return Value::of(component4(as<T>(self)->*field, i)); };
        b.setters[path] = [field, i](void* self, const Value& v) {
            setComponent4(as<T>(self)->*field, i, number(v));  // Quaternion::set notifies
        };
    }
}

/** Registers `<prefix>.elements` for a Matrix4 field: three's column-major array. */
template <typename T>
void nestedMatrix(ClassBinding& b, const char* prefix, Matrix4 T::*field) {
    b.getters[std::string(prefix) + ".elements"] = [field](void* self) {
        return numbers((as<T>(self)->*field).elements.data(), 16);
    };
}

/**
 * A method that answers the Ref of one of `self`'s own members. `memberAlias` resolves `self`
 * through the caller, so the Ref keeps the owner alive and is the same value on every call.
 */
template <typename Owner, typename M>
Method memberAliasMethod(M Owner::*field, const char* cls) {
    return [field, cls](void* self, const Args&, Store& store) {
        return memberAlias(store, self, as<Owner>(self)->*field, cls);
    };
}

/**
 * An Object3D argument of any scene class. `Store::ref` matches one class name, and a Mesh is a
 * valid child of a Group, so the argument is matched against the classes the scene graph owns.
 */
Object3D& objectArg(Store& store, const Value& arg) {
    static const char* const kClasses[] = {"Object3D",        "Group",           "Mesh",
                                           "Scene",           "Camera",          "PerspectiveCamera",
                                           "OrthographicCamera", "AmbientLight", "DirectionalLight",
                                           "HemisphereLight"};
    Object* found = store.find(arg);
    if (found == nullptr) throw Unsupported{"argument is not an Object3D"};
    for (const char* cls : kClasses) {
        if (found->cls == cls) return *static_cast<Object3D*>(found->ptr.get());
    }
    throw Unsupported{"argument is not an Object3D, it is a " + found->cls};
}

std::shared_ptr<void> makeNode() { return std::static_pointer_cast<void>(std::make_shared<Object3D>()); }

// ---------------------------------------------------------------------------- Object3D

/** A found descendant as its own Ref; a borrowed (C++-owned) object has no shared owner to hand out. */
Value foundObject(Store& store, Object3D* found) {
    if (found == nullptr) return Value{};
    std::shared_ptr<Object3D> shared = found->weak_from_this().lock();
    if (!shared) throw Unsupported{"the object found is not shared-owned"};
    return store.share(std::string(found->type()), std::static_pointer_cast<void>(shared));
}

void registerObject3D(ClassBinding& b) {
    b.methods["getObjectById"] = [](void* self, const Args& a, Store& store) {
        // An id is a safe non-negative integer; anything else names no object (`undefined` in three).
        const double id = number(a.at(0));
        if (!(id >= 0 && id <= 9007199254740991.0) || id != std::floor(id)) return Value{};
        return foundObject(store, as<Object3D>(self)->getObjectById(static_cast<uint64_t>(id)));
    };
    b.methods["getObjectByName"] = [](void* self, const Args& a, Store& store) {
        if (a.at(0).kind != Value::Kind::String) throw Unsupported{"getObjectByName needs a name"};
        return foundObject(store, as<Object3D>(self)->getObjectByName(a.at(0).text));
    };
    b.ctor = [](const Args&, Store&) { return makeNode(); };

    // The renderer's flat inputs. Every setter that bumps `revision` is one of these.
    b.getters["visible"] = [](void* self) { return Value::of(as<Object3D>(self)->visible()); };
    b.setters["visible"] = [](void* self, const Value& v) { as<Object3D>(self)->setVisible(flag(v)); };
    b.getters["castShadow"] = [](void* self) { return Value::of(as<Object3D>(self)->castShadow()); };
    b.setters["castShadow"] = [](void* self, const Value& v) { as<Object3D>(self)->setCastShadow(flag(v)); };
    b.getters["receiveShadow"] = [](void* self) { return Value::of(as<Object3D>(self)->receiveShadow()); };
    b.setters["receiveShadow"] = [](void* self, const Value& v) { as<Object3D>(self)->setReceiveShadow(flag(v)); };
    b.getters["frustumCulled"] = [](void* self) { return Value::of(as<Object3D>(self)->frustumCulled); };
    b.setters["frustumCulled"] = [](void* self, const Value& v) { as<Object3D>(self)->frustumCulled = flag(v); };
    b.getters["renderOrder"] = [](void* self) { return Value::of(double(as<Object3D>(self)->renderOrder())); };
    b.setters["renderOrder"] = [](void* self, const Value& v) {
        as<Object3D>(self)->setRenderOrder(static_cast<int>(number(v)));
    };
    b.getters["layers.mask"] = [](void* self) { return Value::of(double(as<Object3D>(self)->layers().mask)); };
    b.setters["layers.mask"] = [](void* self, const Value& v) {
        as<Object3D>(self)->setLayerMask(static_cast<uint32_t>(number(v)));
    };
    b.getters["matrixAutoUpdate"] = [](void* self) { return Value::of(as<Object3D>(self)->matrixAutoUpdate); };
    b.setters["matrixAutoUpdate"] = [](void* self, const Value& v) { as<Object3D>(self)->matrixAutoUpdate = flag(v); };
    b.getters["matrixWorldAutoUpdate"] = [](void* self) { return Value::of(as<Object3D>(self)->matrixWorldAutoUpdate); };
    b.setters["matrixWorldAutoUpdate"] = [](void* self, const Value& v) { as<Object3D>(self)->matrixWorldAutoUpdate = flag(v); };
    b.getters["matrixWorldNeedsUpdate"] = [](void* self) { return Value::of(as<Object3D>(self)->matrixWorldNeedsUpdate); };
    b.getters["id"] = [](void* self) { return Value::of(double(as<Object3D>(self)->id())); };
    b.getters["revision"] = [](void* self) { return Value::of(double(as<Object3D>(self)->revision())); };
    b.getters["type"] = [](void* self) {
        return Value{Value::Kind::String, 0, std::string(as<Object3D>(self)->type())};
    };
    b.getters["name"] = [](void* self) { return Value{Value::Kind::String, 0, as<Object3D>(self)->name}; };
    b.setters["name"] = [](void* self, const Value& v) { as<Object3D>(self)->name = v.text; };

    nestedVector<Object3D>(b, "position", &Object3D::position);
    nestedVector<Object3D>(b, "scale", &Object3D::scale);
    nestedVector<Object3D>(b, "up", &Object3D::up);
    nestedQuaternion<Object3D>(b, "quaternion", &Object3D::quaternion);
    nestedMatrix<Object3D>(b, "matrix", &Object3D::matrix);
    nestedMatrix<Object3D>(b, "matrixWorld", &Object3D::matrixWorld);
    for (int i = 0; i < 3; ++i) {
        const std::string path = std::string("rotation.") + "xyz"[i];
        b.getters[path] = [i](void* self) { return Value::of(as<Object3D>(self)->rotation.toArray()[i]); };
        // As three's Euler setters: write the component, then sync the quaternion through notify().
        b.setters[path] = [i](void* self, const Value& v) {
            Euler& rotation = as<Object3D>(self)->rotation;
            (i == 0 ? rotation.x : i == 1 ? rotation.y : rotation.z) = number(v);
            rotation.notify();
        };
    }
    // `pivot` is `null` in three until something sets it, and the protocol's `set` carries one value,
    // so there is no way to make it non-null through a binding: a C++ caller assigns the member. Both
    // directions therefore refuse while it is null, rather than inventing a zero pivot.
    for (int i = 0; i < 3; ++i) {
        const std::string path = std::string("pivot.") + "xyz"[i];
        b.getters[path] = [i](void* self) {
            const std::optional<Vector3>& pivot = as<Object3D>(self)->pivot;
            if (!pivot.has_value()) throw Unsupported{"this Object3D has no pivot"};
            return Value::of(component3(*pivot, i));
        };
        b.setters[path] = [i](void* self, const Value& v) {
            std::optional<Vector3>& pivot = as<Object3D>(self)->pivot;
            if (!pivot.has_value()) throw Unsupported{"this Object3D has no pivot"};
            setComponent3(*pivot, i, number(v));
        };
    }
    b.getters["rotation.order"] = [](void* self) {
        static const char* const kNames[] = {"XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"};
        return Value{Value::Kind::String, 0,
                     std::string(kNames[static_cast<int>(as<Object3D>(self)->rotation.order)])};
    };
    b.setters["rotation.order"] = [](void* self, const Value& v) {
        static const char* const kNames[] = {"XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"};
        Euler& rotation = as<Object3D>(self)->rotation;
        for (int i = 0; i < 6; ++i) {
            if (v.kind == Value::Kind::String && v.text == kNames[i]) {
                rotation.order = static_cast<EulerOrder>(i);
                rotation.notify();  // three's order setter re-syncs the quaternion
                return;
            }
        }
        throw Unsupported{"unknown Euler order"};
    };

    // The members themselves, as Refs to the members.
    fixedMember(b, "position", memberAliasMethod(&Object3D::position, "Vector3"));
    fixedMember(b, "scale", memberAliasMethod(&Object3D::scale, "Vector3"));
    fixedMember(b, "up", memberAliasMethod(&Object3D::up, "Vector3"));
    fixedMember(b, "quaternion", memberAliasMethod(&Object3D::quaternion, "Quaternion"));
    fixedMember(b, "rotation", memberAliasMethod(&Object3D::rotation, "Euler"));
    fixedMember(b, "matrix", memberAliasMethod(&Object3D::matrix, "Matrix4"));
    fixedMember(b, "matrixWorld", memberAliasMethod(&Object3D::matrixWorld, "Matrix4"));

    // Transforms.
    b.methods["add"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->add(objectArg(store, a.at(0)));
        return chain();
    };
    b.methods["remove"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->remove(objectArg(store, a.at(0)));
        return chain();
    };
    b.methods["attach"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->attach(objectArg(store, a.at(0)));
        return chain();
    };
    b.methods["removeFromParent"] = [](void* self, const Args&, Store&) {
        as<Object3D>(self)->removeFromParent();
        return chain();
    };
    b.methods["clear"] = [](void* self, const Args&, Store&) {
        as<Object3D>(self)->clear();
        return chain();
    };
    b.methods["updateMatrix"] = [](void* self, const Args&, Store&) {
        as<Object3D>(self)->updateMatrix();
        return chain();
    };
    b.methods["updateMatrixWorld"] = [](void* self, const Args& a, Store&) {
        as<Object3D>(self)->updateMatrixWorld(boolean(a, 0, false));
        return chain();
    };
    b.methods["updateWorldMatrix"] = [](void* self, const Args& a, Store&) {
        as<Object3D>(self)->updateWorldMatrix(boolean(a, 0, false), boolean(a, 1, false),
                                               boolean(a, 2, false));
        return chain();
    };
    b.methods["applyMatrix4"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->applyMatrix4(store.ref<Matrix4>(a.at(0), "Matrix4"));
        return chain();
    };
    b.methods["applyQuaternion"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->applyQuaternion(store.ref<Quaternion>(a.at(0), "Quaternion"));
        return chain();
    };
    b.methods["setRotationFromAxisAngle"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->setRotationFromAxisAngle(store.ref<Vector3>(a.at(0), "Vector3"),
                                                    number(a.at(1)));
        return chain();
    };
    b.methods["setRotationFromEuler"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->setRotationFromEuler(store.ref<Euler>(a.at(0), "Euler"));
        return chain();
    };
    b.methods["setRotationFromMatrix"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->setRotationFromMatrix(store.ref<Matrix4>(a.at(0), "Matrix4"));
        return chain();
    };
    b.methods["setRotationFromQuaternion"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->setRotationFromQuaternion(store.ref<Quaternion>(a.at(0), "Quaternion"));
        return chain();
    };
    b.methods["rotateOnAxis"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->rotateOnAxis(store.ref<Vector3>(a.at(0), "Vector3"), number(a.at(1)));
        return chain();
    };
    b.methods["rotateOnWorldAxis"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->rotateOnWorldAxis(store.ref<Vector3>(a.at(0), "Vector3"), number(a.at(1)));
        return chain();
    };
    b.methods["rotateX"] = [](void* self, const Args& a, Store&) {
        as<Object3D>(self)->rotateX(number(a.at(0)));
        return chain();
    };
    b.methods["rotateY"] = [](void* self, const Args& a, Store&) {
        as<Object3D>(self)->rotateY(number(a.at(0)));
        return chain();
    };
    b.methods["rotateZ"] = [](void* self, const Args& a, Store&) {
        as<Object3D>(self)->rotateZ(number(a.at(0)));
        return chain();
    };
    b.methods["translateOnAxis"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->translateOnAxis(store.ref<Vector3>(a.at(0), "Vector3"), number(a.at(1)));
        return chain();
    };
    b.methods["translateX"] = [](void* self, const Args& a, Store&) {
        as<Object3D>(self)->translateX(number(a.at(0)));
        return chain();
    };
    b.methods["translateY"] = [](void* self, const Args& a, Store&) {
        as<Object3D>(self)->translateY(number(a.at(0)));
        return chain();
    };
    b.methods["translateZ"] = [](void* self, const Args& a, Store&) {
        as<Object3D>(self)->translateZ(number(a.at(0)));
        return chain();
    };
    b.methods["localToWorld"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->localToWorld(store.ref<Vector3>(a.at(0), "Vector3"));
        return chain();
    };
    b.methods["worldToLocal"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->worldToLocal(store.ref<Vector3>(a.at(0), "Vector3"));
        return chain();
    };
    b.methods["lookAt"] = [](void* self, const Args& a, Store& store) {
        if (a.at(0).kind == Value::Kind::Ref) {
            as<Object3D>(self)->lookAt(store.ref<Vector3>(a.at(0), "Vector3"));
        } else {
            as<Object3D>(self)->lookAt(number(a.at(0)), number(a.at(1)), number(a.at(2)));
        }
        return chain();
    };
    b.methods["getWorldPosition"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->getWorldPosition(store.ref<Vector3>(a.at(0), "Vector3"));
        return chain();
    };
    b.methods["getWorldQuaternion"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->getWorldQuaternion(store.ref<Quaternion>(a.at(0), "Quaternion"));
        return chain();
    };
    b.methods["getWorldScale"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->getWorldScale(store.ref<Vector3>(a.at(0), "Vector3"));
        return chain();
    };
    b.methods["getWorldDirection"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->getWorldDirection(store.ref<Vector3>(a.at(0), "Vector3"));
        return chain();
    };
    b.methods["copy"] = [](void* self, const Args& a, Store& store) {
        as<Object3D>(self)->copy(objectArg(store, a.at(0)));
        return chain();
    };
}

// ----------------------------------------------------------------------------- Camera

/** The members and inputs both cameras share. */
void registerCameraCommon(ClassBinding& b) {
    nestedMatrix<Camera>(b, "projectionMatrix", &Camera::projectionMatrix);
    nestedMatrix<Camera>(b, "projectionMatrixInverse", &Camera::projectionMatrixInverse);
    nestedMatrix<Camera>(b, "matrixWorldInverse", &Camera::matrixWorldInverse);
    fixedMember(b, "projectionMatrix", memberAliasMethod(&Camera::projectionMatrix, "Matrix4"));
    fixedMember(b, "projectionMatrixInverse", memberAliasMethod(&Camera::projectionMatrixInverse, "Matrix4"));
    fixedMember(b, "matrixWorldInverse", memberAliasMethod(&Camera::matrixWorldInverse, "Matrix4"));
    // `setViewOffset` and `clearViewOffset` are registered per concrete class, because only
    // PerspectiveCamera's `setViewOffset` also writes `aspect`.
}

/** The six view-offset numbers both cameras take. */
Args viewOffsetArgs(const Args& a) {
    if (a.size() < 6) throw Unsupported{"setViewOffset needs fullWidth, fullHeight, x, y, width, height"};
    return a;
}

void registerCamera(ClassBinding& b) {
    registerObject3D(b);
    registerCameraCommon(b);
    b.ctor = [](const Args&, Store&) {
        return std::static_pointer_cast<void>(std::make_shared<Camera>());
    };
}

void registerPerspectiveCamera(ClassBinding& b) {
    registerCamera(b);
    b.ctor = [](const Args& a, Store&) {
        return std::static_pointer_cast<void>(std::make_shared<PerspectiveCamera>(
            optional(a, 0, 50), optional(a, 1, 1), optional(a, 2, 0.1), optional(a, 3, 2000)));
    };
    const std::pair<const char*, double PerspectiveCamera::*> kScalars[] = {
        {"fov", &PerspectiveCamera::fov},         {"zoom", &PerspectiveCamera::zoom},
        {"near", &PerspectiveCamera::near},       {"far", &PerspectiveCamera::far},
        {"focus", &PerspectiveCamera::focus},     {"aspect", &PerspectiveCamera::aspect},
        {"filmGauge", &PerspectiveCamera::filmGauge},
        {"filmOffset", &PerspectiveCamera::filmOffset},
    };
    for (const auto& [name, field] : kScalars) {
        b.getters[name] = [field](void* self) { return Value::of(as<PerspectiveCamera>(self)->*field); };
        b.setters[name] = [field](void* self, const Value& v) {
            as<PerspectiveCamera>(self)->*field = number(v);
        };
    }
    b.methods["updateProjectionMatrix"] = [](void* self, const Args&, Store&) {
        as<PerspectiveCamera>(self)->updateProjectionMatrix();
        return chain();
    };
    b.methods["setViewOffset"] = [](void* self, const Args& a, Store&) {
        const Args six = viewOffsetArgs(a);
        as<PerspectiveCamera>(self)->setViewOffset(number(six.at(0)), number(six.at(1)), number(six.at(2)),
                                                    number(six.at(3)), number(six.at(4)), number(six.at(5)));
        return chain();
    };
    b.methods["clearViewOffset"] = [](void* self, const Args&, Store&) {
        as<PerspectiveCamera>(self)->clearViewOffset();
        return chain();
    };
    b.methods["setFocalLength"] = [](void* self, const Args& a, Store&) {
        as<PerspectiveCamera>(self)->setFocalLength(number(a.at(0)));
        return chain();
    };
    b.methods["getFocalLength"] = [](void* self, const Args&, Store&) {
        return Value::of(as<PerspectiveCamera>(self)->getFocalLength());
    };
    b.methods["getEffectiveFOV"] = [](void* self, const Args&, Store&) {
        return Value::of(as<PerspectiveCamera>(self)->getEffectiveFOV());
    };
    b.methods["getFilmWidth"] = [](void* self, const Args&, Store&) {
        return Value::of(as<PerspectiveCamera>(self)->getFilmWidth());
    };
    b.methods["getFilmHeight"] = [](void* self, const Args&, Store&) {
        return Value::of(as<PerspectiveCamera>(self)->getFilmHeight());
    };
    b.methods["getViewSize"] = [](void* self, const Args& a, Store& store) {
        as<PerspectiveCamera>(self)->getViewSize(number(a.at(0)),
                                                  store.ref<Vector2>(a.at(1), "Vector2"));
        return chain();
    };
}

void registerOrthographicCamera(ClassBinding& b) {
    registerCamera(b);
    b.ctor = [](const Args& a, Store&) {
        return std::static_pointer_cast<void>(std::make_shared<OrthographicCamera>(
            optional(a, 0, -1), optional(a, 1, 1), optional(a, 2, 1), optional(a, 3, -1),
            optional(a, 4, 0.1), optional(a, 5, 2000)));
    };
    const std::pair<const char*, double OrthographicCamera::*> kScalars[] = {
        {"zoom", &OrthographicCamera::zoom},       {"left", &OrthographicCamera::left},
        {"right", &OrthographicCamera::right},     {"top", &OrthographicCamera::top},
        {"bottom", &OrthographicCamera::bottom},   {"near", &OrthographicCamera::near},
        {"far", &OrthographicCamera::far},
    };
    for (const auto& [name, field] : kScalars) {
        b.getters[name] = [field](void* self) { return Value::of(as<OrthographicCamera>(self)->*field); };
        b.setters[name] = [field](void* self, const Value& v) {
            as<OrthographicCamera>(self)->*field = number(v);
        };
    }
    b.methods["updateProjectionMatrix"] = [](void* self, const Args&, Store&) {
        as<OrthographicCamera>(self)->updateProjectionMatrix();
        return chain();
    };
    b.methods["setViewOffset"] = [](void* self, const Args& a, Store&) {
        const Args six = viewOffsetArgs(a);
        as<OrthographicCamera>(self)->setViewOffset(number(six.at(0)), number(six.at(1)), number(six.at(2)),
                                                    number(six.at(3)), number(six.at(4)), number(six.at(5)));
        return chain();
    };
    b.methods["clearViewOffset"] = [](void* self, const Args&, Store&) {
        as<OrthographicCamera>(self)->clearViewOffset();
        return chain();
    };
}

// --------------------------------------------------------------------- Scene, Group, Mesh

void registerScene(ClassBinding& b) {
    // registerObject3D first: it installs the base ctor, and the node class replaces it after.
    registerObject3D(b);
    b.ctor = [](const Args&, Store&) {
        return std::static_pointer_cast<void>(std::make_shared<Scene>());
    };
    const std::pair<const char*, double Scene::*> kScalars[] = {
        {"backgroundBlurriness", &Scene::backgroundBlurriness},
        {"backgroundIntensity", &Scene::backgroundIntensity},
        {"environmentIntensity", &Scene::environmentIntensity},
    };
    for (const auto& [name, field] : kScalars) {
        b.getters[name] = [field](void* self) { return Value::of(as<Scene>(self)->*field); };
        b.setters[name] = [field](void* self, const Value& v) { as<Scene>(self)->*field = number(v); };
    }
    // `background` is the caller's Color itself, as in three: `scene.background = c` keeps `c`, so a
    // later write to `c` is a background change, and reading it back answers `c`.
    b.members["background"] = [](void* self, const Args&, Store& store) -> Value {
        // The Color itself, not an alias of the scene: a later `background =` replaces it, and a JS
        // reference to the old one must stay valid.
        return store.share("Color", as<Scene>(self)->background);
    };
    b.setters["background"] = [](void* self, const Value& v, Store& store) {
        Scene* scene = as<Scene>(self);
        if (v.kind == Value::Kind::Null) {
            scene->background = nullptr;
            return;
        }
        Object* color = store.find(v);
        if (color == nullptr || color->cls != "Color") throw Unsupported{"background must be a Color or null"};
        scene->background = std::static_pointer_cast<Color>(color->ptr);
    };
}

void registerGroup(ClassBinding& b) {
    registerObject3D(b);
    b.ctor = [](const Args&, Store&) {
        return std::static_pointer_cast<void>(std::make_shared<Group>());
    };
}

/** A geometry argument of any generator class, matched to one base pointer. */
std::shared_ptr<BufferGeometry> geometryArg(Store& store, const Value& arg) {
    static const char* const kClasses[] = {
        "BufferGeometry", "PlaneGeometry",  "BoxGeometry",   "SphereGeometry", "CylinderGeometry",
        "ConeGeometry",   "CircleGeometry", "TorusGeometry", "RingGeometry"};
    Object* found = store.find(arg);
    if (found == nullptr) throw Unsupported{"argument is not a BufferGeometry"};
    for (const char* cls : kClasses) {
        if (found->cls == cls) return std::static_pointer_cast<BufferGeometry>(found->ptr);
    }
    throw Unsupported{"argument is not a BufferGeometry, it is a " + found->cls};
}

/** A material argument of any mesh-material class, matched to one base pointer. */
std::shared_ptr<Material> materialArg(Store& store, const Value& arg) {
    static const char* const kClasses[] = {"Material",           "MeshBasicMaterial", "MeshLambertMaterial",
                                           "MeshPhongMaterial",  "MeshStandardMaterial", "MeshPhysicalMaterial"};
    Object* found = store.find(arg);
    if (found == nullptr) throw Unsupported{"argument is not a Material"};
    for (const char* cls : kClasses) {
        if (found->cls == cls) return std::static_pointer_cast<Material>(found->ptr);
    }
    throw Unsupported{"argument is not a Material, it is a " + found->cls};
}

void registerMesh(ClassBinding& b) {
    registerObject3D(b);
    // three's Mesh builds a BufferGeometry and a MeshBasicMaterial by default; this port takes both
    // from the caller, so a no-argument Mesh stays empty.
    b.ctor = [](const Args& a, Store& store) -> std::shared_ptr<void> {
        std::shared_ptr<BufferGeometry> geometry;
        std::shared_ptr<Material> material;
        if (!a.empty() && a.at(0).kind == Value::Kind::Ref) geometry = geometryArg(store, a.at(0));
        if (a.size() >= 2 && a.at(1).kind == Value::Kind::Ref) material = materialArg(store, a.at(1));
        return std::static_pointer_cast<void>(std::make_shared<Mesh>(geometry, material));
    };
    b.members["geometry"] = [](void* self, const Args&, Store& store) -> Value {
        return store.share("BufferGeometry", as<Mesh>(self)->geometry);
    };
    b.members["material"] = [](void* self, const Args&, Store& store) -> Value {
        const std::shared_ptr<Material>& material = as<Mesh>(self)->material;
        return material ? store.share(std::string(material->typeName()), material) : Value{};
    };
}

}  // namespace

void registerObject3DBindings(ClassBinding& b) {
    registerObject3D(b);
}

void registerSceneBindings(Registry& classes) {
    registerObject3D(classes["Object3D"]);
    registerCamera(classes["Camera"]);
    registerPerspectiveCamera(classes["PerspectiveCamera"]);
    registerOrthographicCamera(classes["OrthographicCamera"]);
    registerScene(classes["Scene"]);
    registerGroup(classes["Group"]);
    registerMesh(classes["Mesh"]);
}

}  // namespace tn::binding