import {
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from "three";
import { instancedMesh, pass } from "three/tsl";
import { RenderPipeline, WGSLNodeBuilder, WebGPURenderer } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";

import {
  readVelocityPreviousBoneMatrices,
  readVelocityPreviousMatrices,
} from "../src/render/velocity.js";
import { SceneRenderProjection } from "../src/renderProjection.js";
import { createRenderer } from "../src/renderer.js";

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
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
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.add(root);
  mesh.bind(skeleton);
  return mesh;
}

function sceneWithSpecializedObjects(): {
  crowd: InstancedMesh;
  character: SkinnedMesh;
  scene: Scene;
} {
  const scene = new Scene();
  const regularGeometry = new BoxGeometry(1, 1, 1);
  const regularMaterial = new MeshBasicMaterial();
  for (let index = 0; index < 8; index += 1) {
    const mesh = new Mesh(regularGeometry, regularMaterial);
    mesh.position.set(index, 0, -4);
    scene.add(mesh);
  }

  const character = skinnedCharacter();
  character.position.set(-2, 0, -4);
  scene.add(character);

  const crowd = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2);
  crowd.setMatrixAt(0, new Matrix4().makeTranslation(2, 0, -4));
  crowd.setMatrixAt(1, new Matrix4().makeTranslation(4, 0, -4));
  scene.add(crowd);
  return { crowd, character, scene };
}

describe("SceneRenderProjection and the installed output pipeline", () => {
  it("shares generated matrix declarations across independently allocated projection batches", () => {
    const declarations: string[] = [];
    for (const count of [8, 8]) {
      const scene = new Scene();
      const geometry = new BoxGeometry();
      const material = new MeshBasicMaterial();
      for (let index = 0; index < count; index += 1) scene.add(new Mesh(geometry, material));
      const projection = new SceneRenderProjection(scene, { minMeshes: 8 });
      try {
        projection.reconcile();
        const mesh = projection.root.children.find((object) => object instanceof InstancedMesh);
        if (!(mesh instanceof InstancedMesh)) throw new Error("Missing projected instance batch");
        const renderer = new WebGPURenderer({ canvas: testCanvas() });
        const capabilities = Reflect.get(renderer.backend, "capabilities");
        vi.spyOn(capabilities, "getUniformBufferLimit").mockReturnValue(65_536);
        // Three's declaration omits these existing builder methods; generation runs real Three.
        const builder = new WGSLNodeBuilder(mesh, renderer) as WGSLNodeBuilder & {
          setShaderStage(stage: string): void;
          flowStagesNode(node: unknown, output: string): void;
          getUniforms(stage: string): string;
        };
        builder.setShaderStage("vertex");
        builder.flowStagesNode(instancedMesh(mesh), "void");
        declarations.push(builder.getUniforms("vertex"));
      } finally {
        projection.dispose();
        geometry.dispose();
        material.dispose();
      }
    }
    expect(declarations[0]).toContain("mat4x4<f32>");
    expect(declarations[1]).toBe(declarations[0]);
  });

  it("renders the projected root that carries moved skinned and instance history", async () => {
    const canvas = testCanvas();
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { gpu: {} },
    });
    const { crowd, character, scene } = sceneWithSpecializedObjects();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    const scenePass = pass(scene, camera);
    const auxiliaryScene = new Scene();
    const auxiliaryCamera = new PerspectiveCamera(45, 1, 0.1, 50);
    const auxiliaryPass = pass(auxiliaryScene, auxiliaryCamera);
    const outputNode = scenePass.add(auxiliaryPass);
    const renderPipeline = vi
      .spyOn(RenderPipeline.prototype, "render")
      .mockImplementation(() => {});
    let renderer: Awaited<ReturnType<typeof createRenderer>> | undefined;
    const projection = new SceneRenderProjection(scene, { minMeshes: 8, velocity: true });

    try {
      renderer = await createRenderer({
        canvas,
        webgpuFactory: () => ({
          domElement: canvas,
          init: async () => undefined,
          outputColorSpace: "srgb",
          render: () => undefined,
          setSize: () => undefined,
          toneMapping: 0,
        }),
      });
      projection.reconcile();
      expect(projection.deoptimized).toBe(false);
      projection.commit();

      character.skeleton.bones[0]?.position.set(0.75, 0, 0);
      crowd.setMatrixAt(1, new Matrix4().makeTranslation(5, 0, -4));
      projection.reconcile();

      // A direct one-pass graph keeps the original setOutputNode(scenePass) contract.
      renderer.setOutputNode(scenePass);
      renderer.render(projection.root, camera);
      expect(scenePass.scene).toBe(projection.root);
      expect(scenePass.camera).toBe(camera);
      renderPipeline.mockClear();

      renderer.setOutputNode(outputNode, scenePass);
      renderer.render(projection.root, camera);

      expect(renderPipeline).toHaveBeenCalledTimes(1);
      expect(scenePass.scene).toBe(projection.root);
      expect(scenePass.camera).toBe(camera);
      expect(auxiliaryPass.scene).toBe(auxiliaryScene);
      expect(auxiliaryPass.camera).toBe(auxiliaryCamera);

      let renderedCharacter: SkinnedMesh | undefined;
      let renderedCrowd: InstancedMesh | undefined;
      projection.root.traverse((object) => {
        if ((object as SkinnedMesh).isSkinnedMesh === true)
          renderedCharacter = object as SkinnedMesh;
        if ((object as InstancedMesh).isInstancedMesh === true) {
          const candidate = object as InstancedMesh;
          if (candidate.geometry === crowd.geometry) renderedCrowd = candidate;
        }
      });
      expect(renderedCharacter).toBeDefined();
      expect(renderedCrowd).toBeDefined();
      expect(readVelocityPreviousBoneMatrices(renderedCharacter as SkinnedMesh)).toBeDefined();
      expect(readVelocityPreviousMatrices(renderedCrowd as InstancedMesh)).toBeDefined();
      expect(readVelocityPreviousBoneMatrices(renderedCharacter as SkinnedMesh)).not.toEqual(
        renderedCharacter?.skeleton.boneMatrices,
      );
      expect(readVelocityPreviousMatrices(renderedCrowd as InstancedMesh)).not.toEqual(
        renderedCrowd?.instanceMatrix.array,
      );
    } finally {
      projection.dispose();
      renderer?.dispose();
      renderPipeline.mockRestore();
      if (navigatorDescriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    }
  });
});
