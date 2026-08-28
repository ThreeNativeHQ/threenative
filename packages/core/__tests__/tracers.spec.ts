import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { TracerPool3D } from "../src/tracers.js";

const forward = new Vector3(0, 0, -1);
const origin = new Vector3(0, 0, 0);

function makePool(count = 3, material = new MeshBasicMaterial()) {
  const parent = new Group();
  const tracers = new TracerPool3D(parent, { count, material });
  return { material, parent, tracers };
}

function surfaceOf(parent: Group, slot: number): MeshBasicMaterial {
  return (parent.children[slot] as Mesh).material as MeshBasicMaterial;
}

describe("TracerPool3D", () => {
  it("fails closed for invalid count, options and spawn arguments", () => {
    const material = new MeshBasicMaterial();
    expect(() => new TracerPool3D(new Group(), { count: 0, material })).toThrow(
      "TracerPool3D.count",
    );
    expect(() => new TracerPool3D(new Group(), { count: 2.5, material })).toThrow(
      "TracerPool3D.count",
    );
    expect(() => new TracerPool3D(new Group(), {} as never)).toThrow("TracerPool3D.material");
    expect(() => new TracerPool3D(new Group(), { material, speed: -1 })).toThrow(
      "TracerPool3D.speed",
    );
    expect(() => new TracerPool3D(new Group(), { lifetime: 0, material })).toThrow(
      "TracerPool3D.lifetime",
    );
    expect(() => new TracerPool3D(new Group(), { material, segmentLength: -3 })).toThrow(
      "TracerPool3D.segmentLength",
    );

    const { tracers } = makePool();
    expect(() => tracers.spawn(origin, new Vector3(0, 0, 0), 10)).toThrow(/direction/);
    expect(() => tracers.spawn(origin, forward, Number.NaN)).toThrow(/distance/);
  });

  it("reuses its pool round-robin without creating meshes", () => {
    const { parent, tracers } = makePool(2);
    for (let shot = 0; shot < 7; shot += 1) tracers.spawn(origin, forward, 10);
    expect(parent.children).toHaveLength(2);
    for (const child of parent.children) expect(child).toBeInstanceOf(Mesh);
  });

  it("keeps every member at zero opacity until first use", () => {
    const { parent } = makePool(2);
    for (const slot of [0, 1]) expect(surfaceOf(parent, slot).opacity).toBe(0);
  });

  it("settle hides idle slots and spawn re-shows the slot it fires", () => {
    const { parent, tracers } = makePool(2);
    tracers.spawn(origin, forward, 10);
    tracers.update(99); // the shot retires
    tracers.settle();
    for (const child of parent.children) expect(child.visible).toBe(false);

    // A live slot stays submitted, and the next spawn wakes its slot.
    tracers.spawn(origin, forward, 10);
    expect(parent.children[1].visible).toBe(true);
    expect(parent.children[0].visible).toBe(false);
    tracers.update(99); // retires the live shot again
    expect(parent.children[1].visible).toBe(false);
  });

  it("treats distances under the minimum as a no-op", () => {
    const { parent, tracers } = makePool(2);
    tracers.spawn(origin, forward, 0.049);
    expect(surfaceOf(parent, 0).opacity).toBe(0);
    expect(surfaceOf(parent, 1).opacity).toBe(0);

    // A separate pool so the boundary shot cannot land on a slot a previous call touched.
    const boundary = makePool(1);
    boundary.tracers.spawn(origin, forward, 0.05);
    expect(surfaceOf(boundary.parent, 0).opacity).toBeGreaterThan(0);
  });

  it("travels a capped segment toward the hit point, fades, then retires", () => {
    const { parent, tracers } = makePool(1);
    tracers.spawn(origin, forward, 10);

    const mesh = parent.children[0] as Mesh;
    // A muzzle lead in front of `from`, stretched to the 3.2 m segment cap along -Z.
    expect(mesh.position.z).toBeCloseTo(-0.16, 6);
    expect(mesh.scale.y).toBeCloseTo(3.2, 6);

    tracers.update(0.01);
    // life 0.10 of 0.11: opacity fading linearly; movement 360 * 0.01 along the direction.
    expect(mesh.position.z).toBeCloseTo(-3.76, 6);
    expect(surfaceOf(parent, 0).opacity).toBeCloseTo(10 / 11, 3);

    tracers.update(0.05);
    // Travel is exhausted (maxTravel 6.64 m), so the streak retires at zero opacity.
    expect(mesh.position.z).toBeCloseTo(-6.8, 6);
    expect(surfaceOf(parent, 0).opacity).toBe(0);

    tracers.update(1);
    expect(mesh.position.z).toBeCloseTo(-6.8, 6);
    expect(surfaceOf(parent, 0).opacity).toBe(0);
  });

  it("orients +Y geometry along the shot direction", () => {
    const { parent, tracers } = makePool(1);
    tracers.spawn(origin, new Vector3(1, 0, 0), 5);
    const mesh = parent.children[0] as Mesh;
    const aligned = new Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
    expect(aligned.x).toBeCloseTo(1, 6);
    expect(aligned.y).toBeCloseTo(0, 6);
    expect(aligned.z).toBeCloseTo(0, 6);
    expect(mesh.scale.y).toBeCloseTo(3.2, 6);
    expect(mesh.position.x).toBeCloseTo(0.16, 6);
  });

  it("fades toward the game surface's own peak opacity", () => {
    const material = new MeshBasicMaterial({ color: 0xffe6b0, opacity: 0.4 });
    const { parent, tracers } = makePool(1, material);
    expect(material.transparent).toBe(true);
    tracers.spawn(origin, forward, 10);
    expect(surfaceOf(parent, 0).opacity).toBeCloseTo(0.4, 6);
  });

  it("takes per-shot width, length and lifetime overrides from the game", () => {
    // A game jitters every shot so two rounds never read as one drawn line, and near shots
    // die faster than far ones. Those numbers stay the game's; the pool just applies them.
    const { parent, tracers } = makePool(2);
    tracers.spawn(origin, forward, 10, { widthScale: 1.35, segmentLength: 2, lifetime: 0.06 });
    const live = parent.children[0] as Mesh;
    expect(live.scale.x).toBeCloseTo(1.35, 6);
    expect(live.scale.z).toBeCloseTo(1.35, 6);
    expect(live.scale.y).toBeCloseTo(2, 6);
    expect(live.position.z).toBeCloseTo(-0.16, 6);

    // Fade runs on the shot's own lifetime, not the pool's.
    tracers.update(0.01);
    expect(surfaceOf(parent, 0).opacity).toBeCloseTo((0.05 / 0.06) * 1, 3);

    // The next shot keeps the pool defaults.
    tracers.spawn(origin, forward, 10);
    const plain = parent.children[1] as Mesh;
    expect(plain.scale.x).toBe(1);
    expect(plain.scale.z).toBe(1);
    expect(plain.scale.y).toBeCloseTo(3.2, 6);
  });

  it("fails closed for invalid per-shot overrides", () => {
    const { tracers } = makePool(1);
    expect(() => tracers.spawn(origin, forward, 10, { widthScale: 0 })).toThrow(/widthScale/);
    expect(() => tracers.spawn(origin, forward, 10, { widthScale: Number.NaN })).toThrow(
      /widthScale/,
    );
    expect(() => tracers.spawn(origin, forward, 10, { segmentLength: -1 })).toThrow(
      /segmentLength/,
    );
    expect(() => tracers.spawn(origin, forward, 10, { lifetime: -0.5 })).toThrow(/lifetime/);
    expect(() =>
      tracers.spawn(origin, forward, 10, { lifetime: Number.POSITIVE_INFINITY }),
    ).toThrow(/lifetime/);
  });

  it("draws with a game-supplied geometry when given one", () => {
    const parent = new Group();
    const geometry = new BoxGeometry(0.05, 1, 0.05);
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const tracers = new TracerPool3D(parent, {
      count: 2,
      geometry,
      material: new MeshBasicMaterial(),
    });
    tracers.spawn(origin, forward, 10);
    for (const child of parent.children) expect((child as Mesh).geometry).toBe(geometry);
    // A game-owned geometry survives the pool: only the pooled default is released.
    tracers.dispose();
    expect(geometryDispose).not.toHaveBeenCalled();
  });

  it("dispose removes the meshes and releases pooled resources once", () => {
    const { parent, tracers } = makePool(2);
    const mesh = parent.children[0] as Mesh;
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");
    const firstSurfaceDispose = vi.spyOn(surfaceOf(parent, 0), "dispose");
    const secondSurfaceDispose = vi.spyOn(surfaceOf(parent, 1), "dispose");

    tracers.dispose();
    expect(parent.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(firstSurfaceDispose).toHaveBeenCalledOnce();
    expect(secondSurfaceDispose).toHaveBeenCalledOnce();

    tracers.dispose();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(firstSurfaceDispose).toHaveBeenCalledOnce();
  });
});
