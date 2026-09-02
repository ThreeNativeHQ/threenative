import {
  Bone,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
} from "three";
import { describe, expect, it } from "vitest";
import { normaliseToMetres } from "../src/index.js";

describe("normaliseToMetres", () => {
  it("returns the applied factor and normalises a rigid object's longest axis", () => {
    const object = new Mesh(new BoxGeometry(2, 4, 2), new MeshBasicMaterial());

    const factor = normaliseToMetres(object, { metres: 2, axis: "longest" });

    expect(factor).toBeCloseTo(0.5, 6);
    expect(object.scale.x).toBeCloseTo(0.5, 6);
  });

  it("preserves Three.js's non-precise world-box contract for longest axis", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([1, 0.5, 0, 0, 0.5, 0, 0.5, 1, 0, 0.5, 0, 0], 3),
    );
    const object = new Mesh(geometry, new MeshBasicMaterial());
    object.rotation.z = Math.PI / 4;

    const factor = normaliseToMetres(object, { metres: 1, axis: "longest" });

    expect(factor).toBeCloseTo(1 / Math.SQRT2, 6);
  });

  /**
   * A skinned mesh's geometry bounding box describes its vertices in *bind* space. Where those
   * vertices actually render is `sum(w * bone.matrixWorld * boneInverse) * position` — a different
   * space entirely whenever the rig carries scale, which every quantized import does, because the
   * dequantisation lands in the inverse bind matrices.
   *
   * `Box3.setFromObject` gets this right and so does `normaliseToMetres`; this test is here
   * because that contract had no coverage and a game that hand-rolls the measurement instead
   * gets it wrong. Wildwood did: its own walker read `matrixWorld * POSITION`, reported a fox at
   * 1.96 units that renders at 0.33, and normalised the animal to an ant.
   */
  it("measures a skinned rig's longest axis where the skin renders, not where it binds", () => {
    const geometry = new BufferGeometry();
    // Two metres wide in bind space.
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 0.1, 0], 3),
    );
    geometry.setAttribute(
      "skinIndex",
      new Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4),
    );
    geometry.setAttribute(
      "skinWeight",
      new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
    );
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    const bone = new Bone();
    mesh.add(bone);
    mesh.bind(new Skeleton([bone]));
    // The rig halves it: the skin renders one metre wide, not two.
    bone.scale.setScalar(0.5);
    const object = new Group();
    object.add(mesh);
    object.updateWorldMatrix(true, true);

    const factor = normaliseToMetres(object, { metres: 1, axis: "longest" });

    // Already one metre as rendered, so nothing should be scaled. Measured in bind space it
    // reads two metres and the rig is wrongly halved again.
    expect(factor).toBeCloseTo(1, 6);
  });

  it("uses a stable crown/end bone when a rig also contains Head", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([-0.1, 0, 0, 0.1, 0, 0, -0.1, 4, 0, 0.1, 4, 0], 3),
    );
    geometry.setAttribute(
      "skinIndex",
      new Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
    );
    geometry.setAttribute(
      "skinWeight",
      new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
    );
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    const hips = new Bone();
    const head = new Bone();
    head.name = "Head";
    head.position.y = 1.5;
    const crown = new Bone();
    crown.name = "HeadTop_End";
    crown.position.y = 0.25;
    head.add(crown);
    hips.add(head);
    mesh.add(hips);
    mesh.bind(new Skeleton([hips, head, crown]));
    const object = new Group();
    object.add(mesh);
    object.updateWorldMatrix(true, true);

    const factor = normaliseToMetres(object, { metres: 1, axis: "height" });

    expect(factor).toBeCloseTo(1 / 1.75, 6);
    expect(crown.matrixWorld.elements[13]).toBeCloseTo(1, 6);
    expect(head.matrixWorld.elements[13]).toBeCloseTo(1.5 / 1.75, 6);
  });
});
