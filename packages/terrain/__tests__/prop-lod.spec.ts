import { BoxGeometry, MeshBasicMaterial, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import {
  createProps,
  createPropsInSlices,
  variantFor,
} from "../../../examples/strata-terrain-preview/src/render/props.js";
import type { IPlacement } from "../src/index.js";

describe("preview prop distance bookkeeping", () => {
  it("finishes the same prop work through the installed slice scheduler", async () => {
    const material = new MeshBasicMaterial();
    const placements = [
      {
        id: "boulder:outcrop",
        asset: "boulder",
        position: [2, 0, 3],
        rotation: 0,
        scale: 1,
        normal: [0, 1, 0],
        alignToNormal: false,
      },
    ] as IPlacement[];
    const parts = new Map(
      Array.from({ length: 5 }, (_, variant) => [
        `boulder:${variant}`,
        [
          {
            geometry: new BoxGeometry(1, 2, 1),
            role: "stone" as const,
            material,
            variant,
          },
        ],
      ]),
    );
    const materials = {
      bark: material,
      crown: material,
      fern: material,
      grass: material,
      impostor: material,
      needles: material,
      petal: material,
      pine: material,
      stem: material,
      stone: material,
    };
    const ground = () => ({ height: 4, offset: 0 });
    const sync = createProps(placements, ground, parts, materials);
    const sliced = await createPropsInSlices(placements, ground, parts, materials);
    if (!sliced) throw new Error("Prop build stopped unexpectedly");
    expect([...sliced.byId.keys()]).toEqual([...sync.byId.keys()]);
    expect([...sliced.byId.values()].map((entry) => entry.pose.elements)).toEqual(
      [...sync.byId.values()].map((entry) => entry.pose.elements),
    );
    sync.dispose();
    sliced.dispose();
  });

  it("writes only band crossings and preserves the editor's instance slots", () => {
    const material = new MeshBasicMaterial();
    const sameVariantIds = Array.from({ length: 100 }, (_, i) => `spruce:${i}`).filter(
      (id) => variantFor({ id } as IPlacement, "spruce") === 0,
    );
    const placements = [10, 65, 200].map((x, i) => ({
      id: sameVariantIds[i] ?? "missing-id",
      asset: "spruce",
      position: [x, 0, 0],
      rotation: 0,
      scale: 1,
      normal: [0, 1, 0],
      alignToNormal: false,
    })) as IPlacement[];
    // All instances use variant 0, so each level has one draw.
    const parts = new Map(
      Array.from({ length: 5 }, (_, i) => [
        `spruce:${i}`,
        [0, 1, 2].map((level) => ({
          geometry: new BoxGeometry(1, 2, 1),
          material,
          role: "bark" as const,
          variant: i,
          level,
        })),
      ]),
    );
    const props = createProps(placements, () => ({ height: 0, offset: 0 }), parts, {
      bark: material,
      crown: material,
      fern: material,
      grass: material,
      impostor: material,
      needles: material,
      petal: material,
      pine: material,
      stem: material,
      stone: material,
    });
    props.setLevels(new Vector3());
    const writes = props.meshes.map((mesh) => vi.spyOn(mesh, "setMatrixAt"));
    const bounds = props.meshes.map((mesh) => vi.spyOn(mesh, "computeBoundingSphere"));
    props.setLevels(new Vector3(1, 0, 0));
    expect(writes.reduce((n, spy) => n + spy.mock.calls.length, 0)).toBe(0);
    expect(bounds.reduce((n, spy) => n + spy.mock.calls.length, 0)).toBe(0);
    for (const x of [20, 100, 300, 0]) {
      props.setLevels(new Vector3(x, 0, 0));
      for (const instance of props.byId.values()) {
        for (const part of instance.parts) {
          const position = new Vector3().setFromMatrixPosition(instance.pose);
          const drawn = new Vector3().fromArray(
            part.mesh.instanceMatrix.array,
            part.index * 16 + 12,
          );
          expect(drawn.distanceTo(position)).toBeLessThan(1e-6);
          expect(part.mesh.userData.placementIds[part.index]).toBe(instance.placement.id);
        }
      }
    }
    props.dispose();
  });
});
