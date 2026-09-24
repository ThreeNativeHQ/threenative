import { Document, type Material, type Mesh, type Node, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { flatten, join } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import { describe, expect, it } from "vitest";
import {
  buildFixtureDocument,
  buildFixtureGlb,
} from "../../../test-support/generate-fixture-model.js";
import { buildProtectedSet, resolveCompactOptions } from "../src/passes/compact.js";
import type { IModelCompactSummary } from "../src/passes/compact.js";
import { modelPass, reachableStats } from "../src/passes/model.js";

async function readVerified(buffer: Buffer): Promise<ReturnType<Document["getRoot"]>> {
  const io = new NodeIO()
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder })
    .registerExtensions(ALL_EXTENSIONS);
  return (await io.readJSON(await io.binaryToJSON(buffer))).getRoot();
}

function accessor(
  document: Document,
  buffer: ReturnType<Document["createBuffer"]>,
  name: string,
  array: ArrayBufferView,
): ReturnType<Document["createAccessor"]> {
  return document.createAccessor(name).setArray(array).setBuffer(buffer);
}

/** One three-vertex triangle mesh sharing the supplied material; `seed` makes each mesh unique. */
function triangleMesh(
  document: Document,
  buffer: ReturnType<Document["createBuffer"]>,
  material: Material,
  name: string,
  seed = 0,
): Mesh {
  const mesh = document.createMesh(name);
  const primitive = document.createPrimitive();
  const bump = seed * 1e-4;
  primitive.setAttribute(
    "POSITION",
    accessor(
      document,
      buffer,
      `${name}-positions`,
      new Float32Array([0, 0, bump, 1, 0, bump, 0, 1, bump]),
    ).setType("VEC3"),
  );
  primitive.setIndices(
    accessor(document, buffer, `${name}-indices`, new Uint16Array([0, 1, 2])).setType("SCALAR"),
  );
  primitive.setMaterial(material);
  mesh.addPrimitive(primitive);
  return mesh;
}

function countPrimitives(root: ReturnType<Document["getRoot"]>): number {
  return root
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .filter((primitive) => primitive.getAttribute("POSITION") !== null).length;
}

function nodeNamed(root: ReturnType<Document["getRoot"]>, name: string): Node | undefined {
  return root.listNodes().find((node) => node.getName() === name);
}

/**
 * Static (unskinned, unnimated) fixture: two unprotected hull nodes share one material and
 * are the only pair `join` may merge; a regex-matching propeller node and an allow-listed
 * pivot node share that same material and must survive as their own primitives.
 */
function buildJoinFixture(): Document {
  const document = new Document();
  const buffer = document.createBuffer("fixture");
  const material = document.createMaterial("hull").setBaseColorFactor([0.5, 0.5, 0.5, 1]);
  const scene = document.createScene("Scene");

  scene.addChild(
    document.createNode("hull_01").setMesh(triangleMesh(document, buffer, material, "hull-a", 1)),
  );
  scene.addChild(
    document
      .createNode("hull_02")
      .setMesh(triangleMesh(document, buffer, material, "hull-b", 2))
      .setTranslation([2, 0, 0]),
  );
  scene.addChild(
    document
      .createNode("propeller_01")
      .setMesh(triangleMesh(document, buffer, material, "propeller-a", 3))
      .setTranslation([0, 2, 0]),
  );
  scene.addChild(
    document
      .createNode("MyCustomPivot")
      .setMesh(triangleMesh(document, buffer, material, "pivot-a", 4))
      .setTranslation([0, -2, 0]),
  );
  return document;
}

/** Three nodes reuse one Mesh so the instance pass has a batch to build. */
function buildInstanceFixture(): Document {
  const document = new Document();
  const buffer = document.createBuffer("fixture");
  const material = document.createMaterial("crate").setBaseColorFactor([0.2, 0.6, 0.3, 1]);
  const scene = document.createScene("Scene");
  const mesh = triangleMesh(document, buffer, material, "crate");
  for (let index = 0; index < 3; index += 1) {
    scene.addChild(
      document
        .createNode(`crate_${String(index)}`)
        .setMesh(mesh)
        .setTranslation([index * 3, 0, 0]),
    );
  }
  return document;
}

async function toGlb(document: Document): Promise<Buffer> {
  return Buffer.from(await new NodeIO().writeBinary(document));
}

describe("model compaction", () => {
  it("protects a regex match and an allow-listed name while merging the unprotected pair", async () => {
    // Red: the bare library merges every node that shares the material, protected or not.
    const naive = buildJoinFixture();
    await join()(naive);
    expect(countPrimitives(naive.getRoot())).toBe(1);
    expect(nodeNamed(naive.getRoot(), "propeller_01")).toBeUndefined();

    // Green: the pass keeps both protected nodes out of the merge.
    const result = await modelPass({
      compact: { protectedNames: ["MyCustomPivot"] },
      textures: "none",
      virtual: "none",
    }).apply(Buffer.from(await toGlb(buildJoinFixture())), "join-fixture.glb");
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const output = await readVerified(result.buffer);

    const propeller = nodeNamed(output, "propeller_01");
    const pivot = nodeNamed(output, "MyCustomPivot");
    expect(propeller).toBeDefined();
    expect(pivot).toBeDefined();
    expect(propeller?.getMesh()?.listPrimitives().length).toBe(1);
    expect(pivot?.getMesh()?.listPrimitives().length).toBe(1);
    // Hull pair merged (4 primitives -> 3), protected pair untouched.
    expect(countPrimitives(output)).toBe(3);

    const compact = result.entry?.compact as IModelCompactSummary | undefined;
    const rules = new Map((compact?.protected ?? []).map((entry) => [entry.name, entry.rule]));
    expect(rules.get("propeller_01")).toBe("regex");
    expect(rules.get("MyCustomPivot")).toBe("allow-list");
  });

  it("protects animation targets and their ancestors, and reports skin joints", async () => {
    const animated = new Document();
    const buffer = animated.createBuffer("fixture");
    const material = animated.createMaterial("shell").setBaseColorFactor([0.5, 0.5, 0.5, 1]);
    const scene = animated.createScene("Scene");
    const mount = animated.createNode("turretMount");
    const turret = animated
      .createNode("turret")
      .setMesh(triangleMesh(animated, buffer, material, "turret"));
    mount.addChild(turret);
    scene.addChild(mount);
    const animation = animated.createAnimation("spin");
    const sampler = animated
      .createAnimationSampler("spin-sampler")
      .setInput(accessor(animated, buffer, "times", new Float32Array([0, 1])).setType("SCALAR"))
      .setOutput(
        accessor(animated, buffer, "rots", new Float32Array([0, 0, 0, 1, 0, 0, 0, 1])).setType(
          "VEC4",
        ),
      );
    animation
      .addSampler(sampler)
      .addChannel(
        animated
          .createAnimationChannel("spin-channel")
          .setSampler(sampler)
          .setTargetNode(turret)
          .setTargetPath("rotation"),
      );
    const rules = new Map(buildProtectedSet(animated, {}).summary.map((e) => [e.name, e.rule]));
    expect(rules.get("turret")).toBe("animation-target");
    expect(rules.get("turretMount")).toBe("animation-ancestor");
  });

  it("reports skin joints as protected and preserves them by name", async () => {
    const document = buildFixtureDocument();
    const { summary } = buildProtectedSet(document, {});
    const rules = new Map(summary.map((entry) => [entry.name, entry.rule]));
    // `head` is both a joint and the animation target; the structural rule wins.
    expect(rules.get("head")).toBe("skin-joint");
    expect(rules.get("hips")).toBe("skin-joint");
    expect(rules.get("torso")).toBe("skin-joint");

    const result = await modelPass({ textures: "none", virtual: "none" }).apply(
      Buffer.from(await buildFixtureGlb()),
      "skinned.glb",
    );
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const output = await readVerified(result.buffer);
    const names = new Set(output.listNodes().map((node) => node.getName()));
    expect([...["hips", "torso", "head"]].every((name) => names.has(name))).toBe(true);
    const compact = result.entry?.compact as IModelCompactSummary | undefined;
    const compactProtected = (compact?.protected ?? []).map((entry) => entry.name);
    expect(compactProtected).toEqual(expect.arrayContaining(["hips", "torso", "head"]));
  });

  it("batches a mesh shared by three nodes behind EXT_mesh_gpu_instancing", async () => {
    const input = Buffer.from(await toGlb(buildInstanceFixture()));
    const source = reachableStats(await readVerified(input));
    const result = await modelPass({ textures: "none", virtual: "none" }).apply(
      input,
      "instances.glb",
    );
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const output = await readVerified(result.buffer);

    const batched = output
      .listNodes()
      .filter((node) => node.getExtension("EXT_mesh_gpu_instancing") !== null);
    expect(batched.length).toBe(1);
    const compact = result.entry?.compact as IModelCompactSummary | undefined;
    expect(compact?.instance.batches).toBe(1);
    expect(compact?.instance.instances).toBe(3);

    // Instancing moves the source node transforms into the batch; the self-verify's stats must
    // still see the same geometry, or the pass would reject its own lossless output.
    const after = reachableStats(output);
    expect(after.triangles).toBe(source.triangles);
    expect(after.vertices).toBe(source.vertices);
    expect(after.boundingBox?.min).toEqual(source.boundingBox?.min);
    expect(after.boundingBox?.max).toEqual(source.boundingBox?.max);
  });

  it("reports zero instance candidates without failing when nothing is shared", async () => {
    const result = await modelPass({ textures: "none", virtual: "none" }).apply(
      Buffer.from(await toGlb(buildJoinFixture())),
      "join-fixture.glb",
    );
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const compact = result.entry?.compact as IModelCompactSummary | undefined;
    expect(compact?.instance.batches).toBe(0);
    expect(compact?.instance.reason).toMatch(/shared/u);
  });

  it("keeps a protected pivot in place so its mesh child is not reparented and merged", async () => {
    const build = (): Document => {
      const document = new Document();
      const buffer = document.createBuffer("fixture");
      const material = document.createMaterial("hull").setBaseColorFactor([0.5, 0.5, 0.5, 1]);
      const scene = document.createScene("Scene");
      const pivot = document.createNode("VINTThreeNativePivot");
      const blade = document
        .createNode("blade")
        .setMesh(triangleMesh(document, buffer, material, "blade", 5))
        .setTranslation([0, 0.5, 0]);
      pivot.addChild(blade);
      scene.addChild(
        document
          .createNode("hull_01")
          .setMesh(triangleMesh(document, buffer, material, "hull-a", 1)),
      );
      scene.addChild(
        document
          .createNode("hull_02")
          .setMesh(triangleMesh(document, buffer, material, "hull-b", 2))
          .setTranslation([2, 0, 0]),
      );
      scene.addChild(pivot);
      return document;
    };

    // Red: the bare library reparents the blade out of the pivot, leaves the pivot an empty leaf
    // and prunes it, then join absorbs the blade into the hull.
    const naive = build();
    await flatten()(naive);
    expect(nodeNamed(naive.getRoot(), "VINTThreeNativePivot")).toBeUndefined();

    // Green: the protected pivot keeps its child, and the child is never a join sibling.
    const result = await modelPass({ textures: "none", virtual: "none" }).apply(
      Buffer.from(await toGlb(build())),
      "pivot.glb",
    );
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const output = await readVerified(result.buffer);
    const pivot = nodeNamed(output, "VINTThreeNativePivot");
    const blade = nodeNamed(output, "blade");
    expect(pivot).toBeDefined();
    expect(blade).toBeDefined();
    expect(blade?.getParentNode()?.getName()).toBe("VINTThreeNativePivot");
  });

  it("instances rotated nodes and reconstructs their world bounds", async () => {
    const document = new Document();
    const buffer = document.createBuffer("fixture");
    const material = document.createMaterial("crate").setBaseColorFactor([0.2, 0.6, 0.3, 1]);
    const scene = document.createScene("Scene");
    const mesh = triangleMesh(document, buffer, material, "crate");
    // 90 degrees about Y, glTF quaternion order (x, y, z, w).
    const yaw: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    for (let index = 0; index < 3; index += 1) {
      scene.addChild(
        document
          .createNode(`crate_${String(index)}`)
          .setMesh(mesh)
          .setRotation(yaw)
          .setTranslation([index * 3, 0, 0]),
      );
    }
    const input = Buffer.from(await toGlb(document));
    const source = reachableStats(await readVerified(input));
    const result = await modelPass({ textures: "none", virtual: "none" }).apply(input, "rot.glb");
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const output = await readVerified(result.buffer);
    const metadata = result.entry?.compact as IModelCompactSummary | undefined;
    expect(metadata?.instance.batches).toBe(1);
    expect(metadata?.instance.instances).toBe(3);
    const after = reachableStats(output);
    for (const axis of [0, 1, 2]) {
      expect(after.boundingBox?.min[axis] ?? 0).toBeCloseTo(source.boundingBox?.min[axis] ?? 0, 4);
      expect(after.boundingBox?.max[axis] ?? 0).toBeCloseTo(source.boundingBox?.max[axis] ?? 0, 4);
    }
  });

  it("builds a sheared hierarchy without drift instead of failing", async () => {
    const document = new Document();
    const buffer = document.createBuffer("fixture");
    const material = document.createMaterial("shell").setBaseColorFactor([0.4, 0.4, 0.9, 1]);
    const scene = document.createScene("Scene");
    // A non-uniformly scaled, rotated parent shears its child's world matrix; neither may be
    // reparented, or the shear is decomposed and the self-verify rejects the output.
    const root = document
      .createNode("root")
      .setScale([2, 1, 1])
      .setRotation([0, 0, Math.SQRT1_2, Math.SQRT1_2] as [number, number, number, number]);
    const arm = document
      .createNode("arm")
      .setMesh(triangleMesh(document, buffer, material, "arm"))
      // 45 degrees, so the composed world matrix is a real shear, not a permutation.
      .setRotation([0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)] as [
        number,
        number,
        number,
        number,
      ])
      .setTranslation([1, 0, 0]);
    root.addChild(arm);
    scene.addChild(root);
    const result = await modelPass({ textures: "none", virtual: "none" }).apply(
      Buffer.from(await toGlb(document)),
      "shear.glb",
    );
    expect(Buffer.isBuffer(result)).toBe(false);
  });

  it("keeps a protected node's shared-mesh descendants out of an instance batch", async () => {
    const build = (): Document => {
      const document = new Document();
      const buffer = document.createBuffer("fixture");
      const material = document.createMaterial("blade").setBaseColorFactor([0.3, 0.3, 0.3, 1]);
      const scene = document.createScene("Scene");
      const hub = document.createNode("PropellerHub");
      const bladeMesh = triangleMesh(document, buffer, material, "blade", 7);
      for (let index = 0; index < 3; index += 1) {
        hub.addChild(
          document
            .createNode(`blade_${String(index)}`)
            .setMesh(bladeMesh)
            .setTranslation([index, 0, 0]),
        );
      }
      scene.addChild(hub);
      return document;
    };
    const result = await modelPass({ textures: "none", virtual: "none" }).apply(
      Buffer.from(await toGlb(build())),
      "hub.glb",
    );
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const output = await readVerified(result.buffer);
    const hub = nodeNamed(output, "PropellerHub");
    expect(hub).toBeDefined();
    // The blades shared one mesh; without the keep-closure detach they would be batched at the
    // root and their emptied nodes pruned, deleting the hub.
    const remainingBlades = output
      .listNodes()
      .filter((node) => node.getName().startsWith("blade_"));
    expect(remainingBlades).toHaveLength(3);
    expect(
      remainingBlades.every((blade) => blade.getParentNode()?.getName() === "PropellerHub"),
    ).toBe(true);
    expect(
      output.listNodes().every((node) => node.getExtension("EXT_mesh_gpu_instancing") === null),
    ).toBe(true);
  });

  it("still flattens an animated model whose protected ancestor is near the root", async () => {
    const document = new Document();
    const buffer = document.createBuffer("fixture");
    const material = document.createMaterial("parts").setBaseColorFactor([0.3, 0.4, 0.5, 1]);
    const scene = document.createScene("Scene");
    const airframe = document.createNode("Airframe");
    // 40 empty transform chains under the protected root, each ending in a mesh part — the a6m3
    // shape. Protecting every animation ancestor must not freeze the whole tree.
    for (let index = 0; index < 40; index += 1) {
      const a = document.createNode(`chain_${String(index)}_a`);
      const b = document.createNode(`chain_${String(index)}_b`);
      const c = document
        .createNode(`part_${String(index)}`)
        .setMesh(triangleMesh(document, buffer, material, `part-${String(index)}`, index));
      b.addChild(c);
      a.addChild(b);
      airframe.addChild(a);
    }
    const pivot = document
      .createNode("VINTThreeNativePivot")
      .setMesh(triangleMesh(document, buffer, material, "pivot", 99));
    airframe.addChild(pivot);
    scene.addChild(airframe);
    const animation = document.createAnimation("spin");
    const sampler = document
      .createAnimationSampler("spin-sampler")
      .setInput(accessor(document, buffer, "times", new Float32Array([0, 1])).setType("SCALAR"))
      .setOutput(
        accessor(document, buffer, "rots", new Float32Array([0, 0, 0, 1, 0, 0, 0, 1])).setType(
          "VEC4",
        ),
      );
    animation
      .addSampler(sampler)
      .addChannel(
        document
          .createAnimationChannel("spin-channel")
          .setSampler(sampler)
          .setTargetNode(pivot)
          .setTargetPath("rotation"),
      );
    const result = await modelPass({ textures: "none", virtual: "none" }).apply(
      Buffer.from(await toGlb(document)),
      "animated.glb",
    );
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const metadata = result.entry?.compact as IModelCompactSummary | undefined;
    expect(metadata?.flatten.reparented).toBeGreaterThan(0);
    expect(metadata?.nodesAfter ?? 0).toBeLessThan(metadata?.nodesBefore ?? 0);
  });

  it("leaves an instanced mesh out of the LOD join rung", async () => {
    const document = new Document();
    const buffer = document.createBuffer("fixture");
    const material = document.createMaterial("crate").setBaseColorFactor([0.2, 0.6, 0.3, 1]);
    const scene = document.createScene("Scene");
    const mesh = triangleMesh(document, buffer, material, "crate");
    for (let index = 0; index < 3; index += 1) {
      scene.addChild(
        document
          .createNode(`crate_${String(index)}`)
          .setMesh(mesh)
          .setTranslation([index * 3, 0, 0]),
      );
    }
    // A same-material sibling makes the join rung eligible, so the spec fails if the instanced
    // batch is ever joined.
    scene.addChild(
      document
        .createNode("floor")
        .setMesh(triangleMesh(document, buffer, material, "floor", 42))
        .setTranslation([0, -3, 0]),
    );
    const result = await modelPass({
      lod: { generation: { join: true, maxLevels: 1 } },
      textures: "none",
      virtual: "none",
    }).apply(Buffer.from(await toGlb(document)), "crates.glb");
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const output = await readVerified(result.buffer);
    // Joining an instanced batch would collapse every placed copy onto one transform.
    expect(output.listMeshes().some((entry) => entry.getName().endsWith("__lod_join"))).toBe(false);
  });

  it("keeps a static child of an animated parent when the child's channel is listed first", async () => {
    const document = new Document();
    const buffer = document.createBuffer("fixture");
    const material = document.createMaterial("skin").setBaseColorFactor([0.5, 0.5, 0.5, 1]);
    const scene = document.createScene("Scene");
    const animation = document.createAnimation("flight");
    const channel = (name: string, target: Node, path: "rotation" | "translation") => {
      const sampler = document
        .createAnimationSampler(`${name}-sampler`)
        .setInput(
          accessor(document, buffer, `${name}-times`, new Float32Array([0, 1])).setType("SCALAR"),
        )
        .setOutput(
          accessor(
            document,
            buffer,
            `${name}-out`,
            new Float32Array(path === "rotation" ? [0, 0, 0, 1, 0, 0, 0, 1] : [0, 0, 0, 0, 0, 0]),
          ).setType(path === "rotation" ? "VEC4" : "VEC3"),
        );
      animation
        .addSampler(sampler)
        .addChannel(
          document
            .createAnimationChannel(`${name}-channel`)
            .setSampler(sampler)
            .setTargetNode(target)
            .setTargetPath(path),
        );
    };
    scene.addChild(
      document.createNode("Ground").setMesh(triangleMesh(document, buffer, material, "ground", 1)),
    );
    const plane = document.createNode("Plane");
    const fuselage = document
      .createNode("Fuselage")
      .setMesh(triangleMesh(document, buffer, material, "fuselage", 2));
    const blades = document.createNode("Blades");
    plane.addChild(fuselage);
    plane.addChild(blades);
    scene.addChild(plane);
    // The child's channel is registered first, so a naive ancestor pass would classify Plane as
    // an `animation-ancestor` before its own target is seen and release Fuselage to the root.
    channel("blades", blades, "rotation");
    channel("plane", plane, "translation");

    const result = await modelPass({ textures: "none", virtual: "none" }).apply(
      Buffer.from(await toGlb(document)),
      "plane.glb",
    );
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const output = await readVerified(result.buffer);
    expect(nodeNamed(output, "Fuselage")?.getParentNode()?.getName()).toBe("Plane");
  });

  it("does not duplicate a shared mesh many times over on an animated model", async () => {
    const document = new Document();
    const buffer = document.createBuffer("fixture");
    const material = document.createMaterial("rivet").setBaseColorFactor([0.4, 0.4, 0.4, 1]);
    const scene = document.createScene("Scene");
    // A dense shared mesh: 300 vertices, no texture, no animation on the rivets themselves.
    const positions: number[] = [];
    const indices: number[] = [];
    for (let index = 0; index < 300; index += 1) positions.push(index * 0.01, 0, 0);
    for (let index = 0; index < 298; index += 1) indices.push(index, index + 1, index + 2);
    const mesh = document.createMesh("rivet");
    const primitive = document.createPrimitive();
    primitive.setAttribute(
      "POSITION",
      accessor(document, buffer, "rivet-positions", new Float32Array(positions)).setType("VEC3"),
    );
    primitive.setIndices(
      accessor(document, buffer, "rivet-indices", new Uint16Array(indices)).setType("SCALAR"),
    );
    primitive.setMaterial(material);
    mesh.addPrimitive(primitive);
    const hull = document.createNode("Hull");
    for (let index = 0; index < 50; index += 1) {
      hull.addChild(
        document
          .createNode(`rivet_${String(index)}`)
          .setMesh(mesh)
          .setTranslation([index, 0, 0]),
      );
    }
    scene.addChild(hull);
    // One animation anywhere makes gltf-transform's `instance()` refuse the whole document.
    const spin = document.createAnimation("spin");
    const sampler = document
      .createAnimationSampler("spin-sampler")
      .setInput(accessor(document, buffer, "t", new Float32Array([0, 1])).setType("SCALAR"))
      .setOutput(
        accessor(document, buffer, "r", new Float32Array([0, 0, 0, 1, 0, 0, 0, 1])).setType("VEC4"),
      );
    spin
      .addSampler(sampler)
      .addChannel(
        document
          .createAnimationChannel("c")
          .setSampler(sampler)
          .setTargetNode(hull)
          .setTargetPath("rotation"),
      );

    const input = Buffer.from(await toGlb(document));
    // Quantize off is the case that exposed the N-times growth: with quantize on, its accessor
    // dedup hid the clone; with it off nothing relinks the clones. The mesh detach is also
    // skipped entirely on an animated document, because `instance()` refuses one.
    const result = await modelPass({
      passes: { dedup: true, meshopt: false, prune: true, quantize: false, reorder: false },
      textures: "none",
      virtual: "none",
    }).apply(input, "rivets.glb");
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    expect(result.buffer.length).toBeLessThan(input.length * 3);
  });

  it("does not ship an N-times clone of a protected node's shared mesh", async () => {
    const document = new Document();
    const buffer = document.createBuffer("fixture");
    const material = document.createMaterial("rivet").setBaseColorFactor([0.4, 0.4, 0.4, 1]);
    const scene = document.createScene("Scene");
    const positions = new Float32Array(300 * 3);
    for (let index = 0; index < 300; index += 1) positions[index * 3] = index * 0.01;
    const indices = new Uint16Array(298 * 3);
    for (let index = 0; index < 298; index += 1) {
      indices[index * 3] = index;
      indices[index * 3 + 1] = index + 1;
      indices[index * 3 + 2] = index + 2;
    }
    const mesh = document.createMesh("rivet");
    const primitive = document.createPrimitive();
    primitive.setAttribute(
      "POSITION",
      accessor(document, buffer, "rivet-positions", positions).setType("VEC3"),
    );
    primitive.setIndices(accessor(document, buffer, "rivet-indices", indices).setType("SCALAR"));
    primitive.setMaterial(material);
    mesh.addPrimitive(primitive);
    // A regex-protected static hub with 50 shared rivets: the detach clones each rivet's mesh so
    // `instance()` cannot batch it, and the clones must not survive to the writer.
    const hub = document.createNode("Wheel_hub");
    for (let index = 0; index < 50; index += 1) {
      hub.addChild(
        document
          .createNode(`rivet_${String(index)}`)
          .setMesh(mesh)
          .setTranslation([index, 0, 0]),
      );
    }
    scene.addChild(hub);
    const input = Buffer.from(await toGlb(document));
    const result = await modelPass({
      passes: { dedup: true, meshopt: false, prune: true, quantize: false, reorder: false },
      textures: "none",
      virtual: "none",
    }).apply(input, "hub-rivets.glb");
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const output = await readVerified(result.buffer);
    const authoredVertices = output
      .listMeshes()
      .flatMap((entry) => entry.listPrimitives())
      .reduce((total, entry) => total + (entry.getAttribute("POSITION")?.getCount() ?? 0), 0);
    expect(authoredVertices).toBe(300);
  });

  it("reports every named node compaction removed", async () => {
    const result = await modelPass({
      compact: { protectedNames: ["MyCustomPivot"] },
      textures: "none",
      virtual: "none",
    }).apply(Buffer.from(await toGlb(buildJoinFixture())), "join-fixture.glb");
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const metadata = result.entry?.compact as IModelCompactSummary | undefined;
    // The hull pair is merged into one node, so the other hull node's name is gone.
    expect(metadata?.removed).toEqual(["hull_02"]);
  });

  it("compacts when the prune sub-pass is off, leaving no empty mesh for quantize", async () => {
    // `join({cleanup:false})` leaves a joined-away mesh with zero primitives; with prune off,
    // quantize would throw "Missing POSITION attribute" on it.
    const result = await modelPass({
      passes: { dedup: true, meshopt: false, prune: false, quantize: true, reorder: false },
      textures: "none",
      virtual: "none",
    }).apply(Buffer.from(await toGlb(buildJoinFixture())), "join-fixture.glb");
    expect(Buffer.isBuffer(result)).toBe(false);
  });

  it("rejects an instance minimum below 2 through the programmatic path", () => {
    expect(() => resolveCompactOptions({ instance: { min: 1 } })).toThrow(
      /TN_ASSETS_COMPACT_INVALID/u,
    );
    expect(() => resolveCompactOptions({ instance: { min: Number.NaN } })).toThrow(
      /TN_ASSETS_COMPACT_INVALID/u,
    );
    expect(resolveCompactOptions({ instance: { min: 3 } }).instance).toEqual({ min: 3 });
  });

  it("ships the buffer untouched when compact and the geometry passes are all off", async () => {
    const input = Buffer.from(await toGlb(buildJoinFixture()));
    const result = await modelPass({
      compact: false,
      passes: { dedup: false, meshopt: false, prune: false, quantize: false, reorder: false },
      textures: "none",
      virtual: "none",
    }).apply(input, "join-fixture.glb");
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});
