import { BoxGeometry, Euler, InstancedMesh, Quaternion } from "three";
// @ts-expect-error Three's private binding manager has no public declarations.
import Bindings from "three/src/renderers/common/Bindings.js";
// @ts-expect-error Three's private geometry manager has no public declarations.
import Geometries from "three/src/renderers/common/Geometries.js";
// @ts-expect-error Three's node manager has no public declarations.
import NodeManager from "three/src/renderers/common/nodes/NodeManager.js";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { NodeMaterialObserver, NodeUpdateType } from "three/webgpu";
import { describe, expect, it } from "vitest";

/** One render object per mesh, as the renderer holds it: its identity is what the observer keys. */
const renderObjects = new WeakMap<InstancedMesh, unknown>();

/** The slice of a RenderObject that the observer reads, plus the counters the draws call through. */
interface ICounted {
  objectGroupWrites: number;
  objectNodeUpdates: number;
  frameNodeUpdates: number;
  attributeScans: number;
}

function worldFor(mesh: InstancedMesh) {
  return {
    object: mesh,
    geometry: mesh.geometry,
    material: mesh.material,
    bundle: null as null,
    lightsNode: { getLights: () => [] },
    scene: { environmentIntensity: 1, environmentRotation: new Quaternion() },
  };
}

/** A real observer over a real lit node material, as a render object would hold. */
function observerFor(mesh: InstancedMesh) {
  return new NodeMaterialObserver({
    material: mesh.material,
    object: mesh,
    context: {},
  } as never) as unknown as {
    isSettled(renderObject: unknown): boolean;
    needsRefresh(renderObject: unknown, nodeFrame: unknown): boolean;
  };
}

/** The render object a previous draw cached for this mesh, primed once so it has a snapshot. */
function cachedWorld(mesh: InstancedMesh) {
  let world = renderObjects.get(mesh) as Record<string, unknown> | undefined;
  if (world === undefined) {
    world = { ...worldFor(mesh) };
    renderObjects.set(mesh, world);
  }
  return world as Record<string, never>;
}

/** The one question the renderer asks first on every draw, answered with no motion vectors. */
function prime(mesh: InstancedMesh, observer: ReturnType<typeof observerFor>): void {
  observer.needsRefresh(cachedWorld(mesh), { renderer: { getMRT: () => null } });
}

function litMesh(): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardNodeMaterial(), 1);
  mesh.quaternion.copy(new Quaternion().setFromEuler(new Euler()));
  mesh.updateMatrixWorld();
  return mesh;
}

/** The four draw-time call sites a settled object skips, counted through real three methods. */
function draw(mesh: InstancedMesh, observer: ReturnType<typeof observerFor>) {
  const counts: ICounted = {
    objectGroupWrites: 0,
    objectNodeUpdates: 0,
    frameNodeUpdates: 0,
    attributeScans: 0,
  };
  let renderObject = renderObjects.get(mesh) as Record<string, unknown> | undefined;
  renderObject ??= {};
  renderObjects.set(mesh, renderObject);
  Object.assign(renderObject, {
    ...worldFor(mesh),
    getMonitor: () => observer,
    getNodeBuilderState: () => ({
      updateNodes: [objectNode(counts), frameNode(counts)],
      updateBeforeNodes: [objectBeforeNode(counts)],
      updateAfterNodes: [],
    }),
  });
  const render = { renderId: 2, frameId: 2, renderer: { getMRT: () => null } };
  (renderObject as { frame?: unknown }).frame = render;
  const nodes = {
    isSettled: () => observer.isSettled(renderObject),
    getNodeFrameForRender: () => ({
      updateNode: (node: { update: () => void }) => node.update(),
      updateBeforeNode: (node: { updateBefore: () => void }) => node.updateBefore(),
      updateAfterNode: (node: { updateAfter: () => void }) => node.updateAfter(),
      ...render,
    }),
  };
  // A camera that moved between the frames: nothing about the object changed, so nothing it feeds
  // may go stale. The model-view product is built on the GPU out of the two per-object values the
  // settled path keeps, which is what makes the skip safe.
  // What the renderer asks first, on every draw: the refresh is still answered, and the
  // observer learns whether this frame produces motion vectors.
  observer.needsRefresh(renderObject, render);

  NodeManager.prototype.updateForRender.call(nodes, renderObject);
  NodeManager.prototype.updateBefore.call(nodes, renderObject);
  Geometries.prototype.updateForRender.call(
    {
      has: () => true,
      updateAttributes: () => {
        counts.attributeScans += 1;
      },
    },
    renderObject,
  );
  Bindings.prototype.updateForRender.call(
    {
      getForRender: () => [{ bindings: [objectGroupBinding(counts), textureBinding(counts)] }],
      nodes: {
        isSettled: () => observer.isSettled(renderObject),
        updateGroup: NodeManager.prototype.updateGroup,
        groupsData: new Map(),
      },
      backend: {
        get: () => ({}),
        updateBinding: () => undefined,
        updateBindings: () => undefined,
      },
      textures: {
        get: () => ({ generation: 0, bindGroups: new Set() }),
        updateTexture: () => undefined,
        needsMipmaps: () => false,
      },
      pipelines: {},
      _updateBindings: Bindings.prototype._updateBindings,
      _update: Bindings.prototype._update,
    },
    renderObject,
  );
  return { counts, settled: observer.isSettled(renderObject) };
}

function objectNode(counts: ICounted) {
  return {
    updateType: NodeUpdateType.OBJECT,
    getUpdateType: () => NodeUpdateType.OBJECT,
    update: () => {
      counts.objectNodeUpdates += 1;
    },
  };
}

function objectBeforeNode(counts: ICounted) {
  return {
    updateBeforeType: NodeUpdateType.OBJECT,
    getUpdateBeforeType: () => NodeUpdateType.OBJECT,
    updateBefore: () => {
      counts.objectNodeUpdates += 1;
    },
  };
}

function frameNode(counts: ICounted) {
  return {
    updateType: NodeUpdateType.FRAME,
    getUpdateType: () => NodeUpdateType.FRAME,
    update: () => {
      counts.frameNodeUpdates += 1;
    },
  };
}

function objectGroupBinding(counts: ICounted) {
  return {
    isUniformBuffer: true,
    isBuffer: true,
    updateRanges: [],
    groupNode: { updateType: NodeUpdateType.OBJECT, version: 1 },
    update: () => {
      counts.objectGroupWrites += 1;
    },
  };
}

function textureBinding(counts: ICounted) {
  return {
    isSampledTexture: true,
    isBuffer: true,
    updateRanges: [],
    groupNode: { updateType: NodeUpdateType.RENDER, version: 2 },
    texture: { id: 7, version: 3 },
    update: () => {
      counts.objectGroupWrites += 1;
    },
  };
}

describe("a settled static object skips the per-object draw work", () => {
  it("settles on the second draw and keeps the frame-scoped updates", () => {
    const mesh = litMesh();
    mesh.static = true;
    const observer = observerFor(mesh);

    const first = draw(mesh, observer);
    expect(first.settled).toBe(false);
    expect(first.counts).toMatchObject({
      objectGroupWrites: 2,
      objectNodeUpdates: 2,
      frameNodeUpdates: 1,
      attributeScans: 1,
    });

    const second = draw(mesh, observer);
    expect(second.settled).toBe(true);
    expect(second.counts).toMatchObject({
      objectGroupWrites: 1,
      objectNodeUpdates: 0,
      frameNodeUpdates: 1,
      attributeScans: 0,
    });
  });

  it("refreshes a static object that moved, and settles again once it stops", () => {
    const mesh = litMesh();
    mesh.static = true;
    const observer = observerFor(mesh);
    expect(draw(mesh, observer).settled).toBe(false);
    expect(draw(mesh, observer).settled).toBe(true);

    mesh.position.x = 4;
    mesh.updateMatrixWorld();
    const moved = draw(mesh, observer);
    expect(moved.settled).toBe(false);
    expect(moved.counts).toMatchObject({
      objectGroupWrites: 2,
      objectNodeUpdates: 2,
      attributeScans: 1,
    });

    expect(draw(mesh, observer).settled).toBe(true);
  });

  it("refreshes a static object whose material or geometry was edited", () => {
    const mesh = litMesh();
    mesh.static = true;
    const observer = observerFor(mesh);
    draw(mesh, observer);
    expect(draw(mesh, observer).settled).toBe(true);

    (mesh.material as { version: number }).version += 1;
    expect(draw(mesh, observer).settled).toBe(false);
    expect(draw(mesh, observer).settled).toBe(true);

    (mesh.geometry as unknown as { version: number }).version += 1;
    expect(draw(mesh, observer).settled).toBe(false);
  });

  it("refreshes a static object the scene environment changed under", () => {
    const mesh = litMesh();
    mesh.static = true;
    const observer = observerFor(mesh);
    draw(mesh, observer);
    draw(mesh, observer);
    const world = cachedWorld(mesh);
    expect(observer.isSettled(world)).toBe(true);

    // The scene's environment is not the object's, but its value lands in the object's uniforms.
    world.scene.environmentIntensity = 0.5;
    prime(mesh, observer);
    expect(observer.isSettled(world)).toBe(false);

    // Re-armed: the object settles again on the state it was last seen in.
    prime(mesh, observer);
    expect(observer.isSettled(world)).toBe(true);
    world.scene.environmentRotation.set(0, 0.5, 0);
    prime(mesh, observer);
    expect(observer.isSettled(world)).toBe(false);
  });

  it("never settles a moving object, and never settles while motion vectors render", () => {
    const mesh = litMesh();
    const observer = observerFor(mesh);
    for (let frame = 0; frame < 3; frame += 1) {
      mesh.position.x = frame;
      mesh.updateMatrixWorld();
      prime(mesh, observer);
      expect(observer.isSettled(cachedWorld(mesh))).toBe(false);
    }

    mesh.static = true;
    prime(mesh, observer);
    expect(observer.isSettled(cachedWorld(mesh))).toBe(false);
    prime(mesh, observer);
    expect(observer.isSettled(cachedWorld(mesh))).toBe(true);

    // A render that produces motion vectors needs every frame's values, static or not.
    const world = cachedWorld(mesh);
    world.frame = { renderer: { getMRT: () => ({ has: () => true }) } };
    observer.needsRefresh(world, world.frame);
    expect(observer.isSettled(world)).toBe(false);
  });
});
