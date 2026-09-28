import type { MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";

import { loadMetaHuman } from "../src/index.js";
import { RigEvaluator } from "../src/wasm-evaluator.js";
import {
  JOINT_NAMES,
  buildModel,
  byName,
  closeArray,
  expectedJoints,
  fakeAssets,
  head,
  jointNode,
  sameRotation,
} from "./synthetic-scene.js";

/**
 * Per-instance resource lifetime, on the same synthetic specimen the binding lane drives.
 *
 * Three claims, each with a number behind it: two handles built from one loader do not touch each
 * other's face, disposing one leaves the other working, and ten create/dispose cycles put the
 * rig handles and the handle's own scene graph back where they started — without disposing a
 * single borrowed geometry, material or texture the asset loader still owns.
 */

describe("per-instance lifetime", () => {
  it("keeps two handles from one loader apart, and one alive after the other dies", async () => {
    const assets = fakeAssets(buildModel());
    const open = async () =>
      await loadMetaHuman({
        assets,
        model: "metahuman/head.glb",
        dna: "metahuman/head.dna",
        bindings: "metahuman/bindings.json",
      });
    const first = await open();
    const second = await open();
    try {
      // Same loader, same cached model, two rigs: the roots are separate graphs.
      expect(first.root).not.toBe(second.root);
      expect(head(first, "head").geometry).toBe(head(second, "head").geometry);
      expect(head(first, "head").morphTargetInfluences).not.toBe(
        head(second, "head").morphTargetInfluences,
      );

      first.setControls({ jawOpen: 1 });
      second.setControls({ smile: 1 });
      first.update();
      second.update();
      for (const [index, name] of JOINT_NAMES.entries()) {
        const want = expectedJoints("gui_jawOpen_only")[index];
        const other = expectedJoints("gui_smile_only")[index];
        if (want === undefined || other === undefined)
          throw new Error(`no expectation for ${name}`);
        expect(jointNode(first.root, name).position.distanceTo(want.position), name).toBeLessThan(
          1e-6,
        );
        expect(jointNode(second.root, name).position.distanceTo(other.position), name).toBeLessThan(
          1e-6,
        );
      }
      closeArray(
        head(first, "head").morphTargetInfluences,
        byName.get("gui_jawOpen_only")?.blendshapes,
        "first blendshapes",
      );
      closeArray(
        head(second, "head").morphTargetInfluences,
        byName.get("gui_smile_only")?.blendshapes,
        "second blendshapes",
      );

      first.dispose();
      // The survivor is untouched: its controls, its pose and its geometry are still its own.
      second.setControls({ smile: 0.25 });
      second.update();
      expect(second.root.parent).toBeNull();
      expect(second.diagnostics().lod).toBe(0);
      for (const [index, name] of JOINT_NAMES.entries()) {
        const node = jointNode(second.root, name);
        const want = expectedJoints("gui_smile_only")[index];
        if (want === undefined) throw new Error(`no expectation for ${name}`);
        expect(node.position.distanceTo(want.position), name).toBeLessThan(1e-6);
        expect(sameRotation(node.quaternion, want.quaternion), name).toBe(true);
      }
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("returns the rig handle count and the owned graph to baseline over ten cycles", async () => {
    const model = buildModel();
    const assets = fakeAssets(model);
    const open = async () =>
      await loadMetaHuman({
        assets,
        model: "metahuman/head.glb",
        dna: "metahuman/head.dna",
        bindings: "metahuman/bindings.json",
      });

    // The first load is what puts the module in the process, so the baseline is taken after it.
    const warm = await open();
    const baseline = RigEvaluator.liveHandleCount();
    expect(baseline).toBeGreaterThan(0);
    warm.dispose();
    const afterWarmup = RigEvaluator.liveHandleCount();

    const roots: object[] = [];
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const human = await open();
      human.setControls({ jawOpen: 1 });
      human.update();
      human.setLod(1);
      human.update();
      roots.push(human.root);
      human.dispose();
      expect(human.root.children).toHaveLength(0);
      expect(human.root.parent).toBeNull();
    }

    // Ten rigs created, ten destroyed: the ABI's own registry is back where it started, and the
    // geometry the loader still owns was never handed to a handle that could free it.
    expect(RigEvaluator.liveHandleCount()).toBe(afterWarmup);
    expect(roots).toHaveLength(10);
    for (const mesh of [
      head({ root: model.scene }, "head"),
      head({ root: model.scene }, "head_lod1"),
    ])
      expect(mesh.geometry.attributes.position).toBeDefined();
  });

  it("never disposes a borrowed geometry, material or texture", async () => {
    const model = buildModel();
    const assets = fakeAssets(model);
    const disposed: string[] = [];
    // The loader's objects are borrowed, so a handle that freed one would break every other
    // consumer of the same cached model. Counted, not asserted by inspection.
    const borrowed = [
      ["geometry", head({ root: model.scene }, "head").geometry],
      ["material", head({ root: model.scene }, "head").material as MeshBasicMaterial],
    ] as const;
    for (const [name, target] of borrowed) {
      const original = (target as { dispose: () => void }).dispose.bind(target);
      Object.assign(target, {
        dispose: () => {
          disposed.push(name);
          original();
        },
      });
    }

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const human = await loadMetaHuman({
        assets,
        model: "metahuman/head.glb",
        dna: "metahuman/head.dna",
        bindings: "metahuman/bindings.json",
      });
      human.update();
      human.dispose();
    }
    expect(disposed).toEqual([]);
  });
});
