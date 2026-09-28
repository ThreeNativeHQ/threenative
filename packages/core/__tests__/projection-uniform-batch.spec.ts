import {
  BoxGeometry,
  Color,
  type InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Scene,
  type Texture,
} from "three";
import { describe, expect, it } from "vitest";
import { uniformUnchanged } from "../src/projection-uniform.js";
import { SceneRenderProjection } from "../src/renderProjection.js";

/**
 * PRD-449 R3. A lattice where every cube owns a material that differs from its neighbours only in
 * base colour — L4, and the shape a real game gets for free from cloning a material per object.
 *
 * Before this, each of those materials keyed its own group, so the projection declined the scene as
 * not worth its own cost and 2,375 cubes were drawn one at a time. The claim these rows hold is
 * narrow and load-bearing: **one draw, one per-instance colour, and pixels identical to drawing
 * every material on its own.** The second half is the half an optimizer can silently lose, so every
 * row after the first mutates a *settled* scene and asks what the renderer was handed this frame.
 */

const GEOMETRY = new BoxGeometry(1, 1, 1);

function tintOf(index: number): number {
  return 0xff0000 | (index & 0x00ffff);
}

/** `count` cubes on one shared geometry, each with its own colour-only material clone. */
function uniformLattice(count: number): { scene: Scene; meshes: Mesh[] } {
  const scene = new Scene();
  const meshes: Mesh[] = [];
  for (let index = 0; index < count; index += 1) {
    const material = new MeshStandardMaterial({ color: 0xb8c4cc, metalness: 0, roughness: 0.75 });
    material.color.setHex(tintOf(index));
    const mesh = new Mesh(GEOMETRY, material);
    mesh.position.set(index % 8, Math.floor(index / 8), 0);
    scene.add(mesh);
    meshes.push(mesh);
  }
  return { scene, meshes };
}

function sharedLattice(count: number): {
  scene: Scene;
  meshes: Mesh[];
  material: MeshStandardMaterial;
} {
  const scene = new Scene();
  const material = new MeshStandardMaterial({ color: 0x3366aa });
  const meshes: Mesh[] = [];
  for (let index = 0; index < count; index += 1) {
    const mesh = new Mesh(GEOMETRY, material);
    mesh.position.set(index % 8, Math.floor(index / 8), 0);
    scene.add(mesh);
    meshes.push(mesh);
  }
  return { scene, meshes, material };
}

function project(scene: Scene, frames = 2): SceneRenderProjection {
  const projection = new SceneRenderProjection(scene, { minMeshes: 8, onReport: () => undefined });
  for (let frame = 0; frame < frames; frame += 1) projection.reconcile();
  return projection;
}

/**
 * Reconciles until every member carries a watch, which the install budget spreads over frames.
 *
 * The cap is the fail-closed half: a budget that never spent anything would leave every member on
 * the exact poll forever, which is correct and slow, and this is what says so rather than passing
 * on a spec that asserts nothing about the watch.
 */
function watched(projection: SceneRenderProjection, meshes: Mesh[]): boolean {
  for (let frame = 0; frame < 400; frame += 1) {
    projection.reconcile();
    if (meshes.every((mesh) => hasWatch(mesh.material as Material))) return true;
  }
  return false;
}

/** Whether a material's own properties are accessor pairs over a change-notification store. */
function hasWatch(material: Material): boolean {
  return Object.getOwnPropertyDescriptor(material, "roughness")?.get !== undefined;
}

/** Whether a name is one of the material's own enumerable properties, which is what a signature reads. */
function enumerates(material: Material, key: string): boolean {
  return Object.getOwnPropertyDescriptor(material, key)?.enumerable === true;
}

/** A plain data property, which is what a material goes back to when it leaves its group. */
function isPlain(material: Material, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(material, key);
  return (
    descriptor !== undefined &&
    descriptor.get === undefined &&
    descriptor.set === undefined &&
    descriptor.writable === true &&
    descriptor.enumerable === true &&
    descriptor.configurable === true
  );
}

function onlyBatch(root: Scene): InstancedMesh {
  const found: InstancedMesh[] = [];
  root.traverse((object) => {
    if ((object as InstancedMesh).isInstancedMesh === true) found.push(object as InstancedMesh);
  });
  if (found.length !== 1) throw new Error(`expected one mirror draw, found ${found.length}`);
  return found[0] as InstancedMesh;
}

/** The instance slot holding this source, found through the matrix the mirror actually wrote. */
function slotOf(batch: InstancedMesh, mesh: Mesh): number {
  const baked = new Matrix4();
  for (let slot = 0; slot < batch.count; slot += 1) {
    batch.getMatrixAt(slot, baked);
    if (baked.equals(mesh.matrixWorld)) return slot;
  }
  throw new Error("the mirror holds no instance for this source");
}

function drawnColor(batch: InstancedMesh, mesh: Mesh): number[] {
  const color = new Color();
  batch.getColorAt(slotOf(batch, mesh), color);
  return [color.r, color.g, color.b];
}

function sourceColor(mesh: Mesh): number[] {
  const color = (mesh.material as MeshStandardMaterial).color;
  return [color.r, color.g, color.b];
}

/**
 * The instance colour is a float32 buffer, so it is the source colour to single precision — the
 * precision every instanced attribute in three is stored at, and the precision the GPU reads.
 */
function expectDrawnColor(batch: InstancedMesh, mesh: Mesh): void {
  const drawn = drawnColor(batch, mesh);
  const source = sourceColor(mesh);
  drawn.forEach((value, index) => {
    expect(value).toBeCloseTo(source[index] as number, 6);
  });
}

describe("uniform-colour instanced batches", () => {
  it("draws materials that differ only in colour as one instanced draw with per-instance colour", () => {
    const { scene, meshes } = uniformLattice(64);

    const projection = project(scene);

    expect(projection.deoptimized).toBe(false);
    expect(projection.report.batches).toBe(1);
    expect(projection.report.projectedObjects).toBe(64);
    expect(projection.report.resultDrawCandidates).toBe(1);

    const batch = onlyBatch(projection.root);
    // The draw carries a material the mirror owns, so nothing the game does to its own instance can
    // reach the draw by accident — and never the game's instance, which 64 cubes still hold.
    expect(meshes.some((mesh) => mesh.material === batch.material)).toBe(false);
    expect((batch.material as MeshStandardMaterial).color.getHex()).toBe(0xffffff);
    // Every instance is coloured from its own source material, to the precision the buffer holds.
    for (const mesh of meshes) {
      expectDrawnColor(batch, mesh);
    }
  });

  it("writes a recoloured material into that one instance and rebuilds no draw", () => {
    const { scene, meshes } = uniformLattice(64);
    const projection = project(scene, 3);
    const batch = onlyBatch(projection.root);
    const before = meshes.map((mesh) => drawnColor(batch, mesh));
    const changed = meshes[5] as Mesh;

    (changed.material as MeshStandardMaterial).color.setHex(0x00ff00);
    projection.reconcile();

    // The same draw object: a colour is a three-float write, never a reclassification.
    expect(onlyBatch(projection.root)).toBe(batch);
    expect(projection.report.batches).toBe(1);
    expect(projection.inspect(changed)?.lane).toBe("batched");
    expectDrawnColor(batch, changed);
    const after = meshes.map((mesh) => drawnColor(batch, mesh));
    after.forEach((color, index) => {
      if (index === 5) return;
      expect(color).toEqual(before[index]);
    });
  });

  it.each([
    [
      "roughness",
      (material: MeshStandardMaterial) => {
        material.roughness = 0.05;
      },
    ],
    [
      "a texture",
      (material: MeshStandardMaterial) => {
        material.map = {} as Texture;
      },
    ],
    [
      "opacity",
      (material: MeshStandardMaterial) => {
        material.opacity = 0.5;
      },
    ],
    // A `Color` and a `Vector2` are mutated in place rather than swapped, so they are read field
    // by field instead of by identity. Both are read by name, which is the fast path; a field
    // neither knows falls back to reading whatever names were recorded.
    [
      "an emissive colour in place",
      (material: MeshStandardMaterial) => {
        material.emissive.setHex(0x00ff00);
      },
    ],
    [
      "a normal scale in place",
      (material: MeshStandardMaterial) => {
        material.normalScale.set(0.25, 0.75);
      },
    ],
    [
      "an environment rotation in place",
      (material: MeshStandardMaterial) => {
        material.envMapRotation.z = 0.5;
      },
    ],
    [
      "a numeric field turned into a string",
      (material: MeshStandardMaterial) => {
        (material.normalScale as unknown as { x: unknown }).x = "0.5";
      },
    ],
  ])("ejects a member whose material gained %s after it was batched", (_label, mutate) => {
    const { scene, meshes } = uniformLattice(64);
    const projection = project(scene, 3);
    const changed = meshes[5] as Mesh;
    const other = meshes[6] as Mesh;

    mutate(changed.material as MeshStandardMaterial);
    projection.reconcile();

    // Exactly — never a draw with a stale roughness, a missing map or a stale alpha.
    expect(projection.inspect(changed)?.lane).toBe("exact");
    expect(projection.inspect(other)?.lane).toBe("batched");
    expect(projection.report.projectedObjects).toBe(63);
    // And the classification that put it there is re-derived, so the next frame agrees with it.
    projection.reconcile();
    expect(projection.inspect(changed)?.lane).toBe("exact");
    expect(projection.report.projectedObjects).toBe(63);
  });

  it("ejects a member whose material turned transparent", () => {
    const { scene, meshes } = uniformLattice(64);
    const projection = project(scene, 3);
    const changed = meshes[5] as Mesh;

    (changed.material as MeshStandardMaterial).transparent = true;
    projection.reconcile();

    expect(projection.inspect(changed)?.lane).toBe("exact");
    expect(projection.report.exact.transparent).toBe(1);
    expect(projection.report.projectedObjects).toBe(63);
  });

  it("reclassifies a member whose material was swapped for another", () => {
    const { scene, meshes } = uniformLattice(64);
    const projection = project(scene, 3);
    const changed = meshes[5] as Mesh;
    const batch = onlyBatch(projection.root);
    const replacement = new MeshStandardMaterial({
      color: 0xb8c4cc,
      metalness: 0,
      roughness: 0.75,
    });
    replacement.color.setHex(0x0000ff);

    // Another colour-only material: same group, and the instance takes the new colour.
    changed.material = replacement;
    projection.reconcile();
    expect(projection.inspect(changed)?.lane).toBe("batched");
    expectDrawnColor(batch, changed);

    // One that is not colour-only: it leaves the group entirely rather than draw with the clone.
    const rough = new MeshStandardMaterial({ color: 0xb8c4cc, metalness: 0, roughness: 0.05 });
    changed.material = rough;
    projection.reconcile();
    projection.reconcile();
    expect(projection.inspect(changed)?.lane).toBe("exact");
    expect(projection.report.projectedObjects).toBe(63);
  });

  it("leaves the shared-material lane exactly as it was", () => {
    const { scene, material } = sharedLattice(64);

    const projection = project(scene);

    const batch = onlyBatch(projection.root);
    // The game's own instance, so recolouring it recolours the draw, and no per-instance colour at
    // all: there is nothing per-instance to carry.
    expect(batch.material).toBe(material);
    expect(batch.instanceColor).toBeNull();
    expect(projection.drawsWith(material)).toBe(true);
    expect(projection.report.projectedObjects).toBe(64);
  });

  it("costs one compare per member and no collection on a steady 4,096-material frame", () => {
    const { scene } = uniformLattice(4096);
    const projection = project(scene, 2);
    expect(projection.report.batches).toBe(1);

    const originalMap = globalThis.Map;
    const originalSet = globalThis.Set;
    let collections = 0;
    class CountingMap<K, V> extends originalMap<K, V> {
      constructor(entries?: Iterable<readonly [K, V]> | null) {
        super(entries);
        collections += 1;
      }
    }
    class CountingSet<T> extends originalSet<T> {
      constructor(values?: Iterable<T> | null) {
        super(values);
        collections += 1;
      }
    }
    globalThis.Map = CountingMap;
    globalThis.Set = CountingSet;
    let elapsed = 0;
    try {
      for (let frame = 0; frame < 30; frame += 1) {
        const startedAt = performance.now();
        projection.reconcile();
        elapsed += performance.now() - startedAt;
      }
    } finally {
      globalThis.Map = originalMap;
      globalThis.Set = originalSet;
    }

    // A steady frame re-compares and re-colours; it never re-derives the classification, which is
    // what would rebuild 4,096 signatures and allocate a string for each.
    expect(collections).toBe(0);
    expect(projection.report.resultDrawCandidates).toBe(1);
    // ponytail: a per-frame budget assertion would be a machine-specific threshold; the honest
    // number is the measured reconcile time, which the benchmark arm reports per run.
    process.stdout.write(
      `\nuniform reconcile mean over 30 frames: ${(elapsed / 30).toFixed(3)} ms\n`,
    );
  });

  it("times the per-material drift check itself on a settled 4,096-material frame", () => {
    const { scene, meshes } = uniformLattice(4096);
    // Two frames settle the classification; the check only has a record to compare against once
    // one exists, so the first of them is where `uniformSignatureOf` runs.
    const projection = project(scene, 2);
    expect(projection.report.batches).toBe(1);
    const materials = meshes.map((mesh) => mesh.material as Material);
    const frames = 30;

    /** What one settled frame costs to prove that no member's material moved. */
    const timeCheck = (): number => {
      let unchanged = 0;
      for (let round = 0; round < 5; round += 1) {
        for (const material of materials) if (uniformUnchanged(material)) unchanged += 1;
      }
      const startedAt = performance.now();
      for (let frame = 0; frame < frames; frame += 1) {
        for (const material of materials) if (uniformUnchanged(material)) unchanged += 1;
      }
      const elapsed = performance.now() - startedAt;
      // A settled frame's whole job is to prove nothing moved, so every material must come back
      // unchanged — the timing above is a report, never a threshold a slower machine can fail.
      expect(unchanged).toBe((frames + 5) * materials.length);
      return elapsed;
    };

    // The exact poll, which is what every member is on until its watch lands, and the notification,
    // which is what the settled frame runs once it has.
    const polled = timeCheck();
    expect(watched(projection, meshes)).toBe(true);
    const notified = timeCheck();

    process.stdout.write(
      `\nuniform drift check: ${((polled * 1000) / frames / materials.length).toFixed(
        3,
      )} us per material polled, ${((notified * 1000) / frames / materials.length).toFixed(
        3,
      )} watched\n`,
    );
  });
});

/**
 * PRD-462: the notification replaces the poll, and the guarantees are the poll's guarantees.
 *
 * A watch takes the material's own properties over as accessor pairs, so a game writing one is what
 * raises the dirty bit the settled frame reads. The rows below are the four things that has to get
 * right and the three ways a material can leave a group with a watch still on it.
 */
describe("material change notification", () => {
  it.each([
    [
      "onBeforeCompile",
      (material: MeshStandardMaterial) => {
        material.onBeforeCompile = () => undefined;
      },
    ],
    [
      "a customProgramCacheKey",
      (material: MeshStandardMaterial) => {
        material.customProgramCacheKey = () => "custom";
      },
    ],
  ])("ejects a member whose material gained %s after it was batched", (_label, shadow) => {
    const { scene, meshes } = uniformLattice(64);
    const projection = project(scene, 2);
    expect(watched(projection, meshes)).toBe(true);
    const changed = meshes[5] as Mesh;
    const other = meshes[6] as Mesh;
    const material = changed.material as MeshStandardMaterial;
    // The hooks three keeps on `Material.prototype` are not own properties until a game shadows one,
    // so this is a new own property rather than a changed one — the case a watch cannot see by
    // enumerating the material, and the two it watches by name for.
    expect(enumerates(material, "onBeforeCompile")).toBe(false);
    expect(enumerates(material, "customProgramCacheKey")).toBe(false);

    shadow(material);
    projection.reconcile();

    expect(projection.inspect(changed)?.lane).toBe("exact");
    expect(projection.inspect(other)?.lane).toBe("batched");
    expect(projection.report.projectedObjects).toBe(63);
  });

  it("gives a member its own plain properties back when it leaves the group", () => {
    const { scene, meshes } = uniformLattice(64);
    const projection = project(scene, 2);
    expect(watched(projection, meshes)).toBe(true);
    const changed = meshes[5] as Mesh;
    const material = changed.material as MeshStandardMaterial;
    expect(hasWatch(material)).toBe(true);
    const keysWhileWatched = Object.keys(material).length;

    const hook = (): void => undefined;
    material.onBeforeCompile = hook;
    material.roughness = 0.05;
    projection.reconcile();

    expect(projection.inspect(changed)?.lane).toBe("exact");
    // The values it left with, on plain writable properties, because the game still holds this
    // material and may draw it itself, stream it, or read it back.
    expect(isPlain(material, "roughness")).toBe(true);
    expect(material.roughness).toBe(0.05);
    // The game's own function, as its own plain property — the watch was holding it for the game
    // while it ejected the member, and giving back the prototype's instead would lose the shader.
    expect(material.onBeforeCompile).toBe(hook);
    expect(isPlain(material, "onBeforeCompile")).toBe(true);
    // One name more than the material enumerated while the watch was up, and that name is the game's.
    expect(Object.keys(material).length).toBe(keysWhileWatched + 1);
    expect(Object.values(material)).toContain(0.05);

    // It rejoins the group on the next classification, and the watch comes back with it.
    projection.reconcile();
    expect(projection.inspect(changed)?.lane).toBe("exact");
  });

  it("gives every batched material its own properties back when the mirror is torn down", () => {
    const { scene, meshes } = uniformLattice(64);
    const projection = project(scene, 2);
    expect(watched(projection, meshes)).toBe(true);
    const material = meshes[3]?.material as MeshStandardMaterial;
    const keysBefore = Object.keys(material).length;

    projection.dispose();

    expect(hasWatch(material)).toBe(false);
    expect(isPlain(material, "roughness")).toBe(true);
    expect(material.roughness).toBe(0.75);
    // The prototype hooks the game never shadowed leave no trace at all.
    expect(Object.hasOwn(material, "onBeforeCompile")).toBe(false);
    expect(Object.hasOwn(material, "customProgramCacheKey")).toBe(false);
    expect(Object.keys(material).length).toBe(keysBefore);
  });

  it("never watches a material the shared-material lane draws with", () => {
    const { scene, material } = sharedLattice(64);

    const projection = project(scene, 4);

    // The game's own instance, so there is no fingerprint to prove and no clone to justify one: a
    // watch here would be 64 accessor installs paying for a notification nobody reads.
    expect(projection.drawsWith(material)).toBe(true);
    expect(hasWatch(material)).toBe(false);
    expect(isPlain(material, "roughness")).toBe(true);
  });

  it("ejects a member edited before its watch lands, and spends at most the budget installing", () => {
    const { scene, meshes } = uniformLattice(4096);
    const projection = new SceneRenderProjection(scene, {
      minMeshes: 8,
      onReport: () => undefined,
    });
    // Three frames for the plan, the batch and the classification to land, so what is measured below
    // is a frame that only installs.
    projection.reconcile();
    projection.reconcile();
    projection.reconcile();
    const installedBefore = meshes.filter((mesh) => hasWatch(mesh.material as Material)).length;
    // A clock that spends a millisecond a read, so the budget is spent by a known number of installs
    // on any machine. A wall-clock threshold here would be a statement about the runner.
    const clock = performance.now;
    let tick = 0;
    performance.now = (): number => {
      tick += 1;
      return tick;
    };
    let installed: number;
    try {
      projection.reconcile();
      installed =
        meshes.filter((mesh) => hasWatch(mesh.material as Material)).length - installedBefore;
    } finally {
      performance.now = clock;
    }

    // Two milliseconds of budget against an install that costs 33 µs and a member walk that costs
    // less than the installs it finds: the frame stops where the budget runs out, not at the end of
    // the batch. Sliced, it is 33 us a member; unsliced it is the 130 ms the whole batch costs.
    expect(installed).toBeGreaterThan(0);
    expect(installed).toBeLessThan(64);
    const pending = meshes.filter((mesh) => !hasWatch(mesh.material as Material));
    expect(pending.length).toBeGreaterThan(0);

    // Detection never lapses: a member still on the exact poll is ejected the same frame, which is
    // the guarantee that makes the slice safe to ship.
    const late = pending[pending.length - 1] as Mesh;
    (late.material as MeshStandardMaterial).roughness = 0.02;
    projection.reconcile();
    expect(projection.inspect(late)?.lane).toBe("exact");
    expect(hasWatch(late.material as Material)).toBe(false);
  });

  it("re-derives one material's fingerprint when it changes, not the scene's", () => {
    const { scene, meshes } = uniformLattice(64);
    const projection = project(scene, 2);
    expect(watched(projection, meshes)).toBe(true);
    const changed = meshes[5] as Mesh;

    const keys = Object.keys;
    let classified = 0;
    Object.keys = function (this: unknown, value: unknown): string[] {
      if (value instanceof MeshStandardMaterial) classified += 1;
      return keys.call(this, value as object);
    };
    try {
      (changed.material as MeshStandardMaterial).roughness = 0.11;
      projection.reconcile();
      projection.reconcile();
    } finally {
      Object.keys = keys;
    }

    // One member changing drops the whole plan, so the next frame re-classifies the scene. Sixty-three
    // of those materials have provably not moved, and re-deriving a fingerprint builds a string from
    // every property — 4 µs a material, which is what this replaced. A margin of four, not a clock.
    expect(projection.inspect(changed)?.lane).toBe("exact");
    expect(classified).toBeLessThan(16);
  });
});
