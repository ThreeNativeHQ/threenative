import { GroundSnap } from "@threenative/core";
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { preparePlayerConventions as prepareRpgConventions } from "../templates/action-rpg/src/conventions.js";
import { createSword } from "../templates/action-rpg/src/render/props.js";
import { prepareCommanderConventions } from "../templates/defense/src/conventions.js";
import { commander } from "../templates/defense/src/render/shapes.js";
import { preparePlayerConventions as prepareMinimalConventions } from "../templates/minimal/src/conventions.js";
import { createFox } from "../templates/platformer/src/render/fox.js";
import { prepareVehicleConventions } from "../templates/racing/src/conventions.js";
import { createMaterials as createRacingMaterials } from "../templates/racing/src/render/materials.js";
import { vehicle } from "../templates/racing/src/render/shapes.js";
import { prepareShipConventions } from "../templates/sailing/src/conventions.js";
import { createShipModel } from "../templates/sailing/src/render/props.js";
import { preparePlayerConventions as prepareStarterConventions } from "../templates/starter/src/conventions.js";
import { templatedRig } from "./templated-rig.js";

const FRAME = 1 / 60;

function expectFactor(factor: number): void {
  expect(Number.isFinite(factor)).toBe(true);
  expect(Math.abs(factor - 1)).toBeGreaterThan(0.0001);
}

function expectGrounding(
  model: Object3D,
  conventions: {
    readonly applyGrounding: (surfaceY: number, dt: number) => void;
    readonly groundSnap: GroundSnap;
  },
): void {
  model.position.y = 0.5;
  const disabledMeasurement = new GroundSnap(model, { enabled: false });
  disabledMeasurement.apply(model, 0, FRAME);
  const before = disabledMeasurement.clearance;
  conventions.applyGrounding(0, FRAME);
  const after = conventions.groundSnap.clearance;
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  if (before === null || after === null) throw new Error("Grounding did not report clearance.");
  expect(Number.isFinite(after)).toBe(true);
  expect(Math.abs(after)).toBeLessThan(Math.abs(before));
}

describe("generated template conventions", () => {
  it("grounds, scales, and attaches the action-rpg player", () => {
    // The three conventions a rigged character owes its level, in the order they depend on each
    // other: measure the crown, hold the prop by bone name, then keep the soles on the floor.
    const { scene } = templatedRig(["Sword_Idle"]);
    const conventions = prepareRpgConventions(scene, createSword());

    expectFactor(conventions.normaliseFactor);
    expect(conventions.boneNames).toContain("hand_r");
    expect(conventions.attachedBone).toBe("hand_r");
    expectGrounding(scene, conventions);
  });

  it("reports no attached bone for a bare-handed action-rpg fighter", () => {
    // The raiders swing bare fists, so `attachToBone` is skipped for them. Reporting the name of
    // a bone that was never asked for would be a lie the survives scenario would then assert.
    const { scene } = templatedRig(["Idle_Loop"]);

    expect(prepareRpgConventions(scene).attachedBone).toBe("");
  });

  it("grounds and scales the defense commander", () => {
    const model = commander();
    const conventions = prepareCommanderConventions(model);

    expectFactor(conventions.normaliseFactor);
    expectGrounding(model, conventions);
  });

  it("measures disabled grounding while scaling the minimal player", () => {
    const model = new Mesh(new BoxGeometry(0.6, 1, 0.6), new MeshBasicMaterial());
    const conventions = prepareMinimalConventions(model);
    const beforeY = 0.5;
    model.position.y = beforeY;
    conventions.applyGrounding(0, FRAME);

    expectFactor(conventions.normaliseFactor);
    expect(conventions.groundSnap.clearance).not.toBeNull();
    expect(Number.isFinite(conventions.groundSnap.clearance)).toBe(true);
    expect(model.position.y).toBe(beforeY);
  });

  it("authors the platformer fox in metres, so it needs neither a scale nor a snap", () => {
    // The platformer's applicability row is N/A for both generated conventions, and this is what
    // makes that honest rather than a gap: the rig is built from primitives with its feet on
    // y = 0, and the collider is the `CharacterBody3D` capsule the body already sits on. There is
    // no imported scale to normalise and no visual offset from the body to snap back.
    const fox = createFox();
    const rig = fox.group;
    rig.updateMatrixWorld(true);
    const box = new Box3().setFromObject(rig);

    expect(Number.isFinite(box.min.y)).toBe(true);
    expect(box.min.y).toBeCloseTo(0, 5);
    // A fox-sized character: under two metres, over one, and taller than it is long.
    expect(box.max.y).toBeGreaterThan(1);
    expect(box.max.y).toBeLessThan(2);
    expect(box.max.y).toBeGreaterThan(box.max.x - box.min.x);
  });

  it("scales the racing vehicle", () => {
    const model = vehicle(createRacingMaterials());

    expectFactor(prepareVehicleConventions(model));
  });

  it("scales the sailing ship", () => {
    // `createShipModel` now wraps the loaded `ship.glb` rather than building geometry from
    // materials; a boxed stand-in gives it a real bounding box to normalise without a fixture GLB.
    const scene = new Mesh(new BoxGeometry(4, 2, 12), new MeshBasicMaterial());
    const model = createShipModel({ scene });

    expectFactor(prepareShipConventions(model));
  });

  it("grounds and scales the starter player", () => {
    const model = new Mesh(new BoxGeometry(0.6, 1, 0.6), new MeshBasicMaterial());
    const conventions = prepareStarterConventions(model);

    expectFactor(conventions.normaliseFactor);
    expectGrounding(model, conventions);
  });
});
