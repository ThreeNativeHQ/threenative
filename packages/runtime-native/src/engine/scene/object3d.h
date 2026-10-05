#pragma once

// Object3D, Layers and EventDispatcher, ported from three@0.185.1 src/core/{Object3D,Layers,
// EventDispatcher}.js. Ownership is a heap record per object: an Object3D never moves, and its
// transform members are plain fields, so `&object.position` is the same address on every access and
// survives any number of insertions into a sibling list.
//
// Not ported, and why:
//   - `clone`, `toJSON`, `raycast`: out of scope for the object model (PRD-508 phases 1-2).
//   - `userData`, `animations`, `customDepthMaterial`, `customDistanceMaterial`, `static`,
//     `uuid`: a bag, an animation list, renderer-only materials and a renderer fast-path flag.
//   - `onBeforeShadow`/`onAfterShadow`/`onBeforeRender`/`onAfterRender`: renderer callbacks that
//     only a renderer calls (PRD-514).
//   - `modelViewMatrix`, `normalMatrix`: the renderer's per-frame matrices (PRD-514).
//   - `getObjectsByProperty`: the single-result form above is all the object model needs.
//   - `isMesh`, `isScene`, `isGroup`, `isCamera`, `isLight` booleans: C++ answers them with the
//     class itself, and `isCamera`/`isLight` (the only two Object3D reads) are virtual below.
//   - `copy`'s `recursive` branch: it clones children, and `clone` is not ported.
//   - `Object.defineProperty` descriptors: plain members, which is what a C++ caller expects.
//
// Lifetime: a child is a borrowed pointer, so an attached object must outlive its parent's use. That
// is what the reference gets from the garbage collector, and what `std::shared_ptr` ownership in a
// caller (or the binding Store) gives here.

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "engine/foundation/math/Euler.h"
#include "engine/foundation/math/Matrix.h"
#include "engine/foundation/math/Quaternion.h"
#include "engine/foundation/math/Vector.h"

namespace tn::engine {

class Object3D;

/**
 * A dispatched event, three's shape: the type, the dispatcher as `target`, and `child` for the two
 * child-lifecycle events. `type` names a static string; it never owns one.
 */
struct Event {
    std::string_view type;
    Object3D* target = nullptr;
    Object3D* child = nullptr;
};

/**
 * three's EventDispatcher: one listener list per event type, and a dispatch that copies the list
 * before calling it, so a listener may remove itself while the event is being delivered. A listener
 * is a function pointer plus a context, so registering one costs no allocation.
 *
 * It exists here only as Object3D's base, so the `target` a dispatch stamps on the event is
 * `static_cast<Object3D*>(this)`.
 */
class EventDispatcher {
public:
    using Listener = void (*)(const Event& event, void* context);

    /** Adds the listener for `type`, unless that exact listener is already registered for it. */
    void addEventListener(std::string_view type, Listener listener, void* context);
    [[nodiscard]] bool hasEventListener(std::string_view type, Listener listener, void* context) const;
    void removeEventListener(std::string_view type, Listener listener, void* context);
    void dispatchEvent(Event& event);

private:
    struct Entry {
        Listener listener;
        void* context;
    };
    // std::less<> keeps the lookup by string_view from allocating a temporary std::string.
    std::map<std::string, std::vector<Entry>, std::less<>> listeners_;
};

/** three's Layers: a 32-bit membership mask, layer 0 by default. */
class Layers {
public:
    uint32_t mask = 1;

    void set(int layer) { mask = static_cast<uint32_t>(1) << layer; }
    void enable(int layer) { mask |= static_cast<uint32_t>(1) << layer; }
    void enableAll() { mask = 0xffffffffu; }
    void toggle(int layer) { mask ^= static_cast<uint32_t>(1) << layer; }
    void disable(int layer) { mask &= ~(static_cast<uint32_t>(1) << layer); }
    void disableAll() { mask = 0; }
    [[nodiscard]] bool test(const Layers& layers) const { return (mask & layers.mask) != 0; }
    [[nodiscard]] bool isEnabled(int layer) const { return (mask & (static_cast<uint32_t>(1) << layer)) != 0; }
};

class Object3D : public EventDispatcher {
public:
    Object3D();
    Object3D(const Object3D&) = delete;
    Object3D& operator=(const Object3D&) = delete;
    /** Children are borrowed, so destroying one does not touch the tree; see the header note. */
    virtual ~Object3D() = default;
    // A destructor deliberately does not detach: a child outliving its parent, or the reverse, would
    // then write through a pointer the other side has already freed. A caller that re-parents a
    // dying object calls `removeFromParent` first, as the reference's owners do.

    /** three's `type` string, the class name a loader would serialize. */
    [[nodiscard]] virtual std::string_view type() const { return "Object3D"; }
    /** The two type tests three's own code reads inside Object3D: `lookAt` picks its order by them. */
    [[nodiscard]] virtual bool isCamera() const { return false; }
    [[nodiscard]] virtual bool isLight() const { return false; }

    /** three's `_object3DId ++`: a process-wide counter starting at zero. */
    [[nodiscard]] uint64_t id() const { return id_; }
    std::string name;  // not a renderer input, so a plain field: writes do not bump `revision()`

    Object3D* parent = nullptr;
    std::vector<Object3D*> children;

    /** `Object3D.DEFAULT_UP`, the up direction a new object copies. */
    static Vector3 defaultUp;
    static bool defaultMatrixAutoUpdate;
    static bool defaultMatrixWorldAutoUpdate;

    // The transform. Plain fields: their addresses are stable for the object's whole life.
    Vector3 position;
    Euler rotation;
    Quaternion quaternion;
    Vector3 scale{1, 1, 1};
    Vector3 up{0, 1, 0};
    Matrix4 matrix;
    Matrix4 matrixWorld;
    /** r185's pivot: rotation and scale apply around this point instead of the origin. */
    std::optional<Vector3> pivot;

    bool matrixAutoUpdate = true;
    bool matrixWorldAutoUpdate = true;
    bool matrixWorldNeedsUpdate = false;
    bool frustumCulled = true;

    /** The renderer's inputs. Each setter bumps `revision()`; a direct field write cannot. */
    [[nodiscard]] bool visible() const { return visible_; }
    void setVisible(bool value);
    [[nodiscard]] bool castShadow() const { return castShadow_; }
    void setCastShadow(bool value);
    [[nodiscard]] bool receiveShadow() const { return receiveShadow_; }
    void setReceiveShadow(bool value);
    [[nodiscard]] int renderOrder() const { return renderOrder_; }
    void setRenderOrder(int value);
    [[nodiscard]] const Layers& layers() const { return layers_; }
    /** Every Layers mutation goes through here or through one of the wrappers below, so it counts. */
    void setLayerMask(uint32_t mask);
    void setLayer(int layer);
    void enableLayer(int layer);
    void enableAllLayers();
    void toggleLayer(int layer);
    void disableLayer(int layer);
    void disableAllLayers();

    /**
     * The renderer's change counter (PRD-508 §6.4). It counts the writes the renderer must react
     * to, and nothing else: every transform method below, `updateMatrix`, `add`/`remove`/`attach`/
     * `clear` (which bump the object they are called on, so `child.removeFromParent()` bumps the
     * parent), every setter above, and `copy`. A direct write to `position`, `quaternion`,
     * `rotation`, `scale`, `up`, `matrix`, `matrixWorld`, `pivot` or the auto-update flags is a C++
     * field write the engine cannot see; its sync point is `updateMatrix`, which the renderer calls
     * when `matrixAutoUpdate` is on.
     */
    [[nodiscard]] uint64_t revision() const { return revision_; }

    using Visitor = void (*)(Object3D& object, void* context);

    // ---- transforms, three's order
    void applyMatrix4(const Matrix4& m);
    Object3D& applyQuaternion(const Quaternion& q);
    void setRotationFromAxisAngle(const Vector3& axis, double angle);
    void setRotationFromEuler(const Euler& euler);
    void setRotationFromMatrix(const Matrix4& m);
    void setRotationFromQuaternion(const Quaternion& q);
    Object3D& rotateOnAxis(const Vector3& axis, double angle);
    Object3D& rotateOnWorldAxis(const Vector3& axis, double angle);
    Object3D& rotateX(double angle);
    Object3D& rotateY(double angle);
    Object3D& rotateZ(double angle);
    Object3D& translateOnAxis(const Vector3& axis, double distance);
    Object3D& translateX(double distance);
    Object3D& translateY(double distance);
    Object3D& translateZ(double distance);
    Vector3& localToWorld(Vector3& vector);
    Vector3& worldToLocal(Vector3& vector);
    void lookAt(const Vector3& target);
    void lookAt(double x, double y, double z);

    // ---- hierarchy
    Object3D& add(Object3D& object);
    Object3D& add(const std::vector<Object3D*>& objects);
    Object3D& remove(Object3D& object);
    /** The vector form is what `clear` passes, and how a loader adds a whole list. */
    Object3D& remove(const std::vector<Object3D*>& objects);
    Object3D& removeFromParent();
    Object3D& clear();
    Object3D& attach(Object3D& object);

    [[nodiscard]] Object3D* getObjectById(uint64_t id);
    [[nodiscard]] Object3D* getObjectByName(std::string_view name);
    /**
     * three's `getObjectByProperty`, narrowed to the string-valued properties this class has
     * (`name` and `type`). Any other property matches nothing, which is what three's strict
     * comparison already answers for a property Object3D does not carry.
     */
    [[nodiscard]] Object3D* getObjectByProperty(std::string_view property, std::string_view value);

    // ---- synchronous world queries
    Vector3& getWorldPosition(Vector3& target);
    Quaternion& getWorldQuaternion(Quaternion& target);
    Vector3& getWorldScale(Vector3& target);
    virtual Vector3& getWorldDirection(Vector3& target);

    void traverse(Visitor visitor, void* context);
    void traverseVisible(Visitor visitor, void* context);
    void traverseAncestors(Visitor visitor, void* context);

    virtual void updateMatrix();
    virtual void updateMatrixWorld(bool force = false);
    virtual void updateWorldMatrix(bool updateParents, bool updateChildren, bool force = false);

    /** three's `copy` without its `recursive` branch: fields only, because `clone` is not ported. */
    Object3D& copy(const Object3D& source);

private:
    void bump() { ++revision_; }

    static void onRotationChange(void* context);
    static void onQuaternionChange(void* context);

    bool visible_ = true;
    bool castShadow_ = false;
    bool receiveShadow_ = false;
    int renderOrder_ = 0;
    Layers layers_;
    uint64_t id_ = 0;
    uint64_t revision_ = 0;
};

}  // namespace tn::engine