import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BoxGeometry,
  BufferGeometry,
  InstancedMesh,
  Layers,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Points,
  RawShaderMaterial,
  Scene,
  ShaderMaterial,
  SkinnedMesh,
  Sprite,
  SpriteMaterial,
} from "three";
import { describe, expect, test } from "vitest";

import {
  adviseThreeRenderWorkload,
  type IRenderAdvisorInput,
} from "../src/three/renderWorkloadAdvisor.js";

const EXAMPLES = {
  gpuParticles: "packages/create-threenative/templates/starter/src/render/particles.ts",
  hudInstancing: "packages/create-threenative/templates/starter/src/render/hud.ts",
  materialSharing: "packages/create-threenative/templates/starter/src/render/materials.ts",
  staticMerge: "examples/native-cpu-load-test/src/main.ts",
} as const;
const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

function independent(count: number, material = new MeshStandardMaterial({ color: 0x37b8ff })) {
  const scene = new Scene();
  const geometry = new BoxGeometry(1, 1, 1);
  for (let i = 0; i < count; i += 1) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(i % 100, Math.floor(i / 100), 0);
    scene.add(mesh);
  }
  return scene;
}

function advice(scene: Scene, extra: Partial<IRenderAdvisorInput> = {}) {
  return adviseThreeRenderWorkload({
    observed: {
      renderer: { drawCalls: 4001, triangles: 48001 },
      passes: [
        {
          sceneToken: "scene-token",
          cameraToken: "camera-token",
          targetToken: "screen",
          depthToken: "main",
          purpose: "color",
          equivalenceToken: "same",
          renderCalls: 1,
        },
      ],
    },
    ...extra,
    scene,
    verifiedExamplePaths: EXAMPLES,
  });
}

function codes(scene: Scene, extra: Partial<IRenderAdvisorInput> = {}) {
  return advice(scene, extra).recommendations.map((recommendation) => recommendation.code);
}

describe("render workload advisor", () => {
  test("sanitizes observed renderer counters and rejects unverified example paths", () => {
    const report = advice(independent(1), {
      observed: {
        renderer: {
          drawCalls: 8,
          privatePath: "/home/joao/private/model.glb",
          triangles: Number.NaN,
        } as never,
      },
    });

    expect(report.observed.renderer).toEqual({ drawCalls: 8 });
    expect(JSON.stringify(report.observed.renderer)).not.toContain("privatePath");
    expect(() =>
      adviseThreeRenderWorkload({
        scene: independent(1),
        verifiedExamplePaths: {
          ...EXAMPLES,
          staticMerge: "/home/joao/private/example.ts",
        },
      }),
    ).toThrow(/verifiedExamplePaths\.staticMerge/);
  });

  test("verified example paths are exact repo-relative allowlist entries that exist", () => {
    for (const value of Object.values(EXAMPLES)) {
      expect(path.isAbsolute(value)).toBe(false);
      expect(existsSync(path.join(REPO_ROOT, value))).toBe(true);
    }
  });

  test("shader node and mapped material groups suppress material-sharing advice with bounded reasons", () => {
    const fixtures = [
      { material: () => new ShaderMaterial(), reason: "materialCustomShader" },
      { material: () => new RawShaderMaterial(), reason: "materialCustomShader" },
      { material: () => ({ type: "MeshStandardNodeMaterial" }), reason: "materialCustomNode" },
      {
        material: () => {
          const material = new MeshBasicMaterial({ color: 0xff0000 });
          material.map = { isTexture: true } as never;
          return material;
        },
        reason: "materialTextureMap",
      },
    ];

    for (const fixture of fixtures) {
      const scene = new Scene();
      const geometry = new BoxGeometry(1, 1, 1);
      for (let i = 0; i < 32; i += 1) scene.add(new Mesh(geometry, fixture.material() as never));

      const report = advice(scene, { materialMutationSafety: "caller-declared-stable" });

      expect(report.recommendations.map((recommendation) => recommendation.code)).not.toContain(
        "TN_RENDER_ADVISE_SHARE_MATERIALS",
      );
      expect(report.topGroups.some((group) => group.constraintReasonCounts[fixture.reason] === 32)).toBe(true);
    }
  });

  test("reports bounded aggregate JSON and does not leak private names tokens UUIDs URLs paths or retain refs", () => {
    const scene = independent(32);
    scene.name = "secret-scene";
    const firstChild = scene.children[0];
    if (firstChild === undefined) throw new Error("privacy fixture requires a child.");
    firstChild.name = "secret-url-https://example.com/asset.glb";
    const before = scene.children.map((child) => ({
      child,
      geometry: (child as Mesh).geometry,
      layers: child.layers.mask,
      matrix: child.matrix.clone(),
      material: (child as Mesh).material,
      onAfterRender: child.onAfterRender,
      onBeforeRender: child.onBeforeRender,
      parent: child.parent,
      renderOrder: child.renderOrder,
      visible: child.visible,
    }));
    const report = advice(scene, {
      observed: {
        renderer: { drawCalls: 32, triangles: 384 },
        passes: [
          {
            sceneToken: "/home/joao/private-game/secret-scene.glb",
            cameraToken: "camera-secret-name",
            targetToken: "https://private.invalid/render-target",
            depthToken: "main-depth",
            purpose: "color",
            equivalenceToken: "same-secret-pass",
            renderCalls: 1,
          },
        ],
      },
      sceneCollapse: {
        schemaVersion: 1,
        status: "applied-with-/private/path" as never,
        reasonCode: "secret-/private/path" as never,
        sourceMeshes: 32,
        mergedMeshes: 1,
      },
    });
    const text = JSON.stringify(report);
    expect(report.schemaVersion).toBe(1);
    expect(text).not.toMatch(/secret|uuid|https|asset\.glb|private-game|Object3D|Material|Geometry/u);
    expect(text.length).toBeLessThan(64_000);
    expect(report.observed.passes).toEqual({ recorded: 1, truncated: 0 });
    expect(report.sceneCollapse).toMatchObject({ status: "rejected", reasonCode: "unknown" });
    for (const item of before) {
      expect(item.child.parent).toBe(item.parent);
      expect((item.child as Mesh).geometry).toBe(item.geometry);
      expect((item.child as Mesh).material).toBe(item.material);
      expect(item.child.visible).toBe(item.visible);
      expect(item.child.layers.mask).toBe(item.layers);
      expect(item.child.renderOrder).toBe(item.renderOrder);
      expect(item.child.onBeforeRender).toBe(item.onBeforeRender);
      expect(item.child.onAfterRender).toBe(item.onAfterRender);
      expect(item.child.matrix.equals(item.matrix)).toBe(true);
    }
    assert.doesNotThrow(() => JSON.parse(text));
  });

  test("4k compatible independent dynamic meshes recommend instancing but static merge requires caller-declared static safety", () => {
    const dynamic = advice(independent(4_000));
    expect(dynamic.snapshot.visibleFlagRenderableCount).toBe(4_000);
    expect(dynamic.snapshot.logicalObjectCountIncludesRootScene).toBe(true);
    expect(dynamic.observed.renderer.drawCalls).toBe(4_001);
    expect(dynamic.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TN_RENDER_ADVISE_INSTANCE_COMPATIBLE",
          owner: "generated-src",
          observedCount: 4_000,
          expectedReducedCount: 1,
          examplePath: EXAMPLES.staticMerge,
        }),
      ]),
    );
    expect(dynamic.recommendations.flatMap((r) => r.caveats)).toEqual(
      expect.arrayContaining(["static-merge-requires-caller-declared-static-transforms"]),
    );
    expect(dynamic.recommendations.map((r) => r.code)).not.toContain(
      "TN_RENDER_ADVISE_STATIC_MERGE_COMPATIBLE",
    );

    const staticReport = advice(independent(4_000), { transformSafety: "caller-declared-static" });
    expect(staticReport.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TN_RENDER_ADVISE_STATIC_MERGE_COMPATIBLE",
          expectedReducedCount: 1,
        }),
      ]),
    );
  });

  test("group counts are truthful for two geometries and two materials", () => {
    const scene = new Scene();
    const geometries = [new BoxGeometry(1, 1, 1), new BoxGeometry(2, 1, 1)];
    const materials = [new MeshBasicMaterial({ color: 0xff0000 }), new MeshBasicMaterial({ color: 0x0000ff })];
    for (const geometry of geometries) {
      for (const material of materials) {
        for (let i = 0; i < 32; i += 1) scene.add(new Mesh(geometry, material));
      }
    }
    const report = advice(scene, { topN: Number.NaN });
    expect(report.topGroups).toHaveLength(4);
    expect(report.topGroups.every((group) => group.memberCount === 32)).toBe(true);
    expect(report.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TN_RENDER_ADVISE_INSTANCE_COMPATIBLE",
          expectedReducedCount: 4,
          observedCount: 128,
        }),
      ]),
    );
  });

  test("already instanced and merged fixtures suppress repeated-object warnings", () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshBasicMaterial();
    const instanced = new Scene();
    instanced.add(new InstancedMesh(geometry, material, 4_000));
    expect(codes(instanced)).not.toContain("TN_RENDER_ADVISE_INSTANCE_COMPATIBLE");
    const merged = new Scene();
    merged.add(new Mesh(new BoxGeometry(40, 40, 1), material));
    expect(codes(merged)).not.toContain("TN_RENDER_ADVISE_INSTANCE_COMPATIBLE");
  });

  test("distinct equal-looking materials recommend sharing only with caller mutation safety", () => {
    const scene = new Scene();
    const geometry = new BoxGeometry(1, 1, 1);
    for (let i = 0; i < 128; i += 1)
      scene.add(new Mesh(geometry, new MeshStandardMaterial({ color: 0xff0000, roughness: 0.5, metalness: 0.1 })));
    const unsafe = advice(scene);
    expect(unsafe.recommendations.map((recommendation) => recommendation.code)).not.toContain("TN_RENDER_ADVISE_SHARE_MATERIALS");
    expect(unsafe.recommendations).toHaveLength(0);
    const safe = advice(scene, { materialMutationSafety: "caller-declared-stable" });
    expect(safe.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TN_RENDER_ADVISE_SHARE_MATERIALS", expectedReducedCount: 1 }),
      ]),
    );
  });

  test("unsafe semantics produce explicit reason codes and no instance or merge advice", () => {
    const cases: Array<[string, (mesh: Mesh) => Object3D]> = [
      ["transparentMaterial", (m) => { (m.material as Material).transparent = true; return m; }],
      ["renderHook", (m) => { m.onBeforeRender = () => undefined; return m; }],
      ["customLayerMask", (m) => { m.layers = new Layers(); m.layers.set(2); return m; }],
      ["customRenderOrder", (m) => { m.renderOrder = 5; return m; }],
      ["morphTargets", (m) => { m.morphTargetInfluences = [0.5]; return m; }],
      ["skinnedMesh", () => new SkinnedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())],
      ["customShader", () => new Mesh(new BoxGeometry(1, 1, 1), new ShaderMaterial())],
      ["customShader", () => new Mesh(new BoxGeometry(1, 1, 1), new RawShaderMaterial())],
      ["customNode", () => new Mesh(new BoxGeometry(1, 1, 1), { type: "MeshStandardNodeMaterial" } as never)],
    ];
    for (const [reason, mutate] of cases) {
      const scene = new Scene();
      const geometry = new BoxGeometry(1, 1, 1);
      const material = new MeshBasicMaterial();
      for (let i = 0; i < 32; i += 1) scene.add(mutate(new Mesh(geometry, material)));
      const report = advice(scene, { transformSafety: "caller-declared-static" });
      expect(report.recommendations.map((r) => r.code)).not.toContain("TN_RENDER_ADVISE_INSTANCE_COMPATIBLE");
      expect(report.recommendations.map((r) => r.code)).not.toContain("TN_RENDER_ADVISE_STATIC_MERGE_COMPATIBLE");
      expect(JSON.stringify(report.topGroups)).toContain(reason);
    }
  });

  test("sprites advise only caller-declared camera overlays and Points already batched stays silent", () => {
    const worldSprites = new Scene();
    const spriteMaterial = new SpriteMaterial();
    for (let i = 0; i < 128; i += 1) worldSprites.add(new Sprite(spriteMaterial));
    expect(codes(worldSprites)).not.toContain("TN_RENDER_ADVISE_HUD_INSTANCING");

    const overlaySprites = advice(worldSprites, { spriteWorkload: "caller-declared-camera-overlay" });
    expect(overlaySprites.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TN_RENDER_ADVISE_HUD_INSTANCING", examplePath: EXAMPLES.hudInstancing }),
      ]),
    );

    const onePoints = new Scene();
    onePoints.add(new Points(new BufferGeometry(), new MeshBasicMaterial()));
    expect(codes(onePoints)).not.toContain("TN_RENDER_ADVISE_GPU_PARTICLES");

    const manyPointObjects = new Scene();
    for (let i = 0; i < 64; i += 1) manyPointObjects.add(new Points(new BufferGeometry(), new MeshBasicMaterial()));
    expect(codes(manyPointObjects, { particleWorkload: "caller-declared-many-independent-objects" })).toContain(
      "TN_RENDER_ADVISE_GPU_PARTICLES",
    );
  });

  test("repeated pass advice requires explicit equivalent observed semantics and does not serialize raw tokens", () => {
    const scene = independent(16);
    const positive = advice(scene, { observed: { renderer: { drawCalls: 32, triangles: 384 }, passes: [
      { sceneToken: "a", cameraToken: "c", targetToken: "screen", depthToken: "main", purpose: "color", equivalenceToken: "same", renderCalls: 1 },
      { sceneToken: "a", cameraToken: "c", targetToken: "screen", depthToken: "main", purpose: "color", equivalenceToken: "same", renderCalls: 1 },
    ] } });
    expect(positive.recommendations.map((r) => r.code)).toContain("TN_RENDER_ADVISE_REPEATED_PASS");
    expect(JSON.stringify(positive)).not.toContain("same");

    const negative = advice(scene, { observed: { renderer: { drawCalls: 32, triangles: 384 }, passes: [
      { sceneToken: "a", cameraToken: "c", targetToken: "screen", depthToken: "main", purpose: "color", equivalenceToken: "same", renderCalls: 1 },
      { sceneToken: "a", cameraToken: "c", targetToken: "shadow", depthToken: "shadow", purpose: "shadow", equivalenceToken: "different", renderCalls: 1 },
    ] } });
    expect(negative.recommendations.map((r) => r.code)).not.toContain("TN_RENDER_ADVISE_REPEATED_PASS");
    expect(JSON.stringify(negative.passObservations)).toContain("differentPassSemantics");
  });

  test("invalid or oversized observed input fails closed or reports truncation", () => {
    expect(() => advice(independent(1), { observed: { passes: [{ sceneToken: 42 as never, cameraToken: "c" } as never] } })).toThrow(/observed.passes/);
    const passes = Array.from({ length: 80 }, (_, index) => ({
      sceneToken: `scene-${index}`,
      cameraToken: "camera",
      targetToken: "screen",
      depthToken: "main",
      purpose: "color" as const,
      equivalenceToken: `eq-${index}`,
      renderCalls: 1,
    }));
    const report = advice(independent(1), { observed: { passes } });
    expect(report.observed.passes).toEqual({ recorded: 64, truncated: 16 });
  });

  test("SceneCollapse aggregate outcome is included and applied reductions only suppress current collapsed result", () => {
    const stale = advice(independent(4_000), {
      sceneCollapse: {
        schemaVersion: 1,
        status: "applied",
        reasonCode: "applied",
        sourceMeshes: 4_000,
        mergedMeshes: 2,
        sourceMaterialIdentities: 1,
        mergedMaterialIdentities: 1,
      },
    });
    expect(stale.recommendations.map((r) => r.code)).toContain("TN_RENDER_ADVISE_INSTANCE_COMPATIBLE");
    expect(stale.recommendations.flatMap((r) => r.caveats)).toContain("scene-collapse-report-must-describe-current-graph");

    const current = new Scene();
    current.add(new Mesh(new BoxGeometry(40, 40, 1), new MeshBasicMaterial()));
    const collapsed = advice(current, {
      sceneCollapse: {
        schemaVersion: 1,
        status: "applied",
        reasonCode: "applied",
        sourceMeshes: 4_000,
        mergedMeshes: 1,
        sourceMaterialIdentities: 1,
        mergedMaterialIdentities: 1,
      },
    });
    expect(collapsed.sceneCollapse?.status).toBe("applied");
    expect(collapsed.recommendations.map((r) => r.code)).not.toContain("TN_RENDER_ADVISE_INSTANCE_COMPATIBLE");
  });
});
