// PRD-508 phase 1: the scene graph's own contract, tested against the C++ classes rather than the
// reference, because these are the properties the differential fixtures cannot state: the reference
// has no counter to compare and no alias to observe.
//
// Cases: `hierarchy` (add/remove/attach/clear, re-parenting, traversal order, lookup, event order)
// and `alias` (`&mesh.position` is one address across 10,000 sibling insertions, and the binding
// Store hands the same Ref for it every time).

#include "check.h"
#include "fixture/driver.h"

#include "engine/abi/bindings.h"
#include "engine/foundation/math/Vector.h"
#include "engine/scene/nodes.h"
#include "engine/scene/object3d.h"

#include <cmath>
#include <memory>
#include <string>
#include <vector>

namespace {

using namespace tn::engine;

// The event log both event cases assert on: three stamps `target`, and a child event names the child.
struct Recorded {
    std::vector<std::string> order;
};

void record(const Event& event, void* context) {
    auto* log = static_cast<Recorded*>(context);
    std::string line(event.type);
    line += ':';
    line += event.target->name;
    if (event.child != nullptr) {
        line += '/';
        line += event.child->name;
    }
    log->order.push_back(line);
}

void collect(Object3D& object, void* context) {
    static_cast<std::vector<std::string>*>(context)->push_back(object.name);
}

/** A named node on the heap: an Object3D never moves, which is the whole point of the alias case. */
std::unique_ptr<Object3D> node(const std::string& name) {
    auto object = std::make_unique<Object3D>();
    object->name = name;
    return object;
}

void hierarchy() {
    // ---- add, traversal order, lookup
    Object3D root;
    root.name = "root";
    auto a = node("a");
    auto b = node("b");
    auto a1 = node("a1");
    root.add(*a);
    root.add(*b);
    a->add(*a1);

    CHECK(root.children.size() == 2);
    CHECK(root.children[0] == a.get() && root.children[1] == b.get());
    CHECK(a->parent == &root && a1->parent == a.get());
    CHECK(a1->parent->parent == &root);

    std::vector<std::string> visited;
    root.traverse(&collect, &visited);
    CHECK(visited == std::vector<std::string>({"root", "a", "a1", "b"}));

    root.setVisible(false);
    visited.clear();
    root.traverseVisible(&collect, &visited);
    CHECK(visited.empty());  // an invisible root hides its whole subtree
    root.setVisible(true);

    visited.clear();
    a1->traverseAncestors(&collect, &visited);
    CHECK(visited == std::vector<std::string>({"a", "root"}));

    CHECK(root.getObjectByName("a1") == a1.get());
    CHECK(root.getObjectByName("nope") == nullptr);
    CHECK(root.getObjectByName("a") == a.get());  // the search starts at the object itself
    CHECK(root.getObjectById(root.id()) == &root);
    CHECK(root.getObjectById(a1->id()) == a1.get());
    CHECK(root.getObjectById(9999) == nullptr);
    CHECK(root.getObjectByProperty("type", "Object3D") == &root);

    // ---- re-parenting removes from the old parent
    b->add(*a1);
    CHECK(a->children.empty());
    CHECK(b->children.size() == 1 && b->children[0] == a1.get());
    CHECK(a1->parent == b.get());
    root.add(*a);  // and `add` re-parents too
    CHECK(a->parent == &root);

    // ---- remove detaches without destroying, and clear empties
    root.remove(*a);
    CHECK(root.children.size() == 1 && root.children[0] == b.get());
    CHECK(a->parent == nullptr);
    CHECK(a->children.empty());  // a1 was re-parented to b, so `a` owns nothing now

    auto doomed = node("doomed");
    root.add(*doomed);
    root.clear();
    CHECK(root.children.empty());
    CHECK(doomed->parent == nullptr);
    CHECK(doomed->name == "doomed");  // still alive after clear, as three leaves it
    // clear() walks a copy: removing from the live list while iterating it skips every second child.
    auto c1 = node("c1"), c2 = node("c2"), c3 = node("c3");
    root.add(*c1);
    root.add(*c2);
    root.add(*c3);
    root.clear();
    CHECK(root.children.empty());
    CHECK(c1->parent == nullptr && c2->parent == nullptr && c3->parent == nullptr);

    // ---- attach preserves the world transform
    auto target = node("target");
    target->position.set(2, 0, 0);
    target->rotateY(0.5);
    auto mover = node("mover");
    mover->position.set(0, 4, 0);
    mover->scale.set(2, 2, 2);
    root.add(*mover);
    root.add(*target);
    root.updateMatrixWorld(true);

    Vector3 before;
    target->getWorldPosition(before);
    mover->attach(*target);
    Vector3 after;
    target->getWorldPosition(after);
    CHECK(mover->children.size() == 1 && mover->children[0] == target.get());
    CHECK(target->parent == mover.get());
    CHECK(before.x == after.x && before.y == after.y && before.z == after.z);

    // ---- events, in the reference's order: the child first, then the parent
    Recorded log;
    Object3D parent;
    parent.name = "p";
    auto kid = node("k");
    parent.addEventListener("childadded", &record, &log);
    parent.addEventListener("childremoved", &record, &log);
    kid->addEventListener("added", &record, &log);
    kid->addEventListener("removed", &record, &log);

    parent.add(*kid);
    CHECK(log.order == std::vector<std::string>({"added:k", "childadded:p/k"}));

    log.order.clear();
    parent.remove(*kid);
    CHECK(log.order == std::vector<std::string>({"removed:k", "childremoved:p/k"}));

    // A listener that removes itself while the event is delivered does not disturb the rest.
    Recorded inner;
    kid->addEventListener("added", &record, &inner);
    log.order.clear();
    parent.add(*kid);
    CHECK(inner.order.size() == 1);
    parent.remove(*kid);
    kid->removeEventListener("added", &record, &inner);
    CHECK(!kid->hasEventListener("added", &record, &inner));
    CHECK(parent.hasEventListener("childadded", &record, &log));
    parent.removeEventListener("childadded", &record, &log);
    CHECK(!parent.hasEventListener("childadded", &record, &log));

    // ---- the revision counter counts what the renderer must react to
    Object3D watched;
    const uint64_t start = watched.revision();
    watched.setVisible(false);
    CHECK(watched.revision() == start + 1);
    watched.setRenderOrder(3);
    watched.setCastShadow(true);
    watched.setReceiveShadow(true);
    watched.enableLayer(2);
    CHECK(watched.layers().isEnabled(2));
    watched.rotateY(0.25);
    watched.translateX(1);
    watched.updateMatrix();
    auto child2 = node("c2");
    watched.add(*child2);
    watched.remove(*child2);
    CHECK(watched.revision() >= start + 8);

    // ---- rotation and quaternion stay in step, as three's two callbacks do
    Object3D spun;
    spun.setRotationFromEuler(Euler(0.3, 0.9, -0.2, EulerOrder::XYZ));
    // three keeps the object's own order, and writes the Euler back from the quaternion.
    CHECK(spun.rotation.order == EulerOrder::XYZ);
    CHECK(std::abs(spun.rotation.x - 0.3) < 1e-12);
    CHECK(std::abs(spun.rotation.y - 0.9) < 1e-12);
    CHECK(std::abs(spun.rotation.z + 0.2) < 1e-12);

    const Quaternion fromEuler = spun.quaternion;
    spun.setRotationFromQuaternion(fromEuler);
    CHECK(spun.quaternion.x == fromEuler.x && spun.quaternion.y == fromEuler.y &&
          spun.quaternion.z == fromEuler.z && spun.quaternion.w == fromEuler.w);

    // A quaternion write is what moves the Euler, exactly as three's second callback does.
    spun.setRotationFromAxisAngle(Vector3(0, 0, 1), 0.75);
    CHECK(std::abs(spun.rotation.z - 0.75) < 1e-12);
}

void alias() {
    auto mesh = std::make_shared<Mesh>();
    Vector3* first = &mesh->position;

    // The alias survives any number of insertions into a sibling list, because the object is one
    // heap record and its transform members are plain fields inside it.
    std::vector<std::unique_ptr<Object3D>> siblings;
    siblings.reserve(10001);
    for (int i = 0; i < 10000; ++i) {
        auto sibling = std::make_unique<Object3D>();
        sibling->position.set(i, 0, 0);
        mesh->add(*sibling);
        siblings.push_back(std::move(sibling));
    }
    CHECK(mesh->children.size() == 10000);
    CHECK(&mesh->position == first);
    CHECK(&mesh->scale != first);  // position and scale are two members of one record

    // r185's pivot: rotation and scale apply around it, so the pivot itself does not move. The claim
    // is `matrix * p == position + p`, because three moves the origin by `p - R*S*p`; without the
    // pivot the same product lands at `position + R*S*p`. The protocol cannot set a pivot (its
    // `set` carries one value and three's pivot starts null), so this is the whole of its proof.
    const Vector3 anchor(1.5, -0.5, 2);
    mesh->pivot = anchor;
    mesh->position.set(-2, 3, 0.25);
    mesh->scale.set(2, 3, 4);
    mesh->rotateY(0.7);
    mesh->updateMatrix();
    Vector3 fixed = mesh->position;
    fixed.add(anchor);
    Vector3 moved = anchor;
    moved.applyMatrix4(mesh->matrix);
    CHECK(std::abs(moved.x - fixed.x) < 1e-12);
    CHECK(std::abs(moved.y - fixed.y) < 1e-12);
    CHECK(std::abs(moved.z - fixed.z) < 1e-12);
    mesh->pivot.reset();
    mesh->updateMatrix();
    moved = anchor;
    moved.applyMatrix4(mesh->matrix);
    CHECK(std::abs(moved.y - fixed.y) > 1e-6);  // without the pivot the point does move

    // Writes through either alias are the same write.
    mesh->position.y = 4.5;
    CHECK(first->y == 4.5);
    Vector3& alsoPosition = mesh->position;
    alsoPosition.set(1, 2, 3);
    CHECK(mesh->position.x == 1 && mesh->position.z == 3);
    CHECK(&mesh->position == first);

    // The binding Store answers the same Ref for the member every time, and it is the live member.
    tn::fixture::Driver driver;
    tn::binding::registerAll(driver.classes);
    const tn::binding::Value owner =
        driver.adopt("Mesh", std::static_pointer_cast<void>(mesh));
    CHECK(driver.ref<Mesh>(owner, "Mesh").position.x == 1);

    const tn::binding::Value firstRef = driver.adoptAlias("Vector3", &mesh->position, mesh.get());
    const tn::binding::Value secondRef = driver.adoptAlias("Vector3", &mesh->position, mesh.get());
    CHECK(firstRef.text == secondRef.text);
    CHECK(driver.ref<Vector3>(firstRef, "Vector3").x == 1);

    mesh->position.x = 42;
    CHECK(driver.ref<Vector3>(firstRef, "Vector3").x == 42);

    // The alias keeps its owner alive: dropping the caller's only other reference still leaves the
    // member readable, which is what an aliasing shared_ptr is for.
    mesh.reset();
    CHECK(driver.ref<Vector3>(firstRef, "Vector3").x == 42);
    CHECK(driver.ref<Vector3>(firstRef, "Vector3").y == 2);
}


// `revision` counts changes, not recomputes: three's renderer calls scene.updateMatrixWorld() every
// frame, which recomposes every auto-update object, and a still scene must read as unchanged.
void revision() {
    Object3D scene;
    auto parent = node("parent");
    auto child = node("child");
    scene.add(*parent);
    parent->add(*child);
    child->position.set(1, 2, 3);
    scene.updateMatrixWorld();
    const uint64_t settledParent = parent->revision(), settledChild = child->revision();
    for (int frame = 0; frame < 300; ++frame) scene.updateMatrixWorld();
    CHECK(parent->revision() == settledParent);
    CHECK(child->revision() == settledChild);
    for (int frame = 0; frame < 300; ++frame) scene.updateWorldMatrix(false, true);
    CHECK(child->revision() == settledChild);

    // Moving the parent changes the child's world matrix, so both read as changed.
    parent->position.x = 5;
    scene.updateMatrixWorld();
    CHECK(parent->revision() > settledParent);
    CHECK(child->revision() > settledChild);
    CHECK(child->matrixWorld.elements[12] == 6);
}

}  // namespace

TN_TEST_MAIN({"hierarchy", hierarchy}, {"alias", alias}, {"revision", revision})
