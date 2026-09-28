import { GroundSnap } from "@threenative/core";
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { preparePlayerConventions as prepareRpgConventions } from "../templates/action-rpg/src/conventions.js";
import { createMaterials as createRpgMaterials } from "../templates/action-rpg/src/render/materials.js";
import { createPlayerVisual as createRpgVisual } from "../templates/action-rpg/src/render/shapes.js";
import { prepareCommanderConventions } from "../templates/defense/src/conventions.js";
import { commander } from "../templates/defense/src/render/shapes.js";
import { preparePlayerConventions as prepareMinimalConventions } from "../templates/minimal/src/conventions.js";
import { createFox } from "../templates/platformer/src/render/fox.js";
import { prepareVehicleConventions } from "../templates/racing/src/conventions.js";
import { createMaterials as createRacingMaterials } from "../templates/racing/src/render/materials.js";
import { vehicle } from "../templates/racing/src/render/shapes.js";
import { prepareShipConventions } from "../templates/sailing/src/conventions.js";
import { createMaterials as createSailingMaterials } from "../templates/sailing/src/render/materials.js";
import { createShipModel } from "../templates/sailing/src/render/props.js";
import { preparePlayerConventions as prepareShooterConventions } from "../templates/shooter/src/conventions.js";
import { createMaterials as createShooterMaterials } from "../templates/shooter/src/render/materials.js";
import {
  createLegsVisual as createShooterLegs,
  createViewmodelVisual as createShooterViewmodel,
} from "../templates/shooter/src/render/shapes.js";
import { preparePlayerConventions as prepareStarterConventions } from "../templates/starter/src/conventions.js";

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
    const model = createRpgVisual(createRpgMaterials());
    const conventions = prepareRpgConventions(model);

    expectFactor(conventions.normaliseFactor);
    expect(conventions.boneNames).toContain("RightHand");
    expect(conventions.attachedBone).toBe("RightHand");
    expectGrounding(model, conventions);
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
    const model = createShipModel(createSailingMaterials());

    expectFactor(prepareShipConventions(model));
  });

  it("grounds, scales, and attaches the shooter player", () => {
    const materials = createShooterMaterials();
    // First person splits the player across two spaces: the weapon rides the camera and the legs
    // ride the body, so the size-and-hand conventions and the floor-contact one measure different
    // objects. Both still run, and both still report.
    const viewmodel = createShooterViewmodel(materials);
    const legs = createShooterLegs(materials);
    const conventions = prepareShooterConventions(viewmodel, legs);

    expectFactor(conventions.normaliseFactor);
    expect(conventions.boneNames).toContain("RightHand");
    expect(conventions.attachedBone).toBe("RightHand");
    expectGrounding(legs, conventions);
  });

  it("grounds and scales the starter player", () => {
    const model = new Mesh(new BoxGeometry(0.6, 1, 0.6), new MeshBasicMaterial());
    const conventions = prepareStarterConventions(model);

    expectFactor(conventions.normaliseFactor);
    expectGrounding(model, conventions);
  });
});
