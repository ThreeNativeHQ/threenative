import { THREE, assertCondition, startVisualScene } from "./scene-support.js";

export function assertHierarchyProof(parent, child, grandchild) {
  assertCondition(child.parent === parent, "child must belong to parent");
  assertCondition(grandchild.parent === child, "grandchild must belong to child");
  parent.updateMatrixWorld(true);
  const world = grandchild.getWorldPosition(new THREE.Vector3());
  assertCondition(
    world.distanceTo(new THREE.Vector3(0.1, 1, 0.27)) < 1e-6,
    "nested world transform mismatch",
  );
  return world.toArray();
}

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "hierarchy", ({ scene }) => {
    const parent = new THREE.Group();
    parent.position.set(-0.8, -0.2, 0);
    parent.scale.setScalar(1.5);
    const parentMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.65, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x805ad5 }),
    );
    const child = new THREE.Group();
    child.position.set(0.8, 0.3, 0);
    const childMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.46, 0.24),
      new THREE.MeshBasicMaterial({ color: 0x38b2ac }),
    );
    const grandchild = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 32),
      new THREE.MeshBasicMaterial({ color: 0xf6e05e }),
    );
    grandchild.position.set(-0.2, 0.5, 0.18);
    parent.add(parentMesh, child);
    child.add(childMesh, grandchild);
    scene.add(parent);
    const worldPosition = assertHierarchyProof(parent, child, grandchild);
    return { parent, child, grandchild, detail: { worldPosition } };
  });
}
