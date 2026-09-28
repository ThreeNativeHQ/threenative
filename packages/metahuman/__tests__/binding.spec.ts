import { Object3D } from "three";
import { describe, expect, it } from "vitest";

import {
  JOINT_NAMES,
  REFERENCE,
  RigEvaluator,
  byName,
  closeArray,
  closeTo,
  expectedJoints,
  head,
  jointNode,
  load,
  sameRotation,
} from "./synthetic-scene.js";

/**
 * The Three.js binding, driven against the committed synthetic rig.
 *
 * Redistributable and always run: the DNA is the committed fixture and the model is built in
 * `synthetic-scene.ts`, so this lane needs no licensed specimen. What it proves is the *binding* —
 * that a declared control moves the joints and morph targets its sidecar names, that a LOD switch
 * is atomic and keeps the expression, and that a disposed handle refuses everything.
 */

describe("loadMetaHuman over the committed synthetic rig", () => {
  it("reports the rig it loaded and controls exactly what the sidecar declared", async () => {
    const human = await load();
    try {
      const diagnostics = human.diagnostics();
      expect(diagnostics.backend).toBe("wasm");
      expect(diagnostics.openRigLogic).toBe(await RigEvaluator.upstreamCommit());
      expect(diagnostics.joints).toBe(REFERENCE.counts.joint);
      expect(diagnostics.blendShapes).toBe(REFERENCE.counts.blendshape);
      expect(diagnostics.animatedMaps).toBe(REFERENCE.counts.animatedMap);
      expect(diagnostics.lod).toBe(0);
      expect(human.controls.map((control) => control.alias)).toEqual(REFERENCE.names.gui);
      expect(human.controls[0]).toMatchObject({ min: 0, max: 1, default: 0 });
      expect(human.animatedMapNames()).toEqual(REFERENCE.names.animatedMap);
    } finally {
      human.dispose();
    }
  });

  it("leaves the rest pose alone where the rig's neutral controls move nothing", async () => {
    const human = await load();
    try {
      human.update();
      const expected = expectedJoints("neutral_gui_lod0");
      for (const [index, name] of JOINT_NAMES.entries()) {
        const node = jointNode(human.root, name);
        const want = expected[index];
        if (want === undefined) throw new Error(`no expectation for ${name}`);
        expect(node.position.distanceTo(want.position), `${name} translation`).toBeLessThan(1e-6);
        expect(sameRotation(node.quaternion, want.quaternion), `${name} rotation`).toBe(true);
        expect(node.scale.distanceTo(want.scale), `${name} scale`).toBeLessThan(1e-6);
      }
      // Two of the three synthetic joints have an identity delta at neutral, so those two nodes
      // are still exactly where the exported bind pose put them.
      expect(jointNode(human.root, "face_root").position.length()).toBe(0);
      closeArray(
        head(human, "head").morphTargetInfluences,
        byName.get("neutral_gui_lod0")?.blendshapes,
        "neutral blendshapes",
      );
      closeArray(
        human.animatedMaps(),
        byName.get("neutral_gui_lod0")?.animatedMaps,
        "neutral animated maps",
      );
    } finally {
      human.dispose();
    }
  });

  for (const [alias, caseName] of [
    ["jawOpen", "gui_jawOpen_only"],
    ["browRaise", "gui_browRaise_only"],
    ["smile", "gui_smile_only"],
  ] as const) {
    it(`drives ${alias} to the reference pose and morphs`, async () => {
      const human = await load();
      try {
        human.setControls({ [alias]: 1 });
        human.update();
        const expected = expectedJoints(caseName);
        for (const [index, name] of JOINT_NAMES.entries()) {
          const node = jointNode(human.root, name);
          const want = expected[index];
          if (want === undefined) throw new Error(`no expectation for ${name}`);
          expect(node.position.distanceTo(want.position), `${name} translation`).toBeLessThan(1e-6);
          expect(sameRotation(node.quaternion, want.quaternion), `${name} rotation`).toBe(true);
          expect(node.scale.distanceTo(want.scale), `${name} scale`).toBeLessThan(1e-6);
        }
        closeArray(
          head(human, "head").morphTargetInfluences,
          byName.get(caseName)?.blendshapes,
          `${alias} blendshapes`,
        );
        closeArray(
          human.animatedMaps(),
          byName.get(caseName)?.animatedMaps,
          `${alias} animated maps`,
        );
      } finally {
        human.dispose();
      }
    });
  }

  it("switches LOD atomically, keeps the expression and comes back identically", async () => {
    const controls = { jawOpen: 0.6, browRaise: 0.25, smile: 0.8 };
    const human = await load();
    const fromScratchAtLod1 = await load(1);
    try {
      human.setControls(controls);
      human.update();
      const lod0Influences = [...(head(human, "head").morphTargetInfluences ?? [])];
      const jointState = () =>
        JOINT_NAMES.flatMap((name) => {
          const node = jointNode(human.root, name);
          return [node.position.toArray(), node.quaternion.toArray(), node.scale.toArray()];
        });
      const beforeSwitch = jointState();
      for (const [index, name] of JOINT_NAMES.entries()) {
        const node = jointNode(human.root, name);
        const want = expectedJoints("mixed_gui_lod0")[index];
        if (want === undefined) throw new Error(`no expectation for ${name}`);
        expect(node.position.distanceTo(want.position), `${name} translation`).toBeLessThan(1e-6);
        expect(sameRotation(node.quaternion, want.quaternion), `${name} rotation`).toBe(true);
      }

      // Every moment the LOD1 mesh is shown it is already posed: no neutral frame in between.
      const shown: number[] = [];
      const mesh = head(human, "head_lod1");
      let visible = true;
      Object.defineProperty(mesh, "visible", {
        configurable: true,
        get: () => visible,
        set: (value: boolean) => {
          visible = value;
          if (value) shown.push(mesh.morphTargetInfluences?.[0] ?? 0);
        },
      });

      human.setLod(1);
      expect(head(human, "head").visible).toBe(false);
      expect(head(human, "head_lod1").visible).toBe(true);
      expect(shown).toHaveLength(1);
      expect(shown.every((weight) => weight > 0)).toBe(true);

      // Every LOD0-only target is cleared, and what is left is the expression the same controls
      // produce in a handle that was loaded at LOD1 to begin with.
      expect([...(head(human, "head").morphTargetInfluences ?? [])]).toEqual([0, 0, 0, 0]);
      fromScratchAtLod1.setControls(controls);
      fromScratchAtLod1.update();
      const fromScratchMesh = head(fromScratchAtLod1, "head_lod1");
      for (const [index, weight] of (mesh.morphTargetInfluences ?? []).entries())
        expect(
          closeTo(weight, fromScratchMesh.morphTargetInfluences?.[index] ?? 0),
          `lod1 morph ${String(index)}`,
        ).toBe(true);
      for (const name of JOINT_NAMES) {
        const node = jointNode(human.root, name);
        const other = jointNode(fromScratchAtLod1.root, name);
        expect(node.position.distanceTo(other.position), `${name} translation`).toBeLessThan(1e-9);
        expect(sameRotation(node.quaternion, other.quaternion), `${name} rotation`).toBe(true);
      }

      human.setLod(0);
      expect(head(human, "head").visible).toBe(true);
      expect(head(human, "head_lod1").visible).toBe(false);
      closeArray(
        head(human, "head").morphTargetInfluences,
        lod0Influences,
        "returned LOD0 blendshapes",
      );
      // Back on LOD0 the pose is the one the switch left, not a re-derived near miss.
      expect(jointState()).toEqual(beforeSwitch);
    } finally {
      fromScratchAtLod1.dispose();
      human.dispose();
    }
  });

  it("restores the declared defaults exactly", async () => {
    const human = await load();
    try {
      const neutral = expectedJoints("neutral_gui_lod0");
      human.setControls({ jawOpen: 1, smile: 0.5 });
      human.update();
      human.reset();
      human.update();
      for (const [index, name] of JOINT_NAMES.entries()) {
        const node = jointNode(human.root, name);
        const want = neutral[index];
        if (want === undefined) throw new Error(`no expectation for ${name}`);
        expect(node.position.distanceTo(want.position), `${name} translation`).toBeLessThan(1e-6);
        expect(sameRotation(node.quaternion, want.quaternion), `${name} rotation`).toBe(true);
      }
      closeArray(
        head(human, "head").morphTargetInfluences,
        byName.get("neutral_gui_lod0")?.blendshapes,
        "reset blendshapes",
      );
    } finally {
      human.dispose();
    }
  });

  it("refuses an unknown alias, an out-of-domain value and a bad LOD", async () => {
    const human = await load();
    try {
      expect(() => human.setControls({ notAControl: 1 })).toThrowError(/TN_MH_UNKNOWN_CONTROL/u);
      expect(() => human.setControls({ jawOpen: 1.5 })).toThrowError(/TN_MH_BAD_DOMAIN/u);
      expect(() => human.setControls({ jawOpen: Number.NaN })).toThrowError(/TN_MH_NON_FINITE/u);
      expect(() => human.setControls({ jawOpen: "1" as unknown as number })).toThrowError(
        /TN_MH_BAD_DOMAIN/u,
      );
      expect(() => human.setLod(2)).toThrowError(/TN_MH_BAD_LOD/u);
      expect(() => human.setLod(-1)).toThrowError(/TN_MH_BAD_LOD/u);
      // A rejected call changes nothing: the face is still where the last good call left it.
      human.update();
      const before = jointNode(human.root, "jaw").position.toArray();
      expect(() => human.setControls({ jawOpen: 9 })).toThrowError(/TN_MH_BAD_DOMAIN/u);
      human.update();
      expect(jointNode(human.root, "jaw").position.toArray()).toEqual(before);
    } finally {
      human.dispose();
    }
  });

  it("refuses every call after disposal, and disposal is idempotent", async () => {
    const human = await load();
    const parent = new Object3D();
    parent.add(human.root);
    human.dispose();
    expect(() => human.dispose()).not.toThrow();
    expect(human.root.parent).toBeNull();
    for (const call of [
      () => human.update(),
      () => human.reset(),
      () => human.setControls({ jawOpen: 0.1 }),
      () => human.setLod(1),
      () => human.diagnostics(),
      () => human.animatedMaps(),
      () => human.animatedMapNames(),
    ])
      expect(call).toThrowError(/TN_MH_DISPOSED/u);
  });
});
