import type { IAssetLoader } from "@threenative/core";
import {
  BoxGeometry,
  type BufferAttribute,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from "three";
import type { MeshPhysicalNodeMaterial } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { loadPack } from "../../../examples/strata-terrain-preview/src/render/pack.js";
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

describe("licensed pack characterization", () => {
  function present<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw new Error("Missing characterized prop value");
    return value;
  }
  const image = () => new DataTexture(new Uint8Array([80, 150, 50, 255]), 1, 1);
  function fixture(options: { mapped?: boolean; array?: boolean; zeroNormal?: boolean } = {}) {
    const root = new Group();
    const geometry = new BoxGeometry(1, 2, 1).translate(0, 1, 0);
    if (options.zeroNormal) geometry.getAttribute("normal").setXYZ(1, 0, 0, 0);
    const material = new MeshStandardMaterial({
      map: options.mapped === false ? null : image(),
      normalMap: image(),
      alphaTest: 0.33,
    });
    if (options.array) {
      geometry.clearGroups();
      geometry.addGroup(0, 18, 0);
      geometry.addGroup(18, 18, 1);
    }
    const mesh = new Mesh(geometry, options.array ? [material, material.clone()] : material);
    mesh.position.set(2, 3, 4);
    root.add(mesh);
    return { root, mesh, geometry, material };
  }
  async function loaded(near?: Group, far?: Group) {
    const assets = {
      resolve: async () => [],
      model: async (path: string) => {
        if (near && path === "temperate/kite-spruce/0.glb") return { scene: near };
        if (far && path === "prepared/pine-tall-mid.glb") return { scene: far };
        throw new Error(`Missing optional fixture ${path}`);
      },
    } as unknown as IAssetLoader;
    return loadPack(assets);
  }
  it("retains mapped near/far material identity and imported cutoff", async () => {
    const near = fixture();
    const pack = await loaded(near.root, fixture({ mapped: false }).root);
    try {
      const parts = present(pack.parts.get("spruce:0"));
      expect(parts).toHaveLength(2);
      expect(present(parts[0]).material).toBe(present(parts[1]).material);
      const material = present(parts[0]).material as MeshPhysicalNodeMaterial;
      expect(material.alphaTest).toBe(0.33);
      expect(material.map).toBe(near.material.map);
      expect(material.normalMap).toBe(near.material.normalMap);
    } finally {
      pack.dispose();
    }
  });
  it("uses one whole-model base and scale for trunk and crown", async () => {
    const trunk = fixture();
    const crown = fixture();
    trunk.mesh.position.set(0, 3, 0);
    crown.mesh.position.set(0, 5, 0);
    trunk.root.add(crown.mesh);
    const pack = await loaded(trunk.root);
    try {
      const parts = present(pack.parts.get("spruce:0"));
      expect(parts).toHaveLength(2);
      for (const part of parts) part.geometry.computeBoundingBox();
      expect(
        parts.map((part) => [
          present(part.geometry.boundingBox).min.y,
          present(part.geometry.boundingBox).max.y,
        ]),
      ).toEqual([
        [0, 6],
        [6, 12],
      ]);
    } finally {
      pack.dispose();
    }
  });
  it("preserves cached source geometry and leaves source ownership with the loader", async () => {
    const near = fixture();
    const before = ["position", "normal", "uv"].map((key) =>
      Array.from((near.geometry.getAttribute(key) as BufferAttribute).array),
    );
    const indices = Array.from(present(near.geometry.index).array);
    const geometryDisposal = vi.fn();
    const materialDisposal = vi.fn();
    near.geometry.addEventListener("dispose", geometryDisposal);
    near.material.addEventListener("dispose", materialDisposal);
    const pack = await loaded(near.root);
    const geometry = present(present(pack.parts.get("spruce:0"))[0]).geometry;
    geometry.computeBoundingBox();
    expect(present(geometry.boundingBox).min.y).toBe(0);
    expect(present(geometry.boundingBox).max.y).toBe(12);
    expect(present(geometry.boundingBox).min.x).toBeCloseTo(10.08, 5);
    expect(
      ["position", "normal", "uv"].map((key) =>
        Array.from((near.geometry.getAttribute(key) as BufferAttribute).array),
      ),
    ).toEqual(before);
    expect(Array.from(present(near.geometry.index).array)).toEqual(indices);
    pack.dispose();
    expect(geometryDisposal).not.toHaveBeenCalled();
    expect(materialDisposal).not.toHaveBeenCalled();
  });
  it("keeps missing optional art available to the procedural fallback", async () => {
    const pack = await loaded();
    expect(pack.parts.size).toBe(0);
    pack.dispose();
  });
  it("retains material-array mesh sections", async () => {
    const pack = await loaded(fixture({ array: true }).root);
    try {
      expect(pack.parts.get("spruce:0")?.length ?? 0).toBeGreaterThan(0);
    } finally {
      pack.dispose();
    }
  });
  it("retains a valid untextured near mesh", async () => {
    const pack = await loaded(fixture({ mapped: false }).root);
    try {
      expect(pack.parts.get("spruce:0")?.length ?? 0).toBeGreaterThan(0);
    } finally {
      pack.dispose();
    }
  });
  it("repairs zero normals beyond the first vertex", async () => {
    const pack = await loaded(fixture({ zeroNormal: true }).root);
    try {
      const normal = present(present(pack.parts.get("spruce:0"))[0]).geometry.getAttribute(
        "normal",
      );
      expect(Math.hypot(normal.getX(1), normal.getY(1), normal.getZ(1))).toBeGreaterThan(0.01);
    } finally {
      pack.dispose();
    }
  });
  it("disposes shared near/far material once", async () => {
    const pack = await loaded(fixture().root, fixture({ mapped: false }).root);
    const unique = new Set([...pack.parts.values()].flat().map((part) => present(part.material)));
    const spies = [...unique].map((material) => {
      const spy = vi.fn();
      material.addEventListener("dispose", spy);
      return spy;
    });
    pack.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
