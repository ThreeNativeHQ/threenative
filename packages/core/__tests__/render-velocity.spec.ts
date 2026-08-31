import {
  BatchedMesh,
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Scene,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from "three";
import { WGSLNodeBuilder } from "three/webgpu";
import { describe, expect, it } from "vitest";

import { type IRenderChainRenderer, RenderChain } from "../src/render/chain.js";
import { SceneRenderProjection } from "../src/renderProjection.js";

/**
 * Three's own compile-time gate. `NodeBuilder.needsPreviousData()` decides whether `skinning()`,
 * `instance()` and `batch()` emit a `positionPrevious` assignment at all, so it is the only
 * honest question to ask of a velocity provisioning pass.
 */
function needsPreviousData(object: Object3D, mrt: Set<string> | null = null): boolean {
  const renderer = { getMRT: () => mrt };
  return new WGSLNodeBuilder(object, renderer).needsPreviousData();
}

function skinnedCharacter(): SkinnedMesh {
  const geometry = new BoxGeometry(1, 2, 1);
  const vertices = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
  const weights = new Float32Array(vertices * 4);
  for (let index = 0; index < vertices; index += 1) weights[index * 4] = 1;
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
  const root = new Bone();
  const skeleton = new Skeleton([root]);
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  mesh.add(root);
  mesh.bind(skeleton);
  return mesh;
}

function stubRenderer(): IRenderChainRenderer & { velocityEnabled: boolean } {
  return {
    kind: "webgpu",
    raw: {},
    velocityEnabled: false,
    setOutputNode() {},
    clearOutputNode() {},
    setRenderChainVelocityEnabled(enabled: boolean) {
      this.velocityEnabled = enabled;
    },
  } as IRenderChainRenderer & { velocityEnabled: boolean };
}

describe("velocity provisioning on the shipped path", () => {
  it("gives a skinned character and a moving instance previous-frame data when a temporal stage runs", () => {
    const scene = new Scene();
    const wall = new Mesh(new BoxGeometry(20, 6, 0.5), new MeshStandardMaterial());
    wall.position.set(0, 3, -6);
    const character = skinnedCharacter();
    const crowd = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial(), 4);
    for (let index = 0; index < 4; index += 1) {
      crowd.setMatrixAt(index, new Matrix4().makeTranslation(index * 2, 0, 0));
    }
    scene.add(wall, character, crowd);

    const renderer = stubRenderer();
    const chain = new RenderChain({
      renderer,
      request: { stages: ["traa"], velocity: { perObject: true } },
      stages: [{ build: (input) => input ?? {}, name: "traa" }],
      report: () => undefined,
    });
    expect(chain.applied.stages).toContain("traa");

    const projection = new SceneRenderProjection(scene, {
      velocity: () => renderer.velocityEnabled,
    });
    projection.reconcile();

    expect({
      character: needsPreviousData(character),
      crowd: needsPreviousData(crowd),
    }).toEqual({ character: true, crowd: true });
  });

  it("does not report velocity as provisioned when nothing carries previous-frame data", () => {
    const scene = new Scene();
    const character = skinnedCharacter();
    scene.add(character);

    const renderer = stubRenderer();
    const chain = new RenderChain({
      renderer,
      request: { stages: ["traa"], velocity: { perObject: true } },
      stages: [{ build: (input) => input ?? {}, name: "traa" }],
      report: () => undefined,
    });

    expect(needsPreviousData(character)).toBe(false);
    expect(chain.applied.velocity.provisioned).toBe(false);
  });
});
